'use strict';

const { combineBusinessDateAndTime, toBusinessIsoString } = require('../utils/booking-time');

const CANCELLATION_POLICY = Object.freeze({
  fullRefundThresholdMinutes: 120,
  lateCancellationFeeBasisPoints: 3000,
});

const ensureMoney = (value) => {
  const amount = Number(value || 0);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error('Số tiền cọc thực trả không hợp lệ');
  }
  return amount;
};

const calculateCancellationPolicy = ({ bookingDate, bookingTime, paidAmount, now = new Date() }) => {
  const bookingDateTime = combineBusinessDateAndTime(bookingDate, bookingTime);
  const serverTime = new Date(now);
  const remainingMilliseconds = bookingDateTime.getTime() - serverTime.getTime();
  const remainingMinutes = remainingMilliseconds / 60000;
  const depositPaid = ensureMoney(paidAmount);

  let canCancel = remainingMilliseconds > 0;
  let policyCode = 'CANCELLATION_CLOSED';
  let cancellationFeeRateBasisPoints = 0;

  if (remainingMilliseconds >= CANCELLATION_POLICY.fullRefundThresholdMinutes * 60000) {
    policyCode = 'FULL_REFUND';
  } else if (remainingMilliseconds > 0) {
    policyCode = 'PARTIAL_REFUND';
    cancellationFeeRateBasisPoints = CANCELLATION_POLICY.lateCancellationFeeBasisPoints;
  }

  if (!canCancel) cancellationFeeRateBasisPoints = 0;

  const cancellationFeeAmount = canCancel
    ? Math.floor((depositPaid * cancellationFeeRateBasisPoints) / 10000)
    : 0;
  const refundAmount = canCancel ? depositPaid - cancellationFeeAmount : 0;

  const message = !canCancel
    ? 'Đã đến hoặc quá giờ đặt bàn. Bạn không thể hủy đặt bàn và tiền cọc không được hoàn lại.'
    : policyCode === 'FULL_REFUND'
      ? 'Bạn sẽ được hoàn 100% tiền cọc thực trả vào Ví BookEat.'
      : 'Hủy trước giờ hẹn dưới 2 giờ: phí hủy 30%, phần còn lại được hoàn vào Ví BookEat.';

  return {
    canCancel,
    bookingDateTime: toBusinessIsoString(bookingDateTime),
    serverTime: toBusinessIsoString(serverTime),
    remainingMinutes,
    policyCode,
    depositPaid,
    cancellationFeeRate: cancellationFeeRateBasisPoints / 10000,
    cancellationFeeRateBasisPoints,
    cancellationFeeAmount,
    refundAmount,
    refundMethod: 'BOOKEAT_WALLET',
    message,
  };
};

module.exports = {
  CANCELLATION_POLICY,
  calculateCancellationPolicy,
  ensureMoney,
};
