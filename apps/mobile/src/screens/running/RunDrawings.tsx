// A run's route as a glowing white-gold trail with a numbered stone at each kilometre or mile, and
// its pace as a glowing wave (ROADMAP Stage 5 37a, Kd's drawing of 2026-11-05: white mixed with
// gold, never Strava's orange line; a wave in place of straight bars).
import { useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, Defs, G, LinearGradient, Path, Stop } from "react-native-svg";
import { geodesicMetres, type RunSplit, type Units } from "@app/shared";
import { colours } from "../../look/colours";
import { fonts, Txt } from "../../look/Txt";
import { METRES_PER_MILE, pace, splitLabel } from "./runWords";

const GOLD = colours.gold;
const PALE = colours.flamePale;

/** The path laid flat in a box `w` by `h`, `pad` from its edges, north up and true to its shape. */
export function fitPath(track: readonly (readonly [number, number])[], w: number, h: number, pad: number): [number, number][] {
  const first = track[0];
  if (first === undefined || w <= 0 || h <= 0) return [];
  const cos = Math.cos((first[0] * Math.PI) / 180);
  const xy = track.map(([lat, lng]): [number, number] => [(lng - first[1]) * cos, -(lat - first[0])]);
  const xs = xy.map((p) => p[0]);
  const ys = xy.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX;
  const spanY = Math.max(...ys) - minY;
  const scale = Math.min((w - 2 * pad) / (spanX || 1), (h - 2 * pad) / (spanY || 1));
  const offX = (w - spanX * scale) / 2;
  const offY = (h - spanY * scale) / 2;
  return xy.map(([x, y]) => [offX + (x - minX) * scale, offY + (y - minY) * scale]);
}

/** Where along the path each whole kilometre or mile falls, as indexes into it. */
export function unitMarks(track: readonly (readonly [number, number])[], units: Units): number[] {
  const every = units === "imperial" ? METRES_PER_MILE : 1000;
  const marks: number[] = [];
  let walked = 0;
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1];
    const b = track[i];
    if (a === undefined || b === undefined) continue;
    walked += geodesicMetres(a[0], a[1], b[0], b[1]);
    if (walked >= every * (marks.length + 1)) marks.push(i);
  }
  return marks;
}

const pathOf = (points: readonly (readonly [number, number])[]): string =>
  points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");

/** The route: soft gold where it began, brightening to white where it is now or ended. */
export function RouteLine({ track, units, height, marks = true, testID }: { track: readonly (readonly [number, number])[]; units: Units; height: number; marks?: boolean; testID?: string }) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    setWidth(Math.round(e.nativeEvent.layout.width));
  };
  const pad = marks ? 16 : 8;
  const points = fitPath(track, width, height, pad);
  const first = points[0];
  const last = points[points.length - 1];
  const d = pathOf(points);
  const stones = marks ? unitMarks(track, units) : [];
  return (
    <View onLayout={onLayout} style={{ height }} testID={testID} accessible accessibilityLabel="Your route">
      {width > 0 && first !== undefined && last !== undefined ? (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="trail" x1={first[0]} y1={first[1]} x2={last[0]} y2={last[1]} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor={GOLD} stopOpacity={0.6} />
              <Stop offset="0.6" stopColor={PALE} />
              <Stop offset="1" stopColor={colours.trail} />
            </LinearGradient>
          </Defs>
          {/* The glow: the same line wider and fainter beneath it. */}
          <Path d={d} stroke={GOLD} strokeOpacity={0.12} strokeWidth={marks ? 16 : 11} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Path d={d} stroke={PALE} strokeOpacity={0.22} strokeWidth={marks ? 8 : 6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Path d={d} stroke="url(#trail)" strokeWidth={marks ? 3.5 : 3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          {stones.map((index, n) => {
            const p = points[index];
            return p === undefined ? null : <Circle key={String(n)} cx={p[0]} cy={p[1]} r={10} fill={colours.page} stroke={PALE} strokeWidth={1.6} />;
          })}
          <Circle cx={first[0]} cy={first[1]} r={marks ? 5.5 : 4} fill={GOLD} />
          <Circle cx={last[0]} cy={last[1]} r={marks ? 11 : 8} fill={colours.trail} fillOpacity={0.16} />
          <Circle cx={last[0]} cy={last[1]} r={marks ? 5.5 : 4.5} fill={colours.trail} />
        </Svg>
      ) : null}
      {width > 0
        ? stones.map((index, n) => {
            const p = points[index];
            return p === undefined ? null : <Label key={String(n)} x={p[0]} y={p[1]} text={String(n + 1)} bold />;
          })
        : null}
    </View>
  );
}

/** Words laid over a drawing, centred on a point of it. */
function Label({ x, y, text, bold = false, gold = false, faint = false }: { x: number; y: number; text: string; bold?: boolean; gold?: boolean; faint?: boolean }) {
  return (
    <View pointerEvents="none" style={[styles.label, { left: x - 32, top: y - 8 }]}>
      <Txt style={[styles.labelText, bold ? styles.bold : null, { color: gold ? GOLD : faint ? colours.textFaint : PALE }]} numberOfLines={1}>
        {text}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { position: "absolute", width: 64, height: 16, alignItems: "center", justifyContent: "center" },
  labelText: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 14 },
  bold: { fontFamily: fonts.bold, fontSize: 12 },
});

/** Each kilometre's or mile's pace as a wave: higher is faster, the best a bright white point. */
export function PaceWave({ splits, units }: { splits: readonly RunSplit[]; units: Units }) {
  const [width, setWidth] = useState(0);
  const height = 150;
  const shown = splits.filter((s) => s.m > 0 && s.s > 0);
  const speeds = shown.map((s) => s.m / s.s);
  const best = speeds.length === 0 ? -1 : speeds.indexOf(Math.max(...speeds));
  const lo = Math.min(...speeds);
  const hi = Math.max(...speeds);
  const top = 34;
  const bottom = 112;
  const step = shown.length > 1 ? (width - 60) / (shown.length - 1) : 0;
  const pts = shown.map((_, i): [number, number] => [30 + i * step, hi === lo ? (top + bottom) / 2 : bottom - ((speeds[i] ?? lo) - lo) / (hi - lo) * (bottom - top)]);
  let d = "";
  pts.forEach(([x, y], i) => {
    const prev = pts[i - 1];
    d += prev === undefined ? `M${x.toFixed(1)} ${y.toFixed(1)}` : ` C${(prev[0] + step / 2).toFixed(1)} ${prev[1].toFixed(1)} ${(x - step / 2).toFixed(1)} ${y.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  // On a long run, a pace and a label at every few points, so they never lie on each other.
  const every = Math.max(1, Math.ceil(shown.length / 8));
  const firstX = pts[0]?.[0] ?? 0;
  const lastX = pts[pts.length - 1]?.[0] ?? 0;
  return (
    <View onLayout={(e) => { setWidth(Math.round(e.nativeEvent.layout.width)); }} style={{ height }} accessible accessibilityLabel={shown.map((s, i) => `${splitLabel(i, s.m, units)}: ${pace(s.s, s.m, units)}`).join(", ")}>
      {width > 0 && pts.length > 0 ? (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="waveFill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={GOLD} stopOpacity={0.26} />
              <Stop offset="1" stopColor={GOLD} stopOpacity={0} />
            </LinearGradient>
            <LinearGradient id="waveLine" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={GOLD} />
              <Stop offset="0.5" stopColor={PALE} />
              <Stop offset="1" stopColor={GOLD} />
            </LinearGradient>
          </Defs>
          {pts.length > 1 ? (
            <>
              <Path d={`${d} L${lastX.toFixed(1)} ${String(bottom + 18)} L${firstX.toFixed(1)} ${String(bottom + 18)} Z`} fill="url(#waveFill)" />
              <Path d={d} stroke={GOLD} strokeOpacity={0.18} strokeWidth={9} fill="none" />
              <Path d={d} stroke="url(#waveLine)" strokeWidth={3} fill="none" />
            </>
          ) : null}
          {pts.map(([x, y], i) => {
            const split = shown[i];
            if (split === undefined) return null;
            const isBest = i === best && shown.length > 1;
            return (
              <G key={String(i)}>
                {isBest ? <Circle cx={x} cy={y} r={11} fill={colours.trail} fillOpacity={0.18} /> : null}
                <Circle cx={x} cy={y} r={isBest ? 6.5 : 4.5} fill={isBest ? colours.trail : colours.page} stroke={PALE} strokeWidth={2} />
              </G>
            );
          })}
        </Svg>
      ) : null}
      {width > 0
        ? pts.map(([x, y], i) => {
            const split = shown[i];
            if (split === undefined) return null;
            const isBest = i === best && shown.length > 1;
            return (
              <View key={String(i)} pointerEvents="none" style={StyleSheet.absoluteFill}>
                {!isBest && i % every !== 0 ? null : <Label x={x} y={y - 17} text={pace(split.s, split.m, units)} bold gold={isBest} />}
                {i % every !== 0 && i !== pts.length - 1 ? null : <Label x={x} y={height - 12} text={splitLabel(i, split.m, units)} faint />}
              </View>
            );
          })
        : null}
    </View>
  );
}
