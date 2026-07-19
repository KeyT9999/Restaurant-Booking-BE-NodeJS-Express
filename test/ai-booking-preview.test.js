'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createAiPendingActionController } = require('../src/controllers/ai-pending-action.controller');
const { createAiRouter } = require('../src/routes/ai.routes');
const { createAiBookingWorkflowService } = require('../src/services/ai/ai-booking-workflow.service');
const { createAiPendingActionService, toSafePendingAction } = require('../src/services/ai/ai-pending-action.service');
const { createAiToolRegistry } = require('../src/services/ai/ai-tool-registry');
const { createAiToolRunner } = require('../src/services/ai/ai-tool-runner');

const RESTAURANT_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f191e810c19729de860ea';
const ACTION_ID = '507f1f77bcf86cd799439012';

const completeArgs = {
  restaurantId: RESTAURANT_ID,
  bookingDate: '2026-06-25',
  bookingTime: '19:00',
  numberOfGuests: 4,
  customerName: null,
  customerPhone: null,
  customerEmail: null,
  tableNumbers: null,
  tableId: null,
  voucherCode: 'BOOKEAT10',
  voucherId: null,
  specialRequests: 'Gần cửa sổ',
  note: null,
  occasion: 'birthday',
};

const createWorkflow = (overrides = {}) => {
  const captured = {};
  const workflow = createAiBookingWorkflowService({
    restaurantService: {
      isValidObjectId: () => true,
      async getPublicRestaurantOperationalProfile() {
        return {
          id: RESTAURANT_ID,
          name: 'BookEat Bistro',
          address: 'Quận 1, TP.HCM',
          operatingHours: {},
          hasTableLayout: true,
        };
      },
    },
    booking: {
      async validateBookingTime() {
        return { valid: true, errors: [] };
      },
      async validateTableCapacity() {
        throw new Error('not expected');
      },
      async checkTimeConflict() {
        throw new Error('not expected');
      },
      async checkAvailability() {
        return {
          available: true,
          suggestedTables: [{
            tableNumber: 'A1',
            capacity: 4,
            zone: 'Main',
            depositAmount: 200000,
          }],
          conflicts: [],
        };
      },
    },
    voucher: {
      async validateVoucher(code, restaurantId, customerId, amount, options) {
        captured.voucher = { code, restaurantId, customerId: customerId.toString(), amount, options };
        return {
          valid: true,
          discountAmount: 20000,
          voucher: { _id: '507f1f77bcf86cd799439099' },
        };
      },
    },
    pendingActions: {
      async createBookingPreview(input) {
        captured.pending = input;
        return {
          _id: ACTION_ID,
          status: 'pending',
          expiresAt: new Date('2026-06-18T10:10:00.000Z'),
        };
      },
    },
    now: () => new Date('2026-06-18T03:00:00.000Z'),
    ...overrides,
  });
  return { workflow, captured };
};

test('prepare_booking re-checks data, creates only pending action, and returns safe booking_preview@1', async () => {
  const { workflow, captured } = createWorkflow();
  const user = {
    _id: USER_ID,
    role: 'customer',
    fullName: 'Nguyễn Văn A',
    phoneNumber: '0901234567',
    email: 'a@example.com',
  };

  const result = await workflow.prepareBooking(completeArgs, {
    actor: { role: 'customer', userId: USER_ID },
    user,
    requestId: 'req-preview',
  });

  assert.equal(result.type, 'booking_preview');
  assert.equal(result.version, 1);
  assert.equal(result.payload.pendingActionId, ACTION_ID);
  assert.equal(result.payload.confirmEnabled, true);
  assert.equal(result.payload.preview.restaurant.name, 'BookEat Bistro');
  assert.deepEqual(result.payload.preview.tableNumbers, ['A1']);
  assert.equal(result.payload.preview.depositAmount, 200000);
  assert.equal(result.payload.preview.discountAmount, 20000);
  assert.equal(result.payload.preview.amountDue, 180000);
  assert.equal(result.payload.preview.contact.phone, '0901234567');
  assert.equal(Object.hasOwn(result.payload.preview, 'customerId'), false);
  assert.equal(Object.hasOwn(result.payload.preview.voucher, 'voucherId'), false);

  assert.equal(captured.pending.payload.customerId, USER_ID);
  assert.equal(captured.pending.payload.voucherId, '507f1f77bcf86cd799439099');
  assert.equal(captured.pending.payload.bookingDateTime, '2026-06-25T19:00:00+07:00');
  assert.deepEqual(captured.voucher, {
    code: 'BOOKEAT10',
    restaurantId: RESTAURANT_ID,
    customerId: USER_ID,
    amount: 200000,
    options: { readOnly: true },
  });
});

test('prepare_booking asks for missing profile contact instead of inventing it', async () => {
  const { workflow } = createWorkflow();

  await assert.rejects(
    workflow.prepareBooking(completeArgs, {
      actor: { role: 'customer', userId: USER_ID },
      user: { _id: USER_ID, role: 'customer', fullName: 'Nguyễn Văn A', email: 'a@example.com' },
    }),
    (error) => {
      assert.equal(error.code, 'BOOKING_INFO_REQUIRED');
      assert.deepEqual(error.details.missingFields, ['customerPhone']);
      return true;
    },
  );
});

test('prepare_booking validates the booking window in Asia/Ho_Chi_Minh time', async () => {
  const { workflow } = createWorkflow({
    now: () => new Date('2026-06-18T13:00:00.000Z'),
  });

  await assert.rejects(
    workflow.prepareBooking({
      ...completeArgs,
      bookingDate: '2026-06-18',
      bookingTime: '19:00',
      voucherCode: null,
    }, {
      actor: { role: 'customer', userId: USER_ID },
      user: {
        _id: USER_ID,
        role: 'customer',
        fullName: 'Nguyễn Văn A',
        phoneNumber: '0901234567',
        email: 'a@example.com',
      },
    }),
    (error) => error.code === 'INVALID_BOOKING_TIME',
  );
});

test('guest and owner cannot call prepare_booking through the existing permission guard', async () => {
  const registry = createAiToolRegistry({
    handlers: {
      prepare_booking: async () => {
        throw new Error('handler must not run');
      },
    },
  });
  const runner = createAiToolRunner({
    registry,
    auditLogger: { create: async () => {} },
  });

  const guest = await runner.runToolCall({
    toolName: 'prepare_booking',
    rawArguments: JSON.stringify(completeArgs),
    requestId: 'req-guest',
    user: null,
  });
  const owner = await runner.runToolCall({
    toolName: 'prepare_booking',
    rawArguments: JSON.stringify(completeArgs),
    requestId: 'req-owner',
    user: { _id: USER_ID, role: 'restaurant_owner' },
  });

  assert.equal(guest.errorCode, 'AUTH_REQUIRED');
  assert.equal(owner.errorCode, 'TOOL_NOT_ALLOWED');
});

test('pending action service lazily expires and never exposes canonical payload', async () => {
  const action = {
    _id: ACTION_ID,
    userId: USER_ID,
    actionType: 'prepare_booking',
    schemaVersion: 'booking_preview@1',
    payload: { customerId: USER_ID, internalAmount: 200000 },
    preview: { restaurant: { name: 'BookEat Bistro' } },
    status: 'pending',
    expiresAt: new Date('2026-06-18T09:00:00.000Z'),
    createdAt: new Date('2026-06-18T08:50:00.000Z'),
    updatedAt: new Date('2026-06-18T08:50:00.000Z'),
    async save() {
      this.updatedAt = new Date('2026-06-18T10:00:00.000Z');
      return this;
    },
  };
  const service = createAiPendingActionService({
    pendingActionModel: {
      async findOne(query) {
        return query.userId === USER_ID ? action : null;
      },
    },
    auditLogger: { create: async () => {} },
    now: () => new Date('2026-06-18T10:00:00.000Z'),
  });

  const safe = await service.getOwnedActionSafe(ACTION_ID, USER_ID);
  assert.equal(safe.status, 'expired');
  assert.equal(safe.allowedActions.confirm, false);
  assert.equal(safe.allowedActions.cancel, false);
  assert.equal(Object.hasOwn(safe, 'payload'), false);
  assert.equal(Object.hasOwn(safe.preview, 'internalAmount'), false);
  assert.equal(await service.getOwnedActionSafe(ACTION_ID, '507f191e810c19729de860eb'), null);
});

test('pending action creation stores canonical payload server-side with a ten-minute expiry', async () => {
  let createdDocument;
  const audits = [];
  const service = createAiPendingActionService({
    pendingActionModel: {
      async create(document) {
        createdDocument = document;
        return {
          ...document,
          _id: ACTION_ID,
          createdAt: new Date('2026-06-18T10:00:00.000Z'),
          updatedAt: new Date('2026-06-18T10:00:00.000Z'),
        };
      },
    },
    auditLogger: { create: async (entry) => audits.push(entry) },
    now: () => new Date('2026-06-18T10:00:00.000Z'),
    ttlMinutes: 10,
  });

  const action = await service.createBookingPreview({
    userId: USER_ID,
    payload: { customerId: USER_ID, numberOfGuests: 4 },
    preview: { restaurant: { name: 'BookEat Bistro' } },
    requestId: 'req-create',
  });

  assert.equal(createdDocument.actionType, 'prepare_booking');
  assert.equal(createdDocument.status, 'pending');
  assert.deepEqual(createdDocument.payload, { customerId: USER_ID, numberOfGuests: 4 });
  assert.equal(createdDocument.expiresAt.toISOString(), '2026-06-18T10:10:00.000Z');
  assert.equal(toSafePendingAction(action).payload, undefined);
  assert.equal(audits[0].toolName, 'pending_action.create');
});

test('cancel pending action is idempotent and changes only the pending action state', async () => {
  const audits = [];
  const action = {
    _id: ACTION_ID,
    userId: USER_ID,
    actionType: 'prepare_booking',
    schemaVersion: 'booking_preview@1',
    preview: { restaurant: { name: 'BookEat Bistro' } },
    status: 'pending',
    expiresAt: new Date('2026-06-18T11:00:00.000Z'),
    createdAt: new Date('2026-06-18T10:00:00.000Z'),
    updatedAt: new Date('2026-06-18T10:00:00.000Z'),
    async save() {
      return this;
    },
  };
  const service = createAiPendingActionService({
    pendingActionModel: { findOne: async () => action },
    auditLogger: { create: async (entry) => audits.push(entry) },
    now: () => new Date('2026-06-18T10:05:00.000Z'),
  });

  const first = await service.cancelOwnedActionSafe({
    id: ACTION_ID,
    userId: USER_ID,
    reason: 'Đổi kế hoạch',
    requestId: 'req-cancel-1',
  });
  const second = await service.cancelOwnedActionSafe({
    id: ACTION_ID,
    userId: USER_ID,
    requestId: 'req-cancel-2',
  });

  assert.equal(first.status, 'cancelled');
  assert.equal(second.status, 'cancelled');
  assert.equal(action.cancellationReason, 'Đổi kế hoạch');
  assert.equal(audits.length, 2);
  assert.equal(audits[0].toolName, 'pending_action.cancel');
});

test('pending action endpoints require customer auth and return safe server-side state', async () => {
  const app = express();
  app.use(express.json());
  const pendingController = createAiPendingActionController({
    pendingActionService: {
      async getOwnedActionSafe(id, userId) {
        assert.equal(id, ACTION_ID);
        assert.equal(userId, USER_ID);
        return toSafePendingAction({
          _id: ACTION_ID,
          actionType: 'prepare_booking',
          schemaVersion: 'booking_preview@1',
          preview: { restaurant: { name: 'BookEat Bistro' } },
          status: 'pending',
          expiresAt: new Date('2026-06-18T11:00:00.000Z'),
        });
      },
      async cancelOwnedActionSafe({ id, userId }) {
        assert.equal(id, ACTION_ID);
        assert.equal(userId, USER_ID);
        return {
          id,
          actionType: 'prepare_booking',
          schemaVersion: 'booking_preview@1',
          preview: { restaurant: { name: 'BookEat Bistro' } },
          status: 'cancelled',
          expiresAt: '2026-06-18T11:00:00.000Z',
          allowedActions: { confirm: false, cancel: false, edit: true },
        };
      },
    },
  });
  const baseController = {
    health: (req, res) => res.json({ success: true }),
    mockChat: (req, res) => res.json({ success: true }),
    streamChat: (req, res) => res.end(),
  };
  const optionalUser = (req, res, next) => {
    if (req.headers.authorization) req.user = { _id: USER_ID, role: 'customer' };
    next();
  };
  app.use('/api/v1/ai', createAiRouter(baseController, {
    pendingController,
    optionalUser,
    rateLimiter: (req, res, next) => next(),
  }));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/v1/ai`;

  try {
    const unauthenticated = await fetch(`${baseUrl}/pending-actions/${ACTION_ID}`);
    assert.equal(unauthenticated.status, 401);

    const response = await fetch(`${baseUrl}/pending-actions/${ACTION_ID}`, {
      headers: { Authorization: 'Bearer token' },
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.status, 'pending');
    assert.equal(Object.hasOwn(body.data, 'payload'), false);

    const cancelled = await fetch(`${baseUrl}/pending-actions/${ACTION_ID}/cancel`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    const cancelBody = await cancelled.json();
    assert.equal(cancelBody.data.status, 'cancelled');

    const rejectedPayload = await fetch(`${baseUrl}/pending-actions/${ACTION_ID}/cancel`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ payload: { numberOfGuests: 99 } }),
    });
    assert.equal(rejectedPayload.status, 400);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
