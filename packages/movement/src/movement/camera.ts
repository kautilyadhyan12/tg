// One set as the camera runs it (spec Part 2 §12.2): each frame of the pose model, every person it found, through the
// stages in order: one person locked on, is this body possible, steady points, the body's measures, then the movement's
// counting (reps, or a hold's clock). What the lock gives, and only that, reaches the stages after it; a new person it
// learns starts every one of them afresh; and once the set has counted (its first rep counted, or its first second
// held) the lock is told, so that from then on only a body at the person's place and size is counted.
import type { ExerciseCamera, HoldMovement, Movement, MovementFrame } from "@app/shared";
import { BodyMeasures, MEASURE_LIMITS, type MeasureLimits } from "../body/measures.js";
import { OnePerson, PERSON_LIMITS, type PersonFrame, type PersonLimits } from "../body/person.js";
import { LIMITS, PossibleBody, type Limits } from "../body/possible.js";
import { STEADY, SteadyPoints, type SteadySettings } from "../body/steady.js";
import { HOLD_LIMITS, HoldMatcher, type HoldFrame, type HoldLimits } from "./hold.js";
import { MATCH_LIMITS, MovementMatcher, type MatchFrame, type MatchLimits } from "./matcher.js";

export interface CameraSettings {
  readonly person: PersonLimits;
  readonly body: Limits;
  readonly steady: SteadySettings;
  readonly measures: MeasureLimits;
  readonly match: MatchLimits;
  readonly hold: HoldLimits;
}

export const CAMERA_SETTINGS: CameraSettings = {
  person: PERSON_LIMITS,
  body: LIMITS,
  steady: STEADY,
  measures: MEASURE_LIMITS,
  match: MATCH_LIMITS,
  hold: HOLD_LIMITS,
};

/** One frame of the set: who the camera followed, and the counting's frame (a rep's, or a hold's). */
export interface CameraFrame {
  readonly person: PersonFrame;
  readonly match: MatchFrame | null;
  readonly hold: HoldFrame | null;
}

/** What the set counts: a movement counted by reps, with its exercise's camera file (whose mistakes are judged in each
 *  counted rep) or none; or a hold. */
export type CameraCounts = { readonly movement: Movement; readonly exercise: ExerciseCamera | null } | { readonly hold: HoldMovement };

export class CameraSet {
  private readonly lock: OnePerson;
  private readonly body: PossibleBody;
  private readonly steady: SteadyPoints;
  private readonly measures: BodyMeasures;
  private readonly matcher: MovementMatcher | null;
  private readonly holder: HoldMatcher | null;

  constructor(counts: CameraCounts, settings: CameraSettings = CAMERA_SETTINGS) {
    this.lock = new OnePerson(settings.person);
    this.body = new PossibleBody(settings.body);
    this.steady = new SteadyPoints(settings.steady);
    this.measures = new BodyMeasures(settings.measures);
    this.matcher = "movement" in counts ? new MovementMatcher(counts.movement, settings.match, counts.exercise) : null;
    this.holder = "hold" in counts ? new HoldMatcher(counts.hold, settings.hold) : null;
  }

  /** Whether the set has counted, so that only the person's place and size are followed. */
  get confirmed(): boolean {
    return this.lock.confirmed;
  }

  /** Where the person exercises and their size there (picture heights), once the set has counted; null before. */
  get place(): OnePerson["place"] {
    return this.lock.place;
  }

  /** Where the person has been over their last second followed (picture heights), once the set has counted; null before. */
  get where(): OnePerson["where"] {
    return this.lock.where;
  }

  next(frame: MovementFrame): CameraFrame {
    const person = this.lock.next(frame);
    const checked = this.body.check(frame.t, frame.aspect, frame.down, person.person, person.fresh);
    const steady = this.steady.next(checked);
    const measured = this.measures.next(steady);
    const match = this.matcher?.next(steady, measured) ?? null;
    const hold = this.holder?.next(measured) ?? null;
    if (match?.rep?.verdict === "counted" || hold?.holding === true) this.lock.confirm();
    return { person, match, hold };
  }

  /** The set has ended: a rep held at its far end, or a hold going on, is judged at the last frame. */
  finish(): { readonly match: MatchFrame | null; readonly hold: HoldFrame | null } {
    return { match: this.matcher?.finish() ?? null, hold: this.holder?.finish() ?? null };
  }
}
