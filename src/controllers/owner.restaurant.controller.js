'use strict';

const Restaurant = require('../models/Restaurant');
const Booking = require('../models/Booking');
const RestaurantActivityLog = require('../models/RestaurantActivityLog');
const { assertOwnerCanAccessRestaurant } = require('../utils/restaurant-permission');
const {
  normalizeRestaurantImages,
  sanitizeRestaurantImagePayload,
  validateRestaurantImagePayload,
} = require('../utils/restaurant-images');
const { canCreateRestaurant } = require('../services/plan-gating.service');

// ─────────────────────────────────────────────
// Regex constants
// ─────────────────────────────────────────────
const PHONE_REGEX = /^(\+84|0)[35789][0-9]{8}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_REGEX   = /^https?:\/\/.+/;
const TIME_REGEX  = /^([01]\d|2[0-3]):([0-5]\d)$/;

// ─────────────────────────────────────────────
// POST /api/v1/owner/restaurants — Tạo nhà hàng
// ─────────────────────────────────────────────
exports.createRestaurant = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const body = req.body;

    const quota = await canCreateRestaurant(ownerId);
    if (!quota.allowed) {
      const planNames = { free: 'Free', plus: 'Plus', pro: 'Pro' };
      const planName = planNames[quota.planCode] || quota.planCode;
      return res.status(403).json({
        success: false,
        code: 'RESTAURANT_LIMIT_REACHED',
        message: `Gói ${planName} chỉ cho phép tạo tối đa ${quota.limit} nhà hàng. Vui lòng nâng cấp gói để tạo thêm.`,
        data: {
          planCode: quota.planCode,
          currentCount: quota.currentCount,
          limit: quota.limit,
          remaining: quota.remaining,
          recommendedPlan: quota.recommendedPlan,
        },
      });
    }

    // ── Validate required fields ──
    const errors = [];

    // name
    if (!body.name || !body.name.trim()) {
      errors.push('Tên nhà hàng là bắt buộc');
    } else if (body.name.trim().length > 200) {
      errors.push('Tên nhà hàng không được vượt quá 200 ký tự');
    }

    // description
    if (!body.description || !body.description.trim()) {
      errors.push('Mô tả nhà hàng là bắt buộc');
    } else if (body.description.trim().length < 10) {
      errors.push('Mô tả phải có ít nhất 10 ký tự');
    } else if (body.description.trim().length > 2000) {
      errors.push('Mô tả không được vượt quá 2000 ký tự');
    }

    // phoneNumber
    if (!body.phoneNumber || !body.phoneNumber.trim()) {
      errors.push('Số điện thoại là bắt buộc');
    } else if (!PHONE_REGEX.test(body.phoneNumber.trim())) {
      errors.push('Số điện thoại không đúng định dạng (VD: 0901234567)');
    }

    // email
    if (!body.email || !body.email.trim()) {
      errors.push('Email là bắt buộc');
    } else if (!EMAIL_REGEX.test(body.email.trim().toLowerCase())) {
      errors.push('Email không đúng định dạng');
    }

    // address
    if (!body.address || typeof body.address !== 'object') {
      errors.push('Thông tin địa chỉ là bắt buộc');
    } else {
      if (!body.address.street || !body.address.street.trim()) errors.push('Địa chỉ chi tiết (số nhà, đường) là bắt buộc');
      if (!body.address.ward || !body.address.ward.trim()) errors.push('Phường/Xã là bắt buộc');
      if (!body.address.district || !body.address.district.trim()) errors.push('Quận/Huyện là bắt buộc');
      if (!body.address.city || !body.address.city.trim()) errors.push('Tỉnh/Thành phố là bắt buộc');
    }

    // ── Validate optional fields ──

    // Price validation
    if (body.averagePrice !== undefined && body.averagePrice !== null && body.averagePrice !== '') {
      if (isNaN(body.averagePrice) || Number(body.averagePrice) < 0) {
        errors.push('Giá trung bình phải là số không âm');
      }
    }
    if (body.priceRangeMin !== undefined && body.priceRangeMin !== null && body.priceRangeMin !== '') {
      if (isNaN(body.priceRangeMin) || Number(body.priceRangeMin) < 0) {
        errors.push('Giá thấp nhất phải là số không âm');
      }
    }
    if (body.priceRangeMax !== undefined && body.priceRangeMax !== null && body.priceRangeMax !== '') {
      if (isNaN(body.priceRangeMax) || Number(body.priceRangeMax) < 0) {
        errors.push('Giá cao nhất phải là số không âm');
      }
    }
    if (
      body.priceRangeMin !== undefined && body.priceRangeMax !== undefined &&
      body.priceRangeMin !== null && body.priceRangeMax !== null &&
      body.priceRangeMin !== '' && body.priceRangeMax !== '' &&
      Number(body.priceRangeMin) > Number(body.priceRangeMax)
    ) {
      errors.push('Giá thấp nhất phải nhỏ hơn hoặc bằng giá cao nhất');
    }

    // Capacity
    if (body.capacity !== undefined && body.capacity !== null && body.capacity !== '') {
      if (isNaN(body.capacity) || Number(body.capacity) < 0) {
        errors.push('Sức chứa phải là số không âm');
      }
    }

    // operatingHours validation
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    if (body.operatingHours && typeof body.operatingHours === 'object') {
      for (const day of days) {
        const dayData = body.operatingHours[day];
        if (dayData && !dayData.closed) {
          if (dayData.open && !TIME_REGEX.test(dayData.open)) {
            errors.push(`Giờ mở cửa ngày ${day} không đúng định dạng (HH:mm)`);
          }
          if (dayData.close && !TIME_REGEX.test(dayData.close)) {
            errors.push(`Giờ đóng cửa ngày ${day} không đúng định dạng (HH:mm)`);
          }
          if (dayData.open && dayData.close && dayData.open >= dayData.close) {
            errors.push(`Giờ mở cửa phải trước giờ đóng cửa (${day})`);
          }
        }
      }
    }

    // cuisineTypes validation
    if (body.cuisineTypes && Array.isArray(body.cuisineTypes)) {
      if (body.cuisineTypes.length > 10) {
        errors.push('Tối đa 10 loại ẩm thực');
      }
      for (const item of body.cuisineTypes) {
        if (typeof item !== 'string' || item.trim().length > 100) {
          errors.push('Mỗi loại ẩm thực tối đa 100 ký tự');
          break;
        }
      }
    }

    // Coordinates validation
    if (body.coordinates && typeof body.coordinates === 'object') {
      if (body.coordinates.latitude !== undefined && body.coordinates.latitude !== null) {
        const lat = Number(body.coordinates.latitude);
        if (isNaN(lat) || lat < -90 || lat > 90) {
          errors.push('Vĩ độ phải nằm trong khoảng -90 đến 90');
        }
      }
      if (body.coordinates.longitude !== undefined && body.coordinates.longitude !== null) {
        const lng = Number(body.coordinates.longitude);
        if (isNaN(lng) || lng < -180 || lng > 180) {
          errors.push('Kinh độ phải nằm trong khoảng -180 đến 180');
        }
      }
    }

    errors.push(...validateRestaurantImagePayload(body));

    // Return errors if any
    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: errors[0],
        errors,
      });
    }

    // ── Auto-generate fullAddress ──
    if (body.address && !body.address.fullAddress) {
      const { street, ward, district, city } = body.address;
      body.address.fullAddress = [street, ward, district, city].filter(Boolean).join(', ');
    }

    sanitizeRestaurantImagePayload(body);

    // ── Create restaurant ──
    const restaurant = await Restaurant.create({
      ...body,
      ownerId,
      approvalStatus: 'pending',
      active: true,
    });

    return res.status(201).json({
      success: true,
      message: 'Tạo nhà hàng thành công! Nhà hàng đang chờ Admin duyệt.',
      data: {
        id: restaurant._id.toString(),
        ownerId: restaurant.ownerId,
        name: restaurant.name,
        approvalStatus: restaurant.approvalStatus,
        createdAt: restaurant.createdAt,
      },
    });
  } catch (error) {
    // Mongoose validation error
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({
        success: false,
        message: messages[0],
        errors: messages,
      });
    }

    console.error('❌ Error creating restaurant:', error);
    return res.status(500).json({
      success: false,
      message: 'Lỗi hệ thống khi tạo nhà hàng. Vui lòng thử lại sau.',
    });
  }
};

// ─────────────────────────────────────────────
// GET /api/v1/owner/restaurants — Danh sách nhà hàng của owner
// ─────────────────────────────────────────────
exports.getMyRestaurants = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const [restaurants, total] = await Promise.all([
      Restaurant.find({ ownerId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Restaurant.countDocuments({ ownerId }),
    ]);

    const formatted = restaurants.map((r) => ({
      id: r._id.toString(),
      name: r.name,
      description: r.description,
      phoneNumber: r.phoneNumber,
      email: r.email,
      address: r.address,
      cuisineTypes: r.cuisineTypes,
      operatingHours: r.operatingHours,
      ...normalizeRestaurantImages(r),
      approvalStatus: r.approvalStatus,
      rejectionReason: r.rejectionReason,
      suspensionReason: r.suspensionReason,
      active: r.active,
      stats: r.stats,
      createdAt: r.createdAt,
    }));

    const quota = await canCreateRestaurant(ownerId);

    return res.status(200).json({
      success: true,
      data: {
        restaurants: formatted,
        total,
        page,
        totalPages: Math.ceil(total / limit),
        restaurantQuota: {
          planCode: quota.planCode,
          currentCount: quota.currentCount,
          limit: quota.limit,
          remaining: quota.remaining,
          recommendedPlan: quota.recommendedPlan,
        },
      },
    });
  } catch (error) {
    console.error('❌ Error fetching owner restaurants:', error);
    return res.status(500).json({
      success: false,
      message: 'Lỗi hệ thống khi lấy danh sách nhà hàng.',
    });
  }
};

exports.getMyRestaurantById = async (req, res) => {
  try {
    const restaurant = await assertOwnerCanAccessRestaurant(req.user._id, req.params.restaurantId);

    return res.status(200).json({
      success: true,
      data: {
        ...restaurant.toPublicJSON(),
        rejectionReason: restaurant.rejectionReason,
        suspensionReason: restaurant.suspensionReason,
      },
    });
  } catch (error) {
    console.error('Error fetching owner restaurant:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Loi he thong khi lay thong tin nha hang.',
    });
  }
};

exports.getRestaurantDashboard = async (req, res) => {
  try {
    const restaurant = await assertOwnerCanAccessRestaurant(req.user._id, req.params.restaurantId);
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalBookings,
      pendingBookings,
      confirmedBookings,
      completedBookings,
      cancelledBookings,
      monthBookings,
    ] = await Promise.all([
      Booking.countDocuments({ restaurantId: restaurant._id }),
      Booking.countDocuments({ restaurantId: restaurant._id, status: 'pending' }),
      Booking.countDocuments({ restaurantId: restaurant._id, status: 'confirmed' }),
      Booking.countDocuments({ restaurantId: restaurant._id, status: 'completed' }),
      Booking.countDocuments({ restaurantId: restaurant._id, status: 'cancelled' }),
      Booking.countDocuments({ restaurantId: restaurant._id, createdAt: { $gte: startOfMonth } }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        restaurant: restaurant.toPublicJSON(),
        stats: {
          totalBookings,
          pendingBookings,
          confirmedBookings,
          completedBookings,
          cancelledBookings,
          monthBookings,
          averageRating: restaurant.stats?.averageRating || 0,
          totalReviews: restaurant.stats?.totalReviews || 0,
          balance: restaurant.balance || 0,
          availableBalance: restaurant.availableBalance ?? restaurant.balance ?? 0,
          pendingWithdrawalBalance: restaurant.pendingWithdrawalBalance || 0,
          totalRevenue: restaurant.totalRevenue || 0,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching owner dashboard:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Loi he thong khi lay dashboard nha hang.',
    });
  }
};

exports.updateRestaurant = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const restaurantId = req.params.restaurantId;
    const body = req.body;

    // 1. Kiểm tra xem nhà hàng tồn tại và thuộc sở hữu của user
    const restaurant = await assertOwnerCanAccessRestaurant(ownerId, restaurantId);

    // 2. Kiểm tra trạng thái duyệt
    if (!['approved', 'rejected', 'pending'].includes(restaurant.approvalStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Trạng thái hiện tại của nhà hàng không cho phép chỉnh sửa.',
      });
    }

    // ── Validate fields (same as createRestaurant) ──
    const errors = [];

    // name
    if (!body.name || !body.name.trim()) {
      errors.push('Tên nhà hàng là bắt buộc');
    } else if (body.name.trim().length > 200) {
      errors.push('Tên nhà hàng không được vượt quá 200 ký tự');
    }

    // description
    if (!body.description || !body.description.trim()) {
      errors.push('Mô tả nhà hàng là bắt buộc');
    } else if (body.description.trim().length < 10) {
      errors.push('Mô tả phải có ít nhất 10 ký tự');
    } else if (body.description.trim().length > 2000) {
      errors.push('Mô tả không được vượt quá 2000 ký tự');
    }

    // phoneNumber
    if (!body.phoneNumber || !body.phoneNumber.trim()) {
      errors.push('Số điện thoại là bắt buộc');
    } else if (!PHONE_REGEX.test(body.phoneNumber.trim())) {
      errors.push('Số điện thoại không đúng định dạng (VD: 0901234567)');
    }

    // email
    if (!body.email || !body.email.trim()) {
      errors.push('Email là bắt buộc');
    } else if (!EMAIL_REGEX.test(body.email.trim().toLowerCase())) {
      errors.push('Email không đúng định dạng');
    }

    // address
    if (!body.address || typeof body.address !== 'object') {
      errors.push('Thông tin địa chỉ là bắt buộc');
    } else {
      if (!body.address.street || !body.address.street.trim()) errors.push('Địa chỉ chi tiết (số nhà, đường) là bắt buộc');
      if (!body.address.ward || !body.address.ward.trim()) errors.push('Phường/Xã là bắt buộc');
      if (!body.address.district || !body.address.district.trim()) errors.push('Quận/Huyện là bắt buộc');
      if (!body.address.city || !body.address.city.trim()) errors.push('Tỉnh/Thành phố là bắt buộc');
    }

    // Price validation
    if (body.averagePrice !== undefined && body.averagePrice !== null && body.averagePrice !== '') {
      if (isNaN(body.averagePrice) || Number(body.averagePrice) < 0) {
        errors.push('Giá trung bình phải là số không âm');
      }
    }
    if (body.priceRangeMin !== undefined && body.priceRangeMin !== null && body.priceRangeMin !== '') {
      if (isNaN(body.priceRangeMin) || Number(body.priceRangeMin) < 0) {
        errors.push('Giá thấp nhất phải là số không âm');
      }
    }
    if (body.priceRangeMax !== undefined && body.priceRangeMax !== null && body.priceRangeMax !== '') {
      if (isNaN(body.priceRangeMax) || Number(body.priceRangeMax) < 0) {
        errors.push('Giá cao nhất phải là số không âm');
      }
    }
    if (
      body.priceRangeMin !== undefined && body.priceRangeMax !== undefined &&
      body.priceRangeMin !== null && body.priceRangeMax !== null &&
      body.priceRangeMin !== '' && body.priceRangeMax !== '' &&
      Number(body.priceRangeMin) > Number(body.priceRangeMax)
    ) {
      errors.push('Giá thấp nhất phải nhỏ hơn hoặc bằng giá cao nhất');
    }

    // Capacity
    if (body.capacity !== undefined && body.capacity !== null && body.capacity !== '') {
      if (isNaN(body.capacity) || Number(body.capacity) < 0) {
        errors.push('Sức chứa phải là số không âm');
      }
    }

    // operatingHours validation
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    if (body.operatingHours && typeof body.operatingHours === 'object') {
      for (const day of days) {
        const dayData = body.operatingHours[day];
        if (dayData && !dayData.closed) {
          if (dayData.open && !TIME_REGEX.test(dayData.open)) {
            errors.push(`Giờ mở cửa ngày ${day} không đúng định dạng (HH:mm)`);
          }
          if (dayData.close && !TIME_REGEX.test(dayData.close)) {
            errors.push(`Giờ đóng cửa ngày ${day} không đúng định dạng (HH:mm)`);
          }
          if (dayData.open && dayData.close && dayData.open >= dayData.close) {
            errors.push(`Giờ mở cửa phải trước giờ đóng cửa (${day})`);
          }
        }
      }
    }

    // cuisineTypes validation
    if (body.cuisineTypes && Array.isArray(body.cuisineTypes)) {
      if (body.cuisineTypes.length > 10) {
        errors.push('Tối đa 10 loại ẩm thực');
      }
      for (const item of body.cuisineTypes) {
        if (typeof item !== 'string' || item.trim().length > 100) {
          errors.push('Mỗi loại ẩm thực tối đa 100 ký tự');
          break;
        }
      }
    }

    // Coordinates validation
    if (body.coordinates && typeof body.coordinates === 'object') {
      if (body.coordinates.latitude !== undefined && body.coordinates.latitude !== null) {
        const lat = Number(body.coordinates.latitude);
        if (isNaN(lat) || lat < -90 || lat > 90) {
          errors.push('Vĩ độ phải nằm trong khoảng -90 đến 90');
        }
      }
      if (body.coordinates.longitude !== undefined && body.coordinates.longitude !== null) {
        const lng = Number(body.coordinates.longitude);
        if (isNaN(lng) || lng < -180 || lng > 180) {
          errors.push('Kinh độ phải nằm trong khoảng -180 đến 180');
        }
      }
    }

    errors.push(...validateRestaurantImagePayload(body));

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: errors[0],
        errors,
      });
    }

    // ── Auto-generate fullAddress ──
    if (body.address && !body.address.fullAddress) {
      const { street, ward, district, city } = body.address;
      body.address.fullAddress = [street, ward, district, city].filter(Boolean).join(', ');
    }

    sanitizeRestaurantImagePayload(body);

    // ── Update fields ──
    const fieldsToUpdate = [
      'name', 'description', 'phoneNumber', 'email', 'websiteUrl', 'contactHotline',
      'contactSecondaryPhone', 'address', 'coordinates', 'cuisineTypes', 'priceRange',
      'capacity', 'operatingHours', 'images', 'logo', 'coverImage', 'galleryImages', 'averagePrice', 'priceRangeMin',
      'priceRangeMax', 'statusMessage', 'heroCity', 'heroHeadline', 'heroSubheadline',
      'heroSearchPlaceholder', 'bookingInformation', 'bookingNotes', 'generalPromotions',
      'groupPromotions', 'promotionNotes', 'summaryHighlights', 'suitableFor',
      'signatureDishes', 'spaceDescriptionDetail', 'uniqueFeatures', 'pricingDetails',
      'menuHighlights', 'policyRules', 'amenities', 'parkingDetails', 'galleryNotes',
      'directionInfo', 'operatingSchedule', 'businessLicense', 'taxCode', 'bankInfo',
      'hasMenu', 'hasTableLayout'
    ];

    fieldsToUpdate.forEach(field => {
      if (body[field] !== undefined) {
        restaurant[field] = body[field];
      }
    });

    // Nếu trạng thái là rejected -> đưa về pending để admin duyệt lại
    let reSubmit = false;
    if (restaurant.approvalStatus === 'rejected') {
      restaurant.approvalStatus = 'pending';
      restaurant.rejectionReason = null;
      reSubmit = true;
    }

    await restaurant.save();

    // 3. Log activity
    await RestaurantActivityLog.create({
      restaurantId: restaurant._id,
      action: 'updated',
      performedBy: ownerId,
      performedByRole: 'restaurant_owner',
      metadata: { reSubmit },
    });

    return res.status(200).json({
      success: true,
      message: reSubmit 
        ? 'Cập nhật thành công! Hồ sơ đã được gửi lại chờ Admin duyệt.' 
        : 'Cập nhật thông tin nhà hàng thành công!',
      data: restaurant.toPublicJSON(),
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({
        success: false,
        message: messages[0],
        errors: messages,
      });
    }

    console.error('❌ Error updating restaurant:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Lỗi hệ thống khi chỉnh sửa nhà hàng.',
    });
  }
};
