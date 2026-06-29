const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const User = require('../src/models/User');
const Restaurant = require('../src/models/Restaurant');
const MenuCategory = require('../src/models/MenuCategory');
const MenuItem = require('../src/models/MenuItem');
const RestaurantTable = require('../src/models/RestaurantTable');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to DB');

  const user = await User.findOne({ email: 'molonfa@gmail.com' });
  if (!user) {
    console.log('User molonfa@gmail.com NOT found!');
  } else {
    console.log('User found:', {
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      active: user.active
    });

    const restaurants = await Restaurant.find({ ownerId: user._id });
    console.log(`Found ${restaurants.length} restaurants for this owner:`);
    for (const r of restaurants) {
      console.log(`- ID: ${r._id}, Name: ${r.name}, Status: ${r.approvalStatus}`);
      const categories = await MenuCategory.find({ restaurantId: r._id });
      console.log(`  Categories (${categories.length}):`, categories.map(c => c.name));
      const items = await MenuItem.find({ restaurantId: r._id });
      console.log(`  Menu Items (${items.length}):`, items.map(i => i.name));
      const tables = await RestaurantTable.find({ restaurantId: r._id });
      console.log(`  Tables (${tables.length})`);
    }
  }

  await mongoose.disconnect();
}

run().catch(console.error);
