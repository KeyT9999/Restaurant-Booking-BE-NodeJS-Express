'use strict';

const { randomUUID, createHash } = require('node:crypto');
const express = require('express');
const { getAiConfig } = require('../config/ai.config');
const aiController = require('../controllers/ai.controller');
const { sendError } = require('../controllers/ai.controller');
const { defaultAiObservabilityService } = require('../services/ai/ai-observability.service');
const aiKnowledgeController = require('../controllers/ai-knowledge.controller');
const aiPendingActionController = require('../controllers/ai-pending-action.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const User = require('../models/User');
const { verifyJwtToken } = require('../utils/jwt');

const getRequestActor = (req) => ({
  role: req.user?.role || 'guest',
  userId: req.user?._id || req.user?.id || null,
});

const createAiRateLimiter = ({
  configProvider = getAiConfig,
  observability = defaultAiObservabilityService,
} = {}) => {
  const clients = new Map();

  return (req, res, next) => {
    let config;
    try {
      config = configProvider();
    } catch (error) {
      return next();
    }

    const now = Date.now();
    const actor = getRequestActor(req);
    const key = actor.userId
      ? `${actor.role}:${actor.userId}`
      : `guest:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
    const current = clients.get(key);
    const record = !current || now >= current.resetAt
      ? { count: 0, resetAt: now + config.rateLimitWindowMs }
      : current;

    record.count += 1;
    clients.set(key, record);

    res.setHeader('X-RateLimit-Limit', config.rateLimitMaxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, config.rateLimitMaxRequests - record.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetAt / 1000));

    if (record.count > config.rateLimitMaxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
      res.setHeader('Retry-After', retryAfterSeconds);
      req.aiTelemetry = {
        ...(req.aiTelemetry || {}),
        role: actor.role,
        userId: actor.userId,
        status: 'failed',
        errorCode: 'RATE_LIMITED',
      };
      observability.recordRateLimitHit({ role: actor.role });

      // Safe logging of rate limit hit
      const rawId = actor.userId ? String(actor.userId) : (req.ip || req.socket?.remoteAddress || 'unknown');
      const identityHash = createHash('sha256').update(rawId).digest('hex');
      console.warn(
        `[AI_RATE_LIMIT] requestId=${req.aiRequestId} identityHash=${identityHash} endpoint=${req.originalUrl || req.path} code=AI_RATE_LIMITED`
      );

      return sendError(
        res,
        429,
        'RATE_LIMITED',
        'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.',
        req.aiRequestId,
        { retryAfterSeconds },
      );
    }

    return next();
  };
};

const createOptionalAiUserMiddleware = ({
  userModel = User,
  tokenVerifier = verifyJwtToken,
} = {}) => async (req, res, next) => {
  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) return next();

  const token = authorization.slice('Bearer '.length).trim();
  if (!token) {
    return sendError(
      res,
      401,
      'AUTH_REQUIRED',
      'Phi\u00ean \u0111\u0103ng nh\u1eadp kh\u00f4ng h\u1ee3p l\u1ec7. Vui l\u00f2ng \u0111\u0103ng nh\u1eadp l\u1ea1i.',
      req.aiRequestId,
    );
  }

  try {
    const decoded = tokenVerifier(token);
    const userId = decoded.id || decoded.sub;
    if (!userId) {
      return sendError(
        res,
        401,
        'AUTH_REQUIRED',
        'Token kh\u00f4ng h\u1ee3p l\u1ec7.',
        req.aiRequestId,
      );
    }
    const user = await userModel.findById(userId).select('-password');
    if (!user || !user.active) {
      return sendError(
        res,
        401,
        'AUTH_REQUIRED',
        'Phi\u00ean \u0111\u0103ng nh\u1eadp kh\u00f4ng h\u1ee3p l\u1ec7. Vui l\u00f2ng \u0111\u0103ng nh\u1eadp l\u1ea1i.',
        req.aiRequestId,
      );
    }
    req.user = user;
  } catch (error) {
    return sendError(
      res,
      401,
      'AUTH_REQUIRED',
      error.name === 'TokenExpiredError'
        ? 'Phi\u00ean \u0111\u0103ng nh\u1eadp \u0111\u00e3 h\u1ebft h\u1ea1n. Vui l\u00f2ng \u0111\u0103ng nh\u1eadp l\u1ea1i.'
        : 'Token kh\u00f4ng h\u1ee3p l\u1ec7.',
      req.aiRequestId,
    );
  }

  return next();
};

const requireAiCustomer = (req, res, next) => {
  if (!req.user) {
    return sendError(
      res,
      401,
      'AUTH_REQUIRED',
      'Bạn cần đăng nhập tài khoản khách hàng.',
      req.aiRequestId,
    );
  }
  if (req.user.role !== 'customer') {
    return sendError(
      res,
      403,
      'TOOL_NOT_ALLOWED',
      'Tài khoản này không thể truy cập bản xem trước đặt bàn.',
      req.aiRequestId,
    );
  }
  return next();
};

const requireAiAdmin = (req, res, next) => {
  if (!req.user) {
    return sendError(
      res,
      401,
      'AUTH_REQUIRED',
      'Can dang nhap tai khoan admin.',
      req.aiRequestId,
    );
  }
  if (req.user.role !== 'admin') {
    return sendError(
      res,
      403,
      'TOOL_NOT_ALLOWED',
      'Tai khoan nay khong the xem AI metrics.',
      req.aiRequestId,
    );
  }
  return next();
};

const createAiRouter = (controller = aiController, options = {}) => {
  const router = express.Router();
  const observability = options.observability || defaultAiObservabilityService;
  const rateLimiter = options.rateLimiter || createAiRateLimiter({
    configProvider: options.configProvider || getAiConfig,
    observability,
  });
  const optionalUser = options.optionalUser || createOptionalAiUserMiddleware();
  const pendingController = options.pendingController || aiPendingActionController;
  const confirmHandler = pendingController.confirmPendingAction
    || aiPendingActionController.confirmPendingAction;
  const knowledgeController = options.knowledgeController || aiKnowledgeController;
  const confirmProtect = options.confirmProtect || protect;
  const confirmCustomer = options.confirmCustomer || restrictTo('customer');
  const polishTextHandler = controller.polishText
    || aiController.polishText
    || ((req, res) => res.sendStatus(501));

  router.use((req, res, next) => {
    const startedAt = process.hrtime.bigint();
    let logged = false;
    req.aiRequestId = randomUUID();
    res.setHeader('X-Request-Id', req.aiRequestId);

    const logRequest = () => {
      if (logged) return;
      logged = true;
      const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const actor = getRequestActor(req);
      const telemetry = req.aiTelemetry || {};
      const status = telemetry.status || (res.statusCode >= 400 ? 'failed' : 'success');
      const tokenUsage = observability.recordRequest({
        role: telemetry.role || actor.role,
        mode: telemetry.mode || 'unknown',
        status,
        errorCode: telemetry.errorCode || null,
        latencyMs,
        usage: telemetry.usage || null,
        fallback: telemetry.fallback === true,
        providerUsed: telemetry.providerUsed || 'unknown',
        fallbackReason: telemetry.fallbackReason || null,
      });
      const logUserId = telemetry.userId || actor.userId || 'guest';
      console.info(
        `[AI] requestId=${req.aiRequestId} method=${req.method} path=${req.path} status=${res.statusCode} userId=${logUserId} role=${telemetry.role || actor.role} mode=${telemetry.mode || 'unknown'} providerUsed=${telemetry.providerUsed || 'unknown'} fallbackUsed=${telemetry.fallback === true} fallbackReason=${telemetry.fallbackReason || 'none'} toolCount=${telemetry.toolCount || 0} errorCode=${telemetry.errorCode || 'none'} inputTokens=${tokenUsage?.inputTokens || 0} outputTokens=${tokenUsage?.outputTokens || 0} estimatedCost=${tokenUsage?.estimatedCost || 0} latencyMs=${latencyMs.toFixed(1)}`,
      );
    };

    res.once('finish', logRequest);
    res.once('close', logRequest);
    next();
  });

  router.post(
    '/pending-actions/:id/confirm',
    confirmProtect,
    confirmCustomer,
    confirmHandler,
  );

  router.use(optionalUser);
  router.get('/health', controller.health);
  if (typeof controller.metrics === 'function') {
    router.get('/metrics', requireAiAdmin, controller.metrics);
  }
  router.post('/mock-chat', controller.mockChat);
  router.get('/knowledge/search', rateLimiter, knowledgeController.search);
  router.post('/chat/stream', rateLimiter, controller.streamChat);
  router.post('/polish-text', protect, restrictTo('restaurant_owner'), rateLimiter, polishTextHandler);
  router.get('/pending-actions/:id', requireAiCustomer, pendingController.getPendingAction);
  router.post('/pending-actions/:id/cancel', requireAiCustomer, pendingController.cancelPendingAction);

  return router;
};

module.exports = createAiRouter();
module.exports.createOptionalAiUserMiddleware = createOptionalAiUserMiddleware;
module.exports.createAiRateLimiter = createAiRateLimiter;
module.exports.createAiRouter = createAiRouter;
module.exports.requireAiAdmin = requireAiAdmin;
module.exports.requireAiCustomer = requireAiCustomer;
// Trigger nodemon restart
