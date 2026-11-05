import type { ReactNode } from "react";
import { Animated, Image, Pressable, StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Defs, G, LinearGradient, Path, RadialGradient, Stop } from "react-native-svg";
import type { XpView } from "@app/shared";
import { colours, medal, medalShades, orangeGradient, pictureFadeUnderWords, shadows, sizes } from "../../look/colours";
import { useLoop } from "../../look/Motion";
import { pictures, type PictureName } from "../../look/pictures";
import { pictureTopHeight } from "../../look/sizing";
import { Txt } from "../../look/Txt";
import { NOT_KNOWN } from "../dashboard/words";
import { TABS, type TabKey } from "./achievementsRules";

// Achievements' own pieces (ROADMAP Stage 5 35c-iii; Kd's drawing, reviews/35c-iii-achievements-mock-4.png): the goddess
// over the level and the three tabs, a box with a painting on its right, the laurel branch whose leaves turn gold, and
// the torch on a lane.

const count = (n: number) => n.toLocaleString("en-US");

/** The goddess, big and glowing; the title, the level and its XP, and the three tabs over her. */
export function Hero({ xp, badges, tab, onTab }: { xp: XpView | null; badges: string | null; tab: TabKey; onTab: (t: TabKey) => void }) {
  const { width, height } = useWindowDimensions();
  const tall = pictureTopHeight(width, height, 0.95);
  const breathe = useLoop(3200);
  const glow = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.65, 1] });
  const toNext = xp === null ? null : Math.max(xp.nextLevelAt - xp.total, 0);
  return (
    <View style={{ height: tall }}>
      <View style={[StyleSheet.absoluteFill, styles.clip]}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: glow }]}>
          <Svg width="100%" height="100%">
            <Defs>
              <RadialGradient id="goddessGlow" cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor={colours.orange} stopOpacity={0.42} />
                <Stop offset="0.5" stopColor={colours.orange} stopOpacity={0.08} />
                <Stop offset="1" stopColor={colours.orange} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx="68%" cy="40%" r="60%" fill="url(#goddessGlow)" />
          </Svg>
        </Animated.View>
        <Image source={pictures.goddess} resizeMode="contain" accessible={false} style={[styles.goddess, { height: tall * 0.86, width: tall * 0.86 * (659 / 720) }]} />
      </View>
      <View style={[StyleSheet.absoluteFill, styles.fade]} />
      <View style={styles.words}>
        <Txt kind="hero">Achievements</Txt>
        <View style={styles.level}>
          <LevelRing level={xp?.level ?? null} share={xp === null ? 0 : xp.progressPct / 100} />
          <View style={styles.grow}>
            <Txt kind="strong" numberOfLines={1} fit>
              {xp === null ? NOT_KNOWN : `${count(xp.total)} XP`}
              {badges === null ? null : <Txt kind="strong" colour="orange">{` · ${badges}`}</Txt>}
            </Txt>
            <Txt kind="small" colour="textSoft" numberOfLines={1}>
              {xp === null || toNext === null ? " " : `${count(toNext)} XP to Level ${String(xp.level + 1)}`}
            </Txt>
            <View style={styles.bar}>
              <View style={[styles.barLit, { flex: Math.min(Math.max(xp?.progressPct ?? 0, 0), 100) / 100 }]} />
              <View style={{ flex: 1 - Math.min(Math.max(xp?.progressPct ?? 0, 0), 100) / 100 }} />
            </View>
          </View>
        </View>
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

const RING = 64;
const RING_STROKE = 5;

function LevelRing({ level, share }: { level: number | null; share: number }) {
  const r = (RING - RING_STROKE) / 2;
  const around = 2 * Math.PI * r;
  const lit = Math.max(0, Math.min(1, Number.isFinite(share) ? share : 0));
  return (
    <View style={styles.ring} accessible accessibilityLabel={level === null ? "Level not known yet" : `Level ${String(level)}`}>
      <Svg width={RING} height={RING} style={StyleSheet.absoluteFill}>
        <Circle cx={RING / 2} cy={RING / 2} r={r} stroke={colours.track} strokeWidth={RING_STROKE} fill="none" />
        {lit > 0 ? (
          <Circle
            cx={RING / 2}
            cy={RING / 2}
            r={r}
            stroke={colours.orange}
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            strokeDasharray={`${String(around * lit)} ${String(around)}`}
            fill="none"
            transform={`rotate(-90 ${String(RING / 2)} ${String(RING / 2)})`}
          />
        ) : null}
      </Svg>
      <Txt kind="tiny" colour="textSoft" style={styles.levelWord}>
        LEVEL
      </Txt>
      <Txt kind="big" style={styles.levelNumber}>
        {level === null ? NOT_KNOWN : String(level)}
      </Txt>
    </View>
  );
}

/** A box with one of Kd's paintings on its right, the box's own colour under the words on its left. */
export function PaintBox({ picture, focus = 0.5, height, children, style }: { picture: PictureName; focus?: number; height?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.box, height === undefined ? null : { minHeight: height }, style]}>
      <Image source={pictures[picture]} resizeMode="cover" accessible={false} style={[StyleSheet.absoluteFill, styles.paintFull, { transform: [{ translateY: (0.5 - focus) * 40 }] }]} />
      <View style={[StyleSheet.absoluteFill, styles.paintShade]} />
      <View style={styles.inner}>{children}</View>
    </View>
  );
}

const STEM = "M6 34 C 110 44, 250 18, 362 26";
/** A point along the branch's stem, `t` from 0 to 1 (the stem's own cubic). */
function onStem(t: number): [number, number] {
  const u = 1 - t;
  const x = u * u * u * 6 + 3 * u * u * t * 110 + 3 * u * t * t * 250 + t * t * t * 362;
  const y = u * u * u * 34 + 3 * u * u * t * 44 + 3 * u * t * t * 18 + t * t * t * 26;
  return [x, y];
}

/** A laurel branch for a step-by-step task: `all` leaves along a curved stem, the first `lit` gold and glowing,
 *  the rest outlined; a gold bud with a tick at its end once the task is done. */
export function Laurel({ lit, all, done, say }: { lit: number; all: number; done: boolean; say: string }) {
  const leaves = Array.from({ length: Math.max(all, 0) }, (_, i) => i);
  const [ex] = onStem(lit === 0 ? 0 : Math.min((lit - 0.5) / all + 0.02, 1));
  const [bx, by] = onStem(1);
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={say} style={styles.laurel}>
      <Svg width="100%" height="100%" viewBox="0 -8 372 68" preserveAspectRatio="xMidYMid meet">
        <Defs>
          <LinearGradient id="leafGold" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={medal.goldLight} />
            <Stop offset="0.5" stopColor={medal.gold} />
            <Stop offset="1" stopColor={medal.goldDeep} />
          </LinearGradient>
        </Defs>
        <Path d={STEM} stroke={done ? "url(#leafGold)" : medal.stem} strokeWidth={3.2} fill="none" strokeLinecap="round" />
        {lit > 0 && !done ? <Path d={STEM} stroke="url(#leafGold)" strokeWidth={3.4} fill="none" strokeLinecap="round" strokeDasharray={`${String(ex * 1.02)} 999`} /> : null}
        {leaves.map((i) => {
          const [x, y] = onStem((i + 0.6) / (all + 0.2));
          const on = i < lit;
          return (
            <G key={i} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${i % 2 === 0 ? "-38" : "38"})`}>
              {on ? <Path d="M-2 0 C 6 -12, 25 -12, 33 0 C 25 12, 6 12, -2 0 Z" fill={colours.orange} opacity={0.18} /> : null}
              <Path d="M0 0 C 7 -9, 23 -9, 30 0 C 23 9, 7 9, 0 0 Z" fill={on ? "url(#leafGold)" : medal.leafEmpty} stroke={on ? medal.leafLitLine : medal.leafLine} strokeWidth={1} />
              <Path d="M2 0 H26" stroke={on ? medal.leafVein : medal.leafVeinEmpty} strokeWidth={0.8} />
            </G>
          );
        })}
        {done ? (
          <G>
            <Circle cx={bx} cy={by} r={10} fill={colours.orange} opacity={0.2} />
            <Circle cx={bx} cy={by} r={7} fill="url(#leafGold)" />
            <Path d={`M${String(bx - 3)} ${String(by)} l2 2.4 4 -5`} stroke={medal.onMetal} strokeWidth={1.8} fill="none" />
          </G>
        ) : null}
      </Svg>
    </View>
  );
}

/** The torch at a person's place along their lane. */
export function Torch({ colour }: { colour: string }) {
  return (
    <Svg width={18} height={24} viewBox="0 0 18 24">
      <Path d="M9 0 C11.5 5 17 7.5 17 14 C17 19.5 13.5 24 9 24 C4.5 24 1 19.5 1 14 C1 10 4 7.5 5 4.5 C6 7.5 7.5 8.5 8 9.5 C9.5 6.5 8.8 3.5 9 0Z" fill={colour} opacity={0.3} />
      <Path d="M9 1 C11 6 16 8 16 14 C16 19 13 23 9 23 C5 23 2 19 2 14 C2 10 5 8 6 5 C7 8 8 9 8.5 10 C10 7 9 4 9 1Z" fill={colour} />
      <Path d="M9 11 C10 13 12 14 12 17 C12 19 10.5 21 9 21 C7.5 21 6 19 6 17 C6 15 8 14 9 11Z" fill={colours.flamePale} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
  goddess: { position: "absolute", right: -10, top: "6%" },
  fade: { experimental_backgroundImage: pictureFadeUnderWords },
  words: { position: "absolute", left: sizes.edge, right: sizes.edge, bottom: 14, gap: 8 },
  level: { flexDirection: "row", alignItems: "center", gap: 14 },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  ring: { width: RING, height: RING, alignItems: "center", justifyContent: "center", borderRadius: RING / 2, backgroundColor: colours.page, boxShadow: shadows.logo },
  levelWord: { letterSpacing: 0.8 },
  levelNumber: { lineHeight: 24 },
  bar: { flexDirection: "row", height: 6, borderRadius: 3, backgroundColor: colours.track, marginTop: 5, overflow: "hidden", maxWidth: 260 },
  barLit: { height: 6, borderRadius: 3, backgroundColor: colours.orange, boxShadow: shadows.dotGlow },
  tabs: { flexDirection: "row", marginTop: 6, padding: 4, borderRadius: sizes.round, backgroundColor: colours.fill, borderWidth: 1, borderColor: colours.line },
  tab: { flex: 1, minHeight: sizes.press - 4, alignItems: "center", justifyContent: "center", borderRadius: sizes.round, paddingHorizontal: 6 },
  tabOn: { backgroundColor: colours.orange, experimental_backgroundImage: orangeGradient, boxShadow: shadows.chip },
  tabWords: { fontWeight: "600" },
  box: { backgroundColor: colours.box, borderWidth: 1, borderColor: colours.line, borderRadius: 22, overflow: "hidden" },
  paintFull: { width: "100%", height: "100%" },
  paintShade: { experimental_backgroundImage: medalShades.paint },
  inner: { padding: 16, gap: 8 },
  laurel: { height: 52, width: "100%" },
});
