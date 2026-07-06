import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import PredictionsSection from '../components/progress/PredictionsSection';
import { progressService } from '../api/progressApi';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  Flame, Clock, Dumbbell, Target,
  Trophy, TrendingUp, Calendar, Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';
import WorkoutCalendar from '../components/progress/WorkoutCalendar';
import MeasurementsTracker from '../components/progress/MeasurementsTracker';
import { format, parseISO, eachDayOfInterval, subDays } from 'date-fns';

// ── Constants ─────────────────────────────────────────────────────────────────
const PERIODS = [
  { value: '7d',  label: '7 Days'   },
  { value: '30d', label: '30 Days'  },
  { value: '90d', label: '90 Days'  },
  { value: '1y',  label: '1 Year'   },
  { value: 'all', label: 'All Time' },
];

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
function ActivityHeatmap({ heatmap }) {
  const today = new Date();
  const start = subDays(today, 364);
  const days  = eachDayOfInterval({ start, end: today });

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

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-1 min-w-max">
        {weeks.map((wk, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {wk.map((day) => {
              const dateStr = format(day, 'yyyy-MM-dd');
              const level   = getLevel(dateStr);
              const data    = heatmap[dateStr];
              return (
                <div
                  key={dateStr}
                  title={
                    data
                      ? `${dateStr}: ${data.count} workout(s), ${data.calories} kcal`
                      : dateStr
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

        setOverview(overviewRes.data.overview);
        setCalories(caloriesRes.data.data);
        setWeekly(weeklyRes.data.data);
        setHeatmap(heatmapRes.data.heatmap);
        setCategories(categoriesRes.data.data);
        setRecords(recordsRes.data.records);
      } catch (err) {
        console.error(err);
        toast.error('Failed to load progress data');
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [period]);

  const isEmpty = !loading && overview?.total_workouts === 0;

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
                  value={overview?.total_workouts || 0}
                  sub={`in ${PERIODS.find(p => p.value === period)?.label}`}
                  color="bg-primary-600"
                />
                <StatCard
                  icon={Clock} label="Time Trained"
                  value={`${overview?.total_hours || 0}h`}
                  sub={`${Math.round((overview?.total_hours || 0) * 60)} minutes`}
                  color="bg-blue-600"
                />
                <StatCard
                  icon={Flame} label="Calories"
                  value={overview?.total_calories || 0}
                  sub="kcal burned"
                  color="bg-orange-600"
                />
                <StatCard
                  icon={Zap} label="Streak"
                  value={`${overview?.current_streak || 0} days`}
                  sub={`Longest: ${overview?.longest_streak || 0} days`}
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
                          type="monotone" dataKey="calories" name="Calories"
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
                    Activity — Last 365 Days
                  </h3>
                  <ActivityHeatmap heatmap={heatmap} />
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
                          data={categories} dataKey="count" nameKey="category"
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
                    {overview?.consistency || 0}%
                  </span>
                </div>
                <div className="h-3 bg-dark-300 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-primary-600
                               to-primary-400 rounded-full transition-all duration-500"
                    style={{ width: `${overview?.consistency || 0}%` }}
                  />
                </div>
                <p className="text-gray-500 text-xs mt-2">
                  You worked out {overview?.total_workouts || 0} times in the selected period
                </p>
              </div>

            </>
          )}
        </div>
      </div>
    </div>
  );
}