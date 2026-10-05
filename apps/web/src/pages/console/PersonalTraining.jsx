import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Loader2, Plus, Search, X } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import TimePick from '../../components/console/TimePick';
import { Field, Tick } from './ClassFields';
import { useConsoleOrg } from './useConsoleOrg';
import { consoleIsReadOnly, readOnlyNote } from './billingView';
import { WEEKDAYS, addDays, clockLabel } from './hoursView';
import {
  NOT_TOLD,
  PT_TITLE,
  SESSION_LENGTH_CHOICES,
  addRange,
  bookSentence,
  canAddRange,
  canGoEarlier,
  canGoLater,
  cancelBox,
  dayHeading,
  hoursDraft,
  hoursFormProblem,
  hoursLines,
  hoursRequest,
  noTimesNote,
  personQuery,
  personRow,
  pickTrainer,
  removeRange,
  sessionRow,
  sessionsAWeek,
  setRange,
  timeRange,
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
      <Tick checked={draft.offers} onChange={(on) => setDraft({ ...draft, offers: on })} disabled={saving}>
        Takes personal training sessions
      </Tick>

      <div className="c-narrow">
        <Field label="Session length">
          <select
            value={draft.sessionMinutes}
            onChange={(e) => setDraft({ ...draft, sessionMinutes: e.target.value })}
            disabled={saving}
            className="c-input"
          >
            {SESSION_LENGTH_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </Field>
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
                  <button type="button" onClick={() => setDraft(addRange(draft, day.iso))} disabled={saving} className="c-btn-link c-s14 c-w6">
                    <Plus aria-hidden="true" className="w-4 h-4 inline" /> Add hours
                  </button>
                ) : null}
              </div>
              {ranges.length === 0 ? <span className="c-s14 c-t3">No sessions</span> : null}
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

      {problem === null ? <p className="c-s14 c-t2 m-0">{draft.offers ? `These hours make ${sessionsAWeek(draft)}.` : 'No new sessions can be booked.'} Sessions already booked stay as they are.</p> : null}
      {problem !== null ? (
        <p className="c-s14 c-w5 m-0" style={{ color: 'var(--warn)' }}>
          {problem}
        </p>
      ) : null}
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

/** The box that books one free time: find the person, see who and when, press Book. */
function BookBox({ gymId, trainer, slot, minutes, clockFormat, onBooked, onClose }) {
  const [typed, setTyped] = useState('');
  const [found, setFound] = useState(null);
  const [person, setPerson] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // One key a box: pressing Book twice, or again after a lost answer, books once.
  const requestKey = useRef(crypto.randomUUID());

  const query = personQuery(typed);
  useEffect(() => {
    if (query === null) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      orgService.getMemberListEntries(gymId, query).then(
        (res) => {
          if (live) setFound({ query, entries: res.data.page.entries, total: res.data.page.total, failed: null });
        },
        (err) => {
          if (live) setFound({ query, entries: [], total: 0, failed: errorText(err, "We couldn't search your member list.") });
        },
      );
    }, 250);
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
          Book {trainerName(trainer)} · {dayHeading(slot.localDate, null)} · {timeRange(slot.startMinute, slot.startMinute + minutes, clockFormat)}
        </h3>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="c-btn c-btn-sm c-btn-ghost">
          <X aria-hidden="true" className="w-4 h-4" />
        </button>
      </div>

      {person === null ? (
        <>
          <label className="c-field">
            <span className="c-label">Who is it for? Search your member list</span>
            <span className="relative block">
              <Search aria-hidden="true" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 c-t3" />
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="Name, email or phone"
                className="c-input"
                style={{ paddingLeft: 36 }}
                autoFocus
              />
            </span>
          </label>
          {query !== null && results === null ? <p className="c-s14 c-t3 m-0">Searching…</p> : null}
          {results !== null && results.failed !== null ? <p className="c-s14 c-t2 m-0">{results.failed}</p> : null}
          {results !== null && results.failed === null && results.entries.length === 0 ? (
            <p className="c-s14 c-t2 m-0">Nobody on your member list matches. Add them on Members first.</p>
          ) : null}
          {results !== null && results.entries.length > 0 ? (
            <ul className="m-0 p-0 list-none flex flex-col" style={{ maxHeight: 280, overflowY: 'auto' }}>
              {results.entries.slice(0, 20).map((entry) => {
                const row = personRow(entry);
                return (
                  <li key={entry.entryId} className="c-row">
                    <button type="button" onClick={() => setPerson(entry)} className="w-full text-left min-h-11 flex flex-col justify-center min-w-0">
                      <span className="c-s15 c-w6 c-t1 c-ell">{row.name}</span>
                      {row.detail === '' ? null : <span className="c-s13 c-t3 c-ell">{row.detail}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {results !== null && results.total > 20 ? <p className="c-s13 c-t3 m-0">Showing the first 20 of {results.total}. Type more to narrow it down.</p> : null}
        </>
      ) : (
        <>
          <p className="c-s15 c-t1 m-0">
            {bookSentence({ person, trainer, localDate: slot.localDate, startMinute: slot.startMinute, minutes, clockFormat })}
          </p>
          <p className="c-s14 c-t2 m-0">
            If they have a pack that includes personal training, one session is used. {NOT_TOLD}
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
function SessionRow({ appointment, clockFormat, freeCancelMinutes, locked, asking, busy, error, onAsk, onKeep, onCancel }) {
  const row = sessionRow(appointment, clockFormat);
  const box = asking ? cancelBox(appointment, { freeCancelMinutes, clockFormat }) : null;
  return (
    <li className="c-row flex flex-col gap-3" data-testid="pt-session">
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="flex flex-col min-w-0">
          <span className="c-s15 c-w6 c-t1 c-ell">
            <span className="c-num">{row.time}</span> · {row.name}
          </span>
          {row.detail === '' ? null : <span className="c-s13 c-t3 c-ell">{row.detail}</span>}
        </div>
        {!locked && appointment.cancel !== null && !asking ? (
          <button type="button" onClick={onAsk} className="c-btn-link c-s14 c-w6 flex-shrink-0">
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
  const [editing, setEditing] = useState(false);
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

  const trainer = list === null ? null : pickTrainer(list.trainers, wantedTrainer);
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

  const readWeekAgain = useCallback(() => {
    setBooking(null);
    setCancelling(null);
    setCancelError(null);
    setWeekKey((n) => n + 1);
  }, []);

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

  const pick = (userId) => {
    setEditing(false);
    setSaveError(null);
    setFrom(null);
    setBooking(null);
    setCancelling(null);
    setSearchParams({ trainer: userId });
  };

  const saveHours = async (body) => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await orgService.savePtTrainer(gymId, trainer.userId, body);
      setList(res.data);
      setEditing(false);
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

  return (
    <div className="c-page">
      <header className="flex flex-col gap-1.5 min-w-0">
        <h1 className="c-h1">{PT_TITLE}</h1>
        <p className="c-sub">
          {org.name}
          {list?.timezone ? ` · ${list.timezone} time` : ''}
        </p>
      </header>

      {readOnly ? (
        <section className="c-card p-5 md:p-6">
          <p className="c-s15 c-t2">{readOnlyNote(org.orgType)}</p>
        </section>
      ) : null}

      {list === null && listFailed === null ? <ConsoleLoading label="Loading your trainers…" newLook /> : null}
      {listFailed !== null ? <ConsoleFailed message={listFailed} onRetry={() => setListKey((n) => n + 1)} newLook /> : null}

      {list !== null && trainer !== null ? (
        <>
          {list.canManage && list.trainers.length > 1 ? (
            <div className="c-narrow">
              <Field label="Trainer">
                <select value={trainer.userId} onChange={(e) => pick(e.target.value)} className="c-input">
                  {list.trainers.map((t) => (
                    <option key={t.userId} value={t.userId}>
                      {trainerName(t)} · {trainerSummary(t)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          ) : null}

          <section className="c-card p-5 md:p-6 flex flex-col gap-4" aria-label="Hours">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="flex flex-col gap-1 min-w-0">
                <h2 className="c-h2">{trainerName(trainer)}</h2>
                <p className="c-s14 c-t2 m-0">{trainerSummary(trainer)}</p>
              </div>
              {!readOnly && !editing ? (
                <button type="button" onClick={() => setEditing(true)} className="c-btn c-btn-s w-full md:w-auto">
                  {trainer.sessionMinutes === null ? 'Set hours' : 'Edit hours'}
                </button>
              ) : null}
            </div>
            {editing ? (
              <HoursForm
                key={trainer.userId}
                trainer={trainer}
                clockFormat={clockFormat}
                saving={saving}
                error={saveError}
                onSave={(body) => void saveHours(body)}
                onClose={() => {
                  setEditing(false);
                  setSaveError(null);
                }}
              />
            ) : (
              <ul className="m-0 p-0 list-none flex flex-col gap-1">
                {hoursLines(trainer, clockFormat).map((line) => (
                  <li key={line} className="c-s15 c-t1">
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-4" aria-label="Sessions">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <h2 className="c-h2">{shownWeek?.data ? weekTitle(shownWeek.data) : 'Sessions'}</h2>
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
                    return (
                      <section key={day.localDate} className="c-card p-5 flex flex-col gap-4 min-w-0" data-testid="pt-day">
                        <h3 className="c-h3 m-0">{dayHeading(day.localDate, shownWeek.data.today)}</h3>

                        {day.appointments.length > 0 ? (
                          <ul className="m-0 p-0 list-none flex flex-col">
                            {day.appointments.map((appointment) => (
                              <SessionRow
                                key={appointment.id}
                                appointment={appointment}
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
                        ) : null}

                        <div className="flex flex-col gap-2">
                          <span className="c-s13 c-w6 c-t3">
                            {day.free.length === 0 ? 'No free times' : day.free.length === 1 ? '1 free time' : `${String(day.free.length)} free times`}
                          </span>
                          {day.free.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {day.free.map((minute) => {
                                const picked = openSlot !== null && openSlot.startMinute === minute;
                                const label = clockLabel(minute, clockFormat);
                                return list.canBook && !readOnly ? (
                                  <button
                                    key={minute}
                                    type="button"
                                    aria-pressed={picked}
                                    aria-label={`Book ${label}`}
                                    onClick={() => {
                                      setCancelling(null);
                                      setBooking(picked ? null : { localDate: day.localDate, startMinute: minute });
                                    }}
                                    className={picked ? 'c-chip c-chip-on c-num' : 'c-chip c-num'}
                                  >
                                    {label}
                                  </button>
                                ) : (
                                  <span key={minute} className="c-tag c-tag-plain c-num">
                                    {label}
                                  </span>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>

                        {openSlot !== null && shownWeek.data.sessionMinutes !== null ? (
                          <BookBox
                            key={`${openSlot.localDate}:${String(openSlot.startMinute)}`}
                            gymId={gymId}
                            trainer={trainer}
                            slot={openSlot}
                            minutes={shownWeek.data.sessionMinutes}
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
        </>
      ) : null}
    </div>
  );
}
