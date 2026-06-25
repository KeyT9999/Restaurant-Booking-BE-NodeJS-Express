'use strict';

const RecommendationInteraction = require('../../models/RecommendationInteraction');
const {
  COLLABORATIVE_POSITIVE_EVENT_TYPES,
  COLLABORATIVE_SIMILARITY_OPTIONS,
} = require('./recommendation-constants');
const {
  clamp,
  roundNumber,
  toIdString,
} = require('./recommendation-utils');

const POSITIVE_EVENT_TYPES = new Set(COLLABORATIVE_POSITIVE_EVENT_TYPES);

const createNestedMapEntry = (container, key) => {
  if (!container.has(key)) {
    container.set(key, new Map());
  }
  return container.get(key);
};

const normalizeWeight = (weight, maxWeight) => {
  if (!Number.isFinite(weight) || weight <= 0) return 0;
  return clamp(roundNumber(weight / Math.max(1, maxWeight), 6), 0, 1);
};

const loadLeanDocuments = async (Model, filter = {}, options = {}) => {
  if (!Model || typeof Model.find !== 'function') return [];

  let query = Model.find(filter);
  if (options.sort && typeof query.sort === 'function') {
    query = query.sort(options.sort);
  }
  if (Number.isInteger(options.limit) && options.limit > 0 && typeof query.limit === 'function') {
    query = query.limit(options.limit);
  }

  const documents = query && typeof query.lean === 'function'
    ? await query.lean()
    : await query;

  if (!Array.isArray(documents)) return [];

  const sortedDocuments = options.sort && !query?.sort
    ? [...documents].sort((left, right) => (
      new Date(right.occurredAt || 0).getTime() - new Date(left.occurredAt || 0).getTime()
    ))
    : documents;

  if (Number.isInteger(options.limit) && options.limit > 0) {
    return sortedDocuments.slice(0, options.limit);
  }

  return sortedDocuments;
};

const resolveUserWeightMap = (item) => {
  if (!item) return new Map();
  if (item instanceof Map) return item;
  if (item.userWeights instanceof Map) return item.userWeights;
  if (Array.isArray(item.userWeights)) return new Map(item.userWeights);
  if (item.userWeights && typeof item.userWeights === 'object') {
    return new Map(Object.entries(item.userWeights));
  }
  return new Map();
};

const computeCosineSimilarity = (leftMapLike, rightMapLike) => {
  const leftMap = resolveUserWeightMap(leftMapLike);
  const rightMap = resolveUserWeightMap(rightMapLike);

  if (!leftMap.size || !rightMap.size) {
    return { similarity: 0, overlapCount: 0 };
  }

  let dotProduct = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  let overlapCount = 0;

  for (const [, weight] of leftMap.entries()) {
    const safeWeight = Number(weight) || 0;
    leftNorm += safeWeight ** 2;
  }

  for (const [userId, weight] of rightMap.entries()) {
    const safeWeight = Number(weight) || 0;
    rightNorm += safeWeight ** 2;
    if (leftMap.has(userId)) {
      dotProduct += (Number(leftMap.get(userId)) || 0) * safeWeight;
      overlapCount += 1;
    }
  }

  if (!dotProduct || !leftNorm || !rightNorm) {
    return { similarity: 0, overlapCount: 0 };
  }

  const cosine = dotProduct / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
  const shrinkage = clamp(overlapCount / (overlapCount + 2), 0, 1);

  return {
    similarity: clamp(roundNumber(cosine * shrinkage, 6), 0, 1),
    overlapCount,
  };
};

const createCollaborativeSimilarityService = (dependencies = {}) => {
  const models = {
    RecommendationInteraction,
    ...dependencies,
  };

  const buildPositiveInteractionMaps = (interactions = []) => {
    const itemUserMap = new Map();
    const userItemMap = new Map();

    for (const interaction of interactions) {
      const itemId = toIdString(interaction.itemId);
      const userId = toIdString(interaction.userId);
      const weight = Number(interaction.weight || 0);

      if (!itemId || !userId || weight <= 0) continue;
      if (!POSITIVE_EVENT_TYPES.has(interaction.eventType)) continue;

      const boundedWeight = Math.min(
        weight,
        COLLABORATIVE_SIMILARITY_OPTIONS.maxPositiveWeightPerUserItem
      );

      const itemEntry = createNestedMapEntry(itemUserMap, itemId);
      itemEntry.set(userId, roundNumber((Number(itemEntry.get(userId)) || 0) + boundedWeight, 6));

      const userEntry = createNestedMapEntry(userItemMap, userId);
      userEntry.set(itemId, roundNumber((Number(userEntry.get(itemId)) || 0) + boundedWeight, 6));
    }

    return { itemUserMap, userItemMap };
  };

  const getPositiveUserItemMap = async ({
    itemType,
    referenceDate = new Date(),
  }) => {
    const lookbackStart = new Date(referenceDate);
    lookbackStart.setUTCDate(lookbackStart.getUTCDate() - COLLABORATIVE_SIMILARITY_OPTIONS.lookbackDays);

    const interactions = await loadLeanDocuments(
      models.RecommendationInteraction,
      {
        itemType,
        weight: { $gt: 0 },
        occurredAt: { $gte: lookbackStart },
      },
      {
        sort: { occurredAt: -1 },
        limit: COLLABORATIVE_SIMILARITY_OPTIONS.maxInteractions,
      }
    );

    const { itemUserMap, userItemMap } = buildPositiveInteractionMaps(interactions);

    return {
      interactionCount: interactions.length,
      itemUserMap,
      userItemMap,
    };
  };

  const computeItemSimilarity = (itemA, itemB) => (
    computeCosineSimilarity(itemA, itemB).similarity
  );

  const getSimilarItems = async ({
    itemType,
    itemId,
    limit = COLLABORATIVE_SIMILARITY_OPTIONS.limit,
  }) => {
    const normalizedItemId = toIdString(itemId);
    if (!normalizedItemId) return [];

    const { itemUserMap } = await getPositiveUserItemMap({ itemType });
    const targetUserMap = itemUserMap.get(normalizedItemId);
    if (!targetUserMap) return [];

    return [...itemUserMap.entries()]
      .filter(([candidateItemId]) => candidateItemId !== normalizedItemId)
      .map(([candidateItemId, candidateUserMap]) => {
        const { similarity, overlapCount } = computeCosineSimilarity(targetUserMap, candidateUserMap);
        return {
          itemId: candidateItemId,
          similarity,
          overlapCount,
        };
      })
      .filter((entry) => (
        entry.similarity > 0
        && entry.overlapCount >= COLLABORATIVE_SIMILARITY_OPTIONS.minCoOccurrenceUsers
      ))
      .sort((left, right) => (
        right.similarity - left.similarity
        || right.overlapCount - left.overlapCount
        || left.itemId.localeCompare(right.itemId)
      ))
      .slice(0, limit);
  };

  const getCollaborativeScoresForUser = async ({
    userId,
    itemType,
    candidateItemIds = [],
  }) => {
    const normalizedUserId = toIdString(userId);
    const uniqueCandidateIds = [...new Set(candidateItemIds.map((value) => toIdString(value)).filter(Boolean))]
      .slice(0, COLLABORATIVE_SIMILARITY_OPTIONS.maxCandidateItems);

    if (!normalizedUserId || !uniqueCandidateIds.length) {
      return {};
    }

    const { itemUserMap, userItemMap } = await getPositiveUserItemMap({ itemType });
    const rawHistoryMap = userItemMap.get(normalizedUserId);
    if (!rawHistoryMap || !rawHistoryMap.size) {
      return Object.fromEntries(uniqueCandidateIds.map((candidateId) => [candidateId, 0]));
    }

    const sortedHistory = [...rawHistoryMap.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, COLLABORATIVE_SIMILARITY_OPTIONS.maxUserHistoryItems);

    const maxHistoryWeight = Math.max(1, ...sortedHistory.map(([, weight]) => Number(weight) || 0));
    const scores = {};

    for (const candidateId of uniqueCandidateIds) {
      const candidateUserMap = itemUserMap.get(candidateId);
      if (!candidateUserMap) {
        scores[candidateId] = 0;
        continue;
      }

      let weightedSimilaritySum = 0;
      let weightSum = 0;
      let supportCount = 0;

      for (const [historyItemId, historyWeight] of sortedHistory) {
        if (historyItemId === candidateId) continue;

        const historyUserMap = itemUserMap.get(historyItemId);
        if (!historyUserMap) continue;

        const { similarity } = computeCosineSimilarity(candidateUserMap, historyUserMap);
        if (similarity <= 0) continue;

        const normalizedHistoryWeight = normalizeWeight(historyWeight, maxHistoryWeight);
        weightedSimilaritySum += similarity * normalizedHistoryWeight;
        weightSum += normalizedHistoryWeight;
        supportCount += 1;
      }

      const averageSimilarity = weightSum > 0 ? weightedSimilaritySum / weightSum : 0;
      const evidenceFactor = supportCount > 0 ? clamp(0.7 + (Math.min(supportCount, 3) * 0.1), 0, 1) : 0;
      scores[candidateId] = clamp(roundNumber(averageSimilarity * evidenceFactor, 6), 0, 1);
    }

    return scores;
  };

  return {
    computeItemSimilarity,
    getCollaborativeScoresForUser,
    getPositiveUserItemMap,
    getSimilarItems,
  };
};

module.exports = {
  createCollaborativeSimilarityService,
};
