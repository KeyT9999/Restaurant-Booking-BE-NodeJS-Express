'use strict';

const mongoose = require('mongoose');

const recommendationItemProfileSchema = new mongoose.Schema(
  {
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
    name: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    isAvailable: {
      type: Boolean,
      default: true,
      index: true,
    },
    approvalStatus: {
      type: String,
      default: null,
    },
    cuisineTypes: [{
      type: String,
      trim: true,
    }],
    tags: [{
      type: String,
      trim: true,
    }],
    menuTags: [{
      type: String,
      trim: true,
    }],
    categoryName: {
      type: String,
      default: null,
      trim: true,
    },
    menuCategory: {
      type: String,
      default: null,
      trim: true,
    },
    priceBucket: {
      type: String,
      default: null,
    },
    priceRange: {
      type: String,
      default: null,
    },
    price: {
      type: Number,
      default: null,
    },
    averagePrice: {
      type: Number,
      default: null,
    },
    ratingAverage: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    ratingScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 1,
    },
    reviewCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    bookingCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    favoriteCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    preorderCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    popularityScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 1,
    },
    qualityScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 1,
    },
    voucherActive: {
      type: Boolean,
      default: false,
    },
    featuredBoostEligible: {
      type: Boolean,
      default: false,
    },
    location: {
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
      coordinates: {
        latitude: {
          type: Number,
          default: null,
        },
        longitude: {
          type: Number,
          default: null,
        },
      },
    },
    featureVector: {
      tokens: [{
        type: String,
        trim: true,
      }],
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
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
    },
  },
  {
    timestamps: true,
  }
);

recommendationItemProfileSchema.index({ itemType: 1, itemId: 1 }, { unique: true });
recommendationItemProfileSchema.index({ restaurantId: 1, itemType: 1 });
recommendationItemProfileSchema.index({ itemType: 1, isActive: 1, isAvailable: 1 });

module.exports = mongoose.model('RecommendationItemProfile', recommendationItemProfileSchema);
