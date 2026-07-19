'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const Booking = require('../../src/models/Booking');
const Voucher = require('../../src/models/Voucher');

const apply = process.argv.includes('--apply');
if (apply && !process.argv.includes('--confirm')) throw new Error('--apply yêu cầu --confirm');
const batchSize = Math.max(1, Number.parseInt(process.argv.find((v) => v.startsWith('--batch='))?.split('=')[1] || '100', 10));

const run = async () => {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGO_URI hoặc MONGODB_URI chưa được cấu hình');
  await mongoose.connect(mongoUri);
  const report = [];
  let lastId = null;
  while (true) {
    const rows = await Booking.find({
      ...(lastId ? { _id: { $gt: lastId } } : {}),
      voucherCode: { $type: 'string', $ne: '' },
    }).sort({ _id: 1 }).limit(batchSize).lean();
    if (!rows.length) break;
    for (const booking of rows) {
      lastId = booking._id;
      const base = { bookingId: booking._id, restaurantId: booking.restaurantId, voucherCode: booking.voucherCode };
      try {
        if (booking.voucherId) {
          report.push({ ...base, matchedVoucherId: booking.voucherId, matchStatus: 'already_linked' });
          continue;
        }
        if (!booking.restaurantId) { report.push({ ...base, matchStatus: 'invalid_data', reason: 'missing restaurantId' }); continue; }
        const matches = await Voucher.find({
          code: String(booking.voucherCode).trim().toUpperCase(),
          $or: [{ restaurantId: booking.restaurantId }, { applicableRestaurants: booking.restaurantId }],
        }).select('_id').limit(2).lean();
        if (matches.length === 0) { report.push({ ...base, matchStatus: 'not_found' }); continue; }
        if (matches.length > 1) { report.push({ ...base, matchStatus: 'ambiguous' }); continue; }
        if (apply) await Booking.updateOne({ _id: booking._id, voucherId: null }, { $set: { voucherId: matches[0]._id } });
        report.push({ ...base, matchedVoucherId: matches[0]._id, matchStatus: 'matched_unique', applied: apply });
      } catch (error) { report.push({ ...base, matchStatus: 'invalid_data', reason: error.message }); }
    }
  }
  const reportDir = path.resolve(__dirname, '../../../Task/backend-medium-fixes/reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const output = path.join(reportDir, `legacy-voucher-report-${Date.now()}.json`);
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', processed: report.length, output }, null, 2));
  await mongoose.disconnect();
};
run().catch(async (error) => { console.error(error); await mongoose.disconnect().catch(() => {}); process.exitCode = 1; });
