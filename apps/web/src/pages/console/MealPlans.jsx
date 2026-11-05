import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import { GYM_MEAL_PLAN_NAME_MAX } from '@app/shared';
import { errorCode, errorStatus, errorText } from '../../api/orgsApi';
import { mealPlansService } from '../../api/mealPlansApi';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import { Field } from './ClassFields';
import MealPlanMealBox from './MealPlanMealBox';
import {
  DAY_NAMES, DAY_SHORT, MEAL_TYPES, MOST_PLAN_MEALS, PLAN_WORDS, byLine, dayMeals, itemAmount, mealNumbers, mealTypeName, mealsLine, numbersLine, rowOfItem,
} from './mealPlansView';
import { useConsoleOrg } from './useConsoleOrg';
import { orgWords } from './consoleView';
import { consoleIsReadOnly, readOnlyNote } from './billingView';

// PLANS: the meal plans a gym gives its members (ROADMAP Stage 2 24a-i; spec Part 6 §16.6). The
// list of the gym's plans, and one plan written a day at a time as the phone's own meal plan
// is. `plans.manage`'s; the server refuses anyone else whatever this screen shows.

const newId = () => globalThis.crypto.randomUUID();
const REFUSED = 'Only the owner, and staff the owner has given Write meal plans on the Staff page, can open Plans.';

function Notice({ notice, error }) {
  return (
    <>
      {notice !== null ? (
        <p className="c-s14 c-w6" role="status" style={{ color: 'var(--good)' }}>
          {notice}
        </p>
      ) : null}
      {error !== null ? (
        <p className="c-s14" role="alert" style={{ color: 'var(--bad)' }}>
          {error}
        </p>
      ) : null}
    </>
  );
}

function Page({ children }) {
  return <div className="c-page">{children}</div>;
}

/** Read again when staff come back to the window: another member of staff may have changed it. */
function useReadOnReturn(load) {
  useEffect(() => {
    load();
    const shown = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', shown);
    return () => document.removeEventListener('visibilitychange', shown);
  }, [load]);
}

function NewPlanBox({ gymId, onMade, onClose }) {
  const [name, setName] = useState('');
  const [id] = useState(newId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const create = async () => {
    if (name.trim() === '') {
      setError('Give the plan a name.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onMade(await mealPlansService.create(gymId, id, name.trim()));
    } catch (err) {
      setError(errorText(err, "We couldn't make this plan. Please try again."));
      setSaving(false);
    }
  };
  return (
    <section className="c-card p-5 flex flex-col gap-3" data-testid="new-plan">
      <h2 className="c-s16 c-w6 c-t1">New meal plan</h2>
      <Field label="Name">
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          maxLength={GYM_MEAL_PLAN_NAME_MAX}
          disabled={saving}
          className="c-input"
          placeholder="Lean week"
        />
      </Field>
      <Notice notice={null} error={error} />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={create} disabled={saving} className="c-btn c-btn-p">
          {saving ? 'Making…' : 'Make plan'}
        </button>
        <button type="button" onClick={onClose} disabled={saving} className="c-btn c-btn-quiet">
          Cancel
        </button>
      </div>
    </section>
  );
}

function PlanList({ org, gymId, readOnly, words, notice: startNotice }) {
  const { orgSlug } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, error: null, refused: false, plans: null });
  const [adding, setAdding] = useState(false);
  const load = useCallback(
    () =>
      mealPlansService.list(gymId).then(
        (list) => setState({ loading: false, error: null, refused: false, plans: list.plans }),
        (err) => setState((s) => ({ loading: false, error: errorText(err, "We couldn't load your meal plans."), refused: errorStatus(err) === 403, plans: s.plans })),
      ),
    [gymId],
  );
  useReadOnReturn(load);
  const plans = state.plans;

  return (
    <Page>
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between min-w-0">
        <div className="flex flex-col gap-1.5 min-w-0">
          <h1 className="c-h1">Plans</h1>
          <p className="c-sub">{PLAN_WORDS.pageSub(words)}</p>
        </div>
        {!readOnly && !state.refused && plans !== null && !adding ? (
          <button type="button" onClick={() => setAdding(true)} className="c-btn c-btn-p self-start md:self-auto">
            <Plus aria-hidden="true" className="w-[18px] h-[18px]" />
            New meal plan
          </button>
        ) : null}
      </header>
      {readOnly && !state.refused ? (
        <section className="c-card p-5 md:p-6">
          <p className="c-s15 c-t2">{readOnlyNote(org?.orgType)}</p>
        </section>
      ) : null}
      {state.refused ? (
        <section className="c-card p-5 md:p-6">
          <p className="c-s15 c-t2">{REFUSED}</p>
        </section>
      ) : (
        <>
          {adding ? (
            <NewPlanBox
              gymId={gymId}
              onClose={() => setAdding(false)}
              onMade={(plan) => navigate(`/console/${orgSlug}/plans/${plan.id}`, { state: { notice: PLAN_WORDS.created(plan.name) } })}
            />
          ) : null}
          <Notice notice={startNotice} error={null} />
          {state.loading ? <ConsoleLoading label="Loading your meal plans…" newLook /> : null}
          {!state.loading && plans === null ? <ConsoleFailed message={state.error} onRetry={load} newLook /> : null}
          {plans !== null && plans.length === 0 && !adding ? (
            <section className="c-card p-5 md:p-6">
              <p className="c-s15 c-t2">{readOnly ? 'No meal plans yet.' : PLAN_WORDS.none}</p>
            </section>
          ) : null}
          {plans !== null && plans.length > 0 ? (
            <section className="flex flex-col gap-3" aria-label="Meal plans">
              <h2 className="c-s15 c-w6 c-t1">{`Meal plans (${String(plans.length)})`}</h2>
              <ul className="flex flex-col gap-3">
                {plans.map((p) => (
                  <li key={p.id} className="c-card p-4 md:p-5 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <Link to={`/console/${orgSlug}/plans/${p.id}`} className="c-s16 c-w6 c-lk">
                        {p.name}
                      </Link>
                      <p className="c-s13 c-t2">{`${mealsLine(p.meals)} · ${byLine(p, org.timezone)}`}</p>
                    </div>
                    <Link to={`/console/${orgSlug}/plans/${p.id}`} className="c-btn c-btn-s c-btn-sm self-start md:self-auto">
                      Open
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </Page>
  );
}

function MealCard({ meal, at, dayName, readOnly, busy, onChange, onRemove, asking, onAsk }) {
  const name = mealTypeName(meal.mealType);
  return (
    <li className="c-card p-4 md:p-5 flex flex-col gap-3">
      <div className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h3 className="c-s16 c-w6 c-t1">{name}</h3>
          <p className="c-s13 c-t2">{numbersLine(mealNumbers(meal.totals))}</p>
        </div>
        {!readOnly ? (
          <div className="flex gap-2">
            <button type="button" onClick={() => onChange(at)} disabled={busy} className="c-btn c-btn-s c-btn-sm" aria-label={`Change ${name}`}>
              Change
            </button>
            <button type="button" onClick={() => onAsk(at)} disabled={busy} className="c-btn c-btn-quiet c-btn-sm" aria-label={`Remove ${name}`}>
              Remove
            </button>
          </div>
        ) : null}
      </div>
      <ul className="flex flex-col">
        {meal.items.map((item, i) => (
          <li key={`${item.canonical}-${String(i)}`} className="c-row flex items-baseline justify-between gap-3 py-2">
            <span className="c-s15 c-t1 min-w-0">{item.name}</span>
            <span className="c-s13 c-t2 flex-shrink-0">{`${itemAmount(item)} · ${String(item.kcalPoint)} kcal`}</span>
          </li>
        ))}
      </ul>
      {asking ? (
        <div className="c-callout flex flex-col gap-3" role="dialog" aria-label={`Remove ${name}?`}>
          <p className="c-s15 c-w6 c-t1">{`Remove ${name} from ${dayName}?`}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => onRemove(at)} disabled={busy} className="c-btn c-btn-danger c-btn-sm">
              Remove meal
            </button>
            <button type="button" onClick={() => onAsk(null)} disabled={busy} className="c-btn c-btn-quiet c-btn-sm">
              Keep it
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function PlanPage({ org, gymId, planId, readOnly, notice: startNotice }) {
  const { orgSlug } = useParams();
  const navigate = useNavigate();
  const listTo = `/console/${orgSlug}/plans`;
  const [state, setState] = useState({ loading: true, error: null, refused: false, gone: false, plan: null });
  const [dayAt, setDayAt] = useState(0);
  /** What is open: `{ kind: 'meal', at }` (at null: a new meal, with `mealType`), `{ kind: 'pick' }`, `{ kind: 'remove', at }`, `{ kind: 'rename' }`, `{ kind: 'delete' }`. */
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(startNotice);
  const [error, setError] = useState(null);
  const [name, setName] = useState('');

  const load = useCallback(
    () =>
      mealPlansService.get(gymId, planId).then(
        (plan) => setState({ loading: false, error: null, refused: false, gone: false, plan }),
        (err) =>
          setState((s) => ({
            loading: false,
            error: errorText(err, "We couldn't load this meal plan."),
            refused: errorStatus(err) === 403,
            gone: errorStatus(err) === 404,
            plan: errorStatus(err) === 404 ? null : s.plan,
          })),
      ),
    [gymId, planId],
  );
  useReadOnReturn(load);

  const plan = state.plan;
  if (state.refused) {
    return (
      <Page>
        <section className="c-card p-5 md:p-6">
          <p className="c-s15 c-t2">{REFUSED}</p>
        </section>
      </Page>
    );
  }
  if (state.gone) {
    return (
      <Page>
        <section className="c-card p-5 md:p-6 flex flex-col gap-3">
          <p className="c-s15 c-t2">{state.error}</p>
          <Link to={listTo} className="c-btn c-btn-s self-start">
            All meal plans
          </Link>
        </section>
      </Page>
    );
  }
  if (plan === null) {
    return <Page>{state.loading ? <ConsoleLoading label="Loading this meal plan…" newLook /> : <ConsoleFailed message={state.error} onRetry={load} newLook />}</Page>;
  }

  const day = plan.days[dayAt];
  const dayName = DAY_NAMES[dayAt];
  const say = (n, e = null) => {
    setNotice(n);
    setError(e);
  };
  const failed = async (err, fallback) => {
    say(null, errorText(err, fallback));
    // Changed or deleted by someone else meanwhile: show what is true now.
    if (errorCode(err) === 'plan_changed' || errorStatus(err) === 404) await load();
  };
  const saveDay = async (meals) => {
    const next = await mealPlansService.putDay(gymId, planId, day.day, { changeId: newId(), version: day.version, meals });
    setState((s) => ({ ...s, plan: next }));
  };
  const saveMeal = async (at, mealType, rows) => {
    try {
      await saveDay(dayMeals(day, at, mealType, rows));
    } catch (err) {
      if (errorCode(err) === 'plan_changed') await load();
      throw err;
    }
    setOpen(null);
    say(PLAN_WORDS.mealSaved(mealTypeName(mealType), dayName));
  };
  const removeMeal = async (at) => {
    const mealType = day.meals[at]?.mealType;
    setBusy(true);
    try {
      await saveDay(dayMeals(day, at, mealType, null));
      setOpen(null);
      say(PLAN_WORDS.mealRemoved(mealTypeName(mealType), dayName));
    } catch (err) {
      setOpen(null);
      await failed(err, "We couldn't remove this meal. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  const rename = async () => {
    setBusy(true);
    try {
      const next = await mealPlansService.rename(gymId, planId, name.trim());
      setState((s) => ({ ...s, plan: next }));
      setOpen(null);
      say(PLAN_WORDS.renamed);
    } catch (err) {
      await failed(err, "We couldn't save the name. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await mealPlansService.remove(gymId, planId);
      navigate(listTo, { state: { notice: PLAN_WORDS.deleted(plan.name) } });
    } catch (err) {
      setBusy(false);
      await failed(err, "We couldn't delete this plan. Please try again.");
    }
  };
  const openMeal = (at) => {
    say(null);
    setOpen({ kind: 'meal', at, mealType: day.meals[at].mealType, start: day.meals[at].items.map((i) => rowOfItem(i, null)) });
  };
  const box = (at, mealType, start) => (
    <MealPlanMealBox
      key={`${String(dayAt)}-${String(at)}-${mealType}`}
      gymId={gymId}
      planId={planId}
      day={day.day}
      dayName={dayName}
      at={at}
      mealType={mealType}
      start={start}
      onSave={(rows) => saveMeal(at, mealType, rows)}
      onClose={() => setOpen(null)}
    />
  );
  const full = day.meals.length >= MOST_PLAN_MEALS;

  return (
    <Page>
      <Link to={listTo} className="c-s14 c-w6 c-lk inline-flex items-center gap-1 self-start">
        <ChevronLeft aria-hidden="true" className="w-4 h-4" />
        All meal plans
      </Link>
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between min-w-0">
        <div className="flex flex-col gap-1.5 min-w-0">
          <h1 className="c-h1">{plan.name}</h1>
          <p className="c-sub">{`${mealsLine(plan.meals)} · ${byLine(plan, org.timezone)}`}</p>
        </div>
        {!readOnly ? (
          <div className="flex gap-2 self-start md:self-auto">
            <button
              type="button"
              onClick={() => {
                say(null);
                setName(plan.name);
                setOpen({ kind: 'rename' });
              }}
              className="c-btn c-btn-s c-btn-sm"
            >
              <Pencil aria-hidden="true" className="w-4 h-4" />
              Rename
            </button>
            <button
              type="button"
              onClick={() => {
                say(null);
                setOpen({ kind: 'delete' });
              }}
              className="c-btn c-btn-quiet c-btn-sm"
            >
              <Trash2 aria-hidden="true" className="w-4 h-4" />
              Delete
            </button>
          </div>
        ) : null}
      </header>

      {open?.kind === 'rename' ? (
        <section className="c-card p-5 flex flex-col gap-3">
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={GYM_MEAL_PLAN_NAME_MAX} disabled={busy} className="c-input" />
          </Field>
          <Notice notice={null} error={error} />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={rename} disabled={busy || name.trim() === ''} className="c-btn c-btn-p">
              Save name
            </button>
            <button type="button" onClick={() => setOpen(null)} disabled={busy} className="c-btn c-btn-quiet">
              Cancel
            </button>
          </div>
        </section>
      ) : null}
      {open?.kind === 'delete' ? (
        <section className="c-card p-5 flex flex-col gap-3" role="dialog" aria-label={PLAN_WORDS.deleteAsk(plan.name)}>
          <h2 className="c-s16 c-w6 c-t1">{PLAN_WORDS.deleteAsk(plan.name)}</h2>
          <p className="c-s14 c-t2">{PLAN_WORDS.deleteWhy}</p>
          <Notice notice={null} error={error} />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={remove} disabled={busy} className="c-btn c-btn-danger">
              Delete plan
            </button>
            <button type="button" onClick={() => setOpen(null)} disabled={busy} className="c-btn c-btn-quiet">
              Keep it
            </button>
          </div>
        </section>
      ) : null}

      <p className="c-s13 c-t2">{plan.caution}</p>

      <div className="c-utabs" role="tablist" aria-label="Day of the week">
        {DAY_SHORT.map((short, i) => (
          <button
            key={short}
            type="button"
            role="tab"
            aria-selected={dayAt === i}
            aria-label={DAY_NAMES[i]}
            onClick={() => {
              setDayAt(i);
              setOpen((o) => (o?.kind === 'rename' || o?.kind === 'delete' ? o : null));
              say(null);
            }}
            className={dayAt === i ? 'c-utab c-utab-on' : 'c-utab'}
          >
            {short}
          </button>
        ))}
      </div>

      <section className="flex flex-col gap-3" aria-label={dayName}>
        <div className="flex flex-col gap-1">
          <h2 className="c-h2">{dayName}</h2>
          <p className="c-s14 c-t2">{day.meals.length === 0 ? PLAN_WORDS.dayEmpty(dayName) : numbersLine(day.planned)}</p>
        </div>
        {open?.kind === 'meal' || open?.kind === 'pick' || open?.kind === 'remove' || open === null ? <Notice notice={notice} error={error} /> : null}
        {day.meals.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {day.meals.map((meal, at) =>
              open?.kind === 'meal' && open.at === at ? (
                <li key={`${meal.mealType}-${String(at)}`}>{box(at, open.mealType, open.start)}</li>
              ) : (
                <MealCard
                  key={`${meal.mealType}-${String(at)}`}
                  meal={meal}
                  at={at}
                  dayName={dayName}
                  readOnly={readOnly}
                  busy={busy}
                  asking={open?.kind === 'remove' && open.at === at}
                  onAsk={(i) => {
                    say(null);
                    setOpen(i === null ? null : { kind: 'remove', at: i });
                  }}
                  onChange={openMeal}
                  onRemove={removeMeal}
                />
              ),
            )}
          </ul>
        ) : null}

        {!readOnly && open?.kind === 'meal' && open.at === null ? box(null, open.mealType, []) : null}
        {!readOnly && open?.kind === 'pick' ? (
          <div className="c-card p-5 flex flex-col gap-3" data-testid="pick-meal">
            <h3 className="c-s16 c-w6 c-t1">{`Add a meal to ${dayName}`}</h3>
            <div className="flex flex-wrap gap-2">
              {MEAL_TYPES.map((m) => (
                <button key={m.type} type="button" onClick={() => setOpen({ kind: 'meal', at: null, mealType: m.type })} className="c-btn c-btn-s">
                  {m.name}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setOpen(null)} className="c-btn c-btn-quiet self-start">
              Cancel
            </button>
          </div>
        ) : null}
        {!readOnly && (open === null || open.kind === 'remove' || open.kind === 'rename' || open.kind === 'delete') ? (
          full ? (
            <p className="c-s14 c-t2">{PLAN_WORDS.dayFull}</p>
          ) : (
            <button
              type="button"
              onClick={() => {
                say(null);
                setOpen({ kind: 'pick' });
              }}
              className="c-btn c-btn-soft self-start"
            >
              <Plus aria-hidden="true" className="w-[18px] h-[18px]" />
              Add a meal
            </button>
          )
        ) : null}
      </section>
    </Page>
  );
}

export default function MealPlans() {
  const { orgSlug, planId } = useParams();
  const notice = useLocation().state?.notice ?? null;
  const { loading, error, org, notFound, reload } = useConsoleOrg(orgSlug);
  const words = orgWords(org?.orgType);
  const readOnly = consoleIsReadOnly(org);
  if (loading) {
    return (
      <Page>
        <ConsoleLoading label="Loading your organisation…" newLook />
      </Page>
    );
  }
  if (error !== null) {
    return (
      <Page>
        <ConsoleFailed message={error} onRetry={reload} newLook />
      </Page>
    );
  }
  if (notFound) {
    return (
      <Page>
        <section className="c-card p-5 md:p-6 flex flex-col gap-3">
          <p className="c-s15 c-t2">We couldn&apos;t find an organisation you run at this address.</p>
          <Link to="/console" className="c-s15 c-w6 c-lk self-start">
            Your organisations
          </Link>
        </section>
      </Page>
    );
  }
  return planId === undefined ? (
    <PlanList key="list" org={org} gymId={org.id} readOnly={readOnly} words={words} notice={notice} />
  ) : (
    <PlanPage key={planId} org={org} gymId={org.id} planId={planId} readOnly={readOnly} notice={notice} />
  );
}
