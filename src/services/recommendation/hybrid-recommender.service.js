'use strict';

const {
  CACHE_TTL_MS,
  FALLBACK_REASONS,
  HYBRID_RECOMMENDER_VERSION,
  HYBRID_RECOMMENDER_WEIGHTS,
  ITEM_TYPES,
  RECOMMENDATION_RESPONSE_VERSION,
} = require('./recommendation-constants');
const { createCollaborativeSimilarityService } = require('./collaborative-similarity.service');
const { createRecommendationFoundation } = require('./recommendation-foundation.service');
const {
  clamp,
  roundNumber,
} = require('./recommendation-utils');

const MIN_RELEVANCE_FOR_VOUCHER_BOOST = 0.35;

const normalizeBreakdownScore = (value) => clamp(roundNumber(value, 6), 0, 1);

const createHybridRecommenderService = (dependencies = {}) => {
  const foundation = createRecommendationFoundation({
    ...dependencies,
    algorithmVersion: HYBRID_RECOMMENDER_VERSION,
  });
  const collaborativeService = dependencies.collaborativeService || createCollaborativeSimilarityService(dependencies);

  const buildVoucherBoostScore = (candidate, relevanceScore) => (
    candidate.voucherActive && relevanceScore >= MIN_RELEVANCE_FOR_VOUCHER_BOOST ? 1 : 0
  );

  const buildRestaurantHybridScorePayload = ({
    candidate,
    contentScorePayload,
    collaborativeScore,
    useFallbackWeights,
  }) => {
    const weights = useFallbackWeights
      ? HYBRID_RECOMMENDER_WEIGHTS.fallback
      : HYBRID_RECOMMENDER_WEIGHTS.personalized;

    const contentScore = normalizeBreakdownScore(contentScorePayload.score);
    const popularityScore = normalizeBreakdownScore(candidate.popularityScore);
    const ratingQualityScore = normalizeBreakdownScore((candidate.qualityScore * 0.7) + (candidate.ratingScore * 0.3));
    const voucherBoostScore = buildVoucherBoostScore(candidate, contentScore);
    const safeCollaborativeScore = normalizeBreakdownScore(collaborativeScore);

    const finalScore = normalizeBreakdownScore(
      (contentScore * weights.content)
      + (safeCollaborativeScore * weights.collaborative)
      + (popularityScore * weights.popularity)
      + (ratingQualityScore * weights.ratingQuality)
      + (voucherBoostScore * weights.voucherBoost)
    );

    return {
      score: finalScore,
      componentScores: {
        ...contentScorePayload.componentScores,
        collaborative: safeCollaborativeScore,
        popularity: popularityScore,
        ratingQuality: ratingQualityScore,
        voucherBoost: voucherBoostScore,
      },
      matchDetails: contentScorePayload.matchDetails,
      scoreBreakdown: {
        content: contentScore,
        collaborative: safeCollaborativeScore,
        popularity: popularityScore,
        ratingQuality: ratingQualityScore,
        voucherBoost: voucherBoostScore,
      },
      algorithm: HYBRID_RECOMMENDER_VERSION,
    };
  };

  const buildMenuHybridScorePayload = ({
    candidate,
    contentScorePayload,
    collaborativeScore,
    useFallbackWeights,
  }) => {
    const weights = useFallbackWeights
      ? HYBRID_RECOMMENDER_WEIGHTS.fallback
      : HYBRID_RECOMMENDER_WEIGHTS.personalized;

    const contentScore = normalizeBreakdownScore(contentScorePayload.score);
    const popularityScore = normalizeBreakdownScore(candidate.popularityScore);
    const ratingQualityScore = normalizeBreakdownScore(
      (candidate.restaurantQualityScore * 0.7) + (candidate.ratingScore * 0.3)
    );
    const voucherBoostScore = buildVoucherBoostScore(candidate, contentScore);
    const safeCollaborativeScore = normalizeBreakdownScore(collaborativeScore);

    const finalScore = normalizeBreakdownScore(
      (contentScore * weights.content)
      + (safeCollaborativeScore * weights.collaborative)
      + (popularityScore * weights.popularity)
      + (ratingQualityScore * weights.ratingQuality)
      + (voucherBoostScore * weights.voucherBoost)
    );

    return {
      score: finalScore,
      componentScores: {
        ...contentScorePayload.componentScores,
        collaborative: safeCollaborativeScore,
        popularity: popularityScore,
        ratingQuality: ratingQualityScore,
        voucherBoost: voucherBoostScore,
      },
      matchDetails: contentScorePayload.matchDetails,
      scoreBreakdown: {
        content: contentScore,
        collaborative: safeCollaborativeScore,
        popularity: popularityScore,
        ratingQuality: ratingQualityScore,
        voucherBoost: voucherBoostScore,
      },
      algorithm: HYBRID_RECOMMENDER_VERSION,
    };
  };

  const buildRestaurantRecommendationPayload = async ({ actor, query, surface }) => {
    const normalizedQuery = foundation.normalizeRestaurantQuery(query);
    const profile = await foundation.getUserProfile(actor);
    const candidates = foundation.applyRestaurantFilters(
      await foundation.loadRestaurantCandidates(),
      normalizedQuery,
      profile
    );
    const fallbackReason = foundation.getFallbackReasonForActor(actor, profile, FALLBACK_REASONS);
    const usePersonalized = foundation.canUsePersonalizedProfile(actor, profile);
    const candidateIds = candidates.map((candidate) => candidate.restaurantId);

    const collaborativeScores = usePersonalized
      ? await collaborativeService.getCollaborativeScoresForUser({
        userId: actor.userId,
        itemType: ITEM_TYPES.RESTAURANT,
        candidateItemIds: candidateIds,
      })
      : {};

    const hasCollaborativeSignal = Object.values(collaborativeScores).some((value) => Number(value) > 0);
    const useFallbackWeights = !usePersonalized || !hasCollaborativeSignal;

    const scoredItems = candidates
      .map((candidate) => {
        const contentScorePayload = usePersonalized
          ? foundation.scoreRestaurantCandidate(candidate, profile, normalizedQuery)
          : {
            score: foundation.scoreFallbackRestaurantCandidate(candidate),
            componentScores: {
              cuisineMatch: 0,
              priceMatch: 0,
              menuTagMatch: 0,
              ratingQuality: candidate.qualityScore,
              popularity: candidate.popularityScore,
              timeContext: 0,
              groupSizeContext: normalizedQuery.numberOfGuests
                ? foundation.scoreRestaurantGroupSize(candidate, normalizedQuery.numberOfGuests)
                : 0,
            },
            matchDetails: {},
          };

        const scorePayload = buildRestaurantHybridScorePayload({
          candidate,
          contentScorePayload,
          collaborativeScore: collaborativeScores[candidate.restaurantId] || 0,
          useFallbackWeights,
        });

        return { candidate, scorePayload };
      })
      .filter((entry) => entry.scorePayload.score > 0)
      .sort((left, right) => (
        right.scorePayload.score - left.scorePayload.score
        || right.scorePayload.scoreBreakdown.collaborative - left.scorePayload.scoreBreakdown.collaborative
        || right.candidate.popularityScore - left.candidate.popularityScore
        || left.candidate.name.localeCompare(right.candidate.name)
      ));

    const fallbackUsed = !usePersonalized || !scoredItems.length;
    const finalFallbackReason = !scoredItems.length
      ? FALLBACK_REASONS.INSUFFICIENT_DATA
      : fallbackReason;

    const diversified = foundation.diversifyRestaurants(scoredItems, normalizedQuery.limit);
    const items = diversified.map((entry) => foundation.buildRestaurantResponseItem({
      candidate: entry.candidate,
      scorePayload: entry.scorePayload,
      fallbackUsed,
      filters: normalizedQuery,
      extraFields: {
        algorithm: entry.scorePayload.algorithm,
        scoreBreakdown: entry.scorePayload.scoreBreakdown,
      },
    }));

    return {
      success: true,
      data: {
        type: 'restaurant_recommendations',
        version: RECOMMENDATION_RESPONSE_VERSION,
        personalized: usePersonalized && !fallbackUsed,
        fallbackUsed,
        fallbackReason: fallbackUsed ? (finalFallbackReason || FALLBACK_REASONS.INSUFFICIENT_DATA) : null,
        algorithm: HYBRID_RECOMMENDER_VERSION,
        items,
        generatedAt: new Date().toISOString(),
      },
      cacheItems: items.map(foundation.buildRestaurantCacheEntry),
      cacheMeta: {
        surface,
        recommendationType: 'restaurant',
      },
    };
  };

  const buildMenuRecommendationPayload = async ({ actor, query, surface }) => {
    const normalizedQuery = foundation.normalizeMenuQuery(query);
    const profile = await foundation.getUserProfile(actor);
    const candidates = foundation.applyMenuFilters(
      await foundation.loadMenuItemCandidates(normalizedQuery.restaurantId),
      normalizedQuery,
      profile
    );
    const fallbackReason = foundation.getFallbackReasonForActor(actor, profile, FALLBACK_REASONS);
    const usePersonalized = foundation.canUsePersonalizedProfile(actor, profile);
    const candidateIds = candidates.map((candidate) => candidate.menuItemId);

    const collaborativeScores = usePersonalized
      ? await collaborativeService.getCollaborativeScoresForUser({
        userId: actor.userId,
        itemType: ITEM_TYPES.MENU_ITEM,
        candidateItemIds: candidateIds,
      })
      : {};

    const hasCollaborativeSignal = Object.values(collaborativeScores).some((value) => Number(value) > 0);
    const useFallbackWeights = !usePersonalized || !hasCollaborativeSignal;

    const scoredItems = candidates
      .map((candidate) => {
        const contentScorePayload = usePersonalized
          ? foundation.scoreMenuCandidate(candidate, profile, normalizedQuery)
          : {
            score: foundation.scoreFallbackMenuCandidate(candidate),
            componentScores: {
              menuTagMatch: 0,
              cuisineMatch: 0,
              categoryMatch: 0,
              priceMatch: 0,
              popularity: candidate.popularityScore,
              restaurantQuality: candidate.restaurantQualityScore,
            },
            matchDetails: {},
          };

        const scorePayload = buildMenuHybridScorePayload({
          candidate,
          contentScorePayload,
          collaborativeScore: collaborativeScores[candidate.menuItemId] || 0,
          useFallbackWeights,
        });

        return { candidate, scorePayload };
      })
      .filter((entry) => entry.scorePayload.score > 0)
      .sort((left, right) => (
        right.scorePayload.score - left.scorePayload.score
        || right.scorePayload.scoreBreakdown.collaborative - left.scorePayload.scoreBreakdown.collaborative
        || right.candidate.popularityScore - left.candidate.popularityScore
        || left.candidate.name.localeCompare(right.candidate.name)
      ));

    const fallbackUsed = !usePersonalized || !scoredItems.length;
    const finalFallbackReason = !scoredItems.length
      ? FALLBACK_REASONS.INSUFFICIENT_DATA
      : fallbackReason;

    const diversified = foundation.diversifyMenuItems(scoredItems, normalizedQuery.limit);
    const items = diversified.map((entry) => foundation.buildMenuResponseItem({
      candidate: entry.candidate,
      scorePayload: entry.scorePayload,
      fallbackUsed,
      extraFields: {
        algorithm: entry.scorePayload.algorithm,
        scoreBreakdown: entry.scorePayload.scoreBreakdown,
      },
    }));

    return {
      success: true,
      data: {
        type: 'menu_item_recommendations',
        version: RECOMMENDATION_RESPONSE_VERSION,
        personalized: usePersonalized && !fallbackUsed,
        fallbackUsed,
        fallbackReason: fallbackUsed ? (finalFallbackReason || FALLBACK_REASONS.INSUFFICIENT_DATA) : null,
        algorithm: HYBRID_RECOMMENDER_VERSION,
        items,
        generatedAt: new Date().toISOString(),
      },
      cacheItems: items.map(foundation.buildMenuCacheEntry),
      cacheMeta: {
        surface,
        recommendationType: 'menu_item',
      },
    };
  };

  const buildHomeRecommendationPayload = async ({ actor, query }) => {
    const normalizedQuery = foundation.normalizeHomeQuery(query);
    const [restaurantsPayload, menuPayload, popularRestaurantsPayload] = await Promise.all([
      buildRestaurantRecommendationPayload({
        actor,
        query: {
          limit: normalizedQuery.limit,
          preferredTime: normalizedQuery.preferredTime,
          numberOfGuests: normalizedQuery.numberOfGuests,
        },
        surface: 'home',
      }),
      buildMenuRecommendationPayload({
        actor,
        query: {
          limit: normalizedQuery.limit,
          restaurantId: null,
        },
        surface: 'home',
      }),
      buildRestaurantRecommendationPayload({
        actor: { role: 'guest', userId: null },
        query: { limit: normalizedQuery.limit },
        surface: 'home',
      }),
    ]);

    const fallbackUsed = restaurantsPayload.data.fallbackUsed || menuPayload.data.fallbackUsed;

    return {
      success: true,
      data: {
        type: 'home_recommendations',
        version: RECOMMENDATION_RESPONSE_VERSION,
        algorithm: HYBRID_RECOMMENDER_VERSION,
        restaurantsForYou: restaurantsPayload.data.items,
        menuItemsForYou: menuPayload.data.items,
        popularRestaurants: popularRestaurantsPayload.data.items,
        personalized: restaurantsPayload.data.personalized || menuPayload.data.personalized,
        fallbackUsed,
        fallbackReason: fallbackUsed
          ? restaurantsPayload.data.fallbackReason || menuPayload.data.fallbackReason || FALLBACK_REASONS.INSUFFICIENT_DATA
          : null,
        generatedAt: new Date().toISOString(),
      },
      cacheItems: [
        ...restaurantsPayload.cacheItems,
        ...menuPayload.cacheItems,
      ],
      cacheMeta: {
        surface: 'home',
        recommendationType: 'mixed',
      },
    };
  };

  const getRestaurantRecommendations = async ({ actor, query = {} }) => {
    const resolvedActor = foundation.resolveActor(actor);
    const normalizedQuery = foundation.normalizeRestaurantQuery(query);
    const contextHash = foundation.buildContextHash({
      type: 'restaurants',
      role: resolvedActor.role,
      query: normalizedQuery,
      algorithmVersion: HYBRID_RECOMMENDER_VERSION,
    });

    const cached = await foundation.readCache({
      userId: foundation.buildGuestOrCustomerCacheUserId(resolvedActor),
      surface: 'restaurants',
      recommendationType: 'restaurant',
      contextHash,
      algorithmVersion: HYBRID_RECOMMENDER_VERSION,
    });
    if (cached) return cached;

    const payload = await buildRestaurantRecommendationPayload({
      actor: resolvedActor,
      query: normalizedQuery,
      surface: 'restaurants',
    });

    await foundation.writeCache({
      userId: foundation.buildGuestOrCustomerCacheUserId(resolvedActor),
      surface: 'restaurants',
      recommendationType: 'restaurant',
      contextHash,
      payload,
      items: payload.cacheItems,
      ttlMs: CACHE_TTL_MS.restaurants,
      algorithmVersion: HYBRID_RECOMMENDER_VERSION,
    });

    return payload;
  };

  const getMenuItemRecommendations = async ({ actor, query = {} }) => {
    const resolvedActor = foundation.resolveActor(actor);
    const normalizedQuery = foundation.normalizeMenuQuery(query);
    const payload = await buildMenuRecommendationPayload({
      actor: resolvedActor,
      query: normalizedQuery,
      surface: 'menu_items',
    });

    if (payload?.cacheItems?.length) {
      const contextHash = foundation.buildContextHash({
        type: 'menu_items',
        role: resolvedActor.role,
        query: normalizedQuery,
        algorithmVersion: HYBRID_RECOMMENDER_VERSION,
      });

      await foundation.writeCache({
        userId: foundation.buildGuestOrCustomerCacheUserId(resolvedActor),
        surface: 'menu_items',
        recommendationType: 'menu_item',
        contextHash,
        payload,
        items: payload.cacheItems,
        ttlMs: CACHE_TTL_MS.menuItems,
        algorithmVersion: HYBRID_RECOMMENDER_VERSION,
      });
    }

    return payload;
  };

  const getHomeRecommendations = async ({ actor, query = {} }) => {
    const resolvedActor = foundation.resolveActor(actor);
    const normalizedQuery = foundation.normalizeHomeQuery(query);
    const contextHash = foundation.buildContextHash({
      type: 'home',
      role: resolvedActor.role,
      query: normalizedQuery,
      algorithmVersion: HYBRID_RECOMMENDER_VERSION,
    });

    const cached = await foundation.readCache({
      userId: foundation.buildGuestOrCustomerCacheUserId(resolvedActor),
      surface: 'home',
      recommendationType: 'mixed',
      contextHash,
      algorithmVersion: HYBRID_RECOMMENDER_VERSION,
    });
    if (cached) return cached;

    const payload = await buildHomeRecommendationPayload({
      actor: resolvedActor,
      query: normalizedQuery,
    });

    await foundation.writeCache({
      userId: foundation.buildGuestOrCustomerCacheUserId(resolvedActor),
      surface: 'home',
      recommendationType: 'mixed',
      contextHash,
      payload,
      items: payload.cacheItems,
      ttlMs: CACHE_TTL_MS.home,
      algorithmVersion: HYBRID_RECOMMENDER_VERSION,
    });

    return payload;
  };

  return {
    buildHomeRecommendationPayload,
    buildMenuRecommendationPayload,
    buildRestaurantRecommendationPayload,
    getHomeRecommendations,
    getMenuItemRecommendations,
    getRestaurantRecommendations,
  };
};

module.exports = {
  createHybridRecommenderService,
};
