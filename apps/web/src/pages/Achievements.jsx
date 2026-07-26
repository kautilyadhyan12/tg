import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Trophy, Lock, Target, Zap, Flame, Crown,
  Medal, Loader2, ChevronRight,
} from 'lucide-react';
import {
  UNKNOWN, formatLevel, formatXpTotal, gamificationService,
} from '../api/gamificationApi';
import { useAuth } from '../context/AuthContext';
import { useXp } from '../hooks/useXp';

// ── Tier color config ─────────────────────────────────────────────────────────
const TIER_CONFIG = {
  bronze:   { color: '#cd7f32', bg: 'rgba(10,9,8,0.75)', ring: '#cd7f32', glow: '0 0 16px rgba(205,127,50,0.50), 0 0 40px rgba(205,127,50,0.20)' },
  silver:   { color: '#c0c0c0', bg: 'rgba(10,9,8,0.75)', ring: '#c0c0c0', glow: '0 0 16px rgba(192,192,192,0.50), 0 0 40px rgba(192,192,192,0.20)' },
  gold:     { color: '#FFD66B', bg: 'rgba(10,9,8,0.75)', ring: '#FFD66B', glow: '0 0 16px rgba(255,214,107,0.60), 0 0 40px rgba(255,214,107,0.25)' },
  platinum: { color: '#a78bfa', bg: 'rgba(10,9,8,0.75)', ring: '#a78bfa', glow: '0 0 16px rgba(167,139,250,0.60), 0 0 40px rgba(167,139,250,0.25)' },
};

// ── Category labels ───────────────────────────────────────────────────────────
const CATEGORY_LABELS = {
  milestones:  'Workout Milestones',
  streaks:     'Streaks',
  quality:     'Form Quality',
  intensity:   'Intensity',
  habits:      'Habits',
  variety:     'Variety',
  nutrition:   'Nutrition',
  engagement:  'Engagement',
};

// ── Single badge card ─────────────────────────────────────────────────────────
function BadgeCard({ badge, index }) {
  const tier = TIER_CONFIG[badge.tier] || TIER_CONFIG.bronze;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.02 * index }}
      whileHover={{ y: -2 }}
      className="relative rounded-2xl p-4 text-center transition-all"
      style={{
        background: badge.earned
          ? tier.bg
          : 'rgba(255,255,255,0.02)',
        border: badge.earned
          ? `1px solid ${tier.ring}`
          : '1px solid rgba(255,255,255,0.04)',
        opacity:    badge.earned ? 1 : 0.45,
        boxShadow:  badge.earned ? tier.glow : 'none',
      }}
    >
      {/* Icon */}
      <div
        className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center
                   text-3xl mb-2"
        style={{
          background: badge.earned
            ? `${tier.color}15`
            : 'rgba(255,255,255,0.03)',
          filter: badge.earned ? 'none' : 'grayscale(80%)',
        }}
      >
        {badge.earned ? badge.icon : <Lock className="w-6 h-6"
          style={{ color: 'rgba(255,255,255,0.30)' }} />}
      </div>

      {/* Tier pill */}
      <span
        className="inline-block text-2xs font-semibold uppercase tracking-wider
                   px-2 py-0.5 rounded-full mb-2"
        style={{
          background: badge.earned ? `${tier.color}20` : 'rgba(255,255,255,0.04)',
          color:      badge.earned ? tier.color : 'rgba(255,255,255,0.35)',
        }}
      >
        {badge.tier}
      </span>

      {/* Name */}
      <p className="text-sm font-bold text-white leading-tight mb-1">
        {badge.name}
      </p>

      {/* Description */}
      <p className="text-2xs leading-relaxed"
         style={{ color: 'rgba(255,255,255,0.45)' }}>
        {badge.description}
      </p>

      {/* XP reward */}
      <div className="mt-2 flex items-center justify-center gap-1">
        <Zap className="w-3 h-3"
             style={{ color: badge.earned ? tier.color : 'rgba(255,255,255,0.30)' }} />
        <span className="text-2xs font-semibold tabular-nums"
              style={{ color: badge.earned ? tier.color : 'rgba(255,255,255,0.30)' }}>
          +{badge.xp_reward} XP
        </span>
      </div>
    </motion.div>
  );
}

// ── Challenge card ────────────────────────────────────────────────────────────
function ChallengeCard({ challenge, index }) {
  const diffColor =
    challenge.difficulty === 'easy'   ? '#4ade80' :
    challenge.difficulty === 'medium' ? '#FF8A1F' :
    '#f87171';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 * index }}
      className="card-glass"
      style={{
        opacity: challenge.completed ? 0.7 : 1,
      }}
    >
      <div className="flex items-start gap-3 mb-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
          style={{
            background: `${diffColor}15`,
            border:     `1px solid ${diffColor}30`,
          }}
        >
          {challenge.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-sm font-bold text-white">{challenge.name}</p>
            <span
              className="text-2xs font-semibold uppercase tracking-wider
                         px-1.5 py-0.5 rounded-full"
              style={{
                background: `${diffColor}15`,
                color:      diffColor,
              }}
            >
              {challenge.difficulty}
            </span>
          </div>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.50)' }}>
            {challenge.description}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Zap className="w-3 h-3" style={{ color: '#FF8A1F' }} />
          <span className="text-xs font-bold tabular-nums"
                style={{ color: '#FF8A1F' }}>
            +{challenge.xp_reward}
          </span>
        </div>
      </div>

      {/* Progress */}
      <div className="flex justify-between text-2xs mb-1.5"
           style={{ color: 'rgba(255,255,255,0.50)' }}>
        <span>{challenge.current} / {challenge.target}</span>
        <span style={{ color: challenge.completed ? '#4ade80' : 'rgba(255,255,255,0.50)' }}>
          {challenge.completed ? '✓ Complete' : `${challenge.progress}%`}
        </span>
      </div>
      <div
        className="h-2 rounded-full overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.04)' }}
      >
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${challenge.progress}%` }}
          transition={{ duration: 1, ease: 'easeOut' }}
          className="h-full rounded-full"
          style={{
            background: challenge.completed
              ? 'linear-gradient(90deg, #4ade80, #22c55e)'
              : `linear-gradient(90deg, ${diffColor}, ${diffColor}cc)`,
          }}
        />
      </div>
    </motion.div>
  );
}

// ── Leaderboard row ───────────────────────────────────────────────────────────
function LeaderboardRow({ entry, index }) {
  const isPodium = entry.rank <= 3;
  const podiumColors = {
    1: '#FFD66B',
    2: '#c0c0c0',
    3: '#cd7f32',
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.04 * index }}
      className="flex items-center gap-3 py-3 px-3 rounded-xl transition-all"
      style={{
        background: entry.is_current_user
          ? 'rgba(255,138,31,0.08)'
          : 'transparent',
        border: entry.is_current_user
          ? '1px solid rgba(255,138,31,0.20)'
          : '1px solid transparent',
      }}
    >
      {/* Rank */}
      <div className="w-8 flex justify-center">
        {isPodium ? (
          <Crown className="w-5 h-5"
                 style={{ color: podiumColors[entry.rank] }} />
        ) : (
          <span className="text-sm font-bold tabular-nums"
                style={{ color: 'rgba(255,255,255,0.40)' }}>
            {entry.rank}
          </span>
        )}
      </div>

      {/* Avatar */}
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center
                   text-sm font-bold flex-shrink-0"
        style={{
          background: entry.is_current_user
            ? 'linear-gradient(135deg, #FF8A1F, #FFB347)'
            : 'rgba(255,255,255,0.06)',
          color: entry.is_current_user ? '#fff' : 'rgba(255,255,255,0.65)',
        }}
      >
        {entry.name?.[0]?.toUpperCase() || '?'}
      </div>

      {/* Name + level */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white truncate">
          {entry.name}
          {entry.is_current_user && (
            <span className="ml-2 text-2xs font-medium"
                  style={{ color: '#FF8A1F' }}>
              You
            </span>
          )}
        </p>
        <p className="text-2xs" style={{ color: 'rgba(255,255,255,0.40)' }}>
          Lv {entry.level} · {entry.badge_count} badge{entry.badge_count !== 1 ? 's' : ''}
          {entry.streak > 0 && ` · ${entry.streak}d streak`}
        </p>
      </div>

      {/* XP */}
      <div className="text-right">
        <p className="text-sm font-bold tabular-nums"
           style={{ color: '#FF8A1F' }}>
          {entry.xp.toLocaleString()}
        </p>
        <p className="text-2xs" style={{ color: 'rgba(255,255,255,0.40)' }}>
          XP
        </p>
      </div>
    </motion.div>
  );
}

// ── Main Achievements page ────────────────────────────────────────────────────
export default function Achievements() {
  const { user } = useAuth();
  const [data,         setData]         = useState(null);
  const [leaderboard,  setLeaderboard]  = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [tab,          setTab]          = useState('badges');
  // XP on the NEW API, fetched independently of the old-backend reads below
  // (badges/challenges/leaderboard). `null` = unknown, never a fabricated 0.
  const { xp } = useXp();

  useEffect(() => {
    Promise.all([
      gamificationService.getOverview(),
      gamificationService.getLeaderboard(20),
    ])
      .then(([overviewRes, lbRes]) => {
        setData(overviewRes.data);
        setLeaderboard(lbRes.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center"
           style={{ background: '#0A0908' }}>
        <Loader2 className="w-6 h-6 animate-spin"
                 style={{ color: '#FF8A1F' }} />
      </div>
    );
  }

  // T3 finding ①: this used to be an early `return <Failed to load…>` that
  // took the XP HEADER down with it — the header reads the NEW API, which is
  // fine precisely when the old backend is not. The failure notice is now
  // rendered in place of the TABS below, so the header survives it.
  //
  // `data.user` (the OLD backend's XP block) is deliberately no longer read —
  // XP comes from the new API via useXp. The rest of this payload still feeds
  // the badge-catalog, challenges and leaderboard tabs, each its own OWED card,
  // and is optional-chained so a failed old read cannot blank XP.
  const badges       = data?.badges;
  const challenges   = data?.challenges;
  const earnedBadges = badges?.all?.filter((b) => b.earned) ?? [];

  // Group badges by category
  const badgesByCategory = {};
  (badges?.all ?? []).forEach((b) => {
    if (!badgesByCategory[b.category]) badgesByCategory[b.category] = [];
    badgesByCategory[b.category].push(b);
  });

  return (
    <div className="min-h-screen p-6 relative">
      {/* Fixed background */}
      <div style={{
        position:           'fixed',
        inset:               0,
        zIndex:              0,
        background:         '#0A0908',
        backgroundImage:    'url(/images/achievements/monalisa.jpg)',
        backgroundSize:     'cover',
        backgroundPosition: 'center center',
        backgroundRepeat:   'no-repeat',
      }} />
      {/* Dark overlay */}
      <div style={{
        position:   'fixed',
        inset:       0,
        zIndex:      1,
        background: 'rgba(10,9,8,0.78)',
        boxShadow:  'inset 0 0 120px rgba(255,138,31,0.06)',
      }} />
      {/* Content */}
      <div className="relative achievements-page" style={{ zIndex: 2 }}>

      {/* Ambient glow */}
      <div
        className="fixed pointer-events-none"
        style={{
          top:        -200,
          right:      -200,
          width:      600,
          height:     600,
          background: 'radial-gradient(ellipse, rgba(255,138,31,0.06) 0%, transparent 70%)',
          zIndex:     0,
        }}
      />

      <div className="max-w-5xl mx-auto relative z-10 space-y-6">

        {/* ── Header — Level + XP bar ──────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="card-glass"
        >
          <div className="flex items-center gap-4 mb-4">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, #FF8A1F, #FFB347)',
                boxShadow:  '0 8px 24px rgba(255,138,31,0.3)',
              }}
            >
              <Trophy className="w-8 h-8 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-xs uppercase tracking-widest font-semibold"
                 style={{ color: 'rgba(255,138,31,0.7)' }}>
                Achievements
              </p>
              <h1 className="text-2xl font-bold tracking-tight text-white">
                Level {formatLevel(xp)}
              </h1>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.50)' }}>
                {formatXpTotal(xp)} total XP
                {' · '}{earnedBadges.length} of {badges?.total_count ?? '—'} badges
              </p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold tracking-tighter tabular-nums"
                 style={{ color: '#FF8A1F' }}>
                {xp ? xp.xpInLevel : UNKNOWN}
                <span className="text-base font-medium"
                      style={{ color: 'rgba(255,255,255,0.40)' }}>
                  /{xp ? xp.xpForNext : UNKNOWN}
                </span>
              </p>
              {/* `level + 1` is the LABEL for the next level, not arithmetic on
                  XP — every XP quantity here is server-computed. */}
              <p className="text-2xs"
                 style={{ color: 'rgba(255,255,255,0.40)' }}>
                XP to Lv {xp ? xp.level + 1 : UNKNOWN}
              </p>
            </div>
          </div>

          {/* XP bar */}
          <div
            className="h-3 rounded-full overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.04)' }}
          >
            {/* Unknown XP leaves the TRACK in place and the fill at zero — the
                bar is never removed, and the "—/—" above it is what says the
                number is unknown rather than zero. */}
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: xp ? `${xp.progressPct}%` : '0%' }}
              transition={{ duration: 1.2, ease: 'easeOut' }}
              className="h-full rounded-full"
              style={{
                background: 'linear-gradient(90deg, #FF8A1F, #FFB347)',
                boxShadow:  '0 0 12px rgba(255,138,31,0.4)',
              }}
            />
          </div>
        </motion.div>

        {/* The old-backend failure notice lives HERE, not in an early return —
            badges, challenges and the leaderboard come from that payload, the
            XP header above does not. (T3 finding ①.) */}
        {!data && (
          <div className="card-glass">
            <p className="text-white">Failed to load achievements</p>
            <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.50)' }}>
              Badges, challenges and the leaderboard are unavailable right now.
            </p>
          </div>
        )}

        {/* ── Tabs ──────────────────────────────────────────────────────────── */}
        {data && (
        <div className="flex gap-2">
          {[
            { id: 'badges',      label: 'Badges',       icon: Medal,  count: earnedBadges.length },
            { id: 'challenges',  label: 'Challenges',   icon: Target, count: challenges?.active?.length ?? 0 },
            { id: 'leaderboard', label: 'Leaderboard',  icon: Crown,  count: null },
          ].map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl
                           text-sm font-semibold transition-all"
                style={{
                  background: active
                    ? 'linear-gradient(135deg, rgba(255,138,31,0.15), rgba(255,138,31,0.05))'
                    : 'rgba(255,255,255,0.03)',
                  border: active
                    ? '1px solid rgba(255,138,31,0.30)'
                    : '1px solid rgba(255,255,255,0.05)',
                  color: active ? '#FF8A1F' : 'rgba(255,255,255,0.65)',
                }}
              >
                <Icon className="w-4 h-4" />
                {t.label}
                {t.count !== null && (
                  <span className="text-2xs"
                        style={{ color: active ? '#FF8A1F' : 'rgba(255,255,255,0.30)' }}>
                    ({t.count})
                  </span>
                )}
              </button>
            );
          })}
        </div>
        )}

        {/* ── Tab content ───────────────────────────────────────────────────── */}
        {data && (
        <AnimatePresence mode="wait">
          {/* ── BADGES TAB ──────────────────────────────────────────────────── */}
          {tab === 'badges' && (
            <motion.div
              key="badges"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{    opacity: 0 }}
              className="space-y-6"
            >
              {Object.keys(CATEGORY_LABELS).map((cat) => {
                const catBadges = badgesByCategory[cat] || [];
                if (catBadges.length === 0) return null;

                return (
                  <div key={cat}>
                    <h2 className="text-sm font-bold uppercase tracking-wider mb-3"
                        style={{ color: 'rgba(255,138,31,0.70)' }}>
                      {CATEGORY_LABELS[cat]}
                    </h2>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                      {catBadges.map((b, i) => (
                        <BadgeCard key={b.id} badge={b} index={i} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </motion.div>
          )}

          {/* ── CHALLENGES TAB ──────────────────────────────────────────────── */}
          {tab === 'challenges' && (
            <motion.div
              key="challenges"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{    opacity: 0 }}
              className="space-y-3"
            >
              <div className="card-glass">
                <div className="flex items-center gap-2 mb-1">
                  <Flame className="w-4 h-4" style={{ color: '#FF8A1F' }} />
                  <h3 className="text-sm font-bold text-white">
                    This Week's Challenges
                  </h3>
                </div>
                <p className="text-xs mb-4"
                   style={{ color: 'rgba(255,255,255,0.50)' }}>
                  Complete all three for bonus XP. New challenges every Monday.
                </p>
              </div>

              {challenges.active.map((c, i) => (
                <ChallengeCard key={c.id} challenge={c} index={i} />
              ))}
            </motion.div>
          )}

          {/* ── LEADERBOARD TAB ─────────────────────────────────────────────── */}
          {tab === 'leaderboard' && leaderboard && (
            <motion.div
              key="leaderboard"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{    opacity: 0 }}
              className="card-glass"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Crown className="w-4 h-4" style={{ color: '#FFD66B' }} />
                  <h3 className="text-sm font-bold text-white">
                    Global Leaderboard
                  </h3>
                </div>
                <p className="text-2xs"
                   style={{ color: 'rgba(255,255,255,0.30)' }}>
                  {leaderboard.total_users} athletes
                </p>
              </div>

              <div className="space-y-1">
                {leaderboard.leaderboard.map((entry, i) => (
                  <LeaderboardRow key={entry.user_id} entry={entry} index={i} />
                ))}
              </div>

              {leaderboard.current_user_rank && (
                <div className="mt-4 pt-4 border-t"
                     style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                  <p className="text-xs text-center"
                     style={{ color: 'rgba(255,255,255,0.50)' }}>
                    You're ranked <strong style={{ color: '#FF8A1F' }}>
                      #{leaderboard.current_user_rank}
                    </strong> of {leaderboard.total_users}
                  </p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        )}
      </div>
    </div>
    </div>
  );
}