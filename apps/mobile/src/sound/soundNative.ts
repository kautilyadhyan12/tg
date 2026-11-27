// The app's one sound player (ROADMAP Stage 5 64a-vi, 53b-i; spec Part 2 §13.6: "Sound in a workout uses one player,
// shared with job 53"): expo-audio playing short files kept in the app. A beep mixes with the person's own music, never
// pausing it: in "mixWithOthers" expo-audio asks Android for no audio focus (its AudioModule.requestAudioFocus, read
// 2026-11-23), where its default would pause the music for every beep. The coach's voice (53b-i) lowers the music while
// it speaks and lets it back up after (spec §11.8): for each clip the player asks for "duckOthers", in which expo-audio
// asks Android for focus that lets other sound go quieter (AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK) and gives it back once
// nothing plays (read 2026-11-27), and goes back to mixing when the clip ends. A copy of the app built before expo-audio
// has no player, so it plays nothing and never fails; nor do the tests, which hand in their own (test/screens/setup.js).
import { requireOptionalNativeModule } from "expo";
import { AppState } from "react-native";
import type * as ExpoAudio from "expo-audio";
import type { AudioMode, AudioPlayer } from "expo-audio";
import count from "../../assets/sounds/count.wav";
import go from "../../assets/sounds/go.wav";
import rep from "../../assets/sounds/rep.wav";
import setEnd from "../../assets/sounds/set-end.wav";
import type { Clip } from "../camera/voice";
import { VOICE_CLIPS } from "../camera/voiceClips";
import { VoiceQueue } from "./voiceQueue";

export type SoundName = "rep" | "setEnd" | "count" | "go";

export interface SoundNative {
  play(name: SoundName): void;
  /** One of the coach's clips: the music lowered while it speaks. A clip asked for while another speaks waits for it to
   *  end, and a newer one takes the waiting one's place, so lines never talk over each other or pile up. */
  speak(clip: Clip): void;
  /** The coach falls silent: what waits is dropped and what speaks is stopped (Sound off, Pause, the count by hand, the
   *  screen closed). */
  hush(): void;
}

const FILES: Record<SoundName, number> = { rep, setEnd, count, go };

const MIX: Partial<AudioMode> = { interruptionMode: "mixWithOthers", playsInSilentMode: true, shouldPlayInBackground: false, allowsRecording: false };
const DUCK: Partial<AudioMode> = { ...MIX, interruptionMode: "duckOthers" };

type Audio = typeof ExpoAudio;

function phonePlayer(): SoundNative | null {
  if (requireOptionalNativeModule("ExpoAudio") === null) return null;
  // Loaded only where the phone has it, and set to mix before anything plays.
  const ready = import("expo-audio").then(async (audio) => {
    await audio.setAudioModeAsync(MIX);
    return audio;
  });
  const players = new Map<SoundName, AudioPlayer>();
  const voices = new Map<number, AudioPlayer>();
  let audio: Audio | null = null;
  let speaking: AudioPlayer | null = null;
  // One clip at a time (voiceQueue.ts); the clip's own end, or its time running out, lets the next one speak.
  const queue: VoiceQueue = new VoiceQueue(
    {
      play: async (file, current) => {
        if (audio === null) return;
        await audio.setAudioModeAsync(DUCK);
        const made = voices.get(file);
        if (made !== undefined) await made.seekTo(0);
        // Hushed or replaced while it was starting up: it never plays (the re-check's A).
        if (!current()) return;
        const player = made ?? audio.createAudioPlayer(file);
        if (made === undefined) {
          player.addListener("playbackStatusUpdate", (status) => {
            if (status.didJustFinish && speaking === player) queue.ended();
          });
          voices.set(file, player);
        }
        speaking = player;
        player.play();
      },
      stop: () => {
        speaking?.pause();
        speaking = null;
      },
      rest: () => {
        speaking = null;
        void audio?.setAudioModeAsync(MIX).catch(() => undefined);
      },
    },
    (then, ms) => setTimeout(then, ms),
    (timer) => {
      clearTimeout(timer);
    },
  );
  queue.hushWhenAway((listener) => AppState.addEventListener("change", listener));

  return {
    // Each play on its own, never behind the one before: a seek that never settled would otherwise silence every sound
    // after it (round one, L2).
    play: (name) => {
      void ready
        .then(async (loaded) => {
          const made = players.get(name);
          // A new player is at its start already; one played before goes back to it.
          if (made !== undefined) await made.seekTo(0);
          const player = made ?? loaded.createAudioPlayer(FILES[name]);
          players.set(name, player);
          player.play();
        })
        .catch(() => undefined);
    },
    speak: (clip) => {
      const file = VOICE_CLIPS[clip.id]?.[clip.index];
      if (file === undefined) return;
      void ready
        .then((loaded) => {
          audio = loaded;
          queue.speak(file);
        })
        .catch(() => undefined);
    },
    hush: () => {
      queue.hush();
    },
  };
}

export const soundNative: SoundNative | null = phonePlayer();
