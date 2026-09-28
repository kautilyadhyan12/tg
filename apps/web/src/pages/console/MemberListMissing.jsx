import { useState } from 'react';
import { Check } from 'lucide-react';
import { goneWords, gymToday } from './memberListPeople';
import { missingMarkTitle } from './memberListView';

// The people a whole-list file leaves out (spec Part 3 §18.8; ROADMAP 5b-v-d-i). Staff tick
// the ones who have left; everyone not ticked stays on the list (Kd, RULINGS 2026-09-28:
// "keep the selecting thing and seeing not present people"). Nobody leaves unless ticked.
// Drawn as the import's card always was, until 5b-v-d-ii restyles Upload and Review.

const C = {
  card: '#141210',
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

function Box({ checked, label, onChange, disabled }) {
  return (
    <label className="flex items-center justify-center w-11 h-11 flex-shrink-0 cursor-pointer">
      <input type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" />
      <span
        aria-hidden="true"
        className="w-[22px] h-[22px] rounded-[7px] flex items-center justify-center peer-focus-visible:ring-2 peer-focus-visible:ring-[#FF8A1F]"
        style={{ background: checked ? C.orange : 'transparent', border: `2px solid ${checked ? C.orange : 'rgba(255,255,255,0.3)'}` }}
      >
        {checked ? <Check className="w-3.5 h-3.5" style={{ color: '#000' }} strokeWidth={3.5} /> : null}
      </span>
    </label>
  );
}

export default function MemberListMissing({ missing, left, onLeft, listSize, words, disabled }) {
  const [shown, setShown] = useState(ROWS);
  const today = gymToday();
  const people = missing.people;
  const all = people.length > 0 && people.every((p) => left.has(p.entryId));

  const tick = (entryId, on) => {
    const next = new Set(left);
    if (on) next.add(entryId);
    else next.delete(entryId);
    onLeft(next);
  };

  return (
    <div className="rounded-[18px] p-4 flex flex-col gap-3.5" style={{ background: C.card, border: '1px solid rgba(255,138,31,0.45)' }} data-testid="missing">
      <div>
        <div className="text-[17px] font-bold" style={{ color: '#fff' }}>
          {missingMarkTitle(people.length, listSize, words)}
        </div>
        <div className="text-sm mt-1" style={{ color: C.soft }} data-testid="missing-mark-help">
          Tick the ones who have left. The rest stay on your list.
        </div>
        <div className="text-[13px] mt-1" style={{ color: C.muted }} data-testid="missing-help">
          Your file should include all current {words.people}, so {words.people} missing from it have usually left. {words.peopleCap ?? 'Members'} added
          manually may not be in your export yet.
        </div>
      </div>

      <ul className="rounded-2xl overflow-hidden max-h-[420px] overflow-y-auto" style={{ background: C.card2, border: `1px solid ${C.line}` }} data-testid="missing-rows">
        <li className="flex items-center gap-1 pr-3 py-0.5">
          <Box checked={all} label="Select all" onChange={(on) => onLeft(on ? new Set(people.map((p) => p.entryId)) : new Set())} disabled={disabled} />
          <span className="text-sm font-semibold" style={{ color: C.soft }}>
            Select all
          </span>
        </li>
        {people.slice(0, shown).map((p) => {
          const gone = p.onList === null ? null : goneWords(p, today);
          const facts = gone === null ? (p.wasStatus ?? '') : gone.facts;
          return (
            <li key={p.entryId} className="flex items-center gap-1 pr-3 py-1.5" style={{ borderTop: `1px solid ${C.line}` }} data-testid="missing-row">
              <Box checked={left.has(p.entryId)} label={`${p.fullName || 'No name'} has left`} onChange={(on) => tick(p.entryId, on)} disabled={disabled} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate" style={{ color: '#fff' }}>
                  {p.fullName || 'No name'}
                </div>
                <div className="text-xs truncate" style={{ color: C.muted }}>
                  {[p.email ?? p.phone, facts].filter((v) => v !== null && v !== '').join(' · ')}
                </div>
                {gone !== null && gone.added !== null ? (
                  <div className="text-xs font-semibold mt-0.5" style={{ color: C.orange }}>
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
        {people.length > shown ? (
          <li>
            <button type="button" onClick={() => setShown((n) => n + ROWS)} className="w-full py-3 text-sm font-semibold" style={{ color: C.orange, borderTop: `1px solid ${C.line}` }}>
              Show more ({count(people.length - shown)})
            </button>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
