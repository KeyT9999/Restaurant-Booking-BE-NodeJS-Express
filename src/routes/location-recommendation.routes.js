'use strict';

const express = require('express');
const locationRecommendationController = require('../controllers/location-recommendation.controller');

const router = express.Router();

router.get('/recommend', locationRecommendationController.getRecommendations);

module.exports = router;
