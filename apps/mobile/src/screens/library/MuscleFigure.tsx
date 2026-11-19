import { useId } from "react";
import Svg, { Defs, G, LinearGradient, Path, Stop } from "react-native-svg";
import { colours } from "../../look/colours";
import { FIGURE_BOX, figureName, type Lit, type Sex, type Side } from "../../library/figure";
import { FIGURES } from "../../library/figures";

const BOX = `${String(FIGURE_BOX.x)} ${String(FIGURE_BOX.y)} ${String(FIGURE_BOX.width)} ${String(FIGURE_BOX.height)}`;

/** One of Kd's body figures, its muscles lit for an exercise: a main muscle glows orange, one also worked is
 *  warm, one that keeps the body steady is outlined, the rest are stone. `off`: muscles drawn darker (no
 *  exercise trains them yet). Width sets the size; the height keeps the drawing's shape. */
export function MuscleFigure({
  sex,
  side,
  lit,
  width,
  off,
}: {
  sex: Sex;
  side: Side;
  lit: ReadonlyMap<string, Lit>;
  width: number;
  off?: ReadonlySet<string>;
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
        if (state === "main") return <Path key={i} d={p.d} fill={`url(#${id}main)`} />;
        if (state === "also") return <Path key={i} d={p.d} fill={colours.muscleAlso} />;
        if (state === "steady") {
          return <Path key={i} d={p.d} fill={colours.muscleSteady} stroke={colours.orangeLight} strokeWidth={4} strokeDasharray="9 7" />;
        }
        return <Path key={i} d={p.d} fill={off?.has(p.m) === true ? colours.muscleOff : `url(#${id}idle)`} />;
      })}
    </Svg>
  );
}
