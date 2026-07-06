import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, X, Zap, ChevronRight,
  Dumbbell, Flame, Clock,
  SlidersHorizontal,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { exerciseService } from '../api/exerciseApi';
import { isExerciseRemoved } from '../utils/exerciseMedia';
import ExerciseDetail from '../components/exercise/ExerciseDetail';
import { getExercisePhoto } from '../utils/exerciseMedia';
import { getItem, setItem } from '../utils/storage';

const CATEGORIES = [
  { name: 'All', emoji: '⚡', image: null },
  { name: 'Strength Training', emoji: '🏋️', image: '/images/exercises/lifting.jpg' },
  { name: 'Bodyweight Exercises', emoji: '🤸', image: '/images/exercises/squat.png' },
  { name: 'HIIT', emoji: '⚡', image: '/images/wellness/ropping.jpg' },
  { name: 'Yoga', emoji: '🧘', image: '/images/wellness/yoga.jpg' },
  { name: 'Core & Abs', emoji: '🧠', image: '/images/wellness/regularexercise.jpg' },
  { name: 'Cardio', emoji: '❤️', image: '/images/wellness/running.jpg' },
  { name: 'Upper Body', emoji: '💪', image: '/images/exercises/weight.jpg' },
  { name: 'Lower Body', emoji: '🦵', image: '/images/exercises/squat.png' },
  { name: 'Flexibility & Mobility', emoji: '🧘‍♂️', image: '/images/wellness/yoga1.jpg' },
  { name: 'Endurance & Stamina', emoji: '🏃', image: '/images/wellness/running.jpg' },
  { name: 'Rehabilitation', emoji: '🧩', image: '/images/wellness/yoga2.jpg' },
];

const DIFFICULTIES = ['All', 'beginner', 'intermediate', 'advanced'];

const DIFF_COLORS = {
  beginner: { bg: 'rgba(34,197,94,0.12)', color: '#4ade80', border: 'rgba(34,197,94,0.2)' },
  intermediate: { bg: 'rgba(234,179,8,0.12)', color: '#fbbf24', border: 'rgba(234,179,8,0.2)' },
  advanced: { bg: 'rgba(239,68,68,0.12)', color: '#f87171', border: 'rgba(239,68,68,0.2)' },
};

function CategoryPill({ cat, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2
                 rounded-full text-sm font-medium transition-all duration-200"
      style={{
        background: active
          ? 'linear-gradient(135deg, #FF8A1F, #FFB347)'
          : 'rgba(255,255,255,0.05)',
        color: active ? '#fff' : 'rgba(255,255,255,0.5)',
        border: active
          ? '1px solid transparent'
          : '1px solid rgba(255,255,255,0.07)',
        boxShadow: active ? '0 4px 16px rgba(255,138,31,0.25)' : 'none',
      }}
    >
      <span>{cat.emoji}</span>
      {cat.name}
    </button>
  );
}

function ExerciseCard({ exercise, onClick, index }) {
  const diff = DIFF_COLORS[exercise.difficulty] || DIFF_COLORS.beginner;
  const photo = getExercisePhoto(exercise.name);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.3), duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      onClick={() => onClick(exercise)}
      className="group cursor-pointer rounded-2xl overflow-hidden transition-all duration-100"
      style={{
        background: '#121110',
        border: '1px solid rgba(255,255,255,0.05)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
      }}
      whileHover={{
        y: -6,
        borderColor: 'rgba(255,138,31,0.5)',
        boxShadow: '0 0 20px rgba(255,138,31,0.3), 0 0 40px rgba(255,138,31,0.15), 0 8px 32px rgba(0,0,0,0.4)',
      }}
    >
      <div className="relative overflow-hidden" style={{ height: 160, background: '#0a0908' }}>
        {photo ? (
          <img
            src={photo}
            alt={exercise.name}
            className="w-full h-full object-contain transition-transform
                       duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-4xl opacity-30">🏋️</span>
          </div>
        )}
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(to bottom, rgba(10,9,8,0) 50%, rgba(10,9,8,0.75) 100%)',
          }}
        />
        {exercise.ai_supported && (
          <div
            className="absolute top-3 right-3 flex items-center gap-1
                       px-2 py-1 rounded-lg text-2xs font-bold"
            style={{
              background: 'rgba(139,92,246,0.85)',
              backdropFilter: 'blur(8px)',
              color: '#fff',
            }}
          >
            <Zap className="w-2.5 h-2.5" />
            AI
          </div>
        )}
        <div className="absolute bottom-3 left-3">
          <span className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.6)' }}>
            {exercise.primary_category}
          </span>
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3
            className="text-sm font-semibold leading-tight transition-colors
                       duration-200 group-hover:text-amber-400"
            style={{ color: 'rgba(255,255,255,0.90)' }}
          >
            {exercise.name}
          </h3>
          <ChevronRight
            className="w-4 h-4 flex-shrink-0 mt-0.5 transition-all
                       duration-200 group-hover:translate-x-0.5"
            style={{ color: 'rgba(255,255,255,0.2)' }}
          />
        </div>

        <div className="flex items-center gap-2 mb-3">
          <span
            className="text-2xs font-semibold px-2 py-0.5 rounded-full capitalize"
            style={{
              background: diff.bg,
              color: diff.color,
              border: `1px solid ${diff.border}`,
            }}
          >
            {exercise.difficulty}
          </span>
          {exercise.ai_supported && (
            <span
              className="text-2xs font-bold px-2 py-0.5 rounded-full flex items-center gap-1"
              style={{
                background: 'rgba(139,92,246,0.12)',
                color: '#a78bfa',
                border: '1px solid rgba(139,92,246,0.2)',
              }}
            >
              <Zap className="w-2.5 h-2.5" />
              AI
            </span>
          )}
        </div>

        {exercise.muscles_primary && exercise.muscles_primary.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {exercise.muscles_primary.slice(0, 2).map((m) => (
              <span
                key={m}
                className="text-2xs px-2 py-0.5 rounded-full"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  color: 'rgba(255,255,255,0.40)',
                }}
              >
                {m}
              </span>
            ))}
          </div>
        )}

        <div
          className="flex items-center gap-3 pt-3"
          style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
        >
          <span className="flex items-center gap-1 text-2xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
            <Flame className="w-3 h-3" style={{ color: '#f97316' }} />
            {exercise.calories_per_min} cal/min
          </span>
          <span className="flex items-center gap-1 text-2xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
            <Clock className="w-3 h-3" style={{ color: '#60a5fa' }} />
            {exercise.duration_seconds
              ? `${exercise.duration_seconds}s`
              : `${exercise.reps_default} reps`
            }
          </span>
        </div>
      </div>
    </motion.div>
  );
}

export default function ExerciseLibrary() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [exercises, setExercises] = useState([]);
  const [selectedEx, setSelectedEx] = useState(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [difficulty, setDifficulty] = useState('All');
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [workoutCount, setWorkoutCount] = useState(0);

  const LIMIT = 20;

  const fetchExercises = useCallback(async (reset = false) => {
    setLoading(true);
    try {
      const params = { limit: LIMIT, page: reset ? 1 : page, sort: 'name' };
      if (search) params.search = search;
      if (category !== 'All') params.category = category;
      if (difficulty !== 'All') params.difficulty = difficulty;

      const res = await exerciseService.getExercises(params);
      const data = res.data;

      const filteredExercises = (data.exercises || []).filter(
        (ex) => !isExerciseRemoved(ex.name)
      );

      if (reset || page === 1) {
        setExercises(filteredExercises);
      } else {
        setExercises((prev) => [...prev, ...filteredExercises]);
      }
      setTotal(data.total);
      if (reset) setPage(1);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load exercises');
    } finally {
      setLoading(false);
    }
  }, [search, category, difficulty, page]);

  useEffect(() => {
    fetchExercises(true);
  }, [search, category, difficulty]);

  // Auto-open detail panel when ?exercise=<id> is in the URL
  useEffect(() => {
    const targetId = searchParams.get('exercise');
    if (!targetId) return;

    // Fetch the specific exercise directly from the API
    exerciseService.getExercise(targetId)
      .then((res) => {
        if (res.data && res.data.exercise) {
          setSelectedEx(res.data.exercise);
        }
        searchParams.delete('exercise');
        setSearchParams(searchParams, { replace: true });
      })
      .catch((err) => {
        console.error('Failed to load exercise:', err);
        searchParams.delete('exercise');
        setSearchParams(searchParams, { replace: true });
      });
  }, []);

  useEffect(() => {
    const stored = getItem('workout_builder', []);
    setWorkoutCount(stored.length);
  }, []);

  const handleAddToWorkout = (exercise) => {
    const stored = getItem('workout_builder', []);
    const exists = stored.find((e) => e.id === exercise.id);
    if (exists) {
      toast('Already in workout', { icon: '✓' });
      return;
    }
    const updated = [...stored, {
      ...exercise,
      sets: exercise.sets_default || 3,
      reps: exercise.reps_default || 12,
      rest: 60,
    }];
    setItem('workout_builder', updated);
    setWorkoutCount(updated.length);
    toast.success(`${exercise.name} added`);
    setSelectedEx(null);
  };

  const hasMore = exercises.length < total;

  const loadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    setLoading(true);
    const params = { limit: LIMIT, page: nextPage, sort: 'name' };
    if (search) params.search = search;
    if (category !== 'All') params.category = category;
    if (difficulty !== 'All') params.difficulty = difficulty;

    exerciseService.getExercises(params).then((res) => {
      const data = res.data;
      const filtered = (data.exercises || []).filter(
        (ex) => !isExerciseRemoved(ex.name)
      );
      setExercises((prev) => [...prev, ...filtered]);
      setTotal(data.total);
    }).catch((err) => {
      console.error(err);
      toast.error('Failed to load more exercises');
    }).finally(() => {
      setLoading(false);
    });
  };

  return (
    <div className="min-h-screen" style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(255,138,31,0.12) 0%, rgba(255,180,50,0.05) 30%, #0A0908 65%)' }}>

      {/* ── Subtle background glow ───────────────────────────────────────── */}
      <div
        className="fixed inset-0 z-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at 60% 40%, rgba(255,138,31,0.04) 0%, transparent 60%), radial-gradient(ellipse at 20% 80%, rgba(139,92,246,0.03) 0%, transparent 50%)',
        }}
      />

      {/* ── Hero header ──────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0" style={{ height: 420 }}>
          <img
            src="/images/exercises/backgroundexercise.png"
            alt="Exercises"
            className="w-full h-full object-cover"
            style={{ objectPosition: 'center center' }}
          />
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(180deg, rgba(10,9,8,0.2) 0%, rgba(10,9,8,0.75) 80%, #0A0908 100%)',
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              background: 'radial-gradient(ellipse at 50% 0%, rgba(255,138,31,0.08) 0%, transparent 60%)',
            }}
          />
        </div>

        <div className="relative z-10" style={{ minHeight: 420, display: 'flex', alignItems: 'center' }}>
          <div className="max-w-7xl mx-auto w-full h-full flex items-center justify-start px-8">
            <div className="max-w-2xl text-left">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
              >
                <p
                  className="text-xs font-semibold uppercase tracking-widest mb-2"
                  style={{ color: '#FF8A1F' }}
                >
                  Exercise Library
                </p>
                <h1
                  className="text-7xl font-bold tracking-tighter mb-3"
                  style={{ color: 'rgba(255,255,255,0.95)' }}
                >
                  {total} Exercises
                </h1>
                <p className="text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  AI-powered form detection on selected exercises
                </p>
              </motion.div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div className="relative z-10 px-6 pb-24 max-w-6xl mx-auto">

        {/* Search + filter */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="flex gap-3 mb-5 -mt-2"
        >
          <div className="flex-1 relative">
            <Search
              className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4"
              style={{ color: 'rgba(255,255,255,0.25)' }}
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search exercises, muscles..."
              className="w-full pl-11 pr-4 py-3 rounded-2xl text-sm outline-none
                         transition-all duration-200"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.07)',
                color: 'rgba(255,255,255,0.90)',
              }}
              onFocus={(e) => {
                e.target.style.borderColor = 'rgba(255,138,31,0.35)';
                e.target.style.boxShadow = '0 0 0 3px rgba(255,138,31,0.07)';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = 'rgba(255,255,255,0.07)';
                e.target.style.boxShadow = 'none';
              }}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 btn-icon w-6 h-6"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <button
            onClick={() => setShowFilters((f) => !f)}
            className="flex items-center gap-2 px-4 py-3 rounded-2xl
                       text-sm font-medium transition-all duration-200"
            style={{
              background: showFilters ? 'rgba(255,138,31,0.12)' : 'rgba(255,255,255,0.04)',
              border: showFilters ? '1px solid rgba(255,138,31,0.25)' : '1px solid rgba(255,255,255,0.07)',
              color: showFilters ? '#FF8A1F' : 'rgba(255,255,255,0.55)',
            }}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Filters
          </button>
        </motion.div>

        {/* Difficulty filters */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-4 overflow-hidden"
            >
              <div className="flex gap-2 flex-wrap pb-2">
                {DIFFICULTIES.map((d) => (
                  <button
                    key={d}
                    onClick={() => setDifficulty(d)}
                    className="px-4 py-1.5 rounded-full text-sm font-medium
                               transition-all duration-200 capitalize"
                    style={{
                      background: difficulty === d ? 'rgba(255,138,31,0.15)' : 'rgba(255,255,255,0.04)',
                      border: difficulty === d ? '1px solid rgba(255,138,31,0.3)' : '1px solid rgba(255,255,255,0.07)',
                      color: difficulty === d ? '#FF8A1F' : 'rgba(255,255,255,0.45)',
                    }}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Category pills */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-4 mb-6">
          {CATEGORIES.map((cat) => (
            <CategoryPill
              key={cat.name}
              cat={cat}
              active={category === cat.name}
              onClick={() => setCategory(cat.name)}
            />
          ))}
        </div>

        {/* Category image grid */}
        {category === 'All' && !search && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8"
          >
            {CATEGORIES.filter((c) => c.name !== 'All' && c.image).slice(0, 8).map((cat, i) => (
              <motion.button
                key={cat.name}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.05 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setCategory(cat.name)}
                className="relative overflow-hidden rounded-2xl text-left"
                style={{ height: 110 }}
              >
                <img
                  src={cat.image}
                  alt={cat.name}
                  className="w-full h-full object-cover"
                />
                <div
                  className="absolute inset-0"
                  style={{
                    background: 'linear-gradient(to top, rgba(10,9,8,0.92) 0%, rgba(10,9,8,0.2) 100%)',
                  }}
                />
                <div className="absolute bottom-0 left-0 p-3">
                  <p className="text-xs font-semibold text-white leading-tight">
                    {cat.name}
                  </p>
                </div>
              </motion.button>
            ))}
          </motion.div>
        )}

        {/* Results count */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>
            {loading ? 'Loading...' : `${total} exercises`}
            {category !== 'All' && ` in ${category}`}
          </p>
        </div>

        {/* Exercise grid */}
        {loading && exercises.length === 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="rounded-2xl overflow-hidden"
                style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.05)' }}
              >
                <div className="skeleton" style={{ height: 130 }} />
                <div className="p-4 space-y-2">
                  <div className="skeleton h-4 rounded w-3/4" />
                  <div className="skeleton h-3 rounded w-1/2" />
                  <div className="skeleton h-3 rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : exercises.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Dumbbell className="w-8 h-8" style={{ color: 'rgba(255,255,255,0.2)' }} />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No exercises found</h3>
            <p className="text-sm mb-4" style={{ color: 'rgba(255,255,255,0.35)' }}>
              Try a different search or category
            </p>
            <button
              onClick={() => { setSearch(''); setCategory('All'); setDifficulty('All'); }}
              className="btn-secondary"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {exercises.map((ex, i) => (
                <ExerciseCard
                  key={ex.id}
                  exercise={ex}
                  onClick={setSelectedEx}
                  index={i}
                />
              ))}
            </div>
            {hasMore && (
              <div className="text-center mt-8">
                <button
                  onClick={loadMore}
                  disabled={loading}
                  className="btn-secondary px-8"
                >
                  {loading ? 'Loading...' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Exercise detail panel ─────────────────────────────────────────── */}
      <AnimatePresence>
        {selectedEx && (
          <ExerciseDetail
            exercise={selectedEx}
            onClose={() => setSelectedEx(null)}
            onAddToWorkout={handleAddToWorkout}
          />
        )}
      </AnimatePresence>

      {/* ── Workout FAB ───────────────────────────────────────────────────── */}
      <AnimatePresence>
        {workoutCount > 0 && (
          <motion.button
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => navigate('/workout/builder')}
            className="fixed bottom-6 right-6 flex items-center gap-3
                       px-5 py-3.5 rounded-2xl text-white font-semibold
                       text-sm z-30"
            style={{
              background: 'linear-gradient(135deg, #FF8A1F, #FFB347)',
              boxShadow: '0 8px 32px rgba(255,138,31,0.4)',
            }}
          >
            <Dumbbell className="w-4 h-4" />
            My Workout
            <span
              className="w-6 h-6 rounded-full flex items-center justify-center
                         text-xs font-bold"
              style={{ background: 'rgba(255,255,255,0.25)' }}
            >
              {workoutCount}
            </span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}