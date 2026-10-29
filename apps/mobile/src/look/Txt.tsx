import type { ReactNode } from "react";
import { StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";
import { colours, type ColourName } from "./colours";
import { MOST_TEXT_GROWTH } from "./sizing";

/** Inter, one file a weight: Android picks a weight by the font's name. */
export const fonts = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
  /** Oswald, tall and condensed: the Dashboard clock alone (Kd, 2026-10-28). */
  display: "Oswald_600SemiBold",
  displayLight: "Oswald_400Regular",
} as const;

export type TxtKind = keyof typeof kinds;

interface TxtProps {
  kind?: TxtKind;
  colour?: ColourName;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  /** Words that open something: a link inside a line. */
  onPress?: () => void;
  /** A number in a fixed space (a ring's): it grows smaller to fit whole, never cut to "1,3…". */
  fit?: boolean;
  children: ReactNode;
}

/** Every word on a screen. No size here is under 11. */
export function Txt({ kind = "body", colour, style, numberOfLines, onPress, fit = false, children }: TxtProps) {
  return (
    <Text
      accessibilityRole={onPress !== undefined ? "link" : kind === "hero" || kind === "h1" || kind === "h2" || kind === "h3" ? "header" : undefined}
      onPress={onPress}
      numberOfLines={numberOfLines}
      adjustsFontSizeToFit={fit}
      minimumFontScale={fit ? 0.6 : undefined}
      maxFontSizeMultiplier={MOST_TEXT_GROWTH}
      style={[kinds[kind], colour === undefined ? null : { color: colours[colour] }, style]}
    >
      {children}
    </Text>
  );
}

const kinds = StyleSheet.create({
  /** A first screen's own heading. */
  hero: { fontFamily: fonts.bold, fontSize: 36, lineHeight: 40, letterSpacing: -1.2, color: colours.text },
  h1: { fontFamily: fonts.bold, fontSize: 28, lineHeight: 32, letterSpacing: -0.56, color: colours.text },
  h2: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 26, letterSpacing: -0.44, color: colours.text },
  h3: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, color: colours.text },
  big: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 26, color: colours.text },
  eyebrow: {
    fontFamily: fonts.bold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.54,
    textTransform: "uppercase",
    color: colours.orange,
  },
  body: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colours.textSoft },
  strong: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 21, color: colours.text },
  small: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colours.textSoft },
  tiny: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14, color: colours.textFaint },
});
