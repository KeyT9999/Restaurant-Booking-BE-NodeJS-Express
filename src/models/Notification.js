const mongoose = require('mongoose');

const relatedEntitySchema = new mongoose.Schema(
  {
    entityType: {
      type: String,
      enum: [
        'booking',
        'payment',
        'refund',
        'voucher',
        'chat',
        'restaurant',
        'waitlist',
        'withdrawal',
        'system',
      ],
      default: 'system',
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { _id: false }
);

const notificationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        'booking_created',
        'booking_confirmed',
        'booking_cancelled',
        'booking_completed',
        'booking_no_show',
        'booking_reminder',
        'payment_success',
        'payment_failed',
        'refund_requested',
        'refund_approved',
        'refund_rejected',
        'refund_processed',
        'voucher_new',
        'voucher_expiring',
        'chat_new_message',
        'system_alert',
        'admin_action',
        'waitlist_created',
        'waitlist_updated',
        'withdrawal_created',
        'withdrawal_updated',
      ],
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    recipientRole: {
      type: String,
      enum: ['customer', 'restaurant_owner', 'admin'],
      required: true,
      index: true,
    },
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      default: null,
      index: true,
    },
    relatedEntity: {
      type: relatedEntitySchema,
      default: () => ({ entityType: 'system', entityId: null, metadata: {} }),
    },
    actionUrl: {
      type: String,
      default: null,
      trim: true,
      maxlength: 500,
    },
    status: {
      type: String,
      enum: ['unread', 'read'],
      default: 'unread',
      index: true,
    },
    readAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    sourceKey: {
      type: String,
      default: undefined,
      trim: true,
      index: true,
      unique: true,
      sparse: true,
    },
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

notificationSchema.index({ recipientId: 1, status: 1, createdAt: -1 });
notificationSchema.index({ recipientRole: 1, status: 1, createdAt: -1 });
notificationSchema.index({ restaurantId: 1, status: 1, createdAt: -1 });
notificationSchema.index({ createdAt: -1 });

notificationSchema.methods.toClientJSON = function () {
  return {
    id: this._id.toString(),
    type: this.type,
    title: this.title,
    message: this.message,
    recipientId: this.recipientId ? this.recipientId.toString() : null,
    recipientRole: this.recipientRole,
    restaurantId: this.restaurantId ? this.restaurantId.toString() : null,
    relatedEntity: {
      entityType: this.relatedEntity?.entityType || 'system',
      entityId: this.relatedEntity?.entityId ? this.relatedEntity.entityId.toString() : null,
      metadata: this.relatedEntity?.metadata || {},
    },
    actionUrl: this.actionUrl,
    status: this.status,
    readAt: this.readAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model('Notification', notificationSchema);
