const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const CustomerFavorite = require('./src/models/CustomerFavorite');
const Restaurant = require('./src/models/Restaurant');
const User = require('./src/models/User');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to DB');

  const users = await User.find().lean();
  console.log('--- USERS IN DATABASE ---');
  users.forEach(u => {
    console.log(`ID: ${u._id}, Username: ${u.username}, Role: ${u.role}, Email: ${u.email}`);
  });

  const favorites = await CustomerFavorite.find().lean();
  console.log(`--- FAVORITES IN DATABASE (Total: ${favorites.length}) ---`);
  favorites.forEach(f => {
    console.log(`FavID: ${f._id}, CustomerId: ${f.customerId}, RestaurantId: ${f.restaurantId}`);
  });

  await mongoose.disconnect();
}

run().catch(console.error);
