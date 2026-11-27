import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ChevronDown, ChevronUp, Circle } from 'lucide-react';
import { orgWords } from '@app/shared';
import { startHereCount } from '../../pages/console/startHereView';
import { readOnlyNote } from '../../pages/console/billingView';

// GETTING STARTED on Overview (ROADMAP 23b; V5-a, board `Overview`): a strip with how many steps
// are done, the next step and its button, and View all steps, which opens every step under the
// strip, each Done or Not done yet with its buttons (the next step's buttons then stand in its row). Hide this list hides it for the whole
// business, so it sits under the steps with the sentence that says so.

const RING = 2 * Math.PI * 22;

function StepAction({ action, look, readOnly }) {
  const cls = `c-btn c-btn-sm ${look === 'next' ? 'c-btn-soft' : 'c-btn-s'}`;
  if (readOnly && action.changes === true) {
    return (
      <button type="button" disabled data-look={look} className={cls}>
        {action.label}
      </button>
    );
  }
  return (
    <Link to={action.to} data-look={look} className={cls}>
      {action.label}
    </Link>
  );
}

export default function StartHereCard({ view, orgType, readOnly = false, onHide, busy = false, error = null }) {
  const words = orgWords(orgType);
  const [open, setOpen] = useState(false);
  const share = view.total === 0 ? 0 : view.doneCount / view.total;
  const next = view.rows.find((row) => row.next) ?? null;
  return (
    <section className="c-card overflow-hidden" data-testid="start-here" aria-label="Getting started">
      <div className="c-ov-start">
        <span className="c-ov-ring" aria-hidden="true">
          <svg viewBox="0 0 52 52" width="52" height="52">
            <circle className="c-ov-ring-track" cx="26" cy="26" r="22" fill="none" strokeWidth="5" />
            {share > 0 ? (
            <circle
              className="c-ov-ring-fill"
              cx="26"
              cy="26"
              r="22"
              fill="none"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={`${String(RING * share)} ${String(RING)}`}
            />
            ) : null}
          </svg>
          <span className="c-s14 c-w7 c-t1 c-num">
            {view.doneCount}/{view.total}
          </span>
        </span>
        <div className="c-ov-start-text">
          <span className="c-s14 c-t3">
            Getting started · <span data-testid="start-here-count">{startHereCount(view)}</span>
          </span>
          <h2 className="c-s15 c-w6 c-t1">{next === null ? `Your ${words.it} is set up` : `Next: ${next.title}`}</h2>
          <p className="c-s14 c-t2">{next === null ? 'Every step is done. Each button still opens its page.' : next.line}</p>
        </div>
        <div className="c-ov-start-acts">
          {next !== null && !open
            ? next.actions.map((action, index) => (
                <StepAction key={action.to} action={action} look={index === next.actions.length - 1 ? 'next' : 'plain'} readOnly={readOnly} />
              ))
            : null}
          <button type="button" className="c-btn c-btn-s c-btn-sm" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
            {open ? 'Hide the steps' : `View all ${String(view.total)} steps`}
            {open ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
          </button>
        </div>
      </div>
      {readOnly ? (
        <p className="c-s14 c-t2 px-5 pb-3" data-testid="start-here-read-only">
          {readOnlyNote(orgType)}
        </p>
      ) : null}

      {open ? (
        <>
          <p className="c-s14 c-t2 px-5 pb-3">
            {view.allDone
              ? 'Every step is done. Each button still opens its page.'
              : `Do these in any order. Each one is ticked by itself once it's done. Leave out anything your ${words.it} doesn't use.`}
          </p>
          <ol className="c-ov-steps">
            {view.rows.map((row) => (
              <li key={row.step} data-step={row.step} data-done={row.done ? 'true' : 'false'} className="c-ov-step">
                {row.done ? (
                  <CheckCircle2 aria-hidden="true" size={20} className="c-pay-good flex-none mt-0.5" />
                ) : (
                  <Circle aria-hidden="true" size={20} className="c-t3 flex-none mt-0.5" />
                )}
                <div className="c-ov-step-text">
                  <span className="c-s15 c-w6 c-t1">
                    {row.title}
                    <span className={`c-w5 ${row.done ? 'c-pay-good' : 'c-t3'}`}>{row.done ? ' · Done' : ' · Not done yet'}</span>
                  </span>
                  <span className="c-s14 c-t2">{row.line}</span>
                </div>
                <div className="c-ov-step-acts">
                  {row.actions.map((action, index) => (
                    <StepAction
                      key={action.to}
                      action={action}
                      readOnly={readOnly}
                      look={row.done ? 'done' : row.next && index === row.actions.length - 1 ? 'next' : 'plain'}
                    />
                  ))}
                </div>
              </li>
            ))}
          </ol>
          {view.canHide ? (
            <div className="c-ov-line">
              <button type="button" onClick={onHide} disabled={busy || readOnly} className="c-btn c-btn-s c-btn-sm">
                Hide this list
              </button>
              <span className="c-s14 c-t2" style={{ flex: '1 1 220px' }}>
                This hides it for everyone at your {words.it}. You can show it again from the bottom of this page.
              </span>
            </div>
          ) : null}
        </>
      ) : null}
      {error !== null ? (
        <p role="alert" className="c-s14 c-err px-5 pb-4">
          {error}
        </p>
      ) : null}
    </section>
  );
}
