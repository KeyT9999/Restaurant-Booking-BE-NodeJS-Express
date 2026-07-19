// ─────────────────────────────────────────────
// Refund Controller
// ─────────────────────────────────────────────
const Refund = require('../models/Refund');
const Payment = require('../models/Payment');
const Transaction = require('../models/Transaction');
const Booking = require('../models/Booking');
const notificationService = require('../services/notification.service');
const { getBookingStartAt } = require('../utils/booking-time');

const sendNotification = (promise, label) => {
  Promise.resolve(promise).catch((error) => {
    console.warn(`[RefundNotification/${label}] ${error.message}`);
  });
};

// ─── POST /api/v1/refunds/request ───
exports.createRefundRequest = async (req, res) => {
  try {
    const { paymentId, reason, bankInfo } = req.body;
    const userId = req.user._id;

    if (!paymentId || !reason) {
      return res.status(400).json({ success: false, message: 'paymentId và reason là bắt buộc.' });
    }

    const payment = await Payment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment không tồn tại.' });
    }

    // Chỉ cho phép hoàn tiền payment đã paid
    if (payment.status !== 'paid') {
      return res.status(400).json({ success: false, message: 'Chỉ có thể hoàn tiền cho thanh toán đã thành công.' });
    }

    // Kiểm tra quyền
    if (payment.userId.toString() !== userId.toString() && req.user.role !== 'restaurant_owner') {
      return res.status(403).json({ success: false, message: 'Không có quyền yêu cầu hoàn tiền.' });
    }

    // Kiểm tra đã có refund pending chưa
    const existingRefund = await Refund.findOne({
      paymentId,
      status: { $in: ['requested', 'approved', 'processing'] },
    });
    if (existingRefund) {
      return res.status(400).json({ success: false, message: 'Đã có yêu cầu hoàn tiền đang chờ xử lý.' });
    }

    // Kiểm tra chính sách hoàn cọc (nếu là booking, hủy trước 24h)
    if (payment.targetType === 'booking') {
      const booking = await Booking.findById(payment.targetId);
      if (booking) {
        const now = new Date();
        const hoursLeft = (getBookingStartAt(booking) - now) / (1000 * 60 * 60);
        if (hoursLeft < 24) {
          return res.status(400).json({
            success: false,
            message: 'Không thể hoàn tiền đặt cọc khi thời gian đặt bàn còn dưới 24 giờ.',
          });
        }
      }
    }

    const refund = await Refund.create({
      paymentId: payment._id,
      bookingId: payment.targetType === 'booking' ? payment.targetId : null,
      requestedBy: userId,
      requestedByRole: req.user.role,
      amount: payment.amount,
      reason,
      bankInfo: bankInfo || {},
      status: 'requested',
    });

    // Bắn socket cho admin
    try {
      const io = req.app.get('io');
      if (io) {
        io.emit('new_refund_request', { refundId: refund._id, amount: refund.amount });
      }
    } catch (e) {}
    sendNotification(
      notificationService.notifyRefundRequested(req.app?.get?.('io') || null, { refund, payment }),
      'requested'
    );

    return res.status(201).json({ success: true, message: 'Yêu cầu hoàn tiền đã được gửi.', data: refund });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── GET /api/v1/admin/refunds ───
exports.getAllRefunds = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const refunds = await Refund.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate('requestedBy', 'fullName email phoneNumber')
      .populate('approvedBy', 'fullName')
      .populate({
        path: 'paymentId',
        select: 'amount targetType targetId orderCode status',
        populate: { path: 'restaurantId', select: 'name' },
      })
      .populate('bookingId', 'bookingDate bookingTime numberOfGuests customerName');

    const total = await Refund.countDocuments(filter);

    return res.status(200).json({
      success: true,
      data: refunds,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── PATCH /api/v1/admin/refunds/:id/approve ───
exports.approveRefund = async (req, res) => {
  try {
    const refund = await Refund.findById(req.params.id);
    if (!refund) return res.status(404).json({ success: false, message: 'Refund không tồn tại.' });
    if (refund.status !== 'requested') {
      return res.status(400).json({ success: false, message: 'Chỉ có thể duyệt yêu cầu đang ở trạng thái requested.' });
    }

    refund.status = 'approved';
    refund.approvedBy = req.user._id;
    refund.adminNote = (req.body || {}).adminNote || 'Đã duyệt';
    await refund.save();
    sendNotification(
      notificationService.notifyRefundStatus(req.app?.get?.('io') || null, { refund, status: 'approved' }),
      'approved'
    );

    return res.status(200).json({ success: true, message: 'Đã duyệt yêu cầu hoàn tiền.', data: refund });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── PATCH /api/v1/admin/refunds/:id/reject ───
exports.rejectRefund = async (req, res) => {
  try {
    const refund = await Refund.findById(req.params.id);
    if (!refund) return res.status(404).json({ success: false, message: 'Refund không tồn tại.' });
    if (refund.status !== 'requested') {
      return res.status(400).json({ success: false, message: 'Chỉ có thể từ chối yêu cầu đang ở trạng thái requested.' });
    }

    refund.status = 'rejected';
    refund.approvedBy = req.user._id;
    refund.adminNote = (req.body || {}).adminNote || 'Từ chối';
    await refund.save();
    sendNotification(
      notificationService.notifyRefundStatus(req.app?.get?.('io') || null, { refund, status: 'rejected' }),
      'rejected'
    );

    return res.status(200).json({ success: true, message: 'Đã từ chối yêu cầu hoàn tiền.', data: refund });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── POST /api/v1/admin/refunds/:id/process ───
exports.processRefund = async (req, res) => {
  try {
    const { adminNote, gatewayRefundId } = req.body || {};
    const refund = await Refund.findById(req.params.id);
    if (!refund) return res.status(404).json({ success: false, message: 'Refund không tồn tại.' });

    if (!['approved', 'requested'].includes(refund.status)) {
      return res.status(400).json({ success: false, message: 'Refund phải ở trạng thái approved hoặc requested để xử lý.' });
    }

    // Cập nhật refund
    refund.status = 'refunded';
    refund.approvedBy = req.user._id;
    refund.adminNote = adminNote || 'Đã chuyển tiền hoàn';
    refund.gatewayRefundId = gatewayRefundId || null;
    refund.refundedAt = new Date();
    await refund.save();
    sendNotification(
      notificationService.notifyRefundStatus(req.app?.get?.('io') || null, { refund, status: 'refunded' }),
      'refunded'
    );

    // Cập nhật payment
    const payment = await Payment.findById(refund.paymentId);
    if (payment) {
      payment.status = 'refunded';
      await payment.save();

      // Cập nhật booking liên quan
      if (payment.targetType === 'booking') {
        await Booking.findByIdAndUpdate(payment.targetId, {
          status: 'cancelled',
          cancellationReason: refund.reason,
          cancelledBy: 'admin',
          cancelledAt: new Date(),
          $push: {
            statusHistory: {
              status: 'cancelled',
              changedAt: new Date(),
              note: `Hoàn tiền bởi admin: ${adminNote || ''}`,
            },
          },
        });
      }

      // Tạo transaction ghi nhận dòng tiền âm
      await Transaction.create({
        paymentId: payment._id,
        type: 'refund',
        amount: -refund.amount,
        status: 'success',
        gateway: 'manual',
        gatewayTransactionId: gatewayRefundId || null,
      });
    }

    // Bắn socket cho user
    try {
      const io = req.app.get('io');
      if (io) {
        io.to(`user_${refund.requestedBy}`).emit('refund_processed', {
          refundId: refund._id,
          status: 'refunded',
          amount: refund.amount,
        });
      }
    } catch (e) {}

    return res.status(200).json({ success: true, message: 'Đã xử lý hoàn tiền thành công.', data: refund });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
