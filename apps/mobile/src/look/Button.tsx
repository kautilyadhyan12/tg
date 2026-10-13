import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { colours, orangeGradient, sizes, type ColourName } from "./colours";
import { Icon, type IconName } from "./Icon";
import { fonts, Txt } from "./Txt";

export type ButtonKind = "main" | "plain" | "soft" | "danger";

interface ButtonProps {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  icon?: IconName;
  small?: boolean;
  wide?: boolean;
  style?: StyleProp<ViewStyle>;
}

const ink: Record<ButtonKind, ColourName> = {
  main: "onOrange",
  plain: "text",
  soft: "orange",
  danger: "badText",
};

/** A main button is 48 tall, a small one 44; nothing pressed is smaller. */
export function Button({ label, onPress, kind = "main", icon, small = false, wide = false, style }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[kind],
        small ? styles.small : null,
        wide ? styles.wide : null,
        pressed ? styles.pressed : null,
        style,
      ]}
    >
      {icon === undefined ? null : <Icon name={icon} size={small ? 16 : 18} colour={ink[kind]} />}
      <Txt colour={ink[kind]} style={small ? styles.smallLabel : styles.label}>
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    gap: 8,
    height: sizes.button,
    paddingHorizontal: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "transparent",
  },
  main: { experimental_backgroundImage: orangeGradient },
  plain: { backgroundColor: colours.fill, borderColor: colours.lineStrong },
  soft: { backgroundColor: colours.orangeFill, borderColor: colours.orangeLine },
  danger: { backgroundColor: colours.badFill, borderColor: colours.badLine },
  small: { height: sizes.press, paddingHorizontal: 14, borderRadius: 12 },
  wide: { alignSelf: "stretch" },
  pressed: { opacity: 0.8 },
  label: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  smallLabel: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
});
