import type { PhoneLibraryEntry } from "@app/shared";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { Button } from "../../look/Button";
import { colours, sizes, type ColourName } from "../../look/colours";
import { Sheet } from "../../look/Sheet";
import { fonts, Txt } from "../../look/Txt";
import type { Plan } from "../../library/myWorkout";
import { weightParts, type Units } from "../../library/records";
import { canStep, changed, clockDigits, restWords, targetWords, type Field } from "../../library/workoutSetup";
import { Led } from "./Records";

// Setting up one exercise of My Workout (ROADMAP Stage 5 64a-i, Kd's drawing of 2026-11-20): the box from the bottom.
// The weight is a weight plate with its number, the same for every exercise (Kd's click-through: "a symbol that can go
// with any exercises ... not a barbell"); sets, reps or time and the rest are lit on the gym's LED wall timer, each in
// its own colour. Under them the sets, always shown: "Every set" at
// the top, then each set; the line picked is what the controls change, and they always show its real numbers
// (Kd's click-through, 2026-11-20). Each press is kept at once; Done closes it.

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
  const one = which !== null && which < plan.sets.length ? which : null;
  const barbell = entry.equipment.includes("barbell");
  const shown = plan.sets[one ?? 0];
  const name = entry.text.en.name;
  if (shown === undefined) return null;
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
        if (one === null) return false;
        setWhich(null);
        return true;
      }}
    >
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {one === null ? null : <Txt kind="small" colour="orange">{`Set ${String(one + 1)} only`}</Txt>}
        <WeightBox grams={shown.weightGrams} units={units} press={press} can={can} />
        <View style={styles.wall}>
          <Dial label="Sets" say="sets" field="sets" digits={String(plan.sets.length)} colour="ledAmber" unit={null} press={press} can={can} first />
          {time ? (
            <Dial label="Time" say="time" field="target" digits={clockDigits(shown.target)} colour="ledRed" unit={null} press={press} can={can} />
          ) : (
            <Dial label="Reps" say="reps" field="target" digits={String(shown.target)} colour="ledRed" unit="reps" press={press} can={can} />
          )}
          <Dial label="Rest" say="rest" field="rest" digits={clockDigits(shown.restSeconds ?? 0)} colour="ledGreen" unit={null} press={press} can={can} />
        </View>
        <View style={styles.list}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Every set"
            accessibilityState={{ selected: one === null }}
            onPress={() => {
              setWhich(null);
            }}
            style={[styles.setLine, one === null ? styles.setOn : null]}
          >
            <Txt kind="strong" style={styles.everyWords}>
              Every set
            </Txt>
            <Txt kind="small" colour="timerWords">{`${String(plan.sets.length)} ${plan.sets.length === 1 ? "set" : "sets"}`}</Txt>
          </Pressable>
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
                    style={[styles.setLine, styles.setSplit, on ? styles.setOn : null]}
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
        <Button label={`About ${name}`} kind="link" onPress={onAbout} />
        <Button label="Done" kind="plain" wide onPress={onClose} />
      </ScrollView>
    </Sheet>
  );
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

const PLATE = 84;

/** The weight of the picked set (or the first, for every set): a weight plate with its number on it, between − and +,
 *  the same for every exercise; with none, the plate is faint and reads "None". It is always the same size, so the box
 *  never moves under a finger pressing + or −. */
function WeightBox({ grams, units, press, can }: { grams: number | null; units: Units; press: Press; can: Can }) {
  const [n, unit] = grams === null ? ["None", ""] : weightParts(grams, units);
  return (
    <View style={styles.weightBox}>
      <Round field="weight" by={-1} say="weight" press={press} can={can} />
      <View style={styles.weightMiddle} accessible accessibilityLabel={grams === null ? "Weight, none" : `Weight, ${n} ${unit}`}>
        <Txt kind="tiny" style={styles.label}>
          WEIGHT
        </Txt>
        <View style={[styles.plate, grams === null ? styles.plateNone : null]} testID="weight-plate">
          <Svg width={PLATE} height={PLATE} style={StyleSheet.absoluteFill} accessible={false}>
            <Circle cx={PLATE / 2} cy={PLATE / 2} r={PLATE / 2 - 1} fill={colours.weightPlate} stroke={colours.weightPlateRim} strokeWidth={2} />
            <Circle cx={PLATE / 2} cy={PLATE / 2} r={PLATE / 2 - 9} fill="none" stroke={colours.weightPlateGroove} strokeWidth={2} />
            <Circle cx={PLATE / 2} cy={PLATE / 2} r={5} fill={colours.timerFace} stroke={colours.weightPlateGroove} strokeWidth={1.5} />
          </Svg>
          <Txt kind={grams === null ? "strong" : "big"} colour={grams === null ? "textSoft" : "text"} numberOfLines={1} fit style={styles.plateNumber}>
            {n}
          </Txt>
          {grams === null ? null : (
            <Txt kind="tiny" colour="textSoft" style={styles.plateUnit}>
              {unit}
            </Txt>
          )}
        </View>
      </View>
      <Round field="weight" by={1} say="weight" press={press} can={can} />
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
  weightBox: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.raised },
  weightMiddle: { flex: 1, alignItems: "center", gap: 6 },
  plate: { width: PLATE, height: PLATE, alignItems: "center", justifyContent: "center" },
  plateNone: { opacity: 0.55 },
  plateNumber: { maxWidth: PLATE - 22, marginTop: -6, textAlign: "center" },
  plateUnit: { position: "absolute", bottom: 14 },
  list: { borderRadius: 16, borderWidth: 1, borderColor: colours.timerEdge, backgroundColor: colours.timerFace, overflow: "hidden" },
  setLine: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: sizes.press, paddingVertical: 8, paddingHorizontal: 12, borderLeftWidth: 3, borderLeftColor: "transparent" },
  setSplit: { borderTopWidth: 1, borderTopColor: colours.timerSplit },
  setOn: { borderLeftColor: colours.orange, backgroundColor: colours.orangeFill },
  setNo: { minWidth: 46, fontFamily: fonts.bold, letterSpacing: 1, color: colours.timerWords },
  everyWords: { flex: 1 },
  setWords: { flex: 1, flexDirection: "row", flexWrap: "wrap", columnGap: 14 },
});
