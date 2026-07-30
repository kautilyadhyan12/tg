import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTransition } from '../context/TransitionContext';
import { motion } from 'framer-motion';
import {
  CheckCircle, Clock, Flame, Target, Trophy,
  Zap, ChevronRight, Dumbbell, Star, RotateCcw,
  Apple, Heart, Download, Share2,
} from 'lucide-react';
import { workoutService } from '../api/workoutApi';
import { useXp } from '../hooks/useXp';
import {
  UNKNOWN, formGrade, formatLevel, formatNextLevel, formatPercent, formatXpEarned,
  formatXpFraction, orUnknown, progressWidth, readSummaryView, totalTimeLabel,
  workoutTimeLabel, workoutTimeLabelShort, xpBarWidth,
} from '../api/gamificationApi';
import toast from 'react-hot-toast';
import html2canvas from 'html2canvas';

// ── XP on this screen ─────────────────────────────────────────────────────────
// THE LEVEL AND THE POSITION WITHIN IT COME FROM `GET /v1/gamification/me` via
// useXp — never from the workout summary, and never computed here.
//
// What stood here until 2026-07-27 (OWED.md's 🔴 line, raised by the Dashboard
// card's T3 as its F4): `const xpProgress = summary.current_xp % 100`, rendered
// as `{xpProgress}/100 XP`. `summary.current_xp` is the user's TOTAL XP — the
// old endpoint returns `user.get("xp", 0)`, backend-ml/app/routers/workouts.py,
// in the block returning `"current_xp"` — so that expression assumed every level
// costs exactly 100. The real curve is `floor(100 * (level-1)^1.8)`
// (badges.py:215-227, ported verbatim into the API's xp.ts), i.e. levels cost
// 100, 248, 374 … — so the bar and its "Level N+1" caption were wrong for every
// user above level 2, on the screen shown after EVERY workout. This was the LAST
// copy in the app; the Dashboard's identical bug went the same way in 888e750.
//
// The server already sends the position within the level, so no XP arithmetic
// remains on this page (R3.1, and the Kd ruling of 2026-07-26 which names this
// exact shape as the thing not to copy). Unknown renders as an em dash — never a
// Level 1, never a 0.
//
// `xp_earned` STAYS on the old summary payload, because the new API has no
// per-workout field at all (`xpViewSchema` carries total, level, xpInLevel,
// xpForNext, progressPct, nextLevelAt — no delta). Keeping it is the NO-REMOVAL
// rule; guarding it is R2.3 — an absent field must read "—" and not "+0", which
// would claim the workout earned nothing.
//
// IT IS NOT "THIS WORKOUT'S DELTA", and this comment used to say it was (T3
// round 4 F5, verified against the file it cites): the summary endpoint
// RE-DERIVES the figure as base + form bonus only, while the amount actually
// awarded at completion also included streak_day and badge XP. So it
// understates the real award whenever a streak continued or a badge landed.
// Pre-existing and out of this card's scope — but the comment must not assert
// what the source contradicts.

// ── Confetti ──────────────────────────────────────────────────────────────────
function Confetti() {
  const pieces = Array.from({ length: 20 }, (_, i) => ({
    id:    i,
    color: ['#6366f1','#22c55e','#f59e0b','#ec4899','#06b6d4'][i % 5],
    left:  `${Math.random() * 100}%`,
    delay: `${Math.random() * 2}s`,
    dur:   `${2 + Math.random() * 2}s`,
  }));
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-10">
      {pieces.map((p) => (
        <motion.div
          key={p.id}
          initial={{ y: -20, opacity: 1 }}
          animate={{ y: '110vh', opacity: 0, rotate: 720 }}
          transition={{ duration: parseFloat(p.dur), delay: parseFloat(p.delay) }}
          style={{
            position: 'absolute', left: p.left, top: 0,
            width: 8, height: 8,
            backgroundColor: p.color,
            borderRadius: Math.random() > 0.5 ? '50%' : 2,
          }}
        />
      ))}
    </div>
  );
}

// ── Star rating ───────────────────────────────────────────────────────────────
function StarRating({ value, onChange }) {
  return (
    <div className="flex gap-2 justify-center">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          onClick={() => onChange(star)}
          className="transition-transform hover:scale-110 active:scale-95"
        >
          <Star
            className={`w-8 h-8 transition-colors
              ${star <= value ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600'}`}
          />
        </button>
      ))}
    </div>
  );
}

// ── Share Card (the div that gets screenshot'd) ───────────────────────────────
/** Takes the same `xp` block the page's own XP card renders. It used to read
 *  `summary.current_level`, i.e. the OLD store's level, while the card beside it
 *  showed the new API's — so one screen printed two different levels, and the
 *  one that left the building as a downloadable PNG was the stale one. The two
 *  stores diverge BY DESIGN (the new one recomputes from history — see xp.ts's
 *  governing rule), which is exactly why both surfaces must read one source. */
function ShareCard({ summary, xp, cardRef }) {
  const date = new Date().toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

  // `getGrade` stood here — a SECOND grade ladder with the same missing unknown
  // arm as the page's, so an unscored workout printed "undefined% (D)" into the
  // downloadable PNG. One exported `formGrade` now serves both surfaces; the
  // card keeps its own fixed tile colour, so no colour is concatenated here.

  return (
    <div
      ref={cardRef}
      style={{
        width: 400,
        background: 'linear-gradient(135deg, #0f0e0d 0%, #1a1815 50%, #0f0e0d 100%)',
        borderRadius: 24,
        padding: 32,
        fontFamily: 'Inter, system-ui, sans-serif',
        color: '#fff',
        position: 'relative',
        overflow: 'hidden',
        border: '1px solid rgba(255,138,31,0.2)',
      }}
    >
      {/* Glow blob */}
      <div style={{
        position: 'absolute', top: -60, right: -60,
        width: 200, height: 200,
        borderRadius: '50%',
        background: 'rgba(255,138,31,0.12)',
        filter: 'blur(40px)',
        pointerEvents: 'none',
      }} />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 11, color: '#FF8A1F', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 4 }}>
            AI Home Gym
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>
            Workout Complete
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{date}</div>
        </div>
        <div style={{
          width: 48, height: 48,
          background: 'rgba(34,197,94,0.15)',
          borderRadius: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '1px solid rgba(34,197,94,0.3)',
        }}>
          <span style={{ fontSize: 22 }}>✓</span>
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Workout Time', value: workoutTimeLabelShort(summary.activeSeconds, summary.durationMinutes), icon: '⏱️', color: '#60a5fa' },
          { label: 'Calories',   value: `${summary.caloriesBurned === null ? UNKNOWN : Math.round(summary.caloriesBurned)} kcal`, icon: '🔥', color: '#fb923c' },
          { label: 'Exercises',  value: `${orUnknown(summary.exercisesCount)}`,         icon: '💪', color: '#a78bfa' },
          { label: 'Form score', value: summary.formAccuracy === null ? UNKNOWN : `${summary.formAccuracy}% (${formGrade(summary.formAccuracy).grade})`, icon: '🎯', color: '#34d399' },
        ].map(({ label, value, icon, color }) => (
          <div key={label} style={{
            background: 'rgba(255,255,255,0.04)',
            borderRadius: 12,
            padding: '12px 14px',
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <div style={{ fontSize: 16, marginBottom: 4 }}>{icon}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* XP + streak row */}
      <div style={{
        display: 'flex', gap: 10, marginBottom: 20,
      }}>
        <div style={{
          flex: 1,
          background: 'rgba(255,138,31,0.08)',
          borderRadius: 12, padding: '10px 14px',
          border: '1px solid rgba(255,138,31,0.2)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 18 }}>⚡</span>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fbbf24' }}>{formatXpEarned(summary.xpEarned)} XP</div>
            <div style={{ fontSize: 11, color: '#6b7280' }}>Level {formatLevel(xp)}</div>
          </div>
        </div>
        {summary.currentStreak !== null && summary.currentStreak > 0 && (
          <div style={{
            flex: 1,
            background: 'rgba(249,115,22,0.08)',
            borderRadius: 12, padding: '10px 14px',
            border: '1px solid rgba(249,115,22,0.2)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ fontSize: 18 }}>🔥</span>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#fb923c' }}>{summary.currentStreak} days</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>Streak</div>
            </div>
          </div>
        )}
      </div>

      {/* PRs if any */}
      {summary.personalRecords !== null && summary.personalRecords.length > 0 && (
        <div style={{
          background: 'rgba(234,179,8,0.06)',
          borderRadius: 12, padding: '10px 14px',
          border: '1px solid rgba(234,179,8,0.2)',
          marginBottom: 20,
        }}>
          <div style={{ fontSize: 11, color: '#facc15', fontWeight: 600, marginBottom: 6, letterSpacing: '0.08em' }}>
            🏆 PERSONAL RECORDS
          </div>
          {summary.personalRecords.slice(0, 3).map((pr, i) => (
            <div key={i} style={{ fontSize: 12, color: '#fde68a', marginBottom: 2 }}>
              {orUnknown(pr)}
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div style={{
        borderTop: '1px solid rgba(255,255,255,0.06)',
        paddingTop: 14,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ fontSize: 11, color: '#4b5563' }}>
          Track your fitness with AI Home Gym
        </div>
        <div style={{
          fontSize: 11, fontWeight: 600, color: '#FF8A1F',
          background: 'rgba(255,138,31,0.1)',
          padding: '3px 8px', borderRadius: 6,
        }}>
          #AIHomeGym
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function PostWorkout() {
  const { sessionId } = useParams();
  const navigate       = useNavigate();
  const { triggerTransition } = useTransition();

  // The NEW API's XP block. Its own request, independent of the summary read —
  // but note the page as a whole still cannot render without `summary`, because
  // the summary IS this screen's subject. That is not the "one source failing
  // blanks the other" defect the XP card spent rounds deleting; there is simply
  // no post-workout screen without the workout.
  const { xp } = useXp();

  const [summary,     setSummary]     = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [rating,      setRating]      = useState(0);
  const [showStretch, setShowStretch] = useState(false);
  const [exporting,   setExporting]   = useState(false);
  const [showCard,    setShowCard]    = useState(false);

  const cardRef = useRef(null);

  useEffect(() => {
    if (!sessionId) { navigate('/dashboard'); return; }
    workoutService.getSummary(sessionId)
      .then((res) => {
        const view = readSummaryView(res.data);
        // A 200 carrying no `summary` OBJECT is a failed read, not a page. What
        // stood here — `setSummary(res.data.summary)` — stored `undefined`
        // without throwing, so this promise resolved, the catch never ran, and
        // `if (!summary) return null` rendered a BLANK WHITE PAGE: no toast, no
        // redirect, no text. The smoke rig's `empty200` state serves exactly that
        // and its own comment says a white screen there is the known state
        // (tools/mock-ml-backend.mjs:118). Throwing routes it into the failure
        // path this page ALREADY has, rather than growing a second one worded
        // differently for the same event.
        if (view === null) throw new Error('summary missing from response');
        setSummary(view);
      })
      .catch((err) => {
        // Message only (R3.10) — the axios error carries `config`, i.e. the URL,
        // the request body and any headers. `useXp.js`, imported by this very
        // file, logs `err?.message` and cites this rule by name, so a full-error
        // dump here was two standards eight inches apart. NB the T3 that raised
        // it said the leak includes `Authorization: Bearer <token>`; on THIS
        // branch it does not — `mlApi` attaches the header only `if (token)` and
        // Card 1 stopped writing `localStorage.accessToken` — which is the same
        // overstatement OWED.md already corrected once, on 2026-07-26. Real but
        // less urgent than reported, and fixed here because it is one line in a
        // file already open. The wider sweep stays on its own OWED line.
        console.error('summary load failed:', err?.message);
        toast.error('Failed to load summary');
        navigate('/dashboard');
      })
      .finally(() => setLoading(false));
  }, [sessionId]);

  // `formatTime`, `formatSeconds` and `getFormGrade` used to live here. They are
  // now `workoutTimeLabel` / `workoutTimeLabelShort` / `totalTimeLabel` /
  // `formGrade` in gamificationApi.js — the same move, for the same reason, as
  // `formatXpEarned` (T3 round 4 F9) and `syncTimezone` → userApi.js (DECISIONS
  // 2026-07-21): as page-locals they were the formatters this package's tests
  // could not reach, so their unknown-input behaviour went unasserted — and
  // `getFormGrade` having NO unknown arm is precisely the defect this card fixes.
  // `getFormGrade` also had a TWIN inside ShareCard (`getGrade`), which is why
  // one ladder now serves both surfaces.

  const handleExport = async () => {
    if (!cardRef.current) return;
    setExporting(true);
    try {
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: null,
        scale: 3,
        useCORS: true,
        logging: false,
      });
      const link = document.createElement('a');
      link.download = 'workout-' + new Date().toISOString().slice(0, 10) + '.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
      toast.success('Saved to your downloads!');
    } catch (err) {
      console.error(err);
      toast.error('Export failed, try again');
    } finally {
      setExporting(false);
    }
  };

  const handleShare = async () => {
    if (!cardRef.current) return;
    setExporting(true);
    try {
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: null,
        scale: 3,
        useCORS: true,
        logging: false,
      });
      canvas.toBlob(async (blob) => {
        if (navigator.share && navigator.canShare) {
          const file = new File([blob], 'workout.png', { type: 'image/png' });
          const canShare = navigator.canShare({ files: [file] });
          if (canShare) {
            await navigator.share({
              title: 'Workout Complete!',
              text: 'Crushed my workout with AI Home Gym 💪',
              files: [file],
            });
            setExporting(false);
            return;
          }
        }
        // Fallback — just download
        const link = document.createElement('a');
        link.download = 'workout.png';
        link.href = URL.createObjectURL(blob);
        link.click();
        toast.success('Saved! Share it anywhere 💪');
        setExporting(false);
      }, 'image/png');
    } catch (err) {
      console.error(err);
      setExporting(false);
      toast.error('Share failed, try again');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-dark-200 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-primary-500
                          border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400">Loading your results...</p>
        </div>
      </div>
    );
  }

  if (!summary) return null;

  const formInfo = formGrade(summary.formAccuracy);

  return (
    <div className="min-h-screen bg-dark-200 pb-12">
      <Confetti />

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <div className="bg-gradient-to-b from-primary-600/30 to-dark-200 pt-12 pb-8 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', damping: 15, stiffness: 200 }}
            className="w-24 h-24 bg-green-500/20 border-4 border-green-500/40
                       rounded-full flex items-center justify-center mx-auto mb-4"
          >
            <CheckCircle className="w-12 h-12 text-green-400" />
          </motion.div>
          <motion.h1
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-4xl font-bold text-white mb-2"
          >
            Workout Complete!
          </motion.h1>
          <motion.p
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-gray-400 text-lg"
          >
            Amazing effort 💪 Keep the streak going!
          </motion.p>
          {/* `!== null` first, deliberately: an unknown streak is not a streak of
              zero. The gate's OUTCOME is unchanged (undefined > 0 was already
              false), but it now says which question it is asking, so a later edit
              cannot read the absence as a definite "no streak". */}
          {summary.currentStreak !== null && summary.currentStreak > 0 && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.4, type: 'spring' }}
              className="inline-flex items-center gap-2 bg-orange-500/20
                         border border-orange-500/30 rounded-full px-4 py-2 mt-4"
            >
              <Flame className="w-4 h-4 text-orange-400" />
              <span className="text-orange-300 font-semibold text-sm">
                {summary.currentStreak} day streak!
              </span>
            </motion.div>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 space-y-6">

        {/* ── Stats grid ──────────────────────────────────────────────────── */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="grid grid-cols-2 gap-4"
        >
          {[
            { icon: Clock,    label: 'Workout Time',  value: workoutTimeLabel(summary.activeSeconds, summary.durationMinutes), color: 'text-blue-400',     bg: 'bg-blue-500/10', sublabel: summary.activeSeconds !== null ? totalTimeLabel(summary.durationMinutes) : null, sublabelTip: 'Time you were actually moving through reps. The smaller "total" figure is the whole time on the workout screen, including standing between reps and camera setup.' },
            { icon: Flame,    label: 'Calories',  value: `${orUnknown(summary.caloriesBurned)} kcal`, color: 'text-orange-400',   bg: 'bg-orange-500/10', sublabel: 'Estimate', sublabelTip: 'Calculated from your body weight and active movement time using standard MET values — not measured by a heart-rate sensor, so treat it as a planning estimate rather than an exact figure.' },
            { icon: Dumbbell, label: 'Exercises', value: orUnknown(summary.exercisesCount),      color: 'text-primary-400',  bg: 'bg-primary-500/10' },
            { icon: Target,   label: 'Avg Form',  value: formatPercent(summary.formAccuracy),    color: formInfo.color,      bg: 'bg-white/5' },
          ].map(({ icon: Icon, label, value, color, bg, sublabel, sublabelTip }) => (
            <div key={label} className="card text-center">
              <div className={`w-12 h-12 ${bg} rounded-xl
                              flex items-center justify-center mx-auto mb-3`}>
                <Icon className={`w-6 h-6 ${color}`} />
              </div>
              <p className="text-gray-400 text-sm">{label}</p>
              <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
              {sublabel && (
                <p className="text-gray-500 text-xs mt-0.5" title={sublabelTip || ''}>
                  {sublabel}
                </p>
              )}
            </div>
          ))}
        </motion.div>

        {/* ── Share card preview + export ──────────────────────────────────── */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.35 }}
          className="card"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Share2 className="w-5 h-5 text-primary-400" />
              <h3 className="text-white font-semibold">Share Your Workout</h3>
            </div>
            <button
              onClick={() => setShowCard((s) => !s)}
              className="text-xs text-gray-400 hover:text-white transition-colors"
            >
              {showCard ? 'Hide preview' : 'Preview card'}
            </button>
          </div>

          {/* Preview */}
          {showCard && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="flex justify-center mb-4 overflow-hidden"
            >
              <div style={{ transform: 'scale(0.82)', transformOrigin: 'top center' }}>
                <ShareCard summary={summary} xp={xp} cardRef={cardRef} />
              </div>
            </motion.div>
          )}

          {/* Hidden full-size card for html2canvas (always mounted, off-screen) */}
          {!showCard && (
            <div style={{ position: 'absolute', left: -9999, top: -9999, pointerEvents: 'none' }}>
              <ShareCard summary={summary} xp={xp} cardRef={cardRef} />
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex-1 flex items-center justify-center gap-2
                         py-3 rounded-xl bg-white/5 border border-white/10
                         text-white text-sm font-medium
                         hover:bg-white/10 transition-all
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4" />
              {exporting ? 'Saving...' : 'Download PNG'}
            </button>
            <button
              onClick={handleShare}
              disabled={exporting}
              className="flex-1 flex items-center justify-center gap-2
                         py-3 rounded-xl bg-primary-600 border border-primary-500/30
                         text-white text-sm font-medium
                         hover:bg-primary-500 transition-all
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Share2 className="w-4 h-4" />
              {exporting ? 'Preparing...' : 'Share'}
            </button>
          </div>
        </motion.div>

        {/* ── Form grade ──────────────────────────────────────────────────── */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="card"
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-white font-semibold mb-1">Form Score</h3>
              <p className={`text-sm ${formInfo.color}`}>{formInfo.label}</p>
            </div>
            <div className={`text-5xl font-bold ${formInfo.color}`}>
              {formInfo.grade}
            </div>
          </div>
          <div className="mt-4 h-3 bg-dark-300 rounded-full overflow-hidden">
            {/* `progressWidth` rather than a template: an unknown score leaves the
                track EMPTY (a filled bar beside a "—" grade would be a claim
                about form quality nobody measured), and it clamps 0-100, so an
                out-of-range score can no longer overflow the track either. What
                stood here rendered `width: "undefined%"`. */}
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: progressWidth(summary.formAccuracy) }}
              transition={{ delay: 0.6, duration: 1, ease: 'easeOut' }}
              className="h-full rounded-full bg-gradient-to-r
                         from-primary-600 to-primary-400"
            />
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>0%</span>
            <span className="text-white font-medium">{formatPercent(summary.formAccuracy)}</span>
            <span>100%</span>
          </div>
        </motion.div>

        {/* ── XP earned ───────────────────────────────────────────────────── */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="card bg-gradient-to-r from-primary-600/20 to-primary-800/10
                     border border-primary-500/20"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-yellow-500/20 rounded-xl
                              flex items-center justify-center">
                <Zap className="w-5 h-5 text-yellow-400" />
              </div>
              <div>
                <p className="text-white font-semibold">XP Earned</p>
                <p className="text-gray-400 text-sm">Level {formatLevel(xp)}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-yellow-400 font-bold text-2xl">{formatXpEarned(summary.xpEarned)}</p>
              <p className="text-gray-500 text-xs">experience points</p>
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs text-gray-400 mb-1.5">
              <span>Level {formatLevel(xp)}</span>
              <span>{formatXpFraction(xp)} XP</span>
              <span>Level {formatNextLevel(xp)}</span>
            </div>
            <div className="h-2 bg-dark-300 rounded-full overflow-hidden">
              {/* The bar starts EMPTY. It used to animate from the pre-workout
                  position via `xpProgress - summary.xp_earned` — which cannot
                  survive the repoint: the width now comes from the new API's
                  `progressPct` while the delta is the OLD store's, so
                  subtracting one from the other is arithmetic across two stores
                  that diverge by design. Reconstructing a true "before" would be
                  client-side XP math, which is the thing this card deletes. */}
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: xpBarWidth(xp) }}
                transition={{ delay: 0.8, duration: 1, ease: 'easeOut' }}
                className="h-full bg-gradient-to-r from-yellow-500 to-yellow-300 rounded-full"
              />
            </div>
          </div>
        </motion.div>

        {/* ── Personal records ────────────────────────────────────────────── */}
        {summary.personalRecords !== null && summary.personalRecords.length > 0 && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.55 }}
            className="card border border-yellow-500/20 bg-yellow-500/5"
          >
            <div className="flex items-center gap-2 mb-3">
              <Trophy className="w-5 h-5 text-yellow-400" />
              <h3 className="text-white font-semibold">Personal Records</h3>
            </div>
            <div className="space-y-2">
              {summary.personalRecords.map((record, i) => (
                <div key={i} className="flex items-center gap-2 text-yellow-300 text-sm">
                  <span>🏆</span>{orUnknown(record)}
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* ── Rate difficulty ──────────────────────────────────────────────── */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="card text-center"
        >
          <h3 className="text-white font-semibold mb-2">How was the difficulty?</h3>
          <p className="text-gray-400 text-sm mb-4">Your feedback improves future recommendations</p>
          <StarRating value={rating} onChange={setRating} />
          {rating > 0 && (
            <p className="text-primary-400 text-sm mt-3">
              {['', 'Too easy', 'Easy', 'Just right', 'Challenging', 'Very hard'][rating]}
            </p>
          )}
        </motion.div>

        {/* ── Post workout nutrition ───────────────────────────────────────── */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.65 }}
          className="card"
        >
          <div className="flex items-center gap-2 mb-4">
            <Apple className="w-5 h-5 text-green-400" />
            <h3 className="text-white font-semibold">Post-Workout Nutrition</h3>
          </div>
          <div className="space-y-3">
            {/* NULL is unknown, and it says so. `?.map` on a non-array threw and
                blanked the whole page; an EMPTY array is a truthful "none" and
                keeps its existing silent section (pre-existing, reported). */}
            {summary.mealSuggestions === null ? (
              <p className="text-gray-500 text-sm">Suggestions unavailable right now.</p>
            ) : summary.mealSuggestions.map((meal, i) => (
              <div key={i} className="flex items-start justify-between p-3 bg-dark-200 rounded-xl">
                <div>
                  <p className="text-white text-sm font-medium">{orUnknown(meal.meal)}</p>
                  <p className="text-gray-500 text-xs mt-0.5">{orUnknown(meal.timing)}</p>
                </div>
                <span className="text-green-400 text-xs bg-green-500/10
                                 px-2 py-1 rounded-full flex-shrink-0 ml-3">✓</span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* ── Cool down ────────────────────────────────────────────────────── */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="card"
        >
          <button
            onClick={() => setShowStretch((s) => !s)}
            className="w-full flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <Heart className="w-5 h-5 text-red-400" />
              <h3 className="text-white font-semibold">Cool Down Stretches</h3>
            </div>
            <ChevronRight
              className={`w-4 h-4 text-gray-400 transition-transform
                ${showStretch ? 'rotate-90' : ''}`}
            />
          </button>
          {showStretch && (
            <div className="mt-4 space-y-2">
              {summary.stretches === null ? (
                <p className="text-gray-500 text-sm">Stretches unavailable right now.</p>
              ) : summary.stretches.map((stretch, i) => (
                <div key={i} className="flex items-center gap-3 p-3 bg-dark-200 rounded-xl">
                  <div className="w-6 h-6 bg-red-500/20 rounded-full
                                  flex items-center justify-center flex-shrink-0">
                    <span className="text-red-300 text-xs font-bold">{i + 1}</span>
                  </div>
                  <p className="text-gray-300 text-sm">{orUnknown(stretch)}</p>
                </div>
              ))}
            </div>
          )}
        </motion.div>

        {/* ── Hydration ────────────────────────────────────────────────────── */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.75 }}
          className="card bg-blue-500/10 border border-blue-500/20 text-center py-4"
        >
          <p className="text-blue-300 text-2xl mb-1">💧</p>
          <p className="text-blue-300 font-semibold">Hydration Reminder</p>
          <p className="text-gray-400 text-sm mt-1">
            Drink 500ml of water in the next 30 minutes to aid recovery
          </p>
        </motion.div>

        {/* ── Action buttons ───────────────────────────────────────────────── */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="grid grid-cols-2 gap-3 pb-6"
        >
          <button
            onClick={() => triggerTransition(() => navigate('/exercises'))}
            className="btn-secondary flex items-center justify-center gap-2"
          >
            <RotateCcw className="w-4 h-4" />
            New Workout
          </button>
          <button
            onClick={() => triggerTransition(() => navigate('/dashboard'))}
            className="btn-primary flex items-center justify-center gap-2"
          >
            Dashboard
            <ChevronRight className="w-4 h-4" />
          </button>
        </motion.div>

      </div>
    </div>
  );
}