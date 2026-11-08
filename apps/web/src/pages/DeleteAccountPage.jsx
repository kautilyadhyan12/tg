import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Trash2 } from 'lucide-react';
import { DELETE_PAGE_KEPT, DELETE_PAGE_TEXT as T, DELETE_PAGE_WORDS as W, LEGAL_PATHS, SIGN_IN_ROBOT_WORDS } from '@app/shared';
import { deleteAccountService } from '../api/deleteAccountApi';
import { errorCode, errorText } from '../api/orgsApi';
import { ACCENT, INK, LINE, MUTED } from './GymPublicPage';
import { LegalBlock } from './LegalPage';
import { useRobotCheck } from './useRobotCheck';

// THE WEBSITE'S DELETE YOUR ACCOUNT PAGE, `/delete-account` (ROADMAP Stage 5 21b-ii), the web address
// Google Play asks for. Public, in the light look of the Privacy Policy. It shows the steps in the app,
// and deletes the account for somebody without it: the address typed, the 6-digit code emailed to it,
// Delete. The account's own deletion, with its 14 days to undo. The words live in @app/shared.

const BAD = '#B42318';
const GOOD = '#067647';
const inputClass = 'w-full rounded-xl px-3.5 py-3 text-[16px] outline-none focus:ring-2';
const inputStyle = { border: `1px solid ${LINE}`, background: '#fff', color: INK, minHeight: 48 };

function Section({ heading, children }) {
  return (
    <section className="min-w-0 flex flex-col gap-3">
      <h2 className="text-[20px] font-bold leading-snug" style={{ color: INK }}>{heading}</h2>
      {children}
    </section>
  );
}

function Para({ text }) {
  return <p className="text-[15px] leading-7">{text}</p>;
}

function Steps({ items }) {
  return (
    <ol className="list-decimal pl-5 flex flex-col gap-2 text-[15px] leading-7">
      {items.map((stepText) => (
        <li key={stepText}>{stepText}</li>
      ))}
    </ol>
  );
}

function Problem({ text }) {
  if (text === null) return null;
  return (
    <p role="alert" className="text-sm font-medium" style={{ color: BAD }}>
      {text}
    </p>
  );
}

/** The address, the code, Delete. */
function DeleteForm() {
  const [step, setStep] = useState('email'); // 'email' | 'code' | 'done'
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  // What only the address's holder may be told: a gym they own, an account already going.
  const [owner, setOwner] = useState(false);
  const [resent, setResent] = useState(false);
  const [doneText, setDoneText] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // The robot check, only once the server asks for it; when it passes, the press it stopped goes on.
  const [robotKey, setRobotKey] = useState(null);
  const [robotNote, setRobotNote] = useState('');
  const waiting = useRef(null);
  const { boxRef, failed: robotFailed, blocked: robotBlocked, reset: resetRobot } = useRobotCheck(robotKey, {
    action: 'sign_in',
    appearance: 'interaction-only',
    onToken: (token) => {
      const press = waiting.current;
      waiting.current = null;
      if (press !== null) void send(press, token);
    },
  });

  useEffect(() => {
    if (step !== 'code' || resendAt <= now) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [step, resendAt, now]);
  const secondsToResend = Math.max(0, Math.ceil((resendAt - now) / 1000));

  async function send(press, robotToken) {
    if (busy) return;
    const address = email.trim();
    if (address === '' || !address.includes('@')) {
      setProblem('Enter a valid email address.');
      return;
    }
    setBusy(true);
    setProblem(null);
    setResent(false);
    try {
      const sent = await deleteAccountService.sendCode(address, robotToken);
      setRobotKey(null);
      setRobotNote('');
      setResendAt(Date.now() + sent.resendAfterSeconds * 1000);
      setNow(Date.now());
      if (press === 'resend') setResent(true);
      setStep('code');
    } catch (err) {
      const refusal = err?.response?.data;
      if (refusal?.error === 'robot_check' || refusal?.error === 'robot_failed') {
        setRobotKey(refusal.robotCheckKey);
        setRobotNote(refusal.message);
        if (refusal.error === 'robot_check') waiting.current = press;
      } else {
        setProblem(errorText(err, W.failed));
      }
      if (robotToken) resetRobot();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy || code.length !== 6) return;
    setBusy(true);
    setProblem(null);
    setResent(false);
    try {
      const done = await deleteAccountService.deleteAccount(email.trim(), code);
      setDoneText(done.deletedByAnother ? W.doneMaybe : done.emailSent ? W.doneUndo : W.doneNoEmail);
      setStep('done');
    } catch (err) {
      const why = errorCode(err);
      setOwner(why === 'owns_gym');
      setProblem(errorText(err, W.failed));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  const robotLine = robotBlocked ? SIGN_IN_ROBOT_WORDS.robot_blocked : robotFailed ? SIGN_IN_ROBOT_WORDS.robot_failed : robotNote;
  const robot =
    robotKey !== null ? (
      <div className="flex flex-col gap-2" data-testid="robot-check">
        <div ref={boxRef} />
        {robotLine ? (
          <p role="status" className="text-sm" style={{ color: MUTED }}>
            {robotLine}
          </p>
        ) : null}
      </div>
    ) : null;

  if (step === 'done') {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-2xl p-4" style={{ border: `1px solid ${LINE}`, background: '#fff' }}>
        <p className="text-[17px] font-bold" style={{ color: INK }}>{W.doneTitle}</p>
        <p className="text-[15px] leading-7">{doneText}</p>
      </div>
    );
  }

  const button = 'w-full sm:w-auto rounded-full px-6 py-3 text-[15px] font-semibold flex items-center justify-center gap-2 disabled:opacity-60';

  if (step === 'email') {
    return (
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send('email');
        }}
      >
        <label htmlFor="delete-email" className="text-sm font-semibold">
          {W.emailLabel}
        </label>
        <input
          id="delete-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          maxLength={254}
          placeholder={W.emailPlaceholder}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setProblem(null);
          }}
          className={inputClass}
          style={inputStyle}
        />
        <Problem text={problem} />
        {robot}
        <button type="submit" disabled={busy} className={button} style={{ background: ACCENT, color: '#fff', minHeight: 48 }}>
          {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
          {W.sendButton}
        </button>
      </form>
    );
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void remove();
      }}
    >
      <p role="status" className="text-[15px] leading-7">
        {W.sent(email.trim())}
      </p>
      <label htmlFor="delete-code" className="text-sm font-semibold">
        {W.codeLabel}
      </label>
      <input
        id="delete-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={(e) => {
          setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
          setProblem(null);
          setOwner(false);
        }}
        className={`${inputClass} tracking-[0.3em]`}
        style={inputStyle}
      />
      <Problem text={problem} />
      {owner ? (
        <Link to="/login" className="text-[15px] font-semibold underline" style={{ color: ACCENT }}>
          {W.ownerNext}
        </Link>
      ) : null}
      {robot}
      <button type="submit" disabled={busy || code.length !== 6} className={button} style={{ background: BAD, color: '#fff', minHeight: 48 }}>
        {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <Trash2 aria-hidden="true" className="w-4 h-4" />}
        {W.deleteButton}
      </button>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-[15px]">
        <button
          type="button"
          disabled={busy || secondsToResend > 0}
          onClick={() => void send('resend')}
          className="underline disabled:no-underline disabled:opacity-70"
          style={{ color: secondsToResend > 0 ? MUTED : ACCENT }}
        >
          {secondsToResend > 0 ? W.resendIn(secondsToResend) : W.resend}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setStep('email');
            setCode('');
            setProblem(null);
            setOwner(false);
            setResent(false);
          }}
          className="underline"
          style={{ color: ACCENT }}
        >
          {W.otherEmail}
        </button>
      </div>
      {resent ? (
        <p role="status" className="text-sm" style={{ color: GOOD }}>
          {W.resent}
        </p>
      ) : null}
    </form>
  );
}

export default function DeleteAccountPage() {
  useEffect(() => {
    document.title = `${T.title} · KWAZO`;
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="min-h-screen px-4 py-8 sm:py-12" style={{ background: '#F6F5F2', color: INK }}>
      <main className="mx-auto w-full max-w-[720px] min-w-0 flex flex-col gap-8">
        <header className="min-w-0 flex flex-col gap-2">
          <p className="text-sm font-bold tracking-wide" style={{ color: ACCENT }}>
            KWAZO
          </p>
          <h1 className="text-[28px] sm:text-[34px] font-bold leading-tight" style={{ color: INK }}>{T.title}</h1>
          {T.lead.map((para) => (
            <p key={para} className="text-[16px] leading-7 mt-2">
              {para}
            </p>
          ))}
        </header>

        <Section heading={T.inAppHeading}>
          <Para text={T.inAppLead} />
          <Steps items={T.inAppSteps} />
        </Section>

        <Section heading={T.webHeading}>
          {T.webLead.map((para) => (
            <Para key={para} text={para} />
          ))}
          <DeleteForm />
        </Section>

        <Section heading={T.whatHappensHeading}>
          <Para text={T.whatHappensLead} />
          {T.whatHappens.map((part) => (
            <div key={part.heading} className="flex flex-col gap-3">
              <LegalBlock block={{ kind: 'h3', text: part.heading }} />
              {part.paras.map((para) => (
                <Para key={para} text={para} />
              ))}
            </div>
          ))}
          <LegalBlock block={{ kind: 'list', items: T.deletedItems }} />
          <Para text={T.deletedAfter} />
        </Section>

        <Section heading={T.keptHeading}>
          {T.keptLead.map((para) => (
            <Para key={para} text={para} />
          ))}
          <LegalBlock block={{ kind: 'table', head: T.keptHead, rows: Object.values(DELETE_PAGE_KEPT) }} />
          <p className="text-[15px] leading-7">
            {T.keptMoreBefore}
            <Link to={`${LEGAL_PATHS.privacy}#how-long`} className="underline" style={{ color: ACCENT }}>
              {T.keptMore}
            </Link>
            {T.keptMoreAfter}
          </p>
        </Section>

        <Section heading={T.ownerHeading}>
          <Para text={T.ownerLine} />
          <Para text={T.ownerStepsLead} />
          <Steps items={T.ownerSteps} />
          <Para text={T.ownerAfter} />
        </Section>

        <footer className="flex flex-col gap-2 pt-6 text-sm" style={{ borderTop: `1px solid ${LINE}`, color: MUTED }}>
          <Link to={LEGAL_PATHS.privacy} style={{ color: ACCENT }} className="underline">
            Privacy Policy
          </Link>
          <Link to={LEGAL_PATHS.terms} style={{ color: ACCENT }} className="underline">
            Terms of Use
          </Link>
          <Link to="/login" style={{ color: MUTED }} className="underline">
            Back to KWAZO
          </Link>
        </footer>
      </main>
    </div>
  );
}
