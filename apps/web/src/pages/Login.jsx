import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTransition } from '../context/TransitionContext';
import { Dumbbell, ArrowRight, Loader2, Zap, Mail } from 'lucide-react';
import toast from 'react-hot-toast';
import { LEGAL_PATHS, SIGN_IN_CODE_RULES, SIGN_IN_ROBOT_WORDS } from '@app/shared';
import { GYM_DOOR, MEMBER_DOOR, landingRoute, readDoor, rememberDoor, returnForDoor } from './landingRoute';
import { useRobotCheck } from './useRobotCheck';
import { consoleLook } from './console/consoleMenu';

// ONE "GET STARTED" SCREEN (Kd, 2026-09-07). Sign-up and sign-in are the same
// act: type your email, type the 6-digit code we send, you are in — a new
// address gets a new account on the spot. There is no password anywhere on
// this screen, and no separate register page.
//
// Kd's two doors stay (DECISIONS 2026-08-18, relabelled 2026-09-07): the same
// email, the same account; the choice decides only where you land. "Train"
// goes to the member app (the questionnaire first, for a new person); "Manage"
// goes to the console. Drawn in the console's third look (V5-d, board `SignIn`): each door a
// box with what it opens under its name.
const DOORS = [
  { value: MEMBER_DOOR, label: 'Train', line: 'Use the member app' },
  { value: GYM_DOOR, label: 'Manage my gym or studio', line: 'Open the console for your business' },
];

// Google OAuth on the NEW API (v1 §6.1). A full-page navigation to
// /v1/auth/google — it redirects to Google, and the callback sets the same
// httpOnly cookies as the code sign-in (no token in the URL, none in JS).
const GOOGLE_LOGIN_URL = `${import.meta.env.VITE_API_URL}/v1/auth/google`;
// The callback sends failures back to /login?error=… — surfaced below.
const GOOGLE_ERROR_MESSAGES = {
  google_failed: 'Google sign-in failed. Please try again.',
  google_not_configured: 'Google sign-in is currently unavailable.',
  google_busy: 'Google sign-in is busy here just now. Please try again in a minute, or continue with email.',
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
  const location = useLocation();
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

  // THE ROBOT CHECK (ROADMAP Stage 4 item 10). A gym's wi-fi puts a whole gym on one
  // internet address, so past that address's first 20 codes an hour the server asks
  // for Cloudflare's check instead of refusing. The box is drawn only once asked for;
  // when it passes, the press that was asked continues by itself.
  const [robotKey,  setRobotKey]  = useState(null);
  const [robotNote, setRobotNote] = useState('');
  const waiting = useRef(null);
  const { boxRef: robotBox, token: heldToken, failed: robotFailed, blocked: robotBlocked, reset: resetRobot } = useRobotCheck(robotKey, {
    action: 'sign_in',
    // Most people pass without a tap; the box shows only for those who must.
    appearance: 'interaction-only',
    onToken: (token) => {
      const press = waiting.current;
      waiting.current = null;
      if (press === 'email') void continueWithEmail(token);
      else if (press === 'resend') void resendCode(token);
    },
  });

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
  // `press` says which button asked, so a robot check the server asks for can finish it.
  const requestCode = async (press, robotToken) => {
    const address = email.trim();
    if (!address) {
      setProblem('Please type your email address.');
      return null;
    }
    setBusy(true);
    setProblem('');
    try {
      const res = await sendCode(address, robotToken);
      setResendAt(Date.now() + (res?.resendAfterSeconds ?? 0) * 1000);
      setNow(Date.now());
      setArrival('sent');
      setRobotNote('');
      return 'sent';
    } catch (err) {
      const refusal = err?.response?.data;
      if (refusal?.error === 'robot_check' || refusal?.error === 'robot_failed') {
        setRobotKey(refusal.robotCheckKey);
        setRobotNote(refusal.message);
        // Asked for the first time: the press finishes once the box passes. A failed
        // answer waits for the person to press again, so it can never loop.
        if (refusal.error === 'robot_check') waiting.current = press;
        return null;
      }
      if (refusal?.error === 'code_too_soon') {
        setResendAt(Date.now() + (err.response.data.retryAfterSeconds ?? 0) * 1000);
        setNow(Date.now());
        setArrival('too-soon');
        return 'too-soon';
      }
      setProblem(messageFrom(err, 'We could not send the code. Please try again.'));
      return null;
    } finally {
      // An answer is good for one send, whatever came of it.
      if (robotToken) resetRobot();
      setBusy(false);
    }
  };

  // Sent or too soon, the code box is next. "Too soon" here is usually "Use
  // a different email" then the same address inside the gap, with a good
  // code in the inbox; stranding the person on the address step would make
  // them wait the gap out and spend a code on a resend they never needed.
  // The header says which of the two happened.
  async function continueWithEmail(robotToken) {
    if ((await requestCode('email', robotToken)) !== null) {
      setCode('');
      setStep('code');
    }
  }

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    await continueWithEmail(heldToken ?? undefined);
  };

  const handleResend = () => resendCode(heldToken ?? undefined);

  async function resendCode(robotToken) {
    if (secondsToResend > 0 || busy) return;
    // "New code sent." is said only when one WAS. A second tab on the same
    // address can press Resend after its own countdown while the first tab's
    // code is still inside the gap: the server refuses, the countdown takes
    // the server's number, and the person is told only that — not that the
    // code they have is good, because it may already have signed them in.
    const result = await requestCode('resend', robotToken);
    if (result === 'sent') {
      setCode('');
      toast.success('New code sent.');
    } else if (result === 'too-soon') {
      toast(TOO_SOON_WORDS);
    }
  }

  const robotLine = robotBlocked
    ? SIGN_IN_ROBOT_WORDS.robot_blocked
    : robotFailed
      ? SIGN_IN_ROBOT_WORDS.robot_failed
      : robotNote;

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
      // The console page they were opening, when sign-in was asked for on the way (19b-ii).
      const dest = returnForDoor(door) ?? landingRoute(res.user, door);
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

  const gymDoor = door === GYM_DOOR;
  const look = consoleLook(location.search, import.meta.env.DEV);

  return (
    <div className={`c-console t-${look} c-door-page`}>
      {/* ── The door: who you are here as, then your email and its code ─────────── */}
      <div className="c-door-side">
        <div className="c-door-col c-stack-m">
          <div className="c-door-brand">
            <span className="c-gymicon" aria-hidden="true">
              <Dumbbell size={18} />
            </span>
            <span className="c-s16 c-w7 c-t1">KWAZO</span>
          </div>

          <div className="c-stack-xs">
            <h1 className="c-h1">Get started.</h1>
            <p className="c-sub">
              {gymDoor ? 'Sign in to manage your gym or studio' : 'Sign in or create your account — no password needed'}
            </p>
          </div>

          {/* ── The two doors ───────────────────────────────────────────────
              ONE ACCOUNT. The email below is the same either way; this only
              decides where you land. A gym owner is member #1 of their own
              gym (Part 3 §4.0 step 6), so separate accounts would mean
              logging out to use their own app. */}
          <div className="c-stack-xs">
            <span className="c-label" aria-hidden="true">
              I&apos;m here to
            </span>
            <div role="group" aria-label="What are you here for?" className="c-doors">
              {DOORS.map(({ value, label, line }) => {
                const active = door === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => chooseDoor(value)}
                    className={`c-choice c-pick${active ? ' c-choice-on' : ''}`}
                  >
                    <span className={`c-s15 c-w6 ${active ? 'c-ui' : 'c-t1'}`}>{label}</span>
                    <span className="c-s14 c-t2">{line}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {step === 'email' ? (
            /* ── Step 1: the address ─────────────────────────────────────── */
            <form onSubmit={handleEmailSubmit} className="c-stack-s" noValidate>
              <div className="c-field">
                <label htmlFor="get-started-email" className="c-label">
                  Email
                </label>
                <input
                  id="get-started-email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setProblem('');
                  }}
                  placeholder="you@example.com"
                  className="c-input"
                  autoComplete="email"
                  autoFocus
                />
              </div>

              {problem && (
                <p role="alert" className="c-err c-door-p">
                  {problem}
                </p>
              )}

              <button type="submit" disabled={busy} className="c-btn c-btn-lg c-btn-p c-door-wide">
                {busy ? (
                  <Loader2 size={18} className="animate-spin" aria-label="Sending the code" />
                ) : (
                  <>
                    <Mail size={18} aria-hidden="true" />
                    Continue with email
                  </>
                )}
              </button>
              <p className="c-hint c-door-p c-door-center">We&apos;ll email you a 6-digit code. No password needed.</p>
            </form>
          ) : (
            /* ── Step 2: the code ────────────────────────────────────────── */
            <form onSubmit={handleCodeSubmit} className="c-stack-s" noValidate>
              <div className="c-stack-xs">
                <h2 className="c-h2">Check your email</h2>
                <p className="c-sub">
                  {arrival === 'sent' ? (
                    <>
                      We sent a 6-digit code to <strong className="c-t1 c-w6">{email.trim()}</strong>.
                    </>
                  ) : secondsToResend > 0 ? (
                    <>
                      You asked for a code for <strong className="c-t1 c-w6">{email.trim()}</strong> {TOO_SOON.when}{' '}
                      {TOO_SOON.next}
                    </>
                  ) : (
                    /* The countdown has run out, so "less than a minute ago" would
                       now be false; the button's last tick re-renders this line. */
                    <>
                      Type the 6-digit code for <strong className="c-t1 c-w6">{email.trim()}</strong>, or press Resend for a new
                      one.
                    </>
                  )}
                </p>
              </div>
              <div className="c-field">
                <label htmlFor="get-started-code" className="c-label">
                  6-digit code
                </label>
                {/* ONE field drawn as six boxes: the phone's own code suggestion, pasting the
                    whole code and deleting all work as in any field. The boxes only show it. */}
                <div className="c-otp">
                  <input
                    id="get-started-code"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                      setProblem('');
                    }}
                    className="c-otp-input"
                    autoComplete="one-time-code"
                    autoFocus
                  />
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <span
                      key={i}
                      aria-hidden="true"
                      className={`c-otp-cell${i === Math.min(code.length, 5) ? ' c-otp-at' : ''}`}
                    >
                      {code[i] ?? ''}
                    </span>
                  ))}
                </div>
              </div>

              {problem && (
                <p role="alert" className="c-err c-door-p">
                  {problem}
                </p>
              )}

              <button type="submit" disabled={busy} className="c-btn c-btn-lg c-btn-p c-door-wide">
                {busy ? (
                  <Loader2 size={18} className="animate-spin" aria-label="Checking the code" />
                ) : (
                  <>
                    Continue
                    <ArrowRight size={18} aria-hidden="true" />
                  </>
                )}
              </button>

              <div className="c-door-links">
                <button type="button" onClick={handleResend} disabled={secondsToResend > 0 || busy} className="c-btn c-btn-quiet c-door-link">
                  {secondsToResend > 0 ? `Resend code in ${secondsToResend}s` : 'Resend code'}
                </button>
                <button type="button" onClick={changeEmail} className="c-btn c-btn-quiet c-door-link">
                  Use a different email
                </button>
              </div>
            </form>
          )}

          {/* The robot check: only once the server has asked for it. */}
          {robotKey !== null && (
            <div className="c-stack-xs" data-testid="robot-check">
              <div ref={robotBox} />
              {robotLine && (
                <p role="status" className="c-s14 c-t2 c-door-p">
                  {robotLine}
                </p>
              )}
            </div>
          )}

          <div className="c-door-or">
            <span aria-hidden="true" />
            <span className="c-s14 c-t2">or</span>
            <span aria-hidden="true" />
          </div>

          <button
            type="button"
            onClick={() => {
              window.location.href = GOOGLE_LOGIN_URL;
            }}
            className="c-btn c-btn-lg c-btn-s c-door-wide"
          >
            {/* Google G logo */}
            <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
              <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>

          <div className="c-stack-xs c-door-center">
            <p className="c-s14 c-t2 c-door-p">
              By continuing you agree to our{' '}
              <Link to={LEGAL_PATHS.terms} className="c-lk c-door-u">
                Terms
              </Link>
              {' & '}
              <Link to={LEGAL_PATHS.privacy} className="c-lk c-door-u">
                Privacy Policy
              </Link>
            </p>
            <p className="c-s14 c-door-p">
              <Link to={LEGAL_PATHS.washington} className="c-t2 c-door-u">
                Washington Consumer Health Data Privacy Policy
              </Link>
            </p>
          </div>
        </div>
      </div>

      {/* ── The picture, on a computer: its words follow the door ─────────────── */}
      <div className="c-door-pic">
        <img src="/images/exercises/lifting.jpg" alt="Training" />
        <div className="c-door-pic-box c-stack-xs">
          {gymDoor ? (
            <>
              <span className="c-eyebrow">For gyms and studios</span>
              <p className="c-h2">Members, classes, the front desk and money, in one place.</p>
            </>
          ) : (
            <>
              <span className="c-eyebrow c-flow-s" style={{ gap: 6 }}>
                <Zap size={14} aria-hidden="true" />
                AI-Powered Training
              </span>
              <p className="c-h2">
                &quot;Real-time form correction.
                <br />
                Every rep. Every set.&quot;
              </p>
              <p className="c-s14 c-t2 c-door-p">Pose detection · Rep counting · Voice coaching</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
