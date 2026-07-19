'use strict';

const mongoose = require('mongoose');
const { getAiConfig } = require('../../config/ai.config');
const RestaurantTable = require('../../models/RestaurantTable');
const Voucher = require('../../models/Voucher');
const bookingService = require('../booking.service');
const restaurantQueryService = require('../restaurant-query.service');
const voucherService = require('../voucher.service');
const { createAiPendingActionService } = require('./ai-pending-action.service');
const { isValidDateString, isValidTimeString } = require('./tools/customer-dynamic.tools');
const bookingTimeUtils = require('../../utils/booking-time');

const BOOKING_TIMEZONE = bookingTimeUtils.BUSINESS_TIME_ZONE;
const VALID_OCCASIONS = new Set(['birthday', 'anniversary', 'business', 'date', 'family', 'other']);
const PHONE_PATTERN = /^(0[35789][0-9]{8}|02[0-9]{9})$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class AiBookingWorkflowError extends Error {
  constructor(code, message, { status = 'failed', details = null } = {}) {
    super(message);
    this.name = 'AiBookingWorkflowError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const cleanString = (value, maxLength = 500) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
};

const uniqueStrings = (values = []) => (
  [...new Set(values.map((value) => cleanString(value, 50)).filter(Boolean))]
);

const resolveQuery = async (query, projection = null) => {
  let current = query;
  if (projection && typeof current?.select === 'function') current = current.select(projection);
  if (typeof current?.lean === 'function') current = current.lean();
  return current;
};

const requireValidContact = ({ customerName, customerPhone, customerEmail }) => {
  const missingFields = [];
  const invalidFields = [];

  if (!customerName) missingFields.push('customerName');
  if (!customerPhone) missingFields.push('customerPhone');
  if (!customerEmail) missingFields.push('customerEmail');
  if (customerPhone && !PHONE_PATTERN.test(customerPhone)) invalidFields.push('customerPhone');
  if (customerEmail && !EMAIL_PATTERN.test(customerEmail)) invalidFields.push('customerEmail');

  if (missingFields.length || invalidFields.length) {
    throw new AiBookingWorkflowError(
      'BOOKING_INFO_REQUIRED',
      'Cần bổ sung thông tin liên hệ hợp lệ trước khi tạo bản xem trước.',
      { details: { missingFields, invalidFields } },
    );
  }
};

const makeRestaurantPreview = (restaurant) => ({
  id: restaurant.id,
  name: restaurant.name,
  address: restaurant.address || null,
  detailUrl: `/restaurants/${restaurant.id}`,
});

const makeBookingPreview = ({
  restaurant,
  bookingDate,
  bookingTime,
  numberOfGuests,
  tableNumbers,
  customerName,
  customerPhone,
  customerEmail,
  specialRequests,
  occasion,
  depositAmount,
  discountAmount,
  voucherCode,
}) => ({
  restaurant: makeRestaurantPreview(restaurant),
  bookingDate,
  bookingTime,
  timezone: BOOKING_TIMEZONE,
  localDateTime: bookingTimeUtilsLabel(bookingDate, bookingTime),
  numberOfGuests,
  tableNumbers,
  tableAssignment: tableNumbers.length > 0 ? 'suggested' : 'restaurant_managed',
  contact: {
    name: customerName,
    phone: customerPhone,
    email: customerEmail,
  },
  specialRequests,
  occasion,
  depositAmount,
  voucher: voucherCode ? {
    code: voucherCode,
    discountAmount,
  } : null,
  discountAmount,
  amountDue: Math.max(0, depositAmount - discountAmount),
  disclaimer: 'Đây là bản xem trước, chưa phải booking thật. Bàn và voucher chưa được giữ.',
});

const bookingTimeUtilsLabel = (bookingDate, time) => (
  bookingTimeUtils.toBusinessIsoString(bookingTimeUtils.getBookingStartAt(bookingDate, time))
);

const validateBangkokBookingWindow = ({
  bookingDate,
  bookingTime,
  currentTime,
  constants = bookingService.BOOKING_CONSTANTS,
}) => {
  let localDateTime;
  try {
    localDateTime = bookingTimeUtils.getBookingStartAt(bookingDate, bookingTime);
  } catch {
    localDateTime = new Date(Number.NaN);
  }
  if (Number.isNaN(localDateTime.getTime())) {
    throw new AiBookingWorkflowError('INVALID_BOOKING_TIME', 'Thời gian đặt bàn không hợp lệ.');
  }

  const minAdvanceMinutes = constants?.MIN_BOOKING_ADVANCE_MINUTES ?? 30;
  const maxAdvanceDays = constants?.MAX_BOOKING_ADVANCE_DAYS ?? 30;
  const minAllowed = new Date(currentTime.getTime() + minAdvanceMinutes * 60 * 1000);
  const maxAllowed = new Date(currentTime.getTime() + maxAdvanceDays * 24 * 60 * 60 * 1000);

  if (localDateTime < minAllowed) {
    throw new AiBookingWorkflowError(
      'INVALID_BOOKING_TIME',
      `Phải đặt bàn trước ít nhất ${minAdvanceMinutes} phút.`,
    );
  }
  if (localDateTime > maxAllowed) {
    throw new AiBookingWorkflowError(
      'INVALID_BOOKING_TIME',
      `Không thể đặt trước quá ${maxAdvanceDays} ngày.`,
    );
  }

  return localDateTime;
};

const createAiBookingWorkflowService = ({
  restaurantService = restaurantQueryService,
  booking = bookingService,
  voucher = voucherService,
  tableModel = RestaurantTable,
  voucherModel = Voucher,
  pendingActions = createAiPendingActionService(),
  configProvider = getAiConfig,
  now = () => new Date(),
} = {}) => ({
  async prepareBooking(args = {}, context = {}) {
    const customerId = context.actor?.userId || context.user?._id || context.user?.id || null;
    if (!customerId) {
      throw new AiBookingWorkflowError('AUTH_REQUIRED', 'Bạn cần đăng nhập để chuẩn bị đặt bàn.', {
        status: 'forbidden',
      });
    }

    const restaurantId = cleanString(args.restaurantId, 24);
    const bookingDate = cleanString(args.bookingDate, 10);
    const bookingTime = cleanString(args.bookingTime, 5);
    const numberOfGuests = args.numberOfGuests;

    if (!restaurantService.isValidObjectId(restaurantId)) {
      throw new AiBookingWorkflowError('TOOL_INVALID_ARGUMENT', 'restaurantId không hợp lệ.');
    }
    if (!isValidDateString(bookingDate) || !isValidTimeString(bookingTime)) {
      throw new AiBookingWorkflowError('TOOL_INVALID_ARGUMENT', 'Ngày hoặc giờ đặt bàn không hợp lệ.');
    }
    if (!Number.isInteger(numberOfGuests) || numberOfGuests < 1 || numberOfGuests > 100) {
      throw new AiBookingWorkflowError('TOOL_INVALID_ARGUMENT', 'Số khách phải từ 1 đến 100.');
    }

    const restaurant = await restaurantService.getPublicRestaurantOperationalProfile(restaurantId);
    if (!restaurant) {
      throw new AiBookingWorkflowError('RESTAURANT_NOT_FOUND', 'Nhà hàng không tồn tại hoặc chưa hoạt động.');
    }

    const customerName = cleanString(args.customerName, 200)
      || cleanString(context.user?.fullName || context.user?.name, 200);
    const customerPhone = cleanString(args.customerPhone, 30)
      || cleanString(context.user?.phoneNumber || context.user?.phone, 30);
    const customerEmail = (
      cleanString(args.customerEmail, 200)
      || cleanString(context.user?.email, 200)
    )?.toLowerCase() || null;
    requireValidContact({ customerName, customerPhone, customerEmail });

    const occasion = cleanString(args.occasion, 30);
    if (occasion && !VALID_OCCASIONS.has(occasion)) {
      throw new AiBookingWorkflowError('TOOL_INVALID_ARGUMENT', 'Dịp đặc biệt không hợp lệ.');
    }
    const specialRequests = cleanString(args.specialRequests, 500)
      || cleanString(args.note, 500);

    validateBangkokBookingWindow({
      bookingDate,
      bookingTime,
      currentTime: now(),
      constants: booking.BOOKING_CONSTANTS,
    });
    const timeValidation = await booking.validateBookingTime(bookingDate, bookingTime, restaurant);
    if (!timeValidation.valid) {
      throw new AiBookingWorkflowError(
        'INVALID_BOOKING_TIME',
        'Thời gian đặt bàn không hợp lệ.',
        { details: { reasons: timeValidation.errors || [] } },
      );
    }

    let requestedTableNumbers = Array.isArray(args.tableNumbers)
      ? uniqueStrings(args.tableNumbers)
      : [];
    const tableId = cleanString(args.tableId, 24);
    if (tableId) {
      if (!mongoose.Types.ObjectId.isValid(tableId)) {
        throw new AiBookingWorkflowError('TOOL_INVALID_ARGUMENT', 'tableId không hợp lệ.');
      }
      const selectedTable = await resolveQuery(
        tableModel.findOne({ _id: tableId, restaurantId }),
        'tableNumber',
      );
      if (!selectedTable?.tableNumber) {
        throw new AiBookingWorkflowError('BOOKING_TABLE_UNAVAILABLE', 'Bàn đã chọn không thuộc nhà hàng.');
      }
      requestedTableNumbers = uniqueStrings([...requestedTableNumbers, selectedTable.tableNumber]);
    }

    let assignedTables = [];
    let tableRecords = [];
    if (requestedTableNumbers.length > 0) {
      const capacity = await booking.validateTableCapacity(
        requestedTableNumbers,
        numberOfGuests,
        restaurantId,
      );
      if (!capacity.valid) {
        throw new AiBookingWorkflowError('BOOKING_TABLE_UNAVAILABLE', 'Bàn đã chọn không phù hợp.', {
          details: { reasons: capacity.errors || [] },
        });
      }

      for (const tableNumber of requestedTableNumbers) {
        const conflict = await booking.checkTimeConflict(
          restaurantId,
          tableNumber,
          bookingDate,
          bookingTime,
        );
        if (conflict.hasConflict) {
          throw new AiBookingWorkflowError(
            'BOOKING_TABLE_UNAVAILABLE',
            `Bàn ${tableNumber} đã có lịch trong khung giờ này.`,
          );
        }
      }

      assignedTables = requestedTableNumbers;
      tableRecords = capacity.tables || [];
    } else if (restaurant.hasTableLayout) {
      const availability = await booking.checkAvailability(
        restaurantId,
        bookingDate,
        bookingTime,
        numberOfGuests,
      );
      if (!availability.available) {
        throw new AiBookingWorkflowError(
          'BOOKING_TABLE_UNAVAILABLE',
          'Không còn bàn phù hợp trong khung giờ này.',
          { details: { reasons: availability.conflicts || [] } },
        );
      }
      tableRecords = availability.suggestedTables || [];
      assignedTables = uniqueStrings(tableRecords.map((table) => table.tableNumber));
    }

    if (assignedTables.length > 0 && tableRecords.length === 0) {
      tableRecords = await resolveQuery(
        tableModel.find({
          restaurantId,
          tableNumber: { $in: assignedTables },
        }),
        'tableNumber depositAmount',
      );
    }

    const depositAmount = (tableRecords || []).reduce(
      (sum, table) => sum + Math.max(0, Number(table.depositAmount) || 0),
      0,
    );

    let voucherCode = cleanString(args.voucherCode, 60)?.toUpperCase() || null;
    const voucherIdInput = cleanString(args.voucherId, 24);
    let voucherId = null;
    let discountAmount = 0;
    if (voucherIdInput) {
      if (!mongoose.Types.ObjectId.isValid(voucherIdInput)) {
        throw new AiBookingWorkflowError('TOOL_INVALID_ARGUMENT', 'voucherId không hợp lệ.');
      }
      const voucherRecord = await resolveQuery(voucherModel.findById(voucherIdInput), 'code');
      if (!voucherRecord?.code) {
        throw new AiBookingWorkflowError('VOUCHER_INVALID', 'Voucher không tồn tại.');
      }
      const codeFromId = String(voucherRecord.code).toUpperCase();
      if (voucherCode && voucherCode !== codeFromId) {
        throw new AiBookingWorkflowError('VOUCHER_INVALID', 'voucherCode và voucherId không khớp.');
      }
      voucherCode = codeFromId;
    }

    if (voucherCode) {
      const validation = await voucher.validateVoucher(
        voucherCode,
        restaurantId,
        customerId,
        depositAmount,
        { readOnly: true },
      );
      if (!validation.valid) {
        throw new AiBookingWorkflowError('VOUCHER_INVALID', validation.reason || 'Voucher không hợp lệ.');
      }
      voucherId = validation.voucher?._id || null;
      discountAmount = Math.max(0, Number(validation.discountAmount) || 0);
    }

    const preview = makeBookingPreview({
      restaurant,
      bookingDate,
      bookingTime,
      numberOfGuests,
      tableNumbers: assignedTables,
      customerName,
      customerPhone,
      customerEmail,
      specialRequests,
      occasion,
      depositAmount,
      discountAmount,
      voucherCode,
    });
    const canonicalPayload = {
      customerId: customerId.toString(),
      restaurantId,
      bookingDate,
      bookingTime,
      bookingDateTime: preview.localDateTime,
      timezone: BOOKING_TIMEZONE,
      numberOfGuests,
      customerName,
      customerPhone,
      customerEmail,
      tableNumbers: assignedTables,
      voucherCode,
      voucherId: voucherId ? voucherId.toString() : null,
      specialRequests,
      occasion,
      depositAmount,
      discountAmount,
      amountDue: preview.amountDue,
    };

    const action = await pendingActions.createBookingPreview({
      userId: customerId,
      conversationId: context.requestId || null,
      payload: canonicalPayload,
      preview,
      requestId: context.requestId,
    });

    let confirmEnabled = true;
    try {
      confirmEnabled = configProvider().bookingConfirmEnabled !== false;
    } catch {
      confirmEnabled = false;
    }

    return {
      type: 'booking_preview',
      version: 1,
      payload: {
        pendingActionId: action._id.toString(),
        actionType: 'prepare_booking',
        status: action.status,
        preview,
        expiresAt: new Date(action.expiresAt).toISOString(),
        confirmEnabled,
      },
    };
  },
});

module.exports = {
  AiBookingWorkflowError,
  BOOKING_TIMEZONE,
  createAiBookingWorkflowService,
  makeBookingPreview,
  validateBangkokBookingWindow,
};
