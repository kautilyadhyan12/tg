import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Loader2, Plus, RotateCcw, X } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import {
  ConfirmInline,
  ConsoleCard,
  ConsoleFailed,
  ConsoleLoading,
  ConsoleSection,
} from '../../components/console/ConsoleStates';
import TimePick from '../../components/console/TimePick';
import { Field, RunFields } from './ClassFields';
import { inputStyle, labelStyle } from './classStyles';
import ClassWeek from './ClassWeek';
import { useConsoleOrg } from './useConsoleOrg';
import { viewerPrivileges } from './consoleView';
import { consoleIsReadOnly, readOnlyNote } from './billingView';
import { WEEKDAYS, addDays, gymToday } from './hoursView';
import {
  archivedPageNote,
  CLASS_COLOUR_CHOICES,
  canManageSchedule,
  classDefaultsLine,
  classDraft,
  classProblem,
  classRequest,
  classSwatch,
  emptyClassDraft,
  nextDatesLine,
  repeatDraft,
  repeatEditDraft,
  repeatEditRequest,
  repeatFactsLine,
  repeatLine,
  repeatProblem,
  repeatRequest,
  runFieldsProblem,
  runLine,
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
// **A REPEAT IS THE LIVE ANSWER AND A CLASS IS THE DEFAULT IT STARTS FROM**
// (Kd, RULINGS 2026-09-22, on the industry standard; 17b-ii-a). Each repeat
// carries its own length, places and coach, shown beside it — TeamUp's own
// shape, where "the class size limit and the current instructor are displayed
// beside each time slot". The class's three numbers fill a NEW repeat in and
// are labelled as that, because since the ruling they are not what the class
// runs as.
//
// **THE WEEK TAB (17b-ii-b-i)** is `ClassWeek.jsx`: the calendar a week at a
// time, where one day is changed or cancelled on its own. Moving a repeat to
// another day or time from a date is still to come (17b-ii-b-ii) — it ends the
// old repeat and begins a new one, so the dates already written keep the time
// they were written at.
//
// **NOTHING ON THIS SCREEN DESTROYS DATES WITHOUT ASKING** (Kd, 2026-09-22).
// Remove and Stop both clear every date a class or a repeat had ahead of it, and
// no tap puts them back — so each one asks first, IN PLACE (`ConfirmInline`),
// never over the whole page. Everything else here is one tap, because everything
// else is one tap to undo.
//
// **AND NOTHING LEAVES FOR GOOD.** A removed class keeps its name, its numbers
// and its past dates under "No longer running", with a **Bring back** button —
// Kd's ruling the same day, taking Mindbody's behaviour over TeamUp's, which
// cannot reinstate an archived Class Type at all.

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

      <RunFields draft={draft} set={set} staff={staff} disabled={disabled} forClass />

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

/** WHEN IT RUNS — the weekday ticks, the gym's clock time, the window, AND ITS
 *  OWN LENGTH, PLACES AND COACH, already filled in from the class (Kd, RULINGS
 *  2026-09-22: the repeat is the live answer, the class is the default it starts
 *  from). A gym that changes nothing here gets exactly what it got before. */
function RepeatForm({ draft, setDraft, staff, clockFormat, today, disabled, saving, onSave, onCancel }) {
  const problem = repeatProblem(draft);
  const set = (patch) => setDraft({ ...draft, ...patch });
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

      <RunFields draft={draft} set={set} staff={staff} disabled={disabled} forClass={false} />

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

/** CHANGING A REPEAT — its length, its places, its coach, and NOT when it runs.
 *
 *  **The days and the time are deliberately absent** and the form says so rather
 *  than leaving a gym hunting for them: moving a repeat is §13.3's "this day and
 *  later", which ends the old repeat and begins a new one so that the dates
 *  already on the calendar keep the time they were written at. That is
 *  17b-ii-b's, with the week view it needs.
 *
 *  What this DOES change reaches every coming date of this repeat, and the
 *  sentence under the buttons says so before the gym presses Save — a re-stamp
 *  the gym did not expect is the same surprise as a lost date. */
function RepeatEditForm({ draft, setDraft, staff, disabled, saving, onSave, onCancel }) {
  const problem = runFieldsProblem(draft);
  const set = (patch) => setDraft({ ...draft, ...patch });
  return (
    <div className="flex flex-col gap-4">
      <RunFields draft={draft} set={set} staff={staff} disabled={disabled} forClass={false} />

      <p className="text-xs" style={labelStyle}>
        This changes every date this repeat still has coming up, except a day you
        changed on its own in the week view. The days it has already run keep what
        they ran as. To move the day or the time, stop this repeat and add a new one.
      </p>

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
  // WHICH ROW IS ASKING A QUESTION RIGHT NOW — an id, never a boolean: two rows
  // sharing one flag would open both questions at once, and a person answering
  // the wrong one is the defect the question exists to prevent.
  const [confirming, setConfirming] = useState(null);
  const [repeatFor, setRepeatFor] = useState(null);
  const [repeatDraftState, setRepeatDraftState] = useState(() => repeatDraft(null, ''));
  // WHICH REPEAT IS OPEN FOR EDITING — an id, never a boolean, for `confirming`'s
  // reason one state over: two rows sharing one flag would open both forms and a
  // gym would type its Thursday numbers into its Monday.
  const [editingRepeat, setEditingRepeat] = useState(null);
  const [repeatEditState, setRepeatEditState] = useState(() => repeatEditDraft(null));

  const [reloadKey, setReloadKey] = useState(0);
  // Which tab, in the address so a reload or a shared link keeps it.
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('view') === 'week' ? 'week' : 'list';

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
    // `view` is here so the list is read again every time it is shown — by the
    // tab or by the browser's Back — since a day changed in the week moves its
    // repeat's coming dates (round one, H-3).
  }, [gymId, reloadKey, view]);

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

  const saveRepeatEdit = async (scheduleId) => {
    const body = repeatEditRequest(repeatEditState);
    if (body === null) return;
    if (
      await run(`repeatEdit:${scheduleId}`, () =>
        orgService.updateClassRepeat(gymId, scheduleId, body),
      )
    ) {
      setEditingRepeat(null);
    }
  };

  const showView = (next) => {
    if (next === view) return;
    setSearchParams(next === 'week' ? { view: 'week' } : {});
  };
  const weekShown = view === 'week' && allowed;

  return (
    <div
      className={`${weekShown ? 'max-w-6xl' : 'max-w-3xl'} mx-auto px-4 md:px-8 py-8 flex flex-col gap-4`}
    >
      <div>
        <h1 className="text-2xl font-bold" style={{ color: '#fff' }}>
          Classes
        </h1>
        <p className="text-sm mt-1" style={labelStyle}>
          {org.name}
          {lists.timezone === '' ? '' : ` · times are ${lists.timezone}`}
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

      {allowed ? (
        <div className="flex gap-2" role="tablist" aria-label="How to show your classes">
          {[
            ['list', 'Classes'],
            ['week', 'Week'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              onClick={() => showView(key)}
              className="rounded-lg px-4 py-2 text-sm font-medium"
              style={{
                background: view === key ? 'rgba(255,138,31,0.15)' : 'rgba(255,255,255,0.04)',
                color: view === key ? '#FF8A1F' : 'rgba(255,255,255,0.65)',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {weekShown ? <ClassWeek gymId={gymId} staff={staff} locked={locked} /> : null}

      {!weekShown && actionError !== null ? <ConsoleFailed message={actionError} /> : null}

      {!weekShown && loading ? <ConsoleLoading label="Loading your timetable…" /> : null}
      {!weekShown && !loading && failed !== null ? (
        <ConsoleFailed message={failed} onRetry={retry} />
      ) : null}

      {!weekShown && !loading && failed === null ? (
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
                      {/* WHAT THESE THREE NUMBERS ARE FOR, said on the card
                          that shows them. Since Kd's ruling of 2026-09-22 the
                          REPEAT is the live answer, so "60 min · 20 places ·
                          Dana" under a class name is not what that class runs
                          as — it is what the next repeat is filled in from, and
                          a gym whose Monday runs 45 minutes would read it and
                          believe otherwise. */}
                      <div className="text-sm mt-0.5" style={labelStyle}>
                        {classDefaultsLine(type)}
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
                      {/* IT ASKS FIRST (Kd, 2026-09-22). Removing a class stops
                          its repeats and clears every date it had ahead of it,
                          and tapping again cannot put those dates back — so the
                          tap that does it is not the tap that asks for it. */}
                      <button
                        type="button"
                        onClick={() => setConfirming(`archive:${type.id}`)}
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

                {confirming === `archive:${type.id}` ? (
                  <div className="mt-3">
                    <ConfirmInline
                      question={`Take ${type.name} off the timetable? Its repeats stop and the dates it had coming up are cleared, except days you cancelled, which stay cancelled. The days it already ran are kept, and you can bring it back from "No longer running" below.`}
                      confirmLabel="Remove it"
                      cancelLabel="Keep it"
                      busy={busy !== null}
                      onCancel={() => setConfirming(null)}
                      onConfirm={() => {
                        setConfirming(null);
                        void run(`archive:${type.id}`, () => orgService.archiveClass(gymId, type.id));
                      }}
                    />
                  </div>
                ) : null}

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
                      className="rounded-xl px-3 py-2.5 flex flex-col gap-2"
                      style={{ background: 'rgba(255,255,255,0.03)' }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm" style={{ color: '#fff' }}>
                            {repeatLine(schedule, lists.clockFormat)}
                          </div>
                          {/* THE REPEAT'S OWN THREE, BESIDE THE REPEAT — which
                              is the shape the products in this market use:
                              TeamUp's help centre, read 2026-09-22, says "the
                              class size limit and the current instructor are
                              displayed beside each time slot". */}
                          <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.65)' }}>
                            {runLine(schedule)}
                          </div>
                          <div className="text-xs mt-0.5" style={labelStyle}>
                            {repeatFactsLine(schedule)}
                          </div>
                          <div className="text-xs mt-0.5" style={labelStyle}>
                            {nextDatesLine(schedule)}
                          </div>
                        </div>
                        {locked ? null : (
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                const open = editingRepeat === schedule.id;
                                setEditingRepeat(open ? null : schedule.id);
                                setRepeatEditState(repeatEditDraft(schedule));
                              }}
                              aria-label={`Change the ${weekdayLine(schedule.weekdays)} repeat of ${type.name}`}
                              className="text-sm"
                              style={{ color: '#FF8A1F' }}
                            >
                              {editingRepeat === schedule.id ? 'Close' : 'Edit'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirming(`stop:${schedule.id}`)}
                              disabled={busy !== null}
                              aria-label={`Stop the ${weekdayLine(schedule.weekdays)} repeat of ${type.name}`}
                              className="text-sm"
                              style={{ color: 'rgba(255,255,255,0.45)' }}
                            >
                              {busy === `stop:${schedule.id}` ? 'Stopping…' : 'Stop'}
                            </button>
                          </div>
                        )}
                      </div>

                      {editingRepeat === schedule.id ? (
                        <RepeatEditForm
                          /* Keyed on the repeat, so a draft can never be carried
                             from one repeat to another — `Settings.jsx`'s
                             round-3 Critical, and the same fix one screen up. */
                          key={schedule.id}
                          draft={repeatEditState}
                          setDraft={setRepeatEditState}
                          staff={staff}
                          disabled={locked}
                          saving={busy === `repeatEdit:${schedule.id}`}
                          onSave={() => void saveRepeatEdit(schedule.id)}
                          onCancel={() => setEditingRepeat(null)}
                        />
                      ) : null}
                      {/* STOP ASKS TOO, and that is the CLASS of the change
                          rather than the one button Kd named: stopping a repeat
                          clears every date it had ahead of it, exactly as
                          removing the class does, and no tap brings them back.
                          Two buttons on this screen destroy dates; both ask. */}
                      {confirming === `stop:${schedule.id}` ? (
                        <ConfirmInline
                          question={`Stop the ${weekdayLine(schedule.weekdays)} repeat of ${type.name}? Its coming dates are cleared, except days you cancelled, which stay cancelled, and ${type.name} stays on your timetable — you can add a repeat again whenever you like.`}
                          confirmLabel="Stop it"
                          cancelLabel="Leave it running"
                          busy={busy !== null}
                          onCancel={() => setConfirming(null)}
                          onConfirm={() => {
                            setConfirming(null);
                            void run(`stop:${schedule.id}`, () =>
                              orgService.stopClassRepeat(gymId, schedule.id),
                            );
                          }}
                        />
                      ) : null}
                    </div>
                  ))}

                  {locked ? null : repeatFor === type.id ? (
                    <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
                      <RepeatForm
                        key={type.id}
                        draft={repeatDraftState}
                        setDraft={setRepeatDraftState}
                        staff={staff}
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
                        // FILLED IN FROM THE CLASS — Kd's ruling of 2026-09-22
                        // happens HERE and nowhere else, so the server has one
                        // answer and never has to guess a field.
                        setRepeatDraftState(repeatDraft(type, today));
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
              summary="Classes you have taken off the timetable. Their past dates are kept, and you can bring one back."
              /* THE GYM'S REAL NUMBER, not the length of the page — round one's
                 C/H-2 printed "117 kept" over 130. */
              aside={`${String(lists.archivedTotal)} kept`}
            >
              <div className="flex flex-col gap-2">
                {archivedPageNote(lists.archived.length, lists.archivedTotal) === null ? null : (
                  <p className="text-xs" style={labelStyle}>
                    {archivedPageNote(lists.archived.length, lists.archivedTotal)}
                  </p>
                )}
                {lists.archived.map((type) => (
                  <div
                    key={type.id}
                    className="text-sm flex items-center justify-between gap-3"
                    style={labelStyle}
                  >
                    {/* WORDED AS THE LIVE CARD IS. A bare "60 min · 20 places"
                        here would be the very line `classDefaultsLine` exists
                        to qualify: since Kd's ruling a class's numbers are what
                        a NEW repeat starts from, and bringing this class back
                        brings exactly that. Kept, not dropped — they are what
                        the gym reads to tell two removed classes apart. */}
                    <span className="min-w-0 flex flex-col">
                      <span className="truncate">{type.name}</span>
                      {classDefaultsLine(type) === '' ? null : (
                        <span className="text-xs truncate">{classDefaultsLine(type)}</span>
                      )}
                    </span>
                    {/* BRING IT BACK — Kd, 2026-09-22, Mindbody's way rather than
                        TeamUp's (which cannot reinstate an archived Class Type
                        at all). No question in front of this one: it ADDS a
                        class back to the timetable and takes nothing away, and
                        Remove is one tap from undoing it. */}
                    {locked ? null : (
                      <button
                        type="button"
                        onClick={() =>
                          void run(`restore:${type.id}`, () => orgService.restoreClass(gymId, type.id))
                        }
                        disabled={busy !== null}
                        aria-label={`Bring ${type.name} back to the timetable`}
                        className="text-sm inline-flex items-center gap-1 flex-shrink-0"
                        style={{ color: '#FF8A1F' }}
                      >
                        {busy === `restore:${type.id}` ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <RotateCcw className="w-4 h-4" />
                        )}
                        Bring back
                      </button>
                    )}
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
