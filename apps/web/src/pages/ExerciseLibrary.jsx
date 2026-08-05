// P2.8 web repoint (exercise library card) — this screen reads the NEW /v1 API.
// Every decision the repoint makes lives in `api/exerciseLibrary.js`, which is
// testable without a DOM; this file draws the result. Read that header first.
//
// `isExerciseRemoved` is no longer applied here: Part 4 §3.4:366-369 rules
// Mountain Pose live and says "the `REMOVED_EXERCISES` frontend hack dies with
// the migration". The library lists 58 where it listed 56. The helper stays in
// `utils/exerciseMedia.js` — other callers are not this card's business (R1.1).
import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, X, Zap, ChevronRight,
  Dumbbell, Flame, Clock,
  SlidersHorizontal,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { exerciseService } from '../api/exerciseApi';
import { fetchAllExercises, buildLibraryRows, filterLibrary } from '../api/exerciseLibrary';
import { CATEGORIES, DIFFICULTIES, difficultyStyle } from './exerciseLibraryView';
// The AI badge's meaning lives with the I4 gate it depends on, in poseAdapter —
// see its comment there. It moved out of this file at T3 round 1 (F1) so it
// could be tested at all: a function defined inside a page component file needs
// a DOM to reach, and this file must export a component and nothing else.
import { hasCameraAnalysis } from '../engine/poseAdapter';
import ExerciseDetail from '../components/exercise/ExerciseDetail';
import { getExercisePhoto } from '../utils/exerciseMedia';
import { getItem, setItem } from '../utils/storage';

/** How many cards a "page" of the grid draws. The whole catalog is already in
 *  memory, so this is a rendering choice, not a request size — it keeps the
 *  first paint small and preserves the "Load more" button the screen had. */
const LIMIT = 20;

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
  const diff = difficultyStyle(exercise.difficulty);
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
          {diff && (
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
          )}
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
          {/* A dash, never a blank or the word "null": a catalog row this build
              stocks no words for has no calorie rate and no default, and saying
              so is the honest version of an empty gap. */}
          <span className="flex items-center gap-1 text-2xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
            <Flame className="w-3 h-3" style={{ color: '#f97316' }} />
            {exercise.calories_per_min === null ? '—' : `${exercise.calories_per_min} cal/min`}
          </span>
          <span className="flex items-center gap-1 text-2xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
            <Clock className="w-3 h-3" style={{ color: '#60a5fa' }} />
            {exercise.duration_seconds
              ? `${exercise.duration_seconds}s`
              : exercise.reps_default === null ? '—' : `${exercise.reps_default} reps`
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

  // THE WHOLE CATALOG, read once. 58 rows over a 100-row page limit is one
  // request; filtering and paging happen below without touching the network,
  // because `/v1/exercises` accepts neither a search term nor a page number.
  const [allRows, setAllRows] = useState([]);
  const [selectedEx, setSelectedEx] = useState(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [difficulty, setDifficulty] = useState('All');
  const [loading, setLoading] = useState(true);
  // A FAILED read is its own state, not an empty list. Without this, a server
  // that is down draws "No exercises found" over an empty grid — the screen
  // asserting that the library is empty when it does not know.
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(LIMIT);
  const [showFilters, setShowFilters] = useState(false);
  const [workoutCount, setWorkoutCount] = useState(0);

  // Changing any filter starts the list again from the top — the old code
  // refetched page 1 for exactly this reason. Done in the HANDLERS rather than
  // in an effect watching the filters: an effect that writes state the same
  // render is a cascading render, and the reset is a consequence of the click,
  // not of the state arriving.
  const changeSearch = (v) => { setSearch(v); setShown(LIMIT); };
  const changeCategory = (v) => { setCategory(v); setShown(LIMIT); };
  const changeDifficulty = (v) => { setDifficulty(v); setShown(LIMIT); };
  const clearFilters = () => { changeSearch(''); setCategory('All'); setDifficulty('All'); };

  useEffect(() => {
    let live = true;
    fetchAllExercises(exerciseService.getExercisePage)
      .then(({ items, truncated }) => {
        if (!live) return;
        const rows = buildLibraryRows(items, hasCameraAnalysis);
        setAllRows(rows);
        if (truncated) {
          // Said out loud rather than drawn as a complete library.
          toast('Showing part of the library', { icon: '⚠️' });
        }
        // The ?exercise=<slug> deep link, resolved against the rows just read —
        // no second request, and a value that matches nothing opens nothing.
        // The Dashboard still links with an OLD-backend id until its own
        // repoint; such a link lands in the "matches nothing" arm, exactly as a
        // stale id already did. Tracked in OWED.md, not half-fixed here.
        const target = searchParams.get('exercise');
        if (target) {
          const found = rows.find((r) => r.slug === target);
          if (found) setSelectedEx(found);
          searchParams.delete('exercise');
          setSearchParams(searchParams, { replace: true });
        }
      })
      .catch((err) => {
        if (!live) return;
        // Message only (R3.10) — the axios error carries the URL, the request
        // body and any headers.
        console.error('exercise library load failed:', err?.message);
        setFailed(true);
        toast.error('Failed to load exercises');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => { live = false; };
  }, []);

  // Filtering is derived, never stored: one source of truth for what is on
  // screen, so a filter and its result cannot drift apart.
  const filtered = useMemo(
    () => filterLibrary(allRows, { search, category, difficulty }),
    [allRows, search, category, difficulty],
  );

  const visible = filtered.slice(0, shown);
  const hasMore = filtered.length > visible.length;
  const loadMore = () => setShown((n) => n + LIMIT);

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
                  {/* The old payload carried a server-side `total`; a cursor
                      page carries none. Once every page is read the count IS
                      the number of rows — exact, and never printed as a
                      confident "0 Exercises" while the read is still running or
                      has failed. */}
                  {loading || failed ? 'Exercises' : `${allRows.length} Exercises`}
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
              onChange={(e) => changeSearch(e.target.value)}
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
                onClick={() => changeSearch('')}
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
                    onClick={() => changeDifficulty(d)}
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
              onClick={() => changeCategory(cat.name)}
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
                onClick={() => changeCategory(cat.name)}
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
          {/* Counts what the filters actually matched, which is what the line
              claimed on the old server too (`total` was the FILTERED total, not
              the library's). Silent while loading or failed — a count is a
              claim, and neither state knows one. */}
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>
            {loading ? 'Loading...' : failed ? '' : `${filtered.length} exercises`}
            {!loading && !failed && category !== 'All' && ` in ${category}`}
          </p>
        </div>

        {/* Exercise grid */}
        {loading ? (
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
        ) : failed ? (
          /* The library could not be read. Distinct from "nothing matched":
             offering "Clear filters" here would blame the user's search for the
             server being unreachable, and an empty grid would state that the
             library is empty. */
          <div className="empty-state">
            <div className="empty-state-icon">
              <Dumbbell className="w-8 h-8" style={{ color: 'rgba(255,255,255,0.2)' }} />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Couldn&apos;t load the exercises</h3>
            <p className="text-sm mb-4" style={{ color: 'rgba(255,255,255,0.35)' }}>
              Check your connection and try again
            </p>
            <button onClick={() => window.location.reload()} className="btn-secondary">
              Try again
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Dumbbell className="w-8 h-8" style={{ color: 'rgba(255,255,255,0.2)' }} />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No exercises found</h3>
            <p className="text-sm mb-4" style={{ color: 'rgba(255,255,255,0.35)' }}>
              Try a different search or category
            </p>
            <button
              onClick={clearFilters}
              className="btn-secondary"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {visible.map((ex, i) => (
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
                <button onClick={loadMore} className="btn-secondary px-8">
                  Load more
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