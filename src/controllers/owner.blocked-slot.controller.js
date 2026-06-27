'use strict';

const BlockedSlot = require('../models/BlockedSlot');
const { assertOwnerCanAccessRestaurant } = require('../utils/restaurant-permission');
const bookingService = require('../services/booking.service');

// GET /api/v1/owner/restaurants/:restaurantId/blocked-slots
exports.getBlockedSlots = async (req, res) => {
  try {
    const { restaurantId } = req.params;
    await assertOwnerCanAccessRestaurant(req.user._id, restaurantId);

    const blockedSlots = await BlockedSlot.find({ restaurantId }).sort({ date: 1, startTime: 1 });

    return res.status(200).json({
      success: true,
      data: blockedSlots,
    });
  } catch (error) {
    console.error('❌ Error fetching blocked slots:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Lỗi hệ thống khi tải danh sách giờ chặn.',
    });
  }
};

// POST /api/v1/owner/restaurants/:restaurantId/blocked-slots
exports.createBlockedSlot = async (req, res) => {
  try {
    const { restaurantId } = req.params;
    await assertOwnerCanAccessRestaurant(req.user._id, restaurantId);

    const { date, slotType, startTime, endTime, tableNumbers, reason } = req.body;
    const errors = [];

    if (!date) {
      errors.push('Ngày chặn là bắt buộc.');
    }

    if (slotType && !['full_day', 'time_range'].includes(slotType)) {
      errors.push('Loại chặn không hợp lệ.');
    }

    if (slotType === 'time_range') {
      if (!startTime || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) {
        errors.push('Giờ bắt đầu không hợp lệ (định dạng HH:mm).');
      }
      if (!endTime || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) {
        errors.push('Giờ kết thúc không hợp lệ (định dạng HH:mm).');
      }
      if (startTime && endTime && startTime >= endTime) {
        errors.push('Giờ kết thúc phải sau giờ bắt đầu.');
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: errors[0], errors });
    }

    const normalizedDate = bookingService.normalizeDate(date);

    const blockedSlot = await BlockedSlot.create({
      restaurantId,
      date: normalizedDate,
      slotType: slotType || 'full_day',
      startTime: slotType === 'time_range' ? startTime : null,
      endTime: slotType === 'time_range' ? endTime : null,
      tableNumbers: Array.isArray(tableNumbers) ? tableNumbers.filter(Boolean) : [],
      reason: reason || null,
    });

    return res.status(201).json({
      success: true,
      message: 'Chặn khung giờ thành công',
      data: blockedSlot,
    });
  } catch (error) {
    console.error('❌ Error creating blocked slot:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Lỗi hệ thống khi chặn khung giờ.',
    });
  }
};

// DELETE /api/v1/owner/restaurants/:restaurantId/blocked-slots/:id
exports.deleteBlockedSlot = async (req, res) => {
  try {
    const { restaurantId, id } = req.params;
    await assertOwnerCanAccessRestaurant(req.user._id, restaurantId);

    const blockedSlot = await BlockedSlot.findOne({ _id: id, restaurantId });
    if (!blockedSlot) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy khung giờ chặn hoặc không thuộc nhà hàng này.',
      });
    }

    await BlockedSlot.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: 'Hủy chặn khung giờ thành công',
    });
  } catch (error) {
    console.error('❌ Error deleting blocked slot:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Lỗi hệ thống khi xóa khung giờ chặn.',
    });
  }
};
