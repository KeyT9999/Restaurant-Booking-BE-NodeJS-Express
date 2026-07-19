'use strict';

const WithdrawalRequest = require('../models/WithdrawalRequest');
const Restaurant = require('../models/Restaurant');
const withdrawalService = require('../services/withdrawal.service');

// Hỗ trợ gửi thông báo Socket.io realtime
const emitNotification = (io, room, event, payload) => {
  if (io) {
    io.to(room).emit(event, payload);
  }
};

/**
 * Admin lấy toàn bộ danh sách yêu cầu rút tiền (GET /api/v1/admin/withdrawals)
 */
const getAllWithdrawals = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;
    const { status, ownerId, restaurantId } = req.query;

    const query = {};
    if (status) {
      query.status = status;
    }
    if (ownerId) {
      query.ownerId = ownerId;
    }
    if (restaurantId) {
      query.restaurantId = restaurantId;
    }

    const [withdrawals, total] = await Promise.all([
      WithdrawalRequest.find(query)
        .populate('ownerId', 'fullName email username')
        .populate('restaurantId', 'name logo')
        .populate('reviewedBy', 'fullName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      WithdrawalRequest.countDocuments(query),
    ]);

    return res.json({
      success: true,
      data: withdrawals,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('❌ [GetAllWithdrawals] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lấy danh sách yêu cầu rút tiền' });
  }
};

/**
 * Admin duyệt yêu cầu rút tiền (PATCH /api/v1/admin/withdrawals/:id/approve)
 */
const approveWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNote } = req.body || {};
    const adminId = req.user._id;

    const withdrawal = await withdrawalService.transition({
      withdrawalId: id, expectedStatuses: ['pending'], nextStatus: 'approved', actorId: adminId,
      adminNote: adminNote ? adminNote.trim() : 'Đã duyệt yêu cầu rút tiền',
    });

    // Gửi socket notify cho Owner
    const io = req.app.get('io');
    const restaurantName = withdrawal.restaurantId?.toString() || 'nhà hàng';
    emitNotification(io, `user:${withdrawal.ownerId.toString()}`, 'withdrawal:approved', {
      withdrawalId: withdrawal._id,
      amount: withdrawal.amount,
      status: 'approved',
      message: `Yêu cầu rút tiền ${withdrawal.amount.toLocaleString('vi-VN')} VNĐ đã được duyệt. Đang chờ chuyển tiền.`,
    });

    return res.json({
      success: true,
      message: 'Duyệt yêu cầu rút tiền thành công',
      data: withdrawal,
    });
  } catch (error) {
    console.error('❌ [ApproveWithdrawal] Lỗi:', error.message);
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi duyệt yêu cầu rút tiền' });
  }
};

/**
 * Admin từ chối yêu cầu rút tiền (PATCH /api/v1/admin/withdrawals/:id/reject)
 */
const rejectWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNote } = req.body || {};
    const adminId = req.user._id;

    if (!adminNote || adminNote.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Lý do từ chối (adminNote) là bắt buộc' });
    }

    const withdrawal = await withdrawalService.transition({
      withdrawalId: id, expectedStatuses: ['pending', 'approved'], nextStatus: 'rejected', actorId: adminId,
      adminNote: adminNote.trim(), releaseFunds: true,
    });

    // Gửi socket notify cho Owner
    const io = req.app.get('io');
    emitNotification(io, `user:${withdrawal.ownerId.toString()}`, 'withdrawal:rejected', {
      withdrawalId: withdrawal._id,
      amount: withdrawal.amount,
      status: 'rejected',
      message: `Yêu cầu rút tiền ${withdrawal.amount.toLocaleString('vi-VN')} VNĐ đã bị từ chối. Lý do: ${withdrawal.adminNote}`,
    });

    return res.json({
      success: true,
      message: 'Từ chối yêu cầu rút tiền thành công',
      data: withdrawal,
    });
  } catch (error) {
    console.error('❌ [RejectWithdrawal] Lỗi:', error.message);
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi từ chối yêu cầu rút tiền' });
  }
};

/**
 * Admin hoàn tất/đã chuyển tiền (PATCH /api/v1/admin/withdrawals/:id/complete)
 */
const completeWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNote, proofImage } = req.body || {};
    const adminId = req.user._id;

    const withdrawal = await withdrawalService.transition({
      withdrawalId: id, expectedStatuses: ['approved', 'processing'], nextStatus: 'completed', actorId: adminId,
      adminNote: adminNote ? adminNote.trim() : undefined, proofImage, releaseFunds: false,
    });

    // Gửi socket notify cho Owner
    const io = req.app.get('io');
    emitNotification(io, `user:${withdrawal.ownerId.toString()}`, 'withdrawal:completed', {
      withdrawalId: withdrawal._id,
      amount: withdrawal.amount,
      status: 'completed',
      message: `Yêu cầu rút tiền ${withdrawal.amount.toLocaleString('vi-VN')} VNĐ đã được hoàn tất chuyển tiền.`,
    });

    return res.json({
      success: true,
      message: 'Hoàn tất yêu cầu rút tiền thành công',
      data: withdrawal,
    });
  } catch (error) {
    console.error('❌ [CompleteWithdrawal] Lỗi:', error.message);
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi hoàn tất yêu cầu rút tiền' });
  }
};

module.exports = {
  getAllWithdrawals,
  approveWithdrawal,
  rejectWithdrawal,
  completeWithdrawal,
};
