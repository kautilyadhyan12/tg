// TRIALS ACTUALLY END — the sweep behind Kd's ruling :22215 step 1, against
// REAL Postgres (R9.2). DATABASE_URL-gated.
//
// FOUR THINGS THIS FILE DOES DELIBERATELY:
//
//   1. **THE CLOCK IS MOVED, NEVER THE ROWS.** The threshold is thirty days and
//      the obvious way to test that is to back-date `trial_ends_at` — which
//      tests a row shape the product never produces. Passing `now` into the
//      sweep is the SAME path `tools/trial-sweep.ts` uses during the smoke, so
//      what these assertions exercise is the code an operator will run.
//
//   2. **EVERY SWEEP IS SCOPED TO ITS OWN GYM.** The `trialsweep-t-` namespace
//      bounds the FIXTURES and does nothing whatever about the SWEEP, which is
//      table-wide by nature. `vitest.config.ts` runs four suites at once against
//      one database, and `orgs.routes.test.ts` keeps live trialing gyms of its
//      own — an unscoped sweep at a future `now` from here would end every one
//      of them mid-assertion. That is `sweep.ts`'s T3 round 1 Low-4, applied
//      before it could be found here a second time.
//
//   3. **ONE TEST GOES THROUGH THE REAL `POST /trial` ROUTE AND THE REST INSERT
//      DIRECTLY.** :18652's C/H-1 is the reason for the first — a suite whose
//      every subject is a hand-made row proves the mechanism and says nothing
//      about the product. The one-trial-per-OWNER gate (`repo.ts:1218-1225`) is
//      the reason for the rest: driving nine trials through the route would cost
//      nine bcrypt registrations, and the rows would be identical to the ones
//      inserted here against the same seeded plan.
//
//   4. **BOTH DIRECTIONS, EVERY TIME.** A sweep that expires everything passes
//      any test that only checks something expired (:7104's PG1). Every guard
//      here has a partner asserting what must NOT move.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { getCandidates } from "../src/modules/entitlements/repo.js";
import { expireLapsedGymTrials } from "../src/modules/orgs/trialSweep.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "trialsweep-test-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The seeded INR band-1 plan — the row `startGymTrial` itself picks for a gym
 *  whose country resolves to INR (lowest `seat_cap`, active, monthly,
 *  `trial_days > 0`). Named rather than derived so a direct INSERT here lands a
 *  gym on a plan a real gym is actually on (:18652 C/H-1); the code shape is
 *  `seed.ts:202`'s. */
const INR_BAND_1 = "org_b1_in_m";

/** Vitest's default 5 s does not cover a registration (bcrypt cost 10), a login
 *  and a gym against a database that may be in another country. Raised HERE and
 *  not in `vitest.config.ts` (R1.1): a global bump grants the same slack to
 *  suites where taking 30 s IS the defect. */
const TEST_TIMEOUT_MS = 30_000;
const HOOK_TIMEOUT_MS = 60_000;

const test = (name: string, fn: () => Promise<void>): void => {
  it(name, fn, TEST_TIMEOUT_MS);
};

/** The sweep logs; nothing here asserts on it. Typed to the shape the function
 *  declares, so a widened dependency fails to compile rather than being
 *  silently satisfied by an empty object. */
const log = {
  info: () => {
    /* the sweep reports what it did; nothing here asserts on it */
  },
};

let ipCounter = 0;
const nextIp = () =>
  `10.9.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

interface CreatedOrg {
  org: { id: string; name: string };
  joinCode: { code: string; label: string };
}

d("gym trial expiry sweep (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  type Account = { userId: string; cookies: Record<string, string> };

  /** Shared by every test that does NOT drive `POST /trial`. Safe because one
   *  owner may own many gyms and the subscription rows are inserted directly;
   *  the route-driven test makes its own owner, because the one-trial-per-owner
   *  gate would refuse a second. */
  let sharedOwner: Account | undefined;
  const owner = (): Account => {
    if (sharedOwner === undefined) throw new Error("beforeAll did not make the owner");
    return sharedOwner;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'trialsweep-t-%@example.com')`;
    // Same order and the same reason as the sibling suite: the FKs have no
    // cascade, so a stray child row blocks the parent DELETE with a 23503 that
    // names nothing useful (:10726 Low-2). Subscriptions come out before gyms
    // and after nothing — `subscriptions.owner_id` carries no FK (it is
    // polymorphic over user/gym), so ordering matters only for the rest.
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'trialsweep-t-%@example.com'`;
  };

  beforeAll(async () => {
    await cleanup();
    app = await buildApp(loadConfig(baseEnv));
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

  let userSeq = 0;
  const makeUser = async (): Promise<Account> => {
    const local = `u${String(userSeq++)}-${String(Date.now() % 100000)}`;
    const email = `trialsweep-t-${local}@example.com`;
    const reg = await api().inject({
      method: "POST",
      url: "/v1/auth/register",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email, password: PASSWORD, displayName: `Trial ${local}` }),
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
        name: `Trial Sweep ${String(orgSeq++)} ${String(Date.now() % 100000)}`,
        city: "Austin",
        country: "IN",
        timezone: "Asia/Kolkata",
      },
      cookies,
    );
    expect(res.statusCode).toBe(201);
    return JSON.parse(res.body) as CreatedOrg;
  };

  /** A subscription row on a REAL seeded plan, in whatever state the test needs.
   *  `trialEndsAt` is passed as an absolute instant so the row looks exactly
   *  like one `startGymTrial` wrote `days` ago. */
  const putSubscription = async (
    gymId: string,
    status: string,
    trialEndsAt: Date | null,
  ): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, trial_ends_at, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${INR_BAND_1}),
              ${status}, ${trialEndsAt}, 'none')
      RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error(`could not seed a ${status} subscription`);
    return id;
  };

  const readStatus = async (gymId: string): Promise<string | undefined> => {
    const rows = await sql<{ status: string }[]>`
      SELECT status FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId}`;
    return rows[0]?.status;
  };

  /** The sweep, always bound to the gyms the calling test built. See note 2. */
  const sweepAt = async (at: Date, gymIds: readonly string[]) =>
    await expireLapsedGymTrials({ sql, log }, { now: at, gymIds });

  // ── THE PRODUCT PATH ────────────────────────────────────────────────────────

  /** THE END-TO-END: a real owner taps the real button, the real thirty days
   *  pass, and the trial is over.
   *
   *  This is the only test here that starts its trial through `POST /trial`, and
   *  it is the one that would notice if the route and this sweep ever disagreed
   *  about what a trial row looks like — a hand-inserted fixture cannot
   *  (:18652 C/H-1). It needs its own owner: one free trial per owner, ever. */
  test("a real trial, started through the button, is over thirty days later", async () => {
    const trialOwner = await makeUser();
    const org = await makeOrg(trialOwner.cookies);

    const started = await post(`/v1/orgs/${org.org.id}/trial`, {}, trialOwner.cookies);
    expect(started.statusCode).toBe(200);
    expect(await readStatus(org.org.id)).toBe("trialing");

    const endedAt = new Date(Date.now() + 31 * DAY_MS);
    const result = await sweepAt(endedAt, [org.org.id]);

    expect(result.expired).toBe(1);
    expect(await readStatus(org.org.id)).toBe("expired");

    // **AND THE MOMENT IT ENDED IS WRITTEN DOWN** — migration `0016`, and the
    // start of the four-month archive clock Kd ruled on 2026-08-31. Asserted as
    // an EXACT instant, not merely "not null": the stamp must be the run's own
    // injected clock and not `now()`, or `tools/trial-sweep.ts --now` would end a
    // trial at one instant and date it at another, and the archive sweep it
    // feeds would then be four months out during every smoke.
    const stamped = await sql<{ ended_at: Date | null }[]>`
      SELECT ended_at FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${org.org.id}`;
    expect(stamped[0]?.ended_at?.getTime()).toBe(endedAt.getTime());
  });

  /** THE OTHER DIRECTION, and it is not optional: a sweep that ends every trial
   *  it can see passes the test above perfectly. Same shape, same route, the
   *  clock moved ONE day instead of thirty-one. */
  test("a trial still inside its thirty days is left alone", async () => {
    const trialOwner = await makeUser();
    const org = await makeOrg(trialOwner.cookies);

    expect((await post(`/v1/orgs/${org.org.id}/trial`, {}, trialOwner.cookies)).statusCode).toBe(
      200,
    );

    const result = await sweepAt(new Date(Date.now() + DAY_MS), [org.org.id]);

    expect(result.expired).toBe(0);
    expect(await readStatus(org.org.id)).toBe("trialing");
  });

  // ── THE PROMISE THE RULING IS ABOUT ─────────────────────────────────────────

  /** **KD'S ARM A, MEASURED: the members of a lapsed gym drop to the free app.**
   *
   *  Read through `getCandidates` — the resolver's database half — rather than
   *  through `/v1/entitlements/me`, ON PURPOSE. The route answers out of a
   *  60-second Redis cache (`entitlements/service.ts:17`), and the sweep
   *  deliberately does not bust it, so a route read moments after a sweep would
   *  be asserting on the cache rather than on the sweep. This is the same
   *  function the route calls on a miss, and it is where the gym's grant either
   *  exists or does not.
   *
   *  The owner is the member: `createOrg` writes the owner's own complimentary
   *  `gym_members` row (`repo.ts:298`, Part 3 §4.0 step 6), so no join door is
   *  needed. **The BEFORE reading is load-bearing** — without it the assertion
   *  passes on a gym that never granted anything and proves nothing. */
  test("a lapsed gym's members lose the gym grant and fall back to free", async () => {
    const memberOwner = await makeUser();
    const org = await makeOrg(memberOwner.cookies);
    await putSubscription(org.org.id, "trialing", new Date(Date.now() - DAY_MS));

    const before = await getCandidates(sql, memberOwner.userId);
    expect(before, "the trialing gym should be granting its owner-member").toHaveLength(1);
    expect(before[0]?.memberEntitlements).not.toBeNull();

    await sweepAt(new Date(), [org.org.id]);

    const after = await getCandidates(sql, memberOwner.userId);
    expect(after, "an expired gym contributes no candidate — the member is on free").toHaveLength(
      0,
    );
  });

  /** Part 3 §3.3: every mutating call writes `audit_log`. This is the only
   *  record that will ever explain to an owner why their console changed
   *  overnight, and the actor is NULL because nobody chose it — the first
   *  billing mutation in the product with no human behind it. */
  test("the expiry records who did it, and it was nobody", async () => {
    const org = await makeOrg(owner().cookies);
    const subId = await putSubscription(org.org.id, "trialing", new Date(Date.now() - DAY_MS));

    await sweepAt(new Date(), [org.org.id]);

    const rows = await sql<
      {
        action: string;
        actor_user_id: string | null;
        target_id: string | null;
        meta: Record<string, unknown>;
      }[]
    >`
      SELECT action, actor_user_id, target_id, meta FROM audit_log
      WHERE gym_id = ${org.org.id} AND action = 'org.trial_expired'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor_user_id).toBeNull();
    expect(rows[0]?.target_id).toBe(subId);
    expect(rows[0]?.meta["via"]).toBe("trial_expiry_sweep");
  });

  // ── THE BOUNDARIES OF WHAT THIS JOB MAY TOUCH ───────────────────────────────

  /** **A GYM THAT HAS ACTUALLY PAID IS NOT THIS JOB'S BUSINESS.** Dunning and
   *  paid-plan expiry are Part 5 §8 / P3.8 and R1.1 forbids pulling them
   *  forward. Without the `status = 'trialing'` filter this sweep would cancel a
   *  paying gym the moment its old trial date passed — which every gym that
   *  converts from a trial will have. Driven on both live paid statuses. */
  test("a gym that pays is never touched, whatever its old trial date says", async () => {
    const activeOrg = await makeOrg(owner().cookies);
    const duePastOrg = await makeOrg(owner().cookies);
    const longAgo = new Date(Date.now() - 90 * DAY_MS);
    await putSubscription(activeOrg.org.id, "active", longAgo);
    await putSubscription(duePastOrg.org.id, "past_due", longAgo);

    const result = await sweepAt(new Date(), [activeOrg.org.id, duePastOrg.org.id]);

    expect(result.expired).toBe(0);
    expect(await readStatus(activeOrg.org.id)).toBe("active");
    expect(await readStatus(duePastOrg.org.id)).toBe("past_due");
  });

  /** A subscription with no end date is not a trial that has ended — it is a
   *  row nothing has promised anything about. The comparison in the statement
   *  already filters it (NULL is not `<=` anything), and this pins that so a
   *  future `coalesce(trial_ends_at, …)` cannot quietly start reaping them.
   *
   *  **IT PINS NULL-HANDLING AND NOTHING ELSE, AND THIS DOCSTRING CLAIMED MORE
   *  FOR A COMMIT (T3 round 1, L-4).** It said the test also stopped `<=`
   *  becoming `>=`. **Measured by the reviewer and reproduced here: flip the
   *  comparison and this test stays GREEN while seven of the other eight go
   *  red** — because a NULL row is excluded by a NULL comparison in EITHER
   *  direction, so the mutation has no observable subject in this fixture.
   *  **The DIRECTION is O141's guarantee, and the two arms above own it**
   *  ("thirty days later" / "still inside its thirty days"). A test's docstring
   *  is a claim about coverage and takes the same evidence as the code it
   *  describes (:19960's shape — three sentences claiming more than their guards
   *  delivered, in one commit). */
  test("a subscription with no end date is left alone", async () => {
    const org = await makeOrg(owner().cookies);
    await putSubscription(org.org.id, "trialing", null);

    const result = await sweepAt(new Date(Date.now() + 365 * DAY_MS), [org.org.id]);

    expect(result.expired).toBe(0);
    expect(await readStatus(org.org.id)).toBe("trialing");
  });

  /** THE SCOPE PREDICATE IS REAL, and this is the test that says so. Two gyms,
   *  both lapsed, one named — the unnamed one must survive. Without this, an
   *  `inScope` that silently matched everything would pass every other test in
   *  the file while ending every trial in the database. */
  test("a scoped run ends only the gyms it was given", async () => {
    const named = await makeOrg(owner().cookies);
    const bystander = await makeOrg(owner().cookies);
    const lapsed = new Date(Date.now() - DAY_MS);
    await putSubscription(named.org.id, "trialing", lapsed);
    await putSubscription(bystander.org.id, "trialing", lapsed);

    const result = await sweepAt(new Date(), [named.org.id]);

    expect(result.expired).toBe(1);
    expect(await readStatus(named.org.id)).toBe("expired");
    expect(await readStatus(bystander.org.id), "an unnamed gym keeps its trial").toBe("trialing");
  });

  /** R3.5: the WHERE excludes the state it produces, so a BullMQ retry is free.
   *  Asserted on the COUNT and not only on the row, because "expired twice" and
   *  "expired once" leave the same row and a duplicate audit trail. */
  test("running it twice ends nothing a second time", async () => {
    const org = await makeOrg(owner().cookies);
    await putSubscription(org.org.id, "trialing", new Date(Date.now() - DAY_MS));

    expect((await sweepAt(new Date(), [org.org.id])).expired).toBe(1);
    expect((await sweepAt(new Date(), [org.org.id])).expired).toBe(0);

    const audits = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM audit_log
      WHERE gym_id = ${org.org.id} AND action = 'org.trial_expired'`;
    expect(audits[0]?.n).toBe(1);
  });

  /** **THE EXPIRY AND ITS AUDIT ROW ARE ONE TRANSACTION.** `sweep.ts` shipped
   *  its twin as two and it was a Critical/High (:13075 C/H-2): a failure
   *  between them leaves the row already moved, so the retry matches nothing and
   *  NO audit row is ever written for it — an unrecoverable hole in the trail.
   *
   *  Driven by injecting an audit writer that throws, which is `purge.ts`'s
   *  `purgeOne` precedent. If the two were ever split again, the subscription
   *  below would read `expired` with no audit row and this test would say so. */
  test("a failed audit write rolls the expiry back with it", async () => {
    const org = await makeOrg(owner().cookies);
    await putSubscription(org.org.id, "trialing", new Date(Date.now() - DAY_MS));

    await expect(
      expireLapsedGymTrials(
        {
          sql,
          log,
          insertAudit: () => {
            throw new Error("audit writer is down");
          },
        },
        { now: new Date(), gymIds: [org.org.id] },
      ),
    ).rejects.toThrow("audit writer is down");

    expect(await readStatus(org.org.id), "the expiry must not survive its own audit").toBe(
      "trialing",
    );
    const audits = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM audit_log
      WHERE gym_id = ${org.org.id} AND action = 'org.trial_expired'`;
    expect(audits[0]?.n).toBe(0);
  });
});
