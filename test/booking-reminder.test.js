'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Booking = require('../src/models/Booking');
const Notification = require('../src/models/Notification');
const notificationService = require('../src/services/notification.service');
const bookingReminder = require('../src/cron/bookingReminder');

test('booking_reminder is a valid notification type', async () => {
  const notification = new Notification({
    type: 'booking_reminder',
    title: 'Nhắc nhở lịch đặt bàn',
    message: 'Bạn có lịch đặt bàn sắp tới.',
    recipientId: new mongoose.Types.ObjectId(),
    recipientRole: 'customer',
  });

  await assert.doesNotReject(() => notification.validate());
});

test('failed reminders are attempted once per cron run instead of spinning forever', async () => {
  const originalFind = Booking.find;
  const originalUpdateOne = Booking.updateOne;
  const originalNotify = notificationService.notifyBookingReminder;
  const bookings = [
    { _id: new mongoose.Types.ObjectId(), customerId: new mongoose.Types.ObjectId() },
    { _id: new mongoose.Types.ObjectId(), customerId: new mongoose.Types.ObjectId() },
  ];
  let findCalls = 0;
  let notifyCalls = 0;

  try {
    Booking.find = () => {
      const query = {
        sort() { return query; },
        limit() { return query; },
        async lean() {
          findCalls++;
          return findCalls === 1 ? bookings : [];
        },
      };
      return query;
    };
    Booking.updateOne = async () => {
      throw new Error('updateOne must not run when notification creation fails');
    };
    notificationService.notifyBookingReminder = async () => {
      notifyCalls++;
      throw new Error('simulated notification failure');
    };

    const result = await bookingReminder({});

    assert.deepEqual(result, { processed: 0, failed: 2, skipped: false });
    assert.equal(notifyCalls, 2);
    assert.equal(findCalls, 2);
  } finally {
    Booking.find = originalFind;
    Booking.updateOne = originalUpdateOne;
    notificationService.notifyBookingReminder = originalNotify;
  }
});
