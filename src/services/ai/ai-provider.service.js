'use strict';

const OpenAI = require('openai');

const PROVIDER_NAMES = Object.freeze(['openai', 'groq', 'nvidia']);
const FALLBACK_PROVIDER_ERROR_CODES = new Set([
  'AI_AUTH_ERROR',
  'AI_RATE_LIMITED',
  'AI_PROVIDER_RATE_LIMITED',
  'AI_TIMEOUT',
  'AI_UNAVAILABLE',
]);

const PUBLIC_ERRORS = {
  AI_AUTH_ERROR: {
    message: 'Cấu hình Trợ lý BookEat chưa hợp lệ.',
    retryable: false,
  },
  AI_RATE_LIMITED: {
    message: 'Bạn đang gửi quá nhiều yêu cầu. Vui lòng thử lại sau.',
    retryable: true,
  },
  AI_PROVIDER_RATE_LIMITED: {
    message: 'Nhà cung cấp AI đang quá tải hoặc hết hạn mức tạm thời. Vui lòng thử lại sau.',
    retryable: true,
  },
  AI_TIMEOUT: {
    message: 'Trợ lý phản hồi quá lâu. Vui lòng thử lại.',
    retryable: true,
  },
  AI_UNAVAILABLE: {
    message: 'Trợ lý đang tạm gián đoạn.',
    retryable: true,
  },
  AI_CANCELLED: {
    message: 'Phản hồi đã được dừng.',
    retryable: true,
  },
};

class AiProviderError extends Error {
  constructor(code, options = {}) {
    const publicError = PUBLIC_ERRORS[code] || PUBLIC_ERRORS.AI_UNAVAILABLE;
    super(publicError.message);
    this.name = 'AiProviderError';
    this.code = code in PUBLIC_ERRORS ? code : 'AI_UNAVAILABLE';
    this.retryable = options.retryable ?? publicError.retryable;
    this.cause = options.cause;
  }
}

const mapProviderError = (error) => {
  if (error instanceof AiProviderError) return error;

  const status = Number(error?.status);
  if (status === 401 || status === 403) {
    return new AiProviderError('AI_AUTH_ERROR', { cause: error });
  }
  if (status === 429) {
    return new AiProviderError('AI_PROVIDER_RATE_LIMITED', { cause: error });
  }
  if (
    error?.name === 'AbortError'
    || error?.name === 'APIConnectionTimeoutError'
    || status === 408
  ) {
    return new AiProviderError('AI_TIMEOUT', { cause: error });
  }

  return new AiProviderError('AI_UNAVAILABLE', { cause: error });
};

const mapStreamEventError = (event) => {
  const errorCode = event?.code || event?.response?.error?.code;
  if (errorCode === 'rate_limit_exceeded') {
    return new AiProviderError('AI_PROVIDER_RATE_LIMITED');
  }
  return new AiProviderError('AI_UNAVAILABLE');
};

const normalizeUsage = (usage) => ({
  inputTokens: Number(usage?.input_tokens ?? usage?.prompt_tokens) || 0,
  outputTokens: Number(usage?.output_tokens ?? usage?.completion_tokens) || 0,
});

const normalizeToolSchemaForProvider = (schema) => {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return schema;
  }

  const normalized = { ...schema };
  const types = Array.isArray(normalized.type) ? normalized.type : [normalized.type];

  if (types.includes('object')) {
    const properties = (
      normalized.properties
      && typeof normalized.properties === 'object'
      && !Array.isArray(normalized.properties)
    ) ? normalized.properties : {};

    normalized.properties = Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [
        key,
        normalizeToolSchemaForProvider(value),
      ]),
    );

    if (Object.keys(normalized.properties).length > 0) {
      // OpenAI-compatible function schemas expect all declared properties in `required`.
      // Optional fields remain optional by permitting `null` in their type union.
      normalized.required = Object.keys(normalized.properties);
      if (normalized.additionalProperties === undefined) {
        normalized.additionalProperties = false;
      }
    } else if (normalized.required === undefined) {
      normalized.required = [];
    }
  }

  if (types.includes('array') && normalized.items) {
    normalized.items = normalizeToolSchemaForProvider(normalized.items);
  }

  return normalized;
};

const normalizeToolsForProvider = (tools = []) => (
  Array.isArray(tools)
    ? tools.map((tool) => ({
      ...tool,
      parameters: normalizeToolSchemaForProvider(tool.parameters),
    }))
    : []
);

const normalizeFunctionCall = (item) => ({
  id: item.id || null,
  callId: item.call_id,
  name: item.name,
  arguments: item.arguments || '{}',
  type: 'function_call',
});

const normalizeChatFunctionCall = (toolCall) => ({
  id: toolCall.id || null,
  callId: toolCall.id || null,
  name: toolCall.function?.name || '',
  arguments: toolCall.function?.arguments || '{}',
  type: 'function_call',
});

const toChatCompletionMessages = ({ instructions, input = [] }) => {
  const messages = [];

  if (instructions) {
    messages.push({
      role: 'system',
      content: instructions,
    });
  }

  for (const item of input) {
    if (!item || typeof item !== 'object') continue;

    if (
      item.type === 'function_call'
      || item.role === 'function_call'
    ) {
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: item.call_id,
          type: 'function',
          function: {
            name: item.name,
            arguments: item.arguments || '{}',
          },
        }],
      });
      continue;
    }

    if (
      item.type === 'function_call_output'
      || item.role === 'function_call_output'
    ) {
      messages.push({
        role: 'tool',
        tool_call_id: item.call_id,
        content: typeof item.output === 'string'
          ? item.output
          : JSON.stringify(item.output),
      });
      continue;
    }

    if (typeof item.role === 'string') {
      messages.push({
        role: item.role,
        content: item.content ?? '',
      });
    }
  }

  return messages;
};

const normalizeProviderName = (providerName) => (
  PROVIDER_NAMES.includes(providerName) ? providerName : 'openai'
);

const getProviderRuntimeConfig = (config = {}, providerName = 'openai') => {
  const normalized = normalizeProviderName(providerName);

  if (normalized === 'groq') {
    return {
      providerName: 'groq',
      apiKey: config.groqApiKey || '',
      model: config.groqModel || 'openai/gpt-oss-120b',
      timeoutMs: config.groqTimeoutMs || config.timeoutMs || 30000,
      baseURL: config.groqBaseUrl || 'https://api.groq.com/openai/v1',
    };
  }

  if (normalized === 'nvidia') {
    return {
      providerName: 'nvidia',
      apiKey: config.nvidiaApiKey || '',
      model: config.nvidiaModel || 'stepfun-ai/step-3.7-flash',
      timeoutMs: config.nvidiaTimeoutMs || config.timeoutMs || 30000,
      baseURL: config.nvidiaBaseUrl || 'https://integrate.api.nvidia.com/v1',
    };
  }

  return {
    providerName: 'openai',
    apiKey: config.apiKey || '',
    model: config.model || 'gpt-4o-mini',
    timeoutMs: config.timeoutMs || 30000,
    baseURL: config.openaiBaseUrl || null,
  };
};

const isProviderConfigured = (config = {}, providerName = 'openai') => (
  Boolean(getProviderRuntimeConfig(config, providerName).apiKey)
);

const getProviderHealth = (config = {}) => {
  const primaryProvider = normalizeProviderName(config.provider || 'openai');
  const fallbackProvider = normalizeProviderName(config.fallbackProvider || 'groq');
  const fallbackEnabled = Boolean(
    config.providerFallbackEnabled
    && fallbackProvider
    && fallbackProvider !== primaryProvider
  );
  const openaiConfigured = isProviderConfigured(config, 'openai');
  const groqConfigured = isProviderConfigured(config, 'groq');
  const nvidiaConfigured = isProviderConfigured(config, 'nvidia');
  const primaryConfigured = isProviderConfigured(config, primaryProvider);
  const fallbackConfigured = fallbackEnabled && isProviderConfigured(config, fallbackProvider);

  return {
    primaryProvider,
    fallbackProvider,
    fallbackEnabled,
    openaiConfigured,
    groqConfigured,
    nvidiaConfigured,
    primaryConfigured,
    fallbackConfigured,
    configured: primaryConfigured || fallbackConfigured,
  };
};

const createOpenAiCompatibleProvider = ({
  providerName = 'openai',
  clientFactory,
} = {}) => ({
  async *streamText({
    instructions,
    input,
    config,
    signal,
    tools = [],
    maxToolCalls,
  }) {
    const runtime = getProviderRuntimeConfig(config, providerName);
    if (!runtime.apiKey) {
      throw new AiProviderError('AI_AUTH_ERROR', {
        cause: {
          provider: runtime.providerName,
          code: 'missing_api_key',
        },
      });
    }

    const createClient = clientFactory || ((apiKey, providerConfig) => new OpenAI({
      apiKey,
      ...(providerConfig.baseURL ? { baseURL: providerConfig.baseURL } : {}),
      maxRetries: 0,
      timeout: providerConfig.timeoutMs,
    }));

    let stream;
    try {
      const client = createClient(runtime.apiKey, runtime);
      const normalizedTools = normalizeToolsForProvider(tools);
      const body = {
        model: runtime.model,
        instructions,
        input,
        max_output_tokens: config.maxOutputTokens,
        store: false,
        stream: true,
      };

      if (normalizedTools.length > 0) {
        body.tools = normalizedTools;
        body.tool_choice = 'auto';
        body.parallel_tool_calls = false;
        if (Number.isInteger(maxToolCalls)) body.max_tool_calls = maxToolCalls;
      }

      stream = await client.responses.create(body, {
        signal,
        timeout: runtime.timeoutMs,
        maxRetries: 0,
      });
    } catch (error) {
      throw mapProviderError(error);
    }

    try {
      const yieldedToolCalls = new Set();
      for await (const event of stream) {
        if (event.type === 'response.output_text.delta' && event.delta) {
          yield { type: 'delta', text: event.delta };
        } else if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
          const call = normalizeFunctionCall(event.item);
          if (call.callId && !yieldedToolCalls.has(call.callId)) {
            yieldedToolCalls.add(call.callId);
            yield { type: 'function_call', call };
          }
        } else if (event.type === 'response.completed') {
          for (const item of event.response?.output || []) {
            if (item?.type === 'function_call') {
              const call = normalizeFunctionCall(item);
              if (call.callId && !yieldedToolCalls.has(call.callId)) {
                yieldedToolCalls.add(call.callId);
                yield { type: 'function_call', call };
              }
            }
          }
          yield { type: 'completed', usage: normalizeUsage(event.response?.usage) };
        } else if (
          event.type === 'error'
          || event.type === 'response.failed'
          || event.type === 'response.incomplete'
        ) {
          throw mapStreamEventError(event);
        }
      }
    } catch (error) {
      throw mapProviderError(error);
    }
  },
});

const createOpenAiProvider = (options = {}) => createOpenAiCompatibleProvider({
  ...options,
  providerName: 'openai',
});

const createGroqProvider = (options = {}) => createOpenAiCompatibleProvider({
  ...options,
  providerName: 'groq',
});

const createNvidiaProvider = ({
  clientFactory,
} = {}) => ({
  async *streamText({
    instructions,
    input,
    config,
    signal,
    tools = [],
  }) {
    const runtime = getProviderRuntimeConfig(config, 'nvidia');
    if (!runtime.apiKey) {
      throw new AiProviderError('AI_AUTH_ERROR', {
        cause: {
          provider: runtime.providerName,
          code: 'missing_api_key',
        },
      });
    }

    const createClient = clientFactory || ((apiKey, providerConfig) => new OpenAI({
      apiKey,
      ...(providerConfig.baseURL ? { baseURL: providerConfig.baseURL } : {}),
      maxRetries: 0,
      timeout: providerConfig.timeoutMs,
    }));

    let stream;
    try {
      const client = createClient(runtime.apiKey, runtime);
      const normalizedTools = normalizeToolsForProvider(tools);
      const body = {
        model: runtime.model,
        messages: toChatCompletionMessages({ instructions, input }),
        chat_template_kwargs: { thinking: false },
        max_tokens: config.maxOutputTokens,
        stream: true,
        temperature: 0.7,
      };

      if (normalizedTools.length > 0) {
        body.tools = normalizedTools.map((tool) => ({
          type: tool.type,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            ...(tool.strict === true ? { strict: true } : {}),
          },
        }));
        body.tool_choice = 'auto';
        body.parallel_tool_calls = false;
      }

      stream = await client.chat.completions.create(body, {
        signal,
        timeout: runtime.timeoutMs,
        maxRetries: 0,
      });
    } catch (error) {
      throw mapProviderError(error);
    }

    try {
      const toolCalls = new Map();
      let usage = { inputTokens: 0, outputTokens: 0 };

      for await (const chunk of stream) {
        const choice = chunk?.choices?.[0];
        const delta = choice?.delta || {};

        if (typeof delta.content === 'string' && delta.content.length > 0) {
          yield { type: 'delta', text: delta.content };
        }

        if (Array.isArray(delta.tool_calls)) {
          for (const toolCallDelta of delta.tool_calls) {
            const index = Number.isInteger(toolCallDelta.index)
              ? toolCallDelta.index
              : toolCalls.size;
            const current = toolCalls.get(index) || {
              id: null,
              type: 'function',
              function: {
                name: '',
                arguments: '',
              },
            };

            if (toolCallDelta.id) current.id = toolCallDelta.id;
            if (toolCallDelta.type) current.type = toolCallDelta.type;
            if (toolCallDelta.function?.name) {
              current.function.name += toolCallDelta.function.name;
            }
            if (toolCallDelta.function?.arguments) {
              current.function.arguments += toolCallDelta.function.arguments;
            }

            toolCalls.set(index, current);
          }
        }

        if (chunk?.usage) {
          usage = normalizeUsage(chunk.usage);
        }
      }

      for (const toolCall of toolCalls.values()) {
        if (!toolCall.id || !toolCall.function?.name) continue;
        yield {
          type: 'function_call',
          call: normalizeChatFunctionCall(toolCall),
        };
      }

      yield { type: 'completed', usage };
    } catch (error) {
      throw mapProviderError(error);
    }
  },
});

const shouldFallbackToProvider = ({
  error,
  config,
  fallbackProvider,
  emittedProviderEvents,
}) => {
  const mappedError = mapProviderError(error);
  return Boolean(
    config?.providerFallbackEnabled
    && fallbackProvider
    && isProviderConfigured(config, fallbackProvider)
    && emittedProviderEvents === 0
    && FALLBACK_PROVIDER_ERROR_CODES.has(mappedError.code)
  );
};

const createAiProviderManager = ({
  providers = {
    openai: createOpenAiProvider(),
    groq: createGroqProvider(),
    nvidia: createNvidiaProvider(),
  },
} = {}) => ({
  async *streamText(request) {
    const config = request.config || {};
    const health = getProviderHealth(config);
    const primaryProvider = providers[health.primaryProvider];
    const fallbackProvider = providers[health.fallbackProvider];
    let emittedProviderEvents = 0;

    if (!primaryProvider) {
      throw new AiProviderError('AI_UNAVAILABLE', {
        cause: { provider: health.primaryProvider, code: 'provider_not_registered' },
      });
    }

    try {
      yield {
        type: 'provider_status',
        providerUsed: health.primaryProvider,
        fallbackUsed: false,
        fallbackReason: null,
      };

      for await (const event of primaryProvider.streamText(request)) {
        emittedProviderEvents += 1;
        yield {
          ...event,
          providerUsed: health.primaryProvider,
          fallbackUsed: false,
          fallbackReason: null,
        };
      }
      return;
    } catch (error) {
      const mappedError = mapProviderError(error);
      if (!shouldFallbackToProvider({
        error: mappedError,
        config,
        fallbackProvider: health.fallbackProvider,
        emittedProviderEvents,
      })) {
        throw mappedError;
      }

      if (!fallbackProvider) {
        throw mappedError;
      }

      yield {
        type: 'provider_status',
        providerUsed: health.fallbackProvider,
        fallbackUsed: true,
        fallbackReason: mappedError.code,
      };

      for await (const event of fallbackProvider.streamText(request)) {
        yield {
          ...event,
          providerUsed: health.fallbackProvider,
          fallbackUsed: true,
          fallbackReason: mappedError.code,
        };
      }
    }
  },
});

const toPublicAiError = (error) => {
  const mappedError = mapProviderError(error);
  return {
    code: mappedError.code,
    message: mappedError.message,
    retryable: mappedError.retryable,
  };
};

module.exports = {
  AiProviderError,
  createAiProviderManager,
  createGroqProvider,
  createNvidiaProvider,
  createOpenAiProvider,
  createOpenAiCompatibleProvider,
  getProviderHealth,
  getProviderRuntimeConfig,
  isProviderConfigured,
  mapProviderError,
  normalizeFunctionCall,
  normalizeProviderName,
  toPublicAiError,
};
