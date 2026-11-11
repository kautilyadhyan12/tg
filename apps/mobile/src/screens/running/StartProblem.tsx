// What stood in the way of Start, with its one button, under the button that was pressed: the
// Running page's START and plan box, and the Dashboard's Start run (37d-iii-a).
import { Linking, StyleSheet, View } from "react-native";
import * as Location from "expo-location";
import { Button } from "../../look/Button";
import { Txt } from "../../look/Txt";
import { openAppSettings, START_PROBLEM_WORDS, type StartProblem } from "./RunLayer";

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

/** `onAgain`: Start pressed again, once the person has allowed what was asked. */
export function StartProblemBox({ problem, onAgain }: { problem: StartProblem; onAgain: () => void }) {
  return (
    <View style={styles.problem}>
      <Txt kind="small" colour="badText">
        {START_PROBLEM_WORDS[problem]}
      </Txt>
      {problem === "approximate" ? (
        <View style={styles.choices}>
          <Button kind="link" label="Allow precise location" onPress={onAgain} />
          <Button kind="quiet" label="Open settings" onPress={openAppSettings} />
        </View>
      ) : problem === "settings" ? (
        <Button kind="link" label="Open settings" onPress={openAppSettings} />
      ) : problem === "denied" ? (
        <Button kind="link" label="Allow location" onPress={onAgain} />
      ) : problem === "off" ? (
        <Button
          kind="link"
          label="Turn on location"
          onPress={() => {
            void turnOnLocation().then((on) => {
              if (on) onAgain();
            });
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  problem: { gap: 4, alignItems: "flex-start" },
  choices: { flexDirection: "row", gap: 16, flexWrap: "wrap" },
});
