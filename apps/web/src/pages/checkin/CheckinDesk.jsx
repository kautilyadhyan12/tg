import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, Camera, CheckCircle2, Loader2, LogOut, QrCode, RefreshCw, ScanLine, XCircle } from 'lucide-react';
import { CHECKIN_WORDS } from '@app/shared';
import { checkinService } from '../../api/checkinApi';
import { useAuth } from '../../context/AuthContext';
import { consoleLook } from '../console/consoleMenu';
import DeskCamera from './DeskCamera';
import {
  CAMERA_SAME_CODE_MS,
  DESK_READ_MAX,
  NOT_A_SCAN,
  RESULT_SHOW_MS,
  SAME_PASS_MS,
  claimTrouble,
  deskAnswer,
  deskTrouble,
  isLetIn,
  readDeskNames,
  readyCode,
  signedInLine,
  tokenFromHash,
  tooLongToScan,
  writeDeskNames,
} from './deskView';
import '../../components/console/console.css';

// THE FRONT DESK (spec Part 3 §12.3; ROADMAP 16b-i). A tablet or computer the owner set up
// from Settings → Check-in devices. It is LOCKED: no menu, no links, no list — its key is
// a cookie that opens the scan and nothing else, and this page draws nothing the scan did
// not just answer. One answer at a time, gone after RESULT_SHOW_MS.
//
// `/check-in/setup#<token>` is the one-time link: the token is read, wiped from the
// address bar, spent, and the page moves to `/check-in`, the desk itself.
//
// A browser somebody is signed in to is never a desk, set up or in use: whoever stood at
// it could open the console in the next tab. It says so and offers Sign out.

const TONES = {
  good: { background: 'var(--good-bg)', color: 'var(--good)', Icon: CheckCircle2 },
  plain: { background: 'var(--raise)', color: 'var(--t1)', Icon: RefreshCw },
  bad: { background: 'var(--bad-bg)', color: 'var(--bad)', Icon: XCircle },
  warn: { background: 'var(--warn-bg)', color: 'var(--warn)', Icon: AlertTriangle },
};

function storage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function DeskShell({ children, look }) {
  return <div className={`c-console t-${look} min-h-screen flex flex-col`}>{children}</div>;
}

function SignedIn({ look, user, logout }) {
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    setBusy(true);
    try {
      await logout();
    } finally {
      setBusy(false);
    }
  };
  return (
    <DeskShell look={look}>
      <main className="flex-grow flex items-center justify-center px-4 py-10">
        <div className="c-card w-full max-w-lg p-6 flex flex-col gap-4" role="alert">
          <h1 className="c-h2">Sign out to use this as a check-in desk</h1>
          <p className="c-s15 c-t2">{signedInLine(user)}</p>
          <button type="button" className="c-btn c-btn-p self-start" onClick={() => void signOut()} disabled={busy}>
            <LogOut aria-hidden="true" className="w-5 h-5" />
            Sign out
          </button>
        </div>
      </main>
    </DeskShell>
  );
}

function SetUp({ look, token }) {
  const navigate = useNavigate();
  // A second run of the effect (React's development double run) must not spend the link twice.
  const started = useRef(false);
  // A link with no token in it spends nothing and says so.
  const [problem, setProblem] = useState(() => (token === null ? CHECKIN_WORDS.link_not_valid : null));

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (token === null) return;
    checkinService
      .claimDevice(token)
      .then((names) => {
        writeDeskNames(storage(), names);
        navigate('/check-in', { replace: true });
      })
      .catch((err) => setProblem(claimTrouble(err)));
  }, [token, navigate]);

  return (
    <DeskShell look={look}>
      <main className="flex-grow flex items-center justify-center px-4 py-10">
        <div className="c-card w-full max-w-lg p-6 flex flex-col gap-3" role="status">
          {problem === null ? (
            <p className="c-s15 c-t2 flex items-center gap-2">
              <Loader2 aria-hidden="true" className="w-5 h-5 animate-spin" />
              Setting up this device…
            </p>
          ) : (
            <>
              <h1 className="c-h2">This link can&apos;t be used</h1>
              <p className="c-s15 c-t2">{problem}</p>
            </>
          )}
        </div>
      </main>
    </DeskShell>
  );
}

function Answer({ shown, pending, stopped }) {
  if (pending) {
    return (
      <p className="c-s16 c-t2 flex items-center gap-2">
        <Loader2 aria-hidden="true" className="w-6 h-6 animate-spin" />
        Checking…
      </p>
    );
  }
  if (shown !== null) {
    const tone = TONES[shown.tone] ?? TONES.warn;
    const { Icon } = tone;
    return (
      <div
        data-tone={shown.tone}
        className="w-full max-w-2xl rounded-2xl px-6 py-8 flex flex-col items-center text-center gap-3"
        style={{ background: tone.background }}
      >
        <Icon aria-hidden="true" className="w-16 h-16" style={{ color: tone.color }} />
        <p className="c-h1" style={{ color: tone.color }}>
          {shown.title}
        </p>
        {shown.name ? <p className="c-big c-t1 break-words max-w-full">{shown.name}</p> : null}
        {shown.notice ? (
          <p
            data-notice=""
            className="c-s16 c-w6 rounded-xl px-4 py-2 max-w-full break-words"
            style={{ background: TONES.warn.background, color: TONES.warn.color }}
          >
            {shown.notice}
          </p>
        ) : null}
        {shown.hint ? <p className="c-s16 c-t2">{shown.hint}</p> : null}
        {shown.message ? <p className="c-s16 c-t1 max-w-xl">{shown.message}</p> : null}
      </div>
    );
  }
  if (stopped !== null) {
    return (
      <div className="w-full max-w-2xl rounded-2xl px-6 py-8 flex flex-col items-center text-center gap-3" style={{ background: TONES.bad.background }}>
        <XCircle aria-hidden="true" className="w-16 h-16" style={{ color: TONES.bad.color }} />
        <p className="c-h1" style={{ color: TONES.bad.color }}>
          {stopped.title}
        </p>
        <p className="c-s16 c-t1 max-w-xl">{stopped.message}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center text-center gap-3">
      <QrCode aria-hidden="true" className="w-20 h-20 c-t3" />
      <p className="c-h1">Scan your pass or key tag</p>
      <p className="c-s16 c-t2">Open your pass in the app and hold it under the scanner.</p>
    </div>
  );
}

function Desk({ look }) {
  const [names, setNames] = useState(() => readDeskNames(storage()));
  const [typed, setTyped] = useState('');
  const [shown, setShown] = useState(null);
  const [pending, setPending] = useState(false);
  const [stopped, setStopped] = useState(null);
  const [camera, setCamera] = useState(false);
  const inputRef = useRef(null);
  const seq = useRef(0);
  const clearTimer = useRef(null);
  const lastCameraRead = useRef({ code: '', at: 0 });
  // The codes let in within SAME_PASS_MS, and what was shown for each.
  const letIn = useRef(new Map());
  const inFlight = useRef(null);
  // The code whose answer is on the screen now, or null.
  const onScreen = useRef(null);

  useEffect(() => {
    document.title = 'Check-in';
    return () => {
      if (clearTimer.current !== null) clearTimeout(clearTimer.current);
    };
  }, []);

  const show = useCallback((answer, code = null) => {
    if (clearTimer.current !== null) clearTimeout(clearTimer.current);
    onScreen.current = code;
    setShown(answer);
    clearTimer.current = setTimeout(() => {
      clearTimer.current = null;
      onScreen.current = null;
      setShown(null);
    }, RESULT_SHOW_MS);
  }, []);

  /** An answer the desk already has, shown at once — but never over a scan still on its
   *  way: that is the next person, and their answer is the one they are waiting for. */
  const showNow = useCallback(
    (answer, code = null) => {
      if (inFlight.current !== null) return;
      show(answer, code);
    },
    [show],
  );

  const send = useCallback(
    async (code) => {
      // The same pass again while it is still alive is the person who was just let in (a
      // member holding the phone up, a scanner reading twice): the server has spent it and
      // would say "Show a fresh pass", so their own answer is shown again instead.
      const now = Date.now();
      for (const [kept, entry] of letIn.current) if (now - entry.at >= SAME_PASS_MS) letIn.current.delete(kept);
      const before = letIn.current.get(code);
      if (before !== undefined) {
        // Not over somebody else's answer: the next person keeps their few seconds.
        if (onScreen.current === null || onScreen.current === code) showNow(before.shown, code);
        return;
      }
      if (inFlight.current === code) return;
      const mine = seq.current + 1;
      seq.current = mine;
      inFlight.current = code;
      // The last person's answer goes the moment the next scan arrives.
      if (clearTimer.current !== null) clearTimeout(clearTimer.current);
      clearTimer.current = null;
      setShown(null);
      setPending(true);
      try {
        const answer = await checkinService.scan(code);
        if (seq.current !== mine) return;
        setStopped(null);
        if (isLetIn(answer)) letIn.current.set(code, { at: Date.now(), shown: deskAnswer(answer) });
        if (names === null || names.gymName !== answer.gymName) {
          const next = { gymName: answer.gymName, deviceName: names?.deviceName ?? '' };
          setNames(next);
          writeDeskNames(storage(), next);
        }
        show(deskAnswer(answer), code);
      } catch (err) {
        if (seq.current !== mine) return;
        const trouble = deskTrouble(err);
        if (trouble.stop) {
          letIn.current.clear();
          setStopped(trouble);
          setNames(null);
          writeDeskNames(storage(), null);
        } else {
          show(trouble, code);
        }
      } finally {
        if (seq.current === mine) {
          setPending(false);
          inFlight.current = null;
        }
      }
    },
    [names, show, showNow],
  );

  const onSubmit = (event) => {
    event.preventDefault();
    const read = typed;
    setTyped('');
    if (tooLongToScan(read)) {
      showNow(NOT_A_SCAN);
      return;
    }
    const code = readyCode(read);
    if (code !== null) void send(code);
  };

  const onCameraCode = useCallback(
    (text) => {
      if (typeof text !== 'string') return;
      const now = Date.now();
      const last = lastCameraRead.current;
      if (last.code === text && now - last.at < CAMERA_SAME_CODE_MS) return;
      lastCameraRead.current = { code: text, at: now };
      if (tooLongToScan(text)) {
        showNow(NOT_A_SCAN);
        return;
      }
      const code = readyCode(text);
      if (code !== null) void send(code);
    },
    [send, showNow],
  );

  // The scanner types into this box, so it always holds the focus.
  const keepFocus = () => {
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <DeskShell look={look}>
      <header className="px-4 md:px-12 pt-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {names?.gymName ? <p className="c-eyebrow">{names.deviceName ? `Check-in · ${names.deviceName}` : 'Check-in'}</p> : null}
          <p className="c-h1 c-ell">{names?.gymName || 'Check-in'}</p>
        </div>
        <button type="button" className="c-btn c-btn-s" onClick={() => setCamera((on) => !on)} aria-pressed={camera}>
          <Camera aria-hidden="true" className="w-5 h-5" />
          {camera ? 'Close the camera' : 'Use the camera'}
        </button>
      </header>

      <main className="flex-grow flex flex-col items-center justify-center gap-6 px-4 py-8">
        <div role="status" aria-live="polite" className="w-full flex flex-col items-center">
          <Answer shown={shown} pending={pending} stopped={stopped} />
        </div>
        {camera ? <DeskCamera onCode={onCameraCode} /> : null}
      </main>

      <form onSubmit={onSubmit} className="px-4 md:px-12 pb-8 w-full max-w-2xl mx-auto">
        <label htmlFor="desk-scan" className="c-label flex items-center gap-2">
          <ScanLine aria-hidden="true" className="w-4 h-4" />
          Scanner
        </label>
        <input
          id="desk-scan"
          ref={inputRef}
          className="c-input w-full mt-2"
          value={typed}
          onChange={(event) => setTyped(event.target.value.slice(0, DESK_READ_MAX + 1))}
          onBlur={keepFocus}
          // A USB scanner types like a keyboard; a tablet's own keyboard stays down.
          inputMode="none"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          autoFocus
          placeholder="Scan a pass or key tag"
        />
      </form>
    </DeskShell>
  );
}

export default function CheckinDesk() {
  const location = useLocation();
  const { user, logout } = useAuth();
  const look = consoleLook(location.search, import.meta.env.DEV);
  const setUp = location.pathname === '/check-in/setup';
  // Read once and kept in memory, so a set-up held back by a signed-in browser goes ahead
  // after Sign out without the link being opened again.
  const [token] = useState(() => (setUp && typeof window !== 'undefined' ? tokenFromHash(window.location.hash) : null));

  useEffect(() => {
    // The token leaves the address bar at once, so it is not left on the screen or in the
    // browser's history whatever happens next.
    if (setUp && typeof window !== 'undefined' && window.location.hash !== '') {
      window.history.replaceState(window.history.state, '', window.location.pathname);
    }
  }, [setUp]);

  if (user !== null && user !== undefined) return <SignedIn look={look} user={user} logout={logout} />;
  if (setUp) return <SetUp look={look} token={token} />;
  return <Desk look={look} />;
}
