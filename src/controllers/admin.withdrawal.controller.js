'use strict';

const WithdrawalRequest = require('../models/WithdrawalRequest');
const Restaurant = require('../models/Restaurant');

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

    const withdrawal = await WithdrawalRequest.findById(id);
    if (!withdrawal) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy yêu cầu rút tiền' });
    }

    if (withdrawal.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Chỉ có thể duyệt yêu cầu rút tiền đang chờ xử lý (pending)' });
    }

    withdrawal.status = 'approved';
    withdrawal.adminNote = adminNote ? adminNote.trim() : 'Đã duyệt yêu cầu rút tiền';
    withdrawal.reviewedBy = adminId;
    withdrawal.reviewedAt = new Date();

    await withdrawal.save();

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
      // return res.status(400).json({ success: false, message: 'Lý do từ chối (adminNote) là bắt buộc' });
      // Thay vì báo lỗi, cho phép từ chối mà không cần lý do (gán mặc định)
    }

    const withdrawal = await WithdrawalRequest.findById(id);
    if (!withdrawal) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy yêu cầu rút tiền' });
    }

    if (withdrawal.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Chỉ có thể từ chối yêu cầu rút tiền đang chờ xử lý (pending)' });
    }

    withdrawal.status = 'rejected';
    withdrawal.adminNote = adminNote ? adminNote.trim() : 'Từ chối yêu cầu rút tiền';
    withdrawal.reviewedBy = adminId;
    withdrawal.reviewedAt = new Date();

    await withdrawal.save();

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

    const withdrawal = await WithdrawalRequest.findById(id);
    if (!withdrawal) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy yêu cầu rút tiền' });
    }

    if (withdrawal.status !== 'approved' && withdrawal.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Yêu cầu rút tiền phải ở trạng thái pending hoặc approved để hoàn tất' });
    }

    withdrawal.status = 'completed';
    if (adminNote) {
      withdrawal.adminNote = adminNote.trim();
    }
    if (proofImage) {
      withdrawal.proofImage = proofImage;
    }
    withdrawal.completedAt = new Date();
    // Nếu chưa review thì gán admin review luôn
    if (!withdrawal.reviewedBy) {
      withdrawal.reviewedBy = adminId;
      withdrawal.reviewedAt = new Date();
    }

    await withdrawal.save();

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
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi hoàn tất yêu cầu rút tiền' });
  }
};

module.exports = {
  getAllWithdrawals,
  approveWithdrawal,
  rejectWithdrawal,
  completeWithdrawal,
};
