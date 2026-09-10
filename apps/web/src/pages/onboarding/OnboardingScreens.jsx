// Onboarding v2, screens 1–7 (RULINGS 2026-09-07 and 2026-09-09). Every tap
// saves at once through `save`; the typed boxes (age, height, weight, target)
// save when the person leaves them, through `typed`. Nothing here decides a
// number: the plan panel shows the server's.
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { EQUIPMENT_ICONS, GOAL_ICONS, LEVEL_ICONS } from './onboardingIcons';
import {
  DAYS,
  EQUIPMENT,
  GENDERS,
  GOALS,
  LEVELS,
  PACES,
  SESSION_MINUTES,
  TRAINING_DAYS,
  cleanEquipment,
  paceText,
  toggleEquipment,
} from './onboardingModel';

function Choice({ selected, onSelect, icon: Icon, label, desc }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`flex items-center gap-3 p-4 rounded-2xl border-2 transition-all duration-200 text-left w-full
                 ${selected ? 'border-primary-500 bg-primary-500/10' : 'border-white/10 bg-dark-100 hover:border-white/20'}`}
    >
      {Icon && (
        <span
          aria-hidden="true"
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all"
          style={
            selected
              ? { background: 'linear-gradient(135deg, #FF8A1F, #FFB347)', boxShadow: '0 4px 14px rgba(255,138,31,0.35)' }
              : { background: 'rgba(255,138,31,0.08)', border: '1px solid rgba(255,138,31,0.25)' }
          }
        >
          <Icon className="w-5 h-5" strokeWidth={1.75} style={{ color: selected ? '#FFFFFF' : '#FFB347' }} />
        </span>
      )}
      <span className="flex-1 min-w-0">
        <span className={`block font-medium text-sm ${selected ? 'text-white' : 'text-gray-300'}`}>{label}</span>
        {desc && <span className="block text-gray-500 text-xs mt-0.5">{desc}</span>}
      </span>
      {selected && (
        <span className="w-5 h-5 bg-primary-500 rounded-full flex items-center justify-center flex-shrink-0">
          <Check className="w-3 h-3 text-white" />
        </span>
      )}
    </button>
  );
}

const Question = ({ children }) => <p className="text-sm font-semibold text-white mb-3">{children}</p>;

const Unit = ({ children }) => (
  <span className="bg-dark-100 border border-white/10 rounded-xl px-4 flex items-center text-gray-400 text-sm flex-shrink-0">
    {children}
  </span>
);

const FieldError = ({ children }) =>
  children ? (
    <p role="alert" className="text-2xs mt-1" style={{ color: '#f87171' }}>
      {children}
    </p>
  ) : null;

/** Big and first on the screen (Kd, 2026-09-10): the switch decides what
 *  every box below it means, so it must be seen before anything is typed. */
function UnitSwitch({ units, onChange }) {
  const options = [
    ['metric', 'kg · cm', 'Kilograms and centimetres'],
    ['imperial', 'lb · ft', 'Pounds, feet and inches'],
  ];
  return (
    <div>
      <Question>Units</Question>
      <div role="group" aria-label="Units" className="grid grid-cols-2 gap-3">
        {options.map(([value, label, desc]) => (
          <button
            key={`units-${value}`}
            type="button"
            aria-pressed={units === value}
            onClick={() => onChange(value)}
            className={`p-4 rounded-2xl border-2 text-left transition-all duration-200
                       ${units === value ? 'border-primary-500 bg-primary-500/10' : 'border-white/10 bg-dark-100 hover:border-white/20'}`}
          >
            <span className={`block text-lg font-bold ${units === value ? 'text-white' : 'text-gray-300'}`}>{label}</span>
            <span className="block text-gray-500 text-xs mt-0.5">{desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** One typed box. It saves when the person leaves it, not on every key. */
function TypedField({ id, name, label, hint, unit, placeholder, typed, inputMode = 'decimal' }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm mb-2">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          type="text"
          inputMode={inputMode}
          autoComplete="off"
          className="input-field flex-1"
          placeholder={placeholder}
          value={typed.text(name)}
          onChange={(e) => typed.change(name, e.target.value)}
          onBlur={() => typed.commit(name)}
        />
        <Unit>{unit}</Unit>
      </div>
      {hint && <p className="text-gray-500 text-xs mt-1">{hint}</p>}
      <FieldError>{typed.error(name)}</FieldError>
    </div>
  );
}

/** Height: one box in centimetres, or feet and inches. The pair saves once,
 *  when focus leaves the pair — not between the two boxes, which would store
 *  "5 ft 0 in" for a moment. */
function HeightField({ typed }) {
  const parts = typed.text('height');
  const set = (key, value) => typed.change('height', { ...parts, [key]: value });
  const leave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) typed.commit('height');
  };
  const box = (key, label, placeholder) => (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      aria-label={label}
      className="input-field flex-1"
      placeholder={placeholder}
      value={parts[key]}
      onChange={(e) => set(key, e.target.value)}
    />
  );
  return (
    <div onBlur={leave}>
      <p className="block text-sm mb-2">Height</p>
      {typed.units === 'imperial' ? (
        <div className="flex gap-2">
          {box('ft', 'Height in feet', '5')}
          <Unit>ft</Unit>
          {box('inch', 'Height in inches', '9')}
          <Unit>in</Unit>
        </div>
      ) : (
        <div className="flex gap-2">
          {box('cm', 'Height in centimetres', '170')}
          <Unit>cm</Unit>
        </div>
      )}
      <FieldError>{typed.error('height')}</FieldError>
    </div>
  );
}

// ── Screen 1 ────────────────────────────────────────────────────────────────
export function GoalScreen({ answers, save }) {
  return (
    <div className="space-y-3">
      <Question>What is your main goal?</Question>
      <p className="text-gray-400 text-xs">Pick one. You can change it later.</p>
      {GOALS.map((g) => (
        <Choice
          key={`goal-${g.value}`}
          selected={answers.mainGoal === g.value}
          onSelect={() => answers.mainGoal !== g.value && save({ mainGoal: g.value })}
          icon={GOAL_ICONS[g.value]}
          label={g.label}
        />
      ))}
    </div>
  );
}

// ── Screen 2 ────────────────────────────────────────────────────────────────
export function AboutScreen({ answers, save, typed }) {
  const weightUnit = typed.units === 'imperial' ? 'lb' : 'kg';
  return (
    <div className="space-y-5">
      <UnitSwitch units={typed.units} onChange={typed.setUnits} />
      <TypedField id="ob-age" name="age" label="Age" unit="years" placeholder="30" inputMode="numeric" typed={typed} />
      <div>
        <Question>Gender</Question>
        <p className="text-gray-500 text-xs -mt-2 mb-3">Used to estimate how much energy your body burns.</p>
        <div className="grid grid-cols-2 gap-3">
          {GENDERS.map((g) => (
            <Choice
              key={`gender-${g.value}`}
              selected={answers.gender === g.value}
              onSelect={() => answers.gender !== g.value && save({ gender: g.value })}
              label={g.label}
            />
          ))}
        </div>
      </div>
      <HeightField typed={typed} />
      <TypedField
        id="ob-weight"
        name="weight"
        label="Weight"
        hint="Saved in your weigh-in history."
        unit={weightUnit}
        placeholder={weightUnit === 'lb' ? '154' : '70'}
        typed={typed}
      />
    </div>
  );
}

// ── Screen 3 (only for a goal that moves the weight) ────────────────────────
export function TargetScreen({ answers, save, typed, direction }) {
  const weightUnit = typed.units === 'imperial' ? 'lb' : 'kg';
  const verb = direction === 'gain' ? 'Gain' : 'Lose';
  return (
    <div className="space-y-5">
      <UnitSwitch units={typed.units} onChange={typed.setUnits} />
      <TypedField
        id="ob-target"
        name="target"
        label="Target weight"
        hint={direction === 'gain' ? 'The weight you want to build up to.' : 'The weight you want to reach.'}
        unit={weightUnit}
        placeholder={weightUnit === 'lb' ? '143' : '65'}
        typed={typed}
      />
      <div>
        <Question>How fast?</Question>
        <div className="space-y-3">
          {PACES.map((p) => (
            <Choice
              key={`pace-${p.value}`}
              selected={answers.pace === p.value}
              onSelect={() => answers.pace !== p.value && save({ pace: p.value })}
              label={p.label}
              desc={`${verb} ${paceText(p.value, typed.units)}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Screen 4 ────────────────────────────────────────────────────────────────
export function DayScreen({ answers, save }) {
  return (
    <div className="space-y-3">
      <Question>What does a normal day look like, not counting workouts?</Question>
      {DAYS.map((d) => (
        <Choice
          key={`day-${d.value}`}
          selected={answers.dayActivity === d.value}
          onSelect={() => answers.dayActivity !== d.value && save({ dayActivity: d.value })}
          label={d.label}
          desc={d.desc}
        />
      ))}
    </div>
  );
}

// ── Screen 5 ────────────────────────────────────────────────────────────────
function Stepper({ label, value, unit, small, big, max, onChange }) {
  const from = value ?? 0;
  const set = (n) => onChange(Math.min(max, Math.max(0, n)));
  const steps = [-big, -small, small, big];
  return (
    <div>
      <p className="text-sm mb-2">{label}</p>
      <div className="flex items-center gap-2">
        {steps.slice(0, 2).map((s) => (
          <button key={`${unit}-${s}`} type="button" aria-label={`${unit}: minus ${-s}`} onClick={() => set(from + s)} className="btn-secondary px-3">
            −{-s}
          </button>
        ))}
        <span aria-live="polite" className="flex-1 text-center text-white font-semibold tabular-nums">
          {value === null ? 'Not done' : `${value} ${unit}`}
        </span>
        {steps.slice(2).map((s) => (
          <button key={`${unit}-${s}`} type="button" aria-label={`${unit}: plus ${s}`} onClick={() => set(from + s)} className="btn-secondary px-3">
            +{s}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A stopwatch for the plank: press, hold the plank, press again. */
function PlankTimer({ onStop }) {
  const [startedAt, setStartedAt] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (startedAt === null) return undefined;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 250);
    return () => clearInterval(id);
  }, [startedAt]);
  if (startedAt === null) {
    return (
      <button
        type="button"
        onClick={() => {
          setElapsed(0);
          setStartedAt(Date.now());
        }}
        className="text-xs font-semibold mt-2"
        style={{ color: '#FF8A1F' }}
      >
        Time my plank
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        const seconds = Math.floor((Date.now() - startedAt) / 1000);
        setStartedAt(null);
        onStop(seconds);
      }}
      className="btn-primary mt-2"
    >
      Stop · {elapsed} s
    </button>
  );
}

export function TrainingScreen({ answers, save }) {
  const [checksOpen, setChecksOpen] = useState(true);
  const skip = () => {
    const clear = {};
    if (answers.pushUpsMax !== null) clear.pushUpsMax = null;
    if (answers.plankHoldSeconds !== null) clear.plankHoldSeconds = null;
    if (Object.keys(clear).length > 0) save(clear);
    setChecksOpen(false);
  };
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Question>How fit do you feel right now?</Question>
        {LEVELS.map((l) => (
          <Choice
            key={`level-${l.value}`}
            selected={answers.fitnessLevel === l.value}
            onSelect={() => answers.fitnessLevel !== l.value && save({ fitnessLevel: l.value })}
            icon={LEVEL_ICONS[l.value]}
            label={l.label}
            desc={l.desc}
          />
        ))}
      </div>
      <div className="card-glass space-y-4">
        <p className="text-sm font-semibold text-white">Two quick checks</p>
        {checksOpen ? (
          <>
            <p className="text-gray-400 text-xs">Used to set your first week&apos;s workouts. Do them now if you can, or skip them.</p>
            <Stepper
              label="Push-ups in a row, with good form"
              value={answers.pushUpsMax}
              unit="push-ups"
              small={1}
              big={5}
              max={500}
              onChange={(n) => save({ pushUpsMax: n })}
            />
            <div>
              <Stepper
                label="Longest plank hold"
                value={answers.plankHoldSeconds}
                unit="seconds"
                small={5}
                big={30}
                max={3600}
                onChange={(n) => save({ plankHoldSeconds: n })}
              />
              <PlankTimer onStop={(s) => save({ plankHoldSeconds: Math.min(3600, s) })} />
            </div>
            <button type="button" onClick={skip} className="text-xs underline text-gray-400">
              Skip these, I&apos;ll rate myself
            </button>
          </>
        ) : (
          <p className="text-gray-400 text-xs">
            Skipped. Your rating above is enough.{' '}
            <button type="button" onClick={() => setChecksOpen(true)} className="underline">
              Do the checks
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

// ── Screen 6 ────────────────────────────────────────────────────────────────
export function WeekScreen({ answers, save }) {
  // A length the old Settings slider stored (75, 105, 120 minutes) is shown
  // among the choices, so a stored answer is never on screen as "none picked".
  const lengths = [...new Set([...SESSION_MINUTES, answers.sessionMinutes])]
    .filter((m) => typeof m === 'number')
    .sort((a, b) => a - b);
  const pill = (pressed) =>
    `py-3 rounded-xl border-2 font-bold transition-all text-sm ${
      pressed ? 'border-primary-500 bg-primary-500/10 text-white' : 'border-white/10 bg-dark-100 text-gray-400 hover:border-white/20'
    }`;
  return (
    <div className="space-y-6">
      <div>
        <Question>How many days a week can you train?</Question>
        <div className="flex gap-2">
          {TRAINING_DAYS.map((n) => (
            <button
              key={`days-${n}`}
              type="button"
              aria-pressed={answers.trainingDays === n}
              aria-label={`${n} ${n === 1 ? 'day' : 'days'} a week`}
              onClick={() => answers.trainingDays !== n && save({ trainingDays: n })}
              className={`flex-1 ${pill(answers.trainingDays === n)}`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      <div>
        <Question>How long is one session?</Question>
        <div className="grid grid-cols-3 gap-2">
          {lengths.map((m) => (
            <button
              key={`minutes-${m}`}
              type="button"
              aria-pressed={answers.sessionMinutes === m}
              onClick={() => answers.sessionMinutes !== m && save({ sessionMinutes: m })}
              className={pill(answers.sessionMinutes === m)}
            >
              {m} min
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Screen 7 ────────────────────────────────────────────────────────────────
export function EquipmentScreen({ answers, save }) {
  const shown = cleanEquipment(answers.availableEquipment);
  return (
    <div className="space-y-3">
      <Question>What do you have to train with?</Question>
      <p className="text-gray-400 text-xs">Pick all that apply, or No equipment.</p>
      {EQUIPMENT.map((e) => (
        <Choice
          key={`equipment-${e.value}`}
          selected={shown.includes(e.value)}
          onSelect={() => save({ availableEquipment: toggleEquipment(shown, e.value) })}
          icon={EQUIPMENT_ICONS[e.value]}
          label={e.label}
        />
      ))}
    </div>
  );
}
