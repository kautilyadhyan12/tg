// The phone's clip player (ROADMAP Stage 5 62b). A copy of the app built before expo-video has no player: it shows the
// exercise's picture and never fails. The screen tests hand in their own (test/screens/setup.js).
import { requireOptionalNativeModule } from "expo";
import { lazy, type ComponentType } from "react";
import type { StyleProp, ViewStyle } from "react-native";

export interface ClipProps {
  /** The clip's file on this phone. */
  uri: string;
  /** Plays while true, stopped on its frame while false. */
  playing: boolean;
  /** The clip's first frame is on the screen: until then the picture under it is what shows. */
  onFirstFrame: () => void;
}

/** The player, or null on a copy of the app without one. Loaded the first time a clip is shown. */
export const ClipNative: ComponentType<ClipProps & { style: StyleProp<ViewStyle> }> | null =
  requireOptionalNativeModule("ExpoVideo") === null ? null : lazy(() => import("./clipPlayer"));
