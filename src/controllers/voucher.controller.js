'use strict';

const Voucher = require('../models/Voucher');
const CustomerVoucher = require('../models/CustomerVoucher');
const VoucherRedemption = require('../models/VoucherRedemption');
const voucherService = require('../services/voucher.service');
const voucherCampaignService = require('../services/voucher-campaign.service');
const { assertOwnerRestaurant } = require('../services/plan-gating.service');
const notificationService = require('../services/notification.service');

const isOwnerRole = (role) => role === 'restaurant_owner' || role === 'owner';

const sendNotification = (promise, label) => {
  Promise.resolve(promise).catch((error) => {
    console.warn(`[VoucherNotification/${label}] ${error.message}`);
  });
};

/**
 * 1. Validate voucher code for checkout preview
 * POST /api/v1/vouchers/validate
 */
exports.validateVoucherForBooking = async (req, res) => {
  try {
    const { code, restaurantId, orderAmount } = req.body;
    const customerId = req.user ? req.user._id : null;
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    const result = await voucherService.validateVoucher(
      code,
      restaurantId,
      customerId,
      orderAmount,
      ipAddress
    );
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 2. Save voucher to customer's wallet
 * POST /api/v1/vouchers/save
 */
exports.saveVoucher = async (req, res) => {
  try {
    const { voucherId } = req.body;
    const customerId = req.user._id;

    const saved = await voucherService.saveVoucherForCustomer(voucherId, customerId, 'manual_save');
    return res.status(200).json({ success: true, message: 'Đã lưu voucher vào ví thành công', data: saved });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * 3. Unsave voucher from customer's wallet
 * DELETE /api/v1/vouchers/unsave/:voucherId
 */
exports.unsaveVoucher = async (req, res) => {
  try {
    const { voucherId } = req.params;
    const customerId = req.user._id;

    await voucherService.unsaveVoucherForCustomer(voucherId, customerId);
    return res.status(200).json({ success: true, message: 'Đã bỏ lưu voucher thành công.' });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * 4. Get customer's saved vouchers wallet
 * GET /api/v1/vouchers/my-vouchers
 */
exports.getMyVouchers = async (req, res) => {
  try {
    const customerId = req.user._id;
    const { filter = 'all' } = req.query;

    const list = await voucherService.getCustomerVouchers(customerId, filter);
    return res.status(200).json({ success: true, data: list });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 5. Get customer's voucher redemption history
 * GET /api/v1/vouchers/my-history
 */
exports.getMyVouchersHistory = async (req, res) => {
  try {
    const customerId = req.user._id;
    const { page = 1, limit = 10 } = req.query;

    const skipIndex = (parseInt(page) - 1) * parseInt(limit);

    const [redemptions, total] = await Promise.all([
      VoucherRedemption.find({ customerId, status: 'completed' })
        .populate({
          path: 'voucherId',
          populate: {
            path: 'restaurantId',
            select: 'name address logo images',
          },
        })
        .populate('bookingId', 'bookingDate bookingTime numberOfGuests status')
        .sort({ usedAt: -1 })
        .skip(skipIndex)
        .limit(parseInt(limit)),
      VoucherRedemption.countDocuments({ customerId, status: 'completed' }),
    ]);

    return res.status(200).json({
      success: true,
      data: redemptions,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 6. Get platform-wide active vouchers
 * GET /api/v1/vouchers/platform
 */
exports.getPlatformVouchers = async (req, res) => {
  try {
    const now = new Date();
    const { page = 1, limit = 10 } = req.query;

    const filter = {
      type: { $in: ['platform', 'loyalty'] },
      status: 'active',
      startDate: { $lte: now },
      $or: [
        { endDate: null },
        { endDate: { $gte: now } },
      ],
    };

    const skipIndex = (parseInt(page) - 1) * parseInt(limit);

    const [vouchers, total] = await Promise.all([
      Voucher.find(filter)
        .sort({ priority: -1, createdAt: -1 })
        .skip(skipIndex)
        .limit(parseInt(limit)),
      Voucher.countDocuments(filter),
    ]);

    // If user is logged in, attach isSaved flag
    let savedVoucherIds = [];
    if (req.user) {
      savedVoucherIds = await CustomerVoucher.find({ customerId: req.user._id }).distinct('voucherId');
    }

    const modifiedVouchers = vouchers.map(v => {
      const item = v.toObject();
      item.isSaved = savedVoucherIds.some(id => id.toString() === v._id.toString());
      return item;
    });

    return res.status(200).json({
      success: true,
      data: modifiedVouchers,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 7. Get available vouchers at a specific restaurant
 * GET /api/v1/vouchers/restaurant/:restaurantId
 */
exports.getRestaurantVouchers = async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const customerId = req.user ? req.user._id : null;

    const list = await voucherService.getAvailableRestaurantVouchers(restaurantId, customerId);
    return res.status(200).json({ success: true, data: list });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getHomepageVoucherCampaigns = async (req, res) => {
  try {
    const data = await voucherCampaignService.getHomepageVoucherCampaigns({
      limit: req.query.limit,
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 8. Get specific voucher details (Public info)
 * GET /api/v1/vouchers/:id
 */
exports.getVoucherById = async (req, res) => {
  try {
    const { id } = req.params;
    const voucher = await Voucher.findById(id).populate('restaurantId', 'name address logo images');
    if (!voucher || voucher.status === 'disabled') {
      return res.status(404).json({ success: false, message: 'Voucher không tồn tại hoặc đã bị dừng hoạt động.' });
    }

    const item = voucher.toObject();
    if (req.user) {
      const saved = await CustomerVoucher.findOne({ customerId: req.user._id, voucherId: id });
      item.isSaved = !!saved;
      if (saved) {
        item.isUsed = saved.isUsed;
        item.timesUsed = saved.timesUsed;
      }
    }

    return res.status(200).json({ success: true, data: item });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 9. Internal API to redeem voucher (called when booking gets confirmed/paid)
 * POST /api/v1/internal/vouchers/redeem
 */
exports.redeemVoucherInternal = async (req, res) => {
  try {
    const { code, restaurantId, customerId, orderAmount, bookingId, paymentId } = req.body;
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const redemption = await voucherService.redeemVoucher(
      code,
      restaurantId,
      customerId,
      orderAmount,
      bookingId,
      paymentId,
      { ipAddress, userAgent }
    );

    return res.status(200).json({ success: true, data: redemption });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * 10. Internal API to reverse voucher usage (called when booking gets cancelled before confirm)
 * POST /api/v1/internal/vouchers/reverse
 */
exports.reverseVoucherInternal = async (req, res) => {
  try {
    const { bookingId, reason } = req.body;
    const actor = req.user || null;

    const redemption = await voucherService.reverseRedemption(bookingId, reason, actor);
    return res.status(200).json({ success: true, message: 'Hoàn nguyên voucher thành công.', data: redemption });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};
