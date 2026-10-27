import type { ReactNode } from "react";
import { Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useNavigation, type NavigationProp, type ParamListBase } from "@react-navigation/native";
import {
  gamificationMeSchema,
  progressOverviewSchema,
  progressTrendSchema,
  weeklyChallengesSchema,
  workoutPageSchema,
  type GamificationMe,
  type ProgressOverview,
  type ProgressTrend,
  type WeeklyChallenges,
  type WorkoutPage,
} from "@app/shared";
import { Button } from "../look/Button";
import { Badge, Card, Pill } from "../look/Card";
import { colours, orangeGradient, pictureShade, sizes } from "../look/colours";
import { Icon, type IconName } from "../look/Icon";
import { Page } from "../look/Page";
import { pictures, type PictureName } from "../look/pictures";
import { PictureTop } from "../look/PictureTop";
import { fonts, Txt } from "../look/Txt";
import { useSession } from "../session/SessionProvider";
import {
  NOT_KNOWN,
  activeDaysWords,
  barShare,
  challengeProgress,
  challengeWords,
  count,
  hoursWords,
  latestBadges,
  noWorkoutsWords,
  quoteOf,
  weekOf,
  weekTrained,
  windowWords,
  workoutLine,
  xpToNext,
} from "./dashboard/words";
import { useRead, type Read } from "./dashboard/useRead";
import { greetingAt } from "./greeting";
import { COMING_SOON } from "./Soon";

// The Dashboard as drawn (docs/design/phone/pages/Today.src.html), from the member web's own page,
// filled with the person's own numbers (ROADMAP Stage 5 item 31a). Each box has its own read, so one
// that is slow or fails never empties another; a number not known is "–", never a 0.

export const DASHBOARD_READS = {
  overview: "/v1/progress/overview?period=all",
  me: "/v1/gamification/me",
  week: "/v1/progress/trend?period=7d",
  challenges: "/v1/gamification/challenges",
  recent: "/v1/workouts?limit=3",
} as const;

export function DashboardScreen() {
  const { state } = useSession();
  const go = useNavigation<NavigationProp<ParamListBase>>();
  const overview = useRead(DASHBOARD_READS.overview, progressOverviewSchema);
  const me = useRead(DASHBOARD_READS.me, gamificationMeSchema);
  const week = useRead(DASHBOARD_READS.week, progressTrendSchema);
  const challenges = useRead(DASHBOARD_READS.challenges, weeklyChallengesSchema);
  const recent = useRead(DASHBOARD_READS.recent, workoutPageSchema);
  const reads = [overview, me, week, challenges, recent];
  const failed = reads.some((one) => one.read.kind === "failed");
  const now = new Date();
  // The workout and the Library are the exercise folders' (items 53, 63, 64); their tab says so.
  const toWorkout = () => {
    go.navigate("Workout");
  };
  // Progress and Achievements live on Me (item 35c).
  const toMe = () => {
    go.navigate("Me");
  };

  return (
    <Page
      top={
        <PictureTop
          picture="hero"
          tall={0.9}
          above={
            <View style={styles.row}>
              <View style={styles.grow}>
                <Txt kind="small">{greetingAt(now.getHours())}</Txt>
                <Txt kind="h1" numberOfLines={1}>
                  {state.kind === "in" ? state.user.displayName : ""}
                </Txt>
              </View>
              <Button label="Start Workout" icon="play" small onPress={toWorkout} />
            </View>
          }
          eyebrow="Today’s Focus"
          title={"Precision Training\nPowered by AI."}
        />
      }
    >
      {failed ? (
        <Card style={styles.row}>
          <Icon name="wifioff" size={18} colour="textSoft" />
          <Txt kind="small" style={styles.grow}>
            Some of your numbers couldn’t load.
          </Txt>
          <Button
            label="Try again"
            kind="link"
            onPress={() => {
              for (const one of reads) if (one.read.kind === "failed") one.again();
            }}
          />
        </Card>
      ) : null}
      <Totals overview={overview.read} me={me.read} />
      <Experience me={me.read} week={week.read} now={now} />
      <ThisWeek week={week.read} now={now} />
      <Swipe>
        <PictureLink picture="weight" label="Browse Exercises" onPress={toWorkout} />
        <PictureLink picture="running" label="View Progress" onPress={toMe} />
        <Motivation now={now} />
      </Swipe>
      <Swipe>
        <Challenges read={challenges.read} />
        <Rank />
        <Badges me={me.read} onPress={toMe} />
      </Swipe>
      <Recent read={recent.read} />
      <Ready onPress={toWorkout} />
    </Page>
  );
}

function known<T, R>(read: Read<T>, pick: (data: T) => R): R | null {
  return read.kind === "ok" ? pick(read.data) : null;
}

function Totals({ overview, me }: { overview: Read<ProgressOverview>; me: Read<GamificationMe> }) {
  const totals = known(overview, (o) => ({ ...o, window: windowWords(o.limitedToDays), hours: hoursWords(o.totalDurationMs) }));
  const xp = known(me, (m) => m.xp);
  return (
    <View style={styles.grid}>
      <Stat
        picture="totalworkout"
        icon="dumbbell"
        value={totals === null ? NOT_KNOWN : count(totals.totalWorkouts)}
        label="Total Workouts"
        sub={totals?.window ?? null}
      />
      <Stat
        picture="hourstrained"
        icon="clock"
        value={totals === null ? NOT_KNOWN : totals.hours.value}
        label="Hours Trained"
        sub={totals === null ? null : `${totals.hours.minutes} · ${totals.window}`}
      />
      <Stat
        picture="caloriesburned"
        icon="flame"
        value={totals === null ? NOT_KNOWN : count(totals.totalKcal)}
        label="Calories Burned"
        sub={totals === null ? null : `kcal · ${totals.window}`}
      />
      <Stat
        picture="currentlevel"
        icon="trophy"
        tone="gold"
        value={xp === null ? NOT_KNOWN : `Level ${count(xp.level)}`}
        label="Current Level"
        sub={xp === null ? null : `${count(xp.total)} XP earned`}
      />
    </View>
  );
}

function Stat(props: { picture: PictureName; icon: IconName; tone?: "orange" | "gold"; value: string; label: string; sub: string | null }) {
  return (
    <Card style={styles.stat}>
      <Image source={pictures[props.picture]} resizeMode="contain" style={styles.statArt} accessible={false} />
      <Badge icon={props.icon} tone={props.tone ?? "orange"} />
      <View>
        <Txt kind="big">{props.value}</Txt>
        <Txt kind="small" colour="text" style={styles.semibold}>
          {props.label}
        </Txt>
        {props.sub === null ? null : <Txt kind="tiny">{props.sub}</Txt>}
      </View>
    </Card>
  );
}

function Experience({ me, week, now }: { me: Read<GamificationMe>; week: Read<ProgressTrend>; now: Date }) {
  const data = known(me, (m) => m);
  const thisWeek = known(week, (w) => weekTrained(w.points, weekOf(now)).workouts);
  const freezes = data?.streak.freezesAvailable ?? null;
  return (
    <Card style={styles.split}>
      <View style={[styles.grow, styles.inner]}>
        <View style={styles.titleRow}>
          <Icon name="zap" size={16} colour="orange" />
          <Txt kind="h3">Experience Points</Txt>
        </View>
        <View style={styles.tight}>
          <View style={styles.between}>
            <Txt kind="tiny" colour="orange" style={styles.semibold}>
              {data === null ? NOT_KNOWN : `Level ${count(data.xp.level)}`}
            </Txt>
            <Txt kind="tiny">{data === null ? "" : xpToNext(data.xp)}</Txt>
          </View>
          <Bar share={data === null ? 0 : barShare(data.xp.progressPct)} />
        </View>
        <View style={styles.three}>
          <Figure value={thisWeek === null ? NOT_KNOWN : count(thisWeek)} label="this week" />
          <Figure value={data === null ? NOT_KNOWN : count(data.streak.current)} label="day streak" />
          <Figure value={freezes === null ? NOT_KNOWN : count(freezes)} label={freezes === 1 ? "freeze left" : "freezes left"} />
        </View>
      </View>
      <View style={styles.sideArt}>
        <Image source={pictures.experiencepoints} resizeMode="contain" style={styles.fill} accessible={false} />
      </View>
    </Card>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.figure}>
      <Txt kind="big" colour="orange">
        {value}
      </Txt>
      <Txt kind="tiny" style={styles.centre}>
        {label}
      </Txt>
    </View>
  );
}

function Bar({ share }: { share: number }) {
  return (
    <View style={styles.bar}>
      <View style={[styles.barFill, { flex: share }]} />
      <View style={{ flex: 100 - share }} />
    </View>
  );
}

function ThisWeek({ week, now }: { week: Read<ProgressTrend>; now: Date }) {
  const days = weekOf(now);
  const trained = known(week, (w) => weekTrained(w.points, days));
  return (
    <Card style={styles.split}>
      <View style={[styles.grow, styles.inner]}>
        <View style={styles.titleRow}>
          <Icon name="calendar" size={16} colour="orange" />
          <Txt kind="h3">This Week</Txt>
        </View>
        <View style={styles.days}>
          {days.map((day, i) => {
            const done = trained?.trained[i] === true;
            return (
              <View
                key={day.key}
                style={styles.day}
                accessible
                accessibilityLabel={`${day.name} ${String(day.date)}${done ? ", trained" : ""}${day.today ? ", today" : ""}`}
              >
                <View style={[styles.dot, done ? styles.dotDone : day.today ? styles.dotNow : null]}>
                  {done ? (
                    <Icon name="check" size={14} colour="onOrange" />
                  ) : (
                    <Txt kind="tiny" colour={day.today ? "orange" : "textSoft"} style={styles.semibold}>
                      {String(day.date)}
                    </Txt>
                  )}
                </View>
                <Txt kind="tiny" colour={day.today ? "orange" : "textFaint"} style={styles.dayName}>
                  {day.name}
                </Txt>
              </View>
            );
          })}
        </View>
        <Txt kind="tiny" style={styles.centre}>
          {trained === null ? NOT_KNOWN : activeDaysWords(trained.days)}
        </Txt>
      </View>
      <View style={styles.sideArtNarrow}>
        <Image source={pictures.thisweek} resizeMode="cover" style={styles.fill} accessible={false} />
      </View>
    </Card>
  );
}

/** A row of boxes that swipes sideways, running off the right edge of the page. */
function Swipe({ children }: { children: ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.swipe} contentContainerStyle={styles.swipeRow}>
      {children}
    </ScrollView>
  );
}

function PictureLink({ picture, label, onPress }: { picture: PictureName; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.box, styles.link]}>
      <Image source={pictures[picture]} resizeMode="cover" style={styles.fill} accessible={false} />
      <View style={[StyleSheet.absoluteFill, styles.shade]} />
      <Txt kind="strong" style={styles.linkWords}>
        {label}
      </Txt>
    </Pressable>
  );
}

function Motivation({ now }: { now: Date }) {
  const quote = quoteOf(now);
  return (
    <View style={[styles.box, styles.quote]}>
      <Image source={pictures.dailymotivation} resizeMode="cover" style={styles.quoteArt} accessible={false} />
      <View style={styles.quoteWords}>
        <Txt kind="eyebrow">Daily Motivation</Txt>
        <Txt kind="small" colour="text" style={styles.italic}>
          “{quote.text}”
        </Txt>
        <Txt kind="tiny">— {quote.author}</Txt>
      </View>
    </View>
  );
}

function Challenges({ read }: { read: Read<WeeklyChallenges> }) {
  return (
    <View style={[styles.box, styles.challenges]}>
      <Image source={pictures.rank} resizeMode="cover" style={[styles.fill, styles.faint]} accessible={false} />
      <View style={[StyleSheet.absoluteFill, styles.shade]} />
      <View style={styles.inner}>
        <View style={styles.titleRow}>
          <Icon name="target" size={16} colour="orange" />
          <Txt kind="h3">Weekly Challenges</Txt>
        </View>
        {read.kind !== "ok" ? (
          <Txt kind="small">{NOT_KNOWN}</Txt>
        ) : (
          read.data.challenges.map((c) => (
            <View key={c.code} style={styles.tight}>
              <View style={styles.between}>
                <Txt kind="tiny" colour="text" style={[styles.semibold, styles.grow]} numberOfLines={1}>
                  {challengeWords(c)}
                </Txt>
                <Txt kind="tiny" colour={c.done ? "goodText" : "textSoft"}>
                  {c.done ? "Done" : c.held === null ? challengeProgress(c) : "Paused in Safe mode"}
                </Txt>
              </View>
              <Bar share={c.done ? 100 : barShare((Math.min(c.current, c.target) / c.target) * 100)} />
            </View>
          ))
        )}
      </View>
    </View>
  );
}

/** The gym's leaderboard reaches the phone with feature folder 1's item 17. */
function Rank() {
  return (
    <View style={[styles.box, styles.rank]}>
      <Image source={pictures.weeklychallenges} resizeMode="cover" style={styles.rankArt} accessible={false} />
      <View style={styles.inner}>
        <View style={styles.titleRow}>
          <Icon name="crown" size={16} colour="orange" />
          <Txt kind="h3">Your Rank</Txt>
        </View>
        <Pill label={COMING_SOON} />
      </View>
    </View>
  );
}

function Badges({ me, onPress }: { me: Read<GamificationMe>; onPress: () => void }) {
  const names = known(me, (m) => latestBadges(m.achievements));
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Latest Badges, View all" onPress={onPress} style={[styles.box, styles.badges]}>
      <Image source={pictures.latestbadges} resizeMode="contain" style={[styles.fill, styles.faint]} accessible={false} />
      <View style={styles.inner}>
        <View style={styles.between}>
          <View style={styles.titleRow}>
            <Icon name="trophy" size={16} colour="orange" />
            <Txt kind="h3">Latest Badges</Txt>
          </View>
          <Txt kind="tiny" colour="orange" style={styles.semibold}>
            View all
          </Txt>
        </View>
        {names === null ? (
          <Txt kind="small">{NOT_KNOWN}</Txt>
        ) : names.length === 0 ? (
          <Txt kind="small">No badges yet.</Txt>
        ) : (
          names.map((name) => <Pill key={name} label={name} tone="gold" icon="star" />)
        )}
      </View>
    </Pressable>
  );
}

function Recent({ read }: { read: Read<WorkoutPage> }) {
  return (
    <Card style={styles.recent}>
      <Image source={pictures.recentworkout} resizeMode="contain" style={styles.recentArt} accessible={false} />
      <Txt kind="h3">Recent Workouts</Txt>
      {read.kind !== "ok" ? (
        <Txt kind="small">{NOT_KNOWN}</Txt>
      ) : read.data.items.length === 0 ? (
        <Txt kind="small">{noWorkoutsWords(read.data.hasAnyWorkouts, read.data.limitedToDays)}</Txt>
      ) : (
        read.data.items.map((w) => {
          const line = workoutLine(w);
          return (
            <View key={w.id} style={[styles.row, styles.workout]}>
              <Badge icon="dumbbell" />
              <View style={styles.grow}>
                <Txt kind="strong">Workout</Txt>
                <Txt kind="tiny">{line.when}</Txt>
              </View>
              <View style={styles.right}>
                {line.kcal === null ? null : (
                  <Txt kind="small" colour="orange" style={styles.semibold}>
                    {line.kcal}
                  </Txt>
                )}
                {line.form === null ? null : <Txt kind="tiny">{line.form}</Txt>}
              </View>
            </View>
          );
        })
      )}
    </Card>
  );
}

function Ready({ onPress }: { onPress: () => void }) {
  return (
    <View style={[styles.box, styles.ready]}>
      <Image source={pictures.ready} resizeMode="cover" style={styles.fill} accessible={false} />
      <View style={[StyleSheet.absoluteFill, styles.shade]} />
      <View style={styles.readyWords}>
        <Txt kind="h2">Ready to start?</Txt>
        <Txt kind="small">Your next workout is one tap away.</Txt>
        <Button label="Start Training" icon="play" small onPress={onPress} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  tight: { gap: 6 },
  inner: { padding: 14, gap: 12 },
  semibold: { fontFamily: fonts.semibold },
  italic: { fontStyle: "italic" },
  centre: { textAlign: "center" },
  fill: { position: "absolute", width: "100%", height: "100%" },
  faint: { opacity: 0.6 },
  shade: { experimental_backgroundImage: pictureShade },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  stat: { width: "47%", flexGrow: 1, minHeight: 118, gap: 8 },
  statArt: { position: "absolute", right: -6, bottom: 6, width: 88, height: 88, opacity: 0.9 },
  split: { flexDirection: "row", padding: 0, gap: 0 },
  sideArt: { width: 92, borderLeftWidth: 1, borderLeftColor: colours.line },
  sideArtNarrow: { width: 76, borderLeftWidth: 1, borderLeftColor: colours.line },
  three: { flexDirection: "row", gap: 6 },
  figure: { flex: 1, alignItems: "center" },
  bar: { flexDirection: "row", height: 6, borderRadius: sizes.round, backgroundColor: colours.track, overflow: "hidden" },
  barFill: { borderRadius: sizes.round, backgroundColor: colours.orange, experimental_backgroundImage: orangeGradient },
  days: { flexDirection: "row", justifyContent: "space-between" },
  day: { alignItems: "center", gap: 6 },
  dot: { width: 30, height: 30, borderRadius: 15, backgroundColor: colours.fill, alignItems: "center", justifyContent: "center" },
  dotDone: { backgroundColor: colours.orange, experimental_backgroundImage: orangeGradient },
  dotNow: { borderWidth: 1.5, borderColor: colours.orange, backgroundColor: colours.orangeFill },
  dayName: { fontFamily: fonts.bold, textTransform: "uppercase" },
  swipe: { marginRight: -sizes.edge },
  swipeRow: { gap: 10, paddingRight: sizes.edge, alignItems: "stretch" },
  box: {
    backgroundColor: colours.box,
    borderWidth: 1,
    borderColor: colours.line,
    borderRadius: sizes.boxRadius,
    overflow: "hidden",
  },
  link: { width: 150, height: 190, justifyContent: "flex-end" },
  linkWords: { margin: 12 },
  quote: { width: 210, minHeight: 190 },
  quoteArt: { position: "absolute", right: 0, bottom: 0, width: 80, height: 150, opacity: 0.9 },
  quoteWords: { padding: 14, paddingRight: 80, gap: 8 },
  challenges: { width: 290, minHeight: 150 },
  rank: { width: 200, minHeight: 150 },
  rankArt: { position: "absolute", right: -14, top: 0, height: "100%", width: 130, opacity: 0.9 },
  badges: { width: 230, minHeight: 150 },
  recent: { gap: 4 },
  recentArt: { position: "absolute", right: 8, top: 2, width: 64, height: 48 },
  workout: { minHeight: 56, borderTopWidth: 1, borderTopColor: colours.line, paddingTop: 8 },
  right: { alignItems: "flex-end" },
  ready: { height: 190, borderRadius: 22, justifyContent: "flex-end" },
  readyWords: { padding: 18, gap: 6, alignItems: "flex-start" },
});
