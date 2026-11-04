import type { ReactNode } from "react";
import { Animated, Image, Pressable, StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Stop } from "react-native-svg";
import { Button } from "../../look/Button";
import { artShade, badges, badgeShine, bandShade, colours, orangeGradient, pickedRowGradient, pictureFadeUnderWords, shadows, sizes, topShade } from "../../look/colours";
import { Icon, type IconName } from "../../look/Icon";
import { useLoop } from "../../look/Motion";
import { pictures, type PictureName } from "../../look/pictures";
import { pictureTopHeight } from "../../look/sizing";
import { fonts, Txt } from "../../look/Txt";
import type { Read } from "../dashboard/useRead";
import { NOT_KNOWN } from "../dashboard/words";

// Progress's own pieces (ROADMAP Stage 5 35c-i): its top with the four tabs, a box with a chalk
// drawing behind its words, a box with a drawing across its top, and the flame of a day trained.

export const TABS = [
  { key: "overview", label: "Overview" },
  { key: "trends", label: "Trends" },
  { key: "calendar", label: "Calendar" },
  { key: "body", label: "Body" },
] as const;
export type TabKey = (typeof TABS)[number]["key"];

/** The bandage, big and clear, slowly closing in, its warm glow breathing over it; the title and the four tabs on it. */
export function Hero({ tab, onTab }: { tab: TabKey; onTab: (t: TabKey) => void }) {
  const { width, height } = useWindowDimensions();
  const tall = pictureTopHeight(width, height, 0.95);
  const zoom = useLoop(9000);
  const breathe = useLoop(3200);
  const scale = zoom.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] });
  const glow = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] });
  return (
    <View style={{ height: tall }}>
      <View style={[StyleSheet.absoluteFill, styles.clip]}>
        <Animated.Image
          source={pictures.progress}
          resizeMode="cover"
          accessible={false}
          style={[styles.photo, { height: tall, transform: [{ scale }] }]}
        />
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: glow }]}>
          <Svg width="100%" height="100%">
            <Defs>
              <RadialGradient id="heroGlow" cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor={colours.orange} stopOpacity={0.5} />
                <Stop offset="0.45" stopColor={colours.orange} stopOpacity={0.12} />
                <Stop offset="1" stopColor={colours.orange} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx="68%" cy="42%" r="75%" fill="url(#heroGlow)" />
          </Svg>
        </Animated.View>
      </View>
      <View style={[StyleSheet.absoluteFill, styles.fade]} />
      <View style={styles.words}>
        <Txt kind="hero">Progress</Txt>
        <Txt kind="small" colour="textSoft">
          Track your fitness journey over time
        </Txt>
        <View style={styles.tabs} accessibilityRole="tablist">
          {TABS.map((t) => (
            <Pressable
              key={t.key}
              accessibilityRole="tab"
              accessibilityLabel={t.label}
              accessibilityState={{ selected: tab === t.key }}
              onPress={() => {
                onTab(t.key);
              }}
              style={[styles.tab, tab === t.key ? styles.tabOn : null]}
            >
              <Txt kind="small" colour={tab === t.key ? "onOrange" : "textSoft"} numberOfLines={1} fit style={styles.tabWords}>
                {t.label}
              </Txt>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

export function BoxTitle({ icon, colour = "orange", title, side }: { icon: IconName; colour?: "orange" | "gold" | "blue" | "orangeLight"; title: string; side?: ReactNode }) {
  return (
    <View style={styles.between}>
      <View style={styles.titleRow}>
        <Icon name={icon} size={17} colour={colour} />
        <Txt kind="h3" numberOfLines={1}>
          {title}
        </Txt>
      </View>
      {side ?? null}
    </View>
  );
}

/** A box with a chalk drawing on its right, the box's own colour under the words on its left. */
export function ArtBox({ picture, focus = "center", children, style }: { picture: PictureName; focus?: "center" | "top"; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.box, style]}>
      <View style={[styles.art, focus === "top" ? styles.artTop : null]}>
        <Image source={pictures[picture]} resizeMode="cover" style={styles.fill} accessible={false} />
      </View>
      <View style={[StyleSheet.absoluteFill, focus === "top" ? styles.topShade : styles.artShade, focus === "top" ? styles.artTopShade : null]} />
      <View style={styles.inner}>{children}</View>
    </View>
  );
}

/** A box with a chalk drawing across its top, fading into it, the title lying on its foot. */
export function BandBox({ picture, title, children }: { picture: PictureName; title: ReactNode; children: ReactNode }) {
  return (
    <View style={styles.box}>
      <View style={styles.band}>
        <Image source={pictures[picture]} resizeMode="cover" style={styles.fill} accessible={false} />
        <View style={[StyleSheet.absoluteFill, styles.bandShade]} />
        <View style={styles.bandTitle}>{title}</View>
      </View>
      <View style={styles.bandBody}>{children}</View>
    </View>
  );
}

/** A read's answer, or "–" while it comes, or a line and Try again where it never came. */
export function ReadOr<T>({ read, again, what, children }: { read: Read<T>; again: () => void; what: string; children: (data: T) => ReactNode }) {
  if (read.kind === "loading") return <Txt kind="small">{NOT_KNOWN}</Txt>;
  if (read.kind === "failed")
    return (
      <View style={styles.failed}>
        <Icon name="wifioff" size={16} colour="textSoft" />
        <Txt kind="small" style={styles.grow}>
          {`${what} couldn’t load.`}
        </Txt>
        <Button label="Try again" kind="link" say={`Load ${what.toLowerCase()} again`} onPress={again} />
      </View>
    );
  return <>{children(read.data)}</>;
}

/** The flame of a day trained, gold at its tip running to deep orange, its heart pale. */
/** A glowing pill that opens a box from the bottom to pick from: the period on Trends. */
export function PickButton({ label, say, onPress }: { label: string; say: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={say} onPress={onPress} style={({ pressed }) => [styles.pick, pressed ? styles.pickPressed : null]}>
      <Txt kind="small" colour="orangeLight" numberOfLines={1} style={styles.pickWords}>
        {label}
      </Txt>
      <Icon name="down" size={16} colour="orangeLight" />
    </Pressable>
  );
}

/** The rows of a box from the bottom to pick one from, the picked one lit with a tick (Kd's drawing 1). */
export function PickList<V extends string>({ options, selected, onPick }: { options: readonly { value: V; label: string }[]; selected: V; onPick: (value: V) => void }) {
  return (
    <View style={styles.pickList}>
      {options.map((o) => {
        const on = o.value === selected;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityLabel={o.label}
            accessibilityState={{ selected: on }}
            onPress={() => {
              onPick(o.value);
            }}
            style={({ pressed }) => [styles.pickRow, on ? styles.pickRowOn : null, pressed ? styles.pickPressed : null]}
          >
            <Txt colour={on ? "orangeLight" : "text"} style={styles.pickRowWords}>
              {o.label}
            </Txt>
            {on ? <Icon name="check" size={20} colour="orangeLight" /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export type BadgeTint = keyof typeof badges;

/** A record's badge: a disc lit from its top left, a dark gap and a thin ring of its colour round it,
 *  a white sign on it, glowing in its own colour. */
export function Badge({ icon, tint, size }: { icon: IconName; tint: BadgeTint; size: number }) {
  const t = badges[tint];
  const box = size + 10;
  const mid = box / 2;
  const r = size / 2;
  return (
    <View style={{ width: box, height: box, alignItems: "center", justifyContent: "center" }} accessible={false}>
      <View style={{ position: "absolute", width: size, height: size, borderRadius: r, backgroundColor: t.deep, boxShadow: t.glow }} />
      <Svg width={box} height={box} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="badgeDisc" cx="34%" cy="28%" r="75%">
            <Stop offset="0" stopColor={t.light} />
            <Stop offset="1" stopColor={t.deep} />
          </RadialGradient>
          <LinearGradient id="badgeShine" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={badgeShine.top} stopOpacity={0.34} />
            <Stop offset="0.45" stopColor={badgeShine.top} stopOpacity={0} />
            <Stop offset="0.7" stopColor={badgeShine.foot} stopOpacity={0} />
            <Stop offset="1" stopColor={badgeShine.foot} stopOpacity={0.24} />
          </LinearGradient>
        </Defs>
        <Circle cx={mid} cy={mid} r={r + 3.75} fill="none" stroke={t.deep} strokeOpacity={0.65} strokeWidth={1.5} />
        <Circle cx={mid} cy={mid} r={r + 1.5} fill="none" stroke={colours.box} strokeWidth={3} />
        <Circle cx={mid} cy={mid} r={r} fill="url(#badgeDisc)" />
        <Circle cx={mid} cy={mid} r={r - 0.5} fill="url(#badgeShine)" />
      </Svg>
      <Icon name={icon} size={Math.round(size * 0.46)} colour={tint === "none" ? "textSoft" : "onOrange"} />
    </View>
  );
}

export function Flame({ size, glow = false }: { size: number; glow?: boolean }) {
  const tall = size * (28 / 24);
  const flame = (
    <Svg width={size} height={tall} viewBox="0 0 24 28">
      <Defs>
        <LinearGradient id="flameOut" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colours.gold} />
          <Stop offset="0.55" stopColor={colours.orange} />
          <Stop offset="1" stopColor={colours.flameDeep} />
        </LinearGradient>
        <LinearGradient id="flameIn" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colours.flamePale} />
          <Stop offset="1" stopColor={colours.orangeLight} />
        </LinearGradient>
      </Defs>
      <Path d="M12 0.5C13.6 4.6 19.4 7.5 19.4 15.5C19.4 21.3 16.1 26 12 26C7.9 26 4.6 22.1 4.6 17.2C4.6 13.2 6.6 11 8.2 9.4C8.2 12.5 9.4 14.2 10.9 14.7C10.1 10.3 11.2 4.8 12 0.5Z" fill={colours.orange} opacity={0.25} />
      <Path d="M12 1.5C13.4 5.2 18.6 7.8 18.6 15C18.6 20.3 15.6 24.5 12 24.5C8.4 24.5 5.4 21 5.4 16.6C5.4 13 7.2 11 8.6 9.6C8.6 12.4 9.7 13.9 11 14.4C10.3 10.4 11.3 5.4 12 1.5Z" fill="url(#flameOut)" />
      <Path d="M12 12.8C13 14.9 15.2 16 15.2 18.9C15.2 20.9 13.8 22.4 12 22.4C10.2 22.4 8.8 20.9 8.8 19.2C8.8 17.4 10 16.3 10.9 15.7C11.1 16.8 11.6 17.4 12.2 17.6C11.8 16 12 14.4 12 12.8Z" fill="url(#flameIn)" />
    </Svg>
  );
  if (!glow) return flame;
  const halo = size * 1.6;
  return (
    <View style={{ width: size, height: tall }}>
      <Svg width={halo} height={halo} style={{ position: "absolute", left: (size - halo) / 2, top: tall * 0.62 - halo / 2 }}>
        <Defs>
          <RadialGradient id="flameGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={colours.orange} stopOpacity={0.5} />
            <Stop offset="1" stopColor={colours.orange} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={halo / 2} cy={halo / 2} r={halo / 2} fill="url(#flameGlow)" />
      </Svg>
      {flame}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
  pick: { flexDirection: "row", alignSelf: "flex-start", alignItems: "center", gap: 8, minHeight: sizes.press, paddingHorizontal: 18, borderRadius: sizes.round, backgroundColor: colours.orangeFill, borderWidth: 1, borderColor: colours.orangeLine, boxShadow: shadows.chip },
  pickPressed: { opacity: 0.8 },
  pickWords: { fontFamily: fonts.bold },
  pickList: { gap: 8 },
  // The same border picked or not: a gradient on a box whose border changes crashed Android (31a).
  pickRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 54, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 16, backgroundColor: colours.fill, borderWidth: 1, borderColor: colours.line },
  pickRowOn: { backgroundColor: colours.orangeFill, experimental_backgroundImage: pickedRowGradient, borderColor: colours.fieldOnLine },
  pickRowWords: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22, flexShrink: 1 },
  photo: { position: "absolute", left: 0, right: 0, bottom: 0, width: "100%" },
  fade: { experimental_backgroundImage: pictureFadeUnderWords },
  words: { position: "absolute", left: sizes.edge, right: sizes.edge, bottom: 14, gap: 4 },
  tabs: {
    flexDirection: "row",
    marginTop: 14,
    padding: 4,
    borderRadius: sizes.round,
    backgroundColor: colours.overPicture,
    borderWidth: 1,
    borderColor: colours.lineStrong,
  },
  // Each tab as wide as its word, the room left shared out; a word that still cannot fit shrinks.
  tab: { flexGrow: 1, flexShrink: 1, flexBasis: "auto", minHeight: sizes.press, alignItems: "center", justifyContent: "center", borderRadius: sizes.round, paddingHorizontal: 10 },
  tabOn: { backgroundColor: colours.orange, experimental_backgroundImage: orangeGradient, boxShadow: shadows.chip },
  tabWords: { fontFamily: fonts.bold, textAlign: "center" },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  box: { backgroundColor: colours.box, borderWidth: 1, borderColor: colours.line, borderRadius: 22, overflow: "hidden" },
  art: { position: "absolute", top: 0, bottom: 0, right: 0, width: "66%", opacity: 0.85 },
  artTop: { bottom: undefined, height: 240, width: "100%", opacity: 0.9 },
  artTopShade: { bottom: undefined, height: 242 },
  fill: { position: "absolute", width: "100%", height: "100%" },
  artShade: { experimental_backgroundImage: artShade },
  topShade: { experimental_backgroundImage: topShade },
  inner: { padding: 16, gap: 12 },
  band: { height: 150, justifyContent: "flex-end" },
  bandShade: { experimental_backgroundImage: bandShade },
  bandTitle: { paddingHorizontal: 16, paddingBottom: 8 },
  bandBody: { padding: 16, paddingTop: 8, gap: 10 },
  failed: { flexDirection: "row", alignItems: "center", gap: 8 },
  grow: { flex: 1 },
});
