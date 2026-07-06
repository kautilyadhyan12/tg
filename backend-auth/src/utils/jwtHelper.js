const jwt = require('jsonwebtoken');

const getSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // Fail loudly and early — an unset secret must never silently sign tokens
    throw new Error('JWT_SECRET is not configured');
  }
  return secret;
};

// Generate access token (short lived - 7 days)
const generateAccessToken = (userId) => {
  return jwt.sign(
    { id: userId },
    getSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

// Generate refresh token (long lived - 30 days)
const generateRefreshToken = (userId) => {
  return jwt.sign(
    { id: userId, type: 'refresh' },
    getSecret(),
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }
  );
};

// Verify a token and return decoded payload.
// SECURITY: refresh tokens must never be accepted where an access token is
// expected — previously a stolen 30-day refresh token authenticated anywhere.
const verifyToken = (token) => {
  const decoded = jwt.verify(token, getSecret(), { algorithms: ['HS256'] });
  if (decoded && decoded.type === 'refresh') {
    const err = new Error('Refresh token cannot be used for authentication');
    err.name = 'JsonWebTokenError';
    throw err;
  }
  return decoded;
};

module.exports = { generateAccessToken, generateRefreshToken, verifyToken };
