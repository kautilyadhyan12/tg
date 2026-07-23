import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { useTransition } from '../context/TransitionContext';
import { Eye, EyeOff, Dumbbell, ArrowRight, Check } from 'lucide-react';
import toast from 'react-hot-toast';

// Google OAuth on the NEW API (v1 §6.1). Full-page navigation to
// /v1/auth/google; the callback sets httpOnly cookies (no token in JS). Sign-up
// and sign-in share the endpoint — the callback creates the account if new.
const GOOGLE_LOGIN_URL = `${import.meta.env.VITE_API_URL}/v1/auth/google`;

const PERKS = [
  'Real-time AI form correction',
  'Automatic rep counting',
  'Personalised workout plans',
  'Progress tracking & analytics',
  'RAG-powered AI coach',
];

export default function Register() {
  const { register } = useAuth();
  const navigate     = useNavigate();
  const { triggerTransition } = useTransition();

  const [form, setForm] = useState({
    fullName: '', email: '', password: '', confirm: '',
  });
  const [show,    setShow]    = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.fullName || !form.email || !form.password) {
      toast.error('Please fill in all fields');
      return;
    }
    if (form.password !== form.confirm) {
      toast.error('Passwords do not match');
      return;
    }
    if (form.password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(form.password)) {
      toast.error('Password must contain uppercase, lowercase, and a number');
      return;
    }
    setLoading(true);
    try {
      await register(form.fullName, form.email, form.password);
      toast.success('Account created! Please check your email.');
      triggerTransition(() => navigate('/login'));
    } catch (err) {
      toast.error(err.response?.data?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const strength = (() => {
    const p = form.password;
    if (!p) return 0;
    let s = 0;
    if (p.length >= 8)          s++;
    if (/[A-Z]/.test(p))        s++;
    if (/[0-9]/.test(p))        s++;
    if (/[^A-Za-z0-9]/.test(p)) s++;
    return s;
  })();

  const strengthLabel = ['', 'Weak', 'Fair', 'Good', 'Strong'][strength];
  const strengthColor = ['', '#ef4444', '#f59e0b', '#84cc16', '#22c55e'][strength];

  return (
    <div className="min-h-screen flex" style={{ background: '#0A0908' }}>

      {/* ── Left — Image panel ────────────────────────────────────────────── */}
      <div
        className="hidden lg:flex flex-col justify-end relative overflow-hidden"
        style={{ width: '45%' }}
      >
        <img
          src="/images/wellness/yoga2.jpg"
          alt="Fitness"
          className="absolute inset-0 w-full h-full object-cover"
          style={{ objectPosition: 'center center' }}
        />
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(to left, #0A0908 0%, rgba(10,9,8,0.2) 50%, rgba(10,9,8,0.05) 100%)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse at 40% 60%, rgba(255,138,31,0.07) 0%, transparent 60%)',
          }}
        />

        {/* Perks list */}
        <div className="relative z-10 p-10">
          <div
            className="p-6 rounded-3xl"
            style={{
              background:    'rgba(10,9,8,0.75)',
              backdropFilter:'blur(20px)',
              border:        '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <p
              className="text-xs font-semibold uppercase tracking-widest mb-4"
              style={{ color: '#FF8A1F' }}
            >
              Everything included, free
            </p>
            <div className="space-y-3">
              {PERKS.map((perk, i) => (
                <motion.div
                  key={perk}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0   }}
                  transition={{ delay: 0.1 * i, duration: 0.4 }}
                  className="flex items-center gap-3"
                >
                  <div
                    className="w-5 h-5 rounded-full flex items-center
                               justify-center flex-shrink-0"
                    style={{
                      background: 'rgba(255,138,31,0.15)',
                      border:     '1px solid rgba(255,138,31,0.25)',
                    }}
                  >
                    <Check className="w-3 h-3" style={{ color: '#FF8A1F' }} />
                  </div>
                  <span className="text-sm" style={{ color: 'rgba(255,255,255,0.70)' }}>
                    {perk}
                  </span>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Right — Register form ─────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-8 relative">

        {/* Ambient glow */}
        <div
          className="absolute pointer-events-none"
          style={{
            bottom:    '20%',
            right:     '10%',
            width:     400,
            height:    400,
            background:'radial-gradient(ellipse, rgba(255,138,31,0.05) 0%, transparent 70%)',
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
              Create account.
            </h1>
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.40)' }}>
              Start your AI-powered fitness journey
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Full name */}
            <div>
              <label
                className="block text-xs font-medium mb-2 uppercase tracking-wider"
                style={{ color: 'rgba(255,255,255,0.35)' }}
              >
                Full Name
              </label>
              <input
                type="text"
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                placeholder="John Smith"
                className="input-field"
                autoComplete="name"
              />
            </div>

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
              <label
                className="block text-xs font-medium mb-2 uppercase tracking-wider"
                style={{ color: 'rgba(255,255,255,0.35)' }}
              >
                Password
              </label>
              <div className="relative">
                <input
                  type={show ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="Min. 8 characters"
                  className="input-field pr-12"
                  autoComplete="new-password"
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

              {/* Password strength */}
              {form.password && (
                <div className="mt-2">
                  <div className="flex gap-1 mb-1">
                    {[1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className="flex-1 h-1 rounded-full transition-all duration-300"
                        style={{
                          background: i <= strength ? strengthColor : 'rgba(255,255,255,0.08)',
                        }}
                      />
                    ))}
                  </div>
                  <p className="text-2xs" style={{ color: strengthColor }}>
                    {strengthLabel}
                  </p>
                </div>
              )}
            </div>

            {/* Confirm password */}
            <div>
              <label
                className="block text-xs font-medium mb-2 uppercase tracking-wider"
                style={{ color: 'rgba(255,255,255,0.35)' }}
              >
                Confirm Password
              </label>
              <input
                type="password"
                value={form.confirm}
                onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                placeholder="••••••••"
                className="input-field"
                autoComplete="new-password"
                style={{
                  borderColor: form.confirm && form.confirm !== form.password
                    ? 'rgba(239,68,68,0.4)'
                    : form.confirm && form.confirm === form.password
                      ? 'rgba(34,197,94,0.4)'
                      : undefined,
                }}
              />
              {form.confirm && form.confirm !== form.password && (
                <p className="text-2xs mt-1" style={{ color: '#f87171' }}>
                  Passwords do not match
                </p>
              )}
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
                  Create Account
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </motion.button>
          </form>

          {/* Or divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
            <span className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>
              or
            </span>
            <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
          </div>

          {/* Google sign up */}
          <motion.button
            type="button"
            whileHover={{ scale: 1.01 }}
            whileTap={{   scale: 0.99 }}
            onClick={() => {
              window.location.href = GOOGLE_LOGIN_URL;
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

          {/* Divider */}
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
            <span className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>
              Already have an account?
            </span>
            <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
          </div>

          <Link to="/login">
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
              Sign in instead
            </motion.div>
          </Link>

          <p
            className="text-center text-xs mt-8"
            style={{ color: 'rgba(255,255,255,0.20)' }}
          >
            By creating an account you agree to our Terms & Privacy Policy
          </p>
        </motion.div>
      </div>
    </div>
  );
}