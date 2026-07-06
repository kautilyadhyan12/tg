import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  Sparkles, Flame, Target, TrendingDown, Clock,
  Sun, Sunrise, Sunset, Moon, Loader2,
} from 'lucide-react';
import { progressService } from '../../api/progressApi';

// ── Time-of-day icons + labels ────────────────────────────────────────────────
const TIME_ICONS = {
  morning:   { icon: Sunrise, label: 'Morning',   hours: '5am – 12pm' },
  afternoon: { icon: Sun,     label: 'Afternoon', hours: '12pm – 5pm' },
  evening:   { icon: Sunset,  label: 'Evening',   hours: '5pm – 10pm' },
  night:     { icon: Moon,    label: 'Night',     hours: '10pm – 5am' },
};

// ── Empty state for when there's not enough data ──────────────────────────────
function EmptyPrediction({ icon: Icon, title, reason }) {
  return (
    <div className="card-glass flex flex-col items-center justify-center text-center py-8">
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
        style={{ background: 'rgba(255,255,255,0.04)' }}
      >
        <Icon className="w-5 h-5" style={{ color: 'rgba(255,255,255,0.30)' }} />
      </div>
      <p className="text-sm font-semibold mb-1"
         style={{ color: 'rgba(255,255,255,0.50)' }}>
        {title}
      </p>
      <p className="text-xs" style={{ color: 'rgba(255,255,255,0.30)' }}>
        {reason}
      </p>
    </div>
  );
}

// ── Calorie forecast widget ───────────────────────────────────────────────────
function CalorieForecast({ data }) {
  if (!data?.available) {
    return (
      <EmptyPrediction
        icon={Flame}
        title="Calorie Forecast"
        reason={data?.reason || 'Complete more workouts to enable'}
      />
    );
  }

  const chartData = data.daily_forecast.map((d) => ({
    date:  d.date.slice(5), // MM-DD
    value: d.value,
    lower: d.lower,
    upper: d.upper,
  }));

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="card-glass"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, rgba(255,138,31,0.18), rgba(255,138,31,0.06))',
              border:     '1px solid rgba(255,138,31,0.25)',
            }}
          >
            <Flame className="w-4 h-4" style={{ color: '#FF8A1F' }} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">7-Day Forecast</h3>
            <p className="text-2xs" style={{ color: 'rgba(255,255,255,0.40)' }}>
              Predicted calorie burn
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Sparkles className="w-3 h-3" style={{ color: '#FF8A1F' }} />
          <span className="text-2xs font-semibold" style={{ color: '#FF8A1F' }}>
            AI
          </span>
        </div>
      </div>

      <p className="text-3xl font-bold tracking-tighter tabular-nums mb-1"
         style={{ color: '#FF8A1F' }}>
        {data.predicted_total.toLocaleString()}
        <span className="text-sm font-medium ml-1"
              style={{ color: 'rgba(255,255,255,0.50)' }}>
          kcal
        </span>
      </p>
      <p className="text-xs mb-4" style={{ color: 'rgba(255,255,255,0.40)' }}>
        Estimated for the next {data.horizon_days} days
      </p>

      <div style={{ height: 120 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#FF8A1F" stopOpacity={0.6} />
                <stop offset="100%" stopColor="#FF8A1F" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              stroke="rgba(255,255,255,0.25)"
              fontSize={10}
              tickLine={false}
            />
            <YAxis hide />
            <Tooltip
              contentStyle={{
                background:   '#1A1815',
                border:       '1px solid rgba(255,138,31,0.3)',
                borderRadius: 8,
                fontSize:     11,
              }}
              labelStyle={{ color: '#fff' }}
              itemStyle={{  color: '#FF8A1F' }}
              formatter={(v) => [`${v} kcal`, 'Predicted']}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="#FF8A1F"
              strokeWidth={2}
              fill="url(#forecastGrad)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
}

// ── Weekly goal probability widget ────────────────────────────────────────────
function WeeklyGoal({ data }) {
  if (!data?.available) {
    return (
      <EmptyPrediction
        icon={Target}
        title="Weekly Goal Forecast"
        reason={data?.reason || 'Complete more workouts to enable'}
      />
    );
  }

  const { probability, target, current } = data;
  const progressPct = Math.min((current / target) * 100, 100);

  // Color based on probability
  const probColor =
    probability >= 75 ? '#4ade80'
    : probability >= 50 ? '#FF8A1F'
    : '#f87171';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="card-glass"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{
              background: `linear-gradient(135deg, ${probColor}33, ${probColor}11)`,
              border:     `1px solid ${probColor}44`,
            }}
          >
            <Target className="w-4 h-4" style={{ color: probColor }} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Weekly Goal</h3>
            <p className="text-2xs" style={{ color: 'rgba(255,255,255,0.40)' }}>
              Probability of hitting target
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Sparkles className="w-3 h-3" style={{ color: '#FF8A1F' }} />
          <span className="text-2xs font-semibold" style={{ color: '#FF8A1F' }}>
            AI
          </span>
        </div>
      </div>

      <div className="flex items-end gap-2 mb-4">
        <p className="text-4xl font-bold tracking-tighter tabular-nums"
           style={{ color: probColor }}>
          {probability}
          <span className="text-xl font-semibold">%</span>
        </p>
        <p className="text-xs pb-2"
           style={{ color: 'rgba(255,255,255,0.50)' }}>
          likely to hit goal
        </p>
      </div>

      {/* Progress bar */}
      <div className="mb-2 flex justify-between text-xs">
        <span style={{ color: 'rgba(255,255,255,0.50)' }}>
          This week: <strong className="text-white">{current}</strong> / {target}
        </span>
        <span style={{ color: 'rgba(255,255,255,0.30)' }}>
          {Math.round(progressPct)}%
        </span>
      </div>
      <div
        className="h-2 rounded-full overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.04)' }}
      >
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${progressPct}%` }}
          transition={{ duration: 1, ease: 'easeOut' }}
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, ${probColor}, ${probColor}cc)` }}
        />
      </div>
    </motion.div>
  );
}

// ── Plateau detection widget ──────────────────────────────────────────────────
function PlateauDetector({ data }) {
  if (!data?.available) {
    return (
      <EmptyPrediction
        icon={TrendingDown}
        title="Plateau Detector"
        reason={data?.reason || 'Complete more workouts to enable'}
      />
    );
  }

  const { detected, metrics } = data;
  const statusColor = detected ? '#f87171' : '#4ade80';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="card-glass"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{
              background: `linear-gradient(135deg, ${statusColor}33, ${statusColor}11)`,
              border:     `1px solid ${statusColor}44`,
            }}
          >
            <TrendingDown className="w-4 h-4" style={{ color: statusColor }} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Plateau Detector</h3>
            <p className="text-2xs" style={{ color: 'rgba(255,255,255,0.40)' }}>
              Last 2 weeks vs earlier
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Sparkles className="w-3 h-3" style={{ color: '#FF8A1F' }} />
          <span className="text-2xs font-semibold" style={{ color: '#FF8A1F' }}>
            AI
          </span>
        </div>
      </div>

      <div
        className="rounded-xl p-3 mb-3 text-center"
        style={{
          background: detected
            ? 'rgba(239,68,68,0.08)'
            : 'rgba(34,197,94,0.08)',
          border: detected
            ? '1px solid rgba(239,68,68,0.20)'
            : '1px solid rgba(34,197,94,0.20)',
        }}
      >
        <p className="text-sm font-bold mb-0.5" style={{ color: statusColor }}>
          {detected ? '⚠️ Plateau Detected' : '✅ Progressing Well'}
        </p>
        <p className="text-2xs" style={{ color: 'rgba(255,255,255,0.50)' }}>
          {detected
            ? 'Time to switch up your routine'
            : 'Keep doing what works'}
        </p>
      </div>

      {/* Metrics breakdown */}
      <div className="space-y-2">
        {[
          { label: 'Calories',  ...metrics.calories },
          { label: 'Duration',  ...metrics.duration },
          { label: 'Form',      ...metrics.form     },
        ].map((m) => {
          const change   = m.change_pct;
          const arrow    = change > 0 ? '↑' : change < 0 ? '↓' : '→';
          const color    = change > 2  ? '#4ade80'
                         : change < -2 ? '#f87171'
                         : 'rgba(255,255,255,0.50)';
          return (
            <div key={m.label} className="flex justify-between items-center text-xs">
              <span style={{ color: 'rgba(255,255,255,0.50)' }}>{m.label}</span>
              <div className="flex items-center gap-2">
                <span className="tabular-nums" style={{ color: 'rgba(255,255,255,0.70)' }}>
                  {m.old} → {m.new}
                </span>
                <span className="font-semibold tabular-nums" style={{ color }}>
                  {arrow} {Math.abs(change).toFixed(1)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ── Best workout time widget ──────────────────────────────────────────────────
function BestTime({ data }) {
  if (!data?.available || !data?.best_time) {
    return (
      <EmptyPrediction
        icon={Clock}
        title="Best Workout Time"
        reason={data?.reason || 'Complete more workouts to enable'}
      />
    );
  }

  const meta = TIME_ICONS[data.best_time] || TIME_ICONS.morning;
  const Icon = meta.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="card-glass"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, rgba(255,138,31,0.18), rgba(255,138,31,0.06))',
              border:     '1px solid rgba(255,138,31,0.25)',
            }}
          >
            <Clock className="w-4 h-4" style={{ color: '#FF8A1F' }} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Best Workout Time</h3>
            <p className="text-2xs" style={{ color: 'rgba(255,255,255,0.40)' }}>
              When your form is sharpest
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Sparkles className="w-3 h-3" style={{ color: '#FF8A1F' }} />
          <span className="text-2xs font-semibold" style={{ color: '#FF8A1F' }}>
            AI
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, #FF8A1F, #FFB347)',
            boxShadow:  '0 4px 20px rgba(255,138,31,0.3)',
          }}
        >
          <Icon className="w-7 h-7 text-white" />
        </div>
        <div>
          <p className="text-2xl font-bold tracking-tight text-white capitalize">
            {meta.label}
          </p>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.50)' }}>
            {meta.hours} · {data.best_form}% avg form
          </p>
        </div>
      </div>

      {/* Breakdown */}
      <div className="space-y-1.5">
        {Object.entries(data.breakdown || {}).map(([time, stats]) => {
          const isBest = time === data.best_time;
          return (
            <div
              key={time}
              className="flex justify-between items-center text-xs px-2 py-1.5 rounded-lg"
              style={{
                background: isBest ? 'rgba(255,138,31,0.08)' : 'transparent',
              }}
            >
              <span className="capitalize"
                    style={{
                      color: isBest ? '#FF8A1F' : 'rgba(255,255,255,0.50)',
                      fontWeight: isBest ? 600 : 400,
                    }}>
                {time}
              </span>
              <span className="tabular-nums"
                    style={{ color: 'rgba(255,255,255,0.50)' }}>
                {stats.count} sessions · {stats.avg_form}% form
              </span>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ── Main predictions section ──────────────────────────────────────────────────
export default function PredictionsSection() {
  const [predictions, setPredictions] = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);

  useEffect(() => {
    progressService.getPredictions()
      .then((res) => {
        if (res.data.success) {
          setPredictions(res.data.predictions);
        } else {
          setError(res.data.error || 'Failed to load predictions');
        }
      })
      .catch((err) => {
        console.error('Predictions failed:', err);
        setError('Failed to load predictions');
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="card-glass flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin"
                 style={{ color: 'rgba(255,138,31,0.5)' }} />
        <span className="ml-2 text-sm"
              style={{ color: 'rgba(255,255,255,0.40)' }}>
          Running AI predictions...
        </span>
      </div>
    );
  }

  if (error || !predictions) {
    return null;   // Silently skip if it fails — non-critical
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="space-y-4"
    >
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4" style={{ color: '#FF8A1F' }} />
          <h2 className="text-lg font-bold tracking-tight text-white">
            AI Predictions
          </h2>
        </div>
        <span className="text-2xs" style={{ color: 'rgba(255,255,255,0.30)' }}>
          Based on {predictions.total_sessions} workouts
        </span>
      </div>

      {/* 4-widget grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <CalorieForecast  data={predictions.calorie_forecast} />
        <WeeklyGoal       data={predictions.weekly_goal}      />
        <PlateauDetector  data={predictions.plateau}          />
        <BestTime         data={predictions.best_time}        />
      </div>
    </motion.div>
  );
}