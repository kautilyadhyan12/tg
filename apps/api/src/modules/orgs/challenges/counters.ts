// THE COUNTERS (spec Part 3 §15.10.3; ROADMAP 19d-iii). One for each (subject, measure) on the
// list that the app counts (`packages/shared/src/challengeSubjects.ts`): given the gym, the
// instant and the spans of the challenges that use it, each live member's number in each
// span, in one read. A subject the app comes to count adds one line here.
//
// A challenge whose (subject, measure) has no counter counts nothing: never another
// counter's numbers.
import type { Sql, TransactionSql } from "postgres";
import * as boards from "../leaderboard/repo.js";

export type Counter = (sql: Sql | TransactionSql, input: boards.RangesInput) => Promise<boards.RangeCounts>;

const COUNTERS: ReadonlyMap<string, Counter> = new Map<string, Counter>([
  ["gym_visits.days", boards.gymDaysInRanges],
  ["workouts.days", boards.workoutDaysInRanges],
]);

/** The one key a counter is kept under. */
export const counterKey = (subject: string, measure: string): string => `${subject}.${measure}`;

export const counterFor = (subject: string, measure: string): Counter | undefined => COUNTERS.get(counterKey(subject, measure));

/** Every key a counter is kept under: each must be a measure on the list, and each measure on
 *  the list must have one (`challenges.counters.unit.test.ts`). */
export const counterKeys = (): string[] => [...COUNTERS.keys()];
