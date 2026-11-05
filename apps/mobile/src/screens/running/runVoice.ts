// The run's voice (ROADMAP Stage 5 item 37a-ii): what it says and when, as Strava's and Nike Run
// Club's do, in the person's own units. Pure: the recorder hands in the run's numbers and speaks
// the lines that come back.
//
// Each whole kilometre or mile: the distance, the time at the mark, the last one's time and the
// average pace, as they stood at the mark. A mark is said SETTLE_S after it is passed: the line
// drawn through the points is smoothed with the points that follow, which moves where the mark
// falls. Measured on four real runs recorded on phones, in kilometres and miles (74 marks), a mark
// said SETTLE_S after gives the summary's own seconds every time; said at the mark, up to 9 in 12
// were a second off. A pause ends the stretch the maths smooths, so a mark is said at once there.
import type { RunSums, Units } from "@app/shared";
import { METRES_PER_MILE } from "./runWords";

export const SETTLE_S = 15;
/** Checked no more often than this. */
export const CHECK_MS = 5000;
/** Faster than anybody runs (the 100 m record is under 10.5 m a second): between marks the next
 *  check waits as long as the next mark would take at this speed, so a run costs a few checks a
 *  kilometre. */
const FASTEST_MPS = 12.5;

const metresPer = (units: Units): number => (units === "imperial" ? METRES_PER_MILE : 1000);
const other = (units: Units): Units => (units === "imperial" ? "metric" : "imperial");

export interface VoiceState {
  /** The marks said so far, in each unit; null after the app was closed mid-run, until the first
   *  check counts the marks already passed, which are never said late. */
  said: Record<Units, number> | null;
  /** The next check, in ms into the run. */
  nextAt: number;
}

export const VOICE_START: VoiceState = { said: { metric: 0, imperial: 0 }, nextAt: 0 };
export const VOICE_AFTER_LOAD: VoiceState = { said: null, nextAt: 0 };

export interface Mark {
  /** Whole kilometres or miles. */
  count: number;
  units: Units;
  /** Moving time at the mark. */
  timeS: number;
  /** The last kilometre or mile's own time. */
  lastS: number;
}

/** The newest whole kilometre or mile not yet said, once it is settled (or at a pause). */
export function newMark(sums: RunSums, units: Units, said: number, settled: boolean): Mark | null {
  const count = Math.floor(sums.distanceM / metresPer(units));
  if (count < 1 || count <= said) return null;
  const splits = units === "imperial" ? sums.splitsMi : sums.splitsKm;
  const last = splits[count - 1];
  if (last === undefined || last.s <= 0) return null;
  const since = splits.slice(count).reduce((t, split) => t + split.s, 0);
  if (!settled && since < SETTLE_S) return null;
  return { count, units, timeS: Math.max(0, sums.movingS - since), lastS: last.s };
}

/** A check: the line to say, if any. `sums` is worked out only when a check is due. `at` is the run's
 *  last point, in ms into the run; `settled` is true at a pause. */
export function voiceCheck(
  state: VoiceState,
  at: number,
  units: Units,
  sums: () => RunSums,
  settled: boolean,
): { state: VoiceState; mark: Mark | null; line: string | null } {
  if (!settled && at < state.nextAt) return { state, mark: null, line: null };
  const now = sums();
  const passed = (u: Units) => Math.floor(now.distanceM / metresPer(u));
  const said = state.said ?? { metric: passed("metric"), imperial: passed("imperial") };
  // The other unit is counted too, so a change of units mid-run says no mark already passed.
  const mine = said[units];
  const theirs = Math.max(said[other(units)], passed(other(units)));
  const mark = state.said === null ? null : newMark(now, units, mine, settled);
  const count = mark?.count ?? mine;
  const next: Record<Units, number> = units === "imperial" ? { imperial: count, metric: theirs } : { metric: count, imperial: theirs };
  // Waiting for a mark to settle, or for the next one to be reached.
  const waiting = passed(units) > count;
  const sinceMark = (units === "imperial" ? now.splitsMi : now.splitsKm).slice(passed(units)).reduce((t, split) => t + split.s, 0);
  const wait = waiting
    ? (SETTLE_S - sinceMark) * 1000
    : (((count + 1) * metresPer(units) - now.distanceM) / FASTEST_MPS) * 1000;
  return { state: { said: next, nextAt: at + Math.max(CHECK_MS, wait) }, mark, line: mark === null ? null : markLine(mark) };
}

// ── The words ────────────────────────────────────────────────────────────────────────────────

const counted = (n: number, one: string, many: string): string => `${String(n)} ${n === 1 ? one : many}`;

/** "11 minutes 20 seconds", "1 hour 2 minutes 5 seconds", "5 minutes": what a voice reads well. */
export function spokenTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [
    h > 0 ? counted(h, "hour", "hours") : null,
    m > 0 ? counted(m, "minute", "minutes") : null,
    s % 60 > 0 || s === 0 ? counted(s % 60, "second", "seconds") : null,
  ];
  return parts.filter((p) => p !== null).join(" ");
}

/** A pace slower than an hour a kilometre or mile is nobody's pace: it is not said (the screen
 *  shows --:-- for it). */
const SLOWEST_S = 3600;

/** "2 kilometres. Time 11 minutes 20 seconds. Last kilometre 5 minutes 40 seconds. Average pace
 *  5 minutes 40 seconds per kilometre." The first mark has no "last" of its own: it is the time. */
export function markLine(mark: Mark): string {
  const unit = mark.units === "imperial" ? "mile" : "kilometre";
  const average = Math.round(mark.timeS / mark.count);
  const parts = [
    `${counted(mark.count, unit, `${unit}s`)}.`,
    `Time ${spokenTime(mark.timeS)}.`,
    mark.count > 1 && mark.lastS < SLOWEST_S ? `Last ${unit} ${spokenTime(mark.lastS)}.` : null,
    average < SLOWEST_S ? `Average pace ${spokenTime(average)} per ${unit}.` : null,
  ];
  return parts.filter((p) => p !== null).join(" ");
}

export const PAUSE_WORDS = { auto: "Auto-paused.", person: "Run paused.", resumed: "Run resumed." } as const;
