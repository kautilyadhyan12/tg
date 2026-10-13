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
import { TabBar } from "./look/TabBar";
import { CopyContext, type Ask } from "./screens/ThisCopy";
import { FoodScreen, GymScreen, MeScreen, DashboardScreen, WorkoutScreen } from "./screens/tabs";

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
}

export function App({ extra, ask = fetch }: AppProps) {
  const [fontsReady] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  const copy = useMemo(() => ({ extra: extra === undefined ? readAppExtra() : extra, ask }), [extra, ask]);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colours.page} />
      {fontsReady ? (
        <CopyContext.Provider value={copy}>
          <NavigationContainer theme={theme}>
            <Tabs.Navigator
              screenOptions={{ headerShown: false }}
              tabBar={(props) => <TabBar {...props} icons={tabIcons} />}
            >
              {TABS.map((tab) => (
                <Tabs.Screen key={tab.name} name={tab.name} component={tab.screen} />
              ))}
            </Tabs.Navigator>
          </NavigationContainer>
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
