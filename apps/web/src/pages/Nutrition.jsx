import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Plus, Trash2, Camera, X, Loader2,
  Flame, Coffee, UtensilsCrossed, Sandwich, Cookie,
  Sparkles, Check, Tag, Pencil, ChevronDown,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { MEAL_SCAN_TTL_SECONDS, PHOTO_SCAN_CAUTION } from '@app/shared';
import { nutritionService, composeAddIngredient, missingAnswers, toDisplayTargets, toRingChoice } from '../api/nutritionApi';
import LoggedFoodSheet from '../components/nutrition/LoggedFoodSheet';
import MacroRings from '../components/nutrition/MacroRings';
import MeasurePicker from '../components/nutrition/MeasurePicker';
import {
  amountRefusal, amountSummary, chosenItemFor, comesToUnderAGram, isStartingValue, loggedAmountText, pickerChoices, startingValue, valueKeepingGrams,
} from '../components/nutrition/measures';
import { forgetUnsavedScan, keepUnsavedScan, timeLeftText, unsavedScanFor, unsavedScanMsLeft } from '../components/nutrition/unsavedScan';
import { getUserId } from '../utils/storage';

// Quoted from @app/shared nutrition.ts chosenItemsSchema — the contract's own
// bounds (grams .max(10_000), items .max(30)), never numbers invented here.
// Display/affordance gates only: the server re-validates every request.
const MAX_GRAMS = 10000;
const MAX_ITEMS = 30;

// Where a scanned food's numbers came from, as the photo sheet tags its row
// (ROADMAP 7a-iii-b): a food table, or the scanner's own estimate for a food no
// table has.
const SOURCE_TAGS = { curated: 'Our list', usda: 'USDA', openfoodfacts: 'Packaged product', estimate: 'Estimate' };
/** Whether any of these items is priced by the scanner's own estimate, which
 *  makes their total "about". */
const hasEstimate = (items) => (items || []).some((i) => i?.nutritionSource === 'estimate');
/** What a saved meal's food line says after its calories about whose numbers they
 *  are: a scan's estimate, or the person's own (ROADMAP 7a-iv-g). */
const ITEM_TAGS = { estimate: ' · estimate', own: ' · your numbers' };
/** A copy of `map` without `key`. */
const without = (map, key) => { const next = { ...map }; delete next[key]; return next; };
/** The server's refusals of an amount itself, as its preview answers them: a portion
 *  too small or too large, a measure the food lacks, a dish that is not the person's. */
const REFUSED_AMOUNTS = new Set(['portion_out_of_range', 'unknown_measure', 'unknown_dishware']);

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
// Card 5b: editable time fixes a mistaken timestamp. For LABELED meals
// (mealType, migration 0007) the section never moves with the time; only
// unlabeled meals re-bucket.
// Card 5c: the change-label control (owed by 5b) and per-meal "add ingredient".
// Card 5c2 (Kd smoke ask): tap the name to rename a logged meal (PATCH mealName
// already exists — no API change).
function MealRow({ meal, onDelete, onEditTime, onRelabel, onAddIngredient, onRename, onChangeFood }) {
  const [editingTime, setEditingTime] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [labelOpen,   setLabelOpen]   = useState(false);
  const [foodsOpen,   setFoodsOpen]   = useState(false);
  // Distinguishes an Escape-cancel from a click-away/Enter save on the rename
  // input, so blur commits (the previous onBlur silently discarded the edit —
  // the smoke bug where a rename reverted with no PATCH ever sent).
  const nameCancelRef = useRef(false);
  const time = meal.takenAt
    ? new Date(meal.takenAt).toLocaleTimeString([], {
        hour: '2-digit', minute: '2-digit',
      })
    : '';
  const timeValue = meal.takenAt
    ? `${String(new Date(meal.takenAt).getHours()).padStart(2, '0')}:${String(new Date(meal.takenAt).getMinutes()).padStart(2, '0')}`
    : '';
  const name = meal.mealName || meal.items?.[0]?.name || 'Meal';
  const t = meal.totals || {};
  // A meal holding a food priced by the scanner's own estimate is "about" (ROADMAP 7a-iii-b).
  const estimated = hasEstimate(meal.items);

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      className="group flex flex-wrap items-start justify-between gap-x-2 py-2.5 px-3 rounded-xl
                 transition-all"
      style={{ background: 'rgba(255,255,255,0.02)' }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {editingName ? (
            <input
              type="text"
              defaultValue={name}
              autoFocus
              // Single commit path: blur saves (Enter and click-away both blur),
              // Escape flags a cancel so blur skips the save. Fixes the smoke bug
              // where clicking away discarded the edit without ever PATCHing.
              onBlur={(e) => {
                if (!nameCancelRef.current) {
                  const v = e.target.value.trim();
                  if (v && v !== name) onRename(meal, v);
                }
                nameCancelRef.current = false;
                setEditingName(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.target.blur();
                else if (e.key === 'Escape') { nameCancelRef.current = true; e.target.blur(); }
              }}
              className="text-sm font-semibold px-1.5 py-0.5 rounded min-w-0 flex-1"
              style={{ background: 'rgba(255,255,255,0.06)', color: '#fff', border: '1px solid rgba(255,138,31,0.30)' }}
            />
          ) : (
            <button
              type="button"
              onClick={() => { nameCancelRef.current = false; setEditingName(true); }}
              title="Rename this meal"
              className="flex items-center gap-1 text-sm font-semibold text-white min-w-0 text-left"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              <span className="truncate">{name}</span>
              {/* Always-visible pencil so first-time users know the name is editable. */}
              <Pencil className="w-3 h-3 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.35)' }} />
            </button>
          )}
          {editingTime ? (
            <input
              type="time"
              defaultValue={timeValue}
              autoFocus
              onBlur={() => setEditingTime(false)}
              onChange={(e) => {
                if (e.target.value) {
                  onEditTime(meal, e.target.value);
                  setEditingTime(false);
                }
              }}
              className="text-2xs px-1 rounded"
              style={{ background: 'rgba(255,255,255,0.06)', color: '#fff', border: '1px solid rgba(255,255,255,0.10)' }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingTime(true)}
              title="Change meal time"
              className="text-2xs underline decoration-dotted"
              style={{ color: 'rgba(255,255,255,0.30)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              {time}
            </button>
          )}
        </div>
        <p className="text-2xs mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {estimated ? 'about ' : ''}{Math.round(t.kcalPoint || 0)} kcal · Protein {Math.round(t.proteinG || 0)}g
          · Carbs {Math.round(t.carbsG || 0)}g · Fat {Math.round(t.fatG || 0)}g
        </p>
        {/* Card 5c: change the section label. null clears it — an unlabeled
            meal falls back to the time-of-day bucket for display. */}
        {labelOpen && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {MEAL_TYPES.map((mt) => (
              <button
                key={mt.id}
                type="button"
                onClick={() => { onRelabel(meal, meal.mealType === mt.id ? null : mt.id); setLabelOpen(false); }}
                className="px-2 py-0.5 rounded-md text-2xs font-semibold"
                style={{
                  background: meal.mealType === mt.id ? `${mt.color}20` : 'rgba(255,255,255,0.03)',
                  border: meal.mealType === mt.id ? `1px solid ${mt.color}50` : '1px solid rgba(255,255,255,0.05)',
                  color: meal.mealType === mt.id ? mt.color : 'rgba(255,255,255,0.50)',
                }}
              >
                {mt.label}
              </button>
            ))}
            {meal.mealType && (
              <button
                type="button"
                onClick={() => { onRelabel(meal, null); setLabelOpen(false); }}
                className="px-2 py-0.5 rounded-md text-2xs font-semibold"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.45)' }}
              >
                Remove label
              </button>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => setLabelOpen((v) => !v)}
          title={meal.mealType ? 'Change which section this meal is in' : 'Give this meal a section label'}
          className="p-1.5 rounded-lg"
          style={{ color: labelOpen ? '#FF8A1F' : 'rgba(255,255,255,0.45)' }}
        >
          <Tag className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onAddIngredient(meal)}
          disabled={(meal.items?.length || 0) >= MAX_ITEMS}
          title={(meal.items?.length || 0) >= MAX_ITEMS
            ? `This meal already holds the most items (${MAX_ITEMS})`
            : 'Add an ingredient to this meal'}
          className="p-1.5 rounded-lg disabled:cursor-not-allowed"
          style={{ color: (meal.items?.length || 0) >= MAX_ITEMS ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.45)' }}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onDelete(meal.id)}
          title="Delete this meal"
          className="p-1.5 rounded-lg"
          style={{ color: 'rgba(239,68,68,0.7)' }}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        {/* The meal's foods fold away beside Delete, and start folded, so a day
            of many meals stays short (Kd's click-through of 7a-iv-g). */}
        {meal.items?.length > 0 && (
          <button
            type="button"
            onClick={() => setFoodsOpen((v) => !v)}
            aria-expanded={foodsOpen}
            aria-label={foodsOpen ? 'Hide the foods in this meal' : 'Show the foods in this meal'}
            title={foodsOpen ? 'Hide the foods in this meal' : 'Show the foods in this meal'}
            className="p-1.5 rounded-lg"
            style={{ color: foodsOpen ? '#FF8A1F' : 'rgba(255,255,255,0.45)' }}
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${foodsOpen ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>
      {/* What's in it, one line a food, each a tap to change it (ROADMAP
          7a-iv-g): its amount, its calories, and whose numbers they are. A line
          of its own under the meal, the meal's whole width, so a name is read,
          not cut, on a phone. */}
      {foodsOpen && meal.items?.length > 0 && (
        <ul className="basis-full mt-2 space-y-1" aria-label={`Foods in ${name}`}>
          {meal.items.map((item, at) => (
            <li key={`${at}-${item.canonical}`}>
              <button
                type="button"
                onClick={() => onChangeFood(meal, at)}
                aria-label={`Change ${item.name}`}
                className="w-full min-h-11 px-2.5 py-1.5 rounded-lg flex items-center gap-2 text-left"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer' }}
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-xs break-words" style={{ color: 'rgba(255,255,255,0.80)' }}>{item.name}</span>
                  <span className="block text-2xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
                    {loggedAmountText(item)} · {item.kcalPoint} kcal{ITEM_TAGS[item.nutritionSource] ?? ''}
                  </span>
                </span>
                <Pencil className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.35)' }} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </motion.div>
  );
}

// ── Meal type section ─────────────────────────────────────────────────────────
function MealSection({ mealType, meals, canAdd, onAdd, onDelete, onEditTime, onRelabel, onAddIngredient, onRename, onChangeFood }) {
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
        {/* Card 5d: manual "+" only on Today — a new meal stamps the current
            time (Kd ruling 2026-07-17). Past-day rows stay fully editable. */}
        {canAdd && (
          <button
            onClick={() => onAdd(mealType.id)}
            aria-label={`Add to ${mealType.label}`}
            className="w-8 h-8 rounded-lg flex items-center justify-center
                       transition-all"
            style={{
              background: 'rgba(255,138,31,0.10)',
              border:     '1px solid rgba(255,138,31,0.20)',
            }}
          >
            <Plus className="w-4 h-4" style={{ color: '#FF8A1F' }} />
          </button>
        )}
      </div>
      <div className="space-y-1">
        <AnimatePresence>
          {meals.map((m) => (
            <MealRow key={m.id} meal={m} onDelete={onDelete} onEditTime={onEditTime}
                     onRelabel={onRelabel} onAddIngredient={onAddIngredient} onRename={onRename}
                     onChangeFood={onChangeFood} />
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

// ── Reusable food search + result list ───────────────────────────────────────
// Card 5c: THREE surfaces now search foods (new manual meal · add-ingredient to
// a photo scan · add-ingredient to a saved meal), so the search lives here once
// instead of being copy-pasted three times. Results are PER 100 g (camelCase).
// The stale-response guard is the 5b T3 advisory owed to this card: a slow
// "chick" response must never land after a fast "chicken" one and repaint the
// list under the user.
function FoodPicker({ selected, onPick, autoFocus, exclude = [], placeholder = 'Search food...' }) {
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const searchRef = useRef(null);

  useEffect(() => {
    if (autoFocus) setTimeout(() => searchRef.current?.focus(), 100);
  }, [autoFocus]);

  useEffect(() => {
    if (!query || query.length < 2) {
      setResults([]);
      // Clearing the box while a search is in flight must not strand the
      // spinner: the in-flight run is now stale and will skip its own finally.
      setLoading(false);
      return undefined;
    }
    let stale = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await nutritionService.searchFoods(query, 15);
        if (!stale) setResults(res.data.items || []);
      } catch {
        if (!stale) setResults([]);
      } finally {
        if (!stale) setLoading(false);
      }
    }, 300);
    return () => { stale = true; clearTimeout(timer); };
  }, [query]);

  // A food already in the meal must not be addable twice: the server maps the
  // payload 1:1 in order, so a duplicate canonical would both silently double
  // the amount and (for a drafted item) double-count that item in the Stage-5
  // correction pair. Excluding it here is the honest affordance.
  const shown = results.filter((r) => !exclude.includes(r.canonical));

  return (
    <>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                style={{ color: 'rgba(255,255,255,0.40)' }} />
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm focus:outline-none transition-all"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border:     '1px solid rgba(255,255,255,0.08)',
            color:      '#fff',
          }}
        />
      </div>
      {loading && (
        <div className="flex justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'rgba(255,138,31,0.5)' }} />
        </div>
      )}
      {!loading && shown.length === 0 && query.length >= 2 && (
        <p className="text-center text-xs py-6" style={{ color: 'rgba(255,255,255,0.30)' }}>
          {results.length > 0 ? 'Already in this meal' : 'No foods found'}
        </p>
      )}
      <div className="space-y-1.5">
        {shown.map((r) => (
          <button
            key={r.canonical}
            onClick={() => onPick(r)}
            className="w-full text-left rounded-xl p-3 transition-all"
            style={{
              background: selected?.canonical === r.canonical ? 'rgba(255,138,31,0.10)' : 'rgba(255,255,255,0.02)',
              border: selected?.canonical === r.canonical
                ? '1px solid rgba(255,138,31,0.30)'
                : '1px solid rgba(255,255,255,0.04)',
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white truncate">{r.name}</p>
                <p className="text-2xs mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  {Math.round(r.kcal)} kcal · Protein {Math.round(r.proteinG)}g
                  · Carbs {Math.round(r.carbsG)}g · Fat {Math.round(r.fatG)}g
                  <span className="ml-1" style={{ color: 'rgba(255,255,255,0.25)' }}>/ 100 g</span>
                </p>
                {/* A packaged product is one brand's jar, from Open Food Facts,
                    whose free licence asks for attribution (RULINGS
                    2026-09-14); a USDA food reads its own source the same way
                    (7a-iii-a); the app's own foods carry no label. */}
                {r.source === 'openfoodfacts' && (
                  <p className="text-2xs mt-0.5" style={{ color: 'rgba(255,255,255,0.30)' }}>
                    Packaged product · Open Food Facts
                  </p>
                )}
                {r.source === 'usda' && (
                  <p className="text-2xs mt-0.5" style={{ color: 'rgba(255,255,255,0.30)' }}>
                    USDA FoodData Central
                  </p>
                )}
              </div>
              {selected?.canonical === r.canonical && (
                <Check className="w-4 h-4 flex-shrink-0" style={{ color: '#FF8A1F' }} />
              )}
            </div>
          </button>
        ))}
      </div>
      <SourceCredits sources={shown.map((r) => r.source)} />
    </>
  );
}

/** The credits the food tables ask for wherever their numbers are shown: the
 *  search box's results and the photo sheet's rows. */
function SourceCredits({ sources }) {
  return (
    <>
      {/* USDA FoodData Central is public domain (CC0 1.0) and asks for no
          permission, only that it be listed as the source (fdc.nal.usda.gov,
          read 2026-09-16; RULINGS the same day). */}
      {sources.includes('usda') && (
        <p className="text-2xs mt-3" style={{ color: 'rgba(255,255,255,0.30)' }}>
          Food data from{' '}
          <a href="https://fdc.nal.usda.gov" target="_blank" rel="noreferrer" className="underline"
             style={{ color: 'rgba(255,255,255,0.45)' }}>USDA FoodData Central</a>
          , U.S. Department of Agriculture, Agricultural Research Service.
        </p>
      )}
      {/* The Open Database License's notice for showing its data (section 4.3a):
          the database's name links to the database, and the licence's name to
          its text, as Open Food Facts' terms of use also ask. */}
      {sources.includes('openfoodfacts') && (
        <p className="text-2xs mt-3" style={{ color: 'rgba(255,255,255,0.30)' }}>
          Packaged products contain information from{' '}
          <a href="https://openfoodfacts.org" target="_blank" rel="noreferrer" className="underline"
             style={{ color: 'rgba(255,255,255,0.45)' }}>Open Food Facts</a>
          , which is made available here under the{' '}
          <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer" className="underline"
             style={{ color: 'rgba(255,255,255,0.45)' }}>Open Database License (ODbL)</a>.
        </p>
      )}
    </>
  );
}

// ── Food search & add modal ───────────────────────────────────────────────────
// Card 5b: manual entry on the NEW /v1 API; nutrition shown live from the server
// preview and saved via ONE logManualMeal — the browser never computes
// nutrition (2B).
// ROADMAP 7a-iv-a: the amount is one of the food's own measures and how many of
// it — or a saved dish and how full — picked in the measure picker; the SERVER
// works out the grams from its own list of the food's measures.
// Card 5c: DUAL MODE. With a `meal` prop the same modal adds an ingredient to
// an already-saved meal — PATCH keeps the meal's existing items as saved and adds
// the new one (the API already accepts any searched food there; no new endpoint).
function AddMealModal({ open, mealType, meal, onClose, onSave }) {
  const [selected, setSelected] = useState(null);
  // The picker's value: {key: a measure id or "dish:<id>", amount: as typed}.
  const [amount,   setAmount]   = useState(null);
  const [live,     setLive]     = useState(null);
  const [saving,   setSaving]   = useState(false);
  const [dishware, setDishware] = useState([]);

  const loadDishware = () =>
    nutritionService.listDishware().then((r) => setDishware(r.data.items || [])).catch(() => {});

  useEffect(() => {
    if (open) {
      setSelected(null);
      setAmount(null);
      setLive(null);
      setSaving(false);
      loadDishware();
    }
  }, [open]);

  const choice = selected && amount ? pickerChoices(selected, dishware).find((c) => c.key === amount.key) ?? null : null;
  const chosenItem = selected && amount ? chosenItemFor(selected.canonical, choice, amount.amount) : null;
  // 5b T3 advisory: say WHY the button is dead rather than just disabling it.
  const typed = parseFloat(amount?.amount);
  const tooLarge = choice?.kind === 'measure' && Number.isFinite(typed) && typed * choice.grams > MAX_GRAMS;
  const tooSmall = comesToUnderAGram(choice, amount?.amount);

  // Live server preview for the chosen amount (manual arm — no scanToken). The
  // server prices a measure OR a dish identically (2B). Stale responses dropped;
  // a refusal of the amount (too small, too large, a measure the food lacks) is
  // kept with the payload it refused, said, and holds Add; any other failure
  // degrades to no numbers.
  const chosenKey = JSON.stringify(chosenItem);
  useEffect(() => {
    if (chosenItem === null) { setLive(null); return undefined; }
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const res = await nutritionService.previewMeal({ items: [chosenItem] });
        // Stamp with the payload it priced (T3 5c2) so a result for a PREVIOUS
        // amount/dish is never shown as current — displayed must equal saved.
        if (!stale) setLive({ data: res.data, key: chosenKey });
      } catch (err) {
        if (!stale) setLive(amountRefusal(err) === null ? null : { refusal: amountRefusal(err), key: chosenKey });
      }
    }, 300);
    return () => { stale = true; clearTimeout(timer); };
    // chosenKey is a complete value-serialisation of chosenItem (grams/dish).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenKey]);
  // Only "live" when it priced the CURRENT payload; otherwise withhold ("…").
  const shownLive = live?.key === chosenKey && live.data ? live.data : null;
  const refused = live?.key === chosenKey && live.refusal ? live.refusal : null;
  const held = chosenItem === null || tooLarge || tooSmall || refused !== null;

  const pick = (food) => {
    setSelected(food);
    setAmount(startingValue(food)); // the measure and amount the server says the food starts at
    setLive(null); // never show the previous food's numbers
  };

  const handleSave = async () => {
    if (held || saving) return;
    setSaving(true);
    try {
      if (meal) {
        // Add-ingredient mode: PATCH replaces the whole items array, so name
        // every existing item to be kept as saved, plus the new one (composed by
        // a pure, unit-tested helper — silently dropping an existing item here
        // would wipe a meal).
        const res = await nutritionService.updateMeal(meal.id, {
          items: composeAddIngredient(meal.items, chosenItem),
          itemsVersion: meal.itemsVersion,
        });
        toast.success(`Added ${selected.name} to ${meal.mealName || 'the meal'}`);
        // The meal as saved goes on the page at once (7a-iv-g).
        onSave(res.data?.meal);
      } else {
        await nutritionService.logManualMeal({
          mealName: selected.name,
          takenAt: new Date().toISOString(), // exact real time, always
          // The section whose + opened this modal is the user's chosen label
          // (stored meal_type — Kd ruling 2026-07-17; nothing time-derived).
          mealType,
          items: [chosenItem],
        });
        toast.success(`Added ${selected.name}`);
        onSave();
      }
      onClose();
    } catch (err) {
      // The meal changed in another tab since this box opened (7a-iv-g): the
      // server added nothing. The day is read again and the box closes, so the
      // next try starts from the meal as it is — and the words say try again,
      // never "close this", since it is closed.
      if (meal && err.response?.data?.error === 'meal_changed') {
        toast.error('This meal was changed somewhere else. Try again.');
        onSave();
        onClose();
        return;
      }
      // A refused amount says so. Any other 400 is the food itself: one that can
      // no longer be resolved by canonical — an OFF food picked >24h ago has aged
      // out of the server's cache (the recorded residual). The meal's other foods
      // are kept as saved, never looked up again. Say something actionable.
      toast.error(
        amountRefusal(err) ?? (err.response?.status === 400
          ? meal
            ? 'That food could not be added — try searching for it again.'
            : 'That food could not be logged.'
          : meal ? 'Failed to add the ingredient' : 'Failed to log meal'),
      );
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
        // Only the X closes it: a click outside once lost a half-picked food
        // (Kd, 2026-09-16). On a phone it rises from the bottom, the full width.
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1,    y: 0  }}
          exit={{    opacity: 0, scale: 0.95, y: 20 }}
          className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl flex flex-col"
          style={{
            background: '#121110',
            border:     '1px solid rgba(255,255,255,0.06)',
            maxHeight:  '90vh',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4"
               style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <h3 className="text-base font-bold text-white">
              {meal
                ? `Add ingredient to ${meal.mealName || 'this meal'}`
                : `Add to ${MEAL_TYPES.find(m => m.id === mealType)?.label || 'meal'}`}
            </h3>
            <button
              onClick={onClose}
              aria-label="Close"
              className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(255,255,255,0.04)' }}
            >
              <X className="w-5 h-5" style={{ color: 'rgba(255,255,255,0.5)' }} />
            </button>
          </div>

          {/* Search + results */}
          <div className="flex-1 overflow-y-auto p-5 no-scrollbar space-y-4">
            <FoodPicker
              selected={selected}
              onPick={pick}
              autoFocus={open}
              // Add-ingredient mode: a food the meal already has would be sent
              // twice in one items array.
              exclude={meal ? (meal.items || []).map((i) => i.canonical) : []}
            />
          </div>

          {/* Amount + live server preview + Save */}
          {selected && (
            <div className="p-5"
                 style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              {/* ROADMAP 7a-iv-a: one of the food's own measures and how many, or a
                  saved dish and how full; the grams and calories are the server's. */}
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.70)' }}>Amount</p>
                <p className="text-lg font-bold" style={{ color: '#FF8A1F' }}>
                  {shownLive ? `${shownLive.totals.kcalPoint} kcal` : '…'}
                </p>
              </div>
              <div className="mb-4">
                <MeasurePicker
                  food={selected}
                  dishware={dishware}
                  value={amount}
                  onChange={setAmount}
                  grams={shownLive?.items?.[0]?.gramsPoint ?? null}
                  onDishSaved={loadDishware}
                />
              </div>

              {shownLive && (
                <p className="text-xs mb-4"
                   style={{ color: 'rgba(255,255,255,0.55)' }}>
                  {shownLive.totals.kcalPoint} kcal · Protein {Math.round(shownLive.totals.proteinG)}g
                  · Carbs {Math.round(shownLive.totals.carbsG)}g · Fat {Math.round(shownLive.totals.fatG)}g
                  <span className="ml-1" style={{ color: 'rgba(255,255,255,0.35)' }}>
                    — calculated by the server for your amount
                  </span>
                </p>
              )}
              {tooLarge && (
                <p className="text-xs mb-4" style={{ color: 'rgba(251,191,36,0.85)' }}>
                  That is more than {MAX_GRAMS.toLocaleString()} g — pick a smaller amount.
                </p>
              )}
              {tooSmall && (
                <p className="text-xs mb-4" style={{ color: 'rgba(251,191,36,0.85)' }}>
                  That comes to less than 1 g — pick a larger amount.
                </p>
              )}
              {!tooLarge && !tooSmall && refused && (
                <p className="text-xs mb-4" style={{ color: 'rgba(251,191,36,0.85)' }}>{refused}</p>
              )}
              {choice?.kind === 'dish' && chosenItem === null && (
                <p className="text-xs mb-4" style={{ color: 'rgba(255,255,255,0.50)' }}>
                  Pick how full it was — we'll work out the grams.
                </p>
              )}
              <button
                onClick={handleSave}
                disabled={saving || held}
                className="w-full h-12 rounded-xl font-semibold text-base text-white"
                style={{
                  background: 'linear-gradient(135deg, #FF8A1F, #FFB347)',
                  boxShadow:  '0 4px 16px rgba(255,138,31,0.25)',
                  opacity:    saving || held ? 0.6 : 1,
                }}
              >
                {saving ? 'Saving…'
                  : tooLarge ? 'Amount is too large'
                    : tooSmall ? 'Amount is too small'
                      : refused ? 'Pick another amount'
                        : chosenItem !== null ? `Add ${selected.name}` : (choice?.kind === 'dish' ? 'Pick how full' : 'Enter an amount')}
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ── AI Photo Upload Modal ─────────────────────────────────────────────────────
// Card 5a: photo → analysis (scanToken) → user reviews the amounts → ONE
// confirm POST creates the meal (replaces the old N× logMeal loop). Macros
// come back SERVER-computed; a poor photo is a 422 that may carry a
// retakeToken (one free retry — Part 2B §3.5).
function PhotoModal({ open, onClose, onSave }) {
  const [analyzing,   setAnalyzing]   = useState(false);
  const [analysis,    setAnalysis]    = useState(null);
  const [preview,     setPreview]     = useState(null);
  // ROADMAP 7a-iv-b: every scanned row is measured in the measure picker, as an
  // added ingredient is. amounts[i] is row i's {key, amount}, starting where the
  // server started it: one of its food's own measures, or the photo's grams.
  const [amounts,     setAmounts]     = useState({});
  // "Log as": the user-chosen mealType LABEL (stored via migration 0007);
  // null = unlabeled. takenAt is always the exact real time either way.
  const [logAs,       setLogAs]       = useState(null);
  const [live,        setLive]        = useState(null);
  const [retakeToken, setRetakeToken] = useState(null);
  const [retakeMsg,   setRetakeMsg]   = useState(null);
  const [saving,      setSaving]      = useState(false);
  // Card 5c — meal composition: ingredients the AI never saw (the oats-with-
  // milk case). Each is {food, amount}; they ride the SAME confirm as the
  // drafted items, and the server resolves them by canonical.
  const [extras,      setExtras]      = useState([]);
  const [adding,      setAdding]      = useState(false);
  // The person's saved dishes, which every picker on the sheet offers as measures.
  const [dishware,     setDishware]     = useState([]);
  // ROADMAP 7a-iii-b "Change": replaced[i] is the food the person picked in place
  // of scanned row i, at the row's own grams; changing is the row whose search
  // is open. A changed row goes to the server as an added food (the scan never
  // estimated it), so it forms no correction pair. changeUndo[i] holds what the
  // row held before and what Change set it to, for its Undo.
  const [replaced,     setReplaced]     = useState({});
  const [changing,     setChanging]     = useState(null);
  const [changeUndo,   setChangeUndo]   = useState({});
  // The sheet is a short list, one line a food, and a tap opens that food's
  // picker (Kd's pick, RULINGS 2026-09-17): openRow is the open one — "s2" for
  // scanned row 2, "x0" for added ingredient 0 — or null.
  const [openRow,      setOpenRow]      = useState(null);
  // RULINGS 2026-09-16 (Kd's click-through of 7a-iv-a): an unsaved scan already
  // used one of the day's scans, so neither closing the sheet nor leaving the page
  // throws it away (`unsavedScan.js`). scannedAt is when this sheet's scan came
  // back; confirmingClose is the X's "Close without saving?" while a scan is
  // unsaved, holding what was left of it (ms) when the X was pressed, or null.
  const [scannedAt,       setScannedAt]       = useState(null);
  const [confirmingClose, setConfirmingClose] = useState(null);
  // A row taken from a saved dish to another measure keeps the dish's grams, with
  // an Undo, as "Change" has one (RULINGS 2026-09-16): dishUndo[i] is the dish and
  // fill it held and the grams kept. beforeDish[i] is what the row held before a
  // dish was picked, which it goes back to where the dish was never weighed.
  const [dishUndo,        setDishUndo]        = useState({});
  const [beforeDish,      setBeforeDish]      = useState({});
  const fileRef = useRef(null);

  const loadDishware = () =>
    nutritionService.listDishware().then((r) => setDishware(r.data.items || [])).catch(() => {});

  const resetSheet = () => {
    setAnalysis(null);
    setPreview(null);
    setAnalyzing(false);
    setAmounts({});
    setLogAs(null);
    setLive(null);
    setRetakeToken(null);
    setRetakeMsg(null);
    setSaving(false);
    setExtras([]);
    setAdding(false);
    setReplaced({});
    setChanging(null);
    setChangeUndo({});
    setOpenRow(null);
    setScannedAt(null);
    setConfirmingClose(null);
    setDishUndo({});
    setBeforeDish({});
    forgetUnsavedScan();
  };

  // An unsaved sheet brought back, as it stood.
  const loadSheet = ({ scannedAt: at, sheet }) => {
    setAnalysis(sheet.analysis);
    setPreview(sheet.preview);
    setAnalyzing(false);
    setAmounts(sheet.amounts);
    setLogAs(sheet.logAs);
    setLive(null);
    setRetakeToken(null);
    setRetakeMsg(null);
    setSaving(false);
    setExtras(sheet.extras);
    setAdding(false);
    setReplaced(sheet.replaced);
    setChanging(null);
    setChangeUndo(sheet.changeUndo);
    setOpenRow(null);
    setScannedAt(at);
    setConfirmingClose(null);
    setDishUndo(sheet.dishUndo);
    setBeforeDish(sheet.beforeDish);
  };

  useEffect(() => {
    if (open) {
      // This person's unsaved scan comes back while it can still be saved, from
      // wherever they left it; anything else starts a fresh sheet.
      const unsaved = unsavedScanFor(getUserId(), Date.now());
      if (unsaved) loadSheet(unsaved);
      else resetSheet();
      loadDishware();
    }
    // The sheet is judged as it stood when it was opened, not on every edit.
  }, [open]);

  // Every change to an unsaved sheet is kept above the page, for its person.
  useEffect(() => {
    if (analysis !== null && scannedAt !== null) {
      keepUnsavedScan(getUserId(), scannedAt, { analysis, preview, amounts, logAs, extras, replaced, changeUndo, dishUndo, beforeDish });
    }
  }, [analysis, scannedAt, preview, amounts, logAs, extras, replaced, changeUndo, dishUndo, beforeDish]);

  // The X: a sheet holding an unsaved scan asks first, saying how long it can be
  // picked up again. A click outside the box never closes it (Kd: only the cross).
  const requestClose = () => {
    if (analysis !== null && scannedAt !== null && !saving) { setConfirmingClose(unsavedScanMsLeft(scannedAt, Date.now())); return; }
    onClose();
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const photo = URL.createObjectURL(file);
    // Whose scan this is, for a reply that comes back after they left.
    const scanner = getUserId();
    setPreview(photo);
    setAnalyzing(true);
    setAnalysis(null);
    setScannedAt(null);
    setLogAs(null); // a fresh analysis starts unlabeled (T3 5b advisory)
    setExtras([]);  // …and carries no ingredients from a previous photo
    setAdding(false);
    setReplaced({});     // …and no changed foods
    setChangeUndo({});
    setDishUndo({});     // …and no dish measures
    setBeforeDish({});
    setChanging(null);
    setOpenRow(null);
    setRetakeMsg(null);

    try {
      const res = await nutritionService.analyzePhoto(file, retakeToken);
      const at = Date.now();
      // Each row starts where the server started it (ROADMAP 7a-iv-b): at one of its
      // food's own measures where the photo's count of it agrees with the grams the
      // photo saw, else at those grams. The person corrects it in the picker; the
      // server computes ALL nutrition from what it sends.
      const starts = Object.fromEntries(res.data.items.map((item, i) => [i, startingValue(item)]));
      // Kept the moment it returns, not only once a sheet shows it: a person who
      // left the page while the photo was read still has the scan it counted.
      // Never for someone else who has signed in since.
      if (getUserId() === scanner) {
        keepUnsavedScan(scanner, at, {
          analysis: res.data, preview: photo, amounts: starts,
          logAs: null, extras: [], replaced: {}, changeUndo: {}, dishUndo: {}, beforeDish: {},
        });
      }
      setRetakeToken(null);
      setAnalysis(res.data);
      setScannedAt(at);
      setAmounts(starts);
      setLive(null);
    } catch (err) {
      if (err.response?.status === 422) {
        // Poor photo / unreadable — the retakeToken makes the next attempt free.
        setRetakeToken(err.response.data?.retakeToken || null);
        setRetakeMsg({
          title: 'Try another photo',
          text: err.response.data?.retakeToken
            ? "Couldn't read that photo — try again with better lighting (free retry)."
            : "Couldn't read that photo — please try another one.",
        });
        setPreview(null);
      } else if (err.response?.status === 503) {
        // The scanner failed, not the photo, and that costs no scan: the server
        // gave back the scan it counted, or sends a new free retry for the one
        // this scan rode. A 503 that took nothing (a scanner switched off, or
        // paused after failing) brings none, and the free retry held stays.
        if (err.response.data?.retakeToken) setRetakeToken(err.response.data.retakeToken);
        setRetakeMsg(err.response.data?.error === 'scanner_unavailable'
          ? {
              title: 'Try again',
              text: err.response.data.retakeToken
                ? 'Meal scanning is busy right now — try again in a minute (free retry).'
                : 'Meal scanning is busy right now — try again in a minute.',
            }
          : { title: 'Try again later', text: 'Meal scanning is unavailable right now.' });
        setPreview(null);
      } else if (err.response?.status === 400 && err.response.data?.error === 'invalid_retake') {
        // A free retry that ran out (it lasts ten minutes) or was spent: the
        // next photo is a scan of its own.
        setRetakeToken(null);
        setRetakeMsg({ title: 'Try again', text: 'That free retry has run out. Pick the photo again.' });
        setPreview(null);
      } else if (err.response?.status === 429) {
        toast.error('Daily photo-scan limit reached.');
        setPreview(null);
      } else {
        toast.error(err.message || 'Photo analysis failed');
        setPreview(null);
      }
    } finally {
      setAnalyzing(false);
    }
  };

  // Every row, scanned or added, is measured in the measure picker (ROADMAP 7a-iv-a,
  // 7a-iv-b): one of its food's own measures and how many, or a saved dish and how
  // full it was. It sends nothing while its amount is no amount, and an amount the
  // server would refuse says why before it is sent.
  const resolvePicked = (food, value) => {
    const choice = value ? pickerChoices(food, dishware).find((c) => c.key === value.key) ?? null : null;
    const item = chosenItemFor(food.canonical, choice, value?.amount);
    const typed = parseFloat(value?.amount);
    const tooLarge = choice?.kind === 'measure' && Number.isFinite(typed) && typed * choice.grams > MAX_GRAMS;
    const tooSmall = comesToUnderAGram(choice, value?.amount);
    const usable = item !== null && !tooLarge && !tooSmall;
    return { item: usable ? item : null, valid: usable, tooLarge, tooSmall };
  };
  // The food a scanned row prices now: the one Change picked, else the scan's.
  const rowFood = (i) => replaced[i] ?? analysis.items[i];
  const resolved = analysis === null ? [] : [
    ...analysis.items.map((_, i) => resolvePicked(rowFood(i), amounts[i])),
    ...extras.map((x) => resolvePicked(x.food, x.amount)),
  ];
  // A row still exactly as the scan started it, and a meal still exactly what the
  // scan saw: only then do the scan's own numbers stand in while the server has not
  // answered for what the sheet holds (T3 5c: never a price that is not what will
  // be saved).
  const rowAtScan = (i) => replaced[i] === undefined && isStartingValue(analysis.items[i], amounts[i]);
  const mealAtScan = analysis !== null && extras.length === 0 && analysis.items.every((_, i) => rowAtScan(i));
  // Every food the sheet prices now: a changed row by the food picked for it.
  const rowSources = analysis === null ? [] : [
    ...analysis.items.map((item, i) => replaced[i]?.source ?? item.nutritionSource),
    ...extras.map((x) => x.food.source),
  ];
  const rowCanonicals = analysis === null ? [] : [
    ...analysis.items.map((item, i) => replaced[i]?.canonical ?? item.canonical),
    ...extras.map((x) => x.food.canonical),
  ];
  // What no search on this sheet may offer: every food on it now, and every food
  // the scan put on it, even on a row since changed. The server reads a food by
  // its canonical, so a scanned food sent for another row, or as an added
  // ingredient, is taken for that scanned row — a correction the person never
  // made — and a later Undo would send the same food twice. `row` is the row whose
  // own foods, as scanned and as it is now, its Change may pick again.
  const onSheet = (row = null) => (analysis === null ? [] : [
    ...rowCanonicals.filter((_, j) => j !== row),
    ...analysis.items.map((item) => item.canonical).filter((_, j) => j !== row),
  ]);
  // The total is "about" while any row is an estimate (RULINGS 2026-09-16): a food
  // the scanner itself priced, or a portion still at the photo's own guess (the
  // review of PR #76, L1). A SAVED meal reads "about" only for the first
  // (`hasEstimate`): confirming the sheet makes every amount the person's — Part 2B
  // §3.2 Stage 4, the tap "converts an AI guess into a user-verified log" — so a
  // saved item keeps no mark that its amount began as the photo's guess.
  const aboutTotal = rowSources.includes('estimate')
    || (analysis !== null && analysis.items.some((item, i) => item.portionEstimated && rowAtScan(i)));
  // T3 5b: a []-items request 400s on min(1) — but a zero-match analysis is
  // confirmable once the user adds an ingredient, the whole point of Card 5c.
  const allValid = resolved.length > 0 && resolved.every((r) => r.valid);
  const payloadItems = allValid ? resolved.map((r) => r.item) : [];
  // "Add an ingredient" (or its open picker) shows unless the meal is full; what
  // points at it says so only while it is there.
  const canAdd = adding || payloadItems.length < MAX_ITEMS;
  // 5b T3 advisory: say WHY the button is dead — "Pick an amount for every item"
  // is a lie when the user plainly entered 20000.
  const gramsTooLarge = resolved.some((r) => r.tooLarge);

  // Live server preview (Kd-approved): whenever an amount changes, ask the SERVER
  // what the nutrition would be — the browser never computes it. Debounced;
  // failures degrade silently to the analysis estimates (e.g. old API).
  const payloadKey = JSON.stringify(payloadItems);
  useEffect(() => {
    if (!analysis || !allValid) return undefined;
    let cancelled = false; // T3 Card 5a: drop out-of-order/stale responses
    const timer = setTimeout(async () => {
      try {
        const res = await nutritionService.previewMeal({
          scanToken: analysis.scanToken,
          items: payloadItems,
        });
        // Stamp the result with the payload it priced, so a response that
        // lands after a further edit is not shown as current (T3 5c honesty).
        if (!cancelled) setLive({ data: res.data, key: payloadKey });
      } catch (err) {
        // Kept as a failure of this very payload, so a row can say why its grams
        // are not known: an amount the server refuses, or no answer at all.
        if (!cancelled) setLive({ data: null, key: payloadKey, refused: REFUSED_AMOUNTS.has(err?.response?.data?.error) });
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
    // payloadKey covers every amount AND extras by value; payloadItems is rebuilt
    // each render so it cannot be a dep itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, payloadKey, allValid]);

  // T3 5c: a number is only "live" if it priced the CURRENT payload. A result
  // for a stale payload (mid-debounce, or after an edit made an amount
  // unusable) must NOT be shown — the card's rule is withhold-until-the-server-
  // answers, and with extras present a stale total is not what will be saved.
  const liveNow = live !== null && live.key === payloadKey ? live.data : null;
  // The server's preview of the sheet as it stands failed: 'refused' where it refused
  // an amount, 'failed' where it gave no answer, else null.
  const previewTrouble = live !== null && live.key === payloadKey && live.data === null ? (live.refused ? 'refused' : 'failed') : null;
  // The grams row i holds: the server's answer for the sheet as it stands; else —
  // before it answers, or where it cannot — what the row's own measure weighs, how
  // many times the grams one of it weighs on the server's own list, to the whole
  // gram, as the server works it out. Null for a saved dish the server has not
  // weighed, and for an amount that is no amount (the review of PR #76, H1: a row
  // moved and not priced yet was taken at the scan's grams).
  const rowGrams = (i) => {
    const priced = liveNow?.items?.[i]?.gramsPoint;
    if (Number.isFinite(priced)) return priced;
    const choice = pickerChoices(rowFood(i), dishware).find((c) => c.key === amounts[i]?.key);
    const amount = parseFloat(amounts[i]?.amount);
    if (choice?.kind !== 'measure' || !Number.isFinite(amount) || amount <= 0) return null;
    const grams = Math.round(amount * choice.grams);
    return grams >= 1 && grams <= MAX_GRAMS ? grams : null;
  };
  // Why "Change food" waits, while the row's grams are not known, said truly for each
  // way they can be unknown (the re-check of PR #76): no amount yet; an amount no
  // gram or past what one item may weigh; a dish the server weighs, while it is
  // still to answer, cannot answer until every other amount is usable, refused
  // the amount, or gave no answer.
  const changeHold = (i) => {
    const choice = pickerChoices(rowFood(i), dishware).find((c) => c.key === amounts[i]?.key);
    const dish = choice?.kind === 'dish';
    const amount = parseFloat(amounts[i]?.amount);
    if (!Number.isFinite(amount) || amount <= 0) return dish ? 'Pick how full it was first.' : 'Pick an amount first.';
    if (!dish || previewTrouble === 'refused') return "This amount can't be weighed — pick another.";
    if (!allValid) return 'Finish the other amounts first.';
    if (previewTrouble === 'failed') return "The grams couldn't be worked out just now.";
    return 'Working out the grams…';
  };

  const handleConfirm = async () => {
    if (!analysis || saving || !allValid) return;
    setSaving(true);
    try {
      await nutritionService.confirmMeal({
        scanToken: analysis.scanToken,
        takenAt: new Date().toISOString(), // exact real time, always
        mealType: logAs, // user-chosen label; null = unlabeled (omitted)
        items: payloadItems,
      });
      toast.success(`Logged ${analysis.mealName || 'meal'}`);
      resetSheet(); // saved: the next Photo Log starts fresh
      onSave();
      onClose();
    } catch (err) {
      toast.error(
        amountRefusal(err) ?? (err.response?.data?.error === 'invalid_scan'
          ? `This scan can only be saved for ${MEAL_SCAN_TTL_SECONDS / 60} minutes — take the photo again.`
          : err.response?.status === 400
            ? 'One of the foods could not be logged — try removing or re-adding it.'
            : 'Failed to log the meal'),
      );
    } finally {
      setSaving(false);
    }
  };

  // A scanned row's picker changed. Taken from a saved dish to another measure, the
  // row keeps the grams the server worked out for the dish, with an Undo (RULINGS
  // 2026-09-16); where the dish was never weighed (no fill picked), it goes back to
  // what it held before the dish. Any other change is the picker's own.
  const setRowAmount = (i, next) => {
    const choices = pickerChoices(rowFood(i), dishware);
    const from = choices.find((c) => c.key === amounts[i]?.key);
    const to = choices.find((c) => c.key === next.key);
    if (from?.kind !== 'dish' && to?.kind === 'dish') {
      setBeforeDish((prev) => ({ ...prev, [i]: { value: amounts[i], grams: rowGrams(i) } }));
    }
    if (from?.kind === 'dish' && to !== undefined && to.kind !== 'dish') {
      const dishGrams = liveNow?.items?.[i]?.gramsPoint;
      const kept = valueKeepingGrams(to, dishGrams);
      const before = beforeDish[i];
      setBeforeDish((prev) => without(prev, i));
      if (kept !== null) {
        setDishUndo((prev) => ({ ...prev, [i]: { value: amounts[i], grams: Math.round(dishGrams) } }));
        setAmounts((prev) => ({ ...prev, [i]: kept }));
        return;
      }
      const back = before === undefined ? null : before.value?.key === to.key ? before.value : valueKeepingGrams(to, before.grams);
      if (back) {
        setAmounts((prev) => ({ ...prev, [i]: back }));
        return;
      }
    }
    if (to?.kind === 'dish') setDishUndo((prev) => without(prev, i));
    setAmounts((prev) => ({ ...prev, [i]: next }));
  };
  const undoDishKept = (i) => {
    const undo = dishUndo[i];
    if (!undo) return;
    setAmounts((prev) => ({ ...prev, [i]: undo.value }));
    setDishUndo((prev) => without(prev, i));
  };

  const addExtra = (food) => {
    setOpenRow(`x${extras.length}`);
    setExtras((prev) => [...prev, { food, amount: startingValue(food) }]);
    setAdding(false);
    setLive(null); // numbers are stale until the server re-prices the new list
  };
  const patchExtra = (idx, next) => setExtras((prev) => prev.map((x, i) => (i === idx ? { ...x, ...next } : x)));
  const removeExtra = (idx) => { setExtras((prev) => prev.filter((_, i) => i !== idx)); setOpenRow(null); setLive(null); };
  // The food picked for a scanned row takes its place at the row's own grams, by the
  // gram: the measures the row had were the food it replaced. The server prices it
  // (never the browser) once the preview asks. With no grams to keep, nothing is
  // changed ("Change food" waits for them).
  const changeRow = (i, food) => {
    const grams = rowGrams(i);
    if (grams === null) return;
    const at = { key: 'g', amount: String(grams) };
    // Undo gives back the scanned food as it stood before its first Change.
    setChangeUndo((prev) => ({ ...prev, [i]: { before: replaced[i] === undefined ? amounts[i] : prev[i]?.before ?? startingValue(analysis.items[i]), at } }));
    setReplaced((prev) => ({ ...prev, [i]: food }));
    setAmounts((prev) => ({ ...prev, [i]: at }));
    setDishUndo((prev) => without(prev, i));
    setBeforeDish((prev) => without(prev, i));
    setChanging(null);
    setLive(null);
  };
  // Undo puts the scanned food back: at the measure and amount it held while the
  // row is still at the grams Change kept, else by the gram at the grams the row
  // holds now — or as it held where those grams are not known (a dish not weighed).
  const undoChange = (i) => {
    const undo = changeUndo[i];
    const untouched = undo !== undefined && amounts[i]?.key === undo.at.key && amounts[i]?.amount === undo.at.amount;
    const grams = rowGrams(i);
    setReplaced((prev) => without(prev, i));
    setChangeUndo((prev) => without(prev, i));
    setDishUndo((prev) => without(prev, i));
    setBeforeDish((prev) => without(prev, i));
    setAmounts((prev) => ({ ...prev, [i]: untouched || grams === null ? undo?.before ?? startingValue(analysis.items[i]) : { key: 'g', amount: String(grams) } }));
    setLive(null);
  };

  if (!open) return null;

  const amber = { color: 'rgba(251,191,36,0.85)' };
  const toggleRow = (key) => setOpenRow((current) => (current === key ? null : key));
  // Why a row cannot be saved as it stands, said under it whether it is open or not:
  // nothing can be confirmed until it is fixed.
  const unusableLine = ({ tooLarge, tooSmall }) => ((tooLarge || tooSmall) && (
    <p className="text-xs px-3.5 pb-2.5" style={amber}>
      {tooSmall
        ? 'That comes to less than 1 g — pick a larger amount.'
        : `That is more than ${MAX_GRAMS.toLocaleString()} g — pick a smaller amount.`}
    </p>
  ));
  const macrosLine = (shown) => (
    <p className="text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>
      {shown === null || shown === undefined
        ? 'Calculating…'
        : `Protein ${Math.round(shown.proteinG)}g · Carbs ${Math.round(shown.carbsG)}g · Fat ${Math.round(shown.fatG)}g`}
    </p>
  );
  const rowBox = (isOpen, added) => ({
    background: added ? 'rgba(255,138,31,0.05)' : isOpen ? 'rgba(255,255,255,0.045)' : 'rgba(255,255,255,0.02)',
    border: added ? '1px solid rgba(255,138,31,0.15)' : `1px solid rgba(255,255,255,${isOpen ? '0.10' : '0.05'})`,
  });
  const withSheet = analysis !== null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{    opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
      >
        {/* A phone: the whole screen once a scan is on it. A computer: wide, the
            photo and the total beside the list (Kd's pick, RULINGS 2026-09-17). */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1    }}
          exit={{    opacity: 0, scale: 0.95 }}
          className={`relative w-full flex flex-col rounded-t-3xl sm:rounded-3xl ${withSheet
            ? 'h-[100dvh] sm:h-[90vh] sm:max-w-2xl lg:max-w-5xl'
            : 'max-h-[100dvh] sm:max-h-[85vh] sm:max-w-md'}`}
          style={{
            background: '#121110',
            border:     '1px solid rgba(255,255,255,0.06)',
          }}
        >
          {/* The X's question while a scan is unsaved (RULINGS 2026-09-16). */}
          {confirmingClose !== null && (
            <div className="absolute inset-0 z-10 flex items-center justify-center p-6 rounded-t-3xl sm:rounded-3xl"
                 style={{ background: 'rgba(10,9,8,0.94)' }}>
              <div role="alertdialog" aria-labelledby="close-scan-title" className="w-full max-w-xs text-center">
                <p id="close-scan-title" className="text-base font-bold text-white mb-2">Close without saving?</p>
                <p className="text-sm mb-1" style={{ color: 'rgba(255,255,255,0.70)' }}>
                  This photo already used one of today's scans.
                </p>
                {/* What is truly left of the scan, never more. */}
                <p className="text-xs mb-5" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  {timeLeftText(confirmingClose) ?? 'It can no longer be saved, so it will not come back.'}
                </p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setConfirmingClose(null)}
                          className="flex-1 min-h-11 rounded-xl text-sm font-semibold text-white"
                          style={{ background: 'linear-gradient(135deg, #FF8A1F, #FFB347)' }}>
                    Keep editing
                  </button>
                  <button type="button" onClick={() => { if (confirmingClose <= 0) resetSheet(); setConfirmingClose(null); onClose(); }}
                          className="flex-1 min-h-11 rounded-xl text-sm font-semibold"
                          style={{ color: 'rgba(255,255,255,0.75)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between px-5 py-3 flex-shrink-0"
               style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4" style={{ color: '#FF8A1F' }} />
              <h3 className="text-base font-bold text-white">AI Photo Log</h3>
            </div>
            <button
              onClick={requestClose}
              aria-label="Close"
              className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(255,255,255,0.04)' }}
            >
              <X className="w-5 h-5" style={{ color: 'rgba(255,255,255,0.5)' }} />
            </button>
          </div>

          {!preview ? (
            <div className="flex-1 overflow-y-auto p-5 no-scrollbar">
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
                    {retakeMsg ? retakeMsg.title : 'Snap or upload'}
                  </p>
                  <p className="text-xs mt-1"
                     style={{ color: retakeMsg ? 'rgba(251,191,36,0.85)' : 'rgba(255,255,255,0.50)' }}>
                    {retakeMsg ? retakeMsg.text : 'AI estimates the portions — you confirm them'}
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
            </div>
          ) : (
            // One scroll on a phone: the photo and name, the list, then the total and
            // Confirm. On a computer, two columns that scroll on their own.
            <div className={`flex-1 min-h-0 overflow-y-auto no-scrollbar p-4 sm:p-5 flex flex-col gap-4 ${withSheet
              ? 'lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-6 lg:overflow-hidden'
              : ''}`}>
              <div className="contents lg:flex lg:flex-col lg:gap-4 lg:min-h-0 lg:overflow-y-auto no-scrollbar">
                <div className="order-1 space-y-3">
                  {/* A scan not saved yet, perhaps brought back after a close: a new
                      photo is a new scan, and this one still counts (Kd, RULINGS 2026-09-16). */}
                  {analysis && (
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs" style={{ color: 'rgba(255,255,255,0.50)' }}>
                        Not saved yet. This scan still counts as one of today's scans.
                      </p>
                      <button type="button" onClick={resetSheet}
                              className="flex items-center gap-1.5 min-h-11 px-3 rounded-xl text-xs font-semibold whitespace-nowrap flex-shrink-0"
                              style={{ color: '#FF8A1F', background: 'rgba(255,138,31,0.10)', border: '1px solid rgba(255,138,31,0.25)' }}>
                        <Camera className="w-3.5 h-3.5" /> New photo
                      </button>
                    </div>
                  )}
                  <div className={withSheet ? 'flex gap-3 items-start lg:block' : ''}>
                    <img
                      src={preview}
                      alt="Meal"
                      className={withSheet
                        ? 'w-24 h-24 sm:w-28 sm:h-28 lg:w-full lg:h-auto lg:max-h-52 rounded-2xl object-cover flex-shrink-0'
                        : 'w-full rounded-2xl object-cover max-h-60'}
                    />
                    {analysis && (
                      <div className="min-w-0 lg:mt-4">
                        <p className="text-xs font-semibold uppercase tracking-wider mb-1"
                           style={{ color: '#FF8A1F' }}>
                          AI Analysis · {analysis.photoQuality === 'good' ? 'clear photo' : 'low confidence'}
                        </p>
                        <p className="text-base font-bold text-white mb-1">
                          {analysis.mealName}
                        </p>
                        <p className="text-xs mb-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
                          Tap a food to change its amount before saving.
                        </p>
                        {/* RULINGS 2026-09-09: photo scans say they estimate calories
                            and cannot detect allergens. Never softened or removed. */}
                        <p className="text-xs" style={amber}>
                          {PHOTO_SCAN_CAUTION}
                        </p>
                      </div>
                    )}
                  </div>

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
                </div>

                {analysis && (
                  <div className="order-3">
                    {payloadItems.length > 0 && (<>
                    <div
                      className="rounded-xl p-3 mb-3"
                      style={{
                        background: 'rgba(255,138,31,0.08)',
                        border:     '1px solid rgba(255,138,31,0.20)',
                      }}
                    >
                      {/* The AI's own totals cover ONLY what it saw, as it
                          started each row: once the user has added an
                          ingredient, changed a food or moved an amount they are
                          the wrong number — wait for the server rather than show
                          a total that is not what we are about to save. */}
                      {(() => {
                        const t = liveNow?.totals ?? (mealAtScan ? analysis.totals : null);
                        if (t === null) {
                          return (
                            <>
                              <p className="text-xs font-semibold mb-1" style={{ color: 'rgba(255,138,31,0.85)' }}>TOTAL</p>
                              <p className="text-xl font-bold tracking-tight" style={{ color: '#FF8A1F' }}>…</p>
                              <p className="text-2xs mt-0.5" style={{ color: 'rgba(255,138,31,0.65)' }}>
                                Adding up your ingredients…
                              </p>
                            </>
                          );
                        }
                        return (
                          <>
                            <p className="text-xs font-semibold mb-1" style={{ color: 'rgba(255,138,31,0.85)' }}>
                              {liveNow ? 'TOTAL (updates as you adjust)' : 'ESTIMATED TOTAL'}
                            </p>
                            <p className="text-xl font-bold tracking-tight" style={{ color: '#FF8A1F' }}>
                              {aboutTotal ? 'about ' : ''}
                              {t.kcalLow === t.kcalHigh ? `${t.kcalPoint} kcal` : `${t.kcalLow}–${t.kcalHigh} kcal`}
                            </p>
                            <p className="text-2xs mt-0.5" style={{ color: 'rgba(255,138,31,0.65)' }}>
                              Protein {Math.round(t.proteinG)}g · Carbs {Math.round(t.carbsG)}g · Fat {Math.round(t.fatG)}g
                            </p>
                          </>
                        );
                      })()}
                    </div>

                    {/* Log as: Breakfast/Lunch/Snack/Dinner (default = now) */}
                    <div className="flex gap-2 mb-3">
                      {MEAL_TYPES.map((mt) => (
                        <button
                          key={mt.id}
                          type="button"
                          onClick={() => setLogAs(logAs === mt.id ? null : mt.id)}
                          className="flex-1 min-h-11 rounded-xl text-xs font-semibold transition-all"
                          style={{
                            background: logAs === mt.id ? `${mt.color}20` : 'rgba(255,255,255,0.03)',
                            border: logAs === mt.id ? `1px solid ${mt.color}50` : '1px solid rgba(255,255,255,0.05)',
                            color: logAs === mt.id ? mt.color : 'rgba(255,255,255,0.50)',
                          }}
                        >
                          {mt.label}
                        </button>
                      ))}
                    </div>

                    <p className="text-2xs mb-3"
                       style={{ color: 'rgba(255,255,255,0.40)' }}>
                      {liveNow
                        ? 'All numbers are calculated by the server for your chosen amounts.'
                        : "Numbers here are the AI's first estimate — final nutrition is recalculated from your amounts when you save."}
                    </p>

                    <button
                      onClick={handleConfirm}
                      disabled={saving || !allValid}
                      className="w-full h-12 rounded-xl font-semibold text-sm text-white"
                      style={{
                        background: 'linear-gradient(135deg, #FF8A1F, #FFB347)',
                        boxShadow:  '0 4px 16px rgba(255,138,31,0.25)',
                        opacity:    saving || !allValid ? 0.6 : 1,
                      }}
                    >
                      {saving
                        ? 'Saving…'
                        : gramsTooLarge
                          ? `Amounts must be ${MAX_GRAMS.toLocaleString()} g or less`
                          : allValid
                            ? 'Confirm & log meal'
                            : 'Pick an amount for every item'}
                    </button>
                    </>)}
                    <SourceCredits sources={rowSources} />
                  </div>
                )}
              </div>

              {analysis && (
                <div className="order-2 lg:min-h-0 lg:overflow-y-auto no-scrollbar">
                  <div className="space-y-2 mb-3">
                    {analysis.items.map((item, i) => {
                      // Server-computed live numbers for the CURRENT amounts
                      // (2B: never computed in the browser). The scan's own
                      // numbers stand in only while the meal is still exactly
                      // what the scan saw: every row as it started, nothing
                      // added and nothing changed (T3 5c, 5c2 F1) — a row
                      // measured any other way, or a changed food, waits for
                      // the server rather than show a price that will not be saved.
                      const key = `s${i}`;
                      const isOpen = openRow === key;
                      const food = rowFood(i);
                      const changed = replaced[i];
                      const shown = liveNow?.items?.[i] ?? (mealAtScan ? item : null);
                      const source = changed?.source ?? item.nutritionSource;
                      const choice = pickerChoices(food, dishware).find((c) => c.key === amounts[i]?.key) ?? null;
                      // A row started at the photo's own grams is the scanner's
                      // guess until the person sets an amount (ROADMAP 7a-iv-b).
                      // A start at a measure (no grams from the photo) reads that measure (the review of PR #76, L2).
                      const portionMark = !(rowAtScan(i) && item.portionEstimated) ? null
                        : item.startsAt.measure === 'g' ? `~${item.gramsPoint} g · estimate`
                          : `~${amountSummary(choice, amounts[i]?.amount, item.gramsPoint)} · estimate`;
                      // "Change food" keeps the row's grams, so it waits while they are not known (H1).
                      const canChange = rowGrams(i) !== null;
                      return (
                        <div key={key} className="rounded-2xl" style={rowBox(isOpen, false)}>
                          <button type="button" aria-expanded={isOpen} onClick={() => toggleRow(key)}
                                  className="w-full min-h-14 px-3.5 py-2.5 flex items-center gap-3 text-left">
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold text-white truncate">{food.name}</span>
                              <span className="block text-xs mt-0.5 truncate" style={{ color: 'rgba(255,255,255,0.50)' }}>
                                {/* An estimate's figures and its grams are both the scanner's: one mark says so. */}
                                {source === 'estimate' && portionMark !== null
                                  ? <span style={amber}>{portionMark}</span>
                                  : (
                                    <>
                                      <span style={source === 'estimate' ? amber : undefined}>{SOURCE_TAGS[source] ?? source}</span>
                                      {' · '}
                                      {portionMark !== null
                                        ? <span style={amber}>{portionMark}</span>
                                        : amountSummary(choice, amounts[i]?.amount, shown?.gramsPoint)}
                                    </>
                                  )}
                              </span>
                            </span>
                            <span className="text-base font-bold flex-shrink-0 tabular-nums" style={{ color: '#FF8A1F' }}>
                              {shown === null
                                ? '…'
                                : shown.kcalLow === shown.kcalHigh
                                  ? `${shown.kcalPoint} kcal`
                                  : `${shown.kcalLow}–${shown.kcalHigh} kcal`}
                            </span>
                            <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                                         style={{ color: 'rgba(255,255,255,0.40)' }} />
                          </button>
                          {unusableLine(resolved[i])}
                          {isOpen && (
                            <div className="px-3.5 pb-3.5 space-y-3">
                              {macrosLine(shown)}
                              {/* The food's own measures and the person's saved dishes, as
                                  Add food offers them (ROADMAP 7a-iv-a, 7a-iv-b). */}
                              <MeasurePicker
                                food={food}
                                dishware={dishware}
                                value={amounts[i]}
                                onChange={(next) => setRowAmount(i, next)}
                                grams={shown?.gramsPoint ?? null}
                                onDishSaved={loadDishware}
                              />
                              {dishUndo[i] && choice?.kind !== 'dish' && (
                                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>
                                  Kept the dish's {dishUndo[i].grams} g ·{' '}
                                  <button type="button" onClick={() => undoDishKept(i)}
                                          className="min-h-11 underline decoration-dotted"
                                          style={{ color: 'rgba(255,255,255,0.75)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                                    Undo
                                  </button>
                                </p>
                              )}
                              <div className="flex items-center gap-4 text-xs">
                                <button type="button" disabled={!canChange}
                                        onClick={() => setChanging(changing === i ? null : i)}
                                        className="min-h-11 font-semibold underline decoration-dotted"
                                        style={{ color: '#FF8A1F', background: 'none', border: 'none', padding: 0, cursor: canChange ? 'pointer' : 'default', opacity: canChange ? 1 : 0.5 }}>
                                  Change food
                                </button>
                                {!canChange && <span style={{ color: 'rgba(255,255,255,0.50)' }}>{changeHold(i)}</span>}
                                {changed && (
                                  <button type="button"
                                          onClick={() => undoChange(i)}
                                          className="min-h-11 underline decoration-dotted"
                                          style={{ color: 'rgba(255,255,255,0.60)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                                    Undo
                                  </button>
                                )}
                              </div>
                              {changing === i && canChange && (
                                <div className="p-2.5 rounded-xl space-y-2"
                                     style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                                  <p className="text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.70)' }}>
                                    Pick the right food for {food.name}. The amount stays the same.
                                  </p>
                                  <FoodPicker
                                    selected={null}
                                    onPick={(picked) => changeRow(i, picked)}
                                    autoFocus
                                    exclude={onSheet(i)}
                                    placeholder="Search the right food..."
                                  />
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Card 5c: ingredients the AI never saw (oats → milk).
                        The same measure picker; the SERVER prices them. */}
                    {extras.map((x, j) => {
                      const key = `x${j}`;
                      const isOpen = openRow === key;
                      const shown = liveNow?.items?.[analysis.items.length + j];
                      const choice = pickerChoices(x.food, dishware).find((c) => c.key === x.amount?.key) ?? null;
                      return (
                        <div key={`${x.food.canonical}-${j}`} className="rounded-2xl" style={rowBox(isOpen, true)}>
                          <div className="flex items-center">
                            <button type="button" aria-expanded={isOpen} onClick={() => toggleRow(key)}
                                    className="flex-1 min-w-0 min-h-14 pl-3.5 py-2.5 flex items-center gap-3 text-left">
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-semibold text-white truncate">{x.food.name}</span>
                                <span className="block text-xs mt-0.5 truncate" style={{ color: 'rgba(255,255,255,0.50)' }}>
                                  <span style={{ color: 'rgba(255,138,31,0.80)' }}>added by you</span>
                                  {' · '}
                                  {amountSummary(choice, x.amount?.amount, shown?.gramsPoint)}
                                </span>
                              </span>
                              <span className="text-base font-bold flex-shrink-0 tabular-nums" style={{ color: '#FF8A1F' }}>
                                {shown ? `${shown.kcalPoint} kcal` : '…'}
                              </span>
                              <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                                           style={{ color: 'rgba(255,255,255,0.40)' }} />
                            </button>
                            <button type="button" onClick={() => removeExtra(j)}
                                    title={`Remove ${x.food.name}`} aria-label={`Remove ${x.food.name}`}
                                    className="w-11 h-11 mr-1 flex-shrink-0 flex items-center justify-center rounded-xl" style={{ color: 'rgba(239,68,68,0.75)' }}>
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                          {/* Confirm is hidden while any amount is unusable, so the row says why. */}
                          {unusableLine(resolved[analysis.items.length + j])}
                          {isOpen && (
                            <div className="px-3.5 pb-3.5 space-y-3">
                              {macrosLine(shown)}
                              <MeasurePicker
                                food={x.food}
                                dishware={dishware}
                                value={x.amount}
                                onChange={(next) => patchExtra(j, { amount: next })}
                                grams={shown?.gramsPoint ?? null}
                                onDishSaved={loadDishware}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* + Add ingredient — in the flow, where the mistake is
                      visible (Kd: features live inside the flow they serve). */}
                  {adding ? (
                    <div className="mb-3 p-3 rounded-xl space-y-3"
                         style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.70)' }}>
                          Add an ingredient the photo missed
                        </p>
                        <button type="button" onClick={() => setAdding(false)} aria-label="Stop adding"
                                className="w-11 h-11 -mr-2 flex items-center justify-center rounded-xl" style={{ color: 'rgba(255,255,255,0.45)' }}>
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <FoodPicker
                        selected={null}
                        onPick={addExtra}
                        autoFocus
                        exclude={onSheet()}
                        placeholder="e.g. milk, sugar, oil..."
                      />
                    </div>
                  ) : canAdd ? (
                    <button
                      type="button"
                      onClick={() => setAdding(true)}
                      className="w-full mb-3 min-h-11 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5"
                      style={{
                        background:  'rgba(255,255,255,0.03)',
                        border:      '1px dashed rgba(255,138,31,0.35)',
                        color:       '#FF8A1F',
                      }}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add an ingredient
                    </button>
                  ) : (
                    <p className="text-2xs mb-3 text-center" style={{ color: 'rgba(255,255,255,0.35)' }}>
                      That's the most items one meal can hold ({MAX_ITEMS}).
                    </p>
                  )}

                  {/* Both what the photo could not identify and what matched no
                      food are left out of the total. */}
                  {analysis.unknownItems?.length > 0 && (
                    <p className="text-2xs mb-3"
                       style={{ color: 'rgba(251,191,36,0.75)' }}>
                      Not in the total: {analysis.unknownItems.join(', ')}
                      {canAdd
                        ? ` — add ${analysis.unknownItems.length === 1 ? 'it' : 'them'} with “Add an ingredient” above if needed.`
                        : '.'}
                    </p>
                  )}

                  {/* Card-5b smoke (Kd): AI saw food but NOTHING matched our
                      food data ("Flatbread Stack" ≠ Roti) — say so honestly
                      instead of a 0-kcal box + dead Confirm. Card 5c: the
                      user can now fix it right here, so point at the button
                      above rather than sending them to another screen. */}
                  {analysis.items.length === 0 && extras.length === 0 && (
                    <div className="rounded-xl p-4 mb-3 text-center"
                         style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.20)' }}>
                      <p className="text-sm font-semibold mb-1"
                         style={{ color: 'rgba(251,191,36,0.85)' }}>
                        We saw the food but couldn't match it to our
                        nutrition data.
                      </p>
                      <p className="text-2xs" style={{ color: 'rgba(255,255,255,0.50)' }}>
                        Add it yourself with “Add an ingredient” above — we're
                        improving name matching.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ── Fallback buckets for UNLABELED meals only (Kd ruling 2026-07-17:
// mealType is the stored user-chosen label; this time derivation survives
// purely as the display fallback for rows without one). before 11 =
// breakfast · 11–16 = lunch · 16–19 = snack · 19–22 = dinner · else snack.
function bucketOf(takenAt) {
  const h = new Date(takenAt).getHours();
  if (h < 11) return 'breakfast';
  if (h < 16) return 'lunch';
  if (h < 19) return 'snack';
  if (h < 22) return 'dinner';
  return 'snack';
}

// ── Card 5d: local-day helpers for the previous-days view ─────────────────────
// All day math is client-LOCAL calendar days (same convention as the old
// isToday filter this replaces, and the meal sections' own display buckets).
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function isSameDay(a, b) {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}
function addDays(d, n) {
  const x = startOfDay(d);
  x.setDate(x.getDate() + n);
  return x;
}
// "Today" / "Yesterday" / "Wed, 16 Jul" for the date bar.
function dayLabel(date) {
  const today = new Date();
  if (isSameDay(date, today)) return 'Today';
  if (isSameDay(date, addDays(today, -1))) return 'Yesterday';
  return date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}
// <input type="date"> wants a LOCAL YYYY-MM-DD (toISOString would shift the day
// for anyone west of UTC); parse it back as a local date, never UTC.
function toDateInputValue(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseDateInput(v) {
  const [y, m, d] = v.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// ── Main Nutrition page ───────────────────────────────────────────────────────
export default function Nutrition() {
  const [meals,          setMeals]           = useState([]);
  // Which onboarding answers the server says the plan still needs (its own
  // keys; MacroRings says them in words), whether the target it has is on the
  // wrong side of the weight, plus whether the targets request has come back
  // at all — the page spinner
  // is owned by the MEALS fetch, so without this the honest prompt would
  // flash at everyone while targets are still in flight.
  const [missingInputs,  setMissingInputs]   = useState([]);
  const [targetWrongSide, setTargetWrongSide] = useState(false);
  const [targetsLoaded,  setTargetsLoaded]   = useState(false);
  // ROADMAP 7a-iv-e: which set of numbers the rings are on (App's plan · My
  // own), both sets, and why a stored set of the person's own is not the one
  // showing. `null` = no switch (not loaded, or the request failed).
  const [ringChoice,     setRingChoice]      = useState(null);
  // undefined = not loaded yet · null = profile can't produce a target ·
  // object = real server-computed targets (toDisplayTargets owns the mapping).
  const [targets,        setTargets]         = useState(undefined);
  const [loading,        setLoading]         = useState(true);
  // Card 5d: which local day the page is showing (default today). Navigation
  // (‹ / › / date picker) changes this; `truncated` = the day sits deeper in
  // history than the page-walk cap reaches (honest "couldn't load that far").
  const [selectedDate,   setSelectedDate]    = useState(() => startOfDay(new Date()));
  const [truncated,      setTruncated]       = useState(false);
  // `meal` set = add-ingredient-to-a-saved-meal mode (Card 5c).
  const [addModal,       setAddModal]        = useState({ open: false, mealType: null, meal: null });
  const [photoModalOpen, setPhotoModalOpen]  = useState(false);
  // ROADMAP 7a-iv-g: the logged food whose box is open, {meal, at}, or null.
  const [foodSheet,      setFoodSheet]       = useState(null);

  const viewingToday = isSameDay(selectedDate, new Date());
  // Card 5d (T3 F1): the newest-day request wins. Rapid ‹/› navigation fires
  // overlapping page-walks; without this a slower earlier response could resolve
  // last and paint the wrong day's meals under the current label. Every loadData
  // stamps the day it is fetching; results for a superseded day are dropped.
  const latestDayReq = useRef(null);

  // Card 5d: the meals list has no server date filter, so nutritionService
  // walks the newest-first pages until it passes `date` (see nutritionApi.js).
  // Defaults to the currently selected day so mutation handlers (delete/rename/
  // …) refresh whatever day is on screen. `date` is passed explicitly by
  // goToDay so navigation fetches the target day before the re-render lands.
  const loadData = async (date = selectedDate) => {
    const reqKey = startOfDay(date).getTime();
    latestDayReq.current = reqKey;
    try {
      const { meals: dayMeals, truncated: trunc } = await nutritionService.listMealsForDay(date);
      if (latestDayReq.current !== reqKey) return; // a newer navigation superseded this
      setMeals(dayMeals);
      setTruncated(trunc);
    } catch (err) {
      if (latestDayReq.current !== reqKey) return;  // abandoned day — don't toast
      console.error('Failed to load meals:', err);
      toast.error('Failed to load nutrition data');
    } finally {
      if (latestDayReq.current === reqKey) setLoading(false); // newer request owns the spinner
    }
  };

  // Navigate to another day. Never past today (no future meals can exist —
  // takenAt is always the real current time, Kd ruling 2026-07-17).
  const goToDay = (date) => {
    const d = startOfDay(date);
    if (d.getTime() > startOfDay(new Date()).getTime()) return;
    if (isSameDay(d, selectedDate)) return;
    setSelectedDate(d);
    setLoading(true);
    loadData(d);
  };

  // Targets are SERVER-computed (GET /v1/nutrition/targets: the person's own
  // plan, the number onboarding shows). The server returns targets:null +
  // missing[] while the plan still needs an answer, and we keep that distinct
  // from "not loaded yet" —
  // collapsing them is what the deleted 2000/150/250/65 fallbacks used to
  // hide. A failed request degrades to undefined (show nothing), never null
  // (which would wrongly tell the user their profile is incomplete).
  // One answer, one place it lands: GET and the switch's own PUT both reply
  // with the whole targets payload, so the rings can never show one set while
  // the switch says another.
  const applyTargets = (data) => {
    setTargets(toDisplayTargets(data));
    setMissingInputs(missingAnswers(data?.missing));
    setTargetWrongSide(data?.targetWrongSide === true);
    setRingChoice(toRingChoice(data));
  };

  /** The switch over the rings (7a-iv-e). Rejects with the server's own refusal
   *  so the picker can show the number that binds; the rings move only on the
   *  answer the server sends back. */
  const pickRingNumbers = async (body) => {
    const res = await nutritionService.putTargets(body);
    applyTargets(res.data);
  };

  const loadTargets = async () => {
    try {
      const res = await nutritionService.getTargets();
      applyTargets(res.data);
    } catch (err) {
      // Never `null` here — that would blame the user's profile for our own
      // failure. `undefined` renders MacroRings' "couldn't load" state.
      setTargets(undefined);
      setMissingInputs([]);
      setTargetWrongSide(false);
      setRingChoice(null);
      // Logged, not swallowed (T3): the left column now WAITS on this request,
      // so a silent failure was both invisible and load-bearing. Message only —
      // the error object carries the request config (R3.10).
      console.error('targets load failed:', err?.message);
    } finally {
      setTargetsLoaded(true);
    }
  };

  // Mount only: loads TODAY (loadData's default) once. Every day change goes
  // through goToDay, which fetches the target day explicitly — so this effect
  // must not re-run on selectedDate, and loadData is intentionally excluded.
  useEffect(() => {
    loadData();
    loadTargets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A meal as the server saved it goes on the page at once, then the day is read
  // again: a food tapped before that read lands is changed from the meal as it
  // now is, never refused as changed elsewhere (the review of PR #83, Low A).
  const mealSaved = (saved) => {
    if (saved && typeof saved.id === 'string') {
      setMeals((list) => list.map((m) => (m.id === saved.id ? saved : m)));
    }
    loadData();
  };

  // Resolves whether the meal was deleted, so a box that asked for it stays open
  // when it was not (the review of PR #83, L2).
  const handleDelete = async (mealId) => {
    try {
      await nutritionService.deleteMeal(mealId);
      toast.success('Meal removed');
      loadData();
      return true;
    } catch (err) {
      toast.error('Failed to delete');
      return false;
    }
  };

  // Card 5b: change a meal's time — keeps the date, swaps HH:MM; the server
  // stores it and the D1(a) bucket follows on reload.
  const handleEditTime = async (meal, hhmm) => {
    try {
      const [h, m] = hhmm.split(':').map(Number);
      const at = new Date(meal.takenAt);
      at.setHours(h, m, 0, 0);
      await nutritionService.updateMeal(meal.id, { takenAt: at.toISOString() });
      toast.success('Meal time updated');
      loadData();
    } catch (err) {
      toast.error('Failed to update the time');
    }
  };

  // Card 5c: change (or clear) a meal's section label. null clears it — the row
  // then falls back to the time-of-day bucket for display. The label is a user
  // preference, so the server writes no correction row for it.
  const handleRelabel = async (meal, mealType) => {
    if ((meal.mealType ?? null) === mealType) return;
    try {
      await nutritionService.updateMeal(meal.id, { mealType });
      toast.success(
        mealType
          ? `Moved to ${MEAL_TYPES.find((m) => m.id === mealType)?.label}`
          : 'Label removed',
      );
      loadData();
    } catch {
      toast.error('Failed to change the label');
    }
  };

  // Card 5c2 (Kd smoke ask): rename a logged meal. PATCH mealName already
  // exists (patchMealRequestSchema); the API trims + bounds it (1–200).
  const handleRename = async (meal, mealName) => {
    try {
      await nutritionService.updateMeal(meal.id, { mealName });
      toast.success('Meal renamed');
      loadData();
    } catch {
      toast.error('Failed to rename the meal');
    }
  };

  // The day's line is "about" while any meal in it holds a food priced by the
  // scanner's own estimate (ROADMAP 7a-iii-b).
  const dayEstimated = meals.some((m) => hasEstimate(m.items));

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

  // Same display formula the old backend used (nutrition.py:346-350) — a
  // subtraction of two SERVER-computed numbers for display, which D2/D3
  // expressly allow; the 2B ban is on the browser deriving nutrition.
  // The 2000/150/250/65 fallbacks are GONE (Kd ruling, targets card): with a
  // real calculator live they would only ever fire for the incomplete-profile
  // user, i.e. exactly the person who must not be shown someone else's goal.
  // No targets → no Remaining card at all (the honest state renders instead).
  // `=== null`, not `== null` (T3 F2): `undefined` means the request failed,
  // not that the profile lacks a target. Both suppress this card — there is no
  // target to subtract from either way — but MacroRings above tells the two
  // apart, and conflating them here would have made the false "add your
  // details" prompt the sole explanation of a network blip.
  // Signed: below zero is how far past the target the day went, which the card
  // says as "30 g over" instead of 0 (RULINGS 2026-09-17).
  const remaining = targets === null || targets === undefined ? null : {
    kcal:      Math.round(targets.kcal      - totals.kcal),
    protein_g: Math.round(targets.protein_g - totals.protein_g),
    carbs_g:   Math.round(targets.carbs_g   - totals.carbs_g),
    fat_g:     Math.round(targets.fat_g     - totals.fat_g),
  };

  // Sections group by the USER-CHOSEN label (meal_type, Kd ruling
  // 2026-07-17); unlabeled meals (older rows, photo confirms without a chip)
  // fall back to the time-of-day bucket for display only.
  const byType = meals.reduce((acc, m) => {
    const key = m.mealType || bucketOf(m.takenAt);
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
              {/* Card 5d: logging is only offered on Today — a new meal always
                  stamps the real current time (Kd ruling 2026-07-17), so it
                  would land under today, not the past day being viewed. */}
              {viewingToday ? (
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
              ) : (
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>
                  Viewing a past day · switch to Today to log a meal
                </p>
              )}
            </div>
          </div>
        </motion.div>

        {/* Card 5d (T3): the date bar stays mounted across day changes — only
            each column's CONTENT swaps to a spinner during a walk — so the ‹/›
            arrows stay clickable and the F1 overlapping-request guard is
            reachable through rapid stepping. */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* ── Left: Macro rings + remaining ─────────────────────────────── */}
            <div className="lg:col-span-1 space-y-4">
              {/* The spinner waits for BOTH fetches: `loading` is owned by the
                  MEALS request, and targets is a separate parallel call. Gating
                  on `loading` alone would render this column before targets
                  arrive and flash the "add your details" prompt at every user
                  with a complete profile. */}
              {loading || !targetsLoaded ? (
                <div className="card-glass flex items-center justify-center py-16">
                  <Loader2 className="w-5 h-5 animate-spin"
                           style={{ color: 'rgba(255,138,31,0.5)' }} />
                </div>
              ) : (
                <>
                  <MacroRings totals={totals} targets={targets} missingInputs={missingInputs} targetWrongSide={targetWrongSide}
                              ringChoice={ringChoice} onPickNumbers={pickRingNumbers} />

              {/* Card 5d: on Today this is "Remaining today" (target − eaten);
                  on a past day "remaining" is meaningless, so it becomes an
                  "Eaten on this day" total.
                  Targets card: with no target, "Remaining" cannot be computed
                  at all, so on TODAY this card is hidden and MacroRings' honest
                  prompt above is the single explanation (two prompts would be
                  nagging). A PAST day still renders — "Eaten on this day" is
                  pure server-summed totals and needs no target. */}
              {(viewingToday && remaining === null) ? null : (
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
                    {viewingToday ? 'Remaining today' : 'Eaten on this day'}
                  </h3>
                </div>
                <div className="space-y-2.5">
                  {(viewingToday
                    ? [
                        { label: 'Calories', value: remaining.kcal,      unit: 'kcal', color: '#FF8A1F' },
                        { label: 'Protein',  value: remaining.protein_g, unit: 'g',    color: '#4ade80' },
                        { label: 'Carbs',    value: remaining.carbs_g,   unit: 'g',    color: '#60a5fa' },
                        { label: 'Fat',      value: remaining.fat_g,     unit: 'g',    color: '#fbbf24' },
                      ]
                    : [
                        { label: 'Calories', value: totals.kcal,      unit: 'kcal', color: '#FF8A1F' },
                        { label: 'Protein',  value: totals.protein_g, unit: 'g',    color: '#4ade80' },
                        { label: 'Carbs',    value: totals.carbs_g,   unit: 'g',    color: '#60a5fa' },
                        { label: 'Fat',      value: totals.fat_g,     unit: 'g',    color: '#fbbf24' },
                      ]
                  ).map((r) => (
                    <div key={r.label} className="flex justify-between items-center">
                      <span className="text-xs"
                            style={{ color: 'rgba(255,255,255,0.50)' }}>
                        {r.label}
                      </span>
                      <span className="text-sm font-semibold tabular-nums"
                            style={{ color: r.color }}>
                        {`${dayEstimated ? 'about ' : ''}${r.value < 0 ? `${-r.value} ${r.unit} over` : `${r.value || 0} ${r.unit}`}`}
                      </span>
                    </div>
                  ))}
                </div>
              </motion.div>
              )}
                </>
              )}
            </div>

            {/* ── Right: date bar + meal sections ───────────────────────────── */}
            <div className="lg:col-span-2 space-y-4">

              {/* Card 5d: day navigation. ‹ goes back, › forward (never past
                  today), and the date picker jumps to any past day. */}
              <div className="card-glass flex items-center justify-between !py-2.5">
                <button
                  type="button"
                  onClick={() => goToDay(addDays(selectedDate, -1))}
                  title="Previous day"
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-lg"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.75)' }}
                >
                  ‹
                </button>
                <div className="flex flex-col items-center gap-1">
                  <p className="text-sm font-semibold text-white">{dayLabel(selectedDate)}</p>
                  <input
                    type="date"
                    value={toDateInputValue(selectedDate)}
                    max={toDateInputValue(new Date())}
                    onChange={(e) => e.target.value && goToDay(parseDateInput(e.target.value))}
                    className="text-2xs px-1.5 py-0.5 rounded"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.55)', colorScheme: 'dark' }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => goToDay(addDays(selectedDate, 1))}
                  disabled={viewingToday}
                  title={viewingToday ? 'This is the latest day' : 'Next day'}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-lg"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.75)', opacity: viewingToday ? 0.35 : 1 }}
                >
                  ›
                </button>
              </div>

              {loading ? (
                <div className="card-glass flex items-center justify-center py-16">
                  <Loader2 className="w-5 h-5 animate-spin"
                           style={{ color: 'rgba(255,138,31,0.5)' }} />
                </div>
              ) : (
              <>
              {/* Card 5d (T3 F2): the page-walk stops at a cap (only reached
                  with hundreds of newer meals), so `truncated` means it never
                  got back to this day — the client CANNOT know the day is empty.
                  Three cases, never asserting an emptiness we didn't verify:
                   • truncated + nothing found → "couldn't load back this far"
                     ONLY (no sections, which would each falsely say "none").
                   • truncated + some found   → the partial banner + sections.
                   • not truncated            → the true empty state or sections. */}
              {truncated && meals.length === 0 ? (
                <div className="card-glass text-center py-10">
                  <p className="text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>
                    This day is deep in your history — couldn’t load back this far.
                    Pick a more recent day.
                  </p>
                </div>
              ) : (
                <>
                  {truncated && (
                    <p className="text-2xs text-center" style={{ color: 'rgba(255,255,255,0.40)' }}>
                      Showing the most recent meals for this day — some older entries may not be loaded.
                    </p>
                  )}
                  {!viewingToday && meals.length === 0 ? (
                    <div className="card-glass text-center py-10">
                      <p className="text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>
                        No meals logged on this day.
                      </p>
                    </div>
                  ) : (
                    MEAL_TYPES.map((mt) => (
                      <MealSection
                        key={mt.id}
                        mealType={mt}
                        meals={byType[mt.id] || []}
                        canAdd={viewingToday}
                        onAdd={(id) => setAddModal({ open: true, mealType: id, meal: null })}
                        onDelete={handleDelete}
                        onEditTime={handleEditTime}
                        onRelabel={handleRelabel}
                        onAddIngredient={(meal) => setAddModal({ open: true, mealType: meal.mealType, meal })}
                        onRename={handleRename}
                        onChangeFood={(meal, at) => setFoodSheet({ meal, at })}
                      />
                    ))
                  )}
                </>
              )}
              </>
              )}
            </div>
          </div>
      </div>

      {/* Modals */}
      <AddMealModal
        open={addModal.open}
        mealType={addModal.mealType}
        meal={addModal.meal}
        onClose={() => setAddModal({ open: false, mealType: null, meal: null })}
        onSave={mealSaved}
      />
      <PhotoModal
        open={photoModalOpen}
        onClose={() => setPhotoModalOpen(false)}
        onSave={loadData}
      />
      {foodSheet && (
        <LoggedFoodSheet
          key={`${foodSheet.meal.id}-${foodSheet.at}`}
          meal={foodSheet.meal}
          at={foodSheet.at}
          onClose={() => setFoodSheet(null)}
          onSaved={mealSaved}
          onStale={loadData}
          onDeleteMeal={handleDelete}
        />
      )}
    </div>
  );
}