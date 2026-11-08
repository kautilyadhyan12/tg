import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { adminService, isDoorShut } from '../../api/adminApi';
import { errorText } from '../../api/orgsApi';
import DatePick from '../../components/console/DatePick';
import { costWords, dayTotalsWords, dayWords, minutesWords, myZone, todayIn, zoneWords } from './adminView';

// EACH PERSON'S DAYS (ROADMAP Stage 2 item 14a-ii; Kd, 2026-11-08): time in the app, meal scans,
// route plans and what they cost, day by day for one person, and any day for everyone. Each day is
// the person's own, in their phone's time zone. Read again when Kd comes back to the window, as the
// phone keeps sending (CLAUDE.md §4, "Pages stay current by themselves").

/** Reads `load`, and again when the window is back in front. While it reads again, the last
 *  answer for the same `load` stays on the screen. */
function useRead(load, onShut) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ load: null, attempt: -1, error: null, data: null });
  const lastRead = useRef(0);
  useEffect(() => {
    let cancelled = false;
    lastRead.current = Date.now();
    load()
      .then((data) => {
        if (!cancelled) setState({ load, attempt, error: null, data });
      })
      .catch((err) => {
        if (cancelled) return;
        if (isDoorShut(err)) onShut();
        else setState({ load, attempt, error: errorText(err, "We couldn't load these days."), data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [load, onShut, attempt]);
  useEffect(() => {
    // Coming back can say so twice (the window's focus and the tab shown): one read is enough.
    const back = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRead.current > 2000) setAttempt((n) => n + 1);
    };
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', back);
    return () => {
      window.removeEventListener('focus', back);
      document.removeEventListener('visibilitychange', back);
    };
  }, []);
  const same = state.load === load;
  const loading = !same || state.attempt !== attempt;
  return { loading, error: same && !loading ? state.error : null, data: same ? state.data : null, reload: () => setAttempt((n) => n + 1) };
}

const cell = { padding: '10px 8px', whiteSpace: 'nowrap' };
const head = { padding: '10px 8px' };

function Problem({ text, onRetry }) {
  return (
    <div className="c-card" style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="c-s15">{text}</span>
      <button type="button" className="c-btn c-btn-s" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

/** One person's days, under their row on the people list. */
export function PersonDays({ person, onShut, onClose }) {
  const zone = myZone();
  const load = useCallback(() => adminService.personDays(person.id, { zone }), [person.id, zone]);
  const first = useRead(load, onShut);
  // Earlier pages, added below the first. Read again, the first page may start a day later (their
  // midnight passed): the earlier pages start again from it, so no day falls between them.
  const [earlierState, setEarlier] = useState({ after: null, days: [], next: undefined, loading: false, error: null });
  const earlier = earlierState.after === first.data ? earlierState : { days: [], next: undefined, loading: false, error: null };
  const next = earlier.next === undefined ? (first.data?.next ?? null) : earlier.next;
  const showEarlier = async () => {
    if (next === null) return;
    const after = first.data;
    setEarlier({ ...earlier, after, loading: true, error: null });
    try {
      const page = await adminService.personDays(person.id, { zone, before: next });
      setEarlier((e) => (e.after === after ? { after, days: [...e.days, ...page.days], next: page.next, loading: false, error: null } : e));
    } catch (err) {
      if (isDoorShut(err)) onShut();
      else setEarlier((e) => (e.after === after ? { ...e, loading: false, error: errorText(err, "We couldn't load the earlier days.") } : e));
    }
  };
  const name = person.name || person.email || 'This person';
  const days = first.data === null ? [] : [...first.data.days, ...earlier.days];

  return (
    <section aria-label={`${name}'s days`} style={{ padding: '4px 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h3 className="c-s15 c-w6" style={{ margin: 0 }}>
          {name}&apos;s days
        </h3>
        {first.data !== null ? <span className="c-hint">{zoneWords(first.data)}</span> : null}
        <span style={{ flexGrow: 1 }} />
        <button type="button" className="c-btn c-btn-quiet c-btn-sm" onClick={onClose}>
          <X size={16} aria-hidden="true" />
          Close
        </button>
      </div>
      {first.error ? <Problem text={first.error} onRetry={first.reload} /> : null}
      {first.data === null && first.loading ? <p className="c-hint" style={{ margin: 0 }}>Loading…</p> : null}
      {first.data !== null ? (
        <div className="c-card" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr className="c-th" style={{ textAlign: 'left' }}>
                <th style={head}>Day</th>
                <th style={head}>Time in the app</th>
                <th style={head}>Meal scans</th>
                <th style={head}>Route plans</th>
                <th style={head}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.day} className="c-s14" style={{ borderTop: '1px solid var(--line)' }}>
                  <td className="c-w6" style={cell}>{dayWords(d.day, first.data.today)}</td>
                  <td style={cell}>{minutesWords(d.minutes)}</td>
                  <td style={cell}>{d.mealScans}</td>
                  <td style={cell}>{d.routePlans}</td>
                  <td style={cell}>{costWords(d.costMicro)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {earlier.error ? <p role="status" className="c-s14 c-tc-warn" style={{ margin: 0 }}>{earlier.error}</p> : null}
      {first.data !== null && next !== null ? (
        <button type="button" className="c-btn c-btn-s" style={{ alignSelf: 'flex-start' }} disabled={earlier.loading} onClick={showEarlier}>
          {earlier.loading ? 'Loading…' : 'Earlier days'}
        </button>
      ) : null}
      {first.data !== null && next === null ? <p className="c-hint" style={{ margin: 0 }}>They signed up on the last day shown.</p> : null}
    </section>
  );
}

/** Any day, for everyone who used the app on it. */
export function ByDay({ onShut }) {
  const zone = myZone();
  const today = todayIn(zone);
  const [day, setDay] = useState(today);
  const load = useCallback(() => adminService.day(day, { zone }), [day, zone]);
  const first = useRead(load, onShut);
  // Read again, the first page's order may change: the pages after it start again.
  const [moreState, setMore] = useState({ after: null, people: [], next: undefined, loading: false, error: null });
  const more = moreState.after === first.data ? moreState : { people: [], next: undefined, loading: false, error: null };
  const next = more.next === undefined ? (first.data?.next ?? null) : more.next;
  const showMore = async () => {
    if (next === null) return;
    const after = first.data;
    setMore({ ...more, after, loading: true, error: null });
    try {
      const page = await adminService.day(day, { zone, from: next });
      // Somebody whose minutes arrived meanwhile can move up into a page already shown: shown once.
      setMore((m) => {
        if (m.after !== after) return m;
        const shown = new Set([...(after?.people ?? []), ...m.people].map((p) => p.id));
        return { after, people: [...m.people, ...page.people.filter((p) => !shown.has(p.id))], next: page.next, loading: false, error: null };
      });
    } catch (err) {
      if (isDoorShut(err)) onShut();
      else setMore((m) => (m.after === after ? { ...m, loading: false, error: errorText(err, "We couldn't load more people.") } : m));
    }
  };
  const people = first.data === null ? [] : [...first.data.people, ...more.people];

  return (
    <>
      <div>
        <h2 className="c-s16 c-w6" style={{ margin: 0 }}>
          By day
        </h2>
        <p className="c-hint" style={{ margin: '4px 0 0' }}>
          Everyone who used the app on one day, most time in the app first. Each day is the person&apos;s own, in their phone&apos;s time zone, or in yours until their phone has sent one.
        </p>
      </div>
      <div className="c-field" style={{ maxWidth: 260 }}>
        <span className="c-label">Day</span>
        <DatePick label="Day" value={day} max={today} today={today} onChange={(d) => setDay(d)} newLook />
      </div>
      {first.error ? <Problem text={first.error} onRetry={first.reload} /> : null}
      {first.data !== null ? (
        <p className="c-s15 c-w6" data-testid="day-totals" style={{ margin: 0 }}>
          {dayWords(first.data.day, today)}: {dayTotalsWords(first.data.totals)}
        </p>
      ) : null}
      {first.data === null && first.loading ? <p className="c-hint">Loading…</p> : null}
      {people.length > 0 ? (
        <div className="c-card" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr className="c-th" style={{ textAlign: 'left' }}>
                <th style={{ padding: '12px 16px 12px 16px' }}>Name</th>
                <th style={head}>Email</th>
                <th style={head}>Time in the app</th>
                <th style={head}>Meal scans</th>
                <th style={head}>Route plans</th>
                <th style={{ padding: '10px 16px 10px 8px' }}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id} className="c-s14" style={{ borderTop: '1px solid var(--line)' }}>
                  <td className="c-w6" style={{ padding: '10px 8px 10px 16px' }}>{p.name}</td>
                  <td style={head}>{p.email ?? 'No email'}</td>
                  <td style={cell}>{minutesWords(p.minutes)}</td>
                  <td style={cell}>{p.mealScans}</td>
                  <td style={cell}>{p.routePlans}</td>
                  <td style={{ ...cell, paddingRight: 16 }}>{costWords(p.costMicro)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {more.error ? <p role="status" className="c-s14 c-tc-warn" style={{ margin: 0 }}>{more.error}</p> : null}
      {first.data !== null && next !== null ? (
        <button type="button" className="c-btn c-btn-s" style={{ alignSelf: 'flex-start' }} disabled={more.loading} onClick={showMore}>
          {more.loading ? 'Loading…' : 'Show more'}
        </button>
      ) : null}
    </>
  );
}
