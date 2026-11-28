// The phone's motion during a run (ROADMAP Stage 5 item 37i): this app's Android code in `modules/run-motion`.
// There is none on an iPhone yet (Stage 5 item 21), nor in the tests, which hand in their own
// (test/screens/setup.js); a phone without it records a run exactly as before, with no motion.
import { requireOptionalNativeModule } from "expo";

export interface RunMotionNative {
  /** Start reading the accelerometer, 25 times a second: false on a phone with none. Twice is one listener. */
  start(): boolean;
  /** Stop reading it, and forget what was not taken. */
  stop(): void;
  /** The seconds finished since the last take (read through phoneMotionSchema). */
  take(): unknown;
  /** The compass for the map's beam (37p): false on a phone with none. A copy built before 37p has none of these. */
  compassStart?(): boolean;
  compassStop?(): void;
  /** Where the person is, for the gap between magnetic and true north there. */
  compassPlace?(lat: number, lng: number): void;
  /** "heading": each reading while the compass reads (read through phoneCompassSchema, worked out in compassHeading.ts). */
  addListener?(event: "heading", listener: (said: unknown) => void): { remove: () => void };
}

export const runMotionNative: RunMotionNative | null = requireOptionalNativeModule<RunMotionNative>("RunMotion");
