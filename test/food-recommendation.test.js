'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const foodRecommendationController = require('../src/controllers/food-recommendation.controller');
const foodRecommendationService = require('../src/services/food-recommendation.service');

// Stub/Mock for the recommendation service
const originalGetRecommendations = foodRecommendationService.getRecommendations;

const startTestServer = async () => {
  const app = express();
  app.use(express.json());
  
  // Minimal rate limiter mock to bypass real rate limiting in tests
  app.use((req, res, next) => {
    req.aiRequestId = 'test-request-id-1234';
    next();
  });

  app.post('/api/v1/openai/food-recommendation', foodRecommendationController.getFoodRecommendations);

  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}/api/v1/openai`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
};

const withServer = async (callback) => {
  const server = await startTestServer();
  try {
    await callback(server.url);
  } finally {
    await server.close();
  }
};

test.beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.AI_MOCK_ENABLED = 'true';
});

test.afterEach(() => {
  foodRecommendationService.getRecommendations = originalGetRecommendations;
});

test('POST /food-recommendation validates input and rejects empty questions', async () => {
  await withServer(async (url) => {
    const response = await fetch(`${url}/food-recommendation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: '   ' }),
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.success, false);
    assert.equal(body.code, 'INVALID_REQUEST');
    assert.equal(body.message, 'Câu hỏi không được để trống.');
  });
});

test('POST /food-recommendation rejects too long questions', async () => {
  await withServer(async (url) => {
    const response = await fetch(`${url}/food-recommendation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'a'.repeat(501) }),
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.success, false);
    assert.equal(body.code, 'INVALID_REQUEST');
    assert.equal(body.message, 'Câu hỏi không được vượt quá 500 ký tự.');
  });
});

test('POST /food-recommendation calls service and returns recommendations', async () => {
  // Mock the service result
  foodRecommendationService.getRecommendations = async ({ question }) => {
    return {
      question,
      nutritionAdvice: 'Lời khuyên dinh dưỡng giả lập cho test.',
      suggestedDishes: [
        { name: 'Cơm gạo lứt', reason: 'Tốt cho sức khỏe', tags: ['carb'], nutritionHighlights: '100g' }
      ],
      restaurants: []
    };
  };

  await withServer(async (url) => {
    const response = await fetch(`${url}/food-recommendation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Tôi muốn ăn cơm gạo lứt' }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.question, 'Tôi muốn ăn cơm gạo lứt');
    assert.equal(body.data.nutritionAdvice, 'Lời khuyên dinh dưỡng giả lập cho test.');
    assert.equal(body.data.suggestedDishes[0].name, 'Cơm gạo lứt');
  });
});
