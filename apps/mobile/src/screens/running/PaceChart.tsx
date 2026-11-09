// The pace chart (ROADMAP Stage 5 37c-iii, Kd's "yes" to the drawing of 2026-11-09): the run's speed as
// one glowing line from start to finish, faster higher, a dashed line at the average, the fastest place
// lit, the hills faint behind it. A finger on it reads that place: how far, the pace there, the height.
// The line is the server's (`paceLineOf`), worked out from the same steps as the distance and the splits.
import { useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from "react-native-svg";
import type { Units } from "@app/shared";
import { colours } from "../../look/colours";
import { fonts, Txt } from "../../look/Txt";
import { distance, pace, paceWord, unitWord, METRES_PER_MILE } from "./runWords";

const GOLD = colours.gold;
const PALE = colours.flamePale;
const HEIGHT = 190;
const LEFT = 34;
const RIGHT = 8;
const TOP = 14;
const BOTTOM = 24;
const FEET_PER_METRE = 1 / 0.3048;
/** Slower than this share of the average speed is drawn at the floor, so one stop for a drink does
 *  not squash the rest of the run flat (its pace is still read under a finger). */
const FLOOR_SHARE = 0.6;

export interface PaceChartProps {
  /** Centimetres a second at evenly spaced places from the start to the finish. */
  paceLine: readonly number[];
  /** Metres at the same places; empty while the height map has none. */
  hillLine: readonly number[];
  distanceM: number;
  movingS: number;
  units: Units;
}

const each = (units: Units): number => (units === "imperial" ? METRES_PER_MILE : 1000);
/** The pace of a speed in centimetres a second, as the run's other paces are written. */
const paceOf = (cms: number, units: Units): string => (cms <= 0 ? "--:--" : pace(100, cms, units));
const heightWords = (m: number, units: Units): string =>
  units === "imperial" ? `${String(Math.round(m * FEET_PER_METRE))} ft` : `${String(m)} m`;

/** The whole-minute paces between the fastest and the floor, for the lines across the chart. */
function paceMarks(lo: number, hi: number, units: Units): { cms: number; label: string }[] {
  const out: { cms: number; label: string }[] = [];
  for (let minutes = 2; minutes <= 30; minutes++) {
    const cms = (each(units) * 100) / (minutes * 60);
    if (cms >= lo && cms <= hi) out.push({ cms, label: `${String(minutes)}:00` });
  }
  // On a run of very even pace, few or none fall inside: every other one kept where many do.
  return out.length > 5 ? out.filter((_, i) => i % 2 === 0) : out;
}

/** The distance marks along the bottom: whole kilometres or miles, as many as fit. */
function distanceMarks(distanceM: number, units: Units): number[] {
  const units1 = distanceM / each(units);
  const step = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50].find((s) => units1 / s <= 5) ?? 100;
  const out: number[] = [];
  for (let k = 0; k <= units1 + 1e-9; k += step) out.push(Math.round(k * 10) / 10);
  return out;
}

export function PaceChart({ paceLine, hillLine, distanceM, movingS, units }: PaceChartProps) {
  const [width, setWidth] = useState(0);
  const [at, setAt] = useState<number | null>(null);
  const n = paceLine.length;
  const average = movingS > 0 ? (distanceM / movingS) * 100 : 0;
  const hi = n === 0 ? 0 : Math.max(...paceLine);
  const lo = n === 0 ? 0 : Math.min(Math.max(Math.min(...paceLine), average * FLOOR_SHARE), hi - 1);
  const fastest = paceLine.indexOf(hi);
  const hills = hillLine.length === n ? hillLine : [];
  const plotW = Math.max(0, width - LEFT - RIGHT);
  const plotH = HEIGHT - TOP - BOTTOM;
  const x = (i: number): number => LEFT + (n > 1 ? (plotW * i) / (n - 1) : 0);
  const y = (cms: number): number => TOP + plotH * (1 - (Math.max(lo, cms) - lo) / (hi - lo || 1));
  const hMin = hills.length === 0 ? 0 : Math.min(...hills) - 8;
  const hMax = hills.length === 0 ? 1 : Math.max(...hills) + 8;
  // The hills take the lower half of the chart at most, so they never hide the pace.
  const hy = (h: number): number => HEIGHT - BOTTOM - plotH * 0.55 * ((h - hMin) / (hMax - hMin || 1));

  const geometry = useRef({ plotW, n });
  geometry.current = { plotW, n };
  const pick = (locationX: number) => {
    const g = geometry.current;
    if (g.n < 2 || g.plotW <= 0) return;
    setAt(Math.max(0, Math.min(g.n - 1, Math.round(((locationX - LEFT) / g.plotW) * (g.n - 1)))));
  };
  const touch = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderGrant: (e) => {
          pick(e.nativeEvent.locationX);
        },
        onPanResponderMove: (e) => {
          pick(e.nativeEvent.locationX);
        },
        onPanResponderRelease: () => {
          setAt(null);
        },
        onPanResponderTerminate: () => {
          setAt(null);
        },
        // The page may still scroll up and down from the chart; sliding sideways stays on it.
        onPanResponderTerminationRequest: (_e, g) => Math.abs(g.dy) > Math.abs(g.dx),
      }),
    [],
  );

  if (n < 2) return null;
  const line = paceLine.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  const hillPath =
    hills.length === 0
      ? ""
      : `M${x(0).toFixed(1)} ${String(HEIGHT - BOTTOM)}${hills.map((h, i) => `L${x(i).toFixed(1)} ${hy(h).toFixed(1)}`).join("")}L${x(n - 1).toFixed(1)} ${String(HEIGHT - BOTTOM)}Z`;
  const picked = at === null ? null : (paceLine[at] ?? null);
  const pickedHill = at === null ? undefined : hills[at];

  const onLayout = (e: LayoutChangeEvent) => {
    setWidth(Math.round(e.nativeEvent.layout.width));
  };
  const said = `Pace chart. Average ${paceOf(average, units)}, fastest ${paceOf(hi, units)} ${paceWord(units)}.`;

  return (
    <View>
      <View style={styles.read}>
        {at === null || picked === null ? (
          <>
            <Figure value={paceOf(average, units)} label="Avg pace" />
            <Figure value={paceOf(hi, units)} label="Fastest" gold />
          </>
        ) : (
          <>
            <Figure value={`${distance((distanceM * at) / (n - 1), units)} ${unitWord(units)}`} label="Distance" />
            <Figure value={paceOf(picked, units)} label="Pace" gold />
            {pickedHill === undefined ? null : <Figure value={heightWords(pickedHill, units)} label="Height" />}
          </>
        )}
      </View>
      <View onLayout={onLayout} style={{ height: HEIGHT }} accessible accessibilityLabel={said} testID="pace-chart" {...touch.panHandlers}>
        {width > 0 ? (
          <Svg width={width} height={HEIGHT}>
            <Defs>
              <LinearGradient id="paceFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={GOLD} stopOpacity={0.22} />
                <Stop offset="1" stopColor={GOLD} stopOpacity={0} />
              </LinearGradient>
              <LinearGradient id="paceLine" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={GOLD} />
                <Stop offset="0.5" stopColor={PALE} />
                <Stop offset="1" stopColor={GOLD} />
              </LinearGradient>
              <LinearGradient id="paceBeam" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colours.trail} stopOpacity={0} />
                <Stop offset="0.5" stopColor={colours.trail} stopOpacity={0.4} />
                <Stop offset="1" stopColor={colours.trail} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            {paceMarks(lo, hi, units).map((m) => (
              <Line key={m.label} x1={LEFT} x2={width - RIGHT} y1={y(m.cms)} y2={y(m.cms)} stroke={colours.trailGlow} strokeOpacity={0.35} />
            ))}
            {hillPath === "" ? null : <Path d={hillPath} fill={colours.trail} fillOpacity={0.07} stroke={colours.trail} strokeOpacity={0.14} strokeWidth={1} />}
            <Path d={`${line}L${x(n - 1).toFixed(1)} ${String(HEIGHT - BOTTOM)}L${x(0).toFixed(1)} ${String(HEIGHT - BOTTOM)}Z`} fill="url(#paceFill)" />
            <Path d={line} stroke={GOLD} strokeOpacity={0.18} strokeWidth={9} fill="none" strokeLinejoin="round" />
            <Path d={line} stroke="url(#paceLine)" strokeWidth={2.6} fill="none" strokeLinejoin="round" />
            <Line x1={LEFT} x2={width - RIGHT} y1={y(average)} y2={y(average)} stroke={GOLD} strokeWidth={1.4} strokeDasharray="5 5" strokeOpacity={0.8} />
            {at === null || picked === null ? (
              <>
                <Circle cx={x(fastest)} cy={y(hi)} r={11} fill={colours.trail} fillOpacity={0.18} />
                <Circle cx={x(fastest)} cy={y(hi)} r={5.5} fill={colours.trail} stroke={PALE} strokeWidth={2} />
              </>
            ) : (
              <>
                <Path d={`M${(x(at) - 1).toFixed(1)} ${String(TOP)}h2v${String(plotH)}h-2Z`} fill="url(#paceBeam)" />
                <Circle cx={x(at)} cy={y(picked)} r={13} fill={colours.trail} fillOpacity={0.16} />
                <Circle cx={x(at)} cy={y(picked)} r={6} fill={colours.trail} testID="pace-picked" />
                {pickedHill === undefined ? null : <Circle cx={x(at)} cy={hy(pickedHill)} r={3.5} fill={colours.trail} fillOpacity={0.55} />}
              </>
            )}
          </Svg>
        ) : null}
        {width > 0
          ? paceMarks(lo, hi, units).map((m) => (
              <Txt key={m.label} style={[styles.mark, styles.paceMark, { top: y(m.cms) - 8 }]} numberOfLines={1}>
                {m.label}
              </Txt>
            ))
          : null}
        {width > 0
          ? distanceMarks(distanceM, units).map((k, i, all) => {
              const px = LEFT + (plotW * k * each(units)) / Math.max(1, distanceM);
              const end = i === all.length - 1 && px > width - RIGHT - 24;
              const left = i === 0 ? px : end ? width - RIGHT - 64 : px - 32;
              return (
                <Txt key={String(k)} style={[styles.mark, styles.distanceMark, { left, textAlign: i === 0 ? "left" : end ? "right" : "center" }]} numberOfLines={1}>
                  {k === 0 ? "0" : `${String(k)} ${unitWord(units)}`}
                </Txt>
              );
            })
          : null}
      </View>
      <View style={styles.key}>
        <Key colour={PALE} label="Pace" />
        {hills.length === 0 ? null : <Key colour={colours.trailGlow} label="Hills" thick />}
        <Key colour={GOLD} label="Average" dashed />
      </View>
    </View>
  );
}

function Figure({ value, label, gold = false }: { value: string; label: string; gold?: boolean }) {
  return (
    <View>
      <Txt style={[styles.figure, gold ? { color: GOLD } : null]} numberOfLines={1}>
        {value}
      </Txt>
      <Txt kind="small" colour="textFaint">
        {label}
      </Txt>
    </View>
  );
}

function Key({ colour, label, thick = false, dashed = false }: { colour: string; label: string; thick?: boolean; dashed?: boolean }) {
  return (
    <View style={styles.keyItem}>
      <View style={[styles.keyMark, thick ? styles.keyThick : null, dashed ? { borderTopWidth: 2, borderStyle: "dashed", borderColor: colour, height: 0 } : { backgroundColor: colour }]} />
      <Txt kind="small" colour="textFaint">
        {label}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  read: { flexDirection: "row", gap: 18, minHeight: 44, marginTop: 4 },
  mark: { position: "absolute", fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, color: colours.textFaint },
  paceMark: { left: 0, width: LEFT - 6, textAlign: "right" },
  distanceMark: { top: HEIGHT - 18, width: 64 },
  figure: { fontFamily: fonts.bold, fontSize: 20, color: colours.text },
  key: { flexDirection: "row", gap: 14, flexWrap: "wrap" },
  keyItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  keyMark: { width: 14, height: 3, borderRadius: 2 },
  keyThick: { height: 8 },
});
