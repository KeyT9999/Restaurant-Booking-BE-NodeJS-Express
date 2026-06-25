'use strict';

const mongoose = require('mongoose');

const recommendationInteractionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    itemType: {
      type: String,
      enum: ['restaurant', 'menu_item'],
      required: true,
      index: true,
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: true,
      index: true,
    },
    source: {
      type: String,
      enum: ['booking', 'review', 'favorite', 'menu_preorder'],
      required: true,
      index: true,
    },
    sourceId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      enum: [
        'booking_completed',
        'booking_cancelled',
        'booking_no_show',
        'review_positive',
        'review_neutral',
        'review_negative',
        'favorite_added',
        'menu_preordered',
      ],
      required: true,
      index: true,
    },
    signalClass: {
      type: String,
      enum: ['implicit', 'explicit', 'feedback', 'negative'],
      required: true,
    },
    weight: {
      type: Number,
      required: true,
    },
    rawValue: {
      type: Number,
      default: null,
    },
    quantity: {
      type: Number,
      default: null,
      min: 1,
    },
    rating: {
      type: Number,
      default: null,
      min: 1,
      max: 5,
    },
    bookingStatus: {
      type: String,
      enum: ['pending', 'confirmed', 'completed', 'cancelled', 'no_show', null],
      default: null,
    },
    occurredAt: {
      type: Date,
      required: true,
      index: true,
    },
    context: {
      bookingDate: {
        type: Date,
        default: null,
      },
      bookingTime: {
        type: String,
        default: null,
      },
      dayOfWeek: {
        type: String,
        enum: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', null],
        default: null,
      },
      hourOfDay: {
        type: Number,
        default: null,
        min: 0,
        max: 23,
      },
      numberOfGuests: {
        type: Number,
        default: null,
        min: 1,
      },
      occasion: {
        type: String,
        default: null,
      },
      priceRange: {
        type: String,
        default: null,
      },
      cuisineTypes: [{
        type: String,
        trim: true,
      }],
      menuCategories: [{
        type: String,
        trim: true,
      }],
      menuTags: [{
        type: String,
        trim: true,
      }],
      city: {
        type: String,
        default: null,
        trim: true,
      },
      district: {
        type: String,
        default: null,
        trim: true,
      },
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

recommendationInteractionSchema.index(
  { source: 1, sourceId: 1, itemType: 1, itemId: 1 },
  { unique: true }
);
recommendationInteractionSchema.index({ userId: 1, occurredAt: -1 });
recommendationInteractionSchema.index({ userId: 1, itemType: 1, itemId: 1 });
recommendationInteractionSchema.index({ itemType: 1, itemId: 1, occurredAt: -1 });
recommendationInteractionSchema.index({ restaurantId: 1, occurredAt: -1 });

module.exports = mongoose.model('RecommendationInteraction', recommendationInteractionSchema);
