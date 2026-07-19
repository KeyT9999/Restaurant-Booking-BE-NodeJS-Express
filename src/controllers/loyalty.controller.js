'use strict';

const loyaltyService = require('../services/loyalty.service');

/**
 * Lấy tóm tắt ví xu và lịch sử giao dịch
 */
const getLoyaltySummary = async (req, res) => {
  try {
    const userId = req.user._id;

    // 1. Quét dọn các xu đã hết hạn trước khi lấy dữ liệu
    await loyaltyService.checkAndProcessExpiredCoins(userId);

    // 2. Lấy lịch sử giao dịch
    const history = await loyaltyService.getHistory(userId);

    return res.json({
      success: true,
      data: {
        loyaltyPoints: req.user.loyaltyPoints || 0,
        totalPointsEarned: req.user.totalPointsEarned || 0,
        history,
      },
    });
  } catch (error) {
    console.error('❌ [GetLoyaltySummary] Lỗi:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ khi lấy thông tin tích điểm',
    });
  }
};

/**
 * Tính thử số xu tối đa được dùng cho một mức cọc
 */
const previewRedemption = async (req, res) => {
  try {
    const userId = req.user._id;
    const depositAmount = Number(req.query.depositAmount || 0);

    if (isNaN(depositAmount) || depositAmount < 0) {
      return res.status(400).json({
        success: false,
        message: 'Số tiền đặt cọc không hợp lệ',
      });
    }

    const { coinsToApply, finalAmount } = loyaltyService.calculateMaxCoinsForDeposit(
      depositAmount,
      req.user.loyaltyPoints || 0
    );

    return res.json({
      success: true,
      data: {
        depositAmount,
        userCoins: req.user.loyaltyPoints || 0,
        coinsToApply,
        finalAmount,
      },
    });
  } catch (error) {
    console.error('❌ [PreviewRedemption] Lỗi:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ khi tính toán xu áp dụng',
    });
  }
};

module.exports = {
  getLoyaltySummary,
  previewRedemption,
};
