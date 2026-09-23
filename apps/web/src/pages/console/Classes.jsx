import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Clock, Loader2, Plus, RotateCcw } from 'lucide-react';
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
import { WEEKDAYS, addDays, clockLabel, gymToday } from './hoursView';
import {
  archivedPageNote,
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
  repeatEditRequest,
  repeatProblem,
  repeatRequest,
  runFieldsProblem,
  timeRange,
  timetableLists,
  toggleWeekday,
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

const primaryStyle = (dim) => ({
  background: 'rgba(255,138,31,0.15)',
  color: '#FF8A1F',
  opacity: dim ? 0.5 : 1,
});

function FormButtons({ saveLabel, onSave, onClose, saving, blocked }) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onSave}
        disabled={saving || blocked}
        className="rounded-xl px-4 py-2 text-sm font-medium inline-flex items-center gap-2"
        style={primaryStyle(saving || blocked)}
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        {saveLabel}
      </button>
      <button type="button" onClick={onClose} className="text-sm" style={labelStyle}>
        Close
      </button>
    </div>
  );
}

function Problem({ text }) {
  return text === null ? null : (
    <p className="text-sm" style={{ color: '#FBBF24' }}>
      {text}
    </p>
  );
}

/** One form for adding a class and for editing one. The parent keys it on the
 *  class id so a draft is never carried from one class to another. */
function ClassForm({ draft, setDraft, staff, disabled, onSave, onClose, saving, problem, saveLabel }) {
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

      <Field label="Description (optional)">
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
        Open gym (not a taught class)
      </label>

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
    <div className="flex flex-col gap-4">
      <div className="text-xs uppercase tracking-wider" style={labelStyle}>
        New time slot
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-wider" style={labelStyle}>
          Days
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
          Start time
        </span>
        <TimePick
          label="Start time"
          kind="opens"
          value={draft.time}
          clockFormat={clockFormat}
          onChange={(time) => setDraft({ ...draft, time })}
          disabled={disabled}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Start date">
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
        <Field label="End date (optional)">
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

/** Editing a time slot: its length, coach and size. Its days and time are
 *  moved from a date, which is 17b-ii-b-ii. */
function RepeatEditForm({ draft, setDraft, staff, disabled, saving, onSave, onClose }) {
  const problem = runFieldsProblem(draft);
  const set = (patch) => setDraft({ ...draft, ...patch });
  return (
    <div className="flex flex-col gap-4">
      <RunFields draft={draft} set={set} staff={staff} disabled={disabled} forClass={false} />
      <p className="text-xs" style={labelStyle}>
        Applies to upcoming classes.
      </p>
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
          {timezone ? ` · ${timezone} time` : ''}
        </p>
      </div>

      {/* A lapsed gym's staff see everything and change nothing (§4.2). */}
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
            ['week', 'Calendar'],
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
                No classes yet.
              </p>
            </ConsoleCard>
          ) : null}

          {lists.entries.map((entry) => {
            const type = entry.type;
            const swatch = classSwatch(type.colour);
            const isEditing = editing === type.id;
            const asking = confirming === `archive:${type.id}`;
            return (
              <ConsoleCard key={type.id} className="relative overflow-hidden">
                {/* The class's own colour down its edge, as its classes carry
                    it on the Calendar (Kd, RULINGS 2026-09-23). */}
                {swatch === null ? null : (
                  <span
                    aria-hidden="true"
                    data-testid="class-colour"
                    className="absolute left-0 top-0 bottom-0 w-1"
                    style={{ background: swatch }}
                  />
                )}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold" style={{ color: '#fff' }}>
                        {type.name}
                      </h2>
                      {type.openGym ? (
                        <span
                          className="text-xs rounded-md px-1.5 py-0.5 whitespace-nowrap"
                          style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.65)' }}
                        >
                          Open gym
                        </span>
                      ) : null}
                    </div>
                    {type.description === null || type.description === '' ? null : (
                      <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.65)' }}>
                        {type.description}
                      </p>
                    )}
                  </div>
                  {/* Buttons for the class, links for its time slots, so the
                      two levels never look alike. */}
                  {locked || isEditing || asking ? null : (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(type.id);
                          setEditDraft(classDraft(type));
                        }}
                        aria-label={`Edit ${type.name}`}
                        className="text-sm rounded-lg px-3 py-1.5"
                        style={{ border: '1px solid rgba(255,138,31,0.35)', color: '#FF8A1F' }}
                      >
                        Edit class
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(`archive:${type.id}`)}
                        disabled={busy !== null}
                        aria-label={`Archive ${type.name}`}
                        className="text-sm rounded-lg px-3 py-1.5 inline-flex items-center gap-1"
                        style={{ border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.65)' }}
                      >
                        {busy === `archive:${type.id}` ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : null}
                        Archive
                      </button>
                    </div>
                  )}
                </div>

                {asking ? (
                  <div className="mt-3">
                    <ConfirmInline
                      question={`Archive ${type.name}? Its upcoming classes come off the calendar. You can restore it later.`}
                      confirmLabel="Archive"
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
                  </div>
                ) : null}

                <div className="mt-4 flex flex-col gap-2">
                  <div className="text-xs uppercase tracking-wider" style={labelStyle}>
                    Time slots
                  </div>
                  {entry.schedules.length === 0 ? (
                    <p className="text-sm" style={labelStyle}>
                      No time slots yet.
                    </p>
                  ) : null}
                  {entry.schedules.map((schedule) => {
                    const days = weekdayLine(schedule.weekdays);
                    const editingThis = editingRepeat === schedule.id;
                    const askingThis = confirming === `stop:${schedule.id}`;
                    return (
                      <div
                        key={schedule.id}
                        className="rounded-xl px-3.5 py-3 flex flex-col gap-3"
                        style={{
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.07)',
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex items-start gap-2.5">
                            <Clock
                              aria-hidden="true"
                              className="w-4 h-4 mt-0.5 flex-shrink-0"
                              style={{ color: swatch ?? 'rgba(255,255,255,0.45)' }}
                            />
                            <div className="min-w-0">
                              <div className="text-sm font-semibold" style={{ color: '#fff' }}>
                                {days} ·{' '}
                                {/* The time range never breaks across lines. */}
                                <span className="whitespace-nowrap">
                                  {timeRange(schedule.startMinute, schedule.minutes, lists.clockFormat)}
                                </span>
                              </div>
                              <div className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.7)' }}>
                                {peopleLine(schedule)}
                              </div>
                              {editingThis ? null : (
                                <div className="text-xs mt-1" style={labelStyle}>
                                  {repeatDatesLine(schedule)}
                                </div>
                              )}
                            </div>
                          </div>
                          {locked || editingThis || askingThis ? null : (
                            <div className="flex items-center gap-4 flex-shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingRepeat(schedule.id);
                                  setRepeatEditState(repeatEditDraft(schedule));
                                }}
                                aria-label={`Edit the ${days} time slot of ${type.name}`}
                                className="text-sm"
                                style={{ color: '#FF8A1F' }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirming(`stop:${schedule.id}`)}
                                disabled={busy !== null}
                                aria-label={`Cancel the ${days} time slot of ${type.name}`}
                                className="text-sm"
                                style={{ color: 'rgba(255,255,255,0.5)' }}
                              >
                                {busy === `stop:${schedule.id}` ? 'Cancelling…' : 'Cancel'}
                              </button>
                            </div>
                          )}
                        </div>

                        {editingThis ? (
                          <RepeatEditForm
                            key={schedule.id}
                            draft={repeatEditState}
                            setDraft={setRepeatEditState}
                            staff={staff}
                            disabled={locked}
                            saving={busy === `repeatEdit:${schedule.id}`}
                            onSave={() => void saveRepeatEdit(schedule.id)}
                            onClose={() => setEditingRepeat(null)}
                          />
                        ) : null}
                        {askingThis ? (
                          <ConfirmInline
                            question={`Cancel the ${days} ${clockLabel(schedule.startMinute, lists.clockFormat)} time slot? Its upcoming classes come off the calendar.`}
                            confirmLabel="Cancel time slot"
                            cancelLabel="Keep it"
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
                    );
                  })}

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
                      className="self-start text-sm inline-flex items-center gap-1"
                      style={{ color: '#FF8A1F' }}
                    >
                      <Plus className="w-4 h-4" />
                      Add time slot
                    </button>
                  )}
                </div>
              </ConsoleCard>
            );
          })}

          {locked ? null : adding ? (
            <ConsoleCard>
              <div className="text-xs uppercase tracking-wider mb-4" style={labelStyle}>
                New class
              </div>
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
              Add class
            </button>
          )}

          {lists.archived.length === 0 ? null : (
            <ConsoleSection
              title="Archived classes"
              // The gym's real total, not the length of the page.
              aside={String(lists.archivedTotal)}
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
                    style={{ color: 'rgba(255,255,255,0.65)' }}
                  >
                    <span className="min-w-0 truncate">{type.name}</span>
                    {/* Restore takes nothing away, so it asks nothing (Kd,
                        2026-09-22, Mindbody's behaviour). */}
                    {locked ? null : (
                      <button
                        type="button"
                        onClick={() =>
                          void run(`restore:${type.id}`, () => orgService.restoreClass(gymId, type.id))
                        }
                        disabled={busy !== null}
                        aria-label={`Restore ${type.name}`}
                        className="text-sm inline-flex items-center gap-1 flex-shrink-0"
                        style={{ color: '#FF8A1F' }}
                      >
                        {busy === `restore:${type.id}` ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <RotateCcw className="w-4 h-4" />
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
