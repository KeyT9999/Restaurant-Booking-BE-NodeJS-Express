const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const paymentCtrl = require('../controllers/payment.controller');

// ─── Payment Routes ───
router.post('/', protect, paymentCtrl.createPayment);
router.post('/create', protect, paymentCtrl.createPayment);
router.get('/my', protect, paymentCtrl.getMyPayments);
router.get('/check-status/:orderCode', protect, paymentCtrl.checkPaymentStatus);
router.get('/:id', protect, paymentCtrl.getPaymentById);
router.post('/:id/cancel', protect, paymentCtrl.cancelPayment);

module.exports = router;
