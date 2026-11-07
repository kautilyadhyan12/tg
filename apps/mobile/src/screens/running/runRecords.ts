// Running records (ROADMAP Stage 5 item 37c-ii; Kd's "yes" to reviews/37c-ii-records-mock.png): the four a
// person sees, in their own units (Fastest 1K, or Fastest mile in miles; 5K; 10K; Longest run), their
// words and medals, and which of them a run just finished beats. The records are the server's
// (GET /v1/geo/runs/records), worked out from the person's own runs; a run's best efforts are the shared
// maths' own (`runSums`), so the summary and the server never differ.
import type { RunBests, RunRecord, RunRecordKind, RunRecords, Units } from "@app/shared";
import { clock, distance, METRES_PER_MILE, unitWord } from "./runWords";

export const RECORDS_PATH = "/v1/geo/runs/records";

/** The longest run counts from this far: the streak's own line (the server's LONGEST_RUN_FROM_M). */
export const LONGEST_FROM_M = 200;

export interface ShownRecord {
  kind: RunRecordKind;
  /** "Fastest 5K". */
  name: string;
  /** Its medal's picture (`look/medals.ts`), without `_locked`. */
  medal: string;
  record: RunRecord | null;
  /** "27:40", or "6.21 km". */
  value: string | null;
  /** What it takes while not set: "Run 10 km to set it." */
  takes: string;
}

const NAMES: Readonly<Record<RunRecordKind, string>> = {
  k1: "Fastest 1K",
  mile: "Fastest mile",
  k5: "Fastest 5K",
  k10: "Fastest 10K",
  longest: "Longest run",
};
export const MEDALS: Readonly<Record<RunRecordKind, string>> = {
  k1: "medal_fastest_1k",
  mile: "medal_fastest_1k",
  k5: "medal_fastest_5k",
  k10: "medal_fastest_10k",
  longest: "medal_longest_run",
};
const TAKES: Readonly<Record<RunRecordKind, string>> = {
  k1: "Run 1 km to set it.",
  mile: "Run a mile to set it.",
  k5: "Run 5 km to set it.",
  k10: "Run 10 km to set it.",
  longest: "Go for a run to set it.",
};

/** The four records shown, in the person's units: the 1K is the mile in miles. */
export function shownKinds(units: Units): RunRecordKind[] {
  return [units === "imperial" ? "mile" : "k1", "k5", "k10", "longest"];
}

export const recordName = (kind: RunRecordKind): string => NAMES[kind];

/** A record's value in words: a time, or the longest run's distance in the person's units. */
export function recordValue(kind: RunRecordKind, value: number, units: Units): string {
  return kind === "longest" ? `${distance(value, units)} ${unitWord(units)}` : clock(value);
}

export function shownRecords(records: RunRecords, units: Units): ShownRecord[] {
  return shownKinds(units).map((kind) => {
    const record = records[kind];
    return { kind, name: NAMES[kind], medal: MEDALS[kind], record, value: record === null ? null : recordValue(kind, record.value, units), takes: TAKES[kind] };
  });
}

/** How much the record beat the best before it: "42 seconds faster than your last best.", or for the
 *  longest run "1.20 km longer than your last best."; null for a first record. */
export function beatWords(kind: RunRecordKind, value: number, before: number | null, units: Units): string | null {
  if (before === null) return null;
  if (kind === "longest") {
    const more = value - before;
    if (more <= 0) return null;
    // Under a hundredth of the unit, "0.00 km" would read as no further: said in metres or feet (round one, H2).
    const small = units === "imperial" ? more < METRES_PER_MILE / 100 : more < 10;
    if (!small) return `${distance(more, units)} ${unitWord(units)} longer than your last best.`;
    const n = units === "imperial" ? Math.max(1, Math.round(more * 3.28084)) : Math.max(1, Math.round(more));
    return `${String(n)} ${units === "imperial" ? (n === 1 ? "foot" : "feet") : n === 1 ? "metre" : "metres"} longer than your last best.`;
  }
  const s = before - value;
  if (s <= 0) return null;
  return s < 60 ? `${String(s)} ${s === 1 ? "second" : "seconds"} faster than your last best.` : `${clock(s)} faster than your last best.`;
}

export interface NewRecord {
  kind: RunRecordKind;
  value: number;
  /** The record it beat; null when it is the first. */
  before: number | null;
}

/** The records a run just finished beats, against the person's records as the server last gave them:
 *  strictly faster (a tie keeps the old one, as the server does), or longer for the longest run. */
export function newRecords(bests: RunBests, distanceM: number, records: RunRecords, units: Units): NewRecord[] {
  const out: NewRecord[] = [];
  for (const kind of shownKinds(units)) {
    const held = records[kind]?.value ?? null;
    if (kind === "longest") {
      if (distanceM >= LONGEST_FROM_M && (held === null || distanceM > held)) out.push({ kind, value: distanceM, before: held });
      continue;
    }
    const mine = bests[kind];
    if (mine !== null && (held === null || mine < held)) out.push({ kind, value: mine, before: held });
  }
  return out;
}
