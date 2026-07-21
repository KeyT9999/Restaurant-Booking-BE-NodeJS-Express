'use strict';

const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const RestaurantTable = require('../models/RestaurantTable');
const Restaurant = require('../models/Restaurant');
const User = require('../models/User');
const TableReservation = require('../models/TableReservation');
const BlockedSlot = require('../models/BlockedSlot');
const bookingConfig = require('../config/booking.config');
const bookingTimeUtils = require('../utils/booking-time');

const BOOKING_CONSTANTS = {
  MIN_BOOKING_ADVANCE_MINUTES: 30,
  MAX_BOOKING_ADVANCE_DAYS: 30,
  BOOKING_DURATION_HOURS: bookingConfig.durationMinutes / 60,
  BOOKING_DURATION_MINUTES: bookingConfig.durationMinutes,
  BUFFER_BEFORE_MINUTES: 90,
  BUFFER_AFTER_MINUTES: 120,
  DEFAULT_OPEN_TIME: '10:00',
  DEFAULT_CLOSE_TIME: '22:00',
};

const BOOKING_STATUS_TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'cancelled', 'no_show'],
  completed: [],
  cancelled: [],
  no_show: [],
};

const canTransitionBookingStatus = (currentStatus, nextStatus) => {
  const allowedStatuses = BOOKING_STATUS_TRANSITIONS[currentStatus] || [];
  return allowedStatuses.includes(nextStatus);
};

/**
 * Normalizes a date to UTC midnight.
 */
const normalizeDate = bookingTimeUtils.normalizeBusinessDate;

/**
 * Combines a date object/string and a HH:mm time string into a single JS Date.
 */
const combineDateAndTime = bookingTimeUtils.combineBusinessDateAndTime;

/**
 * Checks if a proposed booking time overlaps with an existing booking.
 */
const checkTimeConflict = async (restaurantId, tableNumber, bookingDate, bookingTime, excludeBookingId = null) => {
  const normalizedDate = normalizeDate(bookingDate);

  // Find all active bookings for this restaurant, table, and date
  const bookings = await Booking.find({
    restaurantId,
    bookingDate: normalizedDate,
    tableNumbers: tableNumber,
    status: { $in: ['pending', 'confirmed'] },
    _id: { $ne: excludeBookingId },
  });

  const newStart = combineDateAndTime(normalizedDate, bookingTime);
  const newEnd = new Date(newStart.getTime() + BOOKING_CONSTANTS.BOOKING_DURATION_HOURS * 60 * 60 * 1000);

  const conflictingBookings = [];

  for (const b of bookings) {
    const existingStart = combineDateAndTime(b.bookingDate, b.bookingTime);

    // Existing occupied interval: [existingStart - BUFFER_BEFORE, existingStart + DURATION + BUFFER_AFTER]
    const occupiedStart = new Date(existingStart.getTime() - BOOKING_CONSTANTS.BUFFER_BEFORE_MINUTES * 60 * 1000);
    const occupiedEnd = new Date(existingStart.getTime() + (BOOKING_CONSTANTS.BOOKING_DURATION_HOURS * 60 + BOOKING_CONSTANTS.BUFFER_AFTER_MINUTES) * 60 * 1000);

    // Overlap condition
    if (newStart < occupiedEnd && newEnd > occupiedStart) {
      conflictingBookings.push(b);
    }
  }

  return {
    hasConflict: conflictingBookings.length > 0,
    conflictingBookings,
  };
};

/**
 * Validates whether the booking time is within operating hours and advanced time limits.
 */
const validateBookingTime = async (bookingDate, bookingTime, restaurant) => {
  const errors = [];
  const now = new Date();

  const proposedDateTime = combineDateAndTime(bookingDate, bookingTime);

  // 1. Check if booking is in the past
  if (proposedDateTime <= now) {
    errors.push('Thời gian đặt bàn phải ở tương lai');
    return { valid: false, errors };
  }

  // 2. Check advance booking constraints (min 30 mins)
  const minAdvanceTime = new Date(now.getTime() + BOOKING_CONSTANTS.MIN_BOOKING_ADVANCE_MINUTES * 60 * 1000);
  if (proposedDateTime < minAdvanceTime) {
    errors.push(`Phải đặt bàn trước ít nhất ${BOOKING_CONSTANTS.MIN_BOOKING_ADVANCE_MINUTES} phút`);
  }

  // 3. Check advance booking constraints (max 30 days)
  const maxAdvanceTime = new Date(now.getTime() + BOOKING_CONSTANTS.MAX_BOOKING_ADVANCE_DAYS * 24 * 60 * 60 * 1000);
  if (proposedDateTime > maxAdvanceTime) {
    errors.push(`Không thể đặt trước quá ${BOOKING_CONSTANTS.MAX_BOOKING_ADVANCE_DAYS} ngày`);
  }

  // 4. Validate against operating hours
  const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayName = bookingTimeUtils.getBusinessWeekday(bookingDate);

  const hours = restaurant.operatingHours?.[dayName] || {
    open: BOOKING_CONSTANTS.DEFAULT_OPEN_TIME,
    close: BOOKING_CONSTANTS.DEFAULT_CLOSE_TIME,
    closed: false,
  };

  if (hours.closed) {
    errors.push('Nhà hàng đóng cửa vào ngày này');
    return { valid: errors.length === 0, errors };
  }

  const [openH, openM] = hours.open.split(':').map(Number);
  const [closeH, closeM] = hours.close.split(':').map(Number);

  const openTime = combineDateAndTime(bookingDate, hours.open);
  let closeTime = combineDateAndTime(bookingDate, hours.close);

  // If closing time is early morning the next day (e.g. close is 02:00, open is 10:00)
  if (closeTime <= openTime) {
    closeTime = new Date(closeTime.getTime() + 24 * 60 * 60 * 1000);
  }

  if (proposedDateTime < openTime || proposedDateTime > closeTime) {
    errors.push(`Giờ đặt bàn nằm ngoài thời gian hoạt động của nhà hàng (${hours.open} - ${hours.close})`);
  }

  // 5. Check against Blocked Slots (for full restaurant blocks)
  try {
    const normalizedDate = normalizeDate(bookingDate);
    const blockedSlots = await BlockedSlot.find({
      restaurantId: restaurant._id,
      date: normalizedDate,
    });

    const bookingEnd = new Date(proposedDateTime.getTime() + BOOKING_CONSTANTS.BOOKING_DURATION_HOURS * 60 * 60 * 1000);

    for (const slot of blockedSlots) {
      if (!slot.tableNumbers || slot.tableNumbers.length === 0) {
        if (slot.slotType === 'full_day') {
          errors.push(slot.reason ? `Nhà hàng đóng cửa hôm nay: ${slot.reason}` : 'Nhà hàng đóng cửa hôm nay');
          return { valid: false, errors };
        } else if (slot.slotType === 'time_range') {
          const blockStart = combineDateAndTime(bookingDate, slot.startTime);
          let blockEnd = combineDateAndTime(bookingDate, slot.endTime);
          if (blockEnd <= blockStart) {
            blockEnd = new Date(blockEnd.getTime() + 24 * 60 * 60 * 1000);
          }

          if (proposedDateTime < blockEnd && bookingEnd > blockStart) {
            errors.push(
              slot.reason
                ? `Khung giờ này nhà hàng không nhận khách: ${slot.reason} (${slot.startTime} - ${slot.endTime})`
                : `Khung giờ này nhà hàng không nhận khách (${slot.startTime} - ${slot.endTime})`
            );
            return { valid: false, errors };
          }
        }
      }
    }
  } catch (err) {
    console.error('Error validating blocked slots:', err);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

/**
 * Checks table capacities and active status.
 */
const validateTableCapacity = async (tableNumbers, numberOfGuests, restaurantId, options = {}) => {
  const { enforceMaxLimit = true } = options;
  const errors = [];

  if (!tableNumbers || tableNumbers.length === 0) {
    return { valid: true, errors, tables: [] };
  }

  const tables = await RestaurantTable.find({
    restaurantId,
    tableNumber: { $in: tableNumbers },
  });

  if (tables.length !== tableNumbers.length) {
    errors.push('Một hoặc nhiều bàn được chọn không tồn tại');
    return { valid: false, errors, tables };
  }

  let totalCapacity = 0;
  for (const table of tables) {
    if (!table.isActive) {
      errors.push(`Bàn ${table.tableNumber} hiện không hoạt động`);
    }
    if (['inactive', 'maintenance'].includes(table.status)) {
      errors.push(`Bàn ${table.tableNumber} đang bảo trì hoặc ngưng hoạt động`);
    }
    totalCapacity += table.capacity;
  }

  if (totalCapacity < numberOfGuests) {
    errors.push(`Tổng sức chứa của các bàn được chọn (${totalCapacity} chỗ) không đủ cho số khách (${numberOfGuests} người)`);
  }

  if (enforceMaxLimit && totalCapacity > numberOfGuests + 2) {
    errors.push(`Tổng sức chứa của các bàn được chọn (${totalCapacity} chỗ) vượt quá giới hạn tối đa cho phép cho ${numberOfGuests} khách (${numberOfGuests + 2} chỗ)`);
  }

  if (enforceMaxLimit && tables.length > 1) {
    const hasSufficientSingleTable = tables.some(t => t.capacity >= numberOfGuests);
    if (hasSufficientSingleTable) {
      errors.push(`Không thể chọn nhiều bàn khi đã có bàn đơn lẻ đủ sức chứa cho ${numberOfGuests} khách`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    tables,
  };
};

/**
 * Gets all active tables that are not occupied during the proposed time window.
 */
const getAvailableTables = async (
  restaurantId,
  bookingDate,
  bookingTime,
  excludeUserId,
  excludeSessionId,
  excludeBookingId = null
) => {
  // Find all active tables for the restaurant
  const allTables = await RestaurantTable.find({
    restaurantId,
    isActive: true,
    status: { $in: ['available', 'reserved'] },
  });

  // Get tables held by other users/sessions
  const heldTableNumbers = await getHeldTableNumbers({
    restaurantId, bookingDate, bookingTime,
    excludeUserId, excludeSessionId,
  });
  const heldSet = new Set(heldTableNumbers);

  // Check blocked slots for tables
  const blockedTableNumbers = [];
  try {
    const normalizedDate = normalizeDate(bookingDate);
    const blockedSlots = await BlockedSlot.find({
      restaurantId,
      date: normalizedDate,
    });

    const proposedDateTime = combineDateAndTime(bookingDate, bookingTime);
    const bookingEnd = new Date(proposedDateTime.getTime() + BOOKING_CONSTANTS.BOOKING_DURATION_HOURS * 60 * 60 * 1000);

    for (const slot of blockedSlots) {
      let overlaps = false;
      if (slot.slotType === 'full_day') {
        overlaps = true;
      } else if (slot.slotType === 'time_range') {
        const blockStart = combineDateAndTime(bookingDate, slot.startTime);
        let blockEnd = combineDateAndTime(bookingDate, slot.endTime);
        if (blockEnd <= blockStart) {
          blockEnd = new Date(blockEnd.getTime() + 24 * 60 * 60 * 1000);
        }
        if (proposedDateTime < blockEnd && bookingEnd > blockStart) {
          overlaps = true;
        }
      }

      if (overlaps) {
        if (!slot.tableNumbers || slot.tableNumbers.length === 0) {
          // If a slot blocks the entire restaurant, return empty array immediately
          return [];
        } else {
          blockedTableNumbers.push(...slot.tableNumbers);
        }
      }
    }
  } catch (err) {
    console.error('Error fetching blocked tables:', err);
  }

  const blockedSet = new Set(blockedTableNumbers);
  const availableTables = [];

  for (const table of allTables) {
    if (heldSet.has(table.tableNumber)) continue;
    if (blockedSet.has(table.tableNumber)) continue;
    const { hasConflict } = await checkTimeConflict(
      restaurantId,
      table.tableNumber,
      bookingDate,
      bookingTime,
      excludeBookingId
    );
    if (!hasConflict) {
      availableTables.push(table);
    }
  }

  return availableTables;
};

/**
 * Suggests best fitting table(s) based on capacity and zone.
 */
const suggestTables = (availableTables, numberOfGuests) => {
  const maxCapacity = numberOfGuests + 2;
  // Sort available tables by capacity in ascending order
  const sortedTables = [...availableTables].sort((a, b) => a.capacity - b.capacity);


  const singleTable = sortedTables.find(t => t.capacity >= numberOfGuests && t.capacity <= maxCapacity);
  if (singleTable) {
    return [singleTable];
  }


  const combo = [];
  let currentCapacity = 0;

  const descTables = [...sortedTables].reverse();
  for (const table of descTables) {
    if (currentCapacity + table.capacity <= maxCapacity) {
      combo.push(table);
      currentCapacity += table.capacity;
      if (currentCapacity >= numberOfGuests) {
        return combo;
      }
    }
  }

  return []; // Return empty if even all tables combined cannot host the guests within the limit
};

/**
 * Wrapper to check overall availability for a restaurant at a certain date and time.
 */
const checkAvailability = async (restaurantId, bookingDate, bookingTime, numberOfGuests, excludeUserId, excludeSessionId) => {
  const availableTables = await getAvailableTables(restaurantId, bookingDate, bookingTime, excludeUserId, excludeSessionId);
  const suggestedTables = suggestTables(availableTables, numberOfGuests);

  const totalAvailableCapacity = availableTables.reduce((sum, t) => sum + t.capacity, 0);
  const isAvailable = totalAvailableCapacity >= numberOfGuests && suggestedTables.length > 0;

  const allRestaurantTables = await RestaurantTable.find({
    restaurantId,
    isActive: true,
    status: { $nin: ['inactive', 'maintenance'] },
  });
  const maxPossibleCapacity = allRestaurantTables.reduce((sum, t) => sum + t.capacity, 0);
  const isCapacityPhysicallySufficient = maxPossibleCapacity >= numberOfGuests;

  return {
    available: isAvailable,
    availableTables,
    suggestedTables,
    insufficientTotalCapacity: !isCapacityPhysicallySufficient,
    conflicts: !isAvailable ? ['Không đủ bàn trống phù hợp cho số khách được yêu cầu'] : [],
  };
};


const addStatusHistory = async (booking, newStatus, changedBy, note = null) => {
  booking.status = newStatus;
  booking.statusHistory.push({
    status: newStatus,
    changedBy,
    note,
    changedAt: new Date(),
  });

  return booking.save();
};

/**
 * Kiểm tra user có bị block do no-show không
 */
const checkUserBookingBlock = async (userId) => {
  const user = await User.findById(userId).select('noShowCounter bookingBlockedUntil');
  if (!user) return { blocked: false };

  if (user.bookingBlockedUntil && user.bookingBlockedUntil > new Date()) {
    return {
      blocked: true,
      blockedUntil: user.bookingBlockedUntil,
      noShowCounter: user.noShowCounter,
      message: `Tài khoản của bạn đã bị tạm khóa đặt bàn đến ${user.bookingBlockedUntil.toLocaleDateString('vi-VN')} do quá nhiều lần vắng mặt.`,
    };
  }

  return {
    blocked: false,
    noShowCounter: user.noShowCounter,
  };
};

/**
 * Atomic table reservation — prevents double-booking race condition
 * Uses unique compound index on TableReservation for MongoDB-level locking.
 * Returns { success: true } or { success: false, error: 'TABLE_ALREADY_RESERVED', tableNumber }
 */
const reserveTables = async (restaurantId, tableNumbers, bookingDate, bookingTime, bookingId, options = {}) => {
  if (!options.session) {
    const ownedSession = await mongoose.startSession();
    try {
      let result;
      await ownedSession.withTransaction(async () => {
        result = await reserveTables(
          restaurantId, tableNumbers, bookingDate, bookingTime, bookingId, { session: ownedSession },
        );
        if (!result.success) {
          const error = new Error(result.message);
          error.code = result.error;
          throw error;
        }
      });
      return result;
    } catch (error) {
      if (error?.code === 'TABLE_ALREADY_RESERVED' || error?.code === 11000) {
        return { success: false, error: 'TABLE_ALREADY_RESERVED', message: error.message };
      }
      throw error;
    } finally {
      await ownedSession.endSession();
    }
  }
  const reservations = buildReservationSlots(restaurantId, tableNumbers, bookingDate, bookingTime, bookingId);

  try {
    await TableReservation.insertMany(reservations, {
      ordered: true,
      session: options.session || undefined,
    });
    return { success: true };
  } catch (err) {
    if (err.code === 11000) {
      // Duplicate key — extract the conflicting table from error message
      const match = err.message.match(/tableNumber: "([^"]+)"/);
      const tableNumber = match ? match[1] : 'unknown';
      return {
        success: false,
        error: 'TABLE_ALREADY_RESERVED',
        tableNumber,
        message: `Bàn ${tableNumber} vừa được khách khác đặt. Vui lòng chọn lại.`,
      };
    }
    throw err;
  }
};

/**
 * Release table reservations (for cancelled/failed bookings)
 */
const releaseTableReservations = async (bookingId, options = {}) => {
  const query = TableReservation.deleteMany({ bookingId });
  if (options.session) query.session(options.session);
  await query;
};

const buildReservationSlots = (restaurantId, tableNumbers, bookingDate, bookingTime, bookingId) => {
  const startAt = bookingTimeUtils.getBookingStartAt(bookingDate, bookingTime);
  const endAt = bookingTimeUtils.getBookingEndAt(bookingDate, bookingConfig.durationMinutes, bookingTime);
  const slotMilliseconds = bookingConfig.reservationSlotMinutes * 60_000;
  // Align every reservation to a global slot grid. Without floor/ceil alignment,
  // 18:05 and 18:10 would generate different keys even though they overlap.
  const occupiedStart = startAt.getTime() - BOOKING_CONSTANTS.BUFFER_BEFORE_MINUTES * 60_000;
  const occupiedEnd = endAt.getTime() + BOOKING_CONSTANTS.BUFFER_AFTER_MINUTES * 60_000;
  const firstSlot = Math.floor(occupiedStart / slotMilliseconds) * slotMilliseconds;
  const afterLastSlot = Math.ceil(occupiedEnd / slotMilliseconds) * slotMilliseconds;
  const reservations = [];
  for (const tableNumber of [...new Set(tableNumbers)]) {
    for (let cursor = firstSlot; cursor < afterLastSlot; cursor += slotMilliseconds) {
      const slotStartUtc = new Date(cursor);
      const localSlotIso = bookingTimeUtils.toBusinessIsoString(slotStartUtc);
      reservations.push({
        restaurantId,
        tableNumber,
        bookingDate: normalizeDate(localSlotIso.slice(0, 10)),
        bookingTime: localSlotIso.slice(11, 16),
        bookingId,
        slotStartUtc,
        slotEndUtc: new Date(cursor + slotMilliseconds),
      });
    }
  }
  return reservations;
};

/**
 * Keeps the atomic reservation records in sync when an owner assigns or changes tables.
 * New tables are reserved before old tables are released so a failed swap never loses
 * the booking's existing reservation.
 */
const replaceTableReservations = async (
  restaurantId,
  tableNumbers,
  bookingDate,
  bookingTime,
  bookingId,
  options = {},
) => {
  const session = options.session || null;
  if (!session) {
    const ownedSession = await mongoose.startSession();
    try {
      let result;
      await ownedSession.withTransaction(async () => {
        result = await replaceTableReservations(
          restaurantId, tableNumbers, bookingDate, bookingTime, bookingId, { session: ownedSession },
        );
        if (!result.success) {
          const error = new Error(result.message);
          error.code = result.error;
          throw error;
        }
      });
      return result;
    } catch (error) {
      if (error?.code === 'TABLE_ALREADY_RESERVED' || error?.code === 11000) {
        return { success: false, error: 'TABLE_ALREADY_RESERVED', message: error.message };
      }
      throw error;
    } finally {
      await ownedSession.endSession();
    }
  }
  const desired = buildReservationSlots(restaurantId, tableNumbers, bookingDate, bookingTime, bookingId);
  const currentQuery = TableReservation.find({ bookingId });
  if (session) currentQuery.session(session);
  const current = await currentQuery;
  const keyOf = (item) => `${item.tableNumber}:${new Date(item.slotStartUtc).toISOString()}`;
  const currentKeys = new Set(current.filter((item) => item.slotStartUtc).map(keyOf));
  const desiredKeys = new Set(desired.map(keyOf));
  const additions = desired.filter((item) => !currentKeys.has(keyOf(item)));
  const removalIds = current
    .filter((item) => !item.slotStartUtc || !desiredKeys.has(keyOf(item)))
    .map((item) => item._id);

  try {
    if (additions.length) {
      await TableReservation.insertMany(additions, { ordered: true, session: session || undefined });
    }
    if (removalIds.length) {
      const removal = TableReservation.deleteMany({ bookingId, _id: { $in: removalIds } });
      if (session) removal.session(session);
      await removal;
    }
    return { success: true };
  } catch (error) {
    if (error?.code === 11000) {
      return {
        success: false,
        error: 'TABLE_ALREADY_RESERVED',
        message: 'Một hoặc nhiều bàn vừa được khách khác đặt. Vui lòng chọn lại.',
      };
    }
    throw error;
  }
};

const confirmBookingAtomic = async ({ bookingId, actorId }) => {
  const session = await mongoose.startSession();
  try {
    let updatedBooking;
    await session.withTransaction(async () => {
      const booking = await Booking.findOne({ _id: bookingId, status: 'pending' }).session(session);
      if (!booking) {
        const error = new Error('Booking không còn ở trạng thái chờ xác nhận');
        error.code = 'BOOKING_NOT_CONFIRMABLE';
        throw error;
      }
      const reservation = await replaceTableReservations(
        booking.restaurantId, booking.tableNumbers, booking.bookingDate,
        booking.bookingTime, booking._id, { session },
      );
      if (!reservation.success) {
        const error = new Error(reservation.message);
        error.code = reservation.error;
        throw error;
      }
      booking.status = 'confirmed';
      booking.confirmedAt = new Date();
      booking.confirmedBy = actorId;
      booking.statusHistory.push({
        status: 'confirmed', changedBy: actorId,
        note: 'Nhà hàng xác nhận đặt bàn',
      });
      updatedBooking = await booking.save({ session });
    });
    return updatedBooking;
  } finally {
    await session.endSession();
  }
};

const changeBookingTablesAtomic = async ({ bookingId, tableNumbers, actorId }) => {
  const session = await mongoose.startSession();
  try {
    let updatedBooking;
    await session.withTransaction(async () => {
      const booking = await Booking.findOne({ _id: bookingId, status: { $in: ['pending', 'confirmed'] } }).session(session);
      if (!booking) {
        const error = new Error('Booking không còn ở trạng thái có thể đổi bàn');
        error.code = 'BOOKING_NOT_RESCHEDULABLE';
        throw error;
      }
      const oldTables = [...(booking.tableNumbers || [])];
      const reservation = await replaceTableReservations(
        booking.restaurantId, tableNumbers, booking.bookingDate,
        booking.bookingTime, booking._id, { session },
      );
      if (!reservation.success) {
        const error = new Error(reservation.message);
        error.code = reservation.error;
        throw error;
      }
      booking.tableNumbers = [...new Set(tableNumbers)];
      booking.statusHistory.push({
        status: booking.status, changedBy: actorId,
        note: `Thay đổi bàn ăn từ [${oldTables.join(', ')}] sang [${booking.tableNumbers.join(', ')}]`,
      });
      updatedBooking = await booking.save({ session });
    });
    return updatedBooking;
  } finally {
    await session.endSession();
  }
};

const rescheduleBookingAtomic = async ({ bookingId, bookingDate, bookingTime, tableNumbers, actorId, depositAmount }) => {
  const session = await mongoose.startSession();
  try {
    let updatedBooking;
    await session.withTransaction(async () => {
      const booking = await Booking.findById(bookingId).session(session);
      if (!booking || !['pending', 'confirmed'].includes(booking.status)) {
        const error = new Error('Booking không còn ở trạng thái có thể đổi lịch');
        error.code = 'BOOKING_NOT_RESCHEDULABLE';
        throw error;
      }
      const reservation = await replaceTableReservations(
        booking.restaurantId, tableNumbers, bookingDate, bookingTime, booking._id, { session },
      );
      if (!reservation.success) {
        const error = new Error(reservation.message);
        error.code = reservation.error;
        throw error;
      }
      const oldDate = booking.bookingDate;
      const oldTime = booking.bookingTime;
      booking.bookingDate = normalizeDate(bookingDate);
      booking.bookingTime = bookingTime;
      booking.tableNumbers = [...new Set(tableNumbers)];
      if (depositAmount !== undefined) {
        booking.depositAmount = depositAmount;
        booking.originalAmount = depositAmount;
        booking.finalAmount = Math.max(0, depositAmount - (booking.discountAmount || 0));
      }
      booking.rescheduleHistory.push({
        fromDate: oldDate, fromTime: oldTime,
        toDate: booking.bookingDate, toTime: bookingTime,
        rescheduledAt: new Date(), rescheduledBy: actorId,
      });
      await booking.save({ session });
      updatedBooking = booking;
    });
    return updatedBooking;
  } finally {
    await session.endSession();
  }
};

// ─── Table Hold Functions ───

const TableHold = require('../models/TableHold');

/**
 * Hold tables for a customer during the booking process.
 * Prevents other customers from seeing these tables as available.
 */
const holdTables = async ({ restaurantId, tableNumbers, bookingDate, bookingTime, userId, sessionId }) => {
  const holdDurationMinutes = 10;
  const expiresAt = new Date(Date.now() + holdDurationMinutes * 60 * 1000);

  // Check if there's already a hold on any of these tables by another user/session
  const existingHolds = await TableHold.find({
    restaurantId,
    bookingDate,
    bookingTime,
    expiresAt: { $gt: new Date() },
  });

  const heldTables = new Set();
  existingHolds.forEach((hold) => {
    const isOwner = userId && hold.userId && hold.userId.toString() === userId.toString();
    const isSameSession = sessionId && hold.sessionId === sessionId;
    if (!isOwner && !isSameSession) {
      hold.tableNumbers.forEach((tn) => heldTables.add(tn));
    }
  });

  const conflictTables = tableNumbers.filter((tn) => heldTables.has(tn));
  if (conflictTables.length > 0) {
    return { success: false, message: `Bàn ${conflictTables.join(', ')} đang được giữ bởi khách khác`, conflictTables };
  }

  // Release any existing holds by this user/session for this restaurant/date/time
  const ownerFilter = {};
  if (userId) ownerFilter.userId = userId;
  else if (sessionId) ownerFilter.sessionId = sessionId;
  if (Object.keys(ownerFilter).length > 0) {
    await TableHold.deleteMany({
      restaurantId,
      bookingDate,
      bookingTime,
      ...ownerFilter,
    });
  }

  // Create new hold
  await TableHold.create({
    restaurantId,
    tableNumbers,
    bookingDate,
    bookingTime,
    userId: userId || null,
    sessionId: sessionId || null,
    expiresAt,
  });

  return { success: true, expiresAt };
};

/**
 * Release a hold (called when booking is submitted or customer navigates away).
 */
const releaseHolds = async ({ userId, sessionId, restaurantId, bookingDate, bookingTime }) => {
  const filter = { restaurantId, bookingDate, bookingTime };
  if (userId) filter.userId = userId;
  else if (sessionId) filter.sessionId = sessionId;

  await TableHold.deleteMany(filter);
};

const getHeldTableNumbers = async ({ restaurantId, bookingDate, bookingTime, excludeUserId, excludeSessionId }) => {
  const activeHolds = await TableHold.find({
    restaurantId,
    bookingDate,
    bookingTime,
    expiresAt: { $gt: new Date() },
  });

  const heldTables = new Set();
  activeHolds.forEach((hold) => {
    const isExcluded = excludeUserId && hold.userId && hold.userId.toString() === excludeUserId.toString();
    const isSameSession = excludeSessionId && hold.sessionId === excludeSessionId;
    if (!isExcluded && !isSameSession) {
      hold.tableNumbers.forEach((tn) => heldTables.add(tn));
    }
  });

  return [...heldTables];
};

/**
 * Xử lý một đặt bàn đã quá hạn (Auto-complete hoặc Auto-no-show).
 * Đảm bảo atomic update trạng thái bằng findOneAndUpdate để chống race condition.
 */
const processExpiredBooking = async (bookingId, now = new Date(), io = null, options = {}) => {
  const notificationService = require('./notification.service');
  const bookingCommissionService = require('./booking-commission.service');

  // 1. Đọc document hiện tại để kiểm tra checkedInAt và status
  const checkBooking = await Booking.findById(bookingId);
  if (!checkBooking || checkBooking.status !== 'confirmed') {
    return { success: false, reason: 'Booking không tồn tại hoặc không ở trạng thái confirmed' };
  }

  // Kiểm tra thời gian kết thúc của booking (bỏ qua nếu có cờ bypassExpiry)
  if (!options.bypassExpiry) {
    const bookingEndTime = bookingTimeUtils.getLifecycleDeadline(checkBooking);
    if (bookingEndTime > now) {
      return { success: false, reason: 'Booking chưa quá hạn' };
    }
  }

  const targetStatus = checkBooking.checkedInAt ? 'completed' : 'no_show';
  if (options.expectedStatus && options.expectedStatus !== targetStatus) {
    return {
      success: false,
      reason: targetStatus === 'completed'
        ? 'Booking đã check-in nên không thể đánh dấu no-show'
        : 'Booking chưa check-in nên không thể hoàn thành',
    };
  }

  // 2. Thực hiện atomic update trạng thái để đảm bảo không ai khác cập nhật cùng lúc
  const booking = await Booking.findOneAndUpdate(
    {
      _id: bookingId,
      status: 'confirmed' // Điều kiện lock: trạng thái vẫn phải là confirmed
    },
    {
      $set: {
        status: targetStatus,
        completedAt: targetStatus === 'completed' ? now : null,
        ...(targetStatus === 'completed' && options.actualGuestCount !== undefined
          ? { actualGuestCount: options.actualGuestCount }
          : {}),
      },
      $push: {
        statusHistory: {
          status: targetStatus,
          changedBy: options.actorId || null,
          note: options.reason || (targetStatus === 'completed'
            ? 'Tự động hoàn tất sau giờ đặt (khách đã check-in)'
            : 'Tự động đánh dấu vắng mặt sau lifecycle deadline (chưa check-in)'),
          changedAt: now
        }
      }
    },
    { new: true } // Trả về document sau khi update
  );

  if (!booking) {
    return { success: false, reason: 'Race condition xảy ra hoặc trạng thái đã thay đổi' };
  }

  // 3. Giải phóng bàn ăn
  // Resolve through exports so tests and operational wrappers can replace the
  // reservation cleanup dependency without changing lifecycle semantics.
  await module.exports.releaseTableReservations(booking._id).catch(() => { });

  const restaurant = await Restaurant.findById(booking.restaurantId);

  // 4. Thực hiện các side effects cụ thể cho từng trạng thái
  if (targetStatus === 'completed') {
    // Để pre('save') nhận biết trạng thái thay đổi, ta gán cờ _becameCompleted = true
    booking._becameCompleted = true;
    await booking.save();

    // Cập nhật statistics cho nhà hàng
    if (restaurant) {
      restaurant.stats.completedBookings = (restaurant.stats.completedBookings || 0) + 1;
      await restaurant.save().catch(() => { });
    }

    // Tạo commission ledger
    await bookingCommissionService.createLedgerForBooking(booking._id, {
      booking,
      restaurant,
      source: options.source || (booking.sourceAiPendingActionId ? 'ai_booking_completed' : 'booking_lifecycle_completed'),
    }).catch((err) => console.warn(`[BookingCommission] ${err.message}`));

  } else {
    // Trạng thái no_show
    await booking.save(); // Để đồng bộ Mongoose

    // Phạt người dùng no-show
    if (booking.customerId) {
      const customer = await User.findById(booking.customerId);
      if (customer) {
        customer.noShowCounter = (customer.noShowCounter || 0) + 1;
        if (customer.noShowCounter >= 3) {
          customer.bookingBlockedUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        }
        await customer.save();
      }
    }
  }

  // 5. Gửi thông báo (Real-time Socket & Notifications)
  if (io && booking.customerId) {
    const room = `user:${booking.customerId.toString()}`;
    const event = `booking:${targetStatus}`;
    io.to(room).emit(event, {
      bookingId: booking._id,
      restaurantId: booking.restaurantId,
      status: booking.status,
      message: targetStatus === 'completed' ? 'Đặt bàn đã hoàn tất' : 'Đặt bàn được đánh dấu no-show',
    });

    notificationService.notifyBookingStatusChanged(io, {
      booking,
      restaurant,
      status: targetStatus,
      actorRole: options.actorRole || 'system',
    }).catch((error) => {
      console.warn(`[Notification Expired Booking] ${error.message}`);
    });
  }

  return { success: true, status: targetStatus };
};

module.exports = {
  BOOKING_CONSTANTS,
  BOOKING_STATUS_TRANSITIONS,
  canTransitionBookingStatus,
  buildReservationSlots,
  normalizeDate,
  combineDateAndTime,
  checkTimeConflict,
  validateBookingTime,
  validateTableCapacity,
  getAvailableTables,
  suggestTables,
  checkAvailability,
  addStatusHistory,
  checkUserBookingBlock,
  reserveTables,
  releaseTableReservations,
  replaceTableReservations,
  confirmBookingAtomic,
  changeBookingTablesAtomic,
  rescheduleBookingAtomic,
  holdTables,
  releaseHolds,
  getHeldTableNumbers,
  processExpiredBooking,
};
