// ROADMAP 7a-iv-a — the measure picker (RULINGS 2026-09-16, the portion redesign).
// A food is logged the way the professional food trackers log it: pick one of its
// own measures — "medium (3" dia) · 182 g", "cup · 158 g", grams, ounces — or a
// dish you saved, and how many (or how full). The SERVER looks the measure up in
// its own list and works out the grams and every number: this picker only says
// which measure and how many, and shows the grams the server sends back.
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { nutritionService } from '../../api/nutritionApi';
import Select from '../common/Select';
import { DISH_SIZES, FILL_CHOICES, MAX_AMOUNT, choiceLabel, pickerChoices, steppedAmount, unitLabel, valueForChoice } from './measures';
import { fillIcon } from './fillBowls';

const NEW_DISH = '__new_dish';

/** Save a dish of your own: a name, and one of the sizes or a size in ml.
 *  `onSaved` receives the saved dish. */
export function SaveDishForm({ title, onClose, onSaved }) {
  const [name,     setName]     = useState('');
  const [size,     setSize]     = useState(null); // a DISH_SIZES entry, or 'custom'
  const [customMl, setCustomMl] = useState('');
  const [saving,   setSaving]   = useState(false);

  const customValid = size === 'custom'
    && Number.isFinite(parseFloat(customMl)) && parseFloat(customMl) > 0 && parseFloat(customMl) <= MAX_AMOUNT;
  const canSave = size !== null && (size !== 'custom' || customValid);

  const save = async () => {
    const volumeMl = size === 'custom' ? Math.round(parseFloat(customMl)) : size?.volumeMl;
    if (!canSave || !Number.isFinite(volumeMl) || volumeMl <= 0 || saving) return;
    setSaving(true);
    try {
      const res = await nutritionService.createDishware({
        label: name.trim() || (size === 'custom' ? 'My dish' : `My ${size.label.toLowerCase()}`),
        containerClass: size === 'custom' ? 'custom' : size.containerClass,
        volumeMl,
      });
      onSaved(res.data.dishware);
    } catch {
      toast.error('Could not save that dish');
    } finally {
      setSaving(false);
    }
  };

  const chip = (selected) => ({
    background: selected ? 'rgba(255,138,31,0.15)' : 'rgba(255,255,255,0.04)',
    border: selected ? '1px solid rgba(255,138,31,0.40)' : '1px solid rgba(255,255,255,0.06)',
    color: selected ? '#FF8A1F' : 'rgba(255,255,255,0.60)',
  });

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.60)' }}>{title}</p>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-2 flex items-center justify-center rounded-xl" style={{ color: 'rgba(255,255,255,0.45)' }}>
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      <input
        value={name} onChange={(e) => setName(e.target.value)}
        placeholder="Name (e.g. my blue bowl)"
        className="w-full h-11 px-3 rounded-xl text-base mb-2 focus:outline-none"
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff' }}
      />
      <div className="grid grid-cols-4 gap-2 mb-2">
        {DISH_SIZES.map((s) => (
          <button key={s.label} type="button" onClick={() => setSize(s)}
                  className="min-h-11 py-1.5 rounded-xl text-sm font-semibold leading-tight" style={chip(size?.label === s.label)}>
            {s.label}<br /><span className="text-xs" style={{ opacity: 0.6 }}>{s.volumeMl} ml</span>
          </button>
        ))}
        <button type="button" onClick={() => setSize('custom')}
                className="min-h-11 py-1.5 rounded-xl text-sm font-semibold leading-tight" style={chip(size === 'custom')}>
          Type ml
        </button>
      </div>
      {size === 'custom' && (
        <input
          type="number" value={customMl} min="1" max={MAX_AMOUNT} inputMode="numeric"
          onChange={(e) => setCustomMl(e.target.value)} placeholder="Volume in ml"
          className="w-full h-11 px-3 rounded-xl text-base mb-2 focus:outline-none"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff' }}
        />
      )}
      <button type="button" onClick={save} disabled={!canSave || saving}
              className="w-full h-11 rounded-xl text-sm font-semibold"
              style={{ background: 'rgba(255,138,31,0.15)', border: '1px solid rgba(255,138,31,0.30)', color: '#FF8A1F', opacity: !canSave || saving ? 0.5 : 1 }}>
        {saving ? 'Saving…' : 'Save this dish'}
      </button>
    </div>
  );
}

/** `value` is {key, amount}: the choice's key (a measure id, or "dish:<id>") and
 *  the amount as typed. `grams` is what the server says the item weighs, or null
 *  while it has not answered. `onDishSaved` refreshes the saved dishes. */
export default function MeasurePicker({ food, dishware, value, onChange, grams, onDishSaved }) {
  const [newDish, setNewDish] = useState(false);
  const choices = pickerChoices(food, dishware);
  const choice = choices.find((c) => c.key === value?.key) ?? null;
  // The app's own dark list, not a native <select>: Windows draws a native
  // popup white, with a blue bar no CSS can change (common/Select.jsx).
  const options = [
    ...choices.map((c) => ({ value: c.key, label: choiceLabel(c) })),
    { value: NEW_DISH, label: '+ Save a new dish…' },
  ];
  const amount = value?.amount ?? '';

  const pick = (key) => {
    if (key === NEW_DISH) { setNewDish(true); return; }
    const next = valueForChoice(choices.find((c) => c.key === key), grams);
    if (next) onChange(next);
  };
  // Roomy enough for a thumb (Kd, 2026-09-16): every control at least 44 px, the
  // amount at 16 px so a phone does not zoom in when it is tapped.
  const field = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', color: '#fff' };
  const gramsText = (
    <span className="text-sm font-semibold whitespace-nowrap" style={{ color: 'rgba(255,255,255,0.85)' }}>
      {grams === null || grams === undefined ? '…' : `= ${Math.round(grams)} g`}
    </span>
  );

  return (
    <div className="space-y-2.5">
      {choice?.kind !== 'dish' && (
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Less" className="w-11 h-11 rounded-xl text-xl leading-none flex-shrink-0" style={field}
                  onClick={() => onChange({ key: value.key, amount: steppedAmount(amount, choice, -1) })}>−</button>
          <input
            type="number" aria-label="Amount" value={amount} min="0" step="any" inputMode="decimal"
            onChange={(e) => onChange({ key: value.key, amount: e.target.value })}
            className="w-20 h-11 px-2 rounded-xl text-base text-center focus:outline-none flex-shrink-0"
            style={field}
          />
          {/* What the amount counts, beside it: never a bare number. */}
          <span className="min-w-0 max-w-[9rem] truncate text-sm" style={{ color: 'rgba(255,255,255,0.75)' }} title={unitLabel(choice)}>
            {unitLabel(choice)}
          </span>
          <button type="button" aria-label="More" className="w-11 h-11 rounded-xl text-xl leading-none flex-shrink-0" style={field}
                  onClick={() => onChange({ key: value.key, amount: steppedAmount(amount, choice, 1) })}>+</button>
          {/* Grams by the gram say nothing more than the amount does. */}
          {choice?.id !== 'g' && <span className="ml-auto flex-shrink-0">{gramsText}</span>}
        </div>
      )}
      <Select
        ariaLabel="Measure" value={value?.key ?? ''} onChange={pick} options={options}
        maxListHeight={240}
        style={{ ...field, minHeight: 44, padding: '10px 14px', fontSize: 14, borderRadius: 12 }}
      />

      {/* How full the dish was — required, never assumed (Kd, 2026-07-18). */}
      {choice?.kind === 'dish' && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>How full?</p>
            {gramsText}
          </div>
          {/* The dish drawn filled to each level, and its word: no fractions (Kd, RULINGS 2026-09-17). */}
          <div className="grid grid-cols-4 gap-2">
            {FILL_CHOICES.map((f) => {
              const selected = parseFloat(amount) === f.value;
              // The dish's own shape, filled to what the server will weigh.
              const Dish = fillIcon(choice.containerClass, f.value);
              return (
                <button key={f.value} type="button" aria-pressed={selected}
                        onClick={() => onChange({ key: value.key, amount: String(f.value) })}
                        className="min-h-[4.5rem] px-1 py-2 rounded-xl flex flex-col items-center justify-center gap-1 text-xs font-semibold leading-tight text-center"
                        style={{
                          background: selected ? 'rgba(255,138,31,0.15)' : 'rgba(255,255,255,0.04)',
                          border: selected ? '1px solid rgba(255,138,31,0.40)' : '1px solid rgba(255,255,255,0.06)',
                          color: selected ? '#FF8A1F' : 'rgba(255,255,255,0.60)',
                        }}>
                  <Dish className="w-9 h-9 flex-shrink-0" />
                  <span>{f.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {newDish && (
        <SaveDishForm
          title={<span className="flex items-center gap-1"><Plus className="w-3 h-3" /> Save a new dish</span>}
          onClose={() => setNewDish(false)}
          onSaved={(dish) => {
            onDishSaved?.(dish);
            onChange({ key: `dish:${dish.id}`, amount: '' });
            setNewDish(false);
          }}
        />
      )}
    </div>
  );
}
