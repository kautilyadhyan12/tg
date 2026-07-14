import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { useTransition } from '../context/TransitionContext';
import { Eye, EyeOff, Dumbbell, ArrowRight, Zap } from 'lucide-react';
import toast from 'react-hot-toast';

// Google OAuth is deferred: the new API has no /v1/auth/google yet (v1 §6.1
// lists it, but P2.1 shipped email/password only). Re-enabled by its own
// web-repoint card; this flag keeps the button in place meanwhile.
const GOOGLE_LOGIN_ENABLED = false;

export default function Login() {
  const { login }  = useAuth();
  const navigate   = useNavigate();
  const { triggerTransition } = useTransition();

  const [form,    setForm]    = useState({ email: '', password: '' });
  const [show,    setShow]    = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.email || !form.password) {
      toast.error('Please fill in all fields');
      return;
    }
    setLoading(true);
    try {
      const res = await login(form.email, form.password);
      triggerTransition(() => {
        if (res.user?.onboardingCompleted === false) {
          navigate('/onboarding');
        } else {
          navigate('/dashboard');
        }
      });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex"
      style={{ background: '#0A0908' }}
    >
      {/* ── Left — Auth form ─────────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-8 relative">

        {/* Ambient glow */}
        <div
          className="absolute pointer-events-none"
          style={{
            top:       '20%',
            left:      '10%',
            width:     400,
            height:    400,
            background:'radial-gradient(ellipse, rgba(255,138,31,0.06) 0%, transparent 70%)',
          }}
        />

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0  }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-sm relative z-10"
        >
          {/* Logo */}
          <div className="flex items-center gap-2.5 mb-10">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, #FF8A1F, #FFB347)',
                boxShadow:  '0 0 20px rgba(255,138,31,0.35)',
              }}
            >
              <Dumbbell className="w-4 h-4 text-white" />
            </div>
            <span
              className="font-bold text-lg tracking-tight"
              style={{ color: 'rgba(255,255,255,0.95)' }}
            >
              AI Home Gym
            </span>
          </div>

          {/* Heading */}
          <div className="mb-8">
            <h1
              className="text-4xl font-bold tracking-tighter mb-2"
              style={{ color: 'rgba(255,255,255,0.95)' }}
            >
              Welcome back.
            </h1>
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.40)' }}>
              Sign in to continue your training
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Email */}
            <div>
              <label
                className="block text-xs font-medium mb-2 uppercase tracking-wider"
                style={{ color: 'rgba(255,255,255,0.35)' }}
              >
                Email
              </label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="you@example.com"
                className="input-field"
                autoComplete="email"
              />
            </div>

            {/* Password */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label
                  className="text-xs font-medium uppercase tracking-wider"
                  style={{ color: 'rgba(255,255,255,0.35)' }}
                >
                  Password
                </label>
                <Link
                  to="/forgot-password"
                  className="text-xs transition-colors duration-200"
                  style={{ color: 'rgba(255,138,31,0.7)' }}
                  onMouseEnter={(e) => e.target.style.color = '#FF8A1F'}
                  onMouseLeave={(e) => e.target.style.color = 'rgba(255,138,31,0.7)'}
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <input
                  type={show ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="••••••••"
                  className="input-field pr-12"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 btn-icon w-7 h-7"
                >
                  {show
                    ? <EyeOff className="w-4 h-4" />
                    : <Eye    className="w-4 h-4" />
                  }
                </button>
              </div>
            </div>

            {/* Submit */}
            <motion.button
              type="submit"
              disabled={loading}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              className="w-full py-3.5 rounded-2xl font-semibold text-sm
                         text-white flex items-center justify-center gap-2
                         transition-all duration-200 mt-2"
              style={{
                background: loading
                  ? 'rgba(255,138,31,0.4)'
                  : 'linear-gradient(135deg, #FF8A1F, #FFB347)',
                boxShadow: loading
                  ? 'none'
                  : '0 4px 20px rgba(255,138,31,0.35)',
              }}
            >
              {loading ? (
                <div
                  className="w-5 h-5 rounded-full border-2 border-white
                             border-t-transparent animate-spin"
                />
              ) : (
                <>
                  Sign In
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </motion.button>
          </form>

          {GOOGLE_LOGIN_ENABLED && (
            <>
          {/* Or divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
            <span className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>
              or
            </span>
            <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
          </div>

          {/* Google sign in */}
          <motion.button
            type="button"
            whileHover={{ scale: 1.01 }}
            whileTap={{   scale: 0.99 }}
            onClick={() => {
              window.location.href = 'http://localhost:3001/api/auth/google';
            }}
            className="w-full py-3.5 rounded-2xl font-semibold text-sm
                       flex items-center justify-center gap-2.5
                       transition-all duration-200"
            style={{
              background: 'rgba(255,255,255,0.06)',
              border:     '1px solid rgba(255,255,255,0.10)',
              color:      'rgba(255,255,255,0.90)',
            }}
          >
            {/* Google G logo */}
            <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
              <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </motion.button>
            </>
          )}

          {/* Divider */}
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
            <span className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>
              New here?
            </span>
            <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
          </div>

          {/* Register link */}
          <Link to="/register">
            <motion.div
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              className="w-full py-3.5 rounded-2xl font-semibold text-sm
                         flex items-center justify-center gap-2
                         transition-all duration-200 cursor-pointer"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border:     '1px solid rgba(255,255,255,0.07)',
                color:      'rgba(255,255,255,0.65)',
              }}
            >
              Create an account
            </motion.div>
          </Link>

          {/* Footer */}
          <p
            className="text-center text-xs mt-8"
            style={{ color: 'rgba(255,255,255,0.20)' }}
          >
            By signing in you agree to our Terms & Privacy Policy
          </p>
        </motion.div>
      </div>

      {/* ── Right — Image panel ───────────────────────────────────────────── */}
      <div
        className="hidden lg:flex flex-1 relative overflow-hidden"
        style={{ maxWidth: '55%' }}
      >
        <img
          src="/images/exercises/lifting.jpg"
          alt="Training"
          className="w-full h-full object-cover"
          style={{ objectPosition: 'center 30%' }}
        />

        {/* Overlay */}
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(to right, #0A0908 0%, rgba(10,9,8,0.3) 40%, rgba(10,9,8,0.1) 100%)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse at 60% 50%, rgba(255,138,31,0.08) 0%, transparent 60%)',
          }}
        />

        {/* Quote overlay */}
        <div className="absolute bottom-12 left-10 right-10">
          <div
            className="p-6 rounded-3xl"
            style={{
              background:    'rgba(10,9,8,0.7)',
              backdropFilter:'blur(20px)',
              border:        '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4" style={{ color: '#FF8A1F' }} />
              <span
                className="text-xs font-semibold uppercase tracking-widest"
                style={{ color: '#FF8A1F' }}
              >
                AI-Powered Training
              </span>
            </div>
            <p
              className="text-xl font-bold tracking-tight mb-2"
              style={{ color: 'rgba(255,255,255,0.95)' }}
            >
              "Real-time form correction.<br />Every rep. Every set."
            </p>
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.40)' }}>
              YOLOv8 pose detection · Bidirectional LSTM · Voice coaching
            </p>
          </div>
        </div>

        {/* Stats floating pills */}
        <div className="absolute top-12 right-8 flex flex-col gap-3">
          {[
            { label: '17 joints tracked',  color: '#FF8A1F' },
            { label: '< 50ms latency',     color: '#4ade80' },
            { label: 'Voice corrections',  color: '#60a5fa' },
          ].map(({ label, color }) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0  }}
              transition={{ delay: 0.5, duration: 0.5 }}
              className="px-4 py-2 rounded-full text-xs font-semibold"
              style={{
                background:    'rgba(10,9,8,0.75)',
                backdropFilter:'blur(12px)',
                border:        `1px solid ${color}30`,
                color,
              }}
            >
              {label}
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}