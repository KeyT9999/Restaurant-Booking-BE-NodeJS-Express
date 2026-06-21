const mongoose = require('mongoose');

const restaurantActivityLogSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: [true, 'Restaurant ID là bắt buộc'],
      index: true,
    },
    action: {
      type: String,
      required: [true, 'Action là bắt buộc'],
      enum: [
        'created',
        'approved',
        'rejected',
        'suspended',
        'unsuspended',
        'updated',
        'deleted',
        'restored',
        'featured',
        'unfeatured',
        'booking_created',
        'booking_confirmed',
        'booking_cancelled',
        'booking_completed',
        'booking_no_show',
      ],
      index: true,
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Người thực hiện là bắt buộc'],
      index: true,
    },
    performedByRole: {
      type: String,
      required: [true, 'Vai trò người thực hiện là bắt buộc'],
      enum: ['admin', 'restaurant_owner'],
    },
    reason: {
      type: String,
      default: null,
      trim: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
restaurantActivityLogSchema.index({ restaurantId: 1, createdAt: -1 });

module.exports = mongoose.model('RestaurantActivityLog', restaurantActivityLogSchema);
