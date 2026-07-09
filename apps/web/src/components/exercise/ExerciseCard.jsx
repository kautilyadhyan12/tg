import { Dumbbell, Clock, Flame, Star, Zap } from 'lucide-react';
import { getExercisePhoto } from '../../utils/exerciseMedia';

const difficultyColors = {
  beginner:     'badge-green',
  intermediate: 'badge-yellow',
  advanced:     'badge-red',
};

const categoryEmojis = {
  'Yoga':                   '🧘',
  'Strength Training':      '🏋️',
  'Cardio':                 '❤️',
  'Bodyweight Exercises':   '🤸',
  'Core & Abs':             '🧠',
  'Flexibility & Mobility': '🧘‍♂️',
  'HIIT':                   '⚡',
  'Endurance & Stamina':    '🏃',
  'Upper Body':             '🏋️‍♂️',
  'Lower Body':             '🦵',
  'Rehabilitation':         '🧩',
};

export default function ExerciseCard({ exercise, onClick }) {
  const isTimed = exercise.duration_seconds && !exercise.reps_default;
  const photo   = getExercisePhoto(exercise.name);

  return (
    <div
      onClick={() => onClick(exercise)}
      className="card-hover group animate-fade-in flex flex-col cursor-pointer overflow-hidden rounded-2xl"
      style={{
        background: '#121110',
        border:     '1px solid rgba(255,255,255,0.05)',
      }}
    >
      {/* Exercise photo */}
      <div
        className="relative w-full overflow-hidden flex-shrink-0"
        style={{ height: 160, background: '#0a0908' }}
      >
        {photo ? (
          <img
            src={photo}
            alt={exercise.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-4xl">
              {categoryEmojis[exercise.primary_category] || '🏋️'}
            </span>
          </div>
        )}

        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(to bottom, rgba(10,9,8,0) 50%, rgba(10,9,8,0.65) 100%)',
          }}
        />

        {exercise.ai_supported && (
          <span
            className="absolute top-2 right-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-2xs font-bold"
            style={{
              background:     'rgba(139,92,246,0.85)',
              color:          '#fff',
              backdropFilter: 'blur(6px)',
            }}
          >
            <Zap className="w-3 h-3" />
            AI
          </span>
        )}
      </div>

      <div className="p-4 flex flex-col flex-1">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-xl flex-shrink-0">
              {categoryEmojis[exercise.primary_category] || '🏋️'}
            </span>
            <div className="min-w-0">
              <h3 className="text-white font-semibold text-sm leading-tight
                             group-hover:text-primary-300 transition-colors
                             line-clamp-2">
                {exercise.name}
              </h3>
              <p className="text-gray-500 text-xs mt-0.5 truncate">
                {exercise.primary_category}
              </p>
            </div>
          </div>
        </div>

        {/* Difficulty badge */}
        <div className="mb-3">
          <span className={difficultyColors[exercise.difficulty] || 'badge-primary'}>
            {exercise.difficulty}
          </span>
        </div>

        {/* Muscles */}
        {exercise.muscles_primary && exercise.muscles_primary.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {exercise.muscles_primary.slice(0, 3).map((muscle) => (
              <span
                key={muscle}
                className="text-xs bg-white/5 text-gray-400 px-2 py-0.5 rounded-full"
              >
                {muscle}
              </span>
            ))}
          </div>
        )}

        {/* Stats row */}
        <div className="flex items-center gap-3 text-xs text-gray-500
                        mt-auto pt-3 border-t border-white/5">
          <span className="flex items-center gap-1">
            <Flame className="w-3 h-3 text-orange-400" />
            {exercise.calories_per_min} cal/min
          </span>
          {isTimed ? (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3 text-blue-400" />
              {exercise.duration_seconds}s
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <Dumbbell className="w-3 h-3 text-primary-400" />
              {exercise.reps_default} reps
            </span>
          )}
          {exercise.rating > 0 && (
            <span className="flex items-center gap-1 ml-auto">
              <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
              {exercise.rating.toFixed(1)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}