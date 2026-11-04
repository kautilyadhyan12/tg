import { Pressable, StyleSheet } from "react-native";
import { colours, orangeGradient, shadows, sizes } from "./colours";
import { Icon, type IconName } from "./Icon";
import { fonts, Txt } from "./Txt";

/** One of a few choices side by side (helmet.html's `.chip`): the picked one is orange and glows.
 *  Drawn at least 40 tall (`small`: 32, beside a picture), growing with its words, and pressed over 44. */
export function Chip({ label, on, onPress, icon, small = false }: { label: string; on: boolean; onPress: () => void; icon?: IconName; small?: boolean }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      onPress={onPress}
      hitSlop={small ? SMALL_SLOP : SLOP}
      style={({ pressed }) => [styles.chip, small ? styles.small : null, on ? styles.on : null, pressed ? styles.pressed : null]}
    >
      {icon === undefined ? null : <Icon name={icon} size={14} colour={on ? "onOrange" : "textSoft"} />}
      <Txt colour={on ? "onOrange" : "textSoft"} style={[on ? styles.labelOn : styles.label, small ? styles.smallLabel : null]}>
        {label}
      </Txt>
    </Pressable>
  );
}

const SLOP = { top: 2, bottom: 2, left: 0, right: 0 };
const SMALL_SLOP = { top: 6, bottom: 6, left: 0, right: 0 };

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: sizes.round,
    borderWidth: 1,
    borderColor: colours.line,
    backgroundColor: colours.fill,
  },
  on: {
    borderColor: "transparent",
    backgroundColor: colours.orange,
    experimental_backgroundImage: orangeGradient,
    boxShadow: shadows.chip,
  },
  small: { minHeight: 32, paddingHorizontal: 12 },
  pressed: { opacity: 0.85 },
  label: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18 },
  labelOn: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18 },
  smallLabel: { fontSize: 13, lineHeight: 17 },
});
