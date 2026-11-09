import { useEffect, useMemo } from "react";
import { AppState, StatusBar, StyleSheet, View } from "react-native";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
// Two weights only, each from its own file, so the other four are never in the app.
import { Oswald_400Regular } from "@expo-google-fonts/oswald/400Regular";
import { Oswald_600SemiBold } from "@expo-google-fonts/oswald/600SemiBold";
import Cinzel_800ExtraBold from "../assets/fonts/Cinzel_800ExtraBold.ttf";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { DarkTheme, NavigationContainer, createNavigationContainerRef, type Theme } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { PhoneAppExtra } from "@app/shared";
import { readAppExtra } from "./appExtra";
import { colours } from "./look/colours";
import type { IconName } from "./look/Icon";
import { Page } from "./look/Page";
import { TabBar } from "./look/TabBar";
import { SignUpNoteGate } from "./screens/BeforeYouStart";
import { InvitationsGate } from "./screens/InvitationsGate";
import { SetupGate } from "./screens/SetupGate";
import { SignInScreen } from "./screens/SignIn";
import { CopyContext, ThisCopy } from "./screens/ThisCopy";
import type { Ask } from "./session/calls";
import { phoneKeyStore, phoneWaitingStore } from "./session/keyStore";
import type { KeyStore } from "./session/session";
import { askGoogle, type AskGoogle } from "./session/google";
import { SessionProvider, useSession } from "./session/SessionProvider";
import { TimeZoneSync } from "./session/TimeZoneSync";
import { AppMinutes } from "./session/MinutesInApp";
import { DashboardScreen } from "./screens/Dashboard";
import { GymScreen } from "./screens/GymTab";
import { NotificationsProvider } from "./notifications/Notifications";
import { forgetNotifications, type Tapped } from "./notifications/phone";
import { emptyPhotoFolder } from "./screens/gym/photoFiles";
import { forgetExports, rememberPerson } from "./session/personFiles";
import { PlacesProvider, usePlaces } from "./screens/places";
import { tabWord } from "./screens/placesHeading";
import { FoodScreen } from "./screens/Food";
import { bodyFile, mealFile, minutesFile, photoSheetFile, runFile } from "./screens/food/fileStore";
import { RunLayerProvider } from "./screens/running/RunLayer";
import { RunOutboxProvider } from "./screens/running/RunOutbox";
import { BodyOutboxProvider } from "./screens/progress/BodyOutbox";
import { MealOutboxProvider } from "./screens/food/MealOutbox";
import { PhotoSheetStoreProvider } from "./screens/food/PhotoSheetStore";
import type { TextStore } from "./screens/food/outbox";
import { MeScreen, WorkoutScreen, openAchievements, openRunning } from "./screens/tabs";

/** The five tabs, in their order (spec Part 6 §16.3a). A tab's name is the word under its icon. */
export const TABS = [
  { name: "Dashboard", icon: "grid", screen: DashboardScreen },
  { name: "Workout", icon: "dumbbell", screen: WorkoutScreen },
  { name: "Food", icon: "apple", screen: FoodScreen },
  { name: "Gym", icon: "building", screen: GymScreen },
  { name: "Me", icon: "user", screen: MeScreen },
] as const satisfies readonly { name: string; icon: IconName; screen: () => React.JSX.Element }[];

const tabIcons: Record<string, IconName> = Object.fromEntries(TABS.map((tab) => [tab.name, tab.icon]));

const Tabs = createBottomTabNavigator();

const theme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colours.orange,
    background: colours.page,
    card: colours.tabBar,
    text: colours.text,
    border: colours.line,
    notification: colours.orange,
  },
};

interface AppProps {
  /** Tests hand these in; the app reads its own. */
  extra?: PhoneAppExtra | null;
  ask?: Ask;
  store?: KeyStore;
  google?: AskGoogle;
  wait?: (ms: number) => Promise<void>;
  /** Where a person's waiting meals are kept: the phone's own file, or a test's. */
  mealStore?: (userId: string) => TextStore;
  /** Where a person's waiting body measurements are kept: the phone's file, or a test's. */
  bodyStore?: (userId: string) => TextStore;
  /** Where a person's photo meal not yet saved is kept (33b-i). */
  photoStore?: (userId: string) => TextStore;
  /** Where a person's saved runs not yet on the server are kept (37a). */
  runStore?: (userId: string) => TextStore;
  /** Where a person's minutes in the app not yet on the server are kept (21f). */
  minutesStore?: (userId: string) => TextStore;
  /** How long a new sign-in looks at the tabs before setup comes up (14d); tests make it short. */
  lookMs?: number;
  /** Where the code step a person left to fetch their code is kept (12e): the phone's key store, or a test's. */
  waitingStore?: KeyStore;
}

/** Signed out, the sign-in screen and nothing of anybody's; signed in, "Before you start" until
 *  the person has ticked it, then any invitation waiting, then setup until it is finished (after a look at the tabs for a new sign-in, 14d), then
 *  the five tabs. */
type Stores = { mealStore: (userId: string) => TextStore; bodyStore: (userId: string) => TextStore; runStore: (userId: string) => TextStore };

function SignedInOrOut({ mealStore, bodyStore, runStore, minutesStore, lookMs, waitingStore }: Stores & { minutesStore: (userId: string) => TextStore; lookMs: number | undefined; waitingStore: KeyStore }) {
  const { state } = useSession();
  // With nobody signed in, nothing of the last person's stays: an app killed with Updates open left its photos.
  useEffect(() => {
    if (state.kind !== "out") return;
    emptyPhotoFolder();
    forgetExports();
    // Nobody's notifications stay on the phone, and none on its way reaches it; asked again on each return.
    void forgetNotifications();
    const heard = AppState.addEventListener("change", (next) => {
      if (next === "active") void forgetNotifications();
    });
    return () => {
      heard.remove();
    };
  }, [state.kind]);
  if (state.kind === "starting") return <View style={styles.page} />;
  if (state.kind === "out") return <SignInScreen note={state.note} waiting={waitingStore} />;
  // Signed in again after a deletion was undone: their files are kept once more.
  rememberPerson(state.user.id);
  return (
    <>
      {/* Counted from the sign-in on, "Before you start" and setup included (21f). */}
      <AppMinutes key={`minutes-${state.user.id}`} userId={state.user.id} store={minutesStore} />
      <SignUpNoteGate key={state.user.id}>
        <TimeZoneSync>
          <InvitationsGate>
            <SetupGate {...(lookMs === undefined ? {} : { lookMs })}>
              <FiveTabs mealStore={mealStore} bodyStore={bodyStore} runStore={runStore} />
            </SetupGate>
          </InvitationsGate>
        </TimeZoneSync>
      </SignUpNoteGate>
    </>
  );
}

// The tabs, reached from outside them: a tapped notification opens the Gym tab, and a training reminder
// Workout or Food (19e-i).
const tabsRef = createNavigationContainerRef<Record<string, undefined>>();
type TappedTab = "Gym" | "Workout" | "Food" | "Dashboard" | "Me";
// The streak reminder opens Workout on Running, the summary the Dashboard, a badge Achievements on Me (19e-ii).
export const tabOfTap = (tapped: Tapped): TappedTab => {
  if (tapped.kind === "progress") return tapped.open === "running" ? "Workout" : tapped.open === "dashboard" ? "Dashboard" : "Me";
  return tapped.kind !== "training" ? "Gym" : tapped.open === "workout" ? "Workout" : "Food";
};
// A tap that opened the app arrives before the tabs are drawn: held until they are.
let heldTab: TappedTab | null = null;
const openTappedTab = (tapped: Tapped) => {
  if (tapped.kind === "progress" && tapped.open === "achievements") openAchievements();
  if (tapped.kind === "progress" && tapped.open === "running") openRunning();
  if (tabsRef.isReady()) tabsRef.navigate(tabOfTap(tapped));
  else heldTab = tabOfTap(tapped);
};
const openHeldTab = () => {
  if (heldTab !== null && tabsRef.isReady()) tabsRef.navigate(heldTab);
  heldTab = null;
};

function FiveTabs({ mealStore, bodyStore, runStore }: Stores) {
  return (
    <PlacesProvider>
      <MealOutboxProvider store={mealStore}>
        <BodyOutboxProvider store={bodyStore}>
          <RunOutboxProvider store={runStore}>
            <RunLayerProvider>
              <NotificationsProvider onTapped={openTappedTab}>
                <TabsOfPlaces />
              </NotificationsProvider>
            </RunLayerProvider>
          </RunOutboxProvider>
        </BodyOutboxProvider>
      </MealOutboxProvider>
    </PlacesProvider>
  );
}

/** The Gym tab is named for the places the person joined ("Studio" for a yoga studio). */
function TabsOfPlaces() {
  const { kinds, newMessages } = usePlaces();
  const labels = { Gym: tabWord(kinds ?? []) };
  // Lit while any of the person's places holds a message they have not opened.
  const dots: Record<string, string> = newMessages > 0 ? { Gym: newMessages === 1 ? "1 new message" : `${String(newMessages)} new messages` } : {};
  return (
    <NavigationContainer ref={tabsRef} theme={theme} onReady={openHeldTab}>
      <Tabs.Navigator screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} icons={tabIcons} labels={labels} dots={dots} />}>
        {TABS.map((tab) => (
          <Tabs.Screen key={tab.name} name={tab.name} component={tab.screen} />
        ))}
      </Tabs.Navigator>
    </NavigationContainer>
  );
}

export function App({ extra, ask = fetch, store = phoneKeyStore, google = askGoogle, wait, mealStore = mealFile, bodyStore = bodyFile, photoStore = photoSheetFile, runStore = runFile, minutesStore = minutesFile, lookMs, waitingStore = phoneWaitingStore }: AppProps) {
  // A font that cannot be read must not leave a blank page: the phone's own font shows instead.
  const [fontsReady, fontsFailed] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Oswald_400Regular,
    Oswald_600SemiBold,
    Cinzel_800ExtraBold,
  });
  const copy = useMemo(() => ({ extra: extra === undefined ? readAppExtra() : extra, ask }), [extra, ask]);
  const apiUrl = copy.extra?.apiUrl;
  const server = useMemo(() => (apiUrl === undefined ? null : { apiUrl, ask }), [apiUrl, ask]);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      {fontsReady || fontsFailed !== null ? (
        <CopyContext.Provider value={copy}>
          {server === null ? (
            // A copy that opened with no settings has no server to sign in to, and says so.
            <Page>
              <ThisCopy />
            </Page>
          ) : (
            <SessionProvider server={server} store={store} google={google} wait={wait}>
              <PhotoSheetStoreProvider store={photoStore}>
                <SignedInOrOut mealStore={mealStore} bodyStore={bodyStore} runStore={runStore} minutesStore={minutesStore} lookMs={lookMs} waitingStore={waitingStore} />
              </PhotoSheetStoreProvider>
            </SessionProvider>
          )}
        </CopyContext.Provider>
      ) : (
        <View style={styles.page} />
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.page },
});
