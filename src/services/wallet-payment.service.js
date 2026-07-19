'use strict';

const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const Wallet = require('../models/Wallet');
const WalletTransaction = require('../models/WalletTransaction');

const applyWalletToBookingPayment = async ({ paymentId, userId, bookingId }) => {
  const session = await mongoose.startSession();
  let result = { appliedAmount: 0, gatewayAmount: null, walletBalance: 0 };
  try {
    await session.withTransaction(async () => {
      const payment = await Payment.findOne({ _id: paymentId, userId, status: 'pending' }).session(session);
      if (!payment) throw new Error('Không tìm thấy payment đang chờ xử lý');
      if (payment.walletTransactionId) {
        const wallet = await Wallet.findOne({ userId }).session(session);
        result = { appliedAmount: payment.walletAmountApplied, gatewayAmount: payment.gatewayAmount, walletBalance: wallet?.balance || 0 };
        return;
      }

      const wallet = await Wallet.findOne({ userId, status: 'active' }).session(session);
      const balanceBefore = Number(wallet?.balance || 0);
      const appliedAmount = Math.min(balanceBefore, payment.amount);
      const gatewayAmount = payment.amount - appliedAmount;
      if (appliedAmount <= 0) {
        payment.gatewayAmount = payment.amount;
        await payment.save({ session });
        result = { appliedAmount: 0, gatewayAmount, walletBalance: balanceBefore };
        return;
      }

      const updatedWallet = await Wallet.findOneAndUpdate(
        { _id: wallet._id, balance: balanceBefore, status: 'active' },
        { $inc: { balance: -appliedAmount } },
        { returnDocument: 'after', session, runValidators: true }
      );
      if (!updatedWallet) throw new Error('Số dư ví vừa thay đổi, vui lòng thử lại');

      const [transaction] = await WalletTransaction.create([{
        walletId: wallet._id,
        userId,
        bookingId,
        type: 'DEBIT_BOOKING_PAYMENT',
        amount: -appliedAmount,
        balanceBefore,
        balanceAfter: balanceBefore - appliedAmount,
        referenceType: 'booking_payment',
        referenceId: payment._id,
        description: `Thanh toán booking #${String(bookingId).slice(-8).toUpperCase()} bằng Ví BookEat`,
        status: 'completed',
        idempotencyKey: `BOOKING_PAYMENT:${payment._id}`,
      }], { session });

      payment.walletAmountApplied = appliedAmount;
      payment.gatewayAmount = gatewayAmount;
      payment.walletTransactionId = transaction._id;
      await payment.save({ session });
      result = { appliedAmount, gatewayAmount, walletBalance: updatedWallet.balance };
    });
    return result;
  } finally {
    await session.endSession();
  }
};

const reverseWalletBookingPayment = async (paymentId, reason = 'Payment không hoàn tất') => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const payment = await Payment.findById(paymentId).session(session);
      if (!payment || payment.walletAmountApplied <= 0 || payment.walletReleasedAt) return;
      const existing = await WalletTransaction.findOne({ idempotencyKey: `BOOKING_PAYMENT_REVERSAL:${payment._id}` }).session(session);
      if (existing) {
        payment.walletReleasedAt = existing.createdAt || new Date();
        await payment.save({ session });
        return;
      }

      const wallet = await Wallet.findOne({ userId: payment.userId, status: 'active' }).session(session);
      if (!wallet) throw new Error('Không tìm thấy Ví BookEat để hoàn lại khoản đã giữ');
      const balanceBefore = wallet.balance;
      wallet.balance += payment.walletAmountApplied;
      await wallet.save({ session });
      await WalletTransaction.create([{
        walletId: wallet._id,
        userId: payment.userId,
        bookingId: payment.targetId,
        type: 'CREDIT_BOOKING_PAYMENT_REVERSAL',
        amount: payment.walletAmountApplied,
        balanceBefore,
        balanceAfter: wallet.balance,
        referenceType: 'booking_payment_reversal',
        referenceId: payment._id,
        description: reason,
        status: 'completed',
        idempotencyKey: `BOOKING_PAYMENT_REVERSAL:${payment._id}`,
      }], { session });
      payment.walletReleasedAt = new Date();
      await payment.save({ session });
    });
  } finally {
    await session.endSession();
  }
};

module.exports = { applyWalletToBookingPayment, reverseWalletBookingPayment };
