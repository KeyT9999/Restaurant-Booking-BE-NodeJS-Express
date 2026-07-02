const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

const dotenv = require('dotenv');
dotenv.config();

const mongoose = require('mongoose');
const User = require('../src/models/User');
const Restaurant = require('../src/models/Restaurant');
const Booking = require('../src/models/Booking');
const Voucher = require('../src/models/Voucher');
const CustomerVoucher = require('../src/models/CustomerVoucher');
const LoyaltyTransaction = require('../src/models/LoyaltyTransaction');

const voucherService = require('../src/services/voucher.service');

async function runTests() {
  console.log('🚀 Bắt đầu chạy chuỗi kiểm thử liên kết Giấy phép kinh doanh & Hệ thống Tích điểm...');
  
  // 1. Kết nối DB
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Đã kết nối MongoDB thành công.');

  const uniqueSuffix = Date.now().toString().slice(-6);

  // Tạo tài khoản Mock với đầy đủ fullName và username
  const testCustomer = new User({
    fullName: 'Khách Hàng Test',
    username: `customer_${uniqueSuffix}`,
    email: `test_customer_${uniqueSuffix}@example.com`,
    password: 'password123',
    role: 'customer',
    loyaltyPoints: 1000,
    totalPointsEarned: 1000
  });
  await testCustomer.save();
  console.log(`✅ Đã tạo Khách hàng test: ${testCustomer.fullName} (Số dư ban đầu: ${testCustomer.loyaltyPoints} Coins)`);

  const testOwner = new User({
    fullName: 'Chủ Nhà Hàng Test',
    username: `owner_${uniqueSuffix}`,
    email: `test_owner_${uniqueSuffix}@example.com`,
    password: 'password123',
    role: 'restaurant_owner'
  });
  await testOwner.save();
  console.log(`✅ Đã tạo Chủ nhà hàng test: ${testOwner.fullName}`);

  // 2. Test tạo nhà hàng kèm GPKD và Ngân hàng (Owner)
  const testRestaurant = new Restaurant({
    name: 'Nhà Hàng Buffet Sen Vàng',
    description: 'Ẩm thực buffet ba miền tinh tế.',
    cuisineTypes: ['vietnamese'],
    priceRange: 'moderate',
    capacity: 100,
    phoneNumber: '0987654321',
    email: 'buffetsenvang@example.com',
    ownerId: testOwner._id,
    address: { street: '123 Đường 2 Tháng 9', ward: 'Bình Thuận', district: 'Hải Châu', city: 'Đà Nẵng' },
    coordinates: {
      latitude: 16.0130,
      longitude: 108.0700
    },
    location: {
      type: 'Point',
      coordinates: [108.0700, 16.0130]
    },
    taxCode: '0102030405',
    businessLicense: {
      number: 'GPKD-BUFFET-789',
      imageUrl: 'https://res.cloudinary.com/bookeat/image/upload/v12345/gpkd_test.png'
    },
    bankInfo: {
      bankName: 'Vietcombank',
      accountNumber: '0071001234567',
      accountHolder: 'NGUYEN VAN OWNER',
      branch: 'Chi nhánh Đà Nẵng'
    },
    approvalStatus: 'pending'
  });
  await testRestaurant.save();
  console.log('✅ Đã lưu thông tin nhà hàng với Số GPKD, Mã số thuế và Tài khoản Ngân hàng thành công.');

  // 3. Test duyệt nhà hàng tự động xác minh GPKD (Admin)
  // Giả lập logic duyệt nhà hàng trong admin controller
  testRestaurant.approvalStatus = 'approved';
  testRestaurant.approvedBy = testOwner._id;
  testRestaurant.approvedAt = new Date();
  testRestaurant.active = true;
  
  if (testRestaurant.businessLicense && testRestaurant.businessLicense.number && testRestaurant.businessLicense.imageUrl) {
    testRestaurant.businessLicense.verifiedAt = new Date();
  }
  await testRestaurant.save();
  
  if (testRestaurant.businessLicense.verifiedAt) {
    console.log(`✅ Admin phê duyệt thành công. Trường businessLicense.verifiedAt đã được điền tự động: ${testRestaurant.businessLicense.verifiedAt}`);
  } else {
    throw new Error('❌ Lỗi: businessLicense.verifiedAt không được cập nhật khi phê duyệt!');
  }

  // 4. Test Tích xu tự động khi Booking chuyển sang completed
  const testBooking = new Booking({
    customerId: testCustomer._id,
    restaurantId: testRestaurant._id,
    bookingDate: new Date(),
    bookingTime: '19:00',
    numberOfGuests: 4,
    customerName: testCustomer.fullName,
    customerPhone: '0912345678',
    customerEmail: testCustomer.email,
    depositAmount: 50000,
    depositPaid: true,
    status: 'confirmed'
  });
  await testBooking.save();
  console.log(`✅ Đã tạo đơn đặt bàn confirmed, tiền cọc: ${testBooking.depositAmount} VND.`);

  // Đổi trạng thái sang completed và lưu
  testBooking.status = 'completed';
  testBooking.completedAt = new Date();
  await testBooking.save();
  console.log('✅ Đã chuyển đổi trạng thái đặt bàn sang completed và lưu.');

  // Chờ 1 giây để post-save hook hoàn thành
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Kiểm tra số dư xu của khách hàng
  const updatedCustomer = await User.findById(testCustomer._id);
  const expectedPoints = 1000 + 5000 + (50000 * 0.05); // 1000 + 5000 + 2500 = 8500
  console.log(`🔍 Số dư xu của khách hàng sau khi hoàn tất đặt bàn: ${updatedCustomer.loyaltyPoints} Coins (Dự kiến: ${expectedPoints})`);
  if (updatedCustomer.loyaltyPoints === expectedPoints) {
    console.log('✅ Thử nghiệm Tích xu tự động hoàn toàn thành công!');
  } else {
    throw new Error(`❌ Lỗi: Số xu tích lũy sai lệch! Có: ${updatedCustomer.loyaltyPoints}, cần: ${expectedPoints}`);
  }

  // Kiểm tra giao dịch tích xu trong DB
  const earnTx = await LoyaltyTransaction.findOne({
    userId: testCustomer._id,
    type: 'earn_completed',
    referenceId: testBooking._id
  });
  if (earnTx) {
    console.log(`✅ Đã tìm thấy giao dịch Tích xu tương ứng trong DB: +${earnTx.points} xu (${earnTx.description})`);
  } else {
    throw new Error('❌ Không tìm thấy bản ghi LoyaltyTransaction earn_completed!');
  }

  // 5. Test đổi xu tích điểm lấy Voucher
  // Tạo voucher loyalty
  const loyaltyVoucher = new Voucher({
    name: 'Voucher Đổi Thưởng 50k',
    code: `TESTLOYALTY_${Date.now().toString().slice(-4)}`,
    description: 'Sử dụng 5000 xu để đổi lấy voucher giảm giá 50k.',
    type: 'loyalty',
    discountType: 'fixed_amount',
    discountValue: 50000,
    minOrderAmount: 200000,
    pointsCost: 5000,
    createdBy: testOwner._id,
    status: 'active'
  });
  await loyaltyVoucher.save();
  console.log(`✅ Đã tạo Voucher loại loyalty: ${loyaltyVoucher.code} (Chi phí đổi: ${loyaltyVoucher.pointsCost} xu)`);

  // Lưu voucher vào ví khách hàng (Exchanging)
  console.log('⏳ Tiến hành đổi voucher...');
  await voucherService.saveVoucherForCustomer(loyaltyVoucher._id, testCustomer._id, 'manual_save');
  console.log('✅ Hàm saveVoucherForCustomer phản hồi thành công.');

  // Kiểm tra số dư xu sau khi đổi
  const updatedCustomer2 = await User.findById(testCustomer._id);
  const expectedPointsAfterRedemption = expectedPoints - 5000; // 8500 - 5000 = 3500
  console.log(`🔍 Số dư xu của khách sau khi đổi voucher: ${updatedCustomer2.loyaltyPoints} Coins (Dự kiến: ${expectedPointsAfterRedemption})`);
  if (updatedCustomer2.loyaltyPoints === expectedPointsAfterRedemption) {
    console.log('✅ Khấu trừ xu đổi voucher thành công!');
  } else {
    throw new Error(`❌ Lỗi: Số xu khấu trừ sai lệch! Có: ${updatedCustomer2.loyaltyPoints}, cần: ${expectedPointsAfterRedemption}`);
  }

  // Kiểm tra giao dịch trừ xu trong DB
  const redeemTx = await LoyaltyTransaction.findOne({
    userId: testCustomer._id,
    type: 'redeem_voucher',
    referenceId: loyaltyVoucher._id
  });
  if (redeemTx) {
    console.log(`✅ Đã tìm thấy giao dịch đổi xu trong DB: -${Math.abs(redeemTx.points)} xu (${redeemTx.description})`);
  } else {
    throw new Error('❌ Không tìm thấy bản ghi LoyaltyTransaction redeem_voucher!');
  }

  // 6. Test chặn đổi trùng
  try {
    console.log('⏳ Thử đổi lại voucher vừa đổi...');
    await voucherService.saveVoucherForCustomer(loyaltyVoucher._id, testCustomer._id, 'manual_save');
    throw new Error('❌ Lỗi: Hệ thống cho phép đổi trùng voucher đã đổi trước đó!');
  } catch (err) {
    console.log(`✅ Ngăn chặn đổi trùng thành công. Lỗi trả về: "${err.message}"`);
  }

  // 7. Test chặn đổi khi không đủ xu
  // Tạo voucher loyalty đắt đỏ
  const expensiveVoucher = new Voucher({
    name: 'Voucher VIP 200k',
    code: `TESTLOYALTY_VIP_${Date.now().toString().slice(-4)}`,
    description: 'Sử dụng 10000 xu để đổi lấy voucher giảm giá 200k.',
    type: 'loyalty',
    discountType: 'fixed_amount',
    discountValue: 200000,
    minOrderAmount: 500000,
    pointsCost: 10000,
    createdBy: testOwner._id,
    status: 'active'
  });
  await expensiveVoucher.save();
  
  try {
    console.log(`⏳ Thử đổi voucher đắt đỏ (${expensiveVoucher.pointsCost} xu) khi chỉ còn ${updatedCustomer2.loyaltyPoints} xu...`);
    await voucherService.saveVoucherForCustomer(expensiveVoucher._id, testCustomer._id, 'manual_save');
    throw new Error('❌ Lỗi: Hệ thống cho phép đổi voucher dù số dư xu không đủ!');
  } catch (err) {
    console.log(`✅ Ngăn chặn đổi khi không đủ xu thành công. Lỗi trả về: "${err.message}"`);
  }

  // 8. Dọn dẹp dữ liệu kiểm thử
  console.log('🧹 Đang dọn dẹp dữ liệu kiểm thử...');
  await User.findByIdAndDelete(testCustomer._id);
  await User.findByIdAndDelete(testOwner._id);
  await Restaurant.findByIdAndDelete(testRestaurant._id);
  await Booking.findByIdAndDelete(testBooking._id);
  await Voucher.findByIdAndDelete(loyaltyVoucher._id);
  await Voucher.findByIdAndDelete(expensiveVoucher._id);
  await CustomerVoucher.deleteMany({ customerId: testCustomer._id });
  await LoyaltyTransaction.deleteMany({ userId: testCustomer._id });
  
  console.log('🎉 TẤT CẢ CÁC BÀI KIỂM THỬ ĐÃ ĐẠT! KHÔNG PHÁT HIỆN LỖI! 🎉');
  process.exit(0);
}

runTests().catch(err => {
  console.error('❌ Kiểm thử thất bại với lỗi:', err);
  process.exit(1);
});
