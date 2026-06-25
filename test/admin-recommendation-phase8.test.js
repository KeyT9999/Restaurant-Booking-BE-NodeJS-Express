'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const {
  createRecommendationAdminService,
} = require('../src/services/recommendation/recommendation-admin.service');
const {
  createRecommendationEvaluationService,
} = require('../src/services/recommendation/recommendation-evaluation.service');
const {
  createAdminRecommendationController,
} = require('../src/controllers/admin.recommendation.controller');
const {
  createAdminRecommendationRouter,
} = require('../src/routes/admin.recommendation.routes');

const clone = (value) => JSON.parse(JSON.stringify(value));

const readPath = (document, path) => path.split('.').reduce((current, segment) => current?.[segment], document);

const matchesFilter = (document, filter = {}) => Object.entries(filter).every(([key, expected]) => {
  if (key === '$or') {
    return Array.isArray(expected) && expected.some((condition) => matchesFilter(document, condition));
  }

  const actual = readPath(document, key);
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    if (Object.hasOwn(expected, '$in')) {
      return expected.$in.map(String).includes(String(actual));
    }
    if (Object.hasOwn(expected, '$ne')) {
      return String(actual) !== String(expected.$ne);
    }
    if (Object.hasOwn(expected, '$gt')) {
      return actual > expected.$gt;
    }
    if (Object.hasOwn(expected, '$gte')) {
      return actual >= expected.$gte;
    }
    if (Object.hasOwn(expected, '$lte')) {
      return actual <= expected.$lte;
    }
  }
  return String(actual) === String(expected);
});

const createCountModel = (documents) => ({
  async countDocuments(filter = {}) {
    return documents.filter((document) => matchesFilter(document, filter)).length;
  },
});

const createRunModel = (documents) => {
  const store = documents.map((document) => clone(document));

  return {
    findOne(filter = {}) {
      const results = store.filter((document) => matchesFilter(document, filter));
      return {
        sort(sortSpec = {}) {
          const [[field, direction]] = Object.entries(sortSpec);
          const sorted = [...results].sort((left, right) => {
            const leftValue = new Date(readPath(left, field) || 0).getTime();
            const rightValue = new Date(readPath(right, field) || 0).getTime();
            return direction < 0 ? rightValue - leftValue : leftValue - rightValue;
          });
          return {
            lean: async () => clone(sorted[0] || null),
          };
        },
      };
    },
    find(filter = {}) {
      const results = store.filter((document) => matchesFilter(document, filter));
      return {
        sort(sortSpec = {}) {
          const [[field, direction]] = Object.entries(sortSpec);
          const sorted = [...results].sort((left, right) => {
            const leftValue = new Date(readPath(left, field) || 0).getTime();
            const rightValue = new Date(readPath(right, field) || 0).getTime();
            return direction < 0 ? rightValue - leftValue : leftValue - rightValue;
          });
          return {
            limit(limitValue) {
              return {
                lean: async () => clone(sorted.slice(0, limitValue)),
              };
            },
          };
        },
      };
    },
    async create(payload = {}) {
      const created = {
        _id: `run-${store.length + 1}`,
        ...clone(payload),
      };
      store.push(created);
      return clone(created);
    },
    async findByIdAndUpdate(id, patch = {}) {
      const index = store.findIndex((document) => String(document._id) === String(id));
      if (index >= 0) {
        store[index] = { ...store[index], ...clone(patch) };
        return clone(store[index]);
      }
      return null;
    },
    get store() {
      return store;
    },
  };
};

const createFindModel = (documents) => ({
  find(filter = {}) {
    const results = documents.filter((document) => matchesFilter(document, filter));
    return {
      sort(sortSpec = {}) {
        const [[field, direction]] = Object.entries(sortSpec);
        const sorted = [...results].sort((left, right) => {
          const leftValue = new Date(readPath(left, field) || 0).getTime();
          const rightValue = new Date(readPath(right, field) || 0).getTime();
          return direction < 0 ? rightValue - leftValue : leftValue - rightValue;
        });
        return {
          lean: async () => clone(sorted),
        };
      },
      lean: async () => clone(results),
    };
  },
});

const createRecommendationControllerApp = (controller, role = null) => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/admin/recommendations', (req, res, next) => {
    if (!role) {
      return res.status(401).json({
        success: false,
        message: 'Bạn chưa đăng nhập. Vui lòng đăng nhập để tiếp tục.',
      });
    }

    req.user = {
      _id: `${role}-1`,
      role,
    };
    return next();
  });
  app.use('/api/v1/admin/recommendations', (req, res, next) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền thực hiện hành động này.',
      });
    }
    return next();
  });
  app.use('/api/v1/admin/recommendations', createAdminRecommendationRouter({ controller }));
  return app;
};

const requestJson = async (app, method, path, body = undefined) => {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    return {
      status: response.status,
      body: await response.json(),
    };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
};

test('admin status returns aggregate counts and health warnings without exposing PII', async () => {
  const adminService = createRecommendationAdminService({
    RecommendationInteraction: createCountModel([
      { _id: 'i-1' },
      { _id: 'i-2' },
    ]),
    RecommendationUserProfile: createCountModel([
      { _id: 'profile-1' },
    ]),
    RecommendationItemProfile: createCountModel([
      { _id: 'restaurant-profile', itemType: 'restaurant' },
      { _id: 'menu-profile', itemType: 'menu_item' },
    ]),
    RecommendationResultCache: createCountModel([
      { _id: 'cache-active', expiresAt: new Date('2026-06-24T13:00:00.000Z'), algorithmVersion: 'hybrid_v1' },
      { _id: 'cache-expired', expiresAt: new Date('2026-06-23T12:00:00.000Z'), algorithmVersion: 'phase3-content-based-v1' },
    ]),
    RecommendationRun: createRunModel([
      {
        _id: 'run-success',
        runType: 'full',
        status: 'success',
        startedAt: '2026-06-24T09:00:00.000Z',
        completedAt: '2026-06-24T09:05:00.000Z',
        algorithmVersion: 'phase2-dataset-builder-v1',
      },
    ]),
    now: () => new Date('2026-06-24T12:00:00.000Z'),
  });

  const status = await adminService.getRecommendationStatus();

  assert.equal(status.algorithmVersion, 'hybrid_v1');
  assert.equal(status.dataset.interactions, 2);
  assert.equal(status.dataset.userProfiles, 1);
  assert.equal(status.dataset.restaurantItemProfiles, 1);
  assert.equal(status.dataset.menuItemProfiles, 1);
  assert.equal(status.cache.totalEntries, 2);
  assert.equal(status.cache.activeEntries, 1);
  assert.equal(status.cache.expiredEntries, 1);
  assert.equal(status.health.status, 'healthy');
  assert.equal(status.health.warnings.includes('customer@example.com'), false);
});

test('admin runs list maps rebuild and evaluation runs into safe aggregate-only summaries', async () => {
  const adminService = createRecommendationAdminService({
    RecommendationRun: createRunModel([
      {
        _id: 'run-eval',
        runType: 'evaluation',
        status: 'success',
        startedAt: '2026-06-24T10:00:00.000Z',
        completedAt: '2026-06-24T10:00:02.000Z',
        algorithmVersion: 'hybrid_v1',
        metricsSnapshot: {
          evaluation: {
            hitRateAtK: 0.5,
            coverage: 0.4,
            evaluatedUsers: 2,
          },
          warnings: [],
        },
      },
      {
        _id: 'run-failed',
        runType: 'full',
        status: 'failed',
        startedAt: '2026-06-24T09:00:00.000Z',
        completedAt: '2026-06-24T09:01:00.000Z',
        algorithmVersion: 'phase2-dataset-builder-v1',
        interactionsBuilt: 10,
        userProfilesBuilt: 3,
        itemProfilesBuilt: 5,
        errorSummary: {
          message: 'Mongo timeout',
        },
      },
    ]),
  });

  const runs = await adminService.getRecommendationRuns({ limit: 5 });

  assert.equal(runs.items.length, 2);
  assert.equal(runs.items[0].runType, 'evaluation');
  assert.equal(runs.items[0].summary.hitRateAtK, 0.5);
  assert.match(runs.items[1].warnings[0], /Mongo timeout/);
  assert.equal(JSON.stringify(runs).includes('userId'), false);
});

test('evaluation returns warning instead of 500 when there is not enough data', async () => {
  const runModel = createRunModel([]);
  const evaluationService = createRecommendationEvaluationService({
    RecommendationInteraction: createFindModel([
      {
        _id: 'interaction-1',
        userId: 'user-1',
        restaurantId: 'restaurant-1',
        itemType: 'restaurant',
        eventType: 'booking_completed',
        weight: 5,
        occurredAt: '2026-06-24T09:00:00.000Z',
      },
    ]),
    RecommendationItemProfile: createCountModel([
      { _id: 'restaurant-profile-1', itemType: 'restaurant', isActive: true, approvalStatus: 'approved' },
    ]),
    RecommendationRun: runModel,
    recommendationService: {
      buildRestaurantRecommendationPayload: async () => ({
        data: { items: [], fallbackUsed: true },
      }),
    },
    now: () => new Date('2026-06-24T12:00:00.000Z'),
  });

  const result = await evaluationService.runOfflineEvaluation({ sampleLimit: 10, k: 5 });

  assert.equal(result.available, false);
  assert.equal(result.warning, 'INSUFFICIENT_EVALUATION_DATA');
  assert.equal(runModel.store[0].runType, 'evaluation');
  assert.equal(runModel.store[0].status, 'success');
});

test('evaluation returns hit rate, coverage, fallback rate, and stores aggregate-only metrics', async () => {
  const runModel = createRunModel([]);
  const evaluationService = createRecommendationEvaluationService({
    RecommendationInteraction: createFindModel([
      {
        _id: 'interaction-1',
        userId: 'user-1',
        restaurantId: 'restaurant-a',
        itemType: 'restaurant',
        eventType: 'booking_completed',
        weight: 5,
        occurredAt: '2026-06-24T10:00:00.000Z',
      },
      {
        _id: 'interaction-2',
        userId: 'user-1',
        restaurantId: 'restaurant-b',
        itemType: 'restaurant',
        eventType: 'favorite_added',
        weight: 4,
        occurredAt: '2026-06-23T10:00:00.000Z',
      },
      {
        _id: 'interaction-3',
        userId: 'user-2',
        restaurantId: 'restaurant-c',
        itemType: 'restaurant',
        eventType: 'review_positive',
        weight: 3,
        occurredAt: '2026-06-24T11:00:00.000Z',
      },
      {
        _id: 'interaction-4',
        userId: 'user-2',
        restaurantId: 'restaurant-a',
        itemType: 'restaurant',
        eventType: 'booking_completed',
        weight: 5,
        occurredAt: '2026-06-23T11:00:00.000Z',
      },
    ]),
    RecommendationItemProfile: createCountModel([
      { _id: 'restaurant-profile-1', itemType: 'restaurant', isActive: true, approvalStatus: 'approved' },
      { _id: 'restaurant-profile-2', itemType: 'restaurant', isActive: true, approvalStatus: 'approved' },
      { _id: 'restaurant-profile-3', itemType: 'restaurant', isActive: true, approvalStatus: 'approved' },
      { _id: 'menu-profile', itemType: 'menu_item', isActive: true, approvalStatus: 'approved' },
    ]),
    RecommendationRun: runModel,
    recommendationService: {
      async buildRestaurantRecommendationPayload({ actor }) {
        if (String(actor._id) === 'user-1') {
          return {
            data: {
              items: [
                { restaurantId: 'restaurant-a' },
                { restaurantId: 'restaurant-c' },
              ],
              fallbackUsed: false,
            },
          };
        }

        return {
          data: {
            items: [
              { restaurantId: 'restaurant-b' },
              { restaurantId: 'restaurant-c' },
            ],
            fallbackUsed: true,
          },
        };
      },
    },
    now: () => new Date('2026-06-24T12:00:00.000Z'),
  });

  const result = await evaluationService.runOfflineEvaluation({ sampleLimit: 10, k: 2 });

  assert.equal(result.available, true);
  assert.equal(result.hitRateAtK, 1);
  assert.equal(result.coverage, 1);
  assert.equal(result.evaluatedUsers, 2);
  assert.equal(result.skippedUsers, 0);
  assert.equal(result.fallbackRate, 0.5);
  assert.equal(result.averageRecommendations, 2);
  assert.equal(JSON.stringify(result).includes('restaurant-a'), false);
  assert.equal(JSON.stringify(result).includes('user-1'), false);
  assert.equal(runModel.store[0].metricsSnapshot.evaluation.hitRateAtK, 1);
});

test('admin route allows admin and blocks guest, customer, and owner from recommendation status', async () => {
  const controller = createAdminRecommendationController({
    adminService: {
      getRecommendationStatus: async () => ({
        algorithmVersion: 'hybrid_v1',
        dataset: {
          interactions: 12,
          userProfiles: 3,
          restaurantItemProfiles: 2,
          menuItemProfiles: 8,
          latestRunStatus: 'success',
          latestRunAt: '2026-06-24T09:00:00.000Z',
        },
        cache: {
          totalEntries: 4,
          activeEntries: 3,
          expiredEntries: 1,
          staleAlgorithmEntries: 0,
        },
        health: {
          status: 'healthy',
          warnings: [],
        },
      }),
      getRecommendationRuns: async () => ({ items: [] }),
    },
    evaluationService: {
      getLatestEvaluation: async () => ({ available: false }),
      runOfflineEvaluation: async () => ({ available: false }),
    },
    datasetBuilderService: {
      rebuildFullDataset: async () => ({ dryRun: true }),
    },
  });

  const adminApp = createRecommendationControllerApp(controller, 'admin');
  const customerApp = createRecommendationControllerApp(controller, 'customer');
  const ownerApp = createRecommendationControllerApp(controller, 'restaurant_owner');
  const guestApp = createRecommendationControllerApp(controller, null);

  const adminResponse = await requestJson(adminApp, 'GET', '/api/v1/admin/recommendations/status');
  const customerResponse = await requestJson(customerApp, 'GET', '/api/v1/admin/recommendations/status');
  const ownerResponse = await requestJson(ownerApp, 'GET', '/api/v1/admin/recommendations/status');
  const guestResponse = await requestJson(guestApp, 'GET', '/api/v1/admin/recommendations/status');

  assert.equal(adminResponse.status, 200);
  assert.equal(adminResponse.body.success, true);
  assert.equal(adminResponse.body.data.dataset.interactions, 12);

  assert.equal(customerResponse.status, 403);
  assert.equal(ownerResponse.status, 403);
  assert.equal(guestResponse.status, 401);
});
