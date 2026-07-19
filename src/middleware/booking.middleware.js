'use strict';

const Booking = require('../models/Booking');
const Restaurant = require('../models/Restaurant');

/**
 * Validates the basic inputs for creating or updating a booking.
 */
const validateBookingInput = (req, res, next) => {
  const {
    restaurantId,
    bookingDate,
    bookingTime,
    numberOfGuests,
    customerName,
    customerPhone,
    customerEmail,
    specialRequests,
    occasion,
    tableNumbers,
  } = req.body;

  const errors = [];

  // 1. validate restaurantId
  if (!restaurantId || !/^[0-9a-fA-F]{24}$/.test(restaurantId)) {
    errors.push('Restaurant ID không hợp lệ hoặc thiếu');
  }

  // 2. validate bookingDate
  if (!bookingDate || isNaN(Date.parse(bookingDate))) {
    errors.push('Ngày đặt bàn không hợp lệ hoặc thiếu');
  }

  // 3. validate bookingTime
  if (!bookingTime || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(bookingTime)) {
    errors.push('Giờ đặt bàn không hợp lệ hoặc thiếu (định dạng đúng HH:mm)');
  }

  // 4. validate numberOfGuests
  const guestsNum = Number(numberOfGuests);
  if (!numberOfGuests || isNaN(guestsNum) || guestsNum < 1 || guestsNum > 100) {
    errors.push('Số lượng khách phải từ 1 đến 100');
  }

  // 5. validate customerName
  if (!customerName || typeof customerName !== 'string' || customerName.trim().length === 0) {
    errors.push('Tên khách hàng là bắt buộc');
  } else if (customerName.length > 200) {
    errors.push('Tên khách hàng không được vượt quá 200 ký tự');
  }

  // 6. validate customerPhone
  const phoneRegex = /^(0[35789][0-9]{8}|02[0-9]{9})$/; // standard VN phone regex
  if (!customerPhone || !phoneRegex.test(customerPhone.trim())) {
    errors.push('Số điện thoại không hợp lệ (ví dụ: 0901234567)');
  }

  // 7. validate customerEmail
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!customerEmail || !emailRegex.test(customerEmail.trim())) {
    errors.push('Email không hợp lệ');
  }

  // 8. validate specialRequests
  if (specialRequests && specialRequests.length > 500) {
    errors.push('Yêu cầu đặc biệt không được vượt quá 500 ký tự');
  }

  // 9. validate occasion
  const validOccasions = ['birthday', 'anniversary', 'business', 'date', 'family', 'other', null, ''];
  if (occasion !== undefined && !validOccasions.includes(occasion)) {
    errors.push('Dịp đặc biệt không hợp lệ');
  }

  // 10. validate tableNumbers
  if (tableNumbers !== undefined && !Array.isArray(tableNumbers)) {
    errors.push('Danh sách số bàn phải là một mảng');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Thông tin đặt bàn không hợp lệ',
      errors,
    });
  }

  next();
};

/**
 * Checks if the customer currently logged in owns the booking.
 */
const verifyCustomerBookingAccess = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy thông tin đặt bàn',
      });
    }

    if (!booking.customerId || booking.customerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền truy cập đặt bàn này',
      });
    }

    req.booking = booking;
    next();
  } catch (error) {
    console.error('❌ [verifyCustomerBookingAccess] Lỗi:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ khi kiểm tra quyền hạn',
    });
  }
};

/**
 * Checks if the restaurant owner currently logged in owns the restaurant of the booking.
 */
const verifyOwnerBookingAccess = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy thông tin đặt bàn',
      });
    }

    const restaurant = await Restaurant.findById(booking.restaurantId);
    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy thông tin nhà hàng tương ứng',
      });
    }

    if (restaurant.ownerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền truy cập đặt bàn của nhà hàng này',
      });
    }

    req.booking = booking;
    req.restaurant = restaurant;
    next();
  } catch (error) {
    console.error('❌ [verifyOwnerBookingAccess] Lỗi:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ khi kiểm tra quyền hạn',
    });
  }
};

module.exports = {
  validateBookingInput,
  verifyCustomerBookingAccess,
  verifyOwnerBookingAccess,
};
