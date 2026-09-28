import { useState } from 'react';
import { Check } from 'lucide-react';
import { goneWords, gymToday } from './memberListPeople';
import { hasStatusChip, markTally, missingMarkTitle, missingStatusChips, withMarks } from './memberListView';

// The import's question about the people a whole-list file leaves out, one person at a time
// (spec Part 3 §18.8; ROADMAP 5b-v-d; RULINGS 2026-09-26). Each is marked Left or Still a
// member; nothing is marked for staff. Tick people (or a status word, or everyone) and press
// They've left or Still a member, as Gmail and HubSpot act on the rows ticked. Drawn in the
// import box's own colours until 5b-v-d-ii restyles Upload and Review.

const C = {
  card: '#141210',
  card2: '#1a1816',
  line: 'rgba(255,255,255,0.07)',
  muted: 'rgba(255,255,255,0.5)',
  soft: 'rgba(255,255,255,0.8)',
  orange: '#FF8A1F',
  orangeBg: 'rgba(255,138,31,0.12)',
  green: '#34d399',
  greenBg: 'rgba(52,211,153,0.12)',
  red: '#f87171',
  redBg: 'rgba(248,113,113,0.1)',
  plain: 'rgba(255,255,255,0.06)',
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

function Mark({ mark, words }) {
  const [bg, fg, text] =
    mark === 'left' ? [C.redBg, C.red, 'Left'] : mark === 'stay' ? [C.greenBg, C.green, `Still a ${words.person}`] : [C.plain, C.muted, 'Not marked yet'];
  return (
    <span className="text-[12px] font-semibold rounded-full px-2.5 py-1 flex-shrink-0 whitespace-nowrap" style={{ background: bg, color: fg }} data-testid="mark">
      {text}
    </span>
  );
}

function InApp() {
  return (
    <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 flex-shrink-0" style={{ background: C.orangeBg, color: C.orange }}>
      In the app
    </span>
  );
}

export default function MemberListMissing({ missing, marks, onMarks, listSize, words, disabled }) {
  const [picked, setPicked] = useState(() => new Set());
  const [shown, setShown] = useState(ROWS);
  const today = gymToday();
  const people = missing.people;
  const chips = missingStatusChips(people);

  const pick = (ids, on) =>
    setPicked((before) => {
      const next = new Set(before);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  /** A status word (or everyone) ticks all of them; pressed again, unticks them. */
  const pickGroup = (ids) => pick(ids, !ids.every((id) => picked.has(id)));
  const markPicked = (mark) => {
    onMarks(withMarks(marks, [...picked], mark));
    setPicked(new Set());
  };
  const allIds = people.map((p) => p.entryId);

  return (
    <div className="rounded-[18px] p-4 flex flex-col gap-3.5" style={{ background: C.card, border: '1px solid rgba(255,138,31,0.45)' }} data-testid="missing">
      <div>
        <div className="text-[17px] font-bold" style={{ color: '#fff' }}>
          {missingMarkTitle(people.length, listSize, words)}
        </div>
        <div className="text-sm mt-1" style={{ color: C.soft }} data-testid="missing-mark-help">
          Mark each one. Those who have left become past {words.people}.
        </div>
        <div className="text-sm mt-1" style={{ color: C.muted }} data-testid="missing-help">
          Your file should include all current {words.people}, so {words.people} missing from it have usually left. {words.peopleCap ?? 'Members'} added
          manually may not be in your export yet.
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2" data-testid="missing-chips">
        <span className="text-[13px] font-semibold" style={{ color: C.muted }}>
          Select:
        </span>
        <button
          type="button"
          aria-pressed={allIds.length > 0 && allIds.every((id) => picked.has(id))}
          onClick={() => pickGroup(allIds)}
          disabled={disabled}
          className="rounded-full px-3 min-h-[36px] text-[13px] font-semibold"
          style={{ background: C.plain, color: C.soft }}
        >
          All {count(people.length)}
        </button>
        {chips.map((chip) => {
          const ids = people.filter((p) => hasStatusChip(p, chip.label)).map((p) => p.entryId);
          const on = ids.every((id) => picked.has(id));
          return (
            <button
              key={chip.label}
              type="button"
              aria-pressed={on}
              onClick={() => pickGroup(ids)}
              disabled={disabled}
              className="rounded-full px-3 min-h-[36px] text-[13px] font-semibold"
              style={{ background: on ? C.orangeBg : C.plain, color: on ? C.orange : C.soft }}
            >
              {chip.label} {count(chip.n)}
            </button>
          );
        })}
      </div>

      <ul className="rounded-2xl overflow-hidden max-h-[420px] overflow-y-auto" style={{ background: C.card2, border: `1px solid ${C.line}` }} data-testid="missing-rows">
        {people.slice(0, shown).map((p) => {
          const gone = p.onList === null ? null : goneWords(p, today);
          const facts = gone === null ? (p.wasStatus ?? '') : gone.facts;
          return (
            <li key={p.entryId} className="flex items-center gap-1 pr-3 py-1.5" style={{ borderTop: `1px solid ${C.line}` }} data-testid="missing-row">
              <Box checked={picked.has(p.entryId)} label={`Select ${p.fullName || 'No name'}`} onChange={(on) => pick([p.entryId], on)} disabled={disabled} />
              {/* On a phone the tags wrap under the name, so the name is not cut short. */}
              <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-2">
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
              <div className="flex items-center gap-2 mt-1.5 sm:mt-0 flex-shrink-0">
                {p.inApp ? <InApp /> : null}
                <Mark mark={marks.get(p.entryId)} words={words} />
              </div>
              </div>
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

      {picked.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2" style={{ background: C.card2, border: `1px solid ${C.line}` }} data-testid="missing-bar">
          <span className="text-sm font-semibold mr-auto" style={{ color: '#fff' }}>
            {count(picked.size)} selected
          </span>
          <button type="button" onClick={() => markPicked('left')} disabled={disabled} className="rounded-xl px-3 min-h-[40px] text-sm font-bold" style={{ background: C.redBg, color: C.red }}>
            They&apos;ve left
          </button>
          <button type="button" onClick={() => markPicked('stay')} disabled={disabled} className="rounded-xl px-3 min-h-[40px] text-sm font-bold" style={{ background: C.greenBg, color: C.green }}>
            Still a {words.person}
          </button>
          <button type="button" onClick={() => setPicked(new Set())} className="rounded-xl px-3 min-h-[40px] text-sm" style={{ color: C.soft }}>
            Clear
          </button>
        </div>
      ) : null}

      <p className="text-[13px]" style={{ color: C.soft }} data-testid="missing-tally">
        {markTally(people, marks, words)}
      </p>
    </div>
  );
}
