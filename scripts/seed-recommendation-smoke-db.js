'use strict';

const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const Booking = require('../src/models/Booking');
const CustomerFavorite = require('../src/models/CustomerFavorite');
const MenuCategory = require('../src/models/MenuCategory');
const MenuItem = require('../src/models/MenuItem');
const RecommendationInteraction = require('../src/models/RecommendationInteraction');
const RecommendationItemProfile = require('../src/models/RecommendationItemProfile');
const RecommendationResultCache = require('../src/models/RecommendationResultCache');
const RecommendationRun = require('../src/models/RecommendationRun');
const RecommendationUserProfile = require('../src/models/RecommendationUserProfile');
const Restaurant = require('../src/models/Restaurant');
const Review = require('../src/models/Review');
const User = require('../src/models/User');

const FIXTURE_TAG = 'recommendation-smoke-phase13';
const DEFAULT_PASSWORD = 'BookEat-QA-Phase13!';

const QA_USERS = Object.freeze({
  admin: {
    username: 'smoke_recommendation_admin',
    email: 'smoke-recommendation-admin@example.test',
    fullName: 'Smoke Recommendation Admin',
    role: 'admin',
  },
  owner: {
    username: 'smoke_recommendation_owner',
    email: 'smoke-recommendation-owner@example.test',
    fullName: 'Smoke Recommendation Owner',
    role: 'restaurant_owner',
  },
  customerA: {
    username: 'smoke_recommendation_customer_a',
    email: 'smoke-recommendation-customer-a@example.test',
    fullName: 'Smoke Recommendation Customer A',
    role: 'customer',
  },
  customerB: {
    username: 'smoke_recommendation_customer_b',
    email: 'smoke-recommendation-customer-b@example.test',
    fullName: 'Smoke Recommendation Customer B',
    role: 'customer',
  },
});

const RESTAURANT_FIXTURES = Object.freeze([
  {
    key: 'pho-dat-viet',
    name: 'Pho Dat Viet Smoke',
    cuisineTypes: ['Viet Nam'],
    priceRange: 'moderate',
    averagePrice: 120000,
    address: {
      street: '101 Smoke Street',
      ward: 'Ben Nghe',
      district: '1',
      city: 'Ho Chi Minh',
      fullAddress: '101 Smoke Street, Ben Nghe, District 1, Ho Chi Minh',
    },
    coordinates: { latitude: 10.776, longitude: 106.701 },
    phoneNumber: '0900001101',
    email: 'pho-dat-viet-smoke@example.test',
    description: 'Synthetic smoke-test pho restaurant for recommendation rebuild.',
    featured: true,
    stats: { totalBookings: 12, completedBookings: 10, cancelledBookings: 1, averageRating: 4.8, totalReviews: 6 },
  },
  {
    key: 'bun-bo-social',
    name: 'Bun Bo Social Smoke',
    cuisineTypes: ['Viet Nam'],
    priceRange: 'budget',
    averagePrice: 90000,
    address: {
      street: '202 Smoke Avenue',
      ward: 'Vo Thi Sau',
      district: '3',
      city: 'Ho Chi Minh',
      fullAddress: '202 Smoke Avenue, Vo Thi Sau, District 3, Ho Chi Minh',
    },
    coordinates: { latitude: 10.784, longitude: 106.688 },
    phoneNumber: '0900002202',
    email: 'bun-bo-social-smoke@example.test',
    description: 'Synthetic smoke-test bun bo restaurant for recommendation rebuild.',
    featured: false,
    stats: { totalBookings: 8, completedBookings: 7, cancelledBookings: 1, averageRating: 4.5, totalReviews: 4 },
  },
  {
    key: 'sushi-combo-lab',
    name: 'Sushi Combo Lab Smoke',
    cuisineTypes: ['Japanese'],
    priceRange: 'expensive',
    averagePrice: 320000,
    address: {
      street: '303 Smoke Road',
      ward: 'Da Kao',
      district: '1',
      city: 'Ho Chi Minh',
      fullAddress: '303 Smoke Road, Da Kao, District 1, Ho Chi Minh',
    },
    coordinates: { latitude: 10.781, longitude: 106.705 },
    phoneNumber: '0900003303',
    email: 'sushi-combo-lab-smoke@example.test',
    description: 'Synthetic smoke-test sushi restaurant for recommendation rebuild.',
    featured: false,
    stats: { totalBookings: 6, completedBookings: 5, cancelledBookings: 0, averageRating: 4.7, totalReviews: 3 },
  },
]);

const buildOperatingHours = () => ({
  monday: { open: '08:00', close: '22:00', closed: false },
  tuesday: { open: '08:00', close: '22:00', closed: false },
  wednesday: { open: '08:00', close: '22:00', closed: false },
  thursday: { open: '08:00', close: '22:00', closed: false },
  friday: { open: '08:00', close: '22:00', closed: false },
  saturday: { open: '08:00', close: '22:00', closed: false },
  sunday: { open: '08:00', close: '22:00', closed: false },
});

const assertSafeEnvironment = () => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Recommendation smoke seed is disabled in production.');
  }

  if (process.env.RECOMMENDATION_SMOKE_SEED_CONFIRM !== 'YES') {
    throw new Error('Set RECOMMENDATION_SMOKE_SEED_CONFIRM=YES before seeding the isolated smoke DB.');
  }

  if (!process.env.MONGO_URI) {
    throw new Error('Missing MONGO_URI environment variable.');
  }

  const databaseName = new URL(process.env.MONGO_URI).pathname.replace(/^\//, '').toLowerCase();
  if (!databaseName) {
    throw new Error('Cannot determine database name from MONGO_URI.');
  }

  if (databaseName.includes('prod') || databaseName.includes('production')) {
    throw new Error('Refusing to seed a database whose name looks like production.');
  }

  if (!databaseName.includes('smoke') && !databaseName.includes('test') && !databaseName.includes('isolated')) {
    throw new Error('Recommendation smoke seed requires a test-only database name containing smoke/test/isolated.');
  }

  const password = String(process.env.QA_RECOMMENDATION_PASSWORD || DEFAULT_PASSWORD);
  if (password.length < 12) {
    throw new Error('QA_RECOMMENDATION_PASSWORD must contain at least 12 characters.');
  }

  return { databaseName, password };
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

const upsertRestaurant = async ({ ownerId, fixture }) => Restaurant.findOneAndUpdate(
  {
    ownerId,
    name: fixture.name,
    email: fixture.email,
  },
  {
    $set: {
      ownerId,
      name: fixture.name,
      description: fixture.description,
      phoneNumber: fixture.phoneNumber,
      email: fixture.email,
      websiteUrl: null,
      contactHotline: null,
      contactSecondaryPhone: null,
      address: fixture.address,
      coordinates: fixture.coordinates,
      cuisineTypes: fixture.cuisineTypes,
      priceRange: fixture.priceRange,
      capacity: 24,
      operatingHours: buildOperatingHours(),
      images: [{
        url: `https://example.test/assets/${fixture.key}.jpg`,
        caption: `${fixture.name} primary image`,
        isPrimary: true,
      }],
      logo: null,
      coverImage: null,
      galleryImages: [],
      averagePrice: fixture.averagePrice,
      priceRangeMin: Math.max(50000, fixture.averagePrice - 30000),
      priceRangeMax: fixture.averagePrice + 60000,
      statusMessage: null,
      bookingInformation: null,
      bookingNotes: null,
      summaryHighlights: 'Synthetic smoke fixture',
      suitableFor: ['family', 'friends'],
      signatureDishes: [`${fixture.name} signature`],
      amenities: ['wifi'],
      policyRules: ['Synthetic smoke data only'],
      approvalStatus: 'approved',
      approvedBy: ownerId,
      approvedAt: new Date('2026-06-01T08:00:00.000Z'),
      active: true,
      featured: fixture.featured,
      hasMenu: true,
      hasTableLayout: false,
      stats: fixture.stats,
    },
  },
  { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
);

const upsertCategory = async ({ restaurantId, name, displayOrder }) => MenuCategory.findOneAndUpdate(
  { restaurantId, name },
  {
    $set: {
      restaurantId,
      name,
      description: `${name} category for smoke rebuild`,
      displayOrder,
      isActive: true,
    },
  },
  { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
);

const upsertMenuItem = async ({
  restaurantId,
  categoryId,
  name,
  price,
  tags,
  displayOrder,
}) => MenuItem.findOneAndUpdate(
  { restaurantId, name },
  {
    $set: {
      restaurantId,
      categoryId,
      name,
      description: `${name} menu item for smoke rebuild`,
      price,
      image: `https://example.test/assets/${name.toLowerCase().replace(/\s+/g, '-')}.jpg`,
      isAvailable: true,
      status: 'available',
      preparationTime: 15,
      tags,
      displayOrder,
    },
  },
  { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
);

const resetDerivedCollections = async () => Promise.all([
  RecommendationInteraction.deleteMany({}),
  RecommendationUserProfile.deleteMany({}),
  RecommendationItemProfile.deleteMany({}),
  RecommendationResultCache.deleteMany({}),
  RecommendationRun.deleteMany({}),
]);

const main = async () => {
  const { databaseName, password } = assertSafeEnvironment();
  await mongoose.connect(process.env.MONGO_URI);

  const [admin, owner, customerA, customerB] = await Promise.all([
    upsertUser(QA_USERS.admin, password),
    upsertUser(QA_USERS.owner, password),
    upsertUser(QA_USERS.customerA, password),
    upsertUser(QA_USERS.customerB, password),
  ]);

  const restaurants = [];
  for (const fixture of RESTAURANT_FIXTURES) {
    restaurants.push(await upsertRestaurant({ ownerId: owner._id, fixture }));
  }

  const categories = {
    pho: await upsertCategory({ restaurantId: restaurants[0]._id, name: 'Pho', displayOrder: 1 }),
    soup: await upsertCategory({ restaurantId: restaurants[1]._id, name: 'Soup', displayOrder: 1 }),
    combo: await upsertCategory({ restaurantId: restaurants[2]._id, name: 'Combo', displayOrder: 1 }),
  };

  const menuItems = [];
  menuItems.push(await upsertMenuItem({
    restaurantId: restaurants[0]._id,
    categoryId: categories.pho._id,
    name: 'Pho Tai Smoke',
    price: 95000,
    tags: ['broth', 'noodle'],
    displayOrder: 1,
  }));
  menuItems.push(await upsertMenuItem({
    restaurantId: restaurants[1]._id,
    categoryId: categories.soup._id,
    name: 'Bun Bo Spicy Smoke',
    price: 90000,
    tags: ['spicy', 'noodle'],
    displayOrder: 1,
  }));
  menuItems.push(await upsertMenuItem({
    restaurantId: restaurants[2]._id,
    categoryId: categories.combo._id,
    name: 'Sushi Combo Smoke',
    price: 290000,
    tags: ['sushi', 'fresh'],
    displayOrder: 1,
  }));

  const bookingDate = new Date('2026-06-15T12:00:00.000Z');
  const booking = await Booking.findOneAndUpdate(
    {
      customerId: customerA._id,
      restaurantId: restaurants[0]._id,
      specialRequests: FIXTURE_TAG,
    },
    {
      $set: {
        customerId: customerA._id,
        restaurantId: restaurants[0]._id,
        bookingDate,
        bookingTime: '19:00',
        numberOfGuests: 2,
        customerName: customerA.fullName,
        customerPhone: '0900004404',
        customerEmail: customerA.email,
        specialRequests: FIXTURE_TAG,
        occasion: 'family',
        status: 'completed',
        completedAt: bookingDate,
        actualGuestCount: 2,
        reviewed: true,
        originalAmount: 240000,
        finalAmount: 240000,
        preOrderItems: [{
          menuItemId: menuItems[0]._id,
          nameSnapshot: menuItems[0].name,
          priceSnapshot: menuItems[0].price,
          quantity: 2,
          note: null,
        }],
        statusHistory: [{
          status: 'completed',
          changedAt: bookingDate,
          changedBy: admin._id,
          note: 'Synthetic smoke fixture booking',
        }],
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );

  const favorite = await CustomerFavorite.findOneAndUpdate(
    { customerId: customerA._id, restaurantId: restaurants[0]._id },
    { $setOnInsert: { customerId: customerA._id, restaurantId: restaurants[0]._id } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );

  const review = await Review.findOneAndUpdate(
    { bookingId: booking._id },
    {
      $set: {
        bookingId: booking._id,
        userId: customerA._id,
        restaurantId: restaurants[0]._id,
        rating: 5,
        title: 'Smoke fixture review',
        comment: 'Synthetic positive review for isolated recommendation smoke testing.',
        status: 'approved',
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );

  await Booking.updateOne(
    { _id: booking._id },
    { $set: { reviewId: review._id, reviewed: true } },
  );

  await RecommendationInteraction.deleteMany({ userId: customerB._id });
  await RecommendationUserProfile.deleteMany({ userId: customerB._id });
  await RecommendationResultCache.deleteMany({ userId: { $in: [customerA._id, customerB._id] } });
  await resetDerivedCollections();

  console.log(JSON.stringify({
    success: true,
    fixture: FIXTURE_TAG,
    databaseName,
    testOnlyConfirmed: true,
    accounts: Object.values(QA_USERS).map(({ username, role }) => ({ username, role })),
    restaurantCount: restaurants.length,
    menuItemCount: menuItems.length,
    bookingFixture: {
      customerACompletedBooking: true,
      customerAFavorite: Boolean(favorite),
      customerAPositiveReview: true,
      customerBFallbackExpected: true,
    },
    recommendationCollectionsReset: true,
    sensitiveValuesPrinted: false,
  }, null, 2));
};

main()
  .catch((error) => {
    console.error('[seed:recommendation-smoke] failed');
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
