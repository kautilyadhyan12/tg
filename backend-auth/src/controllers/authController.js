const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { validationResult } = require('express-validator');
const User = require('../models/User');
const { generateAccessToken, generateRefreshToken } = require('../utils/jwtHelper');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../utils/emailService');

// SECURITY: one-time tokens (email verification, password reset) are stored
// as SHA-256 hashes. The raw token only ever exists in the email link — a
// database leak can no longer be turned into account takeovers.
const hashToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex');

// Pre-computed bcrypt hash used to equalize login timing when the email
// doesn't exist (otherwise "user not found" returns ~100ms faster than a
// wrong password, letting attackers enumerate registered emails).
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer-not-a-real-password', 10);

// ─── Helper: send token as cookie + JSON ─────────────────────────────────────
const sendTokenResponse = (user, statusCode, res) => {
  const accessToken = generateAccessToken(user._id);
  const refreshToken = generateRefreshToken(user._id);

  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
  };

  res
    .status(statusCode)
    .cookie('accessToken', accessToken, cookieOptions)
    .cookie('refreshToken', refreshToken, { ...cookieOptions, maxAge: 30 * 24 * 60 * 60 * 1000 })
    .json({
      success: true,
      accessToken,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        profilePicture: user.profilePicture,
        isEmailVerified: user.isEmailVerified,
        onboardingCompleted: user.onboardingCompleted,
        role: user.role,
        fitnessLevel: user.fitnessLevel,
        xp: user.xp,
        level: user.level,
      },
    });
};

// ─── POST /api/auth/register ──────────────────────────────────────────────────
const register = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { fullName, email, password } = req.body;

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email already exists',
      });
    }

    // Raw token goes in the email; only its hash is stored.
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const user = await User.create({
      fullName,
      email,
      password,
      emailVerificationToken: hashToken(verificationToken),
      emailVerificationExpires: verificationExpires,
    });

    // Send verification email (don't block response if email fails)
    try {
      await sendVerificationEmail(email, fullName, verificationToken);
    } catch (emailError) {
      console.error('Email send failed:', emailError.message);
      // Don't fail registration if email fails — user can request resend
    }

    res.status(201).json({
      success: true,
      message: 'Registration successful! Please check your email to verify your account.',
      userId: user._id,
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ success: false, message: 'Server error during registration' });
  }
};

// ─── POST /api/auth/verify-email ─────────────────────────────────────────────
const verifyEmail = async (req, res) => {
  const { token } = req.body;

  if (!token || typeof token !== 'string' || token.length > 128) {
    return res.status(400).json({ success: false, message: 'Verification token is required' });
  }

  try {
    const user = await User.findOne({
      emailVerificationToken: hashToken(token),
      emailVerificationExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification token',
      });
    }

    user.isEmailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    sendTokenResponse(user, 200, res);
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({ success: false, message: 'Server error during email verification' });
  }
};

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
const login = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      // Timing equalizer: run a bcrypt compare anyway so "no such account"
      // takes as long as "wrong password".
      await bcrypt.compare(password, DUMMY_HASH);
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    if (user.isLocked()) {
      const lockMinutes = Math.ceil((user.lockUntil - Date.now()) / 60000);
      return res.status(423).json({
        success: false,
        message: `Account locked due to too many failed attempts. Try again in ${lockMinutes} minutes.`,
      });
    }

    if (user.authProvider === 'google' && !user.password) {
      return res.status(400).json({
        success: false,
        message: 'This account uses Google Sign-In. Please login with Google.',
      });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      await user.incrementLoginAttempts();
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    // Reset login attempts on success
    user.loginAttempts = 0;
    user.lockUntil = undefined;
    user.lastLogin = new Date();
    await user.save();

    sendTokenResponse(user, 200, res);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Server error during login' });
  }
};

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────
const forgotPassword = async (req, res) => {
  const { email } = req.body;

  if (!email || typeof email !== 'string' || email.length > 254) {
    return res.status(400).json({ success: false, message: 'Email is required' });
  }

  try {
    const user = await User.findOne({ email: email.toLowerCase().trim() });

    // Always return success — don't reveal if email exists (security)
    if (!user) {
      return res.status(200).json({
        success: true,
        message: 'If an account exists with this email, a reset link has been sent.',
      });
    }

    // Raw token goes in the email; only its hash is stored.
    const resetToken = crypto.randomBytes(32).toString('hex');
    user.passwordResetToken = hashToken(resetToken);
    user.passwordResetExpires = Date.now() + 60 * 60 * 1000; // 1 hour
    await user.save();

    try {
      await sendPasswordResetEmail(user.email, user.fullName, resetToken);
    } catch (emailError) {
      console.error('Reset email send failed:', emailError.message);
    }

    res.status(200).json({
      success: true,
      message: 'If an account exists with this email, a reset link has been sent.',
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─── POST /api/auth/reset-password ───────────────────────────────────────────
const resetPassword = async (req, res) => {
  const { token, password } = req.body;

  if (!token || typeof token !== 'string' || token.length > 128 || !password) {
    return res.status(400).json({ success: false, message: 'Token and new password are required' });
  }

  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return res.status(400).json({ success: false, message: 'Password must be 8–128 characters' });
  }

  try {
    const user = await User.findOne({
      passwordResetToken: hashToken(token),
      passwordResetExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });
    }

    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.loginAttempts = 0;
    user.lockUntil = undefined;
    await user.save();

    res.status(200).json({ success: true, message: 'Password reset successful. You can now log in.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ success: false, message: 'Server error during password reset' });
  }
};

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
const logout = (req, res) => {
  res
    .cookie('accessToken', '', { httpOnly: true, expires: new Date(0) })
    .cookie('refreshToken', '', { httpOnly: true, expires: new Date(0) })
    .status(200)
    .json({ success: true, message: 'Logged out successfully' });
};

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    res.status(200).json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─── POST /api/auth/change-password ──────────────────────────────────────────
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current and new password are required',
      });
    }

    if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) {
      return res.status(400).json({
        success: false,
        message: 'New password must be 8–128 characters',
      });
    }

    const user = await User.findById(req.user._id).select('+password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.authProvider !== 'local') {
      return res.status(400).json({
        success: false,
        message: 'Password change not available for OAuth accounts',
      });
    }

    const matches = await user.matchPassword(currentPassword);
    if (!matches) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect',
      });
    }

    user.password = newPassword;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ─── DELETE /api/auth/account ────────────────────────────────────────────────
// Collections in the shared database that hold per-user data written by the
// ML backend (user_id stored as an ObjectId). Deleting the account without
// these leaves the user's workouts/meals/chats orphaned forever — a storage
// leak and a broken privacy expectation.
const USER_DATA_COLLECTIONS = [
  'workout_sessions',
  'workout_templates',
  'meal_logs',
  'coach_conversations',
  'body_measurements',
  'running_sessions',
  'running_schedules',
  'running_routes',
];

const deleteAccount = async (req, res) => {
  try {
    const { password } = req.body;

    const user = await User.findById(req.user._id).select('+password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.authProvider === 'local') {
      if (!password) {
        return res.status(400).json({
          success: false,
          message: 'Password required to delete account',
        });
      }
      const matches = await user.matchPassword(password);
      if (!matches) {
        return res.status(401).json({
          success: false,
          message: 'Password is incorrect',
        });
      }
    }

    const userId = req.user._id;

    // Cascade-delete the user's data in the shared DB (best effort — the
    // account deletion itself must not fail because one collection errored).
    const db = mongoose.connection.db;
    for (const coll of USER_DATA_COLLECTIONS) {
      try {
        await db.collection(coll).deleteMany({ user_id: userId });
      } catch (e) {
        console.error(`Cascade delete failed for ${coll}:`, e.message);
      }
    }

    await User.findByIdAndDelete(userId);

    res.status(200).json({
      success: true,
      message: 'Account and all associated data deleted successfully',
    });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = {
  register, verifyEmail, login, forgotPassword, resetPassword,
  logout, getMe, changePassword, deleteAccount,
};
