// Each rep's score and the set's summary (spec Part 2 §2.4, §13.3; ROADMAP 52b-ii-b): the one thing about a set that
// leaves the phone, in the shape the workout save, calories, XP and the boards already read (`engineSetSummarySchema` in
// @app/shared, the server's own check). Pure: it is told every frame's result and keeps only what the summary needs.
//
// A rep's score comes from its form checks alone (form.ts): of the mistakes the camera could see in that rep, the share
// that were fine, out of 100. A mistake the camera could not see from where the phone stands counts neither way: it is
// never taken as good form, and never as bad. A rep in which the camera could see none of them has no score, so the set's
// scores hold only the reps that were judged; a set with none has no form score at all (null), never a good one.
import type { EngineSetSummary, ExerciseCamera, HoldMovement, Movement, View } from "@app/shared";
import { SIDE_ON } from "./form.js";
import type { HoldFrame } from "./hold.js";
import { MATCH_LIMITS, type MatchFrame, type RepResult } from "./matcher.js";

/** The movement engine's version, beside the old engine's 1.x (`packages/engine`): a set's summary names it. 2.1.0
 *  (52c-ii) reads floor work and holds, and gives a hold's set its time held; a set of a movement 2.0.0 had is counted
 *  as 2.0.0 counted it. */
export const MOVEMENT_ENGINE_VERSION = "2.1.0";

/** The longest time between two pictures that counts as watched, ms: the matcher's own `lost`, half a second; a longer
 *  gap is the person gone from view, or the phone stopped. */
export const WATCHED_GAP = MATCH_LIMITS.lost;

/** A counted rep's form score, 0 to 100: of its form checks the camera could see, the share that were fine. Null for a
 *  rep not counted, and for one in which the camera could see none of its exercise's mistakes. */
export function repScore(rep: RepResult): number | null {
  if (rep.verdict !== "counted") return null;
  const seen = rep.form.filter((f) => f.status !== "unseen");
  if (seen.length === 0) return null;
  return Math.round((100 * seen.filter((f) => f.status === "fine").length) / seen.length);
}

const mean = (values: readonly number[]): number | null => (values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length);
const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] ?? null) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
};
const hundredths = (v: number): number => Math.round(v * 100) / 100;

/**
 * One set, as the camera saw it: give it every frame the matcher returns (`MovementMatcher.next`, and `finish` at the
 * end), then ask for its summary, as often as wanted. A clock that went back is a new set, as it is to the matcher.
 */
export class SetRecord {
  private first: number | null = null;
  private last: number | null = null;
  private lastSeen = false;
  private watched = 0;
  private reps: RepResult[] = [];

  constructor(
    private readonly exercise: ExerciseCamera,
    private readonly movement: Movement,
    private readonly setIndex: number,
  ) {
    if (exercise.movement !== movement.name) throw new Error(`${exercise.id} uses the movement ${exercise.movement}, not ${movement.name}.`);
    if (!Number.isInteger(setIndex) || setIndex < 1) throw new Error(`A set's number is a whole number from 1, not ${String(setIndex)}.`);
  }

  add(frame: MatchFrame): void {
    if (this.last !== null && frame.t < this.last) {
      this.first = null;
      this.last = null;
      this.lastSeen = false;
      this.watched = 0;
      this.reps = [];
    }
    if (frame.rep !== null) this.reps.push(frame.rep);
    if (this.last !== null && frame.t === this.last) return;
    if (this.last !== null && this.lastSeen) this.watched += Math.min(frame.t - this.last, WATCHED_GAP);
    this.first ??= frame.t;
    this.last = frame.t;
    this.lastSeen = frame.seen;
  }

  /** Every rep judged so far, counted or not, in order. */
  judged(): readonly RepResult[] {
    return this.reps;
  }

  /**
   * The set's summary (§2.4):
   *   - `reps`: the reps counted; `repScores`, each counted rep's score where it has one (`repScore`), in order;
   *     `avgFormScore`, their mean, null when none has a score;
   *   - `faultCounts`: for each of the exercise's mistakes, how many reps the camera saw it made in: a counted rep's form
   *     check, or a rep refused for it (the squat's chest past "chest up"); a mistake never seen made is not listed;
   *   - `durationMs`, from the first picture to the last; `watchedMs`, the time the camera read the person, each gap
   *     between pictures counted up to `WATCHED_GAP`;
   *   - `tempoMsAvg`: a counted rep's own time, from passing half its depth on the way down to back up (the movement's
   *     "time"), the mean; `romStats`: each of the movement's count rules' readings, the mean over the counted reps;
   *   - `view`: where the body stood at the bottom of the counted reps, the middle of their turns: "side" when side on
   *     (form.ts `SIDE_ON`), "front" when not side on, half turned included (§2.4's view has no third way, and a turn
   *     cannot be told from facing the phone: from the front 0.61 to 1.00 of the hips show, half turned 0.19 to 0.93),
   *     "unknown" when not seen;
   *   - `engineVersion` this engine's, `definitionVersion` the exercise file's own.
   */
  summary(): EngineSetSummary {
    const counted = this.reps.filter((r) => r.verdict === "counted");
    const scores = counted.flatMap((r) => {
      const s = repScore(r);
      return s === null ? [] : [s];
    });
    const avg = mean(scores);
    const faults = new Map<string, number>();
    for (const r of this.reps) {
      if (r.verdict !== "counted" && r.verdict !== "refused") continue;
      for (const f of r.form) if (f.status === "made") faults.set(f.mistake, (faults.get(f.mistake) ?? 0) + 1);
    }
    const tempo = mean(counted.map((r) => r.end - r.start));
    const counts = this.movement.rules.filter((r) => r.role === "count");
    const rom = counts.flatMap((rule): [string, number][] => {
      const m = mean(
        counted.flatMap((r) => {
          const v = r.readings[rule.name] ?? null;
          return v === null ? [] : [v];
        }),
      );
      return m === null ? [] : [[rule.name, hundredths(m)]];
    });
    const turn = median(counted.flatMap((r) => (r.turn === null ? [] : [r.turn])));
    const view: View = turn === null ? "unknown" : turn <= SIDE_ON ? "side" : "front";
    const durationMs = this.first === null || this.last === null ? 0 : Math.round(this.last - this.first);
    return {
      exercise: this.exercise.id,
      setIndex: this.setIndex,
      reps: counted.length,
      durationMs,
      tempoMsAvg: tempo === null ? null : Math.round(tempo),
      romStats: rom.length === 0 ? null : Object.fromEntries(rom),
      view,
      holdMs: null,
      calibration: null,
      mode: "engine",
      watchedMs: Math.min(durationMs, Math.round(this.watched)),
      avgFormScore: avg === null ? null : Math.round(avg),
      repScores: scores,
      faultCounts: Object.fromEntries(faults),
      engineVersion: MOVEMENT_ENGINE_VERSION,
      definitionVersion: this.exercise.version,
    };
  }
}

/**
 * One hold's set, as the camera saw it (ROADMAP 52c-ii): give it every frame the hold's clock returns (`HoldMatcher.next`,
 * and `finish` at the end), then ask for its summary. `holdMs` is the time held (§2.4); a hold has no reps and, until its
 * mistakes are checked (54), no form score. `watchedMs` is the time the camera read the position, each gap between
 * pictures counted up to `WATCHED_GAP`, as for reps. A clock that went back is a new set.
 */
export class HoldRecord {
  private first: number | null = null;
  private last: number | null = null;
  private lastSeen = false;
  private watched = 0;
  private held = 0;

  constructor(
    private readonly exercise: ExerciseCamera,
    hold: HoldMovement,
    private readonly setIndex: number,
  ) {
    if (exercise.movement !== hold.name) throw new Error(`${exercise.id} uses the movement ${exercise.movement}, not ${hold.name}.`);
    if (!Number.isInteger(setIndex) || setIndex < 1) throw new Error(`A set's number is a whole number from 1, not ${String(setIndex)}.`);
  }

  add(frame: HoldFrame): void {
    if (this.last !== null && frame.t < this.last) {
      this.first = null;
      this.last = null;
      this.lastSeen = false;
      this.watched = 0;
      this.held = 0;
    }
    this.held = frame.heldMs;
    if (this.last !== null && frame.t === this.last) return;
    if (this.last !== null && this.lastSeen) this.watched += Math.min(frame.t - this.last, WATCHED_GAP);
    this.first ??= frame.t;
    this.last = frame.t;
    this.lastSeen = !frame.unseen;
  }

  summary(): EngineSetSummary {
    const durationMs = this.first === null || this.last === null ? 0 : Math.round(this.last - this.first);
    return {
      exercise: this.exercise.id,
      setIndex: this.setIndex,
      reps: 0,
      durationMs,
      tempoMsAvg: null,
      romStats: null,
      view: "unknown",
      holdMs: Math.min(durationMs, Math.round(this.held)),
      calibration: null,
      mode: "engine",
      watchedMs: Math.min(durationMs, Math.round(this.watched)),
      avgFormScore: null,
      repScores: [],
      faultCounts: {},
      engineVersion: MOVEMENT_ENGINE_VERSION,
      definitionVersion: this.exercise.version,
    };
  }
}
