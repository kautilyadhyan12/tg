// @app/movement: the movement engine, made fresh (spec Part 2 §12), beside the old one in
// packages/engine, with which it shares no code. Pure TypeScript with no runtime
// dependencies (§1.3 I1), so the same code runs on the phone, in the tests and on the
// laptop. What it reads, one frame of every person the pose model found, is checked by
// `movementFrameSchema` in @app/shared before it gets here.
export type { Down, MovementFrame, SeenPerson, SeenPoint, WorldPoint } from "@app/shared";
export { BONES, LIMB_PAIRS, MAIN_JOINTS, PARENT, POINTS, POINT_NAMES, TRUNK, TRUNK_SIDES } from "./body/points.js";
export { bodySize } from "./body/size.js";
export {
  OnePerson,
  PERSON_LIMITS,
  bodyChange,
  fromPlace,
  lookAt,
  trunkMiddle,
  type BodyChange,
  type Look,
  type PersonFrame,
  type PersonLimits,
  type PersonStatus,
} from "./body/person.js";
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
export {
  MATCH_LIMITS,
  MovementMatcher,
  checkMovement,
  PROMISED_JUMP,
  FOOT_ROOM,
  FOOT_ENDS_AGREE,
  NEVER_JUMP,
  SLOWEST_RATE,
  hopTime,
  breakOf,
  readPosition,
  within,
  type MatchFrame,
  type MatchLimits,
  type MatchState,
  type RepResult,
  type Verdict,
} from "./movement/matcher.js";
export { FORM_SEEN, FORM_SEEN_FOR, OUT_OF_BOTTOM, SIDE_ON, checkExercise, checkedOf, formOf, mistakeReading, sideOn, turnOf, type FormCheck, type FormFrame, type FormStatus } from "./movement/form.js";
export { HOLD_LIMITS, HoldMatcher, checkHold, heldNow, heldOf, type HeldPicture, type HoldFrame, type HoldLimits, type HoldResult } from "./movement/hold.js";
export { parseExercise, parseHold, parseMovement, parseMovementFile } from "./movement/load.js";
export { CAMERA_SETTINGS, CameraSet, type CameraCounts, type CameraFrame, type CameraSettings } from "./movement/camera.js";
export { PHONE_LIMITS, PhoneMotion, type PhoneFrame, type PhoneLimits } from "./movement/phone.js";
export { HoldRecord, MOVEMENT_ENGINE_VERSION, SetRecord, WATCHED_GAP, repScore } from "./movement/summary.js";
export { COACH_LIMITS, Coach, coachWords, type CoachLimits, type CoachWords, type Say, type SayKind } from "./coach/coach.js";
