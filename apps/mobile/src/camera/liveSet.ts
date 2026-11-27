import { CameraSet, Coach, HoldRecord, SetRecord, type CameraCounts, type Say } from "@app/movement";
import type { EngineSetSummary, ExerciseCamera, SeenPerson } from "@app/shared";
import { frameOf, type PoseEvent } from "./poseFrame";
import { COACH_WORDS } from "./voice";

// The camera screen (ROADMAP Stage 5 53a, 53b-i; spec Part 2 §12.1, §12.6; Kd's drawing of 2026-11-26): what the screen
// shows and the coach says of one set, from each answer of the phone's pose model. The movement engine decides every count
// and every reason (`CameraSet`), and its coach what is said (`Coach`); this only says how long the screen keeps each, in
// the set's own time. Pure: the same answers in give the same screen out.
//
// The screen is read from 2 to 3 metres away, so it says one thing at a time: the count, a green flash and a short sound
// for each counted rep, and at most one line at its foot, only while there is something to say: why a rep did not count
// in its movement's own words ("Go lower to count."), what the camera cannot see ("Keep your whole body in view."), that it
// has lost the person, or the coach's correction or praise as it says it. Every other movement gets no count and no word
// (§12.1).

/** How long a counted rep's number stays green. */
export const FLASH_MS = 600;
/** How long a line stays at the foot, unless a counted rep comes first. */
export const LINE_MS = 4_000;
/** The person unseen this long, once the set has seen them, and the screen says so (§11.8 step 4). */
export const LOST_MS = 2_000;
export const LOST_WORDS = COACH_WORDS.lost;

/** What the line at the foot is about: a rep that fell short or was refused (amber), what the camera could not see, or
 *  the person lost (red), or the coach's correction or praise (the page's own dark). */
export type LineTone = "short" | "unseen" | "coach";

export interface LiveLine {
  readonly words: string;
  readonly tone: LineTone;
}

export interface LiveView {
  /** "setUp" until the camera first reads the person ready (standing tall before a rep; in a hold, its position read). */
  readonly stage: "setUp" | "counting";
  /** Reps the camera counted. */
  readonly reps: number;
  /** A hold's time held, ms. */
  readonly heldMs: number;
  /** A counted rep's green, this answer. */
  readonly flash: boolean;
  readonly line: LiveLine | null;
  /** What the coach says at this answer; null for silence. */
  readonly say: Say | null;
  /** The person the camera follows in this answer, to draw; null when it follows nobody. */
  readonly body: SeenPerson | null;
  /** The picture's width / height. */
  readonly aspect: number;
}

/** The set as the screen shows it, apart from the camera: the person's own changes to the count, and its target (reps,
 *  or a hold's seconds; null with none). */
export interface SetNow {
  readonly byHand: number;
  readonly target: number | null;
}

const NO_SET: SetNow = { byHand: 0, target: null };

export const NO_VIEW: LiveView = { stage: "setUp", reps: 0, heldMs: 0, flash: false, line: null, say: null, body: null, aspect: 3 / 4 };

/** The coach's lines the foot shows as they are said: what to change, and that it is better. The count is the digits'. */
const SHOWN: ReadonlySet<Say["kind"]> = new Set(["correction", "better", "counts now"]);

export class LiveSet {
  private readonly camera: CameraSet;
  private readonly coach: Coach;
  private readonly record: SetRecord | HoldRecord | null;
  private firstAt: number | null = null;
  private lastT = -1;
  private seenAt: number | null = null;
  private flashUntil = -1;
  private lineUntil = -1;
  private view: LiveView = NO_VIEW;
  private ended: { readonly reps: number; readonly summary: EngineSetSummary | null; readonly say: Say | null } | null = null;

  /** `exercise`: the exercise's camera file, when it has one, which its summary and its corrections need; `set`: the set's
   *  number, from 1. */
  constructor(counts: CameraCounts, exercise: ExerciseCamera | null, set: number) {
    this.camera = new CameraSet(counts);
    this.coach = new Coach(exercise, COACH_WORDS);
    this.record = exercise === null ? null : "hold" in counts ? new HoldRecord(exercise, counts.hold, set) : new SetRecord(exercise, counts.movement, set);
  }

  /** The screen after one answer. An answer that is broken, or whose clock went back, changes nothing and says nothing. */
  next(e: PoseEvent, now: SetNow = NO_SET): LiveView {
    // After the end nothing more is said: pictures the phone had already sent still arrive (round one, H1).
    if (this.ended !== null) return { ...this.view, say: null };
    if (this.firstAt === null) this.firstAt = e.t;
    const t = e.t - this.firstAt;
    if (t < this.lastT) return { ...this.view, say: null };
    const frame = frameOf(e, t);
    if (frame === null) return { ...this.view, say: null };
    this.lastT = t;
    const seen = this.camera.next(frame);
    const body = seen.person.person;
    if (body !== null) this.seenAt = t;
    let { stage, reps, heldMs } = this.view;
    let line = this.view.line;
    let say: Say | null = null;
    if (line !== null && line.words !== LOST_WORDS && t >= this.lineUntil) line = null;
    const match = seen.match;
    if (match !== null) {
      if (this.record instanceof SetRecord) this.record.add(match);
      if (match.state !== "waiting") stage = "counting";
      reps = match.count;
      const rep = match.rep;
      if (rep !== null) say = this.coach.rep(rep, match.count + now.byHand, now.target);
      if (rep?.verdict === "counted") {
        this.flashUntil = t + FLASH_MS;
        line = null;
      } else if (rep !== null && rep.reason !== null) {
        line = { words: rep.reason, tone: rep.verdict === "unseen" ? "unseen" : "short" };
        this.lineUntil = t + LINE_MS;
      }
      if (say !== null && SHOWN.has(say.kind)) {
        line = { words: say.words, tone: "coach" };
        this.lineUntil = t + LINE_MS;
      }
    }
    const hold = seen.hold;
    if (hold !== null) {
      if (this.record instanceof HoldRecord) this.record.add(hold);
      if (body !== null && !hold.unseen) stage = "counting";
      heldMs = hold.heldMs;
      if (hold.unseen && hold.reason !== null && stage === "counting") {
        line = { words: hold.reason, tone: "unseen" };
        this.lineUntil = t + LINE_MS;
      }
      if (stage === "counting") say = this.coach.hold(hold, now.target) ?? say;
    }
    // The person lost, once the set has seen them: said until they are back.
    const lost = stage === "counting" && this.seenAt !== null && t - this.seenAt >= LOST_MS;
    if (lost) line = { words: LOST_WORDS, tone: "unseen" };
    else if (line?.words === LOST_WORDS) line = null;
    say = this.coach.seen(t, lost) ?? say;
    this.view = { stage, reps, heldMs, flash: t < this.flashUntil, line, say, body, aspect: frame.aspect };
    return this.view;
  }

  /** The set has ended: a rep held at its far end, or a hold going on, is judged at the last answer, once. The reps the
   *  camera counted in all, the set's summary (§2.4) where the exercise has a camera file (null otherwise), and the
   *  coach's "Set complete.". */
  end(): { readonly reps: number; readonly summary: EngineSetSummary | null; readonly say: Say | null } {
    if (this.ended === null) {
      const last = this.camera.finish();
      if (this.record instanceof SetRecord && last.match !== null) this.record.add(last.match);
      if (this.record instanceof HoldRecord && last.hold !== null) this.record.add(last.hold);
      this.ended = { reps: last.match?.count ?? this.view.reps, summary: this.record?.summary() ?? null, say: this.coach.end(Math.max(0, this.lastT)) };
    }
    return this.ended;
  }
}
