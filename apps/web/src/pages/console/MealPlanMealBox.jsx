import { useEffect, useRef, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import { errorText } from '../../api/orgsApi';
import { mealPlansService } from '../../api/mealPlansApi';
import { Field } from './ClassFields';
import {
  MEAL_MOST_FOODS, PLAN_WORDS, allergensLine, foodLine, formatAmount, measureLabel, mealTypeName, ownFoodProblem, rowOfFood, rowOfOwn,
} from './mealPlansView';

// ONE MEAL OF A GYM'S MEAL PLAN, opened under the meal or the Add a meal it was pressed from
// (ROADMAP Stage 2 24a-i). Its foods with their amounts, the food list's search, and a food of
// the writer's own, as the phone's food box has them; only Save to plan changes the plan.

const SEARCH_WAIT_MS = 300;
const EMPTY_OWN = { name: '', grams: '', proteinG: '', carbsG: '', fatG: '' };

function AmountBox({ row, onChange, disabled }) {
  if (row.kind === 'own') {
    return (
      <label className="flex items-center gap-2 c-s14 c-t2">
        <input
          type="number"
          min="1"
          step="any"
          inputMode="decimal"
          aria-label={`Grams of ${row.name}`}
          value={row.grams}
          disabled={disabled}
          onChange={(e) => onChange({ grams: Number(e.target.value), changed: true })}
          className="c-input"
          style={{ width: 96 }}
        />
        g
      </label>
    );
  }
  if (row.measures === null) return <span className="c-s14 c-t2">{row.measure === 'g' ? `${formatAmount(row.amount)} g` : formatAmount(row.amount)}</span>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="number"
        min="0"
        step="any"
        inputMode="decimal"
        aria-label={`How much ${row.name}`}
        value={row.amount}
        disabled={disabled}
        onChange={(e) => onChange({ amount: Number(e.target.value), changed: true })}
        className="c-input"
        style={{ width: 96 }}
      />
      <select
        aria-label={`Measure of ${row.name}`}
        value={row.measure}
        disabled={disabled}
        onChange={(e) => {
          const next = row.measures.find((m) => m.id === e.target.value);
          const before = row.measures.find((m) => m.id === row.measure);
          // The same weight in the new measure, so changing what it is counted in does not change how much.
          const grams = (before?.grams ?? 1) * row.amount;
          onChange({ measure: e.target.value, amount: next === undefined ? row.amount : Math.round((grams / next.grams) * 100) / 100 || 1, changed: true });
        }}
        className="c-sel"
        style={{ maxWidth: 260 }}
      >
        {row.measures.map((m) => (
          <option key={m.id} value={m.id}>
            {measureLabel(m)}
          </option>
        ))}
      </select>
    </div>
  );
}

function OwnFoodForm({ onAdd, onCancel }) {
  const [own, setOwn] = useState(EMPTY_OWN);
  const [problem, setProblem] = useState(null);
  const set = (change) => {
    setOwn((o) => ({ ...o, ...change }));
    setProblem(null);
  };
  const add = () => {
    const why = ownFoodProblem(own);
    if (why !== null) {
      setProblem(why);
      return;
    }
    onAdd(rowOfOwn({ ...own, proteinG: own.proteinG || 0, carbsG: own.carbsG || 0, fatG: own.fatG || 0 }));
  };
  const number = (key, label) => (
    <Field label={label}>
      <input type="number" min="0" step="any" inputMode="decimal" value={own[key]} onChange={(e) => set({ [key]: e.target.value })} className="c-input" />
    </Field>
  );
  return (
    <div className="c-card p-4 flex flex-col gap-3" data-testid="own-food">
      <h4 className="c-s15 c-w6 c-t1">Your own food</h4>
      <Field label="Name">
        <input value={own.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} className="c-input" placeholder="Chicken curry" />
      </Field>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {number('grams', 'Grams')}
        {number('proteinG', 'Protein (g)')}
        {number('carbsG', 'Carbs (g)')}
        {number('fatG', 'Fat (g)')}
      </div>
      {problem !== null ? (
        <p className="c-s14" role="alert" style={{ color: 'var(--bad)' }}>
          {problem}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={add} className="c-btn c-btn-s c-btn-sm">
          Add to this meal
        </button>
        <button type="button" onClick={onCancel} className="c-btn c-btn-quiet c-btn-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}

function FoodSearch({ onPick, disabled }) {
  const [typed, setTyped] = useState('');
  const [found, setFound] = useState({ q: '', items: [], loading: false, error: null });
  const asked = useRef(0);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  /** Searched a moment after the typing stops; only the newest search's answer is shown. */
  const type = (value) => {
    setTyped(value);
    clearTimeout(timer.current);
    const q = value.trim();
    const n = ++asked.current;
    if (q === '') {
      setFound({ q: '', items: [], loading: false, error: null });
      return;
    }
    setFound((f) => ({ ...f, loading: true, error: null }));
    timer.current = setTimeout(() => {
      mealPlansService.searchFoods(q).then(
        (items) => {
          if (n === asked.current) setFound({ q, items, loading: false, error: null });
        },
        (err) => {
          if (n === asked.current) setFound({ q, items: [], loading: false, error: errorText(err, "We couldn't search the food list. Please try again.") });
        },
      );
    }, SEARCH_WAIT_MS);
  };
  return (
    <div className="flex flex-col gap-2">
      <label className="c-search w-full">
        <Search aria-hidden="true" className="w-[18px] h-[18px]" />
        <input type="search" aria-label="Search food" placeholder="Search food" maxLength={100} value={typed} disabled={disabled} onChange={(e) => type(e.target.value)} className="c-input" />
      </label>
      {found.loading ? <p className="c-s14 c-t2">Searching…</p> : null}
      {found.error !== null ? (
        <p className="c-s14" role="alert" style={{ color: 'var(--bad)' }}>
          {found.error}
        </p>
      ) : null}
      {!found.loading && found.error === null && found.q !== '' && found.items.length === 0 ? (
        <p className="c-s14 c-t2">No food found. Add it as your own food.</p>
      ) : null}
      {found.items.length > 0 ? (
        <ul className="flex flex-col" aria-label="Foods found">
          {found.items.map((food) => {
            const allergens = allergensLine(food);
            return (
              <li key={food.canonical} className="c-row flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="c-s15 c-t1">{food.name}</p>
                  <p className="c-s13 c-t2">{foodLine(food)}</p>
                  {allergens !== null ? <p className="c-s13 c-t2">{allergens}</p> : null}
                </div>
                <button type="button" onClick={() => onPick(food)} disabled={disabled} className="c-btn c-btn-s c-btn-sm flex-shrink-0" aria-label={`Add ${food.name}`}>
                  Add
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/** `start`: the meal's foods as rows, empty for a new meal. `onSave(rows)` saves the meal to the
 *  plan and settles once the server has answered; it throws to keep the box open. */
export default function MealPlanMealBox({ gymId, planId, day, dayName, at, mealType, start, onSave, onClose }) {
  const [rows, setRows] = useState(start);
  const [searching, setSearching] = useState(start.length === 0);
  const [owning, setOwning] = useState(false);
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  /** Something in the box was changed, added or taken off: closing it asks first. */
  const [dirty, setDirty] = useState(false);
  const mealName = mealTypeName(mealType);

  // A meal already in the plan: its foods' own measures, to change their amounts.
  useEffect(() => {
    if (at === null || start.length === 0) return undefined;
    let live = true;
    mealPlansService.measures(gymId, planId, day, at).then(
      (all) => {
        if (!live) return;
        setRows((now) =>
          now.map((r) => {
            const i = start.findIndex((s) => s.key === r.key);
            return r.kind === 'list' && r.measures === null && i >= 0 ? { ...r, measures: all[i] ?? null } : r;
          }),
        );
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [gymId, planId, day, at, start]);

  const edit = (key, change) => {
    setRows((now) => now.map((r) => (r.key === key ? { ...r, ...change } : r)));
    setDirty(true);
    setError(null);
  };
  const add = (row) => {
    if (rows.length >= MEAL_MOST_FOODS) {
      setError(PLAN_WORDS.mealFull);
      return;
    }
    setRows((now) => [...now, row]);
    setDirty(true);
    setError(null);
  };
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(rows);
    } catch (err) {
      setAsking(false);
      setError(errorText(err, "We couldn't save this meal. Please try again."));
    } finally {
      setSaving(false);
    }
  };
  const takeOff = (key) => {
    setRows((now) => now.filter((x) => x.key !== key));
    setDirty(true);
  };
  const close = () => {
    if (dirty && rows.length > 0) setAsking(true);
    else onClose();
  };

  if (asking) {
    return (
      <div className="c-card p-5 flex flex-col gap-3" role="dialog" aria-label={PLAN_WORDS.leaveAsk}>
        <h3 className="c-s16 c-w6 c-t1">{PLAN_WORDS.leaveAsk}</h3>
        <p className="c-s14 c-t2">{PLAN_WORDS.leaveWhy(mealName, dayName)}</p>
        {error !== null ? (
          <p className="c-s14" role="alert" style={{ color: 'var(--bad)' }}>
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={save} disabled={saving} className="c-btn c-btn-p">
            Save to plan
          </button>
          <button type="button" onClick={onClose} disabled={saving} className="c-btn c-btn-quiet">
            Leave without saving
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="c-card p-5 flex flex-col gap-4" data-testid="meal-box">
      <div className="flex items-start justify-between gap-3">
        <h3 className="c-s16 c-w6 c-t1">{`${mealName} · ${dayName}`}</h3>
        <button type="button" onClick={close} className="c-icon-btn" aria-label="Close">
          <X aria-hidden="true" className="w-[18px] h-[18px]" />
        </button>
      </div>

      {rows.length > 0 ? (
        <ul className="flex flex-col" aria-label={`Foods in ${mealName}`}>
          {rows.map((r) => (
            <li key={r.key} className="c-row flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
              <p className="c-s15 c-t1 min-w-0">{r.name}</p>
              <div className="flex items-center gap-2">
                <AmountBox row={r} disabled={saving} onChange={(change) => edit(r.key, change)} />
                <button type="button" onClick={() => takeOff(r.key)} disabled={saving} className="c-icon-btn" aria-label={`Take ${r.name} off`}>
                  <X aria-hidden="true" className="w-[16px] h-[16px]" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="c-s14 c-t2">No foods in this meal yet.</p>
      )}

      {owning ? (
        <OwnFoodForm
          onAdd={(row) => {
            add(row);
            setOwning(false);
          }}
          onCancel={() => setOwning(false)}
        />
      ) : searching ? (
        <div className="flex flex-col gap-2">
          <FoodSearch onPick={(food) => add(rowOfFood(food))} disabled={saving} />
          <button type="button" onClick={() => setOwning(true)} className="c-btn c-btn-link self-start">
            Add your own food
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setSearching(true)} className="c-btn c-btn-soft self-start">
          <Plus aria-hidden="true" className="w-[18px] h-[18px]" />
          Add another food
        </button>
      )}

      {error !== null ? (
        <p className="c-s14" role="alert" style={{ color: 'var(--bad)' }}>
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={save} disabled={saving || rows.length === 0} className="c-btn c-btn-p">
          {saving ? 'Saving…' : 'Save to plan'}
        </button>
        <button type="button" onClick={close} disabled={saving} className="c-btn c-btn-quiet">
          Cancel
        </button>
      </div>
    </div>
  );
}
