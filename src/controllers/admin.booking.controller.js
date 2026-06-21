'use strict';

const Booking = require('../models/Booking');
const bookingService = require('../services/booking.service');
const notificationService = require('../services/notification.service');
const bookingCommissionService = require('../services/booking-commission.service');

const sendNotification = (promise, label) => {
  Promise.resolve(promise).catch((error) => {
    console.warn(`[AdminBookingNotification/${label}] ${error.message}`);
  });
};

// ────────────────────────────────────────────────────────
// A. Danh sách Bookings (Paginated, Search, Filter)
// ────────────────────────────────────────────────────────
const getBookings = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const search = (req.query.search || '').trim();
    const status = (req.query.status || '').trim();
    const fromDate = req.query.fromDate;
    const toDate = req.query.toDate;

    const filter = {};

    if (status) {
      filter.status = status;
    }

    if (fromDate || toDate) {
      filter.bookingDate = {};
      if (fromDate) filter.bookingDate.$gte = new Date(fromDate);
      if (toDate) filter.bookingDate.$lte = new Date(toDate);
    }

    if (search) {
      filter.$or = [
        { customerName: { $regex: search, $options: 'i' } },
        { customerPhone: { $regex: search, $options: 'i' } },
        { customerEmail: { $regex: search, $options: 'i' } },
      ];
    }

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .populate('customerId', 'fullName email')
        .populate('restaurantId', 'name address')
        .sort({ bookingDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Booking.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: {
        bookings: bookings.map(b => b.toAdminJSON()),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('❌ [Admin/GetBookings] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể tải danh sách đặt bàn' });
  }
};

// ────────────────────────────────────────────────────────
// B. Xem chi tiết Booking
// ────────────────────────────────────────────────────────
const getBookingById = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('customerId', 'fullName email phoneNumber avatarUrl')
      .populate('restaurantId', 'name address phoneNumber logo')
      .populate('confirmedBy', 'fullName email');

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy thông tin đặt bàn' });
    }

    return res.json({ success: true, data: booking.toAdminJSON() });
  } catch (error) {
    console.error('❌ [Admin/GetBooking] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể tải chi tiết đặt bàn' });
  }
};

// ────────────────────────────────────────────────────────
// C. Cập nhật trạng thái Booking
// ────────────────────────────────────────────────────────
const updateBookingStatus = async (req, res) => {
  try {
    const { status, note, internalNotes } = req.body;
    const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'];

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Trạng thái không hợp lệ' });
    }

    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy thông tin đặt bàn' });
    }

    if (booking.status === status) {
      return res.status(400).json({ success: false, message: 'Trạng thái này đã được cập nhật' });
    }

    if (!bookingService.canTransitionBookingStatus(booking.status, status)) {
      return res.status(400).json({
        success: false,
        message: `Khong the chuyen trang thai tu ${booking.status} sang ${status}`,
      });
    }

    if (status === 'cancelled' && (!note || !note.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Vui long cung cap ly do huy dat ban',
      });
    }

    // Logic update status
    booking.status = status;
    booking.statusHistory.push({
      status,
      changedBy: req.user._id,
      note: note || `Admin updated status to ${status}`,
    });

    if (status === 'cancelled') {
      booking.cancelledBy = 'admin';
      booking.cancelledAt = new Date();
      booking.cancellationReason = note || 'Admin cancelled';
      
      // Reverse voucher redemption if any
      if (booking.voucherId) {
        try {
          const voucherService = require('../services/voucher.service');
          await voucherService.reverseRedemption(booking._id, note || 'Admin hủy đặt bàn', req.user);
        } catch (reverseErr) {
          console.error('❌ Lỗi hoàn nguyên voucher khi admin hủy đặt bàn:', reverseErr.message);
        }
      }
    } else if (status === 'confirmed') {
      booking.confirmedBy = req.user._id;
      booking.confirmedAt = new Date();
    } else if (status === 'completed') {
      booking.completedAt = new Date();
    }

    if (internalNotes !== undefined) {
      booking.internalNotes = internalNotes;
    }

    await booking.save();

    // Re-fetch with populated data to return full details
    if (status === 'completed') {
      await bookingCommissionService.createLedgerForBooking(booking._id, {
        booking,
        source: booking.sourceAiPendingActionId ? 'ai_booking_admin_completed' : 'admin_booking_completed',
      });
    } else if (status === 'cancelled') {
      bookingCommissionService.markCancelledForBooking(
        booking._id,
        `Admin huỷ booking trước khi phí trở thành khoản phải thu: ${note}`
      ).catch((error) => {
        console.warn(`[BookingCommission/admin-cancelled] ${error.message}`);
      });
    }

    const updatedBooking = await Booking.findById(booking._id)
      .populate('customerId', 'fullName email phoneNumber avatarUrl')
      .populate('restaurantId', 'name address phoneNumber logo')
      .populate('confirmedBy', 'fullName email');

    sendNotification(
      notificationService.notifyBookingStatusChanged(req.app?.get?.('io') || null, {
        booking,
        restaurant: updatedBooking.restaurantId,
        status,
        reason: note,
        actorRole: 'admin',
      }),
      status
    );

    return res.json({
      success: true,
      message: 'Cập nhật trạng thái đặt bàn thành công',
      data: updatedBooking.toAdminJSON(),
    });
  } catch (error) {
    console.error('❌ [Admin/UpdateBookingStatus] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể cập nhật trạng thái đặt bàn' });
  }
};

const getBookingStats = async (req, res) => {
  try {
    const counts = await Booking.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]);

    const stats = {
      totalBookings: 0,
      pending: 0,
      confirmed: 0,
      completed: 0,
      cancelled: 0,
      no_show: 0,
    };

    counts.forEach((item) => {
      if (stats[item._id] !== undefined) {
        stats[item._id] = item.count;
        stats.totalBookings += item.count;
      }
    });

    stats.completionRate = stats.totalBookings > 0
      ? Number(((stats.completed / stats.totalBookings) * 100).toFixed(1))
      : 0;
    stats.cancellationRate = stats.totalBookings > 0
      ? Number(((stats.cancelled / stats.totalBookings) * 100).toFixed(1))
      : 0;

    return res.json({ success: true, data: stats });
  } catch (error) {
    console.error('❌ [Admin/GetBookingStats] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Khong the tai thong ke dat ban' });
  }
};

/**
 * D. Revert No-Show (PUT /api/v1/admin/bookings/:id/revert-no-show)
 * Admin-only: revert a no-show booking back to confirmed and adjust the user's no-show counter.
 */
const revertNoShow = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy đặt bàn' });
    }

    if (booking.status !== 'no_show') {
      return res.status(400).json({ success: false, message: 'Chỉ có thể revert đặt bàn có trạng thái no_show' });
    }

    const User = require('../models/User');

    // Reduce the user's no-show counter
    if (booking.customerId) {
      const customer = await User.findById(booking.customerId);
      if (customer && customer.noShowCounter > 0) {
        customer.noShowCounter = Math.max(0, customer.noShowCounter - 1);
        if (customer.noShowCounter < 3 && customer.bookingBlockedUntil) {
          customer.bookingBlockedUntil = null;
        }
        await customer.save();
      }
    }

    booking.status = 'confirmed';
    booking.statusHistory.push({
      status: 'confirmed',
      changedBy: req.user._id,
      note: `Admin revert no-show: ${req.body.reason || 'Khách đã đến nhưng chưa check-in'}`,
    });

    await booking.save();

    // Notify restaurant
    const io = req.app?.get?.('io');
    if (io) {
      io.to(`restaurant:${booking.restaurantId}`).emit('booking:reverted', {
        bookingId: booking._id,
        restaurantId: booking.restaurantId,
      });
    }

    return res.json({
      success: true,
      message: 'Revert no-show thành công',
      data: booking.toAdminJSON(),
    });
  } catch (error) {
    console.error('❌ [Admin/RevertNoShow] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể revert no-show' });
  }
};

module.exports = {
  getBookings,
  getBookingStats,
  getBookingById,
  updateBookingStatus,
  revertNoShow,
};
