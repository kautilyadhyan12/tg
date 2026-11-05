import { Image, StyleSheet, View } from "react-native";
import type { WeeklyChallenge, WeeklyChallengeMeasure, WeeklyChallenges } from "@app/shared";
import { colours, medal } from "../../look/colours";
import { medalPicture } from "../../look/medals";
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
  return (
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
                <ChallengeCard c={c} />
              </Rise>
            ))}
          </View>
        );
      }}
    </ReadOr>
  );
}

function ChallengeCard({ c }: { c: WeeklyChallenge }) {
  const coin = medalPicture(coinOf(c));
  const held = c.held !== null && !c.done;
  const { lit, all } = leaves(c);
  const unit = c.measure === "kcal_burned" ? " kcal" : c.measure === "training_minutes" ? " min" : "";
  return (
    <View style={[styles.card, held ? styles.held : null]}>
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
});

