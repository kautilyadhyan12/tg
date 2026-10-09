import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, Loader2, Plus, Search, X } from 'lucide-react';
import { orgWords } from '@app/shared';
import { orgService, errorText } from '../../api/orgsApi';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import DatePick from '../../components/console/DatePick';
import BookingRulesLine from '../../components/console/BookingRulesLine';
import PlaceLink from '../../components/console/PlaceLink';
import TimePick from '../../components/console/TimePick';
import { DateField, Tick } from './ClassFields';
import { useConsoleOrg } from './useConsoleOrg';
import { consoleIsReadOnly, readOnlyNote } from './billingView';
import { viewerPrivileges } from './consoleView';
import { canManageStaff } from './staffView';
import { calendarTo, canOpenPlace, placeFor } from './consolePlaces';
import { WEEKDAYS, addDays, gymToday } from './hoursView';
import {
  HOURS_REPEAT,
  HOURS_REPEAT_OWN,
  NEXT_WEEK,
  NOT_TOLD,
  PREVIOUS_WEEK,
  PT_INTRO_MANAGER,
  PT_INTRO_OWN,
  PT_TITLE,
  SESSION_LENGTH_HINT,
  TIME_OFF_BOX_FIRST,
  TIME_OFF_INTRO,
  SESSION_LENGTH_USUAL,
  addRange,
  bookCost,
  bookSentence,
  MARK_FAILED,
  bookableUntil,
  canAddRange,
  canGoEarlier,
  canGoLater,
  cancelBox,
  classInTimeOff,
  coachedClassRow,
  dayHeading,
  dayTimeOffRow,
  freeTimeLabel,
  hoursDraft,
  hoursFormProblem,
  dayTabs,
  hoursBrief,
  pickDay,
  hoursRequest,
  noTimesNote,
  peopleHeading,
  personRow,
  pickTrainer,
  pickerIsEmpty,
  removeRange,
  sessionClash,
  markRow,
  pastDaysNote,
  sessionRow,
  sessionsAWeek,
  setRange,
  setupCount,
  setupSteps,
  timeOffAsked,
  timeOffBoxLines,
  timeOffBoxRow,
  timeOffBoxTitle,
  timeOffDayLimits,
  timeOffDraft,
  timeOffFormProblem,
  timeOffLine,
  timeOffRemoveBox,
  timeOffRequest,
  timeOffSummary,
  trainerGroups,
  trainerName,
  trainerSummary,
  weekTitle,
} from './personalTrainingView';

// PERSONAL TRAINING (spec Part 3 §13.5; ROADMAP 17e-i): each trainer's hours, the free
// times those hours make, and the sessions booked with them. Staff who run the timetable
// see every trainer; anybody else on staff sees their own hours and sessions. Every time
// is the gym's own clock; the server works out the free times and decides every booking.
// Drawn from `console.css` (spec Part 3 §17).

/** One trainer's hours, as a form. Everything in it waits for Save. */
function HoursForm({ trainer, clockFormat, saving, error, onSave, onClose }) {
  const [draft, setDraft] = useState(() => hoursDraft(trainer));
  const problem = hoursFormProblem(draft);
  return (
    <div className="flex flex-col gap-5" data-testid="pt-hours-form">
      <h3 className="c-h3 m-0">Hours for {trainerName(trainer)}</h3>
      <Tick checked={draft.offers} onChange={(on) => setDraft({ ...draft, offers: on })} disabled={saving}>
        Takes personal training sessions
      </Tick>

      <div className="c-field">
        <label className="c-label" htmlFor="pt-session-length">
          How long is one session? (minutes)
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="pt-session-length"
            value={draft.sessionMinutes}
            onChange={(e) => setDraft({ ...draft, sessionMinutes: e.target.value })}
            disabled={saving}
            inputMode="numeric"
            maxLength={3}
            className="c-input"
            style={{ width: 104 }}
          />
          {SESSION_LENGTH_USUAL.map((minutes) => (
            <button
              key={minutes}
              type="button"
              onClick={() => setDraft({ ...draft, sessionMinutes: minutes })}
              disabled={saving}
              aria-pressed={draft.sessionMinutes.trim() === minutes}
              aria-label={`${minutes} minutes`}
              className={draft.sessionMinutes.trim() === minutes ? 'c-chip c-chip-on c-num' : 'c-chip c-num'}
            >
              {minutes}
            </button>
          ))}
        </div>
        <span className="c-s13 c-t3">{SESSION_LENGTH_HINT}</span>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="c-label">Hours they are available each week, on {`the gym's`} clock</span>
          <span className="c-s13 c-t3">A split day? Add a second set of hours, for example a morning and an evening.</span>
        </div>
        {WEEKDAYS.map((day) => {
          const ranges = draft.days[day.iso] ?? [];
          return (
            <div key={day.iso} className="flex flex-col gap-2 pb-3" style={{ borderBottom: '1px solid var(--line)' }}>
              <div className="flex items-center justify-between gap-3">
                <span className="c-s15 c-w6 c-t1">{day.label}</span>
                {canAddRange(draft, day.iso) ? (
                  <button
                    type="button"
                    onClick={() => setDraft(addRange(draft, day.iso))}
                    disabled={saving}
                    aria-label={`Add hours on ${day.label}`}
                    className="c-btn c-btn-sm c-btn-s"
                  >
                    <Plus aria-hidden="true" className="w-4 h-4" /> {ranges.length === 0 ? 'Add hours' : 'Add more hours'}
                  </button>
                ) : null}
              </div>
              {ranges.length === 0 ? <span className="c-s14 c-t3">Not training this day</span> : null}
              {ranges.map((range, index) => (
                <div key={`${String(day.iso)}-${String(index)}`} className="flex flex-wrap items-end gap-3">
                  <div className="c-field">
                    <span className="c-label">From</span>
                    <TimePick
                      label={`${day.label} from`}
                      kind="opens"
                      value={range.from}
                      clockFormat={clockFormat}
                      onChange={(value) => setDraft(setRange(draft, day.iso, index, { from: value }))}
                      disabled={saving}
                      newLook
                    />
                  </div>
                  <div className="c-field">
                    <span className="c-label">To</span>
                    <TimePick
                      label={`${day.label} to`}
                      kind="closes"
                      value={range.to}
                      clockFormat={clockFormat}
                      onChange={(value) => setDraft(setRange(draft, day.iso, index, { to: value }))}
                      disabled={saving}
                      newLook
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setDraft(removeRange(draft, day.iso, index))}
                    disabled={saving}
                    aria-label={`Remove ${day.label} hours ${String(index + 1)}`}
                    className="c-btn c-btn-sm c-btn-s"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {problem === null ? (
        <p className="c-s14 c-t2 m-0">
          {draft.offers ? `These hours make ${sessionsAWeek(draft)}.` : 'No new sessions can be booked.'} Sessions already booked stay as they are.
        </p>
      ) : (
        <p className="c-s14 c-w5 m-0" style={{ color: 'var(--warn)' }}>
          {problem}
        </p>
      )}
      {error !== null ? (
        <p className="c-s14 c-w5 m-0" role="alert" style={{ color: 'var(--bad)' }}>
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => onSave(hoursRequest(draft))} disabled={saving || problem !== null} className="c-btn c-btn-p">
          {saving ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
          Save hours
        </button>
        <button type="button" onClick={onClose} disabled={saving} className="c-btn c-btn-ghost">
          Close
        </button>
      </div>
    </div>
  );
}

/** The sessions or the classes inside a time off being added: the first few, then See all. */
function InTimeOffList({ label, found, kind, clockFormat, today }) {
  const [all, setAll] = useState(false);
  if (found.count === 0) return null;
  const rows = all ? found.shown : found.shown.slice(0, TIME_OFF_BOX_FIRST);
  const more = found.count - rows.length;
  return (
    <div className="flex flex-col gap-2">
      <span className="c-s13 c-w6 c-t3">{label}</span>
      <ul className="m-0 p-0 list-none flex flex-col gap-2" style={all ? { maxHeight: 260, overflowY: 'auto', paddingRight: 4 } : undefined}>
        {rows.map((item) => {
          const row = timeOffBoxRow(item, clockFormat, today, kind);
          return (
            <li key={item.id} className="min-w-0">
              <div className="c-s15 c-t1 c-ell">{row.name}</div>
              <div className="c-s13 c-t3 c-ell c-num">{row.detail}</div>
            </li>
          );
        })}
      </ul>
      {more > 0 ? (
        <p className="c-s14 c-t2 m-0">
          {`and ${more.toLocaleString('en')} more`}
          {!all && found.shown.length > rows.length ? (
            <>
              {' · '}
              <button type="button" onClick={() => setAll(true)} className="c-btn-link c-w6">
                See all
              </button>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/** One trainer's time off: what is coming, each with Remove, and a form that adds one.
 *  Sessions and classes already in a new one are named before it is added. */
function TimeOffPanel({ gymId, trainer, clockFormat, today, locked, canBook, calendarFor, onChanged, onStale, onClose }) {
  const [draft, setDraft] = useState(timeOffDraft);
  const [asked, setAsked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // The time off whose Remove was pressed: it is removed only from the box that asks.
  const [removing, setRemoving] = useState(null);
  // One key until it is added: pressing twice, or again after a lost answer, adds once.
  const requestKey = useRef(crypto.randomUUID());
  const coming = Array.isArray(trainer.timeOff) ? trainer.timeOff : [];
  const problem = timeOffFormProblem(draft, today, coming.length);
  const untouched = draft.fromDate === '' && draft.toDate === '' && draft.from === '' && draft.to === '';
  const limits = timeOffDayLimits(today, draft.fromDate);
  // A change to the form takes the box away: it was about other days.
  const change = (patch) => {
    setDraft({ ...draft, ...patch });
    setAsked(null);
    setError(null);
  };

  const add = async (confirm) => {
    setBusy(true);
    setError(null);
    try {
      const res = await orgService.addPtTimeOff(gymId, trainer.userId, timeOffRequest(draft, requestKey.current, confirm));
      requestKey.current = crypto.randomUUID();
      setDraft(timeOffDraft());
      setAsked(null);
      onChanged(res.data);
    } catch (err) {
      const over = timeOffAsked(err);
      setAsked(over);
      if (err?.response?.data?.error === 'request_reused') {
        // The server has this key on another time off: an earlier press went through and
        // its answer was lost. A new key, and the list read again so that one is shown.
        requestKey.current = crypto.randomUUID();
        setError("That didn't go through. The list above is up to date now: check it before you add this again.");
        onStale();
      } else if (over === null) setError(errorText(err, "We couldn't add that time off."));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (off) => {
    setBusy(true);
    setError(null);
    try {
      const res = await orgService.removePtTimeOff(gymId, trainer.userId, off.id);
      setRemoving(null);
      onChanged(res.data);
    } catch (err) {
      setError(errorText(err, "We couldn't remove that time off."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5" data-testid="pt-time-off">
      <div className="flex flex-col gap-1">
        <h3 className="c-h3 m-0">Time off for {trainerName(trainer)}</h3>
        <p className="c-s14 c-t2 m-0">{TIME_OFF_INTRO}</p>
      </div>

      {coming.length === 0 ? (
        <p className="c-s14 c-t3 m-0">No time off coming.</p>
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col" aria-label="Time off coming">
          {coming.map((off, index) => {
            const line = timeOffLine(off, clockFormat, today);
            const asking = removing === off.id;
            const box = asking ? timeOffRemoveBox(off, trainer, clockFormat, today) : null;
            return (
              <li key={off.id} className="py-2 flex flex-col gap-3 min-w-0" style={index === 0 ? undefined : { borderTop: '1px solid var(--line)' }}>
                <div className="min-h-11 flex items-center justify-between gap-3 min-w-0">
                  <span className="c-s15 c-t1 c-num c-ell">{line}</span>
                  {locked || asking ? null : (
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setRemoving(off.id);
                      }}
                      disabled={busy}
                      aria-label={`Remove time off ${line}`}
                      className="c-btn c-btn-sm c-btn-s flex-shrink-0"
                    >
                      Remove
                    </button>
                  )}
                </div>
                {box !== null ? (
                  <div className="flex flex-col gap-3 pb-1" role="group" aria-label="Remove this time off">
                    <p className="c-s14 c-t1 m-0">{box.question}</p>
                    <p className="c-s14 c-t2 m-0">{box.after}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => void remove(off)} disabled={busy} className="c-btn c-btn-sm c-btn-danger">
                        {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
                        Remove time off
                      </button>
                      <button type="button" onClick={() => setRemoving(null)} disabled={busy} className="c-btn c-btn-sm c-btn-s">
                        Keep it
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {locked ? null : (
        <div className="flex flex-col gap-4 pt-4" style={{ borderTop: '1px solid var(--line)' }}>
          <span className="c-label">Add time off</span>
          <div className="flex flex-wrap items-center gap-2">
            {[
              { kind: 'days', label: 'Whole days' },
              { kind: 'hours', label: 'Part of one day' },
            ].map((choice) => (
              <button
                key={choice.kind}
                type="button"
                onClick={() => change({ kind: choice.kind })}
                disabled={busy}
                aria-pressed={draft.kind === choice.kind}
                className={draft.kind === choice.kind ? 'c-chip c-chip-on' : 'c-chip'}
              >
                {choice.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-start gap-3">
            <div style={{ width: 320, maxWidth: '100%' }}>
              <DateField
                label={draft.kind === 'days' ? 'First day' : 'Day'}
                value={draft.fromDate}
                min={limits.min}
                max={limits.max}
                today={today}
                // The last day follows the first until it is picked later than it.
                onChange={(day) => change({ fromDate: day, toDate: draft.toDate === '' || draft.toDate < day ? day : draft.toDate })}
                disabled={busy}
              />
            </div>
            {draft.kind === 'days' ? (
              <div style={{ width: 320, maxWidth: '100%' }}>
                <DateField
                  label="Last day"
                  value={draft.toDate}
                  min={limits.lastMin}
                  max={limits.lastMax}
                  today={today}
                  onChange={(day) => change({ toDate: day })}
                  disabled={busy}
                />
              </div>
            ) : (
              <>
                <div className="c-field">
                  <span className="c-label">From</span>
                  <TimePick label="Time off from" kind="opens" value={draft.from} clockFormat={clockFormat} onChange={(value) => change({ from: value })} disabled={busy} newLook />
                </div>
                <div className="c-field">
                  <span className="c-label">To</span>
                  <TimePick label="Time off to" kind="closes" value={draft.to} clockFormat={clockFormat} onChange={(value) => change({ to: value })} disabled={busy} newLook />
                </div>
              </>
            )}
          </div>

          {problem !== null && !untouched ? (
            <p className="c-s14 c-w5 m-0" style={{ color: 'var(--warn)' }}>
              {problem}
            </p>
          ) : null}
          {error !== null ? (
            <p className="c-s14 c-w5 m-0" role="alert" style={{ color: 'var(--bad)' }}>
              {error}
            </p>
          ) : null}

          {asked !== null ? (
            <div
              role="group"
              aria-label="Sessions and classes in this time off"
              className="rounded-xl p-4 flex flex-col gap-3"
              style={{ background: 'var(--raise)', border: '1px solid var(--card-line)' }}
              data-testid="pt-time-off-box"
            >
              <p className="c-s15 c-w6 c-t1 m-0">{timeOffBoxTitle(asked, trainer)}</p>
              <InTimeOffList key={`s:${asked.mark}`} label="Sessions booked" found={asked.sessions} kind="session" clockFormat={clockFormat} today={today} />
              <InTimeOffList key={`c:${asked.mark}`} label="Classes they coach" found={asked.classes} kind="class" clockFormat={clockFormat} today={today} />
              {timeOffBoxLines(asked, trainer, draft, canBook, calendarFor(null) !== null).map((line) => (
                <p key={line} className="c-s14 c-t2 m-0">
                  {line}
                </p>
              ))}
              {/* It opens on the week of the first class named here, and leaves the time off
                  being added: so it asks first. */}
              {asked.classes.count > 0 ? (
                <PlaceLink to={calendarFor(asked.classes.shown[0]?.localDate ?? draft.fromDate)} guard>
                  Open the Calendar
                </PlaceLink>
              ) : null}
              {asked.sessions.count > 0 ? <p className="c-s14 c-t2 m-0">{NOT_TOLD}</p> : null}
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => void add(asked.mark)} disabled={busy} className="c-btn c-btn-sm c-btn-danger">
                  {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
                  Add time off anyway
                </button>
                <button type="button" onClick={() => setAsked(null)} disabled={busy} className="c-btn c-btn-sm c-btn-s">
                  Go back
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void add()} disabled={busy || problem !== null} className="c-btn c-btn-p">
                {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
                Add time off
              </button>
              <button type="button" onClick={onClose} disabled={busy} className="c-btn c-btn-ghost">
                Close
              </button>
            </div>
          )}
        </div>
      )}
      {locked ? (
        <div>
          <button type="button" onClick={onClose} className="c-btn c-btn-ghost">
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** The box that books one free time: pick the person from the list, see who and when,
 *  press Book. The list is there without typing; typing narrows it. */
function BookBox({ gymId, trainer, slot, minutes, clockFormat, orgType, membersTo, onBooked, onClose }) {
  const [typed, setTyped] = useState('');
  const [found, setFound] = useState(null);
  const [person, setPerson] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // One key a box: pressing Book twice, or again after a lost answer, books once.
  const requestKey = useRef(crypto.randomUUID());

  const query = typed.trim();
  useEffect(() => {
    let live = true;
    // The list as the box opens; a typed search waits a moment for the next letter.
    const timer = setTimeout(
      () => {
        orgService.getPtPeople(gymId, query, slot.localDate).then(
          (res) => {
            if (live) setFound({ query, data: res.data, failed: null });
          },
          (err) => {
            if (live) setFound({ query, data: null, failed: errorText(err, "We couldn't read your member list.") });
          },
        );
      },
      query === '' ? 0 : 250,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [gymId, query, slot.localDate]);

  const results = found !== null && found.query === query ? found : null;
  const book = async () => {
    if (person === null) return;
    setBusy(true);
    setError(null);
    try {
      await orgService.bookPt(gymId, {
        requestKey: requestKey.current,
        trainerId: trainer.userId,
        entryId: person.entryId,
        localDate: slot.localDate,
        startMinute: slot.startMinute,
        minutes,
      });
      onBooked();
    } catch (err) {
      setError(errorText(err, "We couldn't book that session."));
      setBusy(false);
    }
  };

  return (
    <div className="c-card p-5 flex flex-col gap-4" role="group" aria-label="Book a session" data-testid="pt-book-box" style={{ background: 'var(--raise)' }}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="c-h3 m-0">
          Book {trainerName(trainer)} · {dayHeading(slot.localDate, null)} · {freeTimeLabel(slot.startMinute, minutes, clockFormat)}
        </h3>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="c-btn c-btn-sm c-btn-ghost">
          <X aria-hidden="true" className="w-4 h-4" />
        </button>
      </div>

      {person === null ? (
        <>
          <label className="c-field">
            <span className="c-label">Who is it for?</span>
            <span className="relative block">
              <Search aria-hidden="true" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 c-t3" />
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="Search by name or email"
                maxLength={100}
                className="c-input"
                style={{ paddingLeft: 36 }}
              />
            </span>
          </label>
          {results === null ? <p className="c-s14 c-t3 m-0">Loading your members…</p> : null}
          {results !== null && results.failed !== null ? <p className="c-s14 c-t2 m-0">{results.failed}</p> : null}
          {results !== null && results.data !== null ? (
            <>
              <span className="c-s13 c-w6 c-t3">{peopleHeading(results.data, typed, orgType)}</span>
              {pickerIsEmpty(results.data, typed) ? <PlaceLink to={membersTo}>{`Open ${orgWords(orgType).peopleCap}`}</PlaceLink> : null}
              {results.data.people.length > 0 ? (
                <ul className="m-0 p-0 list-none flex flex-col" style={{ maxHeight: 300, overflowY: 'auto' }}>
                  {results.data.people.map((entry, index) => {
                    const row = personRow(entry, results.data.gymHasTypes);
                    const words = (
                      <>
                        <span className={`c-s15 c-w6 c-ell ${row.pickable ? 'c-t1' : 'c-t3'}`}>{row.name}</span>
                        {row.detail === '' ? null : <span className="c-s13 c-t3 c-ell">{row.detail}</span>}
                      </>
                    );
                    return (
                      <li key={entry.entryId} className="min-w-0" style={index === 0 ? undefined : { borderTop: '1px solid var(--line)' }}>
                        {row.pickable ? (
                          <button
                            type="button"
                            onClick={() => setPerson(entry)}
                            aria-label={`Pick ${row.name}`}
                            className="w-full text-left min-h-11 py-2 flex items-center justify-between gap-3 min-w-0"
                          >
                            <span className="flex flex-col min-w-0">{words}</span>
                            <span className="c-btn c-btn-sm c-btn-s flex-shrink-0" aria-hidden="true">
                              Pick
                            </span>
                          </button>
                        ) : (
                          <div className="min-h-11 py-2 flex flex-col justify-center min-w-0">{words}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {results.data.more ? <p className="c-s13 c-t3 m-0">Showing the first {results.data.people.length}. Type a name to find anybody else.</p> : null}
            </>
          ) : null}
        </>
      ) : (
        <>
          <p className="c-s15 c-t1 m-0">
            {bookSentence({ person, trainer, localDate: slot.localDate, startMinute: slot.startMinute, minutes, clockFormat })}
          </p>
          <p className="c-s14 c-t2 m-0">
            {bookCost(person)} {NOT_TOLD}
          </p>
          {error !== null ? (
            <p className="c-s14 c-w5 m-0" role="alert" style={{ color: 'var(--bad)' }}>
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void book()} disabled={busy} className="c-btn c-btn-p">
              {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
              Book session
            </button>
            <button
              type="button"
              onClick={() => {
                setPerson(null);
                setError(null);
              }}
              disabled={busy}
              className="c-btn c-btn-s"
            >
              Pick someone else
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** One booked session, with its Cancel and the box that asks first. */
function SessionRow({
  appointment,
  classes,
  timeOff,
  canBook,
  first,
  clockFormat,
  freeCancelMinutes,
  locked,
  asking,
  settled,
  busy,
  error,
  marking,
  markError,
  onAsk,
  onKeep,
  onCancel,
  onClose,
  onMark,
}) {
  const row = sessionRow(appointment, clockFormat);
  const clash = sessionClash(appointment, classes, timeOff, canBook);
  const box = asking ? cancelBox(appointment, { freeCancelMinutes, clockFormat }) : null;
  const mark = markRow(appointment);
  return (
    <li className="flex flex-col gap-3 py-3 min-w-0" style={first ? undefined : { borderTop: '1px solid var(--line)' }} data-testid="pt-session">
      <div className="flex items-center justify-between gap-3 min-w-0 min-h-11">
        <div className="flex flex-col min-w-0">
          <span className="c-s15 c-w6 c-t1 c-ell">
            <span className="c-num">{row.time}</span> · {row.name}
          </span>
          {row.detail === '' ? null : <span className="c-s13 c-t3 c-ell">{row.detail}</span>}
          {clash === null ? null : (
            <span className="c-s13 c-w5" style={{ color: 'var(--warn)' }}>
              {clash}
            </span>
          )}
        </div>
        {!locked && appointment.cancel !== null && !asking ? (
          <button type="button" onClick={onAsk} aria-label={`Cancel ${row.name}'s session`} className="c-btn c-btn-sm c-btn-s flex-shrink-0">
            Cancel
          </button>
        ) : null}
      </div>
      {mark !== null ? (
        // Came or no-show, once the session has started (17e-iv-b).
        <div className="flex flex-col gap-2" role="group" aria-label={`Did ${row.name} come?`} data-testid="pt-mark">
          <div className="flex flex-wrap items-center gap-2">
            {mark.tag !== null ? <span className={`c-tag c-tag-${mark.tag.tone}`}>{mark.tag.label}</span> : <span className="c-s13 c-w5 c-t2">{mark.note}</span>}
            {locked
              ? null
              : mark.actions.map((action) => (
                  <button
                    key={action.status}
                    type="button"
                    onClick={() => onMark(action.status)}
                    disabled={marking}
                    aria-label={action.aria}
                    className="c-btn c-btn-sm c-btn-s"
                  >
                    {action.label}
                  </button>
                ))}
          </div>
          {mark.tag !== null && mark.note !== '' ? <span className="c-s13 c-t3">{mark.note}</span> : null}
          {markError !== null ? (
            <p className="c-s14 c-w5 m-0" role="alert" style={{ color: 'var(--bad)' }}>
              {markError}
            </p>
          ) : null}
        </div>
      ) : null}
      {box !== null ? (
        <div className="flex flex-col gap-3" role="group" aria-label="Cancel this session">
          {settled ? null : <p className="c-s14 c-t1 m-0">{box.question}</p>}
          {settled ? null : <p className="c-s14 c-t2 m-0">{NOT_TOLD}</p>}
          {error !== null ? (
            <p className="c-s14 c-w5 m-0" role="alert" style={{ color: 'var(--bad)' }}>
              {error}
            </p>
          ) : null}
          {settled ? (
            // Somebody else has already cancelled it: nothing is left to choose.
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={onClose} className="c-btn c-btn-sm c-btn-s">
                Close
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {box.choices.map((choice) => (
                <button key={choice.key} type="button" onClick={() => onCancel(choice)} disabled={busy} className="c-btn c-btn-sm c-btn-danger">
                  {choice.label}
                </button>
              ))}
              <button type="button" onClick={onKeep} disabled={busy} className="c-btn c-btn-sm c-btn-s">
                Keep it
              </button>
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}

export default function PersonalTraining() {
  const { orgSlug } = useParams();
  const { loading: orgLoading, error: orgError, org, notFound, reload } = useConsoleOrg(orgSlug);
  const gymId = org?.id;
  const [searchParams, setSearchParams] = useSearchParams();
  const wantedTrainer = searchParams.get('trainer');

  const [list, setList] = useState(null);
  const [listFailed, setListFailed] = useState(null);
  const [listKey, setListKey] = useState(0);
  // Whose hours form is open: a member of staff's id, one at a time.
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  // Whose time off is open: a trainer's id, and never beside an hours form.
  const [timeOffFor, setTimeOffFor] = useState(null);

  // The week on screen, with the trainer and first day it is of: never drawn under another.
  // Reading the same week again (`weekKey`) keeps the one on screen until the new one arrives.
  const [from, setFrom] = useState(null);
  const [week, setWeek] = useState(null);
  const [weekKey, setWeekKey] = useState(0);
  const [booking, setBooking] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState(null);
  // The server said the session was already cancelled another way: its words stay on
  // screen until staff close the box, and only then is the week read again.
  const [cancelSettled, setCancelSettled] = useState(false);
  // Came or no-show: the session being saved, and the one whose save was refused.
  const [markBusy, setMarkBusy] = useState(null);
  const [markFailed, setMarkFailed] = useState(null);
  // The day of the week on screen that is open: one day at a time.
  const [dayWanted, setDayWanted] = useState(null);
  // A press on a trainer's name or See week: their week is brought into view once it is
  // drawn, so the press is seen to do something in a short window (Kd, 23d's click-through).
  const weekRef = useRef(null);
  const [weekAsked, setWeekAsked] = useState(0);
  useEffect(() => {
    if (weekAsked > 0) weekRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, [weekAsked]);

  useEffect(() => {
    if (gymId === undefined) return undefined;
    let live = true;
    orgService.getPtTrainers(gymId).then(
      (res) => {
        if (!live) return;
        setList(res.data);
        setListFailed(null);
      },
      (err) => {
        if (live) setListFailed(errorText(err, "We couldn't load your trainers."));
      },
    );
    return () => {
      live = false;
    };
  }, [gymId, listKey]);

  const trainer = list === null ? null : pickTrainer(list.trainers, wantedTrainer, list.canManage);
  const trainerId = trainer?.userId ?? null;
  const weekOf = `${String(trainerId)}:${String(from)}`;

  useEffect(() => {
    if (gymId === undefined || trainerId === null) return undefined;
    let live = true;
    orgService.getPtWeek(gymId, trainerId, from).then(
      (res) => {
        if (live) setWeek({ key: weekOf, data: res.data, failed: null });
      },
      (err) => {
        if (live) setWeek({ key: weekOf, data: null, failed: errorText(err, "We couldn't load that week.") });
      },
    );
    return () => {
      live = false;
    };
  }, [gymId, trainerId, from, weekOf, weekKey]);

  const readWeekAgain = () => {
    setBooking(null);
    setCancelling(null);
    setCancelError(null);
    setCancelSettled(false);
    setWeekKey((n) => n + 1);
  };

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

  const readOnly = consoleIsReadOnly(org);
  const clockFormat = org.clockFormat;
  const shownWeek = week !== null && week.key === weekOf ? week : null;
  const groups = trainerGroups(list?.trainers);
  const privileges = viewerPrivileges(org);
  // Every step to a first session, ticked as each is done (23d).
  const steps = setupSteps(list, { orgSlug, privileges, orgType: org.orgType });
  // The Calendar on a day's week, for whoever runs the timetable; null for anybody else.
  const calendarFor = (day) => (canOpenPlace(privileges, 'calendar') ? calendarTo(orgSlug, day) : null);
  // A session booked or cancelled: the week is read again, and the steps with it while
  // they are on screen, so "Book a session" ticks without a reload.
  const sessionsChanged = () => {
    readWeekAgain();
    if (steps.show) setListKey((n) => n + 1);
  };
  const editingTrainer = list?.trainers.find((t) => t.userId === editing) ?? null;
  // While somebody else is being picked or set up, the page is about them: the week of
  // the trainer shown before is put away, so nothing of theirs reads as the new person's.
  const settingUpOther = editingTrainer !== null ? editingTrainer.userId !== trainerId : adding !== '';

  const show = (userId) => {
    setEditing(null);
    setTimeOffFor(null);
    setAdding('');
    setSaveError(null);
    setFrom(null);
    setBooking(null);
    setCancelling(null);
    setSearchParams({ trainer: userId });
  };
  const seeWeek = (userId) => {
    show(userId);
    setWeekAsked((n) => n + 1);
  };
  const openHours = (userId) => {
    setSaveError(null);
    setTimeOffFor(null);
    setEditing(userId);
  };
  // Their week is shown under it, so the sessions and classes in the time off can be seen.
  const openTimeOff = (userId) => {
    if (list.canManage) show(userId);
    setEditing(null);
    setTimeOffFor(userId);
  };
  const today = list === null ? null : gymToday(list.timezone);
  const timeOffTrainer = list?.trainers.find((t) => t.userId === timeOffFor && t.sessionMinutes !== null) ?? null;
  const timeOffPanel =
    timeOffTrainer === null || today === null ? null : (
      <TimeOffPanel
        key={timeOffTrainer.userId}
        gymId={gymId}
        trainer={timeOffTrainer}
        clockFormat={org.clockFormat}
        today={today}
        locked={consoleIsReadOnly(org)}
        canBook={list.canBook}
        calendarFor={calendarFor}
        onChanged={(data) => {
          setList(data);
          readWeekAgain();
        }}
        onStale={() => {
          setListKey((n) => n + 1);
          readWeekAgain();
        }}
        onClose={() => setTimeOffFor(null)}
      />
    );

  const saveHours = async (body) => {
    setSaving(true);
    setSaveError(null);
    try {
      const saved = editing;
      const res = await orgService.savePtTrainer(gymId, saved, body);
      setList(res.data);
      // Whoever was just set up is the one whose week is shown.
      if (list.canManage) show(saved);
      setEditing(null);
      setAdding('');
      readWeekAgain();
    } catch (err) {
      setSaveError(errorText(err, "We couldn't save those hours."));
    } finally {
      setSaving(false);
    }
  };

  const cancelSession = async (appointment, choice) => {
    setCancelBusy(true);
    setCancelError(null);
    try {
      await orgService.cancelPt(gymId, appointment.id, { lateOk: choice.lateOk, giveBack: choice.giveBack });
      sessionsChanged();
    } catch (err) {
      // The free time ran out while the box was open: read the week again, so the box
      // asks the late question.
      if (err?.response?.data?.error === 'late_cancel') {
        setWeekKey((n) => n + 1);
        setCancelError("It's now too late to cancel for free. Choose again.");
      } else if (err?.response?.data?.error === 'kept_used') {
        // Already cancelled as a late cancel by somebody else: say so, and offer nothing more.
        setCancelError(errorText(err, 'This session was already cancelled as a late cancel. The session stays used.'));
        setCancelSettled(true);
      } else if (err?.response?.data?.error === 'not_kept') {
        setCancelError(errorText(err, 'This session was already cancelled, and not as a late cancel. No session was used.'));
        setCancelSettled(true);
      } else {
        setCancelError(errorText(err, "We couldn't cancel that session."));
      }
    } finally {
      setCancelBusy(false);
    }
  };

  const markSession = async (appointment, status) => {
    setMarkBusy(appointment.id);
    setMarkFailed(null);
    try {
      await orgService.markPt(gymId, appointment.id, status);
    } catch (err) {
      // Refused (cancelled meanwhile, say): the server's sentence, and the week as it now is.
      setMarkFailed({ id: appointment.id, message: errorText(err, MARK_FAILED) });
    } finally {
      setWeekKey((n) => n + 1);
      setMarkBusy(null);
    }
  };

  const hoursForm =
    editingTrainer === null ? null : (
      <HoursForm
        key={editingTrainer.userId}
        trainer={editingTrainer}
        clockFormat={clockFormat}
        saving={saving}
        error={saveError}
        onSave={(body) => void saveHours(body)}
        onClose={() => {
          setEditing(null);
          setSaveError(null);
        }}
      />
    );

  return (
    <div className="c-page">
      <header className="flex flex-col gap-1.5 min-w-0">
        <h1 className="c-h1">{PT_TITLE}</h1>
        <p className="c-sub">
          {org.name}
          {list?.timezone ? ` · ${list.timezone} time` : ''}
        </p>
        {list !== null ? <p className="c-s15 c-t2 m-0">{list.canManage ? PT_INTRO_MANAGER : PT_INTRO_OWN}</p> : null}
        {list !== null ? <BookingRulesLine org={org} orgSlug={orgSlug} privileges={privileges} of="pt" freeCancelMinutes={list.freeCancelMinutes} /> : null}
      </header>

      {readOnly ? (
        <section className="c-card p-5 md:p-6">
          <p className="c-s15 c-t2">{readOnlyNote(org.orgType)}</p>
        </section>
      ) : null}

      {list === null && listFailed === null ? <ConsoleLoading label="Loading your trainers…" newLook /> : null}
      {listFailed !== null ? <ConsoleFailed message={listFailed} onRetry={() => setListKey((n) => n + 1)} newLook /> : null}

      {steps.show ? (
        <section className="c-card p-5 md:p-6 flex flex-col gap-3" aria-label="How to set up personal training" data-testid="pt-setup">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="c-h2">How to set up personal training</h2>
            <span className="c-s14 c-t2 c-num" data-testid="pt-setup-count">
              {setupCount(steps)}
            </span>
          </div>
          <p className="c-s14 c-t2 m-0">Each step is ticked by itself once it&apos;s done.</p>
          <ol className="m-0 p-0 list-none flex flex-col">
            {steps.rows.map((row, index) => (
              <li
                key={row.key}
                data-step={row.key}
                data-done={row.done ? 'true' : 'false'}
                className="py-3 flex flex-col gap-3 md:flex-row md:items-start md:justify-between min-w-0"
                style={index === 0 ? undefined : { borderTop: '1px solid var(--line)' }}
              >
                <div className="flex items-start gap-3 min-w-0">
                  {row.done ? (
                    <CheckCircle2 aria-hidden="true" className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: 'var(--good)' }} />
                  ) : (
                    <Circle aria-hidden="true" className="w-5 h-5 flex-shrink-0 mt-0.5 c-t3" />
                  )}
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className={`c-s15 c-w6 ${row.done ? 'c-t2' : 'c-t1'}`}>
                      {`${String(index + 1)}. ${row.title}`}
                      <span className="c-w5" style={{ color: row.done ? 'var(--good)' : 'var(--t3)' }}>
                        {row.done ? ' · Done' : ' · Not done yet'}
                      </span>
                    </span>
                    <span className="c-s14 c-t2">{row.line}</span>
                  </div>
                </div>
                {row.action === null ? null : row.action.changes && readOnly ? (
                  <button type="button" disabled className="c-btn c-btn-s c-btn-sm ml-8 md:ml-0 self-start flex-shrink-0">
                    {row.action.label}
                  </button>
                ) : (
                  <PlaceLink
                    to={row.action.to}
                    className={`c-btn ${row.next ? 'c-btn-p' : 'c-btn-s'} c-btn-sm ml-8 md:ml-0 self-start flex-shrink-0`}
                  >
                    {row.action.label}
                  </PlaceLink>
                )}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {list !== null && list.canManage ? (
        <section className="c-card p-5 md:p-6 flex flex-col gap-4" aria-label="Trainers">
          <div className="flex flex-col gap-1">
            <h2 className="c-h2">Trainers</h2>
            {groups.setUp.length > 0 ? <p className="c-s14 c-t2 m-0">{HOURS_REPEAT}</p> : null}
          </div>
          {groups.setUp.length === 0 ? (
            <p className="c-s15 c-t1 c-w6 m-0" data-testid="pt-no-trainers">
              No trainers yet.
            </p>
          ) : (
            <ul className="m-0 p-0 list-none flex flex-col">
              {groups.setUp.map((t, index) => {
                const shown = !settingUpOther && trainer !== null && t.userId === trainer.userId;
                return (
                  <li
                    key={t.userId}
                    className="py-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between min-w-0"
                    style={index === 0 ? undefined : { borderTop: '1px solid var(--line)' }}
                    data-testid="pt-trainer"
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="c-s15 c-w6 c-t1 min-w-0">
                        {/* Their name opens their week, as See week does. */}
                        <button
                          type="button"
                          onClick={() => seeWeek(t.userId)}
                          className="c-btn c-btn-link"
                          // A long name wraps rather than running off a phone.
                          style={{ whiteSpace: 'normal', textAlign: 'left' }}
                          data-testid="pt-trainer-name"
                        >
                          {trainerName(t)}
                        </button>
                        {' · '}
                        <span className="c-t2 c-w5">{trainerSummary(t)}</span>
                      </span>
                      {/* Their hours on as few lines as say them, so every trainer is a short row. */}
                      {hoursBrief(t, clockFormat).length > 0 ? <span className="c-s13 c-t3 c-num">{hoursBrief(t, clockFormat).join('  ·  ')}</span> : null}
                      {timeOffSummary(t, clockFormat, today) === null ? null : (
                        <span className="c-s13 c-w5 c-t2 c-num">{timeOffSummary(t, clockFormat, today)}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                      {shown ? (
                        <span className="c-tag c-tag-soft">Week shown below</span>
                      ) : (
                        <button type="button" onClick={() => seeWeek(t.userId)} aria-label={`See ${trainerName(t)}'s week`} className="c-btn c-btn-sm c-btn-s">
                          See week
                        </button>
                      )}
                      {!readOnly ? (
                        <button type="button" onClick={() => openHours(t.userId)} aria-label={`Edit hours for ${trainerName(t)}`} className="c-btn c-btn-sm c-btn-s">
                          Edit hours
                        </button>
                      ) : null}
                      {!readOnly || (t.timeOff ?? []).length > 0 ? (
                        <button type="button" onClick={() => openTimeOff(t.userId)} aria-label={`Time off for ${trainerName(t)}`} className="c-btn c-btn-sm c-btn-s">
                          Time off
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {!readOnly && groups.others.length > 0 && editingTrainer === null && timeOffPanel === null ? (
            <div className="flex flex-col gap-2 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
              <label className="c-label" htmlFor="pt-add-trainer">
                Add a trainer
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <select id="pt-add-trainer" value={adding} onChange={(e) => setAdding(e.target.value)} className="c-input" style={{ maxWidth: 320 }}>
                  <option value="">Choose a member of staff</option>
                  {groups.others.map((t) => (
                    <option key={t.userId} value={t.userId}>
                      {trainerName(t)}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => openHours(adding)} disabled={adding === ''} className="c-btn c-btn-p">
                  Set their hours
                </button>
              </div>
              {/* Inviting staff is the owner's, on Members → Staff: nobody else is sent there. */}
              {canManageStaff(privileges) ? (
                <span className="c-s13 c-t3">
                  Only people on your staff are listed.{' '}
                  <PlaceLink to={placeFor(orgSlug, privileges, 'inviteStaff')} className="c-lk c-w6">
                    Invite staff
                  </PlaceLink>
                </span>
              ) : (
                <span className="c-s13 c-t3">Only people on your staff are listed. The owner can invite somebody new.</span>
              )}
            </div>
          ) : null}

          {hoursForm !== null ? (
            <div className="pt-4" style={{ borderTop: '1px solid var(--line)' }}>
              {hoursForm}
            </div>
          ) : null}
          {hoursForm === null && timeOffPanel !== null ? (
            <div className="pt-4" style={{ borderTop: '1px solid var(--line)' }}>
              {timeOffPanel}
            </div>
          ) : null}
        </section>
      ) : null}

      {list !== null && !list.canManage && trainer !== null ? (
        <section className="c-card p-5 md:p-6 flex flex-col gap-4" aria-label="Your hours">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="flex flex-col gap-1 min-w-0">
              <h2 className="c-h2">Your hours</h2>
              <p className="c-s14 c-t2 m-0">{trainerSummary(trainer)}</p>
              {trainer.sessionMinutes === null ? null : <p className="c-s13 c-t3 m-0">{HOURS_REPEAT_OWN}</p>}
            </div>
            {!readOnly && editingTrainer === null ? (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => openHours(trainer.userId)} className="c-btn c-btn-s w-full md:w-auto">
                  {trainer.sessionMinutes === null ? 'Set my hours' : 'Edit my hours'}
                </button>
                {trainer.sessionMinutes !== null && timeOffPanel === null ? (
                  <button type="button" onClick={() => openTimeOff(trainer.userId)} className="c-btn c-btn-s w-full md:w-auto">
                    Time off
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          {hoursForm ?? (
            <ul className="m-0 p-0 list-none flex flex-col gap-1">
              {hoursBrief(trainer, clockFormat).map((line) => (
                <li key={line} className="c-s15 c-t1 c-num">
                  {line}
                </li>
              ))}
              {timeOffSummary(trainer, clockFormat, today) === null ? null : (
                <li className="c-s14 c-w5 c-t2 c-num">{timeOffSummary(trainer, clockFormat, today)}</li>
              )}
            </ul>
          )}
          {hoursForm === null && timeOffPanel !== null ? (
            <div className="pt-4" style={{ borderTop: '1px solid var(--line)' }}>
              {timeOffPanel}
            </div>
          ) : null}
        </section>
      ) : null}

      {list !== null && trainer !== null && !settingUpOther ? (
        <section ref={weekRef} className="flex flex-col gap-4" aria-label="Sessions" style={{ scrollMarginTop: 16 }}>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h2 className="c-h2">
              {list.canManage ? `${trainerName(trainer)} · ` : ''}
              {shownWeek?.data ? weekTitle(shownWeek.data) : 'Sessions'}
            </h2>
            {shownWeek?.data ? (
              <div className="flex flex-wrap items-center gap-2">
                {/* Straight to any day: the calendar offers the days the week can show. */}
                <div className="w-full md:w-52" data-testid="pt-go-to-date">
                  <DatePick
                    label="Go to a date"
                    value={pickDay(shownWeek.data, dayWanted)}
                    min={shownWeek.data.firstDay ?? shownWeek.data.today}
                    max={shownWeek.data.lastDay}
                    today={shownWeek.data.today}
                    onChange={(date) => {
                      setBooking(null);
                      setCancelling(null);
                      setDayWanted(date);
                      // A day outside the week on screen starts the week it is read from.
                      if (date < shownWeek.data.from || date > shownWeek.data.to) setFrom(date);
                    }}
                    newLook
                    floating
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setFrom(addDays(shownWeek.data.from, -7))}
                  disabled={!canGoEarlier(shownWeek.data)}
                  className="c-btn c-btn-s"
                >
                  <ChevronLeft aria-hidden="true" className="w-4 h-4" /> {PREVIOUS_WEEK}
                </button>
                <button
                  type="button"
                  onClick={() => setFrom(addDays(shownWeek.data.from, 7))}
                  disabled={!canGoLater(shownWeek.data)}
                  className="c-btn c-btn-s"
                >
                  {NEXT_WEEK} <ChevronRight aria-hidden="true" className="w-4 h-4" />
                </button>
              </div>
            ) : null}
          </div>

          {shownWeek === null ? <ConsoleLoading label="Loading that week…" newLook /> : null}
          {shownWeek !== null && shownWeek.failed !== null ? <ConsoleFailed message={shownWeek.failed} onRetry={() => setWeekKey((n) => n + 1)} newLook /> : null}

          {shownWeek?.data ? (
            <>
              <p className="c-s13 c-t3 m-0">{pastDaysNote(shownWeek.data) ?? bookableUntil(shownWeek.data)}</p>
              {noTimesNote(shownWeek.data, trainer) !== null ? (
                <section className="c-card p-5">
                  <p className="c-s15 c-t2 m-0">{noTimesNote(shownWeek.data, trainer)}</p>
                </section>
              ) : null}
              {!list.canBook && !readOnly ? (
                <p className="c-s14 c-t2 m-0">
                  You can see and cancel these sessions. To book one, ask a manager: booking picks a person from the member list.
                </p>
              ) : null}
              {(() => {
                const openDate = pickDay(shownWeek.data, dayWanted);
                const day = shownWeek.data.days.find((d) => d.localDate === openDate);
                if (day === undefined) return null;
                const openSlot = booking !== null && booking.localDate === day.localDate ? booking : null;
                const minutes = shownWeek.data.sessionMinutes;
                const canBook = list.canBook && !readOnly && minutes !== null;
                const dayOff = day.timeOff ?? [];
                return (
                  <>
                    {/* One day at a time: the seven days across, each with what is on it. */}
                    <div className="flex gap-1.5 md:gap-2" role="group" aria-label="Days of this week" data-testid="pt-days">
                      {dayTabs(shownWeek.data).map((tab) => {
                        const on = tab.localDate === day.localDate;
                        return (
                          <button
                            key={tab.localDate}
                            type="button"
                            aria-pressed={on}
                            aria-label={tab.label}
                            onClick={() => {
                              setBooking(null);
                              setCancelling(null);
                              setDayWanted(tab.localDate);
                            }}
                            data-testid="pt-day-tab"
                            className="flex flex-col items-center justify-center gap-0.5 flex-1 min-w-0 rounded-xl border px-1 md:px-2 py-2"
                            style={{
                              minHeight: 76,
                              cursor: 'pointer',
                              background: on ? 'var(--soft)' : 'var(--card)',
                              borderColor: on ? 'var(--accent)' : 'var(--card-line)',
                            }}
                          >
                            <span className={on ? 'c-s13 c-w6 c-t1' : 'c-s13 c-w5 c-t3'}>{tab.today ? 'Today' : tab.weekday}</span>
                            <span className="c-w7 c-t1 c-num" style={{ fontSize: 20, lineHeight: '24px' }}>
                              {tab.date}
                            </span>
                            {/* All seven days fit a phone: there the note is a dot, and the day's own label says it. */}
                            <span className="hidden md:block c-s13 c-w5 c-num" style={{ color: tab.tone === 'warn' ? 'var(--warn)' : tab.tone === 'on' ? 'var(--t1)' : 'var(--t3)', minHeight: 18 }}>
                              {tab.note}
                            </span>
                            <span
                              aria-hidden="true"
                              className="md:hidden rounded-full"
                              style={{ width: 6, height: 6, background: tab.note === '' ? 'transparent' : tab.tone === 'warn' ? 'var(--warn)' : 'var(--accent)' }}
                            />
                          </button>
                        );
                      })}
                    </div>

                    <section className="c-card p-5 md:p-6 flex flex-col gap-5 min-w-0" data-testid="pt-day">
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="c-h3 m-0">{dayHeading(day.localDate, shownWeek.data.today)}</h3>
                        {dayOff.length > 0 ? (
                          <ul className="m-0 p-0 list-none flex flex-wrap gap-2" data-testid="pt-day-off">
                            {dayOff.map((o) => (
                              <li key={o.id} className="c-tag c-tag-warn c-num">
                                {dayTimeOffRow(o, clockFormat)}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>

                      <div className="grid gap-6 lg:grid-cols-2 items-start">
                        {/* What is on this day, first. */}
                        <div className="flex flex-col gap-4 min-w-0">
                          <div className="flex flex-col gap-1">
                            <span className="c-s13 c-w6 c-t3">Booked</span>
                            {day.appointments.length === 0 ? (
                              <span className="c-s15 c-t2">No sessions booked</span>
                            ) : (
                              <ul className="m-0 p-0 list-none flex flex-col">
                                {day.appointments.map((appointment, index) => (
                                  <SessionRow
                                    key={appointment.id}
                                    appointment={appointment}
                                    classes={day.classes}
                                    timeOff={dayOff}
                                    canBook={list.canBook}
                                    first={index === 0}
                                    clockFormat={clockFormat}
                                    freeCancelMinutes={shownWeek.data.freeCancelMinutes ?? list.freeCancelMinutes}
                                    locked={readOnly}
                                    asking={cancelling === appointment.id}
                                    settled={cancelling === appointment.id && cancelSettled}
                                    onClose={readWeekAgain}
                                    busy={cancelBusy}
                                    error={cancelling === appointment.id ? cancelError : null}
                                    marking={markBusy !== null}
                                    markError={markFailed?.id === appointment.id ? markFailed.message : null}
                                    onMark={(status) => void markSession(appointment, status)}
                                    onAsk={() => {
                                      setBooking(null);
                                      setCancelError(null);
                                      setCancelSettled(false);
                                      setCancelling(appointment.id);
                                    }}
                                    onKeep={() => {
                                      setCancelling(null);
                                      setCancelError(null);
                                    }}
                                    onCancel={(choice) => void cancelSession(appointment, choice)}
                                  />
                                ))}
                              </ul>
                            )}
                          </div>

                          {day.classes.length > 0 ? (
                            <div className="flex flex-col gap-1" data-testid="pt-coaching">
                              <span className="c-s13 c-w6 c-t3">Coaching a class, so not available</span>
                              <ul className="m-0 p-0 list-none flex flex-col gap-0.5">
                                {day.classes.map((coached) => (
                                  <li key={`${String(coached.localStartMinute)}:${coached.name}`} className="flex flex-col">
                                    <span className="c-s15 c-t2 c-num">{coachedClassRow(coached, clockFormat)}</span>
                                    {classInTimeOff(coached, dayOff) === null ? null : (
                                      <>
                                        <span className="c-s13 c-w5" style={{ color: 'var(--warn)' }}>
                                          {classInTimeOff(coached, dayOff, calendarFor(null) !== null)}
                                        </span>
                                        <PlaceLink to={calendarFor(day.localDate)} className="c-btn c-btn-s c-btn-sm self-start mt-1">
                                          Open the Calendar
                                        </PlaceLink>
                                      </>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </div>

                        {/* Then what can still be booked on it. */}
                        <div className="flex flex-col gap-2 min-w-0">
                          <span className="c-s13 c-w6 c-t3">{day.free.length > 0 && canBook ? 'Available times. Press one to book it.' : 'Available times'}</span>
                          {day.free.length === 0 || minutes === null ? (
                            <span className="c-s15 c-t2">No available times</span>
                          ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                              {day.free.map((minute) => {
                                const picked = openSlot !== null && openSlot.startMinute === minute;
                                const label = freeTimeLabel(minute, minutes, clockFormat);
                                return canBook ? (
                                  <button
                                    key={minute}
                                    type="button"
                                    aria-pressed={picked}
                                    aria-label={`Book ${label}`}
                                    onClick={() => {
                                      setCancelling(null);
                                      setBooking(picked ? null : { localDate: day.localDate, startMinute: minute });
                                    }}
                                    className={picked ? 'c-btn c-btn-sm c-btn-p c-num w-full' : 'c-btn c-btn-sm c-btn-s c-num w-full'}
                                  >
                                    <Plus aria-hidden="true" className="w-4 h-4" />
                                    {label}
                                  </button>
                                ) : (
                                  <span key={minute} className="c-tag c-tag-plain c-num justify-center">
                                    {label}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>

                      {openSlot !== null && minutes !== null ? (
                        <BookBox
                          key={`${openSlot.localDate}:${String(openSlot.startMinute)}`}
                          gymId={gymId}
                          trainer={trainer}
                          slot={openSlot}
                          minutes={minutes}
                          clockFormat={clockFormat}
                          orgType={org.orgType}
                          membersTo={placeFor(orgSlug, privileges, 'members')}
                          onBooked={sessionsChanged}
                          onClose={() => setBooking(null)}
                        />
                      ) : null}
                    </section>
                  </>
                );
              })()}
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
