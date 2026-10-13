import { StyleSheet, View } from "react-native";
import { PictureCard } from "../look/Card";
import { Page } from "../look/Page";
import { Txt } from "../look/Txt";
import { ThisCopy } from "./ThisCopy";
import { Soon } from "./Soon";

// Each tab's page as the look draws it (docs/design/phone/pages): its heading
// and its own picture. What it holds comes with each feature's own job.

export function TodayScreen() {
  return (
    <Page>
      <Txt kind="h1">Today</Txt>
      <PictureCard picture="hero" height={300} eyebrow="Today’s Focus" title={"Precision Training\nPowered by AI."} />
      <Soon
        icon="grid"
        title="Your day"
        line="Your workouts, calories burned, level and this week will be here after you sign in."
      />
    </Page>
  );
}

export function WorkoutScreen() {
  return (
    <Page>
      <Txt kind="h1">Workout</Txt>
      <PictureCard picture="exhero" height={200} />
      <Soon
        icon="dumbbell"
        title="Exercises, My Workout and Running"
        line="The exercise list, the workouts you build and your runs will be here after you sign in."
      />
    </Page>
  );
}

export function FoodScreen() {
  return (
    <Page>
      <Txt kind="h1">Food</Txt>
      <PictureCard picture="food" height={170} eyebrow="Nutrition" title="Fuel Your Training" />
      <Soon
        icon="apple"
        title="Your meals"
        line="Breakfast, lunch, dinner and snacks, with today’s calories and protein, will be here after you sign in."
      />
    </Page>
  );
}

export function GymScreen() {
  return (
    <Page>
      <View style={styles.head}>
        <Txt kind="h1">My gyms</Txt>
        <Txt kind="small">Where you train, when it’s open, and your pass to check in.</Txt>
      </View>
      <Soon
        icon="building"
        title="Your gym"
        line="Your gym, its classes and your pass will be here after you sign in. A gym invites the email address it has for you."
      />
    </Page>
  );
}

export function MeScreen() {
  return (
    <Page>
      <View style={styles.head}>
        <Txt kind="h1">Me</Txt>
        <Txt kind="small">Your profile, your progress and your achievements.</Txt>
      </View>
      <View style={styles.two}>
        <PictureCard picture="progress" height={110} label="Progress" icon="chart" style={styles.half} />
        <PictureCard picture="monalisa" height={110} label="Achievements" icon="trophy" style={styles.half} />
      </View>
      <Soon
        icon="user"
        title="Settings, Progress and Achievements"
        line="Your profile, your charts and your badges will be here after you sign in."
      />
      <ThisCopy />
    </Page>
  );
}

const styles = StyleSheet.create({
  head: { gap: 4 },
  two: { flexDirection: "row", gap: 10 },
  half: { flex: 1 },
});
