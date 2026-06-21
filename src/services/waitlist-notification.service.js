'use strict';

const notificationService = require('./notification.service');
const Restaurant = require('../models/Restaurant');

const toId = (value) => {
  if (!value) return null;
  if (value._id) return value._id.toString();
  if (value.id) return value.id.toString();
  return value.toString();
};

const waitlistEntity = (waitlist) => ({
  entityType: 'waitlist',
  entityId: waitlist._id || waitlist.id,
  metadata: {
    preferredDate: waitlist.preferredDate,
    preferredTime: waitlist.preferredTime,
    numberOfGuests: waitlist.numberOfGuests,
    status: waitlist.status,
  },
});

const notifyWaitlistCreated = async (io, waitlist) => {
  const restaurantId = toId(waitlist.restaurantId || waitlist.restaurant?.id);
  const restaurant = await Restaurant.findById(restaurantId).select('ownerId name').lean();
  
  const notifications = [
    {
      type: 'waitlist_created',
      title: 'Yêu cầu chờ bàn mới',
      message: `Khách hàng ${waitlist.customerName || 'ẩn danh'} vừa tham gia danh sách chờ (bàn ${waitlist.numberOfGuests} người).`,
      recipientId: restaurant?.ownerId,
      recipientRole: 'restaurant_owner',
      restaurantId: restaurantId,
      relatedEntity: waitlistEntity(waitlist),
      actionUrl: '/owner/waitlists',
      sourceKey: `waitlist:${toId(waitlist)}:created:owner`,
    },
    {
      type: 'waitlist_created',
      title: 'Đã tham gia danh sách chờ',
      message: `Bạn đã tham gia danh sách chờ tại ${restaurant?.name || 'nhà hàng'}.`,
      recipientId: toId(waitlist.customerId),
      recipientRole: 'customer',
      restaurantId: restaurantId,
      relatedEntity: waitlistEntity(waitlist),
      actionUrl: `/my-waitlists`,
      sourceKey: `waitlist:${toId(waitlist)}:created:customer`,
    }
  ];

  return notificationService.createNotifications(notifications, { io });
};

const notifyWaitlistUpdated = async (io, waitlist, action = 'updated') => {
  const restaurantId = toId(waitlist.restaurantId || waitlist.restaurant?.id);
  const restaurant = await Restaurant.findById(restaurantId).select('ownerId name').lean();
  
  const notifications = [
    {
      type: 'waitlist_updated',
      title: 'Danh sách chờ cập nhật',
      message: `Danh sách chờ của ${waitlist.customerName} đã được cập nhật.`,
      recipientId: restaurant?.ownerId,
      recipientRole: 'restaurant_owner',
      restaurantId: restaurantId,
      relatedEntity: waitlistEntity(waitlist),
      actionUrl: '/owner/waitlists',
      sourceKey: `waitlist:${toId(waitlist)}:${action}:owner:${Date.now()}`,
    },
    {
      type: 'waitlist_updated',
      title: 'Danh sách chờ cập nhật',
      message: `Yêu cầu chờ bàn của bạn tại ${restaurant?.name || 'nhà hàng'} đã được cập nhật.`,
      recipientId: toId(waitlist.customerId),
      recipientRole: 'customer',
      restaurantId: restaurantId,
      relatedEntity: waitlistEntity(waitlist),
      actionUrl: `/my-waitlists`,
      sourceKey: `waitlist:${toId(waitlist)}:${action}:customer:${Date.now()}`,
    }
  ];

  return notificationService.createNotifications(notifications, { io });
};

const notifyWaitlistConfirmed = async (io, waitlist, booking = null) => {
  const restaurantId = toId(waitlist.restaurantId || waitlist.restaurant?.id);
  const restaurant = await Restaurant.findById(restaurantId).select('ownerId name').lean();
  
  const notifications = [
    {
      type: 'waitlist_updated',
      title: 'Chờ bàn thành công',
      message: `Yêu cầu chờ bàn của bạn tại ${restaurant?.name || 'nhà hàng'} đã được xác nhận xếp bàn!`,
      recipientId: toId(waitlist.customerId),
      recipientRole: 'customer',
      restaurantId: restaurantId,
      relatedEntity: waitlistEntity(waitlist),
      actionUrl: `/my-waitlists`,
      sourceKey: `waitlist:${toId(waitlist)}:confirmed:customer`,
    }
  ];
  return notificationService.createNotifications(notifications, { io });
};

const notifyWaitlistCancelled = async (io, waitlist) => {
  const restaurantId = toId(waitlist.restaurantId || waitlist.restaurant?.id);
  const restaurant = await Restaurant.findById(restaurantId).select('ownerId name').lean();
  
  const notifications = [
    {
      type: 'waitlist_updated',
      title: 'Hủy danh sách chờ',
      message: `Yêu cầu chờ bàn của bạn đã bị hủy.`,
      recipientId: toId(waitlist.customerId),
      recipientRole: 'customer',
      restaurantId: restaurantId,
      relatedEntity: waitlistEntity(waitlist),
      actionUrl: `/my-waitlists`,
      sourceKey: `waitlist:${toId(waitlist)}:cancelled:customer`,
    },
    {
      type: 'waitlist_updated',
      title: 'Khách hủy chờ bàn',
      message: `Khách hàng ${waitlist.customerName} đã hủy yêu cầu chờ bàn.`,
      recipientId: restaurant?.ownerId,
      recipientRole: 'restaurant_owner',
      restaurantId: restaurantId,
      relatedEntity: waitlistEntity(waitlist),
      actionUrl: '/owner/waitlists',
      sourceKey: `waitlist:${toId(waitlist)}:cancelled:owner`,
    }
  ];
  return notificationService.createNotifications(notifications, { io });
};

const notifyWaitlistExpired = async (io, waitlist) => {
  const restaurantId = toId(waitlist.restaurantId || waitlist.restaurant?.id);
  const restaurant = await Restaurant.findById(restaurantId).select('ownerId name').lean();
  
  const notifications = [
    {
      type: 'waitlist_updated',
      title: 'Danh sách chờ hết hạn',
      message: `Yêu cầu chờ bàn của bạn tại ${restaurant?.name || 'nhà hàng'} đã hết hạn.`,
      recipientId: toId(waitlist.customerId),
      recipientRole: 'customer',
      restaurantId: restaurantId,
      relatedEntity: waitlistEntity(waitlist),
      actionUrl: `/my-waitlists`,
      sourceKey: `waitlist:${toId(waitlist)}:expired:customer`,
    }
  ];
  return notificationService.createNotifications(notifications, { io });
};

module.exports = {
  notifyWaitlistCreated,
  notifyWaitlistUpdated,
  notifyWaitlistConfirmed,
  notifyWaitlistCancelled,
  notifyWaitlistExpired,
};
