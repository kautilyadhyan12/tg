import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Loader2, Plus, X } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { ConsoleCard, ConsoleFailed, ConsoleLoading, ConsoleSection } from '../../components/console/ConsoleStates';
import TimePick from '../../components/console/TimePick';
import { useConsoleOrg } from './useConsoleOrg';
import { viewerPrivileges } from './consoleView';
import { consoleIsReadOnly, readOnlyNote } from './billingView';
import { WEEKDAYS, addDays, gymToday } from './hoursView';
import {
  CLASS_COLOUR_CHOICES,
  canManageSchedule,
  classDraft,
  classProblem,
  classRequest,
  classSwatch,
  emptyClassDraft,
  emptyRepeatDraft,
  horizonLine,
  minutesLine,
  nextDatesLine,
  placesLine,
  repeatLine,
  repeatProblem,
  repeatRequest,
  repeatWindowLine,
  sessionsAheadLine,
  timetableLists,
  toggleWeekday,
  weekdayLine,
} from './classesView';

// CLASSES — the gym's own timetable (Part 3 §13.3, ROADMAP 17b-i).
//
// **IT IS A SECTION OF ITS OWN AND NOT A PANEL INSIDE SETTINGS**, on Kd's
// ruling 17 at the Attendance card (:28107) and the distinction he drew there:
// *Settings is where a gym CONFIGURES itself, a section is where it WORKS*. A
// timetable is typed in once and then lived with — an owner opens it the week
// somebody's Tuesday class moves.
//
// **EVERY TIME ON THIS SCREEN IS THE GYM'S OWN CLOCK, AND NOTHING HERE ASKS THE
// BROWSER WHAT TIME IT IS.** The gym types minutes past midnight; the server
// turns each date into an instant against the gym's zone. That is what keeps a
// six o'clock class at six through a summer-time change, and it is why an owner
// reading this screen from another country still sees their gym's six o'clock.
// The zone is printed under the heading so nobody has to guess which clock they
// are reading.
//
// **THE DATES BESIDE A REPEAT ARE THE SERVER'S, READ BACK FROM THE CALENDAR.**
// Nothing here works out "Mondays from today" — that version always looks
// right, including on the day the calendar was not written, and the gym would be
// reading a promise nothing books against (`nextDatesLine` carries the
// argument).
//
// **HIDING IS NOT THE ENFORCEMENT** (R3.3, :11429 rule 4). The nav draws this
// tab only for somebody holding `schedule.manage`, and every route refuses on
// its own; this screen prints the server's sentence if one arrives.
//
// **WHAT THIS HALF DOES NOT DO, said so nobody looks for it**: there is no week
// calendar and no way to change or cancel a single day. Both are 17b-ii. What a
// gym can do here is say what it runs and when it repeats, and see the dates
// that produced.

const inputStyle = {
  background: '#0A0908',
  border: '1px solid rgba(255,255,255,0.10)',
  color: '#fff',
};

const labelStyle = { color: 'rgba(255,255,255,0.45)' };

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-xs uppercase tracking-wider" style={labelStyle}>
        {label}
      </span>
      {children}
    </label>
  );
}

/** THE ONE FORM, for adding a class and for editing one.
 *
 *  Two forms would be two places for the "no limit" tick to be wired up, and
 *  this screen's whole risk is a number on a calendar that nobody typed. The
 *  parent keys it on the class id so React cannot carry a draft from one class
 *  to another — `Settings.jsx`'s round-3 Critical, one screen over, and the
 *  reason that fix is a class rather than a case. */
function ClassForm({ draft, setDraft, staff, disabled, onSave, onCancel, saving, problem, saveLabel }) {
  const set = (patch) => setDraft({ ...draft, ...patch });
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Name">
          <input
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            disabled={disabled}
            maxLength={80}
            placeholder="Sunrise Yoga"
            className="rounded-lg px-3 py-2 text-sm"
            style={inputStyle}
          />
        </Field>
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
      </div>

      <Field label="What to say about it (optional)">
        <textarea
          value={draft.description}
          onChange={(e) => set({ description: e.target.value })}
          disabled={disabled}
          maxLength={500}
          rows={2}
          className="rounded-lg px-3 py-2 text-sm"
          style={inputStyle}
        />
      </Field>

      <div className="grid gap-4 md:grid-cols-2">
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
        <Field label="Usual coach (optional)">
          <select
            value={draft.coachUserId}
            onChange={(e) => set({ coachUserId: e.target.value })}
            disabled={disabled}
            className="rounded-lg px-3 py-2 text-sm"
            style={inputStyle}
          >
            <option value="">Nobody yet</option>
            {staff.map((person) => (
              <option key={person.userId} value={person.userId}>
                {person.displayName}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-wider" style={labelStyle}>
          Colour
        </span>
        <div className="flex flex-wrap gap-2">
          {CLASS_COLOUR_CHOICES.map((choice) => (
            <button
              key={choice.name}
              type="button"
              onClick={() => set({ colour: choice.name })}
              disabled={disabled}
              aria-label={choice.name}
              aria-pressed={draft.colour === choice.name}
              className="w-8 h-8 rounded-full"
              style={{
                background: choice.swatch ?? 'transparent',
                outline: draft.colour === choice.name ? '2px solid #fff' : 'none',
                outlineOffset: '2px',
              }}
            />
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
        <input
          type="checkbox"
          checked={draft.openGym}
          onChange={(e) => set({ openGym: e.target.checked })}
          disabled={disabled}
        />
        This is open gym, not a taught class
      </label>

      {problem === null ? null : (
        <p className="text-sm" style={{ color: '#FBBF24' }}>
          {problem}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={disabled || saving || problem !== null}
          className="rounded-xl px-4 py-2 text-sm font-medium inline-flex items-center gap-2"
          style={{
            background: 'rgba(255,138,31,0.15)',
            color: '#FF8A1F',
            opacity: disabled || saving || problem !== null ? 0.5 : 1,
          }}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {saveLabel}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} className="text-sm" style={labelStyle}>
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** WHEN IT RUNS — the weekday ticks, the gym's clock time, and the window. */
function RepeatForm({ draft, setDraft, clockFormat, today, disabled, saving, onSave, onCancel }) {
  const problem = repeatProblem(draft);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-wider" style={labelStyle}>
          Which days
        </span>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((day) => {
            const on = draft.weekdays.includes(day.iso);
            return (
              <button
                key={day.iso}
                type="button"
                onClick={() => setDraft(toggleWeekday(draft, day.iso))}
                disabled={disabled}
                aria-pressed={on}
                className="rounded-lg px-3 py-1.5 text-sm"
                style={{
                  background: on ? 'rgba(255,138,31,0.15)' : 'rgba(255,255,255,0.04)',
                  color: on ? '#FF8A1F' : 'rgba(255,255,255,0.65)',
                }}
              >
                {day.short}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-wider" style={labelStyle}>
          Starts at
        </span>
        <TimePick
          label="Class start"
          kind="opens"
          value={draft.time}
          clockFormat={clockFormat}
          onChange={(time) => setDraft({ ...draft, time })}
          disabled={disabled}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="First date">
          <input
            type="date"
            value={draft.startsOn}
            min={today}
            max={addDays(today, 365)}
            onChange={(e) => setDraft({ ...draft, startsOn: e.target.value })}
            disabled={disabled}
            className="rounded-lg px-3 py-2 text-sm"
            style={inputStyle}
          />
        </Field>
        <Field label="Last date (leave blank to keep going)">
          <input
            type="date"
            value={draft.endsOn}
            min={draft.startsOn || today}
            max={addDays(today, 730)}
            onChange={(e) => setDraft({ ...draft, endsOn: e.target.value })}
            disabled={disabled}
            className="rounded-lg px-3 py-2 text-sm"
            style={inputStyle}
          />
        </Field>
      </div>

      {problem === null ? null : (
        <p className="text-sm" style={{ color: '#FBBF24' }}>
          {problem}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={disabled || saving || problem !== null}
          className="rounded-xl px-4 py-2 text-sm font-medium inline-flex items-center gap-2"
          style={{
            background: 'rgba(255,138,31,0.15)',
            color: '#FF8A1F',
            opacity: disabled || saving || problem !== null ? 0.5 : 1,
          }}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Save this repeat
        </button>
        <button type="button" onClick={onCancel} className="text-sm" style={labelStyle}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function Classes() {
  const { orgSlug } = useParams();
  const { loading: orgLoading, error: orgError, org, notFound, reload } = useConsoleOrg(orgSlug);
  const gymId = org?.id;

  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(null);
  const [timetable, setTimetable] = useState(null);
  const [staff, setStaff] = useState([]);
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState(emptyClassDraft);
  const [editing, setEditing] = useState(null);
  const [editDraft, setEditDraft] = useState(emptyClassDraft);
  const [repeatFor, setRepeatFor] = useState(null);
  const [repeatDraftState, setRepeatDraftState] = useState(emptyRepeatDraft(''));

  const [reloadKey, setReloadKey] = useState(0);

  /** THE ONE FETCH SITE, and the loading flag is set by the CLICK rather than
   *  inside the effect.
   *
   *  A `load()` that began `setLoading(true)` and was called from an effect body
   *  is a synchronous setState inside an effect — a cascading render, and what
   *  `react-hooks/set-state-in-effect` refuses. `Attendance.jsx` is the shape
   *  this follows: the effect starts the request and every setState happens in
   *  the callback. **Try again** bumps the key, which is what re-runs it. */
  const retry = useCallback(() => {
    setLoading(true);
    setFailed(null);
    setReloadKey((n) => n + 1);
  }, []);

  useEffect(() => {
    if (gymId === undefined) return undefined;
    let live = true;
    void orgService
      .getClasses(gymId)
      .then((res) => {
        if (!live) return;
        setTimetable(res.data);
        setFailed(null);
        setLoading(false);
      })
      .catch((err) => {
        if (!live) return;
        setFailed(errorText(err, "We couldn't load your timetable."));
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [gymId, reloadKey]);

  // THE COACH LIST IS A SEPARATE, OPTIONAL READ, and its failure is not this
  // screen's failure: somebody who may set the timetable does not necessarily
  // hold `staff.manage`, so this 403s for a manager who can otherwise use every
  // control here. An empty list simply means "Nobody yet" is the only choice,
  // which is honest — and a class with no coach is a state the server allows.
  useEffect(() => {
    if (gymId === undefined) return;
    let live = true;
    void orgService
      .getStaff(gymId)
      .then((res) => {
        if (live) setStaff(Array.isArray(res.data?.staff) ? res.data.staff : []);
      })
      .catch(() => {
        if (live) setStaff([]);
      });
    return () => {
      live = false;
    };
  }, [gymId]);

  if (orgLoading) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
        <ConsoleLoading label="Loading your organisation…" />
      </div>
    );
  }
  if (orgError !== null) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
        <ConsoleFailed message={orgError} onRetry={reload} />
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
        <ConsoleCard>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
            We couldn&apos;t find an organisation you run at this address.
          </p>
          <Link to="/console" className="text-sm inline-block mt-3" style={{ color: '#FF8A1F' }}>
            Your organisations
          </Link>
        </ConsoleCard>
      </div>
    );
  }

  const privileges = viewerPrivileges(org);
  const allowed = canManageSchedule(privileges);
  const readOnly = consoleIsReadOnly(org);
  const lists = timetableLists(timetable);
  const today = gymToday(lists.timezone === '' ? org.timezone : lists.timezone);
  const locked = readOnly || !allowed;

  const run = async (key, call) => {
    setBusy(key);
    setActionError(null);
    try {
      const res = await call();
      setTimetable(res.data);
      return true;
    } catch (err) {
      setActionError(errorText(err, "We couldn't save that."));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const saveNew = async () => {
    const body = classRequest(addDraft);
    if (body === null) return;
    if (await run('add', () => orgService.createClass(gymId, body))) {
      setAdding(false);
      setAddDraft(emptyClassDraft());
    }
  };

  const saveEdit = async (typeId) => {
    const body = classRequest(editDraft);
    if (body === null) return;
    if (await run(`edit:${typeId}`, () => orgService.updateClass(gymId, typeId, body))) {
      setEditing(null);
    }
  };

  const saveRepeat = async (typeId) => {
    const body = repeatRequest(repeatDraftState);
    if (body === null) return;
    if (await run(`repeat:${typeId}`, () => orgService.addClassRepeat(gymId, typeId, body))) {
      setRepeatFor(null);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: '#fff' }}>
          Classes
        </h1>
        <p className="text-sm mt-1" style={labelStyle}>
          {org.name}
          {lists.timezone === '' ? '' : ` · times are ${lists.timezone}`}
        </p>
        <p className="text-sm mt-1" style={labelStyle}>
          {horizonLine(lists.horizonDays)}
        </p>
      </div>

      {/* §4.2's read-only console: staff of a lapsed gym SEE everything and
          change nothing, so the sentence sits above the list rather than in
          place of it. */}
      {readOnly && allowed ? (
        <ConsoleCard>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
            {readOnlyNote(org.orgType)}
          </p>
        </ConsoleCard>
      ) : null}

      {!allowed ? (
        <ConsoleCard>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
            Your role doesn&apos;t allow you to set the timetable.
          </p>
        </ConsoleCard>
      ) : null}

      {actionError === null ? null : <ConsoleFailed message={actionError} />}

      {loading ? <ConsoleLoading label="Loading your timetable…" /> : null}
      {!loading && failed !== null ? <ConsoleFailed message={failed} onRetry={retry} /> : null}

      {!loading && failed === null ? (
        <>
          {lists.entries.length === 0 ? (
            <ConsoleCard>
              <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
                You haven&apos;t added any classes yet.
              </p>
              <p className="text-sm mt-1" style={labelStyle}>
                Add one, then say which days and what time it runs — the dates fill in
                straight away.
              </p>
            </ConsoleCard>
          ) : null}

          {lists.entries.map((entry) => {
            const type = entry.type;
            const swatch = classSwatch(type.colour);
            const isEditing = editing === type.id;
            return (
              <ConsoleCard key={type.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex items-start gap-3">
                    {swatch === null ? null : (
                      <span
                        aria-hidden="true"
                        className="w-3 h-3 rounded-full mt-1.5 flex-shrink-0"
                        style={{ background: swatch }}
                      />
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-medium" style={{ color: '#fff' }}>
                        {type.name}
                        {type.openGym ? (
                          <span className="ml-2 text-xs" style={labelStyle}>
                            Open gym
                          </span>
                        ) : null}
                      </div>
                      <div className="text-sm mt-0.5" style={labelStyle}>
                        {minutesLine(type.minutes)} · {placesLine(type.places)}
                        {type.coachName === null ? '' : ` · ${type.coachName}`}
                      </div>
                      {type.description === null || type.description === '' ? null : (
                        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.65)' }}>
                          {type.description}
                        </p>
                      )}
                    </div>
                  </div>
                  {locked ? null : (
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(isEditing ? null : type.id);
                          setEditDraft(classDraft(type));
                        }}
                        className="text-sm"
                        style={{ color: '#FF8A1F' }}
                      >
                        {isEditing ? 'Close' : 'Edit'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void run(`archive:${type.id}`, () => orgService.archiveClass(gymId, type.id))}
                        disabled={busy !== null}
                        aria-label={`Take ${type.name} off the timetable`}
                        className="text-sm inline-flex items-center gap-1"
                        style={{ color: 'rgba(255,255,255,0.45)' }}
                      >
                        {busy === `archive:${type.id}` ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <X className="w-4 h-4" />
                        )}
                        Remove
                      </button>
                    </div>
                  )}
                </div>

                {isEditing ? (
                  <div className="mt-4">
                    <ClassForm
                      /* Keyed on the class, so a draft can never be carried from
                         one class to another — `Settings.jsx`'s round-3
                         Critical, one screen over. */
                      key={type.id}
                      draft={editDraft}
                      setDraft={setEditDraft}
                      staff={staff}
                      disabled={locked}
                      saving={busy === `edit:${type.id}`}
                      problem={classProblem(editDraft)}
                      saveLabel="Save changes"
                      onSave={() => void saveEdit(type.id)}
                      onCancel={() => setEditing(null)}
                    />
                  </div>
                ) : null}

                <div className="mt-4 flex flex-col gap-3">
                  {entry.schedules.length === 0 ? (
                    <p className="text-sm" style={labelStyle}>
                      It isn&apos;t on the calendar yet — say when it repeats.
                    </p>
                  ) : null}
                  {entry.schedules.map((schedule) => (
                    <div
                      key={schedule.id}
                      className="rounded-xl px-3 py-2.5 flex items-start justify-between gap-3"
                      style={{ background: 'rgba(255,255,255,0.03)' }}
                    >
                      <div className="min-w-0">
                        <div className="text-sm" style={{ color: '#fff' }}>
                          {repeatLine(schedule, lists.clockFormat)}
                        </div>
                        <div className="text-xs mt-0.5" style={labelStyle}>
                          {repeatWindowLine(schedule)} · {sessionsAheadLine(schedule)}
                        </div>
                        <div className="text-xs mt-0.5" style={labelStyle}>
                          {nextDatesLine(schedule)}
                        </div>
                      </div>
                      {locked ? null : (
                        <button
                          type="button"
                          onClick={() =>
                            void run(`stop:${schedule.id}`, () =>
                              orgService.stopClassRepeat(gymId, schedule.id),
                            )
                          }
                          disabled={busy !== null}
                          aria-label={`Stop the ${weekdayLine(schedule.weekdays)} repeat of ${type.name}`}
                          className="text-sm flex-shrink-0"
                          style={{ color: 'rgba(255,255,255,0.45)' }}
                        >
                          {busy === `stop:${schedule.id}` ? 'Stopping…' : 'Stop'}
                        </button>
                      )}
                    </div>
                  ))}

                  {locked ? null : repeatFor === type.id ? (
                    <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
                      <RepeatForm
                        key={type.id}
                        draft={repeatDraftState}
                        setDraft={setRepeatDraftState}
                        clockFormat={lists.clockFormat}
                        today={today}
                        disabled={locked}
                        saving={busy === `repeat:${type.id}`}
                        onSave={() => void saveRepeat(type.id)}
                        onCancel={() => setRepeatFor(null)}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setRepeatFor(type.id);
                        setRepeatDraftState(emptyRepeatDraft(today));
                      }}
                      className="self-start text-sm inline-flex items-center gap-1"
                      style={{ color: '#FF8A1F' }}
                    >
                      <Plus className="w-4 h-4" />
                      Add a repeat
                    </button>
                  )}
                </div>
              </ConsoleCard>
            );
          })}

          {locked ? null : adding ? (
            <ConsoleCard>
              <div className="text-xs uppercase tracking-wider mb-4" style={labelStyle}>
                A new class
              </div>
              <ClassForm
                draft={addDraft}
                setDraft={setAddDraft}
                staff={staff}
                disabled={locked}
                saving={busy === 'add'}
                problem={classProblem(addDraft)}
                saveLabel="Add this class"
                onSave={() => void saveNew()}
                onCancel={() => setAdding(false)}
              />
            </ConsoleCard>
          ) : (
            <button
              type="button"
              onClick={() => {
                setAdding(true);
                setAddDraft(emptyClassDraft());
              }}
              className="self-start rounded-xl px-4 py-2 text-sm font-medium inline-flex items-center gap-2"
              style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' }}
            >
              <Plus className="w-4 h-4" />
              Add a class
            </button>
          )}

          {lists.archived.length === 0 ? null : (
            <ConsoleSection
              title="No longer running"
              summary="Classes you have taken off the timetable. Their past dates are kept."
              aside={`${String(lists.archived.length)} kept`}
            >
              <div className="flex flex-col gap-2">
                {lists.archived.map((type) => (
                  <div key={type.id} className="text-sm" style={labelStyle}>
                    {type.name} · {minutesLine(type.minutes)} · {placesLine(type.places)}
                  </div>
                ))}
              </div>
            </ConsoleSection>
          )}
        </>
      ) : null}
    </div>
  );
}
