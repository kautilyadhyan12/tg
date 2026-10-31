// A pose model gives x as a share of the picture's width and y as a share of its
// height, so on any picture that is not square the two are different units. Every
// angle and width ratio in the pipeline needs one unit: x is rescaled here, once,
// and everything after this works in picture heights.
//
// Measured with the engine's formula: a true knee angle of 115° reads 139° on a
// 16:9 picture and 86° on a 9:16 one if this step is skipped.
import type { CameraFrame, PoseFrame } from "@app/shared";
import { validKeypoints } from "./ingest.js";

// Same bounds as cameraFrameSchema in @app/shared (the engine has no runtime
// dependencies, I1); test/pipeline/trueProportions.test.ts holds them equal.
export const MIN_ASPECT = 0.2;
export const MAX_ASPECT = 5;

export function isUsableAspect(aspect: unknown): aspect is number {
  return (
    typeof aspect === "number" &&
    Number.isFinite(aspect) &&
    aspect >= MIN_ASPECT &&
    aspect <= MAX_ASPECT
  );
}

/** A frame whose picture shape or points are unusable comes back with no points:
 *  ingest drops it as invalid, so it decides nothing. The points are checked here
 *  because multiplying first would turn a null x into a false 0. */
export function toTrueProportions(frame: CameraFrame): PoseFrame {
  if (!isUsableAspect(frame.aspect) || !validKeypoints(frame.kp)) {
    return { t: frame.t, kp: [] };
  }
  return {
    t: frame.t,
    kp: frame.kp.map(([x, y, z, vis]) => [x * frame.aspect, y, z, vis]),
  };
}
