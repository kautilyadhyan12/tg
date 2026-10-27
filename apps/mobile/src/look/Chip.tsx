import { Pressable, StyleSheet } from "react-native";
import { colours, orangeGradient, shadows, sizes } from "./colours";
import { Icon, type IconName } from "./Icon";
import { fonts, Txt } from "./Txt";

/** One of a few choices side by side (helmet.html's `.chip`): the picked one is orange and glows.
 *  Drawn 40 tall and pressed over 44. */
export function Chip({ label, on, onPress, icon }: { label: string; on: boolean; onPress: () => void; icon?: IconName }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      onPress={onPress}
      hitSlop={SLOP}
      style={({ pressed }) => [styles.chip, on ? styles.on : null, pressed ? styles.pressed : null]}
    >
      {icon === undefined ? null : <Icon name={icon} size={14} colour={on ? "onOrange" : "textSoft"} />}
      <Txt colour={on ? "onOrange" : "textSoft"} style={on ? styles.labelOn : styles.label}>
        {label}
      </Txt>
    </Pressable>
  );
}

const SLOP = { top: 2, bottom: 2, left: 0, right: 0 };

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 40,
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
  pressed: { opacity: 0.85 },
  label: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18 },
  labelOn: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18 },
});
