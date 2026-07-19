'use strict';

const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const BUSINESS_UTC_OFFSET_HOURS = 7;

const pad = (value) => String(value).padStart(2, '0');

const combineBusinessDateAndTime = (dateInput, timeInput = '00:00') => {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) throw new Error('Ngày booking không hợp lệ');

  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(timeInput));
  if (!match) throw new Error('Giờ booking không hợp lệ');

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    hours - BUSINESS_UTC_OFFSET_HOURS,
    minutes,
    0,
    0
  ));
};

const toBusinessIsoString = (instant) => {
  const date = new Date(instant);
  const shifted = new Date(date.getTime() + BUSINESS_UTC_OFFSET_HOURS * 60 * 60 * 1000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
    + `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}+07:00`;
};

module.exports = {
  BUSINESS_TIME_ZONE,
  BUSINESS_UTC_OFFSET_HOURS,
  combineBusinessDateAndTime,
  toBusinessIsoString,
};
