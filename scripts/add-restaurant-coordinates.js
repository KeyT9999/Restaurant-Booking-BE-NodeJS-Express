/**
 * Script to add GeoJSON location to restaurants for MongoDB geospatial queries
 * Run: node scripts/add-restaurant-coordinates.js
 */

const mongoose = require('mongoose');

// MongoDB connection
const MONGO_URI = 'mongodb+srv://kimthangwork:kimthangwork123@kimthang.mh3rrz2.mongodb.net/BookEat?retryWrites=true&w=majority&appName=kimthang';

// Sample coordinates around Da Nang (near user location: lat 15.85, lng 108.40)
const SAMPLE_COORDINATES = [
  { lat: 15.8570, lng: 108.4020 }, // Near My Khe Beach
  { lat: 15.8620, lng: 108.4080 }, // Near Han River
  { lat: 15.8500, lng: 108.3950 }, // Near Nguyen Van Linh
  { lat: 15.8680, lng: 108.4150 }, // Near Son Tra
  { lat: 15.8550, lng: 108.4100 }, // Near My An
  { lat: 15.8470, lng: 108.3880 }, // Near Hoa Khanh
  { lat: 15.8710, lng: 108.4200 }, // Near Tho Quang
  { lat: 15.8530, lng: 108.3800 }, // Near Hai Chau
  { lat: 15.8590, lng: 108.3980 }, // Near An Cu
  { lat: 15.8750, lng: 108.4250 }, // Near Man Thai
];

async function addCoordinates() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('Connected!\n');

    // Get the Restaurant model
    const Restaurant = mongoose.model('Restaurant', new mongoose.Schema({}, { strict: false }), 'restaurants');

    // Find restaurants without GeoJSON location
    const restaurantsWithoutLocation = await Restaurant.find({
      $or: [
        { location: { $exists: false } },
        { location: null },
        { 'location.coordinates': null },
        { 'location.coordinates': { $size: 0 } },
      ]
    });

    console.log(`Found ${restaurantsWithoutLocation.length} restaurants without GeoJSON location\n`);

    if (restaurantsWithoutLocation.length === 0) {
      console.log('All restaurants already have GeoJSON location!');
      
      // Also update coordinates from location if missing
      const restaurantsWithLocationButNoCoords = await Restaurant.find({
        'location.coordinates': { $exists: true, $ne: null },
        $or: [
          { 'coordinates.latitude': { $exists: false } },
          { 'coordinates.latitude': null },
        ]
      });
      
      console.log(`\nUpdating coordinates from GeoJSON for ${restaurantsWithLocationButNoCoords.length} restaurants...`);
      
      for (const restaurant of restaurantsWithLocationButNoCoords) {
        if (restaurant.location.coordinates && restaurant.location.coordinates.length === 2) {
          await Restaurant.updateOne(
            { _id: restaurant._id },
            {
              $set: {
                'coordinates.latitude': restaurant.location.coordinates[1],
                'coordinates.longitude': restaurant.location.coordinates[0],
              }
            }
          );
          console.log(`Updated coordinates for: ${restaurant.name}`);
        }
      }
      
      return;
    }

    // Update each restaurant with GeoJSON location
    let updated = 0;
    for (let i = 0; i < restaurantsWithoutLocation.length; i++) {
      const restaurant = restaurantsWithoutLocation[i];
      const coords = SAMPLE_COORDINATES[i % SAMPLE_COORDINATES.length];

      // Add some random variation to make it more realistic
      const variation = {
        lat: (Math.random() - 0.5) * 0.01, // +/- 0.005 degrees
        lng: (Math.random() - 0.5) * 0.01,
      };

      const finalLat = coords.lat + variation.lat;
      const finalLng = coords.lng + variation.lng;

      // Update with both GeoJSON location and simple coordinates
      await Restaurant.updateOne(
        { _id: restaurant._id },
        {
          $set: {
            'location': {
              type: 'Point',
              coordinates: [finalLng, finalLat], // GeoJSON: [longitude, latitude]
            },
            'coordinates.latitude': finalLat,
            'coordinates.longitude': finalLng,
          }
        }
      );

      console.log(`Updated: ${restaurant.name}`);
      console.log(`  → GeoJSON: [${finalLng.toFixed(5)}, ${finalLat.toFixed(5)}]`);
      console.log(`  → Coords: lat=${finalLat.toFixed(5)}, lng=${finalLng.toFixed(5)}\n`);
      updated++;
    }

    console.log(`\n✅ Successfully updated ${updated} restaurants with GeoJSON location!`);
    console.log('\nNow restaurants can be queried using MongoDB geospatial queries ($geoNear).');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
    process.exit(0);
  }
}

addCoordinates();
