import { Link } from 'react-router-dom';
import { CheckCircle2, Circle } from 'lucide-react';
import { orgWords } from '@app/shared';
import { ConsoleCard } from './ConsoleStates';
import { startHereCount } from '../../pages/console/startHereView';
import { readOnlyNote } from '../../pages/console/billingView';

// Overview's "Start here" list (ROADMAP 23b): what a new gym sets up, each line a button
// to the page where it is done, ticked by the server once the gym has it. In Overview's
// own look until R4 restyles the page.
//
// `view` is `startHereView`'s answer with `show: 'list'`. `readOnly`: a gym with no live
// plan; the pages still open, and what would change something is greyed.

const BUTTON = 'rounded-xl px-4 py-2.5 text-sm font-semibold inline-flex items-center justify-center text-center';
const NEXT_STYLE = { background: 'linear-gradient(135deg,#FF8A1F,#FFB347)', color: '#0A0908' };
const PLAIN_STYLE = { background: 'rgba(255,255,255,0.08)', color: '#fff' };
const DONE_STYLE = { background: 'transparent', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.12)' };

const LOOKS = { next: NEXT_STYLE, plain: PLAIN_STYLE, done: DONE_STYLE };

function StepAction({ action, look, readOnly }) {
  if (readOnly && action.changes === true) {
    return (
      <button type="button" disabled data-look={look} className={`${BUTTON} opacity-50 cursor-not-allowed`} style={LOOKS[look]}>
        {action.label}
      </button>
    );
  }
  return (
    <Link to={action.to} data-look={look} className={BUTTON} style={LOOKS[look]}>
      {action.label}
    </Link>
  );
}

export default function StartHereCard({ view, orgType, readOnly = false, onHide, busy = false, error = null }) {
  const words = orgWords(orgType);
  const share = view.total === 0 ? 0 : view.doneCount / view.total;
  return (
    <ConsoleCard>
      <section data-testid="start-here" aria-label="Start here">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.35)' }}>
              Start here
            </div>
            <h2 className="font-semibold mt-1" style={{ color: '#fff' }}>
              {view.allDone ? `Your ${words.it} is set up` : `Set up your ${words.it}`}
            </h2>
          </div>
          <div className="text-sm flex-shrink-0 mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }} data-testid="start-here-count">
            {startHereCount(view)}
          </div>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden mt-3" style={{ background: 'rgba(255,255,255,0.08)' }} aria-hidden="true">
          <div className="h-full rounded-full" style={{ width: `${String(Math.round(share * 100))}%`, background: '#22c55e' }} />
        </div>
        <p className="text-sm mt-3" style={{ color: 'rgba(255,255,255,0.6)' }}>
          {view.allDone
            ? 'Every step is done. Each button still opens its page.'
            : `Do these in any order. Each one is ticked by itself once it's done. Leave out anything your ${words.it} doesn't use.`}
        </p>
        {readOnly ? (
          <p className="text-xs mt-2" style={{ color: 'rgba(255,255,255,0.45)' }} data-testid="start-here-read-only">
            {readOnlyNote(orgType)}
          </p>
        ) : null}

        <ol className="mt-2 flex flex-col">
          {view.rows.map((row) => (
            <li
              key={row.step}
              data-step={row.step}
              data-done={row.done ? 'true' : 'false'}
              className="py-4 flex flex-col sm:flex-row sm:items-start gap-3"
              style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
            >
              <div className="flex items-start gap-3 flex-1 min-w-0">
                {row.done ? (
                  <CheckCircle2 aria-hidden="true" className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#22c55e' }} />
                ) : (
                  <Circle aria-hidden="true" className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: 'rgba(255,255,255,0.3)' }} />
                )}
                <div className="min-w-0">
                  <div className="font-semibold text-sm" style={{ color: row.done ? 'rgba(255,255,255,0.7)' : '#fff' }}>
                    {row.title}
                    <span className="font-normal" style={{ color: row.done ? '#22c55e' : 'rgba(255,255,255,0.45)' }}>
                      {row.done ? ' · Done' : ' · Not done yet'}
                    </span>
                  </div>
                  <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.6)' }}>
                    {row.line}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pl-8 sm:pl-0 sm:justify-end sm:flex-shrink-0">
                {row.actions.map((action, index) => (
                  <StepAction
                    key={action.to}
                    action={action}
                    readOnly={readOnly}
                    // The step to do next has the orange button, on its last action as
                    // "Bring your members in" always had it.
                    look={row.done ? 'done' : row.next && index === row.actions.length - 1 ? 'next' : 'plain'}
                  />
                ))}
              </div>
            </li>
          ))}
        </ol>

        {view.canHide ? (
          <div className="pt-4 flex flex-col gap-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <button
                type="button"
                onClick={onHide}
                disabled={busy || readOnly}
                className="rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.85)' }}
              >
                Hide this list
              </button>
              <span className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
                This hides it for everyone at your {words.it}. You can show it again from the bottom of this page.
              </span>
            </div>
            {error !== null ? (
              <p role="alert" className="text-sm" style={{ color: '#ef4444' }}>
                {error}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </ConsoleCard>
  );
}
