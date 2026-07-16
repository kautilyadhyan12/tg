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
// Card 5a: new /v1 meal shape — {id, takenAt, mealName, items, totals}.
// totals are SERVER-computed (2B: client never does nutrition arithmetic).
function MealRow({ meal, onDelete }) {
  const time = meal.takenAt
    ? new Date(meal.takenAt).toLocaleTimeString([], {
        hour: '2-digit', minute: '2-digit',
      })
    : '';
  const name = meal.mealName || meal.items?.[0]?.name || 'Meal';
  const t = meal.totals || {};

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
            {name}
          </p>
          <span className="text-2xs" style={{ color: 'rgba(255,255,255,0.30)' }}>
            {time}
          </span>
        </div>
        <p className="text-2xs mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {Math.round(t.kcalPoint || 0)} kcal · Protein {Math.round(t.proteinG || 0)}g
          · Carbs {Math.round(t.carbsG || 0)}g · Fat {Math.round(t.fatG || 0)}g
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
  // Display-summing SERVER-computed per-meal totals (D3 doctrine).
  const total = meals.reduce((sum, m) => sum + (m.totals?.kcalPoint || 0), 0);

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
// Card 5a: photo → analysis (scanToken) → user reviews/edits grams → ONE
// confirm POST creates the meal (replaces the old N× logMeal loop). Macros
// come back SERVER-computed; a poor photo is a 422 that may carry a
// retakeToken (one free retry — Part 2B §3.5).
function PhotoModal({ open, onClose, onSave }) {
  const [analyzing,   setAnalyzing]   = useState(false);
  const [analysis,    setAnalysis]    = useState(null);
  const [preview,     setPreview]     = useState(null);
  const [grams,       setGrams]       = useState({});
  const [counts,      setCounts]      = useState({});
  const [live,        setLive]        = useState(null);
  const [retakeToken, setRetakeToken] = useState(null);
  const [retakeMsg,   setRetakeMsg]   = useState(null);
  const [saving,      setSaving]      = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (open) {
      setAnalysis(null);
      setPreview(null);
      setAnalyzing(false);
      setGrams({});
      setCounts({});
      setLive(null);
      setRetakeToken(null);
      setRetakeMsg(null);
      setSaving(false);
    }
  }, [open]);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPreview(URL.createObjectURL(file));
    setAnalyzing(true);
    setAnalysis(null);
    setRetakeMsg(null);

    try {
      const res = await nutritionService.analyzePhoto(file, retakeToken);
      setRetakeToken(null);
      setAnalysis(res.data);
      // Grams default to the server's estimate; the user can correct them —
      // by count (stepper, e.g. the AI saw 1 apple but there are 3) or by
      // typing grams directly. The server computes ALL nutrition from grams.
      const g = {};
      const c = {};
      res.data.items.forEach((item, i) => { g[i] = String(item.gramsPoint); c[i] = 1; });
      setGrams(g);
      setCounts(c);
      setLive(null);
    } catch (err) {
      if (err.response?.status === 422) {
        // Poor photo / unreadable — the retakeToken makes the next attempt free.
        setRetakeToken(err.response.data?.retakeToken || null);
        setRetakeMsg(
          err.response.data?.retakeToken
            ? "Couldn't read that photo — try again with better lighting (free retry)."
            : "Couldn't read that photo — please try another one.",
        );
        setPreview(null);
      } else if (err.response?.status === 429) {
        toast.error('Monthly photo-scan limit reached.');
        setPreview(null);
      } else {
        toast.error(err.message || 'Photo analysis failed');
        setPreview(null);
      }
    } finally {
      setAnalyzing(false);
    }
  };

  // Live server preview (Kd-approved): whenever grams change, ask the SERVER
  // what the nutrition would be — the browser never computes it. Debounced;
  // failures degrade silently to the analysis estimates (e.g. old API).
  useEffect(() => {
    if (!analysis) return undefined;
    const timer = setTimeout(async () => {
      try {
        const res = await nutritionService.previewMeal({
          scanToken: analysis.scanToken,
          items: analysis.items.map((item, i) => ({
            canonical: item.canonical,
            grams: parseFloat(grams[i]) || item.gramsPoint,
          })),
        });
        setLive(res.data);
      } catch {
        setLive(null);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [analysis, grams]);

  const handleConfirm = async () => {
    if (!analysis || saving) return;
    setSaving(true);
    try {
      await nutritionService.confirmMeal({
        scanToken: analysis.scanToken,
        takenAt: new Date().toISOString(),
        items: analysis.items.map((item, i) => ({
          canonical: item.canonical,
          grams: parseFloat(grams[i]) || item.gramsPoint,
        })),
      });
      toast.success(`Logged ${analysis.mealName || 'meal'}`);
      onSave();
      onClose();
    } catch (err) {
      toast.error('Failed to log the meal');
    } finally {
      setSaving(false);
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
                  <p className="text-sm font-semibold text-white">
                    {retakeMsg ? 'Try another photo' : 'Snap or upload'}
                  </p>
                  <p className="text-xs mt-1"
                     style={{ color: retakeMsg ? 'rgba(251,191,36,0.85)' : 'rgba(255,255,255,0.50)' }}>
                    {retakeMsg || 'AI estimates the portions — you confirm them'}
                  </p>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
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
                      AI Analysis · {analysis.photoQuality === 'good' ? 'clear photo' : 'low confidence'}
                    </p>
                    <p className="text-base font-bold text-white mb-1">
                      {analysis.mealName}
                    </p>
                    <p className="text-xs mb-4"
                       style={{ color: 'rgba(255,255,255,0.45)' }}>
                      Check the portion sizes below — you can adjust the grams
                      before saving.
                    </p>

                    <div className="space-y-2 mb-4">
                      {analysis.items.map((item, i) => {
                        // Server-computed live numbers for the CURRENT grams
                        // (2B: never computed in the browser); fall back to
                        // the analysis estimate until the preview answers.
                        const shown = live?.items?.[i] ?? item;
                        return (
                        <div key={i}
                             className="p-2.5 rounded-xl"
                             style={{ background: 'rgba(255,255,255,0.02)' }}>
                          <div className="flex justify-between">
                            <p className="text-sm font-semibold text-white">
                              {item.name}
                            </p>
                            <p className="text-sm font-bold"
                               style={{ color: '#FF8A1F' }}>
                              {shown.kcalLow === shown.kcalHigh
                                ? `${shown.kcalPoint} kcal`
                                : `${shown.kcalLow}–${shown.kcalHigh} kcal`}
                            </p>
                          </div>
                          <div className="flex items-center justify-between mt-1">
                            <p className="text-2xs"
                               style={{ color: 'rgba(255,255,255,0.45)' }}>
                              Protein {Math.round(shown.proteinG)}g
                              · Carbs {Math.round(shown.carbsG)}g · Fat {Math.round(shown.fatG)}g
                            </p>
                            <div className="flex items-center gap-2">
                              {/* Count stepper: multiplies the AI's per-unit
                                  grams (count × gramsPoint) — portion scaling
                                  only; nutrition math stays on the server. */}
                              <div className="flex items-center gap-1 text-2xs"
                                   style={{ color: 'rgba(255,255,255,0.45)' }}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const n = Math.max(1, (counts[i] ?? 1) - 1);
                                    setCounts({ ...counts, [i]: n });
                                    setGrams({ ...grams, [i]: String(Math.min(10000, Math.round(n * item.gramsPoint))) });
                                  }}
                                  className="w-6 h-6 rounded-md"
                                  style={{ background: 'rgba(255,255,255,0.06)', color: '#fff' }}
                                >
                                  −
                                </button>
                                <span className="w-6 text-center text-xs text-white">×{counts[i] ?? 1}</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const n = Math.min(30, (counts[i] ?? 1) + 1);
                                    setCounts({ ...counts, [i]: n });
                                    setGrams({ ...grams, [i]: String(Math.min(10000, Math.round(n * item.gramsPoint))) });
                                  }}
                                  className="w-6 h-6 rounded-md"
                                  style={{ background: 'rgba(255,255,255,0.06)', color: '#fff' }}
                                >
                                  +
                                </button>
                              </div>
                              <label className="flex items-center gap-1.5 text-2xs"
                                     style={{ color: 'rgba(255,255,255,0.45)' }}>
                                <input
                                  type="number"
                                  value={grams[i] ?? ''}
                                  min="1"
                                  max="10000"
                                  onChange={(e) => setGrams({ ...grams, [i]: e.target.value })}
                                  className="w-16 px-2 py-1 rounded-lg text-xs text-right focus:outline-none"
                                  style={{
                                    background: 'rgba(255,255,255,0.06)',
                                    border:     '1px solid rgba(255,255,255,0.10)',
                                    color:      '#fff',
                                  }}
                                />
                                g
                              </label>
                            </div>
                          </div>
                        </div>
                        );
                      })}
                    </div>

                    {analysis.unknownItems?.length > 0 && (
                      <p className="text-2xs mb-4"
                         style={{ color: 'rgba(251,191,36,0.75)' }}>
                        Couldn't identify: {analysis.unknownItems.join(', ')} —
                        add them manually if needed.
                      </p>
                    )}

                    <div
                      className="rounded-xl p-3 mb-4"
                      style={{
                        background: 'rgba(255,138,31,0.08)',
                        border:     '1px solid rgba(255,138,31,0.20)',
                      }}
                    >
                      <p className="text-xs font-semibold mb-1"
                         style={{ color: 'rgba(255,138,31,0.85)' }}>
                        {live ? 'TOTAL (updates as you adjust)' : 'ESTIMATED TOTAL'}
                      </p>
                      <p className="text-xl font-bold tracking-tight"
                         style={{ color: '#FF8A1F' }}>
                        {(live?.totals ?? analysis.totals).kcalLow === (live?.totals ?? analysis.totals).kcalHigh
                          ? `${(live?.totals ?? analysis.totals).kcalPoint} kcal`
                          : `${(live?.totals ?? analysis.totals).kcalLow}–${(live?.totals ?? analysis.totals).kcalHigh} kcal`}
                      </p>
                      <p className="text-2xs mt-0.5"
                         style={{ color: 'rgba(255,138,31,0.65)' }}>
                        Protein {Math.round((live?.totals ?? analysis.totals).proteinG)}g
                        · Carbs {Math.round((live?.totals ?? analysis.totals).carbsG)}g
                        · Fat {Math.round((live?.totals ?? analysis.totals).fatG)}g
                      </p>
                    </div>

                    <p className="text-2xs mb-3"
                       style={{ color: 'rgba(255,255,255,0.40)' }}>
                      {live
                        ? 'All numbers are calculated by the server for your chosen amounts.'
                        : "Numbers above are the AI's first estimate — final nutrition is recalculated from your grams when you save."}
                    </p>

                    <button
                      onClick={handleConfirm}
                      disabled={saving}
                      className="w-full py-2.5 rounded-xl font-semibold text-sm text-white"
                      style={{
                        background: 'linear-gradient(135deg, #FF8A1F, #FFB347)',
                        boxShadow:  '0 4px 16px rgba(255,138,31,0.25)',
                        opacity:    saving ? 0.6 : 1,
                      }}
                    >
                      {saving ? 'Saving…' : 'Confirm & log meal'}
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

// ── D1(a), Kd-ruled (Card 5a; boundaries revised at the 5a smoke): the new
// model stores no meal type — buckets are DISPLAY-ONLY, derived from the
// meal's own timestamp. Nothing invented into the data. before 11 =
// breakfast · 11–16 = lunch · 16–19 = snack · 19–22 = dinner · else snack
// (local time, matching the times the user sees on each row). A user-chosen
// override needs a mealType API field — owed in RUNBOOK/cutover.md; an
// edit-takenAt control (field + PATCH already exist) is owed to Card 5b.
function bucketOf(takenAt) {
  const h = new Date(takenAt).getHours();
  if (h < 11) return 'breakfast';
  if (h < 16) return 'lunch';
  if (h < 19) return 'snack';
  if (h < 22) return 'dinner';
  return 'snack';
}

function isToday(takenAt) {
  const d = new Date(takenAt);
  const now = new Date();
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}

// ── Main Nutrition page ───────────────────────────────────────────────────────
export default function Nutrition() {
  const [meals,          setMeals]           = useState([]);
  const [targets,        setTargets]         = useState({});
  const [loading,        setLoading]         = useState(true);
  const [addModal,       setAddModal]        = useState({ open: false, mealType: null });
  const [photoModalOpen, setPhotoModalOpen]  = useState(false);

  const loadData = async () => {
    try {
      // First page (100 = 5× the busiest day) newest-first; today is a
      // client-side display filter — same precedent as measurements `latest`.
      const res = await nutritionService.listMeals(100);
      setMeals((res.data.items || []).filter((m) => isToday(m.takenAt)));
    } catch (err) {
      console.error('Failed to load meals:', err);
      toast.error('Failed to load nutrition data');
    } finally {
      setLoading(false);
    }
  };

  // D2 interim (Kd-ruled): targets still come from the OLD backend's
  // Mifflin-St Jeor calculator — the gamification pattern, broken on this
  // branch until its new-API card (owed in RUNBOOK/cutover.md). Failure
  // degrades to no targets, never an error toast.
  const loadTargets = async () => {
    try {
      const res = await nutritionService.getTargets();
      setTargets(res.data?.targets || {});
    } catch {
      setTargets({});
    }
  };

  useEffect(() => {
    loadData();
    loadTargets();
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

  // Totals = SUM of each meal's SERVER-computed totals (D3 doctrine: the
  // client displays and sums server numbers, it never derives nutrition).
  // Keys stay snake_case — MacroRings + the remaining card read that shape.
  const summed = meals.reduce(
    (acc, m) => ({
      kcal:      acc.kcal      + (m.totals?.kcalPoint || 0),
      protein_g: acc.protein_g + (m.totals?.proteinG  || 0),
      carbs_g:   acc.carbs_g   + (m.totals?.carbsG    || 0),
      fat_g:     acc.fat_g     + (m.totals?.fatG      || 0),
    }),
    { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );
  const totals = {
    kcal:      Math.round(summed.kcal),
    protein_g: Math.round(summed.protein_g),
    carbs_g:   Math.round(summed.carbs_g),
    fat_g:     Math.round(summed.fat_g),
  };

  // Same display formula the old backend used (nutrition.py:346-350).
  const remaining = {
    kcal:      Math.max(0, Math.round((targets.kcal      || 0) - totals.kcal)),
    protein_g: Math.max(0, Math.round((targets.protein_g || 0) - totals.protein_g)),
    carbs_g:   Math.max(0, Math.round((targets.carbs_g   || 0) - totals.carbs_g)),
    fat_g:     Math.max(0, Math.round((targets.fat_g     || 0) - totals.fat_g)),
  };

  const byType = meals.reduce((acc, m) => {
    const key = bucketOf(m.takenAt);
    (acc[key] = acc[key] || []).push(m);
    return acc;
  }, {});

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