'use strict';

const Booking = require('../models/Booking');
const notificationService = require('../services/notification.service');

/**
 * Gửi reminder cho đặt bàn ngày mai lúc 8h sáng
 * Chạy mỗi 30 phút, chỉ gửi nếu reminderSent = false
 */
const bookingReminder = async (io) => {
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

  while (true) {
    const bookings = await Booking.find(filter)
      .limit(batchSize)
      .lean();

    if (bookings.length === 0) break;

    for (const booking of bookings) {
      try {
        if (io && booking.customerId) {
          await notificationService.notifyBookingReminder(io, booking);
        }
        await Booking.updateOne(
          { _id: booking._id },
          { $set: { reminderSent: true, reminderSentAt: new Date() } }
        );
        processed++;
      } catch (err) {
        console.warn(`[Cron/Reminder] Booking ${booking._id}: ${err.message}`);
      }
    }
  }

  if (processed > 0) {
    console.log(`[Cron] Booking reminder sent to ${processed} customers`);
  }
};

module.exports = bookingReminder;
