import { useCallback, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View, processColor, useWindowDimensions, type NativeSyntheticEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NO_VIEW, type LineTone, type LiveSet, type LiveView } from "../../camera/liveSet";
import { PoseCameraView, type BodyDrawing } from "../../camera/poseCameraNative";
import type { PoseEvent } from "../../camera/poseFrame";
import { BODY_RULES } from "../../camera/skeleton";
import { colours, shadows } from "../../look/colours";
import { MOST_TEXT_GROWTH, cameraSizes } from "../../look/sizing";
import { EYEBROW, Txt, fonts } from "../../look/Txt";
import { soundNative } from "../../sound/soundNative";
import { Led } from "../library/Records";

// The camera screen (ROADMAP Stage 5 53a; Kd's drawing of 2026-11-26, "The camera screen", boards 2 to 5): the selfie
// camera's picture across the whole phone, seen by somebody 2 to 3 metres from it who can press nothing. Over it only
// what they can read from there: the count in the top left in big lit digits, the exercise's reference clip in the top
// right, the person's own body lines and the corners round whom the camera follows, and one line at the foot, only
// while there is something to say. A tap anywhere opens the box of everything else (`children`, the host's own).

export const STOPPED_WORDS = "The camera stopped. Count this set yourself.";
export const SET_UP_WORDS = "Step back until the camera sees you like the picture.";
export const SET_UP_LINE = "Stand the phone on the floor, a bench or a shelf, 2 to 3 m away. From another angle the count may be wrong.";
export const TAP_WORDS = "Tap the screen to change reps, weight or pause";
/** Over the corners round the person the camera follows. */
export const TRACKING_WORDS = "Tracking you";

const argb = (colour: string): number => {
  const n = processColor(colour);
  return typeof n === "number" ? n : 0;
};

/** The person the camera follows, as the phone draws them on their own picture (Kd's drawing): white lines with a gold
 *  glow, a dark ring with a gold dot on each joint, gold corners round them, "Tracking you" over the corners. */
export const BODY_DRAWING: BodyDrawing = {
  ...BODY_RULES,
  words: TRACKING_WORDS.toUpperCase(),
  font: fonts.bold,
  wordsSize: EYEBROW.size,
  wordsLine: EYEBROW.line,
  wordsSpacing: EYEBROW.spacing,
  wordsGrowth: MOST_TEXT_GROWTH,
  line: argb(colours.bodyLine),
  glow: argb(colours.bodyGlow),
  halo: argb(colours.bodyHalo),
  joint: argb(colours.bodyJoint),
  gold: argb(colours.gold),
  shadow: argb(colours.wordShadow),
};

export interface CameraSetProps {
  /** The host's own set, which it asks for the set's end. */
  live: LiveSet;
  /** "Squat · Set 2 of 3". */
  title: string;
  /** The count as the wall timer lights it ("07", "00:12"), and its target ("/ 10"). */
  digits: string;
  of: string;
  paused: boolean;
  /** A short sound for each counted rep. */
  sound: boolean;
  /** The camera is off for the rest of the set: it stopped, or the person counts it themselves. */
  stopped: "failed" | "byHand" | null;
  /** The exercise's reference picture or clip in its tile; null where it has none (the tile is not drawn). */
  reference: ReactNode;
  /** The camera's own count and a hold's time held, each time either changes. */
  onCamera: (reps: number, heldMs: number) => void;
  onProblem: () => void;
  onTap: () => void;
  /** The box over the camera, while open. */
  children?: ReactNode;
}

export function CameraSet({ live, title, digits, of, paused, sound, stopped, reference, onCamera, onProblem, onTap, children }: CameraSetProps) {
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  const sizes = cameraSizes(screen.height);
  const [view, setView] = useState<LiveView>(NO_VIEW);
  const shown = useRef<LiveView>(NO_VIEW);
  const Camera = PoseCameraView;

  // The phone draws the body with each picture itself (`BODY_DRAWING`); the screen is drawn again only when what it says
  // changes. Drawing the whole screen for every picture took the phone's chip from the model (53a's 20-minute run).
  const pose = useCallback(
    (e: NativeSyntheticEvent<PoseEvent>) => {
      const next = live.next(e.nativeEvent);
      const last = shown.current;
      if (saysOtherwise(last, next)) {
        shown.current = next;
        setView(next);
        // A hold's time goes to the set in whole seconds: its target is a number of seconds.
        if (next.reps !== last.reps || second(next.heldMs) !== second(last.heldMs)) onCamera(next.reps, second(next.heldMs) * 1000);
        if (next.flash && !last.flash && sound) soundNative?.play("rep");
      }
    },
    [live, onCamera, sound],
  );

  const on = Camera !== null && stopped === null;
  const line: FootLine | null = stopped === "failed" ? { words: STOPPED_WORDS, tone: "stopped" } : on ? view.line : null;
  const setUp = on && view.stage === "setUp";
  return (
    <View testID="camera-screen" style={styles.page}>
      {on ? (
        <Camera
          active={!paused}
          drawing={BODY_DRAWING}
          onPose={pose}
          onProblem={() => {
            onProblem();
          }}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <Pressable testID="camera-tap" style={StyleSheet.absoluteFill} onPress={onTap} accessibilityRole="button" accessibilityLabel={TAP_WORDS}>
        <View pointerEvents="none" style={[styles.foot, styles.shade]} />
        <View style={[styles.corners, { top: insets.top + 10 }]} pointerEvents="none">
          <View style={styles.count} accessible accessibilityLabel={`${digits} ${of}`}>
            <Led text={digits} colour={view.flash && !paused ? "ledGreen" : "ledRed"} height={sizes.digits} bare />
            <Txt kind="h1" style={styles.of}>
              {of}
            </Txt>
          </View>
          {reference === null ? null : (
            <View style={[styles.tile, { width: sizes.tile.width, height: sizes.tile.height }, setUp ? styles.tileSetUp : null]}>{reference}</View>
          )}
        </View>
        <View style={[styles.bottom, { paddingBottom: insets.bottom + 20 }]} pointerEvents="none">
          {setUp ? (
            <View style={styles.setUp}>
              <Txt kind="h2" style={styles.shadow}>
                {SET_UP_WORDS}
              </Txt>
              <Txt kind="body" colour="text" style={styles.shadow}>
                {SET_UP_LINE}
              </Txt>
            </View>
          ) : (
            <>
              {line === null ? null : <Foot line={line} />}
              <Txt kind="strong" style={[styles.centre, styles.shadow]}>
                {title}
              </Txt>
              {line === null && children === undefined ? (
                <Txt kind="small" colour="text" style={[styles.centre, styles.shadow]}>
                  {TAP_WORDS}
                </Txt>
              ) : null}
            </>
          )}
        </View>
      </Pressable>
      {children}
    </View>
  );
}

/** The line at the foot, or the camera's own end: "stopped", in the page's own dark. */
interface FootLine {
  readonly words: string;
  readonly tone: LineTone | "stopped";
}

/** The one line at the foot: amber for a rep that did not count, red for what the camera cannot see, dark once the camera
 *  has stopped. */
function Foot({ line }: { line: FootLine }) {
  const amber = line.tone === "short";
  return (
    <View testID="camera-line" style={[styles.line, line.tone === "unseen" ? styles.lineRed : amber ? styles.lineAmber : styles.lineDark]} accessibilityLiveRegion="polite">
      <Txt kind={line.tone === "stopped" ? "big" : "h1"} colour={amber ? "onFootAmber" : "text"} style={styles.centre}>
        {line.words}
      </Txt>
    </View>
  );
}

const second = (ms: number): number => Math.floor(ms / 1000);

/** Whether the screen, apart from the body's lines, says anything else after this picture. */
function saysOtherwise(a: LiveView, b: LiveView): boolean {
  return a.stage !== b.stage || a.reps !== b.reps || second(a.heldMs) !== second(b.heldMs) || a.flash !== b.flash || a.line?.words !== b.line?.words || a.line?.tone !== b.line?.tone;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.page, overflow: "hidden" },
  corners: { position: "absolute", left: 16, right: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  count: { flexDirection: "row", alignItems: "flex-end", gap: 10, paddingTop: 6 },
  of: { color: colours.text, textShadowColor: colours.wordShadow, textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } },
  tile: { borderRadius: 18, overflow: "hidden", borderWidth: 1, borderColor: colours.lineStrong, backgroundColor: colours.raised, boxShadow: shadows.cameraTile },
  tileSetUp: { borderWidth: 2, borderColor: colours.orange },
  foot: { position: "absolute", left: 0, right: 0, bottom: 0, height: "22%" },
  shade: { experimental_backgroundImage: `linear-gradient(to bottom, ${colours.cameraShadeClear}, ${colours.cameraShade})` },
  bottom: { position: "absolute", left: 16, right: 16, bottom: 0, gap: 6 },
  setUp: { gap: 8, paddingBottom: 14 },
  line: { minHeight: 68, borderRadius: 20, paddingHorizontal: 20, paddingVertical: 14, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  lineAmber: { backgroundColor: colours.footAmber },
  lineRed: { backgroundColor: colours.footRed },
  lineDark: { backgroundColor: colours.raised, borderWidth: 1, borderColor: colours.lineStrong },
  centre: { textAlign: "center" },
  shadow: { textShadowColor: colours.wordShadow, textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } },
});
