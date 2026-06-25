const User = require('../models/User');
const { verifyJwtToken } = require('../utils/jwt');

const getBearerToken = (req) => {
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    return req.headers.authorization.split(' ')[1];
  }
  return null;
};

const loadAuthenticatedUser = async (token) => {
  if (!token) return null;

  const decoded = verifyJwtToken(token);
  const user = await User.findById(decoded.id || decoded.sub).select('-password');
  if (!user || !user.active) {
    return null;
  }

  return user;
};

const protect = async (req, res, next) => {
  try {
    const token = getBearerToken(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Bạn chưa đăng nhập. Vui lòng đăng nhập để tiếp tục.',
      });
    }

    const user = await loadAuthenticatedUser(token);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Token không hợp lệ hoặc user không tồn tại.',
      });
    }

    req.user = user;
    return next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, message: 'Token không hợp lệ.' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token đã hết hạn. Vui lòng đăng nhập lại.' });
    }
    return res.status(500).json({ success: false, message: 'Lỗi xác thực.' });
  }
};

const protectOptional = async (req, res, next) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      req.user = null;
      return next();
    }

    req.user = await loadAuthenticatedUser(token);
    return next();
  } catch (error) {
    req.user = null;
    return next();
  }
};

const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền thực hiện hành động này.',
      });
    }
    return next();
  };
};

module.exports = {
  getBearerToken,
  loadAuthenticatedUser,
  protect,
  protectOptional,
  restrictTo,
};
