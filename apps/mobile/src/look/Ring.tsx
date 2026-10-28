import { StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { colours, type ColourName } from "./colours";

const STROKE = 6;

/** A share of a day's number as a ring, lit from the top, clockwise; past the number it is full. */
export function Ring({ share, size = 64, colour = "orange" }: { share: number; size?: number; colour?: ColourName }) {
  const r = (size - STROKE) / 2;
  const around = 2 * Math.PI * r;
  const lit = Math.max(0, Math.min(1, Number.isFinite(share) ? share : 0));
  return (
    <View accessible={false} style={[styles.ring, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colours.track} strokeWidth={STROKE} fill="none" />
        {lit > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={colours[colour]}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${String(around * lit)} ${String(around)}`}
            fill="none"
            transform={`rotate(-90 ${String(size / 2)} ${String(size / 2)})`}
          />
        ) : null}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { alignItems: "center", justifyContent: "center" },
});
