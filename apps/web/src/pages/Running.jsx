import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { motion } from 'framer-motion';
import {
  Footprints, MapPin, Calendar, Trophy, Flame, Clock,
  TrendingUp, Plus, ChevronRight, CloudRain, Trash2, Sparkles, Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { runningService } from '../api/runningApi';

const ACCENT = '#FF8A1F';
const EASE = [0.22, 1, 0.36, 1];

function AnimatedNumber({ value, duration = 1400, suffix = '', decimals = 0 }) {
  const [display, setDisplay] = useState(0);
  const startTime = useRef(null);
  const rafRef = useRef(null);
  useEffect(() => {
    if (value == null) return;
    startTime.current = null;
    const animate = (t) => {
      if (!startTime.current) startTime.current = t;
      const p = Math.min((t - startTime.current) / duration, 1);
      setDisplay((1 - Math.pow(1 - p, 3)) * value);
      if (p < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);
  return <span>{display.toFixed(decimals)}{suffix}</span>;
}

function fmtPace(sec) {
  if (!sec) return '--';
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

function RunWeekStrip({ activity = {} }) {
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const today = new Date();
  const dayIdx = (today.getDay() + 6) % 7;
  return (
    <div className="flex gap-1.5">
      {days.map((d, i) => {
        const date = new Date(today);
        date.setDate(today.getDate() - dayIdx + i);
        const key = date.toISOString().split('T')[0];
        const isToday = i === dayIdx;
        const done = !!activity[key];
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <span className="text-2xs font-bold" style={{ color: isToday ? ACCENT : 'rgba(255,255,255,0.4)' }}>{d}</span>
            <div className="w-7 h-7 rounded-full flex items-center justify-center"
                 style={{
                   background: done ? 'linear-gradient(135deg,#FF8A1F,#FFB347)'
                     : isToday ? 'rgba(255,138,31,0.2)' : 'rgba(255,255,255,0.06)',
                   boxShadow: done ? '0 0 10px rgba(255,138,31,0.4)' : 'none',
                   border: isToday && !done ? '1px solid rgba(255,138,31,0.5)' : '1px solid transparent',
                 }}>
              {done ? <Flame className="w-3.5 h-3.5 text-white" />
                : <span className="text-2xs font-bold" style={{ color: 'rgba(255,255,255,0.3)' }}>{date.getDate()}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatTile({ icon: Icon, label, value, suffix, decimals, color, delay }) {
  return (
    <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5, ease: EASE }}
      className="rounded-2xl p-4" style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3"
           style={{ background: color + '25', border: `1px solid ${color}40` }}>
        <Icon className="w-4 h-4" style={{ color }} />
      </div>
      <p className="text-2xl font-black tracking-tighter tabular-nums text-white">
        <AnimatedNumber value={value} suffix={suffix || ''} decimals={decimals || 0} />
      </p>
      <p className="text-2xs mt-0.5 font-medium uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.45)' }}>{label}</p>
    </motion.div>
  );
}

function WeatherBadge({ weather }) {
  if (!weather || weather.risk === 'none' || weather.risk === 'unknown') return null;
  const colors = { low: '#FFD66B', moderate: '#FF8A1F', high: '#ef4444' };
  return (
    <span className="inline-flex items-center gap-1 text-2xs px-2 py-1 rounded-lg"
          style={{ background: 'rgba(255,255,255,0.06)', color: colors[weather.risk] || '#FFD66B' }}>
      <CloudRain className="w-3 h-3" /> {weather.flags?.[0] || weather.summary}
    </span>
  );
}

export default function Running() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [stats, setStats]         = useState(null);
  const [schedules, setSchedules] = useState([]);
  const [sessions, setSessions]   = useState([]);
  const [loading, setLoading]     = useState(true);

  const load = async () => {
    try {
      const [s, sch, ses] = await Promise.all([
        runningService.getStats(), runningService.getSchedule(), runningService.getSessions(5),
      ]);
      setStats(s.data.stats);
      setSchedules(sch.data.schedules || []);
      setSessions(ses.data.sessions || []);
    } catch { toast.error('Could not load running data'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const cancel = async (id) => {
    try {
      await runningService.cancelSchedule(id);
      setSchedules((p) => p.filter((s) => s.id !== id));
      toast.success('Run cancelled');
    } catch { toast.error('Could not cancel'); }
  };

  const upcoming = schedules.filter((s) => !s.is_past);
  const name = user?.displayName?.split(' ')[0] || 'runner';
  const streak = stats?.running_streak ?? 0;

  const activity = {};
  sessions.forEach((s) => { if (s.completed_at) activity[s.completed_at.split('T')[0]] = true; });

  return (
    <div className="max-w-5xl mx-auto pb-12">
      {/* ── FULL-BLEED HERO (img12) ───────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.7 }}
        className="relative overflow-hidden"
        style={{ height: 'min(72vh, 640px)', borderRadius: 0 }}>
        <img src="/running/hero.png" alt="Run"
             className="absolute inset-0 w-full h-full"
             style={{ objectFit: 'cover', objectPosition: 'center 25%' }} />
        {/* Dark gradient for legibility */}
        <div className="absolute inset-0"
             style={{ background: 'linear-gradient(180deg, rgba(10,9,8,0.5) 0%, rgba(10,9,8,0.05) 40%, rgba(10,9,8,0.4) 70%, rgba(10,9,8,0.92) 100%)' }} />
        {/* Orange glow accent */}
        <div className="absolute -bottom-20 -left-20 w-72 h-72 rounded-full pointer-events-none"
             style={{ background: 'radial-gradient(circle, rgba(255,138,31,0.22), transparent 70%)' }} />

        <div className="relative z-10 flex flex-col justify-end p-6" style={{ height: '100%' }}>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, ease: EASE }}>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4" style={{ color: ACCENT }} />
              <span className="text-2xs font-black uppercase tracking-[0.2em]" style={{ color: ACCENT }}>
                {greeting()}, {name}
              </span>
            </div>
            <h1 className="text-5xl md:text-6xl font-black tracking-tighter text-white leading-[0.95] mb-2"
                style={{ textShadow: '0 2px 20px rgba(0,0,0,0.6)' }}>
              OWN<br />THE ROAD.
            </h1>
            <p className="text-sm mb-5 max-w-xs" style={{ color: 'rgba(255,255,255,0.75)' }}>
              {streak > 0 ? `🔥 ${streak}-day streak. Keep it alive.` : 'Lace up. Your first run is the hardest — and the best.'}
            </p>
            <motion.button whileTap={{ scale: 0.96 }} onClick={() => navigate('/running/plan')}
              className="inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl font-black text-white"
              style={{ background: 'linear-gradient(90deg,#FF8A1F,#FFB347)', boxShadow: '0 6px 24px rgba(255,138,31,0.5)' }}>
              <Plus className="w-5 h-5" /> PLAN A RUN
            </motion.button>
          </motion.div>
        </div>
      </motion.div>

      <div className="px-5 pt-5">
        {loading ? (
          <p style={{ color: 'rgba(255,255,255,0.4)' }}>Loading…</p>
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <StatTile icon={Footprints} label="Total runs" value={stats?.total_runs ?? 0} color={ACCENT} delay={0.05} />
              <StatTile icon={TrendingUp} label="Distance km" value={stats?.total_distance_km ?? 0} decimals={1} color="#60a5fa" delay={0.1} />
              <StatTile icon={Flame} label="Run streak" value={streak} color="#ef4444" delay={0.15} />
              <StatTile icon={Trophy} label="Run level" value={stats?.running_level ?? 1} color="#FFD66B" delay={0.2} />
            </div>

            {/* Week strip + PRs */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
              <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, ease: EASE }}
                className="rounded-2xl p-4" style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>This week</span>
                  <Calendar className="w-4 h-4" style={{ color: ACCENT }} />
                </div>
                <RunWeekStrip activity={activity} />
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, ease: EASE }}
                className="rounded-2xl p-4 flex items-center justify-around" style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="text-center">
                  <p className="text-xl font-black text-white tabular-nums">{stats?.longest_run_km ?? 0}<span className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.4)' }}> km</span></p>
                  <p className="text-2xs uppercase tracking-wider mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Longest</p>
                </div>
                <div className="w-px h-10" style={{ background: 'rgba(255,255,255,0.08)' }} />
                <div className="text-center">
                  <p className="text-xl font-black tabular-nums" style={{ color: ACCENT }}>{fmtPace(stats?.best_pace_sec_km)}<span className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.4)' }}> /km</span></p>
                  <p className="text-2xs uppercase tracking-wider mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Best pace</p>
                </div>
              </motion.div>
            </div>

            {/* Upcoming */}
            <h2 className="text-base font-bold text-white mb-3 flex items-center gap-2">
              <Calendar className="w-4 h-4" style={{ color: ACCENT }} /> Upcoming runs
            </h2>
            {upcoming.length === 0 ? (
              /* Motivational empty state with img11 */
              <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
                className="relative overflow-hidden rounded-3xl mb-6" style={{ height: 300 }}>
                <img src="/running/run-city.png" alt="" className="absolute inset-0 w-full h-full"
                     style={{ objectFit: 'cover', objectPosition: 'center' }} />
                <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(10,9,8,0.3) 0%, rgba(10,9,8,0.55) 55%, rgba(10,9,8,0.95) 100%)' }} />
                <div className="relative z-10 h-full flex flex-col justify-end p-6 max-w-sm">
                  <p className="text-white font-black text-2xl leading-tight mb-1">Nothing scheduled.</p>
                  <p className="text-sm mb-3" style={{ color: 'rgba(255,255,255,0.75)' }}>The road's waiting. Plan your next run.</p>
                  <button onClick={() => navigate('/running/plan')}
                          className="self-start px-4 py-2 rounded-xl text-sm font-bold text-white"
                          style={{ background: ACCENT }}>Plan a run</button>
                </div>
              </motion.div>
            ) : (
              <div className="space-y-3 mb-6">
                {upcoming.map((s) => (
                  <motion.div key={s.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                    className="rounded-2xl p-4" style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-white font-bold">{s.target_km} km run</p>
                        <p className="text-2xs mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                          {new Date(s.scheduled_at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          {s.recurrence !== 'none' && ` · repeats ${s.recurrence}`}
                        </p>
                        <div className="mt-2"><WeatherBadge weather={s.weather} /></div>
                      </div>
                      <div className="flex items-center gap-2">
                        <motion.button whileTap={{ scale: 0.94 }}
                          onClick={() => navigate(`/running/active?schedule=${s.id}&km=${s.target_km}` + (s.route_id ? `&route=${s.route_id}` : ''))}
                          className="px-4 py-2 rounded-xl text-sm font-bold text-white"
                          style={{ background: 'linear-gradient(90deg,#FF8A1F,#FFB347)' }}>Start</motion.button>
                        <button onClick={() => cancel(s.id)} className="p-2 rounded-xl" style={{ background: 'rgba(255,255,255,0.06)' }}>
                          <Trash2 className="w-4 h-4" style={{ color: '#ef4444' }} />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}

            {/* Motivational band with img14 */}
            <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
              className="relative overflow-hidden rounded-3xl mb-6" style={{ height: 280 }}>
              <img src="/running/run-women.png" alt="" className="absolute inset-0 w-full h-full"
                   style={{ objectFit: 'cover', objectPosition: 'center' }} />
              <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(10,9,8,0.15) 0%, rgba(10,9,8,0.2) 50%, rgba(10,9,8,0.85) 100%)' }} />
              <div className="relative z-10 h-full flex flex-col justify-end items-end text-right p-6">
                <Zap className="w-5 h-5 mb-1" style={{ color: ACCENT }} />
                <p className="text-white font-black text-3xl leading-none" style={{ textShadow: '0 2px 12px rgba(0,0,0,0.5)' }}>EVERY KM<br/>COUNTS.</p>
              </div>
            </motion.div>

            {/* Trail band with img13 */}
            <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
              className="relative overflow-hidden rounded-3xl mb-6" style={{ height: 280 }}>
              <img src="/running/run-trail.png" alt="" className="absolute inset-0 w-full h-full"
                   style={{ objectFit: 'cover', objectPosition: 'center' }} />
              <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(10,9,8,0.15) 0%, rgba(10,9,8,0.25) 50%, rgba(10,9,8,0.88) 100%)' }} />
              <div className="relative z-10 h-full flex flex-col justify-end p-6">
                <Footprints className="w-5 h-5 mb-1" style={{ color: ACCENT }} />
                <p className="text-white font-black text-3xl leading-none" style={{ textShadow: '0 2px 12px rgba(0,0,0,0.5)' }}>FIND YOUR<br/>PACE.</p>
              </div>
            </motion.div>

            {/* Recent */}
            <h2 className="text-base font-bold text-white mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4" style={{ color: ACCENT }} /> Recent runs
            </h2>
            {sessions.length === 0 ? (
              <div className="rounded-2xl p-6 text-center" style={{ background: '#121110', border: '1px dashed rgba(255,255,255,0.1)' }}>
                <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>No runs yet. Your first one's waiting. 🏃</p>
              </div>
            ) : (
              <div className="space-y-2">
                {sessions.map((s, i) => (
                  <motion.button key={s.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }}
                    whileTap={{ scale: 0.99 }} onClick={() => navigate(`/running/summary/${s.id}`)}
                    className="w-full rounded-2xl p-4 flex items-center justify-between text-left"
                    style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,138,31,0.15)' }}>
                        <MapPin className="w-5 h-5" style={{ color: ACCENT }} />
                      </div>
                      <div>
                        <p className="text-white font-bold tabular-nums">{s.distance_km} km</p>
                        <p className="text-2xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                          {new Date(s.completed_at).toLocaleDateString()} · {fmtPace(s.avg_pace_sec_km)}/km · {s.calories_burned} kcal
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5" style={{ color: 'rgba(255,255,255,0.3)' }} />
                  </motion.button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
