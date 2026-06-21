'use strict';

const express          = require('express');
const adminController  = require('../controllers/admin.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');

const adminRestaurantController = require('../controllers/admin.restaurant.controller');

const router = express.Router();

// ─── Public: Setup admin ban đầu (chỉ dùng 1 lần) ───
router.post('/setup', adminController.setupAdmin);

// ─── Tất cả routes bên dưới cần đăng nhập + role admin ───
router.use(protect);
router.use(restrictTo('admin'));

// ─── Dashboard ───
router.get('/dashboard', adminController.getDashboard);

// ─── Users CRUD ───
router.get(   '/users',              adminController.getUsers);
router.get(   '/users/:id',          adminController.getUserById);
router.post(  '/users',              adminController.createUser);
router.put(   '/users/:id',          adminController.updateUser);
router.patch( '/users/:id/status',   adminController.toggleUserStatus);
router.delete('/users/:id',          adminController.deleteUser);
router.patch( '/users/:id/password', adminController.resetUserPassword);

// ─── Restaurants Management ───
router.get(   '/restaurants',                 adminRestaurantController.getRestaurants);
router.get(   '/restaurants/:id',             adminRestaurantController.getRestaurantById);
router.put(   '/restaurants/:id/approve',     adminRestaurantController.approveRestaurant);
router.put(   '/restaurants/:id/reject',      adminRestaurantController.rejectRestaurant);
router.put(   '/restaurants/:id/suspend',     adminRestaurantController.suspendRestaurant);
router.put(   '/restaurants/:id/unsuspend',   adminRestaurantController.unsuspendRestaurant);
router.delete('/restaurants/:id',             adminRestaurantController.softDeleteRestaurant);
router.put(   '/restaurants/:id/restore',     adminRestaurantController.restoreRestaurant);
router.patch( '/restaurants/:id',             adminRestaurantController.updateRestaurant);
router.get(   '/restaurants/:id/activity-logs', adminRestaurantController.getActivityLogs);

// ─── Bookings Management ───
const adminBookingController = require('../controllers/admin.booking.controller');
router.get(   '/bookings',            adminBookingController.getBookings);
router.get(   '/bookings/stats',      adminBookingController.getBookingStats);
router.get(   '/bookings/:id',        adminBookingController.getBookingById);
router.patch( '/bookings/:id/status', adminBookingController.updateBookingStatus);
router.put(   '/bookings/:id/revert-no-show', adminBookingController.revertNoShow);

// ─── Payments & Revenue Management ───
const adminPaymentController = require('../controllers/admin.payment.controller');
const bookingCommissionController = require('../controllers/booking-commission.controller');
const adminMonetizationController = require('../controllers/admin-monetization.controller');
router.get(   '/payments',           adminPaymentController.getAllPayments);
router.get(   '/transactions',       adminPaymentController.getAllTransactions);
router.get(   '/revenue',            adminPaymentController.getRevenue);
router.get(   '/webhook-logs',       adminPaymentController.getWebhookLogs);
router.get(   '/monetization/summary', adminMonetizationController.getRevenueSummary);
router.get(   '/monetization/payments', adminMonetizationController.getPaymentTransactions);
router.get(   '/monetization/booking-commissions', adminMonetizationController.getBookingCommissions);
router.get(   '/monetization/top-owners', adminMonetizationController.getTopOwners);
router.get(   '/monetization/top-restaurants', adminMonetizationController.getTopRestaurants);
router.get(   '/monetization/payment-health', adminMonetizationController.getPaymentHealth);
router.get(   '/monetization/settlement-readiness', adminMonetizationController.getSettlementReadiness);
router.get(   '/monetization/export.csv', adminMonetizationController.exportRevenueCsv);
router.get(   '/monetization/legacy-booking-commissions', bookingCommissionController.getAdminCommissions);

// ─── Refund Management ───
const refundController = require('../controllers/refund.controller');
router.get(   '/refunds',            refundController.getAllRefunds);
router.patch( '/refunds/:id/approve', refundController.approveRefund);
router.patch( '/refunds/:id/reject',  refundController.rejectRefund);
router.post(  '/refunds/:id/process', refundController.processRefund);

// ─── Withdrawal Requests Management ───
const adminWithdrawalController = require('../controllers/admin.withdrawal.controller');
router.get(   '/withdrawals',              adminWithdrawalController.getAllWithdrawals);
router.patch( '/withdrawals/:id/approve',  adminWithdrawalController.approveWithdrawal);
router.patch( '/withdrawals/:id/reject',   adminWithdrawalController.rejectWithdrawal);
router.patch( '/withdrawals/:id/complete', adminWithdrawalController.completeWithdrawal);

// Waitlist Management
const adminWaitlistController = require('../controllers/admin.waitlist.controller');
router.get(   '/waitlists',            adminWaitlistController.getWaitlists);
router.get(   '/waitlists/stats',      adminWaitlistController.getStats);
router.get(   '/waitlists/:id',        adminWaitlistController.getWaitlistById);
router.patch( '/waitlists/:id/status', adminWaitlistController.updateWaitlistStatus);

// ─── Reviews Management ───
const adminReviewController = require('../controllers/admin.review.controller');
router.get(   '/reviews/reported',     adminReviewController.getReportedReviews);
router.put(   '/reviews/:id/hide',     adminReviewController.hideReview);
router.put(   '/reviews/:id/restore',  adminReviewController.restoreReview);

module.exports = router;
