const { verifyToken } = require('../utils/jwtHelper');
const User = require('../models/User');

// Protect routes — requires valid JWT
const protect = async (req, res, next) => {
  let token;

  // Check Authorization header first, then cookie
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies && req.cookies.accessToken) {
    token = req.cookies.accessToken;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized — no token provided',
    });
  }

  try {
    const decoded = verifyToken(token);
    req.user = await User.findById(decoded.id).select('-password');

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'User no longer exists',
      });
    }

    if (!req.user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account has been deactivated',
      });
    }

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Token is invalid or expired',
    });
  }
};

// Admin only access
const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({
      success: false,
      message: 'Access denied — admin only',
    });
  }
};

module.exports = { protect, adminOnly };