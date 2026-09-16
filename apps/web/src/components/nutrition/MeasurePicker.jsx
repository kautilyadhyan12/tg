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
import { DISH_SIZES, FILL_CHOICES, MAX_AMOUNT, choiceLabel, pickerChoices, steppedAmount, valueForChoice } from './measures';

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
    <div className="mt-2">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-2xs" style={{ color: 'rgba(255,255,255,0.45)' }}>{title}</p>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close" className="p-0.5" style={{ color: 'rgba(255,255,255,0.40)' }}>
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      <input
        value={name} onChange={(e) => setName(e.target.value)}
        placeholder="Name (e.g. my blue bowl)"
        className="w-full px-2.5 py-1.5 rounded-lg text-2xs mb-2 focus:outline-none"
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff' }}
      />
      <div className="flex gap-1.5 mb-2">
        {DISH_SIZES.map((s) => (
          <button key={s.label} type="button" onClick={() => setSize(s)}
                  className="flex-1 py-1.5 rounded-lg text-2xs font-semibold" style={chip(size?.label === s.label)}>
            {s.label}<br /><span style={{ opacity: 0.6 }}>{s.volumeMl} ml</span>
          </button>
        ))}
        <button type="button" onClick={() => setSize('custom')}
                className="flex-1 py-1.5 rounded-lg text-2xs font-semibold" style={chip(size === 'custom')}>
          Type ml
        </button>
      </div>
      {size === 'custom' && (
        <input
          type="number" value={customMl} min="1" max={MAX_AMOUNT}
          onChange={(e) => setCustomMl(e.target.value)} placeholder="Volume in ml"
          className="w-full px-2.5 py-1.5 rounded-lg text-2xs mb-2 focus:outline-none"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff' }}
        />
      )}
      <button type="button" onClick={save} disabled={!canSave || saving}
              className="w-full py-1.5 rounded-lg text-2xs font-semibold"
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
  const measures = choices.filter((c) => c.kind === 'measure');
  const dishes = choices.filter((c) => c.kind === 'dish');
  const amount = value?.amount ?? '';

  const pick = (key) => {
    if (key === NEW_DISH) { setNewDish(true); return; }
    const next = valueForChoice(choices.find((c) => c.key === key), grams);
    if (next) onChange(next);
  };
  const stepButton = { background: 'rgba(255,255,255,0.06)', color: '#fff' };

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap">
        {choice?.kind !== 'dish' && (
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Less" className="w-6 h-6 rounded-md" style={stepButton}
                    onClick={() => onChange({ key: value.key, amount: steppedAmount(amount, choice, -1) })}>−</button>
            <input
              type="number" aria-label="Amount" value={amount} min="0" step="any"
              onChange={(e) => onChange({ key: value.key, amount: e.target.value })}
              className="w-16 px-2 py-1 rounded-lg text-xs text-right focus:outline-none"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', color: '#fff' }}
            />
            <button type="button" aria-label="More" className="w-6 h-6 rounded-md" style={stepButton}
                    onClick={() => onChange({ key: value.key, amount: steppedAmount(amount, choice, 1) })}>+</button>
          </div>
        )}
        <select
          aria-label="Measure" value={value?.key ?? ''} onChange={(e) => pick(e.target.value)}
          className="min-w-0 flex-1 px-2 py-1 rounded-lg text-xs focus:outline-none"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', color: '#fff' }}
        >
          <optgroup label="Measures">
            {measures.map((c) => <option key={c.key} value={c.key}>{choiceLabel(c)}</option>)}
          </optgroup>
          {dishes.length > 0 && (
            <optgroup label="My dishes">
              {dishes.map((c) => <option key={c.key} value={c.key}>{choiceLabel(c)}</option>)}
            </optgroup>
          )}
          <option value={NEW_DISH}>+ Save a new dish…</option>
        </select>
        <span className="text-2xs whitespace-nowrap" style={{ color: 'rgba(255,255,255,0.55)' }}>
          {grams === null || grams === undefined ? '…' : `= ${Math.round(grams)} g`}
        </span>
      </div>

      {/* How full the dish was — required, never assumed (Kd, 2026-07-18). */}
      {choice?.kind === 'dish' && (
        <div className="mt-2">
          <p className="text-2xs mb-1.5" style={{ color: 'rgba(255,255,255,0.45)' }}>How full?</p>
          <div className="flex gap-1.5">
            {FILL_CHOICES.map((f) => {
              const selected = parseFloat(amount) === f.value;
              return (
                <button key={f.value} type="button" onClick={() => onChange({ key: value.key, amount: String(f.value) })}
                        className="flex-1 py-1.5 rounded-lg text-2xs font-semibold"
                        style={{
                          background: selected ? 'rgba(255,138,31,0.15)' : 'rgba(255,255,255,0.04)',
                          border: selected ? '1px solid rgba(255,138,31,0.40)' : '1px solid rgba(255,255,255,0.06)',
                          color: selected ? '#FF8A1F' : 'rgba(255,255,255,0.60)',
                        }}>
                  {f.label}
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
