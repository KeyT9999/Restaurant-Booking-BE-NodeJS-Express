'use strict';

const Restaurant = require('../models/Restaurant');

const DEFAULT_MAX_DISTANCE_M = 5000; // 5km default
const DEFAULT_MIN_RATING = 0;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;

const parsePositiveInt = (value, fallback = DEFAULT_LIMIT, max = MAX_LIMIT) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
};

const parseFloat = (value, fallback = null) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const validateLatitude = (lat) => {
  const num = parseFloat(lat, null);
  return num !== null && num >= -90 && num <= 90;
};

const validateLongitude = (lng) => {
  const num = parseFloat(lng, null);
  return num !== null && num >= -180 && num <= 180;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const roundNumber = (num, decimals = 2) => {
  const factor = Math.pow(10, decimals);
  return Math.round(num * factor) / factor;
};

const formatDistance = (meters) => {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
};

// Normalize cuisine type to match both Vietnamese and English variations
const normalizeCuisineMatch = (category) => {
  // Map frontend value to possible DB values
  const categoryMap = {
    'Việt Nam': ['Việt Nam', 'Vietnamese', 'Vietnam'],
    'Nhật Bản': ['Nhật Bản', 'Japanese'],
    'Hàn Quốc': ['Hàn Quốc', 'Korean'],
    'Trung Quốc': ['Trung Quốc', 'Chinese'],
    'Thái Lan': ['Thái Lan', 'Thai'],
    'Ý': ['Ý', 'Italian'],
    'Pháp': ['Pháp', 'French'],
    'Mỹ': ['Mỹ', 'American'],
    'Hải sản': ['Hải sản', 'Seafood'],
    'Bít tết': ['Bít tết', 'Steak', 'Steakhouse'],
    'Café': ['Café', 'Coffee', 'Cafe'],
  };
  
  // Find matching variations
  const variations = categoryMap[category] || [category];
  
  // Create regex that matches any variation
  const escapedVariations = variations.map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return { $regex: escapedVariations.join('|'), $options: 'i' };
};

const generateGoogleMapsLink = (latitude, longitude, name) => {
  if (!latitude || !longitude) return null;
  // Use Google Maps search URL with coordinates
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name || 'restaurant')}&query_place_id=ChIJ${latitude},${longitude}`;
};

const generateRecommendationReason = (restaurant) => {
  const reasons = [];

  if (restaurant.distance <= 500) {
    reasons.push(`Rất gần bạn, chỉ cách ${formatDistance(restaurant.distance)}`);
  } else if (restaurant.distance <= 1000) {
    reasons.push(`Khá gần, chỉ cách ${formatDistance(restaurant.distance)}`);
  } else if (restaurant.distance <= 2000) {
    reasons.push(`Cách bạn ${formatDistance(restaurant.distance)}`);
  }

  const rating = restaurant.stats?.averageRating || 0;
  if (rating >= 4.5) {
    reasons.push('Được đánh giá rất cao');
  } else if (rating >= 4.0) {
    reasons.push('Được đánh giá tốt');
  }

  const reviewCount = restaurant.stats?.totalReviews || 0;
  if (reviewCount >= 200) {
    reasons.push('Rất phổ biến với nhiều đánh giá');
  } else if (reviewCount >= 50) {
    reasons.push('Khá phổ biến');
  }

  if (restaurant.cuisineTypes?.length > 0) {
    reasons.push(`${restaurant.cuisineTypes[0]}`);
  }

  if (reasons.length === 0) {
    reasons.push('Phù hợp với sở thích của bạn');
  }

  return reasons.slice(0, 3).join('. ');
};

const getPriceRangeText = (priceRange) => {
  const priceMap = {
    'budget': 'Bình dân',
    'moderate': 'Trung cấp',
    'expensive': 'Cao cấp',
    'luxury': 'Sang trọng'
  };
  return priceMap[priceRange] || null;
};

const createLocationRecommendationService = (dependencies = {}) => {

  const getRecommendations = async ({
    latitude,
    longitude,
    category = null,
    maxDistance = DEFAULT_MAX_DISTANCE_M,
    minimumRating = DEFAULT_MIN_RATING,
    limit = DEFAULT_LIMIT,
  }) => {
    console.log('[LocationRecommendation] Starting with:', { latitude, longitude, category, maxDistance });
    
    if (!validateLatitude(latitude)) {
      throw new Error('Vĩ độ không hợp lệ. Vui lòng cung cấp giá trị từ -90 đến 90.');
    }

    if (!validateLongitude(longitude)) {
      throw new Error('Kinh độ không hợp lệ. Vui lòng cung cấp giá trị từ -180 đến 180.');
    }

    latitude = parseFloat(latitude);
    longitude = parseFloat(longitude);
    limit = parsePositiveInt(limit);
    maxDistance = parsePositiveInt(maxDistance, DEFAULT_MAX_DISTANCE_M, 50000);

    // Build match conditions
    const matchConditions = {
      approvalStatus: 'approved',
      active: true,
      deletedAt: null,
      'location.coordinates': { $exists: true, $ne: null }, // Must have GeoJSON location
    };

    if (category) {
      matchConditions.cuisineTypes = normalizeCuisineMatch(category);
    }

    if (minimumRating > 0) {
      matchConditions['stats.averageRating'] = { $gte: minimumRating };
    }

    // Use MongoDB $geoNear aggregation for efficient geospatial query
    const pipeline = [
      {
        $geoNear: {
          near: {
            type: 'Point',
            coordinates: [longitude, latitude], // GeoJSON uses [lng, lat]
          },
          distanceField: 'distance', // This will be in meters
          maxDistance: maxDistance,
          spherical: true, // Use spherical geometry (required for 2dsphere)
          query: matchConditions,
        },
      },
      {
        $sort: { distance: 1 }, // Sort by distance (nearest first)
      },
      {
        $limit: limit,
      },
      {
        $project: {
          _id: 1,
          name: 1,
          address: 1,
          'coordinates.latitude': 1,
          'coordinates.longitude': 1,
          cuisineTypes: 1,
          priceRange: 1,
          averagePrice: 1,
          stats: 1,
          images: 1,
          featured: 1,
          distance: 1,
        },
      },
    ];

    console.log('[LocationRecommendation] Running geoNear aggregation...');
    const restaurants = await Restaurant.aggregate(pipeline);

    console.log('[LocationRecommendation] Found restaurants:', restaurants.length);

    if (restaurants.length === 0) {
      // Fallback: try without geospatial filter if no results
      console.log('[LocationRecommendation] No results with geoNear, trying fallback...');
      
      const fallbackQuery = {
        approvalStatus: 'approved',
        active: true,
        deletedAt: null,
      };
      
      if (category) {
        fallbackQuery.cuisineTypes = normalizeCuisineMatch(category);
      }
      
      if (minimumRating > 0) {
        fallbackQuery['stats.averageRating'] = { $gte: minimumRating };
      }

      const fallbackRestaurants = await Restaurant.find(fallbackQuery)
        .select('name address coordinates cuisineTypes priceRange averagePrice stats images featured')
        .limit(limit)
        .lean();

      console.log('[LocationRecommendation] Fallback found:', fallbackRestaurants.length);

      const items = fallbackRestaurants.map(restaurant => ({
        restaurantId: restaurant._id.toString(),
        name: restaurant.name,
        address: `${restaurant.address?.street || ''}, ${restaurant.address?.ward || ''}, ${restaurant.address?.district || ''}`,
        latitude: restaurant.coordinates?.latitude || null,
        longitude: restaurant.coordinates?.longitude || null,
        distance: null,
        distanceText: null,
        rating: roundNumber(restaurant.stats?.averageRating || 0, 1),
        reviewCount: restaurant.stats?.totalReviews || 0,
        category: restaurant.cuisineTypes?.[0] || null,
        priceRange: restaurant.priceRange,
        priceRangeText: getPriceRangeText(restaurant.priceRange),
        averagePrice: restaurant.averagePrice,
        isOpen: true,
        image: restaurant.images?.[0]?.url || null,
        score: 0.5,
        reason: 'Nhà hàng nổi bật trên BookEat',
        googleMapsLink: generateGoogleMapsLink(restaurant.coordinates?.latitude, restaurant.coordinates?.longitude, restaurant.name),
      }));

      return {
        success: true,
        data: {
          type: 'location_recommendations',
          version: 2,
          algorithm: 'location-based-geospatial',
          items,
          generatedAt: new Date().toISOString(),
        },
      };
    }

    // Calculate scores based on distance and other factors
    const maxDistanceForScore = Math.max(...restaurants.map(r => r.distance || 1), 1);
    
    const items = restaurants.map(restaurant => {
      const distanceScore = clamp(1 - (restaurant.distance / maxDistanceForScore), 0, 1);
      const ratingScore = clamp((restaurant.stats?.averageRating || 0) / 5, 0, 1);
      const reviewScore = clamp(Math.log((restaurant.stats?.totalReviews || 0) + 1) / 10, 0, 1);
      
      const score = (distanceScore * 0.5) + (ratingScore * 0.3) + (reviewScore * 0.2);

      return {
        restaurantId: restaurant._id.toString(),
        name: restaurant.name,
        address: `${restaurant.address?.street || ''}, ${restaurant.address?.ward || ''}, ${restaurant.address?.district || ''}`,
        latitude: restaurant.coordinates?.latitude || null,
        longitude: restaurant.coordinates?.longitude || null,
        distance: Math.round(restaurant.distance),
        distanceText: formatDistance(restaurant.distance),
        rating: roundNumber(restaurant.stats?.averageRating || 0, 1),
        reviewCount: restaurant.stats?.totalReviews || 0,
        category: restaurant.cuisineTypes?.[0] || null,
        priceRange: restaurant.priceRange,
        priceRangeText: getPriceRangeText(restaurant.priceRange),
        averagePrice: restaurant.averagePrice,
        isOpen: true,
        image: restaurant.images?.[0]?.url || null,
        score: roundNumber(score, 4),
        reason: generateRecommendationReason(restaurant),
        googleMapsLink: generateGoogleMapsLink(restaurant.coordinates?.latitude, restaurant.coordinates?.longitude, restaurant.name),
      };
    });

    return {
      success: true,
      data: {
        type: 'location_recommendations',
        version: 2,
        algorithm: 'location-based-geospatial',
        items,
        generatedAt: new Date().toISOString(),
      },
    };
  };

  return {
    getRecommendations,
    validateLatitude,
    validateLongitude,
  };
};

module.exports = {
  createLocationRecommendationService,
  DEFAULT_MAX_DISTANCE_M,
  DEFAULT_MIN_RATING,
  DEFAULT_LIMIT,
  validateLatitude,
  validateLongitude,
  formatDistance,
  generateRecommendationReason,
};
