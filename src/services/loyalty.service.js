'use strict';

const User = require('../models/User');
const LoyaltyTransaction = require('../models/LoyaltyTransaction');

/**
 * Thêm Coins cho người dùng
 */
const addCoins = async (userId, amount, type, referenceId, description, expiryMonths = 6) => {
  if (amount <= 0) return null;

  // Chống cộng xu trùng lặp (Idempotency Check)
  if (referenceId && type) {
    const existing = await LoyaltyTransaction.findOne({ referenceId, type });
    if (existing) {
      console.log(`[Loyalty] Giao dịch tích xu đã tồn tại cho referenceId=${referenceId}, type=${type}. Bỏ qua cộng trùng.`);
      return existing;
    }
  }

  const user = await User.findById(userId);
  if (!user) throw new Error('Người dùng không tồn tại');

  // Tính ngày hết hạn (mặc định 6 tháng sau)
  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + expiryMonths);

  // Tạo giao dịch cộng xu
  const transaction = await LoyaltyTransaction.create({
    userId,
    points: amount,
    type,
    referenceId,
    description,
    expiresAt,
    isExpired: false,
  });

  // Cập nhật số dư xu của User
  user.loyaltyPoints = (user.loyaltyPoints || 0) + amount;
  user.totalPointsEarned = (user.totalPointsEarned || 0) + amount;
  await user.save();

  return transaction;
};

/**
 * Khấu trừ Coins của người dùng
 */
const deductCoins = async (userId, amount, type, referenceId, description) => {
  if (amount <= 0) return null;

  const user = await User.findById(userId);
  if (!user) throw new Error('Người dùng không tồn tại');

  if ((user.loyaltyPoints || 0) < amount) {
    throw new Error('Số dư xu không đủ để thực hiện giao dịch này');
  }

  // Tạo giao dịch trừ xu (lưu giá trị âm)
  const transaction = await LoyaltyTransaction.create({
    userId,
    points: -amount,
    type,
    referenceId,
    description,
  });

  // Cập nhật số dư xu của User
  user.loyaltyPoints = Math.max(0, (user.loyaltyPoints || 0) - amount);
  await user.save();

  return transaction;
};

/**
 * Lấy lịch sử giao dịch xu
 */
const getHistory = async (userId) => {
  return LoyaltyTransaction.find({ userId }).sort({ createdAt: -1 });
};

/**
 * Kiểm tra và xử lý các giao dịch xu đã hết hạn
 */
const checkAndProcessExpiredCoins = async (userId) => {
  const user = await User.findById(userId);
  if (!user) return 0;

  // Lấy các giao dịch cộng xu đã quá hạn và chưa được đánh dấu hết hạn
  const expiredTransactions = await LoyaltyTransaction.find({
    userId,
    points: { $gt: 0 },
    expiresAt: { $lt: new Date() },
    isExpired: false,
  });

  if (expiredTransactions.length === 0) return 0;

  let totalExpiredCoins = 0;
  for (const tx of expiredTransactions) {
    totalExpiredCoins += tx.points;
    tx.isExpired = true;
    await tx.save();
  }

  if (totalExpiredCoins > 0) {
    // Tạo bản ghi giao dịch ghi nhận việc xu bị hết hạn
    await LoyaltyTransaction.create({
      userId,
      points: -totalExpiredCoins,
      type: 'admin_adjust',
      description: `Hết hạn ${totalExpiredCoins} Coins tích lũy từ các giao dịch cũ`,
    });

    // Cập nhật số dư xu của User
    user.loyaltyPoints = Math.max(0, (user.loyaltyPoints || 0) - totalExpiredCoins);
    await user.save();
  }

  return totalExpiredCoins;
};

/**
 * Tính toán số xu tối đa có thể áp dụng cho tiền đặt cọc
 * - Quy ước: 1 Coin = 1 VND
 * - Giới hạn tối đa (Redemption Cap): 50% tiền cọc
 * - Đảm bảo số tiền thanh toán thực tế không nhỏ hơn hạn mức tối thiểu của cổng thanh toán (minGatewayAmount)
 */
const calculateMaxCoinsForDeposit = (depositAmount, userCoins, minGatewayAmount = 2000) => {
  if (depositAmount <= 0) {
    return { coinsToApply: 0, finalAmount: 0 };
  }

  // 1. Áp dụng tối đa 50% tiền đặt cọc
  const maxCoinsAllowed = Math.floor(depositAmount * 0.5);

  // 2. Không áp dụng nhiều hơn số xu người dùng hiện có
  let coinsToApply = Math.min(userCoins, maxCoinsAllowed);

  // 3. Đảm bảo tiền mặt thực tế phải trả không nhỏ hơn hạn mức tối thiểu (minGatewayAmount)
  // Nếu (depositAmount - coinsToApply) < minGatewayAmount, ta phải bớt số xu áp dụng đi
  if (depositAmount - coinsToApply < minGatewayAmount) {
    coinsToApply = Math.max(0, depositAmount - minGatewayAmount);
  }

  const finalAmount = depositAmount - coinsToApply;

  return {
    coinsToApply,
    finalAmount,
  };
};

module.exports = {
  addCoins,
  deductCoins,
  getHistory,
  checkAndProcessExpiredCoins,
  calculateMaxCoinsForDeposit,
};
