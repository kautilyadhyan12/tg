import { useState } from 'react';
import { Check } from 'lucide-react';
import { goneWords, gymToday } from './memberListPeople';

// The names of people a whole-list file leaves out, as the import's card has always shown
// them, with a tick beside each (spec Part 3 §18.8; ROADMAP 5b-v-d-i; RULINGS 2026-09-28).
// On the card of the file's own people a tick means "has left" and the card's two buttons
// answer; on the list of people added in this app a tick means "stays", ticked for them
// already (5b-v-d-ii; RULINGS 2026-09-29). `tickLabel(name)` says which. In the console's
// look (§17).

/** How many rows show before "Show more". */
const ROWS = 100;

const count = (n) => n.toLocaleString('en');

export default function MemberListMissing({ people, ticked, onTicked, tickLabel, disabled, testId = 'missing-rows', rowTestId = 'missing-row' }) {
  const [shown, setShown] = useState(ROWS);
  const today = gymToday();

  const tick = (entryId, on) => {
    const next = new Set(ticked);
    if (on) next.add(entryId);
    else next.delete(entryId);
    onTicked(next);
  };

  return (
    <div className="rounded-xl overflow-hidden border" style={{ background: 'var(--raise)', borderColor: 'var(--raise-line)' }} data-testid={testId}>
      <ul className="py-1 max-h-[360px] overflow-y-auto">
        {people.slice(0, shown).map((p) => {
          const gone = p.onList === null ? null : goneWords(p, today);
          const checked = ticked.has(p.entryId);
          return (
            <li key={p.entryId} className={`flex items-center gap-1 pl-1 pr-4 py-1 ${checked ? 'c-picked' : ''}`} data-testid={rowTestId}>
              <label className="c-tickcell cursor-pointer">
                <input
                  type="checkbox"
                  aria-label={tickLabel(p.fullName || 'No name')}
                  checked={checked}
                  disabled={disabled}
                  onChange={(e) => tick(p.entryId, e.target.checked)}
                  className="sr-only peer"
                />
                <span
                  aria-hidden="true"
                  className={`${checked ? 'c-check c-check-on' : 'c-check'} peer-focus-visible:ring-2 peer-focus-visible:ring-[color:var(--accent)] peer-disabled:opacity-50`}
                >
                  {checked ? <Check className="w-3.5 h-3.5" strokeWidth={3} /> : null}
                </span>
              </label>
              <div className="min-w-0 flex-1 py-1.5">
                <div className="c-s14 c-w6 c-t1 c-ell">{p.fullName || 'No name'}</div>
                <div className="c-s13 c-t2 c-ell">{p.email ?? p.phone ?? ''}</div>
                {gone !== null && gone.facts !== '' ? (
                  <div className="c-s13 c-t2 mt-0.5" data-testid="gone-facts">
                    {gone.facts}
                  </div>
                ) : p.wasStatus ? (
                  <div className="c-s13 c-t2 mt-0.5" data-testid="gone-facts">
                    Status: {p.wasStatus}
                  </div>
                ) : null}
                {gone !== null && gone.added !== null ? (
                  <div className="c-s13 c-w6 mt-0.5" style={{ color: 'var(--warn)' }} data-testid="gone-added">
                    {gone.added}
                  </div>
                ) : null}
              </div>
              {p.inApp ? <span className="c-tag c-tag-good flex-shrink-0">In the app</span> : null}
            </li>
          );
        })}
      </ul>
      {people.length > shown ? (
        <button
          type="button"
          onClick={() => setShown((n) => n + ROWS)}
          className="c-btn c-btn-link c-s14 c-w6 w-full py-3 border-t"
          style={{ borderColor: 'var(--raise-line)' }}
        >
          Show more ({count(people.length - shown)})
        </button>
      ) : null}
    </div>
  );
}
