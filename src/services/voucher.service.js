'use strict';

const mongoose = require('mongoose');
const bookingConfig = require('../config/booking.config');
const Voucher = require('../models/Voucher');
const CustomerVoucher = require('../models/CustomerVoucher');
const VoucherRedemption = require('../models/VoucherRedemption');
const voucherCampaignService = require('./voucher-campaign.service');
const VoucherAuditLog = require('../models/VoucherAuditLog');
const Restaurant = require('../models/Restaurant');
const validationService = require('./voucher.validation.service');

/**
 * Write a new entry to the VoucherAuditLog collection
 */
const logAudit = async ({
  voucherId,
  action,
  actorId,
  actorRole,
  customerId = null,
  bookingId = null,
  paymentId = null,
  ipAddress = null,
  userAgent = null,
  metadata = {},
  result,
  errorReason = null,
}) => {
  try {
    await VoucherAuditLog.create({
      voucherId,
      action,
      actorId,
      actorRole,
      customerId,
      bookingId,
      paymentId,
      ipAddress,
      userAgent,
      metadata,
      result,
      errorReason,
    });
  } catch (error) {
    console.error('❌ Failed to save VoucherAuditLog:', error.message);
  }
};

/**
 * 1. Kiểm tra tính hợp lệ và tính số tiền giảm của Voucher
 */
const validateVoucher = async (code, restaurantId, customerId, orderAmount, ipAddressOrOptions = null, options = {}) => {
  let ipAddress = null;
  let finalOptions = options;

  if (ipAddressOrOptions && typeof ipAddressOrOptions === 'object') {
    finalOptions = ipAddressOrOptions;
  } else if (typeof ipAddressOrOptions === 'string') {
    ipAddress = ipAddressOrOptions;
  }

  const readOnly = finalOptions?.readOnly === true;

  if (!code) {
    return { valid: false, reason: 'Mã voucher không được để trống', discountAmount: 0 };
  }

  // 1a. Check Rate Limit
  if (!readOnly) {
    const rateLimitResult = validationService.checkRateLimit(ipAddress, customerId);
    if (rateLimitResult.limited) {
      return { valid: false, reason: rateLimitResult.reason, discountAmount: 0 };
    }
  }

  // 1b. Check Existence
  const existResult = await validationService.checkExistence(code);
  if (!existResult.valid) {
    return { valid: false, reason: existResult.reason, discountAmount: 0 };
  }
  const voucher = existResult.voucher;

  // 1c. Check Status
  const statusResult = validationService.checkStatus(voucher);
  if (!statusResult.valid) {
    if (!readOnly) {
      await logAudit({
        voucherId: voucher._id,
        action: 'validate',
        actorId: customerId || voucher.createdBy,
        actorRole: customerId ? 'customer' : 'system',
        customerId,
        ipAddress,
        result: 'failure',
        errorReason: statusResult.reason,
      });
    }
    return { valid: false, reason: statusResult.reason, discountAmount: 0 };
  }

  // 1d. Check Date Range
  const dateResult = await validationService.checkDateRange(voucher, finalOptions);
  if (!dateResult.valid) {
    if (!readOnly) {
      await logAudit({
        voucherId: voucher._id,
        action: 'validate',
        actorId: customerId || voucher.createdBy,
        actorRole: customerId ? 'customer' : 'system',
        customerId,
        ipAddress,
        result: 'failure',
        errorReason: dateResult.reason,
      });
    }
    return { valid: false, reason: dateResult.reason, discountAmount: 0 };
  }

  // 1e. Check Restaurant Scope
  const scopeResult = await validationService.checkRestaurantScope(voucher, restaurantId);
  if (!scopeResult.valid) {
    if (!readOnly) {
      await logAudit({
        voucherId: voucher._id,
        action: 'validate',
        actorId: customerId || voucher.createdBy,
        actorRole: customerId ? 'customer' : 'system',
        customerId,
        ipAddress,
        result: 'failure',
        errorReason: scopeResult.reason,
      });
    }
    return { valid: false, reason: scopeResult.reason, discountAmount: 0 };
  }

  // 1f. Check Min Spend
  const spendResult = validationService.checkMinSpend(voucher, orderAmount);
  if (!spendResult.valid) {
    if (!readOnly) {
      await logAudit({
        voucherId: voucher._id,
        action: 'validate',
        actorId: customerId || voucher.createdBy,
        actorRole: customerId ? 'customer' : 'system',
        customerId,
        ipAddress,
        result: 'failure',
        errorReason: spendResult.reason,
      });
    }
    return { valid: false, reason: spendResult.reason, discountAmount: 0 };
  }

  // 1g. Check Global Limit
  const globalResult = await validationService.checkGlobalLimit(voucher);
  if (!globalResult.valid) {
    if (!readOnly) {
      await logAudit({
        voucherId: voucher._id,
        action: 'validate',
        actorId: customerId || voucher.createdBy,
        actorRole: customerId ? 'customer' : 'system',
        customerId,
        ipAddress,
        result: 'failure',
        errorReason: globalResult.reason,
      });
    }
    return { valid: false, reason: globalResult.reason, discountAmount: 0 };
  }

  // 1h. Check Per User Limit
  const userResult = await validationService.checkPerUserLimit(voucher, customerId);
  if (!userResult.valid) {
    if (!readOnly) {
      await logAudit({
        voucherId: voucher._id,
        action: 'validate',
        actorId: customerId,
        actorRole: 'customer',
        customerId,
        ipAddress,
        result: 'failure',
        errorReason: userResult.reason,
      });
    }
    return { valid: false, reason: userResult.reason, discountAmount: 0 };
  }

  // 1i. Check Customer Segment
  const segmentResult = await validationService.checkCustomerSegment(voucher, customerId);
  if (!segmentResult.valid) {
    if (!readOnly) {
      await logAudit({
        voucherId: voucher._id,
        action: 'validate',
        actorId: customerId,
        actorRole: 'customer',
        customerId,
        ipAddress,
        result: 'failure',
        errorReason: segmentResult.reason,
      });
    }
    return { valid: false, reason: segmentResult.reason, discountAmount: 0 };
  }

  // Calculate discount amount
  let discountAmount = 0;
  if (voucher.discountType === 'percentage') {
    discountAmount = (orderAmount * voucher.discountValue) / 100;
    if (voucher.maxDiscountAmount !== null) {
      discountAmount = Math.min(discountAmount, voucher.maxDiscountAmount);
    }
  } else if (voucher.discountType === 'fixed_amount') {
    discountAmount = voucher.discountValue;
  }

  // Ensure discount doesn't exceed orderAmount
  discountAmount = Math.min(discountAmount, orderAmount);
  discountAmount = Math.max(0, discountAmount);

  // Success audit log
  if (!readOnly) {
    await logAudit({
      voucherId: voucher._id,
      action: 'validate',
      actorId: customerId || voucher.createdBy,
      actorRole: customerId ? 'customer' : 'system',
      customerId,
      ipAddress,
      result: 'success',
      metadata: { orderAmount, discountAmount },
    });
  }

  return { valid: true, reason: null, discountAmount, voucher };
};

/**
 * 2. Lưu voucher vào ví khách hàng (Save/Claim)
 */
const saveVoucherForCustomer = async (voucherId, customerId, source = 'manual_save') => {
  const voucher = await Voucher.findById(voucherId);
  if (!voucher) {
    throw new Error('Voucher không tồn tại');
  }

  if (voucher.status !== 'active') {
    throw new Error('Voucher này hiện không thể lưu');
  }

  const now = new Date();
  if (voucher.endDate && now > voucher.endDate) {
    throw new Error('Voucher đã hết hạn sử dụng');
  }

  // Check user segment before saving
  const segmentResult = await validationService.checkCustomerSegment(voucher, customerId);
  if (!segmentResult.valid) {
    throw new Error(segmentResult.reason);
  }

  // Kiểm tra xem đã lưu chưa
  const existingSaved = await CustomerVoucher.findOne({ customerId, voucherId });
  if (existingSaved) {
    throw new Error('Bạn đã lưu voucher này trong ví rồi');
  }

  // Kiểm tra giới hạn lượt dùng toàn hệ thống
  const globalResult = await validationService.checkGlobalLimit(voucher);
  if (!globalResult.valid) {
    throw new Error(globalResult.reason);
  }

  // Deduct coins if loyalty voucher
  if (voucher.type === 'loyalty' && voucher.pointsCost > 0) {
    const loyaltyService = require('./loyalty.service');
    await loyaltyService.deductCoins(
      customerId,
      voucher.pointsCost,
      'redeem_voucher',
      voucher._id,
      `Đổi ${voucher.pointsCost.toLocaleString('vi-VN')} Coins lấy mã giảm giá ${voucher.code}`
    );
  }

  const savedVoucher = new CustomerVoucher({
    customerId,
    voucherId,
    status: 'saved',
    source,
    expiresAt: voucher.endDate,
  });

  await savedVoucher.save();

  // Log audit
  await logAudit({
    voucherId,
    action: 'save',
    actorId: customerId,
    actorRole: 'customer',
    customerId,
    result: 'success',
  });

  return savedVoucher;
};

/**
 * 2b. Xóa voucher khỏi ví khách hàng (Unsave)
 */
const unsaveVoucherForCustomer = async (voucherId, customerId) => {
  const result = await CustomerVoucher.findOneAndDelete({ customerId, voucherId });
  if (!result) {
    throw new Error('Voucher không tồn tại trong ví của bạn');
  }

  // Log audit
  await logAudit({
    voucherId,
    action: 'unsave',
    actorId: customerId,
    actorRole: 'customer',
    customerId,
    result: 'success',
  });

  return true;
};

/**
 * 3. Ghi nhận sử dụng Voucher (Redeem)
 */
const redeemVoucher = async (code, restaurantId, customerId, orderAmount, bookingId, paymentId = null, options = {}) => {
  const { ipAddress = null, userAgent = null } = options;

  let session = null;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
  } catch (err) {
    session = null;
  }

  try {
    const validation = await validateVoucher(code, restaurantId, customerId, orderAmount, ipAddress);
    if (!validation.valid) {
      throw new Error(validation.reason);
    }

    const voucher = validation.voucher;
    const discountAmount = validation.discountAmount;

    // Idempotency check: check if booking already has a completed redemption
    const existingRedemption = await VoucherRedemption.findOne({
      bookingId,
      status: 'completed',
    }).session(session);

    if (existingRedemption) {
      if (session) await session.commitTransaction();
      return existingRedemption;
    }

    // Atomic increment of currentUsage and check
    if (voucher.globalUsageLimit !== null) {
      const updatedVoucher = await Voucher.findOneAndUpdate(
        { _id: voucher._id, currentUsage: { $lt: voucher.globalUsageLimit } },
        { $inc: { currentUsage: 1 } },
        { new: true, session }
      );
      if (!updatedVoucher) {
        throw new Error('Mã giảm giá đã hết lượt sử dụng ngay trước khi bạn hoàn tất đặt bàn');
      }
    } else {
      await Voucher.updateOne({ _id: voucher._id }, { $inc: { currentUsage: 1 } }, { session });
    }

    // Tạo bản ghi VoucherRedemption
    const redemption = new VoucherRedemption({
      voucherId: voucher._id,
      customerId,
      bookingId,
      paymentId,
      discountApplied: discountAmount,
      amountBefore: orderAmount,
      amountAfter: orderAmount - discountAmount,
      channel: 'booking',
      status: 'completed',
      usedAt: new Date(),
    });
    await redemption.save({ session });

    // Cập nhật CustomerVoucher của khách hàng (nếu họ đã lưu trước đó)
    const customerVoucher = await CustomerVoucher.findOne({ customerId, voucherId: voucher._id }).session(session);
    if (customerVoucher) {
      customerVoucher.timesUsed += 1;
      customerVoucher.usedAt = new Date();
      customerVoucher.status = 'used';

      if (voucher.perCustomerLimit !== null && customerVoucher.timesUsed >= voucher.perCustomerLimit) {
        customerVoucher.isUsed = true;
      }
      await customerVoucher.save({ session });
    } else {
      // Tự tạo bản ghi CustomerVoucher đã dùng
      const newCustomerVoucher = new CustomerVoucher({
        customerId,
        voucherId: voucher._id,
        isUsed: voucher.perCustomerLimit !== null && 1 >= voucher.perCustomerLimit,
        timesUsed: 1,
        status: 'used',
        source: 'auto_assign',
        expiresAt: voucher.endDate,
        usedAt: new Date(),
      });
      await newCustomerVoucher.save({ session });
    }

    // Ghi audit log
    await logAudit({
      voucherId: voucher._id,
      action: 'redeem',
      actorId: customerId,
      actorRole: 'customer',
      customerId,
      bookingId,
      paymentId,
      ipAddress,
      userAgent,
      result: 'success',
    });

    if (session) {
      await session.commitTransaction();
    }

    return redemption;
  } catch (error) {
    if (session) {
      await session.abortTransaction();
    }
    // Log failure
    const voucherDoc = await Voucher.findOne({ code: code.toUpperCase() });
    if (voucherDoc) {
      await logAudit({
        voucherId: voucherDoc._id,
        action: 'redeem',
        actorId: customerId,
        actorRole: 'customer',
        customerId,
        bookingId,
        paymentId,
        ipAddress,
        userAgent,
        result: 'failure',
        errorReason: error.message,
      });
    }
    throw error;
  } finally {
    if (session) {
      session.endSession();
    }
  }
};

/**
 * 3b. Hoàn nguyên Voucher (Reverse Redemption)
 */
const reverseRedemption = async (bookingId, reason, actor = null) => {
  let session = null;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
  } catch (err) {
    session = null;
  }

  try {
    const redemption = await VoucherRedemption.findOne({
      bookingId,
      status: 'completed',
    }).session(session);

    if (!redemption) {
      if (session) await session.commitTransaction();
      return null; // No redemption to reverse
    }

    // Check cutoff time (only reverse if used within 30 minutes, or allow admin/system/booking-cancel to override)
    const timeDiffMinutes = (Date.now() - new Date(redemption.usedAt).getTime()) / (1000 * 60);
    const actorRole = actor ? actor.role : 'system';

    // Allow reversal for: admin, system, restaurant_owner (cancelling), or within 30 minutes for customer
    const isPrivileged = ['admin', 'system', 'restaurant_owner'].includes(actorRole);
    if (timeDiffMinutes > bookingConfig.customerVoucherReversalWindowMinutes && !isPrivileged) {
      if (session) await session.commitTransaction();
      return null;
    }

    // Set redemption status to reversed
    redemption.status = 'reversed';
    redemption.reversedAt = new Date();
    redemption.reversedReason = reason || 'Hủy đặt bàn';
    await redemption.save({ session });

    // Decrement currentUsage in Voucher
    await Voucher.updateOne(
      { _id: redemption.voucherId },
      { $inc: { currentUsage: -1 } },
      { session }
    );

    // Update CustomerVoucher
    const customerVoucher = await CustomerVoucher.findOne({
      customerId: redemption.customerId,
      voucherId: redemption.voucherId,
    }).session(session);

    if (customerVoucher) {
      customerVoucher.timesUsed = Math.max(0, customerVoucher.timesUsed - 1);
      customerVoucher.isUsed = false;
      customerVoucher.status = 'saved';
      await customerVoucher.save({ session });
    }

    // Log audit
    await logAudit({
      voucherId: redemption.voucherId,
      action: 'reverse',
      actorId: actor ? actor._id : redemption.customerId,
      actorRole: actor ? actor.role : 'system',
      customerId: redemption.customerId,
      bookingId,
      result: 'success',
      metadata: { reason, timeDiffMinutes },
    });

    if (session) {
      await session.commitTransaction();
    }

    return redemption;
  } catch (error) {
    if (session) {
      await session.abortTransaction();
    }
    throw error;
  } finally {
    if (session) {
      session.endSession();
    }
  }
};

const resolveBookingVoucher = async (booking) => {
  if (booking?.voucherId && typeof booking.voucherId === 'object' && booking.voucherId.code) return booking.voucherId;
  if (booking?.voucherId) return Voucher.findById(booking.voucherId);
  if (!booking?.voucherCode || !booking?.restaurantId) return null;
  const restaurantId = booking.restaurantId?._id || booking.restaurantId;
  const matches = await Voucher.find({
    code: String(booking.voucherCode).trim().toUpperCase(),
    $or: [{ restaurantId }, { applicableRestaurants: restaurantId }],
  }).limit(2);
  if (matches.length !== 1) {
    console.warn(`[LegacyVoucher] booking=${booking._id} code=${booking.voucherCode} matches=${matches.length}; không tự chọn voucher.`);
    return null;
  }
  return matches[0];
};

/**
 * 4. Lấy danh sách ví voucher của Customer
 */
const getCustomerVouchers = async (customerId, filter = 'all') => {
  const query = { customerId };
  const now = new Date();

  // Find all CustomerVouchers
  const saved = await CustomerVoucher.find(query)
    .populate({
      path: 'voucherId',
      populate: {
        path: 'restaurantId',
        select: 'name address logo images cuisineTypes',
      },
    })
    .sort({ createdAt: -1 });

  const results = [];
  for (const item of saved) {
    if (!item.voucherId) continue;

    const v = item.voucherId;
    let currentStatus = item.status;

    // Check expiration dynamically
    const isExpired = v.endDate && now > v.endDate;
    if (isExpired && item.status !== 'expired' && !item.isUsed) {
      item.status = 'expired';
      await item.save();
      currentStatus = 'expired';
    }

    let matchesFilter = false;
    if (filter === 'unused') {
      matchesFilter = !item.isUsed && currentStatus === 'saved' && v.status === 'active';
    } else if (filter === 'used') {
      matchesFilter = item.isUsed || currentStatus === 'used';
    } else if (filter === 'expired') {
      matchesFilter = currentStatus === 'expired' || v.status === 'expired';
    } else {
      matchesFilter = true; // 'all'
    }

    if (matchesFilter) {
      results.push(item);
    }
  }
  return results;
};

/**
 * 5. Lấy danh sách voucher khả dụng tại trang chi tiết nhà hàng
 */
const getAvailableRestaurantVouchers = async (restaurantId, customerId = null) => {
  const now = new Date();

  // Tìm các voucher active của riêng nhà hàng này HOẶC voucher Global (restaurantId = null)
  const vouchers = await Voucher.find({
    status: 'active',
    startDate: { $lte: now },
    $and: [
      {
        $or: [
          { restaurantId: restaurantId },
          { restaurantId: null },
        ],
      },
      {
        $or: [
          { endDate: null },
          { endDate: { $gte: now } },
        ],
      },
    ]
  }).sort({ createdAt: -1 });

  // Nếu truyền customerId, trả về thêm thông tin đã lưu hay chưa
  const campaignMap = new Map(
    (await voucherCampaignService.getActiveCampaigns({
      restaurantIds: [restaurantId],
      voucherIds: vouchers.map((voucher) => voucher._id),
    })).map((campaign) => [String(campaign.voucherId?._id || campaign.voucherId), campaign])
  );

  const annotated = vouchers.map((voucher) => {
    const item = voucher.toObject();
    const campaign = campaignMap.get(String(voucher._id));
    item.isSponsored = Boolean(campaign);
    item.sponsoredLabel = campaign ? 'Duoc tai tro' : null;
    item.campaignPlacement = campaign?.placement || null;
    item.campaignEndAt = campaign?.endAt || null;
    return item;
  }).sort((a, b) => Number(b.isSponsored) - Number(a.isSponsored));

  if (customerId) {
    const savedVoucherIds = await CustomerVoucher.find({ customerId })
      .distinct('voucherId');
    return annotated.map(item => {
      item.isSaved = savedVoucherIds.some(id => id.toString() === item._id.toString());
      return item;
    });
  }

  return annotated;
};

/**
 * 6. Thống kê hiệu quả voucher cho chủ nhà hàng (Owner)
 */
const getVoucherStats = async (voucherId, restaurantId) => {
  const query = { _id: voucherId };
  if (restaurantId) query.restaurantId = restaurantId;

  const voucher = await Voucher.findOne(query);
  if (!voucher) {
    throw new Error('Voucher không tồn tại hoặc không thuộc quyền quản lý của bạn');
  }

  const savedCount = await CustomerVoucher.countDocuments({ voucherId });
  const redemptions = await VoucherRedemption.find({ voucherId, status: 'completed' })
    .populate('customerId', 'fullName email phoneNumber');

  const usedCount = redemptions.length;
  const totalDiscount = redemptions.reduce((acc, curr) => acc + curr.discountApplied, 0);

  return {
    voucherId,
    code: voucher.code,
    status: voucher.status,
    savedCount,
    usedCount,
    totalDiscount,
    redemptions: redemptions.map(r => ({
      bookingId: r.bookingId,
      customerId: r.customerId?._id,
      customerName: r.customerId?.fullName || 'Khách hàng',
      discountApplied: r.discountApplied,
      amountBefore: r.amountBefore,
      amountAfter: r.amountAfter,
      usedAt: r.usedAt,
    })),
  };
};

module.exports = {
  logAudit,
  validateVoucher,
  saveVoucherForCustomer,
  unsaveVoucherForCustomer,
  redeemVoucher,
  reverseRedemption,
  resolveBookingVoucher,
  getCustomerVouchers,
  getAvailableRestaurantVouchers,
  getVoucherStats,
};
