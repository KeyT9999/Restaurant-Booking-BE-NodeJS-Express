'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAiToolRegistry } = require('../src/services/ai/ai-tool-registry');
const { createAiToolRunner } = require('../src/services/ai/ai-tool-runner');
const { createAiOrchestrator } = require('../src/services/ai/ai-orchestrator.service');
const { createPublicCustomerTools } = require('../src/services/ai/tools/public-customer.tools');
const { createCustomerDynamicTools } = require('../src/services/ai/tools/customer-dynamic.tools');

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

const validSearchArgs = {
  query: 'pho',
  cuisineType: null,
  city: null,
  priceRange: null,
  limit: 3,
};

test('AI registry keeps Phase 3-9 tools and registers HTTP-only Phase 6 confirm_booking', () => {
  const registry = createAiToolRegistry();
  assert.deepEqual(registry.getToolNames().sort(), [
    'admin_detect_abnormal_activity',
    'admin_draft_complaint_reply',
    'admin_get_pending_restaurants',
    'admin_get_refunds',
    'admin_get_revenue_summary',
    'admin_get_transactions',
    'check_table_availability',
    'confirm_booking',
    'get_booking_policy',
    'get_personalized_recommendations',
    'get_restaurant_detail',
    'get_restaurant_menu',
    'owner_get_available_tables',
    'owner_get_cancelled_bookings',
    'owner_get_revenue_summary',
    'owner_get_review_summary',
    'owner_get_today_bookings',
    'owner_get_upcoming_customers',
    'owner_get_voucher_summary',
    'owner_search_booking',
    'owner_suggest_review_reply',
    'prepare_booking',
    'search_knowledge',
    'search_restaurants',
    'validate_voucher',
  ]);

  assert.equal(
    registry.getToolDefinitions().some((definition) => definition.name === 'confirm_booking'),
    false,
  );
  for (const definition of registry.getToolDefinitions()) {
    assert.equal(definition.type, 'function');
    assert.equal(definition.strict, true);
    assert.equal(definition.parameters.type, 'object');
    assert.equal(definition.parameters.additionalProperties, false);
  }
});

test('AI tool runner blocks unknown tools and writes forbidden audit', async () => {
  const audits = [];
  const runner = createAiToolRunner({
    registry: createAiToolRegistry(),
    auditLogger: { create: async (payload) => audits.push(payload) },
  });

  const result = await runner.runToolCall({
    toolName: 'admin_tool',
    rawArguments: '{}',
    requestId: 'req-unknown',
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'TOOL_NOT_ALLOWED');
  assert.equal(result.status, 'forbidden');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].status, 'forbidden');
  assert.equal(audits[0].toolName, 'admin_tool');
});

test('AI tool runner rejects unknown schema fields and audits invalid args', async () => {
  const audits = [];
  const registry = createAiToolRegistry({
    handlers: {
      search_restaurants: async () => {
        throw new Error('handler should not run');
      },
    },
  });
  const runner = createAiToolRunner({
    registry,
    auditLogger: { create: async (payload) => audits.push(payload) },
  });

  const result = await runner.runToolCall({
    toolName: 'search_restaurants',
    rawArguments: JSON.stringify({ ...validSearchArgs, unsafe: 'nope' }),
    requestId: 'req-invalid',
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'TOOL_INVALID_ARGUMENT');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].status, 'failed');
  assert.equal(audits[0].argsRedacted.unsafe, 'nope');
});

test('AI tool audit redacts booking contact, notes, and voucher codes', async () => {
  const audits = [];
  const registry = createAiToolRegistry({
    handlers: {
      prepare_booking: async () => ({ type: 'booking_preview', version: 1, payload: {} }),
    },
    flags: createConfig(),
  });
  const runner = createAiToolRunner({
    registry,
    auditLogger: { create: async (payload) => audits.push(payload) },
  });

  const result = await runner.runToolCall({
    toolName: 'prepare_booking',
    rawArguments: {
      restaurantId: '507f1f77bcf86cd799439011',
      bookingDate: '2026-06-25',
      bookingTime: '19:00',
      numberOfGuests: 4,
      customerName: 'Nguyen Van A',
      customerPhone: '0901234567',
      customerEmail: 'customer@example.com',
      tableNumbers: null,
      tableId: null,
      voucherCode: 'BOOKEAT10',
      voucherId: null,
      specialRequests: 'Di ung hai san',
      note: 'Ban gan cua so',
      occasion: null,
    },
    requestId: 'req-redaction',
    user: { _id: '507f1f77bcf86cd799439012', role: 'customer' },
  });

  assert.equal(result.ok, true);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].argsRedacted.customerName, '[redacted]');
  assert.equal(audits[0].argsRedacted.customerPhone, '[redacted]');
  assert.equal(audits[0].argsRedacted.customerEmail, '[redacted]');
  assert.equal(audits[0].argsRedacted.voucherCode, '[redacted]');
  assert.equal(audits[0].argsRedacted.specialRequests, '[redacted]');
  assert.equal(audits[0].argsRedacted.note, '[redacted]');
  assert.equal(audits[0].argsRedacted.restaurantId, '507f1f77bcf86cd799439011');
  assert.equal(audits[0].argsRedacted.bookingDate, '2026-06-25');
  assert.equal(audits[0].argsRedacted.numberOfGuests, 4);
});

test('search_restaurants uses the public restaurant query service and returns safe cards', async () => {
  let capturedQuery;
  const tools = createPublicCustomerTools({
    restaurantService: {
      async searchPublicRestaurants(query) {
        capturedQuery = query;
        return {
          total: 1,
          restaurants: [{
            id: '507f1f77bcf86cd799439011',
            name: 'Pho BookEat',
            description: 'Quan pho public',
            address: 'Quan 1, TP.HCM',
            cuisineTypes: ['Viet Nam'],
            averageRating: 4.5,
            reviewCount: 12,
            averagePrice: 120000,
            coverImageUrl: 'https://example.com/pho.jpg',
            ownerId: 'must-not-leak',
          }],
        };
      },
    },
  });

  const result = await tools.search_restaurants({
    query: 'pho',
    cuisineType: null,
    city: 'Ho Chi Minh',
    priceRange: 'low',
    limit: 2,
  });

  assert.equal(capturedQuery.search, 'pho');
  assert.equal(capturedQuery.city, 'Ho Chi Minh');
  assert.equal(capturedQuery.priceRange, 'low');
  assert.equal(result.type, 'restaurant_list');
  assert.equal(result.version, 1);
  assert.equal(result.payload.restaurants[0].name, 'Pho BookEat');
  assert.equal(Object.hasOwn(result.payload.restaurants[0], 'ownerId'), false);
});

test('get_restaurant_menu calls getPublicMenu and filters a safe result list', async () => {
  let capturedMenuRequest;
  const tools = createPublicCustomerTools({
    restaurantService: {
      async getPublicRestaurantDetail(restaurantId) {
        return { id: restaurantId, name: 'Sea BookEat' };
      },
    },
    menu: {
      async getPublicMenu(restaurantId, query) {
        capturedMenuRequest = { restaurantId, query };
        return {
          items: [
            { id: 'm1', name: 'Hau nuong', price: 180000, isAvailable: true, tags: [] },
            { id: 'm2', name: 'Tom hum', price: 900000, isAvailable: true, tags: [] },
          ],
          categories: [{ id: 'c1', name: 'Hai san' }],
        };
      },
    },
  });

  const result = await tools.get_restaurant_menu({
    restaurantId: '507f1f77bcf86cd799439011',
    query: 'hau',
    categoryId: null,
    maxPrice: 200000,
    limit: 10,
  });

  assert.deepEqual(capturedMenuRequest, {
    restaurantId: '507f1f77bcf86cd799439011',
    query: { search: 'hau' },
  });
  assert.equal(result.type, 'menu_list');
  assert.equal(result.payload.items.length, 1);
  assert.equal(result.payload.items[0].name, 'Hau nuong');
});

test('get_booking_policy uses restaurant public rules before curated policy', async () => {
  const tools = createPublicCustomerTools({
    restaurantService: {
      async getPublicRestaurantPolicyRules() {
        return {
          restaurant: { id: '507f1f77bcf86cd799439011', name: 'Policy House' },
          bookingNotes: 'Dat truoc 2 gio.',
          bookingInformation: null,
          policyRules: ['Huy truoc 24 gio.'],
        };
      },
    },
  });

  const result = await tools.get_booking_policy({
    restaurantId: '507f1f77bcf86cd799439011',
    topic: 'cancellation',
  });

  assert.equal(result.type, 'policy_answer');
  assert.match(result.payload.sourceLabel, /Policy House/);
  assert.deepEqual(result.payload.bullets, ['Dat truoc 2 gio.', 'Huy truoc 24 gio.']);
});

test('check_table_availability calls booking service and returns safe table projection', async () => {
  const captured = {};
  const tools = createCustomerDynamicTools({
    restaurantService: {
      isValidObjectId: () => true,
      async getPublicRestaurantOperationalProfile(restaurantId) {
        captured.restaurantId = restaurantId;
        return {
          id: restaurantId,
          name: 'Table House',
          address: 'District 1',
          operatingHours: {},
          hasTableLayout: true,
        };
      },
    },
    booking: {
      async validateBookingTime(bookingDate, bookingTime, restaurant) {
        captured.timeValidation = { bookingDate, bookingTime, restaurantName: restaurant.name };
        return { valid: true, errors: [] };
      },
      async checkAvailability(restaurantId, bookingDate, bookingTime, numberOfGuests) {
        captured.availability = { restaurantId, bookingDate, bookingTime, numberOfGuests };
        return {
          available: true,
          suggestedTables: [{
            tableNumber: 'A1',
            capacity: 4,
            zone: 'Main',
            note: 'must-not-leak',
            depositAmount: 100000,
          }],
          conflicts: [],
        };
      },
    },
  });

  const result = await tools.check_table_availability({
    restaurantId: '507f1f77bcf86cd799439011',
    bookingDate: '2026-06-25',
    bookingTime: '19:00',
    numberOfGuests: 4,
  });

  assert.equal(captured.restaurantId, '507f1f77bcf86cd799439011');
  assert.deepEqual(captured.availability, {
    restaurantId: '507f1f77bcf86cd799439011',
    bookingDate: '2026-06-25',
    bookingTime: '19:00',
    numberOfGuests: 4,
  });
  assert.equal(result.type, 'availability_result');
  assert.equal(result.payload.available, true);
  assert.deepEqual(result.payload.suggestedTables, [{ tableNumber: 'A1', capacity: 4, zone: 'Main' }]);
  assert.equal(Object.hasOwn(result.payload.suggestedTables[0], 'note'), false);
  assert.equal(Object.hasOwn(result.payload.suggestedTables[0], 'depositAmount'), false);
});

test('validate_voucher uses current customer context and read-only voucher validation', async () => {
  let captured;
  const tools = createCustomerDynamicTools({
    restaurantService: {
      isValidObjectId: () => true,
      async getPublicRestaurantOperationalProfile(restaurantId) {
        return {
          id: restaurantId,
          name: 'Voucher House',
          address: 'District 1',
          hasTableLayout: true,
        };
      },
    },
    voucher: {
      async validateVoucher(code, restaurantId, customerId, orderAmount, options) {
        captured = { code, restaurantId, customerId, orderAmount, options };
        return {
          valid: true,
          reason: null,
          discountAmount: 20000,
          voucher: {
            discountType: 'percentage',
            discountValue: 10,
            minOrderAmount: 100000,
            maxDiscountAmount: 50000,
            endDate: new Date('2026-12-31T00:00:00.000Z'),
            restaurantId: null,
            createdBy: 'must-not-leak',
          },
        };
      },
    },
  });

  const result = await tools.validate_voucher({
    code: 'bookeat10',
    restaurantId: '507f1f77bcf86cd799439011',
    orderAmountEstimate: 200000,
  }, {
    actor: { role: 'customer', userId: 'customer-1' },
  });

  assert.deepEqual(captured, {
    code: 'BOOKEAT10',
    restaurantId: '507f1f77bcf86cd799439011',
    customerId: 'customer-1',
    orderAmount: 200000,
    options: { readOnly: true },
  });
  assert.equal(result.type, 'voucher_result');
  assert.equal(result.payload.valid, true);
  assert.equal(result.payload.discountAmountEstimate, 20000);
  assert.equal(Object.hasOwn(result.payload.conditions, 'createdBy'), false);
});

test('guest validate_voucher returns login-required card and audits forbidden', async () => {
  const audits = [];
  const registry = createAiToolRegistry();
  const runner = createAiToolRunner({
    registry,
    auditLogger: { create: async (payload) => audits.push(payload) },
  });

  const result = await runner.runToolCall({
    toolName: 'validate_voucher',
    rawArguments: JSON.stringify({
      code: 'BOOKEAT10',
      restaurantId: null,
      orderAmountEstimate: null,
    }),
    requestId: 'req-auth',
    user: null,
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'AUTH_REQUIRED');
  assert.equal(result.status, 'forbidden');
  assert.equal(result.result.type, 'voucher_result');
  assert.equal(result.result.payload.authRequired, true);
  assert.equal(result.result.payload.code, 'BOOKEAT10');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].status, 'forbidden');
  assert.equal(audits[0].role, 'guest');
});

test('authenticated owner can use public tools but cannot use customer-only voucher tool', async () => {
  const audits = [];
  let searchCalled = false;
  const registry = createAiToolRegistry({
    handlers: {
      search_restaurants: async () => {
        searchCalled = true;
        return {
          type: 'restaurant_list',
          version: 1,
          payload: { restaurants: [], total: 0 },
        };
      },
      validate_voucher: async () => {
        throw new Error('customer-only handler should not run');
      },
    },
  });
  const runner = createAiToolRunner({
    registry,
    auditLogger: { create: async (payload) => audits.push(payload) },
  });
  const owner = { _id: 'owner-1', role: 'restaurant_owner' };

  const publicResult = await runner.runToolCall({
    toolName: 'search_restaurants',
    rawArguments: JSON.stringify(validSearchArgs),
    requestId: 'req-owner-public',
    user: owner,
  });
  const customerOnlyResult = await runner.runToolCall({
    toolName: 'validate_voucher',
    rawArguments: JSON.stringify({
      code: 'BOOKEAT10',
      restaurantId: null,
      orderAmountEstimate: null,
    }),
    requestId: 'req-owner-voucher',
    user: owner,
  });

  assert.equal(publicResult.ok, true);
  assert.equal(searchCalled, true);
  assert.equal(customerOnlyResult.ok, false);
  assert.equal(customerOnlyResult.errorCode, 'TOOL_NOT_ALLOWED');
  assert.equal(customerOnlyResult.status, 'forbidden');
  assert.equal(audits.length, 2);
  assert.equal(audits[0].role, 'restaurant_owner');
  assert.equal(audits[0].status, 'success');
  assert.equal(audits[1].role, 'restaurant_owner');
  assert.equal(audits[1].status, 'forbidden');
});

test('AI orchestrator emits tool events, structured result, and stops tools at call budget', async () => {
  const requests = [];
  const provider = {
    async *streamText(request) {
      requests.push(request);
      if (requests.length === 1) {
        yield {
          type: 'function_call',
          call: {
            callId: 'call-search',
            name: 'search_restaurants',
            arguments: JSON.stringify(validSearchArgs),
          },
        };
        yield { type: 'completed', usage: { inputTokens: 10, outputTokens: 1 } };
        return;
      }

      assert.equal(request.tools.length, 0);
      yield { type: 'delta', text: 'Đây là kết quả public.' };
      yield { type: 'completed', usage: { inputTokens: 20, outputTokens: 5 } };
    },
  };
  const registry = createAiToolRegistry({
    handlers: {
      search_restaurants: async () => ({
        type: 'restaurant_list',
        version: 1,
        payload: { restaurants: [], total: 0 },
      }),
    },
  });
  const toolRunner = {
    async runToolCall() {
      return {
        ok: true,
        status: 'success',
        label: 'Đang tìm nhà hàng...',
        latencyMs: 1,
        result: {
          type: 'restaurant_list',
          version: 1,
          payload: { restaurants: [], total: 0 },
        },
        modelOutput: {
          ok: true,
          result: {
            type: 'restaurant_list',
            version: 1,
            payload: { restaurants: [], total: 0 },
          },
        },
      };
    },
  };
  const orchestrator = createAiOrchestrator({
    provider,
    registry,
    toolRunner,
    configProvider: () => createConfig({ maxToolCalls: 1 }),
  });

  const events = [];
  for await (const event of orchestrator.streamChat({
    message: 'Tim nha hang pho',
    history: [],
    requestId: 'req-tool',
    signal: new AbortController().signal,
    config: createConfig({ maxToolCalls: 1 }),
  })) {
    events.push(event);
  }

  assert.equal(requests[0].tools.length, 24);
  assert.deepEqual(events.map((event) => event.type), [
    'tool_started',
    'tool_completed',
    'result',
    'delta',
    'completed',
  ]);
  assert.equal(requests[1].input.some((item) => item.type === 'function_call_output'), true);
});
