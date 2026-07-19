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
 * Owner tạo yêu cầu rút tiền mới (POST /api/v1/owner/withdrawals)
 */
const createWithdrawal = async (req, res) => {
  try {
    const { restaurantId, amount, bankName, accountNumber, accountHolder, note } = req.body;
    const userId = req.user._id;

    // Validate inputs
    if (!restaurantId) {
      return res.status(400).json({ success: false, message: 'Thiếu ID nhà hàng (restaurantId)' });
    }
    const amountNum = Number(amount);
    if (isNaN(amountNum) || amountNum < 10000) {
      return res.status(400).json({ success: false, message: 'Số tiền rút tối thiểu là 10,000 VNĐ' });
    }
    if (!bankName || !accountNumber || !accountHolder) {
      return res.status(400).json({ success: false, message: 'Thông tin tài khoản ngân hàng không được để trống' });
    }

    // Kiểm tra nhà hàng tồn tại và thuộc sở hữu của owner này
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy nhà hàng này' });
    }
    if (restaurant.ownerId.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền yêu cầu rút tiền cho nhà hàng này' });
    }

    // Kiểm tra số dư nhà hàng có đủ để rút không
    if ((restaurant.balance || 0) < amountNum) {
      return res.status(400).json({
        success: false,
        message: `Số dư không đủ. Số dư hiện tại: ${(restaurant.balance || 0).toLocaleString('vi-VN')} VNĐ`,
      });
    }

    // Kiểm tra xem đã có yêu cầu pending nào chưa
    const existingPending = await WithdrawalRequest.findOne({
      restaurantId,
      status: 'pending',
    });
    if (existingPending) {
      return res.status(400).json({
        success: false,
        message: 'Bạn đã có một yêu cầu rút tiền đang chờ xử lý. Vui lòng đợi yêu cầu trước được hoàn tất.',
      });
    }

    // Tạo withdrawal request
    const withdrawal = new WithdrawalRequest({
      ownerId: userId,
      restaurantId,
      amount: amountNum,
      bankInfo: {
        bankName: bankName.trim(),
        accountNumber: accountNumber.trim(),
        accountHolder: accountHolder.trim(),
      },
      note: note ? note.trim() : null,
      status: 'pending',
    });

    await withdrawal.save();

    // Gửi socket notify cho admin
    const io = req.app.get('io');
    emitNotification(io, 'admin', 'withdrawal:created', {
      withdrawalId: withdrawal._id,
      restaurantName: restaurant.name,
      amount: amountNum,
      message: `Yêu cầu rút tiền mới trị giá ${amountNum.toLocaleString('vi-VN')} VNĐ từ nhà hàng ${restaurant.name}`,
    });

    return res.status(201).json({
      success: true,
      message: 'Gửi yêu cầu rút tiền thành công',
      data: withdrawal,
    });
  } catch (error) {
    console.error('❌ [CreateWithdrawal] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi tạo yêu cầu rút tiền' });
  }
};

/**
 * Lấy danh sách yêu cầu rút tiền của Owner (GET /api/v1/owner/withdrawals)
 */
const getMyWithdrawals = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;
    const { status, restaurantId } = req.query;

    const query = { ownerId: userId };
    if (status) {
      query.status = status;
    }
    if (restaurantId) {
      query.restaurantId = restaurantId;
    }

    const [withdrawals, total] = await Promise.all([
      WithdrawalRequest.find(query)
        .populate('restaurantId', 'name logo')
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
    console.error('❌ [GetMyWithdrawals] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi tải danh sách yêu cầu rút tiền' });
  }
};

/**
 * Chi tiết yêu cầu rút tiền (GET /api/v1/owner/withdrawals/:id)
 */
const getWithdrawalById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const withdrawal = await WithdrawalRequest.findById(id).populate('restaurantId', 'name logo');
    if (!withdrawal) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy yêu cầu rút tiền' });
    }

    if (withdrawal.ownerId.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền xem yêu cầu rút tiền này' });
    }

    return res.json({
      success: true,
      data: withdrawal,
    });
  } catch (error) {
    console.error('❌ [GetWithdrawalById] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi xem chi tiết yêu cầu rút tiền' });
  }
};

module.exports = {
  createWithdrawal,
  getMyWithdrawals,
  getWithdrawalById,
};
