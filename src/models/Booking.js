const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema(
  {
    // ─── References ───
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Customer ID là bắt buộc'],
      index: true,
    },
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: [true, 'Restaurant ID là bắt buộc'],
      index: true,
    },

    // ─── Booking Details ───
    bookingDate: {
      type: Date,
      required: [true, 'Ngày đặt bàn là bắt buộc'],
      index: true,
    },
    bookingTime: {
      type: String,
      required: [true, 'Giờ đặt bàn là bắt buộc'],
      trim: true,
    },
    numberOfGuests: {
      type: Number,
      required: [true, 'Số lượng khách là bắt buộc'],
      min: [1, 'Số lượng khách phải ít nhất là 1'],
      max: [100, 'Số lượng khách không được vượt quá 100'],
    },

    // ─── Contact Information ───
    customerName: {
      type: String,
      required: [true, 'Tên khách hàng là bắt buộc'],
      trim: true,
    },
    customerPhone: {
      type: String,
      required: [true, 'Số điện thoại là bắt buộc'],
      trim: true,
    },
    customerEmail: {
      type: String,
      required: [true, 'Email là bắt buộc'],
      lowercase: true,
      trim: true,
    },

    // ─── Special Requests ───
    specialRequests: {
      type: String,
      default: null,
      trim: true,
      maxlength: [500, 'Yêu cầu đặc biệt không được vượt quá 500 ký tự'],
    },
    occasion: {
      type: String,
      enum: ['birthday', 'anniversary', 'business', 'date', 'family', 'other', null],
      default: null,
    },

    // ─── Status ───
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'],
      default: 'pending',
      index: true,
    },
    statusHistory: [{
      status: {
        type: String,
        enum: ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'],
      },
      changedAt: {
        type: Date,
        default: Date.now,
      },
      changedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
      },
      note: {
        type: String,
        default: null,
      },
    }],

    // ─── Cancellation ───
    cancellationReason: {
      type: String,
      default: null,
      trim: true,
    },
    cancelledBy: {
      type: String,
      enum: ['customer', 'restaurant', 'admin', null],
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },

    // ─── Payment ───
    depositAmount: {
      type: Number,
      default: 0,
      min: [0, 'Số tiền đặt cọc không thể âm'],
    },
    depositPaid: {
      type: Boolean,
      default: false,
    },
    depositPaidAt: {
      type: Date,
      default: null,
    },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      default: null,
    },
    sourceWaitlistId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Waitlist',
      default: null,
      index: true,
    },
    sourceAiPendingActionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AiPendingAction',
      default: null,
    },

    // ─── Confirmation ───
    confirmedAt: {
      type: Date,
      default: null,
    },
    confirmedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    // ─── Completion ───
    completedAt: {
      type: Date,
      default: null,
    },
    actualGuestCount: {
      type: Number,
      default: null,
      min: [0, 'Số lượng khách thực tế không thể âm'],
    },

    // ─── Table Assignment ───
    tableNumbers: [{
      type: String,
      trim: true,
    }],

    // ─── Notes (internal) ───
    internalNotes: {
      type: String,
      default: null,
      trim: true,
    },

    // ─── Voucher ───
    voucherCode: {
      type: String,
      default: null,
      trim: true,
    },
    voucherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Voucher',
      default: null,
    },
    discountAmount: {
      type: Number,
      default: 0,
      min: [0, 'Số tiền giảm giá không thể âm'],
    },
    originalAmount: {
      type: Number,
      default: 0,
      min: [0, 'Số tiền gốc không thể âm'],
    },
    finalAmount: {
      type: Number,
      default: 0,
      min: [0, 'Số tiền thanh toán cuối cùng không thể âm'],
    },

    // ─── Review ───
    reviewId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Review',
      default: null,
    },
    reviewed: {
      type: Boolean,
      default: false,
    },

    // ─── Check-in ───
    checkedInAt: {
      type: Date,
      default: null,
    },

    // ─── Pre-Order Items ───
    preOrderItems: [{
      menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem' },
      nameSnapshot: { type: String },
      priceSnapshot: { type: Number },
      quantity: { type: Number, default: 1, min: 1 },
      note: { type: String, default: null, trim: true },
    }],

    // ─── Reschedule History ───
    rescheduleHistory: [{
      fromDate: { type: Date },
      fromTime: { type: String },
      toDate: { type: Date },
      toTime: { type: String },
      rescheduledAt: { type: Date, default: Date.now },
      rescheduledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    }],

    // ─── Reminder ───
    reminderSent: {
      type: Boolean,
      default: false,
    },
    reminderSentAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// ─── Indexes ───
bookingSchema.index({ bookingDate: 1, bookingTime: 1 });
bookingSchema.index({ customerId: 1, status: 1 });
bookingSchema.index({ restaurantId: 1, status: 1 });
bookingSchema.index({ restaurantId: 1, bookingDate: 1, status: 1 });
bookingSchema.index({ status: 1, bookingDate: 1 });
bookingSchema.index({ customerPhone: 1, restaurantId: 1 });
bookingSchema.index({ voucherId: 1 });
bookingSchema.index({ createdAt: -1 });
bookingSchema.index(
  { sourceAiPendingActionId: 1 },
  {
    unique: true,
    partialFilterExpression: { sourceAiPendingActionId: { $type: 'objectId' } },
  },
);

// ─── Virtual: Is Upcoming ───
bookingSchema.virtual('isUpcoming').get(function () {
  return this.bookingDate > new Date() && ['pending', 'confirmed'].includes(this.status);
});

// ─── Virtual: Is Past ───
bookingSchema.virtual('isPast').get(function () {
  return this.bookingDate < new Date();
});

// ─── Method: Can Cancel ───
bookingSchema.methods.canCancel = function () {
  // Can cancel if status is pending or confirmed and booking is in the future
  const now = new Date();
  const bookingDateTime = new Date(this.bookingDate);
  return ['pending', 'confirmed'].includes(this.status) && bookingDateTime > now;
};

// ─── Method: Can Complete ───
bookingSchema.methods.canComplete = function () {
  return this.status === 'confirmed';
};

// ─── Method: Public JSON ───
bookingSchema.methods.toPublicJSON = function () {
  return {
    id: this._id.toString(),
    customerId: this.customerId,
    restaurantId: this.restaurantId,
    bookingDate: this.bookingDate,
    bookingTime: this.bookingTime,
    numberOfGuests: this.numberOfGuests,
    customerName: this.customerName,
    customerPhone: this.customerPhone,
    customerEmail: this.customerEmail,
    specialRequests: this.specialRequests,
    occasion: this.occasion,
    status: this.status,
    depositAmount: this.depositAmount,
    depositPaid: this.depositPaid,
    voucherCode: this.voucherCode,
    voucherId: this.voucherId,
    discountAmount: this.discountAmount,
    originalAmount: this.originalAmount,
    finalAmount: this.finalAmount,
    sourceWaitlistId: this.sourceWaitlistId,
    tableNumbers: this.tableNumbers,
    reviewed: this.reviewed,
    checkedInAt: this.checkedInAt,
    preOrderItems: this.preOrderItems,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

// ─── Method: Admin JSON ───
bookingSchema.methods.toAdminJSON = function () {
  return {
    id: this._id.toString(),
    customerId: this.customerId,
    restaurantId: this.restaurantId,
    bookingDate: this.bookingDate,
    bookingTime: this.bookingTime,
    numberOfGuests: this.numberOfGuests,
    customerName: this.customerName,
    customerPhone: this.customerPhone,
    customerEmail: this.customerEmail,
    specialRequests: this.specialRequests,
    occasion: this.occasion,
    status: this.status,
    statusHistory: this.statusHistory,
    cancellationReason: this.cancellationReason,
    cancelledBy: this.cancelledBy,
    cancelledAt: this.cancelledAt,
    depositAmount: this.depositAmount,
    depositPaid: this.depositPaid,
    depositPaidAt: this.depositPaidAt,
    paymentId: this.paymentId,
    sourceWaitlistId: this.sourceWaitlistId,
    confirmedAt: this.confirmedAt,
    confirmedBy: this.confirmedBy,
    completedAt: this.completedAt,
    actualGuestCount: this.actualGuestCount,
    tableNumbers: this.tableNumbers,
    internalNotes: this.internalNotes,
    voucherCode: this.voucherCode,
    voucherId: this.voucherId,
    discountAmount: this.discountAmount,
    originalAmount: this.originalAmount,
    finalAmount: this.finalAmount,
    reviewId: this.reviewId,
    reviewed: this.reviewed,
    reminderSent: this.reminderSent,
    reminderSentAt: this.reminderSentAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model('Booking', bookingSchema);
