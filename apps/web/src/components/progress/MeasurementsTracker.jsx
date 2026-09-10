import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { Plus, Trash2, Ruler, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import toast from 'react-hot-toast';
import { progressService } from '../../api/progressApi';

// ── Metric config ─────────────────────────────────────────────────────────────
const METRICS = [
  { key: 'weight_kg',      label: 'Weight',       unit: 'kg',  color: '#FF8A1F', icon: '⚖️'  },
  { key: 'body_fat_pct',   label: 'Body Fat',     unit: '%',   color: '#f87171', icon: '📊'  },
  { key: 'waist_cm',       label: 'Waist',        unit: 'cm',  color: '#60a5fa', icon: '📏'  },
  { key: 'chest_cm',       label: 'Chest',        unit: 'cm',  color: '#4ade80', icon: '💪'  },
  { key: 'hips_cm',        label: 'Hips',         unit: 'cm',  color: '#a78bfa', icon: '📐'  },
  { key: 'left_arm_cm',    label: 'Left Arm',     unit: 'cm',  color: '#fbbf24', icon: '💪'  },
  { key: 'right_arm_cm',   label: 'Right Arm',    unit: 'cm',  color: '#fb923c', icon: '💪'  },
  { key: 'left_thigh_cm',  label: 'Left Thigh',   unit: 'cm',  color: '#34d399', icon: '🦵'  },
  { key: 'right_thigh_cm', label: 'Right Thigh',  unit: 'cm',  color: '#38bdf8', icon: '🦵'  },
];

// ── Log form ──────────────────────────────────────────────────────────────────
function LogForm({ onSaved, latest }) {
  const [form,    setForm]    = useState({});
  const [loading, setLoading] = useState(false);
  const [open,    setOpen]    = useState(false);

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const hasData = Object.values(form).some((v) => v !== '' && v !== undefined);
    if (!hasData) { toast.error('Enter at least one measurement'); return; }
    setLoading(true);
    try {
      // New /v1 API (Card 3): @app/shared bodyMeasurementInputSchema (.strict())
      // — weight is a first-class column (Part 4 §3.6 mirrors it into
      // users.weight_kg); every other measurement rides the metrics record.
      const payload = { measuredAt: new Date().toISOString(), metrics: {} };
      for (const [k, v] of Object.entries(form)) {
        if (v === '' || v === undefined) continue;
        // Contract rails (nutrition.ts): weightKg is .multipleOf(0.01) and
        // metrics values are finite().nonnegative() — the free-typed number
        // input guarantees neither (75.555, -1), and a violation is a 400
        // behind a generic toast. Round/guard here instead (T3 Card 3 f.1).
        const n = Math.round(parseFloat(v) * 100) / 100;
        if (!Number.isFinite(n) || n < 0) {
          toast.error('Measurements must be positive numbers');
          setLoading(false);
          return;
        }
        if (k === 'weight_kg') {
          if (n === 0 || n >= 1000) { // schema: .positive().lt(1000)
            toast.error('Enter a valid weight');
            setLoading(false);
            return;
          }
          payload.weightKg = n;
        } else {
          payload.metrics[k] = n;
        }
      }
      await progressService.logMeasurement(payload);
      toast.success('Measurements saved');
      setForm({});
      setOpen(false);
      onSaved();
    } catch {
      toast.error('Failed to save measurements');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-4 py-2 rounded-xl
                   text-sm font-semibold transition-all"
        style={{
          background: open
            ? 'rgba(255,138,31,0.15)'
            : 'linear-gradient(135deg, #FF8A1F, #FFB347)',
          color:     '#fff',
          boxShadow: open ? 'none' : '0 4px 16px rgba(255,138,31,0.25)',
        }}
      >
        <Plus className="w-4 h-4" />
        Log Measurements
      </button>

      <AnimatePresence>
        {open && (
          <motion.form
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{    opacity: 0, height: 0 }}
            onSubmit={handleSubmit}
            className="overflow-hidden"
          >
            <div className="pt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
              {METRICS.map((m) => (
                <div key={m.key}>
                  <label
                    className="block text-2xs font-semibold uppercase
                               tracking-wider mb-1.5"
                    style={{ color: 'rgba(255,255,255,0.45)' }}
                  >
                    {m.icon} {m.label} ({m.unit})
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={form[m.key] || ''}
                      onChange={(e) => set(m.key, e.target.value)}
                      placeholder={latest[m.key]
                        ? `Last: ${latest[m.key]}`
                        : `e.g. ${m.key === 'weight_kg' ? '75' : m.key === 'body_fat_pct' ? '18' : '85'}`}
                      className="w-full px-3 py-2 rounded-xl text-sm focus:outline-none"
                      style={{
                        background: 'rgba(255,255,255,0.04)',
                        border:     '1px solid rgba(255,255,255,0.08)',
                        color:      '#fff',
                      }}
                      onFocus={(e) => e.target.style.borderColor = m.color + '60'}
                      onBlur={(e)  => e.target.style.borderColor = 'rgba(255,255,255,0.08)'}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-4 py-2 rounded-xl text-sm font-semibold"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  color:      'rgba(255,255,255,0.65)',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-5 py-2 rounded-xl text-sm font-semibold text-white"
                style={{
                  background: 'linear-gradient(135deg, #FF8A1F, #FFB347)',
                  opacity: loading ? 0.7 : 1,
                }}
              >
                {loading ? 'Saving...' : 'Save'}
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Trend chip ────────────────────────────────────────────────────────────────
function TrendChip({ current, previous, unit, lowerIsBetter = false }) {
  if (!previous || !current) return null;
  const diff = current - previous;
  if (Math.abs(diff) < 0.1) return null;

  const improved = lowerIsBetter ? diff < 0 : diff > 0;
  const Icon     = diff > 0 ? TrendingUp : TrendingDown;
  const color    = improved ? '#4ade80' : '#f87171';

  return (
    <span
      className="inline-flex items-center gap-0.5 text-2xs font-semibold
                 px-1.5 py-0.5 rounded-full"
      style={{ background: `${color}15`, color }}
    >
      <Icon className="w-2.5 h-2.5" />
      {Math.abs(diff).toFixed(1)}{unit}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function MeasurementsTracker() {
  const [measurements, setMeasurements] = useState([]);
  const [latest,       setLatest]       = useState({});
  const [loading,      setLoading]      = useState(true);
  const [activeMetric, setActiveMetric] = useState('weight_kg');

  const load = async () => {
    try {
      // New /v1 API (Card 3): {items: [{id, measuredAt, weightKg, metrics}],
      // nextCursor}, newest first. Flatten each row back to the flat metric
      // keys this component was built around, and derive `latest` here — the
      // old backend precomputed it; the new contract is data-shaped and leaves
      // display aggregation to the client.
      const res = await progressService.getMeasurements(60);
      // `source` is kept: a weight the person typed on a form (onboarding,
      // profile) is a row of its own, and the ruling says it is marked as such.
      // A typed row is DATED after everything the person has (a weigh-in may
      // be dated up to a day ahead of the clock), so its measuredAt can sit in
      // tomorrow; the day it shows under is the day it was typed (createdAt).
      const rows = (res.data.items || []).map((m) => ({
        id: m.id,
        measured_at: m.measuredAt,
        shown_at: m.source === 'self_reported' && m.createdAt ? m.createdAt : m.measuredAt,
        source: m.source,
        ...(m.weightKg != null ? { weight_kg: m.weightKg } : {}),
        ...m.metrics,
      }));
      const latestByMetric = {};
      for (const row of rows) { // newest first: first non-null value wins
        for (const { key } of METRICS) {
          if (latestByMetric[key] == null && row[key] != null) latestByMetric[key] = row[key];
        }
      }
      setMeasurements(rows);
      setLatest(latestByMetric);
    } catch (err) {
      console.error('Failed to load measurements:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this entry?')) return;
    try {
      await progressService.deleteMeasurement(id);
      toast.success('Deleted');
      load();
    } catch {
      toast.error('Failed to delete');
    }
  };

  // Build chart data for selected metric
  const chartData = [...measurements]
    .filter((m) => m[activeMetric] != null)
    .reverse()
    .map((m) => ({
      date:  m.shown_at
        ? new Date(m.shown_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : '',
      value: m[activeMetric],
    }));

  const activeConfig = METRICS.find((m) => m.key === activeMetric) || METRICS[0];

  // Get previous measurement for trend
  const prevMeasurement = measurements.length > 1
    ? measurements[1][activeMetric]
    : null;

  return (
    <div className="card-glass space-y-5 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Ruler className="w-4 h-4" style={{ color: '#FF8A1F' }} />
          <h3 className="text-sm font-semibold"
              style={{ color: 'rgba(255,255,255,0.80)' }}>
            Body Measurements
          </h3>
        </div>
        <LogForm onSaved={load} latest={latest} />
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-5 h-5 border-2 rounded-full animate-spin"
               style={{ borderColor: 'rgba(255,138,31,0.2)', borderTopColor: '#FF8A1F' }} />
        </div>
      ) : measurements.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.40)' }}>
            No measurements yet. Log your first one above.
          </p>
        </div>
      ) : (
        <>
          {/* Latest stats grid */}
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2">
            {METRICS.filter((m) => latest[m.key] != null).map((m) => {
              const prev = measurements.length > 1
                ? measurements[1][m.key]
                : null;
              return (
                <button
                  key={m.key}
                  onClick={() => setActiveMetric(m.key)}
                  className="rounded-xl p-2.5 text-center transition-all"
                  style={{
                    background: activeMetric === m.key
                      ? `${m.color}15`
                      : 'rgba(255,255,255,0.02)',
                    border: activeMetric === m.key
                      ? `1px solid ${m.color}30`
                      : '1px solid rgba(255,255,255,0.04)',
                  }}
                >
                  <p className="text-xs mb-0.5">{m.icon}</p>
                  <p className="text-sm font-bold tabular-nums"
                     style={{ color: activeMetric === m.key ? m.color : '#fff' }}>
                    {latest[m.key]}{m.unit}
                  </p>
                  <p className="text-2xs"
                     style={{ color: 'rgba(255,255,255,0.35)' }}>
                    {m.label}
                  </p>
                  <div className="mt-1 flex justify-center">
                    <TrendChip
                      current={latest[m.key]}
                      previous={prev}
                      unit={m.unit}
                      lowerIsBetter={['waist_cm', 'hips_cm', 'body_fat_pct'].includes(m.key)}
                    />
                  </div>
                </button>
              );
            })}
          </div>

          {/* Trend chart */}
          {chartData.length > 1 && (
            <div>
              <p className="text-xs font-semibold mb-3"
                 style={{ color: 'rgba(255,255,255,0.50)' }}>
                {activeConfig.icon} {activeConfig.label} Trend
              </p>
              <div style={{ height: 140 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(255,255,255,0.04)"
                    />
                    <XAxis
                      dataKey="date"
                      stroke="rgba(255,255,255,0.25)"
                      fontSize={10}
                      tickLine={false}
                    />
                    <YAxis
                      stroke="rgba(255,255,255,0.25)"
                      fontSize={10}
                      tickLine={false}
                      domain={['auto', 'auto']}
                    />
                    <Tooltip
                      contentStyle={{
                        background:   '#1A1815',
                        border:       `1px solid ${activeConfig.color}40`,
                        borderRadius: 8,
                        fontSize:     11,
                      }}
                      labelStyle={{ color: '#fff' }}
                      itemStyle={{  color: activeConfig.color }}
                      formatter={(v) => [`${v}${activeConfig.unit}`, activeConfig.label]}
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke={activeConfig.color}
                      strokeWidth={2}
                      dot={{ fill: activeConfig.color, r: 3 }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* History log */}
          <div>
            <p className="text-xs font-semibold mb-2"
               style={{ color: 'rgba(255,255,255,0.40)' }}>
              Recent entries
            </p>
            <div className="space-y-1.5">
              {measurements.slice(0, 5).map((m) => {
                const date = m.shown_at
                  ? new Date(m.shown_at).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', year: 'numeric',
                    })
                  : '';
                const logged = METRICS.filter((mk) => m[mk.key] != null);

                return (
                  <div
                    key={m.id}
                    className="group flex items-center justify-between py-2 px-3
                               rounded-xl transition-all"
                    style={{ background: 'rgba(255,255,255,0.02)' }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-white">
                        {date}
                        {m.source === 'self_reported' && (
                          <span className="ml-2 font-normal"
                                style={{ color: 'rgba(255,255,255,0.40)' }}>
                            typed by me
                          </span>
                        )}
                      </p>
                      <p className="text-2xs truncate"
                         style={{ color: 'rgba(255,255,255,0.40)' }}>
                        {logged.length > 0
                          ? logged.map((mk) => `${mk.label}: ${m[mk.key]}${mk.unit}`).join(' · ')
                          : m.source === 'self_reported' ? 'Weight cleared' : 'No values'}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDelete(m.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity
                                 p-1.5 rounded-lg ml-2"
                      style={{ color: 'rgba(239,68,68,0.7)' }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}