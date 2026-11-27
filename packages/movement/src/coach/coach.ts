// The coach (spec Part 2 §12.2 stage 7, §12.6; ROADMAP 53b-i): at most one line for what the camera has just seen, and
// silence otherwise. Pure: it reads what the engine decided (each rep judged, a hold's clock, the person lost or found)
// in the set's own time, and says what to say; the app plays it. Nothing here names an exercise: the words are the
// movement's and the exercise's own (a rep's reason, a mistake's correction) or the set's (the voice file's).
//
// What it says, and when (§12.6: "only what is happening in front of the camera"; never wrong out loud):
//   - a rep not counted: its reason, the screen's own words ("Go lower to count."), on the first such rep and every
//     other one after while the same reason comes back (never the same line rep after rep); what the camera could not
//     see ("Keep your whole body in view.") only from the second rep running, since one hidden rep (a passer-by) is
//     nobody's fault;
//   - a mistake made: its correction, once the camera saw it made in two counted reps running (a rep where it could
//     not see it neither breaks nor adds to the run), the most important first (the camera file's order), one at a
//     time; then that run starts again, so the same correction never follows itself, and it comes back in another
//     wording;
//   - fixed: "Better." on the first counted rep where a corrected mistake is seen fine; "That one counts." on the first
//     counted rep after a reason was said;
//   - the count: "Halfway.", "Two more.", "Last one." against the set's target; "Set complete." when it ends;
//   - the person lost: once, until they are back, and not again within 10 s.
// A correction outranks praise, praise the count. A line that only encourages (praise, the count) is left out when it
// would come within 0.8 s of the line before, about the length of the short count lines; the app's player makes any other line wait for
// the one speaking, so lines never talk over each other.
import type { ExerciseCamera, Voice, VoiceWhen } from "@app/shared";
import { checkedOf } from "../movement/form.js";
import type { HoldFrame } from "../movement/hold.js";
import type { RepResult } from "../movement/matcher.js";

export type SayKind = "reason" | "correction" | "better" | "counts now" | "count" | "lost" | "set complete";

export interface Say {
  /** The line, by its first wording: the screen's own words where the screen says it. */
  readonly words: string;
  readonly kind: SayKind;
  /** How many times this set has said the line before: the app says its wordings in turn. */
  readonly times: number;
  /** When, in the set's own time, ms. */
  readonly t: number;
}

/** The set's own lines, each by its first wording, from the voice file. */
export interface CoachWords {
  readonly halfway: string;
  readonly twoMore: string;
  readonly lastOne: string;
  readonly setComplete: string;
  readonly lost: string;
  readonly countsNow: string;
  readonly better: string;
}

export interface CoachLimits {
  /** A correction is said once the mistake was made in this many counted reps running. */
  readonly repsMade: number;
  /** A line that only encourages is left out within this long of the line before, ms. */
  readonly quiet: number;
  /** The person lost is said again only this long after it was last said, ms. */
  readonly lostAgain: number;
  /** A hold's reason is said once the camera has not read the position this long, ms. */
  readonly holdUnseen: number;
  /** "Halfway." for a target of at least this many reps. */
  readonly halfwayFrom: number;
  /** "Halfway." for a hold of at least this many seconds. */
  readonly holdHalfwayFrom: number;
  /** "Two more." for a target of at least this many reps. */
  readonly twoMoreFrom: number;
}

/** The numbers are a coach's sense of when to speak, not measured thresholds: two reps running is the least "more than
 *  one rep" of §12.6; 0.8 s is about the length of the short count lines ("Two more.", 0.81 s; "Better." is 0.59; Kd's squat jumps come about a second apart, and a
 *  quiet of 2 s lost every "Last one." of theirs); 10 s lets a person back in view settle before being told again. "Halfway." from 8 reps or 20 s held, "Two more." from 4, so that a short set is not talked through. */
export const COACH_LIMITS: CoachLimits = { repsMade: 2, quiet: 800, lostAgain: 10_000, holdUnseen: 2000, halfwayFrom: 8, holdHalfwayFrom: 20, twoMoreFrom: 4 };

/** The set's own lines from the voice file, each by its first wording; refused when the file lacks one. */
export function coachWords(voice: Voice): CoachWords {
  const first = (when: VoiceWhen): string => {
    const words = voice.lines.find((l) => l.when === when)?.wordings[0];
    if (words === undefined) throw new Error(`The voice file has no "${when}" line.`);
    return words;
  };
  return {
    halfway: first("halfway"),
    twoMore: first("two more"),
    lastOne: first("last one"),
    setComplete: first("set complete"),
    lost: first("lost"),
    countsNow: first("counts now"),
    better: first("better"),
  };
}

export class Coach {
  private readonly corrections: ReadonlyMap<string, string>;
  private readonly said = new Map<string, number>();
  private lastAt = Number.NEGATIVE_INFINITY;
  /** Each checked mistake's run of counted reps it was made in. */
  private readonly runs = new Map<string, number>();
  /** Mistakes corrected and not yet seen fine. */
  private readonly told = new Set<string>();
  /** A reason was said, and no rep has counted since. */
  private reasonTold = false;
  /** The reason of the last reps not counted that gave one, and how many ran. */
  private reason: { words: string; run: number } | null = null;
  private lost = false;
  private lostAt = Number.NEGATIVE_INFINITY;
  private halfwayHeld = false;
  private unreadSince: number | null = null;
  private holdTold = false;
  private ended = false;

  constructor(
    exercise: ExerciseCamera | null,
    private readonly words: CoachWords,
    private readonly limits: CoachLimits = COACH_LIMITS,
  ) {
    const out = new Map<string, string>();
    if (exercise !== null) for (const m of checkedOf(exercise)) if ("words" in m.coach) out.set(m.id, m.coach.words);
    this.corrections = out;
  }

  /** A rep judged: `count`, the set's count as the screen shows it (the person's own changes with it); `target`, its reps
   *  (null with none). */
  rep(rep: RepResult, count: number, target: number | null): Say | null {
    const t = rep.end;
    if (rep.verdict === "counted") return this.counted(rep, count, target, t);
    if (rep.reason === null) return null;
    const run = this.reason?.words === rep.reason ? this.reason.run + 1 : 1;
    this.reason = { words: rep.reason, run };
    // What the camera could not see is said from the second rep running, every other rep; a rep that fell short or was
    // refused, from the first.
    const due = rep.verdict === "unseen" ? run % 2 === 0 : run % 2 === 1;
    if (!due) return null;
    if (rep.verdict !== "unseen") this.reasonTold = true;
    return this.say(rep.reason, "reason", t);
  }

  private counted(rep: RepResult, count: number, target: number | null, t: number): Say | null {
    this.reason = null;
    let correction: string | null = null;
    let better = false;
    for (const f of rep.form) {
      if (f.status === "unseen") continue;
      if (f.status === "fine") {
        this.runs.set(f.mistake, 0);
        if (this.told.delete(f.mistake)) better = true;
        continue;
      }
      const run = (this.runs.get(f.mistake) ?? 0) + 1;
      this.runs.set(f.mistake, run);
      const words = this.corrections.get(f.mistake);
      if (correction === null && words !== undefined && run >= this.limits.repsMade) {
        correction = f.mistake;
        this.runs.set(f.mistake, 0);
        this.told.add(f.mistake);
      }
    }
    const countsNow = this.reasonTold;
    this.reasonTold = false;
    if (correction !== null) return this.say(this.corrections.get(correction) ?? "", "correction", t);
    if (better) return this.encourage(this.words.better, "better", t);
    if (countsNow) return this.encourage(this.words.countsNow, "counts now", t);
    const line = target === null ? null : this.countLine(count, target);
    return line === null ? null : this.encourage(line, "count", t);
  }

  private countLine(count: number, target: number): string | null {
    if (count === target - 1 && target >= 2) return this.words.lastOne;
    if (count === target - 2 && target >= this.limits.twoMoreFrom) return this.words.twoMore;
    if (count === Math.ceil(target / 2) && target >= this.limits.halfwayFrom) return this.words.halfway;
    return null;
  }

  /** Each answer: whether the screen has lost the person (unseen long enough that it says so). */
  seen(t: number, lost: boolean): Say | null {
    if (!lost) {
      this.lost = false;
      return null;
    }
    if (this.lost) return null;
    this.lost = true;
    if (t - this.lostAt < this.limits.lostAgain) return null;
    this.lostAt = t;
    return this.say(this.words.lost, "lost", t);
  }

  /** A hold's frame: `target`, the seconds to hold (null with none). */
  hold(frame: HoldFrame, target: number | null): Say | null {
    const t = frame.t;
    if (frame.unseen && frame.reason !== null) {
      this.unreadSince ??= t;
      if (!this.holdTold && t - this.unreadSince >= this.limits.holdUnseen) {
        this.holdTold = true;
        return this.say(frame.reason, "reason", t);
      }
      return null;
    }
    this.unreadSince = null;
    if (frame.holding) this.holdTold = false;
    if (!this.halfwayHeld && target !== null && target >= this.limits.holdHalfwayFrom && frame.heldMs >= (target * 1000) / 2) {
      // Left out within the quiet after another line, it is said at the next frame past it: a hold goes on.
      const said = this.encourage(this.words.halfway, "count", t);
      if (said !== null) this.halfwayHeld = true;
      return said;
    }
    return null;
  }

  /** The set has ended. */
  end(t: number): Say | null {
    if (this.ended) return null;
    this.ended = true;
    return this.say(this.words.setComplete, "set complete", t);
  }

  private encourage(words: string, kind: SayKind, t: number): Say | null {
    return t - this.lastAt < this.limits.quiet ? null : this.say(words, kind, t);
  }

  private say(words: string, kind: SayKind, t: number): Say {
    const times = this.said.get(words) ?? 0;
    this.said.set(words, times + 1);
    this.lastAt = t;
    return { words, kind, times, t };
  }
}
