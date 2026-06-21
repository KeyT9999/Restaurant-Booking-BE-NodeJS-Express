'use strict';

const express = require('express');
const ownerBookingController = require('../controllers/owner.booking.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const { verifyOwnerBookingAccess } = require('../middleware/booking.middleware');

const router = express.Router();

// ─── Protected Restaurant Owner Routes ───
router.use(protect);
router.use(restrictTo('restaurant_owner'));

router.get('/bookings', ownerBookingController.getRestaurantBookings);
router.get('/bookings/stats', ownerBookingController.getBookingStats);
router.get('/bookings/export', ownerBookingController.exportBookings);
router.get('/bookings/revenue-stats', ownerBookingController.getRevenueStats);
router.post('/bookings/create', ownerBookingController.ownerCreateBooking);
router.post('/bookings/bulk-cancel', ownerBookingController.bulkCancelBooking);
router.get('/bookings/:id', verifyOwnerBookingAccess, ownerBookingController.getBookingDetail);
router.put('/bookings/:id/confirm', verifyOwnerBookingAccess, ownerBookingController.confirmBooking);
router.put('/bookings/:id/cancel', verifyOwnerBookingAccess, ownerBookingController.cancelBooking);
router.put('/bookings/:id/complete', verifyOwnerBookingAccess, ownerBookingController.completeBooking);
router.put('/bookings/:id/no-show', verifyOwnerBookingAccess, ownerBookingController.markNoShow);
router.put('/bookings/:id/change-table', verifyOwnerBookingAccess, ownerBookingController.changeTable);
router.get('/bookings/:id/available-tables', verifyOwnerBookingAccess, ownerBookingController.getAvailableTables);
router.post('/bookings/:id/internal-notes', verifyOwnerBookingAccess, ownerBookingController.addInternalNote);
router.delete('/bookings/:id/internal-notes', verifyOwnerBookingAccess, ownerBookingController.deleteInternalNote);
router.delete('/bookings/:id/internal-notes/:noteId', verifyOwnerBookingAccess, ownerBookingController.deleteInternalNote);

router.get('/bookings/customer-history/:phone', ownerBookingController.getCustomerHistory);
router.post('/bookings/customer-tag', ownerBookingController.addCustomerTag);
router.delete('/bookings/customer-tag/:id', ownerBookingController.removeCustomerTag);

module.exports = router;
