'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCollaborativeSimilarityService } = require('../src/services/recommendation/collaborative-similarity.service');
const { createContentRecommenderService } = require('../src/services/recommendation/content-recommender.service');
const { createHybridRecommenderService } = require('../src/services/recommendation/hybrid-recommender.service');

const clone = (value) => JSON.parse(JSON.stringify(value));

const normalizeComparable = (value) => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const asDate = Date.parse(value);
    if (!Number.isNaN(asDate) && value.includes('T')) return asDate;
  }
  return value;
};

const matchesCondition = (actual, expected) => {
  if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) {
    if (Object.hasOwn(expected, '$in')) {
      return expected.$in.map(String).includes(String(actual));
    }
    if (Object.hasOwn(expected, '$ne')) {
      return String(actual) !== String(expected.$ne);
    }
    if (Object.hasOwn(expected, '$gt') && !(normalizeComparable(actual) > normalizeComparable(expected.$gt))) {
      return false;
    }
    if (Object.hasOwn(expected, '$gte') && !(normalizeComparable(actual) >= normalizeComparable(expected.$gte))) {
      return false;
    }
    if (Object.hasOwn(expected, '$lt') && !(normalizeComparable(actual) < normalizeComparable(expected.$lt))) {
      return false;
    }
    return true;
  }

  return String(actual) === String(expected);
};

const matchesFilter = (document, filter = {}) => {
  if (filter.$or) {
    const { $or, ...rest } = filter;
    return $or.some((clause) => matchesFilter(document, clause)) && matchesFilter(document, rest);
  }

  return Object.entries(filter).every(([key, expected]) => {
    const actual = key.split('.').reduce((current, segment) => current?.[segment], document);
    return matchesCondition(actual, expected);
  });
};

const createCollectionModel = (documents) => ({
  find(filter = {}) {
    const matched = documents.filter((document) => matchesFilter(document, filter));
    const query = {
      sort(sortSpec = {}) {
        const [[field, direction]] = Object.entries(sortSpec);
        matched.sort((left, right) => {
          const leftValue = normalizeComparable(left[field]);
          const rightValue = normalizeComparable(right[field]);
          if (leftValue === rightValue) return 0;
          return leftValue > rightValue ? Number(direction) : -Number(direction);
        });
        return query;
      },
      limit(limitValue) {
        return {
          lean: async () => clone(matched.slice(0, limitValue)),
        };
      },
      lean: async () => clone(matched),
    };
    return query;
  },
  findOne(filter = {}) {
    return {
      lean: async () => clone(documents.find((document) => matchesFilter(document, filter)) || null),
    };
  },
});

const createCacheModel = () => {
  const store = [];

  return {
    find(filter = {}) {
      return {
        lean: async () => clone(store.filter((document) => matchesFilter(document, filter))),
      };
    },
    findOne(filter = {}) {
      return {
        lean: async () => clone(store.find((document) => matchesFilter(document, filter)) || null),
      };
    },
    async findOneAndUpdate(filter = {}, payload = {}) {
      const index = store.findIndex((document) => matchesFilter(document, filter));
      if (index >= 0) {
        store[index] = { ...store[index], ...clone(payload) };
        return clone(store[index]);
      }
      const created = { ...clone(filter), ...clone(payload) };
      store.push(created);
      return created;
    },
    async create(payload = {}) {
      store.push(clone(payload));
      return clone(payload);
    },
    get store() {
      return store;
    },
  };
};

const createFixtureServices = () => {
  const restaurants = [
    {
      _id: '507f1f77bcf86cd799439201',
      name: 'Pho Legacy',
      cuisineTypes: ['Viet Nam'],
      priceRange: 'moderate',
      averagePrice: 140000,
      address: { city: 'Ho Chi Minh', district: '1' },
      approvalStatus: 'approved',
      active: true,
      deletedAt: null,
      featured: false,
      capacity: 18,
      operatingHours: {
        monday: { open: '08:00', close: '22:00', closed: false },
      },
      images: [{ url: 'https://example.com/pho-legacy.jpg', isPrimary: true }],
      stats: { averageRating: 4.7, totalReviews: 120, totalBookings: 300, completedBookings: 300 },
    },
    {
      _id: '507f1f77bcf86cd799439202',
      name: 'Bun Bo Social',
      cuisineTypes: ['Viet Nam'],
      priceRange: 'budget',
      averagePrice: 95000,
      address: { city: 'Ho Chi Minh', district: '3' },
      approvalStatus: 'approved',
      active: true,
      deletedAt: null,
      featured: false,
      capacity: 12,
      operatingHours: {
        monday: { open: '07:00', close: '21:30', closed: false },
      },
      images: [{ url: 'https://example.com/bunbo-social.jpg', isPrimary: true }],
      stats: { averageRating: 4.5, totalReviews: 80, totalBookings: 220, completedBookings: 220 },
    },
    {
      _id: '507f1f77bcf86cd799439203',
      name: 'Sushi Promo',
      cuisineTypes: ['Japanese'],
      priceRange: 'expensive',
      averagePrice: 420000,
      address: { city: 'Ho Chi Minh', district: '1' },
      approvalStatus: 'approved',
      active: true,
      deletedAt: null,
      featured: true,
      capacity: 30,
      operatingHours: {
        monday: { open: '10:00', close: '23:00', closed: false },
      },
      images: [{ url: 'https://example.com/sushi-promo.jpg', isPrimary: true }],
      stats: { averageRating: 4.8, totalReviews: 180, totalBookings: 450, completedBookings: 450 },
    },
    {
      _id: '507f1f77bcf86cd799439204',
      name: 'Inactive Burger',
      cuisineTypes: ['American'],
      priceRange: 'moderate',
      averagePrice: 200000,
      address: { city: 'Ho Chi Minh', district: '1' },
      approvalStatus: 'approved',
      active: false,
      deletedAt: null,
      stats: { averageRating: 4.6, totalReviews: 20, totalBookings: 100, completedBookings: 100 },
    },
    {
      _id: '507f1f77bcf86cd799439205',
      name: 'Pending Palace',
      cuisineTypes: ['French'],
      priceRange: 'luxury',
      averagePrice: 650000,
      address: { city: 'Ho Chi Minh', district: '1' },
      approvalStatus: 'pending',
      active: true,
      deletedAt: null,
      stats: { averageRating: 4.9, totalReviews: 12, totalBookings: 40, completedBookings: 40 },
    },
  ];

  const menuCategories = [
    { _id: '507f1f77bcf86cd799439601', name: 'Noodle' },
    { _id: '507f1f77bcf86cd799439602', name: 'Combo' },
    { _id: '507f1f77bcf86cd799439603', name: 'Soup' },
  ];

  const menuItems = [
    {
      _id: '507f1f77bcf86cd799439301',
      restaurantId: '507f1f77bcf86cd799439201',
      categoryId: '507f1f77bcf86cd799439601',
      name: 'Pho Tai',
      price: 95000,
      image: 'https://example.com/pho-tai.jpg',
      tags: ['broth', 'noodle'],
      isAvailable: true,
      status: 'available',
    },
    {
      _id: '507f1f77bcf86cd799439302',
      restaurantId: '507f1f77bcf86cd799439202',
      categoryId: '507f1f77bcf86cd799439603',
      name: 'Bun Bo Spicy',
      price: 90000,
      image: 'https://example.com/bunbo-spicy.jpg',
      tags: ['spicy', 'noodle'],
      isAvailable: true,
      status: 'available',
    },
    {
      _id: '507f1f77bcf86cd799439303',
      restaurantId: '507f1f77bcf86cd799439203',
      categoryId: '507f1f77bcf86cd799439602',
      name: 'Sushi Combo',
      price: 390000,
      image: 'https://example.com/sushi-combo.jpg',
      tags: ['sushi', 'fresh'],
      isAvailable: true,
      status: 'available',
    },
    {
      _id: '507f1f77bcf86cd799439304',
      restaurantId: '507f1f77bcf86cd799439201',
      categoryId: '507f1f77bcf86cd799439603',
      name: 'Pho Hidden',
      price: 100000,
      image: 'https://example.com/pho-hidden.jpg',
      tags: ['secret'],
      isAvailable: false,
      status: 'unavailable',
    },
  ];

  const userProfiles = [
    {
      userId: 'user-rich',
      coldStartLevel: 'rich',
      cuisineAffinity: { 'viet nam': 10 },
      menuTagAffinity: { broth: 8, noodle: 7, spicy: 5 },
      categoryAffinity: { noodle: 8, soup: 5 },
      priceBucketAffinity: { moderate: 10, budget: 8 },
      timeSlotAffinity: { dinner: 10 },
      groupSizeAffinity: { '2': 8 },
      restaurantHistory: [
        { restaurantId: '507f1f77bcf86cd799439201', score: 9 },
      ],
      negativeRestaurantIds: [],
      stats: { positiveInteractions: 6 },
    },
    {
      userId: 'user-cold',
      coldStartLevel: 'none',
      cuisineAffinity: {},
      menuTagAffinity: {},
      categoryAffinity: {},
      priceBucketAffinity: {},
      restaurantHistory: [],
      negativeRestaurantIds: [],
      stats: { positiveInteractions: 0 },
    },
  ];

  const itemProfiles = [
    {
      itemType: 'restaurant',
      itemId: '507f1f77bcf86cd799439201',
      bookingCount: 300,
      reviewCount: 120,
      favoriteCount: 60,
      ratingAverage: 4.7,
      ratingScore: 0.94,
      qualityScore: 0.88,
      popularityScore: 0.82,
      voucherActive: false,
      featuredBoostEligible: false,
      metadata: { primaryImage: 'https://example.com/pho-legacy.jpg' },
    },
    {
      itemType: 'restaurant',
      itemId: '507f1f77bcf86cd799439202',
      bookingCount: 220,
      reviewCount: 80,
      favoriteCount: 40,
      ratingAverage: 4.5,
      ratingScore: 0.90,
      qualityScore: 0.84,
      popularityScore: 0.76,
      voucherActive: true,
      featuredBoostEligible: false,
      metadata: { primaryImage: 'https://example.com/bunbo-social.jpg' },
    },
    {
      itemType: 'restaurant',
      itemId: '507f1f77bcf86cd799439203',
      bookingCount: 450,
      reviewCount: 180,
      favoriteCount: 120,
      ratingAverage: 4.8,
      ratingScore: 0.96,
      qualityScore: 0.90,
      popularityScore: 0.90,
      voucherActive: true,
      featuredBoostEligible: true,
      metadata: { primaryImage: 'https://example.com/sushi-promo.jpg' },
    },
    {
      itemType: 'menu_item',
      itemId: '507f1f77bcf86cd799439301',
      ratingAverage: 4.7,
      ratingScore: 0.94,
      qualityScore: 0.88,
      popularityScore: 0.84,
      preorderCount: 100,
      reviewCount: 120,
      bookingCount: 300,
      priceBucket: 'budget',
      categoryName: 'Noodle',
      cuisineTypes: ['viet nam'],
      tags: ['broth', 'noodle'],
      voucherActive: false,
      metadata: { image: 'https://example.com/pho-tai.jpg' },
    },
    {
      itemType: 'menu_item',
      itemId: '507f1f77bcf86cd799439302',
      ratingAverage: 4.5,
      ratingScore: 0.90,
      qualityScore: 0.82,
      popularityScore: 0.72,
      preorderCount: 80,
      reviewCount: 80,
      bookingCount: 220,
      priceBucket: 'budget',
      categoryName: 'Soup',
      cuisineTypes: ['viet nam'],
      tags: ['spicy', 'noodle'],
      voucherActive: true,
      metadata: { image: 'https://example.com/bunbo-spicy.jpg' },
    },
    {
      itemType: 'menu_item',
      itemId: '507f1f77bcf86cd799439303',
      ratingAverage: 4.8,
      ratingScore: 0.96,
      qualityScore: 0.90,
      popularityScore: 0.94,
      preorderCount: 130,
      reviewCount: 180,
      bookingCount: 450,
      priceBucket: 'expensive',
      categoryName: 'Combo',
      cuisineTypes: ['japanese'],
      tags: ['sushi', 'fresh'],
      voucherActive: false,
      metadata: { image: 'https://example.com/sushi-combo.jpg' },
    },
  ];

  const interactions = [
    {
      userId: 'user-rich',
      itemType: 'restaurant',
      itemId: '507f1f77bcf86cd799439201',
      restaurantId: '507f1f77bcf86cd799439201',
      eventType: 'booking_completed',
      weight: 5,
      occurredAt: new Date('2026-06-21T12:00:00.000Z'),
    },
    {
      userId: 'user-ally-1',
      itemType: 'restaurant',
      itemId: '507f1f77bcf86cd799439201',
      restaurantId: '507f1f77bcf86cd799439201',
      eventType: 'booking_completed',
      weight: 5,
      occurredAt: new Date('2026-06-20T12:00:00.000Z'),
    },
    {
      userId: 'user-ally-1',
      itemType: 'restaurant',
      itemId: '507f1f77bcf86cd799439202',
      restaurantId: '507f1f77bcf86cd799439202',
      eventType: 'favorite_added',
      weight: 4,
      occurredAt: new Date('2026-06-20T14:00:00.000Z'),
    },
    {
      userId: 'user-ally-2',
      itemType: 'restaurant',
      itemId: '507f1f77bcf86cd799439201',
      restaurantId: '507f1f77bcf86cd799439201',
      eventType: 'review_positive',
      weight: 5,
      occurredAt: new Date('2026-06-19T11:00:00.000Z'),
    },
    {
      userId: 'user-ally-2',
      itemType: 'restaurant',
      itemId: '507f1f77bcf86cd799439202',
      restaurantId: '507f1f77bcf86cd799439202',
      eventType: 'booking_completed',
      weight: 5,
      occurredAt: new Date('2026-06-19T13:00:00.000Z'),
    },
    {
      userId: 'user-ally-3',
      itemType: 'restaurant',
      itemId: '507f1f77bcf86cd799439203',
      restaurantId: '507f1f77bcf86cd799439203',
      eventType: 'booking_completed',
      weight: 5,
      occurredAt: new Date('2026-06-18T12:00:00.000Z'),
    },
    {
      userId: 'user-rich',
      itemType: 'menu_item',
      itemId: '507f1f77bcf86cd799439301',
      restaurantId: '507f1f77bcf86cd799439201',
      eventType: 'menu_preordered',
      weight: 2.5,
      occurredAt: new Date('2026-06-21T12:30:00.000Z'),
    },
    {
      userId: 'user-ally-1',
      itemType: 'menu_item',
      itemId: '507f1f77bcf86cd799439301',
      restaurantId: '507f1f77bcf86cd799439201',
      eventType: 'menu_preordered',
      weight: 2.5,
      occurredAt: new Date('2026-06-20T12:30:00.000Z'),
    },
    {
      userId: 'user-ally-1',
      itemType: 'menu_item',
      itemId: '507f1f77bcf86cd799439302',
      restaurantId: '507f1f77bcf86cd799439202',
      eventType: 'menu_preordered',
      weight: 2.3,
      occurredAt: new Date('2026-06-20T13:00:00.000Z'),
    },
    {
      userId: 'user-ally-2',
      itemType: 'menu_item',
      itemId: '507f1f77bcf86cd799439301',
      restaurantId: '507f1f77bcf86cd799439201',
      eventType: 'menu_preordered',
      weight: 2.4,
      occurredAt: new Date('2026-06-19T12:30:00.000Z'),
    },
    {
      userId: 'user-ally-2',
      itemType: 'menu_item',
      itemId: '507f1f77bcf86cd799439302',
      restaurantId: '507f1f77bcf86cd799439202',
      eventType: 'menu_preordered',
      weight: 2.4,
      occurredAt: new Date('2026-06-19T13:15:00.000Z'),
    },
    {
      userId: 'user-ally-3',
      itemType: 'menu_item',
      itemId: '507f1f77bcf86cd799439303',
      restaurantId: '507f1f77bcf86cd799439203',
      eventType: 'menu_preordered',
      weight: 2.5,
      occurredAt: new Date('2026-06-18T13:00:00.000Z'),
    },
  ];

  const cacheModel = createCacheModel();
  const commonDependencies = {
    Restaurant: createCollectionModel(restaurants),
    MenuItem: createCollectionModel(menuItems),
    MenuCategory: createCollectionModel(menuCategories),
    RecommendationUserProfile: createCollectionModel(userProfiles),
    RecommendationItemProfile: createCollectionModel(itemProfiles),
    RecommendationInteraction: createCollectionModel(interactions),
    RecommendationResultCache: cacheModel,
  };

  return {
    cacheModel,
    collaborativeService: createCollaborativeSimilarityService(commonDependencies),
    contentService: createContentRecommenderService(commonDependencies),
    hybridService: createHybridRecommenderService(commonDependencies),
  };
};

test('phase 4 collaborative similarity returns overlap-driven similarity and zero when there is no overlap', async () => {
  const { collaborativeService } = createFixtureServices();

  const similarRestaurants = await collaborativeService.getSimilarItems({
    itemType: 'restaurant',
    itemId: '507f1f77bcf86cd799439201',
    limit: 5,
  });
  const collaborativeScores = await collaborativeService.getCollaborativeScoresForUser({
    userId: 'user-rich',
    itemType: 'restaurant',
    candidateItemIds: ['507f1f77bcf86cd799439202', '507f1f77bcf86cd799439203'],
  });

  assert.equal(similarRestaurants[0].itemId, '507f1f77bcf86cd799439202');
  assert.equal(similarRestaurants[0].similarity > 0, true);
  assert.equal(similarRestaurants.some((entry) => entry.itemId === '507f1f77bcf86cd799439203'), false);
  assert.equal(collaborativeScores['507f1f77bcf86cd799439202'] > 0, true);
  assert.equal(collaborativeScores['507f1f77bcf86cd799439203'], 0);
});

test('phase 4 hybrid restaurant ranking combines content and collaborative scores with safe reasons and voucher boost cap', async () => {
  const { hybridService } = createFixtureServices();

  const result = await hybridService.getRestaurantRecommendations({
    actor: { _id: 'user-rich', role: 'customer' },
    query: {
      limit: 3,
      excludeVisited: true,
      city: 'ho chi minh',
      preferredTime: '19:00',
      numberOfGuests: 2,
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.data.type, 'restaurant_recommendations');
  assert.equal(result.data.version, 1);
  assert.equal(result.data.algorithm, 'hybrid_v1');
  assert.equal(result.data.personalized, true);
  assert.equal(result.data.fallbackUsed, false);
  assert.equal(result.data.items[0].restaurantId, '507f1f77bcf86cd799439202');
  assert.equal(result.data.items.some((item) => item.restaurantId === '507f1f77bcf86cd799439204'), false);
  assert.equal(result.data.items.some((item) => item.restaurantId === '507f1f77bcf86cd799439205'), false);
  assert.equal(result.data.items[0].scoreBreakdown.content > 0, true);
  assert.equal(result.data.items[0].scoreBreakdown.collaborative > 0, true);
  assert.equal(result.data.items[0].scoreBreakdown.voucherBoost, 1);
  assert.equal(result.data.items[0].score >= result.data.items[1].score, true);
  assert.equal(result.data.items[1].restaurantId, '507f1f77bcf86cd799439203');
  assert.equal(result.data.items[1].scoreBreakdown.voucherBoost, 0);
  assert.equal(result.data.items.every((item) => Object.values(item.scoreBreakdown).every((value) => Number.isFinite(value) && value >= 0 && value <= 1)), true);
  assert.match(result.data.items[0].reasons.join(' '), /Tuong tu|uu dai|so thich|danh gia/i);
  assert.equal(/Pho Legacy|2026|090|@/.test(result.data.items[0].reasons.join(' ')), false);
});

test('phase 4 fallback remains safe for cold-start users and guests without collaborative leakage', async () => {
  const { hybridService } = createFixtureServices();

  const coldUserResult = await hybridService.getRestaurantRecommendations({
    actor: { _id: 'user-cold', role: 'customer' },
    query: { limit: 3 },
  });
  const guestResult = await hybridService.getRestaurantRecommendations({
    actor: null,
    query: { limit: 3 },
  });

  assert.equal(coldUserResult.data.fallbackUsed, true);
  assert.equal(coldUserResult.data.fallbackReason, 'NO_USER_PROFILE');
  assert.equal(coldUserResult.data.items.length, 3);
  assert.equal(guestResult.data.personalized, false);
  assert.equal(guestResult.data.fallbackUsed, true);
  assert.equal(guestResult.data.items[0].restaurantId, '507f1f77bcf86cd799439203');
  assert.equal(guestResult.data.items.every((item) => item.scoreBreakdown.collaborative === 0), true);
  assert.equal(guestResult.data.items.some((item) => item.scoreBreakdown.voucherBoost > 0 && item.restaurantId === '507f1f77bcf86cd799439201'), false);
});

test('phase 4 menu recommendations stay API-compatible and filter unavailable items while exposing bounded score breakdowns', async () => {
  const { hybridService } = createFixtureServices();

  const result = await hybridService.getMenuItemRecommendations({
    actor: { _id: 'user-rich', role: 'customer' },
    query: {
      limit: 5,
      maxPrice: 120000,
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.data.type, 'menu_item_recommendations');
  assert.equal(result.data.version, 1);
  assert.equal(result.data.algorithm, 'hybrid_v1');
  assert.equal(Array.isArray(result.data.items), true);
  assert.equal(result.data.items.length >= 1, true);
  assert.equal(result.data.items.some((item) => item.menuItemId === '507f1f77bcf86cd799439304'), false);
  assert.equal(result.data.items.every((item) => item.price <= 120000), true);
  assert.equal(result.data.items.every((item) => item.algorithm === 'hybrid_v1'), true);
  assert.equal(result.data.items.every((item) => item.reasons.length >= 1), true);
  assert.equal(result.data.items.every((item) => Object.values(item.scoreBreakdown).every((value) => Number.isFinite(value) && value >= 0 && value <= 1)), true);
});

test('phase 4 menu wrapper keeps omitted maxPrice nullable so personalized results do not collapse to fallback', async () => {
  const { hybridService } = createFixtureServices();

  const result = await hybridService.getMenuItemRecommendations({
    actor: { _id: 'user-rich', role: 'customer' },
    query: { limit: 5 },
  });

  assert.equal(result.success, true);
  assert.equal(result.data.personalized, true);
  assert.equal(result.data.fallbackUsed, false);
  assert.equal(result.data.items.length >= 1, true);
  assert.equal(result.data.items.some((item) => item.menuItemId === '507f1f77bcf86cd799439301'), true);
});

test('phase 4 cache keeps hybrid_v1 separate from phase3 content cache entries', async () => {
  const { cacheModel, contentService, hybridService } = createFixtureServices();
  const actor = { _id: 'user-rich', role: 'customer' };
  const query = { limit: 2 };

  await contentService.getRestaurantRecommendations({ actor, query });
  await hybridService.getRestaurantRecommendations({ actor, query });

  assert.equal(cacheModel.store.length, 2);
  assert.equal(cacheModel.store.some((entry) => entry.algorithmVersion === 'phase3-content-based-v1'), true);
  assert.equal(cacheModel.store.some((entry) => entry.algorithmVersion === 'hybrid_v1'), true);
});
