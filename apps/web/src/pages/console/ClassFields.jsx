import TimePick from '../../components/console/TimePick';
import { coachChoices } from './classesView';
import { inputStyle, labelStyle } from './classStyles';
import { WEEKDAYS } from './hoursView';

// The fields the Classes screen's forms share: a class, a time slot, and one
// class on the calendar.

export function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-xs uppercase tracking-wider" style={labelStyle}>
        {label}
      </span>
      {children}
    </label>
  );
}

/** A time slot's days, one button a day. */
export function DaysPick({ weekdays, onToggle, disabled }) {
  const on = Array.isArray(weekdays) ? weekdays : [];
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs uppercase tracking-wider" style={labelStyle}>
        Days
      </span>
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
              className="rounded-lg px-3 py-1.5 text-sm"
              style={{
                background: picked ? 'rgba(255,138,31,0.15)' : 'rgba(255,255,255,0.04)',
                color: picked ? '#FF8A1F' : 'rgba(255,255,255,0.65)',
              }}
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
    <div className="flex flex-col gap-1.5">
      <span className="text-xs uppercase tracking-wider" style={labelStyle}>
        Start time
      </span>
      <TimePick
        label="Start time"
        kind="opens"
        value={value}
        clockFormat={clockFormat}
        onChange={onChange}
        disabled={disabled}
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
        className="rounded-lg px-3 py-2 text-sm"
        style={inputStyle}
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
        className="rounded-lg px-3 py-2 text-sm"
        style={inputStyle}
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
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="text-xs uppercase tracking-wider" style={labelStyle}>
        {label}
      </span>
      <div className="flex items-center gap-3">
        <input
          value={draft.places}
          onChange={(e) => set({ places: e.target.value })}
          aria-label={label}
          // Disabled, not emptied, while "No limit" is ticked, so unticking it
          // brings the number back.
          disabled={disabled || draft.unlimited}
          inputMode="numeric"
          className="rounded-lg px-3 py-2 text-sm w-24"
          style={{ ...inputStyle, opacity: draft.unlimited ? 0.5 : 1 }}
        />
        <label className="flex items-center gap-2 text-sm" style={labelStyle}>
          <input
            type="checkbox"
            checked={draft.unlimited}
            onChange={(e) => set({ unlimited: e.target.checked })}
            disabled={disabled}
          />
          No limit
        </label>
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
