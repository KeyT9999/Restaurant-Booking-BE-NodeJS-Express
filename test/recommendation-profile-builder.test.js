'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createProfileBuilderService } = require('../src/services/recommendation/profile-builder.service');

const createCollection = (documents) => ({
  find() {
    return {
      lean: async () => documents,
    };
  },
});

test('profile builder aggregates recommendation user preferences from normalized interactions', async () => {
  const service = createProfileBuilderService();
  const result = await service.buildUserProfileDocuments({
    referenceDate: new Date('2026-06-23T00:00:00.000Z'),
    interactions: [
      {
        userId: '507f1f77bcf86cd799439001',
        restaurantId: '507f1f77bcf86cd799439201',
        itemType: 'restaurant',
        eventType: 'booking_completed',
        weight: 5,
        occurredAt: new Date('2026-06-20T12:00:00.000Z'),
        context: {
          cuisineTypes: ['viet nam'],
          priceRange: 'moderate',
          dayOfWeek: 'saturday',
          hourOfDay: 19,
          numberOfGuests: 2,
          occasion: 'date',
          city: 'ho chi minh',
          district: '1',
          menuCategories: ['noodle'],
          menuTags: ['broth'],
        },
      },
      {
        userId: '507f1f77bcf86cd799439001',
        restaurantId: '507f1f77bcf86cd799439201',
        itemType: 'restaurant',
        eventType: 'favorite_added',
        weight: 4,
        occurredAt: new Date('2026-06-21T08:00:00.000Z'),
        context: {
          cuisineTypes: ['viet nam'],
          priceRange: 'moderate',
          dayOfWeek: 'sunday',
          hourOfDay: 20,
          city: 'ho chi minh',
          district: '1',
        },
      },
      {
        userId: '507f1f77bcf86cd799439001',
        restaurantId: '507f1f77bcf86cd799439201',
        itemType: 'menu_item',
        itemId: '507f1f77bcf86cd799439301',
        eventType: 'menu_preordered',
        weight: 2.5,
        quantity: 2,
        occurredAt: new Date('2026-06-22T09:00:00.000Z'),
        context: {
          menuCategories: ['noodle'],
          menuTags: ['spicy'],
          priceRange: 'moderate',
          dayOfWeek: 'monday',
          hourOfDay: 19,
          numberOfGuests: 2,
          city: 'ho chi minh',
          district: '1',
        },
      },
      {
        userId: '507f1f77bcf86cd799439001',
        restaurantId: '507f1f77bcf86cd799439202',
        itemType: 'restaurant',
        eventType: 'review_negative',
        weight: -4,
        rating: 2,
        occurredAt: new Date('2026-06-23T09:00:00.000Z'),
        context: {
          cuisineTypes: ['japanese'],
          city: 'ho chi minh',
          district: '3',
        },
      },
    ],
  });

  assert.equal(result.stats.profileCount, 1);
  const profile = result.profiles[0];

  assert.equal(profile.coldStartLevel, 'light');
  assert.equal(profile.cuisineAffinity['viet nam'] > 0, true);
  assert.equal(profile.menuTagAffinity.spicy > 0, true);
  assert.equal(profile.categoryAffinity.noodle > 0, true);
  assert.equal(profile.timeSlotAffinity.dinner > 0, true);
  assert.deepEqual(profile.preferredCities, ['ho chi minh']);
  assert.deepEqual(profile.negativeRestaurantIds, ['507f1f77bcf86cd799439202']);
  assert.equal(profile.stats.completedBookingCount, 1);
  assert.equal(profile.stats.favoriteCount, 1);
  assert.equal(profile.stats.menuPreorderCount, 2);
  assert.equal(profile.restaurantHistory[0].restaurantId, '507f1f77bcf86cd799439201');
});

test('profile builder creates restaurant and menu item profiles from real source collections', async () => {
  const service = createProfileBuilderService({
    Restaurant: createCollection([
      {
        _id: '507f1f77bcf86cd799439201',
        name: 'Pho BookEat',
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
        images: [{ url: 'https://example.com/pho.jpg', isPrimary: true }],
        stats: { averageRating: 4.5 },
      },
      {
        _id: '507f1f77bcf86cd799439202',
        name: 'Inactive House',
        cuisineTypes: ['Japanese'],
        priceRange: 'expensive',
        address: { city: 'Ho Chi Minh', district: '3' },
        approvalStatus: 'pending',
        active: false,
        deletedAt: null,
      },
    ]),
    MenuItem: createCollection([
      {
        _id: '507f1f77bcf86cd799439301',
        restaurantId: '507f1f77bcf86cd799439201',
        categoryId: '507f1f77bcf86cd799439601',
        name: 'Pho Tai',
        price: 95000,
        image: 'https://example.com/pho-tai.jpg',
        tags: ['Noodle', 'Soup'],
        isAvailable: true,
        status: 'available',
      },
      {
        _id: '507f1f77bcf86cd799439302',
        restaurantId: '507f1f77bcf86cd799439202',
        categoryId: '507f1f77bcf86cd799439602',
        name: 'Hidden Item',
        price: 120000,
        tags: ['Hidden'],
        isAvailable: false,
        status: 'hidden',
      },
    ]),
    MenuCategory: createCollection([
      { _id: '507f1f77bcf86cd799439601', name: 'Pho' },
      { _id: '507f1f77bcf86cd799439602', name: 'Special' },
    ]),
    CustomerFavorite: createCollection([
      {
        _id: '507f1f77bcf86cd799439501',
        customerId: '507f1f77bcf86cd799439001',
        restaurantId: '507f1f77bcf86cd799439201',
      },
    ]),
    Review: createCollection([
      {
        _id: '507f1f77bcf86cd799439401',
        restaurantId: '507f1f77bcf86cd799439201',
        rating: 5,
        status: 'approved',
      },
      {
        _id: '507f1f77bcf86cd799439402',
        restaurantId: '507f1f77bcf86cd799439201',
        rating: 4,
        status: 'approved',
      },
    ]),
    Booking: createCollection([
      {
        _id: '507f1f77bcf86cd799439101',
        restaurantId: '507f1f77bcf86cd799439201',
        status: 'completed',
      },
      {
        _id: '507f1f77bcf86cd799439102',
        restaurantId: '507f1f77bcf86cd799439201',
        status: 'completed',
      },
    ]),
    Voucher: createCollection([
      {
        _id: '507f1f77bcf86cd799439701',
        restaurantId: '507f1f77bcf86cd799439201',
        status: 'active',
        startDate: new Date('2026-06-01T00:00:00.000Z'),
        endDate: new Date('2026-06-30T23:59:59.000Z'),
      },
    ]),
    FeaturedPlacement: createCollection([
      {
        _id: '507f1f77bcf86cd799439801',
        restaurantId: '507f1f77bcf86cd799439201',
        status: 'active',
        startAt: new Date('2026-06-01T00:00:00.000Z'),
        endAt: new Date('2026-06-30T23:59:59.000Z'),
      },
    ]),
  });

  const result = await service.buildItemProfileDocuments({
    referenceDate: new Date('2026-06-23T00:00:00.000Z'),
    interactions: [
      {
        itemType: 'menu_item',
        itemId: '507f1f77bcf86cd799439301',
        restaurantId: '507f1f77bcf86cd799439201',
        eventType: 'menu_preordered',
        quantity: 3,
        rawValue: 3,
      },
    ],
  });

  assert.equal(result.stats.restaurantProfileCount, 1);
  assert.equal(result.stats.menuItemProfileCount, 1);

  const restaurantProfile = result.profiles.find((profile) => profile.itemType === 'restaurant');
  const menuProfile = result.profiles.find((profile) => profile.itemType === 'menu_item');

  assert.equal(restaurantProfile.voucherActive, true);
  assert.equal(restaurantProfile.featuredBoostEligible, true);
  assert.equal(restaurantProfile.reviewCount, 2);
  assert.equal(restaurantProfile.bookingCount, 2);
  assert.equal(restaurantProfile.favoriteCount, 1);
  assert.equal(restaurantProfile.popularityScore > 0, true);

  assert.equal(menuProfile.categoryName, 'Pho');
  assert.equal(menuProfile.preorderCount, 3);
  assert.equal(menuProfile.isAvailable, true);
  assert.equal(menuProfile.voucherActive, true);
  assert.equal(menuProfile.featureVector.tokens.includes('category:pho'), true);
});
