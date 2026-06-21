'use strict';

const cron = require('node-cron');
const bookingReminder = require('./bookingReminder');
const bookingCleanup = require('./bookingCleanup');
const noShowUnblock = require('./noShowUnblock');

let io = null;

const setSocketIO = (socketIO) => {
  io = socketIO;
};

const startCronJobs = () => {
  console.log('[Cron] Starting scheduled jobs...');

  // Booking reminder — every 30 minutes
  cron.schedule('*/30 * * * *', () => {
    bookingReminder(io);
  });

  // Booking cleanup (auto-cancel unpaid, auto-complete, auto-no-show) — every 5 minutes
  cron.schedule('*/5 * * * *', () => {
    bookingCleanup(io);
  });

  // No-show unblock — daily at midnight
  cron.schedule('0 0 * * *', () => {
    noShowUnblock();
  });

  console.log('[Cron] All jobs scheduled');
};

module.exports = { startCronJobs, setSocketIO };
