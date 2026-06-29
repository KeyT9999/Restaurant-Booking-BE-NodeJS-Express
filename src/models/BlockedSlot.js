'use strict';

const mongoose = require('mongoose');

const blockedSlotSchema = new mongoose.Schema(
  {
    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: [true, 'Restaurant ID là bắt buộc'],
      index: true,
    },
    date: {
      type: Date,
      required: [true, 'Ngày chặn là bắt buộc'],
      index: true,
    },
    slotType: {
      type: String,
      enum: ['full_day', 'time_range'],
      default: 'full_day',
    },
    startTime: {
      type: String, // format HH:mm (e.g., '14:00')
      default: null,
    },
    endTime: {
      type: String, // format HH:mm (e.g., '18:00')
      default: null,
    },
    tableNumbers: [{
      type: String,
      trim: true,
    }],
    reason: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
blockedSlotSchema.index({ restaurantId: 1, date: 1 });

module.exports = mongoose.model('BlockedSlot', blockedSlotSchema);
