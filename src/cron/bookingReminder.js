'use strict';

const Booking = require('../models/Booking');
const notificationService = require('../services/notification.service');

let isRunning = false;

/**
 * Gửi reminder cho đặt bàn ngày mai lúc 8h sáng
 * Chạy mỗi 30 phút, chỉ gửi nếu reminderSent = false
 */
const bookingReminder = async (io) => {
  if (isRunning) {
    console.warn('[Cron/Reminder] Bỏ qua vì lượt reminder trước vẫn đang chạy');
    return { processed: 0, failed: 0, skipped: true };
  }

  isRunning = true;

  try {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000);

    const filter = {
      status: { $in: ['pending', 'confirmed'] },
      bookingDate: { $gte: today, $lte: tomorrow },
      reminderSent: false,
    };

    const batchSize = 50;
    let processed = 0;
    let failed = 0;
    let lastSeenId = null;

    while (true) {
      const batchFilter = lastSeenId
        ? { ...filter, _id: { $gt: lastSeenId } }
        : filter;
      const bookings = await Booking.find(batchFilter)
        .sort({ _id: 1 })
        .limit(batchSize)
        .lean();

      if (bookings.length === 0) break;

      for (const booking of bookings) {
        // Advance the cursor even when this booking fails, preventing an in-process retry loop.
        lastSeenId = booking._id;
        try {
          if (io && booking.customerId) {
            await notificationService.notifyBookingReminder(io, booking);
          }
          await Booking.updateOne(
            { _id: booking._id, reminderSent: false },
            { $set: { reminderSent: true, reminderSentAt: new Date() } }
          );
          processed++;
        } catch (err) {
          failed++;
          console.warn(`[Cron/Reminder] Booking ${booking._id}: ${err.message}`);
        }
      }
    }

    if (processed > 0 || failed > 0) {
      console.log(`[Cron] Booking reminder completed: sent=${processed}, failed=${failed}`);
    }

    return { processed, failed, skipped: false };
  } catch (err) {
    console.error(`[Cron/Reminder] Job failed: ${err.message}`);
    return { processed: 0, failed: 1, skipped: false };
  } finally {
    isRunning = false;
  }
};

module.exports = bookingReminder;
