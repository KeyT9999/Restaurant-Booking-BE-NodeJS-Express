'use strict';

const { createHybridRecommenderService } = require('../../recommendation/hybrid-recommender.service');
const { HYBRID_RECOMMENDER_VERSION } = require('../../recommendation/recommendation-constants');
const { normalizeToken } = require('../../recommendation/recommendation-utils');
const { makeToolError } = require('./public-customer.tools');

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const MIN_LIMIT = 1;

const clampInteger = (value, fallback = DEFAULT_LIMIT, min = MIN_LIMIT, max = MAX_LIMIT) => {
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
};

const asStringOrNull = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const normalizeRecommendationType = (value) => {
  const normalized = normalizeToken(value);
  if (!normalized) return 'restaurant';

  if (['restaurant', 'restaurants', 'nha_hang', 'nha hang', 'quan'].includes(normalized)) {
    return 'restaurant';
  }

  if ([
    'menu_item',
    'menu-item',
    'menu item',
    'menu',
    'dish',
    'dishes',
    'mon',
    'mon_an',
    'mon an',
  ].includes(normalized)) {
    return 'menu_item';
  }

  if (normalized === 'mixed') return 'mixed';
  throw makeToolError('INVALID_REQUEST', 'Recommendation type is invalid.');
};

const normalizeBudgetToPriceRange = (value) => {
  const normalized = normalizeToken(value);
  if (!normalized) return null;

  if (['low', 'budget', 'cheap', 'binh dan', 'thap'].includes(normalized)) return 'budget';
  if (['medium', 'moderate', 'mid', 'trung binh', 'trung cap'].includes(normalized)) return 'moderate';
  if (['high', 'expensive', 'cao cap'].includes(normalized)) return 'expensive';
  if (['luxury', 'premium', 'sang trong'].includes(normalized)) return 'luxury';
  return null;
};

const normalizeBudgetToMaxPrice = (value) => {
  const normalized = normalizeBudgetToPriceRange(value);
  if (normalized === 'budget') return 100000;
  if (normalized === 'moderate') return 250000;
  if (normalized === 'expensive') return 500000;
  if (normalized === 'luxury') return 1000000;
  return null;
};

const normalizePreferredTime = (value) => {
  const raw = asStringOrNull(value);
  if (!raw) return null;

  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) return raw;

  const normalized = normalizeToken(raw);
  if (!normalized) return null;

  if (['morning', 'breakfast', 'sang', 'buoi sang', 'sang nay'].includes(normalized)) return '08:00';
  if (['lunch', 'noon', 'trua', 'buoi trua', 'trua nay'].includes(normalized)) return '12:00';
  if (['afternoon', 'chieu', 'buoi chieu', 'chieu nay'].includes(normalized)) return '15:00';
  if (['evening', 'dinner', 'toi', 'buoi toi', 'toi nay', 'tonight'].includes(normalized)) return '19:00';
  if (['late', 'late_night', 'muon', 'buoi muon'].includes(normalized)) return '21:00';

  return null;
};

const normalizeLocationFilters = (value) => {
  const raw = asStringOrNull(value);
  const normalized = normalizeToken(raw);
  if (!raw || !normalized) return {};

  if (['near_me', 'near me', 'gan_toi', 'gan toi', 'xung quanh'].includes(normalized)) {
    return {};
  }

  if (
    normalized.startsWith('quan ')
    || normalized.startsWith('district ')
    || /^q\.?\s*\d+/i.test(raw)
    || /^\d+$/.test(normalized)
  ) {
    return { district: raw };
  }

  return { city: raw };
};

const sanitizeContext = (context = null) => {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return {
      budget: null,
      cuisine: null,
      location: null,
      numberOfGuests: null,
      occasion: null,
      preferredTime: null,
    };
  }

  return {
    budget: asStringOrNull(context.budget),
    cuisine: asStringOrNull(context.cuisine),
    location: asStringOrNull(context.location),
    numberOfGuests: Number.isInteger(context.numberOfGuests) ? context.numberOfGuests : null,
    occasion: asStringOrNull(context.occasion),
    preferredTime: asStringOrNull(context.preferredTime),
  };
};

const buildActor = (context = {}) => ({
  _id: context.actor?.userId || context.user?._id || context.user?.id || null,
  role: context.actor?.role || context.user?.role || 'guest',
});

const buildRestaurantQuery = (limit, safeContext) => ({
  limit,
  cuisine: safeContext.cuisine,
  numberOfGuests: safeContext.numberOfGuests,
  preferredTime: normalizePreferredTime(safeContext.preferredTime),
  priceRange: normalizeBudgetToPriceRange(safeContext.budget),
  ...normalizeLocationFilters(safeContext.location),
});

const buildMenuQuery = (limit, safeContext) => ({
  limit,
  maxPrice: normalizeBudgetToMaxPrice(safeContext.budget),
});

const sanitizeRestaurantItem = (item) => ({
  id: item.restaurantId,
  itemType: 'restaurant',
  name: item.name,
  image: item.image || null,
  ratingAverage: item.ratingAverage || 0,
  priceRange: item.priceRangeLabel || item.priceRange || null,
  cuisineTypes: item.cuisineTypes || [],
  score: item.score,
  reasons: Array.isArray(item.reasons) ? item.reasons.slice(0, 3) : [],
  metadata: {
    restaurantId: item.restaurantId,
    available: true,
    detailUrl: `/restaurants/${item.restaurantId}`,
    bookingUrl: `/restaurants/${item.restaurantId}`,
  },
});

const sanitizeMenuItem = (item) => ({
  id: item.menuItemId,
  itemType: 'menu_item',
  name: item.name,
  image: item.image || null,
  ratingAverage: item.ratingAverage || 0,
  priceRange: item.priceRangeLabel || item.priceRange || null,
  cuisineTypes: item.cuisineTypes || [],
  restaurantName: item.restaurantName || null,
  categoryName: item.categoryName || null,
  price: item.price,
  score: item.score,
  reasons: Array.isArray(item.reasons) ? item.reasons.slice(0, 3) : [],
  metadata: {
    menuItemId: item.menuItemId,
    restaurantId: item.restaurantId,
    available: true,
    detailUrl: `/restaurants/${item.restaurantId}`,
    menuUrl: `/restaurants/${item.restaurantId}#menu`,
  },
});

const buildAssistantMessage = ({ fallbackUsed, requestType }) => {
  if (fallbackUsed) {
    return 'Minh chua co du du lieu ca nhan hoa, nen goi y cac lua chon pho bien hoac phu hop hien tai.';
  }

  if (requestType === 'menu_item') {
    return 'Duoi day la mot so mon phu hop voi ban.';
  }

  if (requestType === 'mixed') {
    return 'Duoi day la mot so goi y nha hang va mon phu hop voi ban.';
  }

  return 'Duoi day la mot so goi y phu hop voi ban.';
};

const logRecommendationToolResult = ({
  actor,
  itemCount,
  limit,
  payload,
  requestId,
  type,
}) => {
  console.info(
    `[AI Recommendation Tool] requestId=${requestId || 'unknown'} userId=${actor._id || 'guest'} role=${actor.role} type=${type} limit=${limit} personalized=${payload.personalized === true} fallbackUsed=${payload.fallbackUsed === true} itemCount=${itemCount}`,
  );
};

const createRecommendationTools = ({
  hybridRecommender = createHybridRecommenderService(),
} = {}) => ({
  async get_personalized_recommendations(args = {}, context = {}) {
    const actor = buildActor(context);
    const type = normalizeRecommendationType(args.type);
    const limit = clampInteger(args.limit, DEFAULT_LIMIT, MIN_LIMIT, MAX_LIMIT);
    const safeContext = sanitizeContext(args.context);

    try {
      if (type === 'restaurant') {
        const result = await hybridRecommender.getRestaurantRecommendations({
          actor,
          query: buildRestaurantQuery(limit, safeContext),
        });
        const items = (result?.data?.items || []).map(sanitizeRestaurantItem);
        const payload = {
          requestType: 'restaurant',
          algorithm: result?.data?.algorithm || HYBRID_RECOMMENDER_VERSION,
          personalized: result?.data?.personalized === true,
          fallbackUsed: result?.data?.fallbackUsed === true,
          items,
          message: buildAssistantMessage({
            fallbackUsed: result?.data?.fallbackUsed === true,
            requestType: 'restaurant',
          }),
          sourceLabel: 'BookEat personalized recommendations',
        };

        logRecommendationToolResult({
          actor,
          itemCount: items.length,
          limit,
          payload,
          requestId: context.requestId,
          type,
        });

        return {
          type: 'personalized_recommendations',
          version: 1,
          payload,
        };
      }

      if (type === 'menu_item') {
        const result = await hybridRecommender.getMenuItemRecommendations({
          actor,
          query: buildMenuQuery(limit, safeContext),
        });
        const items = (result?.data?.items || []).map(sanitizeMenuItem);
        const payload = {
          requestType: 'menu_item',
          algorithm: result?.data?.algorithm || HYBRID_RECOMMENDER_VERSION,
          personalized: result?.data?.personalized === true,
          fallbackUsed: result?.data?.fallbackUsed === true,
          items,
          message: buildAssistantMessage({
            fallbackUsed: result?.data?.fallbackUsed === true,
            requestType: 'menu_item',
          }),
          sourceLabel: 'BookEat personalized recommendations',
        };

        logRecommendationToolResult({
          actor,
          itemCount: items.length,
          limit,
          payload,
          requestId: context.requestId,
          type,
        });

        return {
          type: 'personalized_recommendations',
          version: 1,
          payload,
        };
      }

      if (type === 'mixed') {
        const sectionLimit = clampInteger(Math.ceil(limit / 2), 3, 1, MAX_LIMIT);
        const [restaurants, menuItems] = await Promise.all([
          hybridRecommender.getRestaurantRecommendations({
            actor,
            query: buildRestaurantQuery(sectionLimit, safeContext),
          }),
          hybridRecommender.getMenuItemRecommendations({
            actor,
            query: buildMenuQuery(sectionLimit, safeContext),
          }),
        ]);

        const items = [
          ...(restaurants?.data?.items || []).map(sanitizeRestaurantItem),
          ...(menuItems?.data?.items || []).map(sanitizeMenuItem),
        ]
          .sort((left, right) => (
            (Number(right.score) || 0) - (Number(left.score) || 0)
            || left.name.localeCompare(right.name)
          ))
          .slice(0, limit);

        const payload = {
          requestType: 'mixed',
          algorithm: restaurants?.data?.algorithm
            || menuItems?.data?.algorithm
            || HYBRID_RECOMMENDER_VERSION,
          personalized: restaurants?.data?.personalized === true || menuItems?.data?.personalized === true,
          fallbackUsed: restaurants?.data?.fallbackUsed === true || menuItems?.data?.fallbackUsed === true,
          items,
          message: buildAssistantMessage({
            fallbackUsed: restaurants?.data?.fallbackUsed === true || menuItems?.data?.fallbackUsed === true,
            requestType: 'mixed',
          }),
          sourceLabel: 'BookEat personalized recommendations',
        };

        logRecommendationToolResult({
          actor,
          itemCount: items.length,
          limit,
          payload,
          requestId: context.requestId,
          type,
        });

        return {
          type: 'personalized_recommendations',
          version: 1,
          payload,
        };
      }

      throw makeToolError('INVALID_REQUEST', 'Recommendation type is invalid.');
    } catch (error) {
      if (error?.code) throw error;
      throw makeToolError('RECOMMENDATION_UNAVAILABLE', 'Recommendation service is unavailable.');
    }
  },
});

module.exports = {
  createRecommendationTools,
};
