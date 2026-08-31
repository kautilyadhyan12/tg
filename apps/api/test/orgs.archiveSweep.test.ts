// A GYM WITH NO PLAN IS CLOSED FOUR MONTHS LATER — Kd's ruling of 2026-08-31,
// against REAL Postgres (R9.2). DATABASE_URL-gated.
//
// FIVE THINGS THIS FILE DOES DELIBERATELY:
//
//   1. **THE CLOCK IS MOVED, NEVER THE ROWS.** The window is four months and the
//      obvious way to test it is to back-date `ended_at` — which tests a row
//      shape the product never produces. Passing `now` into the sweep is the
//      SAME path `tools/archive-sweep.ts` uses during the smoke, so what these
//      assertions exercise is the code an operator will run.
//
//   2. **EVERY SWEEP IS SCOPED TO ITS OWN GYMS, WITH ONE DELIBERATE
//      EXCEPTION.** The `archsweep-t-` namespace bounds the FIXTURES and does
//      nothing whatever about the SWEEP, which is table-wide by nature.
//      `vitest.config.ts` runs four suites at once against one database and
//      other suites keep gyms of their own — an unscoped run at a future `now`
//      from here would close every gym in the database that has ever lapsed.
//      `sweep.ts`'s T3 round 1 Low-4, inherited twice now.
//
//      **THE EXCEPTION IS THE ONE TEST THAT DRIVES PRODUCTION'S OWN
//      CONFIGURATION** — no `gymIds`, because that is what `worker.ts` passes —
//      and it is safe because its clock runs BACKWARDS. At the year 2000 the
//      only row inside the window is the one that test just wrote; every
//      `ended_at` any suite or the seed can produce is years later. Added at T3
//      round 1 (2026-08-31): until then nothing proved the unscoped branch
//      selects anything at all, so the nightly job could have become a silent
//      no-op with every test here still green.
//
//   3. **ONE TEST WALKS THE WHOLE PRODUCT PATH** — a real owner taps the real
//      trial button, the real trial sweep ends it, and the archive sweep closes
//      the gym four months after that. :18652's C/H-1 is the reason: a suite
//      whose every subject is a hand-made row proves the mechanism and says
//      nothing about the product. It is also the only test that proves the two
//      sweeps COMPOSE — that what `trialSweep.ts` stamps is what this reads.
//
//   4. **BOTH DIRECTIONS, EVERY TIME.** A sweep that closes everything passes
//      any test that only checks something closed (:7104's PG1). Every guard here
//      has a partner asserting what must NOT move.
//
//   5. **THE NUMBER ITSELF IS PINNED ON FIXED DATES.** "Four months from now" is
//      calendar arithmetic that JavaScript and Postgres round differently at the
//      ends of months, so the boundary test uses 15 January and 15 May — a span
//      both agree on — and asserts one minute either side of it. That is what
//      goes red if anybody edits the four.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { archiveLapsedGyms } from "../src/modules/orgs/archiveSweep.js";
import { restoreGym } from "../src/modules/orgs/repo.js";
import { expireLapsedGymTrials } from "../src/modules/orgs/trialSweep.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "archsweep-test-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The seeded INR band-1 plan — the row `startGymTrial` itself picks for a gym
 *  whose country resolves to INR. Named rather than derived so a direct INSERT
 *  lands a gym on a plan a real gym is actually on (:18652 C/H-1);
 *  `orgs.trialSweep.test.ts` uses the same one for the same reason. */
const INR_BAND_1 = "org_b1_in_m";

const TEST_TIMEOUT_MS = 30_000;
const HOOK_TIMEOUT_MS = 60_000;

const test = (name: string, fn: () => Promise<void>): void => {
  it(name, fn, TEST_TIMEOUT_MS);
};

/** Calendar months, the way both the statement and a person mean them. NOT
 *  `n * 30 * DAY_MS`: the sweep measures with INTERVAL '1 month', and a test
 *  that measured something else would drift in and out of agreement with it
 *  depending on the month it ran in — a suite that goes red in February is a
 *  suite nobody trusts. */
const addMonths = (base: Date, months: number): Date => {
  const out = new Date(base.getTime());
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
};

const log = {
  info: () => {
    /* the sweep reports what it did; nothing here asserts on it */
  },
};

let ipCounter = 0;
const nextIp = () =>
  `10.11.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

interface CreatedOrg {
  org: { id: string; name: string };
  joinCode: { code: string; label: string };
}

d("gym archive sweep (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  type Account = { userId: string; cookies: Record<string, string> };

  /** Shared by every test that does NOT drive `POST /trial`. One owner may own
   *  many gyms and the subscription rows are inserted directly; the
   *  route-driven test makes its own owner, because the one-trial-per-owner gate
   *  would refuse a second. */
  let sharedOwner: Account | undefined;
  const owner = (): Account => {
    if (sharedOwner === undefined) throw new Error("beforeAll did not make the owner");
    return sharedOwner;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'archsweep-t-%@example.com')`;
    // Same order and the same reason as the sibling suites: the FKs have no
    // cascade, so a stray child row blocks the parent DELETE with a 23503 that
    // names nothing useful (:10726 Low-2).
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'archsweep-t-%@example.com'`;
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
    const email = `archsweep-t-${local}@example.com`;
    const reg = await api().inject({
      method: "POST",
      url: "/v1/auth/register",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email, password: PASSWORD, displayName: `Arch ${local}` }),
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
        name: `Arch Sweep ${String(orgSeq++)} ${String(Date.now() % 100000)}`,
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
   *  `endedAt` is the stamp `trialSweep.ts` writes when it moves a row out of
   *  §4.1's live set — passing `null` is the shape of every row that expired
   *  before migration `0016`. */
  const putSubscription = async (
    gymId: string,
    status: string,
    endedAt: Date | null,
  ): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, trial_ends_at,
                                 ended_at, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${INR_BAND_1}),
              ${status}, ${endedAt}, ${endedAt}, 'none')
      RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error(`could not seed a ${status} subscription`);
    return id;
  };

  const readGym = async (gymId: string): Promise<{ status: string; archived: Date | null }> => {
    const rows = await sql<{ status: string; archived_at: Date | null }[]>`
      SELECT status, archived_at FROM gyms WHERE id = ${gymId}`;
    const row = rows[0];
    if (row === undefined) throw new Error("the fixture gym vanished");
    return { status: row.status, archived: row.archived_at };
  };

  /** The sweep, always bound to the gyms the calling test built. See note 2. */
  const sweepAt = async (at: Date, gymIds: readonly string[]) =>
    await archiveLapsedGyms({ sql, log }, { now: at, gymIds });

  // ── THE PRODUCT PATH ────────────────────────────────────────────────────────

  /** THE END-TO-END, AND THE ONLY TEST THAT PROVES THE TWO SWEEPS COMPOSE: a
   *  real owner taps the real trial button, the real trial sweep ends the trial,
   *  and four months after THAT this sweep closes the gym.
   *
   *  Nothing else here would notice if `trialSweep.ts` stopped stamping
   *  `ended_at` — every other fixture writes the stamp by hand. This one reads
   *  only what the product wrote. */
  test("a real gym, whose real trial ended, is closed four months later", async () => {
    const trialOwner = await makeUser();
    const org = await makeOrg(trialOwner.cookies);
    const started = await post(`/v1/orgs/${org.org.id}/trial`, {}, trialOwner.cookies);
    expect(started.statusCode).toBe(200);

    // The trial ends the way the 04:00 job ends it, at a named instant.
    const trialEnded = new Date(Date.now() + 31 * DAY_MS);
    expect((await expireLapsedGymTrials({ sql, log }, { now: trialEnded, gymIds: [org.org.id] })).expired).toBe(1);

    // The stamp is the product's, not the fixture's — asserted, because it is
    // the whole hinge between the two jobs.
    const stamped = await sql<{ ended_at: Date | null }[]>`
      SELECT ended_at FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${org.org.id}`;
    expect(stamped[0]?.ended_at?.getTime(), "the trial sweep stamps when it ended").toBe(
      trialEnded.getTime(),
    );

    const at = new Date(addMonths(trialEnded, 4).getTime() + DAY_MS);
    const result = await sweepAt(at, [org.org.id]);

    expect(result.archived).toBe(1);
    const gym = await readGym(org.org.id);
    expect(gym.status).toBe("archived");
    // THE INSTANT, NOT MERELY A VALUE. This read `.not.toBeNull()` under a
    // message claiming the stamp says WHEN, and T3 round 1 measured what that
    // was worth: replacing `archived_at = ${now}` with `now()` left the whole
    // suite green. The same diff had already upgraded the trial sweep's stamp
    // assertion to an exact instant for exactly this reason (:5105 — a fix is
    // not pinned by the test written beside it unless that test can fail).
    // It is load-bearing now as well as honest: the re-arm condition compares
    // this column against `ended_at`, so a stamp taken from the wall clock
    // instead of the run's would re-arm gyms nobody swept.
    expect(gym.archived?.getTime(), "the closure stamps the instant it happened").toBe(
      at.getTime(),
    );
  });

  /** THE OTHER DIRECTION, and it is not optional: a sweep that closes every gym
   *  it can see passes the test above perfectly. Same path, three months instead
   *  of five. */
  test("a gym whose plan ended three months ago keeps its console", async () => {
    const org = await makeOrg(owner().cookies);
    const ended = new Date();
    await putSubscription(org.org.id, "expired", ended);

    const result = await sweepAt(addMonths(ended, 3), [org.org.id]);

    expect(result.archived).toBe(0);
    expect((await readGym(org.org.id)).status).toBe("active");
  });

  /** **THE FOUR MONTHS ITSELF, ON DATES BOTH CALENDARS AGREE ABOUT.** 15 January
   *  plus four months is 15 May in Postgres and in JavaScript alike, so this
   *  pins the NUMBER rather than the arithmetic: one minute short closes
   *  nothing, one second past closes the gym.
   *
   *  It is the test that goes red in BOTH directions if anybody edits
   *  `ARCHIVE_AFTER_MONTHS` — three months would close the gym on the first
   *  assertion, five would leave it open on the second. Kd ruled the four
   *  (2026-08-31) and :22215 §6 requires that it not be moved without asking. */
  test("the window is four months, to the minute", async () => {
    const org = await makeOrg(owner().cookies);
    const ended = new Date("2026-01-15T00:00:00Z");
    await putSubscription(org.org.id, "expired", ended);

    const short = await sweepAt(new Date("2026-05-14T23:59:00Z"), [org.org.id]);
    expect(short.archived, "one minute short of four months closes nothing").toBe(0);
    expect((await readGym(org.org.id)).status).toBe("active");

    const past = await sweepAt(new Date("2026-05-15T00:00:01Z"), [org.org.id]);
    expect(past.archived, "one second past four months closes it").toBe(1);
    expect((await readGym(org.org.id)).status).toBe("archived");
  });

  // ── THE BOUNDARIES OF WHAT THIS JOB MAY TOUCH ───────────────────────────────

  /** **A GYM THAT IS PAYING IS NEVER CLOSED, WHATEVER ITS OLD DATES SAY** — the
   *  live-plan condition, and the reason it is load-bearing rather than
   *  decoration. Every gym that converts from a trial carries an `ended_at` from
   *  that trial for ever; without the condition this sweep would close a paying
   *  customer four months after their trial, which is the worst thing in this
   *  card's blast radius. Driven on both live paid statuses and on `trialing`. */
  test("a gym that is on a plan is never closed, whatever its old dates say", async () => {
    const longAgo = new Date(Date.now() - 400 * DAY_MS);
    const gyms: string[] = [];
    for (const status of ["trialing", "active", "past_due"]) {
      const org = await makeOrg(owner().cookies);
      // The old trial that ended long ago…
      await putSubscription(org.org.id, "expired", longAgo);
      // …and the plan they are on now.
      await putSubscription(org.org.id, status, null);
      gyms.push(org.org.id);
    }

    const result = await sweepAt(new Date(), gyms);

    expect(result.archived).toBe(0);
    for (const gymId of gyms) {
      expect((await readGym(gymId)).status).toBe("active");
    }
  });

  /** **THE LATEST ENDING, NEVER ANY ENDING.** A gym that trialled long ago, paid
   *  for a while and lapsed LAST WEEK has two ended rows on file. `max()` reads
   *  the recent one; an `EXISTS ... ended_at <= threshold` would read the old one
   *  and close a gym six days after it stopped paying.
   *
   *  This is the only test that can tell those two statements apart, and the
   *  fixture is the reason: with one ended row they agree exactly. */
  test("a gym that lapsed last week is not closed for a trial that ended a year ago", async () => {
    const org = await makeOrg(owner().cookies);
    await putSubscription(org.org.id, "expired", new Date(Date.now() - 400 * DAY_MS));
    await putSubscription(org.org.id, "canceled", new Date(Date.now() - 7 * DAY_MS));

    const result = await sweepAt(new Date(), [org.org.id]);

    expect(result.archived, "the newest ending is what the four months run from").toBe(0);
    expect((await readGym(org.org.id)).status).toBe("active");
  });

  /** A GYM THAT NEVER SUBSCRIBED IS NEVER CLOSED BY THIS. No plan ever ended, so
   *  no clock ever started — the state §4.2 describes is a plan ENDING, and a
   *  gym nobody has promised anything about is a different question with its own
   *  `OWED.md` line. Left alone by the shape of the query (`max()` of no rows is
   *  NULL) rather than by a special case, and pinned here so a future
   *  `coalesce` cannot quietly start reaping them. */
  test("a gym that never subscribed is never closed", async () => {
    const org = await makeOrg(owner().cookies);

    const result = await sweepAt(new Date(Date.now() + 365 * DAY_MS), [org.org.id]);

    expect(result.archived).toBe(0);
    expect((await readGym(org.org.id)).status).toBe("active");
  });

  /** THE ROWS THAT EXPIRED BEFORE MIGRATION `0016` — an `expired` status with no
   *  stamp. There is nothing honest to backfill onto them, so they are never
   *  closed: "we do not know when this ended" must not read as "it ended at the
   *  epoch". Same NULL comparison as the test above, different cause, and both
   *  are stated because a `coalesce` would break them in different ways. */
  test("an expired plan with no stamp is left alone", async () => {
    const org = await makeOrg(owner().cookies);
    await putSubscription(org.org.id, "expired", null);

    const result = await sweepAt(new Date(Date.now() + 365 * DAY_MS), [org.org.id]);

    expect(result.archived).toBe(0);
    expect((await readGym(org.org.id)).status).toBe("active");
  });

  /** **THE SAME RULE WHEN AN OLDER ROW IS STANDING NEXT TO IT — max() SKIPS
   *  NULLS**, which is the crack the test above cannot see. A gym with a dated
   *  row from a year ago plus an undated one that ended last week reads the OLD
   *  date and is closed on the spot: O169's harm, arriving through a NULL
   *  instead of through `min`. Found by T3 round 1 (2026-08-31) as a forward
   *  risk — `trialSweep.ts` is the only writer of `ended_at` today and it always
   *  stamps — and the guard exists because "the writer always stamps" is a
   *  contract living in a comment, which is what :14493's Low-2 is about.
   *
   *  The partner assertion is the test above and the whole rest of this file: a
   *  guard that refused every gym with any undated row would pass this one and
   *  close nothing, so what makes it real is that everything else still closes. */
  test("a gym whose newest ending was never dated is left alone", async () => {
    const org = await makeOrg(owner().cookies);
    await putSubscription(org.org.id, "expired", new Date(Date.now() - 400 * DAY_MS));
    await putSubscription(org.org.id, "canceled", null);

    const result = await sweepAt(new Date(), [org.org.id]);

    expect(result.archived, "an ending nobody dated is not an ending to count from").toBe(0);
    expect((await readGym(org.org.id)).status).toBe("active");
  });

  /** THE SCOPE PREDICATE IS REAL, and this is the test that says so. Two gyms,
   *  both four months lapsed, one named — the unnamed one must survive. Without
   *  this, an `inScope` that silently matched everything would pass every other
   *  test in the file while closing every lapsed gym in the database. */
  test("a scoped run closes only the gyms it was given", async () => {
    const named = await makeOrg(owner().cookies);
    const bystander = await makeOrg(owner().cookies);
    const ended = new Date();
    await putSubscription(named.org.id, "expired", ended);
    await putSubscription(bystander.org.id, "expired", ended);

    const at = new Date(addMonths(ended, 4).getTime() + DAY_MS);
    const result = await sweepAt(at, [named.org.id]);

    expect(result.archived).toBe(1);
    expect((await readGym(named.org.id)).status).toBe("archived");
    expect((await readGym(bystander.org.id)).status, "an unnamed gym keeps its console").toBe(
      "active",
    );
  });

  /** **THE CONFIGURATION PRODUCTION ACTUALLY RUNS, WHICH EVERY OTHER TEST HERE
   *  AVOIDS.** `worker.ts` calls `archiveLapsedGyms({ sql, log })` with no
   *  `gymIds` at all; every other test in this file goes through `sweepAt`,
   *  which always passes some. So until T3 round 1 (2026-08-31) nothing
   *  anywhere proved the unscoped branch selects a row — if
   *  `${scope}::uuid[] IS NULL` ever stopped short-circuiting, the nightly job
   *  would become a permanent silent no-op and this suite would stay green.
   *  Both sibling sweeps share the hole; this is the first test in the repo to
   *  close it.
   *
   *  **AND IT IS SAFE ON A SHARED DATABASE, WHICH IS THE ONLY REASON IT CAN
   *  EXIST — the clock runs BACKWARDS, not forwards.** Note 2 at the top of this
   *  file forbids an unscoped run at a FUTURE instant, and it is right: that
   *  closes every gym in the database that has ever lapsed, including the trial
   *  sweep's mid-assertion. At the year 2000 the threshold is February 2000, and
   *  the only row that can meet it is the one this test just wrote — every
   *  `ended_at` any suite or the seed can produce is 2025 or later. The count is
   *  asserted as "at least one" and never as a literal, because a count over a
   *  database four suites share is not a constant (:25326 §2). */
  test("the nightly job's own configuration, with no scope at all, still selects", async () => {
    const org = await makeOrg(owner().cookies);
    const ended = new Date("2000-01-01T00:00:00Z");
    await putSubscription(org.org.id, "expired", ended);

    const result = await archiveLapsedGyms(
      { sql, log },
      { now: new Date("2000-06-01T00:00:00Z") },
    );

    expect(result.archived, "an unscoped run reaches rows at all").toBeGreaterThanOrEqual(1);
    expect((await readGym(org.org.id)).status, "and this gym is one of them").toBe("archived");
  });

  // ── THE RECORD, THE RETRY, AND THE WAY BACK ─────────────────────────────────

  /** Part 3 §3.3: every mutating call writes `audit_log`. This is the only record
   *  that will ever explain to an owner why their gym closed, and the actor is
   *  NULL because nobody chose it. */
  test("closing a gym records who did it, and it was nobody", async () => {
    const org = await makeOrg(owner().cookies);
    const ended = new Date();
    await putSubscription(org.org.id, "expired", ended);

    await sweepAt(new Date(addMonths(ended, 4).getTime() + DAY_MS), [org.org.id]);

    const rows = await sql<
      {
        action: string;
        actor_user_id: string | null;
        target_id: string | null;
        meta: Record<string, unknown>;
      }[]
    >`
      SELECT action, actor_user_id, target_id, meta FROM audit_log
      WHERE gym_id = ${org.org.id} AND action = 'org.archived'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor_user_id).toBeNull();
    expect(rows[0]?.target_id).toBe(org.org.id);
    expect(rows[0]?.meta["via"]).toBe("archive_sweep");
  });

  /** R3.5: the WHERE excludes the state it produces, so a BullMQ retry is free.
   *  Asserted on the COUNT and on the audit trail, because "closed twice" and
   *  "closed once" leave the same row and a duplicate record. */
  test("running it twice closes nothing a second time", async () => {
    const org = await makeOrg(owner().cookies);
    const ended = new Date();
    await putSubscription(org.org.id, "expired", ended);
    const at = new Date(addMonths(ended, 4).getTime() + DAY_MS);

    expect((await sweepAt(at, [org.org.id])).archived).toBe(1);
    expect((await sweepAt(at, [org.org.id])).archived).toBe(0);

    const audits = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM audit_log
      WHERE gym_id = ${org.org.id} AND action = 'org.archived'`;
    expect(audits[0]?.n).toBe(1);
  });

  /** **A GYM RE-OPENED BY HAND IS NOT CLOSED AGAIN THE NEXT NIGHT**, and without
   *  the `archived_at IS NULL` condition this is exactly what would happen: the
   *  plan still ended five months ago, so the very next run would see a lapsed
   *  gym and close it straight back down. A restore that lasts one night is not
   *  a restore, and today it is the ONLY way back (nothing in this product can
   *  put a gym on a plan).
   *
   *  The second sweep runs a day LATER than the first, which is what a nightly
   *  job does. */
  test("a gym re-opened by hand is not closed again the next night", async () => {
    const org = await makeOrg(owner().cookies);
    const ended = new Date();
    await putSubscription(org.org.id, "expired", ended);
    const at = new Date(addMonths(ended, 4).getTime() + DAY_MS);

    expect((await sweepAt(at, [org.org.id])).archived).toBe(1);

    const restored = await restoreGym(sql, {
      gymId: org.org.id,
      actorUserId: null,
      via: "gym_restore_tool",
    });
    expect(restored.kind).toBe("restored");
    const reopened = await readGym(org.org.id);
    expect(reopened.status).toBe("active");
    // The INSTANT, for the reason the end-to-end test above gives: this column
    // is now compared against `ended_at` by the re-arm condition, so "some
    // date" is not what the restore has to survive with — it is this one.
    expect(
      reopened.archived?.getTime(),
      "the closure date survives the restore — it is the memory",
    ).toBe(at.getTime());

    const nextNight = await sweepAt(new Date(at.getTime() + DAY_MS), [org.org.id]);

    expect(nextNight.archived, "the machine must not undo the operator").toBe(0);
    expect((await readGym(org.org.id)).status).toBe("active");
  });

  /** **AND THE HAND ONLY OVERRULES THE MACHINE UNTIL THE GYM LAPSES AGAIN** —
   *  the other half of the condition above, added at T3 round 1 (2026-08-31)
   *  after a review measured the future this file's header promises: with
   *  `archived_at IS NULL` alone, a gym that has EVER been re-opened is outside
   *  the policy for the rest of its life. Close it, re-open it, let it take a
   *  plan that ends a month later, wait five more months — never closed again,
   *  and no test or mutant could see it.
   *
   *  It is the test the pair above cannot be: there the restore must SURVIVE,
   *  here it must EXPIRE, and only a fixture with an ending on BOTH sides of the
   *  closure can tell those two statements apart. The re-arming ending is the
   *  one the payment card writes the day it exists (:25771 §4), which is why
   *  this is not hypothetical. */
  test("a gym re-opened by hand is closed again if its NEXT plan also ends", async () => {
    const org = await makeOrg(owner().cookies);
    const firstEnded = new Date();
    await putSubscription(org.org.id, "expired", firstEnded);
    const closedAt = new Date(addMonths(firstEnded, 4).getTime() + DAY_MS);

    expect((await sweepAt(closedAt, [org.org.id])).archived).toBe(1);

    const restored = await restoreGym(sql, {
      gymId: org.org.id,
      actorUserId: null,
      via: "gym_restore_tool",
    });
    expect(restored.kind).toBe("restored");

    // A second life: a plan that starts after the re-opening and ends a month
    // later. Nothing in the product can write it yet — that is the payment
    // card's job — so it is inserted the way every other fixture here is.
    const secondEnded = new Date(closedAt.getTime() + 30 * DAY_MS);
    await putSubscription(org.org.id, "canceled", secondEnded);

    // Three months after the SECOND ending, nothing happens: the clock restarted
    // rather than continuing from wherever it was.
    expect(
      (await sweepAt(addMonths(secondEnded, 3), [org.org.id])).archived,
      "the new clock is four months long too, not what is left of an old one",
    ).toBe(0);
    expect((await readGym(org.org.id)).status).toBe("active");

    const again = new Date(addMonths(secondEnded, 4).getTime() + DAY_MS);
    expect((await sweepAt(again, [org.org.id])).archived, "and then it closes").toBe(1);
    const closedTwice = await readGym(org.org.id);
    expect(closedTwice.status).toBe("archived");
    expect(closedTwice.archived?.getTime(), "the stamp moves to the second closure").toBe(
      again.getTime(),
    );
  });

  /** THE RESTORE'S OTHER TWO ANSWERS. Neither is an error and neither is a
   *  silent success: an operator who mistypes a uuid, or re-runs the command on
   *  a gym that is already open, has to be able to tell which happened. */
  test("re-opening tells the truth about a gym that is not closed, and about one that is not there", async () => {
    const org = await makeOrg(owner().cookies);
    const open = await restoreGym(sql, {
      gymId: org.org.id,
      actorUserId: null,
      via: "gym_restore_tool",
    });
    expect(open.kind).toBe("not_archived");

    const missing = await restoreGym(sql, {
      gymId: "00000000-0000-4000-8000-000000000000",
      actorUserId: null,
      via: "gym_restore_tool",
    });
    expect(missing.kind).toBe("not_found");

    // And neither writes a record, because neither changed anything.
    const audits = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM audit_log
      WHERE gym_id = ${org.org.id} AND action = 'org.restored'`;
    expect(audits[0]?.n).toBe(0);
  });

  /** **THE CLOSURE AND ITS AUDIT ROW ARE ONE TRANSACTION.** `sweep.ts` shipped
   *  its twin as two and it was a Critical/High (:13075 C/H-2): a failure between
   *  them leaves the row already moved, so the retry matches nothing and NO audit
   *  row is ever written for it — an unrecoverable hole in the trail, and here it
   *  would be a gym closed with no record of why.
   *
   *  Driven by injecting an audit writer that throws, which is `purge.ts`'s
   *  `purgeOne` precedent and `trialSweep.ts`'s own. */
  test("a failed audit write rolls the closure back with it", async () => {
    const org = await makeOrg(owner().cookies);
    const ended = new Date();
    await putSubscription(org.org.id, "expired", ended);
    const at = new Date(addMonths(ended, 4).getTime() + DAY_MS);

    await expect(
      archiveLapsedGyms(
        {
          sql,
          log,
          insertAudit: () => {
            throw new Error("audit writer is down");
          },
        },
        { now: at, gymIds: [org.org.id] },
      ),
    ).rejects.toThrow("audit writer is down");

    expect((await readGym(org.org.id)).status, "the closure must not survive its own audit").toBe(
      "active",
    );
  });
});
