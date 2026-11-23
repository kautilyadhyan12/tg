// The app's one sound player (ROADMAP Stage 5 64a-vi; spec Part 2 §13.6: "Sound in a workout uses one player, shared
// with job 53"): expo-audio playing short files kept in the app. It mixes with the person's own music, never pausing
// it: in "mixWithOthers" expo-audio asks Android for no audio focus (its AudioModule.requestAudioFocus, read
// 2026-11-23), where its default would pause the music for every beep. A copy of the app built before expo-audio has
// no player, so it plays nothing and never fails; nor do the tests, which hand in their own (test/screens/setup.js).
import { requireOptionalNativeModule } from "expo";
import count from "../../assets/sounds/count.wav";
import go from "../../assets/sounds/go.wav";
import rep from "../../assets/sounds/rep.wav";
import setEnd from "../../assets/sounds/set-end.wav";

export type SoundName = "rep" | "setEnd" | "count" | "go";

export interface SoundNative {
  play(name: SoundName): void;
}

const FILES: Record<SoundName, number> = { rep, setEnd, count, go };

interface Played {
  seekTo(seconds: number): Promise<void>;
  play(): void;
}

function phonePlayer(): SoundNative | null {
  if (requireOptionalNativeModule("ExpoAudio") === null) return null;
  // Loaded only where the phone has it, and set to mix before anything plays.
  const ready = import("expo-audio").then(async (audio) => {
    await audio.setAudioModeAsync({ interruptionMode: "mixWithOthers", playsInSilentMode: true, shouldPlayInBackground: false, allowsRecording: false });
    return audio;
  });
  const players = new Map<SoundName, Played>();
  return {
    // Each play on its own, never behind the one before: a seek that never settled would otherwise silence every sound
    // after it (round one, L2).
    play: (name) => {
      void ready
        .then(async (audio) => {
          const made = players.get(name);
          // A new player is at its start already; one played before goes back to it.
          if (made !== undefined) await made.seekTo(0);
          const player = made ?? audio.createAudioPlayer(FILES[name]);
          players.set(name, player);
          player.play();
        })
        .catch(() => undefined);
    },
  };
}

export const soundNative: SoundNative | null = phonePlayer();
