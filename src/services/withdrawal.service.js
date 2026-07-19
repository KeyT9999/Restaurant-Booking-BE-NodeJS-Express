'use strict';

const mongoose = require('mongoose');
const Restaurant = require('../models/Restaurant');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const WithdrawalLedger = require('../models/WithdrawalLedger');

class WithdrawalError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message); this.name = 'WithdrawalError'; this.code = code; this.statusCode = statusCode;
  }
}

const createWithdrawal = async ({ ownerId, restaurantId, amount, bankInfo, note, idempotencyKey }) => {
  if (idempotencyKey) {
    const existing = await WithdrawalRequest.findOne({ ownerId, idempotencyKey });
    if (existing) return { withdrawal: existing, created: false };
  }
  const session = await mongoose.startSession();
  try {
    let withdrawal;
    await session.withTransaction(async () => {
      const availableExpression = { $ifNull: ['$availableBalance', '$balance'] };
      const restaurant = await Restaurant.findOneAndUpdate(
        { _id: restaurantId, ownerId, $expr: { $gte: [availableExpression, amount] } },
        [{ $set: {
          availableBalance: { $subtract: [availableExpression, amount] },
          balance: { $subtract: [availableExpression, amount] },
          pendingWithdrawalBalance: { $add: [{ $ifNull: ['$pendingWithdrawalBalance', 0] }, amount] },
        } }],
        { new: true, session, updatePipeline: true },
      );
      if (!restaurant) throw new WithdrawalError('INSUFFICIENT_AVAILABLE_BALANCE', 'Số dư khả dụng không đủ hoặc nhà hàng không thuộc quyền sở hữu.', 409);
      [withdrawal] = await WithdrawalRequest.create([{
        ownerId, restaurantId, amount, bankInfo, note: note || null,
        status: 'pending', idempotencyKey: idempotencyKey || null, balanceHeldAt: new Date(),
      }], { session });
      await WithdrawalLedger.create([{
        withdrawalId: withdrawal._id, restaurantId, type: 'hold', amount,
        availableBalanceAfter: restaurant.availableBalance,
        pendingBalanceAfter: restaurant.pendingWithdrawalBalance,
        actorId: ownerId,
      }], { session });
    });
    return { withdrawal, created: true };
  } catch (error) {
    if (error?.code === 11000 && idempotencyKey) {
      const existing = await WithdrawalRequest.findOne({ ownerId, idempotencyKey });
      if (existing) return { withdrawal: existing, created: false };
    }
    throw error;
  } finally { await session.endSession(); }
};

const transition = async ({ withdrawalId, expectedStatuses, nextStatus, actorId, adminNote, proofImage, releaseFunds = false }) => {
  const session = await mongoose.startSession();
  try {
    let withdrawal;
    await session.withTransaction(async () => {
      withdrawal = await WithdrawalRequest.findOneAndUpdate(
        { _id: withdrawalId, status: { $in: expectedStatuses }, balanceReleasedAt: null },
        { $set: {
          status: nextStatus, reviewedBy: actorId, reviewedAt: new Date(),
          ...(adminNote !== undefined ? { adminNote } : {}),
          ...(proofImage ? { proofImage } : {}),
          ...(nextStatus === 'completed' ? { completedAt: new Date() } : {}),
          ...(['completed', 'rejected', 'cancelled', 'failed'].includes(nextStatus) ? { balanceReleasedAt: new Date() } : {}),
        } },
        { new: true, session },
      );
      if (!withdrawal) throw new WithdrawalError('INVALID_WITHDRAWAL_TRANSITION', 'Yêu cầu đã được xử lý hoặc trạng thái không hợp lệ.', 409);

      if (['completed', 'rejected', 'cancelled', 'failed'].includes(nextStatus)) {
        const pendingDelta = -withdrawal.amount;
        const availableDelta = releaseFunds ? withdrawal.amount : 0;
        const restaurant = await Restaurant.findOneAndUpdate(
          { _id: withdrawal.restaurantId, pendingWithdrawalBalance: { $gte: withdrawal.amount } },
          { $inc: { pendingWithdrawalBalance: pendingDelta, availableBalance: availableDelta, balance: availableDelta } },
          { new: true, session },
        );
        if (!restaurant) throw new WithdrawalError('WITHDRAWAL_BALANCE_INCONSISTENT', 'Số dư giữ rút tiền không nhất quán.', 409);
        await WithdrawalLedger.create([{
          withdrawalId: withdrawal._id, restaurantId: withdrawal.restaurantId,
          type: releaseFunds ? 'release' : 'complete', amount: withdrawal.amount,
          availableBalanceAfter: restaurant.availableBalance,
          pendingBalanceAfter: restaurant.pendingWithdrawalBalance,
          actorId,
        }], { session });
      }
    });
    return withdrawal;
  } finally { await session.endSession(); }
};

module.exports = { WithdrawalError, createWithdrawal, transition };
