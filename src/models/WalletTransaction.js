const mongoose = require('mongoose');

const walletTransactionSchema = new mongoose.Schema(
  {
    walletId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Wallet',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
      index: true,
    },
    type: {
      type: String,
      enum: [
        'CREDIT_BOOKING_REFUND',
        'DEBIT_BOOKING_PAYMENT',
        'CREDIT_BOOKING_PAYMENT_REVERSAL',
        'CREDIT_ADMIN_ADJUSTMENT',
        'DEBIT_ADMIN_ADJUSTMENT',
      ],
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      validate: {
        validator: (value) => Number.isSafeInteger(value) && value !== 0,
        message: 'Giá trị giao dịch ví phải là số nguyên VND khác 0',
      },
    },
    balanceBefore: {
      type: Number,
      required: true,
      min: 0,
    },
    balanceAfter: {
      type: Number,
      required: true,
      min: 0,
    },
    referenceType: {
      type: String,
      enum: ['booking_cancellation', 'booking_payment', 'booking_payment_reversal', 'admin_adjustment'],
      required: true,
    },
    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    status: {
      type: String,
      enum: ['completed', 'reversed'],
      default: 'completed',
      index: true,
    },
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

walletTransactionSchema.index({ userId: 1, createdAt: -1 });
walletTransactionSchema.index({ bookingId: 1, type: 1 });

module.exports = mongoose.model('WalletTransaction', walletTransactionSchema);
