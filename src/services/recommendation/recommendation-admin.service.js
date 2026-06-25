'use strict';

const RecommendationInteraction = require('../../models/RecommendationInteraction');
const RecommendationItemProfile = require('../../models/RecommendationItemProfile');
const RecommendationResultCache = require('../../models/RecommendationResultCache');
const RecommendationRun = require('../../models/RecommendationRun');
const RecommendationUserProfile = require('../../models/RecommendationUserProfile');
const {
  ALGORITHM_VERSION,
  HYBRID_RECOMMENDER_VERSION,
  ITEM_TYPES,
} = require('./recommendation-constants');
const { toIdString } = require('./recommendation-utils');

class RecommendationAdminError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'RecommendationAdminError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const DATASET_RUN_TYPES = ['full', 'incremental'];
const RUN_STATUSES = ['running', 'success', 'failed'];

const parsePositiveInteger = (value, fallback, maximum = 20) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
};

const resolveQuery = async (query, lean = true) => {
  if (lean && typeof query?.lean === 'function') return query.lean();
  return query;
};

const countDocuments = async (Model, filter = {}) => {
  if (!Model || typeof Model.countDocuments !== 'function') return 0;
  return Number(await Model.countDocuments(filter)) || 0;
};

const durationMsBetween = (startedAt, finishedAt) => {
  const start = startedAt ? new Date(startedAt).getTime() : null;
  const end = finishedAt ? new Date(finishedAt).getTime() : null;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
};

const uniqueStrings = (values = []) => [...new Set(values.filter((value) => typeof value === 'string' && value.trim()))];

const appendWarning = (warnings, warningCodes, code, message) => {
  warnings.push(message);
  warningCodes.push(code);
};

const mapRunType = (runType) => {
  if (runType === 'full') return 'full_rebuild';
  if (runType === 'incremental') return 'incremental_rebuild';
  if (runType === 'evaluation') return 'evaluation';
  return runType || 'unknown';
};

const buildRunWarnings = (run) => {
  if (!run) return [];

  const warnings = [];
  if (run.status === 'failed' && run.errorSummary?.message) {
    warnings.push(`Run that bai: ${run.errorSummary.message}`);
  }

  if (Array.isArray(run.metricsSnapshot?.warnings)) {
    warnings.push(...run.metricsSnapshot.warnings);
  }

  if (Array.isArray(run.metadata?.warnings)) {
    warnings.push(...run.metadata.warnings);
  }

  if (run.runType === 'evaluation' && run.metricsSnapshot?.evaluation?.warning && run.metricsSnapshot?.evaluation?.message) {
    warnings.push(run.metricsSnapshot.evaluation.message);
  }

  return uniqueStrings(warnings);
};

const createRecommendationAdminService = (dependencies = {}) => {
  const models = {
    RecommendationInteraction,
    RecommendationItemProfile,
    RecommendationResultCache,
    RecommendationRun,
    RecommendationUserProfile,
    ...dependencies,
  };
  const now = dependencies.now || (() => new Date());

  const findLatestRun = async (filter = {}) => {
    if (!models.RecommendationRun || typeof models.RecommendationRun.findOne !== 'function') return null;
    return resolveQuery(
      models.RecommendationRun.findOne(filter).sort({ startedAt: -1 }),
      true
    );
  };

  const findRuns = async (filter = {}, limit = 10) => {
    if (!models.RecommendationRun || typeof models.RecommendationRun.find !== 'function') return [];
    return resolveQuery(
      models.RecommendationRun.find(filter).sort({ startedAt: -1 }).limit(limit),
      true
    );
  };

  const getRecommendationStatus = async () => {
    const currentDate = now();
    const [
      interactions,
      userProfiles,
      restaurantItemProfiles,
      menuItemProfiles,
      totalEntries,
      activeEntries,
      expiredEntries,
      staleAlgorithmEntries,
      latestDatasetRun,
      latestSuccessfulDatasetRun,
    ] = await Promise.all([
      countDocuments(models.RecommendationInteraction),
      countDocuments(models.RecommendationUserProfile),
      countDocuments(models.RecommendationItemProfile, { itemType: ITEM_TYPES.RESTAURANT }),
      countDocuments(models.RecommendationItemProfile, { itemType: ITEM_TYPES.MENU_ITEM }),
      countDocuments(models.RecommendationResultCache),
      countDocuments(models.RecommendationResultCache, { expiresAt: { $gt: currentDate } }),
      countDocuments(models.RecommendationResultCache, { expiresAt: { $lte: currentDate } }),
      countDocuments(models.RecommendationResultCache, {
        expiresAt: { $gt: currentDate },
        algorithmVersion: { $ne: HYBRID_RECOMMENDER_VERSION },
      }),
      findLatestRun({ runType: { $in: DATASET_RUN_TYPES } }),
      findLatestRun({ runType: { $in: DATASET_RUN_TYPES }, status: 'success' }),
    ]);

    const healthWarnings = [];
    const healthWarningCodes = [];

    if (!latestSuccessfulDatasetRun) {
      appendWarning(
        healthWarnings,
        healthWarningCodes,
        'NO_SUCCESSFUL_DATASET_RUN',
        'Chua co rebuild recommendation thanh cong.'
      );
    }

    if (latestDatasetRun?.status === 'failed') {
      appendWarning(
        healthWarnings,
        healthWarningCodes,
        'LATEST_DATASET_RUN_FAILED',
        'Lan rebuild recommendation gan nhat dang o trang thai that bai.'
      );
    }

    if (latestSuccessfulDatasetRun?.algorithmVersion && latestSuccessfulDatasetRun.algorithmVersion !== ALGORITHM_VERSION) {
      appendWarning(
        healthWarnings,
        healthWarningCodes,
        'DATASET_VERSION_MISMATCH',
        'Phien ban dataset builder cua lan rebuild gan nhat khong khop voi phien ban hien tai.'
      );
    }

    if (interactions === 0) {
      appendWarning(
        healthWarnings,
        healthWarningCodes,
        'NO_INTERACTIONS_PERSISTED',
        'Chua co interaction recommendation de phuc vu goi y.'
      );
    }

    if (userProfiles === 0) {
      appendWarning(
        healthWarnings,
        healthWarningCodes,
        'NO_USER_PROFILES_PERSISTED',
        'Chua co ho so nguoi dung recommendation.'
      );
    }

    if ((restaurantItemProfiles + menuItemProfiles) === 0) {
      appendWarning(
        healthWarnings,
        healthWarningCodes,
        'NO_ITEM_PROFILES_PERSISTED',
        'Chua co ho so item recommendation.'
      );
    }

    if (totalEntries > 0 && expiredEntries > Math.max(10, Math.floor(totalEntries * 0.5))) {
      appendWarning(
        healthWarnings,
        healthWarningCodes,
        'CACHE_EXPIRED_RATIO_HIGH',
        'Cache recommendation dang co ty le ban ghi het han cao.'
      );
    }

    if (staleAlgorithmEntries > 0) {
      appendWarning(
        healthWarnings,
        healthWarningCodes,
        'STALE_ALGORITHM_CACHE_PRESENT',
        'Phat hien cache recommendation dung phien ban thuat toan cu.'
      );
    }

    let healthStatus = 'healthy';
    if (latestDatasetRun?.status === 'failed' || interactions === 0 || userProfiles === 0) {
      healthStatus = 'critical';
    } else if (healthWarnings.length) {
      healthStatus = 'warning';
    }

    return {
      algorithmVersion: HYBRID_RECOMMENDER_VERSION,
      dataset: {
        interactions,
        userProfiles,
        restaurantItemProfiles,
        menuItemProfiles,
        latestRunStatus: latestDatasetRun?.status || null,
        latestRunAt: latestDatasetRun?.completedAt || latestDatasetRun?.startedAt || null,
        latestRunStats: latestDatasetRun
          ? {
            interactionsBuilt: Number(latestDatasetRun.interactionsBuilt || 0),
            userProfilesBuilt: Number(latestDatasetRun.userProfilesBuilt || 0),
            itemProfilesGenerated: Number(latestDatasetRun.itemProfilesBuilt || 0),
            cacheInvalidated: Number(latestDatasetRun.cacheInvalidated || 0),
          }
          : null,
      },
      cache: {
        totalEntries,
        activeEntries,
        expiredEntries,
        staleAlgorithmEntries,
      },
      health: {
        status: healthStatus,
        warnings: healthWarnings,
        warningCodes: uniqueStrings(healthWarningCodes),
      },
    };
  };

  const getRecommendationRuns = async (rawQuery = {}) => {
    const limit = parsePositiveInteger(rawQuery.limit, 10, 20);
    const filter = {};

    if (DATASET_RUN_TYPES.concat('evaluation').includes(rawQuery.runType)) {
      filter.runType = rawQuery.runType;
    }
    if (RUN_STATUSES.includes(rawQuery.status)) {
      filter.status = rawQuery.status;
    }

    const runs = await findRuns(filter, limit);

    return {
      items: runs.map((run) => ({
        id: toIdString(run._id),
        runType: mapRunType(run.runType),
        status: run.status,
        startedAt: run.startedAt || null,
        finishedAt: run.completedAt || null,
        durationMs: durationMsBetween(run.startedAt, run.completedAt),
        algorithmVersion: run.algorithmVersion || null,
        stats: {
          interactionsCreated: Number(run.interactionsBuilt || 0),
          userProfilesGenerated: Number(run.userProfilesBuilt || 0),
          itemProfilesGenerated: Number(run.itemProfilesBuilt || 0),
          cacheInvalidated: Number(run.cacheInvalidated || 0),
        },
        summary: run.runType === 'evaluation' && run.metricsSnapshot?.evaluation
          ? {
            hitRateAtK: run.metricsSnapshot.evaluation.hitRateAtK ?? null,
            coverage: run.metricsSnapshot.evaluation.coverage ?? null,
            evaluatedUsers: run.metricsSnapshot.evaluation.evaluatedUsers ?? null,
          }
          : null,
        warnings: buildRunWarnings(run),
      })),
    };
  };

  return {
    getRecommendationRuns,
    getRecommendationStatus,
  };
};

const defaultService = createRecommendationAdminService();

module.exports = {
  ...defaultService,
  RecommendationAdminError,
  createRecommendationAdminService,
};
