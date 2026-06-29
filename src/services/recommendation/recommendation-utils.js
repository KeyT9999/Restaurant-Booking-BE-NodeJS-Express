'use strict';

const {
  RECENCY_HALF_LIFE_DAYS,
  WEIGHTS,
} = require('./recommendation-constants');

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const roundNumber = (value, decimals = 4) => {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const toIdString = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value.toString === 'function') return value.toString();
  return String(value);
};

const normalizeToken = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
};

const uniqueNormalizedStrings = (values = []) => {
  const seen = new Set();
  const items = [];
  for (const value of values) {
    const normalized = normalizeToken(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    items.push(normalized);
  }
  return items;
};

const getDayOfWeek = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return DAY_NAMES[date.getUTCDay()];
};

const parseHourOfDay = (bookingTime) => {
  if (typeof bookingTime !== 'string') return null;
  const match = bookingTime.trim().match(/^(\d{1,2})(?::(\d{2}))?/);
  if (!match) return null;
  const hour = Number(match[1]);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
};

const deriveTimeSlot = (hourOfDay) => {
  if (!Number.isInteger(hourOfDay)) return null;
  if (hourOfDay < 11) return 'breakfast';
  if (hourOfDay < 15) return 'lunch';
  if (hourOfDay < 18) return 'afternoon';
  if (hourOfDay < 23) return 'dinner';
  return 'late';
};

const bucketGroupSize = (value) => {
  const size = Number(value);
  if (!Number.isFinite(size) || size < 1) return null;
  if (size === 1) return '1';
  if (size === 2) return '2';
  if (size <= 4) return '3_4';
  if (size <= 6) return '5_6';
  return '7_plus';
};

const calculateMenuPreorderWeight = (quantity = 1) => {
  const parsedQuantity = Number.isFinite(Number(quantity)) ? Math.max(1, Number(quantity)) : 1;
  const extraQuantity = Math.max(0, parsedQuantity - 1);
  const extraWeight = Math.min(
    extraQuantity * WEIGHTS.menuPreorderedExtraQuantityStep,
    WEIGHTS.menuPreorderedExtraQuantityCap
  );
  return roundNumber(WEIGHTS.menuPreorderedBase + extraWeight, 4);
};

const calculateReviewWeight = (rating) => {
  if (rating >= 5) return WEIGHTS.reviewFiveStar;
  if (rating === 4) return WEIGHTS.reviewFourStar;
  if (rating === 3) return WEIGHTS.reviewThreeStar;
  return WEIGHTS.reviewNegative;
};

const calculateRecencyFactor = (occurredAt, referenceDate = new Date()) => {
  const eventDate = occurredAt ? new Date(occurredAt) : null;
  const now = referenceDate ? new Date(referenceDate) : new Date();
  if (!eventDate || Number.isNaN(eventDate.getTime()) || Number.isNaN(now.getTime())) return 1;
  const diffMs = Math.max(0, now.getTime() - eventDate.getTime());
  const diffDays = diffMs / (24 * 60 * 60 * 1000);
  return Math.exp(-diffDays / RECENCY_HALF_LIFE_DAYS);
};

const incrementMap = (map, key, amount) => {
  const normalizedKey = normalizeToken(key);
  if (!normalizedKey || !Number.isFinite(amount) || amount === 0) return;
  map.set(normalizedKey, roundNumber((map.get(normalizedKey) || 0) + amount, 6));
};

const incrementObjectCounter = (objectMap, key, amount = 1) => {
  const normalizedKey = toIdString(key);
  if (!normalizedKey) return;
  objectMap.set(normalizedKey, (objectMap.get(normalizedKey) || 0) + amount);
};

const sortMapToObject = (map, limit = null) => {
  const entries = [...map.entries()].sort((left, right) => right[1] - left[1]);
  const sliced = Number.isInteger(limit) && limit > 0 ? entries.slice(0, limit) : entries;
  return Object.fromEntries(sliced.map(([key, value]) => [key, roundNumber(value, 6)]));
};

const topKeysFromMap = (map, limit = 5) => (
  [...map.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([key]) => key)
);

const normalizeLogScore = (value, maxValue) => {
  const safeValue = Math.max(0, Number(value) || 0);
  const safeMax = Math.max(0, Number(maxValue) || 0);
  if (safeMax <= 0 || safeValue <= 0) return 0;
  return roundNumber(Math.log1p(safeValue) / Math.log1p(safeMax), 6);
};

const buildFeatureTokens = ({
  itemType,
  cuisineTypes = [],
  tags = [],
  categoryName = null,
  priceBucket = null,
  city = null,
  district = null,
}) => {
  const tokens = [];
  const addToken = (prefix, value) => {
    const normalized = normalizeToken(value);
    if (normalized) tokens.push(`${prefix}:${normalized}`);
  };

  addToken('item_type', itemType);
  cuisineTypes.forEach((value) => addToken('cuisine', value));
  tags.forEach((value) => addToken('tag', value));
  addToken('category', categoryName);
  addToken('price', priceBucket);
  addToken('city', city);
  addToken('district', district);

  return uniqueNormalizedStrings(tokens);
};

const isRestaurantProfileEligible = (restaurant) => Boolean(
  restaurant
  && restaurant.active !== false
  && restaurant.approvalStatus === 'approved'
  && !restaurant.deletedAt
);

const isMenuItemProfileEligible = (menuItem, restaurant) => Boolean(
  menuItem
  && restaurant
  && isRestaurantProfileEligible(restaurant)
  && menuItem.status === 'available'
  && menuItem.isAvailable !== false
);

const isVoucherActive = (voucher, referenceDate = new Date()) => {
  if (!voucher || voucher.status !== 'active') return false;
  const now = referenceDate ? new Date(referenceDate) : new Date();
  const startDate = voucher.startDate ? new Date(voucher.startDate) : null;
  const endDate = voucher.endDate ? new Date(voucher.endDate) : null;
  if (startDate && !Number.isNaN(startDate.getTime()) && startDate > now) return false;
  if (endDate && !Number.isNaN(endDate.getTime()) && endDate < now) return false;
  return true;
};

const isFeaturedPlacementActive = (placement, referenceDate = new Date()) => {
  if (!placement || placement.status !== 'active') return false;
  const now = referenceDate ? new Date(referenceDate) : new Date();
  const startAt = placement.startAt ? new Date(placement.startAt) : null;
  const endAt = placement.endAt ? new Date(placement.endAt) : null;
  if (startAt && !Number.isNaN(startAt.getTime()) && startAt > now) return false;
  if (endAt && !Number.isNaN(endAt.getTime()) && endAt < now) return false;
  return true;
};

module.exports = {
  bucketGroupSize,
  buildFeatureTokens,
  calculateMenuPreorderWeight,
  calculateRecencyFactor,
  calculateReviewWeight,
  clamp,
  deriveTimeSlot,
  getDayOfWeek,
  incrementMap,
  incrementObjectCounter,
  isFeaturedPlacementActive,
  isMenuItemProfileEligible,
  isRestaurantProfileEligible,
  isVoucherActive,
  normalizeLogScore,
  normalizeToken,
  parseHourOfDay,
  roundNumber,
  sortMapToObject,
  toIdString,
  topKeysFromMap,
  uniqueNormalizedStrings,
};
