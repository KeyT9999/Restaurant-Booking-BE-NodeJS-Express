'use strict';

const bookingService = require('../../booking.service');
const restaurantQueryService = require('../../restaurant-query.service');
const voucherService = require('../../voucher.service');
const { makeToolError } = require('./public-customer.tools');
const bookingTimeUtils = require('../../../utils/booking-time');

const BOOKEAT_TIMEZONE = bookingTimeUtils.BUSINESS_TIME_ZONE;

const asStringOrNull = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const isValidDateString = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const isValidTimeString = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));

const toLocalDateTimeLabel = (bookingDate, bookingTime) => (
  bookingTimeUtils.toBusinessIsoString(bookingTimeUtils.getBookingStartAt(bookingDate, bookingTime))
);

const toRestaurantSummary = (restaurant) => ({
  id: restaurant.id,
  name: restaurant.name,
  address: restaurant.address || null,
  detailUrl: `/restaurants/${restaurant.id}`,
});

const toSafeTable = (table) => ({
  tableNumber: table.tableNumber,
  capacity: table.capacity,
  zone: table.zone || null,
});

const toVoucherConditions = (voucher) => {
  if (!voucher) return null;

  return {
    discountType: voucher.discountType || null,
    discountValue: typeof voucher.discountValue === 'number' ? voucher.discountValue : null,
    minOrderAmount: typeof voucher.minOrderAmount === 'number' ? voucher.minOrderAmount : 0,
    maxDiscountAmount: typeof voucher.maxDiscountAmount === 'number' ? voucher.maxDiscountAmount : null,
    validUntil: voucher.endDate ? new Date(voucher.endDate).toISOString() : null,
    restaurantId: voucher.restaurantId ? voucher.restaurantId.toString() : null,
  };
};

const makeAvailabilityPayload = ({
  restaurant,
  bookingDate,
  bookingTime,
  numberOfGuests,
  available,
  suggestedTables = [],
  conflicts = [],
  status = available ? 'available' : 'unavailable',
  reason = null,
}) => ({
  type: 'availability_result',
  version: 1,
  payload: {
    status,
    available: Boolean(available),
    restaurant: toRestaurantSummary(restaurant),
    bookingDate,
    bookingTime,
    numberOfGuests,
    timezone: BOOKEAT_TIMEZONE,
    localDateTime: toLocalDateTimeLabel(bookingDate, bookingTime),
    suggestedTables: suggestedTables.map(toSafeTable),
    alternativeTimes: [],
    conflicts,
    reason,
    checkedAt: new Date().toISOString(),
    disclaimer: 'K\u1ebft qu\u1ea3 ch\u1ec9 ph\u1ea3n \u00e1nh th\u1eddi \u0111i\u1ec3m ki\u1ec3m tra v\u00e0 s\u1ebd \u0111\u01b0\u1ee3c x\u00e1c nh\u1eadn l\u1ea1i trong lu\u1ed3ng \u0111\u1eb7t b\u00e0n.',
    bookingUrl: `/restaurants/${restaurant.id}?bookingDate=${encodeURIComponent(bookingDate)}&bookingTime=${encodeURIComponent(bookingTime)}&guests=${encodeURIComponent(numberOfGuests)}`,
    sourceLabel: 'BookEat table availability',
  },
});

const createCustomerDynamicTools = ({
  restaurantService = restaurantQueryService,
  booking = bookingService,
  voucher = voucherService,
} = {}) => ({
  async check_table_availability(args = {}) {
    const {
      restaurantId,
      bookingDate,
      bookingTime,
      numberOfGuests,
    } = args;

    if (!restaurantService.isValidObjectId(restaurantId)) {
      throw makeToolError('TOOL_INVALID_ARGUMENT', 'restaurantId is invalid.');
    }
    if (!isValidDateString(bookingDate) || !isValidTimeString(bookingTime)) {
      throw makeToolError('TOOL_INVALID_ARGUMENT', 'bookingDate or bookingTime is invalid.');
    }
    if (!Number.isInteger(numberOfGuests) || numberOfGuests < 1 || numberOfGuests > 100) {
      throw makeToolError('TOOL_INVALID_ARGUMENT', 'numberOfGuests is invalid.');
    }

    const restaurant = await restaurantService.getPublicRestaurantOperationalProfile(restaurantId);
    if (!restaurant) {
      throw makeToolError('RESTAURANT_NOT_FOUND', 'Restaurant was not found or is not public.');
    }

    if (!restaurant.hasTableLayout) {
      return makeAvailabilityPayload({
        restaurant,
        bookingDate,
        bookingTime,
        numberOfGuests,
        available: false,
        status: 'unavailable',
        conflicts: ['TABLE_LAYOUT_UNAVAILABLE'],
        reason: 'Nh\u00e0 h\u00e0ng ch\u01b0a c\u00f3 s\u01a1 \u0111\u1ed3 b\u00e0n c\u00f4ng khai \u0111\u1ec3 ki\u1ec3m tra t\u1ef1 \u0111\u1ed9ng.',
      });
    }

    const timeValidation = await booking.validateBookingTime(bookingDate, bookingTime, restaurant);
    if (!timeValidation.valid) {
      return makeAvailabilityPayload({
        restaurant,
        bookingDate,
        bookingTime,
        numberOfGuests,
        available: false,
        status: 'invalid_time',
        conflicts: timeValidation.errors || [],
        reason: (timeValidation.errors || [])[0] || 'Th\u1eddi gian \u0111\u1eb7t b\u00e0n kh\u00f4ng h\u1ee3p l\u1ec7.',
      });
    }

    const availability = await booking.checkAvailability(
      restaurantId,
      bookingDate,
      bookingTime,
      numberOfGuests,
    );

    return makeAvailabilityPayload({
      restaurant,
      bookingDate,
      bookingTime,
      numberOfGuests,
      available: availability.available,
      suggestedTables: availability.suggestedTables || [],
      conflicts: availability.conflicts || [],
      reason: availability.available
        ? null
        : (availability.conflicts || [])[0] || 'Kh\u00f4ng c\u00f3 b\u00e0n ph\u00f9 h\u1ee3p cho khung gi\u1edd n\u00e0y.',
    });
  },

  async validate_voucher(args = {}, context = {}) {
    const code = asStringOrNull(args.code)?.toUpperCase();
    const restaurantId = asStringOrNull(args.restaurantId);
    const orderAmountEstimate = typeof args.orderAmountEstimate === 'number'
      && Number.isFinite(args.orderAmountEstimate)
      ? args.orderAmountEstimate
      : null;
    const customerId = context.actor?.userId || context.user?._id || context.user?.id || null;

    if (!code) {
      throw makeToolError('TOOL_INVALID_ARGUMENT', 'Voucher code is required.');
    }
    if (restaurantId && !restaurantService.isValidObjectId(restaurantId)) {
      throw makeToolError('TOOL_INVALID_ARGUMENT', 'restaurantId is invalid.');
    }

    let restaurant = null;
    if (restaurantId) {
      restaurant = await restaurantService.getPublicRestaurantOperationalProfile(restaurantId);
      if (!restaurant) {
        throw makeToolError('RESTAURANT_NOT_FOUND', 'Restaurant was not found or is not public.');
      }
    }

    const basePayload = {
      code,
      restaurant: restaurant ? toRestaurantSummary(restaurant) : null,
      orderAmountEstimate,
      checkedAt: new Date().toISOString(),
      disclaimer: 'Gi\u1ea3m gi\u00e1 ch\u1ec9 l\u00e0 \u01b0\u1edbc t\u00ednh theo s\u1ed1 ti\u1ec1n b\u1ea1n cung c\u1ea5p v\u00e0 s\u1ebd \u0111\u01b0\u1ee3c ki\u1ec3m tra l\u1ea1i khi \u0111\u1eb7t b\u00e0n.',
      sourceLabel: 'BookEat voucher validation',
    };

    if (orderAmountEstimate === null) {
      return {
        type: 'voucher_result',
        version: 1,
        payload: {
          ...basePayload,
          valid: false,
          status: 'needs_input',
          authRequired: false,
          missingFields: ['orderAmountEstimate'],
          reason: 'C\u1ea7n gi\u00e1 tr\u1ecb \u0111\u01a1n ho\u1eb7c \u0111\u1eb7t c\u1ecdc d\u1ef1 ki\u1ebfn \u0111\u1ec3 ki\u1ec3m tra voucher.',
          discountAmountEstimate: 0,
          conditions: null,
        },
      };
    }

    const validation = await voucher.validateVoucher(
      code,
      restaurantId || null,
      customerId,
      orderAmountEstimate,
      { readOnly: true },
    );
    const conditions = toVoucherConditions(validation.voucher);

    if (validation.valid && conditions?.restaurantId && !restaurantId) {
      return {
        type: 'voucher_result',
        version: 1,
        payload: {
          ...basePayload,
          valid: false,
          status: 'needs_input',
          authRequired: false,
          missingFields: ['restaurantId'],
          reason: 'Voucher n\u00e0y c\u1ea7n th\u00f4ng tin nh\u00e0 h\u00e0ng \u0111\u1ec3 ki\u1ec3m tra ch\u00ednh x\u00e1c.',
          discountAmountEstimate: 0,
          conditions,
        },
      };
    }

    return {
      type: 'voucher_result',
      version: 1,
      payload: {
        ...basePayload,
        valid: Boolean(validation.valid),
        status: validation.valid ? 'valid' : 'invalid',
        authRequired: false,
        reason: validation.reason || null,
        discountAmountEstimate: Number(validation.discountAmount) || 0,
        conditions,
      },
    };
  },
});

module.exports = {
  BOOKEAT_TIMEZONE,
  createCustomerDynamicTools,
  isValidDateString,
  isValidTimeString,
};
