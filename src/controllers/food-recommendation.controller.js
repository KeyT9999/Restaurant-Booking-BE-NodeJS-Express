'use strict';

const foodRecommendationService = require('../services/food-recommendation.service');
const { randomUUID } = require('node:crypto');

const sendError = (res, status, code, message, requestId, details) => res.status(status).json({
  success: false,
  code,
  message,
  ...(details ? { details } : {}),
  requestId,
});

const getFoodRecommendations = async (req, res) => {
  const requestId = req.aiRequestId || randomUUID();
  const { question, context } = req.body;

  if (!question || typeof question !== 'string' || !question.trim()) {
    return sendError(
      res,
      400,
      'INVALID_REQUEST',
      'Câu hỏi không được để trống.',
      requestId
    );
  }

  if (question.length > 500) {
    return sendError(
      res,
      400,
      'INVALID_REQUEST',
      'Câu hỏi không được vượt quá 500 ký tự.',
      requestId
    );
  }

  try {
    const result = await foodRecommendationService.getRecommendations({
      question: question.trim(),
      context: context || {},
      signal: req.signal
    });

    return res.status(200).json({
      success: true,
      data: result,
      requestId
    });
  } catch (error) {
    console.error(`[FoodRecommendationController] requestId=${requestId} error:`, error);
    return sendError(
      res,
      500,
      'INTERNAL_SERVER_ERROR',
      'Đã xảy ra lỗi khi xử lý đề xuất món ăn. Vui lòng thử lại sau.',
      requestId
    );
  }
};

module.exports = {
  getFoodRecommendations
};
