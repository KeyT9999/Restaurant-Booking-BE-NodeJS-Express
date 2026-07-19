'use strict';

const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  withdrawalId: { type: mongoose.Schema.Types.ObjectId, ref: 'WithdrawalRequest', required: true },
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true },
  type: { type: String, enum: ['hold', 'release', 'complete'], required: true },
  amount: { type: Number, required: true, min: 0 },
  availableBalanceAfter: { type: Number, required: true, min: 0 },
  pendingBalanceAfter: { type: Number, required: true, min: 0 },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

schema.index({ withdrawalId: 1, type: 1 }, { unique: true });
schema.index({ restaurantId: 1, createdAt: -1 });

module.exports = mongoose.model('WithdrawalLedger', schema);
