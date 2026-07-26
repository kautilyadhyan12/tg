import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Trophy, Target, Crown, ChevronRight, Sparkles } from 'lucide-react';
import {
  formatLevel, formatXpProgress, formatXpTotal, gamificationService,
} from '../../api/gamificationApi';
import { useXp } from '../../hooks/useXp';

// ── HeroCard ──────────────────────────────────────────────────────────────────
function HeroCard({ bgImage, children, className = '', style = {}, onClick }) {
  return (
    <motion.div
      whileHover={onClick ? { scale: 1.015 } : undefined}
      whileTap={onClick ? { scale: 0.985 } : undefined}
      onClick={onClick}
      className={'relative overflow-hidden rounded-2xl ' + className}
      style={{
        cursor:   onClick ? 'pointer' : 'default',
        border:   '1px solid rgba(255,255,255,0.10)',
        minHeight: 220,
        ...style,
      }}
    >
      {bgImage && (
        <img src={bgImage} alt=""
             className="absolute inset-0 w-full h-full"
             style={{ objectFit: 'cover', objectPosition: 'center' }} />
      )}
      {/* Very light overlay — just enough to keep text readable */}
      <div className="absolute inset-0" style={{
        background: 'linear-gradient(135deg, rgba(10,9,8,0.55) 0%, rgba(10,9,8,0.30) 50%, rgba(10,9,8,0.15) 100%)',
      }} />
      <div className="relative z-10 h-full">{children}</div>
    </motion.div>
  );
}

// ── Challenge row — transparent so background shows through ──────────────────
function ChallengeRow({ challenge }) {
  const diffColor =
    challenge.difficulty === 'easy'   ? '#4ade80' :
    challenge.difficulty === 'medium' ? '#FF8A1F' : '#f87171';

  return (
    <div className="rounded-xl p-2.5" style={{
      background: 'rgba(0,0,0,0.20)',
      border:     '1px solid rgba(255,255,255,0.12)',
      opacity:    challenge.completed ? 0.80 : 1,
    }}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-base flex-shrink-0">{challenge.icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-white truncate">{challenge.name}</p>
          <p className="text-2xs" style={{ color: 'rgba(255,255,255,0.70)' }}>
            {challenge.current}/{challenge.target}
            {challenge.completed && <span className="ml-1 text-green-400">✓</span>}
          </p>
        </div>
      </div>
      <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.15)' }}>
        <motion.div
          initial={{ width: 0 }} animate={{ width: `${challenge.progress}%` }}
          transition={{ duration: 1, ease: 'easeOut' }}
          className="h-full rounded-full"
          style={{
            background: challenge.completed
              ? '#4ade80'
              : `linear-gradient(90deg, ${diffColor}, ${diffColor}bb)`,
          }}
        />
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function GamificationStrip() {
  const navigate = useNavigate();
  const [data,        setData]        = useState(null);
  const [leaderboard, setLeaderboard] = useState(null);
  const [loading,     setLoading]     = useState(true);
  // XP is on the NEW API, fetched separately from the two old-backend reads.
  // `null` = unknown; nothing here invents a number (see readXpView).
  const { xp } = useXp();

  useEffect(() => {
    Promise.all([
      gamificationService.getOverview(),
      gamificationService.getLeaderboard(5),
    ])
      .then(([overview, lb]) => { setData(overview.data); setLeaderboard(lb.data); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // T3 finding ①: this used to be `if (loading || !data) return null`, which
  // gated the NEW-API XP block behind the OLD backend's payload — so the state
  // that is PERMANENT on this branch (old backend Bearer-null-broken, new API
  // fine) rendered no XP at all, while a comment two lines up claimed the two
  // sources were independent. A separate fetch is not independence if the
  // render is still gated. The strip now hides only while the old read is
  // genuinely in flight AND we have no XP either — i.e. nothing to show yet.
  if (loading && !xp) return null;

  // `data.user` (the OLD backend's XP block) is deliberately no longer read —
  // XP comes from the new API via useXp. The rest of this payload still feeds
  // the challenges + badge-catalog cards, which are their own OWED cards, and
  // is now optional-chained throughout so a missing/failed old read degrades
  // those two cards to their existing empty states instead of blanking XP.
  const badges       = data?.badges;
  const challenges   = data?.challenges;
  const earnedBadges = badges?.all?.filter((b) => b.earned) ?? [];
  const recentBadges = earnedBadges.slice(-3).reverse();

  let userRank = null;
  if (leaderboard) {
    const me = leaderboard.leaderboard.find((e) => e.is_current_user);
    userRank  = me ? me.rank : leaderboard.current_user_rank;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="grid grid-cols-1 md:grid-cols-3 gap-4"
    >

      {/* ── Weekly Challenges ─────────────────────────────────────────────── */}
      <HeroCard bgImage="/images/dashboard/Screenshot (221).png">
        <div className="p-5 h-full flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4" style={{ color: '#FF8A1F' }} />
              <h3 className="text-sm font-semibold text-white"
                  style={{ textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
                Weekly Challenges
              </h3>
            </div>
            <button
              onClick={() => navigate('/achievements')}
              className="flex items-center gap-1 text-xs font-medium"
              style={{ color: '#FF8A1F', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}
            >
              View all <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex flex-col gap-2 flex-1">
            {(challenges?.active ?? []).slice(0, 3).map((c) => (
              <ChallengeRow key={c.id} challenge={c} />
            ))}
          </div>
        </div>
      </HeroCard>

      {/* ── Your Rank ─────────────────────────────────────────────────────── */}
      <HeroCard
        bgImage="/images/dashboard/weeklychallenges.png"
        onClick={() => navigate('/achievements')}
      >
        <div className="p-5 h-full flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Crown className="w-4 h-4" style={{ color: '#FFD66B' }} />
              <h3 className="text-sm font-semibold text-white"
                  style={{ textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
                Your Rank
              </h3>
            </div>
            <div className="flex items-end gap-2 mb-2">
              <p className="text-5xl font-bold tracking-tighter tabular-nums"
                 style={{ color: '#FFD66B', textShadow: '0 0 20px rgba(255,214,107,0.5)' }}>
                {userRank || '—'}
              </p>
              <p className="text-sm pb-2" style={{ color: 'rgba(255,255,255,0.85)', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
                of {leaderboard?.total_users || 0}
              </p>
            </div>
            <p className="text-sm mb-4" style={{ color: 'rgba(255,255,255,0.90)', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
              <span className="font-bold text-white">{formatXpTotal(xp)} XP</span>
              {' · '}Level {formatLevel(xp)}
            </p>
          </div>
          <div>
            {/* Unknown XP leaves the TRACK in place and the fill at zero — the
                bar is never removed; the "—/—" caption is what says unknown. */}
            <div className="h-2 rounded-full overflow-hidden mb-1.5"
                 style={{ background: 'rgba(255,255,255,0.15)' }}>
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: xp ? `${xp.progressPct}%` : '0%' }}
                transition={{ duration: 1.2, ease: 'easeOut' }}
                className="h-full rounded-full"
                style={{ background: 'linear-gradient(90deg, #FF8A1F, #FFB347)' }}
              />
            </div>
            {/* `level + 1` is the LABEL for the next level, not arithmetic on
                XP — every XP quantity here is server-computed. (xp.nextLevelAt
                is a cumulative-XP threshold, not a level number: xp.ts:142.) */}
            <p className="text-2xs" style={{ color: 'rgba(255,255,255,0.70)', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
              {formatXpProgress(xp)}
            </p>
          </div>
        </div>
      </HeroCard>

      {/* ── Latest Badges ─────────────────────────────────────────────────── */}
      <HeroCard bgImage="/images/dashboard/latestbadges.png">
        <div className="p-5 h-full flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4" style={{ color: '#FFD66B' }} />
              <h3 className="text-sm font-semibold text-white"
                  style={{ textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
                Latest Badges
              </h3>
              <span className="text-2xs" style={{ color: 'rgba(255,255,255,0.75)', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
                ({earnedBadges.length}/{badges?.total_count ?? '—'})
              </span>
            </div>
            <button
              onClick={() => navigate('/achievements')}
              className="flex items-center gap-1 text-xs font-medium"
              style={{ color: '#FF8A1F', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}
            >
              View all <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 flex flex-col gap-2">
            {recentBadges.length > 0 ? (
              recentBadges.map((b, i) => {
                const tierColor =
                  b.tier === 'platinum' ? '#a78bfa' :
                  b.tier === 'gold'     ? '#FFD66B' :
                  b.tier === 'silver'   ? '#c0c0c0' : '#cd7f32';
                return (
                  <motion.div
                    key={b.id}
                    initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 * i }}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                    style={{
                      background: 'rgba(0,0,0,0.20)',
                      border:     `1px solid ${tierColor}40`,
                    }}
                  >
                    <span className="text-xl flex-shrink-0">{b.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-white truncate"
                         style={{ textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
                        {b.name}
                      </p>
                      <p className="text-2xs uppercase tracking-wider font-semibold"
                         style={{ color: tierColor }}>{b.tier}</p>
                    </div>
                  </motion.div>
                );
              })
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-2">
                <Sparkles className="w-6 h-6" style={{ color: 'rgba(255,138,31,0.5)' }} />
                <p className="text-xs text-center"
                   style={{ color: 'rgba(255,255,255,0.65)', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
                  Complete workouts to<br />earn your first badge
                </p>
              </div>
            )}
          </div>
        </div>
      </HeroCard>

    </motion.div>
  );
}