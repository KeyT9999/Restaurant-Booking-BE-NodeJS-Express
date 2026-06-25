'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { getAiConfig, AiConfigError } = require('../src/config/ai.config');
const { createAiController } = require('../src/controllers/ai.controller');
const { createAiRouter } = require('../src/routes/ai.routes');
const { createAiObservabilityService } = require('../src/services/ai/ai-observability.service');
const { createAiOrchestrator } = require('../src/services/ai/ai-orchestrator.service');
const { createAiToolRegistry } = require('../src/services/ai/ai-tool-registry');
const { createAiToolRunner } = require('../src/services/ai/ai-tool-runner');

const createConfig = (overrides = {}) => ({
  enabled: true,
  apiKey: 'test-key-not-real',
  model: 'gpt-test',
  timeoutMs: 1000,
  toolTimeoutMs: 100,
  maxInputChars: 2000,
  maxHistoryMessages: 8,
  maxOutputTokens: 100,
  rateLimitWindowMs: 60000,
  rateLimitMaxRequests: 10,
  dailyBudgetEstimate: 0,
  monthlyBudgetEstimate: 0,
  publicToolsEnabled: true,
  customerDynamicToolsEnabled: true,
  availabilityToolEnabled: true,
  voucherToolEnabled: true,
  bookingPreviewToolEnabled: true,
  bookingConfirmEnabled: true,
  knowledgeSearchEnabled: true,
  ownerToolsEnabled: true,
  adminToolsEnabled: true,
  pendingActionTtlMinutes: 10,
  maxToolRounds: 3,
  maxToolCalls: 5,
  ...overrides,
});

const parseSse = (text) => text
  .split(/\r?\n\r?\n/)
  .filter(Boolean)
  .map((block) => {
    const lines = block.split(/\r?\n/);
    const event = lines.find((line) => line.startsWith('event: '))?.slice(7);
    const data = lines.find((line) => line.startsWith('data: '))?.slice(6);
    return { event, data: JSON.parse(data) };
  });

const startServer = async ({
  controller,
  configProvider,
  observability,
  optionalUser,
} = {}) => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/ai', createAiRouter(controller, {
    configProvider,
    observability,
    optionalUser,
  }));
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });

  return {
    url: `http://127.0.0.1:${server.address().port}/api/v1/ai`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
};

const postStream = (url, body, options = {}) => {
  const { headers = {}, ...fetchOptions } = options;
  return fetch(`${url}/chat/stream`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
  ...fetchOptions,
  });
};

test('Phase 10 config accepts tool timeout and budget controls and rejects invalid values', () => {
  const config = getAiConfig({
    OPENAI_MODEL: 'gpt-test',
    AI_TOOL_TIMEOUT_MS: '2500',
    AI_DAILY_BUDGET_ESTIMATE: '1.5',
    AI_MONTHLY_BUDGET_ESTIMATE: '20',
    AI_CUSTOMER_DYNAMIC_TOOLS_ENABLED: 'false',
  });

  assert.equal(config.toolTimeoutMs, 2500);
  assert.equal(config.dailyBudgetEstimate, 1.5);
  assert.equal(config.monthlyBudgetEstimate, 20);
  assert.equal(config.customerDynamicToolsEnabled, false);
  assert.throws(
    () => getAiConfig({ OPENAI_MODEL: 'gpt-test', AI_DAILY_BUDGET_ESTIMATE: '-1' }),
    AiConfigError,
  );
});

test('feature flags can disable customer dynamic, owner, admin, and knowledge tools', () => {
  const registry = createAiToolRegistry({
    flags: createConfig({
      customerDynamicToolsEnabled: false,
      ownerToolsEnabled: false,
      adminToolsEnabled: false,
      knowledgeSearchEnabled: false,
    }),
  });
  const names = registry.getToolNames();

  assert.equal(names.includes('search_restaurants'), true);
  assert.equal(names.includes('check_table_availability'), false);
  assert.equal(names.includes('get_personalized_recommendations'), false);
  assert.equal(names.includes('validate_voucher'), false);
  assert.equal(names.includes('prepare_booking'), false);
  assert.equal(names.includes('search_knowledge'), false);
  assert.equal(names.some((name) => name.startsWith('owner_')), false);
  assert.equal(names.some((name) => name.startsWith('admin_')), false);
});

test('AI budget limit fails closed before provider work starts', async () => {
  const observability = createAiObservabilityService();
  observability.recordTokenUsage({ inputTokens: 10000, outputTokens: 10000 });
  let providerCalled = false;
  const config = createConfig({ dailyBudgetEstimate: 0.0001 });
  const configProvider = () => config;
  const orchestrator = {
    async *streamChat() {
      providerCalled = true;
      yield { type: 'completed', usage: {} };
    },
  };
  const controller = createAiController({ orchestrator, configProvider, observability });
  const server = await startServer({ controller, configProvider, observability });

  try {
    const response = await postStream(server.url, { message: 'Hello' });
    const events = parseSse(await response.text());

    assert.equal(response.status, 200);
    assert.deepEqual(events.map((event) => event.event), ['start', 'error', 'done']);
    assert.equal(events[1].data.code, 'BUDGET_LIMITED');
    assert.equal(providerCalled, false);
  } finally {
    await server.close();
  }
});

test('rate limiter keys authenticated users separately and records safe metrics', async () => {
  const observability = createAiObservabilityService();
  const config = createConfig({ rateLimitMaxRequests: 1 });
  const configProvider = () => config;
  const controller = createAiController({
    configProvider,
    orchestrator: {
      async *streamChat() {
        yield { type: 'completed', usage: { inputTokens: 1, outputTokens: 1 } };
      },
    },
    observability,
  });
  const optionalUser = (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) req.user = { _id: token, id: token, role: 'customer', active: true };
    next();
  };
  const server = await startServer({ controller, configProvider, observability, optionalUser });

  try {
    const first = await postStream(server.url, { message: 'First' }, {
      headers: { Authorization: 'Bearer user-a' },
    });
    await first.text();
    const secondSameUser = await postStream(server.url, { message: 'Second' }, {
      headers: { Authorization: 'Bearer user-a' },
    });
    const thirdOtherUser = await postStream(server.url, { message: 'Third' }, {
      headers: { Authorization: 'Bearer user-b' },
    });
    await thirdOtherUser.text();
    const limitedBody = await secondSameUser.json();
    const snapshot = observability.getSnapshot();

    assert.equal(first.status, 200);
    assert.equal(secondSameUser.status, 429);
    assert.equal(limitedBody.code, 'RATE_LIMITED');
    assert.ok(Number(secondSameUser.headers.get('x-ratelimit-reset')) > 0);
    assert.equal(thirdOtherUser.status, 200);
    assert.equal(snapshot.rateLimitHits, 1);
    assert.equal(JSON.stringify(snapshot).includes('user-a'), false);
  } finally {
    await server.close();
  }
});

test('orchestrator passes configured tool timeout and returns a safe tool timeout result', async () => {
  const providerRequests = [];
  const provider = {
    async *streamText(request) {
      providerRequests.push(request);
      if (providerRequests.length === 1) {
        yield {
          type: 'function_call',
          call: {
            callId: 'call-search',
            name: 'search_restaurants',
            arguments: JSON.stringify({
              query: 'pho',
              cuisineType: null,
              city: null,
              priceRange: null,
              limit: 3,
            }),
          },
        };
        yield { type: 'completed', usage: { inputTokens: 1, outputTokens: 1 } };
        return;
      }
      yield { type: 'completed', usage: { inputTokens: 1, outputTokens: 1 } };
    },
  };
  const registry = createAiToolRegistry({
    handlers: {
      search_restaurants: () => new Promise(() => {}),
    },
  });
  const toolRunner = createAiToolRunner({
    registry,
    auditLogger: { create: async () => {} },
    timeoutMs: 1000,
  });
  const orchestrator = createAiOrchestrator({
    provider,
    registry,
    toolRunner,
    configProvider: () => createConfig({ toolTimeoutMs: 5 }),
  });
  const events = [];

  for await (const event of orchestrator.streamChat({
    message: 'Find pho',
    history: [],
    requestId: 'req-tool-timeout',
    signal: new AbortController().signal,
    config: createConfig({ toolTimeoutMs: 5 }),
  })) {
    events.push(event);
  }

  const completed = events.find((event) => event.type === 'tool_completed');
  assert.equal(completed.status, 'failed');
  assert.equal(completed.errorCode, 'TOOL_TIMEOUT');
  assert.equal(JSON.stringify(events).includes('Tool timed out'), false);
});

test('admin metrics endpoint returns safe aggregate observability data only', async () => {
  const observability = createAiObservabilityService();
  observability.recordToolCall({ toolName: 'search_restaurants', status: 'success' });
  observability.recordRequest({
    role: 'customer',
    mode: 'customer',
    status: 'success',
    usage: { inputTokens: 12, outputTokens: 4 },
    latencyMs: 25,
  });
  const configProvider = () => createConfig();
  const controller = createAiController({ configProvider, observability });
  const optionalUser = (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token === 'admin') req.user = { _id: 'admin-id', id: 'admin-id', role: 'admin', active: true };
    if (token === 'customer') req.user = { _id: 'customer-id', id: 'customer-id', role: 'customer', active: true };
    next();
  };
  const server = await startServer({ controller, configProvider, observability, optionalUser });

  try {
    const forbidden = await fetch(`${server.url}/metrics`, {
      headers: { Authorization: 'Bearer customer' },
    });
    const response = await fetch(`${server.url}/metrics`, {
      headers: { Authorization: 'Bearer admin' },
    });
    const body = await response.json();
    const serialized = JSON.stringify(body);

    assert.equal(forbidden.status, 403);
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.tools.byTool.search_restaurants, 1);
    assert.equal(body.data.tokenUsage.inputTokens, 12);
    assert.equal(serialized.includes('test-key-not-real'), false);
    assert.equal(serialized.includes('OPENAI'), false);
    assert.equal(serialized.includes('customer-id'), false);
  } finally {
    await server.close();
  }
});
