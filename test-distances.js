'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

const Restaurant = require('./src/models/Restaurant');

const testLocations = [
  { name: 'Trung tâm Đà Nẵng (Cầu Sông Hàn)', lat: 16.0544, lng: 108.0719 },
  { name: 'Bờ biển Mỹ An', lat: 15.9380, lng: 108.0247 },
  { name: 'Quận Hải Châu', lat: 16.0544, lng: 108.2022 }, // Tọa độ user test
  { name: 'Phường Mỹ An', lat: 15.9500, lng: 108.0500 },
  { name: 'ĐH Đà Nẵng', lat: 16.0747, lng: 108.1527 },
];

async function testDistances() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB\n');

    for (const loc of testLocations) {
      console.log(`\n📍 ${loc.name} (${loc.lat}, ${loc.lng}):`);
      
      const result = await Restaurant.aggregate([
        {
          $geoNear: {
            near: { type: 'Point', coordinates: [loc.lng, loc.lat] },
            distanceField: 'distance',
            maxDistance: 5000, // 5km
            spherical: true,
            query: { approvalStatus: 'approved', active: true }
          }
        },
        { $limit: 3 }
      ]);

      if (result.length === 0) {
        console.log('   Không có nhà hàng trong bán kính 5km');
      } else {
        result.forEach((r, i) => {
          console.log(`   ${i + 1}. ${r.name}: ${(r.distance / 1000).toFixed(2)}km`);
        });
      }
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

testDistances();
