const mongoose = require('mongoose');
require('dotenv').config();

const Restaurant = require('../src/models/Restaurant');
const MenuCategory = require('../src/models/MenuCategory');
const MenuItem = require('../src/models/MenuItem');
const RestaurantTable = require('../src/models/RestaurantTable');

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB.');

    const ownerId = new mongoose.Types.ObjectId('6a11001ee818b2dd1a8767d3');
    const adminId = new mongoose.Types.ObjectId('6a0ec0dcdf36c1ea3ac49c87');

    // 1. Delete existing Bánh Xèo Bà Dưỡng restaurant (and related categories, items, tables) to avoid duplicates
    const existing = await Restaurant.findOne({ name: 'Bánh Xèo Bà Dưỡng', ownerId });
    if (existing) {
      console.log('Found existing Bánh Xèo Bà Dưỡng restaurant. Cleaning up old data...');
      await MenuItem.deleteMany({ restaurantId: existing._id });
      await MenuCategory.deleteMany({ restaurantId: existing._id });
      await RestaurantTable.deleteMany({ restaurantId: existing._id });
      await Restaurant.deleteOne({ _id: existing._id });
      console.log('Cleanup completed.');
    }

    // 2. Create Restaurant
    const restaurantData = {
      ownerId,
      name: 'Bánh Xèo Bà Dưỡng',
      description: 'Bánh Xèo Bà Dưỡng là thương hiệu ẩm thực đặc sản lâu đời và nổi tiếng bậc nhất Đà Nẵng với tuổi đời hơn 30 năm. Quán luôn thu hút đông đảo thực khách nhờ món bánh xèo vỏ giòn tan vàng ươm, nhân tôm thịt đậm đà kết hợp với nước chấm pate gan béo ngậy được chế biến theo công thức gia truyền riêng biệt. Không gian bình dị, gần gũi, mang đậm phong vị ẩm thực đường phố miền Trung.',
      phoneNumber: '02363873168',
      email: 'banhxeobaduongdn@gmail.com',
      address: {
        street: 'K280/23 Hoàng Diệu',
        ward: 'Bình Hiên',
        district: 'Hải Châu',
        city: 'Đà Nẵng',
        fullAddress: 'K280/23 Hoàng Diệu, Bình Hiên, Hải Châu, Đà Nẵng'
      },
      coordinates: {
        latitude: 16.0581,
        longitude: 108.2173
      },
      location: {
        type: 'Point',
        coordinates: [108.2173, 16.0581]
      },
      cuisineTypes: ['Việt Nam', 'Đặc sản', 'Món cuốn'],
      priceRange: 'moderate',
      capacity: 150,
      operatingHours: {
        monday: { open: '09:00', close: '21:30', closed: false },
        tuesday: { open: '09:00', close: '21:30', closed: false },
        wednesday: { open: '09:00', close: '21:30', closed: false },
        thursday: { open: '09:00', close: '21:30', closed: false },
        friday: { open: '09:00', close: '21:30', closed: false },
        saturday: { open: '09:00', close: '21:30', closed: false },
        sunday: { open: '09:00', close: '21:30', closed: false }
      },
      averagePrice: 60000,
      priceRangeMin: 20000,
      priceRangeMax: 150000,
      statusMessage: 'Mở cửa đón khách từ 9:00 sáng đến 9:30 tối hàng ngày',
      bookingNotes: 'Quý khách nên đặt bàn trước ít nhất 30 phút, đặc biệt vào giờ cao điểm từ 18:00 - 20:00. Bàn đặt được giữ tối đa 15 phút so với thời gian đã hẹn.',
      summaryHighlights: 'Vỏ bánh giòn rụm, nước sốt chấm pate gan siêu ngon, nem lụi nướng than hoa thơm nức, địa chỉ ẩm thực không thể bỏ qua khi ghé Đà Nẵng.',
      suitableFor: ['Gia đình', 'Bạn bè', 'Khách du lịch', 'Ăn trưa', 'Ăn tối'],
      signatureDishes: ['Bánh xèo đặc biệt', 'Nem lụi nướng'],
      amenities: ['Wifi miễn phí', 'Có máy điều hòa (Phòng VIP)', 'Chỗ đậu xe máy rộng rãi'],
      policyRules: ['Không mang đồ ăn nước uống từ ngoài vào', 'Giữ gìn vệ sinh chung'],
      approvalStatus: 'approved',
      approvedBy: adminId,
      approvedAt: new Date(),
      active: true,
      featured: true,
      hasMenu: true,
      hasTableLayout: true,
      commissionRate: 10,
      images: [
        {
          url: 'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=1000&q=80',
          caption: 'Không gian món ăn Bánh Xèo Bà Dưỡng',
          isPrimary: true
        }
      ],
      coverImage: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1200&q=80',
      logo: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=200&q=80',
      galleryImages: [
        'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&q=80',
        'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=800&q=80',
        'https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=800&q=80'
      ]
    };

    const restaurant = await Restaurant.create(restaurantData);
    console.log(`Created Restaurant "Bánh Xèo Bà Dưỡng" with ID: ${restaurant._id}`);

    // 3. Create Menu Categories
    const categoriesData = [
      { restaurantId: restaurant._id, name: 'Bánh Xèo & Nem Lụi', description: 'Món đặc sản chính làm nên thương hiệu Bà Dưỡng', displayOrder: 1 },
      { restaurantId: restaurant._id, name: 'Món Ăn Kèm', description: 'Các món ăn kèm ngon miệng', displayOrder: 2 },
      { restaurantId: restaurant._id, name: 'Giải Khát', description: 'Nước uống mát lạnh xua tan cái nóng', displayOrder: 3 }
    ];

    const categories = await MenuCategory.insertMany(categoriesData);
    console.log(`Inserted ${categories.length} Menu Categories.`);

    const catBanhXeo = categories.find(c => c.name === 'Bánh Xèo & Nem Lụi')._id;
    const catAnKem = categories.find(c => c.name === 'Món Ăn Kèm')._id;
    const catNuoc = categories.find(c => c.name === 'Giải Khát')._id;

    // 4. Create Menu Items
    const menuItemsData = [
      {
        restaurantId: restaurant._id,
        categoryId: catBanhXeo,
        name: 'Bánh xèo đặc biệt',
        description: 'Vỏ bánh giòn rụm vàng ươm từ bột gạo và nghệ, nhân ngập tràn tôm sông tươi, thịt heo rim nấm, và giá đỗ, ăn kèm rau sống xanh mướt và nước chấm đặc trưng.',
        price: 60000,
        image: 'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=600&q=80',
        isAvailable: true,
        status: 'available',
        preparationTime: 10,
        tags: ['Bán chạy nhất', 'Khuyên dùng'],
        displayOrder: 1
      },
      {
        restaurantId: restaurant._id,
        categoryId: catBanhXeo,
        name: 'Nem lụi nướng',
        description: 'Nem làm từ thịt heo giã nhuyễn trộn gia vị, quấn quanh sả cây nướng chín vàng trên than hồng thơm lừng béo ngậy. Giá tính theo cây.',
        price: 8000,
        image: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=600&q=80',
        isAvailable: true,
        status: 'available',
        preparationTime: 8,
        tags: ['Món kèm phổ biến'],
        displayOrder: 2
      },
      {
        restaurantId: restaurant._id,
        categoryId: catAnKem,
        name: 'Bún thịt nướng',
        description: 'Bún tươi ăn kèm thịt nướng xiên thơm ngon, rau sống thái nhỏ, đậu phộng rang giòn và rưới sốt tương đậu phộng đặc chế.',
        price: 35000,
        image: 'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=600&q=80',
        isAvailable: true,
        status: 'available',
        preparationTime: 5,
        tags: ['Ăn no'],
        displayOrder: 3
      },
      {
        restaurantId: restaurant._id,
        categoryId: catAnKem,
        name: 'Đĩa rau sống thêm',
        description: 'Đĩa rau sống tươi ngon đầy đặn gồm xà lách, cải con, dưa leo, khế chua, chuối chát thái mỏng.',
        price: 10000,
        image: 'https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=600&q=80',
        isAvailable: true,
        status: 'available',
        preparationTime: 2,
        tags: [],
        displayOrder: 4
      },
      {
        restaurantId: restaurant._id,
        categoryId: catNuoc,
        name: 'Nước mía nguyên chất',
        description: 'Ly nước mía ép tươi kèm quất giải nhiệt cực tốt, phù hợp nhất khi ăn bánh xèo.',
        price: 12000,
        image: 'https://images.unsplash.com/photo-1541658016709-82535e94bc69?w=600&q=80',
        isAvailable: true,
        status: 'available',
        preparationTime: 3,
        tags: ['Giải nhiệt'],
        displayOrder: 5
      },
      {
        restaurantId: restaurant._id,
        categoryId: catNuoc,
        name: 'Bia Larue Đà Nẵng',
        description: 'Lon bia Larue mát lạnh đặc trưng vùng đất Quảng Nam - Đà Nẵng.',
        price: 18000,
        image: 'https://images.unsplash.com/photo-1600788886242-5c96aabe3757?w=600&q=80',
        isAvailable: true,
        status: 'available',
        preparationTime: 1,
        tags: [],
        displayOrder: 6
      }
    ];

    const menuItems = await MenuItem.insertMany(menuItemsData);
    console.log(`Inserted ${menuItems.length} Menu Items.`);

    // 5. Create Tables
    const tablesData = [
      { restaurantId: restaurant._id, tableNumber: 'Bàn 101', capacity: 2, zone: 'Tầng 1', status: 'available', depositAmount: 0, note: 'Gần lối ra vào', isActive: true },
      { restaurantId: restaurant._id, tableNumber: 'Bàn 102', capacity: 2, zone: 'Tầng 1', status: 'available', depositAmount: 0, note: 'Gần quầy nước', isActive: true },
      { restaurantId: restaurant._id, tableNumber: 'Bàn 103', capacity: 4, zone: 'Tầng 1', status: 'available', depositAmount: 0, note: 'Bàn tiêu chuẩn 4 người', isActive: true },
      { restaurantId: restaurant._id, tableNumber: 'Bàn 104', capacity: 4, zone: 'Tầng 1', status: 'available', depositAmount: 0, note: 'Bàn tiêu chuẩn 4 người', isActive: true },
      { restaurantId: restaurant._id, tableNumber: 'Bàn 105', capacity: 6, zone: 'Tầng 2', status: 'available', depositAmount: 0, note: 'Không gian thoáng mát tầng 2', isActive: true },
      { restaurantId: restaurant._id, tableNumber: 'Bàn 106', capacity: 8, zone: 'Tầng 2 (Bàn Lớn)', status: 'available', depositAmount: 0, note: 'Thích hợp cho gia đình đông người', isActive: true },
      { restaurantId: restaurant._id, tableNumber: 'Phòng VIP 1', capacity: 6, zone: 'Phòng Lạnh VIP', status: 'available', depositAmount: 50000, note: 'Phòng máy lạnh, yên tĩnh, riêng tư', isActive: true },
      { restaurantId: restaurant._id, tableNumber: 'Phòng VIP 2', capacity: 10, zone: 'Phòng Lạnh VIP (Lớn)', status: 'available', depositAmount: 100000, note: 'Phòng máy lạnh lớn cho hội họp gia đình', isActive: true }
    ];

    const tables = await RestaurantTable.insertMany(tablesData);
    console.log(`Inserted ${tables.length} Restaurant Tables.`);

    console.log('\n======================================');
    console.log('Seeding Bánh Xèo Bà Dưỡng restaurant successfully completed!');
    console.log(`Restaurant ID: ${restaurant._id}`);
    console.log(`Owner: trankimthang0207@gmail.com`);
    console.log('======================================');

    await mongoose.disconnect();
  } catch (err) {
    console.error('Seeding error:', err);
  }
}

seed();
