import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { adminService, isDoorShut } from '../../api/adminApi';
import { errorText } from '../../api/orgsApi';
import DatePick from '../../components/console/DatePick';
import { ADMIN_TABLE, costWords, dayTotalsWords, dayWords, minutesWords, myZone, todayIn, usedGroups, usedWords, zoneWords } from './adminView';

// EACH PERSON'S DAYS (ROADMAP Stage 2 item 14a-ii; Kd, 2026-11-08): time in the app, meal scans,
// route plans and what they cost, day by day for one person, and any day for everyone. Each day is
// the person's own, in their phone's time zone. Pressing a day, or a name on By day, opens what they
// used that day by feature, under it (14a-iii; Kd, 2026-11-17): counts only, never what it was. Read again when Kd comes back to the window, as the
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

/** What one person used on one day, feature by feature, under the row that was pressed (14a-iii). Its
 *  table scrolls sideways on a narrow screen: the box stays at the left, no wider than the card the
 *  table sits in (`ADMIN_TABLE`) less `inset`, the boxes between them, so its features stack there
 *  instead of running off it. */
function DayUse({ title, numbers, onClose, inset }) {
  return (
    <section
      aria-label={title}
      style={{ position: 'sticky', left: 0, boxSizing: 'border-box', maxWidth: `calc(100cqw - ${String(inset)}px)`, padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h4 className="c-s15 c-w6" style={{ margin: 0 }}>
          {title}
        </h4>
        <span className="c-s14">Time in the app: {minutesWords(numbers.minutes)}</span>
        <span style={{ flexGrow: 1 }} />
        <button type="button" className="c-btn c-btn-quiet c-btn-sm" onClick={onClose}>
          <X size={16} aria-hidden="true" />
          Close
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(210px, 100%), 1fr))', gap: 10 }}>
        {usedGroups(numbers).map((g) => (
          <div key={g.feature} className="c-card" style={{ padding: 12 }}>
            <h5 className="c-s14 c-w6" style={{ margin: '0 0 6px' }}>
              {g.feature}
            </h5>
            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 12px' }}>
              {g.lines.map(([label, n]) => (
                <Fragment key={label}>
                  <dt className="c-s14 c-t2">{label}</dt>
                  <dd className="c-s14 c-w6" style={{ margin: 0 }}>
                    {n}
                  </dd>
                </Fragment>
              ))}
            </dl>
          </div>
        ))}
      </div>
      <p className="c-hint" style={{ margin: 0 }}>
        Meal scans counts every scan made, saved or not, as their limit does. A meal, run, workout or measurement counts on the day it was saved.
      </p>
    </section>
  );
}

/** A name or a day that opens its box under its row. */
function Opens({ open, label, onToggle, children }) {
  return (
    <button type="button" className="c-btn c-btn-link" aria-expanded={open} aria-label={label} onClick={onToggle} style={{ gap: 4, whiteSpace: 'nowrap' }}>
      {children}
      <ChevronDown size={16} aria-hidden="true" style={open ? { transform: 'rotate(180deg)' } : undefined} />
    </button>
  );
}

/** One person's days, under their row on the people list. */
export function PersonDays({ person, onShut, onClose }) {
  const zone = myZone();
  const load = useCallback(() => adminService.personDays(person.id, { zone }), [person.id, zone]);
  const first = useRead(load, onShut);
  // Earlier pages, added below the first, belong to where the first page ends. Read again, it ends a
  // day later once their midnight has passed, or in another zone once their phone sends from one: the
  // earlier pages start again from it, so no day falls between them or is cut twice; otherwise they
  // stay open.
  const [earlierState, setEarlier] = useState({ after: undefined, zone: undefined, days: [], next: undefined, loading: false, error: null });
  const same = earlierState.after === first.data?.next && earlierState.zone === first.data?.zone;
  const earlier = same ? earlierState : { days: [], next: undefined, loading: false, error: null };
  const next = earlier.next === undefined ? (first.data?.next ?? null) : earlier.next;
  const showEarlier = async () => {
    if (next === null) return;
    const after = first.data?.next;
    const cut = first.data?.zone;
    const mine = (e) => e.after === after && e.zone === cut;
    setEarlier({ ...earlier, after, zone: cut, loading: true, error: null });
    try {
      // Cut in the first page's zone, so a day is never shown twice when their phone moves zone.
      const page = await adminService.personDays(person.id, { zone, before: next, dayZone: cut });
      setEarlier((e) => (mine(e) ? { after, zone: cut, days: [...e.days, ...page.days], next: page.next, loading: false, error: null } : e));
    } catch (err) {
      if (isDoorShut(err)) onShut();
      else setEarlier((e) => (mine(e) ? { ...e, loading: false, error: errorText(err, "We couldn't load the earlier days.") } : e));
    }
  };
  const name = person.name || person.email || 'This person';
  const days = first.data === null ? [] : [...first.data.days, ...earlier.days];
  const [openDay, setOpenDay] = useState(null);

  return (
    // At the left of the people's table and no wider than its card: on a phone, somebody who scrolled the
    // table across to press Days still sees their days.
    <section
      aria-label={`${name}'s days`}
      style={{ position: 'sticky', left: 0, boxSizing: 'border-box', maxWidth: '100cqw', padding: '4px 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h3 className="c-s15 c-w6" style={{ margin: 0 }}>
          {name}&apos;s days
        </h3>
        {first.data !== null ? <span className="c-hint">{zoneWords(first.data, zone)}</span> : null}
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
                <th style={head}>Features used</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => {
                const when = dayWords(d.day, first.data.today);
                const open = openDay === d.day;
                return (
                  <Fragment key={d.day}>
                    <tr className="c-s14" style={{ borderTop: '1px solid var(--line)' }}>
                      <td className="c-w6" style={{ padding: '4px 8px' }}>
                        <Opens open={open} label={`${name}, ${when}`} onToggle={() => setOpenDay(open ? null : d.day)}>
                          {when}
                        </Opens>
                      </td>
                      <td style={cell}>{minutesWords(d.minutes)}</td>
                      <td style={cell}>{d.mealScans}</td>
                      <td style={cell}>{d.routePlans}</td>
                      <td style={cell}>{costWords(d.costMicro)}</td>
                      <td style={cell}>{usedWords(d)}</td>
                    </tr>
                    {open ? (
                      <tr>
                        <td colSpan={6} style={{ background: 'var(--card)' }}>
                          <DayUse title={`${name}, ${when}`} numbers={d} inset={34} onClose={() => setOpenDay(null)} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
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
  const [opened, setOpened] = useState(null);
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
          Everyone who used the app on one day, most time in the app first. Each day is the person&apos;s own, in their phone&apos;s time zone, or in yours until their phone has sent one. Press a name to see what they used that day.
        </p>
      </div>
      <div className="c-field" style={{ maxWidth: 260 }}>
        <span className="c-label">Day</span>
        <DatePick label="Day" value={day} max={today} today={today} onChange={(d) => { setDay(d); setOpened(null); }} newLook />
      </div>
      {first.error ? <Problem text={first.error} onRetry={first.reload} /> : null}
      {first.data !== null ? (
        <p className="c-s15 c-w6" data-testid="day-totals" style={{ margin: 0 }}>
          {dayWords(first.data.day, today)}: {dayTotalsWords(first.data.totals)}
        </p>
      ) : null}
      {first.data === null && first.loading ? <p className="c-hint">Loading…</p> : null}
      {people.length > 0 ? (
        <div className="c-card" style={ADMIN_TABLE}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr className="c-th" style={{ textAlign: 'left' }}>
                <th style={{ padding: '12px 16px 12px 16px' }}>Name</th>
                <th style={head}>Email</th>
                <th style={head}>Time in the app</th>
                <th style={head}>Meal scans</th>
                <th style={head}>Route plans</th>
                <th style={head}>Cost</th>
                <th style={{ padding: '10px 16px 10px 8px' }}>Features used</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const name = p.name || p.email || 'This person';
                const open = opened === p.id;
                return (
                  <Fragment key={p.id}>
                    <tr className="c-s14" style={{ borderTop: '1px solid var(--line)' }}>
                      <td className="c-w6" style={{ padding: '4px 8px 4px 16px' }}>
                        <Opens open={open} label={`${name}, ${dayWords(first.data.day, today)}`} onToggle={() => setOpened(open ? null : p.id)}>
                          {p.name}
                        </Opens>
                      </td>
                      <td style={head}>{p.email ?? 'No email'}</td>
                      <td style={cell}>{minutesWords(p.minutes)}</td>
                      <td style={cell}>{p.mealScans}</td>
                      <td style={cell}>{p.routePlans}</td>
                      <td style={cell}>{costWords(p.costMicro)}</td>
                      <td style={{ ...cell, paddingRight: 16 }}>{usedWords(p)}</td>
                    </tr>
                    {open ? (
                      <tr>
                        <td colSpan={7} style={{ background: 'var(--raise)' }}>
                          <DayUse title={`${name}, ${dayWords(first.data.day, today)}`} numbers={p} inset={0} onClose={() => setOpened(null)} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
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
      {first.data !== null && next === null && people.length < first.data.totals.people ? (
        <div role="status" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="c-s14">The list changed while you were reading it.</span>
          <button type="button" className="c-btn c-btn-s c-btn-sm" onClick={first.reload}>
            Read again
          </button>
        </div>
      ) : null}
    </>
  );
}
