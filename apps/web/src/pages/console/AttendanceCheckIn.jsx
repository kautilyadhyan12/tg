// STAFF CHECK-IN AND THE LIVE LOG (Attendance; spec Part 3 §12.5, ROADMAP 16b-ii).
//
// Check in: staff find a person by name, member number or email and press
// Check in beside them; the answer is the desk's (green, or "Already checked in at …",
// with the gym's own status and payment words as a tag). Today's check-ins: every visit
// today, newest first, with those same words, read again when the server says a visit was
// added or removed, or a membership changed (live updates, Stage 4 item 18), and at the
// gym's midnight.
//
// Fixing a visit (ROADMAP 19a-iv): "Day they came" turns Check in into Add visit for an
// earlier day, and each of today's visits has Remove. A box names the person, the day and
// what it counts for before either happens.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { CHECKIN_LOG_LIMIT, VISIT_ADD_DAYS_BACK } from '@app/shared';
import { CalendarDays, Check, CheckCircle2, ChevronDown, Loader2, Plus, Search } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { orgService, errorText, isRetryable } from '../../api/orgsApi';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import { visitTimeLabel } from '../../components/gym/attendanceView';
import { dayLabel } from '../../components/gym/leaderboardView';
import { deskAnswer } from '../checkin/deskView';
import { foundDetails, howLine, mergeLog, newestAt, pickKey, wordsParts } from './checkinLogView';
import { stoppedLine } from './checkinRulesView';
import { gymToday } from './hoursView';
import { addVisitWindow } from './leaderboardStaffView';
import { initialsOf } from './memberListPeople';
import { msToGymMidnight, useLiveNews } from './liveNews';

const SEARCH_WAIT_MS = 250;
/** A read that failed and may clear is tried again after this, while the log is on screen. */
const RETRY_MS = 15_000;
/** While the live line cannot open, the log checks for itself this often. */
const WITHOUT_LINE_MS = 30_000;
/** News of a person or a membership changed reads the whole day again at most this often: such news
 *  can come quickly (an import, or a member saving their profile over and over), and a busy desk's
 *  reads must not use up the allowance its check-ins need. */
const GATHER_MS = 15_000;
/** A read at the gym's midnight that came back on the old day (the browser's clock ahead) is tried
 *  again after this, this many times. */
const MIDNIGHT_AGAIN_MS = 30_000;
const MIDNIGHT_TRIES = 10;
/** The longest one wait for midnight is set for: the wait is worked out again each hour, so a day
 *  that is 23 or 25 hours long at a clock change is still met at its midnight. */
const HOUR_MS = 3_600_000;

// A click anywhere on the box opens the calendar, not only its small icon.
const openCalendar = (e) => {
  try {
    e.currentTarget.showPicker();
  } catch {
    // An older browser: the box is still typed into.
  }
};

/** A box that asks opens under the row pressed and comes fully into the window, its buttons above a
 *  phone's tabs (Kd, 2026-11-27: a button a person must press is never out of sight). */
const intoSight = (el) => {
  el?.scrollIntoView?.({ block: 'nearest' });
};

/** The two buttons under a box that asks before it changes a visit. */
function BoxButtons({ label, busy, danger, onPress, onCancel }) {
  return (
    <div className="c-inbox-a">
      <button type="button" onClick={onPress} disabled={busy} className={`c-btn ${danger ? 'c-btn-d' : 'c-btn-p'} c-btn-sm`}>
        {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
        {label}
      </button>
      <button type="button" onClick={onCancel} disabled={busy} className="c-btn c-btn-s c-btn-sm">
        Cancel
      </button>
    </div>
  );
}

/** A box of the Attendance page: its title and the line under it fold the box, as the old sections
 *  did; `aside` sits at the title's end (a count). */
export function FoldBox({ title, note, aside = null, label, children }) {
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  return (
    <section className="c-card min-w-0" aria-label={label ?? title}>
      <div className="c-attend-head">
        <div className="flex flex-col gap-1 min-w-0" style={{ flex: '1 1 220px' }}>
          <h2 className="c-h3">
            <button type="button" className="c-attend-fold" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((was) => !was)}>
              <ChevronDown aria-hidden="true" className="w-4 h-4" />
              {title}
            </button>
          </h2>
          {note !== null ? <div className="pl-7">{note}</div> : null}
        </div>
        {aside}
      </div>
      {open ? (
        <div id={bodyId} className="c-attend-body">
          {children}
        </div>
      ) : null}
    </section>
  );
}

/** A person's status and payment: quiet words, and money owed as a tag. */
function Words({ words }) {
  const { quiet, owed } = wordsParts(words);
  if (quiet === '' && owed === '') return null;
  return (
    <span className="flex flex-wrap items-center gap-2">
      {quiet !== '' ? <span className="c-s14 c-t2">{quiet}</span> : null}
      {owed !== '' ? <span className="c-tag c-tag-warn">{owed}</span> : null}
    </span>
  );
}

export function CheckSomeoneIn({ gymId, words, keepsList, timezone, clearSignal, onCheckedIn, onAdded }) {
  const today = gymToday(timezone);
  const range = addVisitWindow(today);
  /** An earlier day staff picked; null follows the gym's today, past midnight too. */
  const [picked, setPicked] = useState(null);
  const day = picked !== null && picked < today ? picked : today;
  const earlier = day < today;
  /** The person an earlier day's visit is about to be added for. */
  const [adding, setAdding] = useState(null);
  const [typed, setTyped] = useState('');
  const [found, setFound] = useState({ status: 'idle', people: [], error: null, forQuery: '' });
  const [busy, setBusy] = useState(null);
  // The last answer, with the count of removals it was given under: a visit removed below
  // may be the one a green line is about, so an answer from before a removal is not drawn.
  const [said, setSaid] = useState(null);
  const setAnswer = (next) => setSaid(next === null ? null : { ...next, under: clearSignal });
  const answer = said !== null && said.under === clearSignal ? said : null;
  const asked = useRef(0);
  const input = useRef(null);
  const findId = useId();
  const dayId = useId();
  // New, in the bar across the top, opens here (`#check-in`): the box in view, ready to type.
  // Each press is a new visit (`key`), so pressing it again on the same address works too.
  const { hash, key: visit } = useLocation();
  useEffect(() => {
    if (hash !== '#check-in') return;
    input.current?.scrollIntoView?.({ block: 'center' });
    input.current?.focus();
  }, [hash, visit]);

  useEffect(() => {
    const query = typed.trim();
    if (query === '') {
      // An emptied box shows nothing (below) and drops any answer still on its way.
      asked.current += 1;
      return undefined;
    }
    const mine = ++asked.current;
    const timer = setTimeout(() => {
      void orgService
        .findCheckinPeople(gymId, query)
        .then((res) => {
          // Only the newest search's answer is shown.
          if (asked.current !== mine) return;
          setFound({ status: 'ready', people: res.data.people, error: null, forQuery: query });
        })
        .catch((err) => {
          if (asked.current !== mine) return;
          setFound({ status: 'failed', people: [], error: errorText(err, "We couldn't search just now."), forQuery: query });
        });
    }, SEARCH_WAIT_MS);
    return () => clearTimeout(timer);
  }, [gymId, typed]);

  const checkIn = (person) => {
    if (busy !== null) return;
    const key = pickKey(person.pick);
    setBusy(key);
    setAnswer(null);
    void orgService
      .staffCheckIn(gymId, person.pick)
      .then((res) => {
        setAnswer({ ...deskAnswer(res.data), name: res.data.person.name });
        setTyped('');
        onCheckedIn?.();
        input.current?.focus();
      })
      .catch((err) => {
        setAnswer({ tone: 'bad', title: errorText(err, "We couldn't check them in just now."), name: person.name, notice: null });
      })
      .finally(() => setBusy(null));
  };

  const addVisit = () => {
    if (busy !== null || adding === null) return;
    const person = adding;
    setBusy(pickKey(person.pick));
    setAnswer(null);
    void orgService
      .addVisit(gymId, person.pick, day)
      .then((res) => {
        const on = dayLabel(res.data.day);
        setAnswer({
          tone: 'good',
          title: res.data.result === 'added' ? `Visit added for ${on}` : `Already has a visit that counts on ${on}. Nothing was added.`,
          name: res.data.person.name,
          notice: null,
        });
        setAdding(null);
        setTyped('');
        onAdded?.(res.data.day);
        input.current?.focus();
      })
      .catch((err) => {
        setAnswer({ tone: 'bad', title: errorText(err, "We couldn't add that visit just now."), name: person.name, notice: null });
        setAdding(null);
      })
      .finally(() => setBusy(null));
  };

  const query = typed.trim();
  // An answer is drawn only for what is in the box now: the last search's people are never
  // on screen, with a Check in beside them, under a new one.
  const answered = query !== '' && found.forQuery === query;
  const people = answered && found.status === 'ready' ? found.people : [];
  const searching = query !== '' && !answered;

  return (
    <FoldBox
      title="Check in"
      note={<span className="c-s14 c-t2">For a {words.person} without the app or without their pass. Find them, then press Check in.</span>}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="c-field min-w-0">
          <label className="c-label" htmlFor={findId}>
            Find someone to check in
          </label>
          <div className="c-search">
            <Search aria-hidden="true" className="w-4 h-4" />
            <input
              id={findId}
              ref={input}
              type="search"
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                // An Add visit box belongs to the last search's row.
                setAdding(null);
              }}
              // A list person's email is searched only for staff who keep the list.
              placeholder={keepsList ? 'Name, member number or email' : 'Name or member number'}
              maxLength={100}
              className="c-input"
            />
          </div>
          <span className="c-s14 c-t2 flex items-center gap-2">
            {searching ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
            {keepsList ? 'Name, member number or email' : 'Name or member number'}
          </span>
        </div>
        <div className="c-field min-w-0">
          <label className="c-label" htmlFor={dayId}>
            Day they came
          </label>
          <label className="c-attend-date">
            <CalendarDays aria-hidden="true" className="w-4 h-4 flex-shrink-0" />
            <input
              id={dayId}
              type="date"
              value={day}
              min={range.min}
              max={today}
              // A date box cleared with Backspace gives '': back to today.
              onChange={(e) => {
                setPicked(e.target.value === '' || e.target.value >= today ? null : e.target.value);
                setAdding(null);
                // The last answer was about another day.
                setAnswer(null);
              }}
              onClick={openCalendar}
              aria-label="Day they came"
              className="flex-1"
            />
            <ChevronDown aria-hidden="true" className="w-4 h-4 flex-shrink-0" />
          </label>
          <span className="c-s14 c-t2">
            {earlier
              ? `${dayLabel(day)}: a missed visit is added for that day.`
              : `Today. Pick an earlier day, up to ${VISIT_ADD_DAYS_BACK} days back, to add a visit they missed.`}
          </span>
        </div>
      </div>

      {answer !== null ? (
        <div role="status" className={`c-strip ${answer.tone === 'good' ? 'c-strip-good' : 'c-strip-bad'}`}>
          {answer.tone === 'good' ? <CheckCircle2 aria-hidden="true" className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--good)' }} /> : null}
          <span className="c-strip-words">
            <span className="c-s15 c-w6">{answer.name ? `${answer.name} — ${answer.title}` : answer.title}</span>
            {answer.notice ? <span className="c-s14 c-w6" style={{ color: 'var(--warn)' }}>{answer.notice}</span> : null}
          </span>
        </div>
      ) : null}

      {answered && found.status === 'failed' ? (
        <p className="c-strip c-strip-bad c-s15" role="alert">
          {found.error}
        </p>
      ) : null}

      {answered && found.status === 'ready' && people.length === 0 ? (
        <p className="c-inbox c-s15 c-t1">Nobody on your list matches &ldquo;{found.forQuery}&rdquo;.</p>
      ) : null}

      {people.length > 0 ? (
        <ul className="flex flex-col">
          {/* While an Add visit box is open only its person is listed: nobody else can be pressed. */}
          {people.filter((person) => adding === null || pickKey(person.pick) === pickKey(adding.pick)).map((person) => {
            const key = pickKey(person.pick);
            const details = foundDetails(person);
            const stopped = stoppedLine(person);
            const asking = adding !== null && pickKey(adding.pick) === key;
            return (
              <li key={key} className="min-w-0">
                <div className="c-attend-row items-center flex-wrap">
                  <span className="c-avatar c-avatar-sm c-avatar-md" aria-hidden="true">
                    {initialsOf(person.name)}
                  </span>
                  <span className="grow" style={{ flexBasis: 200 }}>
                    <span className="c-s15 c-w6 c-t1 break-words">{person.name}</span>
                    {details !== '' ? <span className="c-s14 c-t2 break-words">{details}</span> : null}
                    <Words words={person.notice} />
                    {stopped !== '' ? <span className="c-s14 c-t1">{stopped}</span> : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (!earlier) return checkIn(person);
                      setAnswer(null);
                      return setAdding(person);
                    }}
                    disabled={busy !== null || asking}
                    aria-label={earlier ? `Add a visit for ${person.name}` : `Check in ${person.name}`}
                    className="c-btn c-btn-p c-btn-sm flex-shrink-0"
                  >
                    {busy === key ? (
                      <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />
                    ) : earlier ? (
                      <Plus aria-hidden="true" className="w-4 h-4" />
                    ) : (
                      <Check aria-hidden="true" className="w-4 h-4" />
                    )}
                    {earlier ? 'Add visit' : 'Check in'}
                  </button>
                </div>
                {/* Add visit opens under the row that was pressed (Boxes, way 1). */}
                {asking ? (
                  <div role="group" aria-label={`Add a visit for ${adding.name}`} className="c-inbox c-attend-ask flex flex-col gap-2 mb-3" ref={intoSight}>
                    <p className="c-s15 c-w6 c-t1">
                      Add a visit for {adding.name} on {dayLabel(day)}?
                    </p>
                    <p className="c-s14 c-t1">
                      {adding.name} — a visit is added for {dayLabel(day)}. It counts on the leaderboard, unless they already have a visit that day.
                    </p>
                    <p className="c-s14 c-t2">In their app, they see who added it and today&apos;s date. Nobody else&apos;s visits change.</p>
                    <BoxButtons label="Add visit" busy={busy !== null} onPress={addVisit} onCancel={() => setAdding(null)} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </FoldBox>
  );
}

export function CheckedInToday({ gymId, words, refreshSignal, canFix, onRemoved }) {
  /** The visit whose Remove box is open, and how its removal is going. */
  const [removing, setRemoving] = useState(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState(null);
  const [log, setLog] = useState({ status: 'loading', visits: [], day: null, timezone: null, clockFormat: '24h', error: null, retryable: true, stale: false });
  const held = useRef(log);
  useEffect(() => {
    held.current = log;
  }, [log]);
  const inFlight = useRef(false);
  /** A read asked for while one was on its way: 'since' or 'whole', made when that one ends. */
  const owed = useRef(null);
  /** The newest visit held and its day, noted as each answer arrives: news that comes the moment
   *  after asks from it, not from a copy the page has not drawn yet. */
  const newest = useRef({ day: null, at: null });
  const readNext = useRef(() => undefined);
  const [attempt, setAttempt] = useState(0);
  /** Why the server will not open the live line: said beside the heading until it opens. */
  const [liveRefused, setLiveRefused] = useState(null);

  const read = useCallback(
    (whole) => {
      if (inFlight.current) {
        owed.current = whole || owed.current === 'whole' ? 'whole' : 'since';
        return;
      }
      inFlight.current = true;
      const since = whole ? null : newest.current.at;
      void orgService
        .getCheckinLog(gymId, since)
        .then((res) => {
          const answer = res.data.log;
          // A whole read or a new day replaces what was held, as below; a since-read adds to it.
          const fresh = newestAt(answer.visits);
          const kept = whole || newest.current.day !== answer.day ? null : newest.current.at;
          newest.current = { day: answer.day, at: kept === null || (fresh !== null && fresh > kept) ? fresh : kept };
          setLog((prev) => {
            // A new day at the gym, or a whole read: what the server says replaces what was held.
            const replace = whole || prev.day !== answer.day;
            return {
              status: 'ready',
              visits: replace ? mergeLog([], answer.visits) : mergeLog(prev.visits, answer.visits),
              day: answer.day,
              timezone: answer.timezone,
              clockFormat: answer.clockFormat,
              error: null,
              retryable: true,
              stale: false,
            };
          });
        })
        .catch((err) => {
          // A refusal that will not clear (the tick taken away, the gym gone) ends the asking
          // and is said in the server's words; anything else is tried again on the next turn.
          const retryable = isRetryable(err);
          setLog((prev) =>
            prev.status === 'ready' && retryable
              ? { ...prev, stale: true }
              : { ...prev, status: 'failed', error: errorText(err, "We couldn't load today's check-ins."), retryable, stale: false },
          );
        })
        .finally(() => {
          inFlight.current = false;
          const next = owed.current;
          owed.current = null;
          if (next !== null) readNext.current(next === 'whole');
        });
    },
    [gymId],
  );
  useEffect(() => {
    readNext.current = read;
  }, [read]);

  /** One whole read for news of people or memberships: at once after a quiet spell, else when the
   *  15 seconds are up. */
  const lastGathered = useRef(0);
  const gatherSoon = useRef(null);
  const gatherWhole = useCallback(() => {
    if (gatherSoon.current !== null) return;
    gatherSoon.current = setTimeout(
      () => {
        gatherSoon.current = null;
        lastGathered.current = Date.now();
        readNext.current(true);
      },
      Math.max(0, lastGathered.current + GATHER_MS - Date.now()),
    );
  }, []);
  useEffect(() => () => clearTimeout(gatherSoon.current), []);

  useEffect(() => {
    read(true);
  }, [read, attempt]);

  // Live updates (Stage 4 item 18): a visit added at the desk or by staff in another window brings
  // only what is newer than the newest held; a visit removed, a membership changed (its words on a
  // row), or a person changed (a name, a record merged or deleted) brings the whole of today again,
  // as does the line opening after being away.
  useLiveNews(gymId, (message) => {
    if (message.what === 'refused') {
      setLiveRefused(message.message);
      return;
    }
    if (message.what === 'ready') setLiveRefused(null);
    if (held.current.status === 'failed') return;
    if (message.what === 'visits' && message.change === 'added') read(false);
    else if (message.what === 'people' || message.what === 'memberships') gatherWhole();
    else if (message.what !== 'leaderboard') read(true);
  });

  // The gym's day turns at its midnight: the log reads once then, so "today" is the new day. The wait
  // is worked out again each hour, so a clock change is met; a read that comes back still on the old
  // day (the browser's clock ahead of the server's) is tried again shortly, a few times.
  const [turn, setTurn] = useState(0);
  const midnight = useRef({ from: null, tries: 0 });
  useEffect(() => {
    if (log.timezone === null) return undefined;
    const atMidnight = midnight.current.from !== null && midnight.current.from === log.day && midnight.current.tries < MIDNIGHT_TRIES;
    if (midnight.current.from !== log.day) midnight.current = { from: null, tries: 0 };
    const wait = atMidnight ? MIDNIGHT_AGAIN_MS : msToGymMidnight(log.timezone);
    if (wait === null) return undefined;
    const due = atMidnight ? wait : wait + 1_000;
    const timer = setTimeout(
      () => {
        if (due > HOUR_MS) {
          setTurn((t) => t + 1);
          return;
        }
        midnight.current = { from: log.day, tries: atMidnight ? midnight.current.tries + 1 : 0 };
        read(true);
        setTurn((t) => t + 1);
      },
      Math.min(due, HOUR_MS),
    );
    return () => clearTimeout(timer);
  }, [log.day, log.timezone, turn, read]);

  // While the live line cannot open, the log checks for itself, until the line is back.
  useEffect(() => {
    if (liveRefused === null) return undefined;
    const timer = setInterval(() => {
      if (held.current.status !== 'failed') read(true);
    }, WITHOUT_LINE_MS);
    return () => clearInterval(timer);
  }, [liveRefused, read]);

  // A read that failed and may clear is tried again shortly, while the log is still shown.
  useEffect(() => {
    if (log.status !== 'ready' || !log.stale) return undefined;
    const timer = setTimeout(() => read(true), RETRY_MS);
    return () => clearTimeout(timer);
  }, [log, read]);

  useEffect(() => {
    if (refreshSignal > 0) read(false);
  }, [refreshSignal, read]);

  const removeVisit = (visit) => {
    if (removeBusy) return;
    setRemoveBusy(true);
    setRemoveError(null);
    void orgService
      .removeVisit(gymId, visit.id)
      .then(() => {
        setLog((prev) => ({ ...prev, visits: prev.visits.filter((held) => held.id !== visit.id) }));
        setRemoving(null);
        onRemoved?.();
      })
      .catch((err) => setRemoveError(errorText(err, "We couldn't remove that visit just now.")))
      .finally(() => setRemoveBusy(false));
  };

  if (log.status === 'loading') return <ConsoleLoading label="Loading today's check-ins…" newLook />;
  if (log.status === 'failed') {
    return (
      <ConsoleFailed
        newLook
        message={log.error}
        onRetry={
          log.retryable
            ? () => {
                setLog((prev) => ({ ...prev, status: 'loading' }));
                setAttempt((a) => a + 1);
              }
            : undefined
        }
      />
    );
  }

  const count = log.visits.length;
  const live = log.stale ? "Couldn't refresh — trying again" : (liveRefused ?? 'Updates as people check in');
  return (
    <FoldBox
      title="Today's check-ins"
      note={
        <span className="c-s14 c-t2 flex items-center gap-2">
          <span className={`c-dot ${log.stale || liveRefused !== null ? 'c-dot-warn' : 'c-dot-good'}`} aria-hidden="true" />
          {live}
        </span>
      }
      // Below the server's page the count is the day's; at it, the line at the foot says it is the latest.
      aside={count > 0 && count < CHECKIN_LOG_LIMIT ? <span className="c-tag c-tag-plain flex-shrink-0">{count}</span> : null}
    >
      {count === 0 ? (
        <p className="c-inbox c-s15 c-t1">
          Nobody has checked in yet today. Scans at your front desk and check-ins by staff show here as they happen.
        </p>
      ) : (
        <ul className="flex flex-col">
          {log.visits.map((visit) => {
            const name = visit.name === '' ? `A ${words.person}` : visit.name;
            const time = visitTimeLabel(visit.markedAt, log.timezone, log.clockFormat);
            const asking = removing === visit.id;
            return (
              <li key={visit.id} className="min-w-0">
                <div className="c-attend-row">
                  <span className="c-attend-tm c-s15 c-t1">{time}</span>
                  <span className="grow">
                    <span className="c-s15 c-w6 c-t1 break-words">{name}</span>
                    <span className="c-s14 c-t2">{howLine(visit)}</span>
                    <Words words={visit} />
                  </span>
                  {canFix && !asking ? (
                    <button
                      type="button"
                      onClick={() => {
                        setRemoving(visit.id);
                        setRemoveError(null);
                      }}
                      aria-label={`Remove ${name}'s ${time} check-in`}
                      className="c-btn c-btn-s c-btn-sm flex-shrink-0"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
                {/* Remove opens under the row that was pressed (Boxes, way 1). */}
                {asking ? (
                  <div role="group" aria-label={`Remove ${name}'s check-in`} className="c-inbox c-attend-ask flex flex-col gap-2 mb-3" ref={intoSight}>
                    <p className="c-s15 c-w6 c-t1">
                      Remove {name}&apos;s {time} check-in?
                    </p>
                    <p className="c-s14 c-t1">
                      {name} — this visit is removed. It no longer counts today, on the leaderboard or for their streak, unless they have
                      another visit today.
                    </p>
                    <p className="c-s14 c-t2">
                      In their app, they still see it under &ldquo;Didn&apos;t count&rdquo;, with who removed it and today&apos;s date. Nobody
                      else&apos;s visits change.
                    </p>
                    {removeError !== null ? (
                      <p className="c-s14 c-w6" role="alert" style={{ color: 'var(--bad)' }}>
                        {removeError}
                      </p>
                    ) : null}
                    <BoxButtons
                      label="Remove visit"
                      danger
                      busy={removeBusy}
                      onPress={() => removeVisit(visit)}
                      onCancel={() => {
                        setRemoving(null);
                        setRemoveError(null);
                      }}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {count >= CHECKIN_LOG_LIMIT ? (
        <p className="c-s14 c-t2">Showing the latest {CHECKIN_LOG_LIMIT}. Everyone who came today is in Check-in history for today.</p>
      ) : null}
    </FoldBox>
  );
}
