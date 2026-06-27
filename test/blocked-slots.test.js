const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const User = require('../src/models/User');
const Restaurant = require('../src/models/Restaurant');
const RestaurantTable = require('../src/models/RestaurantTable');
const BlockedSlot = require('../src/models/BlockedSlot');

const bookingService = require('../src/services/booking.service');
const blockedSlotCtrl = require('../src/controllers/owner.blocked-slot.controller');

const createResponse = () => {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  return res;
};

const createRequest = ({ user, body = {}, query = {}, params = {} } = {}) => ({
  user,
  body,
  query,
  params,
});

const callController = async (controller, req) => {
  const res = createResponse();
  await controller(req, res, () => {});
  return res;
};

const cleanup = async (suffix) => {
  await BlockedSlot.deleteMany({});
  await RestaurantTable.deleteMany({ tableNumber: new RegExp(`^${suffix}`) });
  await Restaurant.deleteMany({ name: new RegExp(`^${suffix}`) });
  await User.deleteMany({ username: new RegExp(`^${suffix}`) });
};

test.before(async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required for tests');
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  }
});

test.after(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
});

test('Blocked Slots: CRUD, Full Day Block, Time Range Block, and Table-specific Block validation', async () => {
  const suffix = `BLOCK_TEST_${Date.now()}`;
  await cleanup(suffix);

  try {
    // 1. Create fixtures (Owner and Restaurant)
    const owner = await User.create({
      username: `${suffix}_owner`,
      email: `${suffix}_owner@example.com`,
      password: 'Password123!',
      fullName: 'Owner Block Test',
      role: 'restaurant_owner',
      emailVerified: true,
    });

    const restaurant = await Restaurant.create({
      ownerId: owner._id,
      name: `${suffix} Restaurant`,
      description: 'Test restaurant for blocked slots',
      cuisineTypes: ['Vietnamese'],
      phoneNumber: '0987654321',
      email: `${suffix}_rest@example.com`,
      address: { street: '123 St', ward: 'W', district: 'D', city: 'C', fullAddress: '123 St, C' },
      approvalStatus: 'approved',
      active: true,
      operatingHours: {
        monday: { open: '08:00', close: '22:00', closed: false },
        tuesday: { open: '08:00', close: '22:00', closed: false },
        wednesday: { open: '08:00', close: '22:00', closed: false },
        thursday: { open: '08:00', close: '22:00', closed: false },
        friday: { open: '08:00', close: '22:00', closed: false },
        saturday: { open: '08:00', close: '22:00', closed: false },
        sunday: { open: '08:00', close: '22:00', closed: false },
      }
    });

    // Create 2 tables
    const table1 = await RestaurantTable.create({
      restaurantId: restaurant._id,
      tableNumber: `${suffix}_T1`,
      capacity: 4,
      isActive: true,
      status: 'available',
      depositAmount: 100000,
    });

    const table2 = await RestaurantTable.create({
      restaurantId: restaurant._id,
      tableNumber: `${suffix}_T2`,
      capacity: 2,
      isActive: true,
      status: 'available',
      depositAmount: 50000,
    });

    // --- Part 1: CRUD Operations ---
    
    // A. Create full day block
    const reqCreate1 = createRequest({
      user: owner,
      params: { restaurantId: restaurant._id.toString() },
      body: {
        date: '2026-07-10',
        slotType: 'full_day',
        reason: 'Sự kiện đặc biệt',
      },
    });
    const resCreate1 = await callController(blockedSlotCtrl.createBlockedSlot, reqCreate1);
    assert.equal(resCreate1.statusCode, 201);
    assert.equal(resCreate1.body.success, true);
    assert.equal(resCreate1.body.data.reason, 'Sự kiện đặc biệt');
    assert.equal(resCreate1.body.data.slotType, 'full_day');

    // B. Create time range block on a different date
    const reqCreate2 = createRequest({
      user: owner,
      params: { restaurantId: restaurant._id.toString() },
      body: {
        date: '2026-07-11',
        slotType: 'time_range',
        startTime: '14:00',
        endTime: '16:00',
        reason: 'Họp nội bộ',
      },
    });
    const resCreate2 = await callController(blockedSlotCtrl.createBlockedSlot, reqCreate2);
    assert.equal(resCreate2.statusCode, 201);
    assert.equal(resCreate2.body.success, true);
    assert.equal(resCreate2.body.data.startTime, '14:00');
    assert.equal(resCreate2.body.data.endTime, '16:00');

    // C. Create table-specific block on table 1
    const reqCreate3 = createRequest({
      user: owner,
      params: { restaurantId: restaurant._id.toString() },
      body: {
        date: '2026-07-12',
        slotType: 'full_day',
        tableNumbers: [table1.tableNumber],
        reason: 'Bảo trì bàn 1',
      },
    });
    const resCreate3 = await callController(blockedSlotCtrl.createBlockedSlot, reqCreate3);
    assert.equal(resCreate3.statusCode, 201);
    assert.equal(resCreate3.body.data.tableNumbers[0], table1.tableNumber);

    // D. Fetch slots
    const reqGet = createRequest({
      user: owner,
      params: { restaurantId: restaurant._id.toString() },
    });
    const resGet = await callController(blockedSlotCtrl.getBlockedSlots, reqGet);
    assert.equal(resGet.statusCode, 200);
    assert.equal(resGet.body.success, true);
    assert.equal(resGet.body.data.length, 3);

    // --- Part 2: Business Logic Validation ---

    // A. Validate full day block (July 10, 2026)
    const valFullDay = await bookingService.validateBookingTime('2026-07-10', '12:00', restaurant);
    assert.equal(valFullDay.valid, false);
    assert.match(valFullDay.errors[0], /Nhà hàng đóng cửa hôm nay/i);

    // B. Validate time range block (July 11, 2026 between 14:00 and 16:00)
    // Overlapping: booking at 13:00 (ends 15:00, overlaps block 14:00-16:00) -> invalid
    const valOverlap1 = await bookingService.validateBookingTime('2026-07-11', '13:00', restaurant);
    assert.equal(valOverlap1.valid, false);

    // Non-overlapping: booking at 09:00 (ends 11:00, block is 14:00-16:00) -> valid
    const valOverlap2 = await bookingService.validateBookingTime('2026-07-11', '09:00', restaurant);
    assert.equal(valOverlap2.valid, true);

    // C. Validate table-specific block (July 12, 2026)
    const availableTables = await bookingService.getAvailableTables(restaurant._id, '2026-07-12', '12:00');
    const availableNumbers = availableTables.map(t => t.tableNumber);
    assert.equal(availableNumbers.includes(table1.tableNumber), false);
    assert.equal(availableNumbers.includes(table2.tableNumber), true);

    // D. Delete blocked slot and verify it works
    const targetSlotId = resCreate1.body.data._id.toString();
    const reqDelete = createRequest({
      user: owner,
      params: { restaurantId: restaurant._id.toString(), id: targetSlotId },
    });
    const resDelete = await callController(blockedSlotCtrl.deleteBlockedSlot, reqDelete);
    assert.equal(resDelete.statusCode, 200);

    // Validate that July 10, 2026 is now bookable again!
    const valDeletedBlock = await bookingService.validateBookingTime('2026-07-10', '12:00', restaurant);
    assert.equal(valDeletedBlock.valid, true);

  } finally {
    await cleanup(suffix);
  }
});
