'use strict';

const express = require('express');
const foodRecommendationController = require('../controllers/food-recommendation.controller');
const { createOptionalAiUserMiddleware, createAiRateLimiter } = require('./ai.routes');

const router = express.Router();

const optionalUser = createOptionalAiUserMiddleware();
const rateLimiter = createAiRateLimiter();

router.post('/food-recommendation', optionalUser, rateLimiter, foodRecommendationController.getFoodRecommendations);

module.exports = router;
