const mongoose = require('mongoose');
require('dotenv').config();
const User = require('../src/models/User');

async function checkUser() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB.');

    // Search by email and search by ID
    const userByEmail = await User.findOne({ email: 'trankimthang0207@gmail.com' });
    const userById = await User.findById('6a11001ee818b2dd1a8767d3');

    console.log('User found by email:', userByEmail ? {
      _id: userByEmail._id,
      username: userByEmail.username,
      email: userByEmail.email,
      role: userByEmail.role,
    } : 'None');

    console.log('User found by ID:', userById ? {
      _id: userById._id,
      username: userById.username,
      email: userById.email,
      role: userById.role,
    } : 'None');

    await mongoose.disconnect();
    console.log('Disconnected.');
  } catch (err) {
    console.error('Error checking user:', err);
  }
}

checkUser();
