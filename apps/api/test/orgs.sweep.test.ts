// THE WAITING ROOM'S CLOCK — the sweep and the member's nudge, against REAL
// Postgres (R9.2). DATABASE_URL-gated.
//
// TWO THINGS THIS FILE DOES DELIBERATELY:
//
//   1. **THE CLOCK IS MOVED, NEVER THE ROWS** (except in one test that says so
//      in its own name). Every threshold here is measured in days, and the
//      obvious way to test that is to back-date `applied_at` — which tests a
//      row shape the product never produces. Passing `now` into the sweep is
//      the SAME path `tools/orgs-sweep.ts` uses during the smoke, so what these
//      assertions exercise is the code an operator will actually run.
//
//   2. **THE ORDERING RULE GETS TWO TESTS, because it is enforced in two
//      places** (:11385: "an application may NEVER expire before the gym has
//      been told at least once"). One drives the natural timeline and proves
//      the SEQUENCE — a chase in the same run must not licence the expiry. The
//      other builds a row by hand that the timeline cannot produce, purely to
//      pin the expiry statement's own WHERE. Deleting either guard leaves the
//      other test green, which is why there are two.
//
//   3. **EVERY SWEEP IS SCOPED TO ITS OWN GYM.** The suite's `sweep-t-` /
//      `sweep-test` namespace bounds its FIXTURES and does nothing whatever
//      about the SWEEP, which is table-wide by nature — the header here used to
//      claim otherwise and was wrong (T3 round 1, Low-4). Unscoped, a
//      `sweep(TTL * 3)` expires every pending application in the database,
//      including the ones `orgs.routes.test.ts` is midway through confirming,
//      and `vitest.config.ts` runs four suites at once against one database.
//      `waitingGym()` therefore hands back a `sweep` bound to the gym it just
//      built, and the exact counts these tests assert are a consequence of
//      that.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import * as orgRepo from "../src/modules/orgs/repo.js";
import {
  EXPIRY_NOTICE_DAYS,
  GYM_REMINDER_FIRST_DAYS,
  GYM_REMINDER_REPEAT_DAYS,
  sweepJoinApplications,
} from "../src/modules/orgs/sweep.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "sweep-test-secret-0123456789abcdef", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Vitest's default is 5 s and these tests do not fit in it, for a reason that
 *  is about the FIXTURE and not the subject: every scenario here needs a whole
 *  waiting gym — two registrations (bcrypt cost 10 apiece), two logins, a gym
 *  and an application — and the database is in another country. The
 *  cross-tenant test builds two of them.
 *
 *  Raised HERE rather than in `vitest.config.ts` (R1.1): a global bump would
 *  quietly grant the same slack to every other suite, including ones where
 *  taking 30 s IS the defect. :5857 rule 4a's local-Postgres recommendation is
 *  the real fix and it is not this card's. */
const TEST_TIMEOUT_MS = 30_000;

/** `it` with that budget. Named so a failure still reads as a normal test and
 *  the `-t` filters every mutation harness in this repo uses keep working. */
const test = (name: string, fn: () => Promise<void>): void => {
  it(name, fn, TEST_TIMEOUT_MS);
};

/** The sweep logs; nothing here asserts on it. Typed to the same shape the
 *  function declares, so a widened dependency fails to compile rather than
 *  being silently satisfied by an empty object. */
const log = {
  info: () => {
    /* the sweep reports what it did; nothing here asserts on it */
  },
};

let ipCounter = 0;
const nextIp = () =>
  `10.7.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

interface CreatedOrg {
  org: { id: string; name: string };
  joinCode: { code: string; label: string };
}

d("join-application sweep + nudge (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  type Account = { userId: string; cookies: Record<string, string> };
  let sharedOwner: Account | undefined;
  const owner = (): Account => {
    if (sharedOwner === undefined) throw new Error("beforeAll did not make the owner");
    return sharedOwner;
  };

  /** **THE MEMBER IS POOLED AND ROTATED, and the number is the join route's own
   *  rate limit rather than a taste.**
   *
   *  Making two accounts per test was the expensive thing that pushed the
   *  three-suite run over its budgets. Making ONE and sharing it everywhere
   *  then broke differently and more interestingly: `POST /v1/orgs/join` allows
   *  **10 applications per hour per ACCOUNT** (`routes.ts`, deliberate — "a real
   *  person applies to their gym ONCE"), so the eleventh test got a 429 and nine
   *  tests failed at once.
   *
   *  So the pool retires an account before it reaches that cap. Eight leaves
   *  room for the extra apply a test may do of its own, and the whole suite
   *  costs three accounts instead of thirty-six. **The limit is production
   *  behaviour and the test bends to it — raising or bypassing it here would be
   *  testing a route the product does not have.** */
  const APPLIES_PER_MEMBER = 8;
  let pooledMember: Account | undefined;
  let pooledApplies = 0;
  const memberForApply = async (): Promise<Account> => {
    if (pooledMember === undefined || pooledApplies >= APPLIES_PER_MEMBER) {
      pooledMember = await makeUser();
      pooledApplies = 0;
    }
    pooledApplies += 1;
    return pooledMember;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE slug LIKE 'sweep-test%'
         OR owner_user_id IN (SELECT id FROM users WHERE email LIKE 'sweep-t-%@example.com')`;
    // Same order and the same reason as the sibling suite: an application
    // points at the membership a confirm created and the FK has no cascade, so
    // a stray row blocks the user DELETE with a 23503 that names nothing
    // useful (:10726 Low-2).
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'sweep-t-%@example.com'`;
  };

  /** **THE HOOKS CARRY THEIR OWN BUDGET, AND THE DEFAULT 10 s IS WHY.**
   *  `cleanup()` is five DELETEs against a database in another country, and
   *  when three DB-backed suites run at once (`vitest.config.ts` allows four
   *  threads) it does not fit. Measured: this hook timed out at 10,000 ms in a
   *  three-suite run while passing in seconds on its own.
   *
   *  Raised HERE and not globally (R1.1): a global bump grants the same slack
   *  to hooks where taking 30 s IS the defect. */
  const HOOK_TIMEOUT_MS = 60_000;

  beforeAll(async () => {
    await cleanup();
    app = await buildApp(loadConfig(baseEnv));
    // **THE OWNER IS MADE ONCE, NOT PER TEST — and this is the real fix for the
    // three-suite run, not the timeout above.** Each test still gets its OWN
    // GYM and its own application, which is what its isolation actually rests
    // on (the sweep is scoped by gym id); what it does not need is fresh
    // accounts every time, and those were the expensive part — bcrypt
    // registrations plus logins, eighteen times over, against a remote
    // database. Adding this suite is what pushed two of `orgs.routes`' own
    // 30-second tests over their budget, so the honest fix is to stop spending
    // what the tests never needed.
    //
    // Safe because one owner may own many gyms, and a membership is per GYM.
    // The APPLICANT is pooled rather than shared outright — see
    // `memberForApply`, where the join route's own rate limit sets the number.
    sharedOwner = await makeUser();
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end();
  }, HOOK_TIMEOUT_MS);

  const post = (path: string, payload: unknown, cookies: Record<string, string> = {}) =>
    api().inject({
      method: "POST",
      url: path,
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      cookies,
      payload: JSON.stringify(payload),
    });

  const get = (path: string, cookies: Record<string, string> = {}) =>
    api().inject({ method: "GET", url: path, remoteAddress: nextIp(), cookies });

  let userSeq = 0;
  const makeUser = async () => {
    const local = `u${String(userSeq++)}-${String(Date.now() % 100000)}`;
    const email = `sweep-t-${local}@example.com`;
    const reg = await api().inject({
      method: "POST",
      url: "/v1/auth/register",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email, password: PASSWORD, displayName: `Sweep ${local}` }),
    });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await api().inject({
      method: "POST",
      url: "/v1/auth/login",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };

  let orgSeq = 0;
  const makeOrg = async (cookies: Record<string, string>): Promise<CreatedOrg> => {
    const res = await post(
      "/v1/orgs",
      {
        name: `Sweep Test ${String(orgSeq++)} ${String(Date.now() % 100000)}`,
        city: "Jorhat",
        country: "IN",
        timezone: "Asia/Kolkata",
      },
      cookies,
    );
    expect(res.statusCode).toBe(201);
    return JSON.parse(res.body) as CreatedOrg;
  };

  const applyWithCode = async (cookies: Record<string, string>, code: string) => {
    const res = await post("/v1/orgs/join", { code }, cookies);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { outcome: string; application: { id: string } };
    expect(body.outcome).toBe("pending");
    return body.application.id;
  };

  const readRow = async (applicationId: string) => {
    const rows = await sql<
      {
        status: string;
        decided_at: Date | null;
        decided_by_user_id: string | null;
        gym_notified_at: Date | null;
        member_nudged_at: Date | null;
      }[]
    >`
      SELECT status, decided_at, decided_by_user_id, gym_notified_at, member_nudged_at
      FROM gym_join_applications WHERE id = ${applicationId}`;
    const row = rows[0];
    if (row === undefined) throw new Error(`no application ${applicationId}`);
    return row;
  };

  /** A whole waiting gym: an owner, a stranger, and one pending application.
   *
   *  Carries its own `sweep` bound to THIS gym — see below for why every test
   *  uses it. */
  const waitingGym = async () => {
    const org = await makeOrg(owner().cookies);
    const applicant = await memberForApply();
    const applicationId = await applyWithCode(applicant.cookies, org.joinCode.code);
    const gymIds = [org.org.id];
    return {
      owner: owner(),
      org,
      member: applicant,
      applicationId,
      /** Days from now, scoped to this gym. */
      sweep: (daysFromNow: number) =>
        sweepJoinApplications(
          { sql, log },
          { now: new Date(Date.now() + daysFromNow * DAY_MS), gymIds },
        ),
      /** The same, at an explicit instant, for the sub-day cases. */
      sweepAtInstant: (at: Date) => sweepJoinApplications({ sql, log }, { now: at, gymIds }),
    };
  };

  /** **EVERY SWEEP IN THIS FILE IS SCOPED TO ITS OWN GYM — T3 round 1, Low-4.**
   *
   *  The header used to say the suite's namespace kept it out of its
   *  neighbours' way. **The FIXTURES are namespaced; the SWEEP is not.** An
   *  unbounded `sweep(TTL * 3)` chases and expires every pending application in
   *  the database, whoever made it — and `vitest.config.ts` runs four suites at
   *  once against ONE database, so this file could expire the applications
   *  `orgs.routes.test.ts` was midway through confirming, whose tap would then
   *  answer 409. That is a flake generator this card introduced; the two suites
   *  had only ever been run separately, which is why nothing had shown it.
   *
   *  Scoping also makes the counts EXACT instead of "at least one", which closes
   *  the same round's finding that a table-wide `toBeGreaterThanOrEqual(1)` is
   *  satisfiable by a row the test never created. */

  // ── THE CHASE ────────────────────────────────────────────────────────────

  test("does not chase the gym before the ratified two days, and does on them", async () => {
    const { applicationId, sweep } = await waitingGym();

    const early = await sweep(GYM_REMINDER_FIRST_DAYS - 1);
    expect(early.remindedFirst).toBe(0);
    expect((await readRow(applicationId)).gym_notified_at).toBeNull();

    // EXACTLY one, now that the run is scoped to this gym: the count is about
    // the row this test created and nothing else.
    const due = await sweep(GYM_REMINDER_FIRST_DAYS);
    expect(due.remindedFirst).toBe(1);
    expect((await readRow(applicationId)).gym_notified_at).not.toBeNull();
  });

  test("chases again a week later and not sooner", async () => {
    const { applicationId, sweep } = await waitingGym();
    await sweep(GYM_REMINDER_FIRST_DAYS);
    const firstMark = (await readRow(applicationId)).gym_notified_at;

    // One day short of the repeat, measured from the chase and not from the
    // application — which is the difference between "weekly" and "on day 9".
    const tooSoon = await sweep(GYM_REMINDER_FIRST_DAYS + GYM_REMINDER_REPEAT_DAYS - 1);
    expect(tooSoon.remindedAgain).toBe(0);
    expect((await readRow(applicationId)).gym_notified_at).toEqual(firstMark);

    const due = await sweep(GYM_REMINDER_FIRST_DAYS + GYM_REMINDER_REPEAT_DAYS);
    expect(due.remindedAgain).toBe(1);
    expect((await readRow(applicationId)).gym_notified_at).not.toEqual(firstMark);
  });

  // ── THE EXPIRY ───────────────────────────────────────────────────────────

  test("expires a chased application past its deadline, and records NO decision", async () => {
    const { applicationId, sweep } = await waitingGym();
    await sweep(GYM_REMINDER_FIRST_DAYS);

    // THE "BEFORE" CHECK SITS AT DAY 8, NOT DAY 13, AND THE REASON IS THE C/H-1
    // FIX. Sweeping on day 13 fires the WEEKLY repeat (last chase day 2, and
    // 2 <= 13 - 7), which moves the flag to day 13 — one day of notice against
    // a deadline of 14. Under the fixed guard that row correctly survives day
    // 14, so the old timeline made this test fail for a reason that had nothing
    // to do with its subject. Day 8 is the last day before the repeat is due,
    // so the flag stays at day 2 and the ORDINARY path is what is measured.
    const before = await sweep(GYM_REMINDER_FIRST_DAYS + GYM_REMINDER_REPEAT_DAYS - 1);
    expect(before.expired).toBe(0);
    expect((await readRow(applicationId)).status).toBe("pending");

    const after = await sweep(orgRepo.APPLICATION_TTL_DAYS);
    expect(after.expired).toBe(1);

    const row = await readRow(applicationId);
    expect(row.status).toBe("expired");
    // NOBODY DECIDED. `listApplicationsForUser` reads
    // `coalesce(decided_at, expires_at)` for exactly this row, so a stamped
    // `decided_at` would both make that coalesce dead code and claim a decision
    // that was never made.
    expect(row.decided_at).toBeNull();
    expect(row.decided_by_user_id).toBeNull();
  });

  test("does NOT expire in the same run that first chases the gym — the ruling's ordering rule, on the natural timeline", async () => {
    const { applicationId, sweep } = await waitingGym();

    // The worker was down for the whole fortnight: the first run it gets is
    // already past the deadline. It must chase and STOP — the gym has been
    // told, and told nothing if it is told and deleted in the same instant.
    const late = await sweep(orgRepo.APPLICATION_TTL_DAYS + 1);
    expect(late.remindedFirst).toBe(1);
    expect(late.expired).toBe(0);
    expect(late.heldForNotice).toBe(1);

    const chased = await readRow(applicationId);
    expect(chased.status).toBe("pending");
    expect(chased.gym_notified_at).not.toBeNull();

    // And it dies once that notice has actually been sitting there.
    const afterNotice = await sweep(orgRepo.APPLICATION_TTL_DAYS + 1 + EXPIRY_NOTICE_DAYS);
    expect(afterNotice.expired).toBe(1);
    expect((await readRow(applicationId)).status).toBe("expired");
  });

  test("gives the ratified TWO DAYS' notice, not 'any notice at all' — T3 round 1 C/H-1", async () => {
    // **THE DEFECT THIS PINS, in one sentence: the guard used to ask whether the
    // flag went up BEFORE the deadline, which a flag raised one minute before it
    // satisfies.** Measured by the reviewer at 31 minutes' notice on real
    // Postgres. The fixture is what a worker outage actually leaves behind — a
    // never-chased application whose deadline is nearly here — and the second
    // sweep is a nightly run, or a BullMQ retry, or an operator with the tool.
    const { applicationId, sweepAtInstant } = await waitingGym();
    const deadline = Date.now() + orgRepo.APPLICATION_TTL_DAYS * DAY_MS;

    // The worker comes back with about two hours to spare and flags it.
    const justBefore = new Date(deadline - 2 * 60 * 60 * 1000);
    const chased = await sweepAtInstant(justBefore);
    expect(chased.remindedFirst).toBe(1);
    expect(chased.expired).toBe(0);

    // The very next run is past the deadline. UNDER THE OLD GUARD THIS DELETED
    // IT — flagged before `expires_at`, therefore fair game — leaving the gym
    // with two hours' notice against a promise of two days.
    const soonAfter = await sweepAtInstant(new Date(deadline + 31 * 60 * 1000));
    expect(soonAfter.expired).toBe(0);
    expect(soonAfter.heldForNotice).toBe(1);
    expect((await readRow(applicationId)).status).toBe("pending");

    // Still held a full day later — the promise is two days, not one.
    const nextDay = await sweepAtInstant(new Date(deadline + DAY_MS));
    expect(nextDay.expired).toBe(0);
    expect((await readRow(applicationId)).status).toBe("pending");

    // And it does die once the notice is real, so the fix bought safety and not
    // paralysis. Measured from the FLAG, which is the thing being noticed.
    const noticeServed = await sweepAtInstant(
      new Date(justBefore.getTime() + EXPIRY_NOTICE_DAYS * DAY_MS),
    );
    expect(noticeServed.expired).toBe(1);
    expect((await readRow(applicationId)).status).toBe("expired");
  });

  test("a failed audit write takes the expiry down with it — T3 round 1 C/H-2", async () => {
    // **THE DEFECT: the expiry and its audit rows used to be two transactions.**
    // The UPDATE committed on the pool, the audit followed separately — so a
    // timeout, a deadlock or a dead worker between them left the rows `expired`
    // with no record of why, permanently: the retry matches nothing, because
    // `status = 'pending'` is already gone.
    //
    // Two applications, so the failure lands on the SECOND — which is what
    // proves the whole statement rolls back rather than just the row that
    // threw. Injecting the audit writer follows `purge.ts`'s `purgeOne`
    // precedent; production passes nothing.
    const a = await waitingGym();
    const b = await waitingGym();
    const gymIds = [a.org.org.id, b.org.org.id];
    const at = new Date(Date.now() + (orgRepo.APPLICATION_TTL_DAYS + 1) * DAY_MS);

    // Chase both first, so the only thing standing between them and expiry is
    // the audit write about to fail.
    await sweepJoinApplications(
      { sql, log },
      { now: new Date(Date.now() + GYM_REMINDER_FIRST_DAYS * DAY_MS), gymIds },
    );

    let calls = 0;
    await expect(
      sweepJoinApplications(
        {
          sql,
          log,
          insertAudit: async (tx, entry) => {
            calls += 1;
            if (calls === 2) throw new Error("audit write failed");
            await orgRepo.insertAudit(tx, entry);
          },
        },
        { now: at, gymIds },
      ),
    ).rejects.toThrow("audit write failed");

    // NEITHER survived as expired. Before the fix the first row would be
    // `expired` with no audit row and no way back.
    expect((await readRow(a.applicationId)).status).toBe("pending");
    expect((await readRow(b.applicationId)).status).toBe("pending");

    // And the retry — which is what BullMQ does — completes both halves.
    const retry = await sweepJoinApplications({ sql, log }, { now: at, gymIds });
    expect(retry.expired).toBe(2);
    const audits = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM audit_log
      WHERE action = 'org.join_expired'
        AND target_id IN (${a.applicationId}, ${b.applicationId})`;
    expect(audits[0]?.n).toBe(2);
  });

  test("does NOT expire an unchased application — the expiry statement's own guard, pinned separately", async () => {
    const { applicationId, sweepAtInstant } = await waitingGym();

    // A ROW THE TIMELINE CANNOT PRODUCE, ON PURPOSE. `expires_at` is always
    // `applied_at + 14 days`, so a fresh application with a past deadline does
    // not occur in the product — and that is exactly why this fixture is built
    // by hand. The sequence test above cannot fail if only the WHERE is
    // deleted (the chase happens first either way); this one cannot fail if
    // only the sequence is reordered. Two guards, two tests.
    await sql`
      UPDATE gym_join_applications
      SET expires_at = now() - INTERVAL '1 day', gym_notified_at = NULL
      WHERE id = ${applicationId}`;

    const result = await sweepAtInstant(new Date());
    expect(result.expired).toBe(0);
    expect(result.heldForNotice).toBe(1);
    expect((await readRow(applicationId)).status).toBe("pending");
  });

  test("runs twice with no further effect", async () => {
    const { applicationId, sweep, sweepAtInstant } = await waitingGym();
    await sweep(GYM_REMINDER_FIRST_DAYS);
    const at = new Date(Date.now() + orgRepo.APPLICATION_TTL_DAYS * DAY_MS);

    const first = await sweepAtInstant(at);
    expect(first.expired).toBe(1);
    const settled = await readRow(applicationId);

    // R3.5: a retried job must be free. Every statement's WHERE excludes the
    // state it produces, so the second run has nothing left to find.
    const second = await sweepAtInstant(at);
    expect(second.expired).toBe(0);
    expect(second.remindedFirst).toBe(0);
    expect(await readRow(applicationId)).toEqual(settled);
  });

  test("writes an audit row for the expiry with NO actor", async () => {
    const { org, applicationId, sweep } = await waitingGym();
    await sweep(GYM_REMINDER_FIRST_DAYS);
    await sweep(orgRepo.APPLICATION_TTL_DAYS);

    const rows = await sql<{ actor_user_id: string | null; meta: Record<string, string> }[]>`
      SELECT actor_user_id, meta FROM audit_log
      WHERE gym_id = ${org.org.id}
        AND action = 'org.join_expired'
        AND target_id = ${applicationId}`;
    expect(rows).toHaveLength(1);
    // Nobody chose this. A stand-in user id would be the more convenient lie.
    expect(rows[0]?.actor_user_id).toBeNull();
    expect(rows[0]?.meta).toEqual({ via: "expiry_sweep" });
  });

  test("leaves a REJECTED application alone — even one the gym was already chased about", async () => {
    // **THE CHASE FIRST IS THE WHOLE POINT OF THIS TEST AND IT WAS MISSING.**
    // The first version rejected a FRESH application and swept, and mutant O51
    // — the expiry dropping its `status = 'pending'` filter — SURVIVED it. A
    // never-chased row is excluded by `gym_notified_at IS NOT NULL` whatever
    // its status, so the guarantee this test names was being carried by a
    // DIFFERENT guard and the pending filter could have been deleted outright.
    //
    // Chasing first removes that shelter: the row now satisfies every other
    // clause in the expiry, so `status = 'pending'` is the only thing standing
    // between it and being rewritten. :5104 F5's shape — a protection that
    // cannot fail is the same defect with a comment on it.
    const { owner, org, member, sweep } = await waitingGym();
    const rejectedId = await sql<{ id: string }[]>`
      SELECT id FROM gym_join_applications
      WHERE gym_id = ${org.org.id} AND user_id = ${member.userId}`.then((r) => r[0]?.id ?? "");

    await sweep(GYM_REMINDER_FIRST_DAYS);
    expect((await readRow(rejectedId)).gym_notified_at).not.toBeNull();

    const reject = await post(
      `/v1/orgs/${org.org.id}/applications/${rejectedId}/reject`,
      {},
      owner.cookies,
    );
    expect(reject.statusCode).toBe(200);

    // Far past every threshold: a decided row is not the sweep's business at
    // any distance, and "rejected" must never quietly become "expired".
    await sweep(orgRepo.APPLICATION_TTL_DAYS * 3);
    expect((await readRow(rejectedId)).status).toBe("rejected");
  });

  test("leaves a CONFIRMED application alone — a member standing in the gym is not expired by a machine", async () => {
    // The sharper half of the same guarantee, and the one with a user-visible
    // consequence. A confirmed application keeps its own `expires_at`, so with
    // the pending filter gone the sweep would rewrite it as `expired` on day 14
    // while the person is a MEMBER — the audit trail then says a machine threw
    // out somebody who is training there.
    //
    // It also breaks a live reader: `listApplicationsForUser` withholds a stale
    // refusal only when a LATER application for that gym reached `confirmed`
    // (:12518 C/H-1). Flip that row to `expired` and the refusal comes back —
    // the app telling a member the gym never confirmed them, which is the exact
    // sentence that finding existed to remove.
    const { owner, org, applicationId, sweep } = await waitingGym();

    await sweep(GYM_REMINDER_FIRST_DAYS);
    const confirm = await post(
      `/v1/orgs/${org.org.id}/applications/${applicationId}/confirm`,
      {},
      owner.cookies,
    );
    expect(confirm.statusCode).toBe(200);

    await sweep(orgRepo.APPLICATION_TTL_DAYS * 3);
    expect((await readRow(applicationId)).status).toBe("confirmed");
  });

  test("tells the member their request expired, on the screen's own endpoint", async () => {
    const { member, applicationId, sweep } = await waitingGym();
    await sweep(GYM_REMINDER_FIRST_DAYS);
    await sweep(orgRepo.APPLICATION_TTL_DAYS);

    // END TO END, and it is the point of the whole card: the `expired` arm of
    // the dashboard card has existed since step 2 and NOTHING could reach it.
    const res = await get("/v1/orgs/applications/mine", member.cookies);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { applications: { id: string; status: string }[] };
    expect(body.applications.find((a) => a.id === applicationId)?.status).toBe("expired");
  });

  // ── THE MEMBER'S NUDGE ───────────────────────────────────────────────────

  test("sends a nudge and says when the next one is allowed", async () => {
    const { member, applicationId } = await waitingGym();

    const res = await post(`/v1/orgs/applications/${applicationId}/nudge`, {}, member.cookies);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      status: string;
      nudgedAt: string;
      nextNudgeAt: string;
    };
    expect(body.status).toBe("sent");
    // The server sends the time so the screen never computes one (:1110's
    // habit). A day apart, to the minute.
    expect(new Date(body.nextNudgeAt).getTime() - new Date(body.nudgedAt).getTime()).toBe(DAY_MS);
    expect((await readRow(applicationId)).member_nudged_at).not.toBeNull();
  });

  test("refuses a second nudge the same day and reports the FIRST one's time", async () => {
    const { member, applicationId } = await waitingGym();
    const first = await post(`/v1/orgs/applications/${applicationId}/nudge`, {}, member.cookies);
    const firstBody = JSON.parse(first.body) as { nudgedAt: string };
    const stamped = (await readRow(applicationId)).member_nudged_at;

    const second = await post(`/v1/orgs/applications/${applicationId}/nudge`, {}, member.cookies);
    expect(second.statusCode).toBe(200);
    const body = JSON.parse(second.body) as { status: string; nudgedAt: string };
    expect(body.status).toBe("already_sent");
    // The time it reports is the one that HAPPENED. Echoing "now" here would
    // tell somebody they had just reminded the gym when they had not.
    expect(body.nudgedAt).toBe(firstBody.nudgedAt);
    expect((await readRow(applicationId)).member_nudged_at).toEqual(stamped);
  });

  test("allows the next nudge once a day has passed", async () => {
    const { member, applicationId } = await waitingGym();
    await post(`/v1/orgs/applications/${applicationId}/nudge`, {}, member.cookies);

    // The rule is enforced against the DATABASE's clock inside the same
    // statement that writes it, so the only way to move time here is to move
    // the stored mark. Stated rather than glossed: this is the one place the
    // suite ages a row instead of the clock.
    await sql`
      UPDATE gym_join_applications
      SET member_nudged_at = now() - INTERVAL '25 hours'
      WHERE id = ${applicationId}`;

    const again = await post(`/v1/orgs/applications/${applicationId}/nudge`, {}, member.cookies);
    expect((JSON.parse(again.body) as { status: string }).status).toBe("sent");
  });

  test("does not let a stranger nudge somebody else's application", async () => {
    // TWO REAL APPLICATIONS BY TWO REAL PEOPLE, not one (:10182 C/H-3 — a
    // cross-tenant test that builds one tenant can pass on unrelated rows
    // already in a shared database).
    //
    // **THIS IS THE ONE TEST THAT MAKES ITS OWN ACCOUNT, and it must.** Every
    // other test here shares one member, because a membership is per gym and
    // sharing costs nothing — but a test about one person not reaching another
    // person's row is meaningless if both people are the same person. It would
    // pass on `user_id` matching, proving the opposite of its name.
    const mine = await waitingGym();
    const stranger = await makeUser();
    const theirGym = await makeOrg(owner().cookies);
    await applyWithCode(stranger.cookies, theirGym.joinCode.code);

    const res = await post(
      `/v1/orgs/applications/${mine.applicationId}/nudge`,
      {},
      stranger.cookies,
    );
    // 404 and not 403: somebody else's application must be indistinguishable
    // from one that never existed, or the id becomes an enumeration oracle.
    expect(res.statusCode).toBe(404);
    expect((await readRow(mine.applicationId)).member_nudged_at).toBeNull();
  });

  test("refuses a nudge once the person is already a member", async () => {
    const { owner, org, member, applicationId } = await waitingGym();
    const confirm = await post(
      `/v1/orgs/${org.org.id}/applications/${applicationId}/confirm`,
      {},
      owner.cookies,
    );
    expect(confirm.statusCode).toBe(200);

    const res = await post(`/v1/orgs/applications/${applicationId}/nudge`, {}, member.cookies);
    expect(res.statusCode).toBe(409);
    expect((await readRow(applicationId)).member_nudged_at).toBeNull();
  });

  // ── WHAT THE FRONT DESK SEES ─────────────────────────────────────────────

  test("shows the chase and the nudge on the console's queue", async () => {
    const { owner, org, member, applicationId, sweep } = await waitingGym();

    const before = await get(`/v1/orgs/${org.org.id}/applications`, owner.cookies);
    const beforeRow = (
      JSON.parse(before.body) as { items: { id: string; gymNotifiedAt: string | null; nudgedAt: string | null }[] }
    ).items.find((i) => i.id === applicationId);
    expect(beforeRow).toBeDefined();
    expect(beforeRow?.gymNotifiedAt).toBeNull();
    expect(beforeRow?.nudgedAt).toBeNull();

    await post(`/v1/orgs/applications/${applicationId}/nudge`, {}, member.cookies);
    await sweep(GYM_REMINDER_FIRST_DAYS);

    const after = await get(`/v1/orgs/${org.org.id}/applications`, owner.cookies);
    const afterRow = (
      JSON.parse(after.body) as { items: { id: string; gymNotifiedAt: string | null; nudgedAt: string | null }[] }
    ).items.find((i) => i.id === applicationId);
    // **`toBeDefined` FIRST, and it is not decoration — T3 round 1, rule 4.**
    // `find` returns undefined when the row has left the queue entirely, and
    // `expect(undefined).not.toBeNull()` PASSES. So the two assertions below
    // caught a field being dropped and would have said nothing at all about the
    // row vanishing, which is the larger failure of the two.
    expect(afterRow).toBeDefined();
    // The mark the owner sees IS the column the expiry statement reads. Two
    // separate facts here would be two facts that can disagree.
    expect(afterRow?.gymNotifiedAt).not.toBeNull();
    expect(afterRow?.nudgedAt).not.toBeNull();
  });
});
