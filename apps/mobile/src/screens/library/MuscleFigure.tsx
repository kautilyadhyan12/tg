import { useId } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Stop } from "react-native-svg";
import { colours, sizes } from "../../look/colours";
import { fonts, Txt } from "../../look/Txt";
import { centreOf, FIGURE_BOX, figureName, type Lit, type Sex, type Side } from "../../library/figure";
import { FIGURES } from "../../library/figures";

const BOX = `${String(FIGURE_BOX.x)} ${String(FIGURE_BOX.y)} ${String(FIGURE_BOX.width)} ${String(FIGURE_BOX.height)}`;

/** One of Kd's body figures, its muscles lit for an exercise: a main muscle glows orange, one also worked is
 *  warm, one that keeps the body steady is outlined, the rest are stone. `off`: muscles drawn darker (no
 *  exercise trains them yet). `onTap`: each muscle not `off` is pressed by its shape (Find exercises, 63b). Width
 *  sets the size; the height keeps the drawing's shape. */
export function MuscleFigure({
  sex,
  side,
  lit,
  width,
  off,
  onTap,
}: {
  sex: Sex;
  side: Side;
  lit: ReadonlyMap<string, Lit>;
  width: number;
  off?: ReadonlySet<string>;
  onTap?: (muscle: string) => void;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const parts = FIGURES[figureName(sex, side)];
  const height = Math.round((width * FIGURE_BOX.height) / FIGURE_BOX.width);
  const mains = parts.filter((p) => p.m !== "" && lit.get(p.m) === "main");
  return (
    <Svg testID={`figure-${sex}-${side}`} width={width} height={height} viewBox={BOX} accessible={false}>
      <Defs>
        <LinearGradient id={`${id}main`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colours.orangeLight} />
          <Stop offset="1" stopColor={colours.orangeDeep} />
        </LinearGradient>
        <LinearGradient id={`${id}idle`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={colours.muscleIdle} />
          <Stop offset="1" stopColor={colours.muscleIdleDeep} />
        </LinearGradient>
      </Defs>
      {/* The glow: each main muscle's outline drawn wide and soft under the figure's shapes. */}
      <G>
        {mains.map((p, i) => (
          <Path key={`g${String(i)}`} d={p.d} fill={colours.muscleGlow} stroke={colours.muscleGlow} strokeWidth={26} strokeLinejoin="round" />
        ))}
      </G>
      {parts.map((p, i) => {
        const state = p.m === "" ? undefined : lit.get(p.m);
        if (p.m === "") return <Path key={i} d={p.d} fill={colours.figureBare} />;
        const muscle = p.m;
        const tap = onTap === undefined || off?.has(muscle) === true ? {} : { testID: `muscle-${muscle}`, onPress: () => { onTap(muscle); } };
        if (state === "main") return <Path key={i} d={p.d} fill={`url(#${id}main)`} {...tap} />;
        if (state === "also") return <Path key={i} d={p.d} fill={colours.muscleAlso} {...tap} />;
        if (state === "steady") {
          return <Path key={i} d={p.d} fill={colours.muscleSteady} stroke={colours.orangeLight} strokeWidth={4} strokeDasharray="9 7" {...tap} />;
        }
        return <Path key={i} d={p.d} fill={off?.has(muscle) === true ? colours.muscleOff : `url(#${id}idle)`} {...tap} />;
      })}
    </Svg>
  );
}

/** A line from a drawn muscle to its name, in the space beside the figure's head; `note` in a second pill beside
 *  the name (Find exercises: "1 exercise"). Nothing when this side does not show the muscle. */
export function MuscleLeader({ sex, side, muscle, name, note, width }: { sex: Sex; side: Side; muscle: string; name: string; note?: string; width: number }) {
  const at = centreOf(figureName(sex, side), muscle);
  if (at === null) return null;
  const scale = width / FIGURE_BOX.width;
  const x1 = (at.x - FIGURE_BOX.x) * scale;
  const y1 = (at.y - FIGURE_BOX.y) * scale;
  const x2 = width * 0.74;
  const y2 = width * 0.12;
  return (
    <>
      <Svg style={StyleSheet.absoluteFill} width={width} height={(width * FIGURE_BOX.height) / FIGURE_BOX.width} accessible={false}>
        <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={colours.orangeLight} strokeWidth={1.5} />
        <Circle cx={x1} cy={y1} r={4} fill={colours.orangeLight} />
      </Svg>
      <View style={[styles.label, { left: x2 - 4, top: y2 - 13 }]}>
        <View style={styles.name}>
          <Txt kind="tiny" colour="onOrange" style={styles.words} numberOfLines={1}>
            {name}
          </Txt>
        </View>
        {note === undefined ? null : (
          <View style={styles.note}>
            <Txt kind="tiny" colour="text" numberOfLines={1}>
              {note}
            </Txt>
          </View>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  label: { position: "absolute", flexDirection: "row", alignItems: "center" },
  name: { paddingHorizontal: 10, minHeight: 26, justifyContent: "center", borderRadius: sizes.round, backgroundColor: colours.orange },
  note: { marginLeft: -6, paddingLeft: 12, paddingRight: 10, minHeight: 26, justifyContent: "center", borderTopRightRadius: sizes.round, borderBottomRightRadius: sizes.round, borderWidth: 1, borderColor: colours.lineStrong, backgroundColor: colours.raised, zIndex: -1 },
  words: { fontFamily: fonts.bold },
});
