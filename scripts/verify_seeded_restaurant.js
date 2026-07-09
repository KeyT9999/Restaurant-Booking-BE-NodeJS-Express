const mongoose = require('mongoose');
require('dotenv').config();

const Restaurant = require('../src/models/Restaurant');
const MenuCategory = require('../src/models/MenuCategory');
const MenuItem = require('../src/models/MenuItem');
const RestaurantTable = require('../src/models/RestaurantTable');

async function verify() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB.');

    const rest = await Restaurant.findOne({ name: 'Bánh Xèo Bà Dưỡng' });
    if (!rest) {
      console.error('❌ Verification failed: Restaurant not found!');
      await mongoose.disconnect();
      return;
    }

    console.log('✅ Found restaurant:', {
      id: rest._id,
      name: rest.name,
      approvalStatus: rest.approvalStatus,
      ownerId: rest.ownerId,
      fullAddress: rest.address.fullAddress,
      coords: rest.coordinates
    });

    const categoryCount = await MenuCategory.countDocuments({ restaurantId: rest._id });
    const itemCount = await MenuItem.countDocuments({ restaurantId: rest._id });
    const tableCount = await RestaurantTable.countDocuments({ restaurantId: rest._id });

    console.log(`✅ Associated documents:`);
    console.log(`  - Menu Categories: ${categoryCount} (expected 3)`);
    console.log(`  - Menu Items: ${itemCount} (expected 6)`);
    console.log(`  - Tables: ${tableCount} (expected 8)`);

    const items = await MenuItem.find({ restaurantId: rest._id }).populate('categoryId');
    console.log('\n✅ Sample Menu Items with Categories:');
    items.forEach(item => {
      console.log(`  - Món: ${item.name} (${item.price} VND) | Danh mục: ${item.categoryId ? item.categoryId.name : 'N/A'}`);
    });

    const tables = await RestaurantTable.find({ restaurantId: rest._id });
    console.log('\n✅ Tables details:');
    tables.forEach(table => {
      console.log(`  - Bàn: ${table.tableNumber} | Sức chứa: ${table.capacity} | Khu vực: ${table.zone} | Đặt cọc: ${table.depositAmount} VND`);
    });

    await mongoose.disconnect();
  } catch (err) {
    console.error('Verification error:', err);
  }
}

verify();
