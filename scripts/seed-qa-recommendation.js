'use strict';

const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const Booking = require('../src/models/Booking');
const CustomerFavorite = require('../src/models/CustomerFavorite');
const RecommendationInteraction = require('../src/models/RecommendationInteraction');
const RecommendationItemProfile = require('../src/models/RecommendationItemProfile');
const RecommendationResultCache = require('../src/models/RecommendationResultCache');
const RecommendationUserProfile = require('../src/models/RecommendationUserProfile');
const Restaurant = require('../src/models/Restaurant');
const Review = require('../src/models/Review');
const User = require('../src/models/User');

const QA_ACCOUNTS = Object.freeze({
  customerA: {
    username: 'qa_recommendation_customer_a',
    email: 'qa-recommendation-customer-a@example.test',
    fullName: 'QA Recommendation Customer A',
    role: 'customer',
  },
  customerB: {
    username: 'qa_recommendation_customer_b',
    email: 'qa-recommendation-customer-b@example.test',
    fullName: 'QA Recommendation Customer B',
    role: 'customer',
  },
  admin: {
    username: 'qa_recommendation_admin',
    email: 'qa-recommendation-admin@example.test',
    fullName: 'QA Recommendation Admin',
    role: 'admin',
  },
  owner: {
    username: 'qa_recommendation_owner',
    email: 'qa-recommendation-owner@example.test',
    fullName: 'QA Recommendation Owner',
    role: 'restaurant_owner',
  },
});

const assertSafeEnvironment = () => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('QA recommendation seed is disabled in production.');
  }

  if (process.env.QA_RECOMMENDATION_SEED_CONFIRM !== 'YES') {
    throw new Error('Set QA_RECOMMENDATION_SEED_CONFIRM=YES to acknowledge local/dev QA data changes.');
  }

  const password = String(process.env.QA_RECOMMENDATION_PASSWORD || '');
  if (password.length < 12) {
    throw new Error('QA_RECOMMENDATION_PASSWORD must contain at least 12 characters.');
  }

  if (!process.env.MONGO_URI) {
    throw new Error('Missing MONGO_URI environment variable.');
  }

  const databaseName = new URL(process.env.MONGO_URI).pathname.replace(/^\//, '').toLowerCase();
  if (databaseName.includes('prod') || databaseName.includes('production')) {
    throw new Error('Refusing to seed a database whose name looks like production.');
  }

  return password;
};

const upsertUser = async (account, password) => {
  let user = await User.findOne({
    $or: [{ username: account.username }, { email: account.email }],
  }).select('+password');

  if (!user) {
    user = new User(account);
  }

  user.username = account.username;
  user.email = account.email;
  user.fullName = account.fullName;
  user.role = account.role;
  user.password = password;
  user.emailVerified = true;
  user.active = true;
  user.phoneNumber = null;
  user.address = null;
  await user.save();
  return user;
};

const buildAffinityMap = (values) => Object.fromEntries(
  values.filter(Boolean).map((value, index) => [String(value).trim().toLowerCase(), 10 - index])
);

const main = async () => {
  const password = assertSafeEnvironment();
  await mongoose.connect(process.env.MONGO_URI);

  const [customerA, customerB, admin, owner] = await Promise.all([
    upsertUser(QA_ACCOUNTS.customerA, password),
    upsertUser(QA_ACCOUNTS.customerB, password),
    upsertUser(QA_ACCOUNTS.admin, password),
    upsertUser(QA_ACCOUNTS.owner, password),
  ]);

  const restaurantProfile = await RecommendationItemProfile.findOne({
    itemType: 'restaurant',
    isActive: true,
  }).sort({ popularityScore: -1, qualityScore: -1 });

  const restaurant = await Restaurant.findOne({
    ...(restaurantProfile ? { _id: restaurantProfile.restaurantId } : {}),
    approvalStatus: 'approved',
    active: true,
    deletedAt: null,
  }).sort({ featured: -1, 'stats.completedBookings': -1, 'stats.averageRating': -1 });

  if (!restaurant) {
    throw new Error('No approved active restaurant is available for the QA fixture.');
  }

  const fixtureMarker = 'qa-recommendation-phase11';
  const occurredAt = new Date('2026-06-01T12:00:00.000Z');

  const booking = await Booking.findOneAndUpdate(
    {
      customerId: customerA._id,
      restaurantId: restaurant._id,
      specialRequests: fixtureMarker,
    },
    {
      $set: {
        bookingDate: occurredAt,
        bookingTime: '19:00',
        numberOfGuests: 2,
        customerName: customerA.fullName,
        customerPhone: '0900000011',
        customerEmail: customerA.email,
        specialRequests: fixtureMarker,
        occasion: 'family',
        status: 'completed',
        completedAt: occurredAt,
        actualGuestCount: 2,
        reviewed: true,
        statusHistory: [{
          status: 'completed',
          changedAt: occurredAt,
          changedBy: admin._id,
          note: 'Synthetic Phase 11 QA fixture',
        }],
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );

  const favorite = await CustomerFavorite.findOneAndUpdate(
    { customerId: customerA._id, restaurantId: restaurant._id },
    { $setOnInsert: { customerId: customerA._id, restaurantId: restaurant._id } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );

  const review = await Review.findOneAndUpdate(
    { bookingId: booking._id },
    {
      $set: {
        userId: customerA._id,
        restaurantId: restaurant._id,
        rating: 5,
        title: 'QA fixture review',
        comment: 'Synthetic review for authenticated recommendation QA only.',
        status: 'approved',
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );

  await Booking.updateOne({ _id: booking._id }, {
    $set: { reviewId: review._id, reviewed: true },
  });

  const cuisineTypes = restaurantProfile?.cuisineTypes?.length
    ? restaurantProfile.cuisineTypes
    : restaurant.cuisineTypes;
  const priceRange = restaurantProfile?.priceBucket || restaurant.priceRange || 'moderate';

  const interactions = [
    {
      source: 'booking',
      sourceId: booking._id,
      eventType: 'booking_completed',
      signalClass: 'implicit',
      weight: 5,
      bookingStatus: 'completed',
      rawValue: 1,
    },
    {
      source: 'favorite',
      sourceId: favorite._id,
      eventType: 'favorite_added',
      signalClass: 'explicit',
      weight: 4,
      rawValue: 1,
    },
    {
      source: 'review',
      sourceId: review._id,
      eventType: 'review_positive',
      signalClass: 'feedback',
      weight: 5,
      rating: 5,
      rawValue: 5,
    },
  ];

  for (const interaction of interactions) {
    await RecommendationInteraction.findOneAndUpdate(
      {
        source: interaction.source,
        sourceId: interaction.sourceId,
        itemType: 'restaurant',
        itemId: restaurant._id,
      },
      {
        $set: {
          userId: customerA._id,
          itemType: 'restaurant',
          itemId: restaurant._id,
          restaurantId: restaurant._id,
          ...interaction,
          occurredAt,
          context: {
            bookingDate: occurredAt,
            bookingTime: '19:00',
            dayOfWeek: 'monday',
            hourOfDay: 19,
            numberOfGuests: 2,
            occasion: 'family',
            priceRange,
            cuisineTypes,
            city: restaurant.address?.city || null,
            district: restaurant.address?.district || null,
          },
          metadata: { fixture: fixtureMarker },
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
  }

  await RecommendationUserProfile.findOneAndUpdate(
    { userId: customerA._id },
    {
      $set: {
        coldStartLevel: 'rich',
        cuisineAffinity: buildAffinityMap(cuisineTypes),
        priceBucketAffinity: buildAffinityMap([priceRange]),
        timeSlotAffinity: { dinner: 10 },
        weekdayAffinity: { monday: 8 },
        groupSizeAffinity: { small: 10 },
        occasionAffinity: { family: 10 },
        preferredCities: restaurant.address?.city ? [restaurant.address.city] : [],
        preferredDistricts: restaurant.address?.district ? [restaurant.address.district] : [],
        restaurantHistory: [{
          restaurantId: restaurant._id,
          score: 14,
          lastInteractionAt: occurredAt,
        }],
        stats: {
          totalInteractions: 3,
          positiveInteractions: 3,
          negativeInteractions: 0,
          completedBookingCount: 1,
          favoriteCount: 1,
          positiveReviewCount: 1,
          negativeReviewCount: 0,
          menuPreorderCount: 0,
          averageSubmittedRating: 5,
          distinctRestaurantCount: 1,
          lastInteractionAt: occurredAt,
        },
        profileVersion: 1,
        generatedAt: new Date(),
        lastBuiltAt: new Date(),
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );

  await Promise.all([
    RecommendationUserProfile.deleteOne({ userId: customerB._id }),
    RecommendationInteraction.deleteMany({ userId: customerB._id }),
    RecommendationResultCache.deleteMany({ userId: { $in: [customerA._id, customerB._id] } }),
  ]);

  console.log(JSON.stringify({
    success: true,
    fixture: fixtureMarker,
    accounts: Object.values(QA_ACCOUNTS).map(({ username, role }) => ({ username, role })),
    customerA: {
      completedBooking: true,
      favorite: true,
      positiveReview: true,
      recommendationProfile: 'rich',
    },
    customerB: {
      recommendationProfile: 'none',
      expectedFallback: true,
    },
    targetRestaurant: {
      id: restaurant._id.toString(),
      name: restaurant.name,
    },
    sensitiveValuesPrinted: false,
  }, null, 2));
};

main()
  .catch((error) => {
    console.error('[seed:qa-recommendation] failed');
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
