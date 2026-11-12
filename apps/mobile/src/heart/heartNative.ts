// The heart rate monitor's Bluetooth (ROADMAP Stage 5 item 37f-i): this app's Android code in
// `modules/heart-rate`. There is none on an iPhone yet (Stage 5 item 21), nor in the tests, which hand in
// their own (test/screens/setup.js); a phone without it is a phone with no monitor to connect.
import { requireOptionalNativeModule } from "expo";

export interface HeartNative {
  /** "on", "off" (Bluetooth switched off) or "none" (no Bluetooth Low Energy). */
  radio(): string;
  /** Whether Android's "Nearby devices" is allowed. */
  allowed(): boolean;
  /** Look for heart rate monitors for 30 s; each heard is sent as "found". False when it cannot. */
  scan(): boolean;
  stopScan(): void;
  /** Connect to this monitor by its Bluetooth address, and again whenever it comes back in reach. */
  watch(address: string): boolean;
  unwatch(): void;
  /** The readings since the last take (read through phoneHeartSamplesSchema). */
  take(): unknown;
  /** The monitor watched and whether it is connected (read through the code that asks). */
  status(): unknown;
  /** Android's own "Turn on Bluetooth?" box. */
  askRadio(): boolean;
  addListener(event: "found", listener: (found: unknown) => void): { remove: () => void };
}

export const heartNative: HeartNative | null = requireOptionalNativeModule<HeartNative>("HeartRate");
