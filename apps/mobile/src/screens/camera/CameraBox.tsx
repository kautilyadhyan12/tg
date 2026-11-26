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

// The box a tap on the camera screen opens (ROADMAP Stage 5 53a; Kd's drawing of 2026-11-26, board 4, "A tap: reps, weight,
// pause"): everything a person changes in the middle of a set, as the workout's own set has it (64a-ii), in a small box
// from the bottom while the camera goes on counting above it. Once the camera has stopped, it stays open: the set goes on
// by hand.

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
  const insets = useSafeAreaInsets();
  const timed = set.measuredIn === "time";
  const reps = shownReps(set);
  const weight = set.weightGrams === null ? null : weightParts(set.weightGrams, units);
  const main = timed ? `Set done · ${holdWords(set.heldMs / 1000)}` : `Set done · ${repsWords(reps)}`;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {byHand ? null : <Pressable testID="camera-box-close" style={styles.above} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />}
      <View testID="camera-box" style={[styles.box, { paddingBottom: insets.bottom + 18 }]}>
        <View style={styles.grab} />
        <View style={styles.rows}>
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
          <Row label="WEIGHT" less="Less weight" more="More weight" onPress={(by) => { press({ kind: "weight", by, units }); }} line>
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
        </View>
        <Button label={main} onPress={() => { press({ kind: "done" }); }} raised />
        <View style={styles.pills}>
          <Pill icon={set.paused ? "play" : "pause"} words={set.paused ? "Resume" : "Pause"} onPress={() => { press({ kind: set.paused ? "resume" : "pause" }); }} />
          <Pill icon={sound.on ? "volume" : "volumeOff"} words={sound.on ? "Sound on" : "Sound off"} onPress={sound.flip} />
          <Pill words="End" danger onPress={onEnd} />
        </View>
        <View style={styles.links}>
          <Button label="Reset set" kind="link" onPress={() => { press({ kind: "reset" }); }} />
          {byHand ? null : <Button label="Count this set myself" kind="link" onPress={onByHand} />}
          <Button label="Skip exercise" kind="link" onPress={onSkip} />
        </View>
      </View>
    </View>
  );
}

function Row({ label, less, more, onPress, line = false, children }: { label: string; less?: string; more?: string; onPress?: (by: 1 | -1) => void; line?: boolean; children: ReactNode }) {
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

function Pill({ icon, words, danger = false, onPress }: { icon?: IconName; words: string; danger?: boolean; onPress: () => void }) {
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
  pills: { flexDirection: "row", gap: 8 },
  pill: { flex: 1, minHeight: sizes.button, borderRadius: sizes.round, borderWidth: 1, borderColor: colours.lineStrong, backgroundColor: colours.raised, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 10 },
  links: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
});
