// The phone's battery limit on this app (ROADMAP Stage 5 item 37l): this app's Android code in `modules/run-battery`.
// There is none on an iPhone yet (Stage 5 item 21), nor in the tests, which hand in their own (test/screens/setup.js);
// a phone without it is never told of a limit.
import { requireOptionalNativeModule } from "expo";

export interface RunBatteryNative {
  /** True when Android holds this app back in the background (the "Restricted" battery setting). */
  restricted(): boolean;
  /** Opens this app's battery page, or its App info page where a phone has none by that name: false when neither opened. */
  open(): boolean;
}

export const runBatteryNative: RunBatteryNative | null = requireOptionalNativeModule<RunBatteryNative>("RunBattery");
