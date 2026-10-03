import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { nextPassDelayMs, passCells, passPath, PASS_QUIET_CELLS } from './checkinPassView';

// THE MEMBER'S PASS (spec Part 3 §12.2; ROADMAP 16c): the code the front desk reads. One
// pass a person, good at every gym they belong to (RULINGS 2026-09-23), new every 30
// seconds and taken once. The member web shows it until the phone app does.
//
// It asks only while it is open and the page is in view. A pass that could not be renewed
// is taken off the screen, never left there to be scanned stale.

const COULD_NOT = "We couldn't get your pass just now. Please try again.";

function PassCode({ pass }) {
  const cells = passCells(pass);
  if (cells === null) {
    return (
      <p className="text-sm" style={{ color: '#ef4444' }}>
        {COULD_NOT}
      </p>
    );
  }
  const side = cells.length + PASS_QUIET_CELLS * 2;
  return (
    // Dark on white whatever the app's colours: that is what a scanner reads.
    <svg
      role="img"
      aria-label="Your check-in pass"
      viewBox={`0 0 ${String(side)} ${String(side)}`}
      shapeRendering="crispEdges"
      className="w-full h-auto rounded-xl"
      style={{ background: '#fff', maxWidth: '18rem' }}
    >
      <rect width={side} height={side} fill="#fff" />
      <path d={passPath(cells)} fill="#000" />
    </svg>
  );
}

export default function CheckinPass({ onClose }) {
  const [state, setState] = useState({ status: 'loading', pass: null, error: null });
  // Bumped by Try again, which starts the asking over.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stopped = false;
    let timer = null;
    let asking = false;

    const ask = () => {
      timer = null;
      if (asking) return;
      asking = true;
      void orgService
        .getCheckinPass()
        .then((res) => {
          asking = false;
          if (stopped) return;
          setState({ status: 'ready', pass: res.data.pass, error: null });
          if (document.visibilityState !== 'hidden') {
            timer = setTimeout(ask, nextPassDelayMs(res.data.refreshAt, Date.now()));
          }
        })
        .catch((err) => {
          asking = false;
          if (stopped) return;
          // The old pass goes with the failure. Nothing asks again by itself: the
          // person presses Try again.
          setState({ status: 'failed', pass: null, error: errorText(err, COULD_NOT) });
        });
    };

    // A page out of view asks nothing; back in view, the pass on screen may be old.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (timer !== null) clearTimeout(timer);
        timer = null;
      } else if (timer === null) {
        ask();
      }
    };

    ask();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [attempt]);

  // Its own effect: the caller's `onClose` may be a new function on every render, and
  // that must not start the asking over.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Your pass"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xs rounded-3xl overflow-hidden p-5"
        style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#FF8A1F' }}>
              Check in
            </p>
            <h3 className="text-base font-bold text-white">Your pass</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.04)' }}
          >
            <X className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.5)' }} />
          </button>
        </div>

        <div className="mt-4 flex flex-col items-center">
          {state.status === 'loading' ? (
            <p className="text-sm flex items-center gap-2 py-10" style={{ color: 'rgba(255,255,255,0.55)' }}>
              <Loader2 className="w-4 h-4 animate-spin" />
              Getting your pass…
            </p>
          ) : null}

          {state.status === 'ready' ? (
            <>
              <PassCode pass={state.pass} />
              <p className="text-sm mt-3 text-center" style={{ color: 'rgba(255,255,255,0.75)' }}>
                Hold this up to the scanner to check in.
              </p>
              <p className="text-xs mt-1 text-center" style={{ color: 'rgba(255,255,255,0.45)' }}>
                It changes every 30 seconds, so a screenshot won&apos;t work.
              </p>
            </>
          ) : null}

          {state.status === 'failed' ? (
            <div className="w-full">
              <p className="text-sm" style={{ color: '#ef4444' }}>
                {state.error}
              </p>
              <button
                type="button"
                onClick={() => {
                  setState({ status: 'loading', pass: null, error: null });
                  setAttempt((n) => n + 1);
                }}
                className="mt-3 rounded-xl px-3.5 py-2 text-sm font-semibold"
                style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' }}
              >
                Try again
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
