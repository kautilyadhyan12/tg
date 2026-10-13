import type { ReactNode } from "react";
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colours, pictureShade, sizes, type ColourName } from "./colours";
import { Icon, type IconName } from "./Icon";
import { pictures, type PictureName } from "./pictures";
import { fonts, Txt } from "./Txt";

interface CardProps {
  /** The web's see-through box, where a page's own picture shows behind it. */
  glass?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

/** A page's box: dark, with a thin line round it. */
export function Card({ glass = false, style, children }: CardProps) {
  return <View style={[styles.card, glass ? styles.glass : null, styles.pad, style]}>{children}</View>;
}

interface PictureCardProps {
  picture: PictureName;
  height: number;
  eyebrow?: string;
  title?: string;
  /** A small picture's name, with its icon, as on the web's Progress and Achievements cards. */
  label?: string;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}

/** A picture that fills its box, cut to fit and never stretched, with its words over a shade. */
export function PictureCard({ picture, height, eyebrow, title, label, icon, style }: PictureCardProps) {
  return (
    <View style={[styles.card, styles.picture, { height }, style]}>
      <Image source={pictures[picture]} resizeMode="cover" style={StyleSheet.absoluteFill} accessible={false} />
      <View style={[StyleSheet.absoluteFill, styles.shade]} />
      <View style={styles.pictureWords}>
        {eyebrow === undefined ? null : <Txt kind="eyebrow">{eyebrow}</Txt>}
        {title === undefined ? null : <Txt kind="h2">{title}</Txt>}
        {label === undefined ? null : (
          <View style={styles.pictureLabel}>
            {icon === undefined ? null : <Icon name={icon} size={16} colour="orange" />}
            <Txt kind="h3">{label}</Txt>
          </View>
        )}
      </View>
    </View>
  );
}

type Tone = "orange" | "good" | "bad" | "gold" | "plain";

const tones: Record<Tone, { ink: ColourName; fill: ColourName; line: ColourName }> = {
  orange: { ink: "orange", fill: "orangeFill", line: "orangeLine" },
  good: { ink: "goodText", fill: "goodFill", line: "goodLine" },
  bad: { ink: "badText", fill: "badFill", line: "badLine" },
  gold: { ink: "gold", fill: "goldFill", line: "goldLine" },
  plain: { ink: "textSoft", fill: "fill", line: "line" },
};

/** An icon in its small square, at the head of a box. */
export function Badge({ icon, tone = "orange" }: { icon: IconName; tone?: Tone }) {
  const t = tones[tone];
  return (
    <View style={[styles.badge, { backgroundColor: colours[t.fill], borderColor: colours[t.line] }]}>
      <Icon name={icon} size={16} colour={t.ink} />
    </View>
  );
}

/** A word or two about the thing beside it: Open, Beginner, New. */
export function Pill({ label, tone = "plain", icon }: { label: string; tone?: Tone; icon?: IconName }) {
  const t = tones[tone];
  return (
    <View style={[styles.pill, { backgroundColor: colours[t.fill], borderColor: colours[t.line] }]}>
      {icon === undefined ? null : <Icon name={icon} size={12} colour={t.ink} />}
      <Txt colour={t.ink} style={styles.pillLabel}>
        {label}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colours.box,
    borderWidth: 1,
    borderColor: colours.line,
    borderRadius: sizes.boxRadius,
    overflow: "hidden",
  },
  glass: { backgroundColor: colours.glass },
  pad: { padding: 14, gap: 10 },
  picture: { borderRadius: 22 },
  shade: { experimental_backgroundImage: pictureShade },
  pictureWords: { position: "absolute", left: 14, right: 14, bottom: 14, gap: 8 },
  pictureLabel: { flexDirection: "row", alignItems: "center", gap: 8 },
  badge: {
    width: 36,
    height: 36,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillLabel: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14 },
});
