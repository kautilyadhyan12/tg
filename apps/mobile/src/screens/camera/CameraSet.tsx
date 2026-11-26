import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent, type NativeSyntheticEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path } from "react-native-svg";
import { NO_VIEW, type LineTone, type LiveSet, type LiveView } from "../../camera/liveSet";
import { PoseCameraView } from "../../camera/poseCameraNative";
import type { PoseEvent } from "../../camera/poseFrame";
import { drawn } from "../../camera/skeleton";
import { colours, shadows } from "../../look/colours";
import { cameraSizes } from "../../look/sizing";
import { Txt } from "../../look/Txt";
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
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const shown = useRef<LiveView>(NO_VIEW);
  // Only the body's lines are drawn again for each picture (`BodyLayer`, told directly); the rest of the screen only when
  // what it says changes. Drawing the whole screen for every picture took the phone's chip from the model (53a's
  // 20-minute run).
  const drawBody = useRef<((view: LiveView) => void) | null>(null);
  const Camera = PoseCameraView;

  const pose = useCallback(
    (e: NativeSyntheticEvent<PoseEvent>) => {
      const next = live.next(e.nativeEvent);
      drawBody.current?.(next);
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
    <View
      testID="camera-screen"
      style={styles.page}
      onLayout={(e: LayoutChangeEvent) => {
        setBox({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
      }}
    >
      {on ? (
        <Camera
          active={!paused}
          onPose={pose}
          onProblem={() => {
            onProblem();
          }}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <Pressable testID="camera-tap" style={StyleSheet.absoluteFill} onPress={onTap} accessibilityRole="button" accessibilityLabel={TAP_WORDS}>
        {/* Paused, or once the set has ended, the camera rests: no line is left on a picture it no longer reads. */}
        {on && !paused && box !== null ? <BodyLayer bind={drawBody} width={box.width} height={box.height} /> : null}
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

/** The body's lines, drawn again for each picture the screen is told of, alone. */
function BodyLayer({ bind, width, height }: { bind: { current: ((view: LiveView) => void) | null }; width: number; height: number }) {
  const [view, setView] = useState<LiveView | null>(null);
  useEffect(() => {
    bind.current = setView;
    return () => {
      bind.current = null;
    };
  }, [bind]);
  return view === null ? null : <Body view={view} width={width} height={height} />;
}

/** The person the camera follows, drawn on their own picture: white-gold lines with a gold glow, a ring on each joint,
 *  and gold corners round them, "Tracking you" over the corners. Nothing when it follows nobody. */
const Body = memo(function Body({ view, width, height }: { view: LiveView; width: number; height: number }) {
  const d = drawn(view.body, view.aspect, width, height);
  if (d.lines.length === 0 && d.joints.length === 0) return null;
  const path = d.lines.map(([x1, y1, x2, y2]) => `M${x1.toFixed(1)},${y1.toFixed(1)}L${x2.toFixed(1)},${y2.toFixed(1)}`).join("");
  const b = d.box;
  const arm = b === null ? 0 : Math.min(26, (b.right - b.left) / 4);
  const corners =
    b === null
      ? ""
      : [
          ["M", b.left, b.top + arm, "V", b.top, "H", b.left + arm],
          ["M", b.right - arm, b.top, "H", b.right, "V", b.top + arm],
          ["M", b.right, b.bottom - arm, "V", b.bottom, "H", b.right - arm],
          ["M", b.left + arm, b.bottom, "H", b.left, "V", b.bottom - arm],
        ]
          .map((part) => part.map((v) => (typeof v === "number" ? v.toFixed(1) : v)).join(" "))
          .join("");
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="camera-body">
      <Svg width={width} height={height}>
        {corners === "" ? null : <Path d={corners} stroke={colours.gold} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" />}
        <Path d={path} stroke={colours.bodyHalo} strokeWidth={16} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <Path d={path} stroke={colours.bodyGlow} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <Path d={path} stroke={colours.bodyLine} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        {d.joints.map(([x, y], k) => (
          <Circle key={`r${String(k)}`} cx={x} cy={y} r={7} fill={colours.bodyJoint} stroke={colours.bodyLine} strokeWidth={2} />
        ))}
        {d.joints.map(([x, y], k) => (
          <Circle key={`d${String(k)}`} cx={x} cy={y} r={2.5} fill={colours.gold} />
        ))}
      </Svg>
      {b === null ? null : (
        <Txt kind="eyebrow" colour="gold" style={[styles.tracking, styles.shadow, { left: b.left, top: b.top - 22 }]}>
          Tracking you
        </Txt>
      )}
    </View>
  );
});

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
  tracking: { position: "absolute" },
});
