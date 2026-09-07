const express = require("express");
const router = express.Router();
const { body } = require("express-validator");
const {
  register,
  verifyEmail,
  login,
  forgotPassword,
  resetPassword,
  logout,
  getMe,
  changePassword,
  deleteAccount,
} = require("../controllers/authController");
const { protect } = require("../middleware/authGuard");
const { authLimiter, passwordResetLimiter } = require("../middleware/rateLimiter");

// ─── Validation rules ─────────────────────────────────────────────────────────
const registerValidation = [
  body("fullName")
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage("Full name must be 2–50 characters"),
  body("email")
    .isEmail()
    .normalizeEmail()
    .withMessage("Please enter a valid email"),
  body("password")
    .isLength({ min: 8, max: 128 })
    .withMessage("Password must be 8–128 characters")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage("Password must contain uppercase, lowercase, and a number"),
];

const loginValidation = [
  body("email").isEmail().normalizeEmail().withMessage("Please enter a valid email"),
  body("password").notEmpty().withMessage("Password is required"),
];

// ─── Routes ──────────────────────────────────────────────────────────────────
// verify-email and reset-password now rate-limited too — they accept secret
// tokens, so leaving them unlimited invited brute-force attempts.
router.post("/register",        authLimiter, registerValidation, register);
router.post("/verify-email",    authLimiter, verifyEmail);
router.post("/login",           authLimiter, loginValidation, login);
router.post("/forgot-password", passwordResetLimiter, forgotPassword);
router.post("/reset-password",  passwordResetLimiter, resetPassword);
router.post("/logout",          protect, logout);
router.get("/me",               protect, getMe);
router.post("/change-password", protect, changePassword);
router.delete("/account",       protect, deleteAccount);

module.exports = router;
