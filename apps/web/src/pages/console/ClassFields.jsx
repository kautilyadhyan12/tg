import { coachChoices } from './classesView';
import { inputStyle, labelStyle } from './classStyles';

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

/** Length, coach and class size. On a CLASS these are the defaults a new time
 *  slot is filled in from (Kd, RULINGS 2026-09-22), so their labels say
 *  "Default"; on a time slot or one date they are what it runs as. */
export function RunFields({ draft, set, staff, disabled, forClass }) {
  const sizeLabel = forClass ? 'Default class size' : 'Class size';
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={forClass ? 'Default length (minutes)' : 'Length (minutes)'}>
          <input
            value={draft.minutes}
            onChange={(e) => set({ minutes: e.target.value })}
            disabled={disabled}
            inputMode="numeric"
            className="rounded-lg px-3 py-2 text-sm"
            style={inputStyle}
          />
        </Field>
        <Field label={forClass ? 'Default coach (optional)' : 'Coach (optional)'}>
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
      </div>

      {/* Not a `Field`: a <label> around two controls names neither, so the box
          and the tick each carry their own. */}
      <div className="flex flex-col gap-1.5 text-sm">
        <span className="text-xs uppercase tracking-wider" style={labelStyle}>
          {sizeLabel}
        </span>
        <div className="flex items-center gap-3">
          <input
            value={draft.places}
            onChange={(e) => set({ places: e.target.value })}
            aria-label={sizeLabel}
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
    </div>
  );
}
