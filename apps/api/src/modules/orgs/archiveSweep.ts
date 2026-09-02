// A GYM WITH NO PLAN IS CLOSED FOUR MONTHS LATER — the third and last piece of
// Kd's :22215 §5 step 1, and the writer that has never existed.
//
// **THE NUMBER IS KD'S AND IT REPLACES THE SPEC'S.** Part 3 §4.2 says *"the
// console stays read-only 14 days, then archived (restorable by reactivating)"*.
// On 2026-08-31 he ruled four months instead — *"i think after 4 months of
// inactivity shut down the gym"* — after being shown that a gym with no plan is
// already frozen from the day it lapses, so stretching the window costs nothing
// and a short one closes a gym that is merely late paying. :22215 §6 required
// that the fourteen days not be moved without asking; it was asked, and this is
// the answer.
//
// **IT COUNTS FROM THE DAY THE PLAN ENDED, NOT FROM INACTIVITY, and that was a
// recommendation he approved rather than a paraphrase of what he said.** Two
// measurements decided it: nothing in this product records when a gym was last
// active, and an inactivity rule would be able to close a gym that is PAYING but
// quiet, which is closing a paying customer's account. The date a plan ended
// needs no new machinery and cannot reach a paying gym at all.
//
// **THE FIRST MEASUREMENT WAS "`org_daily_stats` HAS NO WRITER AND NO READER —
// grep-verified", AND HALF OF IT EXPIRED ON 2026-09-02**: `modules/orgs/rollup.ts`
// writes that table hourly now (:30094). **The ruling is untouched** — the sweep
// still counts from the day the plan ended, and the reason still holds, because
// a daily aggregate is not a "last active" date and nothing queries it for one.
// The sentence is corrected rather than deleted because it is the evidence Kd
// was shown, and a chat sent here by :25771's trigger would otherwise read a
// dead table into a live one.
//
// **WHAT CLOSING A GYM DOES, because the word is bigger than the change.**
// `gyms.status` becomes `archived`. Nothing is deleted: the gym, its members,
// its codes, its staff and everyone's training history stay exactly as they
// are, and its members were moved to the free app the day the plan ended, not
// today (`entitlements/repo.ts`'s live-status join — :22341). What stops is
// three doors that already refuse an archived gym and have since `0001_init`:
// typing its join code (`applyByCode`), confirming somebody into it
// (`confirmApplication`), and starting a trial on it (`startGymTrial`). Its
// console was already read-only from the day it lapsed (:23711).
//
// **THE CLOCK STARTS AT `subscriptions.ended_at`** (migration `0016`), written
// by `trialSweep.ts` when it moves a row out of §4.1's live set. The reasoning
// for that column rather than `trial_ends_at` is in the migration and in the
// schema, and the short version is that nothing ever clears `trial_ends_at`, so
// a gym that converts to paying and lapses a year later still carries the date
// its trial ended — an archive clock keyed on it would close that gym the same
// night it stopped paying.
//
// **A GYM THAT NEVER STARTED ANYTHING IS NEVER CLOSED BY THIS.** No plan ever
// ended, so `max(ended_at)` is NULL, the comparison is NULL, and the row is
// filtered out — not by a special case but by the shape of the question. Said
// out loud because it is a decision: the state §4.2 describes is a plan ENDING,
// and a gym that has never subscribed is a gym nobody has promised anything
// about yet. Same for the rows that expired before `0016` existed — a NULL stamp
// means "we do not know when this ended", and those gyms keep their console
// until somebody acts. Both are the safe direction for a state that has no
// automatic way back.
//
// **THERE IS NO AUTOMATIC WAY BACK, AND KD WAS TOLD SO BEFORE HE RULED.**
// Nothing in this product can put a gym back on a plan — measured again this
// session: `subscriptions` has exactly two writers in `apps/api/src`, the INSERT
// in `startGymTrial` and the UPDATE in `trialSweep.ts`. So re-opening is
// `tools/gym-restore.ts`, by hand, until the payment card exists; that card owes
// the automatic half and its `OWED.md` line says so.
//
// **A GYM RE-OPENED BY HAND IS NEVER CLOSED AGAIN FOR THE ENDING IT WAS CLOSED
// FOR**, and that is the `archived_at` condition rather than an accident.
// Without it, restoring a gym whose plan ended five months ago would last
// exactly one night: the next run would see no live plan and an old date and
// close it again. `archived_at` therefore means "the last time this gym was
// closed" and survives the restore, while `status` means "is it closed now" —
// an operator's hand overrides the machine, which is the right direction when
// the machine can only close and the hand can only open.
//
// **BUT THE HAND ONLY OVERRULES THE MACHINE UNTIL THE GYM LAPSES AGAIN, and
// that half was missing until T3 round 1 (2026-08-31, DECISIONS :26220).** A
// bare `archived_at IS NULL` does not say *"an operator has overruled this
// closure"*; it says *"an operator overruled a closure once, so this gym is
// outside the policy for the rest of its life"*. Measured on the future the
// paragraph above promises: close a gym, re-open it, let it take a plan that
// ends a month later, wait five more months — and it is never closed again,
// silently, with nothing on any screen to say so. So the condition is
// `archived_at IS NULL` **OR something has ended since that closure**: the
// restore still survives the next night, because the ending it was closed for
// is older than the closure, and a NEW ending re-arms the clock.
//
// **NO `lockOrgRow`, and the race that leaves is named rather than left to be
// found.** This is a check-then-act: the WHERE asks whether a gym has a live
// plan, and a plan starting between that read and the write would be missed —
// the UPDATE waits on `startGymTrial`'s `FOR UPDATE`, but that transaction
// writes `subscriptions` and not `gyms`, so no row version changes and Postgres
// re-checks nothing. **It is unreachable today and that is an argument, not a
// hope**: the only writer that can give a gym a live plan is `startGymTrial`,
// and it refuses any owner who has ever had a trial (`trial_ends_at IS NOT
// NULL`, regardless of status) — so a gym four months past its own plan ending
// cannot acquire one. The day a payment path exists it becomes reachable, and
// the fix then is that path re-opening the gym (its own `OWED.md` line), not a
// lock here. Taking one would turn a set-based sweep into a per-gym loop, which
// is the call `trialSweep.ts` made for the same reason. **The damage if it ever
// fires is one gym closed a moment after paying, recoverable by
// `tools/gym-restore.ts`** — nothing is deleted.
//
// This file holds the logic and OWNS NO SCHEDULE: `worker.ts` runs it nightly
// and `tools/archive-sweep.ts` runs it by hand — the same shape as `sweep.ts`,
// `trialSweep.ts` and `modules/privacy/purge.ts`, and for the same reason: the
// tests drive it against real Postgres with no queue anywhere near them.
//
// NO BATCH LIMIT, like both of its siblings. Same shape, same size of table, and
// it shares their `OWED.md` line rather than opening a second one.
//
// IDEMPOTENT BY CONSTRUCTION (R3.5). The statement is set-based and its WHERE
// excludes the state it produces, so a second run in the same second changes
// nothing and a retried job is free.
import type { Sql } from "postgres";
import { insertAudit } from "./repo.js";

/** HOW LONG A GYM KEEPS ITS CONSOLE AFTER ITS PLAN ENDS — Kd's ruling of
 *  2026-08-31, superseding Part 3 §4.2's fourteen days.
 *
 *  **MONTHS AND NOT DAYS, DELIBERATELY.** He said four months; 120 days is a
 *  different promise in a different part of the year, and the statement below
 *  measures it with `INTERVAL '1 month'` so the answer is calendar-correct
 *  rather than approximately right.
 *
 *  It is NOT `APPLICATION_TTL_DAYS`' neighbour and must never be collapsed with
 *  it: that one is how long a person waits at a gym's door, this one is how long
 *  a gym keeps its console. Two numbers that mean different things get two
 *  constants, or an edit to one silently moves the other (`sweep.ts`'s
 *  `EXPIRY_NOTICE_DAYS` carries the same warning for the same reason). */
export const ARCHIVE_AFTER_MONTHS = 4;

export interface ArchiveSweepDeps {
  sql: Sql;
  log: { info: (obj: object, msg: string) => void };
  /** Injected so the atomicity of "close it + record why" is testable,
   *  following `sweep.ts`'s and `purge.ts`'s precedent. Production passes
   *  nothing. */
  insertAudit?: typeof insertAudit;
}

export interface ArchiveSweepOptions {
  /** Injected clock. Four months is not a thing a test can wait for, and it is
   *  not a thing Kd can wait for during a smoke either: `tools/archive-sweep.ts`
   *  passes this so he can watch a gym close in a browser in three minutes. */
  now?: Date;
  /** Bound the run to named gyms. Omitted = the whole table, which is what the
   *  nightly job wants and what production always passes.
   *
   *  **It exists because a sweep is TABLE-WIDE by nature and its own tests are
   *  not** — `sweep.ts`'s T3 round 1 Low-4, and `trialSweep.ts` inherited it for
   *  the same reason. `vitest` runs suites four at a time against ONE database
   *  and other suites keep gyms of their own; an unscoped run at a future `now`
   *  from this suite would close every gym in the database that has ever
   *  lapsed. Scoping also makes these tests' counts EXACT rather than "at least
   *  one". */
  gymIds?: readonly string[];
}

export interface ArchiveSweepResult {
  /** Gyms closed by this run. */
  archived: number;
}

interface Row {
  id: string;
}

export async function archiveLapsedGyms(
  deps: ArchiveSweepDeps,
  opts: ArchiveSweepOptions = {},
): Promise<ArchiveSweepResult> {
  const now = opts.now ?? new Date();
  const writeAudit = deps.insertAudit ?? insertAudit;

  // `null` means the whole table: `id = ANY(NULL)` is NULL rather than false,
  // which would filter every row out, so the IS NULL test comes first —
  // :12227's L-2, and `sweep.ts`'s `inScope` verbatim in shape.
  const scope = opts.gymIds ?? null;

  // **THE CLOSURE AND ITS AUDIT ROWS ARE ONE TRANSACTION.** `sweep.ts` shipped
  // these as two and it was a Critical/High (:13075 C/H-2): the UPDATE ran on
  // the pool and the audit inserts followed in a `begin` of their own, so a
  // timeout or a dead worker between them left rows already moved that the
  // retry could never match — with no audit row ever written for them, and
  // nothing able to repair it. Built as one from the first commit here, exactly
  // as `trialSweep.ts` was.
  const archivedRows = await deps.sql.begin(async (tx) => {
    const rows = await tx<Row[]>`
      UPDATE gyms g
      SET status = 'archived', archived_at = ${now}
      WHERE g.status = 'active'
        -- NO BACKTICKS ANYWHERE IN THIS TEMPLATE. One ends the literal and turns
        -- a documented query into a run of parse errors. This is listOrgsForUser's
        -- own warning, and it is here because I incurred the slip AGAIN writing
        -- this block — the fourth recorded time in this repo (:12227, then twice
        -- inside that one template). Typecheck caught it, as it did there.
        --
        -- THIS IS THE CONDITION THAT DOES THE WORK, and the line above is a
        -- restatement of it. A gym re-opened by hand keeps its archived_at, so
        -- this is what stops the next night's run closing it straight back down;
        -- an already-closed gym is excluded by it too, which is what makes a
        -- retry free. The status test decides nothing today — every writer of
        -- 'archived' sets both columns together — and it stays because it says
        -- the rule out loud and costs nothing. trialSweep.ts's
        -- "trial_ends_at IS NOT NULL" is the same shape, and its header is
        -- explicit that a restatement must not be sold as the enforcement.
        --
        -- THE SECOND HALF IS WHAT KEEPS THE FIRST FROM BEING PERMANENT IMMUNITY
        -- (T3 round 1, 2026-08-31). Alone, the NULL test reads "an operator
        -- overruled a closure ONCE, so this gym is outside the policy for
        -- ever" — a gym re-opened by hand, later on a plan, later lapsed again
        -- and dead for another four months is never closed, and no test or
        -- mutant could see it. So an ending recorded AFTER the last closure
        -- re-arms the clock.
        --
        -- ANY ending here, the LATEST one below, and the difference is
        -- deliberate. Below the question is how long ago this gym went dark, so
        -- only the newest ending can answer it. Here the question is whether
        -- anything at all has ended since we last closed the gym, and one such
        -- row settles it — if any ending is later than archived_at then the
        -- newest one is too.
        AND (
          g.archived_at IS NULL
          OR EXISTS (
            SELECT 1 FROM subscriptions s4
            WHERE s4.owner_type = 'gym' AND s4.owner_id = g.id
              AND s4.ended_at > g.archived_at)
        )
        AND (${scope}::uuid[] IS NULL OR g.id = ANY(${scope}::uuid[]))
        -- A GYM ON A PLAN IS NOT THIS JOB'S BUSINESS, WHATEVER ITS OLD DATES
        -- SAY. §4.1's three granting statuses, the set gymHasLivePlan,
        -- seatCapFor, startGymTrial, listOrgsForUser's lateral and the
        -- entitlements repo all share — so a gym whose members are getting
        -- gym-tier features is exactly a gym that cannot be closed. Load-bearing
        -- and not decoration: a gym that trialled, lapsed, and later started
        -- paying carries an ended_at from the trial, and without this line the
        -- comparison below would close a paying customer. R3.8 forbids sharing
        -- the set as an sql fragment and :14493's Low-2 is what two readers of
        -- one rule cost when they drift, so what holds this copy to the others
        -- is a test driving one gym across the transition.
        AND NOT EXISTS (
          SELECT 1 FROM subscriptions s
          WHERE s.owner_type = 'gym' AND s.owner_id = g.id
            AND s.status IN ('trialing','active','past_due'))
        -- AN ENDING NOBODY DATED IS NOT AN ENDING WE MAY COUNT FROM, and this
        -- is max()'s blind spot rather than a second rule (T3 round 1,
        -- 2026-08-31). max() SKIPS NULLS: a gym carrying an old stamped row
        -- plus a NEWER row whose writer forgot the stamp reads the OLD date and
        -- is closed on the spot — O169's harm arriving through a NULL instead
        -- of through min(). It is unreachable today (trialSweep.ts is the only
        -- writer of ended_at, and startGymTrial refuses a gym a second
        -- subscription), and the contract is stated in the migration and in the
        -- schema — which is exactly the kind of guarantee :14493's Low-2 says a
        -- comment cannot hold. A row nobody dated means "we do not know when
        -- this ended", which is already the answer this statement gives a gym
        -- whose only ended row carries no stamp.
        --
        -- NOT IN the live set, rather than IN a list of ended statuses: a LIVE
        -- row legitimately carries no ending (it has not ended), and a status
        -- added later that means "over" is covered without anybody remembering
        -- this line.
        AND NOT EXISTS (
          SELECT 1 FROM subscriptions s3
          WHERE s3.owner_type = 'gym' AND s3.owner_id = g.id
            AND s3.ended_at IS NULL
            AND s3.status NOT IN ('trialing','active','past_due'))
        -- THE LATEST ENDING, NEVER ANY ENDING. max() is the whole difference
        -- between "this gym has been off a plan for four months" and "this gym
        -- once had something end four months ago" — a gym that trialled in
        -- January, paid from February and lapsed last week has both dates on
        -- file, and an EXISTS over ended_at would read the January one and close
        -- it six days after it stopped paying.
        --
        -- NULL is the answer for a gym that never subscribed and for rows that
        -- expired before migration 0016 existed, and a NULL comparison is not
        -- true — so both are left alone by the shape of the question rather than
        -- by a special case. Do not wrap this in coalesce.
        --
        -- THE FOUR MONTHS ARE COUNTED IN UTC AND NOT IN WHATEVER ZONE THE
        -- DATABASE SESSION HAPPENS TO CARRY (T3 round 1, 2026-08-31). Adding
        -- or subtracting a MONTH from a timestamptz is calendar arithmetic, and
        -- Postgres does it in the session TimeZone — nothing in this repo sets
        -- one, so it is whatever the server was configured with. On a
        -- DST-observing zone the January-to-May span moves by an hour, which is
        -- nothing to a gym and enough to turn the boundary test red on a
        -- differently-configured database. The round trip through UTC pins it:
        -- to a plain timestamp, calendar maths there, back to an instant.
        AND (
          SELECT max(s2.ended_at) FROM subscriptions s2
          WHERE s2.owner_type = 'gym' AND s2.owner_id = g.id
        ) <= ((${now}::timestamptz AT TIME ZONE 'UTC')
              - (${ARCHIVE_AFTER_MONTHS} * INTERVAL '1 month')) AT TIME ZONE 'UTC'
      RETURNING g.id`;
    // Part 3 §3.3: every mutating call writes `audit_log`. Like both other
    // sweeps this is a mutation with NO ACTOR — nobody chose it — so the actor
    // is null rather than a stand-in, and `via` names the machine that did it.
    // It is also the only record that will ever explain to an owner why their
    // gym closed, and the row `tools/gym-restore.ts` is answering when somebody
    // asks for it back.
    for (const row of rows) {
      await writeAudit(tx, {
        actorUserId: null,
        gymId: row.id,
        action: "org.archived",
        targetType: "gym",
        targetId: row.id,
        meta: { via: "archive_sweep" },
      });
    }
    return rows;
  });

  const result: ArchiveSweepResult = { archived: archivedRows.length };
  // R8.3: every background job says what it did.
  deps.log.info({ ...result, event: "orgs.archive_sweep.finished" }, "gym archive sweep finished");
  return result;
}
