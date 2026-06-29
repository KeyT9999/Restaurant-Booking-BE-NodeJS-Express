'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createContentRecommenderService } = require('../src/services/recommendation/content-recommender.service');

const clone = (value) => JSON.parse(JSON.stringify(value));

const matchesFilter = (document, filter = {}) => Object.entries(filter).every(([key, expected]) => {
  const actual = key.split('.').reduce((current, segment) => current?.[segment], document);
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    if (Object.hasOwn(expected, '$ne')) return actual !== expected.$ne;
    if (Object.hasOwn(expected, '$in')) return expected.$in.map(String).includes(String(actual));
    if (Object.hasOwn(expected, '$gt')) return actual > expected.$gt;
  }
  return String(actual) === String(expected);
});

const createCollectionModel = (documents) => ({
  find(filter = {}) {
    return {
      lean: async () => clone(documents.filter((document) => matchesFilter(document, filter))),
    };
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
    async deleteMany(filter = {}) {
      const before = store.length;
      for (let index = store.length - 1; index >= 0; index -= 1) {
        if (matchesFilter(store[index], filter)) {
          store.splice(index, 1);
        }
      }
      return { deletedCount: before - store.length };
    },
    get store() {
      return store;
    },
  };
};

const createFixtureService = () => {
  const restaurants = [
    {
      _id: '507f1f77bcf86cd799439201',
      name: 'Pho Thin',
      cuisineTypes: ['Viet Nam'],
      priceRange: 'moderate',
      averagePrice: 150000,
      address: { city: 'Ho Chi Minh', district: '1' },
      coordinates: { latitude: 10.77, longitude: 106.69 },
      approvalStatus: 'approved',
      active: true,
      deletedAt: null,
      featured: false,
      capacity: 20,
      operatingHours: {
        monday: { open: '08:00', close: '22:00', closed: false },
      },
      images: [{ url: 'https://example.com/pho-thin.jpg', isPrimary: true }],
      stats: { averageRating: 4.7, totalReviews: 120, totalBookings: 300, completedBookings: 300 },
    },
    {
      _id: '507f1f77bcf86cd799439202',
      name: 'Sushi House',
      cuisineTypes: ['Japanese'],
      priceRange: 'expensive',
      averagePrice: 450000,
      address: { city: 'Ho Chi Minh', district: '1' },
      coordinates: { latitude: 10.78, longitude: 106.7 },
      approvalStatus: 'approved',
      active: true,
      deletedAt: null,
      featured: true,
      capacity: 24,
      operatingHours: {
        monday: { open: '10:00', close: '23:00', closed: false },
      },
      images: [{ url: 'https://example.com/sushi-house.jpg', isPrimary: true }],
      stats: { averageRating: 4.9, totalReviews: 200, totalBookings: 500, completedBookings: 500 },
    },
    {
      _id: '507f1f77bcf86cd799439203',
      name: 'Bun Bo Corner',
      cuisineTypes: ['Viet Nam'],
      priceRange: 'budget',
      averagePrice: 90000,
      address: { city: 'Ho Chi Minh', district: '3' },
      coordinates: { latitude: 10.79, longitude: 106.68 },
      approvalStatus: 'approved',
      active: true,
      deletedAt: null,
      featured: false,
      capacity: 4,
      operatingHours: {
        monday: { open: '07:00', close: '20:00', closed: false },
      },
      images: [{ url: 'https://example.com/bun-bo.jpg', isPrimary: true }],
      stats: { averageRating: 4.2, totalReviews: 40, totalBookings: 80, completedBookings: 80 },
    },
    {
      _id: '507f1f77bcf86cd799439204',
      name: 'Pending Place',
      cuisineTypes: ['French'],
      priceRange: 'luxury',
      averagePrice: 700000,
      address: { city: 'Ho Chi Minh', district: '1' },
      approvalStatus: 'pending',
      active: true,
      deletedAt: null,
      stats: { averageRating: 5, totalReviews: 10, totalBookings: 20, completedBookings: 20 },
    },
    {
      _id: '507f1f77bcf86cd799439205',
      name: 'Inactive Place',
      cuisineTypes: ['Thai'],
      priceRange: 'moderate',
      averagePrice: 200000,
      address: { city: 'Ho Chi Minh', district: '1' },
      approvalStatus: 'approved',
      active: false,
      deletedAt: null,
      stats: { averageRating: 4.8, totalReviews: 20, totalBookings: 60, completedBookings: 60 },
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
      categoryId: '507f1f77bcf86cd799439602',
      name: 'Sushi Combo',
      price: 420000,
      image: 'https://example.com/sushi-combo.jpg',
      tags: ['sushi', 'fresh'],
      isAvailable: true,
      status: 'available',
    },
    {
      _id: '507f1f77bcf86cd799439303',
      restaurantId: '507f1f77bcf86cd799439203',
      categoryId: '507f1f77bcf86cd799439603',
      name: 'Bun Bo Spicy',
      price: 85000,
      image: 'https://example.com/bun-bo-spicy.jpg',
      tags: ['spicy', 'noodle'],
      isAvailable: true,
      status: 'available',
    },
    {
      _id: '507f1f77bcf86cd799439304',
      restaurantId: '507f1f77bcf86cd799439201',
      categoryId: '507f1f77bcf86cd799439603',
      name: 'Pho Bi Mat',
      price: 100000,
      image: 'https://example.com/pho-hidden.jpg',
      tags: ['secret'],
      isAvailable: false,
      status: 'unavailable',
    },
  ];

  const userProfiles = [
    {
      userId: 'user-a',
      coldStartLevel: 'rich',
      cuisineAffinity: { 'viet nam': 10, japanese: 2 },
      menuTagAffinity: { broth: 10, noodle: 8, spicy: 3 },
      categoryAffinity: { noodle: 7 },
      priceBucketAffinity: { moderate: 10, budget: 4 },
      timeSlotAffinity: { dinner: 10 },
      groupSizeAffinity: { '2': 10 },
      restaurantHistory: [{ restaurantId: '507f1f77bcf86cd799439201', score: 8 }],
      negativeRestaurantIds: [],
      stats: { positiveInteractions: 10 },
    },
    {
      userId: 'user-b',
      coldStartLevel: 'rich',
      cuisineAffinity: { japanese: 10, 'viet nam': 1 },
      menuTagAffinity: { sushi: 10, fresh: 9 },
      categoryAffinity: { combo: 10 },
      priceBucketAffinity: { expensive: 10 },
      timeSlotAffinity: { dinner: 8 },
      groupSizeAffinity: { '2': 8 },
      restaurantHistory: [],
      negativeRestaurantIds: [],
      stats: { positiveInteractions: 7 },
    },
  ];

  const itemProfiles = [
    {
      itemType: 'restaurant',
      itemId: '507f1f77bcf86cd799439201',
      bookingCount: 300,
      reviewCount: 120,
      favoriteCount: 80,
      ratingAverage: 4.7,
      ratingScore: 0.94,
      qualityScore: 0.86,
      popularityScore: 0.78,
      voucherActive: true,
      featuredBoostEligible: false,
      metadata: { primaryImage: 'https://example.com/pho-thin.jpg' },
    },
    {
      itemType: 'restaurant',
      itemId: '507f1f77bcf86cd799439202',
      bookingCount: 500,
      reviewCount: 200,
      favoriteCount: 120,
      ratingAverage: 4.9,
      ratingScore: 0.98,
      qualityScore: 0.95,
      popularityScore: 0.98,
      voucherActive: false,
      featuredBoostEligible: true,
      metadata: { primaryImage: 'https://example.com/sushi-house.jpg' },
    },
    {
      itemType: 'restaurant',
      itemId: '507f1f77bcf86cd799439203',
      bookingCount: 80,
      reviewCount: 40,
      favoriteCount: 10,
      ratingAverage: 4.2,
      ratingScore: 0.84,
      qualityScore: 0.65,
      popularityScore: 0.35,
      voucherActive: false,
      featuredBoostEligible: false,
      metadata: { primaryImage: 'https://example.com/bun-bo.jpg' },
    },
    {
      itemType: 'menu_item',
      itemId: '507f1f77bcf86cd799439301',
      ratingAverage: 4.7,
      ratingScore: 0.94,
      qualityScore: 0.86,
      popularityScore: 0.82,
      preorderCount: 100,
      reviewCount: 120,
      bookingCount: 300,
      priceBucket: 'budget',
      categoryName: 'Noodle',
      cuisineTypes: ['viet nam'],
      tags: ['broth', 'noodle'],
      voucherActive: true,
      metadata: { image: 'https://example.com/pho-tai.jpg' },
    },
    {
      itemType: 'menu_item',
      itemId: '507f1f77bcf86cd799439302',
      ratingAverage: 4.9,
      ratingScore: 0.98,
      qualityScore: 0.95,
      popularityScore: 0.95,
      preorderCount: 130,
      reviewCount: 200,
      bookingCount: 500,
      priceBucket: 'expensive',
      categoryName: 'Combo',
      cuisineTypes: ['japanese'],
      tags: ['sushi', 'fresh'],
      voucherActive: false,
      metadata: { image: 'https://example.com/sushi-combo.jpg' },
    },
    {
      itemType: 'menu_item',
      itemId: '507f1f77bcf86cd799439303',
      ratingAverage: 4.2,
      ratingScore: 0.84,
      qualityScore: 0.65,
      popularityScore: 0.4,
      preorderCount: 50,
      reviewCount: 40,
      bookingCount: 80,
      priceBucket: 'budget',
      categoryName: 'Soup',
      cuisineTypes: ['viet nam'],
      tags: ['spicy', 'noodle'],
      voucherActive: false,
      metadata: { image: 'https://example.com/bun-bo-spicy.jpg' },
    },
  ];

  const cacheModel = createCacheModel();
  const service = createContentRecommenderService({
    Restaurant: createCollectionModel(restaurants),
    MenuItem: createCollectionModel(menuItems),
    MenuCategory: createCollectionModel(menuCategories),
    RecommendationUserProfile: createCollectionModel(userProfiles),
    RecommendationItemProfile: createCollectionModel(itemProfiles),
    RecommendationResultCache: cacheModel,
  });

  return { service, cacheModel };
};

test('logged-in customer with profile receives personalized restaurant recommendations and scoring is bounded', async () => {
  const { service } = createFixtureService();

  const result = await service.getRestaurantRecommendations({
    actor: { _id: 'user-a', role: 'customer' },
    query: {
      limit: 5,
      city: 'ho chi minh',
      numberOfGuests: 2,
      preferredTime: '19:00',
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.data.personalized, true);
  assert.equal(result.data.fallbackUsed, false);
  assert.equal(result.data.items[0].restaurantId, '507f1f77bcf86cd799439201');
  assert.equal(result.data.items.some((item) => item.restaurantId === '507f1f77bcf86cd799439204'), false);
  assert.equal(result.data.items.some((item) => item.restaurantId === '507f1f77bcf86cd799439205'), false);
  assert.equal(result.data.items[0].score > result.data.items[1].score, true);
  assert.equal(result.data.items.every((item) => Number.isFinite(item.score) && item.score >= 0 && item.score <= 1), true);
  assert.match(result.data.items[0].reasons.join(' '), /so thich mon Viet Nam|nhom nho|danh gia cao/i);
  assert.equal(/19:00|customer@example.com|090/.test(result.data.items[0].reasons.join(' ')), false);
});

test('guest and customer without profile receive fallback popular restaurant recommendations', async () => {
  const { service } = createFixtureService();

  const guestResult = await service.getRestaurantRecommendations({
    actor: null,
    query: { limit: 3 },
  });
  const noProfileResult = await service.getRestaurantRecommendations({
    actor: { _id: 'user-c', role: 'customer' },
    query: { limit: 3 },
  });

  assert.equal(guestResult.data.personalized, false);
  assert.equal(guestResult.data.fallbackUsed, true);
  assert.equal(guestResult.data.fallbackReason, 'NO_USER_PROFILE');
  assert.equal(guestResult.data.items[0].restaurantId, '507f1f77bcf86cd799439202');

  assert.equal(noProfileResult.data.personalized, false);
  assert.equal(noProfileResult.data.fallbackUsed, true);
  assert.equal(noProfileResult.data.fallbackReason, 'NO_USER_PROFILE');
  assert.equal(noProfileResult.data.items.length, 3);
});

test('cuisine and price preference change ranking while cache stays isolated per user', async () => {
  const { service, cacheModel } = createFixtureService();

  const userAResult = await service.getRestaurantRecommendations({
    actor: { _id: 'user-a', role: 'customer' },
    query: { limit: 3 },
  });
  const userBResult = await service.getRestaurantRecommendations({
    actor: { _id: 'user-b', role: 'customer' },
    query: { limit: 3 },
  });

  assert.equal(userAResult.data.items[0].restaurantId, '507f1f77bcf86cd799439201');
  assert.equal(userBResult.data.items[0].restaurantId, '507f1f77bcf86cd799439202');
  assert.equal(cacheModel.store.filter((entry) => entry.surface === 'restaurants').length, 2);
});

test('menu item recommendations honor availability, category filters, and profile-based ranking', async () => {
  const { service } = createFixtureService();

  const result = await service.getMenuItemRecommendations({
    actor: { _id: 'user-a', role: 'customer' },
    query: {
      limit: 10,
      category: 'noodle',
      maxPrice: 120000,
    },
  });

  assert.equal(result.data.personalized, true);
  assert.equal(result.data.items[0].menuItemId, '507f1f77bcf86cd799439301');
  assert.equal(result.data.items.some((item) => item.menuItemId === '507f1f77bcf86cd799439304'), false);
  assert.equal(result.data.items.every((item) => item.price <= 120000), true);
  assert.equal(result.data.items.every((item) => item.reasons.length >= 1), true);
});

test('menu item wrapper keeps omitted maxPrice as no filter so personalized results still return items', async () => {
  const { service } = createFixtureService();

  const result = await service.getMenuItemRecommendations({
    actor: { _id: 'user-a', role: 'customer' },
    query: { limit: 10 },
  });

  assert.equal(result.data.personalized, true);
  assert.equal(result.data.fallbackUsed, false);
  assert.equal(result.data.items.length >= 1, true);
  assert.equal(result.data.items[0].menuItemId, '507f1f77bcf86cd799439301');
});

test('excludeVisited, limit enforcement, and home sections work together', async () => {
  const { service } = createFixtureService();

  const restaurantsResult = await service.getRestaurantRecommendations({
    actor: { _id: 'user-a', role: 'customer' },
    query: {
      limit: 1,
      excludeVisited: true,
    },
  });
  const homeResult = await service.getHomeRecommendations({
    actor: { _id: 'user-a', role: 'customer' },
    query: { limit: 2, numberOfGuests: 2, preferredTime: '19:00' },
  });

  assert.equal(restaurantsResult.data.items.length, 1);
  assert.equal(restaurantsResult.data.items[0].restaurantId, '507f1f77bcf86cd799439203');

  assert.ok(Array.isArray(homeResult.data.restaurantsForYou));
  assert.ok(Array.isArray(homeResult.data.menuItemsForYou));
  assert.ok(Array.isArray(homeResult.data.popularRestaurants));
  assert.equal(homeResult.data.restaurantsForYou.length <= 2, true);
  assert.equal(homeResult.data.menuItemsForYou.length <= 2, true);
});
