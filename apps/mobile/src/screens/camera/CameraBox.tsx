import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { TryPress, TrySet } from "../../camera/trySet";
import { shownReps } from "../../camera/trySet";
import { holdWords, weightParts, type Units } from "../../library/records";
import { Button } from "../../look/Button";
import { colours, shadows, sizes } from "../../look/colours";
import { Icon, type IconName } from "../../look/Icon";
import { Txt } from "../../look/Txt";
import { Led } from "../library/Records";
import { FIRST_LINE } from "./CameraFirst";

// The box a tap on the camera screen opens (ROADMAP Stage 5 53a; Kd's drawing of 2026-11-26, board 4, "A tap: reps, weight,
// pause"): everything a person changes in the middle of a set, as the workout's own set has it (64a-ii), in a small box
// from the bottom while the camera goes on counting above it. Once the camera has stopped, it stays open: the set goes on
// by hand. Follow along's box (53b-ii) is built of the same pieces.

export interface CameraBoxProps {
  set: TrySet;
  units: Units;
  sound: { on: boolean; flip: () => void };
  press: (p: TryPress) => void;
  /** The camera is off for the rest of the set: the box stays open, with no Count this set myself. */
  byHand: boolean;
  onClose: () => void;
  onByHand: () => void;
  onEnd: () => void;
  onSkip: () => void;
}

/** "7 reps", "1 rep", "20 s". */
export const repsWords = (n: number): string => `${String(n)} ${n === 1 ? "rep" : "reps"}`;

export function CameraBox({ set, units, sound, press, byHand, onClose, onByHand, onEnd, onSkip }: CameraBoxProps) {
  const timed = set.measuredIn === "time";
  const reps = shownReps(set);
  const main = timed ? `Set done · ${holdWords(set.heldMs / 1000)}` : `Set done · ${repsWords(reps)}`;
  return (
    <BoxSheet testID="camera-box" closeID="camera-box-close" onClose={byHand ? null : onClose}>
      <BoxRows>
        {timed ? (
          <Row label="HELD">
            <Led text={String(Math.floor(set.heldMs / 1000))} colour="ledRed" height={30} />
            <Txt kind="small" colour="timerWords">
              s
            </Txt>
          </Row>
        ) : (
          <Row label="REPS" less="One rep less" more="One rep more" onPress={(by) => { press({ kind: "count", by }); }}>
            <Led text={String(reps)} colour="ledRed" height={30} />
            <Txt kind="small" colour="timerWords">
              counted
            </Txt>
          </Row>
        )}
        <Row label="TARGET" less={timed ? "Shorten the target" : "Lower the target"} more={timed ? "Lengthen the target" : "Raise the target"} onPress={(by) => { press({ kind: "target", by }); }} line>
          <Led text={String(set.target)} colour="ledAmber" height={30} />
          <Txt kind="small" colour="timerWords">
            {timed ? "s" : "reps"}
          </Txt>
        </Row>
        <WeightRow grams={set.weightGrams} units={units} onPress={(by) => { press({ kind: "weight", by, units }); }} />
      </BoxRows>
      <Button label={main} onPress={() => { press({ kind: "done" }); }} raised wide />
      <BoxPills>
        <Pill icon={set.paused ? "play" : "pause"} words={set.paused ? "Resume" : "Pause"} onPress={() => { press({ kind: set.paused ? "resume" : "pause" }); }} />
        <Pill icon={sound.on ? "volume" : "volumeOff"} words={sound.on ? "Sound on" : "Sound off"} onPress={sound.flip} />
        <Pill words="End" danger onPress={onEnd} />
      </BoxPills>
      <BoxLinks>
        <Button label="Reset set" kind="link" onPress={() => { press({ kind: "reset" }); }} />
        {byHand ? null : <Button label="Count this set myself" kind="link" onPress={onByHand} />}
        <Button label="Skip exercise" kind="link" onPress={onSkip} />
      </BoxLinks>
      {/* The camera screen's one line of privacy (spec Part 2 §11.8, step 7), here and not over the person. */}
      <Txt kind="small" colour="textSoft" style={styles.privacy}>
        {FIRST_LINE}
      </Txt>
    </BoxSheet>
  );
}

/** The button that opens the set's box, at the foot of the camera screen and of Follow along (Kd's click-through of 53b-ii:
 *  a tap anywhere on the screen opened it, and nobody would know). A tap anywhere still opens it too. */
export function BoxButton({ words, onPress }: { words: string; onPress: () => void }) {
  return (
    <Pressable testID="box-button" accessibilityRole="button" accessibilityLabel={words} onPress={onPress} style={styles.open}>
      <Icon name="sliders" size={18} colour="orangeLight" />
      <Txt kind="strong" colour="text">
        {words}
      </Txt>
    </Pressable>
  );
}

/** The box from the bottom, over the screen: a tap above it closes it, or, with no `onClose`, it stays. */
export function BoxSheet({ testID, closeID, onClose, children }: { testID: string; closeID?: string; onClose: (() => void) | null; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {onClose === null ? <View style={styles.above} pointerEvents="none" /> : <Pressable testID={closeID} style={styles.above} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />}
      <View testID={testID} style={[styles.box, { paddingBottom: insets.bottom + 18 }]}>
        <View style={styles.grab} />
        {children}
      </View>
    </View>
  );
}

/** The box's lit rows, on the wall timer's own dark face. */
export function BoxRows({ children }: { children: ReactNode }) {
  return <View style={styles.rows}>{children}</View>;
}

/** The box's row of round buttons: Pause, Sound, End. */
export function BoxPills({ children }: { children: ReactNode }) {
  return <View style={styles.pills}>{children}</View>;
}

/** The box's last row of words that act: Reset set, Count this set myself, Skip exercise. */
export function BoxLinks({ children }: { children: ReactNode }) {
  return <View style={styles.links}>{children}</View>;
}

/** The set's weight, as the workout's set has it: "None", or the lit number and its unit. */
export function WeightRow({ grams, units, onPress }: { grams: number | null; units: Units; onPress: (by: 1 | -1) => void }) {
  const weight = grams === null ? null : weightParts(grams, units);
  return (
    <Row label="WEIGHT" less="Less weight" more="More weight" onPress={onPress} line>
      {weight === null ? (
        <Txt kind="strong" colour="textSoft">
          None
        </Txt>
      ) : (
        <>
          <Led text={weight[0]} colour="orange" height={30} />
          <Txt kind="small" colour="timerWords">
            {weight[1]}
          </Txt>
        </>
      )}
    </Row>
  );
}

export function Row({ label, less, more, onPress, line = false, children }: { label: string; less?: string; more?: string; onPress?: (by: 1 | -1) => void; line?: boolean; children: ReactNode }) {
  return (
    <View style={[styles.row, line ? styles.rowLine : null]}>
      <Txt kind="tiny" colour="timerWords" style={styles.label}>
        {label}
      </Txt>
      {onPress === undefined ? <View style={styles.roundSpace} /> : <Round mark="minus" say={less ?? ""} onPress={() => { onPress(-1); }} />}
      <View style={styles.value}>{children}</View>
      {onPress === undefined ? <View style={styles.roundSpace} /> : <Round mark="plus" say={more ?? ""} onPress={() => { onPress(1); }} />}
    </View>
  );
}

function Round({ mark, say, onPress }: { mark: IconName; say: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={say} onPress={onPress} style={styles.round} hitSlop={4}>
      <Icon name={mark} size={22} colour="text" />
    </Pressable>
  );
}

export function Pill({ icon, words, danger = false, onPress }: { icon?: IconName; words: string; danger?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={words} onPress={onPress} style={styles.pill}>
      {icon === undefined ? null : <Icon name={icon} size={18} colour="text" filled={icon === "pause" || icon === "play"} />}
      <Txt kind="strong" colour={danger ? "badText" : "text"} numberOfLines={1}>
        {words}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pills: { flexDirection: "row", gap: 8 },
  links: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  above: { flex: 1 },
  box: {
    backgroundColor: colours.box,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: sizes.edge,
    paddingTop: 10,
    gap: 12,
    boxShadow: shadows.sheet,
  },
  grab: { alignSelf: "center", width: 40, height: 4, borderRadius: sizes.round, backgroundColor: colours.grab },
  rows: { borderRadius: 22, borderWidth: 1, borderColor: colours.timerEdge, backgroundColor: colours.timerFace, paddingHorizontal: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 },
  rowLine: { borderTopWidth: 1, borderTopColor: colours.timerSplit },
  label: { width: 66, letterSpacing: 1.1, fontWeight: "700" },
  value: { flex: 1, flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: 6, minHeight: 48 },
  round: { width: 48, height: 48, borderRadius: sizes.round, borderWidth: 1, borderColor: colours.lineStrong, backgroundColor: colours.raised, alignItems: "center", justifyContent: "center" },
  roundSpace: { width: 48 },
  pill: { flex: 1, minHeight: sizes.button, borderRadius: sizes.round, borderWidth: 1, borderColor: colours.lineStrong, backgroundColor: colours.raised, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 10 },
  privacy: { textAlign: "center" },
  open: { alignSelf: "center", minHeight: sizes.button, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, paddingVertical: 8, borderRadius: sizes.round, borderWidth: 1, borderColor: colours.lineStrong, backgroundColor: colours.raised },
});
