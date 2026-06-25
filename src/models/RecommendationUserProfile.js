'use strict';

const mongoose = require('mongoose');

const restaurantHistorySchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: true,
    },
    score: {
      type: Number,
      required: true,
      default: 0,
    },
    lastInteractionAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

const recommendationUserProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    coldStartLevel: {
      type: String,
      enum: ['none', 'light', 'rich'],
      default: 'none',
    },
    cuisineAffinity: {
      type: Map,
      of: Number,
      default: {},
    },
    menuTagAffinity: {
      type: Map,
      of: Number,
      default: {},
    },
    categoryAffinity: {
      type: Map,
      of: Number,
      default: {},
    },
    priceBucketAffinity: {
      type: Map,
      of: Number,
      default: {},
    },
    timeSlotAffinity: {
      type: Map,
      of: Number,
      default: {},
    },
    weekdayAffinity: {
      type: Map,
      of: Number,
      default: {},
    },
    groupSizeAffinity: {
      type: Map,
      of: Number,
      default: {},
    },
    occasionAffinity: {
      type: Map,
      of: Number,
      default: {},
    },
    preferredCities: [{
      type: String,
      trim: true,
    }],
    preferredDistricts: [{
      type: String,
      trim: true,
    }],
    restaurantHistory: {
      type: [restaurantHistorySchema],
      default: [],
    },
    negativeRestaurantIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
    }],
    stats: {
      totalInteractions: {
        type: Number,
        default: 0,
      },
      positiveInteractions: {
        type: Number,
        default: 0,
      },
      negativeInteractions: {
        type: Number,
        default: 0,
      },
      completedBookingCount: {
        type: Number,
        default: 0,
      },
      favoriteCount: {
        type: Number,
        default: 0,
      },
      positiveReviewCount: {
        type: Number,
        default: 0,
      },
      negativeReviewCount: {
        type: Number,
        default: 0,
      },
      menuPreorderCount: {
        type: Number,
        default: 0,
      },
      averageSubmittedRating: {
        type: Number,
        default: 0,
      },
      distinctRestaurantCount: {
        type: Number,
        default: 0,
      },
      lastInteractionAt: {
        type: Date,
        default: null,
      },
    },
    profileVersion: {
      type: Number,
      default: 1,
    },
    generatedAt: {
      type: Date,
      default: Date.now,
    },
    lastBuiltAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

recommendationUserProfileSchema.index({ lastBuiltAt: -1 });

module.exports = mongoose.model('RecommendationUserProfile', recommendationUserProfileSchema);
