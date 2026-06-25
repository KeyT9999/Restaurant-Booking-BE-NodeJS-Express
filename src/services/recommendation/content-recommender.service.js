'use strict';

const {
  CACHE_TTL_MS,
  CONTENT_RECOMMENDER_VERSION,
  FALLBACK_REASONS,
  RECOMMENDATION_RESPONSE_VERSION,
} = require('./recommendation-constants');
const { createRecommendationFoundation } = require('./recommendation-foundation.service');

const createContentRecommenderService = (dependencies = {}) => {
  const foundation = createRecommendationFoundation({
    ...dependencies,
    algorithmVersion: CONTENT_RECOMMENDER_VERSION,
  });

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

    let scoredItems;
    let fallbackUsed = false;
    let finalFallbackReason = fallbackReason;

    if (usePersonalized) {
      scoredItems = candidates
        .map((candidate) => ({
          candidate,
          scorePayload: foundation.scoreRestaurantCandidate(candidate, profile, normalizedQuery),
        }))
        .filter((entry) => entry.scorePayload.score > 0)
        .sort((left, right) => (
          right.scorePayload.score - left.scorePayload.score
          || right.candidate.popularityScore - left.candidate.popularityScore
          || left.candidate.name.localeCompare(right.candidate.name)
        ));

      if (!scoredItems.length) {
        fallbackUsed = true;
        finalFallbackReason = FALLBACK_REASONS.INSUFFICIENT_DATA;
      }
    } else {
      fallbackUsed = true;
    }

    if (!scoredItems || fallbackUsed) {
      scoredItems = candidates
        .map((candidate) => ({
          candidate,
          scorePayload: {
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
          },
        }))
        .sort((left, right) => (
          right.scorePayload.score - left.scorePayload.score
          || right.candidate.popularityScore - left.candidate.popularityScore
          || left.candidate.name.localeCompare(right.candidate.name)
        ));
    }

    const diversified = foundation.diversifyRestaurants(scoredItems, normalizedQuery.limit);
    const items = diversified.map((entry) => foundation.buildRestaurantResponseItem({
      candidate: entry.candidate,
      scorePayload: entry.scorePayload,
      fallbackUsed,
      filters: normalizedQuery,
    }));

    return {
      success: true,
      data: {
        type: 'restaurant_recommendations',
        version: RECOMMENDATION_RESPONSE_VERSION,
        personalized: !fallbackUsed,
        fallbackUsed,
        fallbackReason: fallbackUsed ? (finalFallbackReason || FALLBACK_REASONS.INSUFFICIENT_DATA) : null,
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

    let scoredItems;
    let fallbackUsed = false;
    let finalFallbackReason = fallbackReason;

    if (usePersonalized) {
      scoredItems = candidates
        .map((candidate) => ({
          candidate,
          scorePayload: foundation.scoreMenuCandidate(candidate, profile, normalizedQuery),
        }))
        .filter((entry) => entry.scorePayload.score > 0)
        .sort((left, right) => (
          right.scorePayload.score - left.scorePayload.score
          || right.candidate.popularityScore - left.candidate.popularityScore
          || left.candidate.name.localeCompare(right.candidate.name)
        ));

      if (!scoredItems.length) {
        fallbackUsed = true;
        finalFallbackReason = FALLBACK_REASONS.INSUFFICIENT_DATA;
      }
    } else {
      fallbackUsed = true;
    }

    if (!scoredItems || fallbackUsed) {
      scoredItems = candidates
        .map((candidate) => ({
          candidate,
          scorePayload: {
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
          },
        }))
        .sort((left, right) => (
          right.scorePayload.score - left.scorePayload.score
          || right.candidate.restaurantQualityScore - left.candidate.restaurantQualityScore
          || left.candidate.name.localeCompare(right.candidate.name)
        ));
    }

    const diversified = foundation.diversifyMenuItems(scoredItems, normalizedQuery.limit);
    const items = diversified.map((entry) => foundation.buildMenuResponseItem({
      candidate: entry.candidate,
      scorePayload: entry.scorePayload,
      fallbackUsed,
    }));

    return {
      success: true,
      data: {
        type: 'menu_item_recommendations',
        version: RECOMMENDATION_RESPONSE_VERSION,
        personalized: !fallbackUsed,
        fallbackUsed,
        fallbackReason: fallbackUsed ? (finalFallbackReason || FALLBACK_REASONS.INSUFFICIENT_DATA) : null,
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
        restaurantsForYou: restaurantsPayload.data.items,
        menuItemsForYou: menuPayload.data.items,
        popularRestaurants: popularRestaurantsPayload.data.items,
        personalized: !fallbackUsed,
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
      algorithmVersion: CONTENT_RECOMMENDER_VERSION,
    });

    const cached = await foundation.readCache({
      userId: foundation.buildGuestOrCustomerCacheUserId(resolvedActor),
      surface: 'restaurants',
      recommendationType: 'restaurant',
      contextHash,
      algorithmVersion: CONTENT_RECOMMENDER_VERSION,
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
      algorithmVersion: CONTENT_RECOMMENDER_VERSION,
    });

    return payload;
  };

  const getMenuItemRecommendations = async ({ actor, query = {} }) => {
    const resolvedActor = foundation.resolveActor(actor);
    const normalizedQuery = foundation.normalizeMenuQuery(query);
    const contextHash = foundation.buildContextHash({
      type: 'menu_items',
      role: resolvedActor.role,
      query: normalizedQuery,
      algorithmVersion: CONTENT_RECOMMENDER_VERSION,
    });

    const cached = await foundation.readCache({
      userId: foundation.buildGuestOrCustomerCacheUserId(resolvedActor),
      surface: 'menu_items',
      recommendationType: 'menu_item',
      contextHash,
      algorithmVersion: CONTENT_RECOMMENDER_VERSION,
    });
    if (cached) return cached;

    const payload = await buildMenuRecommendationPayload({
      actor: resolvedActor,
      query: normalizedQuery,
      surface: 'menu_items',
    });

    await foundation.writeCache({
      userId: foundation.buildGuestOrCustomerCacheUserId(resolvedActor),
      surface: 'menu_items',
      recommendationType: 'menu_item',
      contextHash,
      payload,
      items: payload.cacheItems,
      ttlMs: CACHE_TTL_MS.menuItems,
      algorithmVersion: CONTENT_RECOMMENDER_VERSION,
    });

    return payload;
  };

  const getHomeRecommendations = async ({ actor, query = {} }) => {
    const resolvedActor = foundation.resolveActor(actor);
    const normalizedQuery = foundation.normalizeHomeQuery(query);
    const contextHash = foundation.buildContextHash({
      type: 'home',
      role: resolvedActor.role,
      query: normalizedQuery,
      algorithmVersion: CONTENT_RECOMMENDER_VERSION,
    });

    const cached = await foundation.readCache({
      userId: foundation.buildGuestOrCustomerCacheUserId(resolvedActor),
      surface: 'home',
      recommendationType: 'mixed',
      contextHash,
      algorithmVersion: CONTENT_RECOMMENDER_VERSION,
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
      algorithmVersion: CONTENT_RECOMMENDER_VERSION,
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
  createContentRecommenderService,
};
