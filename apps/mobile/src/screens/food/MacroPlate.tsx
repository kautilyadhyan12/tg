import { useId } from "react";
import { Image, StyleSheet, View } from "react-native";
import Svg, { Circle, ClipPath, Defs, G, Image as SvgImage, LinearGradient, Path, RadialGradient, Stop } from "react-native-svg";
import { colours } from "../../look/colours";
import { Fork, Knife } from "../../look/Cutlery";
import { pictures } from "../../look/pictures";
import { Txt } from "../../look/Txt";
import { NOT_KNOWN, count } from "../dashboard/words";
import { PART_SWEEP, PLATE_PARTS, edgePath, fillReach, partPath, plateShare } from "./plateRules";

// Today's macros on a plate (32c-i, Kd's drawing of 2026-11-14: "use some imagination", not rings): a plate
// with a fork and a knife; its rim glows with the calories eaten of the day's number, and its three
// parts fill from the middle outward with chicken (protein), quinoa (carbs) and avocado (fat) as they are
// eaten. Under it, each figure's numbers in words. Every number is the server's.

const SIZE = 224;
const C = SIZE / 2;
const RIM = 100;
const WELL = 90;
const HUB = 35;
const INNER = 36;
const OUTER = 82;

export interface PlateNumbers {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/** `eaten` is null where a meal of the day has no numbers yet: the plate stays empty, never guessed. */
export function MacroPlate({ goal, eaten, left }: { goal: PlateNumbers; eaten: PlateNumbers | null; left: ((key: keyof PlateNumbers) => string) | null }) {
  const id = useId().replace(/:/g, "");
  const around = 2 * Math.PI * RIM;
  const calShare = plateShare(eaten?.kcal ?? null, goal.kcal);
  return (
    <View style={styles.box}>
      <View style={styles.table}>
        <Fork height={150} />
        <View
          style={styles.plate}
          accessible
          accessibilityLabel={`Calories, ${eaten === null ? "not known" : count(eaten.kcal)} of ${count(goal.kcal)} kcal`}
        >
          <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${String(SIZE)} ${String(SIZE)}`}>
            <Defs>
              <RadialGradient id={`rim${id}`} cx="38%" cy="32%" r="80%">
                <Stop offset="0" stopColor={colours.plateRim} />
                <Stop offset="1" stopColor={colours.raised} />
              </RadialGradient>
              <LinearGradient id={`cal${id}`} x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={colours.orangeLight} />
                <Stop offset="1" stopColor={colours.calDeep} />
              </LinearGradient>
              {PLATE_PARTS.map((p) => (
                <ClipPath key={p.key} id={`${p.key}${id}`}>
                  <Path d={partPath(C, C, p.from, p.from + PART_SWEEP, INNER, fillReach(plateShare(eaten?.[p.key] ?? null, goal[p.key]), INNER, OUTER))} />
                </ClipPath>
              ))}
            </Defs>
            <Circle cx={C} cy={C} r={C - 4} fill={`url(#rim${id})`} stroke={colours.plateEdge} strokeWidth={1} />
            <Path d={edgePath(C, C, 200, 290, 104)} stroke={colours.plateRimLight} strokeWidth={2} strokeLinecap="round" fill="none" />
            <Circle cx={C} cy={C} r={RIM} stroke={colours.scrim} strokeWidth={9} fill="none" />
            {calShare > 0 ? (
              <Circle
                cx={C}
                cy={C}
                r={RIM}
                stroke={`url(#cal${id})`}
                strokeWidth={7}
                strokeLinecap="round"
                fill="none"
                strokeDasharray={`${String(around * calShare)} ${String(around)}`}
                transform={`rotate(-90 ${String(C)} ${String(C)})`}
              />
            ) : null}
            <Circle cx={C} cy={C} r={WELL} fill={colours.plateWell} stroke={colours.scrim} strokeWidth={2} />
            {PLATE_PARTS.map((p) => {
              const share = plateShare(eaten?.[p.key] ?? null, goal[p.key]);
              const reach = fillReach(share, INNER, OUTER);
              const to = p.from + PART_SWEEP;
              return (
                <G key={p.key}>
                  <Path d={partPath(C, C, p.from, to, INNER, OUTER)} fill={colours.glass} stroke={colours[p.colour]} strokeOpacity={0.5} strokeWidth={1.2} strokeDasharray="3 3" />
                  {share > 0 ? (
                    <>
                      <G clipPath={`url(#${p.key}${id})`}>
                        <G transform={`translate(${String(C - OUTER)} ${String(C - OUTER)})`}>
                          <SvgImage href={pictures[p.picture]} width={OUTER * 2} height={OUTER * 2} preserveAspectRatio="xMidYMid slice" />
                        </G>
                      </G>
                      <Path d={edgePath(C, C, p.from + 1, to - 1, reach)} stroke={colours[p.colour]} strokeWidth={3} strokeLinecap="round" fill="none" />
                    </>
                  ) : null}
                </G>
              );
            })}
            <Circle cx={C} cy={C} r={HUB} fill={colours.page} stroke={colours.lineStrong} strokeWidth={1} />
          </Svg>
          <View style={styles.hub} pointerEvents="none">
            <Txt kind="strong" numberOfLines={1} fit style={styles.hubNumber}>
              {eaten === null ? NOT_KNOWN : count(eaten.kcal)}
            </Txt>
            <Txt kind="tiny" colour="textSoft" numberOfLines={1} fit>
              of {count(goal.kcal)} kcal
            </Txt>
          </View>
        </View>
        <Knife height={150} />
      </View>
      <View style={styles.parts}>
        {PLATE_PARTS.map((p) => {
          const had = eaten === null ? null : eaten[p.key];
          return (
            <View key={p.key} style={styles.part} accessible accessibilityLabel={`${p.name}, ${had === null ? "not known" : count(had)} of ${count(goal[p.key])} g`}>
              <View style={[styles.food, { borderColor: colours[p.colour] }]}>
                <Image source={pictures[p.picture]} resizeMode="cover" style={styles.fill} accessible={false} />
              </View>
              <Txt kind="tiny" colour="textSoft">
                {p.name}
              </Txt>
              <Txt kind="strong" numberOfLines={1} fit>
                {had === null ? NOT_KNOWN : count(had)}
                <Txt kind="tiny"> / {count(goal[p.key])} g</Txt>
              </Txt>
              {left === null ? null : <Txt kind="tiny">{left(p.key)}</Txt>}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 12 },
  table: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12 },
  plate: { width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center" },
  hub: { position: "absolute", width: HUB * 2 - 6, alignItems: "center" },
  hubNumber: { fontSize: 19, lineHeight: 23 },
  parts: { flexDirection: "row", gap: 8 },
  part: { flex: 1, alignItems: "center", gap: 3 },
  food: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, overflow: "hidden" },
  fill: { width: "100%", height: "100%" },
});
