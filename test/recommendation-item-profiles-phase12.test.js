'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatasetBuilderService } = require('../src/services/recommendation/dataset-builder.service');
const { createHybridRecommenderService } = require('../src/services/recommendation/hybrid-recommender.service');
const { createProfileBuilderService } = require('../src/services/recommendation/profile-builder.service');
const { createRecommendationAdminService } = require('../src/services/recommendation/recommendation-admin.service');

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
    if (Object.hasOwn(expected, '$gt')) {
      return normalizeComparable(actual) > normalizeComparable(expected.$gt);
    }
    if (Object.hasOwn(expected, '$gte')) {
      return normalizeComparable(actual) >= normalizeComparable(expected.$gte);
    }
    if (Object.hasOwn(expected, '$lt')) {
      return normalizeComparable(actual) < normalizeComparable(expected.$lt);
    }
    if (Object.hasOwn(expected, '$lte')) {
      return normalizeComparable(actual) <= normalizeComparable(expected.$lte);
    }
    return true;
  }

  return String(actual) === String(expected);
};

const matchesFilter = (document, filter = {}) => {
  if (!filter || !Object.keys(filter).length) return true;

  if (filter.$or) {
    const { $or, ...rest } = filter;
    return $or.some((entry) => matchesFilter(document, entry)) && matchesFilter(document, rest);
  }

  if (filter.$nor) {
    const { $nor, ...rest } = filter;
    return !$nor.some((entry) => matchesFilter(document, entry)) && matchesFilter(document, rest);
  }

  return Object.entries(filter).every(([key, expected]) => {
    const actual = key.split('.').reduce((current, segment) => current?.[segment], document);
    return matchesCondition(actual, expected);
  });
};

const createQueryModel = (documents) => ({
  find(filter = {}) {
    const matched = documents.filter((document) => matchesFilter(document, filter));
    return {
      lean: async () => clone(matched),
    };
  },
  findOne(filter = {}) {
    return {
      lean: async () => clone(documents.find((document) => matchesFilter(document, filter)) || null),
    };
  },
  async countDocuments(filter = {}) {
    return documents.filter((document) => matchesFilter(document, filter)).length;
  },
});

const createWritableModel = (seed = []) => {
  const store = seed.map((entry) => clone(entry));

  return {
    find(filter = {}) {
      const matched = store.filter((document) => matchesFilter(document, filter));
      return {
        lean: async () => clone(matched),
      };
    },
    async countDocuments(filter = {}) {
      return store.filter((document) => matchesFilter(document, filter)).length;
    },
    async deleteMany(filter = {}) {
      const remaining = [];
      let deletedCount = 0;

      for (const document of store) {
        if (matchesFilter(document, filter)) {
          deletedCount += 1;
        } else {
          remaining.push(document);
        }
      }

      store.length = 0;
      store.push(...remaining);
      return { deletedCount };
    },
    async insertMany(documents = []) {
      const inserted = documents.map((document) => clone(document));
      store.push(...inserted);
      return inserted;
    },
    async bulkWrite(operations = []) {
      let upsertedCount = 0;
      let matchedCount = 0;
      let modifiedCount = 0;

      for (const operation of operations) {
        const payload = operation?.updateOne;
        if (!payload) continue;

        const index = store.findIndex((document) => matchesFilter(document, payload.filter));
        const nextValue = {
          ...(index >= 0 ? store[index] : {}),
          ...clone(payload.update?.$set || {}),
        };

        if (index >= 0) {
          matchedCount += 1;
          modifiedCount += 1;
          store[index] = nextValue;
        } else if (payload.upsert) {
          upsertedCount += 1;
          store.push(nextValue);
        }
      }

      return {
        upsertedCount,
        matchedCount,
        modifiedCount,
      };
    },
    get store() {
      return store;
    },
  };
};

const createRunModel = (seed = []) => {
  const store = seed.map((entry) => clone(entry));

  return {
    findOne(filter = {}) {
      const matched = store.filter((document) => matchesFilter(document, filter));
      return {
        sort(sortSpec = {}) {
          const [[field, direction]] = Object.entries(sortSpec);
          const sorted = [...matched].sort((left, right) => {
            const leftValue = normalizeComparable(left[field]);
            const rightValue = normalizeComparable(right[field]);
            return Number(direction) < 0 ? rightValue - leftValue : leftValue - rightValue;
          });
          return {
            lean: async () => clone(sorted[0] || null),
          };
        },
      };
    },
    find(filter = {}) {
      const matched = store.filter((document) => matchesFilter(document, filter));
      return {
        sort(sortSpec = {}) {
          const [[field, direction]] = Object.entries(sortSpec);
          const sorted = [...matched].sort((left, right) => {
            const leftValue = normalizeComparable(left[field]);
            const rightValue = normalizeComparable(right[field]);
            return Number(direction) < 0 ? rightValue - leftValue : leftValue - rightValue;
          });
          return {
            limit(limitValue) {
              return {
                lean: async () => clone(sorted.slice(0, limitValue)),
              };
            },
          };
        },
      };
    },
    async create(payload = {}) {
      const created = {
        _id: `run-${store.length + 1}`,
        ...clone(payload),
      };
      store.push(created);
      return clone(created);
    },
    async findByIdAndUpdate(id, patch = {}) {
      const index = store.findIndex((document) => String(document._id) === String(id));
      if (index >= 0) {
        store[index] = { ...store[index], ...clone(patch) };
        return clone(store[index]);
      }
      return null;
    },
    get store() {
      return store;
    },
  };
};

const createPhase12SourceDependencies = () => ({
  Restaurant: createQueryModel([
    {
      _id: 'restaurant-1',
      name: 'Pho Dat Viet',
      cuisineTypes: ['Viet Nam'],
      priceRange: 'moderate',
      averagePrice: 120000,
      address: { city: 'Ho Chi Minh', district: '1' },
      coordinates: { latitude: 10.77, longitude: 106.69 },
      approvalStatus: 'approved',
      active: true,
      deletedAt: null,
      hasMenu: true,
      hasTableLayout: true,
      capacity: 18,
      operatingHours: {
        monday: { open: '08:00', close: '22:00', closed: false },
      },
      images: [{ url: 'https://example.com/pho.jpg', isPrimary: true }],
      stats: { averageRating: 4.7, completedBookings: 8, totalReviews: 3 },
    },
    {
      _id: 'restaurant-2',
      name: 'Pending House',
      cuisineTypes: ['French'],
      priceRange: 'luxury',
      approvalStatus: 'pending',
      active: true,
      deletedAt: null,
    },
    {
      _id: 'restaurant-3',
      name: 'Inactive Spot',
      cuisineTypes: ['Japanese'],
      priceRange: 'expensive',
      approvalStatus: 'approved',
      active: false,
      deletedAt: null,
    },
  ]),
  MenuItem: createQueryModel([
    {
      _id: 'menu-1',
      restaurantId: 'restaurant-1',
      categoryId: 'category-1',
      name: 'Pho Tai',
      price: 95000,
      image: 'https://example.com/pho-tai.jpg',
      tags: ['Noodle', 'Broth'],
      isAvailable: true,
      status: 'available',
    },
    {
      _id: 'menu-2',
      restaurantId: 'restaurant-1',
      categoryId: 'category-2',
      name: 'Tam Hide',
      price: 110000,
      image: 'https://example.com/tam.jpg',
      tags: ['Rice'],
      isAvailable: false,
      status: 'available',
    },
    {
      _id: 'menu-3',
      restaurantId: 'restaurant-2',
      categoryId: 'category-3',
      name: 'Pending Steak',
      price: 490000,
      image: 'https://example.com/steak.jpg',
      tags: ['Steak'],
      isAvailable: true,
      status: 'available',
    },
  ]),
  MenuCategory: createQueryModel([
    { _id: 'category-1', name: 'Pho' },
    { _id: 'category-2', name: 'Rice' },
    { _id: 'category-3', name: 'Steak' },
  ]),
  CustomerFavorite: createQueryModel([
    { _id: 'favorite-1', customerId: 'user-1', restaurantId: 'restaurant-1' },
  ]),
  Review: createQueryModel([
    { _id: 'review-1', restaurantId: 'restaurant-1', rating: 5, status: 'approved' },
    { _id: 'review-2', restaurantId: 'restaurant-1', rating: 4, status: 'approved' },
  ]),
  Booking: createQueryModel([
    {
      _id: 'booking-1',
      restaurantId: 'restaurant-1',
      customerId: 'user-1',
      status: 'completed',
      preOrderItems: [{ menuItemId: 'menu-1', quantity: 2 }],
      completedAt: '2026-06-24T10:00:00.000Z',
    },
  ]),
  Voucher: createQueryModel([
    {
      _id: 'voucher-1',
      restaurantId: 'restaurant-1',
      status: 'active',
      startDate: '2026-06-01T00:00:00.000Z',
      endDate: '2026-06-30T23:59:59.000Z',
    },
  ]),
  FeaturedPlacement: createQueryModel([
    {
      _id: 'featured-1',
      restaurantId: 'restaurant-1',
      status: 'active',
      startAt: '2026-06-01T00:00:00.000Z',
      endAt: '2026-06-30T23:59:59.000Z',
    },
  ]),
});

test('phase 12 item profile builder persists only eligible restaurant and available menu items without PII', async () => {
  const service = createProfileBuilderService(createPhase12SourceDependencies());

  const result = await service.buildItemProfileDocuments({
    referenceDate: new Date('2026-06-25T00:00:00.000Z'),
    interactions: [
      {
        itemType: 'menu_item',
        itemId: 'menu-1',
        restaurantId: 'restaurant-1',
        eventType: 'menu_preordered',
        quantity: 2,
      },
    ],
  });

  assert.equal(result.stats.restaurantProfileCount, 1);
  assert.equal(result.stats.menuItemProfileCount, 1);

  const restaurantProfile = result.profiles.find((profile) => profile.itemType === 'restaurant');
  const menuProfile = result.profiles.find((profile) => profile.itemType === 'menu_item');

  assert.equal(restaurantProfile.itemId, 'restaurant-1');
  assert.equal(restaurantProfile.priceRange, 'moderate');
  assert.equal(restaurantProfile.metadata.capacity, 18);
  assert.equal(Boolean(restaurantProfile.metadata.operatingHours?.monday), true);
  assert.equal(menuProfile.itemId, 'menu-1');
  assert.equal(menuProfile.menuCategory, 'Pho');
  assert.deepEqual(menuProfile.menuTags, ['noodle', 'broth']);
  assert.equal(menuProfile.isAvailable, true);
  assert.equal(result.profiles.some((profile) => profile.itemId === 'menu-2'), false);
  assert.equal(result.profiles.some((profile) => profile.itemId === 'menu-3'), false);

  const serialized = JSON.stringify(result.profiles);
  assert.equal(/@|phone|payment|note|raw review/i.test(serialized), false);
});

test('phase 12 full rebuild write mode persists item profiles idempotently and tracks run stats', async () => {
  const itemProfileModel = createWritableModel([]);
  const interactionModel = createWritableModel([]);
  const userProfileModel = createWritableModel([]);
  const cacheModel = createWritableModel([{ _id: 'cache-1', userId: 'user-1' }]);
  const runModel = createRunModel([]);

  const liveProfileBuilder = createProfileBuilderService({
    RecommendationItemProfile: itemProfileModel,
  });

  const datasetBuilder = createDatasetBuilderService({
    RecommendationRun: runModel,
    RecommendationResultCache: cacheModel,
    interactionExtractor: {
      async buildInteractionDocuments() {
        return {
          interactions: [{ _id: 'interaction-1' }, { _id: 'interaction-2' }],
          stats: { totalInteractions: 2 },
        };
      },
      async replaceInteractions(interactions) {
        await interactionModel.deleteMany({});
        await interactionModel.insertMany(interactions);
        return { insertedCount: interactions.length, deletedCount: 0 };
      },
    },
    profileBuilder: {
      async buildUserProfileDocuments() {
        return {
          profiles: [{ _id: 'profile-1', userId: 'user-1' }],
          stats: { profileCount: 1 },
        };
      },
      async buildItemProfileDocuments() {
        return {
          profiles: [
            { itemType: 'restaurant', itemId: 'restaurant-1', restaurantId: 'restaurant-1', name: 'Pho Dat Viet' },
            { itemType: 'menu_item', itemId: 'menu-1', restaurantId: 'restaurant-1', name: 'Pho Tai' },
          ],
          stats: { restaurantProfileCount: 1, menuItemProfileCount: 1, totalProfileCount: 2 },
        };
      },
      async replaceUserProfiles(profiles) {
        await userProfileModel.deleteMany({});
        await userProfileModel.insertMany(profiles);
        return { insertedCount: profiles.length, deletedCount: 0 };
      },
      replaceItemProfiles: liveProfileBuilder.replaceItemProfiles,
    },
  });

  const firstRun = await datasetBuilder.rebuildFullDataset({
    dryRun: false,
    invalidateCache: true,
    initiatedBy: 'phase12-test',
  });
  const secondRun = await datasetBuilder.rebuildFullDataset({
    dryRun: false,
    invalidateCache: true,
    initiatedBy: 'phase12-test',
  });

  assert.equal(firstRun.itemProfilesBuilt, 2);
  assert.equal(secondRun.itemProfilesBuilt, 2);
  assert.equal(itemProfileModel.store.length, 2);
  assert.equal(itemProfileModel.store.filter((profile) => profile.itemType === 'restaurant').length, 1);
  assert.equal(itemProfileModel.store.filter((profile) => profile.itemType === 'menu_item').length, 1);
  assert.equal(runModel.store.length, 2);
  assert.equal(runModel.store[1].status, 'success');
  assert.equal(runModel.store[1].itemProfilesBuilt, 2);
  assert.equal(firstRun.cacheInvalidated, 1);
  assert.equal(runModel.store[1].cacheInvalidated, 0);
});

test('phase 12 dry-run does not mutate derived collections, cache, or run logs', async () => {
  const itemProfileModel = createWritableModel([{ itemType: 'restaurant', itemId: 'restaurant-seeded' }]);
  const cacheModel = createWritableModel([{ _id: 'cache-seeded', userId: 'user-1' }]);
  const runModel = createRunModel([]);

  const datasetBuilder = createDatasetBuilderService({
    RecommendationRun: runModel,
    RecommendationResultCache: cacheModel,
    interactionExtractor: {
      async buildInteractionDocuments() {
        return {
          interactions: [{ _id: 'interaction-new' }],
          stats: { totalInteractions: 1 },
        };
      },
      async replaceInteractions() {
        throw new Error('replaceInteractions must not be called in dry-run');
      },
    },
    profileBuilder: {
      async buildUserProfileDocuments() {
        return {
          profiles: [{ _id: 'profile-new' }],
          stats: { profileCount: 1 },
        };
      },
      async buildItemProfileDocuments() {
        return {
          profiles: [{ itemType: 'menu_item', itemId: 'menu-new', restaurantId: 'restaurant-1', name: 'Pho Tai' }],
          stats: { restaurantProfileCount: 0, menuItemProfileCount: 1, totalProfileCount: 1 },
        };
      },
      async replaceUserProfiles() {
        throw new Error('replaceUserProfiles must not be called in dry-run');
      },
      async replaceItemProfiles() {
        throw new Error('replaceItemProfiles must not be called in dry-run');
      },
    },
  });

  const before = {
    itemProfiles: clone(itemProfileModel.store),
    cache: clone(cacheModel.store),
    runs: clone(runModel.store),
  };

  const summary = await datasetBuilder.rebuildFullDataset({
    dryRun: true,
    invalidateCache: true,
    initiatedBy: 'phase12-test-dry-run',
  });

  assert.equal(summary.dryRun, true);
  assert.equal(summary.itemProfilesBuilt, 1);
  assert.deepEqual(itemProfileModel.store, before.itemProfiles);
  assert.deepEqual(cacheModel.store, before.cache);
  assert.deepEqual(runModel.store, before.runs);
});

test('phase 12 hybrid fallback stays safe when persisted item profiles are empty and excludes unavailable sources', async () => {
  const hybridService = createHybridRecommenderService({
    Restaurant: createQueryModel([
      {
        _id: 'restaurant-1',
        name: 'Pho Dat Viet',
        cuisineTypes: ['Viet Nam'],
        priceRange: 'moderate',
        averagePrice: 120000,
        address: { city: 'Ho Chi Minh', district: '1' },
        approvalStatus: 'approved',
        active: true,
        deletedAt: null,
        stats: { averageRating: 4.7, totalReviews: 5, completedBookings: 9 },
      },
      {
        _id: 'restaurant-2',
        name: 'Pending House',
        cuisineTypes: ['French'],
        priceRange: 'luxury',
        approvalStatus: 'pending',
        active: true,
        deletedAt: null,
      },
    ]),
    MenuItem: createQueryModel([
      {
        _id: 'menu-1',
        restaurantId: 'restaurant-1',
        categoryId: 'category-1',
        name: 'Pho Tai',
        price: 95000,
        tags: ['Broth'],
        isAvailable: true,
        status: 'available',
      },
      {
        _id: 'menu-2',
        restaurantId: 'restaurant-1',
        categoryId: 'category-1',
        name: 'Pho Ngung ban',
        price: 99000,
        tags: ['Broth'],
        isAvailable: false,
        status: 'available',
      },
    ]),
    MenuCategory: createQueryModel([{ _id: 'category-1', name: 'Pho' }]),
    RecommendationUserProfile: createQueryModel([
      {
        userId: 'user-rich',
        coldStartLevel: 'rich',
        cuisineAffinity: { 'viet nam': 10 },
        menuTagAffinity: { broth: 8 },
        categoryAffinity: { pho: 6 },
        priceBucketAffinity: { moderate: 8, budget: 7 },
        restaurantHistory: [],
        negativeRestaurantIds: [],
        stats: { positiveInteractions: 4 },
      },
    ]),
    RecommendationItemProfile: createQueryModel([]),
    RecommendationInteraction: createQueryModel([]),
    RecommendationResultCache: createWritableModel([]),
    collaborativeService: {
      async getCollaborativeScoresForUser() {
        return {};
      },
    },
  });

  const restaurants = await hybridService.getRestaurantRecommendations({
    actor: { _id: 'user-rich', role: 'customer' },
    query: { limit: 5 },
  });
  const menuItems = await hybridService.getMenuItemRecommendations({
    actor: { _id: 'user-rich', role: 'customer' },
    query: { limit: 5 },
  });

  assert.equal(restaurants.success, true);
  assert.equal(restaurants.data.items.length, 1);
  assert.equal(restaurants.data.items[0].restaurantId, 'restaurant-1');
  assert.equal(restaurants.data.items.some((item) => item.restaurantId === 'restaurant-2'), false);
  assert.equal(menuItems.success, true);
  assert.equal(Array.isArray(menuItems.data.items), true);
  assert.equal(menuItems.data.items.some((item) => item.menuItemId === 'menu-2'), false);
});

test('phase 12 admin status exposes item profile counts, run stats, and warning code when profiles are missing', async () => {
  const adminService = createRecommendationAdminService({
    RecommendationInteraction: createQueryModel([{ _id: 'interaction-1' }]),
    RecommendationUserProfile: createQueryModel([{ _id: 'profile-1' }]),
    RecommendationItemProfile: createQueryModel([]),
    RecommendationResultCache: createQueryModel([]),
    RecommendationRun: createRunModel([
      {
        _id: 'run-1',
        runType: 'full',
        status: 'success',
        startedAt: '2026-06-25T08:00:00.000Z',
        completedAt: '2026-06-25T08:01:00.000Z',
        algorithmVersion: 'phase2-dataset-builder-v1',
        interactionsBuilt: 4,
        userProfilesBuilt: 2,
        itemProfilesBuilt: 0,
        cacheInvalidated: 0,
      },
    ]),
    now: () => new Date('2026-06-25T12:00:00.000Z'),
  });

  const status = await adminService.getRecommendationStatus();

  assert.equal(status.dataset.restaurantItemProfiles, 0);
  assert.equal(status.dataset.menuItemProfiles, 0);
  assert.equal(status.dataset.latestRunStats.itemProfilesGenerated, 0);
  assert.equal(status.health.status, 'warning');
  assert.equal(status.health.warningCodes.includes('NO_ITEM_PROFILES_PERSISTED'), true);
});
