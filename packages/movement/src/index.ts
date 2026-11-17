// @app/movement: the movement engine, made fresh (spec Part 2 §12), beside the old one in
// packages/engine, with which it shares no code. Pure TypeScript with no runtime
// dependencies (§1.3 I1), so the same code runs on the phone, in the tests and on the
// laptop. What it reads, one frame of every person the pose model found, is checked by
// `movementFrameSchema` in @app/shared before it gets here.
export type { Down, MovementFrame, SeenPerson, SeenPoint, WorldPoint } from "@app/shared";
export { BONES, LIMB_PAIRS, MAIN_JOINTS, PARENT, POINTS, POINT_NAMES, TRUNK, TRUNK_SIDES } from "./body/points.js";
export { bodySize } from "./body/size.js";
export { LIMITS, PossibleBody, type CheckedBody, type Limits, type Refusal } from "./body/possible.js";
export { STEADY, SteadyPoints, type SteadyBody, type SteadyPoint, type SteadySettings, type Smoothing } from "./body/steady.js";
export {
  BodyMeasures,
  MEASURE_LIMITS,
  MEASURE_LIST,
  type MeasureLimits,
  type MeasureName,
  type MeasuredBody,
  type Reading,
  type Unit,
} from "./body/measures.js";
