const mongoose = require('mongoose');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const axios = require('axios');
dotenv.config();

const User = require('./src/models/User');
const Restaurant = require('./src/models/Restaurant');

const getJwtSecret = () => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  return 'bookeat_dev_secret_change_me';
};

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to DB');

  const customer = await User.findOne({ username: 'kimthang_work' });
  if (!customer) {
    console.error('Customer kimthang_work not found');
    await mongoose.disconnect();
    return;
  }

  const restaurant = await Restaurant.findOne({ approvalStatus: 'approved', active: true });
  if (!restaurant) {
    console.error('No approved, active restaurant found');
    await mongoose.disconnect();
    return;
  }

  console.log(`Testing with user: ${customer.username} (ID: ${customer._id})`);
  console.log(`Testing with restaurant: ${restaurant.name} (ID: ${restaurant._id})`);

  // Generate JWT token
  const userId = customer._id.toString();
  const token = jwt.sign(
    { id: userId, sub: userId, username: customer.username, role: customer.role },
    getJwtSecret(),
    { expiresIn: '7d' }
  );

  console.log('Generated JWT Token:', token);

  const instance = axios.create({
    baseURL: 'http://localhost:3001/api/v1',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  try {
    console.log('\n--- 1. Testing GET /customer/favorites ---');
    const getRes = await instance.get('/customer/favorites');
    console.log('GET Response success:', getRes.data.success);
    console.log('GET Response length:', getRes.data.data.length);

    console.log('\n--- 2. Testing POST /customer/favorites ---');
    const postRes = await instance.post('/customer/favorites', { restaurantId: restaurant._id.toString() });
    console.log('POST Response success:', postRes.data.success);
    console.log('POST Response data:', postRes.data.data);

    console.log('\n--- 3. Testing GET /customer/favorites again ---');
    const getRes2 = await instance.get('/customer/favorites');
    console.log('GET 2 Response success:', getRes2.data.success);
    console.log('GET 2 Response length:', getRes2.data.data.length);
    if (getRes2.data.data.length > 0) {
      console.log('First Item populated restaurantId:', getRes2.data.data[0].restaurantId);
    }

    console.log('\n--- 4. Testing DELETE /customer/favorites/:id ---');
    const delRes = await instance.delete(`/customer/favorites/${restaurant._id.toString()}`);
    console.log('DELETE Response success:', delRes.data.success);

  } catch (error) {
    if (error.response) {
      console.error('HTTP Error Status:', error.response.status);
      console.error('HTTP Error Data:', error.response.data);
    } else {
      console.error('Network/Internal error:', error.message);
    }
  }

  await mongoose.disconnect();
}

run().catch(console.error);
