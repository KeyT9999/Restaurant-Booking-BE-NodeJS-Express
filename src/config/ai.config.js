'use strict';

class AiConfigError extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'AiConfigError';
    this.code = 'AI_CONFIG_ERROR';
    this.field = field;
  }
}

const parseBoolean = (env, name, defaultValue) => {
  const value = env[name];
  if (value === undefined || value === '') return defaultValue;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new AiConfigError(name, `${name} must be true or false`);
};

const parseInteger = (env, name, defaultValue, { min, max }) => {
  const rawValue = env[name];
  if (rawValue === undefined || rawValue === '') return defaultValue;

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new AiConfigError(name, `${name} must be an integer from ${min} to ${max}`);
  }

  return value;
};

const parseNumber = (env, name, defaultValue, { min, max }) => {
  const rawValue = env[name];
  if (rawValue === undefined || rawValue === '') return defaultValue;

  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new AiConfigError(name, `${name} must be a number from ${min} to ${max}`);
  }

  return value;
};

const parseProvider = (env, name, defaultValue) => {
  const rawValue = env[name];
  if (rawValue === undefined || rawValue === '') return defaultValue;

  const value = String(rawValue).trim().toLowerCase();
  if (['openai', 'groq', 'nvidia'].includes(value)) return value;
  throw new AiConfigError(name, `${name} must be openai, groq or nvidia`);
};

const parseUrl = (env, name, defaultValue) => {
  const rawValue = env[name];
  const value = rawValue === undefined || rawValue === '' ? defaultValue : String(rawValue).trim();
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('unsupported protocol');
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new AiConfigError(name, `${name} must be a valid http(s) URL`);
  }
};

const parseModel = (env, name, defaultValue) => {
  const model = (env[name] || defaultValue).trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,119}$/.test(model)) {
    throw new AiConfigError(name, `${name} is invalid`);
  }
  return model;
};

const getAiConfig = (env = process.env) => {
  const model = parseModel(env, 'OPENAI_MODEL', 'gpt-4o-mini');
  const timeoutMs = parseInteger(env, 'OPENAI_TIMEOUT_MS', 30000, { min: 1000, max: 120000 });

  return Object.freeze({
    enabled: parseBoolean(env, 'AI_ENABLED', false),
    provider: parseProvider(env, 'AI_PROVIDER', 'openai'),
    fallbackProvider: parseProvider(env, 'AI_FALLBACK_PROVIDER', 'groq'),
    providerFallbackEnabled: parseBoolean(env, 'AI_PROVIDER_FALLBACK_ENABLED', true),
    apiKey: (env.OPENAI_API_KEY || '').trim(),
    model,
    timeoutMs,
    groqApiKey: (env.GROQ_API_KEY || '').trim(),
    groqModel: parseModel(env, 'GROQ_MODEL', 'openai/gpt-oss-120b'),
    groqBaseUrl: parseUrl(env, 'GROQ_BASE_URL', 'https://api.groq.com/openai/v1'),
    groqTimeoutMs: parseInteger(env, 'GROQ_TIMEOUT_MS', 30000, { min: 1000, max: 120000 }),
    nvidiaApiKey: (env.NVIDIA_API_KEY || '').trim(),
    nvidiaModel: parseModel(env, 'NVIDIA_MODEL', 'stepfun-ai/step-3.7-flash'),
    nvidiaBaseUrl: parseUrl(env, 'NVIDIA_BASE_URL', 'https://integrate.api.nvidia.com/v1'),
    nvidiaTimeoutMs: parseInteger(env, 'NVIDIA_TIMEOUT_MS', 30000, { min: 1000, max: 120000 }),
    toolTimeoutMs: parseInteger(env, 'AI_TOOL_TIMEOUT_MS', 10000, { min: 100, max: 60000 }),
    maxInputChars: parseInteger(env, 'AI_MAX_INPUT_CHARS', 2000, { min: 1, max: 20000 }),
    maxHistoryMessages: parseInteger(env, 'AI_MAX_HISTORY_MESSAGES', 8, { min: 0, max: 20 }),
    maxOutputTokens: parseInteger(env, 'AI_MAX_OUTPUT_TOKENS', 800, { min: 1, max: 8192 }),
    rateLimitWindowMs: parseInteger(env, 'AI_RATE_LIMIT_WINDOW_MS', 60000, { min: 1000, max: 3600000 }),
    rateLimitMaxRequests: parseInteger(env, 'AI_RATE_LIMIT_MAX_REQUESTS', 10, { min: 1, max: 1000 }),
    dailyBudgetEstimate: parseNumber(env, 'AI_DAILY_BUDGET_ESTIMATE', 0, { min: 0, max: 1000000 }),
    monthlyBudgetEstimate: parseNumber(env, 'AI_MONTHLY_BUDGET_ESTIMATE', 0, { min: 0, max: 10000000 }),
    publicToolsEnabled: parseBoolean(env, 'AI_PUBLIC_TOOLS_ENABLED', true),
    customerDynamicToolsEnabled: parseBoolean(env, 'AI_CUSTOMER_DYNAMIC_TOOLS_ENABLED', true),
    availabilityToolEnabled: parseBoolean(env, 'AI_AVAILABILITY_TOOL_ENABLED', true),
    voucherToolEnabled: parseBoolean(env, 'AI_VOUCHER_TOOL_ENABLED', true),
    bookingPreviewToolEnabled: parseBoolean(env, 'AI_BOOKING_PREVIEW_TOOL_ENABLED', true),
    bookingConfirmEnabled: parseBoolean(env, 'AI_BOOKING_CONFIRM_ENABLED', true),
    knowledgeSearchEnabled: parseBoolean(env, 'AI_KNOWLEDGE_SEARCH_ENABLED', true),
    ownerToolsEnabled: parseBoolean(env, 'AI_OWNER_TOOLS_ENABLED', true),
    adminToolsEnabled: parseBoolean(env, 'AI_ADMIN_TOOLS_ENABLED', true),
    pendingActionTtlMinutes: parseInteger(env, 'AI_PENDING_ACTION_TTL_MINUTES', 10, { min: 1, max: 60 }),
    maxToolRounds: parseInteger(env, 'AI_MAX_TOOL_ROUNDS', 3, { min: 0, max: 10 }),
    maxToolCalls: parseInteger(env, 'AI_MAX_TOOL_CALLS', 5, { min: 0, max: 20 }),
  });
};

module.exports = {
  AiConfigError,
  getAiConfig,
};
