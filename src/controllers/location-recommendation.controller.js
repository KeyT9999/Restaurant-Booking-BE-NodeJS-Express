'use strict';

const { createLocationRecommendationService } = require('../services/location-recommendation.service');

const createLocationRecommendationController = (dependencies = {}) => {
  const recommendationService = dependencies.recommendationService 
    || createLocationRecommendationService(dependencies);

  const getRecommendations = async (req, res) => {
    try {
      const { latitude, longitude, category, maxDistance, minimumRating, limit } = req.query;

      if (!latitude || latitude.trim() === '') {
        return res.status(400).json({
          success: false,
          message: 'Vĩ độ (latitude) là bắt buộc.',
        });
      }

      if (!longitude || longitude.trim() === '') {
        return res.status(400).json({
          success: false,
          message: 'Kinh độ (longitude) là bắt buộc.',
        });
      }

      const parsedLatitude = parseFloat(latitude);
      const parsedLongitude = parseFloat(longitude);

      if (isNaN(parsedLatitude)) {
        return res.status(400).json({
          success: false,
          message: 'Vĩ độ phải là một số hợp lệ.',
        });
      }

      if (isNaN(parsedLongitude)) {
        return res.status(400).json({
          success: false,
          message: 'Kinh độ phải là một số hợp lệ.',
        });
      }

      const result = await recommendationService.getRecommendations({
        latitude: parsedLatitude,
        longitude: parsedLongitude,
        category: category || null,
        maxDistance: maxDistance ? parseInt(maxDistance, 10) : undefined,
        minimumRating: minimumRating ? parseFloat(minimumRating) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
      });

      return res.status(200).json(result);
    } catch (error) {
      console.error('Location recommendation error:', error);

      if (error.message.includes('không hợp lệ') || error.message.includes('not configured')) {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Không thể lấy đề xuất nhà hàng. Vui lòng thử lại sau.',
      });
    }
  };

  return {
    getRecommendations,
  };
};

const defaultController = createLocationRecommendationController();

module.exports = {
  ...defaultController,
  createLocationRecommendationController,
};
