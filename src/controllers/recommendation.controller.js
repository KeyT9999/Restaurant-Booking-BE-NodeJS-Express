'use strict';

const { createHybridRecommenderService } = require('../services/recommendation/hybrid-recommender.service');

const INTERNAL_RESPONSE_FIELDS = new Set([
  'componentScores',
  'matchDetails',
  'rawHistory',
  'rawInteractions',
  'rawProfile',
  'scoreBreakdown',
]);

const sanitizePublicRecommendationPayload = (value) => {
  if (Array.isArray(value)) {
    return value.map(sanitizePublicRecommendationPayload);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !INTERNAL_RESPONSE_FIELDS.has(key))
      .map(([key, nestedValue]) => [key, sanitizePublicRecommendationPayload(nestedValue)])
  );
};

const createRecommendationController = (dependencies = {}) => {
  const recommendationService = dependencies.recommendationService || createHybridRecommenderService(dependencies);

  const getActorFromRequest = (req) => ({
    _id: req.user?._id || null,
    role: req.user?.role || 'guest',
  });

  const getRestaurantRecommendations = async (req, res) => {
    try {
      const payload = await recommendationService.getRestaurantRecommendations({
        actor: getActorFromRequest(req),
        query: req.query,
      });
      return res.status(200).json(sanitizePublicRecommendationPayload(payload));
    } catch (error) {
      console.error('Recommendation restaurants error:', error);
      return res.status(500).json({
        success: false,
        message: 'Khong the tai goi y nha hang luc nay.',
      });
    }
  };

  const getMenuItemRecommendations = async (req, res) => {
    try {
      const payload = await recommendationService.getMenuItemRecommendations({
        actor: getActorFromRequest(req),
        query: req.query,
      });
      return res.status(200).json(sanitizePublicRecommendationPayload(payload));
    } catch (error) {
      console.error('Recommendation menu items error:', error);
      return res.status(500).json({
        success: false,
        message: 'Khong the tai goi y mon an luc nay.',
      });
    }
  };

  const getHomeRecommendations = async (req, res) => {
    try {
      const payload = await recommendationService.getHomeRecommendations({
        actor: getActorFromRequest(req),
        query: req.query,
      });
      return res.status(200).json(sanitizePublicRecommendationPayload(payload));
    } catch (error) {
      console.error('Recommendation home error:', error);
      return res.status(500).json({
        success: false,
        message: 'Khong the tai goi y trang chu luc nay.',
      });
    }
  };

  return {
    getHomeRecommendations,
    getMenuItemRecommendations,
    getRestaurantRecommendations,
  };
};

const defaultController = createRecommendationController();

module.exports = {
  ...defaultController,
  createRecommendationController,
  sanitizePublicRecommendationPayload,
};
