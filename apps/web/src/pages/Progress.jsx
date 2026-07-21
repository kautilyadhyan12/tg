import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import PredictionsSection from '../components/progress/PredictionsSection';
import { progressService } from '../api/progressApi';
import { PERIODS, clampNotice, heatmapCaption, recordsNote } from './progressClamp';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  Flame, Clock, Dumbbell, Target,
  Trophy, TrendingUp, Calendar, Zap, Info,
} from 'lucide-react';
import toast from 'react-hot-toast';
import WorkoutCalendar from '../components/progress/WorkoutCalendar';
import MeasurementsTracker from '../components/progress/MeasurementsTracker';
import { format, parseISO, eachDayOfInterval, subDays } from 'date-fns';

// ── Constants ─────────────────────────────────────────────────────────────────
const PIE_COLORS = [
  '#6366f1', '#22c55e', '#f59e0b', '#ec4899',
  '#06b6d4', '#8b5cf6', '#ef4444', '#84cc16',
];

const CHART_STYLE = {
  background: 'transparent',
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 12,
};

// ── Activity heatmap ──────────────────────────────────────────────────────────
function ActivityHeatmap({ heatmap, windowDays }) {
  const today = new Date();
  // Draw exactly the window the heading claims. Previously hard-coded to 364
  // regardless of the plan clamp, so a gated user got a YEAR of squares under
  // a "Last 90 Days" heading — 53 columns wide, hence the horizontal scroll.
  const start = subDays(today, Math.max(windowDays, 1) - 1);
  // Pad back to the week boundary so every ROW is one weekday (GitHub-style):
  // chunking a raw day list into 7s puts an arbitrary weekday in each row.
  const gridStart = subDays(start, start.getDay());
  const days = eachDayOfInterval({ start: gridStart, end: today });

  const getLevel = (dateStr) => {
    const d = heatmap[dateStr];
    if (!d || d.count === 0) return 0;
    if (d.count === 1) return 1;
    if (d.count === 2) return 2;
    return 3;
  };

  const colors = [
    'bg-white/5',
    'bg-primary-900/60',
    'bg-primary-700/80',
    'bg-primary-500',
  ];

  const weeks = [];
  let week = [];
  days.forEach((day, i) => {
    week.push(day);
    if (week.length === 7 || i === days.length - 1) {
      weeks.push(week);
      week = [];
    }
  });

  // Month label above the column where each new month first appears.
  const monthLabels = weeks.map((wk, wi) => {
    const first = wk[0];
    if (first === undefined) return null;
    const prev = wi === 0 ? null : weeks[wi - 1]?.[0];
    const isNew = prev == null || first.getMonth() !== prev.getMonth();
    return isNew && first <= today ? format(first, 'MMM') : null;
  });

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-1 min-w-max">
        {/* Weekday gutter — Mon/Wed/Fri only, as GitHub does, so the labels
            do not crowd the 12px cells. */}
        <div className="flex flex-col gap-1 mr-1 mt-[18px]">
          {['', 'Mon', '', 'Wed', '', 'Fri', ''].map((d, i) => (
            <div key={i} className="h-3 text-[9px] leading-3 text-gray-500 text-right pr-1"
                 style={{ width: '1.9rem' }}>
              {d}
            </div>
          ))}
        </div>
        {weeks.map((wk, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            <div className="h-[14px] text-[9px] leading-[14px] text-gray-500 whitespace-nowrap">
              {monthLabels[wi]}
            </div>
            {wk.map((day) => {
              const dateStr = format(day, 'yyyy-MM-dd');
              const level   = getLevel(dateStr);
              const data    = heatmap[dateStr];
              // Cells before the window start exist only to align the rows.
              if (day < start) return <div key={dateStr} className="w-3 h-3" />;
              return (
                <div
                  key={dateStr}
                  title={
                    data
                      ? `${format(day, 'd MMM yyyy')} — ${data.count} workout${data.count === 1 ? '' : 's'}, ${data.kcal} kcal`
                      : `${format(day, 'd MMM yyyy')} — no workouts`
                  }
                  className={`w-3 h-3 rounded-sm ${colors[level]}
                              transition-colors hover:ring-1
                              hover:ring-primary-400 cursor-default`}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-3 text-xs text-gray-500">
        <span>Less</span>
        {colors.map((c, i) => (
          <div key={i} className={`w-3 h-3 rounded-sm ${c}`} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="card">
      <div className={`w-10 h-10 rounded-xl flex items-center
                      justify-center mb-3 ${color}`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <p className="text-gray-400 text-sm">{label}</p>
      <p className="text-white font-bold text-2xl mt-1">{value}</p>
      {sub && <p className="text-gray-500 text-xs mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Custom tooltip ────────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-dark-100 border border-white/10 rounded-xl p-3 text-sm">
      <p className="text-gray-400 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }} className="font-semibold">
          {p.name}: {p.value}
        </p>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Progress() {
  const [period,     setPeriod]     = useState('30d');
  const [overview,   setOverview]   = useState(null);
  const [calories,   setCalories]   = useState([]);
  const [weekly,     setWeekly]     = useState([]);
  const [heatmap,    setHeatmap]    = useState({});
  const [categories, setCategories] = useState([]);
  const [records,    setRecords]    = useState([]);
  // The plan's history read-gate, as reported by /v1/progress (Part 4 §0.2).
  // null = unlimited. Taken from the OVERVIEW response: all six carry the same
  // gate value, so reading one avoids six states that can never disagree.
  const [limitedToDays, setLimitedToDays] = useState(null);
  // Fires ONLY when the plan window actually cuts the requested one — the
  // server reports limitedToDays unconditionally, so "not null" is not the
  // same question (workouts/service.ts:134). See progressClamp.js.
  const clamp = clampNotice(period, limitedToDays);
  const [loading,    setLoading]    = useState(true);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const [
          overviewRes, caloriesRes, weeklyRes,
          heatmapRes,  categoriesRes, recordsRes,
        ] = await Promise.all([
          progressService.getOverview(period),
          progressService.getCaloriesTrend(period),
          progressService.getWeeklyWorkouts(period),
          progressService.getActivityHeatmap(),
          progressService.getCategoryDistribution(period),
          progressService.getPersonalRecords(),
        ]);

        // New /v1 API (Card 3): responses are @app/shared progress.ts shapes.
        setOverview(overviewRes.data);
        setLimitedToDays(overviewRes.data.limitedToDays ?? null);
        setCalories(caloriesRes.data.points);
        // Weekly points carry {isoYear, isoWeek}; the chart wants one label.
        // When the window spans ISO years (1y/all), Wnn alone is ambiguous —
        // two different July "W29"s would collide (T3 Card 3 f.3), so the
        // label carries the year whenever more than one is present.
        const weeklyPoints = weeklyRes.data.points;
        const spansYears = new Set(weeklyPoints.map((p) => p.isoYear)).size > 1;
        setWeekly(weeklyPoints.map((p) => ({
          ...p,
          week: spansYears
            ? `W${String(p.isoWeek).padStart(2, '0')} ’${String(p.isoYear).slice(-2)}`
            : `W${String(p.isoWeek).padStart(2, '0')}`,
        })));
        // Heatmap arrives as an ARRAY of {date, count, kcal}; the calendar
        // grid looks days up by date string, so index it.
        setHeatmap(Object.fromEntries(
          heatmapRes.data.days.map((d) => [d.date, d]),
        ));
        setCategories(categoriesRes.data.families);
        // records is an OBJECT of refs now — build the display list here
        // (labels/emoji are the client's per the contract's own comment).
        const r = recordsRes.data;
        const fmtMs = (ms) => `${Math.round(ms / 60000)} min`;
        setRecords([
          r.maxKcalWorkout && { icon: '🔥', label: 'Most calories in a workout', value: `${r.maxKcalWorkout.value} kcal` },
          r.longestWorkout && { icon: '⏱️', label: 'Longest workout',            value: fmtMs(r.longestWorkout.value) },
          r.bestAvgForm    && { icon: '🎯', label: 'Best average form',          value: `${r.bestAvgForm.value}%` },
          { icon: '🏋️', label: 'Total workouts', value: r.totalWorkouts },
          { icon: '📆', label: 'Longest streak', value: `${r.longestStreak} days` },
        ].filter(Boolean));
      } catch (err) {
        console.error(err);
        toast.error('Failed to load progress data');
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [period]);

  const isEmpty = !loading && overview?.totalWorkouts === 0;

  return (
    <div className="min-h-screen p-6 relative">

      {/* Fixed background */}
      <div style={{
        position:           'fixed',
        inset:               0,
        zIndex:              0,
        background:         '#0A0908',
        backgroundImage:    'url(/images/dashboard/progress.jpg)',
        backgroundSize:     'cover',
        backgroundPosition: 'center center',
        backgroundRepeat:   'no-repeat',
      }} />

      {/* Dark overlay with glow */}
      <div style={{
        position:   'fixed',
        inset:       0,
        zIndex:      1,
        background: 'rgba(10,9,8,0.75)',
        boxShadow:  'inset 0 0 120px rgba(255,138,31,0.06)',
      }} />

      {/* Content */}
      <div className="relative progress-page" style={{ zIndex: 2 }}>
        <div className="max-w-6xl mx-auto space-y-6">

          {/* ── Header ──────────────────────────────────────────────────────── */}
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <h1 className="section-title">Progress</h1>
              <p className="section-subtitle">Track your fitness journey over time</p>
            </div>
            <div className="flex gap-2 flex-wrap">
              {PERIODS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setPeriod(p.value)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium
                             transition-all duration-200
                             ${period === p.value
                      ? 'bg-primary-600 text-white'
                      : 'bg-dark-100 text-gray-400 hover:text-white'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Plan history read-gate (Part 4 §0.2). Shown ONLY when the plan
              window actually cuts the requested one. The wording is deliberate:
              this is a READ GATE, NOT DELETION (seed.ts:44; repo.ts adds
              `AND started_at >= since` and nothing deletes a workout), so it
              must not imply lost history — the older workouts are saved and
              reappear the moment the plan allows it. No upsell here; selling is
              the paywall card's job. */}
          {clamp.show && !isEmpty && (
            <div
              className="flex items-start gap-2 rounded-xl px-4 py-3 mb-2"
              style={{ background: 'rgba(255,138,31,0.10)' }}
            >
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#FF8A1F' }} />
              <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.70)' }}>
                Your plan shows {clamp.caption}, so this view stops there.
                Older workouts are still saved.
              </p>
            </div>
          )}

          {/* ── Loading skeleton ────────────────────────────────────────────── */}
          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="card animate-pulse">
                  <div className="w-10 h-10 bg-white/5 rounded-xl mb-3" />
                  <div className="h-3 bg-white/5 rounded mb-2 w-2/3" />
                  <div className="h-6 bg-white/5 rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : isEmpty ? (
            <div className="card text-center py-20">
              <Dumbbell className="w-16 h-16 text-gray-700 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-white mb-2">
                No workout data yet
              </h3>
              <p className="text-gray-400 mb-6">
                Complete your first workout to see progress charts here
              </p>
            </div>
          ) : (
            <>
              {/* ── Stats grid ────────────────────────────────────────────── */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                  icon={Dumbbell} label="Workouts"
                  value={overview?.totalWorkouts || 0}
                  sub={`in ${clamp.caption}`}
                  color="bg-primary-600"
                />
                <StatCard
                  icon={Clock} label="Time Trained"
                  value={`${((overview?.totalDurationMs || 0) / 3_600_000).toFixed(1)}h`}
                  sub={`${Math.round((overview?.totalDurationMs || 0) / 60_000)} minutes`}
                  color="bg-blue-600"
                />
                <StatCard
                  icon={Flame} label="Calories"
                  value={overview?.totalKcal || 0}
                  sub="kcal burned"
                  color="bg-orange-600"
                />
                <StatCard
                  icon={Zap} label="Streak"
                  value={`${overview?.currentStreak || 0} days`}
                  sub={`Longest: ${overview?.longestStreak || 0} days`}
                  color="bg-yellow-600"
                />
              </div>

              {/* ── AI Predictions ──────────────────────────────────────────── */}
              <PredictionsSection />

              {/* ── Calendar + Measurements ─────────────────────────────────── */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
                <motion.div
                  initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2, duration: 0.5 }}
                  className="h-full"
                >
                  <div className="h-full">
                    <WorkoutCalendar />
                  </div>
                </motion.div>
                <motion.div
                  initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3, duration: 0.5 }}
                  className="h-full"
                >
                  <div className="h-full">
                    <MeasurementsTracker />
                  </div>
                </motion.div>
              </div>

              {/* ── Calories Burned + Workouts Per Week ─────────────────────── */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {calories.length > 0 && (
                  <div className="card">
                    <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-primary-400" />
                      Calories Burned
                    </h3>
                    <ResponsiveContainer width="100%" height={220}>
                      <AreaChart
                        data={calories} style={CHART_STYLE}
                        margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="calGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%"   stopColor="#6366f1" stopOpacity={0.4} />
                            <stop offset="100%" stopColor="#6366f1" stopOpacity={0}   />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" vertical={false} />
                        <XAxis
                          dataKey="date"
                          tickFormatter={(d) => format(parseISO(d), 'MMM d')}
                          tick={{ fill: '#6b7280', fontSize: 11 }}
                          axisLine={false} tickLine={false}
                          interval="preserveStartEnd"
                        />
                        <YAxis
                          tick={{ fill: '#6b7280', fontSize: 11 }}
                          axisLine={false} tickLine={false}
                          domain={[0, 'dataMax + 50']}
                        />
                        <Tooltip
                          content={<CustomTooltip />}
                          cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 4' }}
                        />
                        <Area
                          type="monotone" dataKey="kcal" name="Calories"
                          stroke="#6366f1" strokeWidth={2.5}
                          fill="url(#calGrad)"
                          dot={{ fill: '#6366f1', strokeWidth: 0, r: 3 }}
                          activeDot={{ r: 5, fill: '#818cf8' }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {weekly.length > 0 && (
                  <div className="card">
                    <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                      <Calendar className="w-5 h-5 text-green-400" />
                      Workouts Per Week
                    </h3>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart
                        data={weekly} style={CHART_STYLE}
                        barSize={40}
                        margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%"   stopColor="#22c55e" stopOpacity={1}   />
                            <stop offset="100%" stopColor="#16a34a" stopOpacity={0.7} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" vertical={false} />
                        <XAxis
                          dataKey="week"
                          tick={{ fill: '#6b7280', fontSize: 11 }}
                          axisLine={false} tickLine={false}
                        />
                        <YAxis
                          tick={{ fill: '#6b7280', fontSize: 11 }}
                          axisLine={false} tickLine={false}
                          allowDecimals={false}
                          domain={[0, 'dataMax + 1']}
                        />
                        <Tooltip
                          content={<CustomTooltip />}
                          cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                        />
                        <Bar
                          dataKey="workouts" name="Workouts"
                          fill="url(#barGrad)" radius={[6, 6, 0, 0]}
                          label={{
                            position: 'top', fill: '#9ca3af', fontSize: 11,
                            formatter: (v) => v > 0 ? v : '',
                          }}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

              </div>

              {/* ── Heatmap + Category pie ───────────────────────────────────── */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="card">
                  <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-primary-400" />
                    Activity — {heatmapCaption(limitedToDays)}
                  </h3>
                  <ActivityHeatmap heatmap={heatmap} windowDays={limitedToDays ?? 365} />
                </div>

                {categories.length > 0 && (
                  <div className="card">
                    <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                      <Target className="w-5 h-5 text-yellow-400" />
                      Exercise Categories
                    </h3>
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie
                          data={categories} dataKey="sets" nameKey="family"
                          cx="50%" cy="50%"
                          outerRadius={80} innerRadius={40} paddingAngle={3}
                        >
                          {categories.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="transparent" />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(v, n) => [v, n]}
                          contentStyle={{
                            background: '#1e1e2e',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: 12, color: '#fff', fontSize: 12,
                          }}
                        />
                        <Legend
                          formatter={(v) => (
                            <span style={{ color: '#9ca3af', fontSize: 11 }}>{v}</span>
                          )}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* ── Personal records ────────────────────────────────────────── */}
              {records.length > 0 && (
                <div className="card">
                  <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-yellow-400" />
                    Personal Records
                  </h3>
                  {/* This endpoint takes NO period — it is gated at every one
                      (service.ts:281), so the period-driven notice above can
                      never speak for it. longestStreak is deliberately ungated
                      (:288-290), hence the carve-out rather than a flat
                      card-level window. */}
                  {recordsNote(limitedToDays) !== null && (
                    <p className="text-xs mb-4" style={{ color: 'rgba(255,255,255,0.45)' }}>
                      {recordsNote(limitedToDays)}
                    </p>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {records.map((record, i) => (
                      <div key={i} className="flex items-center gap-3 p-4 bg-dark-200 rounded-2xl">
                        <span className="text-2xl">{record.icon}</span>
                        <div>
                          <p className="text-gray-400 text-xs">{record.label}</p>
                          <p className="text-white font-bold text-lg">{record.value}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Consistency ─────────────────────────────────────────────── */}
              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-white font-semibold">Consistency</h3>
                  <span className="text-primary-400 font-bold text-lg">
                    {overview?.consistencyPct || 0}%
                  </span>
                </div>
                <div className="h-3 bg-dark-300 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-primary-600
                               to-primary-400 rounded-full transition-all duration-500"
                    style={{ width: `${overview?.consistencyPct || 0}%` }}
                  />
                </div>
                <p className="text-gray-500 text-xs mt-2">
                  You worked out {overview?.totalWorkouts || 0} times in {clamp.show ? clamp.caption : 'the selected period'}
                </p>
              </div>

            </>
          )}
        </div>
      </div>
    </div>
  );
}