// A battery limit that stops a run when the screen turns off (ROADMAP Stage 5 item 37l). Measured on Kd's phone,
// 2026-11-24: with the app set to Restricted, Android took the run's service off foreground seconds after Start; set
// free, the same build recorded every second of 8 minutes with the screen off. The app cannot lift the limit, so the
// Running page says so, with the button to the page where the person does. Said only while the limit is on, and
// checked again each time the person comes back from Settings.
import { useEffect, useState } from "react";
import { AppState, Linking, StyleSheet, View } from "react-native";
import { Button } from "../../look/Button";
import { Txt } from "../../look/Txt";
import { runBatteryNative } from "./runBatteryNative";

export const BATTERY_LIMIT_TITLE = "Keep recording with the screen off";
export const BATTERY_LIMIT_WORDS = "Your phone limits this app in the background, so a run can stop when the screen turns off.";

/** Whether Android limits this app in the background, asked while `asking` and again when the person comes back to
 *  the app. A phone with no such code of this app's, or one that cannot answer, is never told of a limit. */
export function useBatteryLimited(asking: boolean): boolean {
  const [limited, setLimited] = useState(false);
  const [back, setBack] = useState(0);
  useEffect(() => {
    const heard = AppState.addEventListener("change", (next) => {
      if (next === "active") setBack((n) => n + 1);
    });
    return () => {
      heard.remove();
    };
  }, []);
  useEffect(() => {
    if (!asking || runBatteryNative === null) {
      setLimited(false);
      return;
    }
    try {
      setLimited(runBatteryNative.restricted());
    } catch {
      setLimited(false);
    }
  }, [asking, back]);
  return limited;
}

/** This app's battery page; the app's own settings where that page cannot be opened. */
export function openBatterySettings(): void {
  try {
    if (runBatteryNative?.open() === true) return;
  } catch {
    // Opened below.
  }
  void Linking.openSettings();
}

/** The first row of the Running page's settings while the limit is on. */
export function BatteryLimitRow() {
  return (
    <View style={styles.row}>
      <View style={styles.words}>
        <Txt kind="body">{BATTERY_LIMIT_TITLE}</Txt>
        <Txt kind="small" colour="badText">
          {BATTERY_LIMIT_WORDS}
        </Txt>
        <Button kind="link" label="Change battery setting" say="Open this app's battery settings" onPress={openBatterySettings} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 16, paddingVertical: 12, minHeight: 64 },
  words: { gap: 4, alignItems: "flex-start" },
});
