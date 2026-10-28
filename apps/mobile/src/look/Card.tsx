import type { ReactNode } from "react";
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colours, orangeGradient, pictureShade, shadows, sizes, type ColourName } from "./colours";
import { Icon, type IconName } from "./Icon";
import { pictures, type PictureName } from "./pictures";
import { fonts, Txt } from "./Txt";

interface CardProps {
  /** The web's see-through box, where a page's own picture shows behind it. */
  glass?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  children: ReactNode;
}

/** A page's box: dark, with a thin line round it. */
export function Card({ glass = false, style, testID, children }: CardProps) {
  return (
    <View testID={testID} style={[styles.card, glass ? styles.glass : null, styles.pad, style]}>
      {children}
    </View>
  );
}

interface PictureCardProps {
  picture: PictureName;
  height: number;
  eyebrow?: string;
  title?: string;
  /** A small picture's name, with its icon, as on the web's Progress and Achievements cards. */
  label?: string;
  icon?: IconName;
  /** A word over its corner about the thing it shows: Coming soon, New. */
  pill?: string;
  style?: StyleProp<ViewStyle>;
}

/** A picture that fills its box, cut to fit and never stretched, with its words over a shade. */
export function PictureCard({ picture, height, eyebrow, title, label, icon, pill, style }: PictureCardProps) {
  return (
    <View style={[styles.card, styles.picture, { height }, style]}>
      <Image source={pictures[picture]} resizeMode="cover" style={styles.fill} accessible={false} />
      <View style={[StyleSheet.absoluteFill, styles.shade]} />
      {pill === undefined ? null : (
        <View style={styles.corner}>
          <Pill label={pill} tone="veil" />
        </View>
      )}
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

type Tone = "orange" | "good" | "bad" | "gold" | "plain" | "veil";

const tones: Record<Tone, { ink: ColourName; fill: ColourName; line: ColourName }> = {
  orange: { ink: "orange", fill: "orangeFill", line: "orangeLine" },
  good: { ink: "goodText", fill: "goodFill", line: "goodLine" },
  bad: { ink: "badText", fill: "badFill", line: "badLine" },
  gold: { ink: "gold", fill: "goldFill", line: "goldLine" },
  plain: { ink: "textSoft", fill: "fill", line: "line" },
  /** Over a picture. */
  veil: { ink: "text", fill: "veil", line: "lineStrong" },
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

/** The app's own mark: the dumbbell on orange, glowing as on the browser's first page. */
export function Logo() {
  return (
    <View style={styles.logo}>
      <Icon name="dumbbell" size={16} colour="onOrange" />
    </View>
  );
}

/** A person, by the first letter of their name. */
export function Avatar({ name, size = 48 }: { name: string; size?: number }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: Math.round(size * 0.3) }]}>
      <Txt colour="onOrange" style={[styles.initial, { fontSize: Math.round(size * 0.42), lineHeight: Math.round(size * 0.5) }]}>
        {name.trim().charAt(0).toUpperCase()}
      </Txt>
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
  // A picture has a size of its own, so it is told the box's; "cover" then cuts it to fit.
  fill: { position: "absolute", width: "100%", height: "100%" },
  shade: { experimental_backgroundImage: pictureShade },
  corner: { position: "absolute", top: 10, left: 10 },
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
  logo: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colours.orange,
    experimental_backgroundImage: orangeGradient,
    boxShadow: shadows.logo,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colours.orange,
    experimental_backgroundImage: orangeGradient,
  },
  initial: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 24 },
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
