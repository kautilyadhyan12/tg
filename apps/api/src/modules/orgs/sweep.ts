// THE WAITING ROOM'S CLOCK — step 3 of the join door (Kd ruling :11385,
// numbers ratified 2026-08-20).
//
// Two things happen here, in this order, and the order is the ruling:
//   1. CHASE  — a pending application the gym has not been chased about, and
//               is now old enough, gets `gym_notified_at` stamped; one already
//               stamped gets re-stamped a week later.
//   2. EXPIRE — a pending application past its own `expires_at` becomes
//               `expired` — but ONLY if the gym was chased about it, and only
//               if that chase is old enough to have been actionable.
//
// **THE ORDERING RULE IS THE LOAD-BEARING PART AND IT IS ENFORCED TWICE.** Kd:
// "an application may NEVER expire before the gym has been told at least once,
// or the feature becomes 'we quietly threw your members away'." Once in the
// SEQUENCE (chase before expire, same run) and once in the expiry statement's
// own WHERE. The WHERE is the one that matters: a sequence is a fact about this
// function, and a WHERE is a fact about the data whoever calls it next. If this
// worker never runs, nothing expires — the safe direction, and the only
// direction a missing clock should fail in.
//
// **THE ENFORCING CONDITION IS `gym_notified_at <= now - EXPIRY_NOTICE_DAYS`,
// and naming the WRONG one here has now been a review finding three rounds
// running (T3 rounds 2, 3 and 4).** This header used to name
// `gym_notified_at IS NOT NULL` as the guard that matters. It is not: an
// unflagged row has a NULL `gym_notified_at`, so the notice comparison is NULL
// for it and filters it out by itself. **Measured by the round-4 reviewer:
// delete the IS NOT NULL and the sweep suite still passes 18/18.** It stays in
// the statement as an explicit restatement of the rule — it costs nothing and
// says out loud what the comparison implies — but it is not the enforcement,
// and this file will not claim otherwise again.
//
// **AND A CHASE IN THE SAME RUN MUST NOT LICENCE THE EXPIRY.** Enforcing only
// "was it ever chased" has a hole with the shape this repo keeps finding: if
// the worker is down for the whole fortnight, run 1 would stamp the chase and
// then immediately expire everything it just stamped — the gym "told" and given
// zero seconds to act, which is the exact outcome the rule exists to forbid,
// arrived at through the rule's own letter. So the expiry asks whether the flag
// went up IN TIME, not merely whether it went up. Both arms of that, and the
// asymmetry between the first chase and the weekly one, are explained at the
// statements themselves — they are the two places somebody editing this will
// actually be looking.
//
// This file holds the logic and OWNS NO SCHEDULE: `worker.ts` is the shell that
// runs it daily, and `tools/orgs-sweep.ts` runs it by hand. Same shape as
// `modules/privacy/purge.ts`, for the same reason — the tests drive it against
// a real Postgres with no queue anywhere near them.
//
// IDEMPOTENT BY CONSTRUCTION (R3.5). Every statement is set-based and its WHERE
// excludes the state it produces, so a second run in the same second changes
// nothing and a retried job is free.
import type { Sql } from "postgres";
import { insertAudit } from "./repo.js";

/** How long a pending application sits before the gym is chased the first
 *  time. Ratified by Kd 2026-08-20 (:11385's default, put to him and kept). */
export const GYM_REMINDER_FIRST_DAYS = 2;

/** And how often after that. ":11385 — reminded at 2 days, then weekly." */
export const GYM_REMINDER_REPEAT_DAYS = 7;

/** **THE MINIMUM NOTICE AN APPLICATION MUST HAVE HAD BEFORE IT MAY DIE.** Not a
 *  fallback for one edge case — it is the promise, and both arms of the expiry
 *  guard are measured against it.
 *
 *  **T3 round 1 C/H-1 is why that sentence is worded that way.** This constant
 *  used to apply to the late-flagged case ALONE, while the ordinary arm asked
 *  only whether the flag went up BEFORE the deadline — a yes/no, satisfied by a
 *  flag raised one minute before it. Measured by the reviewer against real
 *  Postgres on a fixture the product itself produces: **a gym given 31 minutes'
 *  notice and the request deleted**, in exactly the worker-outage case the
 *  second arm was written for. The rule's own wording produced the outcome the
 *  rule forbids, for the second time on this card.
 *
 *  It is the same NUMBER as the first-chase threshold and a DIFFERENT RULE, so
 *  it is a different constant: this one answers "how much notice is notice?"
 *  and that one answers "when do we start chasing?". Collapsing them into one
 *  name is how a later edit to one silently moves the other. */
export const EXPIRY_NOTICE_DAYS = 2;

export interface SweepDeps {
  sql: Sql;
  log: { info: (obj: object, msg: string) => void };
  /** Injected so the atomicity of "expire + record why" is testable, following
   *  `purge.ts`'s `purgeOne` precedent. Production passes nothing. */
  insertAudit?: typeof insertAudit;
}

export interface SweepOptions {
  /** Injected clock (R6.4's billing doctrine, applied to the other place in
   *  this codebase where a timeline decides whether something is destroyed).
   *  A fortnight is not a thing a test can wait for, and it is not a thing Kd
   *  can wait for during a smoke either — `tools/orgs-sweep.ts` passes this so
   *  he can watch an application expire in a browser in three minutes. */
  now?: Date;
  /** Bound the run to named gyms. Omitted = the whole table, which is what the
   *  nightly job wants and what production always passes.
   *
   *  **It exists because a sweep is TABLE-WIDE by nature and its own tests are
   *  not** (T3 round 1, Low-4). `vitest` runs suites four at a time against one
   *  database, so an unbounded `sweepAt(TTL * 3)` in a test expires every
   *  pending application in it — including the ones `orgs.routes.test.ts` is
   *  midway through confirming, whose tap would then answer 409. That is a flake
   *  generator this card introduced, and the fixtures being namespaced does not
   *  help when the SWEEP is not. Scoping the tests also makes their counts
   *  EXACT rather than "at least one", which closes the same round's
   *  table-wide-assertion finding. */
  gymIds?: readonly string[];
}

export interface SweepResult {
  /** Applications chased for the first time this run. */
  remindedFirst: number;
  /** Applications chased again (the weekly repeat). */
  remindedAgain: number;
  /** Applications that died. */
  expired: number;
  /** Pending applications PAST their deadline that were left alone, because
   *  the gym has not been chased about them or was chased too recently.
   *
   *  Reported rather than hidden, and it is NOT computed from a second copy of
   *  the expiry's WHERE — it is (everything due) minus (everything expired),
   *  both measured in this run. A hand-written copy of the condition it is
   *  meant to describe is precisely the guard :12227 caught testing a duplicate
   *  of the thing it guarded. A number that stays high across runs means the
   *  chase step is not doing its job, which is worth being able to see. */
  heldForNotice: number;
}

interface Row {
  id: string;
  gym_id: string;
}

export async function sweepJoinApplications(
  deps: SweepDeps,
  opts: SweepOptions = {},
): Promise<SweepResult> {
  const now = opts.now ?? new Date();
  const writeAudit = deps.insertAudit ?? insertAudit;

  // The scope, composed ONCE and interpolated into all four statements, so a
  // bounded run cannot be bounded in three places and unbounded in the fourth.
  // `null` means the whole table: `gym_id = ANY(NULL)` is NULL rather than
  // false, which would filter every row out, so the IS NULL test comes first
  // — :12227's L-2 exactly, and the reason it is written once here instead of
  // four times below.
  const scope = opts.gymIds ?? null;
  const inScope = deps.sql`(${scope}::uuid[] IS NULL OR gym_id = ANY(${scope}::uuid[]))`;

  // ── 1. CHASE ──────────────────────────────────────────────────────────────
  // Two statements rather than one with a CASE, because they answer different
  // questions and a single UPDATE ... RETURNING hands back the NEW timestamp
  // with no way left to tell a first chase from a repeat. Counting them apart
  // is what makes "the gym was told at least once" checkable at a glance rather
  // than inferred.
  const firstChase = await deps.sql<Row[]>`
    UPDATE gym_join_applications
    SET gym_notified_at = ${now}
    WHERE status = 'pending'
      AND ${inScope}
      AND gym_notified_at IS NULL
      AND applied_at <= ${now}::timestamptz - (${GYM_REMINDER_FIRST_DAYS} * INTERVAL '1 day')
    RETURNING id, gym_id`;

  // **THE REPEAT SKIPS ANYTHING ALREADY PAST ITS DEADLINE, and the FIRST CHASE
  // ABOVE DELIBERATELY DOES NOT.** The asymmetry is the ordering rule and its
  // cost, in two lines:
  //   · A never-flagged application MUST be flagged even when it is overdue —
  //     that is the whole rule ("told at least once"), and skipping it here
  //     would mean an application nobody was ever told about could never die.
  //   · Re-flagging one that is due to be deleted THIS RUN is noise, and it is
  //     worse than noise: the stamp would move to `now`, which is by definition
  //     after the deadline, and the expiry guard below would then push the
  //     deletion back. A weekly reminder that quietly extends the wait it is
  //     reminding about is a mechanism working against itself.
  const repeatChase = await deps.sql<Row[]>`
    UPDATE gym_join_applications
    SET gym_notified_at = ${now}
    WHERE status = 'pending'
      AND ${inScope}
      AND gym_notified_at IS NOT NULL
      AND expires_at > ${now}
      AND gym_notified_at <= ${now}::timestamptz - (${GYM_REMINDER_REPEAT_DAYS} * INTERVAL '1 day')
    RETURNING id, gym_id`;

  // Counted BEFORE the expiry, because afterwards the rows it describes are no
  // longer pending and the number could never be recovered. The chase step
  // above touches neither `status` nor `expires_at`, so this reading is stable
  // across it.
  const dueRows = await deps.sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gym_join_applications
    WHERE status = 'pending' AND ${inScope} AND expires_at <= ${now}`;
  const due = dueRows[0]?.n ?? 0;

  // ── 2. EXPIRE ─────────────────────────────────────────────────────────────
  // `decided_at` is deliberately LEFT NULL. Nobody decided — that is the whole
  // meaning of an expiry — and `listApplicationsForUser` already reads
  // `coalesce(decided_at, expires_at)` for exactly this row, so stamping a
  // decision here would make that coalesce dead code AND record a decision that
  // was never made. `decided_by_user_id` stays null for the same reason.
  //
  // No entitlement cache bust: a pending application grants nothing (that IS
  // Kd's :11072 ruling), so nothing about this person's plan changed. Busting
  // here would read, to the next person maintaining this, as though it had.
  // **THE GUARD IN PLAIN WORDS, AND IT IS ONE CONDITION: the gym must have been
  // flagged at least `EXPIRY_NOTICE_DAYS` AGO.** Not "flagged before the
  // deadline" — that is a yes/no, and the promise is a duration. Measuring back
  // from `now` makes it true whatever the deadline was and however long the
  // worker had been down.
  //
  // **T3 ROUND 1 C/H-1: ARM 1 USED TO READ `gym_notified_at <= expires_at`, AND
  // THAT IS A YES/NO WHERE THE PROMISE IS A DURATION.** A flag raised one minute
  // before the deadline satisfied it, so the very next run deleted the request —
  // measured against real Postgres at **31 minutes' notice**, on a fixture the
  // product itself produces (never chased, worker back up just before day 14;
  // a BullMQ retry is the second run). The card had closed the "flag lands AFTER
  // the deadline" hole and left "flag lands just BEFORE it" wide open — the same
  // rule producing the same forbidden outcome through its other half.
  //
  // **T3 ROUND 2 Low-1 THEN DELETED THE FIRST ARM, and the reasoning is worth
  // keeping.** Round 1's fix left an OR: `notified <= expires_at - notice` OR
  // `notified <= now - notice`. Given the `expires_at <= now` clause that is
  // always present, `expires_at - notice <= now - notice` — so the FIRST arm
  // implies the second and could never decide anything; what survives above is
  // the SECOND. (Round 3 Low-1: this paragraph said "second", contradicting its
  // own next sentence and the code three lines below it.) **Proven twice: the
  // reviewer deleted it and the suite stayed 18/18 green, and an exhaustive
  // sweep over the three dates finds no case where arm 1 holds and arm 2 does
  // not.** By then three documents recorded that the arm "must not be deleted",
  // which was true of round 1's version and false of round 1's own fix — a
  // claim about coverage that would have misled the next editor. Deleted, and
  // corrected wherever it was written.
  //
  // **THE COST, ACCEPTED AND STATED: a late-chased row dies up to
  // `EXPIRY_NOTICE_DAYS` AFTER its 14-day mark rather than on it.** That is the
  // direction :11385 picks — being late is recoverable, deleting someone's
  // request without warning the gym is not.
  // **THE EXPIRY AND ITS AUDIT ROWS ARE ONE TRANSACTION — T3 round 1 C/H-2.**
  // They used to be two: the UPDATE ran on the pool (autocommit) and the audit
  // inserts followed in a `begin` of their own. Every other mutation in this
  // module writes its audit row inside the same `tx` as the change, and this one
  // was the exception with no reason to be.
  //
  // **What that cost, concretely: the trail is unrecoverable.** If the audit
  // write failed — a statement timeout or a deadlock on a large batch, and this
  // sweep has no batch limit (its own `OWED.md` line) — or the worker died
  // between the two, the rows are already `expired`, so the retry matches
  // nothing (`status = 'pending'` is gone) and NO audit row is ever written for
  // them. The comment below promises this row answers "where did our applicant
  // go" weeks later; after that window it could not, and nothing could repair
  // it. Now a failed audit rolls the expiry back with it and the retry redoes
  // both (R3.5 — the statement is idempotent, so a redo is free).
  //
  // Part 3 §3.3: every mutating call writes `audit_log`. An expiry is the one
  // mutation in this module with NO ACTOR — nobody chose it — so the actor is
  // null rather than a stand-in, and `via` names the machine that did it.
  const expiredRows = await deps.sql.begin(async (tx) => {
    const rows = await tx<Row[]>`
      UPDATE gym_join_applications
      SET status = 'expired'
      WHERE status = 'pending'
        AND ${inScope}
        AND expires_at <= ${now}
        AND gym_notified_at IS NOT NULL
        AND gym_notified_at <= ${now}::timestamptz - (${EXPIRY_NOTICE_DAYS} * INTERVAL '1 day')
      RETURNING id, gym_id`;
    for (const row of rows) {
      await writeAudit(tx, {
        actorUserId: null,
        gymId: row.gym_id,
        action: "org.join_expired",
        targetType: "gym_join_application",
        targetId: row.id,
        meta: { via: "expiry_sweep" },
      });
    }
    return rows;
  });

  const result: SweepResult = {
    remindedFirst: firstChase.length,
    remindedAgain: repeatChase.length,
    expired: expiredRows.length,
    heldForNotice: due - expiredRows.length,
  };
  // R8.3: every background job says what it did.
  deps.log.info({ ...result, event: "orgs.sweep.finished" }, "join-application sweep finished");
  return result;
}
