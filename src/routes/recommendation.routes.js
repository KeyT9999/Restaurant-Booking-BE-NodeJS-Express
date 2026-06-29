'use strict';

const express = require('express');
const recommendationController = require('../controllers/recommendation.controller');
const { protectOptional } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(protectOptional);

router.get('/restaurants', recommendationController.getRestaurantRecommendations);
router.get('/menu-items', recommendationController.getMenuItemRecommendations);
router.get('/home', recommendationController.getHomeRecommendations);

module.exports = router;
