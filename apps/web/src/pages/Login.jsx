import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { useTransition } from '../context/TransitionContext';
import { Dumbbell, ArrowRight, Zap, Mail } from 'lucide-react';
import toast from 'react-hot-toast';
import { SIGN_IN_CODE_RULES } from '@app/shared';
import { GYM_DOOR, MEMBER_DOOR, landingRoute, readDoor, rememberDoor } from './landingRoute';

// ONE "GET STARTED" SCREEN (Kd, 2026-09-07). Sign-up and sign-in are the same
// act: type your email, type the 6-digit code we send, you are in — a new
// address gets a new account on the spot. There is no password anywhere on
// this screen, and no separate register page.
//
// Kd's two doors stay (DECISIONS 2026-08-18, relabelled 2026-09-07): the same
// email, the same account; the choice decides only where you land. "Train"
// goes to the member app (the questionnaire first, for a new person); "Manage"
// goes to the console.
const DOORS = [
  { value: MEMBER_DOOR, label: 'Train' },
  { value: GYM_DOOR,    label: 'Manage my gym, studio or clients' },
];

// Google OAuth on the NEW API (v1 §6.1). A full-page navigation to
// /v1/auth/google — it redirects to Google, and the callback sets the same
// httpOnly cookies as the code sign-in (no token in the URL, none in JS).
const GOOGLE_LOGIN_URL = `${import.meta.env.VITE_API_URL}/v1/auth/google`;
// The callback sends failures back to /login?error=… — surfaced below.
const GOOGLE_ERROR_MESSAGES = {
  google_failed: 'Google sign-in failed. Please try again.',
  google_not_configured: 'Google sign-in is currently unavailable.',
};

/** The server's message is written for people (it says how many tries are
 *  left, or how long to wait); anything else gets one plain fallback. */
const messageFrom = (err, fallback) => err?.response?.data?.message || fallback;

/** The resend gap in words, from the same number the server enforces, so the
 *  sentence can never say "a minute" while the countdown counts something else. */
const gapWords = (seconds) =>
  seconds === 60 ? 'a minute' : seconds % 60 === 0 ? `${seconds / 60} minutes` : `${seconds} seconds`;

/** What a "too soon" refusal is allowed to claim: that a code was asked for
 *  inside the gap. Not that it is still good — it may have signed somebody in
 *  already. The countdown next to Resend says when asking again is allowed.
 *  The header and the Resend toast are both built from these two pieces. */
const TOO_SOON = {
  when: `less than ${gapWords(SIGN_IN_CODE_RULES.resendAfterSeconds)} ago.`,
  next: 'Type it below if you have it, or press Resend when the countdown ends.',
};
const TOO_SOON_WORDS = `You asked for a code ${TOO_SOON.when} ${TOO_SOON.next}`;

export default function Login() {
  const { sendCode, verifyCode } = useAuth();
  const navigate = useNavigate();
  const { triggerTransition } = useTransition();
  const [searchParams, setSearchParams] = useSearchParams();

  // Surface a Google sign-in error passed back by the OAuth callback, once.
  useEffect(() => {
    const error = searchParams.get('error');
    if (!error) return;
    toast.error(GOOGLE_ERROR_MESSAGES[error] ?? 'Sign-in failed. Please try again.');
    setSearchParams({}, { replace: true }); // clear so a refresh won't re-toast
  }, [searchParams, setSearchParams]);

  // Seeded from the stored door so the choice survives coming BACK here — a
  // failed Google attempt lands on /login?error=…, and re-drawing the member
  // door there would silently undo what the person picked a moment ago.
  const [door, setDoor] = useState(() => readDoor() ?? MEMBER_DOOR);
  const chooseDoor = (next) => {
    setDoor(next);
    // Written the moment it is PRESSED, not at submit. "Continue with Google"
    // leaves the site immediately, so a choice recorded only on submit would be
    // lost for exactly the people who never press Continue.
    rememberDoor(next);
  };

  // Two steps: the address, then the code.
  const [step,     setStep]     = useState('email');
  const [email,    setEmail]    = useState('');
  const [code,     setCode]     = useState('');
  const [busy,     setBusy]     = useState(false);
  const [problem,  setProblem]  = useState('');
  // When a resend becomes possible — the SERVER's number, never one made up here.
  const [resendAt, setResendAt] = useState(0);
  const [now,      setNow]      = useState(() => Date.now());
  // How the code step was reached: 'sent' (a code went out) or 'too-soon' (the
  // server refused because one was asked for inside the gap). The header reads
  // from this so it never says "we sent" when nothing was.
  const [arrival,  setArrival]  = useState('sent');

  useEffect(() => {
    if (step !== 'code' || resendAt <= now) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [step, resendAt, now]);

  const secondsToResend = Math.max(0, Math.ceil((resendAt - now) / 1000));

  // Asks the server for a code. Says which of three things happened: the first
  // two both advance to the code box, and the header says which it was:
  //   'sent'     — a new code is on its way
  //   'too-soon' — the server refused because a code was asked for inside
  //                the gap, and the countdown now shows the server's own
  //                number. That is ALL it means: the earlier code may still be
  //                good, or it may already have signed somebody in (a laptop
  //                sign-in, then the phone inside the gap). The server does not
  //                say which — a "used" flag would tell a stranger the address
  //                has an account (RULINGS 2026-09-07) — so the screen must
  //                only ever claim the wait, never that a live code is waiting.
  //   null       — refused for another reason; the words are on screen
  const requestCode = async () => {
    const address = email.trim();
    if (!address) {
      setProblem('Please type your email address.');
      return null;
    }
    setBusy(true);
    setProblem('');
    try {
      const res = await sendCode(address);
      setResendAt(Date.now() + (res?.resendAfterSeconds ?? 0) * 1000);
      setNow(Date.now());
      setArrival('sent');
      return 'sent';
    } catch (err) {
      if (err?.response?.data?.error === 'code_too_soon') {
        setResendAt(Date.now() + (err.response.data.retryAfterSeconds ?? 0) * 1000);
        setNow(Date.now());
        setArrival('too-soon');
        return 'too-soon';
      }
      setProblem(messageFrom(err, 'We could not send the code. Please try again.'));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    // Sent or too soon, the code box is next. "Too soon" here is usually "Use
    // a different email" then the same address inside the gap, with a good
    // code in the inbox; stranding the person on the address step would make
    // them wait the gap out and spend a code on a resend they never needed.
    // The header says which of the two happened.
    if ((await requestCode()) !== null) {
      setCode('');
      setStep('code');
    }
  };

  const handleResend = async () => {
    if (secondsToResend > 0 || busy) return;
    // "New code sent." is said only when one WAS. A second tab on the same
    // address can press Resend after its own countdown while the first tab's
    // code is still inside the gap: the server refuses, the countdown takes
    // the server's number, and the person is told only that — not that the
    // code they have is good, because it may already have signed them in.
    const result = await requestCode();
    if (result === 'sent') {
      setCode('');
      toast.success('New code sent.');
    } else if (result === 'too-soon') {
      toast(TOO_SOON_WORDS);
    }
  };

  const handleCodeSubmit = async (e) => {
    e.preventDefault();
    if (code.length !== 6) {
      setProblem('Type the 6 digits from the email.');
      return;
    }
    setBusy(true);
    setProblem('');
    try {
      const res = await verifyCode(email.trim(), code);
      // A proved code for a NEW address made the account on the spot — say so,
      // because nothing else on the way in does.
      if (res.isNewAccount) toast.success('Welcome! Your account is ready.');
      // The door comes from THIS component's state, not from storage: a browser
      // that refuses sessionStorage must still honour the button just pressed.
      const dest = landingRoute(res.user, door);
      triggerTransition(() => navigate(dest));
    } catch (err) {
      setProblem(messageFrom(err, 'That code did not work. Please try again.'));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const changeEmail = () => {
    setStep('email');
    setCode('');
    setProblem('');
  };

  return (
    <div
      className="min-h-screen flex"
      style={{ background: '#0A0908' }}
    >
      {/* ── Left — the door ──────────────────────────────────────────────── */}
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
              Get started.
            </h1>
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.40)' }}>
              {door === GYM_DOOR
                ? 'Sign in to manage your gym, studio or clients'
                : 'Sign in or create your account — no password needed'}
            </p>
          </div>

          {/* ── The two doors ───────────────────────────────────────────────
              ONE ACCOUNT. The email below is the same either way; this only
              decides where you land. A gym owner is member #1 of their own
              gym (Part 3 §4.0 step 6), so separate accounts would mean
              logging out to use their own app. */}
          <div
            role="group"
            aria-label="What are you here for?"
            className="grid grid-cols-2 gap-2 mb-6"
          >
            {DOORS.map(({ value, label }) => {
              const active = door === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => chooseDoor(value)}
                  className="py-3 px-2 rounded-2xl text-sm font-semibold transition-all duration-200 leading-snug"
                  style={{
                    background: active ? 'rgba(255,138,31,0.14)' : 'rgba(255,255,255,0.04)',
                    border:     active
                      ? '1px solid rgba(255,138,31,0.55)'
                      : '1px solid rgba(255,255,255,0.07)',
                    color:      active ? '#FF8A1F' : 'rgba(255,255,255,0.55)',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {step === 'email' ? (
            /* ── Step 1: the address ─────────────────────────────────────── */
            <form onSubmit={handleEmailSubmit} className="space-y-4" noValidate>
              <div>
                <label
                  htmlFor="get-started-email"
                  className="block text-xs font-medium mb-2 uppercase tracking-wider"
                  style={{ color: 'rgba(255,255,255,0.35)' }}
                >
                  Email
                </label>
                <input
                  id="get-started-email"
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setProblem(''); }}
                  placeholder="you@example.com"
                  className="input-field"
                  autoComplete="email"
                  autoFocus
                />
              </div>

              {problem && (
                <p role="alert" className="text-sm" style={{ color: '#f87171' }}>{problem}</p>
              )}

              <motion.button
                type="submit"
                disabled={busy}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                className="w-full py-3.5 rounded-2xl font-semibold text-sm
                           text-white flex items-center justify-center gap-2
                           transition-all duration-200 mt-2"
                style={{
                  background: busy
                    ? 'rgba(255,138,31,0.4)'
                    : 'linear-gradient(135deg, #FF8A1F, #FFB347)',
                  boxShadow: busy
                    ? 'none'
                    : '0 4px 20px rgba(255,138,31,0.35)',
                }}
              >
                {busy ? (
                  <div
                    className="w-5 h-5 rounded-full border-2 border-white
                               border-t-transparent animate-spin"
                  />
                ) : (
                  <>
                    <Mail className="w-4 h-4" />
                    Continue with email
                  </>
                )}
              </motion.button>
              <p className="text-xs text-center" style={{ color: 'rgba(255,255,255,0.30)' }}>
                We&apos;ll email you a 6-digit code. No password needed.
              </p>
            </form>
          ) : (
            /* ── Step 2: the code ────────────────────────────────────────── */
            <form onSubmit={handleCodeSubmit} className="space-y-4" noValidate>
              <p className="text-sm" style={{ color: 'rgba(255,255,255,0.65)' }}>
                {arrival === 'sent' ? (
                  <>
                    We sent a 6-digit code to{' '}
                    <strong style={{ color: 'rgba(255,255,255,0.95)' }}>{email.trim()}</strong>.
                  </>
                ) : secondsToResend > 0 ? (
                  <>
                    You asked for a code for{' '}
                    <strong style={{ color: 'rgba(255,255,255,0.95)' }}>{email.trim()}</strong>{' '}
                    {TOO_SOON.when} {TOO_SOON.next}
                  </>
                ) : (
                  /* The countdown has run out, so "less than a minute ago" would
                     now be false; the button's last tick re-renders this line. */
                  <>
                    Type the 6-digit code for{' '}
                    <strong style={{ color: 'rgba(255,255,255,0.95)' }}>{email.trim()}</strong>,
                    or press Resend for a new one.
                  </>
                )}
              </p>
              <div>
                <label
                  htmlFor="get-started-code"
                  className="block text-xs font-medium mb-2 uppercase tracking-wider"
                  style={{ color: 'rgba(255,255,255,0.35)' }}
                >
                  6-digit code
                </label>
                <input
                  id="get-started-code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={code}
                  onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setProblem(''); }}
                  placeholder="123456"
                  className="input-field tracking-[0.4em] text-lg"
                  autoComplete="one-time-code"
                  autoFocus
                />
              </div>

              {problem && (
                <p role="alert" className="text-sm" style={{ color: '#f87171' }}>{problem}</p>
              )}

              <motion.button
                type="submit"
                disabled={busy}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                className="w-full py-3.5 rounded-2xl font-semibold text-sm
                           text-white flex items-center justify-center gap-2
                           transition-all duration-200 mt-2"
                style={{
                  background: busy
                    ? 'rgba(255,138,31,0.4)'
                    : 'linear-gradient(135deg, #FF8A1F, #FFB347)',
                  boxShadow: busy
                    ? 'none'
                    : '0 4px 20px rgba(255,138,31,0.35)',
                }}
              >
                {busy ? (
                  <div
                    className="w-5 h-5 rounded-full border-2 border-white
                               border-t-transparent animate-spin"
                  />
                ) : (
                  <>
                    Continue
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </motion.button>

              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={secondsToResend > 0 || busy}
                  className="transition-colors duration-200"
                  style={{ color: secondsToResend > 0 ? 'rgba(255,255,255,0.30)' : 'rgba(255,138,31,0.85)' }}
                >
                  {secondsToResend > 0 ? `Resend code in ${secondsToResend}s` : 'Resend code'}
                </button>
                <button
                  type="button"
                  onClick={changeEmail}
                  className="transition-colors duration-200"
                  style={{ color: 'rgba(255,255,255,0.45)' }}
                >
                  Use a different email
                </button>
              </div>
            </form>
          )}

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

          {/* Footer */}
          <p
            className="text-center text-xs mt-8"
            style={{ color: 'rgba(255,255,255,0.20)' }}
          >
            By continuing you agree to our Terms & Privacy Policy
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
              Pose detection · Rep counting · Voice coaching
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
