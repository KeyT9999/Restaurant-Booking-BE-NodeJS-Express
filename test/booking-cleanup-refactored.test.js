'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Booking = require('../src/models/Booking');
const User = require('../src/models/User');
const Restaurant = require('../src/models/Restaurant');
const bookingService = require('../src/services/booking.service');
const loyaltyService = require('../src/services/loyalty.service');
const bookingCommissionService = require('../src/services/booking-commission.service');

test('processExpiredBooking - checkedInAt != null leads to completed', async () => {
  const originalFindById = Booking.findById;
  const originalFindOneAndUpdate = Booking.findOneAndUpdate;
  const originalBookingSave = Booking.prototype.save;
  const originalRestaurantFindById = Restaurant.findById;
  const originalRestaurantSave = Restaurant.prototype.save;
  const originalAddCoins = loyaltyService.addCoins;
  const originalCreateLedger = bookingCommissionService.createLedgerForBooking;
  const originalRelease = bookingService.releaseTableReservations;

  const bookingId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();
  const restaurantId = new mongoose.Types.ObjectId();

  const mockBooking = {
    _id: bookingId,
    status: 'confirmed',
    customerId,
    restaurantId,
    bookingDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
    bookingTime: '10:00',
    checkedInAt: new Date(),
    statusHistory: [],
    save: async function () {
      if (this._becameCompleted) {
        this.loyaltyAwarded = true;
      }
      return this;
    }
  };

  const mockRestaurant = {
    _id: restaurantId,
    stats: { completedBookings: 0 },
    save: async function () { return this; }
  };

  let findOneAndUpdateCalled = false;
  let releaseCalled = false;
  let addCoinsCalled = false;
  let createLedgerCalled = false;

  try {
    Booking.findById = async () => mockBooking;
    Booking.findOneAndUpdate = async (query, update, options) => {
      assert.deepEqual(query._id, bookingId);
      assert.equal(query.status, 'confirmed');
      assert.equal(update.$set.status, 'completed');
      findOneAndUpdateCalled = true;
      return mockBooking;
    };
    Restaurant.findById = async () => mockRestaurant;
    loyaltyService.addCoins = async (userId, amount, type, referenceId) => {
      assert.deepEqual(userId, customerId);
      assert.deepEqual(referenceId, bookingId);
      assert.equal(type, 'earn_completed');
      addCoinsCalled = true;
      return {};
    };
    bookingCommissionService.createLedgerForBooking = async (id, opts) => {
      assert.deepEqual(id, bookingId);
      createLedgerCalled = true;
      return {};
    };
    bookingService.releaseTableReservations = async (id) => {
      assert.deepEqual(id, bookingId);
      releaseCalled = true;
    };

    // Run service function
    const result = await bookingService.processExpiredBooking(bookingId, new Date(Date.now() + 5 * 60 * 60 * 1000));

    assert.deepEqual(result, { success: true, status: 'completed' });
    assert.equal(findOneAndUpdateCalled, true);
    assert.equal(releaseCalled, true);
    assert.equal(mockBooking.loyaltyAwarded, true);
    assert.equal(mockRestaurant.stats.completedBookings, 1);
  } finally {
    Booking.findById = originalFindById;
    Booking.findOneAndUpdate = originalFindOneAndUpdate;
    Booking.prototype.save = originalBookingSave;
    Restaurant.findById = originalRestaurantFindById;
    Restaurant.prototype.save = originalRestaurantSave;
    loyaltyService.addCoins = originalAddCoins;
    bookingCommissionService.createLedgerForBooking = originalCreateLedger;
    bookingService.releaseTableReservations = originalRelease;
  }
});

test('processExpiredBooking - checkedInAt == null leads to no_show and increments user noShowCounter', async () => {
  const originalFindById = Booking.findById;
  const originalFindOneAndUpdate = Booking.findOneAndUpdate;
  const originalBookingSave = Booking.prototype.save;
  const originalUserFindById = User.findById;
  const originalUserSave = User.prototype.save;
  const originalRestaurantFindById = Restaurant.findById;
  const originalRelease = bookingService.releaseTableReservations;

  const bookingId = new mongoose.Types.ObjectId();
  const customerId = new mongoose.Types.ObjectId();
  const restaurantId = new mongoose.Types.ObjectId();

  const mockBooking = {
    _id: bookingId,
    status: 'confirmed',
    customerId,
    restaurantId,
    bookingDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
    bookingTime: '10:00',
    checkedInAt: null,
    statusHistory: [],
    save: async function () { return this; }
  };

  const mockUser = {
    _id: customerId,
    noShowCounter: 1,
    save: async function () { return this; }
  };

  let findOneAndUpdateCalled = false;
  let releaseCalled = false;
  let userSaveCalled = false;

  try {
    Booking.findById = async () => mockBooking;
    Booking.findOneAndUpdate = async (query, update, options) => {
      assert.deepEqual(query._id, bookingId);
      assert.equal(query.status, 'confirmed');
      assert.equal(update.$set.status, 'no_show');
      findOneAndUpdateCalled = true;
      return mockBooking;
    };
    User.findById = async () => mockUser;
    Restaurant.findById = async () => null;
    User.prototype.save = async function () {
      userSaveCalled = true;
      return this;
    };
    bookingService.releaseTableReservations = async (id) => {
      assert.deepEqual(id, bookingId);
      releaseCalled = true;
    };

    // Run service function (simulating current time is way past booking time)
    const result = await bookingService.processExpiredBooking(bookingId, new Date(Date.now() + 5 * 60 * 60 * 1000));

    assert.deepEqual(result, { success: true, status: 'no_show' });
    assert.equal(findOneAndUpdateCalled, true);
    assert.equal(releaseCalled, true);
    assert.equal(mockUser.noShowCounter, 2);
  } finally {
    Booking.findById = originalFindById;
    Booking.findOneAndUpdate = originalFindOneAndUpdate;
    Booking.prototype.save = originalBookingSave;
    User.findById = originalUserFindById;
    User.prototype.save = originalUserSave;
    Restaurant.findById = originalRestaurantFindById;
    bookingService.releaseTableReservations = originalRelease;
  }
});
