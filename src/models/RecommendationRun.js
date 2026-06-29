'use strict';

const mongoose = require('mongoose');

const recommendationRunSchema = new mongoose.Schema(
  {
    runType: {
      type: String,
      enum: ['full', 'incremental', 'evaluation'],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['running', 'success', 'failed'],
      required: true,
      index: true,
    },
    startedAt: {
      type: Date,
      required: true,
      index: true,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    datasetVersion: {
      type: Number,
      default: 1,
    },
    profileVersion: {
      type: Number,
      default: 1,
    },
    algorithmVersion: {
      type: String,
      default: 'phase2-dataset-builder-v1',
    },
    interactionsBuilt: {
      type: Number,
      default: 0,
    },
    userProfilesBuilt: {
      type: Number,
      default: 0,
    },
    itemProfilesBuilt: {
      type: Number,
      default: 0,
    },
    cacheInvalidated: {
      type: Number,
      default: 0,
    },
    metricsSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    errorSummary: {
      message: {
        type: String,
        default: null,
      },
      stack: {
        type: String,
        default: null,
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

recommendationRunSchema.index({ status: 1, startedAt: -1 });
recommendationRunSchema.index({ runType: 1, startedAt: -1 });

module.exports = mongoose.model('RecommendationRun', recommendationRunSchema);
