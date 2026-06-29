'use strict';

const CustomerFavorite = require('../../models/CustomerFavorite');
const Booking = require('../../models/Booking');
const FeaturedPlacement = require('../../models/FeaturedPlacement');
const MenuCategory = require('../../models/MenuCategory');
const MenuItem = require('../../models/MenuItem');
const RecommendationInteraction = require('../../models/RecommendationInteraction');
const RecommendationItemProfile = require('../../models/RecommendationItemProfile');
const RecommendationUserProfile = require('../../models/RecommendationUserProfile');
const Restaurant = require('../../models/Restaurant');
const Review = require('../../models/Review');
const Voucher = require('../../models/Voucher');
const { normalizeRestaurantImages } = require('../../utils/restaurant-images');
const {
  EVENT_TYPES,
  ITEM_TYPES,
  PROFILE_VERSION,
} = require('./recommendation-constants');
const {
  bucketGroupSize,
  buildFeatureTokens,
  calculateRecencyFactor,
  clamp,
  deriveTimeSlot,
  incrementMap,
  incrementObjectCounter,
  isFeaturedPlacementActive,
  isMenuItemProfileEligible,
  isRestaurantProfileEligible,
  isVoucherActive,
  normalizeLogScore,
  roundNumber,
  sortMapToObject,
  toIdString,
  topKeysFromMap,
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

const buildItemProfileLookup = (profile) => ({
  itemType: profile.itemType,
  itemId: profile.itemId,
});

const createProfileBuilderService = (dependencies = {}) => {
  const models = {
    Booking,
    CustomerFavorite,
    FeaturedPlacement,
    MenuCategory,
    MenuItem,
    RecommendationInteraction,
    RecommendationItemProfile,
    RecommendationUserProfile,
    Restaurant,
    Review,
    Voucher,
    ...dependencies,
  };

  const buildUserProfileDocuments = async (options = {}) => {
    const referenceDate = options.referenceDate ? new Date(options.referenceDate) : new Date();
    const interactions = Array.isArray(options.interactions)
      ? options.interactions
      : await findMany(models.RecommendationInteraction);

    const groupedByUser = new Map();

    for (const interaction of interactions) {
      const userIdString = toIdString(interaction.userId);
      if (!userIdString) continue;
      if (!groupedByUser.has(userIdString)) {
        groupedByUser.set(userIdString, []);
      }
      groupedByUser.get(userIdString).push(interaction);
    }

    const profiles = [];

    for (const [userIdString, userInteractions] of groupedByUser.entries()) {
      const accumulators = {
        cuisineAffinity: new Map(),
        menuTagAffinity: new Map(),
        categoryAffinity: new Map(),
        priceBucketAffinity: new Map(),
        timeSlotAffinity: new Map(),
        weekdayAffinity: new Map(),
        groupSizeAffinity: new Map(),
        occasionAffinity: new Map(),
        cityAffinity: new Map(),
        districtAffinity: new Map(),
        restaurantScoreById: new Map(),
        restaurantLastInteractionAt: new Map(),
        negativeRestaurantIds: new Set(),
        distinctRestaurantIds: new Set(),
      };

      let totalInteractions = 0;
      let positiveInteractions = 0;
      let negativeInteractions = 0;
      let completedBookingCount = 0;
      let favoriteCount = 0;
      let positiveReviewCount = 0;
      let negativeReviewCount = 0;
      let menuPreorderCount = 0;
      let submittedRatingCount = 0;
      let submittedRatingSum = 0;
      let lastInteractionAt = null;

      for (const interaction of userInteractions) {
        totalInteractions += 1;
        const interactionDate = interaction.occurredAt ? new Date(interaction.occurredAt) : null;
        if (interactionDate && !Number.isNaN(interactionDate.getTime())) {
          if (!lastInteractionAt || interactionDate > lastInteractionAt) {
            lastInteractionAt = interactionDate;
          }
        }

        const restaurantIdString = toIdString(interaction.restaurantId);
        if (restaurantIdString) {
          accumulators.distinctRestaurantIds.add(restaurantIdString);
        }

        if (interaction.eventType === EVENT_TYPES.BOOKING_COMPLETED) completedBookingCount += 1;
        if (interaction.eventType === EVENT_TYPES.FAVORITE_ADDED) favoriteCount += 1;
        if (interaction.eventType === EVENT_TYPES.REVIEW_POSITIVE) positiveReviewCount += 1;
        if (interaction.eventType === EVENT_TYPES.REVIEW_NEGATIVE) negativeReviewCount += 1;
        if (interaction.eventType === EVENT_TYPES.MENU_PREORDERED) {
          menuPreorderCount += Number(interaction.quantity || interaction.rawValue || 1);
        }

        if (interaction.rating) {
          submittedRatingCount += 1;
          submittedRatingSum += Number(interaction.rating);
        }

        if (interaction.weight > 0) {
          positiveInteractions += 1;
        } else if (interaction.weight < 0) {
          negativeInteractions += 1;
        }

        if (interaction.weight <= 0) {
          if (restaurantIdString) {
            accumulators.negativeRestaurantIds.add(restaurantIdString);
          }
          continue;
        }

        const effectiveWeight = interaction.weight * calculateRecencyFactor(interaction.occurredAt, referenceDate);
        const context = interaction.context || {};
        const timeSlot = deriveTimeSlot(context.hourOfDay);
        const groupSizeBucket = bucketGroupSize(context.numberOfGuests);

        for (const cuisineType of context.cuisineTypes || []) {
          incrementMap(accumulators.cuisineAffinity, cuisineType, effectiveWeight);
        }
        for (const menuTag of context.menuTags || []) {
          incrementMap(accumulators.menuTagAffinity, menuTag, effectiveWeight);
        }
        for (const categoryName of context.menuCategories || []) {
          incrementMap(accumulators.categoryAffinity, categoryName, effectiveWeight);
        }

        incrementMap(accumulators.priceBucketAffinity, context.priceRange, effectiveWeight);
        incrementMap(accumulators.weekdayAffinity, context.dayOfWeek, effectiveWeight);
        incrementMap(accumulators.timeSlotAffinity, timeSlot, effectiveWeight);
        incrementMap(accumulators.groupSizeAffinity, groupSizeBucket, effectiveWeight);
        incrementMap(accumulators.occasionAffinity, context.occasion, effectiveWeight);
        incrementMap(accumulators.cityAffinity, context.city, effectiveWeight);
        incrementMap(accumulators.districtAffinity, context.district, effectiveWeight);

        if (restaurantIdString) {
          accumulators.restaurantScoreById.set(
            restaurantIdString,
            roundNumber((accumulators.restaurantScoreById.get(restaurantIdString) || 0) + effectiveWeight, 6)
          );
          accumulators.restaurantLastInteractionAt.set(restaurantIdString, interaction.occurredAt || null);
        }
      }

      const coldStartLevel = positiveInteractions === 0
        ? 'none'
        : positiveInteractions >= 5
          ? 'rich'
          : 'light';

      profiles.push({
        userId: userInteractions[0].userId,
        coldStartLevel,
        cuisineAffinity: sortMapToObject(accumulators.cuisineAffinity),
        menuTagAffinity: sortMapToObject(accumulators.menuTagAffinity),
        categoryAffinity: sortMapToObject(accumulators.categoryAffinity),
        priceBucketAffinity: sortMapToObject(accumulators.priceBucketAffinity),
        timeSlotAffinity: sortMapToObject(accumulators.timeSlotAffinity),
        weekdayAffinity: sortMapToObject(accumulators.weekdayAffinity),
        groupSizeAffinity: sortMapToObject(accumulators.groupSizeAffinity),
        occasionAffinity: sortMapToObject(accumulators.occasionAffinity),
        preferredCities: topKeysFromMap(accumulators.cityAffinity, 5),
        preferredDistricts: topKeysFromMap(accumulators.districtAffinity, 5),
        restaurantHistory: [...accumulators.restaurantScoreById.entries()]
          .sort((left, right) => right[1] - left[1])
          .slice(0, 20)
          .map(([restaurantId, score]) => ({
            restaurantId,
            score: roundNumber(score, 6),
            lastInteractionAt: accumulators.restaurantLastInteractionAt.get(restaurantId) || null,
          })),
        negativeRestaurantIds: [...accumulators.negativeRestaurantIds],
        stats: {
          totalInteractions,
          positiveInteractions,
          negativeInteractions,
          completedBookingCount,
          favoriteCount,
          positiveReviewCount,
          negativeReviewCount,
          menuPreorderCount,
          averageSubmittedRating: submittedRatingCount
            ? roundNumber(submittedRatingSum / submittedRatingCount, 4)
            : 0,
          distinctRestaurantCount: accumulators.distinctRestaurantIds.size,
          lastInteractionAt,
        },
        profileVersion: PROFILE_VERSION,
        generatedAt: referenceDate,
        lastBuiltAt: referenceDate,
      });
    }

    return {
      profiles,
      stats: {
        profileCount: profiles.length,
        sourceInteractionCount: interactions.length,
      },
    };
  };

  const buildRestaurantVoucherMap = (vouchers, referenceDate) => {
    const voucherRestaurants = new Set();

    for (const voucher of vouchers) {
      if (!isVoucherActive(voucher, referenceDate)) continue;

      const directRestaurantId = toIdString(voucher.restaurantId);
      if (directRestaurantId) voucherRestaurants.add(directRestaurantId);

      for (const restaurantId of voucher.applicableRestaurants || []) {
        const restaurantIdString = toIdString(restaurantId);
        if (restaurantIdString) voucherRestaurants.add(restaurantIdString);
      }
    }

    return voucherRestaurants;
  };

  const buildItemProfileDocuments = async (options = {}) => {
    const referenceDate = options.referenceDate ? new Date(options.referenceDate) : new Date();
    const interactionDocuments = Array.isArray(options.interactions)
      ? options.interactions
      : await findMany(models.RecommendationInteraction);

    const [
      restaurants,
      menuItems,
      menuCategories,
      favorites,
      reviews,
      bookings,
      vouchers,
      featuredPlacements,
    ] = await Promise.all([
      findMany(models.Restaurant),
      findMany(models.MenuItem),
      findMany(models.MenuCategory),
      findMany(models.CustomerFavorite),
      findMany(models.Review),
      findMany(models.Booking),
      findMany(models.Voucher),
      findMany(models.FeaturedPlacement),
    ]);

    const restaurantById = new Map(
      restaurants.map((restaurant) => [toIdString(restaurant._id), restaurant])
    );
    const categoryNameById = new Map(
      menuCategories.map((category) => [toIdString(category._id), category.name])
    );

    const favoriteCountByRestaurant = new Map();
    const bookingCountByRestaurant = new Map();
    const reviewCountByRestaurant = new Map();
    const reviewSumByRestaurant = new Map();
    const preorderCountByMenuItem = new Map();

    for (const favorite of favorites) {
      incrementObjectCounter(favoriteCountByRestaurant, favorite.restaurantId, 1);
    }

    for (const booking of bookings) {
      if (booking.status !== 'completed') continue;
      incrementObjectCounter(bookingCountByRestaurant, booking.restaurantId, 1);
    }

    for (const review of reviews) {
      if (review.status === 'hidden') continue;
      const restaurantIdString = toIdString(review.restaurantId);
      if (!restaurantIdString) continue;
      incrementObjectCounter(reviewCountByRestaurant, restaurantIdString, 1);
      reviewSumByRestaurant.set(
        restaurantIdString,
        (reviewSumByRestaurant.get(restaurantIdString) || 0) + Number(review.rating || 0)
      );
    }

    if (interactionDocuments.length) {
      for (const interaction of interactionDocuments) {
        if (interaction.eventType !== EVENT_TYPES.MENU_PREORDERED) continue;
        incrementObjectCounter(
          preorderCountByMenuItem,
          interaction.itemId,
          Number(interaction.quantity || interaction.rawValue || 1)
        );
      }
    } else {
      for (const booking of bookings) {
        if (booking.status !== 'completed' || !Array.isArray(booking.preOrderItems)) continue;
        for (const preOrderItem of booking.preOrderItems) {
          incrementObjectCounter(
            preorderCountByMenuItem,
            preOrderItem.menuItemId,
            Number(preOrderItem.quantity || 1)
          );
        }
      }
    }

    const restaurantVoucherMap = buildRestaurantVoucherMap(vouchers, referenceDate);
    const featuredRestaurantSet = new Set(
      featuredPlacements
        .filter((placement) => isFeaturedPlacementActive(placement, referenceDate))
        .map((placement) => toIdString(placement.restaurantId))
        .filter(Boolean)
    );

    const eligibleRestaurants = restaurants.filter((restaurant) => isRestaurantProfileEligible(restaurant));
    const restaurantRatingAverageById = new Map();

    for (const restaurant of eligibleRestaurants) {
      const restaurantIdString = toIdString(restaurant._id);
      const reviewCount = reviewCountByRestaurant.get(restaurantIdString) || 0;
      const averageFromReviews = reviewCount
        ? (reviewSumByRestaurant.get(restaurantIdString) || 0) / reviewCount
        : 0;
      const fallbackAverage = Number(restaurant.stats?.averageRating || 0);
      restaurantRatingAverageById.set(
        restaurantIdString,
        roundNumber(averageFromReviews || fallbackAverage, 4)
      );
    }

    const restaurantBookingMax = Math.max(0, ...[...bookingCountByRestaurant.values()]);
    const restaurantFavoriteMax = Math.max(0, ...[...favoriteCountByRestaurant.values()]);
    const restaurantReviewMax = Math.max(0, ...[...reviewCountByRestaurant.values()]);

    const restaurantProfiles = eligibleRestaurants.map((restaurant) => {
      const restaurantIdString = toIdString(restaurant._id);
      const ratingAverage = restaurantRatingAverageById.get(restaurantIdString) || 0;
      const reviewCount = reviewCountByRestaurant.get(restaurantIdString) || 0;
      const bookingCount = bookingCountByRestaurant.get(restaurantIdString) || Number(restaurant.stats?.completedBookings || 0);
      const favoriteCount = favoriteCountByRestaurant.get(restaurantIdString) || 0;
      const ratingScore = clamp(roundNumber(ratingAverage / 5, 6), 0, 1);
      const qualityScore = clamp(roundNumber(
        (ratingScore * 0.7) + (normalizeLogScore(reviewCount, restaurantReviewMax) * 0.3),
        6
      ), 0, 1);
      const popularityScore = clamp(roundNumber(
        (normalizeLogScore(bookingCount, restaurantBookingMax) * 0.5)
        + (normalizeLogScore(favoriteCount, restaurantFavoriteMax) * 0.3)
        + (normalizeLogScore(reviewCount, restaurantReviewMax) * 0.2),
        6
      ), 0, 1);
      const imageData = normalizeRestaurantImages(restaurant);

      return {
        itemType: ITEM_TYPES.RESTAURANT,
        itemId: restaurant._id,
        restaurantId: restaurant._id,
        name: restaurant.name,
        status: restaurant.approvalStatus,
        isActive: true,
        isAvailable: true,
        approvalStatus: restaurant.approvalStatus,
        cuisineTypes: uniqueNormalizedStrings(restaurant.cuisineTypes || []),
        tags: [],
        menuTags: [],
        categoryName: null,
        menuCategory: null,
        priceBucket: restaurant.priceRange || null,
        priceRange: restaurant.priceRange || null,
        price: null,
        averagePrice: restaurant.averagePrice || null,
        ratingAverage,
        ratingScore,
        reviewCount,
        bookingCount,
        favoriteCount,
        preorderCount: 0,
        popularityScore,
        qualityScore,
        voucherActive: restaurantVoucherMap.has(restaurantIdString),
        featuredBoostEligible: featuredRestaurantSet.has(restaurantIdString),
        location: {
          city: restaurant.address?.city || null,
          district: restaurant.address?.district || null,
          coordinates: {
            latitude: restaurant.coordinates?.latitude || null,
            longitude: restaurant.coordinates?.longitude || null,
          },
        },
        featureVector: {
          tokens: buildFeatureTokens({
            itemType: ITEM_TYPES.RESTAURANT,
            cuisineTypes: restaurant.cuisineTypes || [],
            priceBucket: restaurant.priceRange || null,
            city: restaurant.address?.city || null,
            district: restaurant.address?.district || null,
          }),
        },
        metadata: {
          primaryImage: imageData.primaryImage,
          coverImage: imageData.coverImage,
          logo: imageData.logo,
          hasMenu: Boolean(restaurant.hasMenu),
          hasTableLayout: Boolean(restaurant.hasTableLayout),
          capacity: Number(restaurant.capacity || 0) || null,
          operatingHours: restaurant.operatingHours || null,
        },
        profileVersion: PROFILE_VERSION,
        generatedAt: referenceDate,
        lastBuiltAt: referenceDate,
      };
    });

    const eligibleMenus = menuItems.filter((menuItem) => {
      const restaurant = restaurantById.get(toIdString(menuItem.restaurantId));
      return isMenuItemProfileEligible(menuItem, restaurant);
    });

    const menuRawPopularityScores = eligibleMenus.map((menuItem) => {
      const restaurantIdString = toIdString(menuItem.restaurantId);
      const menuItemIdString = toIdString(menuItem._id);
      const preorderCount = preorderCountByMenuItem.get(menuItemIdString) || 0;
      const restaurantBookingCount = bookingCountByRestaurant.get(restaurantIdString) || 0;
      const restaurantFavoriteCount = favoriteCountByRestaurant.get(restaurantIdString) || 0;
      return preorderCount + (restaurantBookingCount * 0.25) + (restaurantFavoriteCount * 0.1);
    });
    const menuPopularityMax = Math.max(0, ...menuRawPopularityScores);

    const menuProfiles = eligibleMenus.map((menuItem) => {
      const restaurantIdString = toIdString(menuItem.restaurantId);
      const restaurant = restaurantById.get(restaurantIdString);
      const menuItemIdString = toIdString(menuItem._id);
      const preorderCount = preorderCountByMenuItem.get(menuItemIdString) || 0;
      const restaurantBookingCount = bookingCountByRestaurant.get(restaurantIdString) || 0;
      const restaurantFavoriteCount = favoriteCountByRestaurant.get(restaurantIdString) || 0;
      const rawPopularity = preorderCount + (restaurantBookingCount * 0.25) + (restaurantFavoriteCount * 0.1);
      const ratingAverage = restaurantRatingAverageById.get(restaurantIdString) || 0;
      const ratingScore = clamp(roundNumber(ratingAverage / 5, 6), 0, 1);
      const restaurantReviewCount = reviewCountByRestaurant.get(restaurantIdString) || 0;
      const restaurantQualityScore = clamp(roundNumber(
        (ratingScore * 0.7) + (normalizeLogScore(restaurantReviewCount, restaurantReviewMax) * 0.3),
        6
      ), 0, 1);
      const categoryName = categoryNameById.get(toIdString(menuItem.categoryId)) || null;
      const priceBucket = restaurant?.priceRange
        || (menuItem.price <= 100000
          ? 'budget'
          : menuItem.price <= 250000
            ? 'moderate'
            : menuItem.price <= 500000
              ? 'expensive'
              : 'luxury');

      return {
        itemType: ITEM_TYPES.MENU_ITEM,
        itemId: menuItem._id,
        restaurantId: menuItem.restaurantId,
        name: menuItem.name,
        status: menuItem.status,
        isActive: menuItem.status !== 'hidden',
        isAvailable: menuItem.isAvailable !== false && menuItem.status === 'available',
        approvalStatus: restaurant?.approvalStatus || null,
        cuisineTypes: uniqueNormalizedStrings(restaurant?.cuisineTypes || []),
        tags: uniqueNormalizedStrings(menuItem.tags || []),
        menuTags: uniqueNormalizedStrings(menuItem.tags || []),
        categoryName,
        menuCategory: categoryName,
        priceBucket,
        priceRange: priceBucket,
        price: menuItem.price || null,
        averagePrice: restaurant?.averagePrice || null,
        ratingAverage,
        ratingScore,
        reviewCount: restaurantReviewCount,
        bookingCount: restaurantBookingCount,
        favoriteCount: favoriteCountByRestaurant.get(restaurantIdString) || 0,
        preorderCount,
        popularityScore: clamp(normalizeLogScore(rawPopularity, menuPopularityMax), 0, 1),
        qualityScore: clamp(roundNumber((restaurantQualityScore * 0.7) + (ratingScore * 0.3), 6), 0, 1),
        voucherActive: restaurantVoucherMap.has(restaurantIdString),
        featuredBoostEligible: featuredRestaurantSet.has(restaurantIdString),
        location: {
          city: restaurant?.address?.city || null,
          district: restaurant?.address?.district || null,
          coordinates: {
            latitude: restaurant?.coordinates?.latitude || null,
            longitude: restaurant?.coordinates?.longitude || null,
          },
        },
        featureVector: {
          tokens: buildFeatureTokens({
            itemType: ITEM_TYPES.MENU_ITEM,
            cuisineTypes: restaurant?.cuisineTypes || [],
            tags: menuItem.tags || [],
            categoryName,
            priceBucket,
            city: restaurant?.address?.city || null,
            district: restaurant?.address?.district || null,
          }),
        },
        metadata: {
          restaurantName: restaurant?.name || null,
          image: menuItem.image || null,
          categoryId: menuItem.categoryId || null,
          restaurantPrimaryImage: restaurant ? normalizeRestaurantImages(restaurant).primaryImage : null,
        },
        profileVersion: PROFILE_VERSION,
        generatedAt: referenceDate,
        lastBuiltAt: referenceDate,
      };
    });

    const profiles = [...restaurantProfiles, ...menuProfiles];
    return {
      profiles,
      stats: {
        restaurantProfileCount: restaurantProfiles.length,
        menuItemProfileCount: menuProfiles.length,
        totalProfileCount: profiles.length,
      },
    };
  };

  const replaceUserProfiles = async (profiles = []) => {
    if (!models.RecommendationUserProfile) {
      return { insertedCount: 0, deletedCount: 0 };
    }

    const deleteResult = await models.RecommendationUserProfile.deleteMany({});
    if (!profiles.length) {
      return {
        insertedCount: 0,
        deletedCount: deleteResult?.deletedCount || 0,
      };
    }

    const inserted = await models.RecommendationUserProfile.insertMany(profiles, { ordered: false });
    return {
      insertedCount: inserted.length,
      deletedCount: deleteResult?.deletedCount || 0,
    };
  };

  const replaceItemProfiles = async (profiles = []) => {
    if (!models.RecommendationItemProfile) {
      return { insertedCount: 0, deletedCount: 0 };
    }

    if (typeof models.RecommendationItemProfile.bulkWrite !== 'function') {
      const deleteResult = await models.RecommendationItemProfile.deleteMany({});
      if (!profiles.length) {
        return {
          insertedCount: 0,
          deletedCount: deleteResult?.deletedCount || 0,
        };
      }

      const inserted = await models.RecommendationItemProfile.insertMany(profiles, { ordered: false });
      return {
        insertedCount: inserted.length,
        deletedCount: deleteResult?.deletedCount || 0,
      };
    }

    const dedupedProfiles = [...profiles.reduce((map, profile) => {
      const itemId = toIdString(profile.itemId);
      if (!itemId || !profile.itemType) return map;
      map.set(`${profile.itemType}:${itemId}`, profile);
      return map;
    }, new Map()).values()];

    if (!dedupedProfiles.length) {
      const deleteResult = await models.RecommendationItemProfile.deleteMany({});
      return {
        insertedCount: 0,
        deletedCount: deleteResult?.deletedCount || 0,
        upsertedCount: 0,
        matchedCount: 0,
        modifiedCount: 0,
      };
    }

    const bulkResult = await models.RecommendationItemProfile.bulkWrite(
      dedupedProfiles.map((profile) => ({
        updateOne: {
          filter: buildItemProfileLookup(profile),
          update: { $set: profile },
          upsert: true,
        },
      })),
      { ordered: false }
    );

    const deleteResult = await models.RecommendationItemProfile.deleteMany({
      $nor: dedupedProfiles.map((profile) => buildItemProfileLookup(profile)),
    });

    return {
      insertedCount: dedupedProfiles.length,
      deletedCount: deleteResult?.deletedCount || 0,
      upsertedCount: Number(bulkResult?.upsertedCount || 0),
      matchedCount: Number(bulkResult?.matchedCount || 0),
      modifiedCount: Number(bulkResult?.modifiedCount || 0),
    };
  };

  return {
    buildItemProfileDocuments,
    buildUserProfileDocuments,
    replaceItemProfiles,
    replaceUserProfiles,
  };
};

module.exports = {
  createProfileBuilderService,
};
