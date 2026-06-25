'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAiToolRegistry } = require('../src/services/ai/ai-tool-registry');
const { createAiToolRunner } = require('../src/services/ai/ai-tool-runner');
const { inferToolCall } = require('../src/services/ai/ai-mock.service');
const { createRecommendationTools } = require('../src/services/ai/tools/recommendation.tools');

const createConfig = (overrides = {}) => ({
  enabled: true,
  apiKey: 'test-key-not-real',
  model: 'gpt-test',
  timeoutMs: 1000,
  maxInputChars: 2000,
  maxHistoryMessages: 8,
  maxOutputTokens: 100,
  rateLimitWindowMs: 60000,
  rateLimitMaxRequests: 10,
  publicToolsEnabled: true,
  customerDynamicToolsEnabled: true,
  availabilityToolEnabled: true,
  voucherToolEnabled: true,
  bookingPreviewToolEnabled: true,
  ownerToolsEnabled: true,
  adminToolsEnabled: true,
  pendingActionTtlMinutes: 10,
  maxToolRounds: 3,
  maxToolCalls: 5,
  ...overrides,
});

test('phase 5 runner accepts nested context for personalized recommendations', async () => {
  let capturedArgs = null;
  const registry = createAiToolRegistry({
    handlers: {
      get_personalized_recommendations: async (args) => {
        capturedArgs = args;
        return {
          type: 'personalized_recommendations',
          version: 1,
          payload: {
            requestType: 'restaurant',
            algorithm: 'hybrid_v1',
            personalized: false,
            fallbackUsed: true,
            items: [],
            message: 'ok',
            sourceLabel: 'BookEat personalized recommendations',
          },
        };
      },
    },
    flags: createConfig(),
  });
  const runner = createAiToolRunner({
    registry,
    auditLogger: { create: async () => {} },
  });

  const result = await runner.runToolCall({
    toolName: 'get_personalized_recommendations',
    rawArguments: JSON.stringify({
      type: 'restaurant',
      limit: 4,
      context: {
        budget: 'medium',
        cuisine: 'pho',
        location: 'Quan 1',
        numberOfGuests: 2,
        occasion: 'family dinner',
        preferredTime: 'toi nay',
      },
    }),
    requestId: 'req-phase5-nested',
    user: { _id: '507f1f77bcf86cd799439012', role: 'customer' },
  });

  assert.equal(result.ok, true);
  assert.equal(capturedArgs.type, 'restaurant');
  assert.equal(capturedArgs.limit, 4);
  assert.equal(capturedArgs.context.location, 'Quan 1');
  assert.equal(capturedArgs.context.preferredTime, 'toi nay');
});

test('phase 5 personalized restaurant tool sanitizes hybrid recommendation output', async () => {
  const captured = {};
  const tools = createRecommendationTools({
    hybridRecommender: {
      async getRestaurantRecommendations({ actor, query }) {
        captured.actor = actor;
        captured.query = query;
        return {
          data: {
            algorithm: 'hybrid_v1',
            personalized: true,
            fallbackUsed: false,
            items: [{
              restaurantId: '507f1f77bcf86cd799439101',
              name: 'Pho AI',
              image: 'https://example.com/pho.jpg',
              ratingAverage: 4.7,
              priceRange: 'moderate',
              priceRangeLabel: 'Tam trung',
              cuisineTypes: ['Viet Nam'],
              score: 0.9234,
              reasons: ['Hop khau vi pho', 'Phu hop ngan sach', 'Danh gia tot', 'Do not keep'],
              scoreBreakdown: { content: 0.9, collaborative: 0.8 },
              rawProfile: { shouldNotLeak: true },
            }],
          },
        };
      },
      async getMenuItemRecommendations() {
        throw new Error('menu recommender should not run');
      },
    },
  });

  const result = await tools.get_personalized_recommendations(
    {
      type: 'restaurant',
      limit: 50,
      context: {
        budget: 'medium',
        cuisine: 'pho',
        location: 'Quan 1',
        numberOfGuests: 4,
        preferredTime: 'toi nay',
      },
    },
    {
      requestId: 'req-phase5-restaurant',
      actor: { userId: '507f1f77bcf86cd799439012', role: 'customer' },
    },
  );

  assert.equal(captured.actor._id, '507f1f77bcf86cd799439012');
  assert.equal(captured.query.limit, 10);
  assert.equal(captured.query.cuisine, 'pho');
  assert.equal(captured.query.priceRange, 'moderate');
  assert.equal(captured.query.district, 'Quan 1');
  assert.equal(captured.query.preferredTime, '19:00');
  assert.equal(result.type, 'personalized_recommendations');
  assert.equal(result.version, 1);
  assert.equal(result.payload.personalized, true);
  assert.equal(result.payload.fallbackUsed, false);
  assert.equal(result.payload.items.length, 1);
  assert.deepEqual(result.payload.items[0].reasons, [
    'Hop khau vi pho',
    'Phu hop ngan sach',
    'Danh gia tot',
  ]);
  assert.equal(Object.hasOwn(result.payload.items[0], 'scoreBreakdown'), false);
  assert.equal(Object.hasOwn(result.payload.items[0], 'rawProfile'), false);
  assert.equal(result.payload.items[0].metadata.detailUrl, '/restaurants/507f1f77bcf86cd799439101');
});

test('phase 5 mixed personalized tool merges and sorts restaurant and menu items safely', async () => {
  const tools = createRecommendationTools({
    hybridRecommender: {
      async getRestaurantRecommendations() {
        return {
          data: {
            algorithm: 'hybrid_v1',
            personalized: false,
            fallbackUsed: true,
            items: [{
              restaurantId: '507f1f77bcf86cd799439201',
              name: 'Quan Pho Pho Bien',
              image: null,
              ratingAverage: 4.3,
              priceRange: 'budget',
              priceRangeLabel: 'Binh dan',
              cuisineTypes: ['Viet Nam'],
              score: 0.62,
              reasons: ['Pho bien', 'Danh gia tot'],
            }],
          },
        };
      },
      async getMenuItemRecommendations() {
        return {
          data: {
            algorithm: 'hybrid_v1',
            personalized: false,
            fallbackUsed: false,
            items: [{
              menuItemId: '507f1f77bcf86cd799439301',
              restaurantId: '507f1f77bcf86cd799439202',
              restaurantName: 'Bun AI',
              name: 'Bun bo dac biet',
              image: null,
              ratingAverage: 4.6,
              price: 89000,
              priceRange: 'budget',
              priceRangeLabel: 'Binh dan',
              categoryName: 'Bun',
              cuisineTypes: ['Viet Nam'],
              score: 0.91,
              reasons: ['Hop gu', 'Gia tot'],
            }],
          },
        };
      },
    },
  });

  const result = await tools.get_personalized_recommendations({
    type: 'mixed',
    limit: 2,
    context: null,
  }, {
    requestId: 'req-phase5-mixed',
    actor: { role: 'guest' },
  });

  assert.equal(result.payload.requestType, 'mixed');
  assert.equal(result.payload.personalized, false);
  assert.equal(result.payload.fallbackUsed, true);
  assert.equal(result.payload.items.length, 2);
  assert.equal(result.payload.items[0].itemType, 'menu_item');
  assert.equal(result.payload.items[1].itemType, 'restaurant');
  assert.match(result.payload.message, /du du lieu ca nhan hoa/i);
});

test('phase 5 runner returns safe invalid-request message for unsupported recommendation type', async () => {
  const registry = createAiToolRegistry({
    handlers: {
      ...createRecommendationTools({
        hybridRecommender: {
          async getRestaurantRecommendations() {
            throw new Error('should not run');
          },
          async getMenuItemRecommendations() {
            throw new Error('should not run');
          },
        },
      }),
    },
    flags: createConfig(),
  });
  const runner = createAiToolRunner({
    registry,
    auditLogger: { create: async () => {} },
  });

  const result = await runner.runToolCall({
    toolName: 'get_personalized_recommendations',
    rawArguments: {
      type: 'banana',
      limit: 3,
      context: null,
    },
    requestId: 'req-phase5-invalid',
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'INVALID_REQUEST');
  assert.equal(result.message, 'Yeu cau goi y chua hop le.');
});

test('phase 5 mock inference routes recommendation intent to personalized recommendation tool', () => {
  const result = inferToolCall({
    message: 'Goi y cho toi mot vai mon va nha hang hop gu toi toi nay cho 2 nguoi',
    pageContext: null,
  });

  assert.equal(result.name, 'get_personalized_recommendations');
  assert.equal(result.args.type, 'mixed');
  assert.equal(result.args.context.numberOfGuests, 2);
  assert.equal(result.args.context.preferredTime, '19:00');
});
