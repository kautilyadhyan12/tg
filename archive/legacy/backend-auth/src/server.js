require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), override: true });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const connectDB = require('./config/db');
const { generalLimiter } = require('./middleware/rateLimiter');
const authRoutes = require('./routes/auth.routes');
const googleAuthRoutes = require('./routes/googleAuth.routes');
const passport = require('./config/passport');

const isProduction = process.env.NODE_ENV === 'production';

// ─── Refuse to boot in production with insecure config ───────────────────────
// (Mirrors the ML backend's validate_for_production.)
if (isProduction) {
  const problems = [];
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    problems.push('JWT_SECRET missing or shorter than 32 chars (must equal ML_JWT_SECRET on the ML backend)');
  }
  if (!process.env.MONGO_URI) problems.push('MONGO_URI is not set');
  if (!process.env.FRONTEND_URL || process.env.FRONTEND_URL.includes('localhost')) {
    problems.push('FRONTEND_URL missing or points at localhost');
  }
  if (problems.length) {
    console.error('Refusing to start in production with insecure config:\n  - ' + problems.join('\n  - '));
    process.exit(1);
  }
}

// ─── Connect to MongoDB ───────────────────────────────────────────────────────
connectDB();

const app = express();

// CRITICAL behind nginx/any PaaS: without this, express-rate-limit sees every
// request as coming from the proxy's IP — the entire userbase then shares ONE
// rate-limit bucket and real users start getting 429s at trivial traffic.
app.set('trust proxy', 1);

// ─── Security middleware ──────────────────────────────────────────────────────
app.use(helmet());

// FRONTEND_URL may be a comma-separated list (same convention as the ML backend)
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',').map((o) => o.trim()).filter(Boolean);
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

// ─── Body parsing ─────────────────────────────────────────────────────────────
// Auth payloads are tiny — 100kb is generous. The previous 10mb limit was a
// free memory-exhaustion DoS vector on the most attacked service in the stack.
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(cookieParser());
app.use(passport.initialize());

// ─── Rate limiting ────────────────────────────────────────────────────────────
app.use('/api', generalLimiter);

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/auth', googleAuthRoutes);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  const mongoose = require('mongoose');
  const dbReady = mongoose.connection.readyState === 1;
  res.status(dbReady ? 200 : 503).json({
    success: dbReady,
    message: dbReady ? 'Auth backend is running' : 'Database unavailable',
    timestamp: new Date().toISOString(),
  });
});

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack || err);
  // Never leak internal error details to clients in production
  res.status(err.status || 500).json({
    success: false,
    message: isProduction ? 'Internal server error' : (err.message || 'Internal server error'),
  });
});

// ─── Start server ─────────────────────────────────────────────────────────────
const PORT = process.env.AUTH_PORT || 3001;
const server = app.listen(PORT, () => {
  console.log(`Auth backend running on port ${PORT} (env: ${process.env.NODE_ENV || 'development'})`);
});

// ─── Graceful shutdown (lets in-flight requests finish on deploy/restart) ────
const shutdown = (signal) => {
  console.log(`${signal} received — shutting down gracefully`);
  server.close(() => {
    const mongoose = require('mongoose');
    mongoose.connection.close(false).finally(() => process.exit(0));
  });
  // Force-exit if something hangs
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Crash visibly on truly unexpected errors instead of limping in a bad state
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
