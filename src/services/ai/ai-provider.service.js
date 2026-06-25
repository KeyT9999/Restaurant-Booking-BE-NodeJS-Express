'use strict';

const OpenAI = require('openai');

const PROVIDER_NAMES = Object.freeze(['openai', 'groq']);
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

const normalizeFunctionCall = (item) => ({
  id: item.id || null,
  callId: item.call_id,
  name: item.name,
  arguments: item.arguments || '{}',
  type: 'function_call',
});

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
  const primaryConfigured = isProviderConfigured(config, primaryProvider);
  const fallbackConfigured = fallbackEnabled && isProviderConfigured(config, fallbackProvider);

  return {
    primaryProvider,
    fallbackProvider,
    fallbackEnabled,
    openaiConfigured,
    groqConfigured,
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
      const body = {
        model: runtime.model,
        instructions,
        input,
        max_output_tokens: config.maxOutputTokens,
        store: false,
        stream: true,
      };

      if (Array.isArray(tools) && tools.length > 0) {
        body.tools = tools;
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
