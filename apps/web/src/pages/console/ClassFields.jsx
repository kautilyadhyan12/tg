import DatePick from '../../components/console/DatePick';
import TimePick from '../../components/console/TimePick';
import { coachChoices } from './classesView';
import { WEEKDAYS } from './hoursView';

// The fields the Classes screen's forms share: a class, a time slot, and one
// class on the calendar. Drawn from `console.css` (spec Part 3 §17.6).

/** A tick with its words, 44 px tall so a thumb finds it. */
export function Tick({ checked, onChange, disabled, children }) {
  return (
    <label className="flex items-center gap-2.5 min-h-11 c-s15 c-t1">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="w-[18px] h-[18px] flex-shrink-0"
        style={{ accentColor: 'var(--accent)' }}
      />
      {children}
    </label>
  );
}

export function Field({ label, children }) {
  return (
    <label className="c-field">
      <span className="c-label">{label}</span>
      {children}
    </label>
  );
}

/** A date, picked from a calendar. Not a `Field`: the calendar opens inside
 *  it, and a <label> around a calendar would click its button again. */
export function DateField({ label, value, min, max, today, onChange, disabled, emptyText, onClear }) {
  return (
    <div className="c-field">
      <span className="c-label">{label}</span>
      <DatePick
        label={label}
        value={value}
        min={min}
        max={max}
        today={today}
        onChange={onChange}
        disabled={disabled}
        emptyText={emptyText}
        onClear={onClear}
        newLook
      />
    </div>
  );
}

/** A time slot's days, one button a day. */
export function DaysPick({ weekdays, onToggle, disabled }) {
  const on = Array.isArray(weekdays) ? weekdays : [];
  return (
    <div className="c-field">
      <span className="c-label">Days</span>
      <div className="flex flex-wrap gap-2">
        {WEEKDAYS.map((day) => {
          const picked = on.includes(day.iso);
          return (
            <button
              key={day.iso}
              type="button"
              onClick={() => onToggle(day.iso)}
              disabled={disabled}
              aria-pressed={picked}
              className={picked ? 'c-chip c-chip-on' : 'c-chip'}
            >
              {day.short}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A class's start time, on the gym's clock. */
export function StartTimePick({ value, clockFormat, onChange, disabled }) {
  return (
    <div className="c-field">
      <span className="c-label">Start time</span>
      <TimePick
        label="Start time"
        kind="opens"
        value={value}
        clockFormat={clockFormat}
        onChange={onChange}
        disabled={disabled}
        newLook
      />
    </div>
  );
}

export function LengthField({ draft, set, disabled, label = 'Length (minutes)' }) {
  return (
    <Field label={label}>
      <input
        value={draft.minutes}
        onChange={(e) => set({ minutes: e.target.value })}
        disabled={disabled}
        inputMode="numeric"
        className="c-input"
      />
    </Field>
  );
}

export function CoachField({ draft, set, staff, disabled, label = 'Coach (optional)' }) {
  return (
    <Field label={label}>
      <select
        value={draft.coachUserId}
        onChange={(e) => set({ coachUserId: e.target.value })}
        disabled={disabled}
        className="c-input"
      >
        <option value="">No coach</option>
        {/* Whoever is already set is always an option: a select whose value
            is not among its options renders blank, and the next Save would
            send no coach (`coachChoices`). */}
        {coachChoices(staff, draft).map((person) => (
          <option key={person.userId} value={person.userId}>
            {person.displayName}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Not a `Field`: a <label> around two controls names neither, so the box and
 *  the tick each carry their own. */
export function SizeField({ draft, set, disabled, label = 'Class size' }) {
  return (
    <div className="c-field">
      <span className="c-label">{label}</span>
      <div className="flex items-center gap-4">
        <input
          value={draft.places}
          onChange={(e) => set({ places: e.target.value })}
          aria-label={label}
          // Disabled, not emptied, while "No limit" is ticked, so unticking it
          // brings the number back.
          disabled={disabled || draft.unlimited}
          inputMode="numeric"
          className="c-input"
          style={{ width: 104, opacity: draft.unlimited ? 0.5 : 1 }}
        />
        <Tick checked={draft.unlimited} onChange={(on) => set({ unlimited: on })} disabled={disabled}>
          No limit
        </Tick>
      </div>
    </div>
  );
}

/** Length, coach and class size. On a CLASS these are the defaults a new time
 *  slot is filled in from (Kd, RULINGS 2026-09-22), so their labels say
 *  "Default"; on a time slot or one date they are what it runs as. */
export function RunFields({ draft, set, staff, disabled, forClass }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <LengthField
          draft={draft}
          set={set}
          disabled={disabled}
          label={forClass ? 'Default length (minutes)' : 'Length (minutes)'}
        />
        <CoachField
          draft={draft}
          set={set}
          staff={staff}
          disabled={disabled}
          label={forClass ? 'Default coach (optional)' : 'Coach (optional)'}
        />
      </div>
      <SizeField
        draft={draft}
        set={set}
        disabled={disabled}
        label={forClass ? 'Default class size' : 'Class size'}
      />
    </div>
  );
}
