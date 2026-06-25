'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createRecommendationController,
  sanitizePublicRecommendationPayload,
} = require('../src/controllers/recommendation.controller');

const createResponse = () => {
  const response = {
    statusCode: null,
    body: null,
  };

  response.status = (statusCode) => {
    response.statusCode = statusCode;
    return response;
  };
  response.json = (body) => {
    response.body = body;
    return response;
  };

  return response;
};

test('phase 11 public recommendation sanitizer removes internal scoring and raw customer fields recursively', () => {
  const sanitized = sanitizePublicRecommendationPayload({
    success: true,
    data: {
      rawProfile: { userId: 'customer-a' },
      items: [{
        restaurantId: 'restaurant-a',
        score: 0.9,
        scoreBreakdown: { content: 0.8 },
        componentScores: { cuisineMatch: 1 },
        matchDetails: { cuisine: ['vietnamese'] },
        nested: {
          rawHistory: ['restaurant-a'],
          rawInteractions: [{ source: 'booking' }],
        },
      }],
    },
  });

  const serialized = JSON.stringify(sanitized);
  assert.match(serialized, /restaurant-a/);
  assert.doesNotMatch(serialized, /scoreBreakdown|componentScores|matchDetails|rawProfile|rawHistory|rawInteractions/);
});

test('phase 11 public recommendation controller sends only sanitized payloads', async () => {
  const controller = createRecommendationController({
    recommendationService: {
      getHomeRecommendations: async () => ({
        success: true,
        data: {
          personalized: true,
          restaurants: {
            items: [{
              restaurantId: 'restaurant-a',
              reasons: ['Phu hop voi so thich am thuc cua ban'],
              scoreBreakdown: { content: 1 },
            }],
          },
        },
      }),
    },
  });
  const response = createResponse();

  await controller.getHomeRecommendations({
    user: { _id: 'customer-a', role: 'customer' },
    query: {},
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.personalized, true);
  assert.equal(response.body.data.restaurants.items[0].restaurantId, 'restaurant-a');
  assert.equal(response.body.data.restaurants.items[0].scoreBreakdown, undefined);
});
