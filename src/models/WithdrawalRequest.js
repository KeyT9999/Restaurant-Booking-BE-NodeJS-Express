const mongoose = require('mongoose');

const withdrawalRequestSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Owner ID là bắt buộc'],
      index: true,
    },
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: [true, 'Restaurant ID là bắt buộc'],
      index: true,
    },
    amount: {
      type: Number,
      required: [true, 'Số tiền rút là bắt buộc'],
      min: [10000, 'Số tiền rút tối thiểu là 10,000 VNĐ'],
    },
    bankInfo: {
      bankName: {
        type: String,
        required: [true, 'Tên ngân hàng là bắt buộc'],
      },
      accountNumber: {
        type: String,
        required: [true, 'Số tài khoản là bắt buộc'],
      },
      accountHolder: {
        type: String,
        required: [true, 'Tên chủ tài khoản là bắt buộc'],
      },
    },
    note: {
      type: String,
      default: null,
      trim: true,
    },
    proofImage: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'processing', 'completed', 'rejected', 'cancelled', 'failed'],
      default: 'pending',
      index: true,
    },
    adminNote: {
      type: String,
      default: null,
      trim: true,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    idempotencyKey: { type: String, default: null },
    balanceHeldAt: { type: Date, default: null },
    balanceReleasedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  }
);

withdrawalRequestSchema.index({ ownerId: 1, status: 1 });
withdrawalRequestSchema.index({ restaurantId: 1, status: 1 });
withdrawalRequestSchema.index({ status: 1, createdAt: -1 });
withdrawalRequestSchema.index(
  { ownerId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);

module.exports = mongoose.model('WithdrawalRequest', withdrawalRequestSchema);
