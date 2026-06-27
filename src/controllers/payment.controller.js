const Payment = require('../models/Payment');
const Transaction = require('../models/Transaction');
const Booking = require('../models/Booking');
const Subscription = require('../models/Subscription');
const Restaurant = require('../models/Restaurant');
const FeaturedPlacement = require('../models/FeaturedPlacement');
const VoucherCampaignPurchase = require('../models/VoucherCampaignPurchase');
const payosService = require('../services/payos.service');
const notificationService = require('../services/notification.service');
const voucherService = require('../services/voucher.service');
const featuredPlacementService = require('../services/featured-placement.service');
const voucherCampaignService = require('../services/voucher-campaign.service');
const { expirePendingPayments } = require('../services/payment-lifecycle.service');
const {
  payosConfig,
  SUBSCRIPTION_PLANS,
  PLAN_ORDER,
  getPlanCode,
  getPlanInfo,
} = require('../config/payos.config');

const MIN_PAYMENT_AMOUNT = 1000;

const generateOrderCode = async () => {
  let orderCode;
  let exists = true;
  while (exists) {
    orderCode = Math.floor(Date.now() / 1000) * 100 + Math.floor(Math.random() * 100);
    if (orderCode > 9007199254740991) {
      orderCode = Math.floor(Math.random() * 9007199254740991) + 1;
    }
    const found = await Payment.findOne({ orderCode });
    exists = Boolean(found);
  }
  return orderCode;
};

const getPaymentPlanCode = (paymentOrMetadata) => getPlanCode(
  paymentOrMetadata?.metadata?.toPlan
  || paymentOrMetadata?.metadata?.planCode
  || paymentOrMetadata?.metadata?.plan
  || paymentOrMetadata?.toPlan
  || paymentOrMetadata?.planCode
  || paymentOrMetadata?.plan
);

const getCurrentActiveSubscription = async (restaurantId, now = new Date()) => {
  let restaurant = null;
  try {
    const query = Restaurant.findById(restaurantId);
    if (query && typeof query.select === 'function') {
      const selected = query.select('ownerId');
      restaurant = typeof selected.lean === 'function' ? await selected.lean() : await selected;
    } else if (query) {
      restaurant = await query;
    }
  } catch (err) {
    // ignored
  }

  let filter = { restaurantId, status: 'active' };
  if (restaurant?.ownerId) {
    filter = { ownerId: restaurant.ownerId, status: 'active' };
  }
  return Subscription.findOne({
    ...filter,
    $or: [
      { currentPeriodEnd: { $gt: now } },
      { expiredAt: { $gt: now } },
    ],
  }).sort({ currentPeriodEnd: -1, expiredAt: -1, createdAt: -1 });
};

const expireOldPendingPayments = async ({ userId, targetType, targetId }) => {
  await expirePendingPayments({ userId, targetType, targetId });
};

const findReusablePendingPayment = async ({ userId, targetType, targetId, metadata }) => {
  await expireOldPendingPayments({ userId, targetType, targetId });

  const pendingPayments = await Payment.find({
    userId,
    targetType,
    targetId,
    status: 'pending',
    $or: [
      { expiredAt: null },
      { expiredAt: { $gt: new Date() } },
    ],
  }).sort({ createdAt: -1 });

  if (!pendingPayments.length) return null;

  if (targetType !== 'subscription') {
    const candidate = pendingPayments.find((payment) => payment.checkoutUrl);
    if (candidate) {
      try {
        const payosInfo = await payosService.getPaymentInfo(Number(candidate.orderCode));
        const gatewayStatus = payosInfo?.data?.status;
        if (gatewayStatus && gatewayStatus !== 'PENDING') {
          candidate.status = gatewayStatus === 'PAID' ? 'paid' : (gatewayStatus === 'EXPIRED' ? 'expired' : 'cancelled');
          if (candidate.status !== 'paid') {
            candidate.cancelledAt = new Date();
          } else {
            candidate.paidAt = new Date();
            await _processPaymentSuccess(candidate, null);
          }
          await candidate.save();
          return findReusablePendingPayment({ userId, targetType, targetId, metadata });
        }
      } catch (err) {
        console.error('Error verifying reusable payment with PayOS:', err.message);
        const isNotFoundError = err.response?.status === 404 || 
                               err.message.includes('404') || 
                               err.message.toLowerCase().includes('not found') || 
                               err.message.includes('không tồn tại');
        if (isNotFoundError) {
          candidate.status = 'cancelled';
          candidate.cancelledAt = new Date();
          await candidate.save();
          return findReusablePendingPayment({ userId, targetType, targetId, metadata });
        }
      }
      return candidate;
    }
    return null;
  }

  const requestedPlan = getPaymentPlanCode(metadata);
  const reusable = pendingPayments.find((payment) => (
    payment.checkoutUrl && getPaymentPlanCode(payment) === requestedPlan
  ));

  const stalePayments = pendingPayments.filter((payment) => String(payment._id) !== String(reusable?._id));
  await Promise.all(stalePayments.map(async (payment) => {
    payment.status = 'cancelled';
    payment.cancelledAt = new Date();
    await payment.save();
  }));

  return reusable || null;
};

const createZeroDepositBookingSuccess = async (booking, res) => {
  booking.depositPaid = true;
  booking.depositPaidAt = new Date();
  booking.status = 'confirmed';
  booking.statusHistory.push({
    status: 'confirmed',
    changedAt: new Date(),
    note: 'Deposit waived by voucher discount',
  });
  await booking.save();

  if (booking.voucherId) {
    try {
      await voucherService.redeemVoucher(
        booking.voucherId.code,
        booking.restaurantId?._id || booking.restaurantId,
        booking.customerId,
        booking.depositAmount,
        booking._id,
        null
      );
    } catch (error) {
      console.error('Zero-deposit voucher redeem error:', error.message);
    }
  }

  return res.status(200).json({
    success: true,
    message: 'Deposit confirmed without payment because voucher covered the full amount.',
    data: {
      status: 'paid',
      amount: 0,
      bookingId: booking._id,
    },
  });
};

exports.createPayment = async (req, res) => {
  try {
    const { targetType, targetId } = req.body;
    const userId = req.user._id;

    if (!targetType || !targetId) {
      return res.status(400).json({ success: false, message: 'targetType and targetId are required.' });
    }

    let amount = 0;
    let description = '';
    let restaurantId = null;
    let metadata = {};
    let booking = null;

    if (targetType === 'booking') {
      booking = await Booking.findById(targetId).populate('restaurantId').populate('voucherId');
      if (!booking) {
        return res.status(404).json({ success: false, message: 'Booking not found.' });
      }
      if (String(booking.customerId) !== String(userId)) {
        return res.status(403).json({ success: false, message: 'You cannot pay for this booking.' });
      }
      if (booking.depositPaid) {
        return res.status(400).json({ success: false, message: 'Booking deposit was already paid.' });
      }

      amount = Math.max((booking.depositAmount || 0) - (booking.discountAmount || 0), 0);
      if (amount <= 0) return createZeroDepositBookingSuccess(booking, res);

      description = `Dat coc ban #${booking._id.toString().slice(-6).toUpperCase()}`;
      restaurantId = booking.restaurantId?._id || booking.restaurantId;
      metadata = {
        bookingDate: booking.bookingDate,
        numberOfGuests: booking.numberOfGuests,
      };
    } else if (targetType === 'subscription') {
      const restaurant = await Restaurant.findById(targetId).select('_id ownerId name');
      if (!restaurant) {
        return res.status(404).json({ success: false, message: 'Restaurant not found.' });
      }
      if (String(restaurant.ownerId) !== String(userId)) {
        return res.status(403).json({
          success: false,
          code: 'OWNER_RESTAURANT_FORBIDDEN',
          message: 'Restaurant does not belong to this owner.',
        });
      }

      const plan = getPlanCode(req.body.planCode || req.body.plan);
      const planInfo = getPlanInfo(plan);
      if (!planInfo) {
        return res.status(400).json({ success: false, message: 'Invalid subscription plan.' });
      }
      if (planInfo.price <= 0) {
        return res.status(400).json({ success: false, message: 'Free plan does not require payment.' });
      }

      const now = new Date();
      const currentSub = await getCurrentActiveSubscription(targetId, now);
      if (currentSub) {
        const currentPlan = getPlanCode(currentSub.planCode || currentSub.plan);
        if (plan === currentPlan) {
          amount = planInfo.price;
          description = `Gia han goi ${planInfo.name}`;
          metadata = { plan, planCode: plan, isRenewal: true };
        } else if ((PLAN_ORDER[plan] ?? 0) < (PLAN_ORDER[currentPlan] ?? 0)) {
          return res.status(400).json({
            success: false,
            message: `Cannot downgrade from ${currentPlan} to ${plan} while the current plan is active.`,
          });
        } else {
          const currentEnd = currentSub.currentPeriodEnd || currentSub.expiredAt || now;
          const remainingDays = Math.max(0, Math.ceil((currentEnd - now) / (1000 * 60 * 60 * 24)));
          const currentPlanInfo = getPlanInfo(currentPlan) || SUBSCRIPTION_PLANS.free;
          const dailyRate = currentPlanInfo.durationDays ? currentPlanInfo.price / currentPlanInfo.durationDays : 0;
          const creditAmount = Math.floor(dailyRate * remainingDays);
          amount = Math.max(planInfo.price - creditAmount, MIN_PAYMENT_AMOUNT);
          description = `Nang cap goi ${currentPlan} -> ${plan}`;
          metadata = {
            fromPlan: currentPlan,
            toPlan: plan,
            planCode: plan,
            creditAmount,
            remainingDays,
          };
        }
      } else {
        amount = planInfo.price;
        description = `Mua goi ${planInfo.name}`;
        metadata = { plan, planCode: plan };
      }

      restaurantId = restaurant._id;
    } else {
      return res.status(400).json({
        success: false,
        message: 'This payment targetType is not supported yet.',
      });
    }

    const reusablePending = await findReusablePendingPayment({
      userId,
      targetType,
      targetId,
      metadata,
    });

    if (reusablePending) {
      return res.status(200).json({
        success: true,
        message: 'Using existing pending payment link.',
        data: reusablePending,
      });
    }

    const orderCode = await generateOrderCode();
    const payment = await Payment.create({
      userId,
      targetType,
      targetId,
      restaurantId,
      amount,
      orderCode,
      description,
      metadata,
      status: 'pending',
      voucherId: targetType === 'booking' ? (booking.voucherId?._id || booking.voucherId) : null,
      discountApplied: targetType === 'booking' ? (booking.discountAmount || 0) : 0,
      amountBeforeDiscount: targetType === 'booking' ? (booking.depositAmount || 0) : amount,
    });

    try {
      const payosResponse = await payosService.createPaymentLink(
        orderCode,
        amount,
        description.substring(0, 25),
        undefined,
        undefined,
        targetType,
      );

      if (payosResponse?.data) {
        payment.checkoutUrl = payosResponse.data.checkoutUrl;
        payment.paymentLinkId = payosResponse.data.paymentLinkId;
        payment.qrCode = payosResponse.data.qrCode || null;
        payment.expiredAt = new Date(Date.now() + payosConfig.expirationMinutes * 60 * 1000);
        await payment.save();
      }
    } catch (payosError) {
      console.error('Create PayOS payment link error:', payosError.message);
      payment.status = 'failed';
      await payment.save();
      return res.status(500).json({
        success: false,
        message: 'Cannot create PayOS payment link. Please try again.',
        error: payosError.message,
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Payment link created.',
      data: payment,
    });
  } catch (error) {
    console.error('createPayment error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getMyPayments = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, targetType } = req.query;
    const filter = { userId: req.user._id };
    if (status) filter.status = status;
    if (targetType) filter.targetType = targetType;

    const payments = await Payment.find(filter)
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .populate('restaurantId', 'name');

    const total = await Payment.countDocuments(filter);

    return res.status(200).json({
      success: true,
      data: payments,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPaymentById = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id)
      .populate('userId', 'fullName email phoneNumber')
      .populate('restaurantId', 'name');

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found.' });
    }

    if (String(payment.userId._id) !== String(req.user._id) && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'You cannot view this payment.' });
    }

    return res.status(200).json({ success: true, data: payment });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.checkPaymentStatus = async (req, res) => {
  try {
    const { orderCode } = req.params;
    await expirePendingPayments({ orderCode });
    const payment = await Payment.findOne({ orderCode: Number(orderCode) });

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found.' });
    }
    if (String(payment.userId) !== String(req.user._id) && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'You cannot view this payment.' });
    }

    const responseData = payment.toObject();

    if (payment.status === 'paid') {
      let entitlementMissing = false;
      if (payment.targetType === 'subscription') {
        const existingSubscription = await Subscription.findOne({ paymentId: payment._id });
        if (!existingSubscription) entitlementMissing = true;
      } else if (payment.targetType === 'featured_restaurant') {
        const existingPlacement = await FeaturedPlacement.findOne({ paymentId: payment._id, status: 'active' });
        if (!existingPlacement) entitlementMissing = true;
      } else if (payment.targetType === 'voucher_campaign') {
        const existingCampaign = await VoucherCampaignPurchase.findOne({ paymentId: payment._id, status: 'active' });
        if (!existingCampaign) entitlementMissing = true;
      }

      if (entitlementMissing) {
        console.log(`[Repair/checkStatus] Reconciling paid payment ${payment._id} (${payment.targetType}) with missing entitlement.`);
        await activatePaidPaymentEntitlement(payment, req.app?.get?.('io') || null);
      }
      return res.status(200).json({ success: true, data: responseData });
    }
    if (['failed', 'cancelled', 'expired', 'refunded', 'partially_refunded'].includes(payment.status)) {
      return res.status(200).json({ success: true, data: responseData });
    }

    try {
      const payosInfo = await payosService.getPaymentInfo(Number(orderCode));
      const gatewayStatus = payosInfo?.data?.status || null;
      responseData.gatewayStatus = gatewayStatus;

      if (gatewayStatus === 'PAID' && payment.status === 'pending') {
        const claimedPayment = await Payment.findOneAndUpdate(
          {
            _id: payment._id,
            status: 'pending',
          },
          {
            $set: {
              status: 'paid',
              paidAt: new Date(),
            },
          },
          { new: true }
        );

        if (claimedPayment) {
          await _processPaymentSuccess(claimedPayment, req.app?.get?.('io') || null);

          await Transaction.findOneAndUpdate(
            { idempotencyKey: `payment:${claimedPayment._id}` },
            {
              $setOnInsert: {
                paymentId: claimedPayment._id,
                idempotencyKey: `payment:${claimedPayment._id}`,
                type: 'payment',
                amount: claimedPayment.amount,
                status: 'success',
                gateway: 'payos',
                gatewayTransactionId: payosInfo?.data?.reference || payosInfo?.data?.paymentLinkId || null,
                rawPayload: payosInfo?.data || {},
              },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );

          payment.status = 'paid';
          payment.paidAt = claimedPayment.paidAt;
          responseData.status = 'paid';
          responseData.paidAt = claimedPayment.paidAt;
        }
      } else if (['CANCELLED', 'EXPIRED'].includes(gatewayStatus) && payment.status === 'pending') {
        payment.status = gatewayStatus === 'EXPIRED' ? 'expired' : 'cancelled';
        payment.cancelledAt = new Date();
        if (gatewayStatus === 'EXPIRED') {
          payment.expiredAt = payment.expiredAt || payment.cancelledAt;
        }
        await payment.save();
        await featuredPlacementService.cancelFeaturedPlacementForPayment(payment, payment.cancelledAt);
        await voucherCampaignService.cancelVoucherCampaignForPayment(payment, payment.cancelledAt);
        responseData.status = payment.status;
        responseData.cancelledAt = payment.cancelledAt;
        notificationService.notifyPaymentStatus(req.app?.get?.('io') || null, {
          payment,
          status: 'failed',
        }).catch((error) => console.warn(`[PaymentNotification/cancelled] ${error.message}`));
      }
    } catch (payosError) {
      console.error('Check PayOS status error:', payosError.message);
    }

    return res.status(200).json({ success: true, data: responseData });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.cancelPayment = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found.' });
    }
    if (String(payment.userId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'You cannot cancel this payment.' });
    }
    if (payment.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Only pending payments can be cancelled.' });
    }

    try {
      await payosService.cancelPaymentLink(payment.orderCode);
    } catch (error) {
      console.error('PayOS cancel error:', error.message);
    }

    payment.status = 'cancelled';
    payment.cancelledAt = new Date();
    await payment.save();
    await featuredPlacementService.cancelFeaturedPlacementForPayment(payment, payment.cancelledAt);
    await voucherCampaignService.cancelVoucherCampaignForPayment(payment, payment.cancelledAt);

    notificationService.notifyPaymentStatus(req.app?.get?.('io') || null, {
      payment,
      status: 'failed',
    }).catch((error) => console.warn(`[PaymentNotification/user_cancelled] ${error.message}`));

    return res.status(200).json({ success: true, message: 'Payment cancelled.', data: payment });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

async function _processPaymentSuccess(payment, io = null) {
  if (payment.targetType === 'booking') {
    const booking = await Booking.findById(payment.targetId).populate('voucherId');
    if (!booking) return;
    if (booking.depositPaid && String(booking.paymentId || '') === String(payment._id)) return;

    booking.depositPaid = true;
    booking.depositPaidAt = booking.depositPaidAt || new Date();
    booking.paymentId = payment._id;
    booking.status = 'confirmed';
    booking.statusHistory.push({
      status: 'confirmed',
      changedAt: new Date(),
      note: 'Deposit paid via PayOS',
    });
    await booking.save();

    if (booking.voucherId) {
      try {
        await voucherService.redeemVoucher(
          booking.voucherId.code,
          booking.restaurantId,
          booking.customerId,
          booking.depositAmount,
          booking._id,
          payment._id
        );
      } catch (error) {
        console.error(`Voucher redeem after payment error: ${error.message}`);
      }
    }

    const restaurant = await Restaurant.findById(booking.restaurantId).select('_id ownerId name');
    notificationService.notifyPaymentStatus(io, {
      payment,
      booking,
      restaurant,
      status: 'success',
    }).catch((error) => console.warn(`[PaymentNotification/success] ${error.message}`));
    return;
  }

  if (payment.targetType === 'subscription') {
    const existingSubscription = await Subscription.findOne({ paymentId: payment._id });
    if (existingSubscription) return;

    const plan = getPaymentPlanCode(payment);
    const planInfo = getPlanInfo(plan);
    if (!planInfo) return;

    const now = new Date();
    const currentActiveSub = await getCurrentActiveSubscription(payment.targetId, now);
    const currentPlan = getPlanCode(currentActiveSub?.planCode || currentActiveSub?.plan);

    let currentPeriodStart = now;
    let currentPeriodEnd = new Date(now.getTime() + planInfo.durationDays * 24 * 60 * 60 * 1000);

    if (currentActiveSub && plan === currentPlan) {
      const baseDate = currentActiveSub.currentPeriodEnd || currentActiveSub.expiredAt || now;
      currentPeriodStart = baseDate > now ? baseDate : now;
      currentPeriodEnd = new Date(currentPeriodStart.getTime() + planInfo.durationDays * 24 * 60 * 60 * 1000);
      currentActiveSub.status = 'expired';
      await currentActiveSub.save();
    } else {
      await Subscription.updateMany(
        { restaurantId: payment.targetId, status: 'active' },
        { status: 'expired' }
      );
    }

    await Subscription.create({
      ownerId: payment.userId,
      restaurantId: payment.targetId,
      plan,
      planCode: plan,
      status: 'active',
      autoRenew: false,
      startedAt: currentPeriodStart,
      expiredAt: currentPeriodEnd,
      currentPeriodStart,
      currentPeriodEnd,
      paymentId: payment._id,
      benefitsSnapshot: planInfo.benefits,
    });

    const restaurant = await Restaurant.findById(payment.targetId).select('_id ownerId name');
    notificationService.notifyPaymentStatus(io, {
      payment,
      restaurant,
      status: 'success',
    }).catch((error) => console.warn(`[PaymentNotification/subscription] ${error.message}`));
    return;
  }

  if (payment.targetType === 'featured_restaurant') {
    const placement = await featuredPlacementService.activateFeaturedPlacementFromPayment(payment);
    const restaurant = await Restaurant.findById(payment.restaurantId || payment.targetId).select('_id ownerId name');
    notificationService.notifyPaymentStatus(io, {
      payment,
      restaurant,
      status: placement ? 'success' : 'failed',
    }).catch((error) => console.warn(`[PaymentNotification/featured] ${error.message}`));
    return;
  }

  if (payment.targetType === 'voucher_campaign') {
    const campaign = await voucherCampaignService.activateVoucherCampaignFromPayment(payment);
    const restaurant = await Restaurant.findById(payment.restaurantId || payment.metadata?.restaurantId)
      .select('_id ownerId name');
    notificationService.notifyPaymentStatus(io, {
      payment,
      restaurant,
      status: campaign ? 'success' : 'failed',
    }).catch((error) => console.warn(`[PaymentNotification/voucher_campaign] ${error.message}`));
  }
}

async function activatePaidPaymentEntitlement(payment, io = null) {
  if (!payment) return null;
  if (payment.status !== 'paid') return null;
  return _processPaymentSuccess(payment, io);
}

exports._processPaymentSuccess = _processPaymentSuccess;
exports.activatePaidPaymentEntitlement = activatePaidPaymentEntitlement;
