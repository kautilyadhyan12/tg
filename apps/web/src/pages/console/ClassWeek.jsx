import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import { orgService, errorStatus, errorText } from '../../api/orgsApi';
import { ConfirmInline, ConsoleCard, ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import { RunFields, StartTimePick } from './ClassFields';
import { inputStyle, labelStyle } from './classStyles';
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
// class opens it: Edit (this class only, or this and future classes of its time
// slot) or Cancel class for that date, Un-cancel for a cancelled one.

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
  onSave,
  onClose,
  onMove,
  onBack,
}) {
  const problem = dayProblem(draft);
  const set = (patch) => setDraft({ ...draft, ...patch });
  return (
    <div className="flex flex-col gap-4">
      {offerFuture ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Which classes to change">
          {SCOPES.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setScope(key)}
              disabled={saving}
              aria-pressed={scope === key}
              className="rounded-lg px-3 py-1.5 text-sm"
              style={{
                background: scope === key ? 'rgba(255,138,31,0.15)' : 'rgba(255,255,255,0.04)',
                color: scope === key ? '#FF8A1F' : 'rgba(255,255,255,0.65)',
              }}
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
        <p className="text-sm" style={{ color: '#FBBF24' }}>
          {problem}
        </p>
      )}
      {question !== null ? (
        <ConfirmInline
          question={question}
          confirmLabel="Move anyway"
          cancelLabel="Go back"
          busy={saving}
          onConfirm={onMove}
          onCancel={onBack}
        />
      ) : (
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
            Save
          </button>
          <button type="button" onClick={onClose} className="text-sm" style={labelStyle}>
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
function DayPanel({ session, clockFormat, staff, locked, busy, onClose, onChange, onCancel, onRestore }) {
  const [mode, setMode] = useState(null);
  const [draft, setDraft] = useState(() => dayDraft(session));
  const [scope, setScope] = useState('this');
  // How many classes a move from this date would replace, when the server asked.
  const [asked, setAsked] = useState(null);
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
            {session.name}
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.65)' }}>
            {sessionWhenLine(session, clockFormat)}
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.65)' }}>
            {peopleLine(session)}
          </div>
          {tag === '' ? null : (
            <div className="text-xs mt-1" style={{ color: cancelled ? '#F2544B' : '#FBBF24' }}>
              {tag}
            </div>
          )}
        </div>
        <button type="button" onClick={onClose} aria-label="Close this class" style={labelStyle}>
          <X className="w-4 h-4" />
        </button>
      </div>

      {session.started ? (
        <p className="text-sm mt-3" style={labelStyle}>
          This class has started, so it can&apos;t be changed.
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
            Un-cancel
          </button>
        </div>
      ) : mode === 'change' ? (
        <div className="mt-4">
          <DayForm
            draft={draft}
            setDraft={(next) => {
              setAsked(null);
              setDraft(next);
            }}
            staff={staff}
            clockFormat={clockFormat}
            saving={busy}
            scope={scope}
            setScope={(next) => {
              setAsked(null);
              setScope(next);
            }}
            offerFuture={typeof session.scheduleId === 'string'}
            question={asked === null ? null : replaceQuestion(asked, session.localDate)}
            onClose={() => {
              setAsked(null);
              setMode(null);
            }}
            onSave={async () => {
              const body = dayRequest(draft, scope);
              if (body === null) return;
              const done = await onChange(body);
              if (done === true) setMode(null);
              else if (typeof done === 'number') setAsked(done);
            }}
            onMove={async () => {
              const body = dayRequest(draft, scope, asked);
              if (body === null) return;
              const done = await onChange(body);
              if (done === true) setMode(null);
              else setAsked(typeof done === 'number' ? done : null);
            }}
            onBack={() => setAsked(null)}
          />
        </div>
      ) : mode === 'cancel' ? (
        <div className="mt-3">
          {/* It asks first, in place (Kd, 2026-09-22): nothing on this screen
              takes a class off the calendar on one tap. */}
          <ConfirmInline
            question={`Cancel ${name}?`}
            confirmLabel="Cancel class"
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
              setScope('this');
              setAsked(null);
              setMode('change');
            }}
            className="rounded-xl px-4 py-2 text-sm font-medium"
            style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' }}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => setMode('cancel')}
            className="text-sm"
            style={{ color: 'rgba(255,255,255,0.65)' }}
          >
            Cancel class
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

  // True when saved; the count when a move must be asked about first (the
  // question is the form's, not an error); false otherwise.
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
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex items-center gap-2">
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
              Today
            </button>
          )}
        </div>

        {lists.sessions.length === 0 && filter === EMPTY_FILTER ? null : (
          <div className="grid grid-cols-2 gap-2 lg:flex lg:ml-auto">
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
      </div>

      {actionError === null ? null : <ConsoleFailed message={actionError} />}
      {loading ? <ConsoleLoading label="Loading this week…" /> : null}
      {!loading && failed !== null ? (
        <ConsoleFailed message={failed} onRetry={() => goTo(wanted)} />
      ) : null}

      {!loading && failed === null ? (
        <>
          {shown.length === 0 ? (
            <p className="text-sm" style={labelStyle}>
              {lists.sessions.length === 0 ? 'No classes this week.' : 'No classes match.'}
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
                        {peopleLine(s)}
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
