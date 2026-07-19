'use strict';

const menuService = require('../services/menu.service');
const { assertOwnerCanAccessRestaurant } = require('../utils/restaurant-permission');
const MenuItem = require('../models/MenuItem');
const MenuCategory = require('../models/MenuCategory');

// ═══════════════════════════════════════════════
// MENU CATEGORIES
// ═══════════════════════════════════════════════

// GET /api/v1/owner/restaurants/:restaurantId/menu-categories
exports.getCategories = async (req, res) => {
  try {
    await assertOwnerCanAccessRestaurant(req.user._id, req.params.restaurantId);
    const categories = await menuService.getCategories(req.params.restaurantId);

    return res.status(200).json({
      success: true,
      data: { categories },
    });
  } catch (error) {
    console.error('❌ Error fetching categories:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Lỗi hệ thống.',
    });
  }
};

// POST /api/v1/owner/restaurants/:restaurantId/menu-categories
exports.createCategory = async (req, res) => {
  try {
    await assertOwnerCanAccessRestaurant(req.user._id, req.params.restaurantId);

    const { name, description, displayOrder } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Tên danh mục là bắt buộc' });
    }

    const category = await menuService.createCategory(req.params.restaurantId, {
      name: name.trim(),
      description,
      displayOrder,
    });

    return res.status(201).json({
      success: true,
      message: 'Tạo danh mục thành công',
      data: { category },
    });
  } catch (error) {
    // Duplicate key
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Tên danh mục đã tồn tại trong nhà hàng này',
      });
    }
    console.error('❌ Error creating category:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Lỗi hệ thống.',
    });
  }
};

// PUT /api/v1/owner/menu-categories/:id
exports.updateCategory = async (req, res) => {
  try {
    const existingCategory = await MenuCategory.findById(req.params.id).select('restaurantId');
    if (!existingCategory) {
      return res.status(404).json({ success: false, message: 'Danh mục không tồn tại' });
    }
    await assertOwnerCanAccessRestaurant(req.user._id, existingCategory.restaurantId);
    const { name, description, displayOrder, isActive } = req.body || {};
    const category = await menuService.updateCategory(req.params.id, {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(displayOrder !== undefined ? { displayOrder } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
    });

    return res.status(200).json({
      success: true,
      message: 'Cập nhật danh mục thành công',
      data: { category },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Tên danh mục đã tồn tại trong nhà hàng này',
      });
    }
    console.error('❌ Error updating category:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Lỗi hệ thống.',
    });
  }
};

// DELETE /api/v1/owner/menu-categories/:id
exports.deleteCategory = async (req, res) => {
  try {
    // Load category first to check ownership
    const MenuCategory = require('../models/MenuCategory');
    const cat = await MenuCategory.findById(req.params.id);
    if (!cat) {
      return res.status(404).json({ success: false, message: 'Danh mục không tồn tại' });
    }
    await assertOwnerCanAccessRestaurant(req.user._id, cat.restaurantId);

    await menuService.deleteCategory(req.params.id);

    return res.status(200).json({
      success: true,
      message: 'Xóa danh mục thành công',
    });
  } catch (error) {
    console.error('❌ Error deleting category:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Lỗi hệ thống.',
    });
  }
};

// ═══════════════════════════════════════════════
// MENU ITEMS
// ═══════════════════════════════════════════════

// GET /api/v1/owner/restaurants/:restaurantId/menu-items
exports.getMenuItems = async (req, res) => {
  try {
    await assertOwnerCanAccessRestaurant(req.user._id, req.params.restaurantId);
    const result = await menuService.getMenuItems(req.params.restaurantId, req.query);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('❌ Error fetching menu items:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Lỗi hệ thống.',
    });
  }
};

// POST /api/v1/owner/restaurants/:restaurantId/menu-items
exports.createMenuItem = async (req, res) => {
  try {
    await assertOwnerCanAccessRestaurant(req.user._id, req.params.restaurantId);

    const { name, price } = req.body;
    const errors = [];
    if (!name || !name.trim()) errors.push('Tên món ăn là bắt buộc');
    if (price === undefined || price === null || price === '') errors.push('Giá món ăn là bắt buộc');
    else if (isNaN(price) || Number(price) < 0) errors.push('Giá phải là số không âm');

    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: errors[0], errors });
    }

    const item = await menuService.createMenuItem(req.params.restaurantId, {
      ...req.body,
      name: name.trim(),
      price: Number(price),
    });

    return res.status(201).json({
      success: true,
      message: 'Tạo món ăn thành công',
      data: { item },
    });
  } catch (error) {
    console.error('❌ Error creating menu item:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Lỗi hệ thống.',
    });
  }
};

// PUT /api/v1/owner/menu-items/:id
exports.updateMenuItem = async (req, res) => {
  try {
    // Check ownership through the item's restaurantId
    const existing = await MenuItem.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Món ăn không tồn tại' });
    }
    await assertOwnerCanAccessRestaurant(req.user._id, existing.restaurantId);

    if (req.body.price !== undefined) {
      if (isNaN(req.body.price) || Number(req.body.price) < 0) {
        return res.status(400).json({ success: false, message: 'Giá phải là số không âm' });
      }
      req.body.price = Number(req.body.price);
    }

    const item = await menuService.updateMenuItem(req.params.id, req.body);

    return res.status(200).json({
      success: true,
      message: 'Cập nhật món ăn thành công',
      data: { item },
    });
  } catch (error) {
    console.error('❌ Error updating menu item:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Lỗi hệ thống.',
    });
  }
};

// DELETE /api/v1/owner/menu-items/:id
exports.deleteMenuItem = async (req, res) => {
  try {
    const existing = await MenuItem.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Món ăn không tồn tại' });
    }
    await assertOwnerCanAccessRestaurant(req.user._id, existing.restaurantId);

    await menuService.deleteMenuItem(req.params.id);

    return res.status(200).json({
      success: true,
      message: 'Xóa món ăn thành công',
    });
  } catch (error) {
    console.error('❌ Error deleting menu item:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Lỗi hệ thống.',
    });
  }
};

// PATCH /api/v1/owner/menu-items/:id/availability
exports.toggleAvailability = async (req, res) => {
  try {
    const existing = await MenuItem.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Món ăn không tồn tại' });
    }
    await assertOwnerCanAccessRestaurant(req.user._id, existing.restaurantId);

    const { isAvailable } = req.body;
    if (isAvailable === undefined) {
      return res.status(400).json({ success: false, message: 'isAvailable là bắt buộc' });
    }

    const item = await menuService.toggleAvailability(req.params.id, isAvailable);

    return res.status(200).json({
      success: true,
      message: isAvailable ? 'Đã bật món ăn' : 'Đã tắt món ăn',
      data: { item },
    });
  } catch (error) {
    console.error('❌ Error toggling availability:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Lỗi hệ thống.',
    });
  }
};
