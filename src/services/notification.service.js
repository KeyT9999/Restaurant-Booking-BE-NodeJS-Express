'use strict';

const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const Restaurant = require('../models/Restaurant');

const ROLE_ALIASES = {
  owner: 'restaurant_owner',
  restaurant: 'restaurant_owner',
  user: 'customer',
};

const LEGACY_TITLE_COPY = Object.freeze({
  'Da gui yeu cau dat ban': 'Đã gửi yêu cầu đặt bàn',
  'Booking da duoc xac nhan': 'Đặt bàn đã được xác nhận',
  'Booking da bi huy': 'Đặt bàn đã bị hủy',
  'Booking da hoan thanh': 'Đặt bàn đã hoàn thành',
  'Booking duoc danh dau no-show': 'Đặt bàn được đánh dấu khách không đến',
  'Thanh toan thanh cong': 'Thanh toán thành công',
  'Thanh toan that bai': 'Thanh toán thất bại',
  'Hoan tien da duoc duyet': 'Hoàn tiền đã được duyệt',
  'Hoan tien bi tu choi': 'Hoàn tiền bị từ chối',
  'Hoan tien da xu ly': 'Hoàn tiền đã xử lý',
  'Tin nhan moi': 'Tin nhắn mới',
});

const normalizeLegacyMessage = (message) => {
  if (!message) return message;

  return String(message)
    .replace(
      /^(.+) se xac nhan booking (.+) cua ban\.$/u,
      '$1 sẽ xác nhận yêu cầu đặt bàn $2 của bạn.'
    )
    .replace('Nha hang da xac nhan yeu cau dat ban cua ban.', 'Nhà hàng đã xác nhận yêu cầu đặt bàn của bạn.')
    .replace('Booking da duoc cap nhat sang trang thai huy.', 'Đặt bàn đã được cập nhật sang trạng thái hủy.')
    .replace('Booking cua ban da duoc danh dau hoan thanh.', 'Đặt bàn của bạn đã được đánh dấu hoàn thành.')
    .replace('Nha hang da danh dau booking la khach khong den.', 'Nhà hàng đã đánh dấu khách không đến.')
    .replace('Khoan thanh toan ', 'Khoản thanh toán ')
    .replace(' VND da duoc ghi nhan.', ' VND đã được ghi nhận.')
    .replace(
      'Thanh toan chua hoan tat. Vui long thu lai hoac chon phuong thuc khac.',
      'Thanh toán chưa hoàn tất. Vui lòng thử lại hoặc chọn phương thức khác.'
    )
    .replace('Yeu cau hoan tien cua ban da duoc duyet.', 'Yêu cầu hoàn tiền của bạn đã được duyệt.')
    .replace('Yeu cau hoan tien cua ban da bi tu choi.', 'Yêu cầu hoàn tiền của bạn đã bị từ chối.')
    .replace('Khoan hoan tien da duoc xu ly.', 'Khoản hoàn tiền đã được xử lý.')
    .replace(' So tien: ', ' Số tiền: ')
    .replace('Tin nhan dinh kem', 'Tin nhắn đính kèm')
    .replace('Tin nhan moi', 'Tin nhắn mới');
};

const normalizeLegacyNotificationCopy = (data) => ({
  ...data,
  title: LEGACY_TITLE_COPY[data.title] || data.title,
  message: normalizeLegacyMessage(data.message),
});

const normalizeRole = (role) => ROLE_ALIASES[role] || role;

const normalizeId = (value) => {
  if (!value) return null;
  if (value._id) return value._id.toString();
  if (value.id) return value.id.toString();
  return value.toString();
};

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(normalizeId(value));

const createHttpError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const toClient = (notification) => {
  if (!notification) return null;
  if (typeof notification.toClientJSON === 'function') {
    return normalizeLegacyNotificationCopy(notification.toClientJSON());
  }
  const doc = notification.toObject ? notification.toObject() : notification;
  return normalizeLegacyNotificationCopy({
    id: normalizeId(doc._id || doc.id),
    type: doc.type,
    title: doc.title,
    message: doc.message,
    recipientId: normalizeId(doc.recipientId),
    recipientRole: doc.recipientRole,
    restaurantId: normalizeId(doc.restaurantId),
    relatedEntity: {
      entityType: doc.relatedEntity?.entityType || 'system',
      entityId: normalizeId(doc.relatedEntity?.entityId),
      metadata: doc.relatedEntity?.metadata || {},
    },
    actionUrl: doc.actionUrl || null,
    status: doc.status,
    readAt: doc.readAt || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  });
};

const getOwnedRestaurantIds = async (userId) => {
  const restaurants = await Restaurant.find({ ownerId: userId }).select('_id').lean();
  return restaurants.map((restaurant) => restaurant._id);
};

const buildVisibilityFilter = async (user) => {
  if (!user) {
    throw createHttpError(401, 'Authentication required');
  }

  if (user.role === 'admin') {
    return { deletedAt: null };
  }

  if (user.role === 'restaurant_owner') {
    const restaurantIds = await getOwnedRestaurantIds(user._id);
    return {
      deletedAt: null,
      $or: [
        { recipientId: user._id },
        {
          recipientRole: 'restaurant_owner',
          restaurantId: { $in: restaurantIds },
        },
      ],
    };
  }

  return {
    deletedAt: null,
    recipientId: user._id,
    recipientRole: 'customer',
  };
};

const getTargetRooms = (notification) => {
  const data = toClient(notification);
  const rooms = [];
  if (data.recipientId) rooms.push(`user:${data.recipientId}`);
  if (data.recipientRole === 'admin') rooms.push('admin');
  if (data.recipientRole === 'restaurant_owner' && data.restaurantId) {
    rooms.push(`restaurant:${data.restaurantId}`);
  }
  return [...new Set(rooms.filter(Boolean))];
};

const emitNotification = (io, notification, eventName = 'notification:new') => {
  if (!io || !notification) return;
  const rooms = getTargetRooms(notification);
  if (rooms.length === 0) return;
  io.to(rooms).emit(eventName, toClient(notification));
};

const createNotification = async (payload, options = {}) => {
  const recipientRole = normalizeRole(payload.recipientRole);
  if (!recipientRole) {
    throw createHttpError(400, 'recipientRole is required');
  }

  if (payload.recipientId && !isObjectId(payload.recipientId)) {
    throw createHttpError(400, 'recipientId is invalid');
  }

  const doc = {
    type: payload.type,
    title: payload.title,
    message: payload.message,
    recipientId: payload.recipientId || null,
    recipientRole,
    restaurantId: payload.restaurantId || null,
    relatedEntity: payload.relatedEntity || undefined,
    actionUrl: payload.actionUrl || null,
    createdBy: payload.createdBy || null,
  };

  if (payload.sourceKey) {
    const existing = await Notification.findOne({ sourceKey: payload.sourceKey, deletedAt: null });
    if (existing) return existing;
    doc.sourceKey = payload.sourceKey;
  }

  const notification = await Notification.create(doc);
  emitNotification(options.io, notification);
  return notification;
};

const createNotifications = async (items, options = {}) => {
  const created = [];
  for (const item of items.filter(Boolean)) {
    try {
      const notification = await createNotification(item, options);
      created.push(notification);
    } catch (error) {
      console.warn(`[Notification] create failed: ${error.message}`);
    }
  }
  return created;
};

const createSafeNotification = (payload, options = {}) => {
  Promise.resolve(createNotification(payload, options)).catch((error) => {
    console.warn(`[Notification] create failed: ${error.message}`);
  });
};

const listNotifications = async (user, options = {}) => {
  const baseFilter = await buildVisibilityFilter(user);
  const filter = { ...baseFilter };

  if (options.status && ['read', 'unread'].includes(options.status)) {
    filter.status = options.status;
  }

  if (options.type) {
    filter.type = options.type;
  }

  const page = Math.max(1, parseInt(options.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Notification.countDocuments(filter),
    Notification.countDocuments({ ...baseFilter, status: 'unread' }),
  ]);

  return {
    notifications: notifications.map(toClient),
    total,
    unreadCount,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
};

const getUnreadCount = async (user) => {
  const filter = await buildVisibilityFilter(user);
  return Notification.countDocuments({ ...filter, status: 'unread' });
};

const findVisibleNotification = async (user, id) => {
  if (!isObjectId(id)) {
    throw createHttpError(400, 'Notification id is invalid');
  }

  const filter = await buildVisibilityFilter(user);
  const notification = await Notification.findOne({ ...filter, _id: id });
  if (!notification) {
    throw createHttpError(404, 'Notification not found');
  }
  return notification;
};

const markAsRead = async (user, id, io = null) => {
  const notification = await findVisibleNotification(user, id);
  if (notification.status !== 'read') {
    notification.status = 'read';
    notification.readAt = new Date();
    await notification.save();
    emitNotification(io, notification, 'notification:read');
  }
  return toClient(notification);
};

const markAllAsRead = async (user, io = null) => {
  const filter = await buildVisibilityFilter(user);
  const readAt = new Date();
  await Notification.updateMany(
    { ...filter, status: 'unread' },
    { status: 'read', readAt }
  );

  if (io && user.role !== 'admin') {
    io.to(`user:${user._id.toString()}`).emit('notification:read_all', { readAt });
  } else if (io && user.role === 'admin') {
    io.to('admin').emit('notification:read_all', { readAt });
  }

  return { readAt };
};

const deleteNotification = async (user, id, io = null) => {
  const notification = await findVisibleNotification(user, id);
  notification.deletedAt = new Date();
  await notification.save();
  emitNotification(io, notification, 'notification:deleted');
  return { id: notification._id.toString() };
};

const formatDateTime = (booking) => {
  const date = booking.bookingDate ? new Date(booking.bookingDate).toLocaleDateString('vi-VN') : '';
  return [date, booking.bookingTime].filter(Boolean).join(' ');
};

const bookingEntity = (booking) => ({
  entityType: 'booking',
  entityId: booking._id,
  metadata: {
    bookingDate: booking.bookingDate,
    bookingTime: booking.bookingTime,
    status: booking.status,
  },
});

const notifyBookingCreated = async (io, { booking, restaurant, customer }) => createNotifications([
  {
    type: 'booking_created',
    title: 'Đặt bàn mới',
    message: `${booking.customerName || 'Khách hàng'} đặt bàn ${formatDateTime(booking)} cho ${booking.numberOfGuests} khách.`,
    recipientId: restaurant?.ownerId,
    recipientRole: 'restaurant_owner',
    restaurantId: restaurant?._id || booking.restaurantId,
    relatedEntity: bookingEntity(booking),
    actionUrl: '/owner/bookings',
    sourceKey: `booking:${booking._id}:created:owner`,
  },
  {
    type: 'booking_created',
    title: 'Đã gửi yêu cầu đặt bàn',
    message: `${restaurant?.name || 'Nhà hàng'} sẽ xác nhận yêu cầu đặt bàn ${formatDateTime(booking)} của bạn.`,
    recipientId: booking.customerId || customer?._id,
    recipientRole: 'customer',
    restaurantId: restaurant?._id || booking.restaurantId,
    relatedEntity: bookingEntity(booking),
    actionUrl: `/bookings/${booking._id}`,
    sourceKey: `booking:${booking._id}:created:customer`,
  },
], { io });

const statusCopy = {
  confirmed: {
    type: 'booking_confirmed',
    title: 'Đặt bàn đã được xác nhận',
    message: 'Nhà hàng đã xác nhận yêu cầu đặt bàn của bạn.',
  },
  cancelled: {
    type: 'booking_cancelled',
    title: 'Đặt bàn đã bị hủy',
    message: 'Đặt bàn đã được cập nhật sang trạng thái hủy.',
  },
  completed: {
    type: 'booking_completed',
    title: 'Đặt bàn đã hoàn thành',
    message: 'Đặt bàn của bạn đã được đánh dấu hoàn thành.',
  },
  no_show: {
    type: 'booking_no_show',
    title: 'Đặt bàn được đánh dấu khách không đến',
    message: 'Nhà hàng đã đánh dấu khách không đến.',
  },
};

const notifyBookingStatusChanged = async (io, { booking, restaurant, status, reason, actorRole = 'restaurant_owner' }) => {
  const copy = statusCopy[status];
  if (!copy) return [];

  const customerMessage = status === 'cancelled' && reason
    ? `${copy.message} Lý do: ${reason}`
    : copy.message;

  const notifications = [
    {
      type: copy.type,
      title: copy.title,
      message: `${customerMessage} (${formatDateTime(booking)})`,
      recipientId: booking.customerId,
      recipientRole: 'customer',
      restaurantId: restaurant?._id || booking.restaurantId,
      relatedEntity: bookingEntity(booking),
      actionUrl: `/bookings/${booking._id}`,
      sourceKey: `booking:${booking._id}:${status}:customer`,
    },
  ];

  if (actorRole === 'customer') {
    notifications.push({
      type: copy.type,
      title: 'Đặt bàn đã cập nhật',
      message: `${booking.customerName || 'Khách hàng'} đã hủy đặt bàn ${formatDateTime(booking)}.`,
      recipientId: restaurant?.ownerId,
      recipientRole: 'restaurant_owner',
      restaurantId: restaurant?._id || booking.restaurantId,
      relatedEntity: bookingEntity(booking),
      actionUrl: '/owner/bookings',
      sourceKey: `booking:${booking._id}:${status}:owner`,
    });
  }

  return createNotifications(notifications, { io });
};

const notifyPaymentStatus = async (io, { payment, booking, restaurant, status = 'success' }) => {
  const isSuccess = status === 'success';
  const type = isSuccess ? 'payment_success' : 'payment_failed';
  const title = isSuccess ? 'Thanh toán thành công' : 'Thanh toán thất bại';
  const message = isSuccess
    ? `Khoản thanh toán ${Number(payment.amount || 0).toLocaleString('vi-VN')} VND đã được ghi nhận.`
    : 'Thanh toán chưa hoàn tất. Vui lòng thử lại hoặc chọn phương thức khác.';

  return createNotifications([
    {
      type,
      title,
      message,
      recipientId: payment.userId,
      recipientRole: payment.targetType === 'subscription' ? 'restaurant_owner' : 'customer',
      restaurantId: restaurant?._id || payment.restaurantId,
      relatedEntity: {
        entityType: 'payment',
        entityId: payment._id,
        metadata: {
          targetType: payment.targetType,
          targetId: payment.targetId,
          amount: payment.amount,
          status: payment.status,
        },
      },
      actionUrl: booking ? `/bookings/${booking._id}` : '/owner/billing',
      sourceKey: `payment:${payment._id}:${type}:payer`,
    },
    restaurant?.ownerId && booking ? {
      type,
      title: isSuccess ? 'Khách đã thanh toán cọc' : 'Thanh toán đặt bàn thất bại',
      message: `${booking.customerName || 'Khách hàng'}: ${message}`,
      recipientId: restaurant.ownerId,
      recipientRole: 'restaurant_owner',
      restaurantId: restaurant._id,
      relatedEntity: {
        entityType: 'payment',
        entityId: payment._id,
        metadata: { bookingId: booking._id, amount: payment.amount, status: payment.status },
      },
      actionUrl: '/owner/bookings',
      sourceKey: `payment:${payment._id}:${type}:owner`,
    } : null,
  ], { io });
};

const notifyRefundRequested = async (io, { refund, payment }) => createNotification({
  type: 'refund_requested',
    title: 'Yêu cầu hoàn tiền mới',
    message: `Yêu cầu hoàn tiền ${Number(refund.amount || 0).toLocaleString('vi-VN')} VND đang chờ xử lý.`,
  recipientRole: 'admin',
  relatedEntity: {
    entityType: 'refund',
    entityId: refund._id,
    metadata: {
      paymentId: payment?._id || refund.paymentId,
      amount: refund.amount,
      requestedBy: refund.requestedBy,
    },
  },
  actionUrl: '/admin/refunds',
  sourceKey: `refund:${refund._id}:requested:admin`,
}, { io });

const refundStatusCopy = {
  approved: {
    type: 'refund_approved',
    title: 'Hoàn tiền đã được duyệt',
    message: 'Yêu cầu hoàn tiền của bạn đã được duyệt.',
  },
  rejected: {
    type: 'refund_rejected',
    title: 'Hoàn tiền bị từ chối',
    message: 'Yêu cầu hoàn tiền của bạn đã bị từ chối.',
  },
  refunded: {
    type: 'refund_processed',
    title: 'Hoàn tiền đã xử lý',
    message: 'Khoản hoàn tiền đã được xử lý.',
  },
};

const notifyRefundStatus = async (io, { refund, status }) => {
  const copy = refundStatusCopy[status];
  if (!copy) return null;

  return createNotification({
    type: copy.type,
    title: copy.title,
    message: `${copy.message} Số tiền: ${Number(refund.amount || 0).toLocaleString('vi-VN')} VND.`,
    recipientId: refund.requestedBy,
    recipientRole: normalizeRole(refund.requestedByRole),
    relatedEntity: {
      entityType: 'refund',
      entityId: refund._id,
      metadata: { amount: refund.amount, status: refund.status },
    },
    actionUrl: refund.requestedByRole === 'restaurant_owner' ? '/owner/billing' : '/my-bookings',
    sourceKey: `refund:${refund._id}:${status}:requester`,
  }, { io });
};

const notifyRestaurantAdminAction = async (io, { restaurant, type = 'admin_action', title, message, action }) => {
  if (!restaurant?.ownerId) return null;
  return createNotification({
    type,
    title,
    message,
    recipientId: restaurant.ownerId,
    recipientRole: 'restaurant_owner',
    restaurantId: restaurant._id,
    relatedEntity: {
      entityType: 'restaurant',
      entityId: restaurant._id,
      metadata: { action },
    },
    actionUrl: '/owner/restaurants',
    sourceKey: `restaurant:${restaurant._id}:${action}:${Date.now()}`,
  }, { io });
};

const notifyVoucherCreated = async (io, { voucher, restaurant, createdByRole }) => {
  if (createdByRole === 'admin' && restaurant?.ownerId) {
    return createNotification({
      type: 'voucher_new',
      title: 'Voucher mới cho nhà hàng',
      message: `Mã ${voucher.code} đã được tạo cho ${restaurant.name}.`,
      recipientId: restaurant.ownerId,
      recipientRole: 'restaurant_owner',
      restaurantId: restaurant._id,
      relatedEntity: {
        entityType: 'voucher',
        entityId: voucher._id,
        metadata: { code: voucher.code, endDate: voucher.endDate },
      },
      actionUrl: '/owner/vouchers',
      sourceKey: `voucher:${voucher._id}:created:owner`,
    }, { io });
  }

  return createNotification({
    type: 'voucher_new',
    title: 'Voucher mới',
    message: `Mã ${voucher.code} vừa được tạo${restaurant?.name ? ` cho ${restaurant.name}` : ''}.`,
    recipientRole: 'admin',
    restaurantId: restaurant?._id || voucher.restaurantId || null,
    relatedEntity: {
      entityType: 'voucher',
      entityId: voucher._id,
      metadata: { code: voucher.code, endDate: voucher.endDate },
    },
    actionUrl: '/admin/vouchers',
    sourceKey: `voucher:${voucher._id}:created:admin`,
  }, { io });
};

const notifyChatMessage = async (io, { result, sender }) => {
  const message = result?.message;
  const conversation = result?.conversation;
  if (!message || !conversation || !sender) return [];

  const restaurantId = normalizeId(conversation.restaurant?.id || conversation.restaurant || message.restaurantId);
  const customerId = normalizeId(conversation.customer?.id || conversation.customer);
  const restaurant = restaurantId ? await Restaurant.findById(restaurantId).select('_id ownerId name').lean() : null;
  const preview = message.content || (message.attachments?.length ? 'Tin nhắn đính kèm' : 'Tin nhắn mới');
  const senderName = sender.fullName || sender.username || 'BookEat';
  const base = {
    type: 'chat_new_message',
    title: 'Tin nhắn mới',
    message: `${senderName}: ${preview}`.slice(0, 240),
    restaurantId: restaurant?._id || restaurantId,
    relatedEntity: {
      entityType: 'chat',
      entityId: message.conversationId,
      metadata: {
        messageId: message.id,
        conversationType: conversation.type,
      },
    },
  };

  if (conversation.type === 'CUSTOMER_RESTAURANT') {
    if (sender.role === 'customer' && restaurant?.ownerId) {
      return createNotifications([{
        ...base,
        recipientId: restaurant.ownerId,
        recipientRole: 'restaurant_owner',
        actionUrl: '/owner/chat',
        sourceKey: `chat:${message.id}:owner`,
      }], { io });
    }

    if (customerId && sender.role !== 'customer') {
      return createNotifications([{
        ...base,
        recipientId: customerId,
        recipientRole: 'customer',
        actionUrl: '/chat',
        sourceKey: `chat:${message.id}:customer`,
      }], { io });
    }
  }

  if (conversation.type === 'ADMIN_RESTAURANT') {
    if (sender.role === 'admin' && restaurant?.ownerId) {
      return createNotifications([{
        ...base,
        recipientId: restaurant.ownerId,
        recipientRole: 'restaurant_owner',
        actionUrl: '/owner/chat',
        sourceKey: `chat:${message.id}:owner`,
      }], { io });
    }

    if (sender.role === 'restaurant_owner') {
      return createNotifications([{
        ...base,
        recipientRole: 'admin',
        actionUrl: '/admin/chat',
        sourceKey: `chat:${message.id}:admin`,
      }], { io });
    }
  }

  return [];
};

const notifyBookingReminder = async (io, booking) => createNotification({
  type: 'booking_reminder',
  title: 'Nhắc nhở lịch đặt bàn',
  message: `Nhắc nhở: Bạn có lịch hẹn đặt bàn lúc ${formatDateTime(booking)}.`,
  recipientId: booking.customerId,
  recipientRole: 'customer',
  restaurantId: booking.restaurantId,
  relatedEntity: bookingEntity(booking),
  actionUrl: `/bookings/${booking._id}`,
  sourceKey: `booking:${booking._id}:reminder:customer`,
}, { io });

module.exports = {
  createHttpError,
  normalizeRole,
  toClient,
  emitNotification,
  createNotification,
  createNotifications,
  createSafeNotification,
  listNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  notifyBookingCreated,
  notifyBookingStatusChanged,
  notifyPaymentStatus,
  notifyRefundRequested,
  notifyRefundStatus,
  notifyRestaurantAdminAction,
  notifyVoucherCreated,
  notifyChatMessage,
  notifyBookingReminder,
};
