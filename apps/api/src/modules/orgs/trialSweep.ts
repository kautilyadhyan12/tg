// TRIALS ACTUALLY END — step 1 of Kd's four-step order (ruling 2026-08-28,
// DECISIONS :22215 §5). Until this file existed, `subscriptions` had exactly ONE
// writer in the whole product (the INSERT in `startGymTrial`) and no `UPDATE`
// anywhere, so a gym tapped "start free trial", thirty days passed, and NOTHING
// NOTICED: `'trialing'` is in `getCandidates`' granting set, so every member of
// that gym kept gym-tier entitlements, free, for ever.
//
// **WHAT THIS DOES, IN ONE SENTENCE:** a gym subscription still marked
// `trialing` whose `trial_ends_at` has passed becomes `expired`, and an audit
// row records that a machine did it.
//
// **WHAT IT DELIBERATELY DOES NOT DO, because each is somebody else's card:**
//
//   · **It does not touch `active` or `past_due`.** That is dunning and expiry
//     for gyms that have actually paid — Part 5 §8, phase P3.8 — and R1.1
//     forbids pulling it forward. This statement's `status = 'trialing'` is what
//     keeps a paying gym's subscription out of reach of a job written for trials.
//
//   · **It does not touch `owner_type = 'user'`.** The consumer trial (:16548)
//     is unbuilt and nothing inserts a user subscription today, so this filter
//     is inert either way — but R6.2 puts every consumer subscription
//     transition through Part 5 §3's single pure machine, and a second writer
//     invented here would be exactly the deviation that rule exists to stop.
//     Its own `OWED.md` line, so the class is visible rather than silently
//     re-created the day consumer trials ship.
//
//   · **It does not make the lapsed gym's console read-only.** That is the other
//     half of :22215 §5's step 1 and touches every console screen; it is its own
//     card and its own `OWED.md` line. What ships here is the half that closes
//     the money hole — the members' grant.
//
// **THE MEMBERS NEED NO CODE AND THAT IS THE RULING WORKING.** Kd chose arm A
// (*"The member did nothing wrong"*): a lapsed gym's members fall back to the
// FREE app rather than being locked out. `entitlements/repo.ts:23-25` joins
// `subscriptions` on `status IN ('trialing','active','past_due')`, so the moment
// the row leaves that set the gym contributes no candidate and the member
// resolves to `free` — 5 meal scans a day back to 2, keeping every workout they
// ever did. Nothing is deleted and nobody is signed out.
//
// **NO ENTITLEMENT CACHE BUST, STATED SO NOBODY READS IT AS AN OVERSIGHT.**
// `getEntitlements` caches per user for 60 s (`entitlements/service.ts:17`,
// `CACHE_TTL_S = 60`), so a member of a gym that lapsed at 04:00 holds the old
// answer for at most one minute — which is the bound R6.5 asks for, met by the
// TTL alone. Busting instead would mean this file loading every live member of
// every expiring gym and reaching for Redis, and `startGymTrial` sets the
// precedent in the opposite direction: it busts the ACTOR only, so a gym's
// existing members already ride the same 60 s window when a trial STARTS.
//
// **NO `lockOrgRow`, and the requirement it might look like it dodges does not
// cover this.** :19656 C/H-3 binds whatever CREATES a gym subscription (so that
// `updateOrg`'s currency guard cannot be raced by a trial appearing between its
// SELECT and its UPDATE). This statement only ENDS one, and every order of the
// two lands in the same place: `startGymTrial` refuses a second trial on
// `trial_ends_at IS NOT NULL` REGARDLESS of status (`repo.ts:1218-1225`), and
// the partial unique index `subs_one_live_uq` refuses a second live row anyway.
// A set-based sweep cannot take a per-gym lock without becoming a per-gym loop,
// and `sweep.ts` — this file's sibling on the same worker — sets that precedent.
//
// This file holds the logic and OWNS NO SCHEDULE: `worker.ts` runs it nightly
// and `tools/trial-sweep.ts` runs it by hand, the same shape as `sweep.ts` and
// `modules/privacy/purge.ts` and for the same reason — the tests drive it
// against real Postgres with no queue anywhere near them.
//
// IDEMPOTENT BY CONSTRUCTION (R3.5). The statement is set-based and its WHERE
// excludes the state it produces, so a second run in the same second changes
// nothing and a retried job is free.
import type { Sql } from "postgres";
import { insertAudit } from "./repo.js";

export interface TrialSweepDeps {
  sql: Sql;
  log: { info: (obj: object, msg: string) => void };
  /** Injected so the atomicity of "expire + record why" is testable, following
   *  `sweep.ts`'s and `purge.ts`'s precedent. Production passes nothing. */
  insertAudit?: typeof insertAudit;
}

export interface TrialSweepOptions {
  /** Injected clock — R6.4's billing doctrine, and this is billing code.
   *
   *  A thirty-day trial is not a thing a test can wait for, and it is not a
   *  thing Kd can wait for during a smoke either: `tools/trial-sweep.ts` passes
   *  this so he can watch a trial end in his browser in three minutes. */
  now?: Date;
  /** Bound the run to named gyms. Omitted = the whole table, which is what the
   *  nightly job wants and what production always passes.
   *
   *  **It exists because a sweep is TABLE-WIDE by nature and its own tests are
   *  not** — `sweep.ts`'s T3 round 1 Low-4, applied before it could be found
   *  here a second time. `vitest` runs suites four at a time against ONE
   *  database and `orgs.routes.test.ts` keeps live trialing gyms of its own
   *  (its "members get the gym plan the moment the trial starts" test asserts
   *  on one). An unscoped sweep at a future `now` from this suite would expire
   *  every one of them mid-assertion. Scoping also makes these tests' counts
   *  EXACT rather than "at least one". */
  gymIds?: readonly string[];
}

export interface TrialSweepResult {
  /** Gym trials that ended this run. */
  expired: number;
}

interface Row {
  id: string;
  owner_id: string;
}

export async function expireLapsedGymTrials(
  deps: TrialSweepDeps,
  opts: TrialSweepOptions = {},
): Promise<TrialSweepResult> {
  const now = opts.now ?? new Date();
  const writeAudit = deps.insertAudit ?? insertAudit;

  // `null` means the whole table: `owner_id = ANY(NULL)` is NULL rather than
  // false, which would filter every row out, so the IS NULL test comes first —
  // :12227's L-2, and `sweep.ts`'s `inScope` verbatim in shape.
  const scope = opts.gymIds ?? null;

  // **THE EXPIRY AND ITS AUDIT ROWS ARE ONE TRANSACTION.** `sweep.ts` shipped
  // these as two and it was a Critical/High (:13075 C/H-2): the UPDATE ran on
  // the pool and the audit inserts followed in a `begin` of their own, so a
  // timeout or a dead worker between them left rows already moved that the
  // retry could never match (`status = 'trialing'` gone) with no audit row ever
  // written for them. Built that way here from the first commit rather than
  // learned again.
  //
  // **`trial_ends_at IS NOT NULL` IS NOT THE ENFORCEMENT AND THIS FILE WILL NOT
  // CLAIM IT IS** — `sweep.ts`'s header made exactly that claim about its own
  // twin and was wrong for three review rounds. A row with a NULL end date has
  // a NULL comparison on the line below and is filtered out by that alone. It
  // stays as an explicit restatement of what a trial IS: costs nothing, says
  // the rule out loud, decides nothing.
  const expiredRows = await deps.sql.begin(async (tx) => {
    const rows = await tx<Row[]>`
      UPDATE subscriptions
      SET status = 'expired'
      WHERE owner_type = 'gym'
        AND status = 'trialing'
        AND (${scope}::uuid[] IS NULL OR owner_id = ANY(${scope}::uuid[]))
        AND trial_ends_at IS NOT NULL
        AND trial_ends_at <= ${now}
      RETURNING id, owner_id`;
    // Part 3 §3.3: every mutating call writes `audit_log`. Like the join
    // expiry, this is a mutation with NO ACTOR — nobody chose it — so the actor
    // is null rather than a stand-in, and `via` names the machine that did it.
    // It is also the only record that will ever explain to a gym owner why
    // their console changed overnight.
    for (const row of rows) {
      await writeAudit(tx, {
        actorUserId: null,
        gymId: row.owner_id,
        action: "org.trial_expired",
        targetType: "subscription",
        targetId: row.id,
        meta: { via: "trial_expiry_sweep" },
      });
    }
    return rows;
  });

  const result: TrialSweepResult = { expired: expiredRows.length };
  // R8.3: every background job says what it did.
  deps.log.info({ ...result, event: "orgs.trial_sweep.finished" }, "gym trial expiry finished");
  return result;
}
