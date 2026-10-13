import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Button } from "../look/Button";
import { Avatar, Card, PictureCard } from "../look/Card";
import { Icon } from "../look/Icon";
import { Page } from "../look/Page";
import { Sheet } from "../look/Sheet";
import { Txt } from "../look/Txt";
import { useSession } from "../session/SessionProvider";
import { ThisCopy } from "./ThisCopy";
import { COMING_SOON, Soon } from "./Soon";

// Each tab's page as the look draws it (docs/design/phone/pages): its heading
// and its own picture. What it holds comes with each feature's own job.

export function DashboardScreen() {
  const { state } = useSession();
  return (
    <Page>
      <Txt kind="h1">Dashboard</Txt>
      {state.kind === "in" && state.isNewAccount ? (
        <Card style={styles.row}>
          <Icon name="check" size={18} colour="goodText" />
          <Txt colour="text" style={styles.grow}>
            Welcome! Your account is ready.
          </Txt>
        </Card>
      ) : null}
      <PictureCard picture="hero" height={300} eyebrow="Today’s Focus" title={"Precision Training\nPowered by AI."} />
      <Soon icon="grid" title="Your day" />
    </Page>
  );
}

export function WorkoutScreen() {
  return (
    <Page>
      <Txt kind="h1">Workout</Txt>
      <PictureCard picture="exhero" height={200} />
      <Soon icon="dumbbell" title="Your workouts" />
    </Page>
  );
}

export function FoodScreen() {
  return (
    <Page>
      <Txt kind="h1">Food</Txt>
      <PictureCard picture="food" height={170} eyebrow="Nutrition" title="Fuel Your Training" />
      <Soon icon="apple" title="Your meals" />
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
      <Soon icon="building" title="Your gym" />
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
        kind="plain"
        icon="logout"
        wide
        onPress={() => {
          setAsking(true);
        }}
      />
      <Sheet open={asking} title="Sign out?" onClose={close}>
        <Button label="Sign out" kind="danger" icon="logout" wide onPress={() => void session.signOut()} />
        <Button label="Cancel" kind="plain" wide onPress={close} />
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  head: { gap: 4 },
  two: { flexDirection: "row", gap: 10 },
  half: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  grow: { flex: 1 },
});
