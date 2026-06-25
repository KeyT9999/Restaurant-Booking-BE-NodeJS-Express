'use strict';

const RecommendationInteraction = require('../../models/RecommendationInteraction');
const RecommendationItemProfile = require('../../models/RecommendationItemProfile');
const RecommendationRun = require('../../models/RecommendationRun');
const {
  COLLABORATIVE_POSITIVE_EVENT_TYPES,
  HYBRID_RECOMMENDER_VERSION,
  ITEM_TYPES,
} = require('./recommendation-constants');
const { createHybridRecommenderService } = require('./hybrid-recommender.service');
const {
  clamp,
  roundNumber,
  toIdString,
} = require('./recommendation-utils');

class RecommendationEvaluationError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'RecommendationEvaluationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const DEFAULT_SAMPLE_LIMIT = 100;
const MAX_SAMPLE_LIMIT = 200;
const DEFAULT_K = 10;
const MAX_K = 20;
const DEFAULT_TIMEOUT_MS = 12000;
const MAX_TIMEOUT_MS = 20000;

const EVALUATION_LIMITATIONS = Object.freeze([
  'Holdout mới nhất hiện chưa được loại khỏi profile khi chấm điểm, nên hit rate có thể lạc quan hơn thực tế.',
]);

const RESTAURANT_POSITIVE_EVENT_TYPES = COLLABORATIVE_POSITIVE_EVENT_TYPES.filter(
  (eventType) => eventType !== 'menu_preordered'
);

const parsePositiveInteger = (value, fallback, maximum) => {
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

const buildDurationMs = (startedAt, completedAt) => {
  const start = startedAt ? new Date(startedAt).getTime() : null;
  const end = completedAt ? new Date(completedAt).getTime() : null;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return end - start;
};

const buildEligibleUserSamples = (interactions = []) => {
  const grouped = new Map();

  const sortedInteractions = [...interactions].sort((left, right) => {
    const leftUser = toIdString(left.userId);
    const rightUser = toIdString(right.userId);
    const userCompare = leftUser.localeCompare(rightUser);
    if (userCompare !== 0) return userCompare;

    const leftOccurredAt = new Date(left.occurredAt || 0).getTime();
    const rightOccurredAt = new Date(right.occurredAt || 0).getTime();
    return rightOccurredAt - leftOccurredAt;
  });

  for (const interaction of sortedInteractions) {
    const userId = toIdString(interaction.userId);
    const holdoutRestaurantId = toIdString(interaction.restaurantId || interaction.itemId);
    if (!userId || !holdoutRestaurantId) continue;

    if (!grouped.has(userId)) {
      grouped.set(userId, []);
    }
    grouped.get(userId).push(interaction);
  }

  return [...grouped.entries()]
    .map(([userId, userInteractions]) => {
      if (userInteractions.length < 2) return null;
      return {
        userId,
        holdoutRestaurantId: toIdString(userInteractions[0].restaurantId || userInteractions[0].itemId),
        interactionCount: userInteractions.length,
        latestOccurredAt: userInteractions[0].occurredAt || null,
      };
    })
    .filter(Boolean)
    .sort((left, right) => (
      new Date(right.latestOccurredAt || 0).getTime() - new Date(left.latestOccurredAt || 0).getTime()
    ));
};

const createUnavailableEvaluation = ({
  sampleLimit,
  k,
  generatedAt,
  message,
  warning = 'INSUFFICIENT_EVALUATION_DATA',
  skippedUsers = 0,
  warnings = [],
}) => ({
  available: false,
  warning,
  message,
  hitRateAtK: null,
  coverage: null,
  evaluatedUsers: 0,
  skippedUsers,
  averageRecommendations: 0,
  fallbackRate: 0,
  generatedAt,
  algorithmVersion: HYBRID_RECOMMENDER_VERSION,
  sampleLimit,
  k,
  limitations: [...EVALUATION_LIMITATIONS],
  warnings,
});

const createRecommendationEvaluationService = (dependencies = {}) => {
  const models = {
    RecommendationInteraction,
    RecommendationItemProfile,
    RecommendationRun,
    ...dependencies,
  };
  const now = dependencies.now || (() => new Date());
  const recommendationService = dependencies.recommendationService || createHybridRecommenderService(dependencies);

  const findLatestEvaluationRun = async () => {
    if (!models.RecommendationRun || typeof models.RecommendationRun.findOne !== 'function') return null;
    return resolveQuery(
      models.RecommendationRun.findOne({ runType: 'evaluation', status: 'success' }).sort({ startedAt: -1 }),
      true
    );
  };

  const getLatestEvaluation = async () => {
    const latestRun = await findLatestEvaluationRun();
    const evaluation = latestRun?.metricsSnapshot?.evaluation || null;

    if (!evaluation) {
      return createUnavailableEvaluation({
        sampleLimit: DEFAULT_SAMPLE_LIMIT,
        k: DEFAULT_K,
        generatedAt: now().toISOString(),
        message: 'Chưa có dữ liệu đánh giá recommendation.',
        warning: null,
      });
    }

    return evaluation;
  };

  const runOfflineEvaluation = async (rawOptions = {}) => {
    const sampleLimit = parsePositiveInteger(rawOptions.sampleLimit, DEFAULT_SAMPLE_LIMIT, MAX_SAMPLE_LIMIT);
    const k = parsePositiveInteger(rawOptions.k, DEFAULT_K, MAX_K);
    const timeoutMs = parsePositiveInteger(rawOptions.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    const startedAt = now();
    const deadline = Date.now() + timeoutMs;

    let runDocument = null;
    if (models.RecommendationRun && typeof models.RecommendationRun.create === 'function') {
      runDocument = await models.RecommendationRun.create({
        runType: 'evaluation',
        status: 'running',
        startedAt,
        algorithmVersion: HYBRID_RECOMMENDER_VERSION,
        metadata: {
          initiatedBy: rawOptions.initiatedBy || 'admin_api',
          sampleLimit,
          k,
          timeoutMs,
        },
      });
    }

    try {
      const [positiveInteractions, totalCandidateRestaurants] = await Promise.all([
        resolveQuery(
          models.RecommendationInteraction.find({
            itemType: ITEM_TYPES.RESTAURANT,
            eventType: { $in: RESTAURANT_POSITIVE_EVENT_TYPES },
            weight: { $gt: 0 },
          }).sort({ occurredAt: -1 }),
          true
        ),
        countDocuments(models.RecommendationItemProfile, {
          itemType: ITEM_TYPES.RESTAURANT,
          isActive: true,
          approvalStatus: 'approved',
        }),
      ]);

      const eligibleUsers = buildEligibleUserSamples(positiveInteractions);
      const sampledUsers = eligibleUsers.slice(0, sampleLimit);
      const generatedAt = now().toISOString();

      if (!sampledUsers.length || totalCandidateRestaurants === 0) {
        const evaluation = createUnavailableEvaluation({
          sampleLimit,
          k,
          generatedAt,
          message: 'Không đủ dữ liệu để chạy đánh giá recommendation ở thời điểm hiện tại.',
          skippedUsers: sampledUsers.length,
        });

        if (runDocument && typeof models.RecommendationRun.findByIdAndUpdate === 'function') {
          const completedAt = now();
          await models.RecommendationRun.findByIdAndUpdate(runDocument._id, {
            status: 'success',
            completedAt,
            metricsSnapshot: {
              evaluation,
              warnings: evaluation.warnings,
              durationMs: buildDurationMs(startedAt, completedAt),
            },
          });
        }

        return evaluation;
      }

      let hitCount = 0;
      let evaluatedUsers = 0;
      let skippedUsers = 0;
      let fallbackUsers = 0;
      let totalRecommendations = 0;
      let failedUserCount = 0;
      const warnings = [];
      const uniqueRecommendedRestaurantIds = new Set();

      for (let index = 0; index < sampledUsers.length; index += 1) {
        if (Date.now() > deadline) {
          skippedUsers += sampledUsers.length - index;
          warnings.push('Đánh giá đã dừng sớm do timeout guard để tránh chạy quá nặng.');
          break;
        }

        const sample = sampledUsers[index];
        try {
          const payload = await recommendationService.buildRestaurantRecommendationPayload({
            actor: { _id: sample.userId, role: 'customer' },
            query: { limit: k },
            surface: 'evaluation',
          });

          const items = Array.isArray(payload?.data?.items) ? payload.data.items : [];
          if (!items.length) {
            skippedUsers += 1;
            continue;
          }

          evaluatedUsers += 1;
          totalRecommendations += items.length;
          if (payload?.data?.fallbackUsed) {
            fallbackUsers += 1;
          }

          const recommendedRestaurantIds = items
            .map((item) => toIdString(item.restaurantId))
            .filter(Boolean);

          for (const restaurantId of recommendedRestaurantIds) {
            uniqueRecommendedRestaurantIds.add(restaurantId);
          }

          if (recommendedRestaurantIds.includes(sample.holdoutRestaurantId)) {
            hitCount += 1;
          }
        } catch (error) {
          failedUserCount += 1;
          skippedUsers += 1;
        }
      }

      if (failedUserCount > 0) {
        warnings.push(`Bỏ qua ${failedUserCount} user trong mẫu vì không thể tạo recommendation an toàn.`);
      }

      const evaluation = evaluatedUsers > 0
        ? {
          available: true,
          warning: null,
          message: null,
          hitRateAtK: roundNumber(clamp(hitCount / evaluatedUsers, 0, 1), 4),
          coverage: roundNumber(clamp(uniqueRecommendedRestaurantIds.size / Math.max(totalCandidateRestaurants, 1), 0, 1), 4),
          evaluatedUsers,
          skippedUsers,
          averageRecommendations: roundNumber(totalRecommendations / evaluatedUsers, 2),
          fallbackRate: roundNumber(clamp(fallbackUsers / evaluatedUsers, 0, 1), 4),
          generatedAt,
          algorithmVersion: HYBRID_RECOMMENDER_VERSION,
          sampleLimit,
          k,
          limitations: [...EVALUATION_LIMITATIONS],
          warnings,
        }
        : createUnavailableEvaluation({
          sampleLimit,
          k,
          generatedAt,
          message: 'Không thể tạo đủ recommendation để tính metric đánh giá an toàn.',
          skippedUsers,
          warnings,
        });

      if (runDocument && typeof models.RecommendationRun.findByIdAndUpdate === 'function') {
        const completedAt = now();
        await models.RecommendationRun.findByIdAndUpdate(runDocument._id, {
          status: 'success',
          completedAt,
          metricsSnapshot: {
            evaluation,
            warnings,
            durationMs: buildDurationMs(startedAt, completedAt),
          },
        });
      }

      return evaluation;
    } catch (error) {
      if (runDocument && typeof models.RecommendationRun.findByIdAndUpdate === 'function') {
        await models.RecommendationRun.findByIdAndUpdate(runDocument._id, {
          status: 'failed',
          completedAt: now(),
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
    getLatestEvaluation,
    runOfflineEvaluation,
  };
};

const defaultService = createRecommendationEvaluationService();

module.exports = {
  ...defaultService,
  RecommendationEvaluationError,
  createRecommendationEvaluationService,
};
