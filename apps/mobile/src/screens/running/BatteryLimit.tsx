// A battery limit that stops a run when the screen turns off (ROADMAP Stage 5 item 37l). Measured on Kd's phone,
// 2026-11-24: with the app set to Restricted, Android took the run's service off foreground seconds after Start; set
// free, the same build recorded every second of 8 minutes with the screen off. The app cannot lift the limit, so
// Start says so, only on a phone that limits the app, with the button to the page where the person lifts it.
import { Linking } from "react-native";
import { runBatteryNative } from "./runBatteryNative";

/** Whether Android limits this app in the background now. A phone with no such code of this app's, or one that cannot
 *  answer, is never told of a limit: a warning that is false is worse than none. */
export function batteryLimited(): boolean {
  try {
    return runBatteryNative?.restricted() === true;
  } catch {
    return false;
  }
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

/** Said where the box was when the person comes back with the limit lifted. What happened, and no more: on Kd's phone
 *  the memory manager closed a run lifted to "Optimised" 76 s after the screen went off, so recording to the end is not
 *  the app's to promise. */
export const BATTERY_ON_WORDS = "Battery setting changed.";
