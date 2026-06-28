const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const User = require('../src/models/User');
const LoyaltyTransaction = require('../src/models/LoyaltyTransaction');
const loyaltyService = require('../src/services/loyalty.service');

async function run() {
  console.log('🧪 Bắt đầu chạy test suite cho BookEat Coins...');
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Đã kết nối cơ sở dữ liệu');

  // 1. Tìm hoặc tạo tài khoản khách hàng test
  const testEmail = 'Phuc2348hong@gmail.com';
  let user = await User.findOne({ email: testEmail });
  if (!user) {
    console.log(`[Test] Tạo mới tài khoản khách hàng test: ${testEmail}`);
    user = await User.create({
      username: 'phucchau',
      email: testEmail,
      fullName: 'Phuc Chau',
      role: 'customer',
      active: true,
      emailVerified: true,
      loyaltyPoints: 0,
      totalPointsEarned: 0,
    });
  } else {
    // Reset điểm về 0 để dễ test các case
    user.loyaltyPoints = 0;
    user.totalPointsEarned = 0;
    await user.save();
    console.log(`[Test] Tìm thấy tài khoản khách hàng test: ${testEmail}. Đã reset điểm về 0.`);
  }

  const userId = user._id;

  // Xóa các giao dịch cũ của user này để làm sạch môi trường test
  await LoyaltyTransaction.deleteMany({ userId });

  // ==========================================
  // Test Case 1: Tích xu từ bữa ăn hoàn thành (Completed Booking)
  // ==========================================
  console.log('\n--- Test Case 1: Tích xu đơn thường (completed) ---');
  const tx1 = await loyaltyService.addCoins(
    userId,
    500, // 500 Coins
    'earn_completed',
    null,
    'Tích lũy 500 Coins từ đơn đặt bàn hoàn tất thành công'
  );
  console.log('Giao dịch tích xu:', {
    points: tx1.points,
    type: tx1.type,
    description: tx1.description,
  });

  let updatedUser = await User.findById(userId);
  console.log('Số dư xu của User:', updatedUser.loyaltyPoints); // 500
  console.log('Tổng xu tích lũy trọn đời:', updatedUser.totalPointsEarned); // 500
  if (updatedUser.loyaltyPoints === 500) console.log('=> PASS ✅');
  else console.log('=> FAIL ❌');

  // ==========================================
  // Test Case 2: Tích xu từ tiền cọc (Deposit)
  // ==========================================
  console.log('\n--- Test Case 2: Tích xu từ đặt cọc ---');
  // Cọc 500,000đ -> Tích 5,000 Coins (tỷ lệ 100k = 1k cọc = 1k Coins)
  const tx2 = await loyaltyService.addCoins(
    userId,
    5000,
    'earn_deposit',
    null,
    'Tích lũy 5,000 Coins từ tiền cọc 500k đặt bàn VIP'
  );
  updatedUser = await User.findById(userId);
  console.log('Số dư xu mới của User:', updatedUser.loyaltyPoints); // 5500
  if (updatedUser.loyaltyPoints === 5500) console.log('=> PASS ✅');
  else console.log('=> FAIL ❌');

  // ==========================================
  // Test Case 3: Tính toán xu tối đa áp dụng cho tiền đặt cọc (Redemption Cap & Gateway Limit)
  // ==========================================
  console.log('\n--- Test Case 3: Tính toán xu áp dụng cho tiền cọc (Redemption Cap & Gateway Limit) ---');
  
  // Case 3.1: Tiền cọc 100,000đ, user có 5,500 Coins. 
  // - 50% cọc = 50,000đ cọc tối đa được trả bằng xu.
  // - User chỉ có 5,500 Coins -> dùng hết 5,500 Coins, thanh toán còn lại 94,500đ (lớn hơn 2k min gateway)
  const case1 = loyaltyService.calculateMaxCoinsForDeposit(100000, updatedUser.loyaltyPoints);
  console.log('Case 3.1 (Cọc 100k, ví 5,5k):', case1); 
  // Kỳ vọng: coinsToApply = 5500, finalAmount = 94500
  if (case1.coinsToApply === 5500 && case1.finalAmount === 94500) console.log('=> PASS ✅');
  else console.log('=> FAIL ❌');

  // Case 3.2: Tiền cọc 8,000đ, user có 5,500 Coins.
  // - 50% cọc = 4,000đ.
  // - User có dư Coins -> Khấu trừ tối đa 4,000 Coins.
  // - Tiền mặt còn lại = 4,000đ (lớn hơn 2k min gateway)
  const case2 = loyaltyService.calculateMaxCoinsForDeposit(8000, updatedUser.loyaltyPoints);
  console.log('Case 3.2 (Cọc 8k, ví 5,5k):', case2);
  // Kỳ vọng: coinsToApply = 4000, finalAmount = 4000
  if (case2.coinsToApply === 4000 && case2.finalAmount === 4000) console.log('=> PASS ✅');
  else console.log('=> FAIL ❌');

  // Case 3.3: Tiền cọc 3,000đ, user có 5,500 Coins, hạn mức gateway tối thiểu là 2,000đ.
  // - 50% cọc = 1,500đ.
  // - Nếu dùng 1,500đ cọc bằng xu -> số tiền mặt phải trả là 1,500đ (< 2,000đ tối thiểu).
  // - Hệ thống tự động bớt xu áp dụng xuống 1,000 Coins, để tiền mặt thanh toán giữ ở mức 2,000đ.
  const case3 = loyaltyService.calculateMaxCoinsForDeposit(3000, updatedUser.loyaltyPoints, 2000);
  console.log('Case 3.3 (Cọc 3k, ví 5,5k, min gateway 2k):', case3);
  // Kỳ vọng: coinsToApply = 1000, finalAmount = 2000
  if (case3.coinsToApply === 1000 && case3.finalAmount === 2000) console.log('=> PASS ✅');
  else console.log('=> FAIL ❌');

  // ==========================================
  // Test Case 4: Khấu trừ xu (Redeem Coins)
  // ==========================================
  console.log('\n--- Test Case 4: Tiêu xu cọc đặt bàn ---');
  const tx3 = await loyaltyService.deductCoins(
    userId,
    4000, // Dùng 4,000 Coins
    'redeem_deposit',
    null,
    'Khấu trừ 4,000 Coins thanh toán cọc đơn bàn VIP'
  );
  console.log('Giao dịch tiêu xu:', {
    points: tx3.points,
    type: tx3.type,
    description: tx3.description,
  });

  updatedUser = await User.findById(userId);
  console.log('Số dư xu còn lại:', updatedUser.loyaltyPoints); // 5500 - 4000 = 1500
  if (updatedUser.loyaltyPoints === 1500) console.log('=> PASS ✅');
  else console.log('=> FAIL ❌');

  // ==========================================
  // Test Case 5: Xu hết hạn (Expiration check)
  // ==========================================
  console.log('\n--- Test Case 5: Xử lý xu hết hạn ---');
  
  // Tạo thủ công 1 giao dịch tích xu có expiresAt trong quá khứ (đã hết hạn)
  const pastDate = new Date();
  pastDate.setMonth(pastDate.getMonth() - 7); // 7 tháng trước
  
  await LoyaltyTransaction.create({
    userId,
    points: 1000,
    type: 'earn_completed',
    description: 'Xu khuyến mãi tích lũy từ 7 tháng trước',
    expiresAt: pastDate,
    isExpired: false,
  });

  // Tạm thời cộng 1000 xu này vào User để đồng bộ hóa cho kịch bản test
  updatedUser.loyaltyPoints += 1000;
  await updatedUser.save();
  console.log('Số dư xu của User trước khi chạy quét hết hạn:', updatedUser.loyaltyPoints); // 2500

  // Chạy hàm quét và dọn xu hết hạn
  const expiredCoinsCount = await loyaltyService.checkAndProcessExpiredCoins(userId);
  console.log('Số xu hết hạn đã quét và xử lý dọn dẹp:', expiredCoinsCount); // 1000

  updatedUser = await User.findById(userId);
  console.log('Số dư xu của User sau khi quét dọn hết hạn:', updatedUser.loyaltyPoints); // 1500
  if (expiredCoinsCount === 1000 && updatedUser.loyaltyPoints === 1500) console.log('=> PASS ✅');
  else console.log('=> FAIL ❌');

  await mongoose.disconnect();
  console.log('\n🏁 Hoàn thành chạy test suite cho BookEat Coins.');
}

run().catch(async (err) => {
  console.error('❌ Lỗi chạy test:', err);
  await mongoose.disconnect();
});
