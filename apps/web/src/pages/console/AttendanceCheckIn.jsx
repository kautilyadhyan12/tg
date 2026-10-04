// STAFF CHECK-IN AND THE LIVE LOG (Attendance; spec Part 3 §12.5, ROADMAP 16b-ii).
//
// "Check someone in": staff find a person by name, member number or email and press
// Check in beside them; the answer is the desk's (green, or "Already checked in at …",
// with the gym's own status and payment words in orange). "Checked in today": every visit
// today, newest first, with those same words, asked again every 5 seconds while the page
// is in view.
//
// Fixing a visit (ROADMAP 19a-iv): "Day they came" turns Check in into Add visit for an
// earlier day, and each of today's visits has Remove. A box names the person, the day and
// what it counts for before either happens.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CHECKIN_LOG_LIMIT, CHECKIN_LOG_POLL_MS, VISIT_ADD_DAYS_BACK } from '@app/shared';
import { Check, Loader2, Search } from 'lucide-react';
import { orgService, errorText, isRetryable } from '../../api/orgsApi';
import { ConsoleCard, ConsoleFailed, ConsoleLoading, ConsoleSection } from '../../components/console/ConsoleStates';
import { visitTimeLabel } from '../../components/gym/attendanceView';
import { dayLabel } from '../../components/gym/leaderboardView';
import { deskAnswer } from '../checkin/deskView';
import { foundDetails, howLine, mergeLog, newestAt, pickKey, wordsLine } from './checkinLogView';
import { gymToday } from './hoursView';
import { addVisitWindow } from './leaderboardStaffView';

const SEARCH_WAIT_MS = 250;

const muted = { color: 'rgba(255,255,255,0.55)' };
const ORANGE = '#FFB347';

// A click anywhere on the box opens the calendar, not only its small icon.
const openCalendar = (e) => {
  try {
    e.currentTarget.showPicker();
  } catch {
    // An older browser: the box is still typed into.
  }
};

/** The two buttons under a box that asks before it changes a visit. */
function BoxButtons({ label, busy, danger, onPress, onCancel }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <button
        type="button"
        onClick={onPress}
        disabled={busy}
        className="rounded-xl px-3.5 py-2 text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-40"
        style={danger ? { background: 'rgba(239,68,68,0.18)', color: '#f87171' } : { background: '#FF8A1F', color: '#0b0a09' }}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        {label}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="rounded-xl px-3.5 py-2 text-sm font-semibold disabled:opacity-40"
        style={{ background: 'rgba(255,255,255,0.07)', color: '#fff' }}
      >
        Cancel
      </button>
    </div>
  );
}

const boxStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' };

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
    <ConsoleCard>
      <h2 className="text-base font-semibold" style={{ color: '#fff' }}>
        Check someone in
      </h2>
      <p className="text-sm mt-1" style={muted}>
        For a {words.person} without the app or without their pass. Find them, then press Check in.
      </p>

      <label className="mt-3 flex flex-wrap items-center gap-2 text-sm" style={{ color: '#fff' }}>
        Day they came
        <input
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
          className="rounded-lg px-2 py-1 text-sm cursor-pointer"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', color: '#fff', colorScheme: 'dark' }}
        />
        <span className="text-xs" style={muted}>
          {earlier
            ? `${dayLabel(day)}: a missed visit is added for that day.`
            : `Today. Pick an earlier day, up to ${VISIT_ADD_DAYS_BACK} days back, to add a visit they missed.`}
        </span>
      </label>

      <label
        className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2"
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)' }}
      >
        <Search className="w-4 h-4 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.45)' }} />
        <input
          ref={input}
          type="search"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          // A list person's email is searched only for staff who keep the list.
          placeholder={keepsList ? 'Name, member number or email' : 'Name or member number'}
          aria-label="Find someone to check in"
          maxLength={100}
          className="flex-1 bg-transparent text-sm outline-none"
          style={{ color: '#fff' }}
        />
        {searching ? <Loader2 className="w-4 h-4 animate-spin" style={muted} /> : null}
      </label>

      {answer !== null ? (
        <div
          role="status"
          className="mt-3 rounded-xl px-3 py-2.5"
          style={{
            background: answer.tone === 'good' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
            border: `1px solid ${answer.tone === 'good' ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}`,
          }}
        >
          <p className="text-sm font-semibold" style={{ color: answer.tone === 'good' ? '#4ade80' : '#f87171' }}>
            {answer.name ? `${answer.name} — ${answer.title}` : answer.title}
          </p>
          {answer.notice ? (
            <p className="text-sm mt-0.5" style={{ color: ORANGE }}>
              {answer.notice}
            </p>
          ) : null}
        </div>
      ) : null}

      {answered && found.status === 'failed' ? (
        <p className="text-sm mt-3" style={{ color: '#f87171' }}>
          {found.error}
        </p>
      ) : null}

      {answered && found.status === 'ready' && people.length === 0 ? (
        <p className="text-sm mt-3" style={muted}>
          Nobody on your list matches &ldquo;{found.forQuery}&rdquo;.
        </p>
      ) : null}

      {adding !== null ? (
        <div role="group" aria-label={`Add a visit for ${adding.name}`} className="mt-3 rounded-xl px-3 py-3" style={boxStyle}>
          <p className="text-sm font-semibold" style={{ color: '#fff' }}>
            Add a visit for {adding.name} on {dayLabel(day)}?
          </p>
          <p className="text-sm mt-1" style={muted}>
            {adding.name} — a visit is added for {dayLabel(day)}. It counts as a gym day on the leaderboard, unless they already have a visit that day.
          </p>
          <p className="text-sm mt-1" style={muted}>
            In their app, they see who added it and today&apos;s date. Nobody else&apos;s visits change.
          </p>
          <BoxButtons label="Add visit" busy={busy !== null} onPress={addVisit} onCancel={() => setAdding(null)} />
        </div>
      ) : null}

      {people.length > 0 && adding === null ? (
        <ul className="mt-2 flex flex-col">
          {people.map((person) => {
            const key = pickKey(person.pick);
            const details = foundDetails(person);
            const notice = wordsLine(person.notice);
            return (
              <li
                key={key}
                className="flex items-center gap-3 py-2.5"
                style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium truncate" style={{ color: '#fff' }}>
                    {person.name}
                  </span>
                  {details !== '' ? (
                    <span className="block text-xs truncate" style={{ color: 'rgba(255,255,255,0.45)' }}>
                      {details}
                    </span>
                  ) : null}
                  {notice !== '' ? (
                    <span className="block text-xs truncate" style={{ color: ORANGE }}>
                      {notice}
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (!earlier) return checkIn(person);
                    setAnswer(null);
                    return setAdding(person);
                  }}
                  disabled={busy !== null}
                  aria-label={earlier ? `Add a visit for ${person.name}` : `Check in ${person.name}`}
                  className="rounded-xl px-3.5 py-2 text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-40 flex-shrink-0"
                  style={{ background: '#FF8A1F', color: '#0b0a09' }}
                >
                  {busy === key ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {earlier ? 'Add visit' : 'Check in'}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </ConsoleCard>
  );
}

/** Whether the page is in view: a hidden tab asks nothing. */
function pageVisible() {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
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
  const [attempt, setAttempt] = useState(0);

  const read = useCallback(
    (whole) => {
      if (inFlight.current) return;
      inFlight.current = true;
      const since = whole ? null : newestAt(held.current.visits);
      void orgService
        .getCheckinLog(gymId, since)
        .then((res) => {
          const answer = res.data.log;
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
              : { ...prev, status: 'failed', error: errorText(err, "We couldn't load today's check-ins."), retryable },
          );
        })
        .finally(() => {
          inFlight.current = false;
        });
    },
    [gymId],
  );

  useEffect(() => {
    read(true);
    const timer = setInterval(() => {
      if (pageVisible() && held.current.status !== 'failed') read(false);
    }, CHECKIN_LOG_POLL_MS);
    // Back in view after a while: the whole of today again, not a gap.
    const onVisible = () => {
      if (pageVisible()) read(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [read, attempt]);

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

  if (log.status === 'loading') return <ConsoleLoading label="Loading today's check-ins…" />;
  if (log.status === 'failed') {
    return (
      <ConsoleFailed
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
  return (
    <ConsoleSection title="Checked in today" aside={log.stale ? "Couldn't refresh — trying again" : 'Updates every few seconds'} defaultOpen>
      {count === 0 ? (
        <p className="text-sm mt-1" style={muted}>
          Nobody has checked in yet today. Scans at your front desk and check-ins by staff show here as they happen.
        </p>
      ) : (
        <ul className="mt-1 flex flex-col">
          {log.visits.map((visit) => {
            const notice = wordsLine(visit);
            const name = visit.name === '' ? `A ${words.person}` : visit.name;
            const time = visitTimeLabel(visit.markedAt, log.timezone, log.clockFormat);
            if (removing === visit.id) {
              return (
                <li key={visit.id} className="py-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <div role="group" aria-label={`Remove ${name}'s check-in`} className="rounded-xl px-3 py-3" style={boxStyle}>
                    <p className="text-sm font-semibold" style={{ color: '#fff' }}>
                      Remove {name}&apos;s {time} check-in?
                    </p>
                    <p className="text-sm mt-1" style={muted}>
                      {name} — this visit is removed. It no longer counts as a visit today, on the leaderboard or for their streak,
                      unless they have another visit today.
                    </p>
                    <p className="text-sm mt-1" style={muted}>
                      In their app, they still see it under &ldquo;Didn&apos;t count&rdquo;, with who removed it and today&apos;s date.
                      Nobody else&apos;s visits change.
                    </p>
                    {removeError !== null ? (
                      <p className="text-sm mt-2" role="alert" style={{ color: '#f87171' }}>
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
                </li>
              );
            }
            return (
              <li key={visit.id} className="flex items-baseline gap-3 py-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <span className="text-xs w-16 flex-shrink-0 tabular-nums" style={{ color: ORANGE }}>
                  {time}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium truncate" style={{ color: '#fff' }}>
                    {name}
                  </span>
                  <span className="block text-xs truncate" style={{ color: 'rgba(255,255,255,0.45)' }}>
                    {howLine(visit)}
                  </span>
                  {notice !== '' ? (
                    <span className="block text-xs truncate" style={{ color: ORANGE }}>
                      {notice}
                    </span>
                  ) : null}
                </span>
                {canFix ? (
                  <button
                    type="button"
                    onClick={() => {
                      setRemoving(visit.id);
                      setRemoveError(null);
                    }}
                    aria-label={`Remove ${name}'s ${time} check-in`}
                    className="text-xs font-semibold underline flex-shrink-0"
                    style={{ color: 'rgba(255,255,255,0.65)' }}
                  >
                    Remove
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {count >= CHECKIN_LOG_LIMIT ? (
        <p className="text-xs mt-2" style={{ color: 'rgba(255,255,255,0.35)' }}>
          Showing the latest {CHECKIN_LOG_LIMIT}. Everyone who came today is in the day list for today.
        </p>
      ) : null}
    </ConsoleSection>
  );
}
