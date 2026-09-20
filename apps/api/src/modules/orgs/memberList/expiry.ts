// A FILE NOBODY SAID YES TO (Part 3 §9.6, the `orgs.member_list_expiry` job).
//
// A staged upload holds the names, email addresses and phone numbers of every
// person in the file. Staff have an hour to read it and confirm it; after that the
// answer is stale — it was worked out against a list that may have moved — and the
// cells have no reason to exist. This job is what takes them away.
//
// **NOTHING CORRECT DEPENDS ON THIS HAVING RUN.** `repo.uploadFor` answers a
// preview past its own hour as expired whichever state the column is in, so a
// preview a minute over is as gone as one a day over. This is housekeeping: it
// frees the cells and keeps the table honest. If the worker never runs, nobody
// sees a stale preview — we simply keep a file's cells longer than we should,
// which is the safe direction for a sweep to fail in.
//
// **SET-BASED, AND ITS OWN WHERE EXCLUDES THE STATE IT PRODUCES**, so running it
// twice is a no-op and a retry is free (R3.5).
import type { Sql } from "postgres";
import { expireStagedUploads } from "./repo.js";

export interface MemberListExpiryDeps {
  sql: Sql;
  log: { info: (obj: object, msg: string) => void };
}

export interface MemberListExpiryOptions {
  /** Injected clock. An hour is not a thing a test can wait for, and the whole
   *  behaviour under test is what happens after one. */
  now?: Date;
  /** Bound the run to named gyms. Omitted = the whole table, which is what the
   *  hourly job wants and what production always passes.
   *
   *  **It exists because a sweep is TABLE-WIDE by nature and its own tests are
   *  not** — `archiveSweep.ts` and `sweep.ts` carry the same option for the same
   *  recorded reason: vitest runs suites against ONE database, and an unscoped run
   *  at a future `now` from one suite would expire another suite's staged upload
   *  underneath it. */
  gymIds?: readonly string[];
}

export interface MemberListExpiryResult {
  /** Staged uploads that ran out on this run. */
  expired: number;
}

export async function expireStagedMemberListUploads(
  deps: MemberListExpiryDeps,
  opts: MemberListExpiryOptions = {},
): Promise<MemberListExpiryResult> {
  const now = opts.now ?? new Date();
  const expired = await expireStagedUploads(deps.sql, now, opts.gymIds ?? null);
  const result: MemberListExpiryResult = { expired };
  // R8.3: every background job says what it did.
  deps.log.info({ ...result, event: "orgs.member_list_expiry.finished" }, "member list upload expiry finished");
  return result;
}
