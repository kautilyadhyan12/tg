import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Button } from "../look/Button";
import { Avatar, Card, PictureCard } from "../look/Card";
import { Page } from "../look/Page";
import { PictureTop } from "../look/PictureTop";
import { Sheet } from "../look/Sheet";
import { Txt } from "../look/Txt";
import { useSession } from "../session/SessionProvider";
import { greetingAt } from "./greeting";
import { ThisCopy } from "./ThisCopy";
import { COMING_SOON, Soon } from "./Soon";

// Each tab's page as the look draws it (docs/design/phone/pages). Its own picture runs edge to
// edge from the top and into the page, never a box of its own, with the page's first words over it.
// No page says its tab's name again above itself: the lit tab below already does.
// What a page holds comes with each feature's own job.

export function DashboardScreen() {
  const { state } = useSession();
  return (
    <Page
      top={
        <PictureTop
          picture="hero"
          tall={0.9}
          above={
            <>
              <Txt kind="small">{greetingAt(new Date().getHours())}</Txt>
              <Txt kind="h1" numberOfLines={1}>
                {state.kind === "in" ? state.user.displayName : ""}
              </Txt>
            </>
          }
          eyebrow="Today’s Focus"
          title={"Precision Training\nPowered by AI."}
        />
      }
    >
      <Soon icon="grid" title="Your day" />
    </Page>
  );
}

export function WorkoutScreen() {
  return (
    <Page top={<PictureTop picture="exhero" tall={0.62} eyebrow="Exercise Library" title="Exercises" />}>
      <Soon icon="dumbbell" title="Your workouts" />
    </Page>
  );
}

export function FoodScreen() {
  return (
    <Page top={<PictureTop picture="food" tall={0.62} eyebrow="Nutrition" title="Fuel Your Training" />}>
      <Soon icon="apple" title="Your meals" />
    </Page>
  );
}

export function MeScreen() {
  return (
    <Page>
      <Account />
      <View style={styles.two}>
        <PictureCard picture="progress" height={120} label="Progress" icon="chart" pill={COMING_SOON} style={styles.half} />
        <PictureCard
          picture="monalisa"
          height={120}
          label="Achievements"
          icon="trophy"
          pill={COMING_SOON}
          style={styles.half}
        />
      </View>
      <Soon icon="settings" title="Settings" />
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

/** The way out of the account; nothing happens until the person says so in the box from the bottom. */
function SignOut() {
  const { session } = useSession();
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
      <Sheet open={asking} title="Sign out?" onClose={close}>
        <View style={styles.two}>
          <Button label="Cancel" kind="plain" style={styles.half} onPress={close} />
          <Button label="Sign out" kind="danger" icon="logout" style={styles.half} onPress={() => void session.signOut()} />
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  two: { flexDirection: "row", gap: 10 },
  half: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  grow: { flex: 1 },
  middle: { alignSelf: "center" },
});
