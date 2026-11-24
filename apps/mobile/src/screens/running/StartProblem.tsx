// What stood in the way of Start, with its one button, under the button that was pressed: the
// Running page's START and plan box, and the Dashboard's Start run (37d-iii-a).
import { Linking, StyleSheet, View } from "react-native";
import * as Location from "expo-location";
import { Button } from "../../look/Button";
import { Txt } from "../../look/Txt";
import { openAppSettings, START_PROBLEM_WORDS, type StartProblem } from "./RunLayer";
import { openBatterySettings } from "./BatteryLimit";

/** The phone's location turned on in Android's own box (Google's, as the GPS light asks); its
 *  Location page where a phone has no such box. True once it is on. */
export async function turnOnLocation(): Promise<boolean> {
  try {
    await Location.enableNetworkProviderAsync();
    return true;
  } catch {
    await Linking.sendIntent("android.settings.LOCATION_SOURCE_SETTINGS").catch(() => Linking.openSettings());
    return false;
  }
}

/** The one thing to press for each problem. A switch over every kind: a new kind will not build until
 *  it is given its own button here. */
function AgainButtons({ problem, onAgain, onAnyway }: { problem: StartProblem; onAgain: () => void; onAnyway: () => void }) {
  switch (problem) {
    case "approximate":
      return (
        <View style={styles.choices}>
          <Button kind="link" label="Allow precise location" onPress={onAgain} />
          <Button kind="quiet" label="Open settings" onPress={openAppSettings} />
        </View>
      );
    case "settings":
      return <Button kind="link" label="Open settings" onPress={openAppSettings} />;
    case "denied":
      return <Button kind="link" label="Allow location" onPress={onAgain} />;
    case "off":
      return (
        <Button
          kind="link"
          label="Turn on location"
          onPress={() => {
            void turnOnLocation().then((on) => {
              if (on) onAgain();
            });
          }}
        />
      );
    case "failed":
      // Android refused the run after 3, 2, 1.
      return <Button kind="link" label="Start again" onPress={onAgain} />;
    case "battery":
      // The phone's own words for the switch (Settings, the app, App battery usage); a run is never held back.
      return (
        <View style={styles.choices}>
          <Button kind="link" label="Allow background usage" say="Open this app's battery settings" onPress={openBatterySettings} />
          <Button kind="quiet" label="Start anyway" onPress={onAnyway} />
        </View>
      );
  }
}

/** `onAgain`: Start pressed again, once the person has allowed what was asked. `onAnyway`: the run started as it is, on a
 *  phone that limits the app (37l). */
export function StartProblemBox({ problem, onAgain, onAnyway }: { problem: StartProblem; onAgain: () => void; onAnyway: () => void }) {
  return (
    <View style={styles.problem}>
      <Txt kind="small" colour="badText">
        {START_PROBLEM_WORDS[problem]}
      </Txt>
      <AgainButtons problem={problem} onAgain={onAgain} onAnyway={onAnyway} />
    </View>
  );
}

const styles = StyleSheet.create({
  problem: { gap: 4, alignItems: "flex-start" },
  choices: { flexDirection: "row", gap: 16, flexWrap: "wrap" },
});
