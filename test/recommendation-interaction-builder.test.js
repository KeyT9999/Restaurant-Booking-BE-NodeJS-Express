'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createInteractionExtractorService } = require('../src/services/recommendation/interaction-extractor.service');

const createCollection = (documents) => ({
  find() {
    return {
      lean: async () => documents,
    };
  },
});

test('interaction extractor builds weighted booking, review, favorite, and menu preorder interactions', async () => {
  const service = createInteractionExtractorService({
    Booking: createCollection([
      {
        _id: '507f1f77bcf86cd799439101',
        customerId: '507f1f77bcf86cd799439001',
        restaurantId: '507f1f77bcf86cd799439201',
        bookingDate: new Date('2026-06-20T00:00:00.000Z'),
        bookingTime: '19:30',
        numberOfGuests: 2,
        occasion: 'date',
        status: 'completed',
        completedAt: new Date('2026-06-20T12:00:00.000Z'),
        createdAt: new Date('2026-06-18T12:00:00.000Z'),
        preOrderItems: [
          { menuItemId: '507f1f77bcf86cd799439301', quantity: 2 },
          { menuItemId: '507f1f77bcf86cd799439302', quantity: 1 },
        ],
      },
      {
        _id: '507f1f77bcf86cd799439102',
        customerId: '507f1f77bcf86cd799439001',
        restaurantId: '507f1f77bcf86cd799439201',
        bookingDate: new Date('2026-06-22T00:00:00.000Z'),
        bookingTime: '20:00',
        numberOfGuests: 4,
        occasion: 'family',
        status: 'completed',
        completedAt: new Date('2026-06-22T13:00:00.000Z'),
        createdAt: new Date('2026-06-21T12:00:00.000Z'),
        preOrderItems: [],
      },
      {
        _id: '507f1f77bcf86cd799439103',
        customerId: '507f1f77bcf86cd799439002',
        restaurantId: '507f1f77bcf86cd799439202',
        bookingDate: new Date('2026-06-21T00:00:00.000Z'),
        bookingTime: '12:00',
        numberOfGuests: 3,
        status: 'cancelled',
        cancelledAt: new Date('2026-06-21T08:00:00.000Z'),
        createdAt: new Date('2026-06-20T08:00:00.000Z'),
        preOrderItems: [],
      },
    ]),
    Review: createCollection([
      {
        _id: '507f1f77bcf86cd799439401',
        userId: '507f1f77bcf86cd799439001',
        restaurantId: '507f1f77bcf86cd799439201',
        rating: 5,
        status: 'approved',
        createdAt: new Date('2026-06-23T08:00:00.000Z'),
      },
      {
        _id: '507f1f77bcf86cd799439402',
        userId: '507f1f77bcf86cd799439001',
        restaurantId: '507f1f77bcf86cd799439202',
        rating: 2,
        status: 'approved',
        createdAt: new Date('2026-06-23T09:00:00.000Z'),
      },
      {
        _id: '507f1f77bcf86cd799439403',
        userId: '507f1f77bcf86cd799439001',
        restaurantId: '507f1f77bcf86cd799439202',
        rating: 4,
        status: 'hidden',
        createdAt: new Date('2026-06-23T10:00:00.000Z'),
      },
    ]),
    CustomerFavorite: createCollection([
      {
        _id: '507f1f77bcf86cd799439501',
        customerId: '507f1f77bcf86cd799439001',
        restaurantId: '507f1f77bcf86cd799439201',
        createdAt: new Date('2026-06-22T09:00:00.000Z'),
      },
    ]),
    Restaurant: createCollection([
      {
        _id: '507f1f77bcf86cd799439201',
        name: 'Pho BookEat',
        cuisineTypes: ['Viet Nam'],
        priceRange: 'moderate',
        address: { city: 'Ho Chi Minh', district: '1' },
      },
      {
        _id: '507f1f77bcf86cd799439202',
        name: 'Sushi BookEat',
        cuisineTypes: ['Japanese'],
        priceRange: 'expensive',
        address: { city: 'Ho Chi Minh', district: '3' },
      },
    ]),
    MenuItem: createCollection([
      {
        _id: '507f1f77bcf86cd799439301',
        restaurantId: '507f1f77bcf86cd799439201',
        categoryId: '507f1f77bcf86cd799439601',
        name: 'Pho Tai',
        tags: ['Noodle', 'Broth'],
      },
      {
        _id: '507f1f77bcf86cd799439302',
        restaurantId: '507f1f77bcf86cd799439201',
        categoryId: '507f1f77bcf86cd799439602',
        name: 'Cha Gio',
        tags: ['Fried'],
      },
    ]),
    MenuCategory: createCollection([
      { _id: '507f1f77bcf86cd799439601', name: 'Noodle' },
      { _id: '507f1f77bcf86cd799439602', name: 'Starter' },
    ]),
  });

  const result = await service.buildInteractionDocuments();
  assert.equal(result.stats.totalInteractions, 8);
  assert.equal(result.stats.bookingRestaurantInteractions, 3);
  assert.equal(result.stats.menuPreorderInteractions, 2);
  assert.equal(result.stats.reviewInteractions, 2);
  assert.equal(result.stats.favoriteInteractions, 1);

  const repeatedBooking = result.interactions.find((interaction) => (
    interaction.sourceId === '507f1f77bcf86cd799439102'
    && interaction.itemType === 'restaurant'
  ));
  assert.equal(repeatedBooking.weight, 7);
  assert.equal(repeatedBooking.context.dayOfWeek, 'monday');

  const preorderInteraction = result.interactions.find((interaction) => (
    interaction.itemType === 'menu_item'
    && interaction.itemId === '507f1f77bcf86cd799439301'
  ));
  assert.equal(preorderInteraction.weight, 2.5);
  assert.equal(preorderInteraction.context.menuCategories[0], 'noodle');
  assert.equal(preorderInteraction.context.menuTags.includes('broth'), true);

  const negativeReview = result.interactions.find((interaction) => (
    interaction.sourceId === '507f1f77bcf86cd799439402'
  ));
  assert.equal(negativeReview.eventType, 'review_negative');
  assert.equal(negativeReview.weight, -4);

  const cancelledBooking = result.interactions.find((interaction) => (
    interaction.sourceId === '507f1f77bcf86cd799439103'
    && interaction.eventType === 'booking_cancelled'
  ));
  assert.equal(cancelledBooking.weight, -1);
  assert.equal(Object.hasOwn(cancelledBooking.context, 'customerEmail'), false);
});

test('interaction extractor invalidates recommendation cache by user and item scope', async () => {
  const capturedFilters = [];
  const service = createInteractionExtractorService({
    RecommendationResultCache: {
      async deleteMany(filter) {
        capturedFilters.push(filter);
        return { deletedCount: 2 };
      },
    },
  });

  const invalidateUsersResult = await service.invalidateUsers(['507f1f77bcf86cd799439001']);
  const invalidateItemsResult = await service.invalidateItems({
    itemIds: ['507f1f77bcf86cd799439301'],
    restaurantIds: ['507f1f77bcf86cd799439201'],
  });

  assert.equal(invalidateUsersResult.deletedCount, 2);
  assert.equal(invalidateItemsResult.deletedCount, 2);
  assert.deepEqual(capturedFilters[0], {
    userId: { $in: ['507f1f77bcf86cd799439001'] },
  });
  assert.deepEqual(capturedFilters[1], {
    $or: [
      { 'items.itemId': { $in: ['507f1f77bcf86cd799439301'] } },
      { 'items.restaurantId': { $in: ['507f1f77bcf86cd799439201'] } },
    ],
  });
});
