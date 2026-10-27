import { useState } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { colours } from "./colours";
import { pointAt, stepHeights, stepsLit, trailPath, trailPoints } from "./progressShapes";

const TRAIL_HEIGHT = 20;

/** A goal's progress as a trail up a hill (Kd, 2026-10-28: not a straight line), lit orange as far
 *  as the person has climbed, a boulder at the tip, as in the Goals drawing. */
export function Trail({ share }: { share: number }) {
  const [width, setWidth] = useState(0);
  const points = trailPoints(width, TRAIL_HEIGHT);
  const tip = pointAt(points, share);
  return (
    <View
      accessible={false}
      style={styles.trail}
      onLayout={(e) => {
        setWidth(e.nativeEvent.layout.width);
      }}
    >
      {width > 0 ? (
        <Svg width={width} height={TRAIL_HEIGHT}>
          <Path d={trailPath(points)} stroke={colours.track} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          {share > 0 ? (
            <Path d={trailPath(points, share)} stroke={colours.orange} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          ) : null}
          <Circle cx={Math.max(4, Math.min(width - 4, tip.x))} cy={tip.y} r={4} fill={share > 0 ? colours.orangeLight : colours.textFaint} />
        </Svg>
      ) : null}
    </View>
  );
}

const STEP_COUNT = 10;
const STEP_HEIGHT = 16;

/** A challenge's progress as rising steps, lit from the left as it fills. */
export function Steps({ share }: { share: number }) {
  const lit = stepsLit(STEP_COUNT, share);
  return (
    <View accessible={false} style={styles.steps}>
      {stepHeights(STEP_COUNT, STEP_HEIGHT).map((h, i) => (
        <View key={h} style={[styles.step, { height: h }, i < lit ? styles.stepLit : null]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  trail: { height: TRAIL_HEIGHT, alignSelf: "stretch" },
  steps: { height: STEP_HEIGHT, flexDirection: "row", alignItems: "flex-end", gap: 3 },
  step: { flex: 1, borderRadius: 3, backgroundColor: colours.track },
  stepLit: { backgroundColor: colours.orange },
});
