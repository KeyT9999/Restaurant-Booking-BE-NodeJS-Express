'use strict';

const express = require('express');
const { createAdminRecommendationController } = require('../controllers/admin.recommendation.controller');

const createAdminRecommendationRouter = (dependencies = {}) => {
  const controller = dependencies.controller || createAdminRecommendationController(dependencies);
  const router = express.Router();

  router.get('/status', controller.getStatus);
  router.get('/runs', controller.getRuns);
  router.get('/evaluation', controller.getEvaluation);
  router.post('/evaluate', controller.runEvaluation);
  router.post('/rebuild-dry-run', controller.rebuildDryRun);

  return router;
};

const defaultRouter = createAdminRecommendationRouter();

module.exports = defaultRouter;
module.exports.createAdminRecommendationRouter = createAdminRecommendationRouter;
