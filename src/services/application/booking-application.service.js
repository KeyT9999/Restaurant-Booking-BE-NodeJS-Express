'use strict';

const mongoose = require('mongoose');
const Booking = require('../../models/Booking');
const Restaurant = require('../../models/Restaurant');
const RestaurantTable = require('../../models/RestaurantTable');
const bookingService = require('../booking.service');
const emailService = require('../email.service');
const notificationService = require('../notification.service');
const voucherService = require('../voucher.service');
const { buildCanonicalPreOrder } = require('../preorder.service');

const bookingCreateLocks = new Map();

class BookingApplicationError extends Error {
  constructor(code, message, {
    statusCode = 400,
    errors = null,
    cause = null,
  } = {}) {
    super(message);
    this.name = 'BookingApplicationError';
    this.code = code;
    this.statusCode = statusCode;
    this.errors = errors;
    this.cause = cause;
  }
}

const toIdString = (value) => value?.toString?.() || String(value || '');

const uniqueTableNumbers = (values = []) => (
  [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))]
);

const withBookingCreateLock = async (key, task) => {
  const previous = bookingCreateLocks.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => gate);
  bookingCreateLocks.set(key, queued);

  await previous;
  try {
    return await task();
  } finally {
    release();
    if (bookingCreateLocks.get(key) === queued) bookingCreateLocks.delete(key);
  }
};

const fireAndForget = (promise, label) => {
  Promise.resolve(promise).catch((error) => {
    console.warn(`[BookingApplication/${label}] ${error.message}`);
  });
};

const emitBookingEvent = (io, room, event, payload) => {
  if (!io) return;
  io.to(room).emit(event, payload);
};

const validateCommand = (command = {}) => {
  if (!mongoose.Types.ObjectId.isValid(String(command.restaurantId || ''))) {
    throw new BookingApplicationError(
      'BOOKING_POLICY_BLOCKED',
      'Thông tin nhà hàng không hợp lệ.',
      { statusCode: 422 },
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(command.bookingDate || ''))) {
    throw new BookingApplicationError(
      'BOOKING_POLICY_BLOCKED',
      'Ngày đặt bàn không hợp lệ.',
      { statusCode: 422 },
    );
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(command.bookingTime || ''))) {
    throw new BookingApplicationError(
      'BOOKING_POLICY_BLOCKED',
      'Giờ đặt bàn không hợp lệ.',
      { statusCode: 422 },
    );
  }
  if (
    !Number.isInteger(command.numberOfGuests)
    || command.numberOfGuests < 1
    || command.numberOfGuests > 100
  ) {
    throw new BookingApplicationError(
      'BOOKING_POLICY_BLOCKED',
      'Số khách phải từ 1 đến 100.',
      { statusCode: 422 },
    );
  }

  for (const field of ['customerName', 'customerPhone', 'customerEmail']) {
    if (typeof command[field] !== 'string' || !command[field].trim()) {
      throw new BookingApplicationError(
        'BOOKING_POLICY_BLOCKED',
        'Thông tin liên hệ đặt bàn không đầy đủ.',
        { statusCode: 422 },
      );
    }
  }
};

const createBookingApplicationService = ({
  bookingModel = Booking,
  restaurantModel = Restaurant,
  tableModel = RestaurantTable,
  booking = bookingService,
  voucher = voucherService,
  notifications = notificationService,
  email = emailService,
} = {}) => ({
  async createBooking({
    actor,
    command,
    context = {},
  }) {
    const customerId = actor?.userId || actor?._id || actor?.id;
    if (!mongoose.Types.ObjectId.isValid(String(customerId || ''))) {
      throw new BookingApplicationError(
        'PERMISSION_DENIED',
        'Không xác định được khách hàng tạo booking.',
        { statusCode: 403 },
      );
    }

    validateCommand(command);

    const normalizedDate = booking.normalizeDate(command.bookingDate);
    const lockKey = `${toIdString(command.restaurantId)}:${normalizedDate.toISOString().slice(0, 10)}`;

    return withBookingCreateLock(lockKey, async () => {
      const sourceAiPendingActionId = context.sourceAiPendingActionId || null;
      if (sourceAiPendingActionId) {
        const existingBooking = await bookingModel.findOne({ sourceAiPendingActionId });
        if (existingBooking) {
          return {
            booking: existingBooking,
            restaurant: await restaurantModel.findById(existingBooking.restaurantId),
            created: false,
            amountDue: Math.max(
              0,
              Number(existingBooking.depositAmount || 0)
                - Number(existingBooking.discountAmount || 0),
            ),
          };
        }
      }

      const restaurant = await restaurantModel.findById(command.restaurantId);
      if (!restaurant) {
        throw new BookingApplicationError(
          'RESTAURANT_NOT_FOUND',
          'Nhà hàng không tồn tại.',
          { statusCode: 404 },
        );
      }
      if (
        restaurant.approvalStatus !== 'approved'
        || !restaurant.active
        || restaurant.deletedAt
      ) {
        throw new BookingApplicationError(
          'BOOKING_POLICY_BLOCKED',
          'Nhà hàng hiện không nhận đặt bàn.',
          { statusCode: 422 },
        );
      }

      const timeValidation = await booking.validateBookingTime(
        command.bookingDate,
        command.bookingTime,
        restaurant,
      );
      if (!timeValidation.valid) {
        throw new BookingApplicationError(
          'BOOKING_POLICY_BLOCKED',
          'Thời gian đặt bàn không hợp lệ.',
          {
            statusCode: 422,
            errors: timeValidation.errors || [],
          },
        );
      }

      let assignedTables = uniqueTableNumbers(command.tableNumbers);
      if (assignedTables.length > 0) {
        const capacityValidation = await booking.validateTableCapacity(
          assignedTables,
          command.numberOfGuests,
          command.restaurantId,
        );
        if (!capacityValidation.valid) {
          throw new BookingApplicationError(
            'TABLE_NO_LONGER_AVAILABLE',
            'Bàn đã chọn không còn phù hợp. Vui lòng tạo bản xem trước mới.',
            {
              statusCode: 409,
              errors: capacityValidation.errors || [],
            },
          );
        }

        for (const tableNumber of assignedTables) {
          const conflict = await booking.checkTimeConflict(
            command.restaurantId,
            tableNumber,
            command.bookingDate,
            command.bookingTime,
          );
          if (conflict.hasConflict) {
            throw new BookingApplicationError(
              'TABLE_NO_LONGER_AVAILABLE',
              `Bàn ${tableNumber} vừa được đặt. Vui lòng tạo bản xem trước mới.`,
              { statusCode: 409 },
            );
          }
        }
      } else {
        const tableCount = await tableModel.countDocuments({
          restaurantId: command.restaurantId,
        });
        if (tableCount > 0) {
          const availability = await booking.checkAvailability(
            command.restaurantId,
            command.bookingDate,
            command.bookingTime,
            command.numberOfGuests,
          );
          if (!availability.available) {
            throw new BookingApplicationError(
              'TABLE_NO_LONGER_AVAILABLE',
              'Khung giờ này không còn bàn phù hợp. Vui lòng tạo bản xem trước mới.',
              {
                statusCode: 409,
                errors: availability.conflicts || [],
              },
            );
          }
          assignedTables = uniqueTableNumbers(
            (availability.suggestedTables || []).map((table) => table.tableNumber),
          );
        }
      }

      let tableRecords = [];
      if (assignedTables.length > 0) {
        tableRecords = await tableModel.find({
          restaurantId: command.restaurantId,
          tableNumber: { $in: assignedTables },
        });
      }
      const tableDepositAmount = tableRecords.reduce(
        (sum, table) => sum + Math.max(0, Number(table.depositAmount) || 0),
        0,
      );

      let preOrderItems = [];
      let foodTotalAmount = 0;
      if (Array.isArray(command.preOrderItems) && command.preOrderItems.length > 0) {
        const canonicalPreOrder = await buildCanonicalPreOrder({
          restaurantId: command.restaurantId,
          items: command.preOrderItems,
        });
        preOrderItems = canonicalPreOrder.items;
        foodTotalAmount = canonicalPreOrder.totalAmount;
      }

      const depositAmount = tableDepositAmount + Math.round(0.1 * foodTotalAmount);

      let voucherId = null;
      let discountAmount = 0;
      const voucherCode = typeof command.voucherCode === 'string'
        ? command.voucherCode.trim().toUpperCase()
        : null;
      if (voucherCode) {
        const validation = await voucher.validateVoucher(
          voucherCode,
          command.restaurantId,
          customerId,
          depositAmount,
          { readOnly: true },
        );
        const validatedVoucherId = validation.voucher?._id || null;
        if (
          !validation.valid
          || (
            command.voucherId
            && toIdString(validatedVoucherId) !== toIdString(command.voucherId)
          )
        ) {
          throw new BookingApplicationError(
            'VOUCHER_NO_LONGER_VALID',
            validation.reason
              ? `Voucher không còn hợp lệ: ${validation.reason}`
              : 'Voucher không còn hợp lệ. Vui lòng tạo bản xem trước mới.',
            { statusCode: 409 },
          );
        }
        voucherId = validatedVoucherId;
        discountAmount = Math.max(0, Number(validation.discountAmount) || 0);
      } else if (command.voucherId) {
        throw new BookingApplicationError(
          'VOUCHER_NO_LONGER_VALID',
          'Thông tin voucher không còn hợp lệ. Vui lòng tạo bản xem trước mới.',
          { statusCode: 409 },
        );
      }

      const bookingDocument = new bookingModel({
        customerId,
        restaurantId: command.restaurantId,
        bookingDate: normalizedDate,
        bookingTime: command.bookingTime,
        numberOfGuests: command.numberOfGuests,
        customerName: command.customerName.trim(),
        customerPhone: command.customerPhone.trim(),
        customerEmail: command.customerEmail.trim().toLowerCase(),
        specialRequests: command.specialRequests || null,
        occasion: command.occasion || null,
        tableNumbers: assignedTables,
        depositAmount,
        discountAmount,
        voucherId,
        originalAmount: depositAmount,
        finalAmount: Math.max(0, depositAmount - discountAmount),
        sourceAiPendingActionId,
        preOrderItems,
        status: 'pending',
        statusHistory: [{
          status: 'pending',
          changedBy: customerId,
          note: sourceAiPendingActionId
            ? 'Đặt bàn được xác nhận từ bản xem trước của Trợ lý BookEat'
            : 'Đặt bàn được khởi tạo bởi khách hàng',
        }],
      });

      let savedBooking;
      const persistBooking = async (session = null) => {
        savedBooking = await bookingDocument.save(session ? { session } : undefined);
        if (assignedTables.length > 0 && typeof booking.reserveTables === 'function') {
          const reservation = await booking.reserveTables(
            command.restaurantId,
            assignedTables,
            normalizedDate,
            command.bookingTime,
            savedBooking._id,
            session ? { session } : undefined,
          );
          if (!reservation.success) {
            throw new BookingApplicationError(
              'TABLE_NO_LONGER_AVAILABLE',
              reservation.message,
              { statusCode: 409 },
            );
          }
        }
      };

      // Plain test doubles do not expose a Mongoose connection. Real models always
      // take the transaction path so booking + table slots commit or roll back together.
      const supportsTransactions = Boolean(bookingModel?.db?.startSession);
      const session = supportsTransactions ? await bookingModel.db.startSession() : null;
      try {
        if (session) {
          await session.withTransaction(async () => {
            await persistBooking(session);
          });
        } else {
          await persistBooking();
        }
      } catch (error) {
        if (sourceAiPendingActionId && error?.code === 11000) {
          const existingBooking = await bookingModel.findOne({ sourceAiPendingActionId });
          if (existingBooking) {
            return {
              booking: existingBooking,
              restaurant,
              created: false,
              amountDue: Math.max(
                0,
                Number(existingBooking.depositAmount || 0)
                  - Number(existingBooking.discountAmount || 0),
              ),
            };
          }
        }
        throw error;
      } finally {
        if (session) await session.endSession();
      }

      const io = context.io || null;
      emitBookingEvent(
        io,
        `restaurant:${toIdString(command.restaurantId)}`,
        'booking:created',
        {
          bookingId: savedBooking._id,
          restaurantId: command.restaurantId,
          customerId,
          customerName: savedBooking.customerName,
          bookingDate: command.bookingDate,
          bookingTime: command.bookingTime,
          status: savedBooking.status,
          message: 'Có đặt bàn mới cần xác nhận',
        },
      );
      fireAndForget(
        notifications.notifyBookingCreated(io, {
          booking: savedBooking,
          restaurant,
          customer: context.customer || actor.user || null,
        }),
        'notification-created',
      );
      fireAndForget(
        email.sendBookingCreatedEmail(
          context.customer || actor.user || null,
          restaurant,
          savedBooking,
        ),
        'email-created',
      );

      return {
        booking: savedBooking,
        restaurant,
        created: true,
        amountDue: Math.max(0, depositAmount - discountAmount),
      };
    });
  },
});

module.exports = {
  BookingApplicationError,
  createBookingApplicationService,
  uniqueTableNumbers,
  validateCommand,
  withBookingCreateLock,
};
