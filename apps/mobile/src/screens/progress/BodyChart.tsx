import { useState } from "react";
import { Animated, StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from "react-native-svg";
import { colours } from "../../look/colours";
import { useGrow } from "../../look/Motion";
import { Txt } from "../../look/Txt";
import { monotonePath } from "./chartRules";
import { shortDay, type SeriesPoint } from "./bodyRules";

// Body's chart (ROADMAP Stage 5 35c-ii): one measurement's last entries as the glowing line the
// calories chart draws, the newest a lit dot; its first and newest days under it.

const TALL = 104;
const ROOF = 12;
const FOOT = TALL - 10;
const SIDE = 10;

export function BodyChart({ points, say }: { points: readonly SeriesPoint[]; say: string }) {
  const [width, setWidth] = useState(0);
  const drawn = useGrow(1, 120, 900);
  const values = points.map((p) => p.value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low;
  const y = (v: number) => (span === 0 ? (ROOF + FOOT) / 2 : FOOT - ((v - low) / span) * (FOOT - ROOF));
  const step = points.length > 1 ? (width - SIDE * 2) / (points.length - 1) : 0;
  const pts = points.map((p, i) => ({ x: points.length > 1 ? SIDE + i * step : width / 2, y: y(p.value) }));
  const line = monotonePath(pts);
  const first = pts[0];
  const last = pts.at(-1);
  const firstDay = points[0]?.day;
  const lastDay = points.at(-1)?.day;
  return (
    <View>
      <View
        accessible
        accessibilityLabel={say}
        style={{ height: TALL }}
        onLayout={(e) => {
          setWidth(e.nativeEvent.layout.width);
        }}
      >
        {width === 0 || first === undefined || last === undefined ? null : (
          <>
            <Svg width={width} height={TALL} style={StyleSheet.absoluteFill}>
              {[ROOF, (ROOF + FOOT) / 2, FOOT].map((g) => (
                <Line key={g} x1={0} x2={width} y1={g} y2={g} stroke={colours.line} strokeWidth={1} />
              ))}
            </Svg>
            <Animated.View style={[styles.reveal, { width: drawn.interpolate({ inputRange: [0, 1], outputRange: [0, width] }) }]}>
              <Svg width={width} height={TALL}>
                <Defs>
                  <LinearGradient id="bodyFill" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={colours.orange} stopOpacity={0.4} />
                    <Stop offset="1" stopColor={colours.orange} stopOpacity={0} />
                  </LinearGradient>
                </Defs>
                {pts.length > 1 ? (
                  <>
                    <Path d={`${line} L${last.x.toFixed(1)} ${String(TALL)} L${first.x.toFixed(1)} ${String(TALL)} Z`} fill="url(#bodyFill)" />
                    <Path d={line} fill="none" stroke={colours.orange} strokeOpacity={0.12} strokeWidth={12} strokeLinecap="round" />
                    <Path d={line} fill="none" stroke={colours.orange} strokeOpacity={0.25} strokeWidth={6} strokeLinecap="round" />
                    <Path d={line} fill="none" stroke={colours.orange} strokeWidth={3} strokeLinecap="round" />
                  </>
                ) : null}
                {pts.slice(0, -1).map((p, i) => (
                  <Circle key={points[i]?.id ?? i} cx={p.x} cy={p.y} r={3} fill={colours.box} stroke={colours.orangeLight} strokeWidth={1.8} />
                ))}
                <Circle cx={last.x} cy={last.y} r={12} fill={colours.orange} fillOpacity={0.18} />
                <Circle cx={last.x} cy={last.y} r={6} fill={colours.onOrange} stroke={colours.orange} strokeWidth={3} />
              </Svg>
            </Animated.View>
          </>
        )}
      </View>
      <View style={styles.days}>
        <Txt kind="tiny">{firstDay === undefined || points.length < 2 ? "" : shortDay(firstDay)}</Txt>
        <Txt kind="tiny" colour="text">
          {lastDay === undefined ? "" : shortDay(lastDay)}
        </Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  reveal: { position: "absolute", top: 0, left: 0, bottom: 0, overflow: "hidden" },
  days: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
});
