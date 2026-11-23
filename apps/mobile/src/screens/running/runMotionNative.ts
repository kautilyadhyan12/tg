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
}

export const runMotionNative: RunMotionNative | null = requireOptionalNativeModule<RunMotionNative>("RunMotion");
