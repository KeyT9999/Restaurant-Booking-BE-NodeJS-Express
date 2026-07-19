const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    // ─── Người thanh toán ───
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID là bắt buộc'],
      index: true,
    },

    // ─── Loại thanh toán ───
    targetType: {
      type: String,
      enum: [
        'subscription',
        'booking',
        'featured_restaurant',
        'voucher_campaign',
        'booking_fee',
        'deposit_platform_fee',
      ],
      required: [true, 'Loại thanh toán là bắt buộc'],
      index: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, 'Target ID là bắt buộc'],
    },

    // ─── Liên kết nhanh (denormalized) ───
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      default: null,
    },

    // ─── Số tiền ───
    amount: {
      type: Number,
      required: [true, 'Số tiền là bắt buộc'],
      min: [1000, 'Số tiền tối thiểu là 1,000 VNĐ'],
    },
    currency: {
      type: String,
      default: 'VND',
    },
    voucherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Voucher',
      default: null,
    },
    discountApplied: {
      type: Number,
      default: 0,
      min: [0, 'Số tiền giảm giá không thể âm'],
    },
    amountBeforeDiscount: {
      type: Number,
      default: 0,
      min: [0, 'Số tiền trước giảm giá không thể âm'],
    },
    walletAmountApplied: {
      type: Number,
      default: 0,
      min: 0,
    },
    gatewayAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    walletTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WalletTransaction',
      default: null,
    },
    walletReleasedAt: {
      type: Date,
      default: null,
    },

    // ─── Trạng thái ───
    status: {
      type: String,
      enum: ['pending', 'processing', 'paid', 'failed', 'cancelled', 'expired', 'refunded', 'partially_refunded'],
      default: 'pending',
      index: true,
    },

    // ─── Cổng thanh toán ───
    gateway: {
      type: String,
      default: 'payos',
    },

    // ─── PayOS fields ───
    orderCode: {
      type: Number,
      required: [true, 'Order code là bắt buộc'],
      unique: true,
      index: true,
    },
    paymentLinkId: {
      type: String,
      default: null,
    },
    checkoutUrl: {
      type: String,
      default: null,
    },
    qrCode: {
      type: String,
      default: null,
    },

    // ─── Mô tả ───
    description: {
      type: String,
      default: null,
    },

    // ─── Metadata bổ sung ───
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // ─── Thời gian ───
    paidAt: {
      type: Date,
      default: null,
    },
    expiredAt: {
      type: Date,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// ─── Indexes ───
paymentSchema.index({ userId: 1, status: 1 });
paymentSchema.index({ targetType: 1, targetId: 1 });
paymentSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Payment', paymentSchema);
