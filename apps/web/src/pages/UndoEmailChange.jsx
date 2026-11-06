import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, Dumbbell, Loader2, Undo2 } from 'lucide-react';
import { EMAIL_CHANGE_WORDS as W } from '@app/shared';
import { emailChangeLinkService } from '../api/emailChangeLinkApi';
import { errorCode, errorStatus, errorText } from '../api/orgsApi';
import { undoTokenFromHash } from './undoEmailChangeView';

// THE PAGE "UNDO THIS CHANGE" OPENS, `/undo-email-change#<token>` (item 19's security pass, H1; Kd
// 2026-11-06). The note to an account's old address carries it for 14 days: one press puts the account
// back on that address and signs everybody out of it. Public: no sign-in, the token is the proof. The
// token is after "#", so no server sees it in an address; the page keeps it in memory and takes it out
// of the address bar at once. Opening the page changes nothing, so a mail program that opens links
// cannot undo anything; only the button does.

const LOAD_FAILED = "We couldn't load this page. Try again.";
const UNDO_FAILED = "We couldn't put your account back. Try again.";

export default function UndoEmailChange() {
  const [token] = useState(() => (typeof window === 'undefined' ? null : undoTokenFromHash(window.location.hash)));
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash !== '') window.history.replaceState(window.history.state, '', window.location.pathname);
  }, []);
  // null while loading; then the server's page, or { state: 'not_valid' }.
  const [page, setPage] = useState(token === null ? { state: 'not_valid' } : null);
  const [loadError, setLoadError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  useEffect(() => {
    if (token === null) return undefined;
    let live = true;
    emailChangeLinkService.read(token).then(
      (data) => {
        if (!live) return;
        setLoadError(null);
        setPage(data);
      },
      (err) => {
        if (!live) return;
        if (errorStatus(err) === 404) setPage({ state: 'not_valid' });
        else setLoadError(LOAD_FAILED);
      },
    );
    return () => {
      live = false;
    };
  }, [token, attempt]);

  const putBack = async () => {
    if (busy || page?.state !== 'open') return;
    setBusy(true);
    setProblem(null);
    try {
      const done = await emailChangeLinkService.undo(token);
      setPage(done);
    } catch (err) {
      const code = errorCode(err);
      if (code === 'link_closed') setPage({ state: 'closed', supportEmail: page.supportEmail });
      else if (code === 'link_not_valid') setPage({ state: 'not_valid' });
      else setProblem(errorText(err, UNDO_FAILED));
    } finally {
      setBusy(false);
    }
  };

  const title =
    page?.state === 'done' ? W.doneTitle : page?.state === 'closed' ? W.closedTitle : W.openTitle;

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#0A0908' }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
            style={{ background: 'linear-gradient(135deg, #FF8A1F, #FFB347)', boxShadow: '0 0 30px rgba(255,138,31,0.35)' }}
          >
            <Dumbbell className="w-8 h-8 text-white" aria-hidden="true" />
          </div>
          <h1 className="text-3xl font-bold text-white">{title}</h1>
        </div>

        <div className="card space-y-5">
          {page === null && loadError === null ? (
            <p className="text-gray-300 flex items-center gap-2" role="status">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading…
            </p>
          ) : null}

          {page === null && loadError !== null ? (
            <>
              <p role="alert" className="text-sm" style={{ color: '#f87171' }}>{loadError}</p>
              <button type="button" className="btn-primary w-full" onClick={() => { setLoadError(null); setAttempt((n) => n + 1); }}>
                Try again
              </button>
            </>
          ) : null}

          {page?.state === 'not_valid' ? (
            <p role="alert" className="text-sm" style={{ color: '#f87171' }}>{W.notValid}</p>
          ) : null}

          {page?.state === 'open' ? (
            <>
              <p className="text-gray-300">{W.open(page.oldEmail, page.newEmail)}</p>
              {problem !== null ? (
                <p role="alert" className="text-sm" style={{ color: '#f87171' }}>{problem}</p>
              ) : null}
              <button type="button" onClick={putBack} disabled={busy} className="btn-primary w-full flex items-center justify-center gap-2">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Undo2 className="w-4 h-4" aria-hidden="true" />}
                {busy ? 'Putting it back…' : W.button}
              </button>
              <p className="text-xs text-center" style={{ color: 'rgba(255,255,255,0.45)' }}>{W.nothingYet}</p>
              {page.supportEmail !== null ? (
                <p className="text-xs text-center" style={{ color: 'rgba(255,255,255,0.45)' }}>{W.writeToUs(page.supportEmail)}</p>
              ) : null}
            </>
          ) : null}

          {page?.state === 'done' ? (
            <>
              <p className="text-gray-300 flex items-start gap-2">
                <Check className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: '#4ade80' }} aria-hidden="true" />
                {W.done(page.oldEmail)}
              </p>
              <Link to="/login" className="btn-primary w-full inline-block text-center">
                Sign in
              </Link>
              <p className="text-sm text-center" style={{ color: 'rgba(255,255,255,0.55)' }}>{W.phone}</p>
            </>
          ) : null}

          {page?.state === 'closed' ? (
            <>
              <p className="text-gray-300">{W.closed}</p>
              {page.supportEmail !== null ? <p className="text-gray-300">{W.writeToUs(page.supportEmail)}</p> : null}
            </>
          ) : null}

          {page?.state !== 'done' ? (
            <div className="text-center">
              <Link to="/login" className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm">
                <ArrowLeft size={16} aria-hidden="true" /> Back to Get started
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
