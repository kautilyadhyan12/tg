import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, View } from "react-native";
import { colours, orangeGradient, shadows, sizes } from "../../look/colours";
import { Icon, type IconName } from "../../look/Icon";
import { useLoop, useMotion } from "../../look/Motion";
import { fonts, Txt } from "../../look/Txt";

// Scan food as Kd's drawing 2 has it (32c-iii): orange corners on the plate, Meal, Barcode and Label
// in one switch at the foot, and a warm light that sweeps the photo while it is read.

/** The frame's shape, across to down, and how much of the free width it takes. */
const FRAME_SHAPE = 0.9;
const FRAME_WIDTH = 0.82;
const FRAME_GAP = 12;

/** Four orange corners where the plate goes, in the free space between the buttons at the top
 *  (`top`) and the words at the foot (`bottom`): never over either, on a short or folded phone too. */
export function PlateCorners({ top, bottom }: { top: number; bottom: number }) {
  const [room, setRoom] = useState<{ width: number; height: number } | null>(null);
  const across = room === null ? 0 : Math.max(0, Math.min(room.width * FRAME_WIDTH, (room.height - FRAME_GAP * 2) * FRAME_SHAPE));
  return (
    <View
      style={[styles.cornersWrap, { top, bottom }]}
      pointerEvents="none"
      onLayout={(e) => { setRoom({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height }); }}
    >
      <View style={[styles.corners, { width: across, height: across / FRAME_SHAPE }]} testID="plate-corners">
        <View style={[styles.corner, styles.topLeft]} />
        <View style={[styles.corner, styles.topRight]} />
        <View style={[styles.corner, styles.bottomLeft]} />
        <View style={[styles.corner, styles.bottomRight]} />
      </View>
    </View>
  );
}

export interface ModeChoice<T extends string> {
  value: T;
  label: string;
  icon: IconName;
}

/** Choices side by side in one rounded switch, each with its picture; the picked one is orange.
 *  Each takes an equal share of the width, so the switch stays one line on the smallest phone. */
export function ModeSwitch<T extends string>({ choices, on, onPick }: { choices: readonly ModeChoice<T>[]; on: T; onPick: (value: T) => void }) {
  return (
    <View style={styles.switch} accessibilityRole="radiogroup">
      {choices.map((c) => {
        const picked = c.value === on;
        return (
          <Pressable
            key={c.value}
            accessibilityRole="radio"
            accessibilityLabel={c.label}
            accessibilityState={{ selected: picked }}
            onPress={() => { onPick(c.value); }}
            style={({ pressed }) => [styles.mode, picked ? styles.modeOn : null, pressed ? styles.pressed : null]}
          >
            <Icon name={c.icon} size={16} colour={picked ? "onOrange" : "text"} />
            <Txt colour={picked ? "onOrange" : "text"} style={picked ? styles.modeLabelOn : styles.modeLabel} numberOfLines={1} fit>
              {c.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Where the circles pulse on the photo, across and down: on the food, never on
 *  the words under it. Drawn, not read from the scan: the server has not answered yet. */
const SPOTS: readonly { left: `${number}%`; top: `${number}%` }[] = [
  { left: "38%", top: "30%" },
  { left: "62%", top: "42%" },
  { left: "44%", top: "56%" },
];
const SPOT = 64;

/** One circle on the food, breathing in turn with the others. */
function Pulse({ left, top, delay }: { left: `${number}%`; top: `${number}%`; delay: number }) {
  const on = useMotion();
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!on) {
      value.setValue(0);
      return undefined;
    }
    const run = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(value, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(value, { toValue: 0, duration: 900, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.delay(600 - delay / 2),
      ]),
    );
    run.start();
    return () => {
      run.stop();
    };
  }, [on, delay, value]);
  const scale = value.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.1] });
  const glow = value.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.9] });
  return (
    <Animated.View style={[styles.spot, { left, top, opacity: on ? glow : 0.8, transform: [{ scale }] }]}>
      <View style={styles.spotHalo} />
      <View style={styles.spotDot} />
    </Animated.View>
  );
}

/** The warm light that sweeps the photo, the circles on the food and a turning arc while it is read.
 *  Still, with the arc and circles shown, where the phone asks for less motion. */
export function ReadingLight({ words }: { words: string }) {
  const on = useMotion();
  const sweep = useLoop(1600);
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!on) return undefined;
    const run = Animated.loop(Animated.timing(turn, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true }));
    run.start();
    return () => {
      run.stop();
    };
  }, [on, turn]);
  // Moved by the measured height: the phone moves a picture smoothly only by a transform.
  const [tall, setTall] = useState(0);
  const translateY = sweep.interpolate({ inputRange: [0, 1], outputRange: [tall * 0.18, tall * 0.72] });
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={(e) => { setTall(e.nativeEvent.layout.height); }}>
      {on && tall > 0 ? (
        <Animated.View style={[styles.sweep, { transform: [{ translateY }] }]} testID="reading-sweep">
          <View style={styles.sweepGlow} />
          <View style={styles.sweepLine} />
        </Animated.View>
      ) : null}
      {SPOTS.map((s, i) => (
        <Pulse key={`${s.left}-${s.top}`} left={s.left} top={s.top} delay={i * 300} />
      ))}
      <View style={styles.readingFoot} accessibilityLiveRegion="polite">
        <Animated.View style={[styles.arc, { transform: [{ rotate }] }]} testID="reading-arc" />
        <Txt kind="h3" style={styles.readingWords}>
          {words}
        </Txt>
      </View>
    </View>
  );
}

const CORNER = 46;
const CORNER_LINE = 4;

const styles = StyleSheet.create({
  pressed: { opacity: 0.85 },
  cornersWrap: { position: "absolute", left: 0, right: 0, alignItems: "center", justifyContent: "center" },
  corners: {},
  corner: { position: "absolute", width: CORNER, height: CORNER, borderColor: colours.orange },
  topLeft: { top: 0, left: 0, borderTopWidth: CORNER_LINE, borderLeftWidth: CORNER_LINE, borderTopLeftRadius: 18 },
  topRight: { top: 0, right: 0, borderTopWidth: CORNER_LINE, borderRightWidth: CORNER_LINE, borderTopRightRadius: 18 },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: CORNER_LINE, borderLeftWidth: CORNER_LINE, borderBottomLeftRadius: 18 },
  bottomRight: { bottom: 0, right: 0, borderBottomWidth: CORNER_LINE, borderRightWidth: CORNER_LINE, borderBottomRightRadius: 18 },
  switch: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 440,
    flexDirection: "row",
    gap: 4,
    padding: 4,
    borderRadius: sizes.round,
    borderWidth: 1,
    borderColor: colours.lineStrong,
    backgroundColor: colours.overWords,
  },
  mode: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: sizes.press, paddingHorizontal: 8, borderRadius: sizes.round },
  modeOn: { backgroundColor: colours.orange, experimental_backgroundImage: orangeGradient, boxShadow: shadows.chip },
  modeLabel: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 15, lineHeight: 20 },
  modeLabelOn: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  sweep: { position: "absolute", top: -30, left: 0, right: 0, height: 60, justifyContent: "center" },
  // A soft light either side of the line, fading to nothing at its edges: never a box.
  sweepGlow: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, experimental_backgroundImage: `linear-gradient(180deg, transparent, ${colours.orangeFill} 45%, ${colours.orangeLine} 50%, ${colours.orangeFill} 55%, transparent)` },
  sweepLine: { height: 2, marginHorizontal: "12%", borderRadius: sizes.round, backgroundColor: colours.orangeLight, boxShadow: shadows.dotGlow },
  spot: { position: "absolute", width: SPOT, height: SPOT, marginLeft: -SPOT / 2, marginTop: -SPOT / 2, alignItems: "center", justifyContent: "center" },
  spotHalo: { position: "absolute", width: SPOT, height: SPOT, borderRadius: sizes.round, borderWidth: 3, borderColor: colours.text, backgroundColor: colours.overPicture, boxShadow: shadows.logo },
  spotDot: { width: 12, height: 12, borderRadius: sizes.round, backgroundColor: colours.text },
  readingFoot: { position: "absolute", left: sizes.edge, right: sizes.edge, bottom: "14%", alignItems: "center", gap: 18 },
  arc: { width: 56, height: 56, borderRadius: sizes.round, borderWidth: 4, borderColor: "transparent", borderBottomColor: colours.orange, borderLeftColor: colours.orange },
  readingWords: { textAlign: "center", textShadowColor: colours.wordShadow, textShadowRadius: 8 },
});
