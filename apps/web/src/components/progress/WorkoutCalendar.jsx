// P2.8 web repoint (workout calendar card) — reads `GET /v1/workouts` on the
// NEW API through `api/workoutHistory.js`. See that file's header for why the
// month is assembled client-side, why the day key is LOCAL, and why the
// exercise chips are fetched from `/v1/workouts/:id` only when a day opens.
//
// THE STATE THIS SCREEN MUST KEEP APART, and did not before: a FAILED read and
// an EMPTY month. The old code did `.catch(console.error)` and left `byDate`
// at `{}`, so a dead backend drew a blank grid captioned "0 active days this
// month" — a confident claim about days the user may well have trained. Three
// states now, never two (OWED.md:1302's family).
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, ChevronRight, X,
  Flame, Clock, Target,
} from 'lucide-react';
import { workoutService } from '../../api/workoutApi';
import {
  fetchMonth, formatDuration, formatFormScore, formatKcal, formColor,
  monthClamp, readWorkoutExercises,
} from '../../api/workoutHistory';

const DAYS    = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS  = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MUTED = 'rgba(255,255,255,0.40)';

// ── Session detail panel ──────────────────────────────────────────────────────
function SessionDetail({ sessions, dateStr, onClose }) {
  // id → {names,total} (loaded) | null (the detail read failed) | absent (in
  // flight). An absent entry renders NOTHING: "we have not asked yet" must not
  // look like "this workout had no exercises".
  const [exercises, setExercises] = useState({});

  useEffect(() => {
    if (!sessions || sessions.length === 0) return undefined;
    let cancelled = false;
    Promise.all(
      sessions.map((s) =>
        workoutService
          .getWorkout(s.id)
          .then((res) => [s.id, readWorkoutExercises(res?.data)])
          .catch(() => [s.id, null]),
      ),
    ).then((pairs) => {
      if (!cancelled) setExercises(Object.fromEntries(pairs));
    });
    return () => { cancelled = true; };
  }, [sessions]);

  if (!sessions || sessions.length === 0) return null;

  const date = new Date(dateStr + 'T00:00:00');
  const formattedDate = date.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{    opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-50 flex items-end sm:items-center
                   justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
      >
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.96 }}
          animate={{ opacity: 1, y: 0,  scale: 1    }}
          exit={{    opacity: 0, y: 40, scale: 0.96 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md rounded-3xl overflow-hidden"
          style={{
            background: '#121110',
            border:     '1px solid rgba(255,255,255,0.08)',
            maxHeight:  '80vh',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-5 py-4"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider"
                 style={{ color: '#FF8A1F' }}>
                Workout History
              </p>
              <h3 className="text-base font-bold text-white">{formattedDate}</h3>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,0.04)' }}
            >
              <X className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.5)' }} />
            </button>
          </div>

          {/* Sessions */}
          <div className="overflow-y-auto no-scrollbar" style={{ maxHeight: '60vh' }}>
            {sessions.map((session, i) => {
              // START time, not finish: the new schema has no completion
              // timestamp (`workoutListItemSchema` carries `startedAt` only),
              // and deriving one from a duration that can itself be unknown
              // would be an invented number. Labelled "Started" so the reading
              // is unambiguous rather than silently shifted.
              const time = new Date(session.startedAt)
                .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              const tint = formColor(session.formScore);
              const chips = exercises[session.id];

              return (
                <div
                  key={session.id}
                  className="p-5"
                  style={{
                    borderBottom: i < sessions.length - 1
                      ? '1px solid rgba(255,255,255,0.04)'
                      : 'none',
                  }}
                >
                  {/* Time + session number */}
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium"
                          style={{ color: MUTED }}>
                      {sessions.length > 1 ? `Session ${i + 1} · ` : ''}Started {time}
                    </span>
                  </div>

                  {/* Stats grid */}
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {[
                      { icon: Clock,  value: formatDuration(session.durationSeconds),  label: 'Duration', color: '#60a5fa' },
                      { icon: Flame,  value: formatKcal(session.kcal),                 label: 'Calories', color: '#f97316' },
                      { icon: Target, value: formatFormScore(session.formScore),       label: 'Form',     color: tint },
                    ].map(({ icon: Icon, value, label, color }) => (
                      <div
                        key={label}
                        className="rounded-xl p-2.5 text-center"
                        style={{ background: 'rgba(255,255,255,0.03)' }}
                      >
                        <Icon className="w-3.5 h-3.5 mx-auto mb-1" style={{ color }} />
                        <p className="text-sm font-bold text-white tabular-nums">{value}</p>
                        <p className="text-2xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                          {label}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Exercises — absent while in flight (no claim), an honest
                      line when the read failed, nothing when there are none. */}
                  {chips === null && (
                    <p className="text-2xs" style={{ color: 'rgba(255,255,255,0.30)' }}>
                      Couldn&apos;t load this workout&apos;s exercises.
                    </p>
                  )}
                  {chips && chips.total > 0 && (
                    <div>
                      <p className="text-2xs uppercase tracking-wider mb-1.5"
                         style={{ color: 'rgba(255,255,255,0.30)' }}>
                        Exercises · {chips.total} total
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {chips.names.map((name) => (
                          <span
                            key={name}
                            className="text-2xs font-medium px-2 py-1 rounded-lg"
                            style={{
                              background: 'rgba(255,138,31,0.08)',
                              color:      '#FF8A1F',
                              border:     '1px solid rgba(255,138,31,0.15)',
                            }}
                          >
                            {name}
                          </span>
                        ))}
                        {chips.total > chips.names.length && (
                          <span
                            className="text-2xs font-medium px-2 py-1 rounded-lg"
                            style={{
                              background: 'rgba(255,255,255,0.04)',
                              color:      'rgba(255,255,255,0.35)',
                            }}
                          >
                            +{chips.total - chips.names.length} more
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Main calendar component ───────────────────────────────────────────────────
export default function WorkoutCalendar() {
  const today = new Date();
  const [month,    setMonth]    = useState(today.getMonth() + 1);
  const [year,     setYear]     = useState(today.getFullYear());
  const [status,   setStatus]   = useState('loading'); // loading | ready | failed
  const [history,  setHistory]  = useState(null);
  const [selected, setSelected] = useState(null);  // dateStr
  const [reloads,  setReloads]  = useState(0);

  const retry = useCallback(() => setReloads((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setSelected(null);
    fetchMonth(
      ({ limit, cursor }) =>
        workoutService.getHistory({ limit, ...(cursor ? { cursor } : {}) })
          .then((res) => res?.data),
      { month, year },
    ).then((result) => {
      if (cancelled) return;
      if (result === null) {
        setHistory(null);
        setStatus('failed');
        return;
      }
      setHistory(result);
      setStatus('ready');
    });
    return () => { cancelled = true; };
  }, [month, year, reloads]);

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear((y) => y - 1); }
    else              setMonth((m) => m - 1);
  };

  const nextMonth = () => {
    const isCurrentMonth = month === today.getMonth() + 1 && year === today.getFullYear();
    if (isCurrentMonth) return;
    if (month === 12) { setMonth(1); setYear((y) => y + 1); }
    else               setMonth((m) => m + 1);
  };

  // Build calendar grid
  const firstDay  = new Date(year, month - 1, 1);
  const daysInMonth  = new Date(year, month, 0).getDate();
  const startOffset  = firstDay.getDay();   // 0 = Sunday

  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const isToday = (day) =>
    day === today.getDate() &&
    month === today.getMonth() + 1 &&
    year  === today.getFullYear();

  const getDateStr = (day) =>
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const isFuture = (day) => {
    const d = new Date(year, month - 1, day);
    return d > today;
  };

  const isCurrentMonth =
    month === today.getMonth() + 1 && year === today.getFullYear();

  const byDate = status === 'ready' && history ? history.byDate : {};
  const clamp  = status === 'ready' && history
    ? monthClamp({ month, year }, history.limitedToDays)
    : null;

  return (
    <div className="card-glass h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <button
            onClick={prevMonth}
            className="w-8 h-8 rounded-lg flex items-center justify-center
                       transition-all"
            style={{ background: 'rgba(255,255,255,0.04)' }}
          >
            <ChevronLeft className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.65)' }} />
          </button>
          <h3 className="text-base font-bold text-white w-40 text-center">
            {MONTHS[month - 1]} {year}
          </h3>
          <button
            onClick={nextMonth}
            disabled={isCurrentMonth}
            className="w-8 h-8 rounded-lg flex items-center justify-center
                       transition-all disabled:opacity-30"
            style={{ background: 'rgba(255,255,255,0.04)' }}
          >
            <ChevronRight className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.65)' }} />
          </button>
        </div>

        <div className="flex items-center gap-3 text-2xs"
             style={{ color: MUTED }}>
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-sm"
                 style={{ background: '#FF8A1F' }} />
            Workout
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-sm"
                 style={{ background: 'rgba(255,138,31,0.25)' }} />
            Multiple
          </div>
        </div>
      </div>

      {/* Plan read-gate — the window is a READ GATE, never deletion, and the
          copy says so (progressClamp.js's rule, same fact, same sentence). */}
      {clamp && (
        <p className="text-2xs mb-2" style={{ color: 'rgba(255,255,255,0.45)' }}>
          Your plan shows the last {clamp.days} days, so
          {clamp.whole ? ' this month isn’t shown' : ' the earlier part of this month isn’t shown'}.
          {' '}<span style={{ color: 'rgba(255,255,255,0.65)' }}>Older workouts are still saved.</span>
        </p>
      )}
      {status === 'ready' && history?.truncated && (
        <p className="text-2xs mb-2" style={{ color: 'rgba(255,255,255,0.45)' }}>
          This month has more workouts than this view reads back through, so it may be incomplete.
        </p>
      )}
      {status === 'ready' && history?.unreadable > 0 && (
        <p className="text-2xs mb-2" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {history.unreadable} workout{history.unreadable === 1 ? '' : 's'} couldn&apos;t be read and {history.unreadable === 1 ? 'is' : 'are'} not shown.
        </p>
      )}

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {DAYS.map((d) => (
          <div key={d} className="text-center text-2xs font-semibold uppercase
                                  tracking-wider py-1"
               style={{ color: 'rgba(255,255,255,0.30)' }}>
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      {status === 'loading' ? (
        <div className="flex justify-center py-12">
          <div className="w-5 h-5 border-2 rounded-full animate-spin"
               style={{ borderColor: 'rgba(255,138,31,0.2)', borderTopColor: '#FF8A1F' }} />
        </div>
      ) : status === 'failed' ? (
        <div className="flex flex-col items-center gap-3 py-12">
          <p className="text-xs text-center" style={{ color: MUTED }}>
            Couldn&apos;t load your workout history.
          </p>
          <button
            onClick={retry}
            className="px-3 py-1.5 rounded-lg text-2xs font-bold"
            style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' }}
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-1">
          {cells.map((day, i) => {
            if (!day) return <div key={`empty-${i}`} />;

            const dateStr  = getDateStr(day);
            const sessions = byDate[dateStr] || [];
            const hasWorkout = sessions.length > 0;
            const isMultiple = sessions.length > 1;
            const isTodayDay = isToday(day);
            const isFutureDay = isFuture(day);

            return (
              <motion.button
                key={day}
                whileHover={hasWorkout ? { scale: 1.1 } : {}}
                whileTap={hasWorkout   ? { scale: 0.95 } : {}}
                onClick={() => hasWorkout && setSelected(dateStr)}
                disabled={!hasWorkout}
                className="aspect-square rounded-xl flex flex-col items-center
                           justify-center relative transition-all"
                style={{
                  background: hasWorkout
                    ? isMultiple
                      ? 'rgba(255,138,31,0.25)'
                      : 'rgba(255,138,31,0.15)'
                    : isTodayDay
                      ? 'rgba(255,255,255,0.06)'
                      : 'transparent',
                  border: isTodayDay
                    ? '1px solid rgba(255,138,31,0.40)'
                    : hasWorkout
                      ? '1px solid rgba(255,138,31,0.30)'
                      : '1px solid transparent',
                  cursor: hasWorkout ? 'pointer' : 'default',
                  opacity: isFutureDay ? 0.3 : 1,
                }}
              >
                <span
                  className="text-xs font-bold tabular-nums"
                  style={{
                    color: hasWorkout
                      ? '#FF8A1F'
                      : isTodayDay
                        ? '#fff'
                        : 'rgba(255,255,255,0.55)',
                  }}
                >
                  {day}
                </span>

                {/* Activity dot */}
                {hasWorkout && (
                  <div
                    className="absolute bottom-1 w-1 h-1 rounded-full"
                    style={{ background: '#FF8A1F' }}
                  />
                )}

                {/* Multiple sessions indicator */}
                {isMultiple && (
                  <span
                    className="text-2xs font-black"
                    style={{ color: '#FF8A1F', lineHeight: 1 }}
                  >
                    ×{sessions.length}
                  </span>
                )}
              </motion.button>
            );
          })}
        </div>
      )}

      {/* Month summary — the count is stated ONLY when the month was actually
          read. On a failed read it is unknown, and "0 active days" would be a
          claim about days nobody looked at. */}
      <div className="mt-4 pt-4 flex items-center justify-between"
           style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        <p className="text-xs" style={{ color: MUTED }}>
          {status === 'ready' ? (
            <>
              <span className="font-bold text-white">
                {Object.keys(byDate).length}
              </span> active days this month
            </>
          ) : (
            <span>Active days this month unavailable</span>
          )}
        </p>
        <p className="text-xs" style={{ color: MUTED }}>
          Click a highlighted day to view details
        </p>
      </div>

      {/* Session detail modal */}
      {selected && byDate[selected] && (
        <SessionDetail
          sessions={byDate[selected]}
          dateStr={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
