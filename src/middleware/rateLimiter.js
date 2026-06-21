'use strict';

/**
 * Simple in-memory rate limiter.
 * Production: replace with Redis-based limiter.
 */

const rateLimitStore = new Map();

const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (now > entry.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}, 60 * 1000);

// Allow cleanup interval to not prevent Node exit
if (cleanupInterval.unref) cleanupInterval.unref();

const rateLimiter = (windowMs, maxRequests) => {
  return (req, res, next) => {
    const key = req.user ? `${req.user._id}` : req.ip;
    const now = Date.now();

    let entry = rateLimitStore.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      rateLimitStore.set(key, entry);
    }

    entry.count++;

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - entry.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

    if (entry.count > maxRequests) {
      return res.status(429).json({
        success: false,
        message: 'Quá nhiều yêu cầu, vui lòng thử lại sau',
        retryAfter: Math.ceil((entry.resetAt - now) / 1000),
      });
    }

    next();
  };
};

// Pre-configured limiters
const strictLimiter = rateLimiter(60 * 60 * 1000, 10);    // 10 req/h
const moderateLimiter = rateLimiter(60 * 1000, 60);        // 60 req/min
const relaxedLimiter = rateLimiter(60 * 1000, 120);        // 120 req/min

module.exports = { rateLimiter, strictLimiter, moderateLimiter, relaxedLimiter };
