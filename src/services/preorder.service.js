'use strict';

const MenuItem = require('../models/MenuItem');

class PreOrderValidationError extends Error {
  constructor(message, code = 'INVALID_PREORDER') {
    super(message);
    this.name = 'PreOrderValidationError';
    this.code = code;
    this.statusCode = 400;
  }
}

const buildCanonicalPreOrder = async ({ restaurantId, items, session = null }) => {
  if (!Array.isArray(items)) throw new PreOrderValidationError('Danh sách món không hợp lệ');
  if (items.length === 0) return { items: [], totalAmount: 0 };

  const normalized = items.map((item) => {
    const quantity = Number(item?.quantity);
    if (!item?.menuItemId || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw new PreOrderValidationError('Món ăn hoặc số lượng không hợp lệ');
    }
    return { menuItemId: String(item.menuItemId), quantity, note: item.note || null };
  });
  if (new Set(normalized.map((item) => item.menuItemId)).size !== normalized.length) {
    throw new PreOrderValidationError('Không được gửi trùng món ăn');
  }

  const query = MenuItem.find({
    _id: { $in: normalized.map((item) => item.menuItemId) },
    restaurantId,
    isAvailable: true,
    status: 'available',
  });
  if (session) query.session(session);
  const menuItems = await query;
  if (menuItems.length !== normalized.length) {
    throw new PreOrderValidationError(
      'Có món không tồn tại, không thuộc nhà hàng hoặc hiện không được bán',
      'PREORDER_ITEM_UNAVAILABLE',
    );
  }
  const byId = new Map(menuItems.map((item) => [String(item._id), item]));
  let totalAmount = 0;
  const snapshots = normalized.map((item) => {
    const menuItem = byId.get(item.menuItemId);
    const subtotal = menuItem.price * item.quantity;
    totalAmount += subtotal;
    return {
      menuItemId: menuItem._id,
      nameSnapshot: menuItem.name,
      priceSnapshot: menuItem.price,
      quantity: item.quantity,
      note: item.note,
    };
  });
  return { items: snapshots, totalAmount };
};

module.exports = { PreOrderValidationError, buildCanonicalPreOrder };
