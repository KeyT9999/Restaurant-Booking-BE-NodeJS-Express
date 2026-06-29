'use strict';

const express = require('express');
const loyaltyController = require('../controllers/loyalty.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');

const router = express.Router();

// Tất cả các API ví xu đều yêu cầu đăng nhập
router.use(protect);

// Lấy thông tin tóm tắt ví xu và lịch sử
router.get('/summary', restrictTo('customer'), loyaltyController.getLoyaltySummary);

// Tính toán thử số xu áp dụng cho mức cọc
router.get('/preview', restrictTo('customer'), loyaltyController.previewRedemption);

// API ẩn phục vụ giả lập/kiểm thử tích xu
router.post('/simulate', restrictTo('customer'), loyaltyController.simulateEarnCoins);

module.exports = router;
