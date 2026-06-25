'use strict';

const { getAiConfig } = require('../../config/ai.config');
const { buildPrompt } = require('./ai-prompt-builder');
const { createAiToolRegistry } = require('./ai-tool-registry');
const { createAiToolRunner } = require('./ai-tool-runner');
const {
  AiProviderError,
  createAiProviderManager,
  mapProviderError,
} = require('./ai-provider.service');

const makeFunctionCallInputItem = (call) => ({
  type: 'function_call',
  call_id: call.callId,
  name: call.name,
  arguments: call.arguments || '{}',
  ...(call.id ? { id: call.id } : {}),
  status: 'completed',
});

const makeFunctionCallOutputItem = (call, output) => ({
  type: 'function_call_output',
  call_id: call.callId,
  output: JSON.stringify(output),
});

const estimateTokens = (text) => {
  if (typeof text !== 'string') return 0;
  return Math.ceil(text.length / 4);
};

const applyTokenBudgetGuard = (instructions, input, maxBudgetTokens = 3000) => {
  const instructionsTokens = estimateTokens(instructions);
  let totalTokens = instructionsTokens + input.reduce((acc, msg) => {
    const content = msg.content || msg.output || JSON.stringify(msg);
    return acc + estimateTokens(content);
  }, 0);

  const inputTokensBeforeTrim = totalTokens;
  let trimmedHistoryCount = 0;
  let trimmedToolPayload = false;

  if (totalTokens <= maxBudgetTokens) {
    return {
      input,
      inputTokensBeforeTrim,
      inputTokensAfterTrim: totalTokens,
      trimmedHistoryCount,
      trimmedToolPayload,
    };
  }

  let cleanInput = [...input];

  let userQueryIndex = cleanInput.findIndex(msg => 
    msg.role === 'user' && 
    (msg.content?.includes('[BookEat page context') || 
     msg.content?.includes('[BookEat owner context') || 
     msg.content?.includes('[BookEat admin context') || 
     !msg.content?.startsWith('{'))
  );

  if (userQueryIndex === -1) {
    userQueryIndex = cleanInput.findIndex(msg => 
      msg.role === 'function_call' || msg.type === 'function_call' || 
      msg.role === 'function_call_output' || msg.type === 'function_call_output'
    ) - 1;
    if (userQueryIndex < 0) {
      userQueryIndex = cleanInput.length - 1;
    }
  }

  while (userQueryIndex > 0 && totalTokens > maxBudgetTokens) {
    const removed = cleanInput.shift();
    userQueryIndex -= 1;
    trimmedHistoryCount += 1;
    const content = removed.content || removed.output || JSON.stringify(removed);
    totalTokens -= estimateTokens(content);
  }

  if (totalTokens > maxBudgetTokens) {
    for (let i = 0; i < cleanInput.length; i++) {
      const msg = cleanInput[i];
      if ((msg.role === 'function_call_output' || msg.type === 'function_call_output' || msg.output !== undefined) && msg.output) {
        let outputStr = typeof msg.output === 'string' ? msg.output : JSON.stringify(msg.output);
        if (outputStr.length > 500) {
          try {
            const parsed = JSON.parse(outputStr);
            if (parsed.payload && Array.isArray(parsed.payload.items)) {
              parsed.payload.items = parsed.payload.items.slice(0, 2);
              const trimmedStr = JSON.stringify(parsed);
              if (trimmedStr.length < outputStr.length) {
                totalTokens -= estimateTokens(outputStr) - estimateTokens(trimmedStr);
                msg.output = trimmedStr;
                trimmedToolPayload = true;
              }
            } else {
              const trimmedStr = outputStr.slice(0, 300) + '... [trimmed]';
              totalTokens -= estimateTokens(outputStr) - estimateTokens(trimmedStr);
              msg.output = trimmedStr;
              trimmedToolPayload = true;
            }
          } catch {
            const trimmedStr = outputStr.slice(0, 300) + '... [trimmed]';
            totalTokens -= estimateTokens(outputStr) - estimateTokens(trimmedStr);
            msg.output = trimmedStr;
            trimmedToolPayload = true;
          }
        }
      }
    }
  }

  return {
    input: cleanInput,
    inputTokensBeforeTrim,
    inputTokensAfterTrim: totalTokens,
    trimmedHistoryCount,
    trimmedToolPayload,
  };
};

const createAiOrchestrator = ({
  provider = createAiProviderManager(),
  configProvider = getAiConfig,
  registry = createAiToolRegistry(),
  toolRunner = createAiToolRunner({ registry }),
} = {}) => ({
  async *streamChat({
    message,
    history,
    pageContext,
    ownerContext,
    adminContext,
    requestId,
    user,
    signal,
    config: suppliedConfig,
  }) {
    const config = suppliedConfig || configProvider();
    const timeoutController = new AbortController();
    let timedOut = false;

    const abortFromClient = () => timeoutController.abort(signal?.reason);
    if (signal?.aborted) abortFromClient();
    else signal?.addEventListener('abort', abortFromClient, { once: true });

    const timeoutId = setTimeout(() => {
      timedOut = true;
      timeoutController.abort(new Error('AI provider timeout'));
    }, config.timeoutMs);
    timeoutId.unref?.();

    try {
      const prompt = buildPrompt({ message, history, pageContext, ownerContext, adminContext });
      const role = user === undefined ? undefined : (user?.role || 'guest');
      const toolDefinitions = config.publicToolsEnabled === false ? [] : registry.getToolDefinitions(role);
      const maxToolRounds = Number.isInteger(config.maxToolRounds) ? config.maxToolRounds : 3;
      const maxToolCalls = Number.isInteger(config.maxToolCalls) ? config.maxToolCalls : 5;
      let input = prompt.input;
      let toolRounds = 0;
      let toolCallsUsed = 0;
      let usage = { inputTokens: 0, outputTokens: 0 };

      while (true) {
        const canUseTools = toolDefinitions.length > 0
          && toolRounds < maxToolRounds
          && toolCallsUsed < maxToolCalls;
        const roundToolCalls = [];

        const guardResult = applyTokenBudgetGuard(prompt.instructions, input);
        console.info(`[AI Token Budget Guard] inputTokensBeforeTrim=${guardResult.inputTokensBeforeTrim} inputTokensAfterTrim=${guardResult.inputTokensAfterTrim} trimmedHistoryCount=${guardResult.trimmedHistoryCount} trimmedToolPayload=${guardResult.trimmedToolPayload}`);

        for await (const event of provider.streamText({
          instructions: prompt.instructions,
          input: guardResult.input,
          config,
          signal: timeoutController.signal,
          tools: canUseTools ? toolDefinitions : [],
          maxToolCalls: canUseTools ? maxToolCalls - toolCallsUsed : 0,
        })) {
          if (event.type === 'provider_status') {
            yield event;
          } else if (event.type === 'delta') {
            yield event;
          } else if (event.type === 'function_call') {
            roundToolCalls.push(event.call);
          } else if (event.type === 'completed') {
            usage = event.usage || usage;
          }
        }

        if (!canUseTools || roundToolCalls.length === 0) {
          yield { type: 'completed', usage };
          return;
        }

        toolRounds += 1;
        const remainingCalls = Math.max(0, maxToolCalls - toolCallsUsed);
        const executableCalls = roundToolCalls.slice(0, remainingCalls);
        const toolInputItems = [];

        for (const call of executableCalls) {
          toolCallsUsed += 1;
          const tool = registry.getTool(call.name);

          yield {
            type: 'tool_started',
            tool: call.name,
            label: tool?.label || 'Đang xử lý...',
          };

          const toolResult = await toolRunner.runToolCall({
            toolName: call.name,
            rawArguments: call.arguments,
            requestId: requestId || 'unknown',
            user,
            ownerContext,
            adminContext,
            signal: timeoutController.signal,
            timeoutMs: config.toolTimeoutMs,
          });

          yield {
            type: 'tool_completed',
            tool: call.name,
            label: toolResult.label || tool?.label || 'Đã xử lý tool',
            status: toolResult.status,
            latencyMs: toolResult.latencyMs,
            errorCode: toolResult.errorCode || null,
            message: toolResult.ok ? null : toolResult.message,
          };

          if (toolResult.result) {
            yield {
              type: 'result',
              tool: call.name,
              result: toolResult.result,
            };
          }

          toolInputItems.push(makeFunctionCallInputItem(call));
          toolInputItems.push(makeFunctionCallOutputItem(call, toolResult.modelOutput));
        }

        input = [...input, ...toolInputItems];
      }
    } catch (error) {
      if (timedOut) throw new AiProviderError('AI_TIMEOUT', { cause: error });
      if (signal?.aborted) throw new AiProviderError('AI_CANCELLED', { cause: error });
      throw mapProviderError(error);
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', abortFromClient);
    }
  },
});

module.exports = {
  createAiOrchestrator,
  makeFunctionCallInputItem,
  makeFunctionCallOutputItem,
};
