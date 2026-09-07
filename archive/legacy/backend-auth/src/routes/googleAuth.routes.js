const express = require('express');
const router = express.Router();
const passport = require('../config/passport');
const { generateAccessToken } = require('../utils/jwtHelper');

const front = () =>
  (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim();

// If Google OAuth isn't configured, these routes answer cleanly instead of
// crashing (passport.authenticate('google') throws for unknown strategies).
const requireGoogle = (req, res, next) => {
  if (!passport.googleConfigured) {
    return res.redirect(`${front()}/login?error=google_not_configured`);
  }
  next();
};

// ─── Step 1: Redirect user to Google ─────────────────────────────────────────
router.get(
  '/google',
  requireGoogle,
  (req, res, next) =>
    passport.authenticate('google', {
      scope: ['profile', 'email'],
      session: false,
    })(req, res, next)
);

// ─── Step 2: Google redirects back here with auth code ───────────────────────
router.get(
  '/google/callback',
  requireGoogle,
  (req, res, next) =>
    passport.authenticate('google', {
      session: false,
      failureRedirect: `${front()}/login?error=google_failed`,
    })(req, res, next),
  (req, res) => {
    try {
      const token = generateAccessToken(req.user._id);
      const needsOnboarding = !req.user.onboardingCompleted;

      // Pass token via URL fragment — frontend reads it and stores it.
      // Fragments (#) don't get sent to the server, so this is safe in transit.
      res.redirect(
        `${front()}/auth/google/success#token=${token}&onboarding=${needsOnboarding}`
      );
    } catch (err) {
      console.error('Google callback error:', err);
      res.redirect(`${front()}/login?error=google_callback_failed`);
    }
  }
);

module.exports = router;
