'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Booking = require('../src/models/Booking');
const Payment = require('../src/models/Payment');
const Refund = require('../src/models/Refund');
const Wallet = require('../src/models/Wallet');
const WalletTransaction = require('../src/models/WalletTransaction');
const { cancelBookingToWallet } = require('../src/services/booking-cancellation.service');
const { applyWalletToBookingPayment, reverseWalletBookingPayment } = require('../src/services/wallet-payment.service');

const mongoUri = process.env.MONGO_TEST_URI;

const localBookingParts = (instant) => {
  const shifted = new Date(instant.getTime() + 7 * 60 * 60 * 1000);
  return {
    bookingDate: new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate())),
    bookingTime: `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`,
  };
};

const createPaidBooking = async ({ customerId, restaurantId, bookingInstant, amount }) => {
  const parts = localBookingParts(bookingInstant);
  const booking = await Booking.create({
    customerId,
    restaurantId,
    ...parts,
    numberOfGuests: 2,
    customerName: 'Wallet Integration Test',
    customerPhone: '0900000000',
    customerEmail: `wallet-${Date.now()}-${Math.random()}@example.test`,
    status: 'confirmed',
    depositAmount: amount,
    depositPaid: true,
  });
  const payment = await Payment.create({
    userId: customerId,
    targetType: 'booking',
    targetId: booking._id,
    restaurantId,
    amount,
    gatewayAmount: amount,
    orderCode: Date.now() * 100 + Math.floor(Math.random() * 99),
    status: 'paid',
    paidAt: new Date(),
  });
  return { booking, payment };
};

test('real transaction: cancellation, rollback, ownership and retries stay consistent', { skip: !mongoUri }, async () => {
  await mongoose.connect(mongoUri);
  const customerId = new mongoose.Types.ObjectId();
  const restaurantId = new mongoose.Types.ObjectId();
  const now = new Date();
  const { booking } = await createPaidBooking({
    customerId,
    restaurantId,
    bookingInstant: new Date(now.getTime() + 3 * 60 * 60 * 1000),
    amount: 300000,
  });

  try {
    const results = await Promise.all([
      cancelBookingToWallet({ bookingId: booking._id, customerId, reason: 'integration retry', now }),
      cancelBookingToWallet({ bookingId: booking._id, customerId, reason: 'integration retry', now }),
    ]);
    const wallet = await Wallet.findOne({ userId: customerId });
    assert.equal(wallet.balance, 300000);
    assert.equal(await WalletTransaction.countDocuments({ bookingId: booking._id, type: 'CREDIT_BOOKING_REFUND' }), 1);
    assert.equal(await Refund.countDocuments({ bookingId: booking._id, refundMethod: 'bookeat_wallet' }), 1);
    assert.equal(results.filter((result) => result.alreadyProcessed === false).length, 1);

    const retry = await cancelBookingToWallet({ bookingId: booking._id, customerId, reason: 'retry after timeout', now });
    assert.equal(retry.alreadyProcessed, true);
    assert.equal((await Wallet.findOne({ userId: customerId })).balance, 300000);

    const partial = await createPaidBooking({
      customerId,
      restaurantId,
      bookingInstant: new Date(now.getTime() + 60 * 60 * 1000),
      amount: 300000,
    });
    const partialResult = await cancelBookingToWallet({ bookingId: partial.booking._id, customerId, reason: 'late cancel', now });
    assert.equal(partialResult.cancellationFeeAmount, 90000);
    assert.equal(partialResult.refundAmount, 210000);
    assert.equal((await Wallet.findOne({ userId: customerId })).balance, 510000);

    const closed = await createPaidBooking({
      customerId,
      restaurantId,
      bookingInstant: now,
      amount: 300000,
    });
    await assert.rejects(
      cancelBookingToWallet({ bookingId: closed.booking._id, customerId, reason: 'too late', now }),
      (error) => error.code === 'CANCELLATION_CLOSED'
    );
    assert.equal((await Booking.findById(closed.booking._id)).status, 'confirmed');

    const owned = await createPaidBooking({
      customerId,
      restaurantId,
      bookingInstant: new Date(now.getTime() + 3 * 60 * 60 * 1000),
      amount: 120000,
    });
    await assert.rejects(
      cancelBookingToWallet({ bookingId: owned.booking._id, customerId: new mongoose.Types.ObjectId(), reason: 'foreign', now }),
      (error) => error.code === 'BOOKING_NOT_FOUND'
    );
    assert.equal((await Booking.findById(owned.booking._id)).status, 'confirmed');

    const rollback = await createPaidBooking({
      customerId,
      restaurantId,
      bookingInstant: new Date(now.getTime() + 3 * 60 * 60 * 1000),
      amount: 150000,
    });
    const originalCreate = WalletTransaction.create;
    WalletTransaction.create = async () => { throw new Error('forced ledger failure'); };
    try {
      await assert.rejects(
        cancelBookingToWallet({ bookingId: rollback.booking._id, customerId, reason: 'force rollback', now }),
        /forced ledger failure/
      );
    } finally {
      WalletTransaction.create = originalCreate;
    }
    assert.equal((await Booking.findById(rollback.booking._id)).status, 'confirmed');
    assert.equal((await Wallet.findOne({ userId: customerId })).balance, 510000);
    assert.equal(await Refund.countDocuments({ bookingId: rollback.booking._id }), 0);
  } finally {
    await Promise.all([
      Booking.deleteMany({ customerId }),
      Payment.deleteMany({ userId: customerId }),
      Refund.deleteMany({ requestedBy: customerId }),
      WalletTransaction.deleteMany({ userId: customerId }),
      Wallet.deleteMany({ userId: customerId }),
    ]);
    await mongoose.disconnect();
  }
});

test('real transaction: mixed wallet payment debits once and reverses safely', { skip: !mongoUri }, async () => {
  await mongoose.connect(mongoUri);
  const customerId = new mongoose.Types.ObjectId();
  const restaurantId = new mongoose.Types.ObjectId();
  const wallet = await Wallet.create({ userId: customerId, balance: 100000, status: 'active' });
  const { booking, payment } = await createPaidBooking({
    customerId,
    restaurantId,
    bookingInstant: new Date(Date.now() + 3 * 60 * 60 * 1000),
    amount: 250000,
  });
  payment.status = 'pending';
  await payment.save();

  try {
    const split = await applyWalletToBookingPayment({ paymentId: payment._id, userId: customerId, bookingId: booking._id });
    assert.deepEqual({ appliedAmount: split.appliedAmount, gatewayAmount: split.gatewayAmount, walletBalance: split.walletBalance }, {
      appliedAmount: 100000,
      gatewayAmount: 150000,
      walletBalance: 0,
    });
    const sameSplit = await applyWalletToBookingPayment({ paymentId: payment._id, userId: customerId, bookingId: booking._id });
    assert.equal(sameSplit.appliedAmount, 100000);
    assert.equal(await WalletTransaction.countDocuments({ bookingId: booking._id, type: 'DEBIT_BOOKING_PAYMENT' }), 1);

    await reverseWalletBookingPayment(payment._id, 'integration reversal');
    await reverseWalletBookingPayment(payment._id, 'integration reversal retry');
    assert.equal((await Wallet.findById(wallet._id)).balance, 100000);
    assert.equal(await WalletTransaction.countDocuments({ bookingId: booking._id, type: 'CREDIT_BOOKING_PAYMENT_REVERSAL' }), 1);
  } finally {
    await Promise.all([
      Booking.deleteMany({ customerId }),
      Payment.deleteMany({ userId: customerId }),
      WalletTransaction.deleteMany({ userId: customerId }),
      Wallet.deleteMany({ userId: customerId }),
    ]);
    await mongoose.disconnect();
  }
});
