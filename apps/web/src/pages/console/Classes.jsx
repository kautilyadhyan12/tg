import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Clock, Loader2, Plus, RotateCcw } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import {
  ConfirmInline,
  ConsoleFailed,
  ConsoleLoading,
  ConsoleSection,
} from '../../components/console/ConsoleStates';
import {
  CoachField,
  DateField,
  DaysPick,
  Field,
  LengthField,
  RunFields,
  SizeField,
  StartTimePick,
  Tick,
} from './ClassFields';
import ClassWeek from './ClassWeek';
import { useConsoleOrg } from './useConsoleOrg';
import { viewerPrivileges } from './consoleView';
import { consoleIsReadOnly, readOnlyNote } from './billingView';
import { addDays, clockLabel, gymToday } from './hoursView';
import {
  archivedPageNote,
  bulkEditBounds,
  bulkEditDraft,
  bulkEditProblem,
  bulkEditRequest,
  bulkEditSlots,
  CLASS_COLOUR_CHOICES,
  canManageSchedule,
  classDraft,
  classProblem,
  classRequest,
  classSwatch,
  emptyClassDraft,
  peopleLine,
  repeatDatesLine,
  repeatDraft,
  repeatEditDraft,
  repeatEditMoves,
  repeatEditNote,
  repeatEditProblem,
  repeatEditRequest,
  repeatProblem,
  repeatRequest,
  replaceQuestion,
  replacesAsked,
  slotEditable,
  timeRange,
  timetableLists,
  toggleBulkSlot,
  toggleWeekday,
  updateFromBounds,
  weekdayLine,
} from './classesView';

// CLASSES — the gym's timetable (Part 3 §13.3). Its words are gym software's
// (Kd, RULINGS 2026-09-23): a class, its time slots, Cancel, Archive, Restore;
// the Calendar tab is `ClassWeek.jsx`.
//
// Every time here is the gym's own clock; the server turns each date into an
// instant against the gym's zone, and the dates beside a time slot are the ones
// the server wrote.
//
// "Cancel" on this screen only ever takes classes off the calendar, and it asks
// first, in place (Kd, 2026-09-22). Forms close with "Close".

// The page is drawn from `console.css` (spec Part 3 §17; ROADMAP R2): a form's Save is
// its box's one orange button.
function FormButtons({ saveLabel, onSave, onClose, saving, blocked }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={onSave} disabled={saving || blocked} className="c-btn c-btn-p">
        {saving ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
        {saveLabel}
      </button>
      <button type="button" onClick={onClose} className="c-btn c-btn-ghost">
        Close
      </button>
    </div>
  );
}

function Problem({ text }) {
  return text === null ? null : (
    <p className="c-s14 c-w5" style={{ color: 'var(--warn)' }}>
      {text}
    </p>
  );
}

/** One form for adding a class and for editing one. The parent keys it on the
 *  class id so a draft is never carried from one class to another. */
function ClassForm({ draft, setDraft, staff, disabled, onSave, onClose, saving, problem, saveLabel }) {
  const set = (patch) => setDraft({ ...draft, ...patch });
  return (
    <div className="flex flex-col gap-5">
      <Field label="Name">
        <input
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
          disabled={disabled}
          maxLength={80}
          placeholder="Sunrise Yoga"
          className="c-input"
        />
      </Field>

      <Field label="Description (optional)">
        <textarea
          value={draft.description}
          onChange={(e) => set({ description: e.target.value })}
          disabled={disabled}
          maxLength={500}
          rows={2}
          className="c-area"
        />
      </Field>

      <RunFields draft={draft} set={set} staff={staff} disabled={disabled} forClass />

      <div className="c-field">
        <span className="c-label">Colour</span>
        <div className="flex flex-wrap gap-2">
          {CLASS_COLOUR_CHOICES.map((choice) => (
            <button
              key={choice.name}
              type="button"
              onClick={() => set({ colour: choice.name })}
              disabled={disabled}
              aria-label={choice.name}
              aria-pressed={draft.colour === choice.name}
              className="w-11 h-11 md:w-8 md:h-8 rounded-full"
              style={{
                background: choice.swatch ?? 'transparent',
                outline: draft.colour === choice.name ? '2px solid var(--t1)' : 'none',
                outlineOffset: '2px',
              }}
            />
          ))}
        </div>
      </div>

      <Tick checked={draft.openGym} onChange={(on) => set({ openGym: on })} disabled={disabled}>
        Open gym (not a taught class)
      </Tick>

      <Problem text={problem} />
      <FormButtons
        saveLabel={saveLabel}
        onSave={onSave}
        onClose={onClose}
        saving={saving}
        blocked={disabled || problem !== null}
      />
    </div>
  );
}

/** A new time slot: its days, its start time and dates, and its length, coach
 *  and size, filled in from the class's defaults. */
function RepeatForm({ draft, setDraft, staff, clockFormat, today, disabled, saving, onSave, onClose }) {
  const problem = repeatProblem(draft);
  const set = (patch) => setDraft({ ...draft, ...patch });
  return (
    <div className="flex flex-col gap-5">
      <h3 className="c-h3">New time slot</h3>

      <DaysPick
        weekdays={draft.weekdays}
        onToggle={(iso) => setDraft(toggleWeekday(draft, iso))}
        disabled={disabled}
      />
      <StartTimePick
        value={draft.time}
        clockFormat={clockFormat}
        onChange={(time) => setDraft({ ...draft, time })}
        disabled={disabled}
      />

      <div className="grid gap-5 md:grid-cols-2">
        <DateField
          label="Start date"
          value={draft.startsOn}
          min={today}
          max={addDays(today, 365)}
          today={today}
          onChange={(startsOn) => setDraft({ ...draft, startsOn })}
          disabled={disabled}
        />
        <DateField
          label="End date (optional)"
          value={draft.endsOn}
          min={draft.startsOn || today}
          max={addDays(today, 730)}
          today={today}
          onChange={(endsOn) => setDraft({ ...draft, endsOn })}
          disabled={disabled}
          emptyText="No end date"
          onClear={() => setDraft({ ...draft, endsOn: '' })}
        />
      </div>

      <RunFields draft={draft} set={set} staff={staff} disabled={disabled} forClass={false} />

      <Problem text={problem} />
      <FormButtons
        saveLabel="Add time slot"
        onSave={onSave}
        onClose={onClose}
        saving={saving}
        blocked={disabled || problem !== null}
      />
    </div>
  );
}

/** Editing a time slot from a date: its days, start time, length, coach and
 *  size. When a move would replace classes changed on their own, the server
 *  asks and the question stands where Save was. */
function RepeatEditForm({
  schedule,
  draft,
  setDraft,
  bounds,
  today,
  staff,
  clockFormat,
  disabled,
  saving,
  question,
  onSave,
  onClose,
  onMove,
  onBack,
}) {
  const problem = repeatEditProblem(draft, bounds);
  const set = (patch) => setDraft({ ...draft, ...patch });
  return (
    <div className="flex flex-col gap-5">
      <DaysPick
        weekdays={draft.weekdays}
        onToggle={(iso) => setDraft(toggleWeekday(draft, iso))}
        disabled={disabled}
      />
      <StartTimePick
        value={draft.time}
        clockFormat={clockFormat}
        onChange={(time) => set({ time })}
        disabled={disabled}
      />
      <RunFields draft={draft} set={set} staff={staff} disabled={disabled} forClass={false} />
      <DateField
        label="Update from"
        value={draft.updateFrom}
        min={bounds.min}
        max={bounds.max}
        today={today}
        onChange={(updateFrom) => set({ updateFrom })}
        disabled={disabled}
      />
      <p className="c-hint">{repeatEditNote(repeatEditMoves(schedule, draft))}</p>
      <Problem text={problem} />
      {question === null ? (
        <FormButtons
          saveLabel="Save"
          onSave={onSave}
          onClose={onClose}
          saving={saving}
          blocked={disabled || problem !== null}
        />
      ) : (
        <ConfirmInline
          question={question}
          confirmLabel="Move anyway"
          cancelLabel="Go back"
          busy={saving}
          newLook
          onConfirm={onMove}
          onCancel={onBack}
        />
      )}
    </div>
  );
}

/** One field of a bulk edit: a tick, and the box once it is ticked. */
function BulkChange({ label, on, onToggle, disabled, children }) {
  return (
    <div className="flex flex-col gap-2">
      <Tick checked={on} onChange={onToggle} disabled={disabled}>
        {label}
      </Tick>
      {on ? <div className="pl-7">{children}</div> : null}
    </div>
  );
}

/** BULK EDIT (TeamUp's name): a new length, coach or class size for the ticked
 *  time slots of one class, from an Update-from date. */
function BulkEditForm({
  slots,
  draft,
  setDraft,
  bounds,
  today,
  staff,
  clockFormat,
  disabled,
  saving,
  onSave,
  onClose,
}) {
  const problem = bulkEditProblem(draft, bounds);
  const set = (patch) => setDraft({ ...draft, ...patch });
  return (
    <div className="flex flex-col gap-5">
      <div className="c-field">
        <span className="c-label">Time slots</span>
        {slots.map((slot) => (
          <label key={slot.id} className="flex items-start gap-2.5 py-1.5 c-s15 c-w6 c-t1">
            <input
              type="checkbox"
              className="mt-0.5 w-[18px] h-[18px] flex-shrink-0"
              style={{ accentColor: 'var(--accent)' }}
              checked={draft.ticked.includes(slot.id)}
              onChange={() => setDraft(toggleBulkSlot(draft, slot.id))}
              disabled={disabled}
            />
            <span>
              {weekdayLine(slot.weekdays)} ·{' '}
              <span className="whitespace-nowrap">
                {timeRange(slot.startMinute, slot.minutes, clockFormat)}
              </span>
              <span className="block c-s14 c-w5 c-t2">{peopleLine(slot)}</span>
              {/* Its dates, so the two halves of a time slot changed from a
                  date can be told apart (round one, L-1). */}
              <span className="block c-s13 c-w5 c-t3">{repeatDatesLine(slot)}</span>
            </span>
          </label>
        ))}
      </div>
      <BulkChange
        label="Change length"
        on={draft.changeMinutes}
        onToggle={() => set({ changeMinutes: !draft.changeMinutes })}
        disabled={disabled}
      >
        <LengthField draft={draft} set={set} disabled={disabled} />
      </BulkChange>
      <BulkChange
        label="Change coach"
        on={draft.changeCoach}
        onToggle={() => set({ changeCoach: !draft.changeCoach })}
        disabled={disabled}
      >
        <CoachField draft={draft} set={set} staff={staff} disabled={disabled} />
      </BulkChange>
      <BulkChange
        label="Change class size"
        on={draft.changePlaces}
        onToggle={() => set({ changePlaces: !draft.changePlaces })}
        disabled={disabled}
      >
        <SizeField draft={draft} set={set} disabled={disabled} />
      </BulkChange>
      <DateField
        label="Update from"
        value={draft.updateFrom}
        min={bounds.min}
        max={bounds.max}
        today={today}
        onChange={(updateFrom) => set({ updateFrom })}
        disabled={disabled}
      />
      <p className="c-hint">{repeatEditNote(false)}</p>
      <Problem text={problem} />
      <FormButtons
        saveLabel="Save"
        onSave={onSave}
        onClose={onClose}
        saving={saving}
        blocked={disabled || problem !== null}
      />
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
  // Which row is asking a question — an id, so two rows never ask at once.
  const [confirming, setConfirming] = useState(null);
  const [repeatFor, setRepeatFor] = useState(null);
  const [repeatDraftState, setRepeatDraftState] = useState(() => repeatDraft(null, ''));
  // Which time slot is open for editing — an id, for the same reason.
  const [editingRepeat, setEditingRepeat] = useState(null);
  const [repeatEditState, setRepeatEditState] = useState(() => repeatEditDraft(null));
  // A move the server asked about: how many classes it would replace, from
  // which date. Any change to the form puts Save back.
  const [replaceAsk, setReplaceAsk] = useState(null);
  // Which class is open for a bulk edit, and its form.
  const [bulkFor, setBulkFor] = useState(null);
  const [bulkState, setBulkState] = useState(() => bulkEditDraft([], ''));

  const [reloadKey, setReloadKey] = useState(0);
  // Which tab, in the address so a reload or a shared link keeps it.
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('view') === 'week' ? 'week' : 'list';

  // The loading flag is set by the click, never inside the effect; Try again
  // bumps the key, which re-runs it.
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
    // tab or by the browser's Back — since a date changed on the calendar moves
    // what its time slot shows next.
  }, [gymId, reloadKey, view]);

  // The coach list is a separate, optional read: somebody who may set the
  // timetable need not hold `staff.manage`, and its 403 is not this screen's
  // failure. An empty list leaves "No coach" as the only choice.
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
      <div className="c-page">
        <ConsoleLoading label="Loading your organisation…" newLook />
      </div>
    );
  }
  if (orgError !== null) {
    return (
      <div className="c-page">
        <ConsoleFailed message={orgError} onRetry={reload} newLook />
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="c-page">
        <section className="c-card p-5 md:p-6 flex flex-col gap-3">
          <p className="c-s15 c-t2">We couldn&apos;t find an organisation you run at this address.</p>
          <Link to="/console" className="c-s15 c-w6 c-lk self-start">
            Your organisations
          </Link>
        </section>
      </div>
    );
  }

  const privileges = viewerPrivileges(org);
  const allowed = canManageSchedule(privileges);
  const readOnly = consoleIsReadOnly(org);
  const lists = timetableLists(timetable);
  const timezone = lists.timezone === '' ? org.timezone : lists.timezone;
  const today = gymToday(timezone);
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

  const editBounds = (schedule) => updateFromBounds(schedule, today, lists.horizonDays);

  // Not `run`: a move the server asks about is a question, not a failure.
  const saveRepeatEdit = async (schedule, confirmReplace = null) => {
    const body = repeatEditRequest(repeatEditState, editBounds(schedule), confirmReplace);
    if (body === null) return;
    setBusy(`repeatEdit:${schedule.id}`);
    setActionError(null);
    try {
      const res = await orgService.updateClassRepeat(gymId, schedule.id, body);
      setTimetable(res.data);
      setReplaceAsk(null);
      setEditingRepeat(null);
    } catch (err) {
      const count = replacesAsked(err);
      if (count === null) {
        setReplaceAsk(null);
        setActionError(errorText(err, "We couldn't save that."));
        // A refusal can mean the list on screen is out of date — the same Save
        // pressed again after the first one went through — so read it again
        // (round one, L-3), as the Calendar does.
        try {
          const fresh = await orgService.getClasses(gymId);
          setTimetable(fresh.data);
        } catch {
          // The sentence above already says the save failed.
        }
      } else {
        setReplaceAsk({ count, from: body.updateFrom });
      }
    } finally {
      setBusy(null);
    }
  };

  const bulkBounds = (slots) =>
    bulkEditBounds(
      slots.filter((s) => bulkState.ticked.includes(s.id)),
      today,
      lists.horizonDays,
    );

  const saveBulk = async (typeId, slots) => {
    const body = bulkEditRequest(bulkState, bulkBounds(slots));
    if (body === null) return;
    if (await run(`bulk:${typeId}`, () => orgService.bulkEditClass(gymId, typeId, body))) {
      setBulkFor(null);
      return;
    }
    // A refusal can mean the list on screen is out of date, as for one time
    // slot's Edit; read it again.
    try {
      const fresh = await orgService.getClasses(gymId);
      setTimetable(fresh.data);
    } catch {
      // The sentence above already says the save failed.
    }
  };

  const showView = (next) => {
    if (next === view) return;
    setSearchParams(next === 'week' ? { view: 'week' } : {});
  };
  const weekShown = view === 'week' && allowed;

  const listReady = !loading && failed === null;
  // The page's one main button, top right (spec Part 3 §17.2 rule 1). It gives way to the
  // form, whose own button has the same words; from the Calendar it opens the form on the
  // Classes tab.
  const showAdd = !locked && !adding && (weekShown || listReady);
  const openAdd = () => {
    showView('list');
    setAdding(true);
    setAddDraft(emptyClassDraft());
  };

  return (
    <div className="c-page">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-6">
        <div className="flex flex-col gap-1.5 min-w-0">
          <h1 className="c-h1">Classes</h1>
          <p className="c-sub">
            {org.name}
            {timezone ? ` · ${timezone} time` : ''}
          </p>
        </div>
        {showAdd ? (
          <button type="button" onClick={openAdd} className="c-btn c-btn-p w-full md:w-auto">
            <Plus aria-hidden="true" className="w-4 h-4" />
            Add class
          </button>
        ) : null}
      </header>

      {/* A lapsed gym's staff see everything and change nothing (§4.2). */}
      {readOnly && allowed ? (
        <section className="c-card p-5 md:p-6">
          <p className="c-s15 c-t2">{readOnlyNote(org.orgType)}</p>
        </section>
      ) : null}

      {!allowed ? (
        <section className="c-card p-5 md:p-6">
          <p className="c-s15 c-t2">Your role doesn&apos;t allow you to set the timetable.</p>
        </section>
      ) : null}

      {allowed ? (
        <div className="c-utabs" role="tablist" aria-label="How to show your classes">
          {[
            ['list', 'Classes'],
            ['week', 'Calendar'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              onClick={() => showView(key)}
              className={view === key ? 'c-utab c-utab-on' : 'c-utab'}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {weekShown ? <ClassWeek gymId={gymId} staff={staff} locked={locked} /> : null}

      {!weekShown && actionError !== null ? <ConsoleFailed message={actionError} newLook /> : null}

      {!weekShown && loading ? <ConsoleLoading label="Loading your timetable…" newLook /> : null}
      {!weekShown && !loading && failed !== null ? (
        <ConsoleFailed message={failed} onRetry={retry} newLook />
      ) : null}

      {!weekShown && listReady ? (
        <>
          {!locked && adding ? (
            <section className="c-card c-narrow p-5 md:p-6 flex flex-col gap-5">
              <h2 className="c-h2">New class</h2>
              <ClassForm
                draft={addDraft}
                setDraft={setAddDraft}
                staff={staff}
                disabled={locked}
                saving={busy === 'add'}
                problem={classProblem(addDraft)}
                saveLabel="Add class"
                onSave={() => void saveNew()}
                onClose={() => setAdding(false)}
              />
            </section>
          ) : null}

          {lists.entries.length === 0 ? (
            <section className="c-card p-5 md:p-6">
              <p className="c-s15 c-t2">No classes yet.</p>
            </section>
          ) : null}

          {/* Two columns on a wide screen, as drawn; one below 1280 px, where two would
              leave a class too narrow for its three buttons. */}
          {lists.entries.length === 0 ? null : (
            <div className="grid gap-5 md:gap-6 xl:grid-cols-2 items-start">
              {lists.entries.map((entry) => {
                const type = entry.type;
                const swatch = classSwatch(type.colour);
                const isEditing = editing === type.id;
                const asking = confirming === `archive:${type.id}`;
                const bulkSlots = bulkEditSlots(entry.schedules, today, lists.horizonDays);
                const isBulk = bulkFor === type.id;
                return (
                  <section
                    key={type.id}
                    className="c-card relative overflow-hidden flex flex-col gap-4 py-5 pr-5 pl-[25px] md:py-6 md:pr-6 md:pl-[29px] min-w-0"
                  >
                    {/* The class's own colour down its edge, as its classes carry
                        it on the Calendar (Kd, RULINGS 2026-09-23). */}
                    {swatch === null ? null : (
                      <span
                        aria-hidden="true"
                        data-testid="class-colour"
                        className="absolute left-0 top-0 bottom-0 w-[5px]"
                        style={{ background: swatch }}
                      />
                    )}
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="flex flex-col gap-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="c-h2">{type.name}</h2>
                          {type.openGym ? <span className="c-tag c-tag-plain">Open gym</span> : null}
                        </div>
                        {type.description === null || type.description === '' ? null : (
                          <p className="c-s14 c-t2">{type.description}</p>
                        )}
                      </div>
                      {/* Buttons for the class, words for its time slots, so the
                          two levels never look alike. */}
                      {locked || isEditing || asking || isBulk ? null : (
                        <div className="flex flex-wrap items-center gap-1.5 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setEditing(type.id);
                              setEditDraft(classDraft(type));
                            }}
                            aria-label={`Edit ${type.name}`}
                            className="c-btn c-btn-sm c-btn-s"
                          >
                            Edit class
                          </button>
                          {bulkSlots.length >= 2 ? (
                            <button
                              type="button"
                              onClick={() => {
                                setBulkFor(type.id);
                                setBulkState(bulkEditDraft(bulkSlots, today));
                              }}
                              aria-label={`Bulk edit the time slots of ${type.name}`}
                              className="c-btn c-btn-sm c-btn-s"
                            >
                              Bulk edit
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => setConfirming(`archive:${type.id}`)}
                            disabled={busy !== null}
                            aria-label={`Archive ${type.name}`}
                            className="c-btn c-btn-sm c-btn-ghost"
                          >
                            {busy === `archive:${type.id}` ? (
                              <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />
                            ) : null}
                            Archive
                          </button>
                        </div>
                      )}
                    </div>

                    {asking ? (
                      <ConfirmInline
                        question={`Archive ${type.name}? Its time slots are cancelled and its upcoming classes come off the calendar. You can restore the class later and add its time slots again.`}
                        confirmLabel="Archive"
                        cancelLabel="Keep it"
                        busy={busy !== null}
                        newLook
                        onCancel={() => setConfirming(null)}
                        onConfirm={() => {
                          setConfirming(null);
                          void run(`archive:${type.id}`, () => orgService.archiveClass(gymId, type.id));
                        }}
                      />
                    ) : null}

                    {isEditing ? (
                      <ClassForm
                        key={type.id}
                        draft={editDraft}
                        setDraft={setEditDraft}
                        staff={staff}
                        disabled={locked}
                        saving={busy === `edit:${type.id}`}
                        problem={classProblem(editDraft)}
                        saveLabel="Save"
                        onSave={() => void saveEdit(type.id)}
                        onClose={() => setEditing(null)}
                      />
                    ) : null}

                    {isBulk ? (
                      <BulkEditForm
                        key={type.id}
                        slots={bulkSlots}
                        draft={bulkState}
                        setDraft={setBulkState}
                        bounds={bulkBounds(bulkSlots)}
                        today={today}
                        staff={staff}
                        clockFormat={lists.clockFormat}
                        disabled={locked}
                        saving={busy === `bulk:${type.id}`}
                        onSave={() => void saveBulk(type.id, bulkSlots)}
                        onClose={() => setBulkFor(null)}
                      />
                    ) : null}

                    <div className="flex flex-col gap-2">
                      <span className="c-s13 c-w6 c-t3">Time slots</span>
                      {entry.schedules.length === 0 ? <p className="c-s14 c-t3">No time slots yet.</p> : null}
                      {entry.schedules.map((schedule) => {
                        const days = weekdayLine(schedule.weekdays);
                        const startsAt = clockLabel(schedule.startMinute, lists.clockFormat);
                        const editingThis = editingRepeat === schedule.id;
                        const askingThis = confirming === `stop:${schedule.id}`;
                        return (
                          <div
                            key={schedule.id}
                            className="rounded-xl px-3 py-3 md:px-3.5 flex flex-col gap-3"
                            style={{ border: '1px solid var(--card-line)' }}
                          >
                            <div className="flex flex-col gap-1 md:flex-row md:items-start md:gap-3">
                              <div className="min-w-0 flex items-start gap-2.5 md:gap-3 flex-grow">
                                <Clock
                                  aria-hidden="true"
                                  className="w-[18px] h-[18px] mt-0.5 flex-shrink-0"
                                  style={{ color: swatch ?? 'var(--t3)' }}
                                />
                                <div className="min-w-0 flex flex-col gap-0.5">
                                  <div className="c-s15 c-w6 c-t1">
                                    {days} ·{' '}
                                    {/* The time range never breaks across lines. */}
                                    <span className="whitespace-nowrap">
                                      {timeRange(schedule.startMinute, schedule.minutes, lists.clockFormat)}
                                    </span>
                                  </div>
                                  <div className="c-s14 c-t2">{peopleLine(schedule)}</div>
                                  {editingThis ? null : (
                                    <div className="c-s13 c-t3">{repeatDatesLine(schedule)}</div>
                                  )}
                                </div>
                              </div>
                              {locked || editingThis || askingThis ? null : (
                                <div className="flex items-center gap-5 md:gap-3.5 flex-shrink-0 pl-7 md:pl-0">
                                  {/* No date is left to change an ended time slot from. */}
                                  {slotEditable(schedule, editBounds(schedule)) ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingRepeat(schedule.id);
                                        setReplaceAsk(null);
                                        setRepeatEditState(repeatEditDraft(schedule, editBounds(schedule)));
                                      }}
                                      aria-label={`Edit the ${days} ${startsAt} time slot of ${type.name}`}
                                      className="c-btn c-btn-link"
                                    >
                                      Edit
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={() => setConfirming(`stop:${schedule.id}`)}
                                    disabled={busy !== null}
                                    aria-label={`Cancel the ${days} ${startsAt} time slot of ${type.name}`}
                                    className="c-btn c-btn-quiet"
                                  >
                                    {busy === `stop:${schedule.id}` ? 'Cancelling…' : 'Cancel'}
                                  </button>
                                </div>
                              )}
                            </div>

                            {editingThis ? (
                              <RepeatEditForm
                                key={schedule.id}
                                schedule={schedule}
                                draft={repeatEditState}
                                setDraft={(next) => {
                                  setReplaceAsk(null);
                                  setRepeatEditState(next);
                                }}
                                bounds={editBounds(schedule)}
                                today={today}
                                staff={staff}
                                clockFormat={lists.clockFormat}
                                disabled={locked}
                                saving={busy === `repeatEdit:${schedule.id}`}
                                question={
                                  replaceAsk === null ? null : replaceQuestion(replaceAsk.count, replaceAsk.from)
                                }
                                onSave={() => void saveRepeatEdit(schedule)}
                                onClose={() => {
                                  setReplaceAsk(null);
                                  setEditingRepeat(null);
                                }}
                                onMove={() => {
                                  if (replaceAsk !== null) void saveRepeatEdit(schedule, replaceAsk.count);
                                }}
                                onBack={() => setReplaceAsk(null)}
                              />
                            ) : null}
                            {askingThis ? (
                              <ConfirmInline
                                question={`Cancel the ${days} ${startsAt} time slot? Its upcoming classes come off the calendar.`}
                                confirmLabel="Cancel time slot"
                                cancelLabel="Keep it"
                                busy={busy !== null}
                                newLook
                                onCancel={() => setConfirming(null)}
                                onConfirm={() => {
                                  setConfirming(null);
                                  void run(`stop:${schedule.id}`, () => orgService.stopClassRepeat(gymId, schedule.id));
                                }}
                              />
                            ) : null}
                          </div>
                        );
                      })}

                      {locked ? null : repeatFor === type.id ? (
                        <div className="rounded-xl p-4" style={{ background: 'var(--raise)' }}>
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
                            onClose={() => setRepeatFor(null)}
                          />
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setRepeatFor(type.id);
                            // Filled in from the class's defaults, here and nowhere
                            // else (Kd, RULINGS 2026-09-22).
                            setRepeatDraftState(repeatDraft(type, today));
                          }}
                          className="c-btn c-btn-link self-start gap-1.5 mt-1"
                        >
                          <Plus aria-hidden="true" className="w-4 h-4" />
                          Add time slot
                        </button>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          {lists.archived.length === 0 ? null : (
            <ConsoleSection
              title="Archived classes"
              // The gym's real total, not the length of the page.
              aside={String(lists.archivedTotal)}
              newLook
            >
              <div className="flex flex-col">
                {archivedPageNote(lists.archived.length, lists.archivedTotal) === null ? null : (
                  <p className="c-s13 c-t3 pb-2">{archivedPageNote(lists.archived.length, lists.archivedTotal)}</p>
                )}
                {lists.archived.map((type) => (
                  <div
                    key={type.id}
                    className="flex items-center justify-between gap-3 min-h-11 py-1"
                    style={{ borderTop: '1px solid var(--line)' }}
                  >
                    <span className="c-s15 c-t2 min-w-0 truncate">{type.name}</span>
                    {/* Restore takes nothing away, so it asks nothing (Kd,
                        2026-09-22, Mindbody's behaviour). */}
                    {locked ? null : (
                      <button
                        type="button"
                        onClick={() => void run(`restore:${type.id}`, () => orgService.restoreClass(gymId, type.id))}
                        disabled={busy !== null}
                        aria-label={`Restore ${type.name}`}
                        className="c-btn c-btn-link gap-1.5 flex-shrink-0"
                      >
                        {busy === `restore:${type.id}` ? (
                          <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />
                        ) : (
                          <RotateCcw aria-hidden="true" className="w-4 h-4" />
                        )}
                        Restore
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
