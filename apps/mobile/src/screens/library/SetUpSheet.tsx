import type { PhoneLibraryEntry } from "@app/shared";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Button } from "../../look/Button";
import { colours, sizes, type ColourName } from "../../look/colours";
import { Sheet } from "../../look/Sheet";
import { fonts, Txt } from "../../look/Txt";
import type { Plan } from "../../library/myWorkout";
import { weightParts, type Units } from "../../library/records";
import {
  barPlates,
  canStep,
  changed,
  clockDigits,
  restWords,
  same,
  targetWords,
  weightDigits,
  weightWayOf,
  type Field,
} from "../../library/workoutSetup";
import { Led, LOADED_BAR_HEIGHT, LoadedBar } from "./Records";

// Setting up one exercise of My Workout (ROADMAP Stage 5 64a-i, Kd's drawing of 2026-11-20): the box from the bottom.
// The weight of a barbell exercise is the loaded bar, as on Your records; sets, reps or time, any other weight and the
// rest are lit on the gym's LED wall timer, each in its own colour. Every set changes together, or one set alone
// after Change one set. Each press is kept at once; Done closes it.

interface Props {
  entry: PhoneLibraryEntry;
  plan: Plan;
  units: Units;
  onChange: (plan: Plan) => void;
  onAbout: () => void;
  onClose: () => void;
}

export function SetUpSheet({ entry, plan, units, onChange, onAbout, onClose }: Props) {
  const [which, setWhich] = useState<number | null>(null);
  const [each, setEach] = useState(false);
  const one = which !== null && which < plan.sets.length ? which : null;
  const way = weightWayOf(entry, units);
  const barbell = entry.equipment.includes("barbell");
  const shown = plan.sets[one ?? 0];
  const name = entry.text.en.name;
  if (shown === undefined) return null;
  const varies = (field: Exclude<Field, "sets">) => one === null && !same(plan, field);
  const press = (field: Field, by: -1 | 1) => {
    const next = changed(plan, field, by, field === "sets" ? null : one, units, barbell);
    if (next !== plan) onChange(next);
  };
  const can = (field: Field, by: -1 | 1) => canStep(plan, field, by, field === "sets" ? null : one, units, barbell);
  const time = plan.measuredIn === "time";

  return (
    <Sheet
      open
      title={name}
      onClose={onClose}
      onBack={() => {
        if (one === null && !each) return false;
        setWhich(null);
        setEach(false);
        return true;
      }}
    >
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Txt kind="small">{one === null ? "Every set" : `Set ${String(one + 1)} only`}</Txt>
        {way === "bar" ? <BarBox entry={entry} grams={varies("weight") ? undefined : shown.weightGrams} range={weightRange(plan, units)} units={units} press={press} can={can} /> : null}
        <View style={styles.wall}>
          <Dial label="Sets" say="sets" field="sets" digits={String(plan.sets.length)} colour="ledAmber" unit={null} press={press} can={can} first />
          {time ? (
            <Dial label="Time" say="time" field="target" digits={varies("target") ? "--:--" : clockDigits(shown.target)} colour="ledRed" unit={varies("target") ? "varies" : null} press={press} can={can} />
          ) : (
            <Dial label="Reps" say="reps" field="target" digits={varies("target") ? "--" : String(shown.target)} colour="ledRed" unit={varies("target") ? "varies" : "reps"} press={press} can={can} />
          )}
          {way === "number" ? (
            <Dial
              label="Weight"
              say="weight"
              field="weight"
              digits={varies("weight") ? "--" : weightDigits(shown.weightGrams, units)[0]}
              colour="ledBlue"
              unit={varies("weight") ? "varies" : weightDigits(shown.weightGrams, units)[1]}
              press={press}
              can={can}
            />
          ) : null}
          <Dial label="Rest" say="rest" field="rest" digits={varies("rest") ? "--:--" : clockDigits(shown.restSeconds ?? 0)} colour="ledGreen" unit={varies("rest") ? "varies" : null} press={press} can={can} />
        </View>
        {each ? (
          <>
            <View style={styles.list}>
              {plan.sets.map((s, i) => {
                const on = one === i;
                const weight = s.weightGrams === null ? null : weightParts(s.weightGrams, units).join(" ");
                const said = [targetWords(plan, s), weight, restWords(s.restSeconds)].filter((x) => x !== null).join(", ");
                return (
                  <Pressable
                    key={i}
                    accessibilityRole="button"
                    accessibilityLabel={`Set ${String(i + 1)}: ${said}`}
                    accessibilityState={{ selected: on }}
                    onPress={() => {
                      setWhich(i);
                    }}
                    style={[styles.setLine, i > 0 ? styles.setSplit : null, on ? styles.setOn : null]}
                  >
                    <Txt kind="tiny" numberOfLines={1} style={styles.setNo}>{`SET ${String(i + 1)}`}</Txt>
                    <View style={styles.setWords}>
                      <Txt kind="strong" colour="ledRed" style={styles.digitsFont}>{targetWords(plan, s)}</Txt>
                      {weight === null ? null : <Txt kind="strong" colour="ledBlue" style={styles.digitsFont}>{weight}</Txt>}
                      <Txt kind="strong" colour="ledGreen" style={styles.digitsFont}>{restWords(s.restSeconds)}</Txt>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <Button
              label="Change every set"
              kind="link"
              onPress={() => {
                setWhich(null);
              }}
            />
          </>
        ) : (
          <Button
            label="Change one set"
            kind="link"
            onPress={() => {
              setEach(true);
            }}
          />
        )}
        <Button label={`About ${name}`} kind="link" onPress={onAbout} />
        <Button label="Done" kind="plain" wide onPress={onClose} />
      </ScrollView>
    </Sheet>
  );
}

/** Weights that differ from set to set: "35 to 40 kg", or "varies" where some sets take none. */
function weightRange(plan: Plan, units: Units): string {
  const grams = plan.sets.map((s) => s.weightGrams);
  const some = grams.filter((g): g is number => g !== null);
  if (some.length === 0 || some.length < grams.length) return "varies";
  return `${weightParts(Math.min(...some), units)[0]} to ${weightParts(Math.max(...some), units).join(" ")}`;
}

type Press = (field: Field, by: -1 | 1) => void;
type Can = (field: Field, by: -1 | 1) => boolean;

const LESS: Readonly<Record<string, string>> = { sets: "Fewer sets", reps: "Fewer reps", time: "Less time", weight: "Less weight", rest: "Less rest" };
const MORE: Readonly<Record<string, string>> = { sets: "More sets", reps: "More reps", time: "More time", weight: "More weight", rest: "More rest" };

/** A round − or + as a gym timer's buttons; faint and doing nothing at its limit. */
function Round({ field, by, say, press, can }: { field: Field; by: -1 | 1; say: string; press: Press; can: Can }) {
  const ok = can(field, by);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={by < 0 ? LESS[say] : MORE[say]}
      accessibilityState={{ disabled: !ok }}
      disabled={!ok}
      onPress={() => {
        press(field, by);
      }}
      style={({ pressed }) => [styles.round, pressed ? styles.roundPressed : null, ok ? null : styles.faint]}
    >
      <Txt kind="big" style={styles.roundMark}>
        {by < 0 ? "−" : "+"}
      </Txt>
    </Pressable>
  );
}

/** One row of the wall timer: its name, −, the lit digits and their unit, +. */
function Dial({ label, say, field, digits, colour, unit, press, can, first = false }: { label: string; say: string; field: Field; digits: string; colour: ColourName; unit: string | null; press: Press; can: Can; first?: boolean }) {
  return (
    <View style={[styles.row, first ? null : styles.rowSplit]}>
      <View accessible accessibilityLabel={`${label}, ${digits === "--" || digits === "--:--" ? (unit ?? "") : `${digits}${unit === null ? "" : ` ${unit}`}`}`} style={styles.rowName}>
        <Txt kind="tiny" style={styles.label}>
          {label.toUpperCase()}
        </Txt>
      </View>
      <Round field={field} by={-1} say={say} press={press} can={can} />
      <View style={styles.value} accessible={false}>
        <Led text={digits} colour={colour} height={34} />
        {unit === null ? null : (
          <Txt kind="small" colour="timerWords" style={styles.unit}>
            {unit}
          </Txt>
        )}
      </View>
      <Round field={field} by={1} say={say} press={press} can={can} />
    </View>
  );
}

/** A barbell's weight: the number between − and +, and the bar loaded with it in the standard plates. `grams` is
 *  undefined where the sets differ: then no bar is drawn, since no one load is true of them all. */
function BarBox({ entry, grams, range, units, press, can }: { entry: PhoneLibraryEntry; grams: number | null | undefined; range: string; units: Units; press: Press; can: Can }) {
  const plates = grams === undefined ? null : barPlates(entry, units, grams);
  const words = grams === undefined ? range : grams === null ? "None" : weightParts(grams, units).join(" ");
  return (
    <View style={styles.barBox}>
      <View style={styles.barHead}>
        <Round field="weight" by={-1} say="weight" press={press} can={can} />
        <View style={styles.barWords} accessible accessibilityLabel={`Weight, ${words === "None" ? "none" : words}`}>
          <Txt kind="tiny" style={styles.label}>
            WEIGHT
          </Txt>
          <Txt kind={grams === null || grams === undefined ? "strong" : "big"} colour={grams === null || grams === undefined ? "textSoft" : "text"}>
            {words}
          </Txt>
        </View>
        <Round field="weight" by={1} say="weight" press={press} can={can} />
      </View>
      {/* The bar's place is kept when no bar can be drawn, so the box never moves under a finger pressing + or −. */}
      {plates === null ? <View style={styles.barRoom} testID="bar-room" /> : <LoadedBar side={plates} extra={[]} />}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  body: { gap: 12, paddingBottom: 4 },
  faint: { opacity: 0.3 },
  label: { fontFamily: fonts.bold, letterSpacing: 1.1, color: colours.timerWords },
  digitsFont: { fontVariant: ["tabular-nums"] },
  wall: { paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: colours.timerEdge, backgroundColor: colours.timerFace },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10 },
  rowSplit: { borderTopWidth: 1, borderTopColor: colours.timerSplit },
  rowName: { width: 58 },
  value: { flex: 1, flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: 6, minHeight: 36 },
  unit: { paddingBottom: 1 },
  round: {
    width: sizes.press,
    height: sizes.press,
    borderRadius: sizes.press / 2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colours.lineStrong,
    backgroundColor: colours.raised,
  },
  roundPressed: { backgroundColor: colours.box },
  roundMark: { lineHeight: 26 },
  barBox: { gap: 4, paddingTop: 12, paddingBottom: 8, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.raised },
  barHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  barRoom: { height: LOADED_BAR_HEIGHT },
  barWords: { flex: 1, alignItems: "center", gap: 2 },
  list: { borderRadius: 16, borderWidth: 1, borderColor: colours.timerEdge, backgroundColor: colours.timerFace, overflow: "hidden" },
  setLine: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: sizes.press, paddingVertical: 8, paddingHorizontal: 12, borderLeftWidth: 3, borderLeftColor: "transparent" },
  setSplit: { borderTopWidth: 1, borderTopColor: colours.timerSplit },
  setOn: { borderLeftColor: colours.orange, backgroundColor: colours.orangeFill },
  setNo: { minWidth: 46, fontFamily: fonts.bold, letterSpacing: 1, color: colours.timerWords },
  setWords: { flex: 1, flexDirection: "row", flexWrap: "wrap", columnGap: 14 },
});
