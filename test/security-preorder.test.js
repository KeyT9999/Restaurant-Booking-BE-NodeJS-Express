'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const User = require('../src/models/User');
const Restaurant = require('../src/models/Restaurant');
const MenuCategory = require('../src/models/MenuCategory');
const MenuItem = require('../src/models/MenuItem');
const ownerMenuController = require('../src/controllers/owner.menu.controller');
const { buildCanonicalPreOrder } = require('../src/services/preorder.service');

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const cleanup = async (suffix) => {
  const restaurants = await Restaurant.find({ name: new RegExp(`^${suffix}`) }).select('_id');
  const ids = restaurants.map((item) => item._id);
  await MenuItem.deleteMany({ restaurantId: { $in: ids } });
  await MenuCategory.deleteMany({ restaurantId: { $in: ids } });
  await Restaurant.deleteMany({ _id: { $in: ids } });
  await User.deleteMany({ username: new RegExp(`^${suffix}`) });
};

test.before(async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required for security/preorder tests');
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  }
});

test.after(async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
});

test('category ownership is checked before update and preorder snapshots come only from DB', async () => {
  const suffix = `SECURITY_PREORDER_${Date.now()}`;
  await cleanup(suffix);
  try {
    const owners = await User.create([
      {
        username: `${suffix}_owner_a`, email: `${suffix}_a@example.com`, password: 'Password123!',
        fullName: 'Owner A', role: 'restaurant_owner', emailVerified: true,
      },
      {
        username: `${suffix}_owner_b`, email: `${suffix}_b@example.com`, password: 'Password123!',
        fullName: 'Owner B', role: 'restaurant_owner', emailVerified: true,
      },
    ]);
    const restaurantPayload = (owner, marker) => ({
      ownerId: owner._id,
      name: `${suffix} Restaurant ${marker}`,
      description: 'Security fixture',
      phoneNumber: marker === 'A' ? '0901234561' : '0901234562',
      email: `${suffix}_${marker.toLowerCase()}_restaurant@example.com`,
      address: { street: '1 Test', ward: 'Ward', district: 'District', city: 'City' },
      approvalStatus: 'approved', active: true,
    });
    const [restaurantA, restaurantB] = await Restaurant.create([
      restaurantPayload(owners[0], 'A'),
      restaurantPayload(owners[1], 'B'),
    ]);
    const [categoryA, categoryB] = await MenuCategory.create([
      { restaurantId: restaurantA._id, name: `${suffix} Category A` },
      { restaurantId: restaurantB._id, name: `${suffix} Category B` },
    ]);

    const forbiddenResponse = response();
    await ownerMenuController.updateCategory({
      user: owners[0],
      params: { id: categoryB._id.toString() },
      body: { name: 'HACKED CATEGORY' },
    }, forbiddenResponse);
    assert.equal(forbiddenResponse.statusCode, 403);
    assert.equal((await MenuCategory.findById(categoryB._id)).name, `${suffix} Category B`);

    const [available, foreign, inactive] = await MenuItem.create([
      {
        restaurantId: restaurantA._id, categoryId: categoryA._id,
        name: 'Canonical Dish', price: 50000, isAvailable: true, status: 'available',
      },
      {
        restaurantId: restaurantB._id, categoryId: categoryB._id,
        name: 'Foreign Dish', price: 70000, isAvailable: true, status: 'available',
      },
      {
        restaurantId: restaurantA._id, categoryId: categoryA._id,
        name: 'Inactive Dish', price: 90000, isAvailable: false, status: 'unavailable',
      },
    ]);

    const canonical = await buildCanonicalPreOrder({
      restaurantId: restaurantA._id,
      items: [{
        menuItemId: available._id,
        quantity: 2,
        name: 'Client-forged name',
        price: 1,
        priceSnapshot: 1,
      }],
    });
    assert.equal(canonical.items[0].nameSnapshot, 'Canonical Dish');
    assert.equal(canonical.items[0].priceSnapshot, 50000);
    assert.equal(canonical.totalAmount, 100000);

    await assert.rejects(
      buildCanonicalPreOrder({
        restaurantId: restaurantA._id,
        items: [{ menuItemId: foreign._id, quantity: 1 }],
      }),
      (error) => error.code === 'PREORDER_ITEM_UNAVAILABLE',
    );
    await assert.rejects(
      buildCanonicalPreOrder({
        restaurantId: restaurantA._id,
        items: [{ menuItemId: inactive._id, quantity: 1 }],
      }),
      (error) => error.code === 'PREORDER_ITEM_UNAVAILABLE',
    );
  } finally {
    await cleanup(suffix);
  }
});
