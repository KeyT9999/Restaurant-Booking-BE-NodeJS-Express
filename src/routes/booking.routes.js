'use strict';

const express = require('express');
const bookingController = require('../controllers/booking.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const { validateBookingInput, verifyCustomerBookingAccess } = require('../middleware/booking.middleware');
const { strictLimiter, moderateLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// ─── Public Routes ───
router.post('/availability-check', moderateLimiter, bookingController.checkAvailability);

// ─── Protected Customer Routes ───
router.use(protect);

router.post('/hold-tables', protect, bookingController.holdTables);
router.post('/release-holds', protect, bookingController.releaseHolds);
router.post('/', restrictTo('customer'), strictLimiter, validateBookingInput, bookingController.createBooking);
router.get('/my', restrictTo('customer'), bookingController.getMyBookings);
router.get('/:id', verifyCustomerBookingAccess, bookingController.getBookingById);
router.put('/:id', verifyCustomerBookingAccess, validateBookingInput, bookingController.updateBooking);
router.delete('/:id/cancel', verifyCustomerBookingAccess, bookingController.cancelBooking);
router.put('/:id/reschedule', verifyCustomerBookingAccess, bookingController.rescheduleBooking);
router.put('/:id/pre-order', verifyCustomerBookingAccess, bookingController.updatePreOrder);
router.put('/:id/checkin', verifyCustomerBookingAccess, bookingController.checkIn);

module.exports = router;
