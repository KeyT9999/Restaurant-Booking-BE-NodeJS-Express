const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    // ─── References ───
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: [true, 'Mã đặt bàn là bắt buộc'],
      unique: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Mã người dùng là bắt buộc'],
      index: true,
    },
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: [true, 'Mã nhà hàng là bắt buộc'],
      index: true,
    },

    // ─── Review Content ───
    rating: {
      type: Number,
      required: [true, 'Điểm đánh giá là bắt buộc'],
      min: [1, 'Điểm đánh giá tối thiểu là 1 sao'],
      max: [5, 'Điểm đánh giá tối đa là 5 sao'],
      validate: {
        validator: Number.isInteger,
        message: 'Điểm đánh giá phải là số nguyên',
      },
    },
    title: {
      type: String,
      trim: true,
      maxlength: [200, 'Tiêu đề không được vượt quá 200 ký tự'],
      default: null,
    },
    comment: {
      type: String,
      required: [true, 'Nội dung đánh giá là bắt buộc'],
      trim: true,
      minlength: [10, 'Nội dung đánh giá phải có ít nhất 10 ký tự'],
      maxlength: [2000, 'Nội dung đánh giá không được vượt quá 2000 ký tự'],
    },

    // ─── Media ───
    images: [{
      type: String,
      trim: true,
    }],

    // ─── Helpful ───
    helpfulUsers: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    }],
    helpfulCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // ─── Report ───
    reportedBy: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    }],
    reportCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // ─── Owner Reply ───
    ownerReply: {
      comment: {
        type: String,
        trim: true,
        minlength: [5, 'Nội dung phản hồi phải có ít nhất 5 ký tự'],
        maxlength: [500, 'Nội dung phản hồi không được vượt quá 500 ký tự'],
        default: null,
      },
      content: {
        type: String,
        trim: true,
        minlength: [5, 'Nội dung phản hồi phải có ít nhất 5 ký tự'],
        maxlength: [500, 'Nội dung phản hồi không được vượt quá 500 ký tự'],
        default: null,
      },
      repliedAt: {
        type: Date,
        default: null,
      },
      repliedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
      },
    },

    // ─── Moderation ───
    isEdited: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ['approved', 'reported', 'hidden'],
      default: 'approved',
      index: true,
    },
    hiddenBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    hiddenAt: {
      type: Date,
      default: null,
    },
    hideReason: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// ─── Indexes ───
reviewSchema.index({ restaurantId: 1, createdAt: -1 });
reviewSchema.index({ userId: 1, createdAt: -1 });
reviewSchema.index({ restaurantId: 1, status: 1 });
reviewSchema.index({ reportCount: -1 });

// ─── Method: Public JSON ───
reviewSchema.methods.toPublicJSON = function () {
  return {
    id: this._id.toString(),
    userId: this.userId,
    restaurantId: this.restaurantId,
    bookingId: this.bookingId,
    rating: this.rating,
    title: this.title,
    comment: this.comment,
    images: this.images,
    helpfulCount: this.helpfulCount,
    ownerReply: (this.ownerReply?.comment || this.ownerReply?.content) ? {
      comment: this.ownerReply.comment || this.ownerReply.content,
      content: this.ownerReply.content || this.ownerReply.comment,
      repliedAt: this.ownerReply.repliedAt,
    } : null,
    isEdited: this.isEdited || false,
    status: this.status,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

// ─── Method: Admin JSON ───
reviewSchema.methods.toAdminJSON = function () {
  return {
    id: this._id.toString(),
    userId: this.userId,
    restaurantId: this.restaurantId,
    bookingId: this.bookingId,
    rating: this.rating,
    title: this.title,
    comment: this.comment,
    images: this.images,
    helpfulUsers: this.helpfulUsers,
    helpfulCount: this.helpfulCount,
    reportedBy: this.reportedBy,
    reportCount: this.reportCount,
    ownerReply: this.ownerReply,
    isEdited: this.isEdited || false,
    status: this.status,
    hiddenBy: this.hiddenBy,
    hiddenAt: this.hiddenAt,
    hideReason: this.hideReason,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model('Review', reviewSchema);
