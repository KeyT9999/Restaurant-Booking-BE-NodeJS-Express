const Payment = require('../models/Payment');
const FeaturedPlacement = require('../models/FeaturedPlacement');
const VoucherCampaignPurchase = require('../models/VoucherCampaignPurchase');
const { reverseWalletBookingPayment } = require('./wallet-payment.service');

const expirePendingPayments = async ({
  paymentId,
  orderCode,
  userId,
  restaurantId,
  targetType,
  targetId,
  now = new Date(),
  limit = 100,
} = {}) => {
  const filter = {
    status: 'pending',
    expiredAt: { $ne: null, $lte: now },
  };
  if (paymentId) filter._id = paymentId;
  if (orderCode) filter.orderCode = Number(orderCode);
  if (userId) filter.userId = userId;
  if (restaurantId) filter.restaurantId = restaurantId;
  if (targetType) filter.targetType = targetType;
  if (targetId) filter.targetId = targetId;

  const candidates = await Payment.find(filter)
    .select('_id')
    .limit(Math.min(500, Math.max(1, Number(limit) || 100)))
    .lean();

  const expiredPayments = [];
  for (const candidate of candidates) {
    const payment = await Payment.findOneAndUpdate(
      { _id: candidate._id, status: 'pending', expiredAt: { $ne: null, $lte: now } },
      { $set: { status: 'expired' } },
      { new: true }
    );
    if (payment) expiredPayments.push(payment);
  }

  if (!expiredPayments.length) return { count: 0, payments: [] };

  const paymentIds = expiredPayments.map((payment) => payment._id);
  await Promise.all([
    FeaturedPlacement.updateMany(
      { paymentId: { $in: paymentIds }, status: 'pending' },
      { $set: { status: 'cancelled', cancelledAt: now } }
    ),
    VoucherCampaignPurchase.updateMany(
      { paymentId: { $in: paymentIds }, status: 'pending' },
      { $set: { status: 'cancelled', cancelledAt: now } }
    ),
  ]);

  await Promise.all(expiredPayments
    .filter((payment) => payment.targetType === 'booking' && payment.walletAmountApplied > 0)
    .map((payment) => reverseWalletBookingPayment(payment._id, 'Hoàn lại tiền ví do payment hết hạn')));

  return { count: expiredPayments.length, payments: expiredPayments };
};

module.exports = { expirePendingPayments };
