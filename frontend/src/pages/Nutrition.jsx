import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Plus, Trash2, Camera, X, Loader2,
  Flame, Coffee, UtensilsCrossed, Sandwich, Cookie,
  Sparkles, Check,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { nutritionService } from '../api/nutritionApi';
import MacroRings from '../components/nutrition/MacroRings';

// ── Meal type config ──────────────────────────────────────────────────────────
const MEAL_TYPES = [
  { id: 'breakfast', label: 'Breakfast', icon: Coffee,           color: '#FFB347' },
  { id: 'lunch',     label: 'Lunch',     icon: UtensilsCrossed,  color: '#FF8A1F' },
  { id: 'dinner',    label: 'Dinner',    icon: Sandwich,         color: '#a78bfa' },
  { id: 'snack',     label: 'Snack',     icon: Cookie,           color: '#60a5fa' },
];

// ── Single logged meal row ────────────────────────────────────────────────────
function MealRow({ meal, onDelete }) {
  const time = meal.consumed_at
    ? new Date(meal.consumed_at).toLocaleTimeString([], {
        hour: '2-digit', minute: '2-digit',
      })
    : '';

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      className="group flex items-center justify-between py-2.5 px-3 rounded-xl
                 transition-all"
      style={{ background: 'rgba(255,255,255,0.02)' }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-white truncate">
            {meal.food_name}
          </p>
          <span className="text-2xs" style={{ color: 'rgba(255,255,255,0.30)' }}>
            {time}
          </span>
        </div>
        <p className="text-2xs mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {Math.round(meal.kcal)} kcal · P {Math.round(meal.protein_g)}g
          · C {Math.round(meal.carbs_g)}g · F {Math.round(meal.fat_g)}g
        </p>
      </div>
      <button
        onClick={() => onDelete(meal.id)}
        className="opacity-0 group-hover:opacity-100 transition-opacity
                   p-1.5 rounded-lg"
        style={{ color: 'rgba(239,68,68,0.7)' }}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </motion.div>
  );
}

// ── Meal type section ─────────────────────────────────────────────────────────
function MealSection({ mealType, meals, onAdd, onDelete }) {
  const Icon = mealType.icon;
  const total = meals.reduce((sum, m) => sum + (m.kcal || 0), 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="card-glass"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{
              background: `${mealType.color}18`,
              border:     `1px solid ${mealType.color}33`,
            }}
          >
            <Icon className="w-4 h-4" style={{ color: mealType.color }} />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">{mealType.label}</p>
            <p className="text-2xs" style={{ color: 'rgba(255,255,255,0.40)' }}>
              {meals.length} item{meals.length !== 1 ? 's' : ''} · {Math.round(total)} kcal
            </p>
          </div>
        </div>
        <button
          onClick={() => onAdd(mealType.id)}
          className="w-8 h-8 rounded-lg flex items-center justify-center
                     transition-all"
          style={{
            background: 'rgba(255,138,31,0.10)',
            border:     '1px solid rgba(255,138,31,0.20)',
          }}
        >
          <Plus className="w-4 h-4" style={{ color: '#FF8A1F' }} />
        </button>
      </div>
      <div className="space-y-1">
        <AnimatePresence>
          {meals.map((m) => (
            <MealRow key={m.id} meal={m} onDelete={onDelete} />
          ))}
        </AnimatePresence>
        {meals.length === 0 && (
          <p className="text-xs py-3 text-center"
             style={{ color: 'rgba(255,255,255,0.25)' }}>
            No {mealType.label.toLowerCase()} logged yet
          </p>
        )}
      </div>
    </motion.div>
  );
}

// ── Food search & add modal ───────────────────────────────────────────────────
function AddMealModal({ open, mealType, onClose, onSave }) {
  const [query,    setQuery]    = useState('');
  const [results,  setResults]  = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [selected, setSelected] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const searchRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setSelected(null);
      setQuantity(1);
      setTimeout(() => searchRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    if (!query || query.length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await nutritionService.searchFood(query, 15);
        setResults(res.data.results || []);
      } catch (err) {
        console.error('Search failed:', err);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const handleSave = async () => {
    if (!selected) return;
    const meal = {
      meal_type:   mealType,
      food_name:   selected.name,
      quantity:    quantity,
      kcal:        selected.kcal      * quantity,
      protein_g:   selected.protein_g * quantity,
      carbs_g:     selected.carbs_g   * quantity,
      fat_g:       selected.fat_g     * quantity,
      fiber_g:     (selected.fiber_g || 0) * quantity,
    };
    try {
      await nutritionService.logMeal(meal);
      toast.success(`Added ${selected.name}`);
      onSave();
      onClose();
    } catch (err) {
      toast.error('Failed to log meal');
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
            maxHeight:  '85vh',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4"
               style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <h3 className="text-base font-bold text-white">
              Add to {MEAL_TYPES.find(m => m.id === mealType)?.label || 'meal'}
            </h3>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,0.04)' }}
            >
              <X className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.5)' }} />
            </button>
          </div>

          {/* Search */}
          <div className="p-5">
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                style={{ color: 'rgba(255,255,255,0.40)' }}
              />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search food..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm
                           focus:outline-none transition-all"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border:     '1px solid rgba(255,255,255,0.08)',
                  color:      '#fff',
                }}
              />
            </div>
          </div>

          {/* Results */}
          <div className="flex-1 overflow-y-auto px-5 no-scrollbar">
            {loading && (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin"
                         style={{ color: 'rgba(255,138,31,0.5)' }} />
              </div>
            )}

            {!loading && results.length === 0 && query.length >= 2 && (
              <p className="text-center text-xs py-8"
                 style={{ color: 'rgba(255,255,255,0.30)' }}>
                No foods found
              </p>
            )}

            <div className="space-y-1.5 pb-4">
              {results.map((r, i) => (
                <button
                  key={i}
                  onClick={() => setSelected(r)}
                  className="w-full text-left rounded-xl p-3 transition-all"
                  style={{
                    background: selected === r
                      ? 'rgba(255,138,31,0.10)'
                      : 'rgba(255,255,255,0.02)',
                    border: selected === r
                      ? '1px solid rgba(255,138,31,0.30)'
                      : '1px solid rgba(255,255,255,0.04)',
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">
                        {r.name}
                      </p>
                      <p className="text-2xs mt-0.5"
                         style={{ color: 'rgba(255,255,255,0.45)' }}>
                        {r.kcal} kcal · P {r.protein_g}g
                        · C {r.carbs_g}g · F {r.fat_g}g
                        <span className="ml-1"
                              style={{ color: 'rgba(255,255,255,0.25)' }}>
                          / {r.serving_size}{r.serving_unit}
                        </span>
                      </p>
                    </div>
                    {selected === r && (
                      <Check className="w-4 h-4 flex-shrink-0"
                             style={{ color: '#FF8A1F' }} />
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Quantity + Save */}
          {selected && (
            <div className="p-5"
                 style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <div className="flex items-center gap-3 mb-4">
                <p className="text-xs font-medium"
                   style={{ color: 'rgba(255,255,255,0.60)' }}>
                  Quantity:
                </p>
                <input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(0.1, parseFloat(e.target.value) || 1))}
                  step="0.5"
                  min="0.1"
                  className="w-20 px-3 py-1.5 rounded-lg text-sm focus:outline-none"
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border:     '1px solid rgba(255,255,255,0.08)',
                    color:      '#fff',
                  }}
                />
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.40)' }}>
                  × {selected.serving_size}{selected.serving_unit}
                </p>
                <p className="ml-auto text-sm font-bold"
                   style={{ color: '#FF8A1F' }}>
                  {Math.round(selected.kcal * quantity)} kcal
                </p>
              </div>
              <button
                onClick={handleSave}
                className="w-full py-2.5 rounded-xl font-semibold text-sm text-white"
                style={{
                  background: 'linear-gradient(135deg, #FF8A1F, #FFB347)',
                  boxShadow:  '0 4px 16px rgba(255,138,31,0.25)',
                }}
              >
                Add to {MEAL_TYPES.find(m => m.id === mealType)?.label}
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ── AI Photo Upload Modal ─────────────────────────────────────────────────────
function PhotoModal({ open, onClose, onSave }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis,  setAnalysis]  = useState(null);
  const [preview,   setPreview]   = useState(null);
  const [mealType,  setMealType]  = useState('lunch');
  const fileRef = useRef(null);

  useEffect(() => {
    if (open) {
      setAnalysis(null);
      setPreview(null);
      setAnalyzing(false);
      setMealType('lunch');
    }
  }, [open]);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPreview(URL.createObjectURL(file));
    setAnalyzing(true);
    setAnalysis(null);

    try {
      const res = await nutritionService.analyzePhoto(file);
      setAnalysis(res.analysis);
    } catch (err) {
      toast.error(err.message || 'Photo analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSaveAll = async () => {
    if (!analysis) return;
    try {
      for (const item of analysis.items) {
        await nutritionService.logMeal({
          meal_type:  mealType,
          food_name:  item.name,
          quantity:   1,
          kcal:       item.kcal,
          protein_g:  item.protein_g,
          carbs_g:    item.carbs_g,
          fat_g:      item.fat_g,
          fiber_g:    item.fiber_g,
          notes:      `Estimated from photo: ${analysis.meal_name}`,
        });
      }
      toast.success(`Logged ${analysis.items.length} item(s) from photo`);
      onSave();
      onClose();
    } catch (err) {
      toast.error('Failed to log meals');
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
          className="w-full max-w-md rounded-3xl flex flex-col"
          style={{
            background: '#121110',
            border:     '1px solid rgba(255,255,255,0.06)',
            maxHeight:  '85vh',
          }}
        >
          <div className="flex items-center justify-between px-5 py-4"
               style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4" style={{ color: '#FF8A1F' }} />
              <h3 className="text-base font-bold text-white">AI Photo Log</h3>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,0.04)' }}
            >
              <X className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.5)' }} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 no-scrollbar">
            {!preview ? (
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full py-12 rounded-2xl border-2 border-dashed
                           flex flex-col items-center gap-3 transition-all"
                style={{
                  borderColor: 'rgba(255,138,31,0.25)',
                  background:  'rgba(255,138,31,0.04)',
                }}
              >
                <Camera className="w-8 h-8" style={{ color: '#FF8A1F' }} />
                <div className="text-center">
                  <p className="text-sm font-semibold text-white">Snap or upload</p>
                  <p className="text-xs mt-1"
                     style={{ color: 'rgba(255,255,255,0.50)' }}>
                    Groq AI will estimate the macros
                  </p>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFile}
                  className="hidden"
                />
              </button>
            ) : (
              <div className="space-y-4">
                <img
                  src={preview}
                  alt="Meal"
                  className="w-full rounded-2xl object-cover"
                  style={{ maxHeight: 240 }}
                />

                {analyzing && (
                  <div className="flex items-center justify-center gap-2 py-6"
                       style={{
                         background: 'rgba(255,138,31,0.05)',
                         border:     '1px solid rgba(255,138,31,0.15)',
                         borderRadius: 16,
                       }}>
                    <Loader2 className="w-4 h-4 animate-spin"
                             style={{ color: '#FF8A1F' }} />
                    <p className="text-sm font-medium"
                       style={{ color: 'rgba(255,138,31,0.85)' }}>
                      Analyzing your meal...
                    </p>
                  </div>
                )}

                {analysis && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider mb-2"
                       style={{ color: '#FF8A1F' }}>
                      AI Analysis · {analysis.confidence} confidence
                    </p>
                    <p className="text-base font-bold text-white mb-1">
                      {analysis.meal_name}
                    </p>
                    <p className="text-xs mb-4"
                       style={{ color: 'rgba(255,255,255,0.45)' }}>
                      {analysis.notes}
                    </p>

                    <div className="space-y-2 mb-4">
                      {analysis.items.map((item, i) => (
                        <div key={i}
                             className="p-2.5 rounded-xl"
                             style={{ background: 'rgba(255,255,255,0.02)' }}>
                          <div className="flex justify-between">
                            <p className="text-sm font-semibold text-white">
                              {item.name}
                            </p>
                            <p className="text-sm font-bold"
                               style={{ color: '#FF8A1F' }}>
                              {Math.round(item.kcal)} kcal
                            </p>
                          </div>
                          <p className="text-2xs mt-0.5"
                             style={{ color: 'rgba(255,255,255,0.45)' }}>
                            {item.estimated_quantity} · P {Math.round(item.protein_g)}g
                            · C {Math.round(item.carbs_g)}g · F {Math.round(item.fat_g)}g
                          </p>
                        </div>
                      ))}
                    </div>

                    <div
                      className="rounded-xl p-3 mb-4"
                      style={{
                        background: 'rgba(255,138,31,0.08)',
                        border:     '1px solid rgba(255,138,31,0.20)',
                      }}
                    >
                      <p className="text-xs font-semibold mb-1"
                         style={{ color: 'rgba(255,138,31,0.85)' }}>
                        TOTAL
                      </p>
                      <p className="text-xl font-bold tracking-tight"
                         style={{ color: '#FF8A1F' }}>
                        {Math.round(analysis.totals.kcal)} kcal
                      </p>
                      <p className="text-2xs mt-0.5"
                         style={{ color: 'rgba(255,138,31,0.65)' }}>
                        P {Math.round(analysis.totals.protein_g)}g
                        · C {Math.round(analysis.totals.carbs_g)}g
                        · F {Math.round(analysis.totals.fat_g)}g
                      </p>
                    </div>

                    {/* Meal type selector */}
                    <div className="flex gap-2 mb-4">
                      {MEAL_TYPES.map((mt) => (
                        <button
                          key={mt.id}
                          onClick={() => setMealType(mt.id)}
                          className="flex-1 py-2 rounded-lg text-xs font-semibold
                                     transition-all capitalize"
                          style={{
                            background: mealType === mt.id
                              ? `${mt.color}20`
                              : 'rgba(255,255,255,0.03)',
                            border: mealType === mt.id
                              ? `1px solid ${mt.color}50`
                              : '1px solid rgba(255,255,255,0.05)',
                            color: mealType === mt.id
                              ? mt.color
                              : 'rgba(255,255,255,0.50)',
                          }}
                        >
                          {mt.label}
                        </button>
                      ))}
                    </div>

                    <button
                      onClick={handleSaveAll}
                      className="w-full py-2.5 rounded-xl font-semibold text-sm text-white"
                      style={{
                        background: 'linear-gradient(135deg, #FF8A1F, #FFB347)',
                        boxShadow:  '0 4px 16px rgba(255,138,31,0.25)',
                      }}
                    >
                      Log {analysis.items.length} item{analysis.items.length !== 1 ? 's' : ''}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Main Nutrition page ───────────────────────────────────────────────────────
export default function Nutrition() {
  const [data,           setData]            = useState(null);
  const [loading,        setLoading]         = useState(true);
  const [addModal,       setAddModal]        = useState({ open: false, mealType: null });
  const [photoModalOpen, setPhotoModalOpen]  = useState(false);

  const loadData = async () => {
    try {
      const res = await nutritionService.getTodayMeals();
      setData(res.data);
    } catch (err) {
      console.error('Failed to load meals:', err);
      toast.error('Failed to load nutrition data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleDelete = async (mealId) => {
    try {
      await nutritionService.deleteMeal(mealId);
      toast.success('Meal removed');
      loadData();
    } catch (err) {
      toast.error('Failed to delete');
    }
  };

  const totals    = data?.totals    || {};
  const targets   = data?.targets   || {};
  const remaining = data?.remaining || {};
  const byType    = data?.by_type   || {};

  return (
    <div className="nutrition-page min-h-screen p-6 relative" style={{ background: '#0A0908' }}>

      {/* Ambient glow */}
      <div
        className="fixed pointer-events-none"
        style={{
          top:       -200,
          right:     -200,
          width:     600,
          height:    600,
          background:'radial-gradient(ellipse, rgba(255,138,31,0.06) 0%, transparent 70%)',
          zIndex:    0,
        }}
      />

      {/* ── Nutrition watermark (behind content, below hero) ─────────────── */}
      <div
        className="fixed pointer-events-none flex items-center justify-center"
        style={{
          top:    280,
          left:   0,
          right:  0,
          bottom: 0,
          zIndex: 0,
        }}
      >
        <div
          style={{
            width:           600,
            height:          600,
            backgroundImage:    "url('/images/nutrition/download.png')",
            backgroundSize:     'contain',
            backgroundRepeat:   'no-repeat',
            backgroundPosition: 'center center',
            opacity:         0.40,
            maskImage:       'radial-gradient(ellipse 60% 60% at 50% 50%, black 35%, transparent 80%)',
            WebkitMaskImage: 'radial-gradient(ellipse 60% 60% at 50% 50%, black 35%, transparent 80%)',
          }}
        />
      </div>

      {/* ── Full-page static background image ────────────────────────────── */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage:    "url('/images/nutrition/download.png')",
          backgroundSize:     'cover',
          backgroundRepeat:   'no-repeat',
          backgroundPosition: 'center center',
          opacity:            0.15,
          zIndex:             0,
        }}
      />

      <div className="max-w-5xl mx-auto relative z-10 space-y-6">

        {/* Hero header */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="relative overflow-hidden rounded-3xl"
          style={{ height: 200 }}
        >
          <img
            src="/images/nutrition/food.jpg"
            alt="Nutrition"
            className="w-full h-full object-cover"
            style={{ objectPosition: 'center 50%' }}
          />
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(90deg, rgba(10,9,8,0.95) 0%, rgba(10,9,8,0.5) 60%, rgba(10,9,8,0.1) 100%)',
            }}
          />
          <div className="absolute inset-0 flex items-center px-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest mb-2"
                 style={{ color: '#FF8A1F' }}>
                Nutrition
              </p>
              <h1 className="text-3xl font-bold tracking-tighter text-white mb-2">
                Fuel Your Training
              </h1>
              <button
                onClick={() => setPhotoModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl
                           font-semibold text-sm text-white"
                style={{
                  background: 'rgba(255,138,31,0.15)',
                  border:     '1px solid rgba(255,138,31,0.30)',
                  backdropFilter: 'blur(10px)',
                }}
              >
                <Camera className="w-4 h-4" />
                <Sparkles className="w-3 h-3" />
                Log meal from photo
              </button>
            </div>
          </div>
        </motion.div>

        {loading ? (
          <div className="card-glass flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin"
                     style={{ color: 'rgba(255,138,31,0.5)' }} />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* ── Left: Macro rings + remaining ─────────────────────────────── */}
            <div className="lg:col-span-1 space-y-4">
              <MacroRings totals={totals} targets={targets} />

              {/* Remaining card */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="card-glass"
              >
                <div className="flex items-center gap-2 mb-3">
                  <Flame className="w-4 h-4" style={{ color: '#FF8A1F' }} />
                  <h3 className="text-sm font-semibold"
                      style={{ color: 'rgba(255,255,255,0.80)' }}>
                    Remaining today
                  </h3>
                </div>
                <div className="space-y-2.5">
                  {[
                    { label: 'Calories', value: remaining.kcal,      unit: 'kcal', color: '#FF8A1F' },
                    { label: 'Protein',  value: remaining.protein_g, unit: 'g',    color: '#4ade80' },
                    { label: 'Carbs',    value: remaining.carbs_g,   unit: 'g',    color: '#60a5fa' },
                    { label: 'Fat',      value: remaining.fat_g,     unit: 'g',    color: '#fbbf24' },
                  ].map((r) => (
                    <div key={r.label} className="flex justify-between items-center">
                      <span className="text-xs"
                            style={{ color: 'rgba(255,255,255,0.50)' }}>
                        {r.label}
                      </span>
                      <span className="text-sm font-semibold tabular-nums"
                            style={{ color: r.color }}>
                        {r.value || 0}{r.unit}
                      </span>
                    </div>
                  ))}
                </div>
              </motion.div>
            </div>

            {/* ── Right: Meal sections ──────────────────────────────────────── */}
            <div className="lg:col-span-2 space-y-4">
              {MEAL_TYPES.map((mt) => (
                <MealSection
                  key={mt.id}
                  mealType={mt}
                  meals={byType[mt.id] || []}
                  onAdd={(id) => setAddModal({ open: true, mealType: id })}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      <AddMealModal
        open={addModal.open}
        mealType={addModal.mealType}
        onClose={() => setAddModal({ open: false, mealType: null })}
        onSave={loadData}
      />
      <PhotoModal
        open={photoModalOpen}
        onClose={() => setPhotoModalOpen(false)}
        onSave={loadData}
      />
    </div>
  );
}