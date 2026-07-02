'use strict';

const { normalizeToken } = require('./recommendation-utils');

const PRICE_RANGE_LABELS = Object.freeze({
  budget: 'Bình dân',
  moderate: 'Trung cấp',
  expensive: 'Cao cấp',
  luxury: 'Sang trọng',
});

const TIME_SLOT_LABELS = Object.freeze({
  breakfast: 'buổi sáng',
  lunch: 'buổi trưa',
  afternoon: 'buổi chiều',
  dinner: 'buổi tối',
  late: 'buổi muộn',
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
  if (guests <= 2) return 'Phù hợp với nhóm nhỏ';
  if (guests <= 4) return 'Phù hợp với nhóm vừa';
  return 'Phù hợp với nhóm đông người hơn';
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
        reasons.push(`Phù hợp với sở thích món ${cuisineLabel} của bạn`);
      }
    }

    if (componentScores.menuTagMatch >= 0.35) {
      reasons.push('Có phong cách món ăn gần với nhóm bạn thường yêu thích');
    }

    if (componentScores.collaborative >= 0.2) {
      reasons.push('Tương tự những nhà hàng bạn từng quan tâm');
    }

    if (componentScores.priceMatch >= 0.5 && candidate.priceRange) {
      const priceLabel = PRICE_RANGE_LABELS[candidate.priceRange] || candidate.priceRange;
      reasons.push(`Có khoảng giá ${priceLabel.toLowerCase()} tương tự những nơi bạn thường quan tâm`);
    }

    if (componentScores.timeContext >= 0.8 && matchDetails.preferredTimeSlot) {
      const timeLabel = TIME_SLOT_LABELS[matchDetails.preferredTimeSlot] || 'khung giờ bạn quan tâm';
      reasons.push(`Phù hợp với thời điểm ${timeLabel}`);
    }

    if (componentScores.groupSizeContext >= 0.6) {
      const groupReason = buildGroupSizeReason(filters.numberOfGuests);
      if (groupReason) reasons.push(groupReason);
    }

    if (componentScores.ratingQuality >= 0.55) {
      reasons.push('Có đánh giá tốt');
    }

    if (componentScores.popularity >= 0.55) {
      reasons.push('Được nhiều khách hàng yêu thích');
    }

    if (componentScores.voucherBoost >= 0.5) {
      reasons.push('Đang có ưu đãi phù hợp');
    }

    if (!reasons.length && fallbackUsed) {
      if (candidate.qualityScore >= 0.55) {
        reasons.push('Có đánh giá tốt');
      }
      if (candidate.popularityScore >= 0.55) {
        reasons.push('Được nhiều khách hàng yêu thích');
      }
    }

    if (!reasons.length) {
      reasons.push('Sẵn sàng để bạn khám phá thêm trên BookEat');
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
      reasons.push('Có món ăn thuộc nhóm bạn thường yêu thích');
    }

    if (componentScores.categoryMatch >= 0.35 && candidate.categoryName) {
      reasons.push(`Thuộc nhóm món ${candidate.categoryName} bạn thường quan tâm`);
    }

    if (componentScores.cuisineMatch >= 0.35 && matchDetails.matchedCuisine) {
      const cuisineLabel = formatCuisine(matchDetails.matchedCuisine, candidate.displayCuisineTypes || []);
      if (cuisineLabel) {
        reasons.push(`Gần với sở thích ẩm thực ${cuisineLabel} của bạn`);
      }
    }

    if (componentScores.collaborative >= 0.2) {
      reasons.push('Tương tự những món bạn từng quan tâm');
    }

    if (componentScores.priceMatch >= 0.5 && candidate.priceRange) {
      const priceLabel = PRICE_RANGE_LABELS[candidate.priceRange] || candidate.priceRange;
      reasons.push(`Có khoảng giá ${priceLabel.toLowerCase()} phù hợp với xu hướng chọn món của bạn`);
    }

    if (componentScores.ratingQuality >= 0.55 || componentScores.restaurantQuality >= 0.55) {
      reasons.push('Có đánh giá tốt');
    }

    if (componentScores.popularity >= 0.55) {
      reasons.push('Được nhiều khách hàng yêu thích');
    }

    if (componentScores.voucherBoost >= 0.5) {
      reasons.push('Đang có ưu đãi phù hợp');
    }

    if (!reasons.length && fallbackUsed) {
      if (candidate.restaurantQualityScore >= 0.55) {
        reasons.push('Có đánh giá tốt');
      }
      if (candidate.popularityScore >= 0.55) {
        reasons.push('Được nhiều khách hàng yêu thích');
      }
    }

    if (!reasons.length) {
      reasons.push('Là món đang được quan tâm trên BookEat');
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
