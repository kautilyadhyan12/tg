// ROADMAP 7a-iv-g — changing a food already logged (RULINGS 2026-09-17). A tap on
// a food of a saved meal opens this box: its measure picker at the amount it was
// logged by, "Type my own numbers" for a label or a restaurant's numbers (protein,
// carbs and fat; the server works out the calories from them), and "Remove from
// this meal". Every number shown is the server's: the edit is previewed by the
// same rule the save uses, and nothing is worked out here.
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { composeFoodEdit, composeRemoveFood, nutritionService } from '../../api/nutritionApi';
import MeasurePicker from './MeasurePicker';
import { OWN_FIELDS, SOURCE_WORDS, editRefusal, ownNumbersFrom } from './loggedFood';
import {
  MAX_AMOUNT, amountSummary, chosenItemFor, comesToUnderAGram, formatAmount, loggedAmountText, loggedValue, pickerChoices,
} from './measures';

const sameValue = (a, b) => a?.key === b?.key && parseFloat(a?.amount) === parseFloat(b?.amount);

/** Whether a failure is the server saying the meal changed after it was read. */
const mealChanged = (err) => err?.response?.data?.error === 'meal_changed';

/** `onSaved` reads the day again after a change; `onStale` reads it again when the
 *  server says the meal changed elsewhere, so the food opened next is the meal as
 *  it is; `onDeleteMeal` resolves true once the meal is deleted. */
export default function LoggedFoodSheet({ meal, at, onClose, onSaved, onStale, onDeleteMeal }) {
  const item = meal.items[at];
  const [measures,   setMeasures]   = useState(null); // null while loading
  const [dishware,   setDishware]   = useState([]);
  const [value,      setValue]      = useState(null);
  const [start,      setStart]      = useState(null);
  // keep: the item keeps its numbers (its own grow with its amount) · typing:
  // the person's own numbers being typed · clear: back to the food's numbers.
  const [ownMode,    setOwnMode]    = useState('keep');
  const [ownText,    setOwnText]    = useState({ proteinG: '', carbsG: '', fatG: '' });
  // The server's answer for one edit, keyed by it: {key, item}, a refusal said
  // in words {key, refusal}, or a failure that says nothing {key, failed}.
  const [live,       setLive]       = useState(null);
  const [retries,    setRetries]    = useState(0);
  const [saving,     setSaving]     = useState(false);
  const [confirming, setConfirming] = useState(false);

  const loadDishware = () =>
    nutritionService.listDishware().then((r) => setDishware(r.data.items || [])).catch(() => {});

  useEffect(() => {
    let gone = false;
    nutritionService.getMealMeasures(meal.id)
      .then((res) => res.data?.measures?.[at])
      .catch(() => null)
      .then((own) => {
        if (gone) return;
        // Measures that cannot be read leave the food to be weighed by the gram.
        const list = Array.isArray(own) && own.length > 0 ? own : [{ id: 'g', name: 'g', grams: 1 }];
        const opened = loggedValue(item, list);
        setMeasures(list);
        setValue(opened);
        setStart(opened);
      });
    loadDishware();
    return () => { gone = true; };
    // The box is opened for one food of one meal; it is closed, not re-pointed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const food = { measures: measures ?? [] };
  const choice = value ? pickerChoices(food, dishware).find((c) => c.key === value.key) ?? null : null;
  const amountArm = value ? chosenItemFor(item.canonical, choice, value.amount) : null;
  const typed = parseFloat(value?.amount);
  const tooLarge = choice?.kind === 'measure' && Number.isFinite(typed) && typed * choice.grams > MAX_AMOUNT;
  const tooSmall = comesToUnderAGram(choice, value?.amount);
  const typedOwn = ownMode === 'typing' ? ownNumbersFrom(ownText) : undefined;
  const own = ownMode === 'typing' ? typedOwn : ownMode === 'clear' ? null : undefined;
  const changed = measures !== null && (!sameValue(value, start) || ownMode !== 'keep');
  // What would be sent: null while the amount or the typed numbers are no amount.
  const edit = amountArm === null || tooLarge || tooSmall || (ownMode === 'typing' && typedOwn === null)
    ? null
    : composeFoodEdit(meal.items, at, amountArm, own);
  const editKey = JSON.stringify(edit);

  useEffect(() => {
    // Nothing to price: an older answer is never shown, since it is keyed to what
    // it priced (`current` below).
    if (!changed || edit === null) return undefined;
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const res = await nutritionService.previewMealEdit(meal.id, edit, meal.itemsVersion);
        const priced = res.data?.items?.[at] ?? null;
        if (!stale) setLive(priced === null ? { key: editKey, failed: true } : { key: editKey, item: priced });
      } catch (err) {
        if (stale) return;
        const refusal = editRefusal(err);
        setLive(refusal === null ? { key: editKey, failed: true } : { key: editKey, refusal });
        if (mealChanged(err)) onStale();
      }
    }, 300);
    return () => { stale = true; clearTimeout(timer); };
    // editKey is a complete value-serialisation of the edit; `retries` asks again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editKey, changed, retries]);

  // The numbers shown: the saved item's until something changes, then only the
  // server's answer for exactly what would be sent — never an older one, and
  // never one still being worked out. Nothing can be saved, nor typed over,
  // that the server has not priced for the amount on screen (the review of
  // PR #83, High 2): what is saved is what was shown.
  const current = live?.key === editKey ? live : null;
  const shown = !changed ? item : current?.item ?? null;
  const refused = current?.refusal ?? null;
  const failed = current?.failed === true;
  const held = !changed || edit === null || !current?.item || saving;

  const startTyping = () => {
    if (shown === null) return;
    setOwnText({
      proteinG: formatAmount(shown.proteinG), carbsG: formatAmount(shown.carbsG), fatG: formatAmount(shown.fatG),
    });
    setOwnMode('typing');
  };

  const save = async () => {
    if (held) return;
    setSaving(true);
    try {
      await nutritionService.updateMeal(meal.id, { items: edit, itemsVersion: meal.itemsVersion });
      toast.success(`Changed ${item.name}`);
      onSaved();
      onClose();
    } catch (err) {
      if (mealChanged(err)) {
        // Said in the box, and Save held: this edit can never be saved now.
        setLive({ key: editKey, refusal: editRefusal(err) });
        onStale();
      } else {
        toast.error(editRefusal(err) ?? 'Could not save the change. Try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (meal.items.length === 1) {
        // A meal that could not be deleted keeps its box open: the page said why.
        if (await onDeleteMeal(meal.id)) onClose();
      } else {
        await nutritionService.updateMeal(meal.id, { items: composeRemoveFood(meal.items, at), itemsVersion: meal.itemsVersion });
        toast.success(`Removed ${item.name}`);
        onSaved();
        onClose();
      }
    } catch (err) {
      toast.error(editRefusal(err) ?? 'Could not remove it. Try again.');
      if (mealChanged(err)) onStale();
    } finally {
      setSaving(false);
    }
  };

  const isOwn = item.nutritionSource === 'own';
  const backTo = item.scanEstimate ? "Use the scan's estimate" : "Use the food list's numbers";
  const heldReason = !changed ? null
    : tooLarge ? `That is more than ${MAX_AMOUNT.toLocaleString('en-US')} g — pick a smaller amount.`
      : tooSmall ? 'That comes to less than 1 g — pick a larger amount.'
        : amountArm === null ? (choice?.kind === 'dish' ? "Pick how full it was — we'll work out the grams." : 'Enter an amount.')
          : ownMode === 'typing' && typedOwn === null ? 'Fill in protein, carbs and fat, in grams.'
            : failed ? "Couldn't work out the numbers for this amount."
              : refused;
  const button = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.75)' };
  const field = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', color: '#fff' };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        // Only the X closes it (Kd, 2026-09-16). On a phone it rises from the bottom.
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
      >
        <motion.div
          role="dialog" aria-label={`Change ${item.name}`}
          initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl flex flex-col"
          style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.06)', maxHeight: '90vh' }}
        >
          <div className="flex items-start justify-between gap-3 px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-white break-words">{item.name}</h3>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.50)' }}>
                Logged as {loggedAmountText(item)} · {item.kcalPoint} kcal
              </p>
            </div>
            <button onClick={onClose} aria-label="Close" className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(255,255,255,0.04)' }}>
              <X className="w-5 h-5" style={{ color: 'rgba(255,255,255,0.5)' }} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 no-scrollbar space-y-5">
            {/* The amount, in the food's own measures. */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.70)' }}>Amount</p>
                <p className="text-lg font-bold" style={{ color: '#FF8A1F' }}>{shown ? `${shown.kcalPoint} kcal` : '…'}</p>
              </div>
              {measures === null ? (
                <p className="text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>…</p>
              ) : (
                <MeasurePicker
                  food={food} dishware={dishware} value={value} onChange={setValue}
                  grams={shown?.gramsPoint ?? null} onDishSaved={loadDishware}
                />
              )}
              {shown && (
                <p className="text-xs mt-3" style={{ color: 'rgba(255,255,255,0.55)' }}>
                  Protein {formatAmount(shown.proteinG)} g · Carbs {formatAmount(shown.carbsG)} g · Fat {formatAmount(shown.fatG)} g
                  <span className="block mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>{SOURCE_WORDS[shown.nutritionSource] ?? ''}</span>
                </p>
              )}
            </div>

            {/* The person's own numbers (RULINGS 2026-09-17): typed for the amount
                above; the calories are the server's, worked out from them. */}
            <div className="rounded-2xl p-4 space-y-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
              {ownMode === 'typing' ? (
                <>
                  <p className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.80)' }}>Your own numbers</p>
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.50)' }}>
                    For {amountSummary(choice, value?.amount, shown?.gramsPoint)}, as you ate it — from a label or a restaurant.
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {OWN_FIELDS.map(({ key, label }) => (
                      <label key={key} className="block">
                        <span className="block text-xs mb-1" style={{ color: 'rgba(255,255,255,0.55)' }}>{label} (g)</span>
                        <input
                          type="number" inputMode="decimal" min="0" step="any" aria-label={`${label} in grams`}
                          value={ownText[key]} onChange={(e) => setOwnText((t) => ({ ...t, [key]: e.target.value }))}
                          className="w-full h-11 px-2 rounded-xl text-base text-center focus:outline-none" style={field}
                        />
                      </label>
                    ))}
                  </div>
                  <p className="text-sm font-semibold" style={{ color: '#FF8A1F' }}>
                    {shown ? `Comes to ${shown.kcalPoint} kcal` : 'Comes to … kcal'}
                  </p>
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
                    Calories are worked out from these: 4 kcal a gram of protein and of carbs, 9 of fat. That leaves out
                    alcohol, so for a drink with alcohol keep the food list's numbers.
                  </p>
                  <button type="button" onClick={() => setOwnMode('keep')} className="w-full h-11 rounded-xl text-sm font-semibold" style={button}>
                    Cancel typing
                  </button>
                </>
              ) : ownMode === 'clear' ? (
                <>
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>
                    Saving puts back {item.scanEstimate ? "the scan's estimate" : "the food list's numbers"} for this amount.
                  </p>
                  <button type="button" onClick={() => setOwnMode('keep')} className="w-full h-11 rounded-xl text-sm font-semibold" style={button}>
                    Keep my numbers
                  </button>
                </>
              ) : (
                <>
                  {isOwn && (
                    <p className="text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>
                      These are your numbers. Change the amount and they grow or shrink with it.
                    </p>
                  )}
                  {/* Filled from the server's numbers for the amount on screen, so
                      it waits for them: never the last amount's under this one. */}
                  <button type="button" onClick={startTyping} disabled={shown === null}
                          className="w-full h-11 rounded-xl text-sm font-semibold"
                          style={{ ...button, opacity: shown === null ? 0.5 : 1 }}>
                    {isOwn ? 'Type new numbers' : 'Type my own numbers'}
                  </button>
                  {isOwn && (
                    <button type="button" onClick={() => setOwnMode('clear')} className="w-full h-11 rounded-xl text-sm font-semibold" style={button}>
                      {backTo}
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Remove one food; the last one takes the meal with it. */}
            <div>
              {confirming ? (
                <div className="rounded-2xl p-4 space-y-3" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.20)' }}>
                  <p className="text-sm" style={{ color: 'rgba(255,255,255,0.80)' }}>
                    {meal.items.length === 1
                      ? 'This is the only food in this meal. Delete the whole meal?'
                      : `Remove ${item.name} from this meal?`}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={remove} disabled={saving} className="h-11 rounded-xl text-sm font-semibold"
                            style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.35)', color: '#f87171' }}>
                      {meal.items.length === 1 ? 'Delete the meal' : 'Remove'}
                    </button>
                    <button type="button" onClick={() => setConfirming(false)} className="h-11 rounded-xl text-sm font-semibold" style={button}>
                      Keep it
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirming(true)} className="w-full h-11 rounded-xl text-sm font-semibold"
                        style={{ background: 'transparent', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}>
                  Remove from this meal
                </button>
              )}
            </div>
          </div>

          <div className="p-5" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            {heldReason && <p className="text-xs mb-3" style={{ color: 'rgba(251,191,36,0.85)' }}>{heldReason}</p>}
            {failed && (
              <button type="button" onClick={() => { setLive(null); setRetries((n) => n + 1); }}
                      className="w-full h-11 mb-3 rounded-xl text-sm font-semibold" style={button}>
                Try again
              </button>
            )}
            <button
              type="button" onClick={save} disabled={held}
              className="w-full h-12 rounded-xl font-semibold text-base text-white"
              style={{ background: 'linear-gradient(135deg, #FF8A1F, #FFB347)', opacity: held ? 0.6 : 1 }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
