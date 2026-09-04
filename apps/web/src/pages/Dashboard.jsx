import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTransition } from '../context/TransitionContext';
import { workoutService } from '../api/workoutApi';
import { progressService } from '../api/progressApi';
import { recommendationService } from '../api/recommendationApi';
import {
  UNKNOWN, formatCount, formatLevel, formatNextLevel, formatXpFraction,
  formatXpTotal, difficultyStyle, oldPayloadState, orUnknown, readRecommendations,
  xpBarWidth,
} from '../api/gamificationApi';
import {
  activeDayCount, readDashboardOverview, readRecentWorkouts, readWeekActivity,
  weekOfDates, weekWorkoutCount,
} from '../api/dashboardStats';
import { formatDuration, formatFormScore, formatKcal, formColor } from '../api/workoutHistory';
import { totalsWindowLabel } from './progressClamp';
import { useXp } from '../hooks/useXp';
import GamificationStrip from '../components/dashboard/GamificationStrip';
import GymMembershipCard from '../components/gym/GymMembershipCard';
import { useMyGyms } from '../hooks/useMyGyms';
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
 *  hidden component: the days of the week are knowable and the shape stays.
 *
 *  ROUND 8 F3: `known` was `activity !== null`, which collapsed LOADING and
 *  FAILED into one answer, so seven "Activity unavailable" tooltips appeared
 *  during a perfectly healthy in-flight read — permanently, because mlApi sets
 *  no timeout. Same defect as round 3 F2 and round 7 F1, at the one site on this
 *  page `oldPayloadState` had not been applied to. The strip takes the STATE
 *  now, not a second null test of its own: a caption and a tooltip disagreeing
 *  about one request is round 5 F8's two-standards defect. */
function WeekStrip({ activity, state, dates, todayIdx }) {
  const days   = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const known  = state === 'ready';
  const title  = known ? undefined
    : state === 'loading' ? 'Loading activity…' : 'Activity unavailable';
  // ROUND 10 F1: the week comes from `weekOfDates` so the caption above cannot
  // count a different set of days than the dots draw. The caption used to read
  // a SESSION count over a different window, which is how "5 of 7 days active"
  // ended up over three flames.
  // ROUND 11 F6: and it is now computed ONCE by the parent and passed in. This
  // component and the caption each called the helper with their own
  // `new Date()`, so "one source" was true of the function and not of the
  // INSTANT — the same class the round 10 fix closed, left half-open.
  // REPOINT: both numbers now come off ONE response's day buckets, so the two
  // measurements round 10 found disagreeing no longer exist separately.
  const dayIdx = todayIdx;

  return (
    <div className="flex gap-2">
      {days.map((day, i) => {
        const { key: dateStr, day: dayNum } = dates[i];
        const isToday = i === dayIdx;
        // `?.` because knowability now comes from the STATE: a caller passing
        // 'ready' with no payload must degrade, not throw — a throw in render
        // blanks the page (no ErrorBoundary in apps/web).
        const isDone  = known && !!activity?.[dateStr];
        const isPast  = i < dayIdx;

        return (
          <div key={day} className="flex-1 flex flex-col items-center gap-1.5">
            <span className="text-2xs font-medium uppercase tracking-wider"
                  style={{ color: isToday ? '#FF8A1F' : 'rgba(255,255,255,0.5)' }}>
              {day}
            </span>
            <div className="w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300"
                 title={title}
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
                  {dayNum}
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

  // ONE GYM, ONE WELCOME — see the header line below. `gyms` is `[]` while the
  // store is loading or has failed, so the line is simply absent rather than
  // half-written, and nothing here can draw a gym this person is not in.
  const { gyms: memberGyms } = useMyGyms();
  const welcomeGym = memberGyms.length === 1 ? memberGyms[0] : null;

  // THREE READS NOW, NOT ONE — and each carries its own settled flag.
  //
  // The old backend answered all of this in a single envelope, so one `loading`
  // was honest. Three requests can settle in any order, and round 7 F1 is what
  // happens when a state borrows another read's knowability: a pane says
  // "unavailable" while its own request is still in flight, or "Loading…"
  // forever after it failed. The rule that round produced — a state must never
  // borrow another read's knowability — is why there are six pieces of state
  // below and not four.
  const [overviewRaw,     setOverviewRaw]     = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [weekRaw,         setWeekRaw]         = useState(null);
  const [weekLoading,     setWeekLoading]     = useState(true);
  const [recentRaw,       setRecentRaw]       = useState(null);
  const [recentLoading,   setRecentLoading]   = useState(true);
  // NULL = not known yet / read failed; [] = genuinely none. Round 6 F9 is the
  // same distinction for `recent`: `?? []` collapsed three states into two, so
  // a failed read looked exactly like a brand-new account with no workouts.
  const [recommendations, setRecommendations] = useState(null);
  // ROUND 7 F1: recommendations needs its OWN settled flag. Round 6 derived
  // `recsState` from the one shared `loading`, which only the stats chain set —
  // so the recommendations read had no way to move its own state. Both failure
  // modes
  // this card exists to delete reproduced at once: stats settling first while
  // recommendations were still in flight printed "unavailable" (a false denial
  // during a healthy load, the defect oldPayloadState was written to remove),
  // and a hanging stats read with failed recommendations printed "Loading…"
  // forever (round 5 F1, the defect listState was written to remove). A state
  // must never borrow another read's knowability — that is round 6 F1's rule,
  // and this is the seventh consecutive round where the previous fix opened it.
  const [recsLoading, setRecsLoading] = useState(true);

  useEffect(() => {
    // ROUND 5 security pass (R3.10), and it still binds after the repoint:
    // every `.catch` here logs `err?.message` and never the error OBJECT.
    // `.catch(console.error)` hands axios the whole thing, whose `.config
    // .headers` carried the `Authorization: Bearer <token>` the old client set.
    // The new client authenticates with an httpOnly COOKIE, which never appears
    // in a JS-visible header at all — so the leak this rule was written for is
    // now structurally absent rather than merely mitigated. The rule stays:
    // a request id, a URL and a body all belong to the same object.
    // `period=all` because these three tiles are lifetime totals. What comes
    // back may still be a plan-limited window — the response says so in
    // `limitedToDays`, and `totalsWindowLabel` is what puts that on screen
    // instead of the words "all time".
    progressService.getOverview('all')
      .then((res) => setOverviewRaw(res.data))
      .catch((err) => console.error('overview read failed:', err?.message))
      .finally(() => setOverviewLoading(false));
    // ONE read for the week: the caption's number and the dots' fills are both
    // derived from these points, so they cannot describe different weeks
    // (round 10 F1 — the caption used to print a SESSION count beside a DAY
    // picture, which is how "10 of 7 days active" reached a screen).
    progressService.getCaloriesTrend('7d')
      .then((res) => setWeekRaw(res.data))
      .catch((err) => console.error('week read failed:', err?.message))
      .finally(() => setWeekLoading(false));
    // Six, because the pane renders `slice(0, 6)`. Asking for exactly what is
    // drawn keeps the "No workouts logged yet." arm honest: a seventh row
    // existing must not change what this pane claims.
    workoutService.getHistory({ limit: 6 })
      .then((res) => setRecentRaw(res.data))
      .catch((err) => console.error('recent workouts read failed:', err?.message))
      .finally(() => setRecentLoading(false));
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

  // ROUND 4 F2's rule, carried across the repoint unchanged: the previous fix
  // was `statsKnown = Boolean(stats?.stats)` —
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
  const totals = readDashboardOverview(overviewRaw);
  // ROUND 6 F9: `stats.recent ?? []` then `.length > 0` made a FAILED read
  // indistinguishable from a genuine zero-workout account — the card simply
  // vanished. Three states, like everywhere else on this page.
  // Each read answers with its OWN settled flag (round 7 F1). `oldPayloadState`
  // is the tested function for exactly this shape, so all three go through it
  // rather than repeating the ternary and getting one of them wrong again.
  const recent      = readRecentWorkouts(recentRaw);
  const recentState = oldPayloadState({ data: recent,          loading: recentLoading });
  const recsState   = oldPayloadState({ data: recommendations, loading: recsLoading });
  // ROUND 8 F3: the week strip was the THIRD read on this page and the only one
  // still on two states — round 7 applied oldPayloadState to the two above and
  // left this. Against a hung backend it claimed "Weekly activity unavailable"
  // forever, eight inches from a pane correctly reading "Loading recent
  // workouts…" about the very same request. It now has its OWN request, so the
  // two panes can legitimately differ — which makes the per-read state the only
  // correct source rather than merely the tidy one.
  const week        = readWeekActivity(weekRaw);
  const weekState   = oldPayloadState({ data: week,            loading: weekLoading });
  // ROUND 11 F6: ONE instant, read once, shared by the strip and its caption.
  const now         = new Date();
  const weekDays    = weekOfDates(now);
  const todayIdx    = (now.getDay() + 6) % 7;
  // Both from the same map over the same seven keys (round 10 F1): the tile
  // counts WORKOUTS, the caption counts DAYS, and neither can be about a
  // different week from the dots.
  const weeklyWorkouts = weekWorkoutCount(week?.byDate ?? null, weekDays);
  const activeDays     = activeDayCount(week?.byDate ?? null, weekDays);
  // What window these lifetime totals actually cover. "all time" unless the
  // plan's history gate cut it, in which case saying "all time" is the lie.
  const windowLabel = totalsWindowLabel(totals.limitedToDays);

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
          {/* `min-w-0` IS WHAT MAKES THE `truncate` BELOW BITE. A flex child
              defaults to `min-width: auto`, so it refuses to shrink under its
              content and an over-long gym name pushes the Start Workout button
              rather than being cut — `truncate` alone is inert here. It is the
              pairing `GymMembershipCard` and `MyGyms` both already use for the
              same string. */}
          <div className="min-w-0">
            <p className="text-sm font-medium mb-1" style={{ color: 'rgba(255,255,255,0.35)' }}>
              {greeting}
            </p>
            <h1 className="text-4xl font-bold tracking-tighter" style={{ color: 'rgba(255,255,255,0.95)' }}>
              {user?.displayName?.split(' ')[0] || 'Athlete'}
            </h1>
            {/* THE GYM ARRIVES AS A GREETING RATHER THAN AS A CARD — Kd, at his
                own browser, 2026-09-04: *"the dashboard should not even show you
                are a memebr of xyz it is the part of gym and good afternoon
                owner welcome to xyz gym can be there"*. One line, in the order
                he said it: the greeting, the name, then the gym.

                **IT NAMES A GYM ONLY WHEN THERE IS EXACTLY ONE.** He is a member
                of two in the screenshot that produced this ruling, and picking
                one of them to welcome him to would be the screen inventing an
                answer nobody gave it. Two or more, and this line is absent —
                `My Gyms` is where the list lives.

                **IT COSTS NO REQUEST.** `useMyGyms` reads the kept answer the
                member `Sidebar` already fetches on every screen (:28822), so
                this is a second CONSUMER of one response and not a second reader
                of `/v1/orgs/mine`.

                **IT TRUNCATES, because a gym names itself** and
                `createOrgRequestSchema` allows 120 characters
                (`packages/shared/src/orgs.ts:204`). The membership row this line
                replaced carried `truncate`; this one shipped without it (T3
                round 1 on `:32929`/`:33091`, Low-3). It needs BOTH halves — the
                `min-w-0` above and the class here — and jsdom has no layout, so
                nothing in the suite can see either. */}
            {welcomeGym !== null ? (
              <p className="text-sm mt-1 truncate" style={{ color: 'rgba(255,255,255,0.45)' }}>
                Welcome to {welcomeGym.name}
              </p>
            ) : null}
            {totals.currentStreak !== null && totals.currentStreak > 0 && (
              <div className="flex items-center gap-1.5 mt-2">
                <Flame className="w-4 h-4" style={{ color: '#FF8A1F' }} />
                <span className="text-sm font-semibold" style={{ color: '#FF8A1F' }}>
                  {totals.currentStreak} day streak
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

        {/* ── Gym status ────────────────────────────────────────────────────────
            :11132's card, ON TOP of the app rather than in front of it. A person
            waiting for a gym to confirm them keeps the whole free app — a build
            that parked them on a waiting screen would contradict the ruling — so
            what they get is this, above the ordinary dashboard, and everything
            below it works exactly as it did.
            Renders NOTHING when there is nothing to say, including when its
            reads fail: silence states nothing, while an error strip here would
            be noise on the screen a person opens to start training.

            **`showMemberships={false}` — KD TOOK "You're a member of X" OFF THIS
            SCREEN, 2026-09-04**, and the gym now arrives in the greeting above
            instead. What stays here is the news a member cannot get anywhere
            else: a request still waiting (with **Remind them**), a membership
            that ENDED, and a request refused or expired. The component's own
            docblock carries the ruling and the three citations. */}
        <GymMembershipCard showMemberships={false} />

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
          {/* The three sub-lines all name the SAME window, from one label, so a
              gated user cannot read "all time" on one tile and the truth on the
              next. On an unlimited plan they read exactly as before.

              A CAPTION ABOUT AN UNKNOWN NUMBER IS NOT PRINTED. `windowLabel`
              falls back to "all time" when `limitedToDays` is null — which is
              true of an ungated plan AND of a read that never arrived, so a
              failed overview used to print "all time" under an em dash: a
              window nobody told us about, described with confidence. The Hours
              tile already guarded its sub-line this way; the other two now do
              too, per field rather than behind one page-level flag, because a
              200 missing ONE field must still caption the others (round 4 F2's
              rule, which is the rule this whole file is built on). */}
          <StatCard icon={Dumbbell} label="Total Workouts" value={orUnknown(totals.totalWorkouts)} sub={totals.totalWorkouts === null ? undefined : windowLabel} color="#FF8A1F" delay={0.15} bgImage="/images/dashboard/totalworkout.png" />
          <StatCard icon={Clock} label="Hours Trained" value={orUnknown(totals.totalHours)} suffix="h" sub={totals.totalMinutes === null ? undefined : `${totals.totalMinutes} minutes · ${windowLabel}`} color="#60a5fa" delay={0.2} bgImage="/images/dashboard/hourstrained.png" />
          <StatCard icon={Flame} label="Calories Burned" value={orUnknown(totals.totalCalories)} sub={totals.totalCalories === null ? undefined : `kcal · ${windowLabel}`} color="#f97316" delay={0.25} bgImage="/images/dashboard/caloriesburned.png" />
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
                  { label: 'This week', value: formatCount(weeklyWorkouts),        sub: 'workouts' },
                  { label: 'Streak',    value: formatCount(totals.currentStreak), sub: 'days' },
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
                <WeekStrip activity={week?.byDate ?? null} state={weekState} dates={weekDays} todayIdx={todayIdx} />
                {/* ROUND 5 F8: the caption was gated on `weeklyWorkouts` and the
                    dots on `activity` — two different fields, so one could say
                    "3 of 7 days active" beside seven dashed UNKNOWN dots, or
                    "unavailable" beside real flames. Round 4 F3's "two standards
                    eight inches apart", unfixed in the other direction. The
                    caption speaks only when BOTH are known — unchanged here.
                    ROUND 8 F3 adds the third state the dots now carry: an
                    in-flight read is a LOAD, not a failure. */}
                <p className="text-xs mt-4 text-center" style={{ color: 'rgba(255,255,255,0.50)' }}>
                  {/* ROUND 9 F4 — the OTHER direction of round 5 F8, which that
                      round's own text named ("or 'unavailable' beside real
                      flames") and its test never covered. The caption required
                      BOTH the strip's state and a known count; the dots require
                      only the state. So a payload carrying `activity` but no
                      `weekly_workouts` lit seven definite dots — a flame on a
                      day the user really trained — under a caption reading
                      "Weekly activity unavailable". Measured: 4 flames, 0
                      unavailable tooltips, caption claiming failure.
                      The caption now answers the STRIP's question, and the
                      count's own unknown is the dash — which is also why this
                      goes through `formatCount` rather than a `!== null` guard
                      that can be dropped without any test noticing. */}
                  {weekState === 'loading'
                    ? 'Loading this week…'
                    : weekState !== 'ready'
                      ? 'Weekly activity unavailable'
                      : `${formatCount(activeDays)} of 7 days active`}
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
                                // ROUND 10 F4: this ternary knew only
                                // beginner/intermediate/null while the shared
                                // helper matches BOTH vocabularies, so
                                // difficulty 'easy' rendered a green label on a
                                // RED pill — measured. Round 7 F2 routed the
                                // foreground through the helper and left the
                                // background hand-rolled: one element, two
                                // vocabularies. Both fields, one resolver now.
                                background: difficultyStyle(ex.difficulty).tint,
                                color:      difficultyStyle(ex.difficulty).color,
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
            ) : recent.rows.length === 0 ? (
              <div className="card-glass">
                <h3 className="text-sm font-semibold text-white mb-1">Recent Workouts</h3>
                {/* THREE PEOPLE REACH THIS PANE, and only two of them exist in
                    the gate alone — which is what made rounds 1 and 2 each ship
                    a Critical here.

                      · has NOTHING            → "No workouts logged yet."
                      · has history, gated out → "None in the last N days",
                                                  plus the reassurance
                      · we were not told       → the sentence true either way

                    `limitedToDays` cannot separate the first two: EVERY user is
                    gated (no subscription → the free plan's 90 days), so a
                    ten-second-old account and a lapsed veteran send the exact
                    same empty page, and the totals endpoint is clamped by the
                    same floor so it reads 0 for both. Round 1 answered that
                    shape with the first sentence and lied to the veteran; round
                    2 answered it with the second and lied to the newcomer, on
                    the first screen they ever see. `hasAnyWorkouts` is the
                    server settling it. The UNKNOWN arm is not padding — an
                    older server omits the field, and guessing either way there
                    is how this defect returns a third time.

                    The window is spelled by `totalsWindowLabel`, the function
                    the three tiles above already use, and NOT inline here. L26
                    fixed a missing singular by writing a fifth copy of "the
                    last N days" with its own pluralization — which is the drift
                    the fix was for, committed while fixing it. One phrase, one
                    owner. */}
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.65)' }}>
                  {recent.hasAnyWorkouts === false
                    ? 'No workouts logged yet.'
                    : recent.hasAnyWorkouts === true && recent.limitedToDays !== null
                      ? `No workouts in the ${totalsWindowLabel(recent.limitedToDays)}.`
                      : 'No workouts to show.'}
                </p>
                {recent.hasAnyWorkouts === true && recent.limitedToDays !== null && (
                  <p className="text-2xs mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
                    Your plan shows that far back. Older workouts are still saved.
                  </p>
                )}
              </div>
            ) : null}

            {recentState === 'ready' && recent.rows.length > 0 && (
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
                    {recent.rows.slice(0, 6).map((w, i) => {
                      // ROUND 6 F7: a string that is non-empty is not a string
                      // that PARSES, so `'not-a-date'` printed the literal
                      // "Invalid Date" beside siblings correctly reading "—".
                      // `readCalendarSession` now rejects an unparseable
                      // `startedAt` outright, so this branch is belt-and-braces
                      // rather than the only guard — and it stays, because a
                      // reader that starts letting one through must not reach a
                      // render site that assumes it cannot.
                      const parsed = new Date(w.startedAt);
                      // LOCALE-NEUTRAL, deliberately. This was `'en-US'`, which
                      // showed every user on earth the American ordering — the
                      // same defect class as bucketing every user's days in one
                      // fixed timezone. `[]` is the visitor's OWN locale, which
                      // is what `Nutrition.jsx` and `Running.jsx` already pass;
                      // the en-IN spelling on the post-workout screen is the
                      // last one left and has its own OWED line.
                      const date = Number.isNaN(parsed.getTime())
                        ? UNKNOWN
                        : parsed.toLocaleDateString([], { month: 'short', day: 'numeric' });
                      return (
                        <motion.div
                          key={w.id}
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
                            {/* SECONDS, through the calendar's own label. The
                                old payload carried whole MINUTES; rounding the
                                new one's milliseconds to match is :4182 — a
                                real 8,491 ms workout printed as "0 min", and
                                36,290 ms rounded UP past a minute it never
                                reached. Four false numbers on one screen, all
                                from durations the server had recorded fine. */}
                            <p className="text-2xs" style={{ color: 'rgba(255,255,255,0.70)', ...TS }}>
                              {date} · {formatDuration(w.durationSeconds)}
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-xs font-semibold" style={{ color: '#FF8A1F', ...TS }}>
                              {formatKcal(w.kcal)} kcal
                            </p>
                            {/* ROUND 5 F3: `w.form_accuracy || 0` fell through
                                to the <60 branch, so an UNKNOWN score was
                                painted RED — a bad-form claim about a workout
                                nobody scored. `formColor` is the calendar's
                                tested ladder for exactly that, and sharing it
                                means the two screens cannot tint one score two
                                colours (the ONE-LADDER lesson). */}
                            <p className="text-2xs" style={{ color: formColor(w.formScore), ...TS }}>
                              {formatFormScore(w.formScore)} form
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
        {/* Gated on the totals read settling, which is what `loading` meant
            before the split. It is a decoration, not a claim — it says nothing
            about any figure — so it waits on one read rather than all three. */}
        {!overviewLoading && (
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