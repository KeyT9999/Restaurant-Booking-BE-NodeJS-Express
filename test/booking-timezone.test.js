'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const {
  BUSINESS_TIME_ZONE,
  getBookingStartAt,
  getBookingEndAt,
  getMinutesUntilBooking,
  isBookingStarted,
} = require('../src/utils/booking-time');

const booking = { bookingDate: '2026-07-20', bookingTime: '19:00' };

test('19:00 Vietnam is represented by the correct UTC instant', () => {
  assert.equal(BUSINESS_TIME_ZONE, 'Asia/Ho_Chi_Minh');
  assert.equal(getBookingStartAt(booking).toISOString(), '2026-07-20T12:00:00.000Z');
  assert.equal(getBookingEndAt(booking).toISOString(), '2026-07-20T14:00:00.000Z');
});

test('booking instant is independent from the server timezone', () => {
  const modulePath = path.resolve(__dirname, '../src/utils/booking-time.js');
  const script = `const t=require(${JSON.stringify(modulePath)});process.stdout.write(t.getBookingStartAt(${JSON.stringify(booking)}).toISOString())`;
  for (const timezone of ['UTC', 'Asia/Ho_Chi_Minh', 'America/New_York']) {
    const actual = execFileSync(process.execPath, ['-e', script], {
      env: { ...process.env, TZ: timezone },
      encoding: 'utf8',
    });
    assert.equal(actual, '2026-07-20T12:00:00.000Z', timezone);
  }
});

test('started and minutes boundary use the canonical instant', () => {
  assert.equal(getMinutesUntilBooking(booking, new Date('2026-07-20T10:00:00.000Z')), 120);
  assert.equal(isBookingStarted(booking, new Date('2026-07-20T11:59:59.999Z')), false);
  assert.equal(isBookingStarted(booking, new Date('2026-07-20T12:00:00.000Z')), true);
});
