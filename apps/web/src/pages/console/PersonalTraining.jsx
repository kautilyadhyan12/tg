import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Loader2, Plus, Search, X } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import TimePick from '../../components/console/TimePick';
import { Tick } from './ClassFields';
import { useConsoleOrg } from './useConsoleOrg';
import { consoleIsReadOnly, readOnlyNote } from './billingView';
import { WEEKDAYS, addDays } from './hoursView';
import {
  NOT_TOLD,
  PT_INTRO_MANAGER,
  PT_INTRO_OWN,
  PT_TITLE,
  SESSION_LENGTH_HINT,
  SESSION_LENGTH_USUAL,
  addRange,
  bookCost,
  bookSentence,
  canAddRange,
  canGoEarlier,
  canGoLater,
  cancelBox,
  dayHeading,
  freeTimeLabel,
  hoursDraft,
  hoursFormProblem,
  hoursLines,
  hoursRequest,
  noTimesNote,
  peopleHeading,
  personRow,
  pickTrainer,
  removeRange,
  sessionRow,
  sessionsAWeek,
  setRange,
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
        <span className="c-label">Hours they train, on {`the gym's`} clock</span>
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
                    <Plus aria-hidden="true" className="w-4 h-4" /> Add hours
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

/** The box that books one free time: pick the person from the list, see who and when,
 *  press Book. The list is there without typing; typing narrows it. */
function BookBox({ gymId, trainer, slot, minutes, clockFormat, onBooked, onClose }) {
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
        orgService.getPtPeople(gymId, query).then(
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
  }, [gymId, query]);

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
              <span className="c-s13 c-w6 c-t3">{peopleHeading(results.data, typed)}</span>
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
function SessionRow({ appointment, first, clockFormat, freeCancelMinutes, locked, asking, busy, error, onAsk, onKeep, onCancel }) {
  const row = sessionRow(appointment, clockFormat);
  const box = asking ? cancelBox(appointment, { freeCancelMinutes, clockFormat }) : null;
  return (
    <li className="flex flex-col gap-3 py-3 min-w-0" style={first ? undefined : { borderTop: '1px solid var(--line)' }} data-testid="pt-session">
      <div className="flex items-center justify-between gap-3 min-w-0 min-h-11">
        <div className="flex flex-col min-w-0">
          <span className="c-s15 c-w6 c-t1 c-ell">
            <span className="c-num">{row.time}</span> · {row.name}
          </span>
          {row.detail === '' ? null : <span className="c-s13 c-t3 c-ell">{row.detail}</span>}
        </div>
        {!locked && appointment.cancel !== null && !asking ? (
          <button type="button" onClick={onAsk} aria-label={`Cancel ${row.name}'s session`} className="c-btn c-btn-sm c-btn-s flex-shrink-0">
            Cancel
          </button>
        ) : null}
      </div>
      {box !== null ? (
        <div className="flex flex-col gap-3" role="group" aria-label="Cancel this session">
          <p className="c-s14 c-t1 m-0">{box.question}</p>
          <p className="c-s14 c-t2 m-0">{NOT_TOLD}</p>
          {error !== null ? (
            <p className="c-s14 c-w5 m-0" role="alert" style={{ color: 'var(--bad)' }}>
              {error}
            </p>
          ) : null}
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

  // The week on screen, with the trainer and first day it is of: never drawn under another.
  // Reading the same week again (`weekKey`) keeps the one on screen until the new one arrives.
  const [from, setFrom] = useState(null);
  const [week, setWeek] = useState(null);
  const [weekKey, setWeekKey] = useState(0);
  const [booking, setBooking] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState(null);

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
  const editingTrainer = list?.trainers.find((t) => t.userId === editing) ?? null;

  const show = (userId) => {
    setFrom(null);
    setBooking(null);
    setCancelling(null);
    setSearchParams({ trainer: userId });
  };
  const openHours = (userId) => {
    setSaveError(null);
    setEditing(userId);
  };

  const saveHours = async (body) => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await orgService.savePtTrainer(gymId, editing, body);
      setList(res.data);
      // Whoever was just set up is the one whose week is shown.
      if (list.canManage) show(editing);
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
      readWeekAgain();
    } catch (err) {
      // The free time ran out while the box was open: read the week again, so the box
      // asks the late question.
      if (err?.response?.data?.error === 'late_cancel') {
        setWeekKey((n) => n + 1);
        setCancelError("It's now too late to cancel for free. Choose again.");
      } else {
        setCancelError(errorText(err, "We couldn't cancel that session."));
      }
    } finally {
      setCancelBusy(false);
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
      </header>

      {readOnly ? (
        <section className="c-card p-5 md:p-6">
          <p className="c-s15 c-t2">{readOnlyNote(org.orgType)}</p>
        </section>
      ) : null}

      {list === null && listFailed === null ? <ConsoleLoading label="Loading your trainers…" newLook /> : null}
      {listFailed !== null ? <ConsoleFailed message={listFailed} onRetry={() => setListKey((n) => n + 1)} newLook /> : null}

      {list !== null && list.canManage ? (
        <section className="c-card p-5 md:p-6 flex flex-col gap-4" aria-label="Trainers">
          <h2 className="c-h2">Trainers</h2>
          {groups.setUp.length === 0 ? (
            <p className="c-s15 c-t2 m-0">No trainers yet. Choose who takes personal training sessions, then set their hours.</p>
          ) : (
            <ul className="m-0 p-0 list-none flex flex-col">
              {groups.setUp.map((t, index) => {
                const shown = trainer !== null && t.userId === trainer.userId;
                return (
                  <li
                    key={t.userId}
                    className="py-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between min-w-0"
                    style={index === 0 ? undefined : { borderTop: '1px solid var(--line)' }}
                    data-testid="pt-trainer"
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="c-s15 c-w6 c-t1 c-ell">
                        {trainerName(t)} · <span className="c-t2 c-w5">{trainerSummary(t)}</span>
                      </span>
                      {hoursLines(t, clockFormat).map((line) => (
                        <span key={line} className="c-s13 c-t3">
                          {line}
                        </span>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                      {shown ? (
                        <span className="c-tag c-tag-soft">Week shown below</span>
                      ) : (
                        <button type="button" onClick={() => show(t.userId)} aria-label={`See ${trainerName(t)}'s week`} className="c-btn c-btn-sm c-btn-s">
                          See week
                        </button>
                      )}
                      {!readOnly ? (
                        <button type="button" onClick={() => openHours(t.userId)} aria-label={`Edit hours for ${trainerName(t)}`} className="c-btn c-btn-sm c-btn-s">
                          Edit hours
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {!readOnly && groups.others.length > 0 && editingTrainer === null ? (
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
              <span className="c-s13 c-t3">Only people on your staff are listed. Invite somebody new in Settings, under Staff.</span>
            </div>
          ) : null}

          {hoursForm !== null ? (
            <div className="pt-4" style={{ borderTop: '1px solid var(--line)' }}>
              {hoursForm}
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
            </div>
            {!readOnly && editingTrainer === null ? (
              <button type="button" onClick={() => openHours(trainer.userId)} className="c-btn c-btn-s w-full md:w-auto">
                {trainer.sessionMinutes === null ? 'Set my hours' : 'Edit my hours'}
              </button>
            ) : null}
          </div>
          {hoursForm ?? (
            <ul className="m-0 p-0 list-none flex flex-col gap-1">
              {hoursLines(trainer, clockFormat).map((line) => (
                <li key={line} className="c-s15 c-t1">
                  {line}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {list !== null && trainer !== null ? (
        <section className="flex flex-col gap-4" aria-label="Sessions">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h2 className="c-h2">
              {list.canManage ? `${trainerName(trainer)} · ` : ''}
              {shownWeek?.data ? weekTitle(shownWeek.data) : 'Sessions'}
            </h2>
            {shownWeek?.data ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFrom(addDays(shownWeek.data.from, -7))}
                  disabled={!canGoEarlier(shownWeek.data)}
                  className="c-btn c-btn-sm c-btn-s"
                >
                  <ChevronLeft aria-hidden="true" className="w-4 h-4" /> Earlier
                </button>
                <button
                  type="button"
                  onClick={() => setFrom(addDays(shownWeek.data.from, 7))}
                  disabled={!canGoLater(shownWeek.data)}
                  className="c-btn c-btn-sm c-btn-s"
                >
                  Later <ChevronRight aria-hidden="true" className="w-4 h-4" />
                </button>
              </div>
            ) : null}
          </div>

          {shownWeek === null ? <ConsoleLoading label="Loading that week…" newLook /> : null}
          {shownWeek !== null && shownWeek.failed !== null ? <ConsoleFailed message={shownWeek.failed} onRetry={() => setWeekKey((n) => n + 1)} newLook /> : null}

          {shownWeek?.data ? (
            <>
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
              <div className="grid gap-4 xl:grid-cols-2 items-start">
                {shownWeek.data.days.map((day) => {
                  const openSlot = booking !== null && booking.localDate === day.localDate ? booking : null;
                  const minutes = shownWeek.data.sessionMinutes;
                  const canBook = list.canBook && !readOnly && minutes !== null;
                  // A day with nothing on it and nothing to book is one line, so a week reads at a glance.
                  if (day.appointments.length === 0 && day.free.length === 0) {
                    return (
                      <section key={day.localDate} className="c-card px-5 py-3 flex items-center justify-between gap-3 min-w-0" data-testid="pt-day">
                        <h3 className="c-s15 c-w6 c-t2 m-0">{dayHeading(day.localDate, shownWeek.data.today)}</h3>
                        <span className="c-s13 c-t3">No free times</span>
                      </section>
                    );
                  }
                  return (
                    <section key={day.localDate} className="c-card p-5 flex flex-col gap-4 min-w-0" data-testid="pt-day">
                      <h3 className="c-h3 m-0">{dayHeading(day.localDate, shownWeek.data.today)}</h3>

                      {day.appointments.length > 0 ? (
                        <div className="flex flex-col gap-1">
                          <span className="c-s13 c-w6 c-t3">Booked</span>
                          <ul className="m-0 p-0 list-none flex flex-col">
                            {day.appointments.map((appointment, index) => (
                              <SessionRow
                                key={appointment.id}
                                appointment={appointment}
                                first={index === 0}
                                clockFormat={clockFormat}
                                freeCancelMinutes={list.freeCancelMinutes}
                                locked={readOnly}
                                asking={cancelling === appointment.id}
                                busy={cancelBusy}
                                error={cancelling === appointment.id ? cancelError : null}
                                onAsk={() => {
                                  setBooking(null);
                                  setCancelError(null);
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
                        </div>
                      ) : null}

                      {day.free.length > 0 && minutes !== null ? (
                        <div className="flex flex-col gap-2">
                          <span className="c-s13 c-w6 c-t3">{canBook ? 'Free times. Press one to book it.' : 'Free times'}</span>
                          <div className="flex flex-wrap gap-2">
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
                                  className={picked ? 'c-btn c-btn-sm c-btn-p c-num' : 'c-btn c-btn-sm c-btn-s c-num'}
                                >
                                  <Plus aria-hidden="true" className="w-4 h-4" />
                                  {label}
                                </button>
                              ) : (
                                <span key={minute} className="c-tag c-tag-plain c-num">
                                  {label}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}

                      {openSlot !== null && minutes !== null ? (
                        <BookBox
                          key={`${openSlot.localDate}:${String(openSlot.startMinute)}`}
                          gymId={gymId}
                          trainer={trainer}
                          slot={openSlot}
                          minutes={minutes}
                          clockFormat={clockFormat}
                          onBooked={readWeekAgain}
                          onClose={() => setBooking(null)}
                        />
                      ) : null}
                    </section>
                  );
                })}
              </div>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
