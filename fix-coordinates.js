'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

const Restaurant = require('./src/models/Restaurant');

// Tọa độ đúng cho các nhà hàng (sử dụng Google Maps để xác minh)
const correctCoordinates = {
  'Phở Thìn': { latitude: 16.0120, longitude: 108.0690 }, // 42 Đà Thành, Hòa Hải
  'Nhà hàng ăn chay': { latitude: 16.0150, longitude: 108.0710 }, // Khu đô thị FPT, gần đó
  'Nhà Hàng 123': { latitude: 16.0140, longitude: 108.0685 }, // 123 Đường Thí Nghiệm, gần đó
  'Bún Đậu Ông Chú': { latitude: 16.0130, longitude: 108.0700 }, // Gần 42 Đà Thành
  'Bún chả cá': { latitude: 16.0115, longitude: 108.0688 }, // Gần khu vực Đà Thành
  'Sen Vàng - Vietnamese Premium Dining': { latitude: 16.0160, longitude: 108.0720 }, // Khu vực FPT
};

async function fixCoordinates() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB\n');

    let updated = 0;

    for (const [name, coords] of Object.entries(correctCoordinates)) {
      const restaurant = await Restaurant.findOne({ 
        name: { $regex: new RegExp(name, 'i') },
        approvalStatus: 'approved'
      });

      if (restaurant) {
        console.log(`Updating: ${restaurant.name}`);
        console.log(`  Old: ${restaurant.coordinates.latitude?.toFixed(4)}, ${restaurant.coordinates.longitude?.toFixed(4)}`);
        console.log(`  New: ${coords.latitude}, ${coords.longitude}`);

        restaurant.coordinates.latitude = coords.latitude;
        restaurant.coordinates.longitude = coords.longitude;
        restaurant.location = {
          type: 'Point',
          coordinates: [coords.longitude, coords.latitude] // GeoJSON: [lng, lat]
        };

        await restaurant.save();
        updated++;
        console.log('  ✅ Updated\n');
      } else {
        console.log(`Not found: ${name}\n`);
      }
    }

    console.log(`\nTotal updated: ${updated} restaurants`);

    // Verify with test
    console.log('\n--- Testing with center of Da Nang (16.0544, 108.0719) ---');
    
    const result = await Restaurant.aggregate([
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [108.0719, 16.0544] },
          distanceField: 'distance',
          maxDistance: 5000,
          spherical: true,
          query: { approvalStatus: 'approved', active: true }
        }
      },
      { $limit: 5 }
    ]);

    console.log(`\nFound ${result.length} restaurants within 5km:`);
    result.forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.name}: ${(r.distance / 1000).toFixed(2)}km`);
    });

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixCoordinates();
