'use strict';

const { normalizeToken } = require('./recommendation-utils');

const PRICE_RANGE_LABELS = Object.freeze({
  budget: 'Binh dan',
  moderate: 'Trung cap',
  expensive: 'Cao cap',
  luxury: 'Sang trong',
});

const TIME_SLOT_LABELS = Object.freeze({
  breakfast: 'buoi sang',
  lunch: 'buoi trua',
  afternoon: 'buoi chieu',
  dinner: 'buoi toi',
  late: 'buoi muon',
});

const toTitleCase = (value = '') => value
  .split(/\s+/)
  .filter(Boolean)
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

const formatCuisine = (value, displayValues = []) => {
  const normalized = normalizeToken(value);
  if (!normalized) return null;

  const matchedDisplay = displayValues.find((item) => normalizeToken(item) === normalized);
  return matchedDisplay || toTitleCase(normalized);
};

const buildGroupSizeReason = (numberOfGuests) => {
  const guests = Number(numberOfGuests || 0);
  if (!Number.isFinite(guests) || guests <= 0) return null;
  if (guests <= 2) return 'Phu hop voi nhom nho';
  if (guests <= 4) return 'Phu hop voi nhom vua';
  return 'Phu hop voi nhom dong nguoi hon';
};

const createRecommendationReasonService = () => {
  const buildRestaurantReasons = ({
    candidate,
    componentScores = {},
    matchDetails = {},
    fallbackUsed = false,
    filters = {},
  }) => {
    const reasons = [];

    if (componentScores.cuisineMatch >= 0.35 && matchDetails.matchedCuisine) {
      const cuisineLabel = formatCuisine(matchDetails.matchedCuisine, candidate.displayCuisineTypes || []);
      if (cuisineLabel) {
        reasons.push(`Phu hop voi so thich mon ${cuisineLabel} cua ban`);
      }
    }

    if (componentScores.menuTagMatch >= 0.35) {
      reasons.push('Co phong cach mon an gan voi nhom ban thuong yeu thich');
    }

    if (componentScores.collaborative >= 0.2) {
      reasons.push('Tuong tu nhung nha hang ban tung quan tam');
    }

    if (componentScores.priceMatch >= 0.5 && candidate.priceRange) {
      const priceLabel = PRICE_RANGE_LABELS[candidate.priceRange] || candidate.priceRange;
      reasons.push(`Co khoang gia ${priceLabel.toLowerCase()} tuong tu nhung noi ban thuong quan tam`);
    }

    if (componentScores.timeContext >= 0.8 && matchDetails.preferredTimeSlot) {
      const timeLabel = TIME_SLOT_LABELS[matchDetails.preferredTimeSlot] || 'khung gio ban quan tam';
      reasons.push(`Phu hop voi thoi diem ${timeLabel}`);
    }

    if (componentScores.groupSizeContext >= 0.6) {
      const groupReason = buildGroupSizeReason(filters.numberOfGuests);
      if (groupReason) reasons.push(groupReason);
    }

    if (componentScores.ratingQuality >= 0.55) {
      reasons.push('Co danh gia tot');
    }

    if (componentScores.popularity >= 0.55) {
      reasons.push('Duoc nhieu khach hang yeu thich');
    }

    if (componentScores.voucherBoost >= 0.5) {
      reasons.push('Dang co uu dai phu hop');
    }

    if (!reasons.length && fallbackUsed) {
      if (candidate.qualityScore >= 0.55) {
        reasons.push('Co danh gia tot');
      }
      if (candidate.popularityScore >= 0.55) {
        reasons.push('Duoc nhieu khach hang yeu thich');
      }
    }

    if (!reasons.length) {
      reasons.push('Phu hop voi cac lua chon an uong dang duoc quan tam tren BookEat');
    }

    return [...new Set(reasons)].slice(0, 3);
  };

  const buildMenuReasons = ({
    candidate,
    componentScores = {},
    matchDetails = {},
    fallbackUsed = false,
  }) => {
    const reasons = [];

    if (componentScores.menuTagMatch >= 0.35) {
      reasons.push('Co mon an thuoc nhom ban thuong yeu thich');
    }

    if (componentScores.categoryMatch >= 0.35 && candidate.categoryName) {
      reasons.push(`Thuoc nhom mon ${candidate.categoryName} ban thuong quan tam`);
    }

    if (componentScores.cuisineMatch >= 0.35 && matchDetails.matchedCuisine) {
      const cuisineLabel = formatCuisine(matchDetails.matchedCuisine, candidate.displayCuisineTypes || []);
      if (cuisineLabel) {
        reasons.push(`Gan voi so thich am thuc ${cuisineLabel} cua ban`);
      }
    }

    if (componentScores.collaborative >= 0.2) {
      reasons.push('Tuong tu nhung mon ban tung quan tam');
    }

    if (componentScores.priceMatch >= 0.5 && candidate.priceRange) {
      const priceLabel = PRICE_RANGE_LABELS[candidate.priceRange] || candidate.priceRange;
      reasons.push(`Co khoang gia ${priceLabel.toLowerCase()} phu hop voi xu huong chon mon cua ban`);
    }

    if (componentScores.ratingQuality >= 0.55 || componentScores.restaurantQuality >= 0.55) {
      reasons.push('Co danh gia tot');
    }

    if (componentScores.popularity >= 0.55) {
      reasons.push('Duoc nhieu khach hang yeu thich');
    }

    if (componentScores.voucherBoost >= 0.5) {
      reasons.push('Dang co uu dai phu hop');
    }

    if (!reasons.length && fallbackUsed) {
      if (candidate.restaurantQualityScore >= 0.55) {
        reasons.push('Co danh gia tot');
      }
      if (candidate.popularityScore >= 0.55) {
        reasons.push('Duoc nhieu khach hang yeu thich');
      }
    }

    if (!reasons.length) {
      reasons.push('La mon dang duoc quan tam tren BookEat');
    }

    return [...new Set(reasons)].slice(0, 3);
  };

  return {
    buildMenuReasons,
    buildRestaurantReasons,
  };
};

module.exports = {
  PRICE_RANGE_LABELS,
  TIME_SLOT_LABELS,
  createRecommendationReasonService,
};
