import { useState } from 'react';
import { Check } from 'lucide-react';
import { goneWords, gymToday } from './memberListPeople';

// The names of the people a whole-list file leaves out, as the import's card has always
// shown them, with a tick beside each (spec Part 3 §18.8; ROADMAP 5b-v-d-i; RULINGS
// 2026-09-28). The card's own two buttons answer: They've left moves the people ticked, or
// everyone when nobody is ticked, as before; They're still members keeps everyone.

const C = {
  card2: '#1a1816',
  line: 'rgba(255,255,255,0.07)',
  muted: 'rgba(255,255,255,0.5)',
  soft: 'rgba(255,255,255,0.8)',
  orange: '#FF8A1F',
  orangeBg: 'rgba(255,138,31,0.12)',
};

/** How many rows show before "Show more". */
const ROWS = 100;

const count = (n) => n.toLocaleString('en');

export default function MemberListMissing({ missing, left, onLeft, disabled }) {
  const [shown, setShown] = useState(ROWS);
  const today = gymToday();
  const people = missing.people;

  const tick = (entryId, on) => {
    const next = new Set(left);
    if (on) next.add(entryId);
    else next.delete(entryId);
    onLeft(next);
  };

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: C.card2, border: `1px solid ${C.line}` }} data-testid="missing-rows">
      <ul className="py-1 max-h-[360px] overflow-y-auto">
        {people.slice(0, shown).map((p) => {
          const gone = p.onList === null ? null : goneWords(p, today);
          const checked = left.has(p.entryId);
          return (
            <li key={p.entryId} className="flex items-center gap-3 px-4 py-2.5" data-testid="missing-row">
              <label className="flex items-center justify-center flex-shrink-0 cursor-pointer -m-2 p-2">
                <input
                  type="checkbox"
                  aria-label={`${p.fullName || 'No name'} has left`}
                  checked={checked}
                  disabled={disabled}
                  onChange={(e) => tick(p.entryId, e.target.checked)}
                  className="sr-only peer"
                />
                <span
                  aria-hidden="true"
                  className="w-[22px] h-[22px] rounded-[7px] flex items-center justify-center peer-focus-visible:ring-2 peer-focus-visible:ring-[#FF8A1F]"
                  style={{ background: checked ? C.orange : 'transparent', border: `2px solid ${checked ? C.orange : 'rgba(255,255,255,0.3)'}` }}
                >
                  {checked ? <Check className="w-3.5 h-3.5" style={{ color: '#000' }} strokeWidth={3.5} /> : null}
                </span>
              </label>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate" style={{ color: '#fff' }}>
                  {p.fullName || 'No name'}
                </div>
                <div className="text-xs truncate" style={{ color: C.muted }}>
                  {p.email ?? p.phone ?? ''}
                </div>
                {gone !== null && gone.facts !== '' ? (
                  <div className="text-xs mt-0.5" style={{ color: C.soft }} data-testid="gone-facts">
                    {gone.facts}
                  </div>
                ) : p.wasStatus ? (
                  <div className="text-xs mt-0.5" style={{ color: C.soft }} data-testid="gone-facts">
                    Status: {p.wasStatus}
                  </div>
                ) : null}
                {gone !== null && gone.added !== null ? (
                  <div className="text-xs font-semibold mt-0.5" style={{ color: C.orange }} data-testid="gone-added">
                    {gone.added}
                  </div>
                ) : null}
              </div>
              {p.inApp ? (
                <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 flex-shrink-0" style={{ background: C.orangeBg, color: C.orange }}>
                  In the app
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {people.length > shown ? (
        <button type="button" onClick={() => setShown((n) => n + ROWS)} className="w-full py-3 text-sm font-semibold" style={{ color: C.orange, borderTop: `1px solid ${C.line}` }}>
          Show more ({count(people.length - shown)})
        </button>
      ) : null}
    </div>
  );
}
