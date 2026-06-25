'use strict';

const Booking = require('../../models/Booking');
const Review = require('../../models/Review');
const CustomerFavorite = require('../../models/CustomerFavorite');
const Restaurant = require('../../models/Restaurant');
const MenuItem = require('../../models/MenuItem');
const MenuCategory = require('../../models/MenuCategory');
const RecommendationInteraction = require('../../models/RecommendationInteraction');
const RecommendationResultCache = require('../../models/RecommendationResultCache');
const {
  EVENT_TYPES,
  INTERACTION_SOURCES,
  ITEM_TYPES,
  SIGNAL_CLASSES,
  WEIGHTS,
} = require('./recommendation-constants');
const {
  calculateMenuPreorderWeight,
  calculateReviewWeight,
  getDayOfWeek,
  parseHourOfDay,
  roundNumber,
  toIdString,
  uniqueNormalizedStrings,
} = require('./recommendation-utils');

const findMany = async (Model, filter = {}) => {
  if (!Model || typeof Model.find !== 'function') return [];
  const query = Model.find(filter);
  if (query && typeof query.lean === 'function') {
    return query.lean();
  }
  return query;
};

const createInteractionExtractorService = (dependencies = {}) => {
  const models = {
    Booking,
    CustomerFavorite,
    MenuCategory,
    MenuItem,
    RecommendationInteraction,
    RecommendationResultCache,
    Restaurant,
    Review,
    ...dependencies,
  };

  const buildRestaurantContext = ({ booking = null, restaurant = null, menuCategories = [], menuTags = [] }) => ({
    bookingDate: booking?.bookingDate || null,
    bookingTime: booking?.bookingTime || null,
    dayOfWeek: getDayOfWeek(booking?.bookingDate),
    hourOfDay: parseHourOfDay(booking?.bookingTime),
    numberOfGuests: booking?.numberOfGuests || null,
    occasion: booking?.occasion || null,
    priceRange: restaurant?.priceRange || null,
    cuisineTypes: uniqueNormalizedStrings(restaurant?.cuisineTypes || []),
    menuCategories: uniqueNormalizedStrings(menuCategories),
    menuTags: uniqueNormalizedStrings(menuTags),
    city: restaurant?.address?.city || null,
    district: restaurant?.address?.district || null,
  });

  const buildRestaurantInteractionDocument = ({
    userId,
    restaurantId,
    source,
    sourceId,
    eventType,
    signalClass,
    weight,
    occurredAt,
    bookingStatus = null,
    booking = null,
    restaurant = null,
    rawValue = null,
    rating = null,
    quantity = null,
    menuCategories = [],
    menuTags = [],
    metadata = {},
  }) => ({
    userId,
    itemType: ITEM_TYPES.RESTAURANT,
    itemId: restaurantId,
    restaurantId,
    source,
    sourceId,
    eventType,
    signalClass,
    weight: roundNumber(weight),
    rawValue,
    quantity,
    rating,
    bookingStatus,
    occurredAt,
    context: buildRestaurantContext({
      booking,
      restaurant,
      menuCategories,
      menuTags,
    }),
    metadata,
  });

  const buildMenuInteractionDocument = ({
    userId,
    restaurantId,
    menuItemId,
    sourceId,
    occurredAt,
    booking,
    restaurant,
    menuItem,
    quantity,
    categoryName,
  }) => ({
    userId,
    itemType: ITEM_TYPES.MENU_ITEM,
    itemId: menuItemId,
    restaurantId,
    source: INTERACTION_SOURCES.MENU_PREORDER,
    sourceId,
    eventType: EVENT_TYPES.MENU_PREORDERED,
    signalClass: SIGNAL_CLASSES.IMPLICIT,
    weight: calculateMenuPreorderWeight(quantity),
    rawValue: quantity,
    quantity,
    rating: null,
    bookingStatus: booking?.status || null,
    occurredAt,
    context: buildRestaurantContext({
      booking,
      restaurant,
      menuCategories: categoryName ? [categoryName] : [],
      menuTags: menuItem?.tags || [],
    }),
    metadata: {
      menuItemName: menuItem?.name || null,
      menuCategoryName: categoryName || null,
      restaurantName: restaurant?.name || null,
    },
  });

  const determineBookingSignal = (booking) => {
    switch (booking?.status) {
      case 'completed':
        return {
          eventType: EVENT_TYPES.BOOKING_COMPLETED,
          signalClass: SIGNAL_CLASSES.IMPLICIT,
          weight: WEIGHTS.bookingCompleted,
          occurredAt: booking.completedAt || booking.updatedAt || booking.createdAt || new Date(),
        };
      case 'cancelled':
        return {
          eventType: EVENT_TYPES.BOOKING_CANCELLED,
          signalClass: SIGNAL_CLASSES.NEGATIVE,
          weight: WEIGHTS.bookingCancelled,
          occurredAt: booking.cancelledAt || booking.updatedAt || booking.createdAt || new Date(),
        };
      case 'no_show':
        return {
          eventType: EVENT_TYPES.BOOKING_NO_SHOW,
          signalClass: SIGNAL_CLASSES.NEGATIVE,
          weight: WEIGHTS.bookingNoShow,
          occurredAt: booking.updatedAt || booking.createdAt || new Date(),
        };
      default:
        return null;
    }
  };

  const determineReviewSignal = (review) => {
    const rating = Number(review?.rating || 0);
    if (rating >= 4) {
      return {
        eventType: EVENT_TYPES.REVIEW_POSITIVE,
        signalClass: SIGNAL_CLASSES.EXPLICIT,
        weight: calculateReviewWeight(rating),
      };
    }
    if (rating === 3) {
      return {
        eventType: EVENT_TYPES.REVIEW_NEUTRAL,
        signalClass: SIGNAL_CLASSES.FEEDBACK,
        weight: calculateReviewWeight(rating),
      };
    }
    return {
      eventType: EVENT_TYPES.REVIEW_NEGATIVE,
      signalClass: SIGNAL_CLASSES.NEGATIVE,
      weight: calculateReviewWeight(rating),
    };
  };

  const buildInteractionDocuments = async (options = {}) => {
    const [
      bookings,
      reviews,
      favorites,
      restaurants,
      menuItems,
      menuCategories,
    ] = await Promise.all([
      findMany(models.Booking),
      findMany(models.Review),
      findMany(models.CustomerFavorite),
      findMany(models.Restaurant),
      findMany(models.MenuItem),
      findMany(models.MenuCategory),
    ]);

    const restaurantById = new Map(
      restaurants.map((restaurant) => [toIdString(restaurant._id), restaurant])
    );
    const categoryNameById = new Map(
      menuCategories.map((category) => [toIdString(category._id), category.name])
    );
    const menuItemById = new Map(
      menuItems.map((menuItem) => [toIdString(menuItem._id), menuItem])
    );

    const interactions = [];
    const affectedUserIds = new Set();
    const affectedRestaurantIds = new Set();
    const affectedItemIds = new Set();
    const repeatedBookingCounter = new Map();

    const stats = {
      sourceRecords: {
        bookings: bookings.length,
        reviews: reviews.length,
        favorites: favorites.length,
      },
      bookingRestaurantInteractions: 0,
      menuPreorderInteractions: 0,
      reviewInteractions: 0,
      favoriteInteractions: 0,
      skippedMenuPreorders: 0,
    };

    const sortedBookings = [...bookings].sort((left, right) => {
      const userCompare = `${toIdString(left.customerId) || ''}`.localeCompare(`${toIdString(right.customerId) || ''}`);
      if (userCompare !== 0) return userCompare;
      const restaurantCompare = `${toIdString(left.restaurantId) || ''}`.localeCompare(`${toIdString(right.restaurantId) || ''}`);
      if (restaurantCompare !== 0) return restaurantCompare;
      const leftTime = new Date(left.completedAt || left.updatedAt || left.createdAt || 0).getTime();
      const rightTime = new Date(right.completedAt || right.updatedAt || right.createdAt || 0).getTime();
      return leftTime - rightTime;
    });

    for (const booking of sortedBookings) {
      const userId = booking.customerId;
      const restaurantId = booking.restaurantId;
      const userIdString = toIdString(userId);
      const restaurantIdString = toIdString(restaurantId);
      if (!userIdString || !restaurantIdString) continue;

      const restaurant = restaurantById.get(restaurantIdString) || null;
      const bookingSignal = determineBookingSignal(booking);
      const bookingCategoryNames = [];
      const bookingMenuTags = [];

      if (Array.isArray(booking.preOrderItems)) {
        for (const preOrderItem of booking.preOrderItems) {
          const menuItemIdString = toIdString(preOrderItem?.menuItemId);
          const menuItem = menuItemIdString ? menuItemById.get(menuItemIdString) : null;
          if (!menuItem) continue;
          const categoryName = categoryNameById.get(toIdString(menuItem.categoryId)) || null;
          if (categoryName) bookingCategoryNames.push(categoryName);
          if (Array.isArray(menuItem.tags)) bookingMenuTags.push(...menuItem.tags);
        }
      }

      if (bookingSignal) {
        let weight = bookingSignal.weight;
        if (bookingSignal.eventType === EVENT_TYPES.BOOKING_COMPLETED) {
          const repeatKey = `${userIdString}:${restaurantIdString}`;
          const previousCount = repeatedBookingCounter.get(repeatKey) || 0;
          if (previousCount > 0) {
            weight += WEIGHTS.repeatedBookingBonus;
          }
          repeatedBookingCounter.set(repeatKey, previousCount + 1);
        }

        interactions.push(buildRestaurantInteractionDocument({
          userId,
          restaurantId,
          source: INTERACTION_SOURCES.BOOKING,
          sourceId: booking._id,
          eventType: bookingSignal.eventType,
          signalClass: bookingSignal.signalClass,
          weight,
          occurredAt: bookingSignal.occurredAt,
          bookingStatus: booking.status,
          booking,
          restaurant,
          menuCategories: bookingCategoryNames,
          menuTags: bookingMenuTags,
          metadata: {
            restaurantName: restaurant?.name || null,
            bookingId: toIdString(booking._id),
          },
        }));
        stats.bookingRestaurantInteractions += 1;
        affectedUserIds.add(userIdString);
        affectedRestaurantIds.add(restaurantIdString);
        affectedItemIds.add(`${ITEM_TYPES.RESTAURANT}:${restaurantIdString}`);
      }

      if (booking.status !== 'completed' || !Array.isArray(booking.preOrderItems)) {
        continue;
      }

      for (const preOrderItem of booking.preOrderItems) {
        const menuItemIdString = toIdString(preOrderItem?.menuItemId);
        const quantity = Number(preOrderItem?.quantity || 1);
        const menuItem = menuItemIdString ? menuItemById.get(menuItemIdString) : null;
        if (!menuItem || !menuItemIdString) {
          stats.skippedMenuPreorders += 1;
          continue;
        }

        const categoryName = categoryNameById.get(toIdString(menuItem.categoryId)) || null;
        interactions.push(buildMenuInteractionDocument({
          userId,
          restaurantId,
          menuItemId: menuItem._id,
          sourceId: booking._id,
          occurredAt: booking.completedAt || booking.updatedAt || booking.createdAt || new Date(),
          booking,
          restaurant,
          menuItem,
          quantity,
          categoryName,
        }));

        stats.menuPreorderInteractions += 1;
        affectedUserIds.add(userIdString);
        affectedRestaurantIds.add(restaurantIdString);
        affectedItemIds.add(`${ITEM_TYPES.MENU_ITEM}:${menuItemIdString}`);
      }
    }

    for (const review of reviews) {
      if (review.status === 'hidden') continue;

      const userIdString = toIdString(review.userId);
      const restaurantIdString = toIdString(review.restaurantId);
      if (!userIdString || !restaurantIdString) continue;

      const restaurant = restaurantById.get(restaurantIdString) || null;
      const reviewSignal = determineReviewSignal(review);

      interactions.push(buildRestaurantInteractionDocument({
        userId: review.userId,
        restaurantId: review.restaurantId,
        source: INTERACTION_SOURCES.REVIEW,
        sourceId: review._id,
        eventType: reviewSignal.eventType,
        signalClass: reviewSignal.signalClass,
        weight: reviewSignal.weight,
        occurredAt: review.createdAt || review.updatedAt || new Date(),
        restaurant,
        rawValue: review.rating,
        rating: review.rating,
        metadata: {
          restaurantName: restaurant?.name || null,
          reviewStatus: review.status || null,
        },
      }));

      stats.reviewInteractions += 1;
      affectedUserIds.add(userIdString);
      affectedRestaurantIds.add(restaurantIdString);
      affectedItemIds.add(`${ITEM_TYPES.RESTAURANT}:${restaurantIdString}`);
    }

    for (const favorite of favorites) {
      const userIdString = toIdString(favorite.customerId);
      const restaurantIdString = toIdString(favorite.restaurantId);
      if (!userIdString || !restaurantIdString) continue;

      const restaurant = restaurantById.get(restaurantIdString) || null;
      interactions.push(buildRestaurantInteractionDocument({
        userId: favorite.customerId,
        restaurantId: favorite.restaurantId,
        source: INTERACTION_SOURCES.FAVORITE,
        sourceId: favorite._id,
        eventType: EVENT_TYPES.FAVORITE_ADDED,
        signalClass: SIGNAL_CLASSES.IMPLICIT,
        weight: WEIGHTS.favoriteAdded,
        occurredAt: favorite.createdAt || favorite.updatedAt || new Date(),
        restaurant,
        metadata: {
          restaurantName: restaurant?.name || null,
        },
      }));

      stats.favoriteInteractions += 1;
      affectedUserIds.add(userIdString);
      affectedRestaurantIds.add(restaurantIdString);
      affectedItemIds.add(`${ITEM_TYPES.RESTAURANT}:${restaurantIdString}`);
    }

    return {
      interactions,
      stats: {
        ...stats,
        totalInteractions: interactions.length,
      },
      affectedUserIds: [...affectedUserIds],
      affectedRestaurantIds: [...affectedRestaurantIds],
      affectedItemIds: [...affectedItemIds],
    };
  };

  const replaceInteractions = async (interactionDocuments = []) => {
    if (!models.RecommendationInteraction) {
      return { insertedCount: 0, deletedCount: 0 };
    }

    const deleteResult = await models.RecommendationInteraction.deleteMany({});
    if (!interactionDocuments.length) {
      return {
        insertedCount: 0,
        deletedCount: deleteResult?.deletedCount || 0,
      };
    }

    const inserted = await models.RecommendationInteraction.insertMany(interactionDocuments, {
      ordered: false,
    });

    return {
      insertedCount: inserted.length,
      deletedCount: deleteResult?.deletedCount || 0,
    };
  };

  const invalidateUsers = async (userIds = []) => {
    const normalizedUserIds = userIds.filter(Boolean);
    if (!models.RecommendationResultCache || !normalizedUserIds.length) {
      return { deletedCount: 0 };
    }
    return models.RecommendationResultCache.deleteMany({
      userId: { $in: normalizedUserIds },
    });
  };

  const invalidateItems = async ({ itemIds = [], restaurantIds = [] } = {}) => {
    const normalizedItemIds = itemIds.filter(Boolean);
    const normalizedRestaurantIds = restaurantIds.filter(Boolean);

    if (!models.RecommendationResultCache || (!normalizedItemIds.length && !normalizedRestaurantIds.length)) {
      return { deletedCount: 0 };
    }

    const orConditions = [];
    if (normalizedItemIds.length) {
      orConditions.push({ 'items.itemId': { $in: normalizedItemIds } });
    }
    if (normalizedRestaurantIds.length) {
      orConditions.push({ 'items.restaurantId': { $in: normalizedRestaurantIds } });
    }

    return models.RecommendationResultCache.deleteMany({ $or: orConditions });
  };

  return {
    buildInteractionDocuments,
    invalidateItems,
    invalidateUsers,
    replaceInteractions,
  };
};

module.exports = {
  createInteractionExtractorService,
};
