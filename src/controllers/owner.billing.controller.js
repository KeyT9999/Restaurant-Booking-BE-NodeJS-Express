const Payment = require('../models/Payment');
const Subscription = require('../models/Subscription');
const paymentController = require('./payment.controller');
const { PLAN_ORDER, SUBSCRIPTION_PLANS, getPlanCode } = require('../config/payos.config');
const { getActivePlans } = require('../services/monetization-plan.service');
const { expirePendingPayments } = require('../services/payment-lifecycle.service');
const {
  assertOwnerRestaurant,
  getActiveSubscriptionForRestaurant,
  canCreateRestaurant,
} = require('../services/plan-gating.service');

const BILLING_TARGET_TYPES = [
  'subscription',
  'featured_restaurant',
  'voucher_campaign',
  'booking_fee',
  'deposit_platform_fee',
];

const getRestaurantId = (req) => req.query?.restaurantId || req.body?.restaurantId || req.body?.targetId;

const normalizePlan = (plan) => ({
  key: plan.code,
  code: plan.code,
  name: plan.name,
  price: plan.priceMonthly ?? plan.price ?? 0,
  priceMonthly: plan.priceMonthly ?? plan.price ?? 0,
  priceYearly: plan.priceYearly ?? 0,
  features: plan.features || [],
  limits: plan.limits || {},
  benefits: plan.benefits || {},
  sortOrder: plan.sortOrder ?? PLAN_ORDER[plan.code] ?? 0,
});

const serializeSubscription = (subscription) => {
  if (!subscription) return null;
  const planCode = getPlanCode(subscription.planCode || subscription.plan || 'free') || 'free';
  return {
    _id: subscription._id,
    ownerId: subscription.ownerId,
    restaurantId: subscription.restaurantId,
    plan: planCode,
    planCode,
    status: subscription.status,
    autoRenew: subscription.autoRenew,
    startedAt: subscription.startedAt,
    expiredAt: subscription.expiredAt || subscription.currentPeriodEnd,
    currentPeriodStart: subscription.currentPeriodStart || subscription.startedAt,
    currentPeriodEnd: subscription.currentPeriodEnd || subscription.expiredAt,
    paymentId: subscription.paymentId,
    benefitsSnapshot: subscription.benefitsSnapshot,
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt,
  };
};

const findPendingPayment = async (userId, restaurantId) => Payment.findOne({
  userId,
  restaurantId,
  targetType: 'subscription',
  status: 'pending',
  $or: [
    { expiredAt: null },
    { expiredAt: { $gt: new Date() } },
  ],
}).sort({ createdAt: -1 }).lean();

const repairPaidPaymentsForRestaurant = async (restaurantId, userId, io = null) => {
  try {
    const paidPayments = await Payment.find({
      userId,
      restaurantId,
      targetType: 'subscription',
      status: 'paid',
    });

    for (const payment of paidPayments) {
      const existingSubscription = await Subscription.findOne({ paymentId: payment._id });
      if (!existingSubscription) {
        console.log(`[Repair] Reconciling paid payment ${payment._id} with missing subscription.`);
        await paymentController.activatePaidPaymentEntitlement(payment, io);
      }
    }
  } catch (error) {
    console.error('[Repair] Error during subscription repair:', error.message);
  }
};

const buildBillingContext = async (req) => {
  const restaurantId = getRestaurantId(req);
  if (!restaurantId) {
    const error = new Error('restaurantId is required.');
    error.statusCode = 400;
    throw error;
  }

  const restaurant = await assertOwnerRestaurant(req.user._id, restaurantId);
  await repairPaidPaymentsForRestaurant(restaurantId, req.user._id, req.app?.get?.('io') || null);

  await expirePendingPayments({
    userId: req.user._id,
    restaurantId,
    targetType: 'subscription',
  });
  const plans = (await getActivePlans()).map(normalizePlan);
  const activeSubscription = await getActiveSubscriptionForRestaurant(restaurantId);
  const currentPlan = getPlanCode(activeSubscription?.planCode || activeSubscription?.plan || 'free') || 'free';
  const currentOrder = PLAN_ORDER[currentPlan] ?? 0;
  const planInfo = plans.find((plan) => plan.code === currentPlan)
    || normalizePlan(SUBSCRIPTION_PLANS.free);
  const pendingPayment = await findPendingPayment(req.user._id, restaurantId);

  const availablePlans = plans.map((plan) => ({
    ...plan,
    isCurrent: plan.code === currentPlan,
    canSelect: plan.code !== 'free' && (PLAN_ORDER[plan.code] ?? 0) >= currentOrder,
  }));

  const quota = await canCreateRestaurant(req.user._id);

  return {
    restaurant: {
      id: restaurant._id,
      name: restaurant.name,
    },
    currentPlan,
    planInfo,
    subscription: serializeSubscription(activeSubscription),
    pendingPayment,
    availablePlans,
    restaurantQuota: {
      planCode: quota.planCode,
      currentCount: quota.currentCount,
      limit: quota.limit,
      remaining: quota.remaining,
      recommendedPlan: quota.recommendedPlan,
    },
  };
};

exports.getPlans = async (req, res) => {
  try {
    const plans = (await getActivePlans()).map(normalizePlan);
    return res.status(200).json({ success: true, data: plans });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getCurrentSubscription = async (req, res) => {
  try {
    const data = await buildBillingContext(req);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({
      success: false,
      code: error.code,
      message: error.message,
    });
  }
};

exports.checkoutSubscription = async (req, res) => {
  const restaurantId = getRestaurantId(req);
  const plan = getPlanCode(req.body.planCode || req.body.plan);
  req.body = {
    ...req.body,
    targetType: 'subscription',
    targetId: restaurantId,
    restaurantId,
    plan,
    planCode: plan,
  };
  return paymentController.createPayment(req, res);
};

exports.getTransactions = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      targetType,
    } = req.query;
    const restaurantId = getRestaurantId(req);
    const filter = {
      userId: req.user._id,
      targetType: targetType || { $in: BILLING_TARGET_TYPES },
    };

    if (status) filter.status = status;
    if (restaurantId) {
      await assertOwnerRestaurant(req.user._id, restaurantId);
      filter.restaurantId = restaurantId;
    }

    const payments = await Payment.find(filter)
      .select('-qrCode')
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
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      code: error.code,
      message: error.message,
    });
  }
};

exports.getTransactionById = async (req, res) => {
  try {
    const payment = await Payment.findOne({
      _id: req.params.id,
      userId: req.user._id,
      targetType: { $in: BILLING_TARGET_TYPES },
    })
      .select('-qrCode')
      .populate('restaurantId', 'name');

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Billing transaction not found.' });
    }

    if (payment.restaurantId?._id) {
      await assertOwnerRestaurant(req.user._id, payment.restaurantId._id);
    }

    return res.status(200).json({ success: true, data: payment });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      code: error.code,
      message: error.message,
    });
  }
};

exports.getBillingHistory = exports.getTransactions;

exports.createDefaultFreeSubscription = async (ownerId, restaurantId) => Subscription.create({
  ownerId,
  restaurantId,
  plan: 'free',
  planCode: 'free',
  status: 'free',
  startedAt: new Date(),
  currentPeriodStart: new Date(),
  benefitsSnapshot: SUBSCRIPTION_PLANS.free.benefits,
});
