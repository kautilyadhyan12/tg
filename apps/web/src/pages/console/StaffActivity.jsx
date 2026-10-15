import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { staffActivityService } from '../../api/staffActivityApi';
import { errorText } from '../../api/orgsApi';
import DatePick from '../../components/console/DatePick';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import { gymToday } from './hoursView';
import { WHEN_CHOICES, addDays, emptyWords, groupByDay, noStaffYet, whenRange, workerChoices } from './staffActivityView';

// THE STAFF ACTIVITY TAB (ROADMAP 4d; Kd, RULINGS 2026-09-25): which worker did what and
// when, newest first, for the owner. Who and when are kept in the address, so a staff
// member's "See activity" opens it already on them, and a reload stays where it was.

/** `filters`: { worker, when, day } from the address; `onFilters` writes them back. */
export default function StaffActivity({ gymId, timezone, clockFormat, filters, onFilters, onInviteStaff }) {
  // The page read for one who-and-when (`key`); a different key is still loading.
  const [state, setState] = useState({ key: null, error: null, page: null, lines: [] });
  const [more, setMore] = useState({ busy: false, error: null });
  const [attempt, setAttempt] = useState(0);
  // The gym's own today, for the days the time choices ask for; the server's answer says
  // its own for the headings.
  const today = gymToday(timezone);
  const worker = filters.worker ?? null;
  const when = WHEN_CHOICES.some((c) => c.value === filters.when) ? filters.when : 'any';
  const range = whenRange(when, filters.day ?? null, today);
  // A picked day waits for the day itself before it asks.
  const waiting = when === 'day' && range === null;
  const from = range?.from ?? null;
  const to = range?.to ?? null;
  const key = `${gymId}|${worker ?? ''}|${from ?? ''}|${to ?? ''}|${String(attempt)}`;

  useEffect(() => {
    if (waiting) return undefined;
    let live = true;
    staffActivityService.list(gymId, { worker, from, to, after: null }).then(
      (page) => live && setState({ key, error: null, page, lines: page.lines }),
      (err) => live && setState({ key, error: errorText(err, "We couldn't load staff activity."), page: null, lines: [] }),
    );
    return () => {
      live = false;
    };
  }, [gymId, worker, from, to, waiting, key]);

  const showMore = (after) => {
    setMore({ busy: true, error: null });
    staffActivityService.list(gymId, { worker, from, to, after }).then(
      (page) => {
        setState((was) => (was.key !== key ? was : { ...was, page, lines: [...was.lines, ...page.lines] }));
        setMore({ busy: false, error: null });
      },
      (err) => setMore({ busy: false, error: errorText(err, "We couldn't load more. Try again.") }),
    );
  };
  const loading = !waiting && state.key !== key;

  const set = (change) => onFilters({ worker, when, day: filters.day ?? null, ...change });
  const page = loading ? null : state.page;
  const people = page === null ? { current: [], former: [] } : workerChoices(page.workers);
  const filtered = worker !== null || when !== 'any';
  const groups = page === null ? [] : groupByDay(state.lines, page.today, clockFormat);
  const empty = emptyWords(filtered);

  return (
    <section className="flex flex-col gap-4" aria-label="Staff activity">
      <p className="c-s14 c-t2 m-0">What each person on your staff did in the console, newest first.</p>

      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <label className="c-field md:w-[260px]">
          <span className="c-label">Who</span>
          <select className="c-sel" value={worker ?? ''} onChange={(e) => set({ worker: e.target.value === '' ? null : e.target.value })}>
            <option value="">Everyone</option>
            {people.current.map((w) => (
              <option key={w.userId} value={w.userId}>
                {w.name}
              </option>
            ))}
            {people.former.length > 0 ? (
              <optgroup label="No longer on staff">
                {people.former.map((w) => (
                  <option key={w.userId} value={w.userId}>
                    {w.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </label>
        <label className="c-field md:w-[200px]">
          <span className="c-label">When</span>
          <select className="c-sel" value={when} onChange={(e) => set({ when: e.target.value, day: e.target.value === 'day' ? (filters.day ?? null) : null })}>
            {WHEN_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        {when === 'day' ? (
          <div className="c-field">
            <span className="c-label">Day</span>
            <DatePick newLook label="Day" value={filters.day ?? ''} max={today} today={today} yearSelect min={addDays(today, -730)} emptyText="Choose a day" onChange={(day) => set({ day })} />
          </div>
        ) : null}
      </div>

      {page !== null && noStaffYet(page.workers) ? (
        <div className="c-card p-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between" data-testid="activity-no-staff">
          <span className="c-s14 c-t2">You have no staff yet. When you add them, what each of them does is listed here.</span>
          <button type="button" className="c-btn c-btn-s c-btn-sm self-start md:self-auto" onClick={onInviteStaff}>
            Invite staff
          </button>
        </div>
      ) : null}

      {loading ? <ConsoleLoading label="Loading staff activity…" newLook /> : null}
      {!loading && state.error !== null ? <ConsoleFailed message={state.error} onRetry={() => setAttempt((n) => n + 1)} newLook /> : null}

      {page !== null && state.lines.length === 0 ? (
        <div className="c-card p-5 flex flex-col gap-3" data-testid="activity-empty">
          <p className="c-s15 c-t1 m-0">{empty.line}</p>
          {empty.clear ? (
            <button type="button" className="c-btn c-btn-s self-start" onClick={() => onFilters({ worker: null, when: 'any', day: null })}>
              Show everything
            </button>
          ) : null}
        </div>
      ) : null}

      {groups.length > 0 ? (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <section key={group.day} className="c-card overflow-hidden" aria-label={group.heading}>
              <h3 className="c-s14 c-t2 m-0 px-4 pt-3 pb-2" style={{ fontWeight: 600 }}>
                {group.heading}
              </h3>
              <ul className="m-0 p-0" style={{ listStyle: 'none' }}>
                {group.lines.map((line) => (
                  <li key={line.id} className="px-4 py-3 flex flex-col gap-0.5 md:flex-row md:gap-4" style={{ borderTop: '1px solid var(--line)' }} data-testid="activity-line">
                    <span className="c-s14 c-t3 c-num md:w-[80px] md:flex-shrink-0">{line.time}</span>
                    <span className="c-s15 c-t1">
                      <span style={{ fontWeight: 600 }}>{line.worker}</span>
                      <span className="c-t3"> · </span>
                      {line.line}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}

      {page !== null && page.next !== null ? (
        <div className="flex flex-col gap-2">
          <button type="button" className="c-btn c-btn-s self-start" disabled={more.busy} onClick={() => showMore(page.next)}>
            {more.busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
            Show more
          </button>
          {more.error !== null ? (
            <p className="c-s14 m-0" style={{ color: 'var(--bad)' }} role="alert">
              {more.error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
