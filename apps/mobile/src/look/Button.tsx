import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { colours, orangeGradient, shadows, sizes, type ColourName } from "./colours";
import { Icon, type IconName } from "./Icon";
import { fonts, Txt } from "./Txt";

/** `link` and `quiet` are words alone, with no box: a second thing to do beside a main button. */
export type ButtonKind = "main" | "plain" | "soft" | "danger" | "link" | "quiet";

interface ButtonProps {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  icon?: IconName;
  /** A mark of its own in the icon's place, such as Google's G. */
  lead?: ReactNode;
  small?: boolean;
  wide?: boolean;
  /** Drawn faint, and a press does nothing. */
  disabled?: boolean;
  /** Its own work is away: it turns, and a press does nothing. */
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  /** What a screen reader says, where the label alone does not say what it is for. */
  say?: string;
}

const ink: Record<ButtonKind, ColourName> = {
  main: "onOrange",
  plain: "text",
  soft: "orange",
  danger: "badText",
  link: "orange",
  quiet: "textSoft",
};

/** A main button is 48 tall, a small one 44; nothing pressed is smaller. */
export function Button({
  label,
  onPress,
  kind = "main",
  icon,
  lead,
  small = false,
  wide = false,
  disabled = false,
  busy = false,
  style,
  say,
}: ButtonProps) {
  const words = kind === "link" || kind === "quiet";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={say ?? label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[kind],
        small || words ? styles.small : null,
        words ? styles.words : null,
        wide ? styles.wide : null,
        pressed ? styles.pressed : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={colours[ink[kind]]} />
      ) : (
        <>
          {lead ?? (icon === undefined ? null : <Icon name={icon} size={small ? 16 : 18} colour={ink[kind]} />)}
          <Txt colour={ink[kind]} style={small || words ? styles.smallLabel : styles.label}>
            {label}
          </Txt>
        </>
      )}
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
    paddingHorizontal: 22,
    borderRadius: sizes.round,
    borderWidth: 1,
    borderColor: "transparent",
  },
  main: { backgroundColor: colours.orange, experimental_backgroundImage: orangeGradient, boxShadow: shadows.button },
  plain: { backgroundColor: colours.fill, borderColor: colours.lineStrong },
  soft: { backgroundColor: colours.orangeFill, borderColor: colours.orangeLine },
  danger: { backgroundColor: colours.badFill, borderColor: colours.badLine },
  link: {},
  quiet: {},
  small: { height: sizes.press, paddingHorizontal: 16 },
  words: { paddingHorizontal: 4 },
  wide: { alignSelf: "stretch" },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.45 },
  label: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  smallLabel: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
});
