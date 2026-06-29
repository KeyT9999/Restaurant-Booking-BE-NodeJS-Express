'use strict';

const { createDatasetBuilderService } = require('../services/recommendation/dataset-builder.service');
const { createRecommendationAdminService } = require('../services/recommendation/recommendation-admin.service');
const { createRecommendationEvaluationService } = require('../services/recommendation/recommendation-evaluation.service');

const handleError = (res, error) => {
  const statusCode = error.statusCode || 500;
  if (statusCode >= 500) {
    console.error('[AdminRecommendation]', error);
  }

  return res.status(statusCode).json({
    success: false,
    message: error.message || 'Khong the tai du lieu recommendation admin.',
    ...(error.code ? { code: error.code } : {}),
  });
};

const createAdminRecommendationController = (dependencies = {}) => {
  const adminService = dependencies.adminService || createRecommendationAdminService(dependencies);
  const evaluationService = dependencies.evaluationService || createRecommendationEvaluationService(dependencies);
  const datasetBuilderService = dependencies.datasetBuilderService || createDatasetBuilderService(dependencies);

  const getStatus = async (req, res) => {
    try {
      const data = await adminService.getRecommendationStatus();
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return handleError(res, error);
    }
  };

  const getRuns = async (req, res) => {
    try {
      const data = await adminService.getRecommendationRuns(req.query);
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return handleError(res, error);
    }
  };

  const getEvaluation = async (req, res) => {
    try {
      const data = await evaluationService.getLatestEvaluation();
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return handleError(res, error);
    }
  };

  const runEvaluation = async (req, res) => {
    try {
      const data = await evaluationService.runOfflineEvaluation({
        sampleLimit: req.body?.sampleLimit,
        k: req.body?.k,
        timeoutMs: req.body?.timeoutMs,
        initiatedBy: `admin:${req.user?._id || 'unknown'}`,
      });
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return handleError(res, error);
    }
  };

  const rebuildDryRun = async (req, res) => {
    try {
      const data = await datasetBuilderService.rebuildFullDataset({
        dryRun: true,
        invalidateCache: false,
        referenceDate: req.body?.referenceDate,
        initiatedBy: `admin:${req.user?._id || 'unknown'}:dry_run`,
      });
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return handleError(res, error);
    }
  };

  return {
    getEvaluation,
    getRuns,
    getStatus,
    rebuildDryRun,
    runEvaluation,
  };
};

const defaultController = createAdminRecommendationController();

module.exports = {
  ...defaultController,
  createAdminRecommendationController,
};
