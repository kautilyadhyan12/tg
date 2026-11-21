import { StyleSheet } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Stop } from "react-native-svg";
import { colours } from "../../look/colours";

/** The weight plate's face (64a-i, Kd's click-through: "a symbol that can go with any exercises"): a bumper plate in
 *  the app's orange, lit from above, its raised band and steel hub; black rubber for no weight. The words on it are
 *  the caller's, laid over it. Drawn in the set-up box and on the workout's own screen (64a-ii). */
export function PlateFace({ size, none }: { size: number; none: boolean }) {
  const mid = size / 2;
  const scale = size / 112;
  return (
    <Svg width={size} height={size} style={StyleSheet.absoluteFill} accessible={false}>
      <Defs>
        <LinearGradient id="plateFace" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colours.orangeLight} />
          <Stop offset="1" stopColor={colours.orangeDeep} />
        </LinearGradient>
      </Defs>
      {/* The rubber, lit from above; black for none. */}
      <Circle cx={mid} cy={mid} r={mid - 1} fill={none ? colours.weightPlate : "url(#plateFace)"} />
      <Circle cx={mid} cy={mid} r={mid - 1} fill="none" stroke={colours.weightPlateRim} strokeWidth={1.5} />
      {/* The raised band a plate's lettering sits on. */}
      <Circle cx={mid} cy={mid} r={mid - 13 * scale} fill="none" stroke={colours.plateSide} strokeWidth={1.5} />
      {/* The steel hub and its hole. */}
      <Circle cx={mid} cy={mid} r={12 * scale} fill={colours.barSleeve} stroke={colours.barCollar} strokeWidth={2 * scale} />
      <Circle cx={mid} cy={mid} r={7.5 * scale} fill={colours.barCollar} />
      <Circle cx={mid} cy={mid} r={4.5 * scale} fill={colours.timerFace} />
    </Svg>
  );
}
