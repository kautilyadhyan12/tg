import { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import {
  ADULT_AGE,
  AGE_REST,
  DAYS,
  EQUIPMENT,
  GENDERS,
  GOALS,
  HEIGHT_REST,
  LEVELS,
  PACES,
  PLACES,
  PLANK_REST,
  PUSH_UPS_REST,
  SESSION_MINUTES,
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
  kgFromParts,
  paceNote,
  paceText,
  patchOnboardingRequestSchema,
  plankList,
  plankShown,
  pushUpList,
  pushUpShown,
  range,
  targetRest,
  targetShownRow,
  targetWholes,
  targetWrongSide,
  toggleEquipment,
  toggleGoal,
  togglePlace,
  weightParts,
  weightShown,
  weightWholes,
  wrongSideText,
  type PatchOnboardingRequest,
  type PlanNumbers,
  type SetupAnswers,
  type Units,
  type WeightParts,
} from "@app/shared";
import { Chip, Chips, Options, Segments } from "../../look/Choice";
import { Field } from "../../look/Field";
import { Icon } from "../../look/Icon";
import { Ruler } from "../../look/Ruler";
import { fonts, Txt } from "../../look/Txt";
import { colours } from "../../look/colours";

// Setup's first seven screens on the phone. Every tap and every slide saves at once through
// `save`; the one typed box, the name, saves when the person leaves it. Nothing here decides a
// number: the plan bar shows the server's. Drawn for a phone, not copied from the browser (Kd,
// 2026-10-27): few words, one group a question, measures on sliding scales.

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

/** Whether the server takes this one answer: a scale never saves a number the contract refuses. */
const takes = (patch: PatchOnboardingRequest): boolean => patchOnboardingRequestSchema.safeParse(patch).success;

const at = <T,>(list: readonly T[], i: number, fallback: T): T => list[i] ?? fallback;

/** A weight as tenths of a kilogram or pound, the scale's one row a tenth. */
const tenthsOf = ({ whole, tenth }: WeightParts): number => whole * 10 + tenth;
const partsOf = (tenths: number): WeightParts => ({ whole: Math.floor(tenths / 10), tenth: tenths % 10 });
const wholeMark = (t: number): string | null => (t % 10 === 0 ? String(t / 10) : null);
const halfMark = (t: number): boolean => t % 5 === 0;

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Txt style={styles.sectionTitle}>{title}</Txt>
        {hint === undefined ? null : <Txt style={styles.hint}>{hint}</Txt>}
      </View>
      {children}
    </View>
  );
}

function Problem({ children }: { children: string | null }) {
  return children === null ? null : <Txt style={styles.problem}>{children}</Txt>;
}

const UNIT_OPTIONS = [
  { value: "metric", label: "kg · cm", say: "Kilograms and centimetres" },
  { value: "imperial", label: "lb · ft", say: "Pounds, feet and inches" },
] as const;

function UnitSwitch({ units, onChange }: { units: Units; onChange: (units: Units) => void }) {
  return (
    <View style={styles.unitRow}>
      <Txt style={styles.sectionTitle}>Units</Txt>
      <View style={styles.unitSwitch}>
        <Segments options={UNIT_OPTIONS} selected={units} onPick={onChange} />
      </View>
    </View>
  );
}

// ── The measures ────────────────────────────────────────────────────────────

function AgeScale({ age, save }: { age: number | null; save: Save }) {
  const rows = ageList(age);
  return (
    <View style={styles.measure}>
      <Ruler
        label="Age"
        rows={rows}
        index={Math.max(0, rows.indexOf(age ?? AGE_REST))}
        isSet={age !== null}
        shown={(v) => `${String(v)} years`}
        major={(v) => (v % 10 === 0 ? String(v) : null)}
        mid={(v) => v % 5 === 0}
        onPick={(i) => {
          const v = at(rows, i, age ?? AGE_REST);
          if (v !== age && takes({ age: v })) save({ age: v });
        }}
      />
      <Problem>{age !== null && age < ADULT_AGE ? UNDER_AGE_LINE : null}</Problem>
    </View>
  );
}

function HeightScale({ cm, units, save }: { cm: number | null; units: Units; save: Save }) {
  const isSet = cm !== null;
  const set = (value: number) => {
    if (value !== cm && takes({ heightCm: value })) save({ heightCm: value });
  };
  if (units === "imperial") {
    // One row an inch. The rows on show are the stored answer (175 cm reads 5 ft 9 in, and
    // 5 ft 9 in back is 175.26 cm): picked again, they save nothing.
    const parts = isSet ? heightParts(cm, "imperial") : HEIGHT_REST.imperial;
    const feet = heightFeetList(parts.ft);
    const rows = range(at(feet, 0, 3) * 12, at(feet, feet.length - 1, 8) * 12 + 11);
    const here = parts.ft * 12 + parts.inch;
    return (
      <Ruler
        label="Height"
        rows={rows}
        index={Math.max(0, rows.indexOf(here))}
        isSet={isSet}
        shown={(inches) => `${String(Math.floor(inches / 12))} ft ${String(inches % 12)} in`}
        major={(inches) => (inches % 12 === 0 ? `${String(inches / 12)} ft` : null)}
        mid={(inches) => inches % 6 === 0}
        onPick={(i) => {
          const inches = at(rows, i, here);
          if (isSet && inches === here) return;
          set(cmFromParts({ ft: Math.floor(inches / 12), inch: inches % 12 }, "imperial"));
        }}
      />
    );
  }
  const shownCm = isSet ? heightParts(cm, "metric").cm : HEIGHT_REST.metric.cm;
  const rows = heightCmList(shownCm);
  return (
    <Ruler
      label="Height"
      rows={rows}
      index={Math.max(0, rows.indexOf(shownCm))}
      isSet={isSet}
      shown={(v) => `${String(v)} cm`}
      major={(v) => (v % 10 === 0 ? String(v) : null)}
      mid={(v) => v % 5 === 0}
      onPick={(i) => {
        const v = at(rows, i, shownCm);
        if (!(isSet && v === shownCm)) set(v);
      }}
    />
  );
}

function WeightScale({ weightKg, units, save }: { weightKg: number | null; units: Units; save: Save }) {
  const isSet = weightKg !== null;
  const shown: WeightParts = isSet ? weightParts(weightKg, units) : { whole: WEIGHT_REST[units], tenth: 0 };
  const wholes = weightWholes(units, shown.whole);
  const rows = range(at(wholes, 0, shown.whole) * 10, at(wholes, wholes.length - 1, shown.whole) * 10 + 9);
  const here = tenthsOf(shown);
  return (
    <Ruler
      label="Weight"
      rows={rows}
      index={Math.max(0, rows.indexOf(here))}
      isSet={isSet}
      shown={(t) => weightShown(partsOf(t), units)}
      major={wholeMark}
      mid={halfMark}
      onPick={(i) => {
        const t = at(rows, i, here);
        // Compared as rows, never as kilograms: 70 kg reads 154.3 lb, and 154.3 lb back is
        // 69.99 kg, a weigh-in the person never made (RULINGS 2026-09-10).
        if (isSet && t === here) return;
        const kg = kgFromParts(partsOf(t), units);
        if (kg !== weightKg && takes({ weightKg: kg })) save({ weightKg: kg });
      }}
    />
  );
}

/** Screen 3's scale (Kd, 2026-09-11): only weights on the goal's side of the current weight are
 *  on it. A target under the lowest healthy weight stays pickable and is said at once (Kd,
 *  2026-09-14). */
function TargetScale({
  target,
  weightKg,
  direction,
  units,
  save,
}: {
  target: number | null;
  weightKg: number;
  direction: Direction | null;
  units: Units;
  save: Save;
}) {
  const weight = weightParts(weightKg, units);
  const wrong = targetWrongSide(direction, target, weightKg);
  const isSet = target !== null && !wrong;
  const shown = isSet ? targetShownRow(direction, { targetWeightKg: target, weightKg }, units) : targetRest(direction, weight);
  const wholes = targetWholes(units, direction, weight, shown);
  const rows =
    direction === "gain"
      ? range(tenthsOf(weight) + 1, at(wholes, wholes.length - 1, weight.whole + 1) * 10 + 9)
      : range(at(wholes, 0, weight.whole) * 10, tenthsOf(weight) - 1);
  const here = tenthsOf(shown);
  return (
    <Ruler
      label="Target weight"
      rows={rows}
      index={Math.max(0, rows.indexOf(here))}
      isSet={isSet}
      shown={(t) => weightShown(partsOf(t), units)}
      major={wholeMark}
      mid={halfMark}
      onPick={(i) => {
        const row = clampTarget(direction, weight, partsOf(at(rows, i, here)));
        if (isSet && tenthsOf(row) === here) return;
        const kg = kgFromParts(row, units);
        if (targetWrongSide(direction, kg, weightKg)) return;
        if (kg !== target && takes({ targetWeightKg: kg })) save({ targetWeightKg: kg });
      }}
    />
  );
}

// ── Screen 1 ────────────────────────────────────────────────────────────────

/** Under "Your weight", the choice's own verb: "Lose weight" reads "Lose". */
const WEIGHT_WORD: Readonly<Record<Direction, string>> = { lose: "Lose", maintain: "Keep", gain: "Gain" };

/** The ONE weight choice, which alone sets the calories (RULINGS 2026-09-10); under it, any
 *  number of goals, none of which moves them. */
export function GoalScreen({ answers, save }: ScreenProps) {
  const also = Array.isArray(answers.fitnessGoals) ? answers.fitnessGoals : [];
  return (
    <View style={styles.screen}>
      <Section title="Your weight">
        <Segments
          options={WEIGHT_GOALS.map((g) => ({ value: g.value, label: WEIGHT_WORD[g.value], say: g.label }))}
          selected={answers.weightGoal}
          onPick={(value) => {
            if (answers.weightGoal !== value) save({ weightGoal: value });
          }}
        />
      </Section>
      <Section title="Also work on" hint="Pick any">
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
      </Section>
    </View>
  );
}

// ── Screen 2 ────────────────────────────────────────────────────────────────

export function AboutScreen({ answers, save, units, setUnits, name }: ScreenProps) {
  return (
    <View style={styles.screen}>
      <View>
        <Field label="Your name" value={name.text} onChange={name.change} onDone={name.commit} name maxLength={100} />
        <Problem>{name.error}</Problem>
      </View>
      <Section title="Gender">
        <Chips>
          {GENDERS.map((g) => (
            <Chip
              key={g.value}
              label={g.label}
              selected={answers.gender === g.value}
              onPress={() => {
                if (answers.gender !== g.value) save({ gender: g.value });
              }}
            />
          ))}
        </Chips>
      </Section>
      <UnitSwitch units={units} onChange={setUnits} />
      <AgeScale age={answers.age ?? null} save={save} />
      <HeightScale cm={answers.heightCm ?? null} units={units} save={save} />
      <WeightScale weightKg={answers.weightKg ?? null} units={units} save={save} />
    </View>
  );
}

// ── Screen 3 (only for a goal that moves the weight) ────────────────────────

export function TargetScreen({ answers, save, units, setUnits, direction, plan }: ScreenProps) {
  const target = answers.targetWeightKg ?? null;
  const weightKg = answers.weightKg ?? null;
  const verb = direction === "gain" ? "Gain" : "Lose";
  const healthy = healthyTargetLine(direction, answers, units);
  const wrong = weightKg !== null && target !== null && targetWrongSide(direction, target, weightKg);
  return (
    <View style={styles.screen}>
      <UnitSwitch units={units} onChange={setUnits} />
      {weightKg === null ? (
        <Txt style={styles.hint}>Set your weight on About you first.</Txt>
      ) : (
        <View style={styles.measure}>
          <TargetScale target={target} weightKg={weightKg} direction={direction} units={units} save={save} />
          {wrong ? (
            <Problem>{wrongSideText(direction, target, weightKg, units)}</Problem>
          ) : (
            <Txt style={styles.hint}>You weigh {weightShown(weightParts(weightKg, units), units)}.</Txt>
          )}
          {healthy === null ? null : (
            <View style={styles.warn}>
              <Icon name="warn" size={14} colour="gold" />
              <Txt style={styles.warnWords}>{healthy}</Txt>
            </View>
          )}
        </View>
      )}
      <Section title="How fast?">
        <Options
          options={PACES.map((p) => ({
            value: p.value,
            label: p.label,
            desc: `${verb} ${paceText(p.value, units)}`,
            note: paceNote(p.value, direction, answers, plan),
          }))}
          selected={answers.pace}
          onPick={(value) => {
            if (answers.pace !== value) save({ pace: value });
          }}
        />
      </Section>
    </View>
  );
}

// ── Screen 4 ────────────────────────────────────────────────────────────────

export function DayScreen({ answers, save }: ScreenProps) {
  return (
    <Section title="A normal day, not counting workouts">
      <Options
        options={DAYS}
        selected={answers.dayActivity}
        onPick={(value) => {
          if (answers.dayActivity !== value) save({ dayActivity: value });
        }}
      />
    </Section>
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
  const unsureChip = (key: Check, isSet: boolean) => (
    <Chip
      label="Not sure"
      selected={!isSet && unsure[key]}
      onPress={() => {
        notSure(key);
      }}
    />
  );
  return (
    <View style={styles.screen}>
      <Section title="How fit do you feel?">
        <Options
          options={LEVELS}
          selected={answers.fitnessLevel}
          onPick={(value) => {
            if (answers.fitnessLevel !== value) save({ fitnessLevel: value });
          }}
        />
      </Section>
      <Txt style={styles.hint}>A guess is fine. It sets your first week’s workouts.</Txt>
      <View style={styles.measure}>
        <Ruler
          label="Push-ups in a row"
          rows={pushRows}
          index={Math.max(0, pushRows.indexOf(pushUps ?? PUSH_UPS_REST))}
          isSet={pushUps !== null}
          empty={unsure.pushUpsMax ? "Not sure" : "Not set"}
          shown={pushUpShown}
          major={(v) => (v % 10 === 0 ? String(v) : null)}
          mid={(v) => v % 5 === 0}
          onPick={(i) => {
            pick("pushUpsMax", at(pushRows, i, PUSH_UPS_REST));
          }}
        />
        {unsureChip("pushUpsMax", pushUps !== null)}
      </View>
      <View style={styles.measure}>
        <Ruler
          label="Plank hold"
          rows={plankRows}
          index={Math.max(0, plankRows.indexOf(plank ?? PLANK_REST))}
          isSet={plank !== null}
          empty={unsure.plankHoldSeconds ? "Not sure" : "Not set"}
          shown={plankShown}
          major={(v) => (v % 60 === 0 ? plankShown(v) : null)}
          mid={(v) => v % 30 === 0}
          onPick={(i) => {
            pick("plankHoldSeconds", at(plankRows, i, PLANK_REST));
          }}
        />
        {unsureChip("plankHoldSeconds", plank !== null)}
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
      <Section title="Days a week">
        <Segments
          options={TRAINING_DAYS.map((n) => ({ value: n, label: String(n), say: `${String(n)} ${n === 1 ? "day" : "days"} a week` }))}
          selected={answers.trainingDays}
          onPick={(n) => {
            if (answers.trainingDays !== n) save({ trainingDays: n });
          }}
        />
      </Section>
      <Section title="Minutes a session">
        <Segments
          options={lengths.map((m) => ({ value: m, label: String(m), say: `${String(m)} minutes` }))}
          selected={answers.sessionMinutes}
          onPick={(m) => {
            if (answers.sessionMinutes !== m) save({ sessionMinutes: m });
          }}
        />
      </Section>
    </View>
  );
}

// ── Screen 7 ────────────────────────────────────────────────────────────────

/** Where the person trains, then what they have (Kd, 2026-10-27: a gym is a place, not equipment). */
export function EquipmentScreen({ answers, save }: ScreenProps) {
  const shown = cleanEquipment(answers.availableEquipment);
  const places = Array.isArray(answers.trainingPlaces) ? answers.trainingPlaces : [];
  return (
    <View style={styles.screen}>
      <Section title="Where do you train?" hint="Pick any">
        <Chips>
          {PLACES.map((p) => (
            <Chip
              key={p.value}
              label={p.label}
              selected={places.includes(p.value)}
              onPress={() => {
                save({ trainingPlaces: togglePlace(places, p.value) });
              }}
            />
          ))}
        </Chips>
      </Section>
      <Section title="What equipment do you have?" hint="Pick any">
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
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { gap: 26 },
  section: { gap: 10 },
  sectionHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 10 },
  sectionTitle: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, color: colours.text },
  hint: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colours.textFaint },
  problem: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: colours.badText, marginTop: 4 },
  unitRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  unitSwitch: { width: 170 },
  measure: { gap: 8 },
  warn: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  warnWords: { flex: 1, fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: colours.gold },
});
