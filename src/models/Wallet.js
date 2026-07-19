const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    balance: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isSafeInteger,
        message: 'Số dư ví phải là số nguyên VND an toàn',
      },
    },
    status: {
      type: String,
      enum: ['active', 'frozen', 'closed'],
      default: 'active',
      index: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Wallet', walletSchema);
