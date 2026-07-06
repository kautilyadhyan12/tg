const rateLimit = require('express-rate-limit');

// ── Auth limiter (login + register) ──────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max:      20,
  message: {
    success: false,
    message: 'Too many attempts. Please try again in 1 hour.',
  },
  standardHeaders:        true,
  legacyHeaders:          false,
  skipSuccessfulRequests: true,
});

// ── Password reset limiter ────────────────────────────────────────────────────
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max:      5,
  message: {
    success: false,
    message: 'Too many password reset attempts. Try again in 1 hour.',
  },
  standardHeaders: true,
  legacyHeaders:   false,
});

// ── General API limiter ───────────────────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max:      500,
  message: {
    success: false,
    message: 'Too many requests. Please slow down.',
  },
  standardHeaders: true,
  legacyHeaders:   false,
});

// ── Aliases so both old and new code work ─────────────────────────────────────
const loginLimiter    = authLimiter;
const registerLimiter = authLimiter;
const apiLimiter      = generalLimiter;

module.exports = {
  authLimiter,
  passwordResetLimiter,
  generalLimiter,
  loginLimiter,
  registerLimiter,
  apiLimiter,
};