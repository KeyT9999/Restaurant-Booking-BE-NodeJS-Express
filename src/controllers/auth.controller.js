'use strict';

const crypto = require('crypto');
const jwt    = require('jsonwebtoken');
const User   = require('../models/User');
const emailService = require('../services/email.service');

// ────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^(0[35789])[0-9]{8}$/;

const getJwtSecret = () => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required in production');
  }
  return 'bookeat_dev_secret_change_me';
};

const parseExpiresInSeconds = (value = '7d') => {
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return Number(text);
  const match = text.match(/^(\d+)([smhd])$/i);
  if (!match) return 7 * 24 * 60 * 60;
  const amount = Number(match[1]);
  const unit   = match[2].toLowerCase();
  return amount * { s: 1, m: 60, h: 3600, d: 86400 }[unit];
};

const signToken = (user) => {
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
  const userId = user._id.toString();
  return {
    access_token: jwt.sign(
      { id: userId, sub: userId, username: user.username, role: user.role },
      getJwtSecret(),
      { expiresIn }
    ),
    token_type : 'Bearer',
    expires_in : parseExpiresInSeconds(expiresIn),
  };
};

const authResponse = (user) => ({
  ...signToken(user),
  user: user.toPublicJSON(),
});

/**
 * Tạo token ngẫu nhiên an toàn (hex 64 ký tự).
 * KHÔNG lưu trực tiếp — caller phải hash trước khi lưu DB nếu cần.
 * Ở đây ta lưu plain token vì link verify không được đoán được (64-byte entropy).
 */
const generateToken = () => crypto.randomBytes(32).toString('hex');

// ────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────

const normalizeRegisterBody = (body) => ({
  username      : String(body.username || '').trim(),
  email         : String(body.email || '').trim().toLowerCase(),
  fullName      : String(body.fullName || '').trim(),
  phoneNumber   : body.phoneNumber ? String(body.phoneNumber).trim() : null,
  address       : body.address     ? String(body.address).trim()     : null,
  password      : String(body.password || ''),
  confirmPassword: String(body.confirmPassword || ''),
});

const validateRegister = (data) => {
  if (!data.username || data.username.length < 3 || data.username.length > 50)
    return 'Username phải từ 3-50 ký tự';
  if (!data.email || !EMAIL_REGEX.test(data.email))
    return 'Email không hợp lệ';
  if (!data.fullName)
    return 'Họ và tên không được để trống';
  if (data.phoneNumber && !PHONE_REGEX.test(data.phoneNumber))
    return 'Số điện thoại phải là 10 số và bắt đầu bằng 03, 05, 07, 08, 09';
  if (!data.password || data.password.length < 8)
    return 'Mật khẩu phải có ít nhất 8 ký tự';
  if (data.password !== data.confirmPassword)
    return 'Mật khẩu xác nhận không khớp';
  return null;
};

// ────────────────────────────────────────────────────────
// A. Register
// ────────────────────────────────────────────────────────

const registerWithRole = async (req, res, role) => {
  try {
    const data = normalizeRegisterBody(req.body);
    const validationError = validateRegister(data);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const existingUser = await User.findOne({
      $or: [{ username: data.username }, { email: data.email }],
    });
    if (existingUser) {
      const message = existingUser.email === data.email ? 'Email đã tồn tại' : 'Username đã tồn tại';
      return res.status(409).json({ success: false, message });
    }

    // Tạo verification token
    const verificationToken  = generateToken();
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 giờ

    const user = await User.create({
      username                  : data.username,
      email                     : data.email,
      password                  : data.password,
      fullName                  : data.fullName,
      phoneNumber               : data.phoneNumber,
      address                   : data.address,
      role,
      emailVerified             : false,
      emailVerificationToken    : verificationToken,
      emailVerificationExpires  : verificationExpires,
      active                    : true,
    });

    // Gửi email verify — non-blocking, lỗi gửi mail không làm hỏng đăng ký
    emailService.sendVerificationEmail(user, verificationToken)
      .catch((err) => console.error('⚠️  [Register] Gửi email verify thất bại:', err.message));

    // Thông báo admin — hoàn toàn optional
    emailService.sendAdminNewUserNotification(user)
      .catch((err) => console.warn('⚠️  [Register] Admin notification thất bại:', err.message));

    return res.status(201).json({
      success : true,
      message : 'Đăng ký thành công! Vui lòng kiểm tra email để xác minh tài khoản.',
      user    : user.toPublicJSON(),
    });
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0] || 'Tài khoản';
      return res.status(409).json({ success: false, message: `${field} đã tồn tại` });
    }
    console.error('❌ [Register] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể đăng ký tài khoản' });
  }
};

const register              = (req, res) => registerWithRole(req, res, 'customer');
const registerRestaurantOwner = (req, res) => registerWithRole(req, res, 'restaurant_owner');

// ────────────────────────────────────────────────────────
// B. Login
// ────────────────────────────────────────────────────────

const login = async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    if (!username || !password) {
      return res.status(400).json({
        success : false,
        message : 'Username/email và mật khẩu là bắt buộc',
      });
    }

    const user = await User.findOne({
      $or: [{ username }, { email: username.toLowerCase() }],
    }).select('+password');

    if (!user) {
      return res.status(401).json({
        success : false,
        message : 'Tên đăng nhập hoặc mật khẩu không chính xác',
      });
    }

    if (!user.active) {
      return res.status(401).json({ success: false, message: 'Tài khoản đã bị vô hiệu hóa' });
    }

    const passwordMatches = await user.comparePassword(password);
    if (!passwordMatches) {
      return res.status(401).json({
        success : false,
        message : 'Tên đăng nhập hoặc mật khẩu không chính xác',
      });
    }

    // Kiểm tra email đã xác minh chưa (bỏ qua nếu tài khoản Google)
    if (!user.emailVerified && !user.googleId) {
      return res.status(403).json({
        success           : false,
        message           : 'Tài khoản chưa được xác minh. Vui lòng kiểm tra email để xác minh tài khoản.',
        needsVerification : true,
        email             : user.email,
      });
    }

    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    return res.json({
      success : true,
      message : 'Đăng nhập thành công',
      ...authResponse(user),
    });
  } catch (error) {
    console.error('❌ [Login] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể đăng nhập' });
  }
};

// ────────────────────────────────────────────────────────
// C. Verify Email
// ────────────────────────────────────────────────────────

const verifyEmail = async (req, res) => {
  try {
    const token = String(req.query.token || req.body.token || '').trim();

    if (!token) {
      return res.status(400).json({ success: false, message: 'Token xác minh là bắt buộc' });
    }

    // Tìm user có token này (phải select các field hidden)
    const user = await User.findOne({ emailVerificationToken: token })
      .select('+emailVerificationToken +emailVerificationExpires');

    if (!user) {
      return res.status(400).json({
        success : false,
        message : 'Token không hợp lệ hoặc không tồn tại',
        code    : 'INVALID_TOKEN',
      });
    }

    if (user.emailVerified) {
      return res.status(400).json({
        success : false,
        message : 'Tài khoản đã được xác minh trước đó',
        code    : 'ALREADY_VERIFIED',
      });
    }

    if (user.emailVerificationExpires < new Date()) {
      return res.status(400).json({
        success : false,
        message : 'Token đã hết hạn. Vui lòng yêu cầu gửi lại email xác minh.',
        code    : 'TOKEN_EXPIRED',
        email   : user.email,
      });
    }

    // Xác minh thành công — cập nhật user
    user.emailVerified            = true;
    user.emailVerificationToken   = null;
    user.emailVerificationExpires = null;
    await user.save({ validateBeforeSave: false });

    return res.json({
      success : true,
      message : 'Xác minh tài khoản thành công! Bạn có thể đăng nhập ngay.',
    });
  } catch (error) {
    console.error('❌ [VerifyEmail] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể xác minh tài khoản' });
  }
};

// ────────────────────────────────────────────────────────
// D. Resend Verification Email
// ────────────────────────────────────────────────────────

const resendVerification = async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();

    if (!email || !EMAIL_REGEX.test(email)) {
      return res.status(400).json({ success: false, message: 'Email không hợp lệ' });
    }

    const user = await User.findOne({ email })
      .select('+emailVerificationToken +emailVerificationExpires');

    // Trả response giống nhau kể cả user không tồn tại — tránh email enumeration
    if (!user) {
      return res.json({
        success : true,
        message : 'Nếu email tồn tại và chưa xác minh, chúng tôi sẽ gửi lại email xác minh.',
      });
    }

    if (user.emailVerified) {
      return res.status(400).json({
        success : false,
        message : 'Tài khoản này đã được xác minh.',
        code    : 'ALREADY_VERIFIED',
      });
    }

    // Tạo token mới
    const newToken   = generateToken();
    const newExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    user.emailVerificationToken   = newToken;
    user.emailVerificationExpires = newExpires;
    await user.save({ validateBeforeSave: false });

    // Gửi email — non-blocking
    emailService.sendResendVerificationEmail(user, newToken)
      .catch((err) => console.error('⚠️  [ResendVerification] Gửi mail thất bại:', err.message));

    return res.json({
      success : true,
      message : 'Email xác minh đã được gửi lại. Vui lòng kiểm tra hộp thư.',
    });
  } catch (error) {
    console.error('❌ [ResendVerification] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể gửi lại email xác minh' });
  }
};

// ────────────────────────────────────────────────────────
// E. Forgot Password
// ────────────────────────────────────────────────────────

const forgotPassword = async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();

    if (!email || !EMAIL_REGEX.test(email)) {
      return res.status(400).json({ success: false, message: 'Email không hợp lệ' });
    }

    const user = await User.findOne({ email }).select('+passwordResetToken +passwordResetExpires');

    // Luôn trả thành công để tránh email enumeration attack
    if (!user) {
      return res.json({
        success : true,
        message : 'Nếu email tồn tại trong hệ thống, chúng tôi sẽ gửi link đặt lại mật khẩu.',
      });
    }

    // Không reset nếu token cũ còn hiệu lực < 5 phút (chống spam)
    if (
      user.passwordResetExpires &&
      user.passwordResetExpires > new Date(Date.now() + 55 * 60 * 1000) // còn > 55 phút
    ) {
      return res.status(429).json({
        success : false,
        message : 'Yêu cầu đặt lại mật khẩu đã được gửi. Vui lòng chờ ít nhất 5 phút trước khi thử lại.',
      });
    }

    const resetToken   = generateToken();
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 60 phút

    user.passwordResetToken   = resetToken;
    user.passwordResetExpires = resetExpires;
    await user.save({ validateBeforeSave: false });

    emailService.sendForgotPasswordEmail(user, resetToken)
      .catch((err) => console.error('⚠️  [ForgotPassword] Gửi mail thất bại:', err.message));

    return res.json({
      success : true,
      message : 'Link đặt lại mật khẩu đã được gửi đến email của bạn.',
    });
  } catch (error) {
    console.error('❌ [ForgotPassword] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể xử lý yêu cầu' });
  }
};

// ────────────────────────────────────────────────────────
// F. Reset Password
// ────────────────────────────────────────────────────────

const resetPassword = async (req, res) => {
  try {
    const token       = String(req.body.token || req.query.token || '').trim();
    const password    = String(req.body.password || '');
    const confirmPass = String(req.body.confirmPassword || '');

    if (!token) {
      return res.status(400).json({ success: false, message: 'Token đặt lại mật khẩu là bắt buộc' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ success: false, message: 'Mật khẩu phải có ít nhất 8 ký tự' });
    }
    if (password !== confirmPass) {
      return res.status(400).json({ success: false, message: 'Mật khẩu xác nhận không khớp' });
    }

    const user = await User.findOne({ passwordResetToken: token })
      .select('+password +passwordResetToken +passwordResetExpires');

    if (!user) {
      return res.status(400).json({
        success : false,
        message : 'Token không hợp lệ hoặc không tồn tại',
        code    : 'INVALID_TOKEN',
      });
    }

    if (user.passwordResetExpires < new Date()) {
      return res.status(400).json({
        success : false,
        message : 'Token đã hết hạn. Vui lòng yêu cầu đặt lại mật khẩu lại.',
        code    : 'TOKEN_EXPIRED',
      });
    }

    // Cập nhật mật khẩu — pre('save') hook sẽ hash tự động
    user.password             = password;
    user.passwordResetToken   = null;
    user.passwordResetExpires = null;
    await user.save();

    return res.json({
      success : true,
      message : 'Đặt lại mật khẩu thành công! Bạn có thể đăng nhập với mật khẩu mới.',
    });
  } catch (error) {
    console.error('❌ [ResetPassword] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể đặt lại mật khẩu' });
  }
};

// ────────────────────────────────────────────────────────
// G. Profile / Logout / Google OAuth
// ────────────────────────────────────────────────────────

const getProfile = (req, res) =>
  res.json({ success: true, user: req.user.toPublicJSON() });

// ────────────────────────────────────────────────────────
// H. Update Profile (PUT /users/me)
// ────────────────────────────────────────────────────────

const ALLOWED_UPDATE_FIELDS = ['fullName', 'phoneNumber', 'address'];

const updateProfile = async (req, res) => {
  try {
    const updates = {};

    // Chỉ cho phép các field được whitelist
    for (const field of ALLOWED_UPDATE_FIELDS) {
      if (req.body[field] !== undefined) {
        updates[field] = typeof req.body[field] === 'string'
          ? req.body[field].trim()
          : req.body[field];
      }
    }

    // Validate
    if (updates.fullName !== undefined && !updates.fullName) {
      return res.status(400).json({ success: false, message: 'Họ và tên không được để trống' });
    }
    if (updates.phoneNumber && !PHONE_REGEX.test(updates.phoneNumber)) {
      return res.status(400).json({
        success: false,
        message: 'Số điện thoại phải là 10 số và bắt đầu bằng 03, 05, 07, 08, 09',
      });
    }

    // Không cho phép cập nhật email, role, password qua đây
    if (req.body.email || req.body.role || req.body.password) {
      return res.status(400).json({
        success: false,
        message: 'Không thể cập nhật email, role hoặc mật khẩu qua endpoint này',
      });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng' });
    }

    return res.json({
      success: true,
      message: 'Cập nhật thông tin thành công',
      user: user.toPublicJSON(),
    });
  } catch (error) {
    console.error('❌ [UpdateProfile] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể cập nhật thông tin' });
  }
};

// ────────────────────────────────────────────────────────
// I. Change Password (PUT /users/me/password)
// ────────────────────────────────────────────────────────

const changePassword = async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword     = String(req.body.newPassword || '');
    const confirmPassword = String(req.body.confirmPassword || '');

    // Validate
    if (!currentPassword) {
      return res.status(400).json({ success: false, message: 'Mật khẩu hiện tại không được để trống' });
    }
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'Mật khẩu mới phải có ít nhất 8 ký tự' });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Xác nhận mật khẩu không khớp' });
    }
    if (newPassword === currentPassword) {
      return res.status(400).json({ success: false, message: 'Mật khẩu mới không được trùng mật khẩu hiện tại' });
    }

    // Lấy user kèm password (select: false trong schema)
    const user = await User.findById(req.user._id).select('+password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng' });
    }

    // Tài khoản Google không có password
    if (!user.password) {
      return res.status(400).json({
        success: false,
        message: 'Tài khoản Google không thể đổi mật khẩu theo cách này',
      });
    }

    // Kiểm tra mật khẩu hiện tại
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Mật khẩu hiện tại không chính xác' });
    }

    // Cập nhật mật khẩu — pre('save') hook sẽ hash tự động
    user.password = newPassword;
    await user.save();

    return res.json({
      success: true,
      message: 'Đổi mật khẩu thành công! Vui lòng đăng nhập lại để xác nhận.',
    });
  } catch (error) {
    console.error('❌ [ChangePassword] Lỗi:', error.message);
    return res.status(500).json({ success: false, message: 'Không thể đổi mật khẩu' });
  }
};

const logout = (req, res) =>
  res.json({ success: true, message: 'Logout successful' });

const googleNotConfigured = (req, res) =>
  res.status(501).json({
    success : false,
    message : 'Google OAuth chưa được cấu hình. Kiểm tra GOOGLE_CLIENT_ID và GOOGLE_CLIENT_SECRET trong .env.',
  });

/**
 * Được gọi sau khi Passport xác thực Google thành công.
 * Tài khoản Google được tự động xác minh email.
 */
const googleCallback = (req, res) => {
  try {
    const user = req.user;
    const state = req.query.state;
    
    let frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    if (state && (state.startsWith('bookeatreactnative://') || state.startsWith('exp://') || state === 'mobile')) {
      frontendUrl = state === 'mobile' ? 'bookeatreactnative://google-callback' : state;
    }

    const isMobile = frontendUrl.startsWith('bookeatreactnative://') || frontendUrl.startsWith('exp://');

    if (!user) {
      const redirectUrl = isMobile 
        ? `${frontendUrl}?error=no_user`
        : `${frontendUrl}/auth/google/callback?error=no_user`;
      return res.redirect(redirectUrl);
    }

    const tokenData   = signToken(user);
    const params      = new URLSearchParams({
      token     : tokenData.access_token,
      expires_in: String(tokenData.expires_in),
    });

    const redirectUrl = isMobile
      ? `${frontendUrl}?${params.toString()}`
      : `${frontendUrl}/auth/google/callback?${params.toString()}`;
    return res.redirect(redirectUrl);
  } catch (error) {
    const state = req.query.state;
    let frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    if (state && (state.startsWith('bookeatreactnative://') || state.startsWith('exp://') || state === 'mobile')) {
      frontendUrl = state === 'mobile' ? 'bookeatreactnative://google-callback' : state;
    }
    const isMobile = frontendUrl.startsWith('bookeatreactnative://') || frontendUrl.startsWith('exp://');
    const redirectUrl = isMobile
      ? `${frontendUrl}?error=server_error`
      : `${frontendUrl}/auth/google/callback?error=server_error`;
    return res.redirect(redirectUrl);
  }
};

const googleMobileLogin = async (req, res) => {
  try {
    const { token, tokenType = 'access' } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Mã xác thực Google là bắt buộc',
      });
    }

    const axios = require('axios');
    let googleId, email, fullName, avatarUrl;

    if (tokenType === 'id') {
      const googleRes = await axios.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${token}`);
      const profile = googleRes.data;
      
      if (profile.error || profile.error_description) {
        return res.status(400).json({
          success: false,
          message: profile.error_description || 'Mã ID Token không hợp lệ',
        });
      }
      
      googleId = profile.sub;
      email = profile.email;
      fullName = profile.name || 'Google User';
      avatarUrl = profile.picture || null;
    } else {
      // Access token
      const googleRes = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const profile = googleRes.data;
      
      googleId = profile.sub;
      email = profile.email;
      fullName = profile.name || 'Google User';
      avatarUrl = profile.picture || null;
    }

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Không lấy được thông tin email từ Google',
      });
    }

    // Find or create user
    let user = await User.findOne({
      $or: [{ googleId }, { email }],
    });

    if (user) {
      if (!user.googleId) {
        user.googleId = googleId;
      }
      if (!user.avatarUrl && avatarUrl) {
        user.avatarUrl = avatarUrl;
      }
      user.lastLogin = new Date();
      await user.save({ validateBeforeSave: false });
    } else {
      // Create user
      const baseUsername = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_');
      let username = baseUsername;
      let counter = 1;

      while (await User.exists({ username })) {
        username = `${baseUsername}_${counter++}`;
      }

      user = await User.create({
        googleId,
        email,
        username,
        fullName,
        avatarUrl,
        emailVerified: true,
        active: true,
        role: 'customer',
        lastLogin: new Date(),
      });
    }

    const tokenData = signToken(user);
    return res.json({
      success: true,
      message: 'Đăng nhập Google thành công',
      data: {
        user: user.toPublicJSON(),
        token: tokenData.access_token,
        expiresIn: tokenData.expires_in
      }
    });
  } catch (error) {
    console.error('Lỗi đăng nhập Google Native:', error);
    return res.status(500).json({
      success: false,
      message: 'Lỗi xác thực thông tin tài khoản Google với máy chủ',
      error: error.message
    });
  }
};

// ────────────────────────────────────────────────────────
// Exports
// ────────────────────────────────────────────────────────

module.exports = {
  register,
  registerRestaurantOwner,
  login,
  getProfile,
  updateProfile,
  changePassword,
  logout,
  googleNotConfigured,
  googleCallback,
  googleMobileLogin,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
};
