'use strict';

const ITEM_TYPES = {
  RESTAURANT: 'restaurant',
  MENU_ITEM: 'menu_item',
};

const INTERACTION_SOURCES = {
  BOOKING: 'booking',
  REVIEW: 'review',
  FAVORITE: 'favorite',
  MENU_PREORDER: 'menu_preorder',
};

const EVENT_TYPES = {
  BOOKING_COMPLETED: 'booking_completed',
  BOOKING_CANCELLED: 'booking_cancelled',
  BOOKING_NO_SHOW: 'booking_no_show',
  REVIEW_POSITIVE: 'review_positive',
  REVIEW_NEUTRAL: 'review_neutral',
  REVIEW_NEGATIVE: 'review_negative',
  FAVORITE_ADDED: 'favorite_added',
  MENU_PREORDERED: 'menu_preordered',
};

const SIGNAL_CLASSES = {
  IMPLICIT: 'implicit',
  EXPLICIT: 'explicit',
  FEEDBACK: 'feedback',
  NEGATIVE: 'negative',
};

const WEIGHTS = {
  bookingCompleted: 5,
  repeatedBookingBonus: 2,
  bookingCancelled: -1,
  bookingNoShow: -3,
  favoriteAdded: 4,
  reviewFiveStar: 5,
  reviewFourStar: 3,
  reviewThreeStar: 1,
  reviewNegative: -4,
  menuPreorderedBase: 2,
  menuPreorderedExtraQuantityStep: 0.5,
  menuPreorderedExtraQuantityCap: 2,
};

const PROFILE_VERSION = 1;
const DATASET_VERSION = 1;
const ALGORITHM_VERSION = 'phase2-dataset-builder-v1';
const CONTENT_RECOMMENDER_VERSION = 'phase3-content-based-v1';
const HYBRID_RECOMMENDER_VERSION = 'hybrid_v1';
const RECENCY_HALF_LIFE_DAYS = 90;
const RECOMMENDATION_RESPONSE_VERSION = 1;

const CONTENT_RECOMMENDER_WEIGHTS = Object.freeze({
  restaurant: Object.freeze({
    cuisineMatch: 0.30,
    priceMatch: 0.15,
    menuTagMatch: 0.20,
    ratingQuality: 0.15,
    popularity: 0.10,
    timeContext: 0.05,
    groupSizeContext: 0.05,
  }),
  menuItem: Object.freeze({
    menuTagMatch: 0.35,
    cuisineMatch: 0.20,
    categoryMatch: 0.15,
    priceMatch: 0.15,
    popularity: 0.10,
    restaurantQuality: 0.05,
  }),
});

const CACHE_TTL_MS = Object.freeze({
  restaurants: 30 * 60 * 1000,
  menuItems: 30 * 60 * 1000,
  home: 30 * 60 * 1000,
});

const HYBRID_RECOMMENDER_WEIGHTS = Object.freeze({
  personalized: Object.freeze({
    content: 0.55,
    collaborative: 0.25,
    popularity: 0.10,
    ratingQuality: 0.05,
    voucherBoost: 0.05,
  }),
  fallback: Object.freeze({
    content: 0.65,
    collaborative: 0,
    popularity: 0.20,
    ratingQuality: 0.10,
    voucherBoost: 0.05,
  }),
});

const COLLABORATIVE_SIMILARITY_OPTIONS = Object.freeze({
  lookbackDays: 365,
  limit: 10,
  maxInteractions: 4000,
  maxCandidateItems: 400,
  maxUserHistoryItems: 20,
  minCoOccurrenceUsers: 1,
  maxPositiveWeightPerUserItem: 12,
});

const COLLABORATIVE_POSITIVE_EVENT_TYPES = Object.freeze([
  EVENT_TYPES.BOOKING_COMPLETED,
  EVENT_TYPES.FAVORITE_ADDED,
  EVENT_TYPES.REVIEW_POSITIVE,
  EVENT_TYPES.MENU_PREORDERED,
]);

const FALLBACK_REASONS = Object.freeze({
  NO_USER_PROFILE: 'NO_USER_PROFILE',
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
  USER_ROLE_NOT_SUPPORTED: 'USER_ROLE_NOT_SUPPORTED',
});

module.exports = {
  ALGORITHM_VERSION,
  CACHE_TTL_MS,
  COLLABORATIVE_POSITIVE_EVENT_TYPES,
  COLLABORATIVE_SIMILARITY_OPTIONS,
  CONTENT_RECOMMENDER_VERSION,
  CONTENT_RECOMMENDER_WEIGHTS,
  DATASET_VERSION,
  EVENT_TYPES,
  FALLBACK_REASONS,
  HYBRID_RECOMMENDER_VERSION,
  HYBRID_RECOMMENDER_WEIGHTS,
  INTERACTION_SOURCES,
  ITEM_TYPES,
  PROFILE_VERSION,
  RECENCY_HALF_LIFE_DAYS,
  RECOMMENDATION_RESPONSE_VERSION,
  SIGNAL_CLASSES,
  WEIGHTS,
};
