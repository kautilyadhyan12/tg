import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import { orgService, errorStatus, errorText } from '../../api/orgsApi';
import { ConfirmInline, ConsoleCard, ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import TimePick from '../../components/console/TimePick';
import { RunFields } from './ClassFields';
import { inputStyle, labelStyle } from './classStyles';
import { addDays } from './hoursView';
import {
  canGoForward,
  classSwatch,
  dayDraft,
  dayProblem,
  dayRequest,
  filterWeek,
  sessionName,
  sessionPeopleLine,
  sessionTag,
  sessionTimeLine,
  weekColumns,
  weekFilterChoices,
  weekLists,
  weekTitle,
} from './classesView';

// THE WEEK VIEW — the Classes page's Week tab (Part 3 §13.3, §13.6; ROADMAP
// 17b-ii-b-i). Monday to Sunday in the gym's own calendar: seven columns on a
// wide screen, a list by day on a phone. Tapping a class opens it, and staff
// change or cancel THAT DAY only.
//
// A day changed on its own keeps what staff gave it when its repeat is changed
// later; a cancelled day stays on the week crossed out, with "Put it back on".
// Moving a repeat to another day or time from a date is 17b-ii-b-ii.

const EMPTY_FILTER = { classTypeId: '', className: '', coach: '', coachLabel: '' };

function DayForm({ draft, setDraft, staff, clockFormat, saving, onSave, onClose }) {
  const problem = dayProblem(draft);
  const set = (patch) => setDraft({ ...draft, ...patch });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-wider" style={labelStyle}>
          Starts at
        </span>
        <TimePick
          label="Class start"
          kind="opens"
          value={draft.time}
          clockFormat={clockFormat}
          onChange={(time) => set({ time })}
          disabled={saving}
        />
      </div>
      <RunFields draft={draft} set={set} staff={staff} disabled={saving} forClass={false} />
      <p className="text-xs" style={labelStyle}>
        Only this date changes. Later changes to its repeat leave it as you set it here.
      </p>
      {problem === null ? null : (
        <p className="text-sm" style={{ color: '#FBBF24' }}>
          {problem}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={saving || problem !== null}
          className="rounded-xl px-4 py-2 text-sm font-medium inline-flex items-center gap-2"
          style={{
            background: 'rgba(255,138,31,0.15)',
            color: '#FF8A1F',
            opacity: saving || problem !== null ? 0.5 : 1,
          }}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Save this day
        </button>
        <button type="button" onClick={onClose} className="text-sm" style={labelStyle}>
          Don&apos;t change it
        </button>
      </div>
    </div>
  );
}

/** ONE DATE, OPENED. Its actions follow what the server says it is: a started
 *  date has none, a cancelled one can be put back, a running one can be changed
 *  or cancelled. */
function DayPanel({ session, clockFormat, staff, locked, busy, onClose, onChange, onCancel, onRestore }) {
  const [mode, setMode] = useState(null);
  const [draft, setDraft] = useState(() => dayDraft(session));
  const tag = sessionTag(session);
  const name = sessionName(session, clockFormat);
  const cancelled = session.status === 'cancelled';

  return (
    <ConsoleCard>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div
            className="text-sm font-medium"
            style={{ color: '#fff', textDecoration: cancelled ? 'line-through' : 'none' }}
          >
            {name}
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.65)' }}>
            {[sessionTimeLine(session, clockFormat), sessionPeopleLine(session)]
              .filter((p) => p !== '')
              .join(' · ')}
          </div>
          {tag === '' ? null : (
            <div className="text-xs mt-1" style={{ color: cancelled ? '#F2544B' : '#FBBF24' }}>
              {tag}
            </div>
          )}
        </div>
        <button type="button" onClick={onClose} aria-label="Close this day" style={labelStyle}>
          <X className="w-4 h-4" />
        </button>
      </div>

      {session.started ? (
        <p className="text-sm mt-3" style={labelStyle}>
          This class has already started, so it can&apos;t be changed.
        </p>
      ) : locked ? null : cancelled ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={onRestore}
            disabled={busy}
            className="rounded-xl px-4 py-2 text-sm font-medium inline-flex items-center gap-2"
            style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F', opacity: busy ? 0.5 : 1 }}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Put it back on
          </button>
        </div>
      ) : mode === 'change' ? (
        <div className="mt-4">
          <DayForm
            draft={draft}
            setDraft={setDraft}
            staff={staff}
            clockFormat={clockFormat}
            saving={busy}
            onClose={() => setMode(null)}
            onSave={async () => {
              const body = dayRequest(draft);
              if (body !== null && (await onChange(body))) setMode(null);
            }}
          />
        </div>
      ) : mode === 'cancel' ? (
        <div className="mt-3">
          {/* It asks first, in place (Kd, 2026-09-22): nothing on this screen
              takes a class off the calendar on one tap. */}
          <ConfirmInline
            question={`Cancel ${name}? It stays on the week crossed out, and you can put it back on.`}
            confirmLabel="Cancel this day"
            cancelLabel="Keep it"
            busy={busy}
            onCancel={() => setMode(null)}
            onConfirm={async () => {
              if (await onCancel()) setMode(null);
            }}
          />
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setDraft(dayDraft(session));
              setMode('change');
            }}
            className="rounded-xl px-4 py-2 text-sm font-medium"
            style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' }}
          >
            Change this day
          </button>
          <button
            type="button"
            onClick={() => setMode('cancel')}
            className="text-sm"
            style={{ color: 'rgba(255,255,255,0.65)' }}
          >
            Cancel this day
          </button>
        </div>
      )}
    </ConsoleCard>
  );
}

export default function ClassWeek({ gymId, staff, locked }) {
  const [wanted, setWanted] = useState(null);
  const [week, setWeek] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

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

  const act = async (call) => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await call();
      setWeek(res.data);
      return true;
    } catch (err) {
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => goTo(addDays(lists.weekStart, -7))}
          disabled={loading || lists.weekStart === ''}
          aria-label="Week before"
          className="rounded-lg p-2"
          style={{ background: 'rgba(255,255,255,0.04)', color: '#fff' }}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="text-sm font-medium min-w-[11rem] text-center" style={{ color: '#fff' }}>
          {weekTitle(lists.weekStart)}
        </div>
        <button
          type="button"
          onClick={() => goTo(addDays(lists.weekStart, 7))}
          disabled={loading || !canGoForward(lists.weekStart, lists.lastWeekStart)}
          aria-label="Week after"
          className="rounded-lg p-2"
          style={{
            background: 'rgba(255,255,255,0.04)',
            color: '#fff',
            opacity: canGoForward(lists.weekStart, lists.lastWeekStart) ? 1 : 0.35,
          }}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        {thisWeek || lists.weekStart === '' ? null : (
          <button
            type="button"
            onClick={() => goTo(null)}
            className="text-sm ml-1"
            style={{ color: '#FF8A1F' }}
          >
            This week
          </button>
        )}
      </div>

      {lists.sessions.length === 0 && filter === EMPTY_FILTER ? null : (
        <div className="flex flex-wrap gap-3">
          <select
            aria-label="Show which class"
            value={filter.classTypeId}
            onChange={(e) => {
              const choice = choices.classes.find((c) => c.value === e.target.value);
              setFilter({ ...filter, classTypeId: e.target.value, className: choice?.label ?? '' });
            }}
            className="rounded-lg px-3 py-2 text-sm"
            style={inputStyle}
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
            className="rounded-lg px-3 py-2 text-sm"
            style={inputStyle}
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

      {actionError === null ? null : <ConsoleFailed message={actionError} />}
      {loading ? <ConsoleLoading label="Loading this week…" /> : null}
      {!loading && failed !== null ? (
        <ConsoleFailed message={failed} onRetry={() => goTo(wanted)} />
      ) : null}

      {!loading && failed === null ? (
        <>
          {shown.length === 0 ? (
            <p className="text-sm" style={labelStyle}>
              {lists.sessions.length === 0 ? 'No classes this week.' : 'Nothing this week matches those filters.'}
            </p>
          ) : null}
          {/* One list of days: a column each on a wide screen, stacked on a phone.
              The opened day sits right under its own day when stacked, and under
              the whole week when the days are side by side. */}
          <div className="grid grid-cols-1 lg:grid-cols-7 gap-3">
            {columns.map((column, index) => (
              <div
                key={column.date}
                className="flex flex-col gap-2 min-w-0"
                style={{ order: index * 2 }}
              >
                <div
                  className="text-xs uppercase tracking-wider"
                  style={{ color: column.isToday ? '#FF8A1F' : 'rgba(255,255,255,0.45)' }}
                >
                  {column.heading}
                  {column.isToday ? ' · Today' : ''}
                </div>
                {column.sessions.length === 0 ? (
                  <div className="text-xs lg:hidden" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    No classes
                  </div>
                ) : null}
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
                      className="text-left rounded-lg px-2.5 py-2 min-w-0"
                      style={{
                        background: selected === s.id ? 'rgba(255,138,31,0.12)' : 'rgba(255,255,255,0.04)',
                        borderLeft: `3px solid ${classSwatch(s.colour) ?? 'rgba(255,255,255,0.2)'}`,
                        opacity: cancelled ? 0.6 : 1,
                      }}
                    >
                      <div className="text-xs" style={{ color: 'rgba(255,255,255,0.65)' }}>
                        {sessionTimeLine(s, lists.clockFormat)}
                      </div>
                      <div
                        className="text-sm font-medium truncate"
                        style={{ color: '#fff', textDecoration: cancelled ? 'line-through' : 'none' }}
                      >
                        {s.name}
                      </div>
                      <div className="text-xs truncate" style={{ color: 'rgba(255,255,255,0.45)' }}>
                        {sessionPeopleLine(s)}
                      </div>
                      {tag === '' ? null : (
                        <div className="text-xs mt-0.5" style={{ color: cancelled ? '#F2544B' : '#FBBF24' }}>
                          {tag}
                        </div>
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
                  session={open}
                  clockFormat={lists.clockFormat}
                  staff={staff}
                  locked={locked}
                  busy={busy}
                  onClose={() => setSelected(null)}
                  onChange={(body) => act(() => orgService.changeClassDay(gymId, open.id, body))}
                  onCancel={() => act(() => orgService.cancelClassDay(gymId, open.id))}
                  onRestore={() => void act(() => orgService.restoreClassDay(gymId, open.id))}
                />
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
