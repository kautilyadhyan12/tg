// A saved run as a line of Your runs (ROADMAP Stage 5 37c-i): its route drawn small, as the summary
// draws it (white-gold, glowing), its name, when it was, and its distance, time and pace. Pressed, its
// own page opens.
import { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { decodeShape, type RunSummary, type Units } from "@app/shared";
import { colours, sizes } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { fonts, Txt } from "../../look/Txt";
import { fitPath, pathOf } from "./routeShape";
import { clock, distance, pace, paceWord, runWhen, unitWord } from "./runWords";

const THUMB = 56;

/** The route in a small square: the whole of it, true to its shape; the footprints for a run with none. */
export function RouteThumb({ shape, size = THUMB }: { shape: string | null; size?: number }) {
  const drawn = useMemo(() => {
    if (shape === null) return null;
    const { track, starts } = decodeShape(shape);
    const points = fitPath(track, size, size, 7);
    const first = points[0];
    const last = points[points.length - 1];
    return first === undefined || last === undefined || points.length < 2 ? null : { d: pathOf(points, starts), first, last };
  }, [shape, size]);
  return (
    <View style={[styles.thumb, { width: size, height: size }]} accessible={false}>
      {drawn === null ? (
        <Icon name="footprints" size={22} colour="orange" />
      ) : (
        <Svg width={size} height={size}>
          <Defs>
            <LinearGradient id="thumb" x1={drawn.first[0]} y1={drawn.first[1]} x2={drawn.last[0]} y2={drawn.last[1]} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor={colours.gold} stopOpacity={0.6} />
              <Stop offset="0.6" stopColor={colours.flamePale} />
              <Stop offset="1" stopColor={colours.trail} />
            </LinearGradient>
          </Defs>
          <Path d={drawn.d} stroke={colours.gold} strokeOpacity={0.16} strokeWidth={6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Path d={drawn.d} stroke="url(#thumb)" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Circle cx={drawn.last[0]} cy={drawn.last[1]} r={2.6} fill={colours.trail} />
        </Svg>
      )}
    </View>
  );
}

/** "9.59 kilometres, 1:02:44, pace 6:32 a kilometre": the line read aloud, in whole words. */
export function runNumbersSaid(run: Pick<RunSummary, "distanceM" | "durationS">, units: Units): string {
  const each = pace(run.durationS, run.distanceM < 50 ? 0 : run.distanceM, units);
  // The pace the line shows: none under 50 m, as the summary's.
  return `${distance(run.distanceM, units)} ${units === "imperial" ? "miles" : "kilometres"}, ${clock(run.durationS)}, ${each === "--:--" ? "no pace" : `pace ${each} ${units === "imperial" ? "a mile" : "a kilometre"}`}`;
}

/** One run of the list. */
export function RunRow({ run, units, onOpen, line = true }: { run: RunSummary; units: Units; onOpen: (id: string) => void; line?: boolean }) {
  const when = runWhen(new Date(run.startedAt));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${run.name}, ${when}, ${runNumbersSaid(run, units)}`}
      onPress={() => {
        onOpen(run.id);
      }}
      style={({ pressed }) => [styles.row, line ? styles.rowLine : null, pressed ? styles.pressed : null]}
    >
      <RouteThumb shape={run.shape} />
      <View style={styles.grow}>
        <Txt kind="strong" numberOfLines={1}>
          {run.name}
        </Txt>
        <Txt kind="small" colour="textFaint" numberOfLines={1}>
          {when}
        </Txt>
        <View style={styles.numbers}>
          <Txt style={styles.number}>
            {distance(run.distanceM, units)}
            <Txt style={styles.unit}> {unitWord(units)}</Txt>
          </Txt>
          <Txt style={styles.number}>{clock(run.durationS)}</Txt>
          <Txt style={styles.number}>
            {pace(run.durationS, run.distanceM < 50 ? 0 : run.distanceM, units)}
            <Txt style={styles.unit}> {paceWord(units)}</Txt>
          </Txt>
        </View>
      </View>
      <Icon name="go" size={18} colour="textFaint" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  thumb: {
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colours.tabBar,
    borderWidth: 1,
    borderColor: colours.lineStrong,
    overflow: "hidden",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, minHeight: sizes.press },
  rowLine: { borderTopWidth: 1, borderTopColor: colours.line },
  pressed: { opacity: 0.8 },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  numbers: { flexDirection: "row", flexWrap: "wrap", columnGap: 14, marginTop: 4 },
  number: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 19, color: colours.text },
  unit: { fontFamily: fonts.medium, fontSize: 11, color: colours.textFaint },
});
