'use strict';

const Refund = require('../models/Refund');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');

/**
 * Calculate refund amount based on cancellation policy.
 * @param {Object} booking - The booking being cancelled
 * @param {Object} policy - Cancellation policy from restaurant
 * @returns {{ refundAmount: number, reason: string }}
 */
const calculateRefund = (booking, policy) => {
  const depositAmount = booking.depositAmount || 0;
  if (depositAmount <= 0) {
    return { refundAmount: 0, reason: 'Không có tiền cọc để hoàn' };
  }

  const now = new Date();
  const bookingDateTime = (() => {
    const d = new Date(booking.bookingDate);
    const [h, m] = (booking.bookingTime || '00:00').split(':');
    d.setHours(parseInt(h, 10), parseInt(m, 10), 0, 0);
    return d;
  })();

  const hoursUntilBooking = (bookingDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);

  if (hoursUntilBooking >= policy.fullRefundBeforeHours) {
    return { refundAmount: depositAmount, reason: `Hủy trước ${policy.fullRefundBeforeHours}h, hoàn 100% tiền cọc` };
  }

  if (hoursUntilBooking >= policy.partialRefundBeforeHours) {
    const refundAmount = Math.round(depositAmount * (policy.partialRefundPercent / 100));
    return { refundAmount, reason: `Hủy trước ${hoursUntilBooking.toFixed(1)}h, hoàn ${policy.partialRefundPercent}% tiền cọc` };
  }

  return { refundAmount: 0, reason: `Hủy sát giờ (còn ${hoursUntilBooking.toFixed(1)}h), không được hoàn tiền cọc` };
};

/**
 * Create a refund record and update payment status.
 * @param {Object} options
 * @returns {Promise<Object>} refund record
 */
const createRefund = async ({ booking, payment, amount, reason, requestedBy, requestedByRole }) => {
  if (amount <= 0) return null;

  const refund = await Refund.create({
    paymentId: payment._id,
    bookingId: booking._id,
    requestedBy,
    requestedByRole,
    amount,
    reason,
    status: 'approved',
    approvedBy: requestedBy,
  });

  payment.status = amount >= payment.amount ? 'refunded' : 'partially_refunded';
  await payment.save();

  return refund;
};

/**
 * Auto-process refund when booking is cancelled.
 * @param {Object} booking - The cancelled booking
 * @param {Object} restaurant - The restaurant
 * @param {ObjectId} userId - User who performed the cancellation
 * @param {string} userRole - Role of the user
 * @returns {Promise<Object|null>} refund record or null
 */
const autoRefund = async (booking, restaurant, userId, userRole) => {
  if (!booking.depositPaid || !booking.depositAmount) return null;

  const policy = restaurant.cancellationPolicy || {
    fullRefundBeforeHours: 24,
    partialRefundBeforeHours: 2,
    partialRefundPercent: 50,
    cancellationFee: 0,
  };

  const { refundAmount, reason } = calculateRefund(booking, policy);
  if (refundAmount <= 0) return null;

  const payment = await Payment.findOne({
    targetType: 'booking',
    targetId: booking._id,
    status: 'paid',
  });
  if (!payment) return null;

  return await createRefund({
    booking, payment, amount: refundAmount, reason,
    requestedBy: userId, requestedByRole: userRole,
  });
};

module.exports = {
  calculateRefund,
  createRefund,
  autoRefund,
};
