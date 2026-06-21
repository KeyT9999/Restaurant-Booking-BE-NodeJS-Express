'use strict';

/**
 * Simple in-memory cache with TTL.
 * Production: replace with Redis.
 */

const store = new Map();

const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.expiresAt) {
      store.delete(key);
    }
  }
}, 30 * 1000);

if (cleanupInterval.unref) cleanupInterval.unref();

const cache = {
  get(key) {
    const entry = store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      store.delete(key);
      return null;
    }
    return entry.value;
  },

  set(key, value, ttlSeconds = 60) {
    store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  },

  del(key) {
    store.delete(key);
  },

  delPattern(pattern) {
    const regex = new RegExp(pattern);
    for (const key of store.keys()) {
      if (regex.test(key)) {
        store.delete(key);
      }
    }
  },

  flush() {
    store.clear();
  },

  get size() {
    return store.size;
  },
};

module.exports = cache;
