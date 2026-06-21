'use strict';

const Booking = require('../models/Booking');
const Restaurant = require('../models/Restaurant');
const RestaurantTable = require('../models/RestaurantTable');
const bookingService = require('../services/booking.service');
const emailService = require('../services/email.service');
const notificationService = require('../services/notification.service');
const bookingCommissionService = require('../services/booking-commission.service');
const {
  BookingApplicationError,
  createBookingApplicationService,
} = require('../services/application/booking-application.service');

const bookingApplicationService = createBookingApplicationService();

const emitBookingEvent = (io, room, event, payload) => {
  if (!io) return;
  io.to(room).emit(event, payload);
};

const sendBookingEmail = (promise, label) => {
  Promise.resolve(promise).catch((error) => {
    console.warn(`[BookingEmail/${label}] ${error.message}`);
  });
};

const sendNotification = (promise, label) => {
  Promise.resolve(promise).catch((error) => {
    console.warn(`[BookingNotification/${label}] ${error.message}`);
  });
};

/**
 * A. Tạo Đặt Bàn Mới (POST /api/v1/bookings)
 */
const createBookingLegacy = async (req, res) => {
  try {
    const customerId = req.user._id;
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
      voucherCode,
      preOrderItems,
    } = req.body;

    // 1. Kiểm tra nhà hàng
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) {
      return res.status(404).json({ success: false, message: 'Nhà hàng không tồn tại' });
    }

    if (restaurant.approvalStatus !== 'approved' || !restaurant.active) {
      return res.status(400).json({ success: false, message: 'Nhà hàng hiện đang ngưng hoạt động hoặc chưa được duyệt' });
    }

    // 2. Kiểm tra user có bị block do no-show không
    const blockCheck = await bookingService.checkUserBookingBlock(customerId);
    if (blockCheck.blocked) {
      return res.status(403).json({
        success: false,
        message: blockCheck.message,
        errorCode: 'NO_SHOW_BLOCKED',
        blockedUntil: blockCheck.blockedUntil,
      });
    }

    // 3. Validate booking time (giờ hoạt động, thời gian đặt trước)
    const timeValidation = await bookingService.validateBookingTime(bookingDate, bookingTime, restaurant);
    if (!timeValidation.valid) {
      return res.status(400).json({ success: false, message: 'Thời gian đặt bàn không hợp lệ', errors: timeValidation.errors });
    }

    let assignedTables = tableNumbers || [];

    // 3. Nếu người dùng chọn bàn cụ thể
    if (assignedTables.length > 0) {
      // Validate sức chứa và trạng thái bàn
      const capacityValidation = await bookingService.validateTableCapacity(assignedTables, numberOfGuests, restaurantId);
      if (!capacityValidation.valid) {
        return res.status(400).json({ success: false, message: 'Lựa chọn bàn không hợp lệ', errors: capacityValidation.errors });
      }

      // Check conflict cho từng bàn
      for (const tableNumber of assignedTables) {
        const { hasConflict, conflictingBookings } = await bookingService.checkTimeConflict(
          restaurantId,
          tableNumber,
          bookingDate,
          bookingTime
        );
        if (hasConflict) {
          return res.status(400).json({
            success: false,
            message: `Bàn ${tableNumber} đã có khách đặt trong khung giờ này`,
          });
        }
      }
    } else {
      // 4. Nếu người dùng không chọn bàn cụ thể -> tự động gợi ý bàn trống phù hợp
      const tableCount = await RestaurantTable.countDocuments({ restaurantId });

      if (tableCount === 0) {
        assignedTables = [];
      } else {
        const availability = await bookingService.checkAvailability(
        restaurantId,
        bookingDate,
        bookingTime,
        numberOfGuests
      );

      if (!availability.available) {
        return res.status(400).json({
          success: false,
          message: 'Hết bàn trống phù hợp trong khung giờ này. Vui lòng chọn khung giờ hoặc ngày khác.',
          errors: availability.conflicts,
        });
      }

      // Tự động gán các bàn được gợi ý
        assignedTables = availability.suggestedTables.map(t => t.tableNumber);
      }
    }

    // 4.5 Tính toán tiền đặt cọc gốc của booking dựa trên các bàn được gán
    let depositAmount = 0;
    if (assignedTables.length > 0) {
      const tables = await RestaurantTable.find({
        restaurantId,
        tableNumber: { $in: assignedTables }
      });
      depositAmount = tables.reduce((sum, t) => sum + (t.depositAmount || 0), 0);
    }

    // 5. Tính toán giảm giá từ voucher thực tế
    let discountAmount = 0;
    let voucherId = null;
    if (voucherCode) {
      const voucherService = require('../services/voucher.service');
      const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      const valResult = await voucherService.validateVoucher(voucherCode, restaurantId, customerId, depositAmount, ipAddress);
      if (valResult.valid) {
        discountAmount = valResult.discountAmount;
        voucherId = valResult.voucher._id;
      } else {
        return res.status(400).json({ success: false, message: `Mã giảm giá không hợp lệ: ${valResult.reason}` });
      }
    }

    // 6. Tạo booking document (chưa save)
    const normalizedDate = bookingService.normalizeDate(bookingDate);
    const booking = new Booking({
      customerId,
      restaurantId,
      bookingDate: normalizedDate,
      bookingTime,
      numberOfGuests,
      customerName,
      customerPhone,
      customerEmail,
      specialRequests: specialRequests || null,
      occasion: occasion || null,
      tableNumbers: assignedTables,
      depositAmount,
      discountAmount,
      voucherCode: voucherCode ? voucherCode.toUpperCase().trim() : null,
      originalAmount: depositAmount,
      finalAmount: Math.max(0, depositAmount - discountAmount),
      preOrderItems: Array.isArray(preOrderItems) ? preOrderItems.map((item) => ({
        menuItemId: item.menuItemId,
        nameSnapshot: item.nameSnapshot || item.name,
        priceSnapshot: item.priceSnapshot || item.price,
        quantity: Math.max(1, item.quantity || 1),
        note: item.note || null,
      })) : [],
      status: 'pending',
      statusHistory: [
        {
          status: 'pending',
          changedBy: customerId,
          note: 'Đặt bàn được khởi tạo bởi khách hàng',
        },
      ],
    });

    // 6.5 Atomic table reservation — prevents double-booking race condition
    if (assignedTables.length > 0) {
      const reservation = await bookingService.reserveTables(
        restaurantId,
        assignedTables,
        bookingDate,
        bookingTime,
        booking._id
      );
      if (!reservation.success) {
        return res.status(409).json({
          success: false,
          message: reservation.message,
          errorCode: reservation.error,
          tableNumber: reservation.tableNumber,
        });
      }
    }

    await booking.save();

    // 7. Gửi thông báo real-time qua Socket.io nếu có
    const io = req.app.get('io');
    emitBookingEvent(io, `restaurant:${restaurantId.toString()}`, 'booking:created', {
      bookingId: booking._id,
      restaurantId,
      customerId,
      customerName,
      bookingDate,
      bookingTime,
      status: booking.status,
      message: 'Co dat ban moi can xac nhan',
    });
    sendNotification(
      notificationService.notifyBookingCreated(io, { booking, restaurant, customer: req.user }),
      'created'
    );
    sendBookingEmail(
      emailService.sendBookingCreatedEmail(req.user, restaurant, booking),
      'created'
    );

    return res.status(201).json({
      success: true,
      message: 'Đặt bàn thành công! Vui lòng chờ nhà hàng xác nhận.',
      data: booking.toPublicJSON(),
    });
  } catch (error) {
    console.error('❌ [CreateBooking] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi tạo đặt bàn' });
  }
};

const createBooking = async (req, res) => {
  try {
    const result = await bookingApplicationService.createBooking({
      actor: {
        userId: req.user._id,
        user: req.user,
      },
      command: req.body,
      context: {
        customer: req.user,
        io: req.app.get('io'),
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Đặt bàn thành công! Vui lòng chờ nhà hàng xác nhận.',
      data: result.booking.toPublicJSON(),
    });
  } catch (error) {
    if (error instanceof BookingApplicationError) {
      const legacyStatus = [409, 422].includes(error.statusCode)
        ? 400
        : error.statusCode;
      return res.status(legacyStatus).json({
        success: false,
        message: error.message,
        ...(error.errors ? { errors: error.errors } : {}),
      });
    }
    console.error('❌ [CreateBooking] Lỗi:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ khi tạo đặt bàn',
    });
  }
};

/**
 * B. Lấy Lịch Sử Đặt Bàn (GET /api/v1/bookings/my)
 */
const getMyBookings = async (req, res) => {
  try {
    const customerId = req.user._id;
    const filterType = req.query.filter || 'all'; // all, upcoming, past, cancelled
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    const query = { customerId };
    const today = bookingService.normalizeDate(new Date());

    if (filterType === 'upcoming') {
      query.bookingDate = { $gte: today };
      query.status = { $in: ['pending', 'confirmed'] };
    } else if (filterType === 'past') {
      query.$or = [
        { bookingDate: { $lt: today } },
        { status: { $in: ['completed', 'no_show'] } },
      ];
    } else if (filterType === 'cancelled') {
      query.status = 'cancelled';
    }

    const [bookings, total] = await Promise.all([
      Booking.find(query)
        .populate('restaurantId', 'name address images logo phoneNumber')
        .sort({ bookingDate: -1, bookingTime: -1 })
        .skip(skip)
        .limit(limit),
      Booking.countDocuments(query),
    ]);

    return res.json({
      success: true,
      data: {
        bookings: bookings.map(b => {
          const item = b.toPublicJSON();
          // Attach populated restaurant info
          if (b.restaurantId) {
            item.restaurant = {
              name: b.restaurantId.name,
              address: b.restaurantId.address,
              primaryImage: b.restaurantId.images?.find(i => i.isPrimary)?.url || b.restaurantId.images?.[0]?.url || null,
              logo: b.restaurantId.logo,
              phoneNumber: b.restaurantId.phoneNumber,
            };
          }
          return item;
        }),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('❌ [GetMyBookings] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi tải danh sách đặt bàn' });
  }
};

/**
 * C. Xem Chi Tiết Đặt Bàn (GET /api/v1/bookings/:id)
 */
const getBookingById = async (req, res) => {
  try {
    // req.booking đã được verify và gán ở middleware verifyCustomerBookingAccess
    const booking = await Booking.findById(req.booking._id)
      .populate('restaurantId', 'name address images logo phoneNumber operatingHours');

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy đặt bàn' });
    }

    const data = booking.toPublicJSON();
    if (booking.restaurantId) {
      data.restaurant = {
        name: booking.restaurantId.name,
        address: booking.restaurantId.address,
        primaryImage: booking.restaurantId.images?.find(i => i.isPrimary)?.url || booking.restaurantId.images?.[0]?.url || null,
        logo: booking.restaurantId.logo,
        phoneNumber: booking.restaurantId.phoneNumber,
        operatingHours: booking.restaurantId.operatingHours,
      };
    }

    // Trả thêm timeline lịch sử trạng thái cho customer xem
    data.statusHistory = booking.statusHistory;

    return res.json({ success: true, data });
  } catch (error) {
    console.error('❌ [GetBookingById] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi tải chi tiết đặt bàn' });
  }
};

/**
 * D. Cập Nhật Đặt Bàn (PUT /api/v1/bookings/:id)
 */
const updateBooking = async (req, res) => {
  try {
    const booking = req.booking; // Từ middleware verifyCustomerBookingAccess
    const customerId = req.user._id;

    if (!['pending', 'confirmed'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: 'Chỉ có thể cập nhật đặt bàn ở trạng thái chờ duyệt hoặc đã xác nhận',
      });
    }

    const bookingDateTime = bookingService.combineDateAndTime(booking.bookingDate, booking.bookingTime);
    if (bookingDateTime <= new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Không thể cập nhật đặt bàn đã diễn ra',
      });
    }

    const {
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

    const restaurant = await Restaurant.findById(booking.restaurantId);
    if (!restaurant) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy thông tin nhà hàng' });
    }

    // Nếu thay đổi ngày/giờ/số lượng khách hoặc bàn -> cần re-validate
    const isDateTimeOrGuestsChanged =
      bookingDate !== undefined && bookingDate !== booking.bookingDate.toISOString().split('T')[0] ||
      bookingTime !== undefined && bookingTime !== booking.bookingTime ||
      numberOfGuests !== undefined && numberOfGuests !== booking.numberOfGuests;

    const isTablesChanged = tableNumbers !== undefined && JSON.stringify(tableNumbers) !== JSON.stringify(booking.tableNumbers);

    let finalDate = bookingDate || booking.bookingDate;
    let finalTime = bookingTime || booking.bookingTime;
    let finalGuests = numberOfGuests || booking.numberOfGuests;
    let finalTables = tableNumbers || booking.tableNumbers;

    if (isDateTimeOrGuestsChanged) {
      const timeValidation = await bookingService.validateBookingTime(finalDate, finalTime, restaurant);
      if (!timeValidation.valid) {
        return res.status(400).json({ success: false, message: 'Thời gian mới không hợp lệ', errors: timeValidation.errors });
      }
    }

    if (isDateTimeOrGuestsChanged || isTablesChanged) {
      if (finalTables.length > 0) {
        const capacityValidation = await bookingService.validateTableCapacity(finalTables, finalGuests, booking.restaurantId);
        if (!capacityValidation.valid) {
          return res.status(400).json({ success: false, message: 'Lựa chọn bàn mới không hợp lệ', errors: capacityValidation.errors });
        }

        // Check conflict loại trừ chính booking này
        for (const tableNumber of finalTables) {
          const { hasConflict } = await bookingService.checkTimeConflict(
            booking.restaurantId,
            tableNumber,
            finalDate,
            finalTime,
            booking._id
          );
          if (hasConflict) {
            return res.status(400).json({
              success: false,
              message: `Bàn ${tableNumber} đã được đặt trong khung giờ mới`,
            });
          }
        }
      } else {
        // Tự động tìm bàn trống mới
        const availability = await bookingService.checkAvailability(
          booking.restaurantId,
          finalDate,
          finalTime,
          finalGuests
        );

        if (!availability.available) {
          return res.status(400).json({
            success: false,
            message: 'Hết bàn trống phù hợp cho thời gian thay đổi',
          });
        }
        finalTables = availability.suggestedTables.map(t => t.tableNumber);
      }
    }

    // Thực hiện cập nhật
    if (bookingDate !== undefined) booking.bookingDate = bookingService.normalizeDate(bookingDate);
    if (bookingTime !== undefined) booking.bookingTime = bookingTime;
    if (numberOfGuests !== undefined) booking.numberOfGuests = numberOfGuests;
    if (customerName !== undefined) booking.customerName = customerName;
    if (customerPhone !== undefined) booking.customerPhone = customerPhone;
    if (customerEmail !== undefined) booking.customerEmail = customerEmail;
    if (specialRequests !== undefined) booking.specialRequests = specialRequests;
    if (occasion !== undefined) booking.occasion = occasion;
    booking.tableNumbers = finalTables;

    // Ghi nhận lịch sử thay đổi
    booking.statusHistory.push({
      status: booking.status,
      changedBy: customerId,
      note: 'Khách hàng cập nhật thông tin đặt bàn',
    });

    await booking.save();

    return res.json({
      success: true,
      message: 'Cập nhật đặt bàn thành công',
      data: booking.toPublicJSON(),
    });
  } catch (error) {
    console.error('❌ [UpdateBooking] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi cập nhật đặt bàn' });
  }
};

/**
 * E. Hủy Đặt Bàn (DELETE /api/v1/bookings/:id/cancel)
 */
const cancelBooking = async (req, res) => {
  try {
    const booking = req.booking; // Từ middleware verifyCustomerBookingAccess
    const customerId = req.user._id;
    const { reason } = req.body;

    if (!booking.canCancel()) {
      return res.status(400).json({
        success: false,
        message: 'Không thể hủy đặt bàn ở trạng thái hiện tại hoặc đặt bàn đã diễn ra',
      });
    }

    booking.status = 'cancelled';
    booking.cancelledBy = 'customer';
    booking.cancelledAt = new Date();
    booking.cancellationReason = reason || 'Khách hàng chủ động hủy';
    
    booking.statusHistory.push({
      status: 'cancelled',
      changedBy: customerId,
      note: reason || 'Khách hàng hủy đặt bàn',
    });

    await booking.save();

    // Release table reservations
    bookingService.releaseTableReservations(booking._id).catch(() => {});

    // Reverse voucher redemption if any
    if (booking.voucherId) {
      try {
        const voucherService = require('../services/voucher.service');
        await voucherService.reverseRedemption(booking._id, reason || 'Khách hàng hủy đặt bàn', req.user);
      } catch (reverseErr) {
        console.error('❌ Lỗi hoàn nguyên voucher khi hủy đặt bàn:', reverseErr.message);
      }
    }

    bookingCommissionService.markCancelledForBooking(
      booking._id,
      `Khách hàng huỷ booking trước khi phí trở thành khoản phải thu: ${booking.cancellationReason}`
    ).catch((error) => {
      console.warn(`[BookingCommission/customer-cancelled] ${error.message}`);
    });

    const restaurant = await Restaurant.findById(booking.restaurantId);
    const refundService = require('../services/refund.service');
    const refund = await refundService.autoRefund(booking, restaurant, req.user._id, 'customer');

    // Gửi thông báo real-time qua Socket.io
    const io = req.app.get('io');
    emitBookingEvent(io, `restaurant:${booking.restaurantId.toString()}`, 'booking:cancelled', {
      bookingId: booking._id,
      restaurantId: booking.restaurantId,
      customerId,
      cancelledBy: 'customer',
      reason: booking.cancellationReason,
    });
    sendNotification(
      notificationService.notifyBookingStatusChanged(io, {
        booking,
        restaurant,
        status: 'cancelled',
        reason: booking.cancellationReason,
        actorRole: 'customer',
      }),
      'cancelled'
    );
    sendBookingEmail(
      emailService.sendBookingCancelledEmail(req.user, null, booking, booking.cancellationReason),
      'cancelled'
    );

    return res.json({
      success: true,
      message: 'Hủy đặt bàn thành công',
      data: refund ? { refundAmount: refund.amount, refundId: refund._id } : { refundAmount: 0 },
    });
  } catch (error) {
    console.error('❌ [CancelBooking] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi hủy đặt bàn' });
  }
};

/**
 * F1. Hold Tables (POST /api/v1/bookings/hold-tables)
 */
const holdTables = async (req, res) => {
  try {
    const { restaurantId, bookingDate, bookingTime, tableNumbers } = req.body;
    const userId = req.user?._id;

    if (!restaurantId || !bookingDate || !bookingTime || !tableNumbers?.length) {
      return res.status(400).json({ success: false, message: 'Thiếu thông tin giữ bàn' });
    }

    const result = await bookingService.holdTables({
      restaurantId, tableNumbers, bookingDate, bookingTime,
      userId: userId || null,
      sessionId: userId ? undefined : (req.headers['x-session-id'] || null),
    });

    if (!result.success) {
      return res.status(409).json({ success: false, message: result.message, conflictTables: result.conflictTables });
    }

    return res.json({ success: true, data: { expiresAt: result.expiresAt } });
  } catch (error) {
    console.error(' HoldTables Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi giữ bàn' });
  }
};

/**
 * F2. Release Holds (POST /api/v1/bookings/release-holds)
 */
const releaseHolds = async (req, res) => {
  try {
    const { restaurantId, bookingDate, bookingTime } = req.body;
    const userId = req.user?._id;

    await bookingService.releaseHolds({
      restaurantId, bookingDate, bookingTime,
      userId: userId || null,
      sessionId: userId ? undefined : (req.headers['x-session-id'] || null),
    });

    return res.json({ success: true, message: 'Đã giải phóng giữ bàn' });
  } catch (error) {
    console.error(' ReleaseHolds Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi giải phóng giữ bàn' });
  }
};

/**
 * F. Kiểm Tra Bàn Trống (POST /api/v1/bookings/availability-check)
 */
const checkAvailability = async (req, res) => {
  try {
    const { restaurantId, bookingDate, bookingTime, numberOfGuests } = req.body;
    const userId = req.user?._id;

    if (!restaurantId || !bookingDate || !bookingTime || !numberOfGuests) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp đầy đủ thông tin: restaurantId, bookingDate, bookingTime, numberOfGuests',
      });
    }

    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) {
      return res.status(404).json({ success: false, message: 'Nhà hàng không tồn tại' });
    }

    // Kiểm tra giờ hoạt động
    const timeValidation = await bookingService.validateBookingTime(bookingDate, bookingTime, restaurant);
    if (!timeValidation.valid) {
      return res.json({
        success: true,
        data: {
          available: false,
          availableTables: [],
          suggestedTables: [],
          conflicts: timeValidation.errors,
        },
      });
    }

    // Kiểm tra bàn trống
    const availability = await bookingService.checkAvailability(
      restaurantId,
      bookingDate,
      bookingTime,
      numberOfGuests,
      userId || undefined
    );

    return res.json({
      success: true,
      data: availability,
    });
  } catch (error) {
    console.error('❌ [CheckAvailability] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi kiểm tra bàn trống' });
  }
};

/**
 * G. Reschedule Booking (PUT /api/v1/bookings/:id/reschedule)
 */
const rescheduleBooking = async (req, res) => {
  try {
    const { newDate, newTime, newTableNumbers } = req.body;
    const booking = req.booking;

    if (!['pending', 'confirmed'].includes(booking.status)) {
      return res.status(400).json({ success: false, message: 'Chỉ có thể đổi lịch khi đặt bàn đang chờ xác nhận hoặc đã xác nhận' });
    }

    if (new Date(booking.bookingDate) <= new Date()) {
      return res.status(400).json({ success: false, message: 'Không thể đổi lịch cho đặt bàn đã qua' });
    }

    const restaurant = await Restaurant.findById(booking.restaurantId);

    const timeValidation = await bookingService.validateBookingTime(newDate, newTime, restaurant);
    if (!timeValidation.valid) {
      return res.status(400).json({ success: false, message: 'Thời gian mới không hợp lệ', errors: timeValidation.errors });
    }

    // Determine which tables to use: new selection or existing ones
    let targetTables = newTableNumbers || booking.tableNumbers || [];

    if (targetTables.length > 0) {
      const capacityValidation = await bookingService.validateTableCapacity(targetTables, booking.numberOfGuests, booking.restaurantId);
      if (!capacityValidation.valid) {
        return res.status(400).json({ success: false, message: 'Bàn mới không phù hợp', errors: capacityValidation.errors });
      }
    } else {
      const availability = await bookingService.checkAvailability(booking.restaurantId, newDate, newTime, booking.numberOfGuests);
      if (!availability.available) {
        return res.status(400).json({ success: false, message: 'Hết bàn trống vào thời gian mới' });
      }
      targetTables = availability.suggestedTables.map(t => t.tableNumber);
    }

    // Release old reservations and create new ones
    await bookingService.releaseTableReservations(booking._id);
    const normalizedDate = bookingService.normalizeDate(newDate);

    if (targetTables.length > 0) {
      const reservation = await bookingService.reserveTables(
        booking.restaurantId, targetTables, newDate, newTime, booking._id
      );
      if (!reservation.success) {
        return res.status(409).json({ success: false, message: reservation.message, errorCode: reservation.error });
      }
    }

    // Store old values for history
    const oldDate = booking.bookingDate;
    const oldTime = booking.bookingTime;

    booking.bookingDate = normalizedDate;
    booking.bookingTime = newTime;
    booking.tableNumbers = targetTables;
    booking.rescheduleHistory.push({
      fromDate: oldDate,
      fromTime: oldTime,
      toDate: normalizedDate,
      toTime: newTime,
      rescheduledAt: new Date(),
      rescheduledBy: req.user._id,
    });

    await booking.save();

    // Notify restaurant
    const io = req.app.get('io');
    emitBookingEvent(io, `restaurant:${booking.restaurantId}`, 'booking:rescheduled', {
      bookingId: booking._id,
      restaurantId: booking.restaurantId,
      oldDate, oldTime, newDate: normalizedDate, newTime,
    });

    return res.json({ success: true, message: 'Đổi lịch đặt bàn thành công', data: booking.toPublicJSON() });
  } catch (error) {
    console.error('❌ [RescheduleBooking] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi đổi lịch đặt bàn' });
  }
};

/**
 * H. Update Pre-Order Items (PUT /api/v1/bookings/:id/pre-order)
 */
const updatePreOrder = async (req, res) => {
  try {
    const booking = req.booking;
    const { items } = req.body;

    if (!['pending', 'confirmed'].includes(booking.status)) {
      return res.status(400).json({ success: false, message: 'Chỉ có thể đặt món cho đặt bàn đang chờ hoặc đã xác nhận' });
    }

    if (!Array.isArray(items)) {
      return res.status(400).json({ success: false, message: 'Danh sách món không hợp lệ' });
    }

    booking.preOrderItems = items.map((item) => ({
      menuItemId: item.menuItemId,
      nameSnapshot: item.name,
      priceSnapshot: item.price,
      quantity: Math.max(1, item.quantity || 1),
      note: item.note || null,
    }));

    await booking.save();

    return res.json({ success: true, message: 'Cập nhật món đặt trước thành công', data: booking.toPublicJSON() });
  } catch (error) {
    console.error('❌ [UpdatePreOrder] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi cập nhật món đặt trước' });
  }
};

/**
 * I. Check-in (PUT /api/v1/bookings/:id/checkin)
 */
const checkIn = async (req, res) => {
  try {
    const booking = req.booking;

    if (booking.status !== 'confirmed') {
      return res.status(400).json({ success: false, message: 'Chỉ có thể check-in khi đặt bàn đã được xác nhận' });
    }

    if (booking.checkedInAt) {
      return res.status(400).json({ success: false, message: 'Đã check-in trước đó' });
    }

    booking.checkedInAt = new Date();
    booking.statusHistory.push({
      status: booking.status,
      changedBy: req.user._id,
      note: 'Khách hàng đã check-in tại quầy',
    });

    await booking.save();

    const io = req.app.get('io');
    emitBookingEvent(io, `restaurant:${booking.restaurantId}`, 'booking:checked-in', {
      bookingId: booking._id,
      restaurantId: booking.restaurantId,
    });

    return res.json({ success: true, message: 'Check-in thành công', data: booking.toPublicJSON() });
  } catch (error) {
    console.error('❌ [CheckIn] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi check-in' });
  }
};

module.exports = {
  createBooking,
  getMyBookings,
  getBookingById,
  updateBooking,
  cancelBooking,
  checkAvailability,
  rescheduleBooking,
  holdTables,
  releaseHolds,
  updatePreOrder,
  checkIn,
};
