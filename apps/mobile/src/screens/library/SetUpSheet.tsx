import type { PhoneLibraryEntry } from "@app/shared";
import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { Button } from "../../look/Button";
import { colours, sizes, type ColourName } from "../../look/colours";
import { useMotion } from "../../look/Motion";
import { Sheet } from "../../look/Sheet";
import { fonts, Txt } from "../../look/Txt";
import type { Plan } from "../../library/myWorkout";
import { weightParts, type Units } from "../../library/records";
import { canStep, changed, clockDigits, restWords, targetWords, typedWeight, withWeight, type Field } from "../../library/workoutSetup";
import { Led } from "./Records";
import { PlateFace } from "./WeightPlate";

// Setting up one exercise of My Workout (ROADMAP Stage 5 64a-i, Kd's drawing of 2026-11-20): the box from the bottom.
// The weight is a weight plate with its number, the same for every exercise (Kd's click-through: "a symbol that can go
// with any exercises ... not a barbell"); sets, reps or time and the rest are lit on the gym's LED wall timer, each in
// its own colour. Under them the sets, always shown: "Every set" at the top, then each set; the line picked is what
// the controls change, and they always show its real numbers (Kd's click-through, 2026-11-20). Each press is kept at
// once; Done closes it.

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
  // A weight being typed is kept here, not in the plate, so every way of leaving it keeps it (review H1, L2): Done,
  // ✕, the background, Back, About, another set, + or −. Only Done and Set weight keep the box open where it cannot
  // be read; the others leave it, as a person pressing them is done with it.
  const [typing, setTyping] = useState<string | null>(null);
  const [wrong, setWrong] = useState<"unread" | "heavy" | null>(null);
  const one = which !== null && which < plan.sets.length ? which : null;
  const barbell = entry.equipment.includes("barbell");
  const shown = plan.sets[one ?? 0];
  const name = entry.text.en.name;
  if (shown === undefined) return null;
  /** The plan with the weight being typed put on the set it was typed for; null where it cannot be read and the box
   *  should stay to say so. */
  const settled = (stayIfWrong: boolean): Plan | null => {
    if (typing === null) return plan;
    const read = typedWeight(typing, units);
    if (read.kind !== "ok" && stayIfWrong) {
      setWrong(read.kind);
      return null;
    }
    setTyping(null);
    setWrong(null);
    return read.kind === "ok" ? withWeight(plan, read.grams, one) : plan;
  };
  const keep = (next: Plan) => {
    if (next !== plan) onChange(next);
  };
  const press = (field: Field, by: -1 | 1) => {
    const base = settled(false) ?? plan;
    keep(changed(base, field, by, field === "sets" ? null : one, units, barbell));
  };
  const can = (field: Field, by: -1 | 1) => canStep(plan, field, by, field === "sets" ? null : one, units, barbell);
  const pick = (i: number | null) => {
    const base = settled(false);
    if (base !== null) keep(base);
    setWhich(i);
  };
  const leave = (then: () => void) => {
    const base = settled(false);
    if (base !== null) keep(base);
    then();
  };
  const finishTyping = () => {
    const base = settled(true);
    if (base !== null) keep(base);
  };
  const time = plan.measuredIn === "time";

  return (
    <Sheet
      open
      title={name}
      onClose={() => {
        leave(onClose);
      }}
      onBack={() => {
        if (typing !== null) {
          // Back keeps the box open, so words that cannot be read are said, as Done says them (re-check L7).
          const base = settled(true);
          if (base !== null) keep(base);
          return true;
        }
        if (one === null) return false;
        setWhich(null);
        return true;
      }}
    >
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {one === null ? null : <Txt kind="small" colour="orange">{`Set ${String(one + 1)} only`}</Txt>}
        <WeightBox
          grams={shown.weightGrams}
          units={units}
          press={press}
          can={can}
          typing={typing}
          wrong={wrong}
          onStart={() => {
            setWrong(null);
            setTyping(shown.weightGrams === null ? "" : weightParts(shown.weightGrams, units)[0]);
          }}
          onTyped={(t) => {
            setTyping(t);
            setWrong(null);
          }}
          onFinish={finishTyping}
        />
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
              pick(null);
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
                  pick(i);
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
      </ScrollView>
      {/* The foot stays whole under the sets, never half under the box's edge while they scroll. */}
      <View style={styles.foot}>
        <Button
          label="About"
          kind="link"
          icon="info"
          say={`About ${name}`}
          onPress={() => {
            leave(onAbout);
          }}
        />
        <Button
          label="Done"
          kind="plain"
          style={styles.done}
          onPress={() => {
            const base = settled(true);
            if (base === null) return;
            keep(base);
            onClose();
          }}
        />
      </View>
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

const PLATE = 112;
const HALO = 136;

/** The weight of the picked set (or the first, for every set), the same for every exercise: a bumper plate in the
 *  app's own orange, light running deep as its main buttons (Kd: "orange type vibe better", after a red face and a
 *  black one), with a soft orange glow, its steel hub, the number above the hub and the unit below, as a real plate
 *  is printed; black rubber reading "NONE" for no weight. It pops a little each time the weight changes, unless the
 *  phone asks for less motion. Always the same size, so the box never moves under a finger pressing + or −. */
interface WeightBoxProps {
  grams: number | null;
  units: Units;
  press: Press;
  can: Can;
  /** The words being typed on the plate, or null. */
  typing: string | null;
  wrong: "unread" | "heavy" | null;
  onStart: () => void;
  onTyped: (text: string) => void;
  onFinish: () => void;
}

function WeightBox({ grams, units, press, can, typing, wrong, onStart, onTyped, onFinish }: WeightBoxProps) {
  const [n, unit] = grams === null ? ["None", ""] : weightParts(grams, units);
  const unitWord = units === "imperial" ? "lb" : "kg";
  const motion = useMotion();
  const pop = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!motion) return;
    pop.setValue(0.9);
    Animated.spring(pop, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true }).start();
  }, [grams, motion, pop]);
  return (
    <View style={styles.weightBox}>
      <Round field="weight" by={-1} say="weight" press={press} can={can} />
      <View style={styles.weightMiddle}>
        <Txt kind="tiny" style={styles.label}>
          WEIGHT
        </Txt>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={grams === null ? "Weight, none" : `Weight, ${n} ${unit}`}
          accessibilityHint="Type a weight"
          disabled={typing !== null}
          onPress={onStart}
          style={styles.halo}
        >
          <Svg width={HALO} height={HALO} style={StyleSheet.absoluteFill} accessible={false}>
            <Circle cx={HALO / 2} cy={HALO / 2} r={HALO / 2 - 2} fill={colours.orange} fillOpacity={grams === null ? 0 : 0.08} />
            <Circle cx={HALO / 2} cy={HALO / 2} r={HALO / 2 - 10} fill={colours.orange} fillOpacity={grams === null ? 0 : 0.12} />
          </Svg>
          <Animated.View style={[styles.plate, { transform: [{ scale: pop }] }]} testID="weight-plate">
            <PlateFace size={PLATE} none={grams === null} />
            {typing === null ? (
              <Txt kind="big" colour={grams === null ? "textSoft" : "onOrange"} numberOfLines={1} fit style={[styles.plateNumber, grams === null ? styles.plateNoneWords : null]}>
                {grams === null ? "NONE" : n}
              </Txt>
            ) : (
              <TextInput
                value={typing}
                onChangeText={onTyped}
                onSubmitEditing={onFinish}
                keyboardType="decimal-pad"
                returnKeyType="done"
                autoFocus
                selectTextOnFocus
                maxLength={7}
                placeholder="0"
                placeholderTextColor={colours.textFaint}
                accessibilityLabel={`Weight in ${unitWord}`}
                style={styles.plateInput}
              />
            )}
            {grams === null && typing === null ? null : (
              <Txt kind="tiny" colour={grams === null && typing !== null ? "textSoft" : "onOrange"} style={styles.plateUnit}>
                {unitWord.toUpperCase()}
              </Txt>
            )}
          </Animated.View>
        </Pressable>
        {wrong === null ? null : (
          <Txt kind="small" colour="badText" style={styles.centre}>
            {wrong === "heavy" ? (units === "imperial" ? "Enter a weight up to 2,204 lb." : "Enter a weight up to 1,000 kg.") : `Enter a weight such as ${units === "imperial" ? "135" : "47.5"}.`}
          </Txt>
        )}
        <Button label={typing === null ? "Type a weight" : "Set weight"} kind="link" icon={typing === null ? "pen" : "check"} style={styles.underPlate} onPress={typing === null ? onStart : onFinish} />
      </View>
      <Round field="weight" by={1} say="weight" press={press} can={can} />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 1 },
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
  weightMiddle: { flex: 1, alignItems: "center", gap: 2 },
  halo: { width: HALO, height: HALO, alignItems: "center", justifyContent: "center" },
  plate: { width: PLATE, height: PLATE },
  plateNumber: { position: "absolute", top: 13, left: 18, right: 18, textAlign: "center", fontFamily: fonts.bold, fontSize: 24, lineHeight: 28 },
  plateNoneWords: { fontSize: 15, letterSpacing: 1.5, top: 17 },
  centre: { textAlign: "center" },
  underPlate: { alignSelf: "center" },
  foot: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10 },
  done: { flex: 1 },
  plateInput: {
    position: "absolute",
    top: 8,
    left: 22,
    right: 22,
    padding: 0,
    textAlign: "center",
    fontFamily: fonts.bold,
    fontSize: 24,
    lineHeight: 30,
    color: colours.onOrange,
    borderBottomWidth: 2,
    borderBottomColor: colours.onOrange,
  },
  plateUnit: { position: "absolute", bottom: 20, left: 0, right: 0, textAlign: "center", fontFamily: fonts.bold, letterSpacing: 1.5 },
  list: { borderRadius: 16, borderWidth: 1, borderColor: colours.timerEdge, backgroundColor: colours.timerFace, overflow: "hidden" },
  setLine: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: sizes.press, paddingVertical: 8, paddingHorizontal: 12, borderLeftWidth: 3, borderLeftColor: "transparent" },
  setSplit: { borderTopWidth: 1, borderTopColor: colours.timerSplit },
  setOn: { borderLeftColor: colours.orange, backgroundColor: colours.orangeFill },
  setNo: { minWidth: 46, fontFamily: fonts.bold, letterSpacing: 1, color: colours.timerWords },
  everyWords: { flex: 1 },
  setWords: { flex: 1, flexDirection: "row", flexWrap: "wrap", columnGap: 14 },
});
