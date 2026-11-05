import { useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import type { WeeklyChallenge, WeeklyChallengeMeasure, WeeklyChallenges } from "@app/shared";
import { colours, medal } from "../../look/colours";
import { bandFor } from "../../look/bands";
import { medalPicture } from "../../look/medals";
import { Sheet, type SheetPicture } from "../../look/Sheet";
import { Rise } from "../../look/Motion";
import { Txt } from "../../look/Txt";
import { challengeProgress, challengeWords } from "../dashboard/words";
import type { Read } from "../dashboard/useRead";
import { ReadOr } from "../progress/parts";
import { challengeToGo, coinOf, leaves } from "./achievementsRules";
import { Laurel, PaintBox } from "./parts";

// Challenges: this week's three under the Viking painting, each a coin in its difficulty's metal and a laurel branch
// whose leaves turn gold as it is done (Kd's drawing). The same read as the Dashboard's Weekly Challenges box.

const count = (n: number) => n.toLocaleString("en-US");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "3 – 9 Nov", "29 Sep – 5 Oct", from the week's own days. */
export function weekWords(start: string, end: string): string {
  const [, sm, sd] = start.split("-").map(Number);
  const [, em, ed] = end.split("-").map(Number);
  if (sm === undefined || sd === undefined || em === undefined || ed === undefined) return "";
  const startMonth = MONTHS[sm - 1] ?? "";
  const endMonth = MONTHS[em - 1] ?? "";
  return sm === em ? `${String(sd)} – ${String(ed)} ${endMonth}` : `${String(sd)} ${startMonth} – ${String(ed)} ${endMonth}`;
}

const WHAT_COUNTS: Record<WeeklyChallengeMeasure, string> = {
  training_days: "Any workout counts.",
  kcal_burned: "Calories from your workouts.",
  training_minutes: "Every workout's time adds up.",
  form_80_workouts: "Scored by the camera.",
  form_90_workouts: "Scored by the camera.",
  families: "Different kinds of exercise.",
  food_days: "Any meal you log counts.",
};

const DIFFICULTY = { easy: "Easy", medium: "Medium", hard: "Hard" } as const;

export function ChallengesTab({ read, again }: { read: Read<WeeklyChallenges>; again: () => void }) {
  const [open, setOpen] = useState<WeeklyChallenge | null>(null);
  const week = read.kind === "ok" ? read.data : null;
  return (
    <>
    <ReadOr read={read} again={again} what="This week's challenges">
      {(week) => {
        const all = week.challenges.reduce((sum, c) => sum + c.xp, 0);
        const done = week.challenges.filter((c) => c.done).length;
        return (
          <View style={styles.list}>
            <PaintBox picture="vikingbell" height={170}>
              <Txt kind="h3">This Week</Txt>
              <Txt kind="small">{`${weekWords(week.weekStart, week.weekEnd)} · new ones on Monday`}</Txt>
              <View style={styles.xpRow}>
                <Txt kind="h1">{count(week.xpThisWeek)}</Txt>
                <Txt kind="small" colour="textSoft">{`of ${count(all)} XP`}</Txt>
              </View>
              <View style={styles.coins} accessible accessibilityLabel={`${String(done)} of ${String(week.challenges.length)} done`}>
                {week.challenges.map((c) => {
                  const coin = medalPicture(coinOf(c, !c.done));
                  return coin === null ? null : <Image key={c.code} source={coin} accessible={false} style={styles.smallCoin} />;
                })}
              </View>
            </PaintBox>
            {week.challenges.map((c, i) => (
              <Rise key={c.code} delay={i * 80}>
                <ChallengeCard
                  c={c}
                  onPress={() => {
                    setOpen(c);
                  }}
                />
              </Rise>
            ))}
          </View>
        );
      }}
    </ReadOr>
      <Sheet open={open !== null} title={open === null ? "" : challengeWords(open)} picture={paintingOf(open)} onClose={() => { setOpen(null); }}>
        {open === null || week === null ? null : <ChallengeBox c={open} weekEnd={week.weekEnd} />}
      </Sheet>
    </>
  );
}

function ChallengeCard({ c, onPress }: { c: WeeklyChallenge; onPress: () => void }) {
  const coin = medalPicture(coinOf(c));
  const held = c.held !== null && !c.done;
  const { lit, all } = leaves(c);
  const unit = c.measure === "kcal_burned" ? " kcal" : c.measure === "training_minutes" ? " min" : "";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${challengeWords(c)}, ${DIFFICULTY[c.difficulty]}, ${challengeProgress(c)}${unit}. See more`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, held ? styles.held : null, pressed ? styles.pressed : null]}
    >
      <View style={styles.top}>
        {coin === null ? null : <Image source={coin} accessible={false} style={styles.coin} />}
        <View style={styles.grow}>
          <Txt kind="strong">{challengeWords(c)}</Txt>
          <View style={styles.row}>
            <View style={[styles.difficulty, styles[c.difficulty]]}>
              <Txt kind="tiny" colour={c.difficulty === "hard" ? "gold" : "text"} style={styles.difficultyWords}>
                {DIFFICULTY[c.difficulty]}
              </Txt>
            </View>
            <Txt kind="tiny" colour="textSoft" numberOfLines={2} style={styles.grow}>
              {WHAT_COUNTS[c.measure]}
            </Txt>
          </View>
        </View>
        <Txt kind="small" colour="orange" style={styles.xp}>{`+${count(c.xp)} XP`}</Txt>
      </View>
      <Laurel lit={lit} all={all} done={c.done} say={`${challengeProgress(c)}${unit}${c.done ? ", done" : ""}`} />
      <View style={styles.between}>
        <Txt kind="small">{`${challengeProgress(c)}${unit}`}</Txt>
        {c.done ? (
          <Txt kind="small" colour="gold" style={styles.bold}>
            Done
          </Txt>
        ) : held ? (
          <Txt kind="small" colour="orange" style={styles.bold}>
            Paused in Safe mode
          </Txt>
        ) : (
          <Txt kind="small">{challengeToGo(c)}</Txt>
        )}
      </View>
    </Pressable>
  );
}

/** What counts, in a whole sentence, for a challenge's box. */
const COUNTS_IN_FULL: Record<WeeklyChallengeMeasure, string> = {
  training_days: "Any workout counts. A day counts once, however many workouts.",
  kcal_burned: "The calories of every workout this week add up.",
  training_minutes: "The time of every workout this week adds up.",
  form_80_workouts: "Workouts the camera scored 80 or higher.",
  form_90_workouts: "Workouts the camera scored 90 or higher.",
  families: "Each different kind of exercise counts once.",
  food_days: "A day with any meal logged counts.",
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** "Sun" and "ends 8 Nov", from the week's own last day. */
export function endWords(weekEnd: string): { day: string; on: string } {
  const [y, m, d] = weekEnd.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) return { day: "", on: "" };
  const at = new Date(Date.UTC(y, m - 1, d));
  return { day: DAYS[at.getUTCDay()] ?? "", on: `ends ${String(d)} ${MONTHS[m - 1] ?? ""}` };
}

/** The challenge's own painting (Kd, 2026-11-05), or the Viking one where it has none. */
function paintingOf(c: WeeklyChallenge | null): SheetPicture {
  const band = c === null ? null : bandFor(`c_${c.measure}`);
  return band === null ? { name: "vikingbell", focus: 0.5 } : { source: band, focus: 0.25 };
}

/** A challenge's box: its coin and level, what counts, how far along, its XP and the week's end. */
function ChallengeBox({ c, weekEnd }: { c: WeeklyChallenge; weekEnd: string }) {
  const coin = medalPicture(coinOf(c));
  const held = c.held !== null && !c.done;
  const { lit, all } = leaves(c);
  const unit = c.measure === "kcal_burned" ? "kcal" : c.measure === "training_minutes" ? "min" : c.measure === "families" ? "kinds" : c.measure === "food_days" || c.measure === "training_days" ? "days" : "workouts";
  const end = endWords(weekEnd);
  return (
    <View style={styles.box}>
      <View style={styles.top}>
        {coin === null ? null : <Image source={coin} accessible={false} style={styles.bigCoin} />}
        <View style={styles.grow}>
          <View style={[styles.difficulty, styles[c.difficulty], styles.start]}>
            <Txt kind="tiny" colour={c.difficulty === "hard" ? "gold" : "text"} style={styles.difficultyWords}>
              {c.done ? "Done" : DIFFICULTY[c.difficulty]}
            </Txt>
          </View>
          <Txt colour="text">{COUNTS_IN_FULL[c.measure]}</Txt>
        </View>
      </View>
      <View style={styles.stats}>
        <Stat big={count(Math.min(c.current, c.target))} small={`of ${count(c.target)} ${unit}`} />
        <Stat big={`+${count(c.xp)}`} small={c.done ? "XP earned" : "XP when done"} orange />
        <Stat big={end.day} small={end.on} />
      </View>
      <Laurel lit={lit} all={all} done={c.done} say={`${challengeProgress(c)}${c.done ? ", done" : ""}`} />
      <Txt kind="small">{c.done ? "Done this week." : held ? "Paused in Safe mode until the week ends." : `${challengeToGo(c)} this week.`}</Txt>
    </View>
  );
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
  list: { gap: 14 },
  xpRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 10 },
  coins: { flexDirection: "row", gap: 6 },
  smallCoin: { width: 34, height: 34 },
  card: { backgroundColor: colours.box, borderWidth: 1, borderColor: colours.line, borderRadius: 22, padding: 16, gap: 4 },
  held: { opacity: 0.7 },
  top: { flexDirection: "row", alignItems: "center", gap: 12 },
  coin: { width: 50, height: 50 },
  grow: { flex: 1, minWidth: 0, gap: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  difficulty: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  easy: { backgroundColor: medal.bronzeFill },
  medium: { backgroundColor: medal.silverFill },
  hard: { backgroundColor: colours.goldFill },
  difficultyWords: { letterSpacing: 1, textTransform: "uppercase", fontWeight: "700" },
  xp: { alignSelf: "flex-start", fontWeight: "700" },
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  bold: { fontWeight: "700" },
  pressed: { opacity: 0.8 },
  box: { gap: 14 },
  bigCoin: { width: 84, height: 84 },
  start: { alignSelf: "flex-start" },
  stats: { flexDirection: "row", gap: 10 },
  stat: { flex: 1, minHeight: 64, padding: 12, borderRadius: 16, backgroundColor: colours.glass, borderWidth: 1, borderColor: colours.line },
});

