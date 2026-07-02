'use strict';

const Restaurant = require('../models/Restaurant');
const RestaurantActivityLog = require('../models/RestaurantActivityLog');
const emailService = require('../services/email.service');
const notificationService = require('../services/notification.service');

const sendNotification = (promise, label) => {
  Promise.resolve(promise).catch((error) => {
    console.warn(`[AdminRestaurantNotification/${label}] ${error.message}`);
  });
};

// ────────────────────────────────────────────────────────
// A. Danh sách nhà hàng (Paginated, Search, Filter, Sort)
// ────────────────────────────────────────────────────────
const getRestaurants = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;
    
    const search = (req.query.search || '').trim();
    const approvalStatus = (req.query.approvalStatus || '').trim();
    const ownerId = (req.query.ownerId || '').trim();
    const city = (req.query.city || '').trim();
    const featured = req.query.featured;
    const deleted = req.query.deleted;

    const filter = {};

    // Soft delete filter
    if (deleted === 'true') {
      filter.deletedAt = { $ne: null };
    } else {
      filter.deletedAt = null;
    }

    if (approvalStatus) {
      filter.approvalStatus = approvalStatus;
    }
    if (ownerId) {
      filter.ownerId = ownerId;
    }
    if (city) {
      filter['address.city'] = { $regex: city, $options: 'i' };
    }
    if (featured !== undefined) {
      filter.featured = featured === 'true';
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phoneNumber: { $regex: search, $options: 'i' } },
      ];
    }

    // Sort setup
    const sortField = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const sortObj = { [sortField]: sortOrder };

    const [restaurants, total] = await Promise.all([
      Restaurant.find(filter)
        .populate('ownerId', 'fullName email username phoneNumber')
        .sort(sortObj)
        .skip(skip)
        .limit(limit),
      Restaurant.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: {
        restaurants: restaurants.map(r => r.toAdminJSON()),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('❌ [Admin/GetRestaurants] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể tải danh sách nhà hàng' });
  }
};

// ────────────────────────────────────────────────────────
// B. Xem chi tiết nhà hàng
// ────────────────────────────────────────────────────────
const getRestaurantById = async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.params.id)
      .populate('ownerId', 'fullName email username phoneNumber avatarUrl')
      .populate('approvedBy', 'fullName email');

    if (!restaurant) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy nhà hàng' });
    }

    return res.json({ success: true, data: restaurant.toAdminJSON() });
  } catch (error) {
    console.error('❌ [Admin/GetRestaurant] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể tải thông tin nhà hàng' });
  }
};

// ────────────────────────────────────────────────────────
// C. Duyệt nhà hàng (Approve)
// ────────────────────────────────────────────────────────
const approveRestaurant = async (req, res) => {
  try {
    const { commissionRate } = req.body;

    const restaurant = await Restaurant.findById(req.params.id).populate('ownerId');
    if (!restaurant) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy nhà hàng' });
    }

    if (restaurant.approvalStatus === 'approved') {
      return res.status(400).json({ success: false, message: 'Nhà hàng đã được duyệt trước đó' });
    }

    restaurant.approvalStatus = 'approved';
    restaurant.approvedBy = req.user._id;
    restaurant.approvedAt = new Date();
    restaurant.rejectionReason = null;
    restaurant.suspensionReason = null;
    restaurant.active = true;

    // Auto-verify business license if present
    if (restaurant.businessLicense && restaurant.businessLicense.number && restaurant.businessLicense.imageUrl) {
      restaurant.businessLicense.verifiedAt = new Date();
    }
    
    if (commissionRate !== undefined && commissionRate >= 0 && commissionRate <= 100) {
      restaurant.commissionRate = commissionRate;
    }

    await restaurant.save();

    // Log activity
    await RestaurantActivityLog.create({
      restaurantId: restaurant._id,
      action: 'approved',
      performedBy: req.user._id,
      performedByRole: 'admin',
      metadata: { commissionRate: restaurant.commissionRate },
    });

    // Send notification email to owner
    if (emailService.sendRestaurantApprovedEmail && restaurant.ownerId) {
      emailService.sendRestaurantApprovedEmail(restaurant.ownerId, restaurant)
        .catch(err => console.error('⚠️ Lỗi gửi email duyệt NH:', err.message));
    }
    sendNotification(
      notificationService.notifyRestaurantAdminAction(req.app?.get?.('io') || null, {
        restaurant,
        title: 'Nha hang da duoc duyet',
        message: `${restaurant.name} da duoc admin duyet va hien thi tren BookEat.`,
        action: 'approved',
      }),
      'approved'
    );

    return res.json({
      success: true,
      message: 'Đã duyệt nhà hàng thành công',
      data: restaurant.toAdminJSON(),
    });
  } catch (error) {
    console.error('❌ [Admin/ApproveRestaurant] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể duyệt nhà hàng' });
  }
};

// ────────────────────────────────────────────────────────
// D. Từ chối nhà hàng (Reject)
// ────────────────────────────────────────────────────────
const rejectRestaurant = async (req, res) => {
  try {
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, message: 'Vui lòng cung cấp lý do từ chối' });
    }

    const restaurant = await Restaurant.findById(req.params.id).populate('ownerId');
    if (!restaurant) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy nhà hàng' });
    }

    restaurant.approvalStatus = 'rejected';
    restaurant.rejectionReason = reason.trim();
    restaurant.active = false;
    await restaurant.save();

    // Log activity
    await RestaurantActivityLog.create({
      restaurantId: restaurant._id,
      action: 'rejected',
      performedBy: req.user._id,
      performedByRole: 'admin',
      reason: reason.trim(),
    });

    // Send notification email to owner
    if (emailService.sendRestaurantRejectedEmail && restaurant.ownerId) {
      emailService.sendRestaurantRejectedEmail(restaurant.ownerId, restaurant, reason)
        .catch(err => console.error('⚠️ Lỗi gửi email từ chối NH:', err.message));
    }
    sendNotification(
      notificationService.notifyRestaurantAdminAction(req.app?.get?.('io') || null, {
        restaurant,
        title: 'Ho so nha hang bi tu choi',
        message: `${restaurant.name} bi tu choi. Ly do: ${reason.trim()}`,
        action: 'rejected',
      }),
      'rejected'
    );

    return res.json({
      success: true,
      message: 'Đã từ chối nhà hàng',
      data: restaurant.toAdminJSON(),
    });
  } catch (error) {
    console.error('❌ [Admin/RejectRestaurant] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể từ chối nhà hàng' });
  }
};

// ────────────────────────────────────────────────────────
// E. Tạm ngưng nhà hàng (Suspend)
// ────────────────────────────────────────────────────────
const suspendRestaurant = async (req, res) => {
  try {
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, message: 'Vui lòng cung cấp lý do tạm ngưng' });
    }

    const restaurant = await Restaurant.findById(req.params.id).populate('ownerId');
    if (!restaurant) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy nhà hàng' });
    }

    restaurant.approvalStatus = 'suspended';
    restaurant.suspensionReason = reason.trim();
    restaurant.active = false; // Nhà hàng sẽ không hiển thị trên FE public
    await restaurant.save();

    // Log activity
    await RestaurantActivityLog.create({
      restaurantId: restaurant._id,
      action: 'suspended',
      performedBy: req.user._id,
      performedByRole: 'admin',
      reason: reason.trim(),
    });

    // Send notification email to owner
    if (emailService.sendRestaurantSuspendedEmail && restaurant.ownerId) {
      emailService.sendRestaurantSuspendedEmail(restaurant.ownerId, restaurant, reason)
        .catch(err => console.error('⚠️ Lỗi gửi email tạm ngưng NH:', err.message));
    }
    sendNotification(
      notificationService.notifyRestaurantAdminAction(req.app?.get?.('io') || null, {
        restaurant,
        title: 'Nha hang bi tam ngung',
        message: `${restaurant.name} da bi tam ngung. Ly do: ${reason.trim()}`,
        action: 'suspended',
      }),
      'suspended'
    );

    return res.json({
      success: true,
      message: 'Đã tạm ngưng nhà hàng',
      data: restaurant.toAdminJSON(),
    });
  } catch (error) {
    console.error('❌ [Admin/SuspendRestaurant] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể tạm ngưng nhà hàng' });
  }
};

// ────────────────────────────────────────────────────────
// F. Gỡ tạm ngưng nhà hàng (Unsuspend)
// ────────────────────────────────────────────────────────
const unsuspendRestaurant = async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.params.id).populate('ownerId');
    if (!restaurant) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy nhà hàng' });
    }

    if (restaurant.approvalStatus !== 'suspended') {
      return res.status(400).json({ 
        success: false, 
        message: 'Chỉ có thể gỡ tạm ngưng nhà hàng đang bị tạm ngưng' 
      });
    }

    restaurant.approvalStatus = 'approved';
    restaurant.suspensionReason = null;
    restaurant.active = true;
    restaurant.unsuspendedAt = new Date();
    restaurant.unsuspendedBy = req.user._id;
    await restaurant.save();

    // Log activity
    await RestaurantActivityLog.create({
      restaurantId: restaurant._id,
      action: 'unsuspended',
      performedBy: req.user._id,
      performedByRole: 'admin',
    });

    // Send email
    if (emailService.sendRestaurantUnsuspendedEmail && restaurant.ownerId) {
      emailService.sendRestaurantUnsuspendedEmail(restaurant.ownerId, restaurant)
        .catch(err => console.error('⚠️ Lỗi gửi email gỡ tạm ngưng:', err.message));
    }
    sendNotification(
      notificationService.notifyRestaurantAdminAction(req.app?.get?.('io') || null, {
        restaurant,
        title: 'Nha hang da hoat dong lai',
        message: `${restaurant.name} da duoc go tam ngung va hoat dong tro lai.`,
        action: 'unsuspended',
      }),
      'unsuspended'
    );

    return res.json({
      success: true,
      message: 'Đã gỡ tạm ngưng nhà hàng thành công',
      data: restaurant.toAdminJSON(),
    });
  } catch (error) {
    console.error('❌ [Admin/UnsuspendRestaurant] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể gỡ tạm ngưng nhà hàng' });
  }
};

// ────────────────────────────────────────────────────────
// G. Soft Delete nhà hàng
// ────────────────────────────────────────────────────────
const softDeleteRestaurant = async (req, res) => {
  try {
    const { reason } = req.body;
    
    const restaurant = await Restaurant.findById(req.params.id);
    if (!restaurant) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy nhà hàng' });
    }

    if (restaurant.deletedAt) {
      return res.status(400).json({ success: false, message: 'Nhà hàng đã bị xóa trước đó' });
    }

    restaurant.deletedAt = new Date();
    restaurant.deletedBy = req.user._id;
    restaurant.deleteReason = reason || null;
    restaurant.active = false;
    await restaurant.save();

    // Log activity
    await RestaurantActivityLog.create({
      restaurantId: restaurant._id,
      action: 'deleted',
      performedBy: req.user._id,
      performedByRole: 'admin',
      reason: reason || null,
    });
    sendNotification(
      notificationService.notifyRestaurantAdminAction(req.app?.get?.('io') || null, {
        restaurant,
        title: 'Nha hang da bi xoa',
        message: `${restaurant.name} da bi admin xoa${reason ? `. Ly do: ${reason}` : '.'}`,
        action: 'deleted',
      }),
      'deleted'
    );

    return res.json({
      success: true,
      message: 'Đã xóa nhà hàng thành công',
      data: restaurant.toAdminJSON(),
    });
  } catch (error) {
    console.error('❌ [Admin/DeleteRestaurant] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể xóa nhà hàng' });
  }
};

// ────────────────────────────────────────────────────────
// H. Khôi phục nhà hàng (Restore)
// ────────────────────────────────────────────────────────
const restoreRestaurant = async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.params.id);
    if (!restaurant) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy nhà hàng' });
    }

    if (!restaurant.deletedAt) {
      return res.status(400).json({ success: false, message: 'Chỉ có thể khôi phục nhà hàng đã bị xóa' });
    }

    restaurant.deletedAt = null;
    restaurant.deletedBy = null;
    restaurant.deleteReason = null;
    restaurant.active = true;
    restaurant.approvalStatus = 'approved';
    await restaurant.save();

    // Log activity
    await RestaurantActivityLog.create({
      restaurantId: restaurant._id,
      action: 'restored',
      performedBy: req.user._id,
      performedByRole: 'admin',
    });
    sendNotification(
      notificationService.notifyRestaurantAdminAction(req.app?.get?.('io') || null, {
        restaurant,
        title: 'Nha hang da duoc khoi phuc',
        message: `${restaurant.name} da duoc khoi phuc va hoat dong tro lai.`,
        action: 'restored',
      }),
      'restored'
    );

    return res.json({
      success: true,
      message: 'Đã khôi phục nhà hàng thành công',
      data: restaurant.toAdminJSON(),
    });
  } catch (error) {
    console.error('❌ [Admin/RestoreRestaurant] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể khôi phục nhà hàng' });
  }
};

// ────────────────────────────────────────────────────────
// I. Admin chỉnh sửa nhà hàng (featured, commissionRate, active)
// ────────────────────────────────────────────────────────
const updateRestaurant = async (req, res) => {
  try {
    const { commissionRate, featured, active } = req.body;
    
    const restaurant = await Restaurant.findById(req.params.id);
    if (!restaurant) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy nhà hàng' });
    }

    const metadataChanges = {};

    if (commissionRate !== undefined) {
      const rate = Number(commissionRate);
      if (isNaN(rate) || rate < 0 || rate > 100) {
        return res.status(400).json({ success: false, message: 'Tỷ lệ hoa hồng không hợp lệ (0-100)' });
      }
      if (restaurant.commissionRate !== rate) {
        metadataChanges.commissionRate = { old: restaurant.commissionRate, new: rate };
        restaurant.commissionRate = rate;
      }
    }

    if (featured !== undefined) {
      const isFeatured = !!featured;
      if (restaurant.featured !== isFeatured) {
        metadataChanges.featured = { old: restaurant.featured, new: isFeatured };
        restaurant.featured = isFeatured;
      }
    }

    if (active !== undefined) {
      const isActive = !!active;
      if (restaurant.active !== isActive) {
        metadataChanges.active = { old: restaurant.active, new: isActive };
        restaurant.active = isActive;
      }
    }

    // Only save and log if there are changes
    if (Object.keys(metadataChanges).length > 0) {
      await restaurant.save();

      // Log activity
      await RestaurantActivityLog.create({
        restaurantId: restaurant._id,
        action: 'updated',
        performedBy: req.user._id,
        performedByRole: 'admin',
        metadata: { changes: metadataChanges },
      });
      sendNotification(
        notificationService.notifyRestaurantAdminAction(req.app?.get?.('io') || null, {
          restaurant,
          title: 'Cau hinh nha hang da thay doi',
          message: `${restaurant.name} vua duoc admin cap nhat cau hinh.`,
          action: 'updated',
        }),
        'updated'
      );
    }

    return res.json({
      success: true,
      message: 'Cập nhật thông tin nhà hàng thành công',
      data: restaurant.toAdminJSON(),
    });
  } catch (error) {
    console.error('❌ [Admin/UpdateRestaurant] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể cập nhật nhà hàng' });
  }
};

// ────────────────────────────────────────────────────────
// J. Lấy nhật ký hoạt động (Activity Logs)
// ────────────────────────────────────────────────────────
const getActivityLogs = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      RestaurantActivityLog.find({ restaurantId: req.params.id })
        .populate('performedBy', 'fullName email role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      RestaurantActivityLog.countDocuments({ restaurantId: req.params.id }),
    ]);

    return res.json({
      success: true,
      data: {
        logs,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('❌ [Admin/GetActivityLogs] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể lấy lịch sử hoạt động' });
  }
};

module.exports = {
  getRestaurants,
  getRestaurantById,
  approveRestaurant,
  rejectRestaurant,
  suspendRestaurant,
  unsuspendRestaurant,
  softDeleteRestaurant,
  restoreRestaurant,
  updateRestaurant,
  getActivityLogs,
};
