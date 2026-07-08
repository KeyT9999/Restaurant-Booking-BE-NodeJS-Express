'use strict';

const express      = require('express');
const authController = require('../controllers/auth.controller');
const { protect }  = require('../middleware/auth.middleware');

const router = express.Router();

// ─── Đăng ký / Đăng nhập ───
router.post('/register',             authController.register);
router.post('/register-restaurant',  authController.registerRestaurantOwner);
router.post('/login',                authController.login);

// ─── Profile / Logout (cần auth) ───
router.get( '/profile', protect, authController.getProfile);
router.post('/logout',  protect, authController.logout);

// ─── Email Verification ───
// GET  /api/v1/auth/verify-email?token=...
router.get( '/verify-email',         authController.verifyEmail);
// POST /api/v1/auth/resend-verification
router.post('/resend-verification',  authController.resendVerification);

// ─── Password Reset ───
// POST /api/v1/auth/forgot-password  { email }
router.post('/forgot-password',  authController.forgotPassword);
// POST /api/v1/auth/reset-password   { token, password, confirmPassword }
router.post('/reset-password',   authController.resetPassword);

// ─── Google OAuth ───
const setupGoogleRoutes = () => {
  try {
    const { passport, initPassport } = require('../config/passport.config');
    const isConfigured = initPassport();

    if (isConfigured) {
      // Bước 1: Redirect sang Google để user đăng nhập
      router.get(
        '/google',
        (req, res, next) => {
          const { state } = req.query;
          passport.authenticate('google', {
            scope  : ['profile', 'email'],
            session: false,
            state  : state
          })(req, res, next);
        }
      );

      // Bước 2: Google callback sau khi user đồng ý
      router.get(
        '/google/callback',
        passport.authenticate('google', {
          session        : false,
          failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/auth/login?error=google_failed`,
        }),
        authController.googleCallback
      );
    } else {
      router.get('/google',          authController.googleNotConfigured);
      router.get('/google/callback', authController.googleNotConfigured);
    }
  } catch {
    router.get('/google',          authController.googleNotConfigured);
    router.get('/google/callback', authController.googleNotConfigured);
  }
};

setupGoogleRoutes();

// Mobile Google Sign-In verification route (Native Google Auth)
router.post('/google/mobile', authController.googleMobileLogin);

module.exports = router;
