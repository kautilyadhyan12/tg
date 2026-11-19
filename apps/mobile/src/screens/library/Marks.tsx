import { useId } from "react";
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { colours } from "../../look/colours";
import { Icon } from "../../look/Icon";

/** A rounded box as a path (react-native-svg's Rect takes its place by props it marks as going away). */
function box(x: number, y: number, w: number, h: number, r: number): string {
  return `M${String(x + r)} ${String(y)}h${String(w - 2 * r)}a${String(r)} ${String(r)} 0 0 1 ${String(r)} ${String(r)}v${String(h - 2 * r)}a${String(r)} ${String(r)} 0 0 1 ${String(-r)} ${String(r)}h${String(-(w - 2 * r))}a${String(r)} ${String(r)} 0 0 1 ${String(-r)} ${String(-r)}v${String(-(h - 2 * r))}a${String(r)} ${String(r)} 0 0 1 ${String(r)} ${String(-r)}z`;
}

// The Library's small drawings (63a): the level as weight plates on a bar, the effort as flames, and what
// an exercise needs as a drawn thing.

/** A bar with three plates, the first `lit` gold: the level. */
export function Plates({ lit, scale = 1 }: { lit: 0 | 1 | 2 | 3; scale?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const plates = [
    { x: 7, h: 8 },
    { x: 14, h: 12 },
    { x: 21, h: 16 },
  ];
  return (
    <Svg width={34 * scale} height={16 * scale} viewBox="0 0 34 16" accessible={false}>
      <Defs>
        <LinearGradient id={`${id}p`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colours.gold} />
          <Stop offset="1" stopColor={colours.orange} />
        </LinearGradient>
      </Defs>
      <Path d={box(0, 7, 34, 2, 1)} fill={colours.track} />
      {plates.map((p, i) => (
        <Path key={i} d={box(p.x, (16 - p.h) / 2, 5, p.h, 1.6)} fill={i < lit ? `url(#${id}p)` : colours.lineStrong} />
      ))}
    </Svg>
  );
}

const FLAME = "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z";

/** Three flames, the first `lit` burning: the effort. */
export function Flames({ lit, size = 13 }: { lit: 0 | 1 | 2 | 3; size?: number }) {
  return (
    <Svg width={size * 3 - 4} height={size} viewBox="0 0 64 24" accessible={false}>
      {[0, 1, 2].map((i) => (
        <Path key={i} d={FLAME} transform={`translate(${String(i * 20)} 0)`} fill={i < lit ? colours.orange : colours.lineStrong} />
      ))}
    </Svg>
  );
}

/** What an exercise needs, drawn: a person for none, a barbell, or the dumbbell sign for anything else. */
export function KitMark({ item, size = 1 }: { item: string | undefined; size?: number }) {
  if (item === undefined) {
    return (
      <Svg width={44 * size} height={28 * size} viewBox="0 0 44 28" accessible={false}>
        <Circle cx={22} cy={6} r={3} fill="none" stroke={colours.orange} strokeWidth={2} />
        <Path d="M22 10v8M14 13l8-2 8 2M22 18l-5 8M22 18l5 8" fill="none" stroke={colours.orange} strokeWidth={2} strokeLinecap="round" />
      </Svg>
    );
  }
  if (item === "barbell" || item === "ez_curl_bar" || item === "smith_machine") {
    return (
      <Svg width={44 * size} height={28 * size} viewBox="0 0 44 28" accessible={false}>
        <Path d={box(2, 13, 40, 2.4, 1.2)} fill={colours.steelShine} />
        <Path d={box(6, 5, 4, 18, 1.4)} fill={colours.orange} />
        <Path d={box(11, 8, 3, 12, 1.2)} fill={colours.orangeLight} />
        <Path d={box(34, 5, 4, 18, 1.4)} fill={colours.orange} />
        <Path d={box(30, 8, 3, 12, 1.2)} fill={colours.orangeLight} />
      </Svg>
    );
  }
  return <Icon name="dumbbell" size={Math.round(24 * size)} colour="orange" />;
}
