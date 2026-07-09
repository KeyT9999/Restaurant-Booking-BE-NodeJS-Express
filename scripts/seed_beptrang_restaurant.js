const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config();

const cloudinary = require('../src/config/cloudinary');
const Restaurant = require('../src/models/Restaurant');
const MenuCategory = require('../src/models/MenuCategory');
const MenuItem = require('../src/models/MenuItem');
const RestaurantTable = require('../src/models/RestaurantTable');

const artifactDir = 'C:/Users/KAYT/.gemini/antigravity-ide/brain/8ba0c199-4360-415f-8414-67a621442d73';

function findLatestImage(prefix) {
  try {
    const files = fs.readdirSync(artifactDir);
    const matched = files.filter(f => f.startsWith(prefix) && f.endsWith('.png'));
    if (matched.length === 0) {
      throw new Error(`No image found with prefix ${prefix} in ${artifactDir}`);
    }
    // Sort by name/timestamp descending to get the newest file
    matched.sort();
    const latest = matched[matched.length - 1];
    return path.join(artifactDir, latest);
  } catch (err) {
    console.error(`Error scanning artifact directory for ${prefix}:`, err.message);
    throw err;
  }
}

async function uploadToCloudinary(filePath, folder = 'bookeat/restaurants') {
  console.log(`[Cloudinary] Uploading ${path.basename(filePath)}...`);
  const res = await cloudinary.uploader.upload(filePath, { folder });
  console.log(`[Cloudinary] Success! URL: ${res.secure_url}`);
  return res.secure_url;
}

async function seed() {
  try {
    // 1. Scan and locate newly generated photos
    console.log('Locating generated photos in artifacts...');
    const coverPath = findLatestImage('cover_beptrang');
    const quangechPath = findLatestImage('dish_quangech');
    const quanggaPath = findLatestImage('dish_quangga');
    const cuonthitheoPath = findLatestImage('dish_cuonthitheo');

    // 2. Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB.');

    // 3. Upload photos to Cloudinary
    console.log('Uploading images to Cloudinary...');
    const coverUrl = await uploadToCloudinary(coverPath, 'bookeat/restaurants/covers');
    const quangechUrl = await uploadToCloudinary(quangechPath, 'bookeat/menu-items');
    const quanggaUrl = await uploadToCloudinary(quanggaPath, 'bookeat/menu-items');
    const cuonthitheoUrl = await uploadToCloudinary(cuonthitheoPath, 'bookeat/menu-items');

    const ownerId = new mongoose.Types.ObjectId('6a11001ee818b2dd1a8767d3');
    const adminId = new mongoose.Types.ObjectId('6a0ec0dcdf36c1ea3ac49c87');

    // 4. Delete existing Mì Quảng Ếch Bếp Trang to prevent duplicates
    const existing = await Restaurant.findOne({ name: 'Mì Quảng Ếch Bếp Trang', ownerId });
    if (existing) {
      console.log('Found existing Mì Quảng Ếch Bếp Trang restaurant. Cleaning up old data...');
      await MenuItem.deleteMany({ restaurantId: existing._id });
      await MenuCategory.deleteMany({ restaurantId: existing._id });
      await RestaurantTable.deleteMany({ restaurantId: existing._id });
      await Restaurant.deleteOne({ _id: existing._id });
      console.log('Cleanup completed.');
    }

    // 5. Create Restaurant
    const restaurantData = {
      ownerId,
      name: 'Mì Quảng Ếch Bếp Trang',
      description: 'Mì Quảng Ếch Bếp Trang là thương hiệu ẩm thực danh tiếng tại Đà Nẵng, nổi bật với sự sáng tạo đưa món mì Quảng ếch lên mẹt tre lót lá chuối mộc mạc. Thịt ếch um sả ớt vàng ươm, thơm lừng trong niêu đất, ăn kèm với sợi mì dai mềm, bánh tráng nướng giòn rụm và mắm nêm đậm đà chuẩn vị miền Trung. Không gian quán rộng rãi, ấm cúng và mang phong vị truyền thống Việt Nam.',
      phoneNumber: '0905151522',
      email: 'miquangechbeptrang@gmail.com',
      address: {
        street: '24 Pasteur',
        ward: 'Hải Châu 1',
        district: 'Hải Châu',
        city: 'Đà Nẵng',
        fullAddress: '24 Pasteur, Hải Châu 1, Hải Châu, Đà Nẵng'
      },
      coordinates: {
        latitude: 16.0694,
        longitude: 108.2202
      },
      location: {
        type: 'Point',
        coordinates: [108.2202, 16.0694]
      },
      cuisineTypes: ['Việt Nam', 'Đặc sản', 'Mì Quảng'],
      priceRange: 'moderate',
      capacity: 200,
      operatingHours: {
        monday: { open: '06:30', close: '22:15', closed: false },
        tuesday: { open: '06:30', close: '22:15', closed: false },
        wednesday: { open: '06:30', close: '22:15', closed: false },
        thursday: { open: '06:30', close: '22:15', closed: false },
        friday: { open: '06:30', close: '22:15', closed: false },
        saturday: { open: '06:30', close: '22:15', closed: false },
        sunday: { open: '06:30', close: '22:15', closed: false }
      },
      averagePrice: 55000,
      priceRangeMin: 30000,
      priceRangeMax: 150000,
      statusMessage: 'Phục vụ từ 6:30 sáng đến 10:15 tối mỗi ngày',
      bookingNotes: 'Khách đặt bàn vui lòng đến đúng giờ. Bàn sẽ được giữ tối đa 15 phút. Nếu đi nhóm đông trên 15 người, vui lòng đặt bàn trước 1 tiếng.',
      summaryHighlights: 'Mì Quảng ếch phục vụ trên mẹt tre lá chuối độc đáo, ếch um sả nghệ đậm vị, không gian xưa mộc mạc và sạch sẽ.',
      suitableFor: ['Gia đình', 'Du lịch', 'Hội họp', 'Ăn sáng', 'Ăn trưa', 'Ăn tối'],
      signatureDishes: ['Mì Quảng ếch đặc biệt', 'Bánh tráng cuốn thịt heo'],
      amenities: ['Wifi tốc độ cao', 'Điều hòa phòng VIP', 'Chỗ đỗ ô tô miễn phí'],
      policyRules: ['Không mang thú cưng', 'Không mang đồ ăn ngoài'],
      approvalStatus: 'approved',
      approvedBy: adminId,
      approvedAt: new Date(),
      active: true,
      featured: true,
      hasMenu: true,
      hasTableLayout: true,
      commissionRate: 10,
      logo: coverUrl,
      coverImage: coverUrl,
      images: [
        {
          url: coverUrl,
          caption: 'Không gian ẩm thực Bếp Trang',
          isPrimary: true
        }
      ],
      galleryImages: [quangechUrl, quanggaUrl, cuonthitheoUrl]
    };

    const restaurant = await Restaurant.create(restaurantData);
    console.log(`Created Restaurant "Mì Quảng Ếch Bếp Trang" with ID: ${restaurant._id}`);

    // 6. Create Menu Categories
    const categoriesData = [
      { restaurantId: restaurant._id, name: 'Món chính', description: 'Mì Quảng mẹt và món cuốn đặc trưng', displayOrder: 1 },
      { restaurantId: restaurant._id, name: 'Tráng miệng & Giải khát', description: 'Đồ uống mát lành và chè hạt sen', displayOrder: 2 }
    ];

    const categories = await MenuCategory.insertMany(categoriesData);
    console.log(`Inserted ${categories.length} Menu Categories.`);

    const catMain = categories.find(c => c.name === 'Món chính')._id;
    const catDrink = categories.find(c => c.name === 'Tráng miệng & Giải khát')._id;

    // 7. Create Menu Items
    const menuItemsData = [
      {
        restaurantId: restaurant._id,
        categoryId: catMain,
        name: 'Mì Quảng ếch đặc biệt',
        description: 'Mẹt mì Quảng ếch đặc trưng với niêu ếch um nóng hổi thơm nức sả nghệ, sợi mì vàng dai ngon, ăn kèm bánh tráng nướng và đĩa rau sống tươi mát.',
        price: 65000,
        image: quangechUrl,
        isAvailable: true,
        status: 'available',
        preparationTime: 10,
        tags: ['Đặc sản số 1', 'Nên thử'],
        displayOrder: 1
      },
      {
        restaurantId: restaurant._id,
        categoryId: catMain,
        name: 'Mì Quảng gà ta',
        description: 'Mì Quảng sợi trắng truyền thống kết hợp với thịt gà ta thả vườn dai ngọt thơm ngon, trứng cút luộc, đậu phộng rang giòn rụm và nước lèo thanh ngọt.',
        price: 45000,
        image: quanggaUrl,
        isAvailable: true,
        status: 'available',
        preparationTime: 7,
        tags: ['Món truyền thống'],
        displayOrder: 2
      },
      {
        restaurantId: restaurant._id,
        categoryId: catMain,
        name: 'Bánh tráng cuốn thịt heo',
        description: 'Thịt heo luộc hai đầu da thái mỏng mềm ngọt, cuộn bánh tráng và lá mì Quảng cùng đĩa rau sống đa dạng, chấm với nước mắm nêm chưng cay nồng chuẩn vị Đà Nẵng.',
        price: 95000,
        image: cuonthitheoUrl,
        isAvailable: true,
        status: 'available',
        preparationTime: 8,
        tags: ['Yêu thích'],
        displayOrder: 3
      },
      {
        restaurantId: restaurant._id,
        categoryId: catMain,
        name: 'Bánh tráng nướng thêm',
        description: 'Bánh tráng mè nướng giòn tan ăn kèm mì Quảng.',
        price: 10000,
        image: null,
        isAvailable: true,
        status: 'available',
        preparationTime: 2,
        tags: [],
        displayOrder: 4
      },
      {
        restaurantId: restaurant._id,
        categoryId: catDrink,
        name: 'Nước ép hạt sen nhãn nhục',
        description: 'Thức uống thanh mát được nấu từ hạt sen tươi Huế và nhãn nhục ngọt bùi.',
        price: 25000,
        image: null,
        isAvailable: true,
        status: 'available',
        preparationTime: 3,
        tags: ['Thanh mát'],
        displayOrder: 5
      },
      {
        restaurantId: restaurant._id,
        categoryId: catDrink,
        name: 'Chè hạt sen long nhãn',
        description: 'Món tráng miệng thanh ngọt từ long nhãn ôm trọn hạt sen dẻo thơm.',
        price: 30000,
        image: null,
        isAvailable: true,
        status: 'available',
        preparationTime: 4,
        tags: ['Ngọt nhẹ'],
        displayOrder: 6
      }
    ];

    const menuItems = await MenuItem.insertMany(menuItemsData);
    console.log(`Inserted ${menuItems.length} Menu Items.`);

    // 8. Create Tables
    const tablesData = [
      { restaurantId: restaurant._id, tableNumber: 'Bàn 201', capacity: 2, zone: 'Tầng 1', status: 'available', depositAmount: 0, note: 'Gần cửa sổ', isActive: true },
      { restaurantId: restaurant._id, tableNumber: 'Bàn 202', capacity: 2, zone: 'Tầng 1', status: 'available', depositAmount: 0, note: 'Gần cửa sổ', isActive: true },
      { restaurantId: restaurant._id, tableNumber: 'Bàn 203', capacity: 4, zone: 'Tầng 1', status: 'available', depositAmount: 0, note: 'Bàn tiêu chuẩn 4 người', isActive: true },
      { restaurantId: restaurant._id, tableNumber: 'Bàn 204', capacity: 4, zone: 'Tầng 1', status: 'available', depositAmount: 0, note: 'Bàn tiêu chuẩn 4 người', isActive: true },
      { restaurantId: restaurant._id, tableNumber: 'Bàn 205', capacity: 4, zone: 'Tầng 1', status: 'available', depositAmount: 0, note: 'Bàn tiêu chuẩn 4 người', isActive: true },
      { restaurantId: restaurant._id, tableNumber: 'Bàn 206', capacity: 6, zone: 'Tầng 1 (Bàn Lớn)', status: 'available', depositAmount: 0, note: 'Bàn dài cho nhóm khách', isActive: true },
      { restaurantId: restaurant._id, tableNumber: 'Bàn 207', capacity: 6, zone: 'Tầng 1 (Bàn Lớn)', status: 'available', depositAmount: 0, note: 'Bàn dài cho nhóm khách', isActive: true },
      { restaurantId: restaurant._id, tableNumber: 'Bàn 208', capacity: 8, zone: 'Sân vườn ngoài trời', status: 'available', depositAmount: 0, note: 'Không gian xanh thoáng đãng', isActive: true },
      { restaurantId: restaurant._id, tableNumber: 'Phòng VIP 3', capacity: 6, zone: 'Phòng Máy Lạnh VIP', status: 'available', depositAmount: 50000, note: 'Phòng lạnh yên tĩnh riêng tư', isActive: true },
      { restaurantId: restaurant._id, tableNumber: 'Phòng VIP 4', capacity: 12, zone: 'Phòng Hội Họp VIP', status: 'available', depositAmount: 150000, note: 'Phòng họp gia đình hoặc liên hoan sinh nhật', isActive: true }
    ];

    const tables = await RestaurantTable.insertMany(tablesData);
    console.log(`Inserted ${tables.length} Restaurant Tables.`);

    console.log('\n======================================');
    console.log('Seeding Mì Quảng Ếch Bếp Trang successfully completed!');
    console.log(`Restaurant ID: ${restaurant._id}`);
    console.log(`Owner: trankimthang0207@gmail.com`);
    console.log('======================================');

    await mongoose.disconnect();
  } catch (err) {
    console.error('Seeding error:', err);
  }
}

seed();
