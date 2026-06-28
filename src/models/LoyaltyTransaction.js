const mongoose = require('mongoose');

const loyaltyTransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID là bắt buộc'],
      index: true,
    },
    points: {
      type: Number,
      required: [true, 'Số điểm/xu là bắt buộc'],
    },
    type: {
      type: String,
      enum: ['earn_deposit', 'earn_completed', 'redeem_deposit', 'refund', 'admin_adjust'],
      required: [true, 'Loại giao dịch là bắt buộc'],
    },
    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    description: {
      type: String,
      required: [true, 'Mô tả giao dịch là bắt buộc'],
      trim: true,
    },
    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },
    isExpired: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

loyaltyTransactionSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('LoyaltyTransaction', loyaltyTransactionSchema);
