'use strict';

const Booking = require('../models/Booking');

/**
 * Auto-cancel unpaid pending bookings after 15 minutes.
 * Auto-complete confirmed bookings past their booking date + 2 hours.
 * Auto-mark no-show if past booking time + 2 hours and no check-in.
 * Chạy mỗi 5 phút.
 */
const bookingCleanup = async (io) => {
  const now = new Date();
  const results = { cancelled: 0, completed: 0, noShow: 0 };

  try {
    // 1. Auto-cancel pending unpaid > 15 phút
    const fifteenMinAgo = new Date(now.getTime() - 15 * 60 * 1000);
    const unpaidPending = await Booking.find({
      status: 'pending',
      depositPaid: false,
      createdAt: { $lte: fifteenMinAgo },
      depositAmount: { $gt: 0 },
    });

    for (const booking of unpaidPending) {
      booking.status = 'cancelled';
      booking.cancelledBy = 'system';
      booking.cancelledAt = now;
      booking.cancellationReason = 'Tự động hủy do không thanh toán cọc';
      booking.statusHistory.push({
        status: 'cancelled',
        changedBy: null,
        note: 'Tự động hủy do quá thời gian thanh toán cọc',
      });
      await booking.save();
      results.cancelled++;
    }

    // 2. Auto-complete confirmed bookings past booking + 2h
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const twoHoursAgoEnd = new Date(twoHoursAgo.getTime() + 24 * 60 * 60 * 1000);

    const overdueConfirmed = await Booking.find({
      status: 'confirmed',
      bookingDate: { $lte: twoHoursAgoEnd },
      createdAt: { $lte: twoHoursAgo },
    });

    for (const booking of overdueConfirmed) {
      booking.status = 'completed';
      booking.completedAt = now;
      booking.actualGuestCount = booking.actualGuestCount || booking.numberOfGuests;
      booking.statusHistory.push({
        status: 'completed',
        changedBy: null,
        note: 'Tự động hoàn tất sau giờ đặt',
      });
      await booking.save();
      results.completed++;
    }

    // 3. Auto no-show: confirmed, past booking time + 2h, no check-in
    const overdueNoShow = await Booking.find({
      status: 'confirmed',
      checkedInAt: null,
      bookingDate: { $lte: twoHoursAgoEnd },
      createdAt: { $lte: twoHoursAgo },
    });

    for (const booking of overdueNoShow) {
      booking.status = 'no_show';
      booking.statusHistory.push({
        status: 'no_show',
        changedBy: null,
        note: 'Tự động đánh dấu vắng mặt',
      });
      await booking.save();
      results.noShow++;
    }

    if (results.cancelled || results.completed || results.noShow) {
      console.log(`[Cron] Cleanup: cancelled=${results.cancelled} completed=${results.completed} noShow=${results.noShow}`);
    }
  } catch (err) {
    console.error('[Cron/Cleanup] Error:', err.message);
  }
};

module.exports = bookingCleanup;
