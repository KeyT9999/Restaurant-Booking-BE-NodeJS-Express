const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const User = require('../src/models/User');
const Restaurant = require('../src/models/Restaurant');
const MenuCategory = require('../src/models/MenuCategory');
const MenuItem = require('../src/models/MenuItem');
const RestaurantTable = require('../src/models/RestaurantTable');
const RestaurantService = require('../src/models/RestaurantService');
const Voucher = require('../src/models/Voucher');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to DB');

  // 1. Find Owner
  const owner = await User.findOne({ email: 'molonfa@gmail.com' });
  if (!owner) {
    throw new Error('User molonfa@gmail.com not found. Please register this user first.');
  }
  const ownerId = owner._id;
  console.log(`Found owner: ${owner.fullName} (${ownerId})`);

  // 2. Find or Create an Admin for Approval
  let admin = await User.findOne({ role: 'admin' });
  if (!admin) {
    // If no admin, use owner themselves
    admin = owner;
  }
  const adminId = admin._id;

  // 3. Clear existing restaurant data for this owner to avoid duplicates/conflicts
  const existingRestaurant = await Restaurant.findOne({ ownerId });
  if (existingRestaurant) {
    console.log(`Found existing restaurant for this owner: "${existingRestaurant.name}". Cleaning related data...`);
    const restId = existingRestaurant._id;
    await MenuItem.deleteMany({ restaurantId: restId });
    await MenuCategory.deleteMany({ restaurantId: restId });
    await RestaurantTable.deleteMany({ restaurantId: restId });
    await RestaurantService.deleteMany({ restaurantId: restId });
    await Voucher.deleteMany({ restaurantId: restId });
    await Restaurant.deleteOne({ _id: restId });
    console.log('Old restaurant and its menu, tables, services, and vouchers cleared.');
  }

  // 4. Create Restaurant
  const restaurantData = {
    ownerId,
    name: 'Sen Vàng - Vietnamese Premium Dining',
    description: 'Chào mừng quý khách đến với Sen Vàng - Vietnamese Premium Dining, biểu tượng của sự kết hợp hoàn hảo giữa ẩm thực truyền thống Việt Nam tinh tế và không gian kiến trúc sang trọng đẳng cấp. Nằm ngay tại trung tâm Thủ đô Hà Nội cổ kính, Sen Vàng mang đến cho thực khách một hành trình ẩm thực phong phú, từ những món ăn dân dã thấm đượm hương vị quê hương đến các món cung đình Huế cầu kỳ, được tái hiện lại dưới bàn tay tài hoa của đội ngũ đầu bếp hàng đầu.\n\nChúng tôi cam kết sử dụng nguồn nguyên liệu sạch, tươi ngon nhất từ các trang trại hữu cơ liên kết và hải sản tươi sống đánh bắt trong ngày. Với không gian rộng rãi nhưng không kém phần ấm cúng, riêng tư cùng hệ thống phòng VIP sang trọng, Sen Vàng là lựa chọn lý tưởng cho các buổi tiệc gia đình, tiếp đãi đối tác quan trọng hay những buổi hẹn hò lãng mạn.',
    phoneNumber: '02439382233',
    email: 'contact@senvangdining.vn',
    websiteUrl: 'https://senvangdining.vn',
    contactHotline: '1900 8899',
    contactSecondaryPhone: '0912345678',
    address: {
      street: '12 Tràng Tiền',
      ward: 'Tràng Tiền',
      district: 'Hoàn Kiếm',
      city: 'Hà Nội',
      fullAddress: '12 Tràng Tiền, Phường Tràng Tiền, Quận Hoàn Kiếm, Hà Nội'
    },
    coordinates: {
      latitude: 21.0253,
      longitude: 105.8569
    },
    cuisineTypes: ['Vietnamese', 'Fine Dining', 'Seafood', 'Traditional'],
    priceRange: 'luxury',
    capacity: 120,
    operatingHours: {
      monday: { open: '08:00', close: '22:30', closed: false },
      tuesday: { open: '08:00', close: '22:30', closed: false },
      wednesday: { open: '08:00', close: '22:30', closed: false },
      thursday: { open: '08:00', close: '22:30', closed: false },
      friday: { open: '08:00', close: '22:30', closed: false },
      saturday: { open: '08:00', close: '22:30', closed: false },
      sunday: { open: '08:00', close: '22:30', closed: false }
    },
    images: [
      {
        url: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1200&q=80',
        caption: 'Không gian sảnh chính sang trọng',
        isPrimary: true
      },
      {
        url: 'https://images.unsplash.com/photo-1552566626-52f8b828add9?auto=format&fit=crop&w=1200&q=80',
        caption: 'Bàn tiệc VIP setup chuẩn Âu - Việt',
        isPrimary: false
      },
      {
        url: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=1200&q=80',
        caption: 'Không gian phòng riêng yên tĩnh',
        isPrimary: false
      }
    ],
    logo: 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?auto=format&fit=crop&w=150&h=150&q=80',
    coverImage: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1200&q=80',
    galleryImages: [
      'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1552566626-52f8b828add9?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1583032013896-1c0fac8b15d7?auto=format&fit=crop&w=1200&q=80'
    ],
    averagePrice: 450000,
    priceRangeMin: 200000,
    priceRangeMax: 1500000,
    statusMessage: 'Chào mừng quý khách đến với Sen Vàng Premium Dining!',
    heroCity: 'Hà Nội',
    heroHeadline: 'Trải Nghiệm Ẩm Thực Tinh Hoa Việt Nam Đẳng Cấp',
    heroSubheadline: 'Sự giao hòa tuyệt mỹ của hương vị truyền thống và nghệ thuật bày trí hiện đại trong lòng thủ đô.',
    heroSearchPlaceholder: 'Đặt bàn ngay hôm nay để nhận nhiều ưu đãi hấp dẫn...',
    bookingInformation: 'Quý khách nên đặt trước ít nhất 1 giờ vào ngày thường và 3 giờ vào ngày cuối tuần để chúng tôi có sự chuẩn bị chu đáo nhất. Nhóm đi từ 10 người trở lên vui lòng tham khảo các set menu tiệc đặc sắc của nhà hàng.',
    bookingNotes: 'Nhà hàng giữ bàn tối đa 15 phút. Nếu có bất kỳ thay đổi nào về thời gian hoặc số lượng khách, xin vui lòng liên hệ hotline 1900 8899 sớm nhất có thể.',
    generalPromotions: 'Ưu đãi giảm 10% trên hóa đơn thức ăn cho khách hàng đặt bàn thành công qua hệ thống BookEat trước 11h trưa hàng ngày.',
    groupPromotions: 'Tặng ngay 1 chai vang đỏ Chile hoặc 1 đĩa trái cây đặc biệt cho nhóm khách từ 8 người trở lên lựa chọn một trong các Set Menu Hoàng Gia.',
    promotionNotes: 'Các chương trình ưu đãi không áp dụng đồng thời và không có hiệu lực vào các ngày lễ Tết dương lịch, âm lịch, 30/4, 1/5, 2/9.',
    summaryHighlights: 'Nhà hàng ẩm thực Việt cao cấp • Vị trí đắc địa cạnh Hồ Gươm • Không gian Đông Dương cổ kính • Phục vụ chuyên nghiệp 5 sao',
    suitableFor: ['Hội họp gia đình', 'Tiếp khách đối tác', 'Hẹn hò lãng mạn', 'Tổ chức sinh nhật', 'Tiệc công ty'],
    signatureDishes: ['Chả cá lăng hoàng gia', 'Nộm bò khô phố cổ', 'Tôm sú hoàng kim sốt trứng muối', 'Lẩu riêu cua sườn sụn đặc biệt'],
    spaceDescriptionDetail: 'Nhà hàng có sức chứa lên đến 120 khách với 3 tầng không gian được thiết kế tỉ mỉ. Tầng trệt là sảnh chung thoáng đãng với cây xanh mát mắt, phù hợp hội họp gia đình năng động. Lầu 1 có ban công mở rộng hướng phố Tràng Tiền thích hợp hẹn hò lãng mạn. Tầng 3 gồm 3 phòng VIP riêng tư biệt lập được trang bị máy lạnh, bàn xoay tiện lợi.',
    uniqueFeatures: 'Nhạc công hòa tấu nhạc cụ truyền thống dân tộc trực tiếp tại sảnh chính vào tối thứ 6 và thứ 7 từ 19:30 đến 20:30.',
    pricingDetails: 'Đơn giá trung bình từ 250,000đ - 600,000đ/người. Thực đơn Alacarte phong phú chỉ từ 85,000đ. Có sẵn 4 gói Set Menu tiệc đa dạng từ 450,000đ/người đến 1,200,000đ/người.',
    menuHighlights: '100% nguyên liệu đầu vào được kiểm định nguồn gốc rõ ràng, rau củ hữu cơ chuẩn VietGAP. Hải sản tươi sống được nuôi thả bể kính tại nhà hàng.',
    policyRules: [
      'Vui lòng không mang theo vật nuôi vào khu vực ăn uống chung.',
      'Không hút thuốc trong phòng lạnh (khách hàng có thể hút thuốc ở ban công tầng 2).',
      'Thức uống mang ngoài vào chịu phí phục vụ 15% trị giá sản phẩm cùng loại hoặc phí mở chai cố định 200,000đ/chai.'
    ],
    amenities: [
      'Phòng VIP máy lạnh riêng biệt',
      'Có ghế ngồi trẻ em chuyên dụng',
      'Bãi đỗ xe ô tô và xe máy an toàn',
      'Wifi tốc độ cao phủ sóng toàn bộ',
      'Hỗ trợ thanh toán thẻ quốc tế Visa/Master, chuyển khoản & ví điện tử',
      'Hỗ trợ xuất hóa đơn đỏ điện tử (VAT)'
    ],
    parkingDetails: 'Nhà hàng hỗ trợ trông giữ xe máy miễn phí trước cửa. Xe ô tô được đỗ tại sảnh tòa nhà văn phòng Tràng Tiền Plaza cách nhà hàng 50m (nhân viên bảo vệ của chúng tôi sẽ hướng dẫn và lái xe giúp quý khách).',
    galleryNotes: 'Album hình ảnh chân thực về không gian bài trí sang trọng và các món ngon tinh tế tại Sen Vàng.',
    directionInfo: 'Nằm ngay góc ngã tư Tràng Tiền - Ngô Quyền, đối diện khu mua sắm Tràng Tiền Plaza và chỉ cách bờ Hồ Gươm 3 phút đi bộ.',
    operatingSchedule: 'Mở cửa phục vụ liên tục từ 08:00 sáng đến 22:30 tối tất cả các ngày trong tuần kể cả các ngày nghỉ lễ.',
    approvalStatus: 'approved',
    approvedBy: adminId,
    approvedAt: new Date(),
    active: true,
    featured: true,
    hasMenu: true,
    hasTableLayout: true,
    balance: 50000000, // 50 million VND initial balance
    totalRevenue: 245000000,
    totalCommission: 24500000,
    commissionRate: 10,
    taxCode: '0109876543',
    bankInfo: {
      bankName: 'Ngân hàng TMCP Ngoại Thương Việt Nam (Vietcombank)',
      accountNumber: '1023456789',
      accountHolder: 'NGUYEN VAN MOLO',
      branch: 'Sở Giao Dịch Hà Nội'
    },
    businessLicense: {
      number: 'GP-8899/ĐKKD-HN',
      imageUrl: 'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?auto=format&fit=crop&w=400&q=80',
      verifiedAt: new Date()
    }
  };

  const restaurant = await Restaurant.create(restaurantData);
  const restaurantId = restaurant._id;
  console.log(`Created Restaurant: "${restaurant.name}" with ID: ${restaurantId}`);

  // 5. Create Menu Categories
  const categoriesData = [
    { restaurantId, name: 'Khai Vị', description: 'Các món ăn nhẹ kích thích vị giác trước bữa ăn', displayOrder: 1, isActive: true },
    { restaurantId, name: 'Món Chính', description: 'Tinh hoa ẩm thực thuần Việt đậm đà và giàu dinh dưỡng', displayOrder: 2, isActive: true },
    { restaurantId, name: 'Lẩu & Nướng', description: 'Lẩu nước dùng thanh ngọt, đồ nướng tẩm ướp đậm vị', displayOrder: 3, isActive: true },
    { restaurantId, name: 'Tráng Miệng & Đồ Uống', description: 'Đồ uống hoa quả tươi nguyên chất và chè ngọt mát', displayOrder: 4, isActive: true }
  ];

  const categories = await MenuCategory.create(categoriesData);
  console.log(`Created ${categories.length} Menu Categories.`);

  const catMap = {};
  categories.forEach(c => {
    catMap[c.name] = c._id;
  });

  // 6. Create Menu Items
  const menuItemsData = [
    // Khai Vị
    {
      restaurantId,
      categoryId: catMap['Khai Vị'],
      name: 'Nộm Hoa Chuối Tai Heo',
      description: 'Sợi hoa chuối giòn sần sật, tai heo luộc thái mỏng quyện nước sốt chua ngọt đặc trưng và lạc rang giòn bùi.',
      price: 85000,
      image: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=500&q=80',
      isAvailable: true,
      status: 'available',
      preparationTime: 10,
      tags: ['nộm', 'salad', 'khai vị', 'giòn'],
      displayOrder: 1
    },
    {
      restaurantId,
      categoryId: catMap['Khai Vị'],
      name: 'Súp Hải Sản Tóc Tiên',
      description: 'Súp hải sản nóng hổi thơm ngon với tôm, mực, cồi điệp và rong tóc tiên bổ dưỡng, sánh mịn tự nhiên.',
      price: 95000,
      image: 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=500&q=80',
      isAvailable: true,
      status: 'available',
      preparationTime: 12,
      tags: ['súp', 'soup', 'hải sản', 'bổ dưỡng'],
      displayOrder: 2
    },
    {
      restaurantId,
      categoryId: catMap['Khai Vị'],
      name: 'Phở Cuốn Thịt Bò',
      description: 'Bánh phở mỏng dai cuộn rau thơm tươi mát và thịt bò xào sả ớt đậm đà, chấm nước mắm tỏi ớt chua ngọt đặc trưng.',
      price: 105000,
      image: 'https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?auto=format&fit=crop&w=500&q=80',
      isAvailable: true,
      status: 'available',
      preparationTime: 8,
      tags: ['phở cuốn', 'thịt bò', 'cuốn', 'khai vị'],
      displayOrder: 3
    },

    // Món Chính
    {
      restaurantId,
      categoryId: catMap['Món Chính'],
      name: 'Chả Cá Lăng Thượng Hạng',
      description: 'Cá lăng tươi thái miếng vuông dày, ướp gia vị nghệ nướng thơm lừng, xào nóng tại bàn cùng hành hoa, thì là. Ăn kèm bún rối, lạc rang và mắm tôm pha chanh sủi bọt.',
      price: 285000,
      image: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=500&q=80',
      isAvailable: true,
      status: 'available',
      preparationTime: 15,
      tags: ['chả cá', 'cá lăng', 'món chính', 'đặc sản'],
      displayOrder: 1
    },
    {
      restaurantId,
      categoryId: catMap['Món Chính'],
      name: 'Tôm Sú Hoàng Kim Sốt Trứng Muối',
      description: 'Tôm sú tươi loại lớn chiên giòn rụm bên ngoài nhưng thịt bên trong vẫn ngọt mềm, phủ lớp sốt trứng muối béo ngậy vàng ươm hấp dẫn.',
      price: 320000,
      image: 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?auto=format&fit=crop&w=500&q=80',
      isAvailable: true,
      status: 'available',
      preparationTime: 15,
      tags: ['tôm', 'seafood', 'trứng muối', 'hoàng kim'],
      displayOrder: 2
    },
    {
      restaurantId,
      categoryId: catMap['Món Chính'],
      name: 'Bò Sốt Tiêu Đen Bản Gang',
      description: 'Thịt bò thăn mềm thái lát xào cùng ớt chuông, hành tây và nước sốt tiêu đen cay nồng, đậm đà. Phục vụ trên bản gang nóng hổi giúp giữ trọn hương vị.',
      price: 350000,
      image: 'https://images.unsplash.com/photo-1600891964599-f61ba0e24092?auto=format&fit=crop&w=500&q=80',
      isAvailable: true,
      status: 'available',
      preparationTime: 18,
      tags: ['bò', 'tiêu đen', 'bản gang', 'món chính'],
      displayOrder: 3
    },
    {
      restaurantId,
      categoryId: catMap['Món Chính'],
      name: 'Gà Hấp Lá Chanh Trúc Lâm',
      description: 'Nửa con gà ta thả vườn thịt chắc thơm ngọt, da giòn vàng ươm hấp cách thủy cùng lá chanh, dùng kèm muối tiêu chanh ớt truyền thống.',
      price: 290000,
      image: 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?auto=format&fit=crop&w=500&q=80',
      isAvailable: true,
      status: 'available',
      preparationTime: 20,
      tags: ['gà', 'gà hấp', 'lá chanh', 'dân dã'],
      displayOrder: 4
    },

    // Lẩu & Nướng
    {
      restaurantId,
      categoryId: catMap['Lẩu & Nướng'],
      name: 'Lẩu Riêu Cua Sườn Sụn Đặc Biệt',
      description: 'Nồi lẩu đầy đặn với nước dùng thanh chua dịu của giấm bỗng và cà chua, gạch cua xịn thơm ngậy. Đồ nhúng đi kèm gồm sườn sụn heo non giòn sần sật, bắp bò tươi, giò tai, đậu hũ chiên và rau sống các loại.',
      price: 450000,
      image: 'https://images.unsplash.com/photo-1551183053-bf91a1d81141?auto=format&fit=crop&w=500&q=80',
      isAvailable: true,
      status: 'available',
      preparationTime: 20,
      tags: ['lẩu', 'riêu cua', 'sườn sụn', 'ấm áp'],
      displayOrder: 1
    },
    {
      restaurantId,
      categoryId: catMap['Lẩu & Nướng'],
      name: 'Thịt Ba Chỉ Bò Mỹ Nướng Sốt BBQ',
      description: 'Thịt ba chỉ bò Mỹ thái lát mỏng tẩm ướp sốt BBQ đậm đà, được nướng trực tiếp tại bàn mang lại hương vị thơm lừng hấp dẫn.',
      price: 260000,
      image: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=500&q=80',
      isAvailable: true,
      status: 'available',
      preparationTime: 15,
      tags: ['thịt nướng', 'bbq', 'bò mỹ', 'ba chỉ'],
      displayOrder: 2
    },

    // Tráng Miệng & Đồ Uống
    {
      restaurantId,
      categoryId: catMap['Tráng Miệng & Đồ Uống'],
      name: 'Chè Sen Long Nhãn Hạt Sen',
      description: 'Hạt sen Huế ninh bùi bùi bọc khéo léo trong cùi nhãn Hưng Yên dày cùi mọng nước, nước chè ngọt thanh tao ướp hương hoa bưởi mát lành.',
      price: 55000,
      image: 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?auto=format&fit=crop&w=500&q=80',
      isAvailable: true,
      status: 'available',
      preparationTime: 5,
      tags: ['chè', 'long nhãn', 'hạt sen', 'tráng miệng'],
      displayOrder: 1
    },
    {
      restaurantId,
      categoryId: catMap['Tráng Miệng & Đồ Uống'],
      name: 'Nước Ép Trái Cây Tươi Theo Mùa',
      description: 'Các loại quả tươi tự nhiên (cam, dưa hấu, dứa hoặc xoài) ép nguyên chất không dùng đường hóa học, bổ sung vitamin tươi mát cho bữa ăn.',
      price: 45000,
      image: 'https://images.unsplash.com/photo-1621263764928-df1444c5e859?auto=format&fit=crop&w=500&q=80',
      isAvailable: true,
      status: 'available',
      preparationTime: 5,
      tags: ['nước ép', 'juice', 'hoa quả', 'tươi mát'],
      displayOrder: 2
    },
    {
      restaurantId,
      categoryId: catMap['Tráng Miệng & Đồ Uống'],
      name: 'Trà Sen Tuyết Shan Cổ Thụ',
      description: 'Ấm trà tuyết Shan cổ thụ ướp hương sen Tây Hồ thơm dịu nhẹ, hậu vị ngọt sâu thanh khiết giúp thực khách thư thái sau bữa ăn ngon miệng.',
      price: 65000,
      image: 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=500&q=80',
      isAvailable: true,
      status: 'available',
      preparationTime: 5,
      tags: ['trà', 'trà sen', 'cổ thụ', 'ấm trà'],
      displayOrder: 3
    }
  ];

  const menuItems = await MenuItem.create(menuItemsData);
  console.log(`Created ${menuItems.length} Menu Items.`);

  // 7. Create Restaurant Tables
  const tablesData = [
    // Sảnh Trệt (Ground Floor)
    { restaurantId, tableNumber: 'ST-01', capacity: 2, zone: 'Sảnh Trệt', status: 'available', depositAmount: 0, note: 'Bàn đôi cạnh cửa sổ kính sảnh trệt', isActive: true },
    { restaurantId, tableNumber: 'ST-02', capacity: 2, zone: 'Sảnh Trệt', status: 'available', depositAmount: 0, note: 'Bàn đôi gần lối đi sảnh trệt', isActive: true },
    { restaurantId, tableNumber: 'ST-03', capacity: 2, zone: 'Sảnh Trệt', status: 'available', depositAmount: 0, note: 'Bàn đôi cạnh hồ cá cảnh sảnh trệt', isActive: true },
    { restaurantId, tableNumber: 'ST-04', capacity: 4, zone: 'Sảnh Trệt', status: 'available', depositAmount: 0, note: 'Bàn gia đình 4 người sảnh trệt', isActive: true },
    { restaurantId, tableNumber: 'ST-05', capacity: 4, zone: 'Sảnh Trệt', status: 'available', depositAmount: 0, note: 'Bàn 4 người gần quầy bar sảnh trệt', isActive: true },
    { restaurantId, tableNumber: 'ST-06', capacity: 4, zone: 'Sảnh Trệt', status: 'available', depositAmount: 0, note: 'Bàn 4 người cạnh kệ sách trang trí sảnh trệt', isActive: true },
    { restaurantId, tableNumber: 'ST-07', capacity: 8, zone: 'Sảnh Trệt', status: 'available', depositAmount: 0, note: 'Bàn tròn lớn 8 người sảnh trệt', isActive: true },
    { restaurantId, tableNumber: 'ST-08', capacity: 8, zone: 'Sảnh Trệt', status: 'available', depositAmount: 0, note: 'Bàn dài họp mặt gia đình lớn sảnh trệt', isActive: true },

    // Lầu 1 - Sân Vườn (First Floor - Garden)
    { restaurantId, tableNumber: 'SV-01', capacity: 2, zone: 'Lầu 1 - Sân Vườn', status: 'available', depositAmount: 0, note: 'Bàn đôi lãng mạn hướng phố Tràng Tiền', isActive: true },
    { restaurantId, tableNumber: 'SV-02', capacity: 2, zone: 'Lầu 1 - Sân Vườn', status: 'available', depositAmount: 0, note: 'Bàn đôi ban công lộng gió sân vườn', isActive: true },
    { restaurantId, tableNumber: 'SV-03', capacity: 4, zone: 'Lầu 1 - Sân Vườn', status: 'available', depositAmount: 0, note: 'Bàn gia đình 4 người không gian ngoài trời', isActive: true },
    { restaurantId, tableNumber: 'SV-04', capacity: 4, zone: 'Lầu 1 - Sân Vườn', status: 'available', depositAmount: 0, note: 'Bàn 4 người dưới giàn hoa giấy', isActive: true },
    { restaurantId, tableNumber: 'SV-05', capacity: 4, zone: 'Lầu 1 - Sân Vườn', status: 'available', depositAmount: 0, note: 'Bàn 4 người cạnh góc tiểu cảnh hòn non bộ', isActive: true },
    { restaurantId, tableNumber: 'SV-06', capacity: 6, zone: 'Lầu 1 - Sân Vườn', status: 'available', depositAmount: 0, note: 'Bàn tròn 6 người khu vực hành lang sân vườn', isActive: true },

    // Phòng VIP Hoàng Gia (VIP Rooms)
    { restaurantId, tableNumber: 'VIP-01', capacity: 10, zone: 'Phòng VIP Hoàng Gia', status: 'available', depositAmount: 200000, note: 'Phòng riêng máy lạnh khép kín phong cách cổ điển Đông Dương', isActive: true },
    { restaurantId, tableNumber: 'VIP-02', capacity: 12, zone: 'Phòng VIP Hoàng Gia', status: 'available', depositAmount: 300000, note: 'Phòng tiệc sang trọng kèm bàn xoay và dàn âm thanh karaoke hiện đại', isActive: true },
    { restaurantId, tableNumber: 'VIP-03', capacity: 16, zone: 'Phòng VIP Hoàng Gia', status: 'available', depositAmount: 500000, note: 'Đại sảnh tiệc VIP riêng tư, có ban công penthouse view trọn Hồ Gươm', isActive: true }
  ];

  const tables = await RestaurantTable.create(tablesData);
  console.log(`Created ${tables.length} Restaurant Tables.`);

  // 8. Create Restaurant Services
  const servicesData = [
    {
      restaurantId,
      name: 'Trang trí sinh nhật / kỷ niệm Standard',
      category: 'Decorations',
      description: 'Gồm bóng bay màu sắc chủ đạo, chữ Happy Birthday / Happy Anniversary nghệ thuật, nến lung linh và bình hoa tươi trang trí bàn tiệc cơ bản.',
      price: 250000,
      status: 'available',
      isAvailable: true,
      displayOrder: 1
    },
    {
      restaurantId,
      name: 'Trang trí sinh nhật / kỷ niệm Premium',
      category: 'Decorations',
      description: 'Trang trí hoa tươi nhập khẩu cao cấp, cổng bóng nghệ thuật hoành tráng, bóng bay trần ngập phòng, bảng Welcome thiết kế riêng theo chủ đề tiệc của khách.',
      price: 1200000,
      status: 'available',
      isAvailable: true,
      displayOrder: 2
    },
    {
      restaurantId,
      name: 'Bánh kem mừng tiệc đặc biệt (socola/dâu tây)',
      category: 'Celebration Cakes',
      description: 'Bánh kem tươi 2 tấc làm thủ công thơm ngon trong ngày, trang trí chữ kỷ niệm và nến đi kèm theo yêu cầu của quý khách.',
      price: 350000,
      status: 'available',
      isAvailable: true,
      displayOrder: 3
    },
    {
      restaurantId,
      name: 'Hòa tấu nhạc công Guitar & Violin tại bàn',
      category: 'Live Music',
      description: 'Màn trình diễn độc tấu lãng mạn bởi 2 nhạc công Guitar & Violin chuyên nghiệp trực tiếp tại bàn tiệc của quý khách trong 30 phút, mang đến trải nghiệm khó quên.',
      price: 800000,
      status: 'available',
      isAvailable: true,
      displayOrder: 4
    }
  ];

  const services = await RestaurantService.create(servicesData);
  console.log(`Created ${services.length} Restaurant Services.`);

  // 9. Create Voucher
  const voucherData = {
    code: 'SENVANG10',
    name: 'Mã Giảm Giá Khai Trương Sen Vàng',
    description: 'Giảm giá 10% trên tổng giá trị hóa đơn ăn uống cho khách đặt bàn qua hệ thống BookEat.',
    type: 'restaurant',
    createdByRole: 'owner',
    customerSegments: ['all'],
    applicableRestaurants: [restaurantId],
    discountType: 'percentage',
    discountValue: 10,
    maxDiscountAmount: 200000,
    minOrderAmount: 500000,
    startDate: new Date(),
    endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year from now
    globalUsageLimit: 500,
    perCustomerLimit: 2,
    restaurantId,
    status: 'active',
    createdBy: ownerId
  };

  // Delete existing voucher with the same code if any, to avoid index conflicts
  await Voucher.deleteOne({ code: 'SENVANG10' });
  const voucher = await Voucher.create(voucherData);
  console.log(`Created Voucher: "${voucher.name}" with Code: ${voucher.code}`);

  console.log('\n=========================================');
  console.log('🎉 SEED COMPLETED SUCCESSFULLY! 🎉');
  console.log(`New restaurant created for molonfa@gmail.com`);
  console.log(`Restaurant ID: ${restaurantId}`);
  console.log(`Approved status set to: ${restaurant.approvalStatus}`);
  console.log('=========================================');

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('Error during seed:', err);
  await mongoose.disconnect();
});
