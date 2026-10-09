import { useCallback, useEffect, useState } from 'react';
import { orgWords } from '@app/shared';
import { ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import { orgService, errorStatus, errorText } from '../../api/orgsApi';
import BookingsEndBox from '../../components/console/BookingsEndBox';
import TrainerSessionsBox from '../../components/console/TrainerSessionsBox';
import ClassBookingsList from '../../components/console/ClassBookingsList';
import { ConfirmInline, ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import { bookingsAsked, endingTotal } from './bookingsEndView';
import { sessionsAsked } from './trainerSessionsView';
import { RunFields, StartTimePick } from './ClassFields';
import MemberListPerson from './MemberListPerson';
import { canRemoveMembers, viewerPrivileges } from './consoleView';
import { placeTo } from './consolePlaces';
import { addDays } from './hoursView';
import {
  canGoForward,
  classSwatch,
  dayDraft,
  dayProblem,
  dayRequest,
  filterWeek,
  peopleLine,
  replaceQuestion,
  replacesAsked,
  sessionName,
  sessionTag,
  sessionTimeLine,
  sessionWhenLine,
  weekColumns,
  weekFilterChoices,
  weekLists,
  weekTitle,
} from './classesView';

// THE CALENDAR TAB (Part 3 §13.3, §13.6). Monday to Sunday in the gym's own
// calendar: seven columns on a wide screen, a list by day on a phone. Tapping a
// class opens it: who is booked on it (17c-iii), and Edit (this class only, or this
// and future classes of its time slot) or Cancel class for that date, Un-cancel for
// a cancelled one. Drawn from
// `console.css` (spec Part 3 §17; ROADMAP R2).

const EMPTY_FILTER = { classTypeId: '', className: '', coach: '', coachLabel: '' };

const SCOPES = [
  ['this', 'This class only'],
  ['future', 'This and future classes'],
];

function DayForm({
  draft,
  setDraft,
  staff,
  clockFormat,
  saving,
  scope,
  setScope,
  offerFuture,
  question,
  endBox,
  onSave,
  onClose,
  onMove,
  onBack,
}) {
  const problem = dayProblem(draft);
  const set = (patch) => setDraft({ ...draft, ...patch });
  return (
    <div className="flex flex-col gap-5">
      {offerFuture ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Which classes to change">
          {SCOPES.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setScope(key)}
              disabled={saving}
              aria-pressed={scope === key}
              className={scope === key ? 'c-chip c-chip-on' : 'c-chip'}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      <StartTimePick
        value={draft.time}
        clockFormat={clockFormat}
        onChange={(time) => set({ time })}
        disabled={saving}
      />
      <RunFields draft={draft} set={set} staff={staff} disabled={saving} forClass={false} />
      {problem === null ? null : (
        <p className="c-s14 c-w5" style={{ color: 'var(--warn)' }}>
          {problem}
        </p>
      )}
      {endBox !== null ? (
        endBox
      ) : question !== null ? (
        <ConfirmInline
          question={question}
          confirmLabel="Move anyway"
          cancelLabel="Go back"
          busy={saving}
          newLook
          onConfirm={onMove}
          onCancel={onBack}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onSave} disabled={saving || problem !== null} className="c-btn c-btn-p">
            {saving ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
            Save
          </button>
          <button type="button" onClick={onClose} className="c-btn c-btn-ghost">
            Close
          </button>
        </div>
      )}
    </div>
  );
}

/** One date, opened. Its actions follow what the server says it is: a started
 *  class has none, a cancelled one can be un-cancelled, any other can be edited
 *  or cancelled. */
function DayPanel({ gymId, session, clockFormat, staff, locked, busy, peopleVersion, trainingTo, onOpenPerson, onClose, onChange, onCancel, onRestore }) {
  const [mode, setMode] = useState(null);
  const [draft, setDraft] = useState(() => dayDraft(session));
  const [scope, setScope] = useState('this');
  // How many classes a move from this date would replace, when the server asked.
  const [asked, setAsked] = useState(null);
  // Who is booked on the classes a cancel or a move would end, when the server asked.
  const [ending, setEnding] = useState(null);
  // Personal training sessions the class would run over, when the server asked: the
  // sessions, and the body that was sent (null for an un-cancel, which has none).
  const [over, setOver] = useState(null);
  // Saves so far: a save can move people in from the waitlist, so the list is read again.
  const [saves, setSaves] = useState(0);
  // What a save answered: done, a move to ask about, or people to ask about.
  const settle = (done) => {
    if (done === true) {
      setSaves((n) => n + 1);
      setEnding(null);
      setMode(null);
      return;
    }
    if (typeof done === 'number') setAsked(done);
    setEnding(done !== null && typeof done === 'object' ? (done.ending ?? null) : null);
  };
  // A change sent, and what it answered; a class over a trainer's sessions is kept with
  // the body that asked, so its answer is that body again with their mark.
  const send = async (body) => {
    const done = await onChange(body);
    const sessions = done !== null && typeof done === 'object' ? (done.sessions ?? null) : null;
    setOver(sessions === null ? null : { sessions, body });
    return done;
  };
  const restore = async (confirm = null) => {
    const done = await onRestore(confirm);
    const sessions = done !== null && typeof done === 'object' ? (done.sessions ?? null) : null;
    setOver(sessions === null ? null : { sessions, body: null });
  };
  const overBox =
    over === null ? null : (
      <TrainerSessionsBox
        sessions={over.sessions}
        clockFormat={clockFormat}
        kind={over.body === null ? 'uncancel' : 'save'}
        busy={busy}
        trainingTo={trainingTo}
        onCancel={() => setOver(null)}
        onConfirm={async () => {
          if (over.body === null) await restore(over.sessions.mark);
          else settle(await send({ ...over.body, confirmTrainerSessions: over.sessions.mark }));
        }}
      />
    );
  const tag = sessionTag(session);
  const name = sessionName(session, clockFormat);
  const cancelled = session.status === 'cancelled';

  return (
    <section
      className="c-card relative overflow-hidden flex flex-col gap-4 py-5 pr-5 pl-[25px] md:py-6 md:pr-6 md:pl-[29px]"
    >
      <span
        aria-hidden="true"
        className="absolute left-0 top-0 bottom-0 w-[5px]"
        style={{ background: classSwatch(session.colour) ?? 'var(--ctl-line)' }}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={cancelled ? 'c-h3 c-t2 line-through' : 'c-h3'}>{session.name}</h3>
            {tag === '' ? null : <span className={cancelled ? 'c-tag c-tag-bad' : 'c-tag c-tag-warn'}>{tag}</span>}
          </div>
          <div className="c-s14 c-t2">{sessionWhenLine(session, clockFormat)}</div>
          <div className="c-s14 c-t2">{peopleLine(session)}</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close this class" className="c-icon-btn">
          <X aria-hidden="true" className="w-[18px] h-[18px]" />
        </button>
      </div>

      {/* A cancelled class holds nobody: its bookings ended with it. */}
      {cancelled ? null : (
        <ClassBookingsList gymId={gymId} sessionId={session.id} version={`${String(saves)}-${String(peopleVersion)}`} onOpen={onOpenPerson} />
      )}

      {session.started ? (
        <p className="c-s14 c-t3">This class has started, so its time, coach and places can&apos;t be changed.</p>
      ) : locked ? null : cancelled ? (
        overBox ?? (
          <div>
            <button type="button" onClick={() => void restore()} disabled={busy} className="c-btn c-btn-soft">
              {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
              Un-cancel
            </button>
          </div>
        )
      ) : mode === 'change' ? (
        <div className="c-narrow">
          <DayForm
            draft={draft}
            setDraft={(next) => {
              setAsked(null);
              setEnding(null);
              setOver(null);
              setDraft(next);
            }}
            staff={staff}
            clockFormat={clockFormat}
            saving={busy}
            scope={scope}
            setScope={(next) => {
              setAsked(null);
              setEnding(null);
              setOver(null);
              setScope(next);
            }}
            offerFuture={typeof session.scheduleId === 'string'}
            question={asked === null ? null : replaceQuestion(asked, session.localDate)}
            endBox={
              overBox !== null ? (
                overBox
              ) : ending === null ? null : (
                <BookingsEndBox
                  gymId={gymId}
                  ending={ending}
                  scope={{ by: 'slot', id: session.scheduleId, from: session.localDate }}
                  kind="move"
                  clockFormat={clockFormat}
                  busy={busy}
                  cancelLabel="Go back"
                  onCancel={() => setEnding(null)}
                  onConfirm={async () => {
                    const body = dayRequest(draft, scope, asked, endingTotal(ending));
                    if (body !== null) settle(await send(body));
                  }}
                />
              )
            }
            onClose={() => {
              setAsked(null);
              setEnding(null);
              setOver(null);
              setMode(null);
            }}
            onSave={async () => {
              const body = dayRequest(draft, scope);
              if (body !== null) settle(await send(body));
            }}
            onMove={async () => {
              const body = dayRequest(draft, scope, asked);
              if (body === null) return;
              const done = await send(body);
              if (done === false) setAsked(null);
              settle(done);
            }}
            onBack={() => setAsked(null)}
          />
        </div>
      ) : mode === 'cancel' ? (
        <div>
          {/* It asks first, in place (Kd, 2026-09-22): nothing on this screen
              takes a class off the calendar on one tap. */}
          {ending === null ? (
            <ConfirmInline
              question={`Cancel ${name}?`}
              confirmLabel="Cancel class"
              cancelLabel="Keep it"
              busy={busy}
              newLook
              onCancel={() => setMode(null)}
              onConfirm={async () => settle(await onCancel(null))}
            />
          ) : (
            <BookingsEndBox
              gymId={gymId}
              ending={ending}
              scope={{ by: 'session', id: session.id }}
              kind="cancel"
              clockFormat={clockFormat}
              busy={busy}
              onCancel={() => {
                setEnding(null);
                setMode(null);
              }}
              onConfirm={async () => settle(await onCancel(endingTotal(ending)))}
            />
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setDraft(dayDraft(session));
              setScope('this');
              setAsked(null);
              setMode('change');
            }}
            className="c-btn c-btn-soft"
          >
            Edit
          </button>
          <button type="button" onClick={() => setMode('cancel')} className="c-btn c-btn-ghost">
            Cancel class
          </button>
        </div>
      )}
    </section>
  );
}

// `startDay`: the day whose week is shown first ('YYYY-MM-DD'); this week without one.
export default function ClassWeek({ gymId, org, readOnly, staff, locked, startDay = null }) {
  const [wanted, setWanted] = useState(startDay);
  const [week, setWeek] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  // A person opened from a class's list: their page, over the Calendar.
  const [person, setPerson] = useState(null);
  // The gym's own columns, for that page; read when the first person is opened.
  const [memberList, setMemberList] = useState(null);
  // Closing that page reads the class's list again: a membership may have been cancelled.
  const [peopleVersion, setPeopleVersion] = useState(0);

  const openPerson = (entryId) => {
    setPerson(entryId);
    if (memberList !== null) return;
    orgService.getMemberList(gymId).then(
      (res) => setMemberList(res.data.list),
      () => undefined,
    );
  };

  // The loading flag is set by the click, never inside the effect.
  const goTo = useCallback((day) => {
    setLoading(true);
    setFailed(null);
    setSelected(null);
    setActionError(null);
    setWanted(day);
    setReloadKey((n) => n + 1);
  }, []);

  useEffect(() => {
    if (gymId === undefined) return undefined;
    let live = true;
    void orgService
      .getClassWeek(gymId, wanted)
      .then((res) => {
        if (!live) return;
        setWeek(res.data);
        setLoading(false);
      })
      .catch((err) => {
        if (!live) return;
        setFailed(errorText(err, "We couldn't load this week."));
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [gymId, wanted, reloadKey]);

  const lists = weekLists(week);
  const shown = filterWeek(lists.sessions, filter);
  const columns = weekColumns(lists.weekStart, lists.today, shown);
  const choices = weekFilterChoices(lists.sessions, filter);
  const open = selected === null ? null : lists.sessions.find((s) => s.id === selected) ?? null;
  const openDay = open === null ? -1 : columns.findIndex((c) => c.date === open.localDate);
  const thisWeek = lists.today !== '' && lists.weekStart !== '' && lists.today >= lists.weekStart && lists.today <= addDays(lists.weekStart, 6);

  // True when saved; the count when a move must be asked about first, `{ ending }`
  // when people are booked on what would go, or `{ sessions }` when the class would run
  // over its coach's personal training sessions (each a question of the form's, not an
  // error); false otherwise.
  const act = async (call) => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await call();
      setWeek(res.data);
      return true;
    } catch (err) {
      const count = replacesAsked(err);
      if (count !== null) return count;
      const ending = bookingsAsked(err);
      if (ending !== null) return { ending };
      const sessions = sessionsAsked(err);
      if (sessions !== null) return { sessions };
      setActionError(errorText(err, "We couldn't save that."));
      // A refusal means the week on screen is out of date — the class started,
      // or another date now holds that time — so read it again, keeping the
      // sentence and the open day (round one, L-2).
      if (errorStatus(err) === 409) {
        try {
          const fresh = await orgService.getClassWeek(gymId, lists.weekStart);
          setWeek(fresh.data);
        } catch {
          // The sentence above already says the save failed.
        }
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 md:gap-6">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => goTo(addDays(lists.weekStart, -7))}
            disabled={loading || lists.weekStart === ''}
            aria-label="Week before"
            className="c-icon-btn c-t1"
            style={{ border: '1px solid var(--ctl-line)', width: 44, height: 44 }}
          >
            <ChevronLeft aria-hidden="true" className="w-[18px] h-[18px]" />
          </button>
          <div className="c-s16 c-w6 c-t1 c-num min-w-[11.25rem] text-center">{weekTitle(lists.weekStart)}</div>
          <button
            type="button"
            onClick={() => goTo(addDays(lists.weekStart, 7))}
            disabled={loading || !canGoForward(lists.weekStart, lists.lastWeekStart)}
            aria-label="Week after"
            className="c-icon-btn c-t1"
            style={{
              border: '1px solid var(--ctl-line)',
              width: 44,
              height: 44,
              opacity: canGoForward(lists.weekStart, lists.lastWeekStart) ? 1 : 0.35,
            }}
          >
            <ChevronRight aria-hidden="true" className="w-[18px] h-[18px]" />
          </button>
          {thisWeek || lists.weekStart === '' ? null : (
            <button type="button" onClick={() => goTo(null)} className="c-btn c-btn-link ml-2">
              Today
            </button>
          )}
        </div>

        {lists.sessions.length === 0 && filter === EMPTY_FILTER ? null : (
          <div className="grid grid-cols-2 gap-2 xl:flex xl:ml-auto">
            <select
              aria-label="Show which class"
              value={filter.classTypeId}
              onChange={(e) => {
                const choice = choices.classes.find((c) => c.value === e.target.value);
                setFilter({ ...filter, classTypeId: e.target.value, className: choice?.label ?? '' });
              }}
              className="c-input xl:!w-[200px]"
            >
              <option value="">All classes</option>
              {choices.classes.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <select
              aria-label="Show which coach"
              value={filter.coach}
              onChange={(e) => {
                const choice = choices.coaches.find((c) => c.value === e.target.value);
                setFilter({ ...filter, coach: e.target.value, coachLabel: choice?.label ?? '' });
              }}
              className="c-input xl:!w-[200px]"
            >
              <option value="">All coaches</option>
              {choices.coaches.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {actionError === null ? null : <ConsoleFailed message={actionError} newLook />}
      {loading ? <ConsoleLoading label="Loading this week…" newLook /> : null}
      {!loading && failed !== null ? (
        <ConsoleFailed message={failed} onRetry={() => goTo(wanted)} newLook />
      ) : null}

      {!loading && failed === null ? (
        <>
          {shown.length === 0 ? (
            <p className="c-s15 c-t2">{lists.sessions.length === 0 ? 'No classes this week.' : 'No classes match.'}</p>
          ) : null}
          {/* One list of days: a column each on a wide screen, stacked on a phone.
              The opened day sits right under its own day when stacked, and under
              the whole week when the days are side by side. */}
          <div className="grid grid-cols-1 lg:grid-cols-7 gap-4 lg:gap-2.5">
            {columns.map((column, index) => (
              <div
                key={column.date}
                className="flex flex-col gap-2 min-w-0"
                style={{ order: index * 2 }}
              >
                <div
                  className={column.isToday ? 'c-s13 c-w6 c-lk' : 'c-s13 c-w6 c-t3'}
                  style={{
                    padding: '0 2px 4px',
                    borderBottom: column.isToday ? '2px solid var(--accent)' : '1px solid var(--line)',
                  }}
                >
                  {column.heading}
                  {column.isToday ? ' · Today' : ''}
                </div>
                {column.sessions.length === 0 ? <div className="c-s13 c-t3 lg:hidden">No classes</div> : null}
                {column.sessions.map((s) => {
                  const cancelled = s.status === 'cancelled';
                  const tag = sessionTag(s);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setActionError(null);
                        setSelected(selected === s.id ? null : s.id);
                      }}
                      aria-pressed={selected === s.id}
                      aria-label={`${sessionName(s, lists.clockFormat)}${tag === '' ? '' : `, ${tag.toLowerCase()}`}`}
                      className="c-card text-left min-w-0 flex flex-col gap-px"
                      style={{
                        borderRadius: 10,
                        padding: '8px 10px',
                        borderLeft: `3px solid ${classSwatch(s.colour) ?? 'var(--ctl-line)'}`,
                        background: selected === s.id ? 'var(--raise)' : undefined,
                        outline: selected === s.id ? '2px solid var(--accent)' : 'none',
                        outlineOffset: -1,
                      }}
                    >
                      <span className={cancelled ? 'c-s12 c-t3 c-num' : 'c-s12 c-t2 c-num'}>
                        {sessionTimeLine(s, lists.clockFormat)}
                      </span>
                      <span className={cancelled ? 'c-s14 c-w6 c-t2 c-ell line-through' : 'c-s14 c-w6 c-t1 c-ell'}>
                        {s.name}
                      </span>
                      <span className="c-s12 c-t3 c-ell">{peopleLine(s)}</span>
                      {tag === '' ? null : (
                        <span className="c-s12 c-w6" style={{ color: cancelled ? 'var(--bad)' : 'var(--warn)' }}>
                          {tag}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
            {open === null ? null : (
              <div className="lg:col-span-7 lg:!order-last" style={{ order: openDay * 2 + 1 }}>
                <DayPanel
                  /* Keyed on the date, so a half-typed change never carries
                     from one day to another. */
                  key={open.id}
                  gymId={gymId}
                  session={open}
                  clockFormat={lists.clockFormat}
                  trainingTo={placeTo(org?.slug, 'personalTraining')}
                  staff={staff}
                  locked={locked}
                  busy={busy}
                  peopleVersion={peopleVersion}
                  onOpenPerson={openPerson}
                  onClose={() => setSelected(null)}
                  onChange={(body) => act(() => orgService.changeClassDay(gymId, open.id, body))}
                  onCancel={(confirmBookings) =>
                    act(() =>
                      confirmBookings === null
                        ? orgService.cancelClassDay(gymId, open.id)
                        : orgService.cancelClassDay(gymId, open.id, confirmBookings),
                    )
                  }
                  onRestore={(confirm) => act(() => orgService.restoreClassDay(gymId, open.id, confirm))}
                />
              </div>
            )}
          </div>
        </>
      ) : null}

      {person === null ? null : (
        <MemberListPerson
          key={person}
          gymId={gymId}
          gym={org}
          entryId={person}
          list={memberList}
          words={orgWords(org?.orgType)}
          readOnly={readOnly}
          canRemove={canRemoveMembers(viewerPrivileges(org))}
          onClose={() => {
            setPerson(null);
            setPeopleVersion((n) => n + 1);
          }}
          onChanged={() => setPeopleVersion((n) => n + 1)}
        />
      )}
    </div>
  );
}
