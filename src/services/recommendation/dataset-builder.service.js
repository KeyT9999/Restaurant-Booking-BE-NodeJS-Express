'use strict';

const RecommendationResultCache = require('../../models/RecommendationResultCache');
const RecommendationRun = require('../../models/RecommendationRun');
const {
  ALGORITHM_VERSION,
  DATASET_VERSION,
  PROFILE_VERSION,
} = require('./recommendation-constants');
const { createInteractionExtractorService } = require('./interaction-extractor.service');
const { createProfileBuilderService } = require('./profile-builder.service');

const createDatasetBuilderService = (dependencies = {}) => {
  const interactionExtractor = dependencies.interactionExtractor
    || createInteractionExtractorService(dependencies);
  const profileBuilder = dependencies.profileBuilder
    || createProfileBuilderService(dependencies);

  const models = {
    RecommendationResultCache,
    RecommendationRun,
    ...dependencies,
  };

  const invalidateAllCaches = async () => {
    if (!models.RecommendationResultCache) {
      return { deletedCount: 0 };
    }
    return models.RecommendationResultCache.deleteMany({});
  };

  const invalidateUsers = async (userIds = []) => interactionExtractor.invalidateUsers(userIds);

  const invalidateItems = async ({ itemIds = [], restaurantIds = [] } = {}) => (
    interactionExtractor.invalidateItems({ itemIds, restaurantIds })
  );

  const rebuildFullDataset = async (options = {}) => {
    const dryRun = options.dryRun === true;
    const referenceDate = options.referenceDate ? new Date(options.referenceDate) : new Date();
    const startedAt = new Date();

    let runDocument = null;
    if (!dryRun && models.RecommendationRun && typeof models.RecommendationRun.create === 'function') {
      runDocument = await models.RecommendationRun.create({
        runType: 'full',
        status: 'running',
        startedAt,
        datasetVersion: DATASET_VERSION,
        profileVersion: PROFILE_VERSION,
        algorithmVersion: ALGORITHM_VERSION,
        metadata: {
          initiatedBy: options.initiatedBy || 'manual',
        },
      });
    }

    try {
      const interactionResult = await interactionExtractor.buildInteractionDocuments({
        referenceDate,
      });
      const userProfileResult = await profileBuilder.buildUserProfileDocuments({
        interactions: interactionResult.interactions,
        referenceDate,
      });
      const itemProfileResult = await profileBuilder.buildItemProfileDocuments({
        interactions: interactionResult.interactions,
        referenceDate,
      });

      let interactionPersistence = { insertedCount: interactionResult.interactions.length, deletedCount: 0 };
      let userProfilePersistence = { insertedCount: userProfileResult.profiles.length, deletedCount: 0 };
      let itemProfilePersistence = { insertedCount: itemProfileResult.profiles.length, deletedCount: 0 };
      let cacheInvalidation = { deletedCount: 0 };

      if (!dryRun) {
        interactionPersistence = await interactionExtractor.replaceInteractions(interactionResult.interactions);
        userProfilePersistence = await profileBuilder.replaceUserProfiles(userProfileResult.profiles);
        itemProfilePersistence = await profileBuilder.replaceItemProfiles(itemProfileResult.profiles);

        if (options.invalidateCache !== false) {
          cacheInvalidation = await invalidateAllCaches();
        }
      }

      const completedAt = new Date();
      const summary = {
        dryRun,
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        datasetVersion: DATASET_VERSION,
        profileVersion: PROFILE_VERSION,
        algorithmVersion: ALGORITHM_VERSION,
        interactionsBuilt: interactionPersistence.insertedCount,
        userProfilesBuilt: userProfilePersistence.insertedCount,
        itemProfilesBuilt: itemProfilePersistence.insertedCount,
        cacheInvalidated: cacheInvalidation?.deletedCount || 0,
        interactionStats: interactionResult.stats,
        userProfileStats: userProfileResult.stats,
        itemProfileStats: itemProfileResult.stats,
      };

      if (!dryRun && runDocument && typeof models.RecommendationRun.findByIdAndUpdate === 'function') {
        await models.RecommendationRun.findByIdAndUpdate(runDocument._id, {
          status: 'success',
          completedAt,
          interactionsBuilt: summary.interactionsBuilt,
          userProfilesBuilt: summary.userProfilesBuilt,
          itemProfilesBuilt: summary.itemProfilesBuilt,
          cacheInvalidated: summary.cacheInvalidated,
          metricsSnapshot: {
            interactionStats: interactionResult.stats,
            userProfileStats: userProfileResult.stats,
            itemProfileStats: itemProfileResult.stats,
            durationMs: summary.durationMs,
          },
        });
      }

      return summary;
    } catch (error) {
      if (!dryRun && runDocument && typeof models.RecommendationRun.findByIdAndUpdate === 'function') {
        await models.RecommendationRun.findByIdAndUpdate(runDocument._id, {
          status: 'failed',
          completedAt: new Date(),
          errorSummary: {
            message: error.message,
            stack: error.stack,
          },
        });
      }
      throw error;
    }
  };

  return {
    invalidateAllCaches,
    invalidateItems,
    invalidateUsers,
    rebuildFullDataset,
  };
};

module.exports = {
  createDatasetBuilderService,
};
