// The camera screen's camera (ROADMAP Stage 5 53a): this app's Android code in `modules/pose-camera`. There is none on an
// iPhone yet (Stage 5 item 21), nor on a copy of the app built before it, nor in the tests, which hand in their own
// (test/screens/setup.js): with none, the camera screen is never offered and a set is counted by hand.
import { requireNativeView, requireOptionalNativeModule } from "expo";
import type { ComponentType } from "react";
import type { NativeSyntheticEvent, StyleProp, ViewStyle } from "react-native";
import type { PoseEvent } from "./poseFrame";

export interface PoseCameraProps {
  /** The camera and the model run while true. */
  active: boolean;
  /** Each answer of the model (read through `frameOf`). */
  onPose: (e: NativeSyntheticEvent<PoseEvent>) => void;
  /** The camera or the model stopped: "camera" or "model". */
  onProblem: (e: NativeSyntheticEvent<{ reason: string }>) => void;
  style?: StyleProp<ViewStyle>;
}

/** The camera's view, or null on a phone without it. */
export const PoseCameraView: ComponentType<PoseCameraProps> | null =
  requireOptionalNativeModule("PoseCamera") === null ? null : requireNativeView<PoseCameraProps>("PoseCamera");
