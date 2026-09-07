const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');

// Only register the strategy when credentials exist — previously a missing
// GOOGLE_CLIENT_ID crashed the whole auth server at boot, taking login and
// registration down with it even for password users.
const googleConfigured =
  process.env.GOOGLE_CLIENT_ID &&
  process.env.GOOGLE_CLIENT_SECRET &&
  process.env.GOOGLE_CALLBACK_URL;

if (googleConfigured) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails && profile.emails[0] && profile.emails[0].value;
          if (!email) {
            return done(new Error('Google profile did not include an email'), null);
          }

          // Check if user already exists with this Google ID
          let user = await User.findOne({ googleId: profile.id });

          if (user) {
            user.lastLogin = new Date();
            await user.save();
            return done(null, user);
          }

          // Check if email already registered (link accounts)
          user = await User.findOne({ email });
          if (user) {
            user.googleId = profile.id;
            // Do NOT downgrade a local account to authProvider='google' —
            // that silently disabled their password-change ability. Linking
            // the googleId is enough for Google sign-in to work.
            if (!user.password) {
              user.authProvider = 'google';
            }
            user.isEmailVerified = true;
            user.lastLogin = new Date();
            await user.save();
            return done(null, user);
          }

          // Create brand new user from Google profile
          user = await User.create({
            fullName: profile.displayName || 'New User',
            email,
            googleId: profile.id,
            authProvider: 'google',
            profilePicture: (profile.photos && profile.photos[0] && profile.photos[0].value) || '',
            isEmailVerified: true, // Google already verified the email
            lastLogin: new Date(),
          });

          return done(null, user);
        } catch (error) {
          return done(error, null);
        }
      }
    )
  );
} else {
  console.warn('Google OAuth not configured (GOOGLE_CLIENT_ID / SECRET / CALLBACK_URL missing) — Google sign-in disabled');
}

passport.serializeUser((user, done) => done(null, user._id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

module.exports = passport;
module.exports.googleConfigured = !!googleConfigured;
