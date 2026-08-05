import { X, Dumbbell, Flame, Clock, Zap, AlertCircle, Play, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import GifCarousel from './GifCarousel';
import { getExerciseMedia } from '../../utils/exerciseMedia';
// T3 round 1, F3 — the FIFTH site of the one-of-N shape, and the one on the
// panel that opens on every card click. This file had its own copy of
// DIFF_COLORS and its own `|| DIFF_COLORS.beginner`, so an ungraded exercise was
// asserted to be BEGINNER in green. `OWED.md` was already ticked DONE for that
// shape by the card that fixed the grid card — the instance, not the class.
// One table now, shared with the grid: unknown is neutral, missing draws no pill.
import { difficultyStyle } from '../../pages/exerciseLibraryView';

export default function ExerciseDetail({ exercise, onClose, onAddToWorkout }) {
  if (!exercise) return null;

  const diff  = difficultyStyle(exercise.difficulty);
  const media = getExerciseMedia(exercise.name);
  const photo = media ? media.photo : null;
  const gifs  = media ? media.gifs  : [];

  const ytQuery    = encodeURIComponent(exercise.name + ' exercise form');
  const youtubeUrl = 'https://www.youtube.com/results?search_query=' + ytQuery;

  const statLabel = exercise.duration_seconds ? 'Duration' : 'Reps';
  const statValue = exercise.duration_seconds
    ? exercise.duration_seconds + 's'
    : exercise.reps_default;

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      />

      <motion.div
        key="panel"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 220 }}
        className="fixed right-0 top-0 h-full w-full max-w-md z-50 overflow-y-auto no-scrollbar"
        style={{ background: '#0D0C0B', borderLeft: '1px solid rgba(255,255,255,0.06)' }}
      >
        {/* ── Hero photo ───────────────────────────────────────────────── */}
        <div
          className="relative w-full flex-shrink-0"
          style={{ height: 260, background: '#0a0908' }}
        >
          {photo ? (
            <img
              src={photo}
              alt={exercise.name}
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Dumbbell className="w-14 h-14 text-white/20" />
            </div>
          )}

          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'linear-gradient(to bottom, rgba(13,12,11,0.15) 0%, rgba(13,12,11,0) 40%, rgba(13,12,11,0.9) 100%)',
            }}
          />

          {/* YouTube */}
          <a
            href={youtubeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute bottom-3 right-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold"
            style={{ background: 'rgba(220,38,38,0.9)', color: '#fff', backdropFilter: 'blur(8px)' }}
          >
            <ExternalLink className="w-3 h-3" />
            YouTube
          </a>

          {/* Close */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)' }}
          >
            <X className="w-4 h-4 text-white" />
          </button>

          {/* AI badge */}
          {exercise.ai_supported && (
            <div
              className="absolute top-4 left-4 flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold"
              style={{ background: 'rgba(139,92,246,0.85)', color: '#fff', backdropFilter: 'blur(8px)' }}
            >
              <Zap className="w-3 h-3" />
              AI Supported
            </div>
          )}
        </div>

        {/* ── GIF carousel ─────────────────────────────────────────────── */}
        {gifs.length > 0 && (
          <div className="px-6 pt-5">
            <div className="flex items-center justify-between mb-2">
              <p
                className="text-xs uppercase tracking-widest font-semibold"
                style={{ color: 'rgba(255,255,255,0.30)' }}
              >
                Live Demo
              </p>
              <div className="flex items-center gap-1 text-2xs" style={{ color: '#4ade80' }}>
                <Play className="w-2.5 h-2.5" />
                <span className="font-bold tracking-wider">DEMO</span>
              </div>
            </div>
            <div
              className="w-full rounded-2xl overflow-hidden"
              style={{
                height:     280,
                background: 'rgba(255,255,255,0.03)',
                border:     '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <GifCarousel
                gifs={gifs}
                interval={10000}
                alt={exercise.name + ' demonstration'}
                rounded="rounded-2xl"
                bg="#0D0C0B"
              />
            </div>
          </div>
        )}

        {/* ── Body ─────────────────────────────────────────────────────── */}
        <div className="p-6 space-y-6">
          {/* Title + tags */}
          <div>
            <h2
              className="text-2xl font-bold tracking-tight mb-2"
              style={{ color: 'rgba(255,255,255,0.95)' }}
            >
              {exercise.name}
            </h2>
            <div className="flex flex-wrap gap-2">
              {diff && (
                <span
                  className="text-xs font-semibold px-2.5 py-1 rounded-full capitalize"
                  style={{ background: diff.bg, color: diff.color, border: '1px solid ' + diff.border }}
                >
                  {exercise.difficulty}
                </span>
              )}
              {exercise.equipment && exercise.equipment.map((eq) => (
                <span
                  key={eq}
                  className="text-xs px-2.5 py-1 rounded-full"
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    color:      'rgba(255,255,255,0.5)',
                    border:     '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  {eq}
                </span>
              ))}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: Flame,   label: 'Cal/min', value: exercise.calories_per_min, color: '#f97316' },
              { icon: Clock,   label: statLabel,  value: statValue,                color: '#60a5fa' },
              { icon: Dumbbell,label: 'Sets',     value: exercise.sets_default,    color: '#FF8A1F' },
            ].map(({ icon: Icon, label, value, color }) => (
              <div
                key={label}
                className="rounded-2xl p-3 text-center"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <Icon className="w-4 h-4 mx-auto mb-1.5" style={{ color }} />
                <p className="text-lg font-bold text-white tabular-nums">{value}</p>
                <p className="text-2xs mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>{label}</p>
              </div>
            ))}
          </div>

          {/* About */}
          {exercise.description && (
            <div>
              <p className="text-xs uppercase tracking-widest font-semibold mb-2"
                 style={{ color: 'rgba(255,255,255,0.30)' }}>About</p>
              <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.60)' }}>
                {exercise.description}
              </p>
            </div>
          )}

          {/* Instructions */}
          {exercise.instructions && exercise.instructions.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-widest font-semibold mb-3"
                 style={{ color: 'rgba(255,255,255,0.30)' }}>How to do it</p>
              <div className="space-y-2">
                {exercise.instructions.map((step, i) => (
                  <div key={i} className="flex gap-3">
                    <div
                      className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-bold"
                      style={{ background: 'rgba(255,138,31,0.12)', color: '#FF8A1F' }}
                    >
                      {i + 1}
                    </div>
                    <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.60)' }}>
                      {step}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Common mistakes */}
          {exercise.common_mistakes && exercise.common_mistakes.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-widest font-semibold mb-3"
                 style={{ color: 'rgba(255,255,255,0.30)' }}>Common Mistakes</p>
              <div className="space-y-2">
                {exercise.common_mistakes.map((m, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 text-sm"
                    style={{ color: 'rgba(255,255,255,0.55)' }}
                  >
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: '#f87171' }} />
                    {m}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Muscles */}
          {exercise.muscles_primary && exercise.muscles_primary.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-widest font-semibold mb-3"
                 style={{ color: 'rgba(255,255,255,0.30)' }}>Muscles Worked</p>
              <div className="space-y-3">
                <div>
                  <p className="text-2xs mb-1.5" style={{ color: 'rgba(255,255,255,0.30)' }}>Primary</p>
                  <div className="flex flex-wrap gap-1.5">
                    {exercise.muscles_primary.map((m) => (
                      <span
                        key={m}
                        className="text-xs px-3 py-1 rounded-full font-medium"
                        style={{
                          background: 'rgba(255,138,31,0.10)',
                          color:      '#FFB347',
                          border:     '1px solid rgba(255,138,31,0.15)',
                        }}
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
                {exercise.muscles_secondary && exercise.muscles_secondary.length > 0 && (
                  <div>
                    <p className="text-2xs mb-1.5" style={{ color: 'rgba(255,255,255,0.30)' }}>Secondary</p>
                    <div className="flex flex-wrap gap-1.5">
                      {exercise.muscles_secondary.map((m) => (
                        <span
                          key={m}
                          className="text-xs px-3 py-1 rounded-full"
                          style={{
                            background: 'rgba(255,255,255,0.04)',
                            color:      'rgba(255,255,255,0.40)',
                            border:     '1px solid rgba(255,255,255,0.07)',
                          }}
                        >
                          {m}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Add to workout */}
          <div className="pt-2">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onAddToWorkout(exercise)}
              className="w-full py-3.5 rounded-2xl font-semibold text-sm text-white flex items-center justify-center gap-2"
              style={{
                background:  'linear-gradient(135deg, #FF8A1F, #FFB347)',
                boxShadow:   '0 4px 20px rgba(255,138,31,0.3)',
              }}
            >
              <Dumbbell className="w-4 h-4" />
              Add to Workout
            </motion.button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}