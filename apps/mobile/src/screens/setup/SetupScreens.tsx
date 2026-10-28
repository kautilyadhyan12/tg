import { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import {
  ADULT_AGE,
  AGE_REST,
  CHECK_FIRST_HEADING,
  CHECK_FIRST_OPTIONS,
  CHECK_FIRST_PICK,
  CLEARED_LINE,
  CURRENT_DISCLAIMER_VERSION,
  DAYS,
  DIETS,
  DISCLAIMER_WORDINGS,
  EQUIPMENT,
  FINISH_HINT,
  GENDERS,
  GOALS,
  HEALTH_QUESTION_ITEMS,
  HEALTH_QUESTION_LEAD,
  HEALTH_QUESTION_NOTE,
  HEIGHT_REST,
  LEVELS,
  MEALS_PER_DAY,
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
  answerRows,
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
  workoutsDetail,
  workoutsLine,
  wrongSideText,
  type CheckFirst,
  type MyInvitation,
  type PatchOnboardingRequest,
  type PlanNumbers,
  type SetupAnswers,
  type SetupScreenId,
  type Units,
  type WeightParts,
} from "@app/shared";
import { Button } from "../../look/Button";
import { Card } from "../../look/Card";
import { Chip, Grid, Options, Segments } from "../../look/Choice";
import { Field } from "../../look/Field";
import { Icon } from "../../look/Icon";
import { Ruler } from "../../look/Ruler";
import { Tick } from "../../look/Tick";
import { fonts, Txt } from "../../look/Txt";
import { colours } from "../../look/colours";
import { InvitationList } from "../Invitation";
import type { HealthStep } from "./useHealthStep";

// Setup's screens on the phone. Every tap and every slide saves at once through
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
  health: HealthStep;
  /** A health answer the server took: the daily number is read again, as any yes stops the calorie cut. */
  healthSaved: () => void;
  /** The invitations waiting when setup opened, for the place step. */
  invitations: MyInvitation[];
  /** The plan screen's way back to one answer; Continue there then comes straight back. */
  adjust: (id: SetupScreenId) => void;
  /** A save or a finish is away: no way back to an answer opens meanwhile. */
  busy: boolean;
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
        <Grid
          columns={2}
          cells={GOALS.map((g) => ({
            key: g.value,
            label: g.label === "Endurance and running" ? "Endurance" : g.label,
            say: g.label,
            selected: also.includes(g.value),
            onPress: () => {
              save({ fitnessGoals: toggleGoal(also, g.value) });
            },
          }))}
        />
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
        <Grid
          columns={2}
          cells={GENDERS.map((g) => ({
            key: g.value,
            label: g.label,
            selected: answers.gender === g.value,
            onPress: () => {
              if (answers.gender !== g.value) save({ gender: g.value });
            },
          }))}
        />
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
      <Section title="How many days a week can you train?">
        <Grid
          columns={4}
          cells={TRAINING_DAYS.map((n) => ({
            key: String(n),
            label: `${String(n)} ${n === 1 ? "day" : "days"}`,
            say: `${String(n)} ${n === 1 ? "day" : "days"} a week`,
            selected: answers.trainingDays === n,
            onPress: () => {
              if (answers.trainingDays !== n) save({ trainingDays: n });
            },
          }))}
        />
      </Section>
      <Section title="How long is each workout?">
        <Grid
          columns={3}
          cells={lengths.map((m) => ({
            key: String(m),
            label: `${String(m)} min`,
            say: `${String(m)} minutes`,
            selected: answers.sessionMinutes === m,
            onPress: () => {
              if (answers.sessionMinutes !== m) save({ sessionMinutes: m });
            },
          }))}
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
        <Grid
          columns={2}
          cells={PLACES.map((p) => ({
            key: p.value,
            label: p.label,
            selected: places.includes(p.value),
            onPress: () => {
              save({ trainingPlaces: togglePlace(places, p.value) });
            },
          }))}
        />
      </Section>
      <Section title="What equipment do you have?" hint="Pick any">
        <Grid
          columns={2}
          cells={EQUIPMENT.map((e) => ({
            key: e.value,
            label: e.label,
            selected: shown.includes(e.value),
            onPress: () => {
              save({ availableEquipment: toggleEquipment(shown, e.value) });
            },
          }))}
        />
      </Section>
    </View>
  );
}

// ── Screen 8 ────────────────────────────────────────────────────────────────

const healthNote = DISCLAIMER_WORDINGS.health_step[CURRENT_DISCLAIMER_VERSION.health_step];
const CHECK_FIRST: readonly CheckFirst[] = ["cleared", "not_yet"];

/** The one health question (RULINGS 2026-09-07 and 2026-09-10) as a heading and a list, every part
 *  of the browser's sentence in its order, and the words in dark boxes, never on the picture (Kd,
 *  2026-10-28: "looking like a article, text on text"). A yes is
 *  NOT saved until "Check first" is answered: the server refuses a yes with no choice, so Yes opens
 *  the two and stores nothing; until one is picked the screen holds what the server has. "Not yet"
 *  is Safe mode. The note's tick is kept in the consent log the moment it is made. */
export function HealthScreen({ health, healthSaved }: ScreenProps) {
  const screening = health.screening;
  const stored = screening?.answered === true ? screening.hasCondition : null;
  const yes = health.pendingYes ? true : stored;
  const checkFirst = stored === true ? (screening?.checkFirst ?? null) : null;
  const busy = health.saving;

  const send = async (hasCondition: boolean, choice: CheckFirst | null) => {
    if (await health.answer(hasCondition ? { hasCondition, checkFirst: choice } : { hasCondition })) healthSaved();
  };

  return (
    <View style={styles.screen}>
      <Section title={HEALTH_QUESTION_LEAD}>
        <View style={styles.box}>
          {HEALTH_QUESTION_ITEMS.map((item) => (
            <View key={item} style={styles.item}>
              <View style={styles.bullet} />
              <Txt style={styles.itemWords}>{item}</Txt>
            </View>
          ))}
          <Txt style={styles.boxNote}>{HEALTH_QUESTION_NOTE}</Txt>
        </View>
        <Grid
          columns={2}
          cells={[
            {
              key: "no",
              label: "No",
              selected: yes === false,
              disabled: busy,
              onPress: () => {
                health.openYes(false);
                if (stored !== false) void send(false, null);
              },
            },
            {
              key: "yes",
              label: "Yes",
              selected: yes === true,
              disabled: busy,
              onPress: () => {
                if (stored !== true) health.openYes(true);
              },
            },
          ]}
        />
      </Section>
      {yes === true ? (
        <Section title={CHECK_FIRST_HEADING}>
          <Options
            options={CHECK_FIRST.map((value) => ({ value, label: CHECK_FIRST_OPTIONS[value].label, desc: CHECK_FIRST_OPTIONS[value].detail }))}
            selected={checkFirst}
            solid
            disabled={busy}
            onPick={(value) => {
              if (value === checkFirst) health.openYes(false);
              else void send(true, value);
            }}
          />
          {stored === true ? null : <Txt style={styles.hint}>{CHECK_FIRST_PICK}</Txt>}
        </Section>
      ) : null}
      <Card style={[styles.box, styles.note]}>
        <Txt style={styles.noteWords}>{healthNote}</Txt>
        <Tick
          label="I have read and understood this"
          ticked={health.ticked}
          disabled={health.ticked}
          busy={health.ticking}
          onPress={() => void health.tick()}
          testID="health-tick-box"
        />
        {health.ticked ? null : <Txt style={styles.hint}>Tick this to continue.</Txt>}
      </Card>
    </View>
  );
}

// ── Screen 9 ────────────────────────────────────────────────────────────────

/** The diet and how many meals a day (RULINGS 2026-09-10). Neither moves a calorie; the meal
 *  ideas read both, so neither is ever guessed. */
export function FoodScreen({ answers, save }: ScreenProps) {
  return (
    <View style={styles.screen}>
      <Section title="How do you eat?">
        <Options
          options={DIETS}
          selected={answers.diet}
          solid
          onPick={(value) => {
            if (answers.diet !== value) save({ diet: value });
          }}
        />
      </Section>
      <Section title="How many meals a day?" hint="Snacks count">
        <Grid
          columns={MEALS_PER_DAY.length}
          cells={MEALS_PER_DAY.map((n) => ({
            key: String(n),
            label: String(n),
            say: `${String(n)} meals a day`,
            selected: answers.mealsPerDay === n,
            onPress: () => {
              if (answers.mealsPerDay !== n) save({ mealsPerDay: n });
            },
          }))}
        />
      </Section>
    </View>
  );
}

// ── The place that invited them ─────────────────────────────────────────────

/** Asked only when an invitation is still waiting (Kd, 2026-10-28): the same boxes as the Gym tab.
 *  Continue is lit, so it can be left for later; no words on the picture say so. */
export function PlaceScreen({ invitations }: ScreenProps) {
  return <InvitationList invitations={invitations} onAnswered={() => undefined} />;
}

// ── The last screen: your plan ──────────────────────────────────────────────

const planNote = DISCLAIMER_WORDINGS.plan_screen[CURRENT_DISCLAIMER_VERSION.plan_screen];

/** The week of workouts, or in Safe mode why there is none (RULINGS 2026-09-07); every answer with
 *  Adjust; the plan's note and its tick, which Finish waits for. No workout is named: those come
 *  with the weekly plan. */
export function PlanScreen({ answers, units, health, adjust, busy }: ScreenProps) {
  const screening = health.screening;
  const safeMode = screening?.safeMode === true;
  const cleared = screening?.hasCondition === true && screening.checkFirst === "cleared";
  const week = workoutsLine(answers);
  const detail = workoutsDetail(answers);
  return (
    <View style={styles.screen}>
      <Card style={[styles.box, styles.note]}>
        <View style={styles.eyebrow}>
          <Icon name="dumbbell" size={14} colour="orange" />
          <Txt kind="eyebrow">Your workouts</Txt>
        </View>
        {safeMode ? (
          <View style={styles.warn}>
            <Icon name="shield" size={18} colour="gold" />
            <Txt style={styles.softWords}>{CHECK_FIRST_OPTIONS.not_yet.detail}</Txt>
          </View>
        ) : (
          <>
            {week === null ? null : <Txt kind="big">{week}</Txt>}
            {detail === "" ? null : <Txt kind="small">{detail}</Txt>}
            {cleared ? <Txt style={styles.warnWords}>{CLEARED_LINE}</Txt> : null}
          </>
        )}
      </Card>
      <Section title="Your answers">
        <View style={[styles.box, styles.rows]}>
          {answerRows(answers, units).map((row, i) => (
            <View key={row.id} style={[styles.answer, i === 0 ? null : styles.answerLine]}>
              <View accessible style={styles.answerWords}>
                <Txt kind="tiny">{row.title}</Txt>
                <Txt style={styles.answerValue}>{row.value}</Txt>
              </View>
              <Button
                label="Adjust"
                say={`Adjust ${row.title}`}
                kind="link"
                small
                disabled={busy}
                onPress={() => {
                  adjust(row.id);
                }}
              />
            </View>
          ))}
        </View>
      </Section>
      <Card style={[styles.box, styles.note]}>
        <Txt style={styles.noteWords}>{planNote}</Txt>
        <Tick
          label="I have read and understood this"
          ticked={health.planTicked}
          disabled={health.planTicked}
          busy={health.planTicking}
          onPress={() => void health.tickPlan()}
          testID="plan-tick-box"
        />
        {health.planTicked ? null : <Txt style={styles.hint}>{FINISH_HINT}</Txt>}
      </Card>
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
  box: { gap: 10, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.overWords },
  item: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  bullet: { width: 6, height: 6, borderRadius: 3, marginTop: 7, backgroundColor: colours.orange },
  itemWords: { flex: 1, fontFamily: fonts.medium, fontSize: 15, lineHeight: 20, color: colours.text },
  boxNote: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colours.textFaint, marginTop: 4 },
  note: { gap: 10 },
  noteWords: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colours.textSoft },
  warnWords: { flex: 1, fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: colours.gold },
  eyebrow: { flexDirection: "row", alignItems: "center", gap: 6 },
  rows: { gap: 0, paddingVertical: 4 },
  answer: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  answerLine: { borderTopWidth: 1, borderTopColor: colours.line },
  answerWords: { flex: 1, gap: 2 },
  answerValue: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 19, color: colours.textSoft },
  softWords: { flex: 1, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colours.textSoft },
});
