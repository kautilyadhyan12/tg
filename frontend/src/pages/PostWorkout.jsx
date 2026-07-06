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
import toast from 'react-hot-toast';
import html2canvas from 'html2canvas';

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
function ShareCard({ summary, cardRef }) {
  const date = new Date().toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

  const getGrade = (score) => {
    if (score >= 90) return 'A+';
    if (score >= 80) return 'A';
    if (score >= 70) return 'B';
    if (score >= 60) return 'C';
    return 'D';
  };

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
          { label: 'Workout Time', value: summary.active_seconds ? (summary.active_seconds < 60 ? `${summary.active_seconds}s` : `${Math.floor(summary.active_seconds / 60)}m ${Math.round(summary.active_seconds % 60)}s`) : (summary.duration_minutes < 60 ? `${summary.duration_minutes}m` : `${Math.floor(summary.duration_minutes/60)}h ${summary.duration_minutes%60}m`), icon: '⏱️', color: '#60a5fa' },
          { label: 'Calories',   value: `${Math.round(summary.calories_burned)} kcal`, icon: '🔥', color: '#fb923c' },
          { label: 'Exercises',  value: `${summary.exercises_count}`,                  icon: '💪', color: '#a78bfa' },
          { label: 'Form score', value: `${summary.form_accuracy}% (${getGrade(summary.form_accuracy)})`, icon: '🎯', color: '#34d399' },
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
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fbbf24' }}>+{summary.xp_earned} XP</div>
            <div style={{ fontSize: 11, color: '#6b7280' }}>Level {summary.current_level}</div>
          </div>
        </div>
        {summary.current_streak > 0 && (
          <div style={{
            flex: 1,
            background: 'rgba(249,115,22,0.08)',
            borderRadius: 12, padding: '10px 14px',
            border: '1px solid rgba(249,115,22,0.2)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ fontSize: 18 }}>🔥</span>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#fb923c' }}>{summary.current_streak} days</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>Streak</div>
            </div>
          </div>
        )}
      </div>

      {/* PRs if any */}
      {summary.personal_records?.length > 0 && (
        <div style={{
          background: 'rgba(234,179,8,0.06)',
          borderRadius: 12, padding: '10px 14px',
          border: '1px solid rgba(234,179,8,0.2)',
          marginBottom: 20,
        }}>
          <div style={{ fontSize: 11, color: '#facc15', fontWeight: 600, marginBottom: 6, letterSpacing: '0.08em' }}>
            🏆 PERSONAL RECORDS
          </div>
          {summary.personal_records.slice(0, 3).map((pr, i) => {
            const label = typeof pr === 'string' ? pr : `${pr.icon} ${pr.value} — ${pr.label}`;
            return (
              <div key={i} style={{ fontSize: 12, color: '#fde68a', marginBottom: 2 }}>
                {label}
              </div>
            );
          })}
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
      .then((res) => setSummary(res.data.summary))
      .catch((err) => {
        console.error(err);
        toast.error('Failed to load summary');
        navigate('/dashboard');
      })
      .finally(() => setLoading(false));
  }, [sessionId]);

  const formatTime = (mins) => {
    if (mins < 1)  return '< 1 min';
    if (mins < 60) return `${mins} min`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  };

  // Format an exact number of SECONDS as a compact duration. Used for the
  // active-workout-time headline so a 29s or 1m37s span shows precisely
  // rather than being rounded to whole minutes.
  const formatSeconds = (totalSeconds) => {
    if (totalSeconds == null) return '—';
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.round(totalSeconds % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m === 0) return `${s}s`;
    return `${m}m ${s}s`;
  };

  const getFormGrade = (score) => {
    if (score >= 90) return { grade: 'A+', color: 'text-green-400',  label: 'Excellent' };
    if (score >= 80) return { grade: 'A',  color: 'text-green-400',  label: 'Great' };
    if (score >= 70) return { grade: 'B',  color: 'text-yellow-400', label: 'Good' };
    if (score >= 60) return { grade: 'C',  color: 'text-orange-400', label: 'Needs work' };
    return               { grade: 'D',  color: 'text-red-400',    label: 'Keep practicing' };
  };

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

  const formInfo   = getFormGrade(summary.form_accuracy);
  const xpProgress = summary.current_xp % 100;

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
          {summary.current_streak > 0 && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.4, type: 'spring' }}
              className="inline-flex items-center gap-2 bg-orange-500/20
                         border border-orange-500/30 rounded-full px-4 py-2 mt-4"
            >
              <Flame className="w-4 h-4 text-orange-400" />
              <span className="text-orange-300 font-semibold text-sm">
                {summary.current_streak} day streak!
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
            { icon: Clock,    label: 'Workout Time',  value: summary.active_seconds ? formatSeconds(summary.active_seconds) : formatTime(summary.duration_minutes), color: 'text-blue-400',     bg: 'bg-blue-500/10', sublabel: summary.active_seconds ? `${formatTime(summary.duration_minutes)} total` : null, sublabelTip: 'Time you were actually moving through reps. The smaller "total" figure is the whole time on the workout screen, including standing between reps and camera setup.' },
            { icon: Flame,    label: 'Calories',  value: `${summary.calories_burned} kcal`,    color: 'text-orange-400',   bg: 'bg-orange-500/10', sublabel: 'Estimate', sublabelTip: 'Calculated from your body weight and active movement time using standard MET values — not measured by a heart-rate sensor, so treat it as a planning estimate rather than an exact figure.' },
            { icon: Dumbbell, label: 'Exercises', value: summary.exercises_count,               color: 'text-primary-400',  bg: 'bg-primary-500/10' },
            { icon: Target,   label: 'Avg Form',  value: `${summary.form_accuracy}%`,           color: formInfo.color,      bg: 'bg-white/5' },
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
                <ShareCard summary={summary} cardRef={cardRef} />
              </div>
            </motion.div>
          )}

          {/* Hidden full-size card for html2canvas (always mounted, off-screen) */}
          {!showCard && (
            <div style={{ position: 'absolute', left: -9999, top: -9999, pointerEvents: 'none' }}>
              <ShareCard summary={summary} cardRef={cardRef} />
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
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${summary.form_accuracy}%` }}
              transition={{ delay: 0.6, duration: 1, ease: 'easeOut' }}
              className="h-full rounded-full bg-gradient-to-r
                         from-primary-600 to-primary-400"
            />
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>0%</span>
            <span className="text-white font-medium">{summary.form_accuracy}%</span>
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
                <p className="text-gray-400 text-sm">Level {summary.current_level}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-yellow-400 font-bold text-2xl">+{summary.xp_earned}</p>
              <p className="text-gray-500 text-xs">experience points</p>
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs text-gray-400 mb-1.5">
              <span>Level {summary.current_level}</span>
              <span>{xpProgress}/100 XP</span>
              <span>Level {summary.current_level + 1}</span>
            </div>
            <div className="h-2 bg-dark-300 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: `${Math.max(0, xpProgress - summary.xp_earned)}%` }}
                animate={{ width: `${Math.min(xpProgress, 100)}%` }}
                transition={{ delay: 0.8, duration: 1, ease: 'easeOut' }}
                className="h-full bg-gradient-to-r from-yellow-500 to-yellow-300 rounded-full"
              />
            </div>
          </div>
        </motion.div>

        {/* ── Personal records ────────────────────────────────────────────── */}
        {summary.personal_records?.length > 0 && (
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
              {summary.personal_records.map((record, i) => {
                const text = typeof record === 'string' ? record : `${record.icon} ${record.value} — ${record.label}`;
                return (
                  <div key={i} className="flex items-center gap-2 text-yellow-300 text-sm">
                    <span>🏆</span>{text}
                  </div>
                );
              })}
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
            {summary.meal_suggestions?.map((meal, i) => (
              <div key={i} className="flex items-start justify-between p-3 bg-dark-200 rounded-xl">
                <div>
                  <p className="text-white text-sm font-medium">{meal.meal}</p>
                  <p className="text-gray-500 text-xs mt-0.5">{meal.timing}</p>
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
              {summary.stretches?.map((stretch, i) => (
                <div key={i} className="flex items-center gap-3 p-3 bg-dark-200 rounded-xl">
                  <div className="w-6 h-6 bg-red-500/20 rounded-full
                                  flex items-center justify-center flex-shrink-0">
                    <span className="text-red-300 text-xs font-bold">{i + 1}</span>
                  </div>
                  <p className="text-gray-300 text-sm">{stretch}</p>
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