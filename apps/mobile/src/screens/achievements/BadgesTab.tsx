import { useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import type { Badge, BadgeList } from "@app/shared";
import { colours, medal, medalShades } from "../../look/colours";
import { medalPicture } from "../../look/medals";
import { Rise } from "../../look/Motion";
import { Sheet } from "../../look/Sheet";
import { Txt } from "../../look/Txt";
import type { Read } from "../dashboard/useRead";
import { ReadOr } from "../progress/parts";
import { badgeGroups, earnedDay, medalOf, ofWords, progressWords, share, TIER_LABEL, toGoWords, type ShownBadge } from "./achievementsRules";
import { Laurel } from "./parts";

// Badges: every badge as its own medal, standing on dark shelves three to a row, in its group (Kd's drawing): an earned
// one in its metal with the day it was earned, the rest grey with how far along the person is. A medal pressed opens its
// box from the bottom under a painting.

const count = (n: number) => n.toLocaleString("en-US");

export function BadgesTab({ read, again }: { read: Read<BadgeList>; again: () => void }) {
  const [open, setOpen] = useState<ShownBadge | null>(null);
  const now = new Date();
  return (
    <>
      <ReadOr read={read} again={again} what="Your badges">
        {(data) => (
          <View style={styles.groups}>
            {badgeGroups(data.badges).map((g, gi) => (
              <View key={g.key}>
                <View style={styles.heading}>
                  <Txt kind="eyebrow" style={styles.headingWords}>
                    {g.label}
                  </Txt>
                  <View style={styles.headingLine} />
                  <Txt kind="tiny">{`${count(g.earned)} of ${count(g.badges.length)}`}</Txt>
                </View>
                {rowsOf(g.badges).map((row) => (
                  <View key={row.map((b) => b.badge.code).join()} style={styles.shelf}>
                    <View style={styles.ledge} />
                    {row.map((b, i) => (
                      <Rise key={b.badge.code} delay={gi * 60 + i * 40} style={styles.third}>
                        <MedalOnShelf b={b} now={now} onPress={() => { setOpen(b); }} />
                      </Rise>
                    ))}
                    {row.length < 3 ? Array.from({ length: 3 - row.length }, (_, i) => <View key={`gap${String(i)}`} style={styles.third} />) : null}
                  </View>
                ))}
              </View>
            ))}
          </View>
        )}
      </ReadOr>
      <Sheet open={open !== null} title={open?.name ?? ""} picture={{ name: "greekyoga", focus: 0.2 }} onClose={() => { setOpen(null); }}>
        {open === null ? null : <BadgeBox b={open} now={now} />}
      </Sheet>
    </>
  );
}

function rowsOf<T>(items: readonly T[]): T[][] {
  const rows: T[][] = [];
  items.forEach((item, i) => {
    if (i % 3 === 0) rows.push([]);
    rows[rows.length - 1]?.push(item);
  });
  return rows;
}

function MedalOnShelf({ b, now, onPress }: { b: ShownBadge; now: Date; onPress: () => void }) {
  const earned = b.badge.earnedAt !== null;
  const picture = medalPicture(medalOf(b.badge, !earned));
  const line = b.badge.earnedAt !== null ? earnedDay(b.badge.earnedAt, now) : progressWords(b);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${b.name}, ${TIER_LABEL[b.badge.tier]}. ${earned ? `Earned ${line}` : `Not earned yet, ${line}`}.`}
      onPress={onPress}
      style={({ pressed }) => [styles.medal, pressed ? styles.pressed : null]}
    >
      <View style={styles.art}>
        {earned ? <View style={styles.glow} /> : null}
        {picture === null ? null : <Image source={picture} resizeMode="contain" accessible={false} style={styles.picture} />}
      </View>
      <Txt kind="small" colour={earned ? "text" : "textSoft"} numberOfLines={2} style={styles.name}>
        {b.name}
      </Txt>
      <Txt kind="tiny" colour={earned ? "orange" : "textFaint"} numberOfLines={1} fit style={styles.line}>
        {line}
      </Txt>
    </Pressable>
  );
}

/** A badge's box: the medal big, what it takes, how far along, its XP and its metal. */
function BadgeBox({ b, now }: { b: ShownBadge; now: Date }) {
  const earned = b.badge.earnedAt !== null;
  const picture = medalPicture(medalOf(b.badge, false));
  return (
    <View style={styles.box}>
      <View style={styles.boxTop}>
        {picture === null ? null : <Image source={picture} resizeMode="contain" accessible={false} style={[styles.big, earned ? null : styles.notYet]} />}
        <View style={styles.boxWords}>
          <View style={[styles.chip, earned ? styles.chipEarned : null]}>
            <Txt kind="tiny" colour={earned ? "onBar" : "textSoft"}>
              {earned && b.badge.earnedAt !== null ? `Earned ${earnedDay(b.badge.earnedAt, now)}` : "Not earned yet"}
            </Txt>
          </View>
          <Txt colour="text">{b.takes}</Txt>
        </View>
      </View>
      <View style={styles.stats}>
        <Stat big={earned ? "Done" : count(progressFigure(b.badge))} small={earned ? "earned" : ofWords(b)} />
        <Stat big={`+${count(b.badge.xp)}`} small={earned ? "XP earned" : "XP when earned"} orange />
        <Stat big={TIER_LABEL[b.badge.tier]} small="medal" />
      </View>
      {earned ? null : (
        <>
          <Laurel lit={Math.floor(share(b.badge) * 10)} all={10} done={false} say={progressWords(b)} />
          <Txt kind="small">{toGoWords(b)}</Txt>
        </>
      )}
    </View>
  );
}

/** The figure in the first box: the workouts first where they are still owed, else how far along. */
function progressFigure(b: Badge): number {
  return b.workoutsFirst !== null && b.workoutsFirst.current < b.workoutsFirst.target ? b.workoutsFirst.current : b.current;
}

function Stat({ big, small, orange = false }: { big: string; small: string; orange?: boolean }) {
  return (
    <View style={styles.stat}>
      <Txt kind="big" colour={orange ? "orange" : "text"} numberOfLines={1} fit>
        {big}
      </Txt>
      <Txt kind="tiny" colour="textSoft" numberOfLines={2}>
        {small}
      </Txt>
    </View>
  );
}


const styles = StyleSheet.create({
  groups: { gap: 6 },
  heading: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10, marginBottom: 2 },
  headingWords: { color: medal.heading },
  headingLine: { flex: 1, height: 1, experimental_backgroundImage: medalShades.heading },
  shelf: { flexDirection: "row", paddingTop: 4 },
  ledge: { position: "absolute", left: -4, right: -4, top: 118, height: 9, borderRadius: 3, experimental_backgroundImage: medalShades.shelf, boxShadow: medalShades.shelfShadow },
  third: { flex: 1 },
  medal: { alignItems: "center", paddingBottom: 6 },
  pressed: { opacity: 0.75 },
  art: { height: 118, width: "100%", alignItems: "center", justifyContent: "flex-end" },
  glow: { position: "absolute", top: 18, width: 84, height: 84, borderRadius: 42, boxShadow: medalShades.earnedGlow },
  picture: { width: 100, height: 117 },
  name: { textAlign: "center", fontWeight: "700", marginTop: 16, paddingHorizontal: 2 },
  line: { textAlign: "center", marginTop: 2 },
  box: { gap: 14 },
  boxTop: { flexDirection: "row", alignItems: "center", gap: 14 },
  big: { width: 112, height: 131 },
  notYet: { opacity: 0.5 },
  boxWords: { flex: 1, gap: 10 },
  chip: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: colours.fill },
  chipEarned: { backgroundColor: medal.gold },
  stats: { flexDirection: "row", gap: 10 },
  stat: { flex: 1, minHeight: 64, padding: 12, borderRadius: 16, backgroundColor: colours.glass, borderWidth: 1, borderColor: colours.line },
});
