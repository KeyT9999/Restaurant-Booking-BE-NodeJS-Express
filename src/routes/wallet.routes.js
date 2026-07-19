const express = require('express');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const walletController = require('../controllers/wallet.controller');

const router = express.Router();
router.use(protect, restrictTo('customer'));
router.get('/', walletController.getMyWallet);
router.get('/transactions', walletController.getMyTransactions);

module.exports = router;
