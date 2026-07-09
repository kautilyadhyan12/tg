import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTransition } from '../context/TransitionContext';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Dumbbell, Trash2, Plus, Minus, ChevronUp,
  ChevronDown, Play, ArrowLeft, Flame, Zap, Timer,
  BookMarked, FolderOpen, X, Save, Check,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { getItem, setItem, removeItem } from '../utils/storage';
import { workoutService } from '../api/workoutApi';

// ── Templates modal ───────────────────────────────────────────────────────────
function TemplatesModal({ open, onClose, onLoad }) {
  const [templates, setTemplates] = useState([]);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    workoutService.getTemplates()
      .then((res) => setTemplates(res.data.templates || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [open]);

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete template "${name}"?`)) return;
    try {
      await workoutService.deleteTemplate(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      toast.success('Template deleted');
    } catch {
      toast.error('Failed to delete template');
    }
  };

  const handleLoad = async (template) => {
    try {
      const res = await workoutService.useTemplate(template.id);
      onLoad(res.data.exercises, res.data.name);
      onClose();
      toast.success(`Loaded "${template.name}"`);
    } catch {
      toast.error('Failed to load template');
    }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{    opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1,    y: 0  }}
          exit={{    opacity: 0, scale: 0.95, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md rounded-3xl flex flex-col"
          style={{
            background: '#121110',
            border:     '1px solid rgba(255,255,255,0.06)',
            maxHeight:  '80vh',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-5 py-4"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
          >
            <div className="flex items-center gap-2">
              <FolderOpen className="w-4 h-4" style={{ color: '#FF8A1F' }} />
              <h3 className="text-base font-bold text-white">Saved Templates</h3>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,0.04)' }}
            >
              <X className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.5)' }} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 no-scrollbar">
            {loading ? (
              <div className="flex justify-center py-12">
                <div className="w-5 h-5 border-2 rounded-full animate-spin"
                     style={{ borderColor: 'rgba(255,138,31,0.2)', borderTopColor: '#FF8A1F' }} />
              </div>
            ) : templates.length === 0 ? (
              <div className="text-center py-12">
                <BookMarked className="w-10 h-10 mx-auto mb-3"
                            style={{ color: 'rgba(255,255,255,0.15)' }} />
                <p className="text-sm font-semibold"
                   style={{ color: 'rgba(255,255,255,0.50)' }}>
                  No templates saved yet
                </p>
                <p className="text-xs mt-1"
                   style={{ color: 'rgba(255,255,255,0.30)' }}>
                  Build a workout and save it as a template
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {templates.map((t) => (
                  <motion.div
                    key={t.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="group rounded-2xl p-4 transition-all"
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      border:     '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-white truncate">
                          {t.name}
                        </p>
                        <p className="text-xs mt-0.5"
                           style={{ color: 'rgba(255,255,255,0.45)' }}>
                          {t.exercise_count} exercise{t.exercise_count !== 1 ? 's' : ''}
                          {t.times_used > 0 && ` · used ${t.times_used}×`}
                        </p>
                        {/* Exercise names preview */}
                        <p className="text-2xs mt-1.5 truncate"
                           style={{ color: 'rgba(255,255,255,0.30)' }}>
                          {(t.exercises || []).slice(0, 4).map((e) => e.name).join(' · ')}
                          {(t.exercises || []).length > 4 && ` +${t.exercises.length - 4} more`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => handleDelete(t.id, t.name)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity
                                     p-1.5 rounded-lg"
                          style={{ color: 'rgba(239,68,68,0.7)' }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleLoad(t)}
                          className="flex items-center gap-1.5 px-3 py-1.5
                                     rounded-xl text-xs font-semibold"
                          style={{
                            background: 'linear-gradient(135deg, #FF8A1F, #FFB347)',
                            color:      '#fff',
                          }}
                        >
                          <Play className="w-3 h-3" />
                          Load
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Save template modal ───────────────────────────────────────────────────────
function SaveTemplateModal({ open, defaultName, onClose, onSave }) {
  const [name,    setName]    = useState('');
  const [loading, setLoading] = useState(false);
  const [saved,   setSaved]   = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setName(defaultName || '');
      setSaved(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, defaultName]);

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Enter a template name'); return; }
    setLoading(true);
    try {
      await onSave(name.trim());
      setSaved(true);
      setTimeout(() => { onClose(); setSaved(false); }, 800);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{    opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1    }}
          exit={{    opacity: 0, scale: 0.95 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-sm rounded-3xl p-5"
          style={{
            background: '#121110',
            border:     '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <div className="flex items-center gap-2 mb-4">
            <BookMarked className="w-4 h-4" style={{ color: '#FF8A1F' }} />
            <h3 className="text-base font-bold text-white">Save as Template</h3>
          </div>

          <label className="block text-xs font-semibold uppercase tracking-wider mb-2"
                 style={{ color: 'rgba(255,255,255,0.50)' }}>
            Template Name
          </label>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            placeholder="e.g. Push Day A, Leg Day, Morning Cardio"
            className="input-field w-full mb-4"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border:     '1px solid rgba(255,255,255,0.08)',
              color:      '#fff',
            }}
          />

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border:     '1px solid rgba(255,255,255,0.08)',
                color:      'rgba(255,255,255,0.70)',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={loading || !name.trim()}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold
                         text-white flex items-center justify-center gap-2"
              style={{
                background: saved
                  ? 'linear-gradient(135deg, #22c55e, #4ade80)'
                  : 'linear-gradient(135deg, #FF8A1F, #FFB347)',
                opacity: !name.trim() ? 0.5 : 1,
              }}
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white
                                border-t-transparent rounded-full animate-spin" />
              ) : saved ? (
                <><Check className="w-4 h-4" /> Saved!</>
              ) : (
                <><Save className="w-4 h-4" /> Save Template</>
              )}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Main WorkoutBuilder ───────────────────────────────────────────────────────
export default function WorkoutBuilder() {
  const navigate      = useNavigate();
  const { triggerTransition } = useTransition();
  const [exercises,   setExercises]         = useState([]);
  const [name,        setName]              = useState('My Workout');
  const [loading,     setLoading]           = useState(false);
  const [showTemplates, setShowTemplates]   = useState(false);
  const [showSave,      setShowSave]        = useState(false);
  const isFirstRender = useRef(true);

  // ── Load from per-user storage ────────────────────────────────────────────
  useEffect(() => {
    const stored = getItem('workout_builder', []);
    if (stored.length > 0) setExercises(stored);
  }, []);

  // ── Sync to per-user storage ──────────────────────────────────────────────
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setItem('workout_builder', exercises);
  }, [exercises]);

  const updateExercise = (index, field, value) => {
    setExercises((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: Math.max(1, Number(value)) };
      return updated;
    });
  };

  const removeExercise = (index) => {
    setExercises((prev) => prev.filter((_, i) => i !== index));
    toast('Exercise removed', { icon: '🗑️' });
  };

  const moveUp = (index) => {
    if (index === 0) return;
    setExercises((prev) => {
      const u = [...prev];
      [u[index - 1], u[index]] = [u[index], u[index - 1]];
      return u;
    });
  };

  const moveDown = (index) => {
    if (index === exercises.length - 1) return;
    setExercises((prev) => {
      const u = [...prev];
      [u[index], u[index + 1]] = [u[index + 1], u[index]];
      return u;
    });
  };

  const clearWorkout = () => {
    setExercises([]);
    removeItem('workout_builder');
    toast('Workout cleared', { icon: '🗑️' });
  };

  const handleLoadTemplate = (exercises, templateName) => {
    setExercises(exercises);
    setName(templateName);
    setItem('workout_builder', exercises);
  };

  const handleSaveTemplate = async (templateName) => {
    await workoutService.saveTemplate(templateName, exercises);
    toast.success(`Template "${templateName}" saved!`);
  };

  // ── Totals ────────────────────────────────────────────────────────────────
  const totalSets  = exercises.reduce((s, e) => s + (e.sets || 3), 0);
  const estMinutes = exercises.reduce((s, e) => {
    const work = (e.sets || 3) * (e.reps || 12) * 3;
    const rest  = (e.sets || 3) * (e.rest || 60);
    return s + Math.ceil((work + rest) / 60);
  }, 0);
  const estCals = Math.round(estMinutes * 6);

  const handleStartWorkout = async () => {
    if (exercises.length === 0) {
      toast.error('Add at least one exercise first');
      return;
    }
    setLoading(true);
    try {
      triggerTransition(() => navigate('/workout/pre'));
    } catch (err) {
      toast.error('Failed to start workout');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen" style={{ background: '#0A0908' }}>

      {/* ── Hero header ──────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0" style={{ height: 320 }}>
          <img
            src="/images/exercises/weight.jpg"
            alt="Workout"
            className="w-full h-full object-cover"
            style={{ objectPosition: 'center 40%' }}
          />
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(180deg, rgba(10,9,8,0.6) 0%, rgba(10,9,8,0.97) 80%, #0A0908 100%)',
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              background: 'radial-gradient(ellipse at 50% 0%, rgba(255,138,31,0.08) 0%, transparent 60%)',
            }}
          />
        </div>

        <div className="relative z-10 px-6 pt-16 pb-8" style={{ minHeight: 320 }}>
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center gap-4 mb-2">
              <button
                onClick={() => triggerTransition(() => navigate('/exercises'))}
                className="btn-icon w-8 h-8"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="flex-1">
                <p
                  className="text-xs font-semibold uppercase tracking-widest mb-1"
                  style={{ color: '#FF8A1F' }}
                >
                  Workout Builder
                </p>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-transparent text-3xl font-bold tracking-tighter
                             text-white border-none outline-none w-full"
                  placeholder="Workout name..."
                />
              </div>

              {/* Template buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowTemplates(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl
                             text-xs font-semibold transition-all"
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border:     '1px solid rgba(255,255,255,0.10)',
                    color:      'rgba(255,255,255,0.75)',
                  }}
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  Templates
                </button>

                {exercises.length > 0 && (
                  <>
                    <button
                      onClick={() => setShowSave(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl
                                 text-xs font-semibold transition-all"
                      style={{
                        background: 'rgba(255,138,31,0.10)',
                        border:     '1px solid rgba(255,138,31,0.25)',
                        color:      '#FF8A1F',
                      }}
                    >
                      <BookMarked className="w-3.5 h-3.5" />
                      Save
                    </button>
                    <button
                      onClick={clearWorkout}
                      className="text-xs font-medium px-3 py-1.5 rounded-xl
                                 transition-all duration-200"
                      style={{ color: '#f87171', background: 'rgba(239,68,68,0.08)' }}
                    >
                      Clear
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="px-6 pb-32 max-w-3xl mx-auto">

        {/* ── Stats row ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { icon: Dumbbell, label: 'Exercises',     value: exercises.length, color: '#FF8A1F' },
            { icon: Timer,    label: 'Est. Duration',  value: `${estMinutes}m`, color: '#60a5fa' },
            { icon: Flame,    label: 'Est. Calories',  value: `~${estCals}`,    color: '#f97316' },
          ].map(({ icon: Icon, label, value, color }) => (
            <div
              key={label}
              className="rounded-2xl p-4 text-center"
              style={{
                background: 'rgba(255,255,255,0.03)',
                border:     '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <Icon className="w-4 h-4 mx-auto mb-1.5" style={{ color }} />
              <p className="text-xl font-bold text-white tabular-nums">{value}</p>
              <p className="text-2xs mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
                {label}
              </p>
            </div>
          ))}
        </div>

        {/* ── Empty state ───────────────────────────────────────────────── */}
        {exercises.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0  }}
            className="space-y-4"
          >
            <div
              className="relative overflow-hidden rounded-3xl text-center"
              style={{ height: 320 }}
            >
              <img
                src="/images/exercises/squat.png"
                alt="Add exercises"
                className="absolute inset-0 w-full h-full object-cover"
                style={{ objectPosition: 'center top' }}
              />
              <div
                className="absolute inset-0"
                style={{
                  background: 'linear-gradient(to top, rgba(10,9,8,0.97) 0%, rgba(10,9,8,0.6) 60%, rgba(10,9,8,0.3) 100%)',
                }}
              />
              <div className="absolute inset-0 flex flex-col items-center justify-end pb-8">
                <h3 className="text-xl font-bold text-white mb-2">
                  No exercises yet
                </h3>
                <p className="text-sm mb-5" style={{ color: 'rgba(255,255,255,0.40)' }}>
                  Browse the library or load a saved template
                </p>
                <div className="flex gap-3">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setShowTemplates(true)}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl
                               text-sm font-semibold"
                    style={{
                      background: 'rgba(255,255,255,0.08)',
                      border:     '1px solid rgba(255,255,255,0.12)',
                      color:      'rgba(255,255,255,0.85)',
                    }}
                  >
                    <FolderOpen className="w-4 h-4" />
                    Load Template
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => triggerTransition(() => navigate('/exercises'))}
                    className="btn-primary"
                  >
                    <Plus className="w-4 h-4" />
                    Browse Exercises
                  </motion.button>
                </div>
              </div>
            </div>
          </motion.div>
        ) : (
          /* ── Exercise list ─────────────────────────────────────────── */
          <div className="space-y-3">
            <AnimatePresence>
              {exercises.map((exercise, index) => (
                <motion.div
                  key={exercise.id || index}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0  }}
                  exit={{ opacity: 0, x: -20, scale: 0.95 }}
                  transition={{ delay: index * 0.04 }}
                  className="rounded-2xl overflow-hidden"
                  style={{
                    background: '#121110',
                    border:     '1px solid rgba(255,255,255,0.05)',
                  }}
                >
                  {/* Header */}
                  <div className="flex items-center gap-3 p-4 pb-3">
                    <div
                      className="w-7 h-7 rounded-lg flex items-center
                                 justify-center flex-shrink-0 text-xs font-bold"
                      style={{
                        background: 'rgba(255,138,31,0.12)',
                        color:      '#FF8A1F',
                      }}
                    >
                      {index + 1}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4
                          className="text-sm font-semibold truncate"
                          style={{ color: 'rgba(255,255,255,0.90)' }}
                        >
                          {exercise.name}
                        </h4>
                        {exercise.ai_supported && (
                          <span
                            className="text-2xs font-bold px-1.5 py-0.5
                                       rounded-md flex items-center gap-0.5
                                       flex-shrink-0"
                            style={{
                              background: 'rgba(139,92,246,0.15)',
                              color:      '#a78bfa',
                            }}
                          >
                            <Zap className="w-2.5 h-2.5" />
                            AI
                          </span>
                        )}
                      </div>
                      <p
                        className="text-2xs mt-0.5 truncate"
                        style={{ color: 'rgba(255,255,255,0.30)' }}
                      >
                        {exercise.primary_category || exercise.category}
                      </p>
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => moveUp(index)}
                        disabled={index === 0}
                        className="btn-icon w-7 h-7 disabled:opacity-20"
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => moveDown(index)}
                        disabled={index === exercises.length - 1}
                        className="btn-icon w-7 h-7 disabled:opacity-20"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => removeExercise(index)}
                        className="btn-icon w-7 h-7 ml-1"
                        style={{ color: '#f87171' }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239,68,68,0.1)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Divider */}
                  <div
                    className="mx-4"
                    style={{ height: 1, background: 'rgba(255,255,255,0.04)' }}
                  />

                  {/* Controls */}
                  <div
                    className="grid grid-cols-3 gap-px p-3"
                    style={{ background: 'rgba(255,255,255,0.02)' }}
                  >
                    {[
                      { label: 'Sets',     field: 'sets', default: 3,  min: 1, max: 10  },
                      { label: 'Reps',     field: 'reps', default: 12, min: 1, max: 50  },
                      { label: 'Rest (s)', field: 'rest', default: 60, min: 0, max: 300 },
                    ].map(({ label, field, default: def, min, max }) => {
                      const val = exercise[field] ?? def;
                      return (
                        <div
                          key={field}
                          className="flex flex-col items-center gap-2 py-3 px-2 rounded-xl"
                          style={{ background: 'rgba(255,255,255,0.02)' }}
                        >
                          <p
                            className="text-2xs font-medium uppercase tracking-wider"
                            style={{ color: 'rgba(255,255,255,0.30)' }}
                          >
                            {label}
                          </p>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => updateExercise(index, field, Math.max(min, val - 1))}
                              className="w-6 h-6 rounded-lg flex items-center
                                         justify-center transition-all duration-150"
                              style={{ background: 'rgba(255,255,255,0.06)' }}
                              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,138,31,0.15)'}
                              onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                            >
                              <Minus className="w-3 h-3 text-white" />
                            </button>
                            <span
                              className="text-xl font-bold tabular-nums w-8 text-center"
                              style={{ color: 'rgba(255,255,255,0.95)' }}
                            >
                              {val}
                            </span>
                            <button
                              onClick={() => updateExercise(index, field, Math.min(max, val + 1))}
                              className="w-6 h-6 rounded-lg flex items-center
                                         justify-center transition-all duration-150"
                              style={{ background: 'rgba(255,255,255,0.06)' }}
                              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,138,31,0.15)'}
                              onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                            >
                              <Plus className="w-3 h-3 text-white" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* ── Bottom action bar ─────────────────────────────────────────────── */}
      {exercises.length > 0 && (
        <motion.div
          initial={{ y: 100 }}
          animate={{ y: 0   }}
          className="fixed bottom-0 left-0 right-0 p-4 z-30"
          style={{
            background:    'rgba(10,9,8,0.92)',
            backdropFilter:'blur(20px)',
            borderTop:     '1px solid rgba(255,255,255,0.05)',
            marginLeft:    220,
          }}
        >
          <div className="max-w-3xl mx-auto flex gap-3">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => triggerTransition(() => navigate('/exercises'))}
              className="btn-secondary flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add More
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              onClick={handleStartWorkout}
              disabled={loading}
              className="flex-1 py-3 rounded-2xl font-semibold text-sm
                         text-white flex items-center justify-center gap-2"
              style={{
                background: 'linear-gradient(135deg, #FF8A1F, #FFB347)',
                boxShadow:  '0 4px 20px rgba(255,138,31,0.35)',
              }}
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white
                                border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Start Workout
                </>
              )}
            </motion.button>
          </div>
        </motion.div>
      )}

      {/* Modals */}
      <TemplatesModal
        open={showTemplates}
        onClose={() => setShowTemplates(false)}
        onLoad={handleLoadTemplate}
      />
      <SaveTemplateModal
        open={showSave}
        defaultName={name}
        onClose={() => setShowSave(false)}
        onSave={handleSaveTemplate}
      />
    </div>
  );
}