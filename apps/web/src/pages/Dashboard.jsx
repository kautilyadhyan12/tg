import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTransition } from '../context/TransitionContext';
import { workoutService } from '../api/workoutApi';
import { recommendationService } from '../api/recommendationApi';
import {
  UNKNOWN, formatCount, formatLevel, formatNextLevel, formatXpFraction,
  formatXpTotal, difficultyColor, oldPayloadState, orUnknown, readRecommendations,
  readStatsView, xpBarWidth,
} from '../api/gamificationApi';
import { useXp } from '../hooks/useXp';
import GamificationStrip from '../components/dashboard/GamificationStrip';
import { motion } from 'framer-motion';
import {
  Flame, Dumbbell, Clock, TrendingUp,
  ChevronRight, Play, Zap, Trophy,
  Calendar, ArrowRight, Sparkles,
} from 'lucide-react';

// ── Animated counter ──────────────────────────────────────────────────────────
function AnimatedNumber({ value, duration = 1500, suffix = '' }) {
  const [display, setDisplay] = useState(0);
  const startTime = useRef(null);
  const rafRef    = useRef(null);

  useEffect(() => {
    if (!value) return;
    startTime.current = null;
    const animate = (timestamp) => {
      if (!startTime.current) startTime.current = timestamp;
      const progress = Math.min((timestamp - startTime.current) / duration, 1);
      const ease     = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.floor(ease * value));
      if (progress < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  return <span>{display.toLocaleString()}{suffix}</span>;
}

// ── Week calendar strip ───────────────────────────────────────────────────────
/** `activity` is a date-keyed object, or NULL when we do not know.
 *
 *  ROUND 4 F3: this used to default to `{}`, so an unknown week rendered all
 *  seven dots in their NOT-TRAINED state — a visual "you trained on none of
 *  these days", which is seven claims — directly beside a caption that correctly
 *  read "Weekly activity unavailable". Two standards eight inches apart, and the
 *  same fabrication class the two XP cards exist to delete: GamificationStrip
 *  already applies the honest rule to its own empty list ("an empty list would
 *  read as 'no challenges this week', which is a claim we cannot make").
 *
 *  Unknown now has its OWN look — dashed outline, no fill, no flame — so the
 *  strip asserts nothing about any day. It is deliberately not an empty box or a
 *  hidden component: the days of the week are knowable and the shape stays. */
function WeekStrip({ activity }) {
  const days   = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const today  = new Date();
  const dayIdx = (today.getDay() + 6) % 7;
  const known  = activity !== null && activity !== undefined;

  return (
    <div className="flex gap-2">
      {days.map((day, i) => {
        const date    = new Date(today);
        date.setDate(today.getDate() - dayIdx + i);
        const dateStr = date.toISOString().split('T')[0];
        const isToday = i === dayIdx;
        const isDone  = known && !!activity[dateStr];
        const isPast  = i < dayIdx;

        return (
          <div key={day} className="flex-1 flex flex-col items-center gap-1.5">
            <span className="text-2xs font-medium uppercase tracking-wider"
                  style={{ color: isToday ? '#FF8A1F' : 'rgba(255,255,255,0.5)' }}>
              {day}
            </span>
            <div className="w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300"
                 title={known ? undefined : 'Activity unavailable'}
                 style={{
                   background: !known ? 'transparent'
                     : isDone ? 'linear-gradient(135deg, #FF8A1F, #FFB347)'
                     : isToday ? 'rgba(255,138,31,0.25)' : 'rgba(255,255,255,0.08)',
                   border: !known ? '1px dashed rgba(255,255,255,0.20)'
                     : isToday && !isDone ? '1px solid rgba(255,138,31,0.6)' : '1px solid transparent',
                   boxShadow: isDone ? '0 0 12px rgba(255,138,31,0.4)' : 'none',
                 }}>
              {isDone ? (
                <Flame className="w-3.5 h-3.5 text-white" />
              ) : (
                <span className="text-xs font-bold" style={{
                  color: !known ? 'rgba(255,255,255,0.22)'
                    : isToday ? '#FF8A1F' : isPast ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.4)',
                }}>
                  {date.getDate()}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── XP bar ────────────────────────────────────────────────────────────────────
/** Takes the WHOLE xp block from useXp (or null), never loose numbers.
 *
 *  It used to take `xp`/`level` as numbers defaulting to 0/1 and compute
 *  `xp % 100` — i.e. it assumed every level costs exactly 100 XP. The real
 *  curve is `floor(100 * (level-1)^1.8)` (badges.py:215-227), so levels cost
 *  100, 248, 374, … and that bar was wrong for every user above level 2. The
 *  server already sends the position within the level, so nothing here
 *  computes anything: no `% 100`, no defaults, no XP arithmetic (R3.1 / the
 *  Kd ruling of 2026-07-26). Unknown renders as a dash, not a Level 1. */
function XPBar({ xp }) {
  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5" style={{ color: '#FF8A1F' }} />
          <span className="text-xs font-medium" style={{ color: '#FF8A1F' }}>
            Level {formatLevel(xp)}
          </span>
        </div>
        <span className="text-2xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
          {formatXpFraction(xp)} XP → Level {formatNextLevel(xp)}
        </span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: 'linear-gradient(90deg, #FF8A1F, #FFB347)' }}
          initial={{ width: 0 }}
          animate={{ width: xpBarWidth(xp) }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1], delay: 0.5 }}
        />
      </div>
    </div>
  );
}

// ── Quotes ────────────────────────────────────────────────────────────────────
const QUOTES = [
  { text: "The only bad workout is the one that didn't happen.", author: "Unknown" },
  { text: "Strength does not come from the body. It comes from the will.", author: "Gandhi" },
  { text: "Take care of your body. It's the only place you have to live.", author: "Jim Rohn" },
  { text: "The pain you feel today will be the strength you feel tomorrow.", author: "Arnold Schwarzenegger" },
  { text: "Your body can stand almost anything. It's your mind you have to convince.", author: "Unknown" },
  { text: "Fitness is not about being better than someone else. It's about being better than you used to be.", author: "Khloe Kardashian" },
  { text: "The difference between the impossible and the possible lies in determination.", author: "Tommy Lasorda" },
];

const getQuote    = () => QUOTES[new Date().getDay() % QUOTES.length];
const getGreeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, suffix, sub, color, delay = 0, bgImage }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-2xl"
      style={{ minHeight: 150, background: '#121110', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      {bgImage && (
        <img src={bgImage} alt=""
          className="absolute top-0 right-0 h-full pointer-events-none"
          style={{ width: '65%', objectFit: 'contain', objectPosition: 'right center', opacity: 0.95 }} />
      )}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'linear-gradient(90deg, #121110 0%, #121110 30%, rgba(18,17,16,0.7) 50%, rgba(18,17,16,0.1) 100%)',
      }} />
      <div className="relative z-10 p-4 flex flex-col justify-between h-full" style={{ minHeight: 150 }}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center"
             style={{ background: color + '25', border: `1px solid ${color}40` }}>
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
        <div className="mt-3">
          <p className="text-2xl font-bold tracking-tighter tabular-nums text-white">
            {typeof value === 'number'
              ? <AnimatedNumber value={value} suffix={suffix || ''} />
              : value}
          </p>
          <p className="text-xs mt-0.5 font-medium" style={{ color: 'rgba(255,255,255,0.65)' }}>{label}</p>
          {sub && <p className="text-2xs mt-0.5" style={{ color: 'rgba(255,255,255,0.40)' }}>{sub}</p>}
        </div>
      </div>
    </motion.div>
  );
}

// ── BgCard — image right side, text left ─────────────────────────────────────
function BgCard({ bgImage, children, className = '', style = {}, imageWidth = '40%' }) {
  return (
    <div className={'relative overflow-hidden rounded-2xl ' + className}
         style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.08)', ...style }}>
      {bgImage && (
        <img src={bgImage} alt=""
             className="absolute top-0 right-0 h-full pointer-events-none"
             style={{ width: imageWidth, objectFit: 'contain', objectPosition: 'right center', opacity: 0.85 }} />
      )}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'linear-gradient(90deg, #121110 0%, #121110 45%, rgba(18,17,16,0.7) 65%, rgba(18,17,16,0.2) 100%)',
      }} />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

// ── HeroCard — full cover image, light overlay, text shadow ──────────────────
function HeroCard({ bgImage, children, className = '', onClick, fixedHeight }) {
  return (
    <motion.div
      whileHover={onClick ? { scale: 1.015 } : undefined}
      whileTap={onClick ? { scale: 0.985 } : undefined}
      onClick={onClick}
      className={'relative overflow-hidden rounded-2xl ' + className}
      style={{
        height:  fixedHeight || undefined,
        cursor:  onClick ? 'pointer' : 'default',
        border:  'none',
      }}
    >
      {bgImage && (
        <img src={bgImage} alt=""
             className="absolute inset-0 w-full h-full"
             style={{ objectFit: 'cover', objectPosition: 'center' }} />
      )}
      <div className="absolute inset-0" style={{
        background: 'linear-gradient(135deg, rgba(10,9,8,0.55) 0%, rgba(10,9,8,0.30) 50%, rgba(10,9,8,0.15) 100%)',
      }} />
      <div className="relative z-10 h-full">{children}</div>
    </motion.div>
  );
}

// ── Shared text shadow for readability over images ────────────────────────────
const TS = { textShadow: '0 1px 6px rgba(0,0,0,0.9)' };

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { user } = useAuth();
  // XP/level come from the NEW API (GET /v1/gamification/me), not from
  // workoutService.getStats — that old-backend payload's `xp`/`level` are the
  // ones that rendered a fabricated "Level 1 / 0 XP earned" for everyone here.
  const { xp } = useXp();
  const navigate = useNavigate();
  const { triggerTransition } = useTransition();
  const quote    = getQuote();
  const greeting = getGreeting();

  const [statsRaw,        setStatsRaw]        = useState(null);
  const [loading,         setLoading]         = useState(true);
  // NULL = not known yet / read failed; [] = genuinely none. Round 6 F9 is the
  // same distinction for `recent`: `?? []` collapsed three states into two, so
  // a failed read looked exactly like a brand-new account with no workouts.
  const [recommendations, setRecommendations] = useState(null);
  // ROUND 7 F1: recommendations needs its OWN settled flag. Round 6 derived
  // `recsState` from `loading`, which only the getStats chain sets — so the
  // recommendations read had no way to move its own state. Both failure modes
  // this card exists to delete reproduced at once: stats settling first while
  // recommendations were still in flight printed "unavailable" (a false denial
  // during a healthy load, the defect oldPayloadState was written to remove),
  // and a hanging stats read with failed recommendations printed "Loading…"
  // forever (round 5 F1, the defect listState was written to remove). A state
  // must never borrow another read's knowability — that is round 6 F1's rule,
  // and this is the seventh consecutive round where the previous fix opened it.
  const [recsLoading, setRecsLoading] = useState(true);

  useEffect(() => {
    // ROUND 5 security pass (R3.10): these two were `.catch(console.error)`,
    // which hands the WHOLE axios error to the console — and its `.config
    // .headers` carries the `Authorization: Bearer <token>` that mlApi's request
    // interceptor sets. GamificationStrip and Achievements fixed exactly this
    // and cite R3.10; these two were left behind in the same commit. That it is
    // harmless today only because Card 1 stopped writing localStorage is a
    // mitigation, not a fix.
    workoutService.getStats()
      .then((res) => setStatsRaw(res.data))
      .catch((err) => console.error('stats read failed:', err?.message))
      .finally(() => setLoading(false));
    // ROUND 6 F2: this was `res.data.recommendations || []`, which accepts ANY
    // type — a string, an object — and `.slice(0,6).map(...)` below then threw,
    // blanking the ENTIRE Dashboard including the XP header. With no
    // ErrorBoundary in apps/web that is T3 finding ① by a fourth route, and the
    // file's own comments cite that hazard three times while leaving this live.
    recommendationService.getRecommendations(6)
      .then((res) => setRecommendations(readRecommendations(res.data)))
      .catch((err) => console.error('recommendations read failed:', err?.message))
      .finally(() => setRecsLoading(false));
  }, []);

  // The old read fails on this branch permanently (mlApi's Bearer comes from
  // localStorage, which Card 1 no longer writes), so EVERY figure below is
  // unknown in the state Kd actually sees.
  //
  // ROUND 4 F2: the previous fix was `statsKnown = Boolean(stats?.stats)` —
  // which asserted the ENVELOPE arrived, then six sites read fields off it with
  // `?? 0`. A 200 carrying `{stats:{}}`, or any subset with `total_minutes`
  // missing, printed "0 workouts / 0h / 0 kcal" as fact. That is verbatim the
  // shape round 3 had just deleted from GamificationStrip and Achievements
  // (Boolean(data) → badgesKnown/challengesKnown) and shipped here in the SAME
  // commit. The code carried its own admission: if those fields could never be
  // missing, the `?? 0` operators would be dead.
  //
  // Per-field now, via the same reader treatment the new API's payload gets —
  // so there is no envelope gate left to be wrong, and `?? 0` appears nowhere.
  const stats  = readStatsView(statsRaw);
  // ROUND 6 F9: `stats.recent ?? []` then `.length > 0` made a FAILED read
  // indistinguishable from a genuine zero-workout account — the card simply
  // vanished. Three states, like everywhere else on this page.
  // Each read answers with its OWN settled flag (round 7 F1). `oldPayloadState`
  // is the tested function for exactly this shape, so both go through it rather
  // than repeating the ternary and getting one of them wrong again.
  const recent      = stats.recent;
  const recentState = oldPayloadState({ data: recent,          loading });
  const recsState   = oldPayloadState({ data: recommendations, loading: recsLoading });
  const hours  = stats.totalMinutes === null
    ? null
    : Math.round((stats.totalMinutes / 60) * 10) / 10;

  return (
    <div className="min-h-screen p-6 relative" style={{ background: '#0A0908' }}>
      <div className="fixed pointer-events-none" style={{
        top: -200, right: -200, width: 600, height: 600,
        background: 'radial-gradient(ellipse, rgba(255,138,31,0.06) 0%, transparent 70%)',
        zIndex: 0,
      }} />

      <div className="max-w-6xl mx-auto relative z-10 space-y-6">

        {/* ── Header ────────────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex items-start justify-between"
        >
          <div>
            <p className="text-sm font-medium mb-1" style={{ color: 'rgba(255,255,255,0.35)' }}>
              {greeting}
            </p>
            <h1 className="text-4xl font-bold tracking-tighter" style={{ color: 'rgba(255,255,255,0.95)' }}>
              {user?.displayName?.split(' ')[0] || 'Athlete'}
            </h1>
            {stats.streak !== null && stats.streak > 0 && (
              <div className="flex items-center gap-1.5 mt-2">
                <Flame className="w-4 h-4" style={{ color: '#FF8A1F' }} />
                <span className="text-sm font-semibold" style={{ color: '#FF8A1F' }}>
                  {stats.streak} day streak
                </span>
                <span className="text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>— keep it going!</span>
              </div>
            )}
          </div>
          <motion.button
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
            onClick={() => triggerTransition(() => navigate('/exercises'))}
            className="flex items-center gap-2 px-5 py-3 rounded-2xl font-semibold text-sm text-white"
            style={{ background: 'linear-gradient(135deg, #FF8A1F, #FFB347)', boxShadow: '0 4px 20px rgba(255,138,31,0.35)' }}
          >
            <Play className="w-4 h-4" />
            Start Workout
          </motion.button>
        </motion.div>

        {/* ── Hero banner ───────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1, duration: 0.6 }}
          className="relative overflow-hidden rounded-3xl cursor-pointer"
          style={{ height: 740 }}
          onClick={() => triggerTransition(() => navigate('/exercises'))}
        >
          <img src="/images/exercises/lifting.jpg" alt="Training"
               className="w-full h-full object-cover" style={{ objectPosition: 'center 30%' }} />
          <div className="absolute inset-0" style={{
            background: 'linear-gradient(90deg, rgba(10,9,8,0.95) 0%, rgba(10,9,8,0.5) 50%, rgba(10,9,8,0.1) 100%)',
          }} />
          <div className="absolute inset-0" style={{
            background: 'radial-gradient(ellipse at 20% 50%, rgba(255,138,31,0.12) 0%, transparent 60%)',
          }} />
          <div className="absolute inset-0 flex items-center p-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: '#FF8A1F' }}>
                Today's Focus
              </p>
              <h2 className="text-3xl font-bold tracking-tighter mb-3" style={{ color: 'rgba(255,255,255,0.95)' }}>
                Precision Training<br />Powered by AI.
              </h2>
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold w-fit"
                    style={{ background: 'rgba(255,138,31,0.15)', border: '1px solid rgba(255,138,31,0.25)', color: '#FFB347' }}>
                <Sparkles className="w-3 h-3" />
                AI Form Detection Active
              </span>
            </div>
          </div>
          <div className="absolute right-6 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center"
               style={{ background: 'rgba(255,138,31,0.15)', border: '1px solid rgba(255,138,31,0.25)' }}>
            <ArrowRight className="w-5 h-5" style={{ color: '#FF8A1F' }} />
          </div>
        </motion.div>

        {/* ── Stats grid ────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={Dumbbell} label="Total Workouts" value={orUnknown(stats.totalWorkouts)} sub="all time" color="#FF8A1F" delay={0.15} bgImage="/images/dashboard/totalworkout.png" />
          <StatCard icon={Clock} label="Hours Trained" value={orUnknown(hours)} suffix="h" sub={stats.totalMinutes === null ? undefined : `${stats.totalMinutes} minutes`} color="#60a5fa" delay={0.2} bgImage="/images/dashboard/hourstrained.png" />
          <StatCard icon={Flame} label="Calories Burned" value={orUnknown(stats.totalCalories)} sub="kcal total" color="#f97316" delay={0.25} bgImage="/images/dashboard/caloriesburned.png" />
          <StatCard icon={Trophy} label="Current Level" value={`Level ${formatLevel(xp)}`} sub={`${formatXpTotal(xp)} XP earned`} color="#FFD66B" delay={0.3} bgImage="/images/dashboard/currentlevel.png" />
        </div>

        {/* ── XP + Week strip ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.5 }}>
            <BgCard bgImage="/images/dashboard/experiencepoints.png" className="h-full p-5" imageWidth="35%">
              <div className="flex items-center gap-2 mb-4">
                <Zap className="w-4 h-4" style={{ color: '#FF8A1F' }} />
                <h3 className="text-sm font-semibold text-white">Experience Points</h3>
              </div>
              <div style={{ maxWidth: '65%' }}>
                <XPBar xp={xp} />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3" style={{ maxWidth: '65%' }}>
                {[
                  { label: 'This week', value: formatCount(stats.weeklyWorkouts), sub: 'workouts' },
                  { label: 'Streak',    value: formatCount(stats.streak),         sub: 'days' },
                  { label: 'Level',     value: formatLevel(xp),                   sub: 'current' },
                ].map(({ label, value, sub }) => (
                  <div key={label} className="text-center">
                    <p className="text-xl font-bold tracking-tighter tabular-nums" style={{ color: '#FF8A1F' }}>{value}</p>
                    <p className="text-2xs" style={{ color: 'rgba(255,255,255,0.50)' }}>{sub}</p>
                  </div>
                ))}
              </div>
            </BgCard>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.5 }}>
            <BgCard bgImage="/images/dashboard/thisweek.png" className="h-full p-5" imageWidth="30%">
              <div className="flex items-center gap-2 mb-4">
                <Calendar className="w-4 h-4" style={{ color: '#FF8A1F' }} />
                <h3 className="text-sm font-semibold text-white">This Week</h3>
              </div>
              <div style={{ maxWidth: '70%' }}>
                <WeekStrip activity={stats.activity} />
                {/* ROUND 5 F8: the caption was gated on `weeklyWorkouts` and the
                    dots on `activity` — two different fields, so one could say
                    "3 of 7 days active" beside seven dashed UNKNOWN dots, or
                    "unavailable" beside real flames. Round 4 F3's "two standards
                    eight inches apart", unfixed in the other direction. The
                    caption now speaks only when BOTH are known. */}
                <p className="text-xs mt-4 text-center" style={{ color: 'rgba(255,255,255,0.50)' }}>
                  {stats.weeklyWorkouts === null || stats.activity === null
                    ? 'Weekly activity unavailable'
                    : `${stats.weeklyWorkouts} of 7 days active`}
                </p>
              </div>
            </BgCard>
          </motion.div>
        </div>

        {/* ── Quick actions + Daily Motivation ──────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { label: 'Browse Exercises', icon: Dumbbell,   path: '/exercises', image: '/images/exercises/weight.jpg',  color: '#FF8A1F' },
            { label: 'View Progress',    icon: TrendingUp, path: '/progress',  image: '/images/wellness/running.jpg',  color: '#60a5fa' },
            { label: 'Ask AI Coach',     icon: Sparkles,   path: '/coach',     image: '/images/wellness/yoga.jpg',     color: '#a78bfa' },
          ].map(({ label, icon: Icon, path, image, color }, idx) => (
            <motion.div
              key={path}
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 + idx * 0.05, duration: 0.5 }}
            >
              <HeroCard bgImage={image} fixedHeight={420} onClick={() => triggerTransition(() => navigate(path))}>
                <div className="flex flex-col justify-end h-full p-4">
                  <Icon className="w-4 h-4 mb-1.5" style={{ color }} />
                  <p className="text-xs font-semibold text-white leading-tight" style={TS}>{label}</p>
                </div>
              </HeroCard>
            </motion.div>
          ))}

          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.5 }}
          >
            <BgCard bgImage="/images/dashboard/dailymotivation.png"
                    className="h-full p-5 flex flex-col justify-between"
                    style={{ minHeight: 420 }} imageWidth="55%">
              <div style={{ maxWidth: '60%' }}>
                <p className="text-2xs uppercase tracking-widest font-semibold mb-3" style={{ color: '#FF8A1F' }}>
                  Daily Motivation
                </p>
                <p className="text-sm leading-relaxed italic text-white">"{quote.text}"</p>
              </div>
              <p className="text-2xs mt-4" style={{ color: 'rgba(255,255,255,0.50)' }}>— {quote.author}</p>
            </BgCard>
          </motion.div>
        </div>

        {/* ── Gamification strip ────────────────────────────────────────────── */}
        <GamificationStrip />

        {/* ── Recommended For You + Recent Workouts ─────────────────────────── */}
        {/* ROUND 7 F8: this was gated so that BOTH lists being ready-and-empty
            hid the whole section — suppressing "No workouts logged yet.", which
            is knowable and true. The section is unconditional now; each half
            always says what it knows. */}
        {(
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">

            {recsState !== 'ready' ? (
              <div className="card-glass">
                <h3 className="text-sm font-semibold text-white mb-1">Recommended For You</h3>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.65)' }}>
                  {recsState === 'failed'
                    ? 'Recommendations are unavailable right now.'
                    : 'Loading recommendations…'}
                </p>
              </div>
            ) : recommendations.length === 0 ? (
              <div className="card-glass">
                <h3 className="text-sm font-semibold text-white mb-1">Recommended For You</h3>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.65)' }}>
                  No recommendations right now.
                </p>
              </div>
            ) : null}

            {recsState === 'ready' && recommendations.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.5 }}
                className="flex"
              >
                <div className="relative overflow-hidden rounded-2xl flex-1"
                     style={{ border: '1px solid rgba(255,255,255,0.10)' }}>
                  <img src="/images/dashboard/recommendedforyou.png" alt=""
                       className="absolute inset-0 w-full h-full"
                       style={{ objectFit: 'cover', objectPosition: 'center' }} />
                  <div className="absolute inset-0" style={{
                    background: 'linear-gradient(135deg, rgba(10,9,8,0.55) 0%, rgba(10,9,8,0.30) 50%, rgba(10,9,8,0.15) 100%)',
                  }} />
                  <div className="relative z-10 p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4" style={{ color: '#FF8A1F' }} />
                        <h3 className="text-sm font-semibold text-white" style={TS}>
                          Recommended For You
                        </h3>
                      </div>
                      <button
                        onClick={() => triggerTransition(() => navigate('/exercises'))}
                        className="flex items-center gap-1 text-xs font-medium"
                        style={{ color: '#FF8A1F', ...TS }}
                      >
                        Browse all <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {/* ROUND 6 F3: six bare reads lived here. The difficulty
                          ternary's final `else` painted an UNKNOWN difficulty
                          the hard RED — the pill itself was EMPTY, since a bare
                          `{ex.difficulty}` renders as nothing (round 7 F3
                          corrected the earlier "red-and-advanced" wording, which
                          was never renderable) — and `{ex.calories_per_min}`
                          rendered " kcal/min", a unit with no number. Unknown
                          difficulty is neutral grey via the shared
                          `difficultyColor`, and every field goes through the
                          reader + orUnknown. */}
                      {recommendations.slice(0, 6).map((ex, i) => (
                        <motion.button
                          key={ex.id ?? i}
                          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.05 * i }}
                          // Round 7, security pass: `'…?exercise=' + ex.id` put
                          // an unencoded external string into a query — an id
                          // containing & or # silently corrupts the URL. No
                          // injection sink (client-side route), but free to fix.
                          onClick={ex.id === null
                            ? undefined
                            : () => triggerTransition(() =>
                                navigate('/exercises?exercise=' + encodeURIComponent(ex.id)))}
                          className="text-left rounded-2xl p-3 transition-all"
                          style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.12)' }}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span
                              className="text-2xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
                              style={{
                                background: ex.difficulty === 'beginner' ? 'rgba(34,197,94,0.25)'
                                  : ex.difficulty === 'intermediate' ? 'rgba(255,138,31,0.25)'
                                  : ex.difficulty === null ? 'rgba(255,255,255,0.06)'
                                  : 'rgba(239,68,68,0.25)',
                                // Round 7 F2: the foreground goes through the
                                // shared helper so all three difficulty sites
                                // agree on what unknown looks like.
                                color: difficultyColor(ex.difficulty),
                              }}
                            >
                              {orUnknown(ex.difficulty)}
                            </span>
                            {ex.aiSupported === true && <Sparkles className="w-3 h-3" style={{ color: '#FF8A1F' }} />}
                          </div>
                          <p className="text-xs font-semibold text-white leading-snug mb-1" style={TS}>
                            {orUnknown(ex.name)}
                          </p>
                          <p className="text-2xs truncate" style={{ color: 'rgba(255,255,255,0.70)', ...TS }}>
                            {orUnknown(ex.primaryCategory)}
                          </p>
                          <div className="flex items-center gap-1 mt-2">
                            <Flame className="w-3 h-3" style={{ color: '#FF8A1F' }} />
                            <span className="text-2xs font-medium" style={{ color: 'rgba(255,138,31,0.95)', ...TS }}>
                              {formatCount(ex.caloriesPerMin)} kcal/min
                            </span>
                          </div>
                        </motion.button>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {recentState !== 'ready' ? (
              <div className="card-glass">
                <h3 className="text-sm font-semibold text-white mb-1">Recent Workouts</h3>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.65)' }}>
                  {recentState === 'failed'
                    ? 'Recent workouts are unavailable right now.'
                    : 'Loading recent workouts…'}
                </p>
              </div>
            ) : recent.length === 0 ? (
              <div className="card-glass">
                <h3 className="text-sm font-semibold text-white mb-1">Recent Workouts</h3>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.65)' }}>
                  No workouts logged yet.
                </p>
              </div>
            ) : null}

            {recentState === 'ready' && recent.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.55, duration: 0.5 }}
                className="flex"
              >
                <div className="relative overflow-hidden rounded-2xl flex-1"
                     style={{ border: '1px solid rgba(255,255,255,0.10)' }}>
                  <img src="/images/dashboard/recentworkout.png" alt=""
                       className="absolute inset-0 w-full h-full"
                       style={{ objectFit: 'cover', objectPosition: 'center' }} />
                  <div className="absolute inset-0" style={{
                    background: 'linear-gradient(135deg, rgba(10,9,8,0.55) 0%, rgba(10,9,8,0.30) 50%, rgba(10,9,8,0.15) 100%)',
                  }} />
                  <div className="relative z-10 p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-semibold text-white" style={TS}>Recent Workouts</h3>
                      <button
                        onClick={() => triggerTransition(() => navigate('/progress'))}
                        className="flex items-center gap-1 text-xs font-medium"
                        style={{ color: '#FF8A1F', ...TS }}
                      >
                        View all <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {recent.slice(0, 6).map((w, i) => {
                      // ROUND 6 F7: `text()` validates non-empty-string, never
                      // PARSEABILITY, so `completed_at: 'not-a-date'` printed
                      // the literal "Invalid Date" beside siblings correctly
                      // reading "—". A date that will not parse is unknown.
                      const parsed = w.completedAt === null ? null : new Date(w.completedAt);
                      const date = parsed !== null && !Number.isNaN(parsed.getTime())
                        ? parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                        : UNKNOWN;
                      // ROUND 5 F3: `w.form_accuracy || 0` fell through to the
                      // <60 branch, so an UNKNOWN accuracy was painted RED —
                      // a bad-form claim about a workout we know nothing about.
                      // Unknown is neutral grey and reads "—".
                      const formColor =
                        w.formAccuracy === null ? 'rgba(255,255,255,0.40)' :
                        w.formAccuracy >= 80 ? '#4ade80' :
                        w.formAccuracy >= 60 ? '#FFB347' : '#f87171';
                      return (
                        <motion.div
                          key={w.id ?? i}
                          initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.08 * i }}
                          className="flex items-center gap-3 py-2.5 rounded-xl px-3 mb-2"
                          style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.10)' }}
                        >
                          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                               style={{ background: 'rgba(255,138,31,0.25)', border: '1px solid rgba(255,138,31,0.35)' }}>
                            <Dumbbell className="w-3.5 h-3.5" style={{ color: '#FF8A1F' }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-white truncate" style={TS}>
                              Workout Session
                            </p>
                            <p className="text-2xs" style={{ color: 'rgba(255,255,255,0.70)', ...TS }}>
                              {date} · {formatCount(w.durationMinutes)} min
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-xs font-semibold" style={{ color: '#FF8A1F', ...TS }}>
                              {formatCount(w.caloriesBurned)} kcal
                            </p>
                            <p className="text-2xs" style={{ color: formColor, ...TS }}>
                              {formatCount(w.formAccuracy)}% form
                            </p>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            )}

          </div>
        )}

        {/* ── CTA ───────────────────────────────────────────────────────────── */}
        {!loading && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="relative overflow-hidden rounded-3xl"
            style={{ height: 500 }}
          >
            <img src="/images/wellness/regularexercise.jpg" alt="Start training"
                 className="w-full h-full object-cover" style={{ objectPosition: 'center 20%' }} />
            <div className="absolute inset-0" style={{
              background: 'linear-gradient(90deg, rgba(10,9,8,0.95) 0%, rgba(10,9,8,0.6) 60%, rgba(10,9,8,0.2) 100%)',
            }} />
            <div className="absolute inset-0 flex items-center px-8">
              <div>
                <h3 className="text-xl font-bold tracking-tight text-white mb-1">Ready to start?</h3>
                <p className="text-sm mb-4" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  Your next workout is one click away.
                </p>
                <button onClick={() => triggerTransition(() => navigate('/exercises'))} className="btn-primary">
                  <Play className="w-4 h-4" />
                  Start Training
                </button>
              </div>
            </div>
          </motion.div>
        )}

      </div>
    </div>
  );
}