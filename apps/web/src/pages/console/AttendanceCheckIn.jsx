// STAFF CHECK-IN AND THE LIVE LOG (Attendance; spec Part 3 §12.5, ROADMAP 16b-ii).
//
// "Check someone in": staff find a person by name, member number or email and press
// Check in beside them; the answer is the desk's (green, or "Already checked in at …",
// with the gym's own status and payment words in orange). "Checked in today": every visit
// today, newest first, asked again every 5 seconds while the page is in view.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CHECKIN_LOG_LIMIT, CHECKIN_LOG_POLL_MS } from '@app/shared';
import { Check, Loader2, Search } from 'lucide-react';
import { orgService, errorText, isRetryable } from '../../api/orgsApi';
import { ConsoleCard, ConsoleFailed, ConsoleLoading, ConsoleSection } from '../../components/console/ConsoleStates';
import { visitTimeLabel } from '../../components/gym/attendanceView';
import { deskAnswer } from '../checkin/deskView';
import { foundDetails, howLine, mergeLog, newestAt, pickKey } from './checkinLogView';

const SEARCH_WAIT_MS = 250;

const muted = { color: 'rgba(255,255,255,0.55)' };
const ORANGE = '#FFB347';

export function CheckSomeoneIn({ gymId, words, onCheckedIn }) {
  const [typed, setTyped] = useState('');
  const [found, setFound] = useState({ status: 'idle', people: [], error: null, forQuery: '' });
  const [busy, setBusy] = useState(null);
  const [answer, setAnswer] = useState(null);
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
      setFound((held) => ({ ...held, status: 'loading' }));
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

  const query = typed.trim();
  const people = query !== '' && (found.status === 'ready' || found.status === 'loading') ? found.people : [];

  return (
    <ConsoleCard>
      <h2 className="text-base font-semibold" style={{ color: '#fff' }}>
        Check someone in
      </h2>
      <p className="text-sm mt-1" style={muted}>
        For a {words.person} without the app or without their pass. Find them, then press Check in.
      </p>

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
          placeholder="Name, member number or email"
          aria-label="Find someone to check in"
          maxLength={100}
          className="flex-1 bg-transparent text-sm outline-none"
          style={{ color: '#fff' }}
        />
        {query !== '' && found.status === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" style={muted} /> : null}
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

      {query !== '' && found.status === 'failed' ? (
        <p className="text-sm mt-3" style={{ color: '#f87171' }}>
          {found.error}
        </p>
      ) : null}

      {found.status === 'ready' && people.length === 0 && query !== '' ? (
        <p className="text-sm mt-3" style={muted}>
          Nobody on your list matches &ldquo;{found.forQuery}&rdquo;.
        </p>
      ) : null}

      {people.length > 0 ? (
        <ul className="mt-2 flex flex-col">
          {people.map((person) => {
            const key = pickKey(person.pick);
            const details = foundDetails(person);
            const notice = [person.notice?.status, person.notice?.payment].filter((w) => typeof w === 'string' && w.trim() !== '');
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
                  {notice.length > 0 ? (
                    <span className="block text-xs truncate" style={{ color: ORANGE }}>
                      {notice.join(' · ')}
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => checkIn(person)}
                  disabled={busy !== null}
                  aria-label={`Check in ${person.name}`}
                  className="rounded-xl px-3.5 py-2 text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-40 flex-shrink-0"
                  style={{ background: '#FF8A1F', color: '#0b0a09' }}
                >
                  {busy === key ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Check in
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

export function CheckedInToday({ gymId, words, refreshSignal }) {
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
          setLog((prev) =>
            prev.status === 'ready'
              ? { ...prev, stale: true }
              : { ...prev, status: 'failed', error: errorText(err, "We couldn't load today's check-ins."), retryable: isRetryable(err) },
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
          {log.visits.map((visit) => (
            <li key={visit.id} className="flex items-baseline gap-3 py-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <span className="text-xs w-16 flex-shrink-0 tabular-nums" style={{ color: ORANGE }}>
                {visitTimeLabel(visit.markedAt, log.timezone, log.clockFormat)}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium truncate" style={{ color: '#fff' }}>
                  {visit.name === '' ? `A ${words.person}` : visit.name}
                </span>
                <span className="block text-xs truncate" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  {howLine(visit)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {count >= CHECKIN_LOG_LIMIT ? (
        <p className="text-xs mt-2" style={{ color: 'rgba(255,255,255,0.35)' }}>
          Showing the latest {CHECKIN_LOG_LIMIT}. Everyone who came is in the day list below.
        </p>
      ) : null}
    </ConsoleSection>
  );
}
