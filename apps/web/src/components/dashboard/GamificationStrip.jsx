import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Trophy, Target, Crown, ChevronRight, Sparkles } from 'lucide-react';
import {
  earnedBadgeCount, formatFraction, formatLevel, formatXpProgress,
  formatXpTotal, gamificationService, listState, oldPayloadState, orUnknown,
  progressWidth, readLeaderboardView, readOverviewView, xpBarWidth,
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
/** `challenge` is a readChallenge() view: every field is a usable value or NULL.
 *  Round 4 F5 — `current`/`target`/`progress` were read bare here, so a partial
 *  element rendered "undefined/undefined" and `width: "undefined%"`. */
function ChallengeRow({ challenge }) {
  const diffColor =
    challenge.difficulty === 'easy'   ? '#4ade80' :
    challenge.difficulty === 'medium' ? '#FF8A1F' : '#f87171';

  return (
    <div className="rounded-xl p-2.5" style={{
      background: 'rgba(0,0,0,0.20)',
      border:     '1px solid rgba(255,255,255,0.12)',
      opacity:    challenge.completed === true ? 0.80 : 1,
    }}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-base flex-shrink-0">{challenge.icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-white truncate">{orUnknown(challenge.name)}</p>
          <p className="text-2xs" style={{ color: 'rgba(255,255,255,0.70)' }}>
            {formatFraction(challenge.current, challenge.target)}
            {challenge.completed === true && <span className="ml-1 text-green-400">✓</span>}
          </p>
        </div>
      </div>
      <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.15)' }}>
        <motion.div
          initial={{ width: 0 }} animate={{ width: progressWidth(challenge.progress) }}
          transition={{ duration: 1, ease: 'easeOut' }}
          className="h-full rounded-full"
          style={{
            background: challenge.completed === true
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
  const { xp, status: xpStatus } = useXp();

  // ROUND 3 F8: `Promise.all` coupled two independent old-backend features, so
  // ONE rejection nulled BOTH payloads. DECISIONS 2026-07-24 rules the
  // leaderboard goes dark until P4 — with `all`, that planned dark window would
  // have blanked the badge catalog and challenges too: a no-removal problem
  // arriving on a schedule. Settled independently now, and logged message-only
  // (R3.10) rather than handing the whole axios error to console.error.
  useEffect(() => {
    Promise.allSettled([
      gamificationService.getOverview(),
      gamificationService.getLeaderboard(5),
    ])
      .then(([overview, lb]) => {
        if (overview.status === 'fulfilled') setData(overview.value.data);
        else console.error('gamification overview failed:', overview.reason?.message);
        if (lb.status === 'fulfilled') setLeaderboard(lb.value.data);
        else console.error('leaderboard failed:', lb.reason?.message);
      })
      .finally(() => setLoading(false));
  }, []);

  // Round 5 F1: `oldFailed` is gone — every render below asks its own list's
  // state via listState(), never the envelope's, which is what put three
  // captions in a permanent "Loading…".
  const oldState = oldPayloadState({ data, loading });

  // T3 finding ①: this used to be `if (loading || !data) return null`, which
  // gated the NEW-API XP block behind the OLD backend's payload — so the state
  // that is PERMANENT on this branch (old backend Bearer-null-broken, new API
  // fine) rendered no XP at all, while a comment two lines up claimed the two
  // sources were independent. A separate fetch is not independence if the
  // render is still gated.
  //
  // ROUND 4 F7: the replacement `loading && !xp` was still two states pretending
  // to be three. `!xp` is true for BOTH "XP still loading" and "XP failed", so
  // with the old backend accepting the connection and never answering (mlApi
  // sets no timeout) and the XP read failing, this returned null FOREVER — no
  // dash, no notice, nothing. Both reads now report their own state and the
  // strip hides only while BOTH are genuinely still in flight.
  if (oldState === 'loading' && xpStatus === 'loading') return null;

  // `data.user` (the OLD backend's XP block) is deliberately no longer read —
  // XP comes from the new API via useXp. The rest of this payload still feeds
  // the challenges + badge-catalog cards, which are their own OWED cards.
  //
  // ROUND 2 ①: hoisting XP out of the old payload's early return made these two
  // cards render on a FAILED old read for the first time — and they fabricated,
  // which is the very thing this card exists to delete. "of 0" claimed a zero
  // user count, "(0/—)" and "0 of — badges" claimed zero earned badges, and
  // "Complete workouts to earn your first badge" told a user with badges that
  // they had none. All were unreachable before this card and are the PERMANENT
  // state on this branch.
  //
  // ROUND 3 F2/F5: `oldReady = Boolean(data)` was wrong twice over. It treated
  // "still in flight" as "failed", so a healthy load asserted "unavailable";
  // and it asserted the ENVELOPE arrived rather than the FIELD inside it, so a
  // 200 with `{}` still printed "(0/—)" and "earn your first badge". Three
  // states, and per-card knowledge — both pure and unit-tested. (oldState and
  // oldFailed are computed above, because the early return needs them.)
  //
  // ROUND 4 F5/F6: both payloads now cross a READER, so every field below is a
  // usable value or null. Previously only the reads someone had thought of were
  // guarded, and each round found the ones they had not — `challenge.current`
  // and `challenge.progress` were still bare here when round 4 ran.
  const overview     = readOverviewView(data);
  const board        = readLeaderboardView(leaderboard);
  // ROUND 5 F2: `earned` may now be null (unknown), so the COUNT is null unless
  // every element answers. A count derived from a defaulted boolean is a
  // fabrication with extra steps — it printed "0 of 40 badges" and "earn your
  // first badge" to a user who has badges.
  const earnedCount  = earnedBadgeCount(overview.badges.all);
  const earnedBadges = (overview.badges.all ?? []).filter((b) => b.earned === true);
  // ROUND 6 F1: `recentBadges` is empty when the COUNT is unknown — showing a
  // "latest earned" list we cannot verify would itself be a claim. But the
  // STATE below must not borrow that test: `listState(oldState, earnedCount
  // !== null)` classified a catalog that had arrived and was on screen as a
  // FAILED read, printing "Badges are unavailable right now" beside a rendered
  // "(—/40)". The list's state is whether the LIST arrived; the count is a
  // separate question with a separate answer.
  const recentBadges = earnedCount === null ? [] : earnedBadges.slice(-3).reverse();
  const badgesState     = listState(oldState, overview.badges.all !== null);
  const challengesState = listState(oldState, overview.challenges.active !== null);

  // Round 2 ③: `leaderboard.leaderboard` was an unguarded read while its
  // sibling was optional-chained, and a render throw blanks the page (no
  // ErrorBoundary exists in apps/web) — which would take the XP header down
  // too, re-creating ① by a third route.
  const me       = board.entries?.find((e) => e.isCurrentUser) ?? null;
  const userRank = me ? me.rank : board.currentUserRank;

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
            {challengesState === 'ready' && overview.challenges.active.length > 0 ? (
              overview.challenges.active.slice(0, 3).map((c, i) => (
                <ChallengeRow key={c.id ?? i} challenge={c} />
              ))
            ) : challengesState === 'ready' ? (
              // ROUND 6 F6: a ready-but-empty list rendered an empty card body.
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.65)', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
                No challenges this week
              </p>
            ) : challengesState === 'loading' ? (
              // ROUND 6 F4: the loading arm rendered NOTHING, forever — mlApi
              // sets no timeout, so a hung backend leaves this permanent. The
              // sibling Achievements tab says "Loading challenges…" in the
              // identical state: two standards, eight inches apart, again.
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.65)', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
                Loading challenges…
              </p>
            ) : (
              // An empty list would read as "no challenges this week", which is
              // a claim we cannot make when the payload never arrived (round 2 ①)
              // — and only sayable once the read has FAILED, not while it is
              // still in flight (round 3 F2).
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.65)', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
                Challenges are unavailable right now
              </p>
            )}
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
                {orUnknown(userRank)}
              </p>
              <p className="text-sm pb-2" style={{ color: 'rgba(255,255,255,0.85)', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
                of {orUnknown(board.totalUsers)}
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
                animate={{ width: xpBarWidth(xp) }}
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
                ({orUnknown(earnedCount)}/{orUnknown(overview.badges.totalCount)})
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
                    key={b.id ?? i}
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
                        {orUnknown(b.name)}
                      </p>
                      <p className="text-2xs uppercase tracking-wider font-semibold"
                         style={{ color: tierColor }}>{orUnknown(b.tier)}</p>
                    </div>
                  </motion.div>
                );
              })
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-2">
                <Sparkles className="w-6 h-6" style={{ color: 'rgba(255,138,31,0.5)' }} />
                <p className="text-xs text-center"
                   style={{ color: 'rgba(255,255,255,0.65)', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
                  {/* "earn your first badge" is a CLAIM about the user's
                      catalog, sayable only when the count is genuinely 0 —
                      round 5 F2 restored it via `earned: false` defaults, and
                      round 6 F1 showed the STATE must not borrow the count's
                      test. Ready-with-unknown-count says neither.
                      ROUND 6 F4: the loading arm was `null`, so a hung backend
                      left this card body permanently empty. */}
                  {badgesState === 'loading'
                    ? <>Loading badges…</>
                    : badgesState === 'failed'
                      ? <>Badges are<br />unavailable right now</>
                      : earnedCount === 0
                        ? <>Complete workouts to<br />earn your first badge</>
                        : <>No badges to show</>}
                </p>
              </div>
            )}
          </div>
        </div>
      </HeroCard>

    </motion.div>
  );
}