// An exercise's clip playing (ROADMAP Stage 5 62b), expo-video's. Loaded only through `clipNative.ts`, so a copy of the
// app built before expo-video never loads it. One player for one clip: the screen gives each clip a player of its own
// (keyed by its file), so a new exercise never shows the last one's frames.
import { useEffect } from "react";
import { AppState, type StyleProp, type ViewStyle } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import type { ClipProps } from "./clipNative";

export default function ClipPlayer({ uri, playing, onFirstFrame, style }: ClipProps & { style: StyleProp<ViewStyle> }) {
  const player = useVideoPlayer({ uri }, (p) => {
    p.loop = true;
    // The clip has no sound; muted and mixing, the player never asks Android for the sound, so the person's own music
    // plays on (expo-video's AudioFocusManager asks only for a player not muted, read 2026-11-25).
    p.muted = true;
    p.audioMixingMode = "mixWithOthers";
    // An exercise's page stays open while the person reads: the screen goes dark by its own setting. The workout keeps
    // it awake by itself (expo-keep-awake).
    p.keepScreenOnWhilePlaying = false;
    p.staysActiveInBackground = false;
    p.showNowPlayingNotification = false;
  });
  useEffect(() => {
    if (playing) player.play();
    else player.pause();
    if (!playing) return undefined;
    // Away and back: the player stops when the app is left, and starts again here.
    const heard = AppState.addEventListener("change", (now) => {
      if (now === "active") player.play();
    });
    return () => {
      heard.remove();
    };
  }, [player, playing]);
  return (
    <VideoView
      player={player}
      style={style}
      contentFit="contain"
      nativeControls={false}
      allowsPictureInPicture={false}
      // Drawn as part of the page, so it scrolls and fades with it (Android's default surface is drawn apart).
      surfaceType="textureView"
      onFirstFrameRender={onFirstFrame}
      accessible={false}
    />
  );
}
