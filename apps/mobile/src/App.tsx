import { useMemo } from "react";
import { StatusBar, StyleSheet, View } from "react-native";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { DarkTheme, NavigationContainer, type Theme } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { PhoneAppExtra } from "@app/shared";
import { readAppExtra } from "./appExtra";
import { colours } from "./look/colours";
import type { IconName } from "./look/Icon";
import { Page } from "./look/Page";
import { TabBar } from "./look/TabBar";
import { SignUpNoteGate } from "./screens/BeforeYouStart";
import { InvitationsGate } from "./screens/InvitationsGate";
import { SignInScreen } from "./screens/SignIn";
import { CopyContext, ThisCopy } from "./screens/ThisCopy";
import type { Ask } from "./session/calls";
import { phoneKeyStore } from "./session/keyStore";
import type { KeyStore } from "./session/session";
import { askGoogle, type AskGoogle } from "./session/google";
import { SessionProvider, useSession } from "./session/SessionProvider";
import { DashboardScreen } from "./screens/Dashboard";
import { GymScreen } from "./screens/GymTab";
import { PlacesProvider, usePlaces } from "./screens/places";
import { tabWord } from "./screens/placesHeading";
import { FoodScreen, MeScreen, WorkoutScreen } from "./screens/tabs";

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
}

/** Signed out, the sign-in screen and nothing of anybody's; signed in, "Before you start" until
 *  the person has ticked it, then any invitation waiting, then the five tabs. */
function SignedInOrOut() {
  const { state } = useSession();
  if (state.kind === "starting") return <View style={styles.page} />;
  if (state.kind === "out") return <SignInScreen note={state.note} />;
  return (
    <SignUpNoteGate key={state.user.id}>
      <InvitationsGate>
        <FiveTabs />
      </InvitationsGate>
    </SignUpNoteGate>
  );
}

function FiveTabs() {
  return (
    <PlacesProvider>
      <TabsOfPlaces />
    </PlacesProvider>
  );
}

/** The Gym tab is named for the places the person joined ("Studio" for a yoga studio). */
function TabsOfPlaces() {
  const { kinds } = usePlaces();
  const labels = { Gym: tabWord(kinds ?? []) };
  return (
    <NavigationContainer theme={theme}>
      <Tabs.Navigator screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} icons={tabIcons} labels={labels} />}>
        {TABS.map((tab) => (
          <Tabs.Screen key={tab.name} name={tab.name} component={tab.screen} />
        ))}
      </Tabs.Navigator>
    </NavigationContainer>
  );
}

export function App({ extra, ask = fetch, store = phoneKeyStore, google = askGoogle, wait }: AppProps) {
  // A font that cannot be read must not leave a blank page: the phone's own font shows instead.
  const [fontsReady, fontsFailed] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
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
              <SignedInOrOut />
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
