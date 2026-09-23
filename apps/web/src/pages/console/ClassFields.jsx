import { coachChoices } from './classesView';
import { inputStyle, labelStyle } from './classStyles';

// The fields the Classes screen's forms share: the list's three forms and the
// week view's "Change this day". Moved out of `Classes.jsx` unchanged so the
// week view draws the same "no limit" tick rather than a second one.

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

/** HOW LONG, HOW MANY, WHO — the three fields a class, a repeat and one day all
 *  hold.
 *
 *  **ONE COMPONENT BECAUSE THERE IS ONE "no limit" TICK TO GET WRONG.** The
 *  tick's whole subtlety — the box keeps its number while the tick is on, so a
 *  gym that ticks it by mistake finds its 20 still there — would otherwise be
 *  written out once per form.
 *
 *  `forClass` changes only the words. On a CLASS these three are the values a
 *  new repeat is filled in from (Kd, RULINGS 2026-09-22) and the note above them
 *  says so; on a repeat or a day they are what it actually runs as. */
export function RunFields({ draft, set, staff, disabled, forClass }) {
  return (
    <div className="flex flex-col gap-4">
      {forClass ? (
        <p className="text-xs" style={labelStyle}>
          These fill in a new repeat. Each repeat can then have its own.
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="How long (minutes)">
          <input
            value={draft.minutes}
            onChange={(e) => set({ minutes: e.target.value })}
            disabled={disabled}
            inputMode="numeric"
            className="rounded-lg px-3 py-2 text-sm"
            style={inputStyle}
          />
        </Field>
        <Field label={forClass ? 'Usual coach (optional)' : 'Coach (optional)'}>
          <select
            value={draft.coachUserId}
            onChange={(e) => set({ coachUserId: e.target.value })}
            disabled={disabled}
            className="rounded-lg px-3 py-2 text-sm"
            style={inputStyle}
          >
            <option value="">Nobody yet</option>
            {/* WHOEVER IS ALREADY SET IS ALWAYS AN OPTION — `coachChoices`
                carries the argument: a select whose value is not among its
                options renders blank and the next Save sends null, which would
                take a coach off with nobody touching the box. */}
            {coachChoices(staff, draft).map((person) => (
              <option key={person.userId} value={person.userId}>
                {person.displayName}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/* NOT a `Field`, and the reason is a real one rather than layout: a
          `<label>` wrapping TWO controls labels NEITHER of them, so the box
          and the tick both need their own name. A screen reader lands on
          "How many people fit" and then on "No limit"; the render test can
          reach both by those names, which is what a person can do. */}
      <div className="flex flex-col gap-1.5 text-sm">
        <span className="text-xs uppercase tracking-wider" style={labelStyle}>
          How many people fit
        </span>
        <div className="flex items-center gap-3">
          <input
            value={draft.places}
            onChange={(e) => set({ places: e.target.value })}
            aria-label="How many people fit"
            /* THE BOX KEEPS ITS NUMBER WHILE "no limit" IS TICKED, so a gym
               that ticks it by mistake finds its 20 still there. Disabled, not
               emptied. */
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
