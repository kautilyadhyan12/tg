import { useState } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from "react-native-svg";
import { barGradient, colours, shadows } from "../../look/colours";
import { GrowUp, Rise, useCountUp, useGrow } from "../../look/Motion";
import { fonts, Txt } from "../../look/Txt";
import { count } from "../dashboard/words";
import { average, bestIndex, columnCentres, guides, monotonePath, tagWords } from "./chartRules";
import type { ForecastDay } from "./predictionWords";
import { caloriesSaid, type Bucket, type Step } from "./progressRules";

// Progress's charts (ROADMAP Stage 5 35c-i), drawn as they fill: the calories as a glowing line with
// its picked week lit, the workouts as capsules that grow, the ring of days, the families' ring and
// the next 7 days. Each number is the server's, put in place by chartRules.

export const LABEL_GAP = 8;
const CHART = 196;
const ROOF = 44;
const FOOT = 176;
/** Room on the right for the guide numbers. */
const GUIDE_ROOM = 26;

/** A box with round top corners as a path: the picked bar's beam of light. */
function roundedTop(x: number, top: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  const f = (n: number) => n.toFixed(1);
  return `M${f(x)} ${f(top + h)} V${f(top + rr)} Q${f(x)} ${f(top)} ${f(x + rr)} ${f(top)} H${f(x + w - rr)} Q${f(x + w)} ${f(top)} ${f(x + w)} ${f(top + rr)} V${f(top + h)} Z`;
}

/** The bars' dates under a chart, the picked one bright. */
export function Labels({ bars, picked = null }: { bars: readonly Bucket[]; picked?: number | null }) {
  return (
    <View style={styles.labels}>
      {bars.map((bar, i) => (
        <View key={bar.from} style={styles.label}>
          <Txt kind="tiny" colour={i === picked ? "text" : "textFaint"} numberOfLines={1} style={[styles.labelWords, i === picked ? styles.labelOn : null]}>
            {bar.label}
          </Txt>
        </View>
      ))}
    </View>
  );
}

/** The calories of each bar as a smooth glowing line drawn from the left, the picked bar lit by a beam
 *  with its days and number on a tag; pressing the chart picks the bar under the finger. */
export function CaloriesChart({ bars, step, total, each }: { bars: readonly Bucket[]; step: Step; total: number; each: string }) {
  const [width, setWidth] = useState(0);
  const values = bars.map((b) => b.kcal);
  const [picked, setPicked] = useState<number | null>(() => bestIndex(values));
  const [tag, setTag] = useState({ w: 0, h: 26 });
  const drawn = useGrow(1, 260, 1100);
  const most = Math.max(0, ...values);
  const top = most === 0 ? 1 : most / 0.9;
  const y = (v: number) => FOOT - (v / top) * (FOOT - ROOF);
  const xs = columnCentres(width, bars.length, LABEL_GAP);
  const pts = xs.map((x, i) => ({ x, y: y(values[i] ?? 0) }));
  const line = monotonePath(pts);
  const first = pts[0];
  const last = pts.at(-1);
  const avg = average(values);
  const pick = picked === null ? null : pts[picked];
  const pickBar = picked === null ? undefined : bars[picked];
  const nearest = (x: number) => xs.reduce((best, cx, i) => (Math.abs(cx - x) < Math.abs((xs[best] ?? 0) - x) ? i : best), 0);
  return (
    <View style={styles.chart}>
      <View style={styles.chartHead}>
        <Txt kind="tiny">{each}</Txt>
        {avg > 0 ? (
          <View style={styles.averageKey}>
            <Svg width={16} height={2}>
              <Line x1={0} x2={16} y1={1} y2={1} stroke={colours.textSoft} strokeWidth={1.5} strokeDasharray="4 3" />
            </Svg>
            <Txt kind="tiny" colour="textSoft" style={styles.averageWords}>
              {`Average ${count(Math.round(avg))}`}
            </Txt>
          </View>
        ) : null}
      </View>
      <Pressable
        accessible
        accessibilityLabel={caloriesSaid(bars, total)}
        style={{ height: CHART }}
        onLayout={(e) => {
          setWidth(e.nativeEvent.layout.width);
        }}
        onPress={(e) => {
          setPicked(nearest(e.nativeEvent.locationX));
        }}
      >
        {width === 0 || first === undefined || last === undefined ? null : (
          <>
            <Svg width={width} height={CHART} style={StyleSheet.absoluteFill}>
              {guides(most).map((g) => (
                <Line key={g} x1={0} x2={width - GUIDE_ROOM} y1={y(g)} y2={y(g)} stroke={colours.line} strokeWidth={1} />
              ))}
              {avg > 0 ? <Line x1={0} x2={width - GUIDE_ROOM} y1={y(avg)} y2={y(avg)} stroke={colours.textFaint} strokeWidth={1} strokeDasharray="4 5" /> : null}
            </Svg>
            {guides(most).map((g) => (
              <Txt key={g} kind="tiny" style={[styles.guide, { top: y(g) - 8 }]}>
                {count(g)}
              </Txt>
            ))}
            <Animated.View style={[styles.reveal, { width: drawn.interpolate({ inputRange: [0, 1], outputRange: [0, width] }) }]}>
              <Svg width={width} height={CHART}>
                <Defs>
                  <LinearGradient id="burnFill" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={colours.orange} stopOpacity={0.5} />
                    <Stop offset="0.6" stopColor={colours.orange} stopOpacity={0.1} />
                    <Stop offset="1" stopColor={colours.orange} stopOpacity={0} />
                  </LinearGradient>
                  <LinearGradient id="burnLine" x1="0" y1="0" x2="1" y2="0">
                    <Stop offset="0" stopColor={colours.flameDeep} />
                    <Stop offset="0.5" stopColor={colours.orangeLight} />
                    <Stop offset="1" stopColor={colours.flameDeep} />
                  </LinearGradient>
                  <LinearGradient id="burnBeam" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={colours.orangeLight} stopOpacity={0.35} />
                    <Stop offset="1" stopColor={colours.orangeLight} stopOpacity={0} />
                  </LinearGradient>
                </Defs>
                {pick === undefined || pick === null ? null : <Path d={roundedTop(pick.x - 18, pick.y, 36, FOOT - pick.y, 10)} fill="url(#burnBeam)" />}
                {pts.length > 1 ? (
                  <>
                    <Path d={`${line} L${last.x.toFixed(1)} ${String(FOOT)} L${first.x.toFixed(1)} ${String(FOOT)} Z`} fill="url(#burnFill)" />
                    <Path d={line} fill="none" stroke={colours.orange} strokeOpacity={0.1} strokeWidth={14} strokeLinecap="round" />
                    <Path d={line} fill="none" stroke={colours.orange} strokeOpacity={0.22} strokeWidth={7} strokeLinecap="round" />
                    <Path d={line} fill="none" stroke="url(#burnLine)" strokeWidth={3} strokeLinecap="round" />
                  </>
                ) : null}
                {pts.map((p, i) =>
                  i === picked ? null : <Circle key={bars[i]?.from ?? i} cx={p.x} cy={p.y} r={3} fill={colours.box} stroke={colours.orangeLight} strokeWidth={1.8} />,
                )}
                {pick === undefined || pick === null ? null : (
                  <>
                    <Circle cx={pick.x} cy={pick.y} r={14} fill={colours.orange} fillOpacity={0.16} />
                    <Circle cx={pick.x} cy={pick.y} r={7} fill={colours.onOrange} stroke={colours.orange} strokeWidth={3.5} />
                  </>
                )}
              </Svg>
            </Animated.View>
            {pick === undefined || pick === null || pickBar === undefined ? null : (
              <View
                pointerEvents="none"
                onLayout={(e) => {
                  setTag({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
                }}
                style={[styles.tag, { maxWidth: width, left: Math.max(0, Math.min(width - tag.w, pick.x - tag.w / 2)), top: Math.max(0, pick.y - 14 - tag.h), opacity: tag.w === 0 ? 0 : 1 }]}
              >
                <Txt kind="tiny" colour="onOrange" style={styles.tagWords}>
                  {tagWords(pickBar, step, pickBar.kcal)}
                </Txt>
              </View>
            )}
          </>
        )}
      </Pressable>
      <Labels bars={bars} picked={picked} />
    </View>
  );
}

/** The workouts of each bar as capsules on faint tracks, growing up one after another, the number in
 *  each (over it, where the capsule is too thin); the period's best glow. */
export function WeekBars({ bars }: { bars: readonly Bucket[] }) {
  const most = Math.max(1, ...bars.map((b) => b.workouts));
  const wide = bars.length <= 7 ? 30 : bars.length <= 10 ? 20 : 14;
  const each = Math.min(70, Math.round(500 / Math.max(1, bars.length)));
  return (
    <View style={styles.chart}>
      <View style={styles.bars}>
        {bars.map((bar, i) => {
          const inside = wide >= 20;
          const tall = Math.max(wide, Math.round((bar.workouts / most) * (BAR_TRACK - (inside ? 0 : OVER_ROOM))));
          return (
            <View key={bar.from} style={styles.column} accessible accessibilityLabel={bar.said}>
              <View style={[styles.track, { width: wide, borderRadius: wide / 2 }]} />
              {bar.workouts === 0 || inside ? null : (
                <Rise delay={760 + i * each}>
                  <Txt kind="tiny" colour="orangeLight" style={styles.overBar}>
                    {count(bar.workouts)}
                  </Txt>
                </Rise>
              )}
              {bar.workouts === 0 ? null : (
                <GrowUp
                  delay={280 + i * each}
                  style={[
                    styles.capsule,
                    { width: wide, height: tall, borderRadius: wide / 2 },
                    bar.workouts === most ? styles.best : null,
                  ]}
                >
                  {inside ? (
                    <Txt kind="tiny" colour="onBar" style={styles.inBar}>
                      {count(bar.workouts)}
                    </Txt>
                  ) : null}
                </GrowUp>
              )}
            </View>
          );
        })}
      </View>
      <Labels bars={bars} />
    </View>
  );
}
const BAR_TRACK = 138;
const OVER_ROOM = 20;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** A share of something as a ring that fills, its percent counting up in the middle. */
export function FillRing({ pct, size = 112, stroke = 10, delay = 480 }: { pct: number; size?: number; stroke?: number; delay?: number }) {
  const shown = useCountUp(pct, delay, 1000);
  const grown = useGrow(pct / 100, delay, 1000);
  const halo = 8;
  const r = (size - stroke - halo) / 2;
  const around = 2 * Math.PI * r;
  const offset = grown.interpolate({ inputRange: [0, 1], outputRange: [around, 0] });
  const mid = size / 2;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id="ringFill" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colours.gold} />
            <Stop offset="1" stopColor={colours.flameDeep} />
          </LinearGradient>
        </Defs>
        <Circle cx={mid} cy={mid} r={r} stroke={colours.track} strokeWidth={stroke} fill="none" />
        {pct > 0 ? (
          <>
            <AnimatedCircle cx={mid} cy={mid} r={r} stroke={colours.orange} strokeOpacity={0.16} strokeWidth={stroke + halo} strokeDasharray={`${String(around)} ${String(around)}`} strokeDashoffset={offset} fill="none" transform={`rotate(-90 ${String(mid)} ${String(mid)})`} />
            <AnimatedCircle cx={mid} cy={mid} r={r} stroke="url(#ringFill)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${String(around)} ${String(around)}`} strokeDashoffset={offset} fill="none" transform={`rotate(-90 ${String(mid)} ${String(mid)})`} />
          </>
        ) : null}
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.middle]}>
        <Txt kind="big" colour="orangeLight">{`${String(Math.round(shown))}%`}</Txt>
      </View>
    </View>
  );
}

/** One dot for each day of the period, oldest first, lit where there was a workout, today ringed. */
export function DayDots({ lit }: { lit: readonly boolean[] }) {
  return (
    <View style={styles.dots}>
      {lit.map((on, i) => (
        <Rise key={i} delay={600 + i * 18} style={styles.dotBox}>
          <View style={[styles.dot, on ? styles.dotOn : null, i === lit.length - 1 && !on ? styles.dotToday : null]} />
        </Rise>
      ))}
    </View>
  );
}

const SLICE_COLOURS = [colours.orange, colours.gold, colours.pink, colours.textFaint] as const;
export const sliceColour = (i: number) => SLICE_COLOURS[Math.min(i, SLICE_COLOURS.length - 1)] ?? colours.textFaint;

/** The families' shares as a ring, each its own colour, the sets in the middle. */
export function FamilyRing({ shares, total }: { shares: readonly number[]; total: number }) {
  const size = 120;
  const stroke = 14;
  const halo = 10;
  const r = (size - stroke - halo) / 2;
  const around = 2 * Math.PI * r;
  const sum = shares.reduce((a, b) => a + b, 0);
  let start = 0;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colours.track} strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colours.orange} strokeOpacity={0.15} strokeWidth={stroke + halo} fill="none" />
        {shares.map((share, i) => {
          const len = sum === 0 ? 0 : (share / sum) * around;
          const gap = shares.length > 1 ? 2 : 0;
          const el = (
            <Circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke={sliceColour(i)}
              strokeWidth={stroke}
              strokeDasharray={`${String(Math.max(0, len - gap))} ${String(around)}`}
              strokeDashoffset={-start}
              fill="none"
              transform={`rotate(-90 ${String(size / 2)} ${String(size / 2)})`}
            />
          );
          start += len;
          return el;
        })}
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.middle]}>
        <Txt kind="big">{count(total)}</Txt>
        <Txt kind="tiny">{total === 1 ? "set" : "sets"}</Txt>
      </View>
    </View>
  );
}

/** The next 7 days: each day's likely range as a faint capsule, its point as a glowing dot. */
export function ForecastDays({ days }: { days: readonly ForecastDay[] }) {
  const most = Math.max(1, ...days.map((d) => d.high));
  return (
    <View style={styles.forecast} accessible={false}>
      {days.map((d, i) => (
        <View key={i} style={styles.forecastDay}>
          <View style={styles.forecastTrack}>
            {d.high > 0 ? <View style={[styles.forecastRange, { height: Math.max(10, Math.round((d.high / most) * FORECAST_TRACK)) }]} /> : null}
            <View style={[styles.forecastPoint, { bottom: Math.max(2, Math.round((d.point / most) * FORECAST_TRACK) - 3) }, d.point === 0 ? styles.forecastNone : null]} />
          </View>
          <Txt kind="tiny" style={styles.centre}>
            {d.letter}
          </Txt>
        </View>
      ))}
    </View>
  );
}

const FORECAST_TRACK = 40;

const styles = StyleSheet.create({
  chart: { gap: 6 },
  reveal: { position: "absolute", left: 0, top: 0, height: CHART, overflow: "hidden" },
  guide: { position: "absolute", right: 0, width: GUIDE_ROOM, textAlign: "right" },
  chartHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" },
  averageKey: { flexDirection: "row", alignItems: "center", gap: 6 },
  averageWords: { fontFamily: fonts.bold, lineHeight: 16 },
  tag: { position: "absolute", minHeight: 26, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colours.orange, boxShadow: shadows.chip },
  tagWords: { fontFamily: fonts.bold, fontSize: 11.5, lineHeight: 15, textAlign: "center" },
  labels: { flexDirection: "row", gap: LABEL_GAP },
  label: { flex: 1, alignItems: "center", overflow: "visible" },
  // Wider than a thin bar: a crowded row names only some bars, so a name runs under its blank neighbours.
  labelWords: { textAlign: "center", width: 72 },
  labelOn: { fontFamily: fonts.bold },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: LABEL_GAP, height: BAR_TRACK },
  column: { flex: 1, alignItems: "center", justifyContent: "flex-end", height: "100%" },
  track: { position: "absolute", bottom: 0, top: 0, backgroundColor: colours.fill },
  capsule: { alignItems: "center", paddingTop: 6, backgroundColor: colours.orange, experimental_backgroundImage: barGradient },
  best: { boxShadow: shadows.barGlow },
  inBar: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 16 },
  overBar: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 15, marginBottom: 3 },
  middle: { alignItems: "center", justifyContent: "center" },
  dots: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  dotBox: { width: 10, height: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colours.track },
  // Flat: a gradient on a small dot crashed Android 15 on Kd's phone (the Dashboard's week, 31a).
  dotOn: { backgroundColor: colours.orange, boxShadow: shadows.dotGlow },
  dotToday: { backgroundColor: colours.box, borderWidth: 1.5, borderColor: colours.orange },
  forecast: { flexDirection: "row", justifyContent: "space-between", height: 54, marginTop: 6 },
  forecastDay: { alignItems: "center", gap: 3, width: 14 },
  forecastTrack: { width: 10, height: FORECAST_TRACK, borderRadius: 5, backgroundColor: colours.fill, justifyContent: "flex-end", overflow: "visible" },
  forecastRange: { width: 10, borderRadius: 5, backgroundColor: colours.orangeLine },
  forecastPoint: { position: "absolute", left: 2, width: 6, height: 6, borderRadius: 3, backgroundColor: colours.orangeLight },
  forecastNone: { backgroundColor: colours.textFaint },
  centre: { textAlign: "center" },
});
