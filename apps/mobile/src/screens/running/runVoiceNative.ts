// The phone's own voice for a run (ROADMAP Stage 5 item 37a-ii): this app's Android code in
// `modules/run-voice`. There is none on an iPhone yet (Stage 5 item 21), nor in the tests, which hand
// in their own (test/screens/setup.js); a phone without it is a phone that cannot speak.
import { requireOptionalNativeModule } from "expo";

/** Whether the phone can speak: "off" is no text-to-speech that starts, "noEnglish" one with no
 *  English voice. */
export type SpeakState = "ok" | "off" | "noEnglish";

/** What the Android code answers, read as one of the three; anything else is taken as able. */
export function speakState(answer: unknown): SpeakState {
  return answer === "off" || answer === "noEnglish" ? answer : "ok";
}

export interface RunVoiceNative {
  /** Say one line after any still being said; the music is lowered while it speaks. */
  say(text: string): Promise<void>;
  /** Stop at once and let the phone's voice go. */
  quiet(): Promise<void>;
  /** Whether this phone can speak English (read through speakState). */
  check(): Promise<unknown>;
}

export const runVoiceNative: RunVoiceNative | null = requireOptionalNativeModule<RunVoiceNative>("RunVoice");
