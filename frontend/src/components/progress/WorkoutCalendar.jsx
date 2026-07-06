import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, ChevronRight, X,
  Flame, Clock, Dumbbell, Target, Zap,
} from 'lucide-react';
import { workoutService } from '../../api/workoutApi';

const DAYS    = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS  = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ── Session detail panel ──────────────────────────────────────────────────────
function SessionDetail({ sessions, dateStr, onClose }) {
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
              const time = new Date(session.completed_at)
                .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

              const formColor =
                session.form_accuracy >= 80 ? '#4ade80' :
                session.form_accuracy >= 60 ? '#FF8A1F' : '#f87171';

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
                          style={{ color: 'rgba(255,255,255,0.40)' }}>
                      {sessions.length > 1 ? `Session ${i + 1} · ` : ''}{time}
                    </span>
                    {session.xp_earned > 0 && (
                      <div className="flex items-center gap-1">
                        <Zap className="w-3 h-3" style={{ color: '#FF8A1F' }} />
                        <span className="text-xs font-bold"
                              style={{ color: '#FF8A1F' }}>
                          +{session.xp_earned} XP
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Stats grid */}
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {[
                      { icon: Clock,  value: `${session.duration_minutes}m`, label: 'Duration', color: '#60a5fa' },
                      { icon: Flame,  value: `${session.calories_burned}`,   label: 'Calories', color: '#f97316' },
                      { icon: Target, value: `${session.form_accuracy}%`,    label: 'Form',     color: formColor },
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

                  {/* Exercises */}
                  {session.exercises?.length > 0 && (
                    <div>
                      <p className="text-2xs uppercase tracking-wider mb-1.5"
                         style={{ color: 'rgba(255,255,255,0.30)' }}>
                        Exercises · {session.exercise_count} total
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {session.exercises.map((ex, j) => (
                          <span
                            key={j}
                            className="text-2xs font-medium px-2 py-1 rounded-lg"
                            style={{
                              background: 'rgba(255,138,31,0.08)',
                              color:      '#FF8A1F',
                              border:     '1px solid rgba(255,138,31,0.15)',
                            }}
                          >
                            {ex.name}
                          </span>
                        ))}
                        {session.exercise_count > session.exercises.length && (
                          <span
                            className="text-2xs font-medium px-2 py-1 rounded-lg"
                            style={{
                              background: 'rgba(255,255,255,0.04)',
                              color:      'rgba(255,255,255,0.35)',
                            }}
                          >
                            +{session.exercise_count - session.exercises.length} more
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
  const [byDate,   setByDate]   = useState({});
  const [loading,  setLoading]  = useState(true);
  const [selected, setSelected] = useState(null);  // dateStr

  useEffect(() => {
    setLoading(true);
    workoutService.getHistory(month, year)
      .then((res) => setByDate(res.data.by_date || {}))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [month, year]);

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
             style={{ color: 'rgba(255,255,255,0.40)' }}>
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
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-5 h-5 border-2 rounded-full animate-spin"
               style={{ borderColor: 'rgba(255,138,31,0.2)', borderTopColor: '#FF8A1F' }} />
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

      {/* Month summary */}
      <div className="mt-4 pt-4 flex items-center justify-between"
           style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.40)' }}>
          <span className="font-bold text-white">
            {Object.keys(byDate).length}
          </span> active days this month
        </p>
        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.40)' }}>
          Click a highlighted day to view details
        </p>
      </div>

      {/* Session detail modal */}
      {selected && (
        <SessionDetail
          sessions={byDate[selected]}
          dateStr={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}