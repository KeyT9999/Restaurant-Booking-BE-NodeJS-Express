'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const Restaurant = require('../../src/models/Restaurant');
const WithdrawalRequest = require('../../src/models/WithdrawalRequest');

const apply = process.argv.includes('--apply');
if (apply && !process.argv.includes('--confirm')) throw new Error('--apply yêu cầu --confirm');
const batchSize = Math.max(
  1,
  Number.parseInt(process.argv.find((value) => value.startsWith('--batch='))?.split('=')[1] || '100', 10),
);

const run = async () => {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGO_URI hoặc MONGODB_URI chưa được cấu hình');
  await mongoose.connect(mongoUri);

  const report = [];
  let lastId = null;
  while (true) {
    const restaurants = await Restaurant.find({
      availableBalance: null,
      ...(lastId ? { _id: { $gt: lastId } } : {}),
    }).select('_id balance').sort({ _id: 1 }).limit(batchSize).lean();
    if (!restaurants.length) break;

    for (const restaurant of restaurants) {
      lastId = restaurant._id;
      try {
        const active = await WithdrawalRequest.aggregate([
          { $match: { restaurantId: restaurant._id, status: { $in: ['pending', 'approved', 'processing'] } } },
          { $group: { _id: null, total: { $sum: '$amount' }, ids: { $push: '$_id' } } },
        ]);
        const pending = Number(active[0]?.total || 0);
        const legacyBalance = Number(restaurant.balance || 0);
        const available = legacyBalance - pending;
        const entry = {
          restaurantId: restaurant._id,
          legacyBalance,
          pending,
          available,
          status: available >= 0 ? 'ready' : 'conflict_negative',
        };
        report.push(entry);

        if (apply && available >= 0) {
          const session = await mongoose.startSession();
          try {
            await session.withTransaction(async () => {
              await Restaurant.updateOne(
                { _id: restaurant._id, availableBalance: null },
                { $set: { availableBalance: available, balance: available, pendingWithdrawalBalance: pending } },
                { session },
              );
              if (active[0]?.ids?.length) {
                await WithdrawalRequest.updateMany(
                  { _id: { $in: active[0].ids }, balanceHeldAt: null },
                  { $set: { balanceHeldAt: new Date() } },
                  { session },
                );
              }
            });
          } finally {
            await session.endSession();
          }
        }
      } catch (error) {
        report.push({ restaurantId: restaurant._id, status: 'error', reason: error.message });
      }
    }
  }

  const reportDir = path.resolve(__dirname, '../../../Task/backend-medium-fixes/reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const output = path.join(reportDir, `withdrawal-balance-report-${Date.now()}.json`);
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', processed: report.length, output }, null, 2));
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
