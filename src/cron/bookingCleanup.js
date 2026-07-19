'use strict';

const Booking = require('../models/Booking');
const bookingService = require('../services/booking.service');

/**
 * Cleanup expired confirmed bookings:
 * - auto-no-show for bookings past booking end time with checkedInAt == null
 * - auto-complete for bookings past booking end time with checkedInAt != null
 * Auto-cancel unpaid pending bookings after 15 minutes.
 * Chạy mỗi 5 phút.
 */
const bookingCleanup = async (io) => {
  const now = new Date();
  const results = { cancelled: 0, completed: 0, noShow: 0, errors: 0, skipped: 0 };

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
      try {
        booking.status = 'cancelled';
        booking.cancelledBy = 'system';
        booking.cancelledAt = now;
        booking.cancellationReason = 'Tự động hủy do không thanh toán cọc';
        booking.statusHistory.push({
          status: 'cancelled',
          changedBy: null,
          note: 'Tự động hủy do quá thời gian thanh toán cọc',
          changedAt: now
        });
        await booking.save();

        // Release table reservations for cancelled bookings
        await bookingService.releaseTableReservations(booking._id).catch(() => {});

        results.cancelled++;
      } catch (err) {
        console.error(`[Cron/Cleanup] Lỗi khi hủy booking pending ${booking._id}:`, err.message);
        results.errors++;
      }
    }

    // 2. Tìm tất cả các booking ở trạng thái confirmed để xử lý quá hạn
    // Tìm các booking có ngày đặt <= hôm nay + 1 ngày để tối ưu hóa bộ nhớ
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const confirmedBookings = await Booking.find({
      status: 'confirmed',
      bookingDate: { $lte: tomorrow },
    });

    for (const booking of confirmedBookings) {
      try {
        const processResult = await bookingService.processExpiredBooking(booking._id, now, io);
        if (processResult.success) {
          if (processResult.status === 'completed') {
            results.completed++;
          } else if (processResult.status === 'no_show') {
            results.noShow++;
          }
        } else {
          results.skipped++;
        }
      } catch (err) {
        console.error(`[Cron/Cleanup] Lỗi khi xử lý booking confirmed quá hạn ${booking._id}:`, err.message);
        results.errors++;
      }
    }

    if (results.cancelled || results.completed || results.noShow || results.errors) {
      console.log(`[Cron] Cleanup hoàn tất: cancelled=${results.cancelled} completed=${results.completed} noShow=${results.noShow} skipped=${results.skipped} errors=${results.errors}`);
    }
  } catch (err) {
    console.error('[Cron/Cleanup] Lỗi hệ thống:', err.message);
  }
};

module.exports = bookingCleanup;
