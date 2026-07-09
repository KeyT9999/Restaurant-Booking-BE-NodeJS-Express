const mongoose = require('mongoose');
require('dotenv').config();
const Restaurant = require('../src/models/Restaurant');
const MenuCategory = require('../src/models/MenuCategory');
const MenuItem = require('../src/models/MenuItem');
const RestaurantTable = require('../src/models/RestaurantTable');

async function listSamples() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB.');

    const restaurant = await Restaurant.findOne({ approvalStatus: 'approved' });
    if (restaurant) {
      console.log('--- Sample Restaurant ---');
      console.log(JSON.stringify(restaurant.toObject(), null, 2));

      const categories = await MenuCategory.find({ restaurantId: restaurant._id });
      console.log('--- Menu Categories ---');
      console.log(categories);

      const items = await MenuItem.find({ restaurantId: restaurant._id }).limit(3);
      console.log('--- Menu Items (Sample) ---');
      console.log(items);

      const tables = await RestaurantTable.find({ restaurantId: restaurant._id }).limit(3);
      console.log('--- Tables (Sample) ---');
      console.log(tables);
    } else {
      console.log('No approved restaurants found.');
    }

    await mongoose.disconnect();
  } catch (err) {
    console.error('Error listing samples:', err);
  }
}

listSamples();
