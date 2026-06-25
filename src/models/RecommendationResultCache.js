'use strict';

const mongoose = require('mongoose');

const recommendationCacheItemSchema = new mongoose.Schema(
  {
    itemType: {
      type: String,
      enum: ['restaurant', 'menu_item'],
      required: true,
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      default: null,
    },
    score: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const recommendationResultCacheSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    surface: {
      type: String,
      enum: ['home', 'restaurants', 'menu_items', 'chatbot'],
      required: true,
      index: true,
    },
    recommendationType: {
      type: String,
      enum: ['restaurant', 'menu_item', 'mixed'],
      required: true,
      index: true,
    },
    contextHash: {
      type: String,
      required: true,
      default: 'default',
    },
    items: {
      type: [recommendationCacheItemSchema],
      default: [],
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    reasons: [{
      type: String,
      trim: true,
    }],
    fallbackUsed: {
      type: Boolean,
      default: false,
    },
    algorithmVersion: {
      type: String,
      default: 'phase2-dataset-builder-v1',
    },
    generatedAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

recommendationResultCacheSchema.index(
  { userId: 1, surface: 1, recommendationType: 1, contextHash: 1 },
  { name: 'recommendation_cache_lookup' }
);
recommendationResultCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
recommendationResultCacheSchema.index({ 'items.itemId': 1 });
recommendationResultCacheSchema.index({ 'items.restaurantId': 1 });

module.exports = mongoose.model('RecommendationResultCache', recommendationResultCacheSchema);
