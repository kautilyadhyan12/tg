import { useState } from 'react';
import {
  hourChoices,
  joinClock,
  minuteChoices,
  splitClock,
} from '../../pages/console/hoursView';

// `_ _ : _ _` — the console's ONE time control.
//
// **IT LIVED INSIDE `OpeningHoursPanel` UNTIL 17b-i, and it moved here rather
// than being written a second time for the Classes screen.** A gym sets a class
// start time the same way it sets an opening time, and two implementations of
// one control is two places for Kd's ruling below to be half-applied — the
// shape :1239 records and the reason `ConsoleStates` exists at all. Nothing
// about the markup, the aria labels or the state handling changed in the move;
// `openingHours.render.test.jsx` drives it through the same labels it always
// did.

/** The input skin, shared with the boxes around it on both screens. */
const inputStyle = {
  background: '#0A0908',
  border: '1px solid rgba(255,255,255,0.10)',
  color: '#fff',
};

/** The word under a box. Kd, at 17b-ii-b-i's click-through: *"there is no hour"* —
 *  the two boxes showed `18` and `00` and nothing said which was which. Hidden
 *  from screen readers, which already hear each box's own label. */
function Caption({ children, newLook }) {
  if (newLook) {
    return (
      <span aria-hidden="true" className="c-s12 c-t3">
        {children}
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="text-[11px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
      {children}
    </span>
  );
}

/** `_ _ : _ _` — HOUR, MINUTE, and AM/PM when the gym reads on a 12-hour clock.
 *
 *  Kd, 2026-09-01: *"in the time select this is what i meant _ _ : _ _ here when
 *  the gym clicks they can set the time theself by selecting number but you have
 *  give soem already set time"*. **The first version was ONE dropdown of 96
 *  pre-made times and he was right that it is the wrong shape** — a person
 *  setting a clock picks an hour and then a minute, and a 96-item list is a
 *  scroll where three short lists are three glances.
 *
 *  **Every box starts EMPTY and shows `--`.** Nothing is chosen on the gym's
 *  behalf, and `hoursProblem` refuses to save while any part is unfilled — a box
 *  sitting on the first option would be the screen answering a question nobody
 *  asked.
 *
 *  **24:00 lives in the HOUR list on the closing end only**, spelled out as
 *  midnight at the end of the day, and its minute is fixed at `00` because there
 *  is no 24:15.
 *
 *  `newLook` draws the boxes from `console.css` (spec Part 3 §17) on a page
 *  already restyled; Settings keeps the old look until R6. */
export default function TimePick({ label, kind, value, clockFormat, onChange, disabled, newLook = false }) {
  /** **THE THREE BOXES HOLD THEIR OWN HALF-FINISHED STATE, and they have to.**
   *
   *  The draft stores one string per end (`"06:30"`), which cannot express
   *  *"the hour is 6 and the minute is not chosen yet"*. Deriving all three
   *  boxes from that string meant picking the hour produced `''` — nothing is
   *  complete — and the hour box snapped straight back to `--`. **The first
   *  version did exactly that and the control was unusable: neither box would
   *  hold what you picked.** Caught by the render test that drives the two
   *  boxes separately, which is how a person uses them.
   *
   *  So the parts live here and the joined string goes OUT. `hoursProblem` is
   *  still what refuses to save a row that is half-filled — nothing here
   *  invents the missing half. */
  const [parts, setParts] = useState(() => splitClock(value, clockFormat));
  const [lastValue, setLastValue] = useState(value);
  const [lastFormat, setLastFormat] = useState(clockFormat);

  // The prop moved under us — a save came back, the week was copied across, or
  // the gym switched clock. React's own pattern for state derived from a prop,
  // so there is no frame in which the boxes and the row disagree.
  if (value !== lastValue || clockFormat !== lastFormat) {
    setLastValue(value);
    setLastFormat(clockFormat);
    setParts(splitClock(value, clockFormat));
  }

  const hours = hourChoices(kind, clockFormat);
  const minutes = minuteChoices();
  const endOfDay = parts.hour === 24;

  const emit = (next) => {
    const merged = { ...parts, ...next };
    setParts(merged);
    const joined = joinClock(merged, clockFormat);
    // `lastValue` is moved with it so the sync above does not immediately
    // overwrite a half-finished pick with the row's still-empty string.
    setLastValue(joined);
    onChange(joined);
  };

  // The new look sets its widths inline: `c-input` is 100% wide, and which of
  // two one-class rules wins depends on the order the stylesheets load in.
  const box = (width) => (newLook ? 'c-input c-num' : `${width} rounded-lg px-2 py-1.5 text-sm`);
  const skin = (width, dim) =>
    newLook
      ? { width: width === 'w-20' ? 88 : 72, padding: '0 8px', opacity: dim ? 0.5 : 1 }
      : { ...inputStyle, opacity: dim ? 0.5 : 1 };

  return (
    // `flex-nowrap` and `shrink-0`: the three boxes are ONE control and must
    // never break across lines. Kd's screen wrapped them one per line — nine
    // stacked fragments reading `--`, `:`, `--` — because the row had eight
    // shrinkable children and no widths.
    <span className="inline-flex flex-nowrap shrink-0 items-start gap-1">
      <span className="inline-flex flex-col items-center gap-0.5">
        <select
          value={parts.hour === null ? '' : String(parts.hour)}
          onChange={(e) => {
            const hour = e.target.value === '' ? null : Number(e.target.value);
            // The end-of-day entry has no minutes to choose, and picking it must
            // not leave a stale `:45` behind it.
            emit(hour === 24 ? { hour, minute: 0 } : { hour });
          }}
          disabled={disabled}
          aria-label={`${label} hour`}
          className={box('w-16')}
          style={skin('w-16', disabled)}
        >
          <option value="">--</option>
          {hours.map((h) => (
            <option key={h.value} value={h.value}>
              {h.label}
            </option>
          ))}
        </select>
        <Caption newLook={newLook}>Hour</Caption>
      </span>

      {newLook ? (
        <span className="c-s15 c-t3 h-11 flex items-center">:</span>
      ) : (
        <span className="text-sm py-1.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
          :
        </span>
      )}

      <span className="inline-flex flex-col items-center gap-0.5">
        <select
          value={parts.minute === null ? '' : String(parts.minute)}
          onChange={(e) => emit({ minute: e.target.value === '' ? null : Number(e.target.value) })}
          disabled={disabled || endOfDay}
          aria-label={`${label} minute`}
          className={box('w-16')}
          style={skin('w-16', disabled || endOfDay)}
        >
          <option value="">--</option>
          {minutes.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <Caption newLook={newLook}>Minute</Caption>
      </span>

      {/* AM/PM ONLY ON THE 12-HOUR CLOCK — it is meaningless on the other one,
          and the end-of-day entry already says "midnight" in its own label. */}
      {clockFormat === '12h' && !endOfDay ? (
        <select
          value={parts.meridiem ?? ''}
          onChange={(e) => emit({ meridiem: e.target.value === '' ? null : e.target.value })}
          disabled={disabled}
          aria-label={`${label} AM or PM`}
          className={box('w-20')}
          style={skin('w-20', disabled)}
        >
          <option value="">--</option>
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      ) : null}
    </span>
  );
}
