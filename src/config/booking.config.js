'use strict';

const integerAtLeast = (value, fallback, minimum = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : fallback;
};

const configuredTimezone = process.env.BOOKING_TIMEZONE || 'Asia/Ho_Chi_Minh';
try {
  new Intl.DateTimeFormat('en-US', { timeZone: configuredTimezone }).format();
} catch {
  throw new Error(`BOOKING_TIMEZONE không hợp lệ: ${configuredTimezone}`);
}

module.exports = Object.freeze({
  timezone: configuredTimezone,
  durationMinutes: integerAtLeast(process.env.BOOKING_DURATION_MINUTES, 120, 1),
  lifecycleGraceMinutes: integerAtLeast(process.env.BOOKING_LIFECYCLE_GRACE_MINUTES, 0),
  reservationSlotMinutes: integerAtLeast(process.env.BOOKING_RESERVATION_SLOT_MINUTES, 15, 1),
  customerVoucherReversalWindowMinutes: integerAtLeast(
    process.env.CUSTOMER_VOUCHER_REVERSAL_WINDOW_MINUTES,
    30,
  ),
});
