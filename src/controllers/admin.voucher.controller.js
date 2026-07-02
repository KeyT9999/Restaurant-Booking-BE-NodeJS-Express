'use strict';

const Voucher = require('../models/Voucher');
const CustomerVoucher = require('../models/CustomerVoucher');
const VoucherCampaign = require('../models/VoucherCampaign');
const VoucherRedemption = require('../models/VoucherRedemption');
const User = require('../models/User');
const voucherService = require('../services/voucher.service');
const voucherAnalyticsService = require('../services/voucher.analytics.service');

/**
 * GET /api/v1/admin/vouchers
 * List all vouchers with pagination and advanced admin filters
 */
exports.getAdminVouchers = async (req, res) => {
  try {
    const { type, status, restaurantId, search, page = 1, limit = 10 } = req.query;
    const filter = {};

    if (type) filter.type = type;
    if (status) filter.status = status;
    if (restaurantId) filter.restaurantId = restaurantId === 'null' ? null : restaurantId;

    if (search) {
      filter.$or = [
        { code: new RegExp(search, 'i') },
        { name: new RegExp(search, 'i') },
      ];
    }

    const skipIndex = (parseInt(page) - 1) * parseInt(limit);

    const [vouchers, total] = await Promise.all([
      Voucher.find(filter)
        .populate('restaurantId', 'name address')
        .populate('campaignId', 'name')
        .sort({ createdAt: -1 })
        .skip(skipIndex)
        .limit(parseInt(limit)),
      Voucher.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: vouchers,
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
 * POST /api/v1/admin/vouchers
 * Create a platform-wide or restaurant-specific voucher from Admin console
 */
exports.createPlatformVoucher = async (req, res) => {
  try {
    const {
      name,
      code,
      description,
      type = 'platform',
      customerSegments = ['all'],
      applicableRestaurants = [],
      applicableCities = [],
      applicableCategories = [],
      stackable = false,
      priority = 0,
      campaignId = null,
      discountType,
      discountValue,
      maxDiscountAmount,
      minOrderAmount,
      startDate,
      endDate,
      globalUsageLimit,
      perCustomerLimit,
      restaurantId,
      pointsCost,
    } = req.body;

    const uppercaseCode = code.toUpperCase().trim();
    const existing = await Voucher.findOne({ code: uppercaseCode });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Mã voucher này đã tồn tại trên hệ thống.' });
    }

    const now = new Date();
    const start = startDate ? new Date(startDate) : now;
    const end = endDate ? new Date(endDate) : null;

    if (end && start >= end) {
      return res.status(400).json({ success: false, message: 'Ngày kết thúc phải sau ngày bắt đầu.' });
    }

    const initialStatus = start > now ? 'scheduled' : 'active';

    const voucher = new Voucher({
      name,
      code: uppercaseCode,
      description,
      type,
      createdByRole: 'admin',
      customerSegments,
      applicableRestaurants,
      applicableCities,
      applicableCategories,
      stackable,
      priority,
      campaignId: campaignId || null,
      discountType,
      discountValue,
      maxDiscountAmount: discountType === 'percentage' ? (maxDiscountAmount || null) : null,
      minOrderAmount: minOrderAmount || 0,
      startDate: start,
      endDate: end,
      globalUsageLimit: globalUsageLimit ? parseInt(globalUsageLimit) : null,
      perCustomerLimit: perCustomerLimit ? parseInt(perCustomerLimit) : 1,
      restaurantId: restaurantId || null,
      createdBy: req.user._id,
      status: initialStatus,
      pointsCost: type === 'loyalty' ? (parseInt(pointsCost) || 0) : 0,
    });

    await voucher.save();

    await voucherService.logAudit({
      voucherId: voucher._id,
      action: 'create',
      actorId: req.user._id,
      actorRole: 'admin',
      result: 'success',
    });

    return res.status(201).json({ success: true, message: 'Tạo voucher platform thành công', data: voucher });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PUT /api/v1/admin/vouchers/:id
 * Update any voucher parameters
 */
exports.updateAdminVoucher = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      customerSegments,
      applicableRestaurants,
      applicableCities,
      applicableCategories,
      stackable,
      priority,
      campaignId,
      status,
      endDate,
      minOrderAmount,
      maxDiscountAmount,
      globalUsageLimit,
      perCustomerLimit,
      pointsCost,
    } = req.body;

    const voucher = await Voucher.findById(id);
    if (!voucher) {
      return res.status(404).json({ success: false, message: 'Voucher không tồn tại.' });
    }

    if (name) voucher.name = name;
    if (description !== undefined) voucher.description = description;
    if (customerSegments !== undefined) voucher.customerSegments = customerSegments;
    if (applicableRestaurants !== undefined) voucher.applicableRestaurants = applicableRestaurants;
    if (applicableCities !== undefined) voucher.applicableCities = applicableCities;
    if (applicableCategories !== undefined) voucher.applicableCategories = applicableCategories;
    if (stackable !== undefined) voucher.stackable = stackable;
    if (priority !== undefined) voucher.priority = priority;
    if (campaignId !== undefined) voucher.campaignId = campaignId || null;
    if (minOrderAmount !== undefined) voucher.minOrderAmount = minOrderAmount;
    if (maxDiscountAmount !== undefined) voucher.maxDiscountAmount = maxDiscountAmount;
    if (pointsCost !== undefined) {
      voucher.pointsCost = parseInt(pointsCost) || 0;
    }
    
    if (globalUsageLimit !== undefined) {
      const limit = globalUsageLimit ? parseInt(globalUsageLimit) : null;
      if (limit !== null && limit < voucher.currentUsage) {
        return res.status(400).json({ success: false, message: `Giới hạn hệ thống không thể nhỏ hơn số lượt đã dùng hiện tại (${voucher.currentUsage}).` });
      }
      voucher.globalUsageLimit = limit;
    }
    
    if (perCustomerLimit !== undefined) voucher.perCustomerLimit = perCustomerLimit ? parseInt(perCustomerLimit) : 1;

    if (endDate !== undefined) {
      if (endDate) {
        const newEnd = new Date(endDate);
        if (newEnd <= voucher.startDate) {
          return res.status(400).json({ success: false, message: 'Ngày kết thúc phải sau ngày bắt đầu.' });
        }
        voucher.endDate = newEnd;
      } else {
        voucher.endDate = null;
      }
    }

    if (status) {
      voucher.status = status;
    }

    await voucher.save();

    await voucherService.logAudit({
      voucherId: voucher._id,
      action: 'update',
      actorId: req.user._id,
      actorRole: 'admin',
      result: 'success',
    });

    return res.status(200).json({ success: true, message: 'Cập nhật voucher thành công', data: voucher });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PATCH /api/v1/admin/vouchers/:id/status
 * Lock or Unlock any voucher
 */
exports.changeAdminVoucherStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const voucher = await Voucher.findById(id);
    if (!voucher) {
      return res.status(404).json({ success: false, message: 'Voucher không tồn tại.' });
    }

    voucher.status = status;
    await voucher.save();

    await voucherService.logAudit({
      voucherId: voucher._id,
      action: 'status_change',
      actorId: req.user._id,
      actorRole: 'admin',
      result: 'success',
      metadata: { newStatus: status },
    });

    return res.status(200).json({ success: true, message: `Thay đổi trạng thái voucher thành công sang: ${status}`, data: voucher });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * DELETE /api/v1/admin/vouchers/:id
 * Delete voucher (Soft delete by default)
 */
exports.deleteAdminVoucher = async (req, res) => {
  try {
    const { id } = req.params;
    const { force = 'false' } = req.query;

    const voucher = await Voucher.findById(id);
    if (!voucher) {
      return res.status(404).json({ success: false, message: 'Voucher không tồn tại.' });
    }

    if (force === 'true') {
      await Voucher.findByIdAndDelete(id);
      await CustomerVoucher.deleteMany({ voucherId: id });
      await VoucherRedemption.deleteMany({ voucherId: id });
    } else {
      voucher.status = 'disabled';
      await voucher.save();
    }

    await voucherService.logAudit({
      voucherId: id,
      action: 'delete',
      actorId: req.user._id,
      actorRole: 'admin',
      result: 'success',
      metadata: { forceDelete: force },
    });

    return res.status(200).json({ success: true, message: 'Xóa voucher thành công.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/v1/admin/vouchers/analytics
 * System wide metrics
 */
exports.getAdminVouchersAnalytics = async (req, res) => {
  try {
    const { startDate, endDate, granularity = 'day' } = req.query;
    const dateRange = {};
    if (startDate) dateRange.startDate = startDate;
    if (endDate) dateRange.endDate = endDate;

    const [topVouchers, conversion, usageTrend, finance] = await Promise.all([
      voucherAnalyticsService.getTopVouchers(dateRange, 10),
      voucherAnalyticsService.getConversionRate(dateRange),
      voucherAnalyticsService.getUsageByDate(dateRange, granularity),
      voucherAnalyticsService.getRevenueImpact(dateRange),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        topVouchers,
        conversion,
        usageTrend,
        finance,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/v1/admin/vouchers/fraud-report
 * Suspicious activity logging
 */
exports.getAdminVouchersFraudReport = async (req, res) => {
  try {
    const report = await voucherAnalyticsService.getFraudPatterns();
    return res.status(200).json({ success: true, data: report });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/v1/admin/vouchers/:id/reset-usage
 * Reset voucher currentUsage
 */
exports.resetAdminVoucherUsage = async (req, res) => {
  try {
    const { id } = req.params;
    const { count = 0 } = req.body;

    const voucher = await Voucher.findById(id);
    if (!voucher) {
      return res.status(404).json({ success: false, message: 'Voucher không tồn tại.' });
    }

    const previousCount = voucher.currentUsage;
    voucher.currentUsage = parseInt(count);
    await voucher.save();

    await voucherService.logAudit({
      voucherId: id,
      action: 'update',
      actorId: req.user._id,
      actorRole: 'admin',
      result: 'success',
      metadata: { actionDetail: 'reset-usage', previousCount, newCount: count },
    });

    return res.status(200).json({ success: true, message: 'Đã reset lượt sử dụng của voucher thành công.', data: voucher });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/v1/admin/vouchers/compensation
 * Issue compensation voucher to specific customer
 */
exports.issueAdminVoucherCompensation = async (req, res) => {
  try {
    const { customerId, name, discountType, discountValue, minOrderAmount, daysValid = 30 } = req.body;

    const customer = await User.findById(customerId);
    if (!customer || customer.role !== 'customer') {
      return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản khách hàng.' });
    }

    const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase();
    const code = `COMP-${randomStr}-${Date.now().toString().slice(-4)}`;

    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + daysValid * 24 * 60 * 60 * 1000);

    const voucher = new Voucher({
      name: name || 'Voucher đền bù dịch vụ',
      code,
      description: 'Voucher cá nhân hóa dành riêng cho bạn vì sự bất tiện của hệ thống.',
      type: 'compensation',
      createdByRole: 'admin',
      customerSegments: ['all'],
      discountType,
      discountValue,
      minOrderAmount: minOrderAmount || 0,
      startDate,
      endDate,
      globalUsageLimit: 1,
      perCustomerLimit: 1,
      createdBy: req.user._id,
      status: 'active',
    });

    await voucher.save();

    // Auto-save to customer's wallet
    await voucherService.saveVoucherForCustomer(voucher._id, customer._id, 'milestone');

    await voucherService.logAudit({
      voucherId: voucher._id,
      action: 'create',
      actorId: req.user._id,
      actorRole: 'admin',
      customerId,
      result: 'success',
      metadata: { compReason: 'customer_compensation' },
    });

    return res.status(201).json({ success: true, message: 'Đã phát hành voucher đền bù vào ví của khách hàng.', data: voucher });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/v1/admin/campaigns
 * Create a new voucher campaign
 */
exports.createAdminCampaign = async (req, res) => {
  try {
    const { name, description, type, startDate, endDate, targetSegments, autoDistribute, distributionRule } = req.body;

    const campaign = new VoucherCampaign({
      name,
      description,
      type,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      targetSegments: targetSegments || ['all'],
      createdBy: req.user._id,
      autoDistribute: autoDistribute || false,
      distributionRule: distributionRule || {},
      status: new Date(startDate) > new Date() ? 'draft' : 'active',
    });

    await campaign.save();
    return res.status(201).json({ success: true, message: 'Tạo chiến dịch thành công.', data: campaign });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/v1/admin/campaigns
 * List all campaigns
 */
exports.getAdminCampaigns = async (req, res) => {
  try {
    const campaigns = await VoucherCampaign.find().sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: campaigns });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PUT /api/v1/admin/campaigns/:id
 * Update campaign
 */
exports.updateAdminCampaign = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const campaign = await VoucherCampaign.findByIdAndUpdate(id, updateData, { new: true });
    if (!campaign) {
      return res.status(404).json({ success: false, message: 'Chiến dịch không tồn tại.' });
    }

    return res.status(200).json({ success: true, message: 'Cập nhật chiến dịch thành công.', data: campaign });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
