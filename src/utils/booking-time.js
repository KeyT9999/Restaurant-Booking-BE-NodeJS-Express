'use strict';

const { DateTime } = require('luxon');
const bookingConfig = require('../config/booking.config');

const BUSINESS_TIME_ZONE = bookingConfig.timezone;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const getDateKey = (dateInput) => {
  if (typeof dateInput === 'string') {
    const directDate = /^(\d{4}-\d{2}-\d{2})/.exec(dateInput);
    if (directDate) return directDate[1];
  }

  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) throw new Error('Ngày booking không hợp lệ');
  return DateTime.fromJSDate(date, { zone: 'utc' }).toISODate();
};

const validateTime = (timeInput) => {
  const match = TIME_PATTERN.exec(String(timeInput || ''));
  if (!match) throw new Error('Giờ booking không hợp lệ');
  return { hour: Number(match[1]), minute: Number(match[2]) };
};

const combineBusinessDateAndTime = (dateInput, timeInput = '00:00') => {
  const dateKey = getDateKey(dateInput);
  const { hour, minute } = validateTime(timeInput);
  const localDateTime = DateTime.fromObject(
    {
      year: Number(dateKey.slice(0, 4)),
      month: Number(dateKey.slice(5, 7)),
      day: Number(dateKey.slice(8, 10)),
      hour,
      minute,
      second: 0,
      millisecond: 0,
    },
    { zone: BUSINESS_TIME_ZONE },
  );

  if (!localDateTime.isValid) throw new Error('Ngày giờ booking không hợp lệ');
  return localDateTime.toUTC().toJSDate();
};

const getBookingStartAt = (bookingOrDate, timeInput) => {
  if (bookingOrDate && typeof bookingOrDate === 'object' && 'bookingDate' in bookingOrDate) {
    return combineBusinessDateAndTime(bookingOrDate.bookingDate, bookingOrDate.bookingTime || '00:00');
  }
  return combineBusinessDateAndTime(bookingOrDate, timeInput || '00:00');
};

const getBookingEndAt = (bookingOrDate, durationMinutes = bookingConfig.durationMinutes, timeInput) => {
  const startAt = getBookingStartAt(bookingOrDate, timeInput);
  return new Date(startAt.getTime() + durationMinutes * 60_000);
};

const getLifecycleDeadline = (booking, graceMinutes = bookingConfig.lifecycleGraceMinutes) => {
  const endAt = getBookingEndAt(booking);
  return new Date(endAt.getTime() + graceMinutes * 60_000);
};

const getCancellationDeadline = (booking, thresholdMinutes) => {
  const startAt = getBookingStartAt(booking);
  return new Date(startAt.getTime() - Number(thresholdMinutes || 0) * 60_000);
};

const getMinutesUntilBooking = (booking, now = new Date()) => (
  (getBookingStartAt(booking).getTime() - new Date(now).getTime()) / 60_000
);

const isBookingStarted = (booking, now = new Date()) => getBookingStartAt(booking) <= new Date(now);
const isBookingExpired = (booking, now = new Date()) => getLifecycleDeadline(booking) <= new Date(now);

const normalizeBusinessDate = (dateInput) => {
  const dateKey = getDateKey(dateInput);
  return DateTime.fromISO(dateKey, { zone: 'utc' }).startOf('day').toJSDate();
};

const getBusinessWeekday = (dateInput) => {
  const dateKey = getDateKey(dateInput);
  return DateTime.fromISO(dateKey, { zone: BUSINESS_TIME_ZONE }).toFormat('cccc').toLowerCase();
};

const getBusinessDateKey = (instant = new Date()) => (
  DateTime.fromJSDate(new Date(instant), { zone: 'utc' }).setZone(BUSINESS_TIME_ZONE).toISODate()
);

const getBusinessTime = (instant = new Date()) => (
  DateTime.fromJSDate(new Date(instant), { zone: 'utc' }).setZone(BUSINESS_TIME_ZONE).toFormat('HH:mm')
);

const toBusinessIsoString = (instant) => {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) throw new Error('Thời điểm không hợp lệ');
  return DateTime.fromJSDate(date, { zone: 'utc' })
    .setZone(BUSINESS_TIME_ZONE)
    .toISO({ suppressMilliseconds: true });
};

module.exports = {
  BUSINESS_TIME_ZONE,
  combineBusinessDateAndTime,
  getBookingStartAt,
  getBookingEndAt,
  getLifecycleDeadline,
  getCancellationDeadline,
  getMinutesUntilBooking,
  isBookingStarted,
  isBookingExpired,
  normalizeBusinessDate,
  getBusinessWeekday,
  getBusinessDateKey,
  getBusinessTime,
  toBusinessIsoString,
};
