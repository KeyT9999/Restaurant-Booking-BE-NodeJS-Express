'use strict';

const crypto = require('crypto');
const MenuCategory = require('../../models/MenuCategory');
const MenuItem = require('../../models/MenuItem');
const RecommendationItemProfile = require('../../models/RecommendationItemProfile');
const RecommendationResultCache = require('../../models/RecommendationResultCache');
const RecommendationUserProfile = require('../../models/RecommendationUserProfile');
const Restaurant = require('../../models/Restaurant');
const { normalizeRestaurantImages } = require('../../utils/restaurant-images');
const {
  CONTENT_RECOMMENDER_VERSION,
  CONTENT_RECOMMENDER_WEIGHTS,
  ITEM_TYPES,
} = require('./recommendation-constants');
const { createRecommendationReasonService, PRICE_RANGE_LABELS } = require('./recommendation-reason.service');
const {
  clamp,
  deriveTimeSlot,
  normalizeLogScore,
  normalizeToken,
  parseHourOfDay,
  roundNumber,
  toIdString,
  uniqueNormalizedStrings,
} = require('./recommendation-utils');

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;
const DEFAULT_HOME_LIMIT = 6;

const PUBLIC_RESTAURANT_FILTER = Object.freeze({
  approvalStatus: 'approved',
  active: true,
  deletedAt: null,
});

const parsePositiveInt = (value, fallback = DEFAULT_LIMIT, max = MAX_LIMIT) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
};

const parseBoolean = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  return defaultValue;
};

const parseNullableNumber = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const findMany = async (Model, filter = {}, projection = null) => {
  if (!Model || typeof Model.find !== 'function') return [];
  let query = Model.find(filter);
  if (projection && typeof query.select === 'function') {
    query = query.select(projection);
  }
  if (query && typeof query.lean === 'function') {
    return query.lean();
  }
  return query;
};

const findOneLean = async (Model, filter = {}) => {
  if (!Model || typeof Model.findOne !== 'function') return null;
  const query = Model.findOne(filter);
  if (query && typeof query.lean === 'function') {
    return query.lean();
  }
  return query;
};

const stableStringify = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const buildContextHash = (payload) => crypto
  .createHash('sha1')
  .update(stableStringify(payload))
  .digest('hex');

const buildMapFromProfiles = (profiles = []) => new Map(
  profiles.map((profile) => [toIdString(profile.itemId), profile])
);

const getMapValue = (mapLike, key) => {
  if (!mapLike || !key) return 0;
  if (typeof mapLike.get === 'function') return Number(mapLike.get(key) || 0);
  return Number(mapLike[key] || 0);
};

const getMapEntries = (mapLike) => {
  if (!mapLike) return [];
  if (typeof mapLike.entries === 'function') return [...mapLike.entries()];
  return Object.entries(mapLike);
};

const getMaxMapValue = (mapLike) => {
  const values = getMapEntries(mapLike)
    .map(([, value]) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  return values.length ? Math.max(...values) : 0;
};

const scoreAffinityMatch = (mapLike, values = []) => {
  const normalizedValues = uniqueNormalizedStrings(values);
  if (!normalizedValues.length) return 0;

  const maxValue = getMaxMapValue(mapLike);
  if (maxValue <= 0) return 0;

  const matches = normalizedValues
    .map((value) => getMapValue(mapLike, value))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (!matches.length) return 0;
  const average = matches.reduce((sum, value) => sum + value, 0) / matches.length;
  return clamp(roundNumber(average / maxValue, 6), 0, 1);
};

const normalizePriceRange = (value) => {
  const normalized = normalizeToken(value);
  if (!normalized) return null;

  if (['budget', 'low', 'binh dan', 'thap'].includes(normalized)) return 'budget';
  if (['moderate', 'medium', 'trung cap', 'trungcap'].includes(normalized)) return 'moderate';
  if (['expensive', 'high', 'cao cap', 'caocap'].includes(normalized)) return 'expensive';
  if (['luxury', 'premium', 'sang trong', 'sangtrong'].includes(normalized)) return 'luxury';
  return normalized;
};

const derivePriceBucketFromPrice = (price) => {
  const amount = Number(price || 0);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (amount <= 100000) return 'budget';
  if (amount <= 250000) return 'moderate';
  if (amount <= 500000) return 'expensive';
  return 'luxury';
};

const buildFallbackRestaurantMetrics = (candidate, metricsMaxima) => {
  const bookingScore = normalizeLogScore(candidate.rawMetrics.bookingCount, metricsMaxima.maxBookingCount);
  const reviewScore = normalizeLogScore(candidate.rawMetrics.reviewCount, metricsMaxima.maxReviewCount);
  const favoriteScore = normalizeLogScore(candidate.rawMetrics.favoriteCount, metricsMaxima.maxFavoriteCount);
  const ratingScore = clamp(roundNumber((candidate.rawMetrics.ratingAverage || 0) / 5, 6), 0, 1);

  return {
    qualityScore: clamp(roundNumber((ratingScore * 0.7) + (reviewScore * 0.3), 6), 0, 1),
    popularityScore: clamp(roundNumber((bookingScore * 0.5) + (favoriteScore * 0.3) + (reviewScore * 0.2), 6), 0, 1),
    ratingScore,
  };
};

const buildFallbackMenuMetrics = (candidate, metricsMaxima) => {
  const preorderScore = normalizeLogScore(candidate.rawMetrics.preorderCount, metricsMaxima.maxPreorderCount);
  const reviewScore = normalizeLogScore(candidate.rawMetrics.reviewCount, metricsMaxima.maxReviewCount);
  const restaurantBookingScore = normalizeLogScore(candidate.rawMetrics.restaurantBookingCount, metricsMaxima.maxRestaurantBookingCount);
  const ratingScore = clamp(roundNumber((candidate.rawMetrics.ratingAverage || 0) / 5, 6), 0, 1);

  return {
    restaurantQualityScore: clamp(roundNumber((ratingScore * 0.7) + (reviewScore * 0.3), 6), 0, 1),
    popularityScore: clamp(roundNumber((preorderScore * 0.6) + (restaurantBookingScore * 0.4), 6), 0, 1),
    ratingScore,
  };
};

const isOpenAtPreferredTime = (operatingHours, preferredTime) => {
  const hour = parseHourOfDay(preferredTime);
  if (!Number.isInteger(hour) || !operatingHours || typeof operatingHours !== 'object') return 0;

  return Object.values(operatingHours).some((day) => {
    if (!day || day.closed) return false;
    const openHour = parseHourOfDay(day.open);
    const closeHour = parseHourOfDay(day.close);
    if (!Number.isInteger(openHour) || !Number.isInteger(closeHour)) return false;
    if (closeHour >= openHour) {
      return hour >= openHour && hour <= closeHour;
    }
    return hour >= openHour || hour <= closeHour;
  }) ? 1 : 0;
};

const scoreRestaurantGroupSize = (candidate, numberOfGuests) => {
  const guests = Number(numberOfGuests || 0);
  const capacity = Number(candidate.capacity || 0);
  if (!Number.isFinite(guests) || guests < 1 || !Number.isFinite(capacity) || capacity < guests) return 0;
  if (capacity <= guests * 2) return 1;
  if (capacity <= guests * 3) return 0.75;
  return 0.5;
};

const resolveActor = (actor = null) => {
  const resolvedUserId = actor?._id || actor?.id || actor?.userId || null;
  return {
    role: actor?.role || 'guest',
    _id: resolvedUserId,
    id: resolvedUserId,
    userId: resolvedUserId,
  };
};

const normalizeRestaurantQuery = (query = {}) => ({
  limit: parsePositiveInt(query.limit, DEFAULT_LIMIT, MAX_LIMIT),
  city: normalizeToken(query.city),
  district: normalizeToken(query.district),
  cuisine: normalizeToken(query.cuisine),
  priceRange: normalizePriceRange(query.priceRange),
  excludeVisited: parseBoolean(query.excludeVisited, false),
  preferredTime: typeof query.preferredTime === 'string' ? query.preferredTime.trim() : null,
  numberOfGuests: parseNullableNumber(query.numberOfGuests),
});

const normalizeMenuQuery = (query = {}) => ({
  limit: parsePositiveInt(query.limit, DEFAULT_LIMIT, MAX_LIMIT),
  restaurantId: toIdString(query.restaurantId),
  category: normalizeToken(query.category),
  maxPrice: parseNullableNumber(query.maxPrice),
});

const normalizeHomeQuery = (query = {}) => ({
  limit: parsePositiveInt(query.limit, DEFAULT_HOME_LIMIT, 20),
  preferredTime: typeof query.preferredTime === 'string' ? query.preferredTime.trim() : null,
  numberOfGuests: parseNullableNumber(query.numberOfGuests),
});

const buildRestaurantCacheEntry = (item) => ({
  itemType: ITEM_TYPES.RESTAURANT,
  itemId: item.restaurantId,
  restaurantId: item.restaurantId,
  score: item.score,
});

const buildMenuCacheEntry = (item) => ({
  itemType: ITEM_TYPES.MENU_ITEM,
  itemId: item.menuItemId,
  restaurantId: item.restaurantId,
  score: item.score,
});

const buildGuestOrCustomerCacheUserId = (actor) => (
  actor.role === 'customer' && actor.userId ? actor.userId : null
);

const createRecommendationFoundation = (dependencies = {}) => {
  const models = {
    MenuCategory,
    MenuItem,
    RecommendationItemProfile,
    RecommendationResultCache,
    RecommendationUserProfile,
    Restaurant,
    ...dependencies,
  };
  const reasonService = dependencies.reasonService || createRecommendationReasonService();
  const defaultAlgorithmVersion = dependencies.algorithmVersion || CONTENT_RECOMMENDER_VERSION;

  const readCache = async ({
    userId,
    surface,
    recommendationType,
    contextHash,
    algorithmVersion = defaultAlgorithmVersion,
  }) => {
    const cache = await findOneLean(models.RecommendationResultCache, {
      userId,
      surface,
      recommendationType,
      contextHash,
      algorithmVersion,
    });

    if (!cache || !cache.payload) return null;
    if (cache.expiresAt && new Date(cache.expiresAt) <= new Date()) return null;
    return cache.payload;
  };

  const writeCache = async ({
    userId,
    surface,
    recommendationType,
    contextHash,
    payload,
    items,
    ttlMs,
    algorithmVersion = defaultAlgorithmVersion,
  }) => {
    if (!models.RecommendationResultCache) return;

    const expiresAt = new Date(Date.now() + ttlMs);
    const cacheDocument = {
      userId,
      surface,
      recommendationType,
      contextHash,
      items,
      payload,
      reasons: [],
      fallbackUsed: Boolean(payload?.data?.fallbackUsed),
      algorithmVersion,
      generatedAt: new Date(payload?.data?.generatedAt || Date.now()),
      expiresAt,
    };

    const lookup = {
      userId,
      surface,
      recommendationType,
      contextHash,
      algorithmVersion,
    };

    if (typeof models.RecommendationResultCache.findOneAndUpdate === 'function') {
      await models.RecommendationResultCache.findOneAndUpdate(
        lookup,
        cacheDocument,
        { upsert: true, returnDocument: 'after' }
      );
      return;
    }

    if (typeof models.RecommendationResultCache.create === 'function') {
      await models.RecommendationResultCache.create({
        ...lookup,
        ...cacheDocument,
      });
    }
  };

  const getUserProfile = async (actor) => {
    if (actor.role !== 'customer' || !actor.userId) return null;
    return findOneLean(models.RecommendationUserProfile, { userId: actor.userId });
  };

  const canUsePersonalizedProfile = (actor, profile) => (
    actor.role === 'customer'
    && Boolean(profile)
    && profile.coldStartLevel !== 'none'
    && Number(profile?.stats?.positiveInteractions || 0) > 0
  );

  const getFallbackReasonForActor = (actor, profile, fallbackReasons) => {
    if (actor.role !== 'customer') {
      return actor.role === 'guest'
        ? fallbackReasons.NO_USER_PROFILE
        : fallbackReasons.USER_ROLE_NOT_SUPPORTED;
    }

    if (!profile || profile.coldStartLevel === 'none') {
      return fallbackReasons.NO_USER_PROFILE;
    }

    return null;
  };

  const loadRestaurantCandidates = async () => {
    const [restaurants, restaurantProfiles, menuItems, menuCategories] = await Promise.all([
      findMany(models.Restaurant, PUBLIC_RESTAURANT_FILTER),
      findMany(models.RecommendationItemProfile, { itemType: ITEM_TYPES.RESTAURANT }),
      findMany(models.MenuItem, { status: { $ne: 'hidden' } }),
      findMany(models.MenuCategory),
    ]);

    const restaurantProfileMap = buildMapFromProfiles(restaurantProfiles);
    const categoryNameMap = new Map(menuCategories.map((category) => [toIdString(category._id), category.name]));
    const menuMetaMap = new Map();

    for (const menuItem of menuItems) {
      const restaurantId = toIdString(menuItem.restaurantId);
      if (!restaurantId) continue;
      if (!menuMetaMap.has(restaurantId)) {
        menuMetaMap.set(restaurantId, { tags: [], categories: [] });
      }
      const meta = menuMetaMap.get(restaurantId);
      meta.tags.push(...(menuItem.tags || []));
      const categoryName = categoryNameMap.get(toIdString(menuItem.categoryId));
      if (categoryName) meta.categories.push(categoryName);
    }

    const candidates = restaurants.map((restaurant) => {
      const restaurantId = toIdString(restaurant._id);
      const profile = restaurantProfileMap.get(restaurantId) || null;
      const menuMeta = menuMetaMap.get(restaurantId) || { tags: [], categories: [] };
      const imageData = normalizeRestaurantImages(restaurant);
      const tags = uniqueNormalizedStrings(
        (Array.isArray(profile?.tags) && profile.tags.length ? profile.tags : menuMeta.tags)
      );
      const categoryNames = uniqueNormalizedStrings(menuMeta.categories);
      const rawMetrics = {
        bookingCount: Number(profile?.bookingCount || restaurant.stats?.completedBookings || restaurant.stats?.totalBookings || 0),
        reviewCount: Number(profile?.reviewCount || restaurant.stats?.totalReviews || 0),
        favoriteCount: Number(profile?.favoriteCount || 0),
        ratingAverage: Number(profile?.ratingAverage || restaurant.stats?.averageRating || 0),
      };
      const metrics = buildFallbackRestaurantMetrics({ rawMetrics }, {
        maxBookingCount: 1,
        maxReviewCount: 1,
        maxFavoriteCount: 1,
      });

      return {
        id: restaurantId,
        restaurantId,
        name: restaurant.name,
        image: profile?.metadata?.primaryImage || imageData.primaryImage,
        priceRange: normalizePriceRange(profile?.priceBucket || restaurant.priceRange),
        priceRangeLabel: PRICE_RANGE_LABELS[normalizePriceRange(profile?.priceBucket || restaurant.priceRange)] || null,
        averagePrice: Number(profile?.averagePrice || restaurant.averagePrice || 0) || null,
        cuisineTypes: uniqueNormalizedStrings(profile?.cuisineTypes?.length ? profile.cuisineTypes : restaurant.cuisineTypes || []),
        displayCuisineTypes: restaurant.cuisineTypes || [],
        tags,
        categoryNames,
        ratingAverage: rawMetrics.ratingAverage,
        ratingScore: Number.isFinite(profile?.ratingScore) ? profile.ratingScore : metrics.ratingScore,
        qualityScore: Number.isFinite(profile?.qualityScore) ? profile.qualityScore : null,
        popularityScore: Number.isFinite(profile?.popularityScore) ? profile.popularityScore : null,
        voucherActive: Boolean(profile?.voucherActive),
        featuredBoostEligible: Boolean(profile?.featuredBoostEligible || restaurant.featured),
        reviewCount: rawMetrics.reviewCount,
        bookingCount: rawMetrics.bookingCount,
        favoriteCount: rawMetrics.favoriteCount,
        location: {
          city: normalizeToken(profile?.location?.city || restaurant.address?.city),
          district: normalizeToken(profile?.location?.district || restaurant.address?.district),
        },
        capacity: Number(profile?.metadata?.capacity || restaurant.capacity || 0),
        operatingHours: profile?.metadata?.operatingHours || restaurant.operatingHours || null,
        rawMetrics,
      };
    });

    const metricsMaxima = {
      maxBookingCount: Math.max(1, ...candidates.map((candidate) => candidate.rawMetrics.bookingCount)),
      maxReviewCount: Math.max(1, ...candidates.map((candidate) => candidate.rawMetrics.reviewCount)),
      maxFavoriteCount: Math.max(1, ...candidates.map((candidate) => candidate.rawMetrics.favoriteCount)),
    };

    return candidates.map((candidate) => {
      const metrics = buildFallbackRestaurantMetrics(candidate, metricsMaxima);
      return {
        ...candidate,
        ratingScore: Number.isFinite(candidate.ratingScore) ? candidate.ratingScore : metrics.ratingScore,
        qualityScore: Number.isFinite(candidate.qualityScore) ? candidate.qualityScore : metrics.qualityScore,
        popularityScore: Number.isFinite(candidate.popularityScore) ? candidate.popularityScore : metrics.popularityScore,
      };
    });
  };

  const loadMenuItemCandidates = async (restaurantId = null) => {
    const restaurantFilter = restaurantId
      ? { ...PUBLIC_RESTAURANT_FILTER, _id: restaurantId }
      : PUBLIC_RESTAURANT_FILTER;

    const [restaurants, menuItems, menuProfiles, menuCategories] = await Promise.all([
      findMany(models.Restaurant, restaurantFilter),
      findMany(models.MenuItem, {}),
      findMany(models.RecommendationItemProfile, { itemType: ITEM_TYPES.MENU_ITEM }),
      findMany(models.MenuCategory),
    ]);

    const restaurantMap = new Map(restaurants.map((restaurant) => [toIdString(restaurant._id), restaurant]));
    const menuProfileMap = buildMapFromProfiles(menuProfiles);
    const categoryNameMap = new Map(menuCategories.map((category) => [toIdString(category._id), category.name]));

    const candidates = menuItems
      .filter((menuItem) => {
        const ownerRestaurant = restaurantMap.get(toIdString(menuItem.restaurantId));
        return Boolean(ownerRestaurant)
          && menuItem.status !== 'hidden'
          && menuItem.isAvailable !== false
          && menuItem.status === 'available';
      })
      .map((menuItem) => {
        const menuItemId = toIdString(menuItem._id);
        const ownerRestaurant = restaurantMap.get(toIdString(menuItem.restaurantId));
        const profile = menuProfileMap.get(menuItemId) || null;
        const rawMetrics = {
          preorderCount: Number(profile?.preorderCount || 0),
          reviewCount: Number(profile?.reviewCount || ownerRestaurant?.stats?.totalReviews || 0),
          restaurantBookingCount: Number(profile?.bookingCount || ownerRestaurant?.stats?.completedBookings || ownerRestaurant?.stats?.totalBookings || 0),
          ratingAverage: Number(profile?.ratingAverage || ownerRestaurant?.stats?.averageRating || 0),
        };

        return {
          id: menuItemId,
          menuItemId,
          restaurantId: toIdString(menuItem.restaurantId),
          restaurantName: ownerRestaurant?.name || null,
          name: menuItem.name,
          image: profile?.metadata?.image || menuItem.image || null,
          price: Number(menuItem.price || 0),
          priceRange: normalizePriceRange(profile?.priceBucket || derivePriceBucketFromPrice(menuItem.price)),
          priceRangeLabel: PRICE_RANGE_LABELS[normalizePriceRange(profile?.priceBucket || derivePriceBucketFromPrice(menuItem.price))] || null,
          categoryId: toIdString(menuItem.categoryId),
          categoryName: profile?.categoryName || categoryNameMap.get(toIdString(menuItem.categoryId)) || null,
          tags: uniqueNormalizedStrings(profile?.tags?.length ? profile.tags : menuItem.tags || []),
          cuisineTypes: uniqueNormalizedStrings(profile?.cuisineTypes?.length ? profile.cuisineTypes : ownerRestaurant?.cuisineTypes || []),
          displayCuisineTypes: ownerRestaurant?.cuisineTypes || [],
          ratingAverage: rawMetrics.ratingAverage,
          ratingScore: Number.isFinite(profile?.ratingScore) ? profile.ratingScore : null,
          restaurantQualityScore: Number.isFinite(profile?.qualityScore) ? profile.qualityScore : null,
          popularityScore: Number.isFinite(profile?.popularityScore) ? profile.popularityScore : null,
          voucherActive: Boolean(profile?.voucherActive),
          featuredBoostEligible: Boolean(profile?.featuredBoostEligible || ownerRestaurant?.featured),
          reviewCount: rawMetrics.reviewCount,
          bookingCount: rawMetrics.restaurantBookingCount,
          preorderCount: rawMetrics.preorderCount,
          location: {
            city: normalizeToken(ownerRestaurant?.address?.city),
            district: normalizeToken(ownerRestaurant?.address?.district),
          },
          rawMetrics,
        };
      });

    const metricsMaxima = {
      maxPreorderCount: Math.max(1, ...candidates.map((candidate) => candidate.rawMetrics.preorderCount)),
      maxReviewCount: Math.max(1, ...candidates.map((candidate) => candidate.rawMetrics.reviewCount)),
      maxRestaurantBookingCount: Math.max(1, ...candidates.map((candidate) => candidate.rawMetrics.restaurantBookingCount)),
    };

    return candidates.map((candidate) => {
      const metrics = buildFallbackMenuMetrics(candidate, metricsMaxima);
      return {
        ...candidate,
        ratingScore: Number.isFinite(candidate.ratingScore) ? candidate.ratingScore : metrics.ratingScore,
        restaurantQualityScore: Number.isFinite(candidate.restaurantQualityScore)
          ? candidate.restaurantQualityScore
          : metrics.restaurantQualityScore,
        popularityScore: Number.isFinite(candidate.popularityScore) ? candidate.popularityScore : metrics.popularityScore,
      };
    });
  };

  const applyRestaurantFilters = (candidates, filters, profile = null) => {
    const visitedRestaurantIds = new Set(
      parseBoolean(filters.excludeVisited, false) && profile
        ? (profile.restaurantHistory || []).map((entry) => toIdString(entry.restaurantId)).filter(Boolean)
        : []
    );
    const negativeRestaurantIds = new Set(
      (profile?.negativeRestaurantIds || []).map((value) => toIdString(value)).filter(Boolean)
    );

    return candidates.filter((candidate) => {
      if (filters.city && candidate.location.city !== filters.city) return false;
      if (filters.district && candidate.location.district !== filters.district) return false;
      if (filters.cuisine && !candidate.cuisineTypes.some((value) => value.includes(filters.cuisine))) return false;
      if (filters.priceRange && candidate.priceRange !== filters.priceRange) return false;
      if (visitedRestaurantIds.has(candidate.restaurantId)) return false;
      if (negativeRestaurantIds.has(candidate.restaurantId)) return false;
      return true;
    });
  };

  const applyMenuFilters = (candidates, filters, profile = null) => {
    const negativeRestaurantIds = new Set(
      (profile?.negativeRestaurantIds || []).map((value) => toIdString(value)).filter(Boolean)
    );

    return candidates.filter((candidate) => {
      if (filters.restaurantId && candidate.restaurantId !== filters.restaurantId) return false;
      if (filters.category) {
        const normalizedCategoryName = normalizeToken(candidate.categoryName);
        const normalizedCategoryId = normalizeToken(candidate.categoryId);
        if (normalizedCategoryName !== filters.category && normalizedCategoryId !== filters.category) return false;
      }
      if (Number.isFinite(filters.maxPrice) && candidate.price > filters.maxPrice) return false;
      if (negativeRestaurantIds.has(candidate.restaurantId)) return false;
      return true;
    });
  };

  const scoreRestaurantCandidate = (candidate, profile, filters) => {
    const weightConfig = CONTENT_RECOMMENDER_WEIGHTS.restaurant;
    const matchedCuisine = candidate.cuisineTypes.find((cuisineType) => getMapValue(profile?.cuisineAffinity, cuisineType) > 0) || null;
    const componentScores = {
      cuisineMatch: scoreAffinityMatch(profile?.cuisineAffinity, candidate.cuisineTypes),
      priceMatch: Math.max(
        scoreAffinityMatch(profile?.priceBucketAffinity, [candidate.priceRange]),
        filters.priceRange && filters.priceRange === candidate.priceRange ? 1 : 0
      ),
      menuTagMatch: scoreAffinityMatch(profile?.menuTagAffinity, candidate.tags),
      ratingQuality: clamp(roundNumber((candidate.qualityScore * 0.7) + (candidate.ratingScore * 0.3), 6), 0, 1),
      popularity: clamp(roundNumber(candidate.popularityScore, 6), 0, 1),
      timeContext: filters.preferredTime ? isOpenAtPreferredTime(candidate.operatingHours, filters.preferredTime) : 0,
      groupSizeContext: filters.numberOfGuests ? scoreRestaurantGroupSize(candidate, filters.numberOfGuests) : 0,
    };

    const score = clamp(roundNumber(
      (componentScores.cuisineMatch * weightConfig.cuisineMatch)
      + (componentScores.priceMatch * weightConfig.priceMatch)
      + (componentScores.menuTagMatch * weightConfig.menuTagMatch)
      + (componentScores.ratingQuality * weightConfig.ratingQuality)
      + (componentScores.popularity * weightConfig.popularity)
      + (componentScores.timeContext * weightConfig.timeContext)
      + (componentScores.groupSizeContext * weightConfig.groupSizeContext),
      6
    ), 0, 1);

    return {
      score,
      componentScores,
      matchDetails: {
        matchedCuisine,
        preferredTimeSlot: deriveTimeSlot(parseHourOfDay(filters.preferredTime)),
      },
    };
  };

  const scoreMenuCandidate = (candidate, profile, filters) => {
    const weightConfig = CONTENT_RECOMMENDER_WEIGHTS.menuItem;
    const matchedCuisine = candidate.cuisineTypes.find((cuisineType) => getMapValue(profile?.cuisineAffinity, cuisineType) > 0) || null;
    const componentScores = {
      menuTagMatch: scoreAffinityMatch(profile?.menuTagAffinity, candidate.tags),
      cuisineMatch: scoreAffinityMatch(profile?.cuisineAffinity, candidate.cuisineTypes),
      categoryMatch: scoreAffinityMatch(profile?.categoryAffinity, [candidate.categoryName]),
      priceMatch: Math.max(
        scoreAffinityMatch(profile?.priceBucketAffinity, [candidate.priceRange]),
        Number.isFinite(filters.maxPrice) && candidate.price <= filters.maxPrice ? 1 : 0
      ),
      popularity: clamp(roundNumber(candidate.popularityScore, 6), 0, 1),
      restaurantQuality: clamp(roundNumber(candidate.restaurantQualityScore, 6), 0, 1),
    };

    const score = clamp(roundNumber(
      (componentScores.menuTagMatch * weightConfig.menuTagMatch)
      + (componentScores.cuisineMatch * weightConfig.cuisineMatch)
      + (componentScores.categoryMatch * weightConfig.categoryMatch)
      + (componentScores.priceMatch * weightConfig.priceMatch)
      + (componentScores.popularity * weightConfig.popularity)
      + (componentScores.restaurantQuality * weightConfig.restaurantQuality),
      6
    ), 0, 1);

    return {
      score,
      componentScores,
      matchDetails: { matchedCuisine },
    };
  };

  const scoreFallbackRestaurantCandidate = (candidate) => clamp(roundNumber(
    (candidate.popularityScore * 0.55)
    + (candidate.qualityScore * 0.30)
    + (candidate.ratingScore * 0.15),
    6
  ), 0, 1);

  const scoreFallbackMenuCandidate = (candidate) => clamp(roundNumber(
    (candidate.popularityScore * 0.55)
    + (candidate.restaurantQualityScore * 0.30)
    + (candidate.ratingScore * 0.15),
    6
  ), 0, 1);

  const diversifyRestaurants = (items, limit) => {
    const selected = [];
    const cuisineCounts = new Map();

    for (const item of items) {
      const candidate = item.candidate || item;
      const primaryCuisine = candidate.cuisineTypes?.[0] || 'unknown';
      const currentCount = cuisineCounts.get(primaryCuisine) || 0;
      if (currentCount >= 2 && items.length > limit) continue;
      cuisineCounts.set(primaryCuisine, currentCount + 1);
      selected.push(item);
      if (selected.length >= limit) return selected;
    }

    for (const item of items) {
      const candidate = item.candidate || item;
      if (selected.some((selectedItem) => (selectedItem.candidate || selectedItem).restaurantId === candidate.restaurantId)) continue;
      selected.push(item);
      if (selected.length >= limit) break;
    }

    return selected.slice(0, limit);
  };

  const diversifyMenuItems = (items, limit) => {
    const selected = [];
    const restaurantCounts = new Map();

    for (const item of items) {
      const candidate = item.candidate || item;
      const restaurantId = candidate.restaurantId || 'unknown';
      const currentCount = restaurantCounts.get(restaurantId) || 0;
      if (currentCount >= 3 && items.length > limit) continue;
      restaurantCounts.set(restaurantId, currentCount + 1);
      selected.push(item);
      if (selected.length >= limit) return selected;
    }

    return selected.slice(0, limit);
  };

  const buildRestaurantResponseItem = ({
    candidate,
    scorePayload,
    fallbackUsed,
    filters,
    extraFields = {},
  }) => ({
    restaurantId: candidate.restaurantId,
    name: candidate.name,
    image: candidate.image || null,
    ratingAverage: roundNumber(candidate.ratingAverage, 2),
    priceRange: candidate.priceRange || null,
    priceRangeLabel: candidate.priceRangeLabel,
    cuisineTypes: candidate.displayCuisineTypes?.length ? candidate.displayCuisineTypes : candidate.cuisineTypes,
    score: clamp(roundNumber(scorePayload.score, 4), 0, 1),
    reasons: reasonService.buildRestaurantReasons({
      candidate,
      componentScores: scorePayload.componentScores,
      matchDetails: scorePayload.matchDetails,
      fallbackUsed,
      filters,
    }),
    voucherActive: candidate.voucherActive,
    featured: candidate.featuredBoostEligible,
    ...extraFields,
  });

  const buildMenuResponseItem = ({
    candidate,
    scorePayload,
    fallbackUsed,
    extraFields = {},
  }) => ({
    menuItemId: candidate.menuItemId,
    restaurantId: candidate.restaurantId,
    restaurantName: candidate.restaurantName,
    name: candidate.name,
    image: candidate.image || null,
    price: candidate.price,
    priceRange: candidate.priceRange || null,
    priceRangeLabel: candidate.priceRangeLabel,
    categoryName: candidate.categoryName || null,
    cuisineTypes: candidate.displayCuisineTypes?.length ? candidate.displayCuisineTypes : candidate.cuisineTypes,
    tags: candidate.tags,
    score: clamp(roundNumber(scorePayload.score, 4), 0, 1),
    reasons: reasonService.buildMenuReasons({
      candidate,
      componentScores: scorePayload.componentScores,
      matchDetails: scorePayload.matchDetails,
      fallbackUsed,
    }),
    voucherActive: candidate.voucherActive,
    featured: candidate.featuredBoostEligible,
    ...extraFields,
  });

  return {
    buildContextHash,
    buildGuestOrCustomerCacheUserId,
    buildMenuCacheEntry,
    buildMenuResponseItem,
    buildRestaurantCacheEntry,
    buildRestaurantResponseItem,
    canUsePersonalizedProfile,
    defaultAlgorithmVersion,
    diversifyMenuItems,
    diversifyRestaurants,
    getFallbackReasonForActor,
    getUserProfile,
    loadMenuItemCandidates,
    loadRestaurantCandidates,
    models,
    normalizeHomeQuery,
    normalizeMenuQuery,
    normalizeRestaurantQuery,
    parseBoolean,
    readCache,
    reasonService,
    resolveActor,
    scoreFallbackMenuCandidate,
    scoreFallbackRestaurantCandidate,
    scoreMenuCandidate,
    scoreRestaurantCandidate,
    scoreRestaurantGroupSize,
    writeCache,
    applyMenuFilters,
    applyRestaurantFilters,
  };
};

module.exports = {
  createRecommendationFoundation,
};
