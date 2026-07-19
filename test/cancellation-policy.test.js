'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateCancellationPolicy } = require('../src/services/cancellation-policy.service');

const previewAt = (now, paidAmount = 300000) => calculateCancellationPolicy({
  bookingDate: '2026-07-20',
  bookingTime: '19:00',
  paidAmount,
  now: new Date(now),
});

test('cancellation policy uses Asia/Ho_Chi_Minh and refunds fully above 120 minutes', () => {
  const result = previewAt('2026-07-20T09:59:59.000Z');
  assert.equal(result.bookingDateTime, '2026-07-20T19:00:00+07:00');
  assert.equal(result.policyCode, 'FULL_REFUND');
  assert.equal(result.refundAmount, 300000);
  assert.equal(result.cancellationFeeAmount, 0);
});

test('exactly 120 minutes receives a full refund', () => {
  const result = previewAt('2026-07-20T10:00:00.000Z');
  assert.equal(result.remainingMinutes, 120);
  assert.equal(result.policyCode, 'FULL_REFUND');
  assert.equal(result.refundAmount, 300000);
});

test('119 minutes 59 seconds incurs a 30 percent fee', () => {
  const result = previewAt('2026-07-20T10:00:01.000Z');
  assert.equal(result.policyCode, 'PARTIAL_REFUND');
  assert.equal(result.cancellationFeeRateBasisPoints, 3000);
  assert.equal(result.cancellationFeeAmount, 90000);
  assert.equal(result.refundAmount, 210000);
});

test('exactly at and after booking time cannot be cancelled', () => {
  for (const now of ['2026-07-20T12:00:00.000Z', '2026-07-20T12:00:01.000Z']) {
    const result = previewAt(now);
    assert.equal(result.canCancel, false);
    assert.equal(result.policyCode, 'CANCELLATION_CLOSED');
    assert.equal(result.refundAmount, 0);
  }
});

test('zero deposit creates no money and odd VND amounts use deterministic floor fee', () => {
  const zero = previewAt('2026-07-20T10:30:00.000Z', 0);
  assert.equal(zero.cancellationFeeAmount, 0);
  assert.equal(zero.refundAmount, 0);

  const odd = previewAt('2026-07-20T10:30:00.000Z', 101);
  assert.equal(odd.cancellationFeeAmount, 30);
  assert.equal(odd.refundAmount, 71);
  assert.equal(odd.cancellationFeeAmount + odd.refundAmount, 101);
});

test('refund is based only on actual paid amount after voucher or source composition', () => {
  const cases = [
    ['voucher adjusted payment', 250000],
    ['wallet payment', 180000],
    ['mixed wallet and gateway payment', 275000],
  ];

  for (const [label, actualPaid] of cases) {
    const result = previewAt('2026-07-20T10:30:00.000Z', actualPaid);
    assert.equal(result.depositPaid, actualPaid, label);
    assert.equal(result.cancellationFeeAmount + result.refundAmount, actualPaid, label);
  }
});

test('unsafe or fractional money is rejected', () => {
  assert.throws(() => previewAt('2026-07-20T10:30:00.000Z', 10.5), /không hợp lệ|khÃ´ng há»£p lá»‡/);
  assert.throws(() => previewAt('2026-07-20T10:30:00.000Z', -1), /không hợp lệ|khÃ´ng há»£p lá»‡/);
});
