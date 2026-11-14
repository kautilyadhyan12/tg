import { useId } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, ClipPath, Defs, Ellipse, G, LinearGradient, Path, Stop } from "react-native-svg";
import type { MoreNutrient } from "@app/shared";
import { colours } from "../../look/colours";
import { Txt } from "../../look/Txt";
import { jarFill, shareWords } from "./figures";

// The Nutrients pantry (32c-ii-a, Kd's drawing 4b): each nutrient drawn as a food that holds it, filled
// to its share of the published daily amount, green for an amount to reach and gold for a limit to stay
// under. A nutrient with no share (no figure, or no published amount) is its outline alone. Drawn on a
// 48-unit square.

type Part =
  | { kind: "path"; d: string }
  | { kind: "rect"; x: number; y: number; w: number; h: number; r: number; turn?: number }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number; turn?: number }
  | { kind: "circle"; cx: number; cy: number; r: number };

interface Shape {
  /** What holds the fill. */
  body: readonly Part[];
  /** The top and foot of the body: an empty picture's level is its foot, a full one's its top. */
  top: number;
  foot: number;
  /** Lines drawn over it: the cube's edges, a leaf's vein. */
  lines?: string;
  /** Holes drawn over the fill: the cheese's, the salt shaker's. */
  holes?: readonly { cx: number; cy: number; r: number }[];
}

const leaf = (cx: number, cy: number, turn: number): Part => ({ kind: "ellipse", cx, cy, rx: 2.1, ry: 4.4, turn });
const ray = (turn: number): Part => ({ kind: "rect", x: 22.6, y: 2, w: 2.8, h: 7, r: 1.4, turn });

const SHAPES: Readonly<Record<MoreNutrient, Shape>> = {
  // Fibre: an ear of wheat.
  fiberG: {
    body: [
      { kind: "rect", x: 23, y: 24, w: 2, h: 22, r: 1 },
      { kind: "ellipse", cx: 24, cy: 7, rx: 2.2, ry: 4.6 },
      ...[11.5, 16.5, 21.5, 26.5].flatMap((y) => [leaf(20.9, y, -30), leaf(27.1, y, 30)]),
    ],
    top: 2.4,
    foot: 46,
  },
  // Total sugars: a sugar cube.
  sugarsG: { body: [{ kind: "path", d: "M24,5 L41,14 L41,34 L24,43 L7,34 L7,14 Z" }], top: 5, foot: 43, lines: "M7,14 L24,23 L41,14 M24,23 L24,43" },
  // Saturated fat: a wedge of cheese.
  satFatG: {
    body: [{ kind: "path", d: "M5,38 L43,38 L43,20 L33,11 Z" }],
    top: 11,
    foot: 38,
    lines: "M5,38 L33,11",
    holes: [
      { cx: 30, cy: 30, r: 2.6 },
      { cx: 20, cy: 33, r: 1.8 },
      { cx: 38, cy: 26, r: 1.6 },
    ],
  },
  // Unsaturated fat: a drop of oil.
  unsatFatG: { body: [{ kind: "path", d: "M24,4 C24,4 38,20 38,30 A14,14 0 0 1 10,30 C10,20 24,4 24,4 Z" }], top: 4, foot: 44 },
  // Sodium: a salt shaker.
  sodiumMg: {
    body: [
      { kind: "path", d: "M13,18 Q13,6 24,6 Q35,6 35,18 Z" },
      { kind: "rect", x: 12, y: 18, w: 24, h: 26, r: 4 },
    ],
    top: 6,
    foot: 44,
    lines: "M12,18 L36,18",
    holes: [
      { cx: 20, cy: 12, r: 1.2 },
      { cx: 24, cy: 10, r: 1.2 },
      { cx: 28, cy: 12, r: 1.2 },
    ],
  },
  // Potassium: a banana.
  potassiumMg: {
    body: [
      { kind: "path", d: "M6,10 L11,8 C13,28 26,37 43,30 L45,35 C30,48 7,38 6,10 Z" },
      { kind: "rect", x: 5, y: 6, w: 5, h: 5, r: 1.5 },
    ],
    top: 6,
    foot: 44,
  },
  // Calcium: a bottle of milk.
  calciumMg: { body: [{ kind: "path", d: "M19,4 h10 v6 l5,7 v25 a4,4 0 0 1 -4,4 h-12 a4,4 0 0 1 -4,-4 v-25 l5,-7 Z" }], top: 4, foot: 46, lines: "M14,22 L34,22" },
  // Iron: a spinach leaf.
  ironMg: { body: [{ kind: "path", d: "M24,45 C9,37 5,21 13,9 C21,3 37,5 41,14 C45,27 37,41 24,45 Z" }], top: 5, foot: 45, lines: "M24,45 C20,30 22,18 33,8" },
  // Magnesium: a pumpkin seed.
  magnesiumMg: { body: [{ kind: "path", d: "M24,4 C36,12 40,28 32,40 C28,45 20,45 16,40 C8,28 12,12 24,4 Z" }], top: 4, foot: 44, lines: "M24,8 C22,20 22,32 24,42" },
  // Vitamin D: the sun.
  vitaminDUg: { body: [{ kind: "circle", cx: 24, cy: 24, r: 10 }, ...[0, 45, 90, 135, 180, 225, 270, 315].map(ray)], top: 2, foot: 46 },
};

/** Where the fill's top lies, for a fill from 0 (empty) to 1 (full). */
export const fillLevel = (key: MoreNutrient, fill: number): number => {
  const { top, foot } = SHAPES[key];
  return foot - (foot - top) * fill;
};

/** A box with round corners, as a path. */
const roundRect = ({ x, y, w, h, r }: { x: number; y: number; w: number; h: number; r: number }): string =>
  `M${String(x + r)},${String(y)} h${String(w - 2 * r)} a${String(r)},${String(r)} 0 0 1 ${String(r)},${String(r)} v${String(h - 2 * r)} a${String(r)},${String(r)} 0 0 1 -${String(r)},${String(r)} h-${String(w - 2 * r)} a${String(r)},${String(r)} 0 0 1 -${String(r)},-${String(r)} v-${String(h - 2 * r)} a${String(r)},${String(r)} 0 0 1 ${String(r)},-${String(r)} Z`;

const r1 = (n: number): string => String(Math.round(n * 10) / 10);

function Parts({ parts }: { parts: readonly Part[] }) {
  return (
    <>
      {parts.map((p, i) => {
        const key = String(i);
        if (p.kind === "path") return <Path key={key} d={p.d} />;
        if (p.kind === "circle") return <Circle key={key} cx={p.cx} cy={p.cy} r={p.r} />;
        if (p.kind === "rect") {
          return <Path key={key} d={roundRect(p)} {...(p.turn === undefined ? {} : { transform: `rotate(${String(p.turn)} 24 24)` })} />;
        }
        return <Ellipse key={key} cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} {...(p.turn === undefined ? {} : { transform: `rotate(${String(p.turn)} ${String(p.cx)} ${String(p.cy)})` })} />;
      })}
    </>
  );
}

/** One nutrient's picture, filled to its share, with the share in a small badge at its top. */
export function NutrientJar({ nutrient, share, limit, size = 62 }: { nutrient: MoreNutrient; share: number | null; limit: boolean; size?: number }) {
  const id = useId().replace(/[^A-Za-z0-9]/g, "");
  const shape = SHAPES[nutrient];
  const words = shareWords(share);
  const y = fillLevel(nutrient, jarFill(share));
  const wave = `M-2,${r1(y)} Q4,${r1(y - 2.6)} 10,${r1(y)} T22,${r1(y)} T34,${r1(y)} T46,${r1(y)} T58,${r1(y)}`;
  return (
    <View style={{ width: size, height: size }} testID={`jar-${nutrient}`}>
      <Svg width={size} height={size} viewBox="0 0 48 48" accessible={false}>
        <Defs>
          <ClipPath id={`in${id}`}>
            <Parts parts={shape.body} />
          </ClipPath>
          <LinearGradient id={`fill${id}`} x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor={limit ? colours.limitDeep : colours.good} />
            <Stop offset="1" stopColor={limit ? colours.gold : colours.goodText} />
          </LinearGradient>
        </Defs>
        <G fill={colours.fill} stroke={colours.plateRimLight} strokeWidth={1.1}>
          <Parts parts={shape.body} />
        </G>
        {share === null ? null : (
          <G clipPath={`url(#in${id})`}>
            <Path d={`${wave} V50 H-2 Z`} fill={`url(#fill${id})`} />
            <Path d={wave} stroke={colours.glassEdge} strokeWidth={1.2} fill="none" />
          </G>
        )}
        {shape.lines === undefined ? null : <Path d={shape.lines} stroke={colours.glassShine} strokeWidth={1.2} fill="none" />}
        {(shape.holes ?? []).map((h) => (
          <Circle key={`${String(h.cx)}-${String(h.cy)}`} cx={h.cx} cy={h.cy} r={h.r} fill={colours.jarDot} />
        ))}
      </Svg>
      {words === null ? null : (
        <View style={[styles.badge, limit ? styles.badgeLimit : styles.badgeAim]}>
          <Txt kind="tiny" colour={limit ? "gold" : "goodText"} style={styles.badgeWords}>
            {words}
          </Txt>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { position: "absolute", top: -6, left: "70%", paddingHorizontal: 6, borderRadius: 999, borderWidth: 1 },
  badgeAim: { backgroundColor: colours.goodFill, borderColor: colours.goodLine },
  badgeLimit: { backgroundColor: colours.goldFill, borderColor: colours.goldLine },
  badgeWords: { fontSize: 11, lineHeight: 16 },
});
