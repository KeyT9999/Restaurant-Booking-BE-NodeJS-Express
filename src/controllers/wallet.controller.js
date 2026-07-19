'use strict';

const Wallet = require('../models/Wallet');
const WalletTransaction = require('../models/WalletTransaction');

const serializeTransaction = (transaction) => ({
  id: transaction._id.toString(),
  bookingId: transaction.bookingId,
  type: transaction.type,
  amount: transaction.amount,
  balanceBefore: transaction.balanceBefore,
  balanceAfter: transaction.balanceAfter,
  referenceType: transaction.referenceType,
  referenceId: transaction.referenceId,
  description: transaction.description,
  status: transaction.status,
  metadata: transaction.metadata || {},
  createdAt: transaction.createdAt,
});

exports.getMyWallet = async (req, res) => {
  try {
    const wallet = await Wallet.findOne({ userId: req.user._id });
    return res.json({
      success: true,
      data: {
        wallet: wallet ? {
          id: wallet._id.toString(),
          balance: wallet.balance,
          status: wallet.status,
          createdAt: wallet.createdAt,
          updatedAt: wallet.updatedAt,
        } : {
          id: null,
          balance: 0,
          status: 'active',
          createdAt: null,
          updatedAt: null,
        },
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Không thể tải Ví BookEat.' });
  }
};

exports.getMyTransactions = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const filter = { userId: req.user._id };
    if (req.query.type) filter.type = req.query.type;

    const [transactions, total] = await Promise.all([
      WalletTransaction.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      WalletTransaction.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: {
        transactions: transactions.map(serializeTransaction),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Không thể tải lịch sử Ví BookEat.' });
  }
};
