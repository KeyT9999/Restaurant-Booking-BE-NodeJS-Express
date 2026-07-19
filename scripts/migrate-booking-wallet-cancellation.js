'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const Booking = require('../src/models/Booking');
const Payment = require('../src/models/Payment');
const Refund = require('../src/models/Refund');
const Wallet = require('../src/models/Wallet');
const WalletTransaction = require('../src/models/WalletTransaction');

async function migrate() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGO_URI hoặc MONGODB_URI chưa được cấu hình');
  await mongoose.connect(mongoUri);

  await Promise.all([
    Booking.createIndexes(),
    Payment.createIndexes(),
    Refund.createIndexes(),
    Wallet.createIndexes(),
    WalletTransaction.createIndexes(),
  ]);

  const paymentResult = await Payment.updateMany(
    { gatewayAmount: { $exists: false } },
    [{ $set: { gatewayAmount: '$amount', walletAmountApplied: 0 } }]
  );

  console.log(JSON.stringify({
    migration: 'booking-wallet-cancellation',
    matchedPayments: paymentResult.matchedCount,
    updatedPayments: paymentResult.modifiedCount,
  }, null, 2));
}

migrate()
  .then(() => mongoose.disconnect())
  .catch(async (error) => {
    console.error(error);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
  });
