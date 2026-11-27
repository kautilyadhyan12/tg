import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { followLeftMs, followedMs, type Follow, type FollowPress } from "../../camera/followAlong";
import { holdWords, type Units } from "../../library/records";
import { Button } from "../../look/Button";
import { colours } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { followDigits } from "../../look/sizing";
import { Txt, fonts } from "../../look/Txt";
import { Led } from "../library/Records";
import { countdown } from "../workout/words";
import { BoxButton, BoxLinks, BoxPills, BoxRows, BoxSheet, Pill, Row, WeightRow, repsWords } from "./CameraBox";

// Follow along (ROADMAP Stage 5 53b-ii; Kd's drawing of 2026-11-27, boards 3 to 6; RULINGS 2026-08-17): the exercise's clip
// fills the phone and a timer runs the set, for a room where the camera may not be able to follow the person. The camera is
// off, and says so where it is turned back on. The timer's digits in the top left as the camera's count is lit there, read
// from 2 to 3 metres; a tap anywhere opens the box of everything else, as the camera screen's does.

export const CAMERA_OFF_WORDS = "Camera off";
export const CAMERA_ON_WORDS = "Tap to turn on";
export const FOLLOW_TAP_WORDS = "Tap the screen to change time, weight or pause";
/** The button at the foot that opens Follow along's box. */
export const FOLLOW_BOX_WORDS = "Time, weight, pause";
export const ASK_REPS_WORDS = "How many reps did you do?";

export interface FollowAlongProps {
  follow: Follow;
  /** "Kettlebell Goblet Squat" and "Set 1 of 1". */
  name: string;
  setWords: string;
  /** The exercise's clip over its picture, filling the space it is given; null where it has none. */
  reference: ReactNode;
  press: (p: FollowPress) => void;
  onTap: () => void;
  /** Back to the camera: the clip to the corner, the camera on, the set started again. */
  onCamera: () => void;
  /** The box over the screen, while open. */
  children?: ReactNode;
}

export function FollowAlong({ follow, name, setWords, reference, press, onTap, onCamera, children }: FollowAlongProps) {
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  const ready = follow.phase === "ready";
  const colour = ready ? "ledAmber" : "ledRed";
  const label = follow.paused ? "PAUSED" : ready ? "GET READY" : "TIME LEFT";
  const digits = countdown(followLeftMs(follow));
  return (
    <View testID="follow-screen" style={styles.page}>
      <Pressable testID="follow-tap" style={styles.page} onPress={onTap} accessibilityRole="button" accessibilityLabel={FOLLOW_TAP_WORDS}>
        <View style={[styles.top, { paddingTop: insets.top + 12 }]} pointerEvents="box-none">
          <View style={styles.timer} accessible accessibilityLabel={`${label.toLowerCase()} ${digits}`} pointerEvents="none">
            <Txt kind="tiny" colour={ready ? "ledAmber" : "text"} style={styles.label}>
              {label}
            </Txt>
            <Led text={digits} colour={colour} height={followDigits(screen.height)} bare />
          </View>
          {/* Once the set has ended there is nothing left for the camera to count: only the person's own answer. */}
          {follow.phase === "done" ? null : (
            <Pressable testID="follow-camera" accessibilityRole="button" accessibilityLabel={`${CAMERA_OFF_WORDS}. ${CAMERA_ON_WORDS}`} onPress={onCamera} style={styles.camera}>
              <Icon name="cameraOff" size={18} colour="text" />
              <View style={styles.cameraWords}>
                <Txt kind="small" colour="text" style={styles.bold}>
                  {CAMERA_OFF_WORDS}
                </Txt>
                <Txt kind="small" colour="textSoft">
                  {CAMERA_ON_WORDS}
                </Txt>
              </View>
            </Pressable>
          )}
        </View>
        <View style={styles.clip} pointerEvents="none">
          {reference}
          <View style={[styles.melt, styles.meltTop]} />
          <View style={[styles.melt, styles.meltFoot]} />
        </View>
        <View style={[styles.foot, { paddingBottom: insets.bottom + 18 }]} pointerEvents="box-none">
          {ready ? (
            <View style={styles.readyRow} pointerEvents="box-none">
              <View style={styles.grow} pointerEvents="none">
                <Txt kind="strong">{name}</Txt>
                <Txt kind="small" colour="text">{`${setWords} · ${holdWords(follow.seconds)}`}</Txt>
              </View>
              <Button label="Start now" raised onPress={() => { press({ kind: "start" }); }} />
            </View>
          ) : (
            <View style={styles.centred} pointerEvents="none">
              <Txt kind="strong" style={styles.centre}>{`${name} · ${setWords}`}</Txt>
            </View>
          )}
          {children === undefined ? <BoxButton words={FOLLOW_BOX_WORDS} onPress={onTap} /> : null}
        </View>
      </Pressable>
      {children}
    </View>
  );
}

export interface FollowBoxProps {
  follow: Follow;
  weightGrams: number | null;
  units: Units;
  sound: { on: boolean; flip: () => void };
  press: (p: FollowPress) => void;
  onWeight: (by: 1 | -1) => void;
  onClose: () => void;
  onByHand: () => void;
  onEnd: () => void;
  onSkip: () => void;
}

/** A tap while following (board 5): the timer's length and the weight, Set done with the time followed, Pause, Sound, End,
 *  and the camera box's three words that act. Its clip and timer go on above it. */
export function FollowBox({ follow, weightGrams, units, sound, press, onWeight, onClose, onByHand, onEnd, onSkip }: FollowBoxProps) {
  return (
    <BoxSheet testID="follow-box" closeID="follow-box-close" onClose={onClose}>
      <BoxRows>
        <Row label="TIME" less="Shorten the time" more="Lengthen the time" onPress={(by) => { press({ kind: "time", by }); }}>
          <Led text={String(follow.seconds)} colour="ledAmber" height={30} />
          <Txt kind="small" colour="timerWords">
            s
          </Txt>
        </Row>
        <WeightRow grams={weightGrams} units={units} onPress={onWeight} />
      </BoxRows>
      <Button label={`Set done · ${holdWords(followedMs(follow) / 1000)}`} onPress={() => { press({ kind: "done" }); }} raised wide />
      <BoxPills>
        <Pill icon={follow.paused ? "play" : "pause"} words={follow.paused ? "Resume" : "Pause"} onPress={() => { press({ kind: follow.paused ? "resume" : "pause" }); }} />
        <Pill icon={sound.on ? "volume" : "volumeOff"} words={sound.on ? "Sound on" : "Sound off"} onPress={sound.flip} />
        <Pill words="End" danger onPress={onEnd} />
      </BoxPills>
      <BoxLinks>
        <Button label="Reset set" kind="link" onPress={() => { press({ kind: "reset" }); }} />
        <Button label="Count this set myself" kind="link" onPress={onByHand} />
        <Button label="Skip exercise" kind="link" onPress={onSkip} />
      </BoxLinks>
    </BoxSheet>
  );
}

/** The timer ended, or Set done (board 6): how long it was followed, and, for a set of reps, the person's own count,
 *  started from that time at 3 s a rep. Nothing of it comes from the clip. */
export function FollowDone({ follow, press, onDone }: { follow: Follow; press: (p: FollowPress) => void; onDone: () => void }) {
  const reps = follow.measuredIn === "reps";
  const time = holdWords(follow.doneMs / 1000);
  return (
    <BoxSheet testID="follow-done" onClose={null}>
      <View style={styles.doneWords}>
        <Txt kind="h2">Set done</Txt>
        <Txt kind="body" colour="text">
          {reps ? `${time} · ${ASK_REPS_WORDS}` : time}
        </Txt>
      </View>
      {reps ? (
        <BoxRows>
          <Row label="REPS" less="One rep less" more="One rep more" onPress={(by) => { press({ kind: "reps", by }); }}>
            <Led text={String(follow.reps)} colour="ledRed" height={30} />
            <Txt kind="small" colour="timerWords">
              {follow.reps === 1 ? "rep" : "reps"}
            </Txt>
          </Row>
        </BoxRows>
      ) : null}
      <Button label={reps ? `Done · ${repsWords(follow.reps)}` : "Done"} onPress={onDone} raised wide />
    </BoxSheet>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.page },
  top: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 10, paddingHorizontal: 16, paddingBottom: 8, backgroundColor: colours.page },
  timer: { gap: 8 },
  label: { fontFamily: fonts.bold, letterSpacing: 1.54 },
  camera: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 12, paddingRight: 16, paddingVertical: 6, borderRadius: 24, borderWidth: 1, borderColor: colours.lineStrong, backgroundColor: colours.raised },
  cameraWords: { flexShrink: 1 },
  bold: { fontFamily: fonts.semibold },
  clip: { flex: 1, overflow: "hidden" },
  melt: { position: "absolute", left: 0, right: 0, height: 32 },
  meltTop: { top: 0, experimental_backgroundImage: `linear-gradient(to bottom, ${colours.page}, ${colours.cameraShadeClear})` },
  meltFoot: { bottom: 0, experimental_backgroundImage: `linear-gradient(to top, ${colours.page}, ${colours.cameraShadeClear})` },
  foot: { paddingHorizontal: 16, paddingTop: 8, gap: 10, backgroundColor: colours.page },
  readyRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  grow: { flex: 1, gap: 2 },
  centred: { alignItems: "center", gap: 4 },
  centre: { textAlign: "center" },
  doneWords: { gap: 4, paddingTop: 8 },
});
