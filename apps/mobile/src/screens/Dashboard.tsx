import { useEffect, useState, type ReactNode } from "react";
import { AppState, Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useIsFocused, useNavigation, type NavigationProp, type ParamListBase } from "@react-navigation/native";
import {
  gamificationMeSchema,
  goalsResponseSchema,
  mealPageSchema,
  myOrgsResponseSchema,
  progressOverviewSchema,
  progressTrendSchema,
  runPageSchema,
  weeklyChallengesSchema,
  workoutPageSchema,
  type GamificationMe,
  type LeaderboardResponse,
  type MealPage,
  type ProgressOverview,
  type ProgressTrend,
  type RunPage,
  type WeeklyChallenges,
  type WorkoutPage,
} from "@app/shared";
import { Button } from "../look/Button";
import { Badge, Card, Pill } from "../look/Card";
import { boxShade, colours, orangeGradient, pictureShade, sizes } from "../look/colours";
import { Icon, type IconName } from "../look/Icon";
import { Page } from "../look/Page";
import { pictures, type PictureName } from "../look/pictures";
import { PictureTop } from "../look/PictureTop";
import { Steps } from "../look/Progress";
import { fonts, Txt } from "../look/Txt";
import { useSession } from "../session/SessionProvider";
import { useZoneSaved } from "../session/TimeZoneSync";
import {
  NOT_KNOWN,
  activeDaysWords,
  barShare,
  challengeProgress,
  challengeWords,
  count,
  hoursWords,
  latestBadges,
  noActivityWords,
  recentActivity,
  type ActivityKind,
  weekOf,
  weekTrained,
  windowWords,
  xpToNext,
} from "./dashboard/words";
import { Clock } from "./dashboard/Clock";
import { useRead, type Read } from "./dashboard/useRead";
import { GOALS_READ, GoalsBox, GoalsPage, type GoalsOpen } from "./Goals";
import { LeaderboardPage, type LeaderboardPlace } from "./gym/Leaderboard";
import { rankWords } from "./gym/leaderboardView";
import { useGymRank } from "./gym/useGymRank";
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
  runs: "/v1/geo/runs?limit=3",
  meals: "/v1/nutrition/meals?limit=3",
  goals: GOALS_READ,
} as const;
/** Your Rank's: which gym. The Gym tab reads the same. */
const PLACES_READ = "/v1/orgs/mine";

export function DashboardScreen() {
  const { state } = useSession();
  const go = useNavigation<NavigationProp<ParamListBase>>();
  // The week, the streak and the totals are keyed by day in the person's zone: read again once it is saved.
  const zoneSaved = useZoneSaved();
  const overview = useRead(DASHBOARD_READS.overview, progressOverviewSchema, zoneSaved);
  const me = useRead(DASHBOARD_READS.me, gamificationMeSchema, zoneSaved);
  const week = useRead(DASHBOARD_READS.week, progressTrendSchema, zoneSaved);
  const challenges = useRead(DASHBOARD_READS.challenges, weeklyChallengesSchema);
  const recent = useRead(DASHBOARD_READS.recent, workoutPageSchema);
  const runs = useRead(DASHBOARD_READS.runs, runPageSchema);
  const meals = useRead(DASHBOARD_READS.meals, mealPageSchema);
  // A goal's days are the person's own: read again once the zone is saved.
  const goals = useRead(DASHBOARD_READS.goals, goalsResponseSchema, zoneSaved);
  const [goalsOpen, setGoalsOpen] = useState<GoalsOpen | null>(null);
  // Your Rank is the person's first gym's board; somebody using the app alone has a board of their own to come (item 38).
  const places = useRead(PLACES_READ, myOrgsResponseSchema);
  const firstGym = places.read.kind === "ok" ? (places.read.data.orgs.find((org) => org.isMember) ?? null) : null;
  const rank = useGymRank(firstGym?.id ?? null);
  // The clock ticks only while the Dashboard is what the person sees.
  const focused = useIsFocused();
  const [awake, setAwake] = useState(AppState.currentState === "active");
  useEffect(() => {
    const heard = AppState.addEventListener("change", (next) => {
      setAwake(next === "active");
    });
    return () => {
      heard.remove();
    };
  }, []);
  const reads = [overview, me, week, challenges, recent, runs, meals, goals, places, rank];
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
          picture="cave"
          // The picture's own shape, so none of it is cut; its fire is not dimmed.
          tall={1}
          fade="light"
          above={
            <View style={styles.hello}>
              <Txt kind="small">{greetingAt(now.getHours())}</Txt>
              <Txt kind="h1" numberOfLines={1} style={styles.name}>
                {state.kind === "in" ? state.user.displayName : ""}
              </Txt>
            </View>
          }
          foot={
            <View style={styles.footDrop}>
              <Button label="Start Training" icon="play" compact onPress={toWorkout} />
            </View>
          }
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
      <GoalsBox
        read={goals.read}
        onOpen={(on) => {
          goals.again();
          setGoalsOpen(on);
        }}
      />
      <Swipe>
        <Motivation running={focused && awake && goalsOpen === null} />
        <PictureLink picture="weight" label="Browse Exercises" onPress={toWorkout} />
        <PictureLink picture="running" label="View Progress" onPress={toMe} />
      </Swipe>
      <Swipe>
        <Challenges read={challenges.read} />
        {firstGym !== null ? (
          <GymRank key={firstGym.id} place={{ id: firstGym.id, name: firstGym.name, clockFormat: firstGym.clockFormat }} read={rank.read} onClosed={rank.again} />
        ) : places.read.kind === "ok" ? (
          <RankBox big={null} />
        ) : (
          <RankBox big={NOT_KNOWN} />
        )}
        <Badges me={me.read} onPress={toMe} />
      </Swipe>
      <Recent workouts={recent.read} runs={runs.read} meals={meals.read} />
      <Ready onPress={toWorkout} />
      <GoalsPage
        open={goalsOpen}
        onClose={() => {
          setGoalsOpen(null);
        }}
        read={goals.read}
        again={goals.again}
      />
    </Page>
  );
}

function known<T, R>(read: Read<T>, pick: (data: T) => R): R | null {
  return read.kind === "ok" ? pick(read.data) : null;
}

function Totals({ overview, me }: { overview: Read<ProgressOverview>; me: Read<GamificationMe> }) {
  // Sessions are workouts and runs together (Kd's "Total Sessions"); the server sends them apart.
  const totals = known(overview, (o) => ({
    sessions: o.totalWorkouts + o.totalRuns,
    kcal: o.totalKcal + o.runKcal,
    hours: hoursWords(o.totalDurationMs + o.runDurationMs),
    window: windowWords(o.limitedToDays),
  }));
  const xp = known(me, (m) => m.xp);
  return (
    <View style={styles.tight}>
      {totals === null ? null : (
        <Txt kind="tiny" style={styles.windowWords}>
          {totals.window}
        </Txt>
      )}
      <View style={styles.grid}>
      <Stat
        picture="totalworkout"
        icon="dumbbell"
        value={totals === null ? NOT_KNOWN : count(totals.sessions)}
        label="Total Sessions"
      />
      <Stat
        picture="hourstrained"
        icon="clock"
        value={totals === null ? NOT_KNOWN : totals.hours}
        label="Hours Trained"
      />
      <Stat
        picture="caloriesburned"
        icon="flame"
        value={totals === null ? NOT_KNOWN : count(totals.kcal)}
        label="Calories Burned"
      />
      <Stat
        picture="currentlevel"
        icon="trophy"
        tone="gold"
        value={xp === null ? NOT_KNOWN : `Level ${count(xp.level)}`}
        label={xp === null ? "Current Level" : `${count(xp.total)} XP earned`}
      />
      </View>
    </View>
  );
}

function Stat(props: { picture: PictureName; icon: IconName; tone?: "orange" | "gold"; value: string; label: string }) {
  return (
    <Card style={styles.stat}>
      <Image source={pictures[props.picture]} resizeMode="contain" style={styles.statArt} accessible={false} />
      <View style={[StyleSheet.absoluteFill, styles.statShade]} />
      <Badge icon={props.icon} tone={props.tone ?? "orange"} />
      <View>
        <Txt kind="big">{props.value}</Txt>
        <Txt kind="small" style={styles.statLabel}>
          {props.label}
        </Txt>
      </View>
    </Card>
  );
}

function Experience({ me, week, now }: { me: Read<GamificationMe>; week: Read<ProgressTrend>; now: Date }) {
  const data = known(me, (m) => m);
  const thisWeek = known(week, (w) => weekTrained(w.points, weekOf(now), w.runDays).workouts);
  const freezes = data?.streak.freezesAvailable ?? null;
  return (
    <Card style={styles.split}>
      <View style={[styles.grow, styles.inner]}>
        <View style={styles.titleRow}>
          <Icon name="zap" size={16} colour="orange" />
          <Txt kind="h3" style={styles.boxTitle}>Experience Points</Txt>
        </View>
        <View style={styles.tight}>
          <Txt kind="tiny">{data === null ? NOT_KNOWN : xpToNext(data.xp)}</Txt>
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
    <View style={styles.figure} accessible accessibilityLabel={`${value} ${label}`}>
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
      {/* An empty bar draws no fill: no gradient on a view with no width. */}
      {share > 0 ? <View style={[styles.barFill, { flex: share }]} /> : null}
      <View style={{ flex: 100 - share }} />
    </View>
  );
}

function ThisWeek({ week, now }: { week: Read<ProgressTrend>; now: Date }) {
  const days = weekOf(now);
  const trained = known(week, (w) => weekTrained(w.points, days, w.runDays));
  return (
    <Card style={styles.split}>
      <View style={[styles.grow, styles.inner]}>
        <View style={styles.between}>
          <View style={styles.titleRow}>
            <Icon name="calendar" size={16} colour="orange" />
            <Txt kind="h3" style={styles.boxTitle}>This Week</Txt>
          </View>
          <Txt kind="tiny">{trained === null ? NOT_KNOWN : activeDaysWords(trained.days)}</Txt>
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

/** Kd's own picture (2026-10-28), darkened at the top where the clock lies. */
function Motivation({ running }: { running: boolean }) {
  return (
    <View style={[styles.box, styles.motivation]}>
      <Image source={pictures.motivation} resizeMode="cover" style={styles.fill} accessible={false} />
      <View style={styles.motivationWords}>
        <Clock running={running} />
      </View>
    </View>
  );
}

function Challenges({ read }: { read: Read<WeeklyChallenges> }) {
  return (
    <View style={[styles.box, styles.challenges]}>
      <Image source={pictures.weeklychallenges} resizeMode="cover" style={styles.fill} accessible={false} />
      <View style={[StyleSheet.absoluteFill, styles.statShade]} />
      <View style={[styles.grow, styles.inner]}>
        <View style={styles.titleRow}>
          <Icon name="target" size={16} colour="orange" />
          <Txt kind="h3" style={styles.boxTitle}>Weekly Challenges</Txt>
        </View>
        {read.kind !== "ok" ? (
          <Txt kind="small">{NOT_KNOWN}</Txt>
        ) : (
          // In the box's left half: the picture's own figures stand in the right half, never under a row.
          read.data.challenges.map((c) => (
            <View key={c.code} style={[styles.tight, styles.challengeRow]}>
              <Txt kind="tiny" colour="textSoft" numberOfLines={1}>
                {challengeWords(c)}
              </Txt>
              {c.held !== null && !c.done ? (
                <Txt kind="tiny" colour="orange" style={styles.semibold}>
                  Paused in Safe mode
                </Txt>
              ) : (
                <View style={styles.between}>
                  <View style={styles.grow}>
                    <Steps share={c.done ? 1 : Math.min(c.current, c.target) / c.target} />
                  </View>
                  <Txt kind="tiny" colour={c.done ? "goodText" : "orange"} style={styles.semibold}>
                    {c.done ? "Done" : challengeProgress(c)}
                  </Txt>
                </View>
              )}
            </View>
          ))
        )}
      </View>
    </View>
  );
}

/** Your Rank from the person's first gym's board; a press opens the board. */
function GymRank({ place, read, onClosed }: { place: LeaderboardPlace; read: Read<LeaderboardResponse>; onClosed: () => void }) {
  const [open, setOpen] = useState(false);
  const words = read.kind === "ok" && read.data.gymId === place.id ? rankWords(read.data) : null;
  return (
    <>
      <RankBox
        big={words?.big ?? NOT_KNOWN}
        of={words?.of ?? null}
        line={words?.line ?? null}
        say={`Your Rank at ${place.name}`}
        onPress={() => {
          setOpen(true);
        }}
      />
      <LeaderboardPage
        place={open ? place : null}
        onClose={() => {
          setOpen(false);
          onClosed();
        }}
      />
    </>
  );
}

interface RankBoxProps {
  /** Null: somebody who has no gym, whose own board is still to come. */
  big: string | null;
  of?: string | null;
  line?: string | null;
  say?: string;
  onPress?: () => void;
}

function RankBox({ big, of = null, line = null, say, onPress }: RankBoxProps) {
  const inside = (
    <>
      <Image source={pictures.rank} resizeMode="cover" style={styles.fill} accessible={false} />
      <View style={[StyleSheet.absoluteFill, styles.shade]} />
      <View style={styles.inner}>
        <View style={styles.titleRow}>
          <Icon name="crown" size={16} colour="orange" />
          <Txt kind="h3" style={styles.boxTitle}>Your Rank</Txt>
        </View>
        {big === null ? (
          <Pill label={COMING_SOON} />
        ) : (
          <View>
            <View style={styles.rankNumber}>
              <Txt kind="h1" colour="gold">{big}</Txt>
              {of === null ? null : <Txt kind="small" colour="text">{of}</Txt>}
            </View>
            {line === null ? null : <Txt kind="small" colour="text">{line}</Txt>}
          </View>
        )}
      </View>
    </>
  );
  if (onPress === undefined) return <View style={[styles.box, styles.rank]}>{inside}</View>;
  return (
    <Pressable accessibilityRole="button" {...(say === undefined ? {} : { accessibilityLabel: say })} onPress={onPress} style={[styles.box, styles.rank]}>
      {inside}
    </Pressable>
  );
}

function Badges({ me, onPress }: { me: Read<GamificationMe>; onPress: () => void }) {
  const names = known(me, (m) => latestBadges(m.achievements));
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Latest Badges, View all" onPress={onPress} style={[styles.box, styles.badges]}>
      <Image source={pictures.latestbadges} resizeMode="cover" style={styles.fill} accessible={false} />
      <View style={styles.inner}>
        <View style={styles.between}>
          <View style={styles.titleRow}>
            <Icon name="trophy" size={16} colour="orange" />
            <Txt kind="h3" style={styles.boxTitle}>Latest Badges</Txt>
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

const ACTIVITY_ICONS: Record<ActivityKind, IconName> = { workout: "dumbbell", run: "pin", meal: "utensils" };

/** Everything done lately, of any kind. Shown only when all three lists are read: a list missing
 *  would leave out what may be the newest thing. */
function Recent({ workouts, runs, meals }: { workouts: Read<WorkoutPage>; runs: Read<RunPage>; meals: Read<MealPage> }) {
  const rows =
    workouts.kind === "ok" && runs.kind === "ok" && meals.kind === "ok"
      ? recentActivity({ workouts: workouts.data.items, runs: runs.data.items, meals: meals.data.items })
      : null;
  return (
    <Card style={styles.recent}>
      <Image source={pictures.recentworkout} resizeMode="contain" style={styles.recentArt} accessible={false} />
      <View style={[StyleSheet.absoluteFill, styles.statShade]} />
      <Txt kind="h3" style={styles.boxTitle}>
        Recent Activity
      </Txt>
      {rows === null || workouts.kind !== "ok" ? (
        <Txt kind="small">{NOT_KNOWN}</Txt>
      ) : rows.length === 0 ? (
        <Txt kind="small">{noActivityWords(workouts.data.hasAnyWorkouts, workouts.data.limitedToDays)}</Txt>
      ) : (
        rows.map((row) => (
          <View key={row.key} style={[styles.row, styles.workout]}>
            <Badge icon={ACTIVITY_ICONS[row.kind]} />
            <View style={styles.grow}>
              <Txt kind="body" style={styles.semibold}>
                {row.day}
              </Txt>
              {row.detail === "" ? null : <Txt kind="tiny">{row.detail}</Txt>}
            </View>
            {row.value === null ? null : (
              <Txt kind="small" colour="orange" style={styles.semibold}>
                {row.value}
              </Txt>
            )}
          </View>
        ))
      )}
    </Card>
  );
}

function Ready({ onPress }: { onPress: () => void }) {
  return (
    <View style={[styles.box, styles.ready]}>
      <Image source={pictures.ready} resizeMode="cover" style={styles.fill} accessible={false} />
      <View style={[StyleSheet.absoluteFill, styles.statShade]} />
      <View style={styles.readyWords}>
        <Txt kind="h2">Ready to start?</Txt>
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
  hello: { alignItems: "flex-start" },
  name: { alignSelf: "stretch" },
  // A little lower than the picture's own foot, on the ground under the figures (Kd).
  footDrop: { transform: [{ translateY: 12 }] },
  boxTitle: { fontSize: 14, lineHeight: 18, color: colours.textSoft },
  statLabel: { fontSize: 12, lineHeight: 16 },
  centre: { textAlign: "center" },
  fill: { position: "absolute", width: "100%", height: "100%" },
  shade: { experimental_backgroundImage: pictureShade },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  windowWords: { textAlign: "right" },
  stat: { width: "47%", flexGrow: 1, minHeight: 96, padding: 12, gap: 6 },
  statArt: { position: "absolute", top: 0, right: 0, width: "65%", height: "100%", opacity: 0.95 },
  statShade: { experimental_backgroundImage: boxShade },
  split: { flexDirection: "row", padding: 0, gap: 0 },
  sideArt: { width: 92 },
  sideArtNarrow: { width: 76 },
  three: { flexDirection: "row", gap: 6 },
  figure: { flex: 1, alignItems: "center" },
  bar: { flexDirection: "row", height: 6, borderRadius: sizes.round, backgroundColor: colours.track, overflow: "hidden" },
  barFill: { borderRadius: sizes.round, backgroundColor: colours.orange, experimental_backgroundImage: orangeGradient },
  days: { flexDirection: "row", justifyContent: "space-between" },
  day: { alignItems: "center", gap: 6 },
  dot: { width: 30, height: 30, borderRadius: 15, backgroundColor: colours.fill, alignItems: "center", justifyContent: "center" },
  // Flat: a gradient on these crashed Android 15 on Kd's phone (IllegalArgumentException in LinearGradient).
  dotDone: { backgroundColor: colours.orange },
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
  // As tall as the clock box beside them, so the row lines up.
  link: { width: 190, height: 270, justifyContent: "flex-end" },
  linkWords: { margin: 12 },
  // The pictures were widened to these boxes' shapes, so each covers its box without cutting its subject.
  // Square, as its picture is, so the picture covers it whole.
  motivation: { width: 270, height: 270 },
  motivationWords: { paddingHorizontal: 16, paddingTop: 10 },
  // At least this tall, and taller with the phone's large text: the row's boxes grow together.
  challenges: { width: 360, minHeight: 210 },
  challengeRow: { width: "52%" },
  rank: { width: 140, minHeight: 210, justifyContent: "flex-end" },
  rankNumber: { flexDirection: "row", alignItems: "flex-end", flexWrap: "wrap", gap: 6 },
  badges: { width: 230, minHeight: 210 },
  recent: { gap: 4 },
  recentArt: { position: "absolute", top: 0, right: -10, width: "75%", height: "100%", opacity: 0.6 },
  workout: { minHeight: 56, borderTopWidth: 1, borderTopColor: colours.line, paddingTop: 8 },
  ready: { height: 210, borderRadius: 22, justifyContent: "center" },
  readyWords: { padding: 18, gap: 14, alignItems: "flex-start", maxWidth: "62%" },
});
