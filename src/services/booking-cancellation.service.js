'use strict';

const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const TableReservation = require('../models/TableReservation');
const Payment = require('../models/Payment');
const Refund = require('../models/Refund');
const Wallet = require('../models/Wallet');
const WalletTransaction = require('../models/WalletTransaction');
const { calculateCancellationPolicy } = require('./cancellation-policy.service');

const IDEMPOTENCY_PREFIX = 'BOOKING_CANCELLATION_REFUND';

class BookingCancellationError extends Error {
  constructor(code, message, statusCode = 400, details = null) {
    super(message);
    this.name = 'BookingCancellationError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

const idempotencyKeyFor = (bookingId) => `${IDEMPOTENCY_PREFIX}:${bookingId}`;

const findPaidBookingPayment = (bookingId, session = null) => {
  const query = Payment.findOne({
    targetType: 'booking',
    targetId: bookingId,
    status: 'paid',
  }).sort({ paidAt: -1, createdAt: -1 });
  if (session) query.session(session);
  return query;
};

const toIntegerAmount = (value) => {
  const amount = Number(value || 0);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : 0;
};

const buildStoredResult = async (booking, session = null) => {
  let walletTransaction = null;
  if (booking.walletTransactionId) {
    const query = WalletTransaction.findById(booking.walletTransactionId);
    if (session) query.session(session);
    walletTransaction = await query;
  }

  let wallet = null;
  if (walletTransaction?.walletId) {
    const query = Wallet.findById(walletTransaction.walletId);
    if (session) query.session(session);
    wallet = await query;
  } else if (booking.customerId) {
    const query = Wallet.findOne({ userId: booking.customerId });
    if (session) query.session(session);
    wallet = await query;
  }

  const refundQuery = Refund.findOne({ bookingId: booking._id, refundMethod: 'bookeat_wallet' });
  if (session) refundQuery.session(session);
  const refund = await refundQuery;

  return {
    booking,
    alreadyProcessed: true,
    policyCode: booking.cancellationPolicyCode,
    depositPaid: toIntegerAmount(booking.cancellationPaidAmount),
    cancellationFeeRateBasisPoints: Number(booking.cancellationFeeRateBasisPoints || 0),
    cancellationFeeAmount: toIntegerAmount(booking.cancellationFeeAmount),
    refundAmount: toIntegerAmount(booking.refundAmount),
    refundMethod: booking.refundMethod === 'bookeat_wallet' ? 'BOOKEAT_WALLET' : booking.refundMethod,
    refundStatus: booking.refundStatus === 'completed' ? 'COMPLETED' : booking.refundStatus,
    walletBalance: toIntegerAmount(wallet?.balance),
    walletTransaction,
    refund,
  };
};

const getCancellationPreview = async ({ booking, now = new Date() }) => {
  if (booking.status === 'cancelled' && booking.cancellationPolicyCode) {
    const stored = await buildStoredResult(booking);
    return {
      bookingId: booking._id.toString(),
      canCancel: false,
      alreadyCancelled: true,
      policyCode: stored.policyCode,
      depositPaid: stored.depositPaid,
      cancellationFeeRate: stored.cancellationFeeRateBasisPoints / 10000,
      cancellationFeeRateBasisPoints: stored.cancellationFeeRateBasisPoints,
      cancellationFeeAmount: stored.cancellationFeeAmount,
      refundAmount: stored.refundAmount,
      refundMethod: stored.refundMethod || 'BOOKEAT_WALLET',
      refundStatus: stored.refundStatus,
      walletBalance: stored.walletBalance,
      walletTransactionId: stored.walletTransaction?._id || null,
      message: 'Booking này đã được hủy và kết quả hoàn tiền trước đó được giữ nguyên.',
    };
  }

  if (!['pending', 'confirmed'].includes(booking.status)) {
    throw new BookingCancellationError(
      'BOOKING_STATUS_NOT_CANCELLABLE',
      'Chỉ booking đang chờ xác nhận hoặc đã xác nhận mới có thể hủy.',
      409
    );
  }

  const payment = await findPaidBookingPayment(booking._id);
  const paidAmount = toIntegerAmount(payment?.amount);
  const policy = calculateCancellationPolicy({
    bookingDate: booking.bookingDate,
    bookingTime: booking.bookingTime,
    paidAmount,
    now,
  });

  return {
    bookingId: booking._id.toString(),
    ...policy,
    paymentId: payment?._id || null,
  };
};

const cancelBookingToWallet = async ({
  bookingId,
  customerId,
  actorId = customerId,
  cancelledBy = 'customer',
  waiveCancellationFee = false,
  reason,
  now = new Date(),
}) => {
  const session = await mongoose.startSession();
  let committedResult = null;

  try {
    await session.withTransaction(async () => {
      const ownershipFilter = cancelledBy === 'customer' ? { customerId } : {};
      const booking = await Booking.findOne({ _id: bookingId, ...ownershipFilter }).session(session);
      if (!booking) {
        throw new BookingCancellationError(
          'BOOKING_NOT_FOUND',
          'Không tìm thấy booking hoặc bạn không có quyền hủy booking này.',
          404
        );
      }

      if (booking.status === 'cancelled' && booking.cancellationPolicyCode) {
        committedResult = await buildStoredResult(booking, session);
        return;
      }

      if (!['pending', 'confirmed'].includes(booking.status)) {
        throw new BookingCancellationError(
          'BOOKING_STATUS_NOT_CANCELLABLE',
          'Booking đã hoàn thành, no-show hoặc không còn ở trạng thái có thể hủy.',
          409
        );
      }

      const payment = await findPaidBookingPayment(booking._id, session);
      const paidAmount = toIntegerAmount(payment?.amount);
      let policy = calculateCancellationPolicy({
        bookingDate: booking.bookingDate,
        bookingTime: booking.bookingTime,
        paidAmount,
        now,
      });

      if (waiveCancellationFee) {
        policy = {
          ...policy,
          canCancel: true,
          policyCode: 'FULL_REFUND',
          cancellationFeeRate: 0,
          cancellationFeeRateBasisPoints: 0,
          cancellationFeeAmount: 0,
          refundAmount: paidAmount,
          message: 'Hoàn 100% tiền cọc vào Ví BookEat do nhà hàng hoặc quản trị viên hủy booking.',
        };
      }

      if (!policy.canCancel) {
        throw new BookingCancellationError(
          'CANCELLATION_CLOSED',
          policy.message,
          409,
          policy
        );
      }

      const walletOwnerId = booking.customerId;
      if (policy.refundAmount > 0 && !walletOwnerId) {
        throw new BookingCancellationError(
          'GUEST_REFUND_REQUIRES_MANUAL_PROCESSING',
          'Booking khách vãng lai có tiền cọc cần được hoàn theo nguồn thanh toán bởi owner/admin.',
          409,
        );
      }
      let wallet = walletOwnerId
        ? await Wallet.findOne({ userId: walletOwnerId }).session(session)
        : null;
      let walletTransaction = null;
      let refund = null;

      if (policy.refundAmount > 0) {
        if (!payment) {
          throw new BookingCancellationError(
            'PAID_PAYMENT_NOT_FOUND',
            'Không tìm thấy giao dịch tiền cọc đã thanh toán để hoàn vào ví.',
            409
          );
        }

        if (!wallet) {
          const created = await Wallet.create([{
            userId: walletOwnerId,
            balance: 0,
            status: 'active',
          }], { session });
          wallet = created[0];
        }

        if (wallet.status !== 'active') {
          throw new BookingCancellationError(
            'WALLET_NOT_ACTIVE',
            'Ví BookEat hiện không hoạt động. Vui lòng liên hệ hỗ trợ.',
            409
          );
        }

        const balanceBefore = toIntegerAmount(wallet.balance);
        const balanceAfter = balanceBefore + policy.refundAmount;
        if (!Number.isSafeInteger(balanceAfter)) {
          throw new BookingCancellationError('WALLET_BALANCE_OVERFLOW', 'Số dư ví vượt giới hạn an toàn.', 409);
        }

        const updatedWallet = await Wallet.findOneAndUpdate(
          { _id: wallet._id, balance: balanceBefore, status: 'active' },
          { $inc: { balance: policy.refundAmount } },
          { returnDocument: 'after', session, runValidators: true }
        );
        if (!updatedWallet) {
          throw new BookingCancellationError(
            'WALLET_CONCURRENT_UPDATE',
            'Số dư ví vừa thay đổi. Vui lòng thử lại.',
            409
          );
        }
        wallet = updatedWallet;

        const createdTransactions = await WalletTransaction.create([{
          walletId: wallet._id,
          userId: walletOwnerId,
          bookingId: booking._id,
          type: 'CREDIT_BOOKING_REFUND',
          amount: policy.refundAmount,
          balanceBefore,
          balanceAfter,
          referenceType: 'booking_cancellation',
          referenceId: booking._id,
          description: `Hoàn tiền hủy booking #${booking._id.toString().slice(-8).toUpperCase()}`,
          status: 'completed',
          idempotencyKey: idempotencyKeyFor(booking._id),
          metadata: {
            policyCode: policy.policyCode,
            paidAmount: policy.depositPaid,
            cancellationFeeAmount: policy.cancellationFeeAmount,
          },
        }], { session });
        walletTransaction = createdTransactions[0];

        const refunds = await Refund.create([{
          paymentId: payment._id,
          bookingId: booking._id,
          requestedBy: actorId,
          requestedByRole: cancelledBy === 'customer' ? 'customer' : (cancelledBy === 'admin' ? 'admin' : 'restaurant_owner'),
          amount: policy.refundAmount,
          reason: reason?.trim() || (cancelledBy === 'customer' ? 'Khách hàng chủ động hủy booking' : 'Nhà hàng chủ động hủy booking'),
          status: 'refunded',
          refundMethod: 'bookeat_wallet',
          walletTransactionId: walletTransaction._id,
          cancellationPolicyCode: policy.policyCode,
          cancellationFeeAmount: policy.cancellationFeeAmount,
          refundedAt: now,
          adminNote: 'Hoàn tự động vào Ví BookEat',
        }], { session });
        refund = refunds[0];

        payment.status = policy.refundAmount >= paidAmount ? 'refunded' : 'partially_refunded';
        await payment.save({ session });
      }

      booking.status = 'cancelled';
      booking.cancelledBy = cancelledBy;
      booking.cancelledAt = now;
      booking.cancellationReason = reason?.trim() || (cancelledBy === 'customer' ? 'Khách hàng chủ động hủy' : 'Nhà hàng chủ động hủy');
      booking.cancellationPolicyCode = policy.policyCode;
      booking.cancellationFeeRateBasisPoints = policy.cancellationFeeRateBasisPoints;
      booking.cancellationPaidAmount = policy.depositPaid;
      booking.cancellationFeeAmount = policy.cancellationFeeAmount;
      booking.refundAmount = policy.refundAmount;
      booking.refundMethod = 'bookeat_wallet';
      booking.refundStatus = policy.refundAmount > 0 ? 'completed' : 'not_applicable';
      booking.walletTransactionId = walletTransaction?._id || null;
      booking.statusHistory.push({
        status: 'cancelled',
        changedBy: actorId,
        changedAt: now,
        note: `${booking.cancellationReason}. Chính sách ${policy.policyCode}, phí ${policy.cancellationFeeAmount} VND, hoàn ví ${policy.refundAmount} VND.`,
      });
      await booking.save({ session });
      await TableReservation.deleteMany({ bookingId: booking._id }).session(session);

      committedResult = {
        booking,
        alreadyProcessed: false,
        policyCode: policy.policyCode,
        depositPaid: policy.depositPaid,
        cancellationFeeRateBasisPoints: policy.cancellationFeeRateBasisPoints,
        cancellationFeeAmount: policy.cancellationFeeAmount,
        refundAmount: policy.refundAmount,
        refundMethod: 'BOOKEAT_WALLET',
        refundStatus: policy.refundAmount > 0 ? 'COMPLETED' : 'NOT_APPLICABLE',
        walletBalance: toIntegerAmount(wallet?.balance),
        walletTransaction,
        refund,
      };
    });
  } catch (error) {
    if (error?.code === 11000) {
      const booking = await Booking.findOne({ _id: bookingId, ...(cancelledBy === 'customer' ? { customerId } : {}) });
      if (booking?.status === 'cancelled' && booking.cancellationPolicyCode) {
        return buildStoredResult(booking);
      }
    }
    throw error;
  } finally {
    await session.endSession();
  }

  return committedResult;
};

module.exports = {
  BookingCancellationError,
  IDEMPOTENCY_PREFIX,
  idempotencyKeyFor,
  findPaidBookingPayment,
  getCancellationPreview,
  cancelBookingToWallet,
};
