'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const Booking = require('../../src/models/Booking');
const TableReservation = require('../../src/models/TableReservation');
const bookingService = require('../../src/services/booking.service');

const apply = process.argv.includes('--apply');
const confirmed = process.argv.includes('--confirm');
const batchArg = process.argv.find((arg) => arg.startsWith('--batch='));
const batchSize = Math.max(1, Number.parseInt(batchArg?.split('=')[1] || '100', 10));

if (apply && !confirmed) throw new Error('--apply yêu cầu --confirm');

const run = async () => {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGO_URI hoặc MONGODB_URI chưa được cấu hình');
  await mongoose.connect(mongoUri);
  const report = [];
  let lastId = null;
  while (true) {
    const bookings = await Booking.find({
      ...(lastId ? { _id: { $gt: lastId } } : {}),
      status: { $in: ['pending', 'confirmed'] },
      tableNumbers: { $exists: true, $ne: [] },
    }).sort({ _id: 1 }).limit(batchSize).lean();
    if (!bookings.length) break;

    for (const booking of bookings) {
      lastId = booking._id;
      try {
        const desired = bookingService.buildReservationSlots(
          booking.restaurantId, booking.tableNumbers, booking.bookingDate,
          booking.bookingTime, booking._id,
        );
        let bookingConflict = null;
        for (const tableNumber of booking.tableNumbers) {
          const check = await bookingService.checkTimeConflict(
            booking.restaurantId, tableNumber, booking.bookingDate,
            booking.bookingTime, booking._id,
          );
          if (check.hasConflict) {
            bookingConflict = check.conflictingBookings[0];
            break;
          }
        }
        if (bookingConflict) {
          report.push({ bookingId: booking._id, status: 'conflict', conflictBookingId: bookingConflict._id });
          continue;
        }
        const slotKeys = desired.map((slot) => ({
          restaurantId: slot.restaurantId,
          tableNumber: slot.tableNumber,
          slotStartUtc: slot.slotStartUtc,
          bookingId: { $ne: booking._id },
        }));
        const conflict = slotKeys.length ? await TableReservation.findOne({ $or: slotKeys }).lean() : null;
        if (conflict) {
          report.push({ bookingId: booking._id, status: 'conflict', conflictBookingId: conflict.bookingId });
          continue;
        }
        if (apply) {
          const session = await mongoose.startSession();
          try {
            await session.withTransaction(async () => {
              await TableReservation.deleteMany({ bookingId: booking._id }).session(session);
              await TableReservation.insertMany(desired, { ordered: true, session });
            });
          } finally {
            await session.endSession();
          }
        }
        report.push({ bookingId: booking._id, status: apply ? 'backfilled' : 'would_backfill', slots: desired.length });
      } catch (error) {
        report.push({ bookingId: booking._id, status: 'error', reason: error.message });
      }
    }
  }
  if (apply && !report.some((item) => ['conflict', 'error'].includes(item.status))) {
    const collection = TableReservation.collection;
    const indexes = await collection.indexes();
    for (const index of indexes) {
      const key = JSON.stringify(index.key);
      if (
        key === JSON.stringify({ createdAt: 1 })
        || key === JSON.stringify({ restaurantId: 1, tableNumber: 1, bookingDate: 1, bookingTime: 1 })
      ) {
        await collection.dropIndex(index.name);
      }
    }
    await TableReservation.createIndexes();
  }
  const reportDir = path.resolve(__dirname, '../../../Task/backend-medium-fixes/reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const output = path.join(reportDir, `reservation-slot-report-${Date.now()}.json`);
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', processed: report.length, output }, null, 2));
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
