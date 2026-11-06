import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Button } from "../look/Button";
import { Avatar, Badge, Card, PictureCard } from "../look/Card";
import { sizes } from "../look/colours";
import { Icon } from "../look/Icon";
import { Page } from "../look/Page";
import { PictureTop } from "../look/PictureTop";
import { Txt } from "../look/Txt";
import { useSession } from "../session/SessionProvider";
import { Segments } from "../look/Choice";
import { RunningTab } from "./running/RunningTab";
import { SettingsPage } from "./Settings";
import { Setup, accountUnits } from "./setup/Setup";
import { SignOutAsk } from "./SignOutAsk";
import { ProgressPage } from "./progress/ProgressPage";
import { AchievementsPage } from "./achievements/AchievementsPage";
import { ThisCopy } from "./ThisCopy";
import { Soon } from "./Soon";

// Each tab's page as the look draws it (docs/design/phone/pages). Its own picture runs edge to
// edge from the top and into the page, never a box of its own, with the page's first words over it.
// No page says its tab's name again above itself: the lit tab below already does.
// What a page holds comes with each feature's own job; the Dashboard has its own file.

type WorkoutPart = "exercises" | "mine" | "running";

const WORKOUT_PARTS = [
  { value: "exercises", label: "Exercises" },
  { value: "mine", label: "My Workout" },
  { value: "running", label: "Running" },
] as const;

// The streak reminder's tap opens Workout on Running (19e-ii): a run is what keeps a streak from the phone today.
let runningAsked = false;
const runningWatchers = new Set<() => void>();
export function openRunning(): void {
  runningAsked = true;
  for (const watcher of runningWatchers) watcher();
}

/** Exercises, My Workout and Running across the picture's top, as drawn (docs/design/phone/pages/Workout):
 *  it opens on Exercises, where the Dashboard's Browse Exercises points. Running is 37a's; the other two come
 *  with exercise folder 2's jobs. */
export function WorkoutScreen() {
  const { state } = useSession();
  const units = (state.kind === "in" ? accountUnits(state.user.units) : null) ?? "metric";
  const [part, setPart] = useState<WorkoutPart>("exercises");
  useEffect(() => {
    const take = () => {
      if (!runningAsked) return;
      runningAsked = false;
      setPart("running");
    };
    take();
    runningWatchers.add(take);
    return () => {
      runningWatchers.delete(take);
    };
  }, []);
  const parts = <Segments options={WORKOUT_PARTS} selected={part} onPick={setPart} />;
  // The three lie just under the picture, never over it (Kd, 37a's click-through: over it they cut it).
  return part === "running" ? (
    <RunningTab units={units} parts={parts} />
  ) : (
    <Page top={<PictureTop picture="exhero" tall={0.62} eyebrow="Exercise Library" title="Exercises" />}>
      {parts}
      <Soon icon="dumbbell" title={part === "mine" ? "My Workout" : "Your workouts"} />
    </Page>
  );
}

export function MeScreen() {
  return (
    <Page>
      <Account />
      <YourPlan />
      <View style={styles.two}>
        <ProgressCard />
        <AchievementsCard />
      </View>
      <SettingsLink />
      <SignOut />
      <ThisCopy />
    </Page>
  );
}

/** Whose account this phone is signed in to. */
function Account() {
  const { state } = useSession();
  if (state.kind !== "in") return null;
  const { displayName, email } = state.user;
  return (
    <Card style={styles.row}>
      <Avatar name={displayName} />
      <View style={styles.grow}>
        <Txt kind="strong" numberOfLines={1}>
          {displayName}
        </Txt>
        {email === null ? null : (
          <Txt kind="small" numberOfLines={1}>
            {email}
          </Txt>
        )}
      </View>
    </Card>
  );
}

/** Setup's answers: the goal, the body and the week the plan is built on, opened over the tab. */
function YourPlan() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Your plan"
        style={styles.press}
        onPress={() => {
          setOpen(true);
        }}
      >
        <Card style={styles.row}>
          <Badge icon="target" />
          <View style={styles.grow}>
            <Txt kind="strong">Your plan</Txt>
            <Txt kind="small">Your goal, body and week</Txt>
          </View>
          <Icon name="go" size={18} colour="textFaint" />
        </Card>
      </Pressable>
      <Setup
        open={open}
        onClose={() => {
          setOpen(false);
        }}
      />
    </>
  );
}

/** Progress's picture, opening the page over the tab. */
function ProgressCard() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Progress"
        style={[styles.half, styles.press]}
        onPress={() => {
          setOpen(true);
        }}
      >
        <PictureCard picture="progress" height={120} label="Progress" icon="chart" />
      </Pressable>
      <ProgressPage
        open={open}
        onClose={() => {
          setOpen(false);
        }}
      />
    </>
  );
}

// A tapped badge notification opens Achievements over the Me tab (19e-ii): asked before the tab is drawn,
// it opens once the tab is.
let achievementsAsked = false;
const achievementsWatchers = new Set<() => void>();
export function openAchievements(): void {
  achievementsAsked = true;
  for (const watcher of achievementsWatchers) watcher();
}

/** Achievements' picture, opening the page over the tab (35c-iii). */
function AchievementsCard() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const take = () => {
      if (!achievementsAsked) return;
      achievementsAsked = false;
      setOpen(true);
    };
    take();
    achievementsWatchers.add(take);
    return () => {
      achievementsWatchers.delete(take);
    };
  }, []);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Achievements"
        style={[styles.half, styles.press]}
        onPress={() => {
          setOpen(true);
        }}
      >
        <PictureCard picture="goddess" height={120} label="Achievements" icon="trophy" whole />
      </Pressable>
      <AchievementsPage
        open={open}
        onClose={() => {
          setOpen(false);
        }}
      />
    </>
  );
}

/** Settings, opened over the tab: the name, units, Hide me, what each place can see, the account. */
function SettingsLink() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Settings"
        style={styles.press}
        onPress={() => {
          setOpen(true);
        }}
      >
        <Card style={styles.row}>
          <Badge icon="settings" />
          <View style={styles.grow}>
            <Txt kind="strong">Settings</Txt>
            <Txt kind="small">Name, units, notifications, privacy and account</Txt>
          </View>
          <Icon name="go" size={18} colour="textFaint" />
        </Card>
      </Pressable>
      <SettingsPage
        open={open}
        onClose={() => {
          setOpen(false);
        }}
      />
    </>
  );
}

/** The way out of the account; nothing happens until the person says so in the box from the bottom. */
function SignOut() {
  const [asking, setAsking] = useState(false);
  const close = () => {
    setAsking(false);
  };
  return (
    <>
      <Button
        label="Sign out"
        kind="quiet"
        icon="logout"
        style={styles.middle}
        onPress={() => {
          setAsking(true);
        }}
      />
      <SignOutAsk open={asking} onClose={close} />
    </>
  );
}

const styles = StyleSheet.create({
  two: { flexDirection: "row", gap: 10 },
  half: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  grow: { flex: 1 },
  middle: { alignSelf: "center" },
  press: { minHeight: sizes.press },
});
