import { useRef, useState } from 'react';
import { ADMIN_PASSWORD_MIN } from '@app/shared';
import { useAuth } from '../../context/AuthContext';
import { useRobotCheck } from '../useRobotCheck';
import { adminService } from '../../api/adminApi';
import { errorText } from '../../api/orgsApi';

// THE ADMIN DOOR (Kd, 2026-11-08): its own sign-in at /admin, never a gym's menu. A sign-in
// code typed in the last few minutes, then his own password, opens the page for 12 hours. The
// server decides all of it; these screens only ask.

const box = { padding: 20, display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 420 };

/** A new sign-in code: the email (filled in when signed in already), then the code. */
export function CodeStep({ heading, line, email: known, onSignedIn }) {
  const { sendCode, verifyCode } = useAuth();
  const [email, setEmail] = useState(known ?? '');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [robotKey, setRobotKey] = useState(null);
  const waiting = useRef(false);
  const { boxRef, reset } = useRobotCheck(robotKey, {
    action: 'sign_in',
    appearance: 'interaction-only',
    onToken: (token) => {
      if (waiting.current) {
        waiting.current = false;
        void send(token);
      }
    },
  });

  async function send(robotToken) {
    if (email.trim() === '') {
      setProblem('Please type your email address.');
      return;
    }
    setBusy(true);
    setProblem('');
    try {
      await sendCode(email.trim(), robotToken);
      setSent(true);
    } catch (err) {
      const refusal = err?.response?.data;
      if (refusal?.error === 'robot_check' || refusal?.error === 'robot_failed') {
        setRobotKey(refusal.robotCheckKey);
        setProblem(refusal.message);
        if (refusal.error === 'robot_check') waiting.current = true;
      } else if (refusal?.error === 'code_too_soon') {
        setSent(true);
      } else {
        setProblem(errorText(err, 'We could not send the code. Please try again.'));
      }
    } finally {
      if (robotToken) reset();
      setBusy(false);
    }
  }

  async function verify(e) {
    e.preventDefault();
    setBusy(true);
    setProblem('');
    try {
      await verifyCode(email.trim(), code.trim());
      onSignedIn?.();
    } catch (err) {
      setProblem(errorText(err, 'That code did not work. Please try again.'));
      setBusy(false);
    }
  }

  return (
    <section className="c-card" style={box}>
      <h2 className="c-s16 c-w6" style={{ margin: 0 }}>{heading}</h2>
      <p className="c-s14 c-t2" style={{ margin: 0 }}>{line}</p>
      {!sent ? (
        <form
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            void send(undefined);
          }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="c-s14 c-w6">Email</span>
            <input className="c-input" type="email" autoComplete="email" value={email} readOnly={known !== undefined} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <div ref={boxRef} />
          <button type="submit" className="c-btn c-btn-p" disabled={busy}>
            {busy ? 'Sending…' : 'Send code'}
          </button>
        </form>
      ) : (
        <form style={{ display: 'flex', flexDirection: 'column', gap: 12 }} onSubmit={verify}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="c-s14 c-w6">The code we emailed to {email.trim()}</span>
            <input className="c-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <button type="submit" className="c-btn c-btn-p" disabled={busy || code.trim().length !== 6}>
            {busy ? 'Checking…' : 'Continue'}
          </button>
        </form>
      )}
      {problem ? <p role="alert" className="c-s14 c-tc-warn" style={{ margin: 0 }}>{problem}</p> : null}
    </section>
  );
}

/** The password: made once (typed twice), then typed each time the door is opened. */
export function PasswordStep({ make, onOpened, onStale }) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const short = password.length < ADMIN_PASSWORD_MIN;
  const differs = make && again !== password;

  async function submit(e) {
    e.preventDefault();
    if (short) {
      setProblem(`Your admin password needs at least ${String(ADMIN_PASSWORD_MIN)} characters.`);
      return;
    }
    if (differs) {
      setProblem('The two passwords are not the same.');
      return;
    }
    setBusy(true);
    setProblem('');
    try {
      const state = make ? await adminService.makePassword(password) : await adminService.openDoor(password);
      onOpened(state);
    } catch (err) {
      if (err?.response?.data?.error === 'fresh_code_needed') onStale();
      setProblem(errorText(err, "That didn't work. Please try again."));
      setPassword('');
      setAgain('');
      setBusy(false);
    }
  }

  return (
    <form className="c-card" style={box} onSubmit={submit}>
      <h2 className="c-s16 c-w6" style={{ margin: 0 }}>{make ? 'Make your admin password' : 'Admin password'}</h2>
      <p className="c-s14 c-t2" style={{ margin: 0 }}>
        {make
          ? `At least ${String(ADMIN_PASSWORD_MIN)} characters, used only for this page. Keep it somewhere safe.`
          : 'The page opens for 12 hours.'}
      </p>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="c-s14 c-w6">{make ? 'New password' : 'Password'}</span>
        <input className="c-input" type="password" autoComplete={make ? 'new-password' : 'current-password'} value={password} maxLength={200} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {make ? (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="c-s14 c-w6">Type it again</span>
          <input className="c-input" type="password" autoComplete="new-password" value={again} maxLength={200} onChange={(e) => setAgain(e.target.value)} />
        </label>
      ) : null}
      <button type="submit" className="c-btn c-btn-p" disabled={busy}>
        {busy ? 'Opening…' : make ? 'Make password and open' : 'Open'}
      </button>
      {problem ? <p role="alert" className="c-s14 c-tc-warn" style={{ margin: 0 }}>{problem}</p> : null}
    </form>
  );
}
