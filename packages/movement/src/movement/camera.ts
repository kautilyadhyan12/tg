// One set as the camera runs it (spec Part 2 §12.2): each frame of the pose model, every person it found, through the
// stages in order: one person locked on, is this body possible, steady points, the body's measures, then the movement's
// counting (reps, or a hold's clock). What the lock gives, and only that, reaches the stages after it; a new person it
// learns starts every one of them afresh; and once the set has counted (its first rep counted, or its first second
// held) the lock is told, so that from then on only a body at the person's place and size is counted.
//
// Before all of them, the phone itself (53c, `PhoneMotion`): while it is moving (knocked, picked up, held by hand) no
// picture reaches the stages, so nothing it sees counts; once it stands again, or after the camera gave no picture long
// enough that it may have been moved, every stage starts afresh as at the start of a set, the lock included (the person is
// somewhere else on a moved phone's picture), and the count and the time held go on from where they were.
import type { ExerciseCamera, HoldMovement, Movement, MovementFrame } from "@app/shared";
import { BodyMeasures, MEASURE_LIMITS, type MeasureLimits } from "../body/measures.js";
import { OnePerson, PERSON_LIMITS, type PersonFrame, type PersonLimits } from "../body/person.js";
import { LIMITS, PossibleBody, type Limits } from "../body/possible.js";
import { STEADY, SteadyPoints, type SteadySettings } from "../body/steady.js";
import { HOLD_LIMITS, HoldMatcher, type HoldFrame, type HoldLimits } from "./hold.js";
import { MATCH_LIMITS, MovementMatcher, type MatchFrame, type MatchLimits } from "./matcher.js";
import { PHONE_LIMITS, PhoneMotion, type PhoneFrame, type PhoneLimits } from "./phone.js";

export interface CameraSettings {
  readonly person: PersonLimits;
  readonly body: Limits;
  readonly steady: SteadySettings;
  readonly measures: MeasureLimits;
  readonly match: MatchLimits;
  readonly hold: HoldLimits;
  readonly phone: PhoneLimits;
}

export const CAMERA_SETTINGS: CameraSettings = {
  person: PERSON_LIMITS,
  body: LIMITS,
  steady: STEADY,
  measures: MEASURE_LIMITS,
  match: MATCH_LIMITS,
  hold: HOLD_LIMITS,
  phone: PHONE_LIMITS,
};

/** One frame of the set: who the camera followed, the counting's frame (a rep's, or a hold's), and the phone's own
 *  (moving: nothing read; again: every stage started afresh at this picture). */
export interface CameraFrame {
  readonly person: PersonFrame;
  readonly match: MatchFrame | null;
  readonly hold: HoldFrame | null;
  readonly phone: PhoneFrame;
}

/** What the set counts: a movement counted by reps, with its exercise's camera file (whose mistakes are judged in each
 *  counted rep) or none; or a hold. */
export type CameraCounts = { readonly movement: Movement; readonly exercise: ExerciseCamera | null } | { readonly hold: HoldMovement };

/** The stages after the phone, made afresh at the set's start and each time the phone stands again. */
class Stages {
  readonly lock: OnePerson;
  readonly body: PossibleBody;
  readonly steady: SteadyPoints;
  readonly measures: BodyMeasures;
  readonly matcher: MovementMatcher | null;
  readonly holder: HoldMatcher | null;

  constructor(counts: CameraCounts, settings: CameraSettings) {
    this.lock = new OnePerson(settings.person);
    this.body = new PossibleBody(settings.body);
    this.steady = new SteadyPoints(settings.steady);
    this.measures = new BodyMeasures(settings.measures);
    this.matcher = "movement" in counts ? new MovementMatcher(counts.movement, settings.match, counts.exercise) : null;
    this.holder = "hold" in counts ? new HoldMatcher(counts.hold, settings.hold) : null;
  }
}

export class CameraSet {
  private readonly counts: CameraCounts;
  private readonly settings: CameraSettings;
  private readonly phone: PhoneMotion;
  private stages: Stages;
  /** What the stages before the newest started afresh had counted and held: carried into everything given out. */
  private carried = { reps: 0, heldMs: 0 };
  /** The count and the time held as last given out. */
  private given = { reps: 0, heldMs: 0 };

  constructor(counts: CameraCounts, settings: CameraSettings = CAMERA_SETTINGS) {
    this.counts = counts;
    this.settings = settings;
    this.phone = new PhoneMotion(settings.phone);
    this.stages = new Stages(counts, settings);
  }

  /** Whether the set has counted, so that only the person's place and size are followed (since the stages last started
   *  afresh). */
  get confirmed(): boolean {
    return this.stages.lock.confirmed;
  }

  /** Where the person exercises and their size there (picture heights), once the set has counted; null before. */
  get place(): OnePerson["place"] {
    return this.stages.lock.place;
  }

  /** Where the person has been over their last second followed (picture heights), once the set has counted; null before. */
  get where(): OnePerson["where"] {
    return this.stages.lock.where;
  }

  next(frame: MovementFrame): CameraFrame {
    const phone = this.phone.next(frame.t, frame.spin);
    if (phone.moving) return { person: { t: frame.t, person: null, status: "moving", fresh: false }, match: null, hold: null, phone };
    if (phone.again) {
      this.carried = { ...this.given };
      this.stages = new Stages(this.counts, this.settings);
    }
    const s = this.stages;
    const person = s.lock.next(frame);
    const checked = s.body.check(frame.t, frame.aspect, frame.down, person.person, person.fresh);
    const steady = s.steady.next(checked);
    const measured = s.measures.next(steady);
    const match = this.carry(s.matcher?.next(steady, measured) ?? null);
    const hold = this.carryHold(s.holder?.next(measured) ?? null);
    if (match?.rep?.verdict === "counted" || hold?.holding === true) s.lock.confirm();
    return { person, match, hold, phone };
  }

  /** The set has ended: a rep held at its far end, or a hold going on, is judged at the last frame. */
  finish(): { readonly match: MatchFrame | null; readonly hold: HoldFrame | null } {
    return { match: this.carry(this.stages.matcher?.finish() ?? null), hold: this.carryHold(this.stages.holder?.finish() ?? null) };
  }

  private carry(match: MatchFrame | null): MatchFrame | null {
    if (match === null) return null;
    const out = this.carried.reps === 0 ? match : { ...match, count: match.count + this.carried.reps };
    this.given = { ...this.given, reps: out.count };
    return out;
  }

  private carryHold(hold: HoldFrame | null): HoldFrame | null {
    if (hold === null) return null;
    const out = this.carried.heldMs === 0 ? hold : { ...hold, heldMs: hold.heldMs + this.carried.heldMs };
    this.given = { ...this.given, heldMs: out.heldMs };
    return out;
  }
}
