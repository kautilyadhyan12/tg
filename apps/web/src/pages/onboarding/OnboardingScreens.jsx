// Onboarding v2, screens 1–7 (RULINGS 2026-09-07, 2026-09-09 and 2026-09-10).
// Every tap and every wheel saves at once through `save`; the one typed box,
// the name, saves when the person leaves it. Nothing here decides a number:
// the plan panel shows the server's.
import { useState } from 'react';
import { Check } from 'lucide-react';
import { patchOnboardingRequestSchema } from '@app/shared';
import NumberWheel from './NumberWheel';
import { EQUIPMENT_ICONS, GOAL_ICONS, LEVEL_ICONS } from './onboardingIcons';
import {
  AGE_REST,
  DAYS,
  EQUIPMENT,
  GENDERS,
  GOALS,
  HEIGHT_REST,
  INCHES,
  LEVELS,
  PACES,
  PLANK_REST,
  PUSH_UPS_REST,
  SESSION_MINUTES,
  TENTHS,
  TRAINING_DAYS,
  WEIGHT_REST,
  ageList,
  clampTarget,
  cleanEquipment,
  cmFromParts,
  heightCmList,
  heightFeetList,
  heightParts,
  heightShown,
  kgFromParts,
  paceText,
  plankList,
  plankShown,
  pushUpList,
  pushUpShown,
  stepIn,
  stepInches,
  targetRest,
  targetRow,
  targetTenths,
  targetWholes,
  targetWrongSide,
  toggleEquipment,
  weightParts,
  weightShown,
  weightWholes,
} from './onboardingModel';

/** Whether the server takes this one answer. A wheel never saves a number the
 *  contract refuses: a list stretched to reach an odd stored answer can hold
 *  rows past the rails. */
const takes = (patch) => patchOnboardingRequestSchema.safeParse(patch).success;

/** A pick of the rows already on show is not a new answer, and saves nothing.
 *  Compared as rows, never as kilograms: 70 kg reads 154.3 lb, and 154.3 lb
 *  back is 69.99 kg, so re-picking it would write a weigh-in the person never
 *  made (RULINGS 2026-09-10). */
const sameRows = (a, b) => a.whole === b.whole && a.tenth === b.tenth;

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

const FieldError = ({ children }) =>
  children ? (
    <p role="alert" className="text-2xs mt-1" style={{ color: '#f87171' }}>
      {children}
    </p>
  ) : null;

/** Big, and first among the numbers (Kd, 2026-09-10): the switch decides what
 *  every wheel below it means. */
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

// ── The wheels ──────────────────────────────────────────────────────────────

function AgeWheel({ age, save }) {
  const list = ageList(age);
  const at = age ?? AGE_REST;
  const pick = (v) => {
    if (v !== age && takes({ age: v })) save({ age: v });
  };
  return (
    <NumberWheel
      id="ob-age"
      question="Age"
      shown={age === null ? 'Not set' : `${age} years`}
      isSet={age !== null}
      unit="years"
      stepLabel="Age"
      onStep={(by) => pick(stepIn(list, at, by))}
      columns={[{ label: 'Age', values: list, index: list.indexOf(at), format: String, onPick: (i) => pick(list[i]) }]}
    />
  );
}

function HeightWheel({ cm, units, save }) {
  const isSet = cm !== null;
  const set = (value) => {
    if (value !== cm && takes({ heightCm: value })) save({ heightCm: value });
  };
  if (units === 'imperial') {
    const parts = isSet ? heightParts(cm, 'imperial') : HEIGHT_REST.imperial;
    const feet = heightFeetList(parts.ft);
    // The rows on show are the answer already stored (175 cm reads 5 ft 9 in,
    // and 5 ft 9 in back is 175.26 cm): picked again, they save nothing.
    const pick = (next) => {
      if (isSet && next.ft === parts.ft && next.inch === parts.inch) return;
      set(cmFromParts(next, 'imperial'));
    };
    return (
      <NumberWheel
        id="ob-height"
        question="Height"
        shown={isSet ? heightShown(parts, 'imperial') : 'Not set'}
        isSet={isSet}
        stepLabel="Height"
        onStep={(by) => pick(stepInches(parts, by))}
        columns={[
          {
            label: 'Height, feet',
            values: feet,
            index: feet.indexOf(parts.ft),
            format: (v) => `${v} ft`,
            onPick: (i) => pick({ ft: feet[i], inch: parts.inch }),
          },
          {
            label: 'Height, inches',
            values: INCHES,
            index: parts.inch,
            format: (v) => `${v} in`,
            onPick: (i) => pick({ ft: parts.ft, inch: INCHES[i] }),
          },
        ]}
      />
    );
  }
  const at = isSet ? heightParts(cm, 'metric').cm : HEIGHT_REST.metric.cm;
  const list = heightCmList(at);
  // As above: 5 ft 9 in is stored as 175.26 cm and reads 175.
  const pick = (value) => {
    if (!(isSet && value === at)) set(value);
  };
  return (
    <NumberWheel
      id="ob-height"
      question="Height"
      shown={isSet ? heightShown({ cm: at }, 'metric') : 'Not set'}
      isSet={isSet}
      unit="cm"
      stepLabel="Height"
      onStep={(by) => pick(stepIn(list, at, by))}
      columns={[
        { label: 'Height in centimetres', values: list, index: list.indexOf(at), format: String, onPick: (i) => pick(list[i]) },
      ]}
    />
  );
}

/** A weight on two columns, whole kilos or pounds and tenths. `at` is the row
 *  pair on show; `wholes` and `tenths` are the rows offered; `onPick` gets the
 *  pair picked, in parts. */
function WeightWheel({ id, question, shown, isSet, at, wholes, tenths, units, onPick }) {
  const unitWord = units === 'imperial' ? 'pound' : 'kilogram';
  return (
    <NumberWheel
      id={id}
      question={question}
      shown={shown}
      isSet={isSet}
      unit={units === 'imperial' ? 'lb' : 'kg'}
      stepLabel={question}
      onStep={(by) => onPick({ whole: stepIn(wholes, at.whole, by), tenth: at.tenth })}
      columns={[
        {
          label: `${question} in whole ${unitWord}s`,
          values: wholes,
          index: wholes.indexOf(at.whole),
          format: String,
          onPick: (i) => onPick({ whole: wholes[i], tenth: at.tenth }),
        },
        {
          label: `${question}, tenths of a ${unitWord}`,
          values: tenths,
          index: tenths.indexOf(at.tenth),
          format: (v) => `.${v}`,
          onPick: (i) => onPick({ whole: at.whole, tenth: tenths[i] }),
        },
      ]}
    />
  );
}

/** Screen 3's wheel (Kd, 2026-09-11): only weights on the goal's side of the
 *  current weight are on it, so a contradiction cannot be picked. A stored
 *  target already on the wrong side is named, and the screen waits. */
function TargetWheel({ target, weightKg, direction, units, save }) {
  const weight = weightParts(weightKg, units);
  const wrong = targetWrongSide(direction, target, weightKg);
  // A wrong-side target is on no row of the wheel, so the wheel rests and
  // reads "Not set" while the error under it names the target.
  const isSet = target !== null && !wrong;
  const at = isSet ? targetRow(direction, weight, target, units) : targetRest(direction, weight);
  const wholes = targetWholes(units, direction, weight, at);
  const pick = (parts) => {
    const row = clampTarget(direction, weight, parts);
    if (isSet && sameRows(row, at)) return;
    const kg = kgFromParts(row, units);
    // The rows offered are all on the right side; this is the belt with the braces.
    if (targetWrongSide(direction, kg, weightKg)) return;
    if (kg !== target && takes({ targetWeightKg: kg })) save({ targetWeightKg: kg });
  };
  const side = direction === 'gain' ? 'above' : 'below';
  return (
    <div>
      <WeightWheel
        id="ob-target"
        question="Target weight"
        shown={target === null ? 'Not set' : weightShown(isSet ? at : weightParts(target, units), units)}
        isSet={isSet}
        at={at}
        wholes={wholes}
        tenths={targetTenths(direction, weight, at.whole)}
        units={units}
        onPick={pick}
      />
      {wrong ? (
        <FieldError>
          {`${weightShown(weightParts(target, units), units)} is not ${side} your current ${weightShown(weight, units)}. Pick a weight ${side} it.`}
        </FieldError>
      ) : (
        <p className="text-gray-500 text-xs mt-2">
          {direction === 'gain' ? 'The weight you want to build up to.' : 'The weight you want to reach.'} You weigh{' '}
          {weightShown(weight, units)}.
        </p>
      )}
    </div>
  );
}

function NotSure({ label, pressed, onClick }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={`mt-3 px-4 py-2 rounded-xl border-2 text-sm font-semibold transition-all ${
        pressed ? 'border-primary-500 bg-primary-500/10 text-white' : 'border-white/10 bg-dark-100 text-gray-400 hover:border-white/20'
      }`}
    >
      Not sure
    </button>
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
export function AboutScreen({ answers, save, units, setUnits, name }) {
  const weightKg = answers.weightKg ?? null;
  const weightSet = weightKg !== null;
  const weightAt = weightSet ? weightParts(weightKg, units) : { whole: WEIGHT_REST[units], tenth: 0 };
  return (
    <div className="space-y-6">
      {/* The one typed box (Kd, 2026-09-10): it opens the screen. */}
      <div>
        <label htmlFor="ob-name" className="block text-sm font-semibold text-white mb-2">
          What should we call you?
        </label>
        <input
          id="ob-name"
          type="text"
          autoComplete="given-name"
          maxLength={100}
          className="input-field w-full"
          value={name.text}
          onChange={(e) => name.change(e.target.value)}
          onBlur={name.commit}
        />
        <FieldError>{name.error}</FieldError>
      </div>
      <UnitSwitch units={units} onChange={setUnits} />
      <AgeWheel age={answers.age ?? null} save={save} />
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
      <HeightWheel cm={answers.heightCm ?? null} units={units} save={save} />
      <div>
        <WeightWheel
          id="ob-weight"
          question="Weight"
          shown={weightSet ? weightShown(weightAt, units) : 'Not set'}
          isSet={weightSet}
          at={weightAt}
          wholes={weightWholes(units, weightAt.whole)}
          tenths={TENTHS}
          units={units}
          onPick={(parts) => {
            if (weightSet && sameRows(parts, weightAt)) return;
            const kg = kgFromParts(parts, units);
            if (kg !== weightKg && takes({ weightKg: kg })) save({ weightKg: kg });
          }}
        />
        <p className="text-gray-500 text-xs mt-2">Saved in your weigh-in history.</p>
      </div>
    </div>
  );
}

// ── Screen 3 (only for a goal that moves the weight) ────────────────────────
export function TargetScreen({ answers, save, units, setUnits, direction }) {
  const target = answers.targetWeightKg ?? null;
  const weightKg = answers.weightKg ?? null;
  const verb = direction === 'gain' ? 'Gain' : 'Lose';
  return (
    <div className="space-y-6">
      <UnitSwitch units={units} onChange={setUnits} />
      {weightKg === null ? (
        // Screen 2 comes first and the step bar cannot pass it unanswered;
        // said plainly all the same, never a wheel with no side to keep to.
        <p className="text-sm text-gray-300">Set your weight on About you first.</p>
      ) : (
        <TargetWheel target={target} weightKg={weightKg} direction={direction} units={units} save={save} />
      )}
      <div>
        <Question>How fast?</Question>
        <div className="space-y-3">
          {PACES.map((p) => (
            <Choice
              key={`pace-${p.value}`}
              selected={answers.pace === p.value}
              onSelect={() => answers.pace !== p.value && save({ pace: p.value })}
              label={p.label}
              desc={`${verb} ${paceText(p.value, units)}`}
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
/** Two plain questions, a guess is fine, and "Not sure" for either (Kd,
 *  2026-09-10): no timer, no test. "Not sure" is this visit's word for an
 *  empty answer — the server keeps a number or nothing, so a later visit
 *  reads "Not set" again. */
export function TrainingScreen({ answers, save }) {
  const [unsure, setUnsure] = useState({ pushUpsMax: false, plankHoldSeconds: false });
  const pick = (key, value) => {
    setUnsure((u) => ({ ...u, [key]: false }));
    if (value !== answers[key] && takes({ [key]: value })) save({ [key]: value });
  };
  const notSure = (key) => {
    setUnsure((u) => ({ ...u, [key]: true }));
    if (answers[key] !== null && answers[key] !== undefined) save({ [key]: null });
  };
  const pushUps = answers.pushUpsMax ?? null;
  const plank = answers.plankHoldSeconds ?? null;
  const pushRows = pushUpList(pushUps);
  const plankRows = plankList(plank);
  const pushAt = pushUps ?? PUSH_UPS_REST;
  const plankAt = plank ?? PLANK_REST;
  const empty = (key) => (unsure[key] ? 'Not sure' : 'Not set');
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
      <p className="text-gray-400 text-xs">A guess is fine. Used to set your first week&apos;s workouts.</p>
      <div>
        <NumberWheel
          id="ob-push-ups"
          question="How many push-ups can you do in a row?"
          shown={pushUps === null ? empty('pushUpsMax') : pushUpShown(pushUps)}
          isSet={pushUps !== null}
          stepLabel="Push-ups"
          onStep={(by) => pick('pushUpsMax', stepIn(pushRows, pushAt, by))}
          columns={[
            {
              label: 'Push-ups in a row',
              values: pushRows,
              index: pushRows.indexOf(pushAt),
              format: String,
              onPick: (i) => pick('pushUpsMax', pushRows[i]),
            },
          ]}
        />
        <NotSure
          label="Not sure how many push-ups"
          pressed={pushUps === null && unsure.pushUpsMax}
          onClick={() => notSure('pushUpsMax')}
        />
      </div>
      <div>
        <NumberWheel
          id="ob-plank"
          question="How long can you hold a plank?"
          shown={plank === null ? empty('plankHoldSeconds') : plankShown(plank)}
          isSet={plank !== null}
          stepLabel="Plank"
          onStep={(by) => pick('plankHoldSeconds', stepIn(plankRows, plankAt, by))}
          columns={[
            {
              label: 'Plank hold',
              values: plankRows,
              index: plankRows.indexOf(plankAt),
              format: plankShown,
              onPick: (i) => pick('plankHoldSeconds', plankRows[i]),
            },
          ]}
        />
        <NotSure
          label="Not sure how long a plank"
          pressed={plank === null && unsure.plankHoldSeconds}
          onClick={() => notSure('plankHoldSeconds')}
        />
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
