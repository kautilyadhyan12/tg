import { useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  ADULT_AGE,
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
  UNDER_AGE_LINE,
  WEIGHT_GOALS,
  WEIGHT_REST,
  ageList,
  clampTarget,
  cleanEquipment,
  cmFromParts,
  healthyTargetLine,
  heightCmList,
  heightFeetList,
  heightParts,
  heightShown,
  kgFromParts,
  paceNote,
  paceText,
  patchOnboardingRequestSchema,
  plankList,
  plankShown,
  pushUpList,
  pushUpShown,
  stepIn,
  stepInches,
  targetRest,
  targetShownRow,
  targetTenths,
  targetWholes,
  targetWrongSide,
  toggleEquipment,
  toggleGoal,
  weightParts,
  weightShown,
  weightWholes,
  wrongSideText,
  type ImperialHeight,
  type PatchOnboardingRequest,
  type PlanNumbers,
  type SetupAnswers,
  type Units,
  type WeightParts,
} from "@app/shared";
import { Chip, Chips, Choice, Segments } from "../../look/Choice";
import { Field } from "../../look/Field";
import { Icon } from "../../look/Icon";
import { Card } from "../../look/Card";
import { Txt } from "../../look/Txt";
import { Wheel, type WheelColumn } from "../../look/Wheel";

// Setup's first seven screens, the browser's own (apps/web/src/pages/onboarding/OnboardingScreens.jsx)
// fitted to a phone: every tap and every wheel saves at once through `save`; the one typed box,
// the name, saves when the person leaves it. Nothing here decides a number: the plan panel shows
// the server's.

type Direction = "lose" | "maintain" | "gain";
export type Save = (patch: PatchOnboardingRequest) => void;

export interface NameBox {
  text: string;
  error: string | null;
  change: (text: string) => void;
  commit: () => boolean;
}

export interface ScreenProps {
  answers: SetupAnswers;
  save: Save;
  units: Units;
  setUnits: (units: Units) => void;
  name: NameBox;
  direction: Direction | null;
  plan: PlanNumbers | null;
}

/** Whether the server takes this one answer: a wheel never saves a number the contract refuses. */
const takes = (patch: PatchOnboardingRequest): boolean => patchOnboardingRequestSchema.safeParse(patch).success;

/** A pick of the rows already on show is not a new answer, and saves nothing: 70 kg reads
 *  154.3 lb, and 154.3 lb back is 69.99 kg, a weigh-in the person never made. */
const sameRows = (a: WeightParts, b: WeightParts): boolean => a.whole === b.whole && a.tenth === b.tenth;

const at = <T,>(list: readonly T[], i: number, fallback: T): T => list[i] ?? fallback;

function Question({ children, hint }: { children: string; hint?: string }) {
  return (
    <View style={styles.question}>
      <Txt kind="h3">{children}</Txt>
      {hint === undefined ? null : <Txt kind="small">{hint}</Txt>}
    </View>
  );
}

function Problem({ children }: { children: string | null }) {
  return children === null ? null : (
    <Txt colour="badText" kind="small" style={styles.problem}>
      {children}
    </Txt>
  );
}

const UNIT_OPTIONS = [
  { value: "metric", label: "kg · cm", say: "Kilograms and centimetres" },
  { value: "imperial", label: "lb · ft", say: "Pounds, feet and inches" },
] as const;

function UnitSwitch({ units, onChange }: { units: Units; onChange: (units: Units) => void }) {
  return (
    <View style={styles.block}>
      <Question>Units</Question>
      <Segments options={UNIT_OPTIONS} selected={units} onPick={onChange} />
    </View>
  );
}

// ── The wheels ──────────────────────────────────────────────────────────────

function AgeWheel({ age, save }: { age: number | null; save: Save }) {
  const list = ageList(age);
  const shownAt = age ?? AGE_REST;
  const pick = (v: number) => {
    if (v !== age && takes({ age: v })) save({ age: v });
  };
  return (
    <View style={styles.block}>
      <Wheel
        question="Age"
        shown={age === null ? "Not set" : `${String(age)} years`}
        isSet={age !== null}
        unit="years"
        stepLabel="Age"
        onStep={(by) => {
          pick(stepIn(list, shownAt, by));
        }}
        columns={[{ label: "Age", values: list, index: list.indexOf(shownAt), format: String, onPick: (i) => { pick(at(list, i, shownAt)); } }]}
      />
      <Problem>{age !== null && age < ADULT_AGE ? UNDER_AGE_LINE : null}</Problem>
    </View>
  );
}

function HeightWheel({ cm, units, save }: { cm: number | null; units: Units; save: Save }) {
  const isSet = cm !== null;
  const set = (value: number) => {
    if (value !== cm && takes({ heightCm: value })) save({ heightCm: value });
  };
  if (units === "imperial") {
    const parts: ImperialHeight = isSet ? heightParts(cm, "imperial") : HEIGHT_REST.imperial;
    const feet = heightFeetList(parts.ft);
    // The rows on show are the answer already stored (175 cm reads 5 ft 9 in, and 5 ft 9 in
    // back is 175.26 cm): picked again, they save nothing.
    const pick = (next: ImperialHeight) => {
      if (isSet && next.ft === parts.ft && next.inch === parts.inch) return;
      set(cmFromParts(next, "imperial"));
    };
    return (
      <Wheel
        question="Height"
        shown={isSet ? heightShown(parts, "imperial") : "Not set"}
        isSet={isSet}
        stepLabel="Height"
        onStep={(by) => {
          pick(stepInches(parts, by));
        }}
        columns={[
          {
            label: "Height, feet",
            values: feet,
            index: feet.indexOf(parts.ft),
            format: (v) => `${String(v)} ft`,
            onPick: (i) => {
              pick({ ft: at(feet, i, parts.ft), inch: parts.inch });
            },
          },
          {
            label: "Height, inches",
            values: INCHES,
            index: parts.inch,
            format: (v) => `${String(v)} in`,
            onPick: (i) => {
              pick({ ft: parts.ft, inch: at(INCHES, i, parts.inch) });
            },
          },
        ]}
      />
    );
  }
  const shownCm = isSet ? heightParts(cm, "metric").cm : HEIGHT_REST.metric.cm;
  const list = heightCmList(shownCm);
  const pick = (value: number) => {
    if (!(isSet && value === shownCm)) set(value);
  };
  return (
    <Wheel
      question="Height"
      shown={isSet ? heightShown({ cm: shownCm }, "metric") : "Not set"}
      isSet={isSet}
      unit="cm"
      stepLabel="Height"
      onStep={(by) => {
        pick(stepIn(list, shownCm, by));
      }}
      columns={[
        {
          label: "Height in centimetres",
          values: list,
          index: list.indexOf(shownCm),
          format: String,
          onPick: (i) => {
            pick(at(list, i, shownCm));
          },
        },
      ]}
    />
  );
}

interface WeightWheelProps {
  question: string;
  shown: string;
  isSet: boolean;
  rows: WeightParts;
  wholes: readonly number[];
  tenths: readonly number[];
  units: Units;
  onPick: (parts: WeightParts) => void;
}

/** A weight on two columns, whole kilos or pounds and tenths. */
function WeightWheel({ question, shown, isSet, rows, wholes, tenths, units, onPick }: WeightWheelProps) {
  const unitWord = units === "imperial" ? "pound" : "kilogram";
  const columns: WheelColumn[] = [
    {
      label: `${question} in whole ${unitWord}s`,
      values: wholes,
      index: wholes.indexOf(rows.whole),
      format: String,
      onPick: (i) => {
        onPick({ whole: at(wholes, i, rows.whole), tenth: rows.tenth });
      },
    },
    {
      label: `${question}, tenths of a ${unitWord}`,
      values: tenths,
      index: tenths.indexOf(rows.tenth),
      format: (v) => `.${String(v)}`,
      onPick: (i) => {
        onPick({ whole: rows.whole, tenth: at(tenths, i, rows.tenth) });
      },
    },
  ];
  return (
    <Wheel
      question={question}
      shown={shown}
      isSet={isSet}
      unit={units === "imperial" ? "lb" : "kg"}
      stepLabel={question}
      onStep={(by) => {
        onPick({ whole: stepIn(wholes, rows.whole, by), tenth: rows.tenth });
      }}
      columns={columns}
    />
  );
}

/** Screen 3's wheel (Kd, 2026-09-11): only weights on the goal's side of the current weight are
 *  on it. A target under the lowest healthy weight stays pickable and is said at once (Kd,
 *  2026-09-14). */
function TargetWheel({
  target,
  weightKg,
  direction,
  units,
  save,
  healthy,
}: {
  target: number | null;
  weightKg: number;
  direction: Direction | null;
  units: Units;
  save: Save;
  healthy: string | null;
}) {
  const weight = weightParts(weightKg, units);
  const wrong = targetWrongSide(direction, target, weightKg);
  const isSet = target !== null && !wrong;
  const rows = isSet ? targetShownRow(direction, { targetWeightKg: target, weightKg }, units) : targetRest(direction, weight);
  const pick = (parts: WeightParts) => {
    const row = clampTarget(direction, weight, parts);
    if (isSet && sameRows(row, rows)) return;
    const kg = kgFromParts(row, units);
    if (targetWrongSide(direction, kg, weightKg)) return;
    if (kg !== target && takes({ targetWeightKg: kg })) save({ targetWeightKg: kg });
  };
  return (
    <View style={styles.block}>
      <WeightWheel
        question="Target weight"
        shown={target === null ? "Not set" : weightShown(isSet ? rows : weightParts(target, units), units)}
        isSet={isSet}
        rows={rows}
        wholes={targetWholes(units, direction, weight, rows)}
        tenths={targetTenths(direction, weight, rows.whole)}
        units={units}
        onPick={pick}
      />
      {wrong && target !== null ? (
        <Problem>{wrongSideText(direction, target, weightKg, units)}</Problem>
      ) : (
        <Txt kind="small">
          {direction === "gain" ? "The weight you want to build up to." : "The weight you want to reach."} You weigh{" "}
          {weightShown(weight, units)}.
        </Txt>
      )}
      {healthy === null ? null : (
        <Card style={styles.warn}>
          <Icon name="warn" size={16} colour="orangeLight" />
          <Txt colour="orangeLight" kind="small" style={styles.grow}>
            {healthy}
          </Txt>
        </Card>
      )}
    </View>
  );
}

// ── Screen 1 ────────────────────────────────────────────────────────────────

/** The ONE weight choice on top, which alone sets the calories (RULINGS 2026-09-10); under it,
 *  any number of goals, none of which moves them. Nothing fights anything else. */
export function GoalScreen({ answers, save }: ScreenProps) {
  const also = Array.isArray(answers.fitnessGoals) ? answers.fitnessGoals : [];
  return (
    <View style={styles.screen}>
      <View style={styles.block}>
        <Question>Your weight</Question>
        <Segments
          options={WEIGHT_GOALS}
          selected={answers.weightGoal}
          onPick={(value) => {
            if (answers.weightGoal !== value) save({ weightGoal: value });
          }}
        />
      </View>
      <View style={styles.block}>
        <Question hint="Pick any">Also work on</Question>
        <Chips>
          {GOALS.map((g) => (
            <Chip
              key={g.value}
              label={g.label}
              selected={also.includes(g.value)}
              onPress={() => {
                save({ fitnessGoals: toggleGoal(also, g.value) });
              }}
            />
          ))}
        </Chips>
      </View>
    </View>
  );
}

// ── Screen 2 ────────────────────────────────────────────────────────────────

export function AboutScreen({ answers, save, units, setUnits, name }: ScreenProps) {
  const weightKg = answers.weightKg ?? null;
  const weightSet = weightKg !== null;
  const weightRows: WeightParts = weightSet ? weightParts(weightKg, units) : { whole: WEIGHT_REST[units], tenth: 0 };
  return (
    <View style={styles.screen}>
      <View style={styles.block}>
        <Field label="What should we call you?" value={name.text} onChange={name.change} onDone={name.commit} name maxLength={100} />
        <Problem>{name.error}</Problem>
      </View>
      <UnitSwitch units={units} onChange={setUnits} />
      <AgeWheel age={answers.age ?? null} save={save} />
      <View style={styles.block}>
        <Question hint="Used to estimate how much energy your body burns.">Gender</Question>
        <View style={styles.two}>
          {GENDERS.map((g) => (
            <View key={g.value} style={styles.half}>
              <Choice
                label={g.label}
                selected={answers.gender === g.value}
                onPress={() => {
                  if (answers.gender !== g.value) save({ gender: g.value });
                }}
              />
            </View>
          ))}
        </View>
      </View>
      <HeightWheel cm={answers.heightCm ?? null} units={units} save={save} />
      <View style={styles.block}>
        <WeightWheel
          question="Weight"
          shown={weightSet ? weightShown(weightRows, units) : "Not set"}
          isSet={weightSet}
          rows={weightRows}
          wholes={weightWholes(units, weightRows.whole)}
          tenths={TENTHS}
          units={units}
          onPick={(parts) => {
            if (weightSet && sameRows(parts, weightRows)) return;
            const kg = kgFromParts(parts, units);
            if (kg !== weightKg && takes({ weightKg: kg })) save({ weightKg: kg });
          }}
        />
        <Txt kind="small">Saved in your weigh-in history.</Txt>
      </View>
    </View>
  );
}

// ── Screen 3 (only for a goal that moves the weight) ────────────────────────

export function TargetScreen({ answers, save, units, setUnits, direction, plan }: ScreenProps) {
  const target = answers.targetWeightKg ?? null;
  const weightKg = answers.weightKg ?? null;
  const verb = direction === "gain" ? "Gain" : "Lose";
  return (
    <View style={styles.screen}>
      <UnitSwitch units={units} onChange={setUnits} />
      {weightKg === null ? (
        <Txt>Set your weight on About you first.</Txt>
      ) : (
        <TargetWheel
          target={target}
          weightKg={weightKg}
          direction={direction}
          units={units}
          save={save}
          healthy={healthyTargetLine(direction, answers, units)}
        />
      )}
      <View style={styles.block}>
        <Question>How fast?</Question>
        {PACES.map((p) => (
          <Choice
            key={p.value}
            label={p.label}
            desc={`${verb} ${paceText(p.value, units)}`}
            note={paceNote(p.value, direction, answers, plan)}
            selected={answers.pace === p.value}
            onPress={() => {
              if (answers.pace !== p.value) save({ pace: p.value });
            }}
          />
        ))}
      </View>
    </View>
  );
}

// ── Screen 4 ────────────────────────────────────────────────────────────────

export function DayScreen({ answers, save }: ScreenProps) {
  return (
    <View style={styles.block}>
      <Question>What does a normal day look like, not counting workouts?</Question>
      {DAYS.map((d) => (
        <Choice
          key={d.value}
          label={d.label}
          desc={d.desc}
          selected={answers.dayActivity === d.value}
          onPress={() => {
            if (answers.dayActivity !== d.value) save({ dayActivity: d.value });
          }}
        />
      ))}
    </View>
  );
}

// ── Screen 5 ────────────────────────────────────────────────────────────────

type Check = "pushUpsMax" | "plankHoldSeconds";

/** Two plain questions, a guess is fine, and "Not sure" for either (Kd, 2026-09-10). "Not sure"
 *  is this visit's word for an empty answer: the server keeps a number or nothing. */
export function TrainingScreen({ answers, save }: ScreenProps) {
  const [unsure, setUnsure] = useState<Record<Check, boolean>>({ pushUpsMax: false, plankHoldSeconds: false });
  const pick = (key: Check, value: number) => {
    setUnsure((u) => ({ ...u, [key]: false }));
    if (value !== answers[key] && takes({ [key]: value })) save({ [key]: value });
  };
  const notSure = (key: Check) => {
    setUnsure((u) => ({ ...u, [key]: true }));
    if (answers[key] !== null && answers[key] !== undefined) save({ [key]: null });
  };
  const pushUps = answers.pushUpsMax ?? null;
  const plank = answers.plankHoldSeconds ?? null;
  const pushRows = pushUpList(pushUps);
  const plankRows = plankList(plank);
  const pushAt = pushUps ?? PUSH_UPS_REST;
  const plankAt = plank ?? PLANK_REST;
  const empty = (key: Check) => (unsure[key] ? "Not sure" : "Not set");
  return (
    <View style={styles.screen}>
      <View style={styles.block}>
        <Question>How fit do you feel right now?</Question>
        {LEVELS.map((l) => (
          <Choice
            key={l.value}
            label={l.label}
            desc={l.desc}
            selected={answers.fitnessLevel === l.value}
            onPress={() => {
              if (answers.fitnessLevel !== l.value) save({ fitnessLevel: l.value });
            }}
          />
        ))}
      </View>
      <Txt kind="small">A guess is fine. Used to set your first week’s workouts.</Txt>
      <View style={styles.block}>
        <Wheel
          question="How many push-ups can you do in a row?"
          shown={pushUps === null ? empty("pushUpsMax") : pushUpShown(pushUps)}
          isSet={pushUps !== null}
          stepLabel="Push-ups"
          onStep={(by) => {
            pick("pushUpsMax", stepIn(pushRows, pushAt, by));
          }}
          columns={[
            {
              label: "Push-ups in a row",
              values: pushRows,
              index: pushRows.indexOf(pushAt),
              format: String,
              onPick: (i) => {
                pick("pushUpsMax", at(pushRows, i, pushAt));
              },
            },
          ]}
        />
        <Chip
          label="Not sure"
          selected={pushUps === null && unsure.pushUpsMax}
          onPress={() => {
            notSure("pushUpsMax");
          }}
        />
      </View>
      <View style={styles.block}>
        <Wheel
          question="How long can you hold a plank?"
          shown={plank === null ? empty("plankHoldSeconds") : plankShown(plank)}
          isSet={plank !== null}
          stepLabel="Plank"
          onStep={(by) => {
            pick("plankHoldSeconds", stepIn(plankRows, plankAt, by));
          }}
          columns={[
            {
              label: "Plank hold",
              values: plankRows,
              index: plankRows.indexOf(plankAt),
              format: plankShown,
              onPick: (i) => {
                pick("plankHoldSeconds", at(plankRows, i, plankAt));
              },
            },
          ]}
        />
        <Chip
          label="Not sure"
          selected={plank === null && unsure.plankHoldSeconds}
          onPress={() => {
            notSure("plankHoldSeconds");
          }}
        />
      </View>
    </View>
  );
}

// ── Screen 6 ────────────────────────────────────────────────────────────────

export function WeekScreen({ answers, save }: ScreenProps) {
  // A length an older form stored (75, 105 minutes) is shown among the choices.
  const lengths = [...new Set([...SESSION_MINUTES, answers.sessionMinutes])]
    .filter((m): m is number => typeof m === "number")
    .sort((a, b) => a - b);
  return (
    <View style={styles.screen}>
      <View style={styles.block}>
        <Question>How many days a week can you train?</Question>
        <Segments
          options={TRAINING_DAYS.map((n) => ({ value: n, label: String(n), say: `${String(n)} ${n === 1 ? "day" : "days"} a week` }))}
          selected={answers.trainingDays}
          onPick={(n) => {
            if (answers.trainingDays !== n) save({ trainingDays: n });
          }}
        />
      </View>
      <View style={styles.block}>
        <Question>How long is one session?</Question>
        <Chips>
          {lengths.map((m) => (
            <Chip
              key={m}
              label={`${String(m)} min`}
              selected={answers.sessionMinutes === m}
              onPress={() => {
                if (answers.sessionMinutes !== m) save({ sessionMinutes: m });
              }}
            />
          ))}
        </Chips>
      </View>
    </View>
  );
}

// ── Screen 7 ────────────────────────────────────────────────────────────────

export function EquipmentScreen({ answers, save }: ScreenProps) {
  const shown = cleanEquipment(answers.availableEquipment);
  return (
    <View style={styles.block}>
      <Question hint="Pick all that apply, or No equipment.">What do you have to train with?</Question>
      <Chips>
        {EQUIPMENT.map((e) => (
          <Chip
            key={e.value}
            label={e.label}
            selected={shown.includes(e.value)}
            onPress={() => {
              save({ availableEquipment: toggleEquipment(shown, e.value) });
            }}
          />
        ))}
      </Chips>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { gap: 24 },
  block: { gap: 10 },
  question: { gap: 2 },
  problem: { marginTop: -4 },
  two: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  half: { width: "48.5%" },
  warn: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  grow: { flex: 1 },
});
