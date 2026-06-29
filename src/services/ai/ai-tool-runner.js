'use strict';

const AiToolAuditLog = require('../../models/AiToolAuditLog');
const { defaultAiObservabilityService } = require('./ai-observability.service');
const { AiToolPermissionError, assertToolAllowed, getActorContext } = require('./ai-permission-guard');
const { createAiToolRegistry } = require('./ai-tool-registry');

const PUBLIC_TOOL_ERROR_MESSAGES = Object.freeze({
  AUTH_REQUIRED: 'B\u1ea1n c\u1ea7n \u0111\u0103ng nh\u1eadp \u0111\u1ec3 ki\u1ec3m tra d\u1eef li\u1ec7u n\u00e0y.',
  INVALID_BOOKING_TIME: 'Th\u1eddi gian ki\u1ec3m tra b\u00e0n kh\u00f4ng h\u1ee3p l\u1ec7.',
  BOOKING_INFO_REQUIRED: 'C\u1ea7n b\u1ed5 sung th\u00f4ng tin \u0111\u1eb7t b\u00e0n.',
  BOOKING_TABLE_UNAVAILABLE: 'Kh\u00f4ng c\u00f3 b\u00e0n ph\u00f9 h\u1ee3p cho y\u00eau c\u1ea7u n\u00e0y.',
  PENDING_ACTION_EXPIRED: 'B\u1ea3n xem tr\u01b0\u1edbc \u0111\u00e3 h\u1ebft h\u1ea1n.',
  VOUCHER_INVALID: 'Voucher kh\u00f4ng h\u1ee3p l\u1ec7.',
  SELECTED_RESTAURANT_REQUIRED: 'Vui long chon nha hang truoc khi dung tro ly AI cho owner.',
  OWNER_RESTAURANT_FORBIDDEN: 'Ban khong co quyen truy cap du lieu cua nha hang nay.',
  OWNER_REVIEW_NOT_FOUND: 'Khong tim thay review phu hop trong nha hang da chon.',
  ADMIN_ACCESS_REQUIRED: 'Can tai khoan admin de dung tool nay.',
  TOOL_INVALID_ARGUMENT: 'Yêu cầu gọi tool không hợp lệ.',
  TOOL_NOT_ALLOWED: 'Tool này không được phép sử dụng.',
  TOOL_TIMEOUT: 'Tool phản hồi quá lâu.',
  RESTAURANT_NOT_FOUND: 'Không tìm thấy nhà hàng công khai phù hợp.',
  MENU_NOT_FOUND: 'Không tìm thấy menu công khai phù hợp.',
  POLICY_NOT_FOUND: 'Không tìm thấy nguồn chính sách công khai phù hợp.',
  TOOL_INTERNAL_ERROR: 'Tool tạm thời không khả dụng.',
  INVALID_REQUEST: 'Yeu cau goi y chua hop le.',
});

class AiToolRunnerError extends Error {
  constructor(code, message, { status = 'failed', cause } = {}) {
    super(message || PUBLIC_TOOL_ERROR_MESSAGES[code] || PUBLIC_TOOL_ERROR_MESSAGES.TOOL_INTERNAL_ERROR);
    this.name = 'AiToolRunnerError';
    this.code = code;
    this.status = status;
    this.cause = cause;
  }
}

const getPublicToolMessage = (code) => (
  PUBLIC_TOOL_ERROR_MESSAGES[code] || PUBLIC_TOOL_ERROR_MESSAGES.TOOL_INTERNAL_ERROR
);

const safeParseArguments = (rawArguments) => {
  if (rawArguments === undefined || rawArguments === null || rawArguments === '') return {};
  if (typeof rawArguments === 'object' && !Array.isArray(rawArguments)) return rawArguments;
  if (typeof rawArguments !== 'string') {
    throw new AiToolRunnerError('TOOL_INVALID_ARGUMENT', 'Tool arguments must be a JSON object.');
  }

  let parsed;
  try {
    parsed = JSON.parse(rawArguments);
  } catch (error) {
    throw new AiToolRunnerError('TOOL_INVALID_ARGUMENT', 'Tool arguments must be valid JSON.', {
      cause: error,
    });
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AiToolRunnerError('TOOL_INVALID_ARGUMENT', 'Tool arguments must be a JSON object.');
  }

  return parsed;
};

const schemaTypes = (schema) => (Array.isArray(schema.type) ? schema.type : [schema.type]);

const validateValue = (schema, value, path) => {
  const types = schemaTypes(schema);
  if (value === null) {
    if (types.includes('null')) return;
    throw new AiToolRunnerError('TOOL_INVALID_ARGUMENT', `${path} must not be null.`);
  }

  if (types.includes('string')) {
    if (typeof value !== 'string') {
      throw new AiToolRunnerError('TOOL_INVALID_ARGUMENT', `${path} must be a string.`);
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      throw new AiToolRunnerError('TOOL_INVALID_ARGUMENT', `${path} is too short.`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      throw new AiToolRunnerError('TOOL_INVALID_ARGUMENT', `${path} is too long.`);
    }
    if (schema.pattern && !(new RegExp(schema.pattern).test(value))) {
      throw new AiToolRunnerError('TOOL_INVALID_ARGUMENT', `${path} has an invalid format.`);
    }
    if (schema.enum && !schema.enum.includes(value)) {
      throw new AiToolRunnerError('TOOL_INVALID_ARGUMENT', `${path} is not an allowed value.`);
    }
    return;
  }

  if (types.includes('integer')) {
    if (!Number.isInteger(value)) {
      throw new AiToolRunnerError('TOOL_INVALID_ARGUMENT', `${path} must be an integer.`);
    }
    if (schema.minimum !== undefined && value < schema.minimum) {
      throw new AiToolRunnerError('TOOL_INVALID_ARGUMENT', `${path} is below the minimum.`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      throw new AiToolRunnerError('TOOL_INVALID_ARGUMENT', `${path} is above the maximum.`);
    }
    return;
  }

  if (types.includes('number')) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new AiToolRunnerError('TOOL_INVALID_ARGUMENT', `${path} must be a number.`);
    }
    if (schema.minimum !== undefined && value < schema.minimum) {
      throw new AiToolRunnerError('TOOL_INVALID_ARGUMENT', `${path} is below the minimum.`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      throw new AiToolRunnerError('TOOL_INVALID_ARGUMENT', `${path} is above the maximum.`);
    }
    return;
  }

  if (types.includes('boolean')) {
    if (typeof value !== 'boolean') {
      throw new AiToolRunnerError('TOOL_INVALID_ARGUMENT', `${path} must be a boolean.`);
    }
    return;
  }

  if (types.includes('array')) {
    if (!Array.isArray(value)) {
      throw new AiToolRunnerError('TOOL_INVALID_ARGUMENT', `${path} must be an array.`);
    }
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      throw new AiToolRunnerError('TOOL_INVALID_ARGUMENT', `${path} has too few items.`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      throw new AiToolRunnerError('TOOL_INVALID_ARGUMENT', `${path} has too many items.`);
    }
    if (schema.items) {
      value.forEach((item, index) => validateValue(schema.items, item, `${path}[${index}]`));
    }
    return;
  }

  if (types.includes('object')) {
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new AiToolRunnerError('TOOL_INVALID_ARGUMENT', `${path} must be an object.`);
    }
    return;
  }

  throw new AiToolRunnerError('TOOL_INVALID_ARGUMENT', `${path} has an unsupported schema.`);
};

const validateArguments = (schema, args) => {
  if (schema.type !== 'object') {
    throw new AiToolRunnerError('TOOL_INVALID_ARGUMENT', 'Tool schema must be an object.');
  }

  const allowedKeys = new Set(Object.keys(schema.properties || {}));
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(args)) {
      if (!allowedKeys.has(key)) {
        throw new AiToolRunnerError('TOOL_INVALID_ARGUMENT', `Unknown field: ${key}.`);
      }
    }
  }

  for (const key of schema.required || []) {
    if (!Object.hasOwn(args, key)) {
      throw new AiToolRunnerError('TOOL_INVALID_ARGUMENT', `Missing field: ${key}.`);
    }
  }

  for (const [key, value] of Object.entries(args)) {
    validateValue(schema.properties[key], value, key);
  }

  return args;
};

const SENSITIVE_AUDIT_KEYS = new Set([
  'apikey',
  'accountnumber',
  'accountholder',
  'accountname',
  'authorization',
  'bank',
  'bankaccount',
  'bankcode',
  'bankinfo',
  'bankname',
  'card',
  'cardnumber',
  'code',
  'complaint',
  'complainttext',
  'cookie',
  'cvv',
  'customeremail',
  'customerid',
  'customername',
  'customerphone',
  'checkouturl',
  'email',
  'gatewayrefundid',
  'gatewaytransactionid',
  'internalnotes',
  'metadata',
  'message',
  'note',
  'order',
  'ordercode',
  'orderid',
  'password',
  'payment',
  'paymentid',
  'paymentlinkid',
  'providerpayload',
  'phone',
  'q',
  'qrcode',
  'rawpayload',
  'query',
  'reason',
  'redemptionid',
  'refund',
  'refundid',
  'refundnote',
  'search',
  'secret',
  'specialrequests',
  'statushistory',
  'token',
  'vouchercode',
  'voucherid',
  'webhookpayload',
  'withdrawal',
  'withdrawalid',
]);

const isSensitiveAuditKey = (key) => (
  typeof key === 'string'
  && SENSITIVE_AUDIT_KEYS.has(key.replace(/[^a-z0-9]/gi, '').toLowerCase())
);

const redactValue = (value, key = null) => {
  if (isSensitiveAuditKey(key) && value !== null && value !== undefined) return '[redacted]';
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const compact = value.replace(/\s+/g, ' ').trim();
    return compact.length > 80 ? `${compact.slice(0, 79)}…` : compact;
  }
  if (Array.isArray(value)) return value.slice(0, 5).map((item) => redactValue(item));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([nestedKey, nested]) => [
        nestedKey,
        redactValue(nested, nestedKey),
      ]),
    );
  }
  return '[redacted]';
};

const withTimeout = (promise, timeoutMs, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(new AiToolRunnerError('TOOL_TIMEOUT', 'Tool was aborted.', { cause: signal.reason }));
    return;
  }

  const timeoutId = setTimeout(() => {
    reject(new AiToolRunnerError('TOOL_TIMEOUT', 'Tool timed out.'));
  }, timeoutMs);
  timeoutId.unref?.();

  const abortHandler = () => {
    clearTimeout(timeoutId);
    reject(new AiToolRunnerError('TOOL_TIMEOUT', 'Tool was aborted.', { cause: signal.reason }));
  };

  signal?.addEventListener('abort', abortHandler, { once: true });

  promise
    .then(resolve)
    .catch(reject)
    .finally(() => {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', abortHandler);
    });
});

const auditSafely = async (auditLogger, payload) => {
  try {
    await auditLogger.create(payload);
  } catch (error) {
    console.warn(`[AI Tool Audit] failed tool=${payload.toolName} code=${error.message}`);
  }
};

const normalizeRunnerError = (error) => {
  if (error instanceof AiToolRunnerError) return error;
  if (error instanceof AiToolPermissionError) {
    return new AiToolRunnerError(error.code, error.message, { status: 'forbidden', cause: error });
  }
  if (error?.code) {
    const normalized = new AiToolRunnerError(error.code, error.message, {
      status: error.status || 'failed',
      cause: error,
    });
    normalized.details = error.details || null;
    return normalized;
  }
  return new AiToolRunnerError('TOOL_INTERNAL_ERROR', getPublicToolMessage('TOOL_INTERNAL_ERROR'), {
    cause: error,
  });
};

const makeAuthRequiredResult = (tool, args) => {
  if (tool?.resultType !== 'voucher_result') return null;

  return {
    type: 'voucher_result',
    version: 1,
    payload: {
      valid: false,
      status: 'auth_required',
      authRequired: true,
      code: typeof args?.code === 'string' ? args.code.trim().toUpperCase() : null,
      reason: 'B\u1ea1n c\u1ea7n \u0111\u0103ng nh\u1eadp t\u00e0i kho\u1ea3n kh\u00e1ch h\u00e0ng \u0111\u1ec3 ki\u1ec3m tra voucher.',
      loginUrl: '/auth/login',
      discountAmountEstimate: 0,
      orderAmountEstimate: typeof args?.orderAmountEstimate === 'number' ? args.orderAmountEstimate : null,
      checkedAt: new Date().toISOString(),
      disclaimer: 'Voucher s\u1ebd \u0111\u01b0\u1ee3c ki\u1ec3m tra l\u1ea1i trong lu\u1ed3ng \u0111\u1eb7t b\u00e0n ch\u00ednh th\u1ee9c.',
      sourceLabel: 'BookEat voucher validation',
    },
  };
};

const sanitizeToolResultForLlm = (value, toolName) => {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeToolResultForLlm(item, toolName));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const excludeKeys = new Set([
    'scoreBreakdown',
    'componentScores',
    'matchDetails',
    'rawProfile',
    'rawHistory',
    'rawInteractions',
  ]);

  const entries = Object.entries(value)
    .filter(([key]) => !excludeKeys.has(key))
    .map(([key, val]) => {
      if (key === 'image' || key === 'imageUrl') {
        return [key, val ? '[image_url]' : null];
      }
      if (key === 'metadata' && val && typeof val === 'object') {
        const cleanMeta = {};
        const allowedMeta = ['restaurantId', 'menuItemId', 'available', 'tableId', 'voucherId', 'pendingActionId'];
        for (const k of allowedMeta) {
          if (val[k] !== undefined) cleanMeta[k] = val[k];
        }
        return [key, cleanMeta];
      }
      if (key === 'reasons' && Array.isArray(val)) {
        return [key, val.slice(0, 3)];
      }
      return [key, sanitizeToolResultForLlm(val, toolName)];
    });

  return Object.fromEntries(entries);
};

const createAiToolRunner = ({
  registry = createAiToolRegistry(),
  auditLogger = AiToolAuditLog,
  observability = defaultAiObservabilityService,
  timeoutMs: defaultTimeoutMs = 10000,
} = {}) => ({
  async runToolCall({
    toolName,
    rawArguments,
    requestId,
    user,
    ownerContext,
    adminContext,
    signal,
    timeoutMs,
  }) {
    const startedAt = process.hrtime.bigint();
    let argsForAudit = {};
    let actor = getActorContext(user);

    const finish = async ({ status, errorCode = null, result = null }) => {
      const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      await auditSafely(auditLogger, {
        requestId,
        userId: actor.userId,
        role: actor.role,
        toolName,
        argsRedacted: redactValue(argsForAudit),
        status,
        latencyMs,
        errorCode,
        createdAt: new Date(),
      });
      observability.recordToolCall({ toolName, status, errorCode });

      return { latencyMs, result };
    };

    try {
      const tool = registry.getTool(toolName);
      if (!tool) actor = assertToolAllowed(tool, { user });
      const parsedArgs = safeParseArguments(rawArguments);
      argsForAudit = parsedArgs;
      const args = validateArguments(tool.schema, parsedArgs);
      actor = assertToolAllowed(tool, { user });

      if (typeof tool.handler !== 'function') {
        throw new AiToolRunnerError('TOOL_NOT_ALLOWED', 'Tool handler is not configured.', {
          status: 'forbidden',
        });
      }

      const result = await withTimeout(
        Promise.resolve(tool.handler(args, { user, actor, requestId, ownerContext, adminContext, signal })),
        timeoutMs || defaultTimeoutMs,
        signal,
      );
      const { latencyMs } = await finish({ status: 'success', result });

      return {
        ok: true,
        toolName,
        status: 'success',
        label: tool.label,
        latencyMs,
        result,
        modelOutput: {
          ok: true,
          result: sanitizeToolResultForLlm(result, toolName),
        },
      };
    } catch (error) {
      const runnerError = normalizeRunnerError(error);
      const status = runnerError.status || (runnerError.code === 'TOOL_NOT_ALLOWED' ? 'forbidden' : 'failed');
      const tool = registry.getTool(toolName);
      const result = runnerError.code === 'AUTH_REQUIRED'
        ? makeAuthRequiredResult(tool, argsForAudit)
        : null;
      const { latencyMs } = await finish({ status, errorCode: runnerError.code });

      return {
        ok: false,
        toolName,
        status,
        label: registry.getTool(toolName)?.label || 'Đang xử lý...',
        latencyMs,
        errorCode: runnerError.code,
        message: getPublicToolMessage(runnerError.code),
        result,
        modelOutput: {
          ok: false,
          error: {
            code: runnerError.code,
            message: getPublicToolMessage(runnerError.code),
            ...(runnerError.details ? { details: runnerError.details } : {}),
          },
          ...(result ? { result: sanitizeToolResultForLlm(result, toolName) } : {}),
        },
      };
    }
  },
});

module.exports = {
  AiToolRunnerError,
  PUBLIC_TOOL_ERROR_MESSAGES,
  createAiToolRunner,
  getPublicToolMessage,
  safeParseArguments,
  validateArguments,
};
