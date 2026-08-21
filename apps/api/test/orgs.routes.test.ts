// Orgs — routes + repo against REAL Postgres (R9.2). DATABASE_URL-gated.
//
// Covers: create (Part 3 §4.0 steps 1/4/6), join by code (Part 4 §4.2 —
// including the seat check, the idempotent repeat, and the ORG-ROW LOCK under
// genuine concurrency), the roster read, and the §2.2 role matrix with its
// cross-tenant denial.
//
// TWO THINGS THIS FILE DOES DELIBERATELY, because getting them wrong is how a
// suite goes vacuous here:
//   1. The concurrency tests call the repo through TWO SEPARATE postgres
//      clients. `buildApp` opens its pool with `max: 1`, so two `app.inject`
//      calls would be serialised by the CLIENT and would pass even with the
//      FOR UPDATE lock deleted — a test that cannot fail.
//      **CORRECTED (T3 round 1 L-6): that is true of the SEAT-CAP race and
//      false of the same-person race.** Measured with the lock deleted: the
//      seat-cap test goes RED (`['joined','joined']`), the same-person test
//      stays GREEN, because it is carried by the partial unique index and
//      ON CONFLICT rather than by the lock. This header and the commit message
//      both credited BOTH tests with catching a deleted lock; only one does.
//      The same-person test is kept for what it actually proves — that the
//      idempotent path holds when two transactions genuinely overlap.
//   2. The entitlement-cache proof reads /v1/entitlements/me BEFORE joining, so
//      the cache is genuinely populated with the free answer first. Without
//      that first read there is nothing to bust and the assertion is satisfied
//      by a cold cache.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { JOIN_CODE_ALPHABET } from "@app/shared";
import * as orgRepo from "../src/modules/orgs/repo.js";
// The REAL spend-attribution readers, called by the permanent guard rather
// than re-typed into it (T3 security-pass note). Three imports because R7.1
// keeps them module-local — that duplication is the reason to name all three.
import * as coachRepo from "../src/modules/coach/repo.js";
import * as geoRepo from "../src/modules/geo/repo.js";
import * as nutritionRepo from "../src/modules/nutrition/repo.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "orgs-test-secret-0123456789abcdef-32", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

const CAP1_PLAN = "zz_orgs_cap1";

type App = Awaited<ReturnType<typeof buildApp>>;

let ipCounter = 0;
const nextIp = () =>
  `10.9.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

interface CreatedOrg {
  org: {
    id: string;
    slug: string;
    name: string;
    orgType: string;
    timezone: string;
    currencyDisplay: string;
  };
  joinCode: { code: string; label: string };
}

d("orgs routes (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  // Gyms this suite made are identified by SLUG **or by OWNER**, and the owner
  // half is load-bearing since T3 L-2: the reserved-slug test has to create a
  // gym literally named "New", whose slug is `new-gym` and matches no
  // `orgs-test%` pattern. Cleaning by slug alone left that row in the shared
  // database, so the SECOND run lost the slug race, got `new-gym-24kq`, and the
  // test would have failed for a reason that had nothing to do with its
  // subject — a test that passes exactly once.
  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE slug LIKE 'orgs-test%'
         OR owner_user_id IN (SELECT id FROM users WHERE email LIKE 'orgs-t-%@example.com')`;
    // BEFORE gym_members: an application points at the membership a confirm
    // created, and the FK has no cascade. Deleted explicitly rather than left
    // to the gym cascade because the user DELETE at the end of this function
    // is what a stray row would block — :10726's Low-2, where exactly that
    // shape (`gyms.owner_user_id` with no onDelete) failed all 46 tests with a
    // 23503 that named nothing useful.
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'orgs-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${CAP1_PLAN}`;
  };

  const post = (
    path: string,
    payload: unknown,
    opts: { cookies?: Record<string, string> } = {},
  ) =>
    api().inject({
      method: "POST",
      url: path,
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      cookies: opts.cookies ?? {},
      payload: JSON.stringify(payload),
    });

  const get = (path: string, opts: { cookies?: Record<string, string> } = {}) =>
    api().inject({
      method: "GET",
      url: path,
      remoteAddress: nextIp(),
      cookies: opts.cookies ?? {},
    });

  /** No body and no content-type, deliberately: the remove route takes neither,
   *  and sending an empty JSON body would be testing a shape the console does
   *  not send. */
  const del = (path: string, opts: { cookies?: Record<string, string> } = {}) =>
    api().inject({
      method: "DELETE",
      url: path,
      remoteAddress: nextIp(),
      cookies: opts.cookies ?? {},
    });

  const makeUser = async (local: string) => {
    const email = `orgs-t-${local}@example.com`;
    const reg = await api().inject({
      method: "POST",
      url: "/v1/auth/register",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email, password: PASSWORD, displayName: `Orgs ${local}` }),
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

  const makeOrg = async (
    cookies: Record<string, string>,
    name: string,
    extra: { orgType?: string; country?: string } = {},
  ): Promise<CreatedOrg> => {
    const res = await post(
      "/v1/orgs",
      { name, city: "Jorhat", country: "IN", timezone: "Asia/Kolkata", ...extra },
      { cookies },
    );
    expect(res.statusCode).toBe(201);
    return JSON.parse(res.body) as CreatedOrg;
  };

  /** Apply with a code and return the application id.
   *
   *  Since Kd's 2026-08-19 ruling this is ALL that typing a code does — no
   *  seat, no membership, no entitlements. Tests that need a real MEMBER use
   *  `joinAsMember` below. */
  const applyWithCode = async (
    cookies: Record<string, string>,
    code: string,
  ): Promise<string> => {
    const res = await post("/v1/orgs/join", { code }, { cookies });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { outcome: string; application?: { id: string } };
    expect(body.outcome).toBe("pending");
    const id = body.application?.id;
    if (id === undefined) throw new Error("apply returned no application");
    return id;
  };

  /** THE WHOLE DOOR, both halves: the member applies, the gym's front desk
   *  confirms. Every test that just needs somebody to BE a member goes through
   *  here, so none of them can accidentally assert the pre-ruling behaviour
   *  where typing a code was enough. */
  const joinAsMember = async (
    memberCookies: Record<string, string>,
    org: CreatedOrg,
    staffCookies: Record<string, string>,
  ): Promise<string> => {
    const applicationId = await applyWithCode(memberCookies, org.joinCode.code);
    const confirm = await post(
      `/v1/orgs/${org.org.id}/applications/${applicationId}/confirm`,
      {},
      { cookies: staffCookies },
    );
    expect(confirm.statusCode).toBe(200);
    return applicationId;
  };

  /** Give a gym a live subscription on a named plan (P2.4 GAP-5's precedent:
   *  pre-billing tests insert `provider='pilot'` rows directly). */
  const subscribeGym = async (gymId: string, planCode: string) => {
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${planCode}), 'trialing', 'pilot')`;
  };

  beforeAll(async () => {
    await cleanup();
    // A one-seat org plan so the cap is reachable without creating 25 users.
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                         seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${CAP1_PLAN}, 'org', ${"plan." + CAP1_PLAN}, 0, 'USD', 'month',
              1, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
    app = await buildApp(loadConfig(baseEnv));
  }, 120_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await cleanup();
    await sql.end({ timeout: 5 });
  });

  it("every route requires authentication", { timeout: 30_000 }, async () => {
    expect((await post("/v1/orgs", { name: "X", country: "US", timezone: "UTC" })).statusCode).toBe(401);
    expect((await get("/v1/orgs/mine")).statusCode).toBe(401);
    expect((await post("/v1/orgs/join", { code: "AAAAAA" })).statusCode).toBe(401);
    expect(
      (await get("/v1/orgs/11111111-1111-1111-1111-111111111111/members")).statusCode,
    ).toBe(401);
    expect(
      (await get("/v1/orgs/11111111-1111-1111-1111-111111111111/codes")).statusCode,
    ).toBe(401);
    // T3 L-1: this test named FIVE of the module's NINE routes and none of the
    // four the waiting-room card added — proven by deleting `app.authenticate`
    // from the confirm route and watching it stay GREEN. It was Low rather than
    // Critical only because every handler calls `requireUserId`, which throws
    // when the preHandler did not run, so a missing guard is a 500 and not an
    // open door. A guard whose absence nothing notices is still a guard nobody
    // is checking.
    const someGym = "11111111-1111-1111-1111-111111111111";
    const someApplication = "22222222-2222-2222-2222-222222222222";
    expect((await get("/v1/orgs/applications/mine")).statusCode).toBe(401);
    expect((await get(`/v1/orgs/${someGym}/applications`)).statusCode).toBe(401);
    expect(
      (await post(`/v1/orgs/${someGym}/applications/${someApplication}/confirm`, {})).statusCode,
    ).toBe(401);
    expect(
      (await post(`/v1/orgs/${someGym}/applications/${someApplication}/reject`, {})).statusCode,
    ).toBe(401);
    const someUser = "33333333-3333-3333-3333-333333333333";
    expect((await del(`/v1/orgs/${someGym}/members/${someUser}`)).statusCode).toBe(401);
  });

  it("creates the org, its first code, the owner staff row and the owner's seat", { timeout: 30_000 }, async () => {
    const owner = await makeUser("create");
    const created = await makeOrg(owner.cookies, "Orgs Test Alpha");

    expect(created.org.slug).toBe("orgs-test-alpha");
    expect(created.org.orgType).toBe("gym");
    expect(created.joinCode.label).toBe("Front Desk");
    expect(created.joinCode.code).toHaveLength(6);
    for (const ch of created.joinCode.code) expect(JOIN_CODE_ALPHABET).toContain(ch);

    const staff = await sql<{ role: string }[]>`
      SELECT role FROM gym_staff WHERE gym_id = ${created.org.id} AND user_id = ${owner.userId}`;
    expect(staff[0]?.role).toBe("owner");

    // Part 3 §4.0 step 6 — member #1, complimentary (not seat-counted).
    const seat = await sql<{ complimentary: boolean; consent_at: Date | null }[]>`
      SELECT complimentary, consent_at FROM gym_members
      WHERE gym_id = ${created.org.id} AND user_id = ${owner.userId} AND removed_at IS NULL`;
    expect(seat[0]?.complimentary).toBe(true);
    // T3 round 1 C/H-2: NULL, because nobody asked. The previous assertion here
    // was `.not.toBeNull()`, which pinned a fabricated consent record as
    // correct behaviour — :5906's "a test asserting the defect".
    expect(seat[0]?.consent_at).toBeNull();

    // Part 3 §3.3 — every mutating call writes audit_log.
    const audit = await sql<{ action: string }[]>`
      SELECT action FROM audit_log WHERE gym_id = ${created.org.id} AND action = 'org.created'`;
    expect(audit).toHaveLength(1);
  });

  it("rejects a malformed or over-specified create body (400, strict)", { timeout: 30_000 }, async () => {
    const { cookies } = await makeUser("badbody");
    expect((await post("/v1/orgs", {}, { cookies })).statusCode).toBe(400);
    expect(
      (await post("/v1/orgs", { name: "", country: "US", timezone: "UTC" }, { cookies })).statusCode,
    ).toBe(400);
    expect(
      (await post("/v1/orgs", { name: "Orgs Test Bad", country: "US", timezone: "UTC", seatCap: 9999 }, { cookies }))
        .statusCode,
    ).toBe(400);
    // A gym must not be able to declare its own currency (Kd ruling
    // 2026-08-18: the SERVER derives it from the country).
    expect(
      (await post(
        "/v1/orgs",
        { name: "Orgs Test Bad", country: "IN", timezone: "UTC", currencyDisplay: "USD" },
        { cookies },
      )).statusCode,
    ).toBe(400);
    // Country is required — without it there is nothing for the currency to
    // follow, and a default is exactly what Kd ruled out.
    expect(
      (await post("/v1/orgs", { name: "Orgs Test Bad", timezone: "UTC" }, { cookies })).statusCode,
    ).toBe(400);
    // T3 round 1 L-3: the timezone is the ONLY source of an org's day
    // boundaries, so a string that names no real zone is refused at the door
    // rather than written permanently into a row nothing can later interpret.
    for (const timezone of ["Mars/Olympus", "Asia/Kolkatta", "not a zone", "UTC+5"]) {
      expect(
        (await post("/v1/orgs", { name: "Orgs Test Bad", country: "IN", timezone }, { cookies }))
          .statusCode,
      ).toBe(400);
    }
    expect(
      (await post(
        "/v1/orgs",
        { name: "Orgs Test Bad", country: "IN", timezone: "Asia/Kolkata", locale: "en_US!!" },
        { cookies },
      )).statusCode,
    ).toBe(400);
  });

  it("sets the currency from the gym's country, and refuses a country we are not open in", { timeout: 60_000 }, async () => {
    const { cookies } = await makeUser("currency");
    for (const [country, currency] of [
      ["US", "USD"],
      ["IN", "INR"],
      ["CA", "CAD"],
      ["GB", "GBP"],
      ["DE", "EUR"],
      ["ie", "EUR"], // lower case is accepted; the poster/keyboard does not care
    ] as const) {
      const created = await makeOrg(cookies, `Orgs Test Money ${country}`, { country });
      expect(created.org.currencyDisplay).toBe(currency);
      // The value is what the DATABASE holds, not just what the reply says —
      // the column default is still INR and must never be what lands.
      const row = await sql<{ currency_display: string }[]>`
        SELECT currency_display FROM gyms WHERE id = ${created.org.id}`;
      expect(row[0]?.currency_display).toBe(currency);
    }

    // Australia, Poland and Switzerland are all real gyms in real countries we
    // have no prices for. An honest refusal beats quoting them in euros.
    for (const country of ["AU", "PL", "CH", "ZZ"]) {
      const res = await post(
        "/v1/orgs",
        { name: "Orgs Test Money No", country, timezone: "UTC" },
        { cookies },
      );
      expect(res.statusCode).toBe(400);
      expect((JSON.parse(res.body) as { error: string }).error).toBe("country_unsupported");
    }
  });

  it("gives a second org of the SAME name its own slug", { timeout: 30_000 }, async () => {
    const a = await makeUser("dup-a");
    const b = await makeUser("dup-b");
    const first = await makeOrg(a.cookies, "Orgs Test Twin");
    const second = await makeOrg(b.cookies, "Orgs Test Twin");
    expect(first.org.slug).toBe("orgs-test-twin");
    expect(second.org.slug).not.toBe(first.org.slug);
    expect(second.org.slug.startsWith("orgs-test-twin-")).toBe(true);
  });

  it("typing a code APPLIES — no seat, no membership, no code use (Kd ruling 2026-08-19)", { timeout: 30_000 }, async () => {
    const owner = await makeUser("apply-owner");
    const member = await makeUser("apply-member");
    const org = await makeOrg(owner.cookies, "Orgs Test Apply");

    const typed = ` ${org.joinCode.code.toLowerCase().slice(0, 3)}-${org.joinCode.code.toLowerCase().slice(3)} `;
    const first = await post("/v1/orgs/join", { code: typed }, { cookies: member.cookies });
    expect(first.statusCode).toBe(200);
    const firstBody = JSON.parse(first.body) as {
      outcome: string;
      org: { id: string };
      application: { id: string; status: string; expiresAt: string };
    };
    expect(firstBody.outcome).toBe("pending");
    expect(firstBody.org.id).toBe(org.org.id);
    expect(firstBody.application.status).toBe("pending");

    // THE RULING, ASSERTED RATHER THAN DESCRIBED: no membership row exists.
    // This is the assertion that goes red if a later edit "helpfully" restores
    // the instant join, and it is why it sits above everything else here.
    const members = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_members
      WHERE gym_id = ${org.org.id} AND user_id = ${member.userId} AND removed_at IS NULL`;
    expect(members[0]?.n).toBe(0);

    // And no code use is burned. If applying spent one, a stranger with a
    // leaked code could exhaust a max_uses code and shut a real gym's poster
    // down without ever getting in.
    const uses = await sql<{ uses: number }[]>`
      SELECT uses FROM gym_codes WHERE code = ${org.joinCode.code}`;
    expect(uses[0]?.uses).toBe(0);

    // :11385 — the row carries its own 14-day deadline from the moment it is
    // written, so the sweep that acts on it is a reader and not a backfill.
    const days =
      (new Date(firstBody.application.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);

    // A second tap while waiting returns the SAME application, not an error
    // and not a second row.
    const again = await post(
      "/v1/orgs/join",
      { code: org.joinCode.code },
      { cookies: member.cookies },
    );
    expect(again.statusCode).toBe(200);
    const againBody = JSON.parse(again.body) as {
      outcome: string;
      application: { id: string };
    };
    expect(againBody.outcome).toBe("already_pending");
    expect(againBody.application.id).toBe(firstBody.application.id);
    const rows = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_join_applications
      WHERE gym_id = ${org.org.id} AND user_id = ${member.userId}`;
    expect(rows[0]?.n).toBe(1);
  });

  it("the front desk's confirm is what creates the membership, and it is idempotent", { timeout: 30_000 }, async () => {
    const owner = await makeUser("confirm-owner");
    const member = await makeUser("confirm-member");
    const org = await makeOrg(owner.cookies, "Orgs Test Confirm");
    const applicationId = await applyWithCode(member.cookies, org.joinCode.code);

    const confirm = await post(
      `/v1/orgs/${org.org.id}/applications/${applicationId}/confirm`,
      {},
      { cookies: owner.cookies },
    );
    expect(confirm.statusCode).toBe(200);
    const body = JSON.parse(confirm.body) as {
      status: string;
      membership: { groupLabel: string | null };
    };
    expect(body.status).toBe("confirmed");
    expect(body.membership.groupLabel).toBe("Front Desk");

    const live = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_members
      WHERE gym_id = ${org.org.id} AND user_id = ${member.userId} AND removed_at IS NULL`;
    expect(live[0]?.n).toBe(1);
    // NOW the code use is spent — `uses` counts memberships the code created.
    const uses = await sql<{ uses: number }[]>`
      SELECT uses FROM gym_codes WHERE code = ${org.joinCode.code}`;
    expect(uses[0]?.uses).toBe(1);
    // The application records which membership it produced.
    const app = await sql<{ status: string; member_id: string | null; decided_by_user_id: string | null }[]>`
      SELECT status, member_id, decided_by_user_id FROM gym_join_applications
      WHERE id = ${applicationId}`;
    expect(app[0]?.status).toBe("confirmed");
    expect(app[0]?.member_id).not.toBeNull();
    expect(app[0]?.decided_by_user_id).toBe(owner.userId);

    // A second tap is a person pressing a button twice, not an error — and it
    // must not burn a second code use.
    const twice = await post(
      `/v1/orgs/${org.org.id}/applications/${applicationId}/confirm`,
      {},
      { cookies: owner.cookies },
    );
    expect(twice.statusCode).toBe(200);
    expect((JSON.parse(twice.body) as { status: string }).status).toBe("already_confirmed");
    const usesAfter = await sql<{ uses: number }[]>`
      SELECT uses FROM gym_codes WHERE code = ${org.joinCode.code}`;
    expect(usesAfter[0]?.uses).toBe(1);

    // Now a member, re-typing the code says so rather than opening a second
    // application.
    const retype = await post(
      "/v1/orgs/join",
      { code: org.joinCode.code },
      { cookies: member.cookies },
    );
    expect(retype.statusCode).toBe(200);
    expect((JSON.parse(retype.body) as { outcome: string }).outcome).toBe("already_member");
  });

  it("'not this person' closes the request and creates nobody", { timeout: 30_000 }, async () => {
    const owner = await makeUser("reject-owner");
    const stranger = await makeUser("reject-stranger");
    const org = await makeOrg(owner.cookies, "Orgs Test Reject");
    const applicationId = await applyWithCode(stranger.cookies, org.joinCode.code);

    const rejected = await post(
      `/v1/orgs/${org.org.id}/applications/${applicationId}/reject`,
      {},
      { cookies: owner.cookies },
    );
    expect(rejected.statusCode).toBe(200);
    expect((JSON.parse(rejected.body) as { status: string }).status).toBe("rejected");

    const live = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_members
      WHERE gym_id = ${org.org.id} AND user_id = ${stranger.userId} AND removed_at IS NULL`;
    expect(live[0]?.n).toBe(0);

    // Confirming afterwards must not resurrect it.
    const late = await post(
      `/v1/orgs/${org.org.id}/applications/${applicationId}/confirm`,
      {},
      { cookies: owner.cookies },
    );
    expect(late.statusCode).toBe(409);
    expect((JSON.parse(late.body) as { error: string }).error).toBe("application_rejected");

    // T3 L-3: a SECOND tap on "not this person" answers the same as the first.
    // Confirm has been idempotent since it was written ("a person pressing a
    // button twice"); reject 409'd, and the asymmetry was not designed. Two
    // front-desk staff working one queue is the case this card cites
    // everywhere else. Asserted BEFORE the re-apply below, because that one
    // opens a new pending row and would make this unreachable.
    const rejectedTwice = await post(
      `/v1/orgs/${org.org.id}/applications/${applicationId}/reject`,
      {},
      { cookies: owner.cookies },
    );
    expect(rejectedTwice.statusCode).toBe(200);
    expect((JSON.parse(rejectedTwice.body) as { status: string }).status).toBe("rejected");

    // :11385 — re-applying is FREE. A real member mis-tapped as a stranger is
    // not locked out; the per-route rate limit is what bounds a stranger's
    // retries, never a permanent block.
    const again = await post(
      "/v1/orgs/join",
      { code: org.joinCode.code },
      { cookies: stranger.cookies },
    );
    expect(again.statusCode).toBe(200);
    expect((JSON.parse(again.body) as { outcome: string }).outcome).toBe("pending");
  });

  it("shows the applicant their own waiting list, and tells them when it was refused", { timeout: 30_000 }, async () => {
    const owner = await makeUser("mineapp-owner");
    const member = await makeUser("mineapp-member");
    const org = await makeOrg(owner.cookies, "Orgs Test Mine Apps");
    const applicationId = await applyWithCode(member.cookies, org.joinCode.code);

    const waiting = await get("/v1/orgs/applications/mine", { cookies: member.cookies });
    expect(waiting.statusCode).toBe(200);
    const body = JSON.parse(waiting.body) as {
      applications: { id: string; status: string; org: { id: string; name: string } }[];
    };
    const row = body.applications.find((a) => a.id === applicationId);
    expect(row?.status).toBe("pending");
    // The gym is named: a person waiting has to be told WHICH gym.
    expect(row?.org.name).toBe("Orgs Test Mine Apps");

    // Somebody else's application is not in my list.
    const other = await makeUser("mineapp-other");
    const otherList = await get("/v1/orgs/applications/mine", { cookies: other.cookies });
    expect(
      (JSON.parse(otherList.body) as { applications: { id: string }[] }).applications.map(
        (a) => a.id,
      ),
    ).not.toContain(applicationId);

    // Refused, and the applicant can SEE it was refused — leaving "waiting for
    // Orgs Test Mine Apps" on screen after the gym said no is the app stating
    // something false (:5807).
    await post(
      `/v1/orgs/${org.org.id}/applications/${applicationId}/reject`,
      {},
      { cookies: owner.cookies },
    );
    const after = await get("/v1/orgs/applications/mine", { cookies: member.cookies });
    const afterRow = (
      JSON.parse(after.body) as { applications: { id: string; status: string; decidedAt: string | null }[] }
    ).applications.find((a) => a.id === applicationId);
    expect(afterRow?.status).toBe("rejected");
    expect(afterRow?.decidedAt).not.toBeNull();
  });

  it("drops a CONFIRMED application from the applicant's list — /mine owns that fact", { timeout: 30_000 }, async () => {
    const owner = await makeUser("mineapp2-owner");
    const member = await makeUser("mineapp2-member");
    const org = await makeOrg(owner.cookies, "Orgs Test Mine Apps Two");
    const applicationId = await joinAsMember(member.cookies, org, owner.cookies);

    const list = await get("/v1/orgs/applications/mine", { cookies: member.cookies });
    const ids = (JSON.parse(list.body) as { applications: { id: string }[] }).applications.map(
      (a) => a.id,
    );
    // Two readers claiming the same thing is two readers that can disagree:
    // once confirmed, the membership lives in /v1/orgs/mine and only there.
    expect(ids).not.toContain(applicationId);
    const mine = await get("/v1/orgs/mine", { cookies: member.cookies });
    expect(
      (JSON.parse(mine.body) as { orgs: { id: string; isMember: boolean }[] }).orgs.find(
        (o) => o.id === org.org.id,
      )?.isMember,
    ).toBe(true);
  });

  it("never lets a stale REFUSAL outlive the confirmation that followed it (T3 r1 C/H-1)", { timeout: 30_000 }, async () => {
    // THE BUG THIS PINS, in the words of the screen it broke: a person the gym
    // confirmed and then removed was told "{gym} didn't confirm your request",
    // with a Try again link, while `gym_join_applications` held a confirmation
    // two minutes before the removal. It is the smoke sheet's own steps
    // 8 → 10 → 11 → 14 — the documented happy path, not an exotic ordering.
    //
    // Neither reader could see the truth alone, which is why the fix is here
    // and not in the client: `/applications/mine` excludes confirmed rows BY
    // DESIGN, and `/orgs/mine` drops the gym the moment `removed_at` is set. So
    // the only surviving fact was the refusal, and the client's rank had
    // nothing to outrank it with.
    const owner = await makeUser("supersede-owner");
    const member = await makeUser("supersede-member");
    const org = await makeOrg(owner.cookies, "Orgs Test Stale Refusal");

    // Refused once...
    const refusedId = await applyWithCode(member.cookies, org.joinCode.code);
    const reject = await post(
      `/v1/orgs/${org.org.id}/applications/${refusedId}/reject`,
      {},
      { cookies: owner.cookies },
    );
    expect(reject.statusCode).toBe(200);
    // The refusal IS visible while it is the newest fact — this assertion is
    // what stops the fix being "hide every rejection", which would break the
    // thing :5807 put the refused card there for in the first place.
    const whileTrue = await get("/v1/orgs/applications/mine", { cookies: member.cookies });
    expect(
      (
        JSON.parse(whileTrue.body) as { applications: { id: string; status: string }[] }
      ).applications.find((a) => a.id === refusedId)?.status,
    ).toBe("rejected");

    // ...asks again, is let in, and is then removed.
    const confirmedId = await joinAsMember(member.cookies, org, owner.cookies);
    const removed = await del(`/v1/orgs/${org.org.id}/members/${member.userId}`, {
      cookies: owner.cookies,
    });
    expect(removed.statusCode).toBe(200);

    // The membership is gone from the other reader, which is correct and is
    // exactly what leaves the refusal standing alone.
    const mine = await get("/v1/orgs/mine", { cookies: member.cookies });
    expect(
      (JSON.parse(mine.body) as { orgs: { id: string }[] }).orgs.find((o) => o.id === org.org.id),
    ).toBeUndefined();

    // THE ASSERTION: the superseded refusal is gone, and the confirmed row is
    // still absent (that exclusion is deliberate and unchanged). The screen is
    // therefore silent about this gym rather than lying about it.
    const after = await get("/v1/orgs/applications/mine", { cookies: member.cookies });
    const rows = (
      JSON.parse(after.body) as { applications: { id: string; status: string }[] }
    ).applications;
    expect(rows.find((a) => a.id === refusedId)).toBeUndefined();
    expect(rows.find((a) => a.id === confirmedId)).toBeUndefined();
  });

  it("TELLS a removed member they were removed, and keeps saying nothing false (Kd 2026-08-20)", { timeout: 30_000 }, async () => {
    // Kd's ruling: stopping the app calling a removed member a stranger was
    // right and was not enough — silence about the gym is its own hole. The
    // person was let IN and then taken OUT and is entitled to know that.
    const owner = await makeUser("former-owner");
    const member = await makeUser("former-member");
    const org = await makeOrg(owner.cookies, "Orgs Test Former");

    await joinAsMember(member.cookies, org, owner.cookies);

    // While they are a MEMBER, nothing is former — or the card would tell a
    // current member their membership had ended.
    const during = await get("/v1/orgs/mine", { cookies: member.cookies });
    const beforeBody = JSON.parse(during.body) as {
      orgs: { id: string; isMember: boolean }[];
      formerOrgs: { id: string; removedAt: string }[];
    };
    expect(beforeBody.orgs.find((o) => o.id === org.org.id)?.isMember).toBe(true);
    expect(beforeBody.formerOrgs).toEqual([]);

    await del(`/v1/orgs/${org.org.id}/members/${member.userId}`, { cookies: owner.cookies });

    const after = await get("/v1/orgs/mine", { cookies: member.cookies });
    const body = JSON.parse(after.body) as {
      orgs: { id: string }[];
      formerOrgs: { id: string; name: string; removedAt: string }[];
    };
    // `orgs` is UNCHANGED in meaning — it still means a live relationship, which
    // is what keeps the console's reader honest.
    expect(body.orgs.find((o) => o.id === org.org.id)).toBeUndefined();
    const former = body.formerOrgs.find((o) => o.id === org.org.id);
    expect(former?.name).toBe("Orgs Test Former");
    expect(former?.removedAt).not.toBeUndefined();

    // Nobody ELSE's removal is in my list.
    const stranger = await makeUser("former-stranger");
    expect(
      (JSON.parse((await get("/v1/orgs/mine", { cookies: stranger.cookies })).body) as {
        formerOrgs: { id: string }[];
      }).formerOrgs,
    ).toEqual([]);
  });

  it("names a gym ONCE however many times the person was removed from it (T3 r2 L2-3)", { timeout: 60_000 }, async () => {
    // `gym_members_live_uq` is a PARTIAL unique index — `WHERE removed_at IS
    // NULL` — so joining, being removed, joining again and being removed again
    // leaves TWO closed rows for one person and one gym. Without DISTINCT ON
    // the response names the gym twice, breaking the promise `listOrgsForUser`
    // makes one function above ("a caller can never render the same gym
    // twice"). It was invisible because the CLIENT happens to dedupe by org id
    // — a contract holding only because of what today's one caller does.
    const owner = await makeUser("dupe-owner");
    const member = await makeUser("dupe-member");
    const org = await makeOrg(owner.cookies, "Orgs Test Dupe");

    await joinAsMember(member.cookies, org, owner.cookies);
    await del(`/v1/orgs/${org.org.id}/members/${member.userId}`, { cookies: owner.cookies });
    await joinAsMember(member.cookies, org, owner.cookies);
    await del(`/v1/orgs/${org.org.id}/members/${member.userId}`, { cookies: owner.cookies });

    // THE FIXTURE IS THE ASSERTION: two closed rows must actually exist, or
    // this test passes against a database that could never have produced the
    // defect (:10010's own fixture lesson).
    const closed = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_members
      WHERE gym_id = ${org.org.id} AND user_id = ${member.userId}
        AND removed_at IS NOT NULL`;
    expect(closed[0]?.n).toBe(2);

    const body = JSON.parse((await get("/v1/orgs/mine", { cookies: member.cookies })).body) as {
      formerOrgs: { id: string; removedAt: string }[];
    };
    expect(body.formerOrgs.filter((o) => o.id === org.org.id)).toHaveLength(1);
  });

  it("stops calling them a former member once they REJOIN", { timeout: 30_000 }, async () => {
    // One gym, one truth. A person removed and then let back in is simply a
    // member; carrying the old removal alongside would put two contradictory
    // rows about one gym on the dashboard.
    const owner = await makeUser("rejoin-owner");
    const member = await makeUser("rejoin-member");
    const org = await makeOrg(owner.cookies, "Orgs Test Rejoin");

    await joinAsMember(member.cookies, org, owner.cookies);
    await del(`/v1/orgs/${org.org.id}/members/${member.userId}`, { cookies: owner.cookies });
    await joinAsMember(member.cookies, org, owner.cookies);

    const body = JSON.parse((await get("/v1/orgs/mine", { cookies: member.cookies })).body) as {
      orgs: { id: string; isMember: boolean }[];
      formerOrgs: { id: string }[];
    };
    expect(body.orgs.find((o) => o.id === org.org.id)?.isMember).toBe(true);
    expect(body.formerOrgs.find((o) => o.id === org.org.id)).toBeUndefined();
  });

  it("still shows a refusal that came AFTER a confirmation (the fix must not hide it)", { timeout: 30_000 }, async () => {
    // The mirror image, and the reason the fix compares TIMESTAMPS instead of
    // asking "has this person ever been confirmed here". Confirmed, removed,
    // asks again, refused: the refusal is now the newest fact and MUST show,
    // or a person who was genuinely turned away sees nothing at all.
    const owner = await makeUser("order-owner");
    const member = await makeUser("order-member");
    const org = await makeOrg(owner.cookies, "Orgs Test Refusal Order");

    await joinAsMember(member.cookies, org, owner.cookies);
    await del(`/v1/orgs/${org.org.id}/members/${member.userId}`, { cookies: owner.cookies });

    const laterId = await applyWithCode(member.cookies, org.joinCode.code);
    await post(
      `/v1/orgs/${org.org.id}/applications/${laterId}/reject`,
      {},
      { cookies: owner.cookies },
    );

    const list = await get("/v1/orgs/applications/mine", { cookies: member.cookies });
    expect(
      (
        JSON.parse(list.body) as { applications: { id: string; status: string }[] }
      ).applications.find((a) => a.id === laterId)?.status,
    ).toBe("rejected");
  });

  it("serves the confirm queue to staff who may confirm, and to nobody else (R3.2)", { timeout: 30_000 }, async () => {
    const owner = await makeUser("queue-owner");
    const waiting = await makeUser("queue-waiting");
    const stranger = await makeUser("queue-stranger");
    const org = await makeOrg(owner.cookies, "Orgs Test Queue");
    const applicationId = await applyWithCode(waiting.cookies, org.joinCode.code);

    // THE FIXTURE IS THE ASSERTION (T3 round 1 C/H-3, applied before the
    // defect rather than after it): a SECOND gym with its OWN pending
    // applicant must exist, or "this queue is scoped to one gym" is proven by
    // nothing — `WHERE gym_id = $1 OR true` returns the same single row on a
    // clean database and survives.
    const otherOwner = await makeUser("queue-other-owner");
    const otherWaiting = await makeUser("queue-other-waiting");
    const otherOrg = await makeOrg(otherOwner.cookies, "Orgs Test Queue Other");
    const otherApplicationId = await applyWithCode(
      otherWaiting.cookies,
      otherOrg.joinCode.code,
    );

    const res = await get(`/v1/orgs/${org.org.id}/applications`, { cookies: owner.cookies });
    expect(res.statusCode).toBe(200);
    const page = JSON.parse(res.body) as {
      items: { id: string; userId: string; displayName: string; groupLabel: string }[];
      nextCursor: string | null;
      pendingCount: number;
    };

    // Scoping first, naming the person this test itself put in ANOTHER gym, so
    // a failure says whose row leaked rather than "expected 7 to equal 1".
    expect(page.items.map((i) => i.id)).not.toContain(otherApplicationId);
    expect(page.items.map((i) => i.userId)).not.toContain(otherWaiting.userId);

    expect(page.items.map((i) => i.id)).toEqual([applicationId]);
    expect(page.items[0]?.displayName).toBe("Orgs queue-waiting");
    expect(page.items[0]?.groupLabel).toBe("Front Desk");
    expect(page.pendingCount).toBe(1);
    // Part 3 §2.4: an applicant is not a member, and the shape is no wider
    // than the roster's. A field added here reaches a gym-facing screen.
    //
    // **WIDENED 2026-08-20 BY THE WAITING ROOM'S CLOCK, DELIBERATELY — and the
    // fact that this list had to be edited is the guard WORKING.** It exists to
    // make a widening a decision somebody wrote down rather than something that
    // happens, so the §2.4 reasoning for the two new keys is here:
    //   · `gymNotifiedAt` is a fact about what THIS APP did toward this gym
    //     (whether the row has been flagged for their attention). It reveals
    //     nothing whatever about the person.
    //   · `nudgedAt` is a fact about an action the applicant took TOWARD THIS
    //     GYM — the equivalent of them ringing the front desk. §2.4's boundary
    //     is about a person's TRAINING AND HEALTH data (meals, weight, coach
    //     chats, routes, anything before joining or after leaving); when they
    //     last asked this gym to look at their own request is none of that.
    // Neither is on the never-see list, and both are already known to the gym
    // in substance. The list stays EXACT so the next addition gets the same
    // argument rather than a free pass.
    for (const item of page.items) {
      expect(Object.keys(item).sort()).toEqual(
        [
          "appliedAt",
          "displayName",
          "expiresAt",
          "groupLabel",
          "gymNotifiedAt",
          "id",
          "nudgedAt",
          "userId",
        ].sort(),
      );
    }

    // A stranger with the org's uuid must not learn it exists.
    expect(
      (await get(`/v1/orgs/${org.org.id}/applications`, { cookies: stranger.cookies }))
        .statusCode,
    ).toBe(404);
    // Nor may the person WAITING read the queue they are in — membership is
    // not staffing, and an applicant is not even that.
    expect(
      (await get(`/v1/orgs/${org.org.id}/applications`, { cookies: waiting.cookies }))
        .statusCode,
    ).toBe(404);
  });

  it("refuses to let one gym's staff decide another gym's application (R3.2)", { timeout: 30_000 }, async () => {
    const ownerA = await makeUser("xt-owner-a");
    const ownerB = await makeUser("xt-owner-b");
    const applicant = await makeUser("xt-applicant");
    const gymA = await makeOrg(ownerA.cookies, "Orgs Test Cross A");
    const gymB = await makeOrg(ownerB.cookies, "Orgs Test Cross B");
    const applicationId = await applyWithCode(applicant.cookies, gymA.joinCode.code);

    // Gym B's owner holds a real application uuid — from gym A. Addressing it
    // under their OWN gym must find nothing (the id is scoped by gym_id in the
    // WHERE), and addressing it under gym A must not tell them gym A exists.
    for (const verb of ["confirm", "reject"] as const) {
      const underOwnGym = await post(
        `/v1/orgs/${gymB.org.id}/applications/${applicationId}/${verb}`,
        {},
        { cookies: ownerB.cookies },
      );
      expect(underOwnGym.statusCode).toBe(404);
      expect((JSON.parse(underOwnGym.body) as { error: string }).error).toBe(
        "application_not_found",
      );

      const underOtherGym = await post(
        `/v1/orgs/${gymA.org.id}/applications/${applicationId}/${verb}`,
        {},
        { cookies: ownerB.cookies },
      );
      // 404, not 403: a 403 would confirm gym A exists (:10010 decision 1).
      expect(underOtherGym.statusCode).toBe(404);
      expect((JSON.parse(underOtherGym.body) as { error: string }).error).toBe("org_not_found");
    }

    // And after all that the person is still waiting, in the right gym.
    const still = await sql<{ status: string; gym_id: string }[]>`
      SELECT status, gym_id FROM gym_join_applications WHERE id = ${applicationId}`;
    expect(still[0]?.status).toBe("pending");
    expect(still[0]?.gym_id).toBe(gymA.org.id);
  });

  it("holds a TRAINER back from confirming — §2.2's remove/restore row, and Kd's ruling", { timeout: 30_000 }, async () => {
    const owner = await makeUser("priv-owner");
    const trainer = await makeUser("priv-trainer");
    const manager = await makeUser("priv-manager");
    const applicant = await makeUser("priv-applicant");
    const org = await makeOrg(owner.cookies, "Orgs Test Privilege");
    await sql`
      INSERT INTO gym_staff (gym_id, user_id, role) VALUES
        (${org.org.id}, ${trainer.userId}, 'trainer'),
        (${org.org.id}, ${manager.userId}, 'manager')`;
    const applicationId = await applyWithCode(applicant.cookies, org.joinCode.code);

    // 403 and NOT 404: the trainer already knows this gym exists — they staff
    // it. The distinction is the whole reason the seam returns both.
    const queue = await get(`/v1/orgs/${org.org.id}/applications`, {
      cookies: trainer.cookies,
    });
    expect(queue.statusCode).toBe(403);
    const refused = await post(
      `/v1/orgs/${org.org.id}/applications/${applicationId}/confirm`,
      {},
      { cookies: trainer.cookies },
    );
    expect(refused.statusCode).toBe(403);
    expect((JSON.parse(refused.body) as { error: string }).error).toBe("forbidden");
    // The refusal is REAL, not a hidden button: nobody was created.
    const live = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_members
      WHERE gym_id = ${org.org.id} AND user_id = ${applicant.userId} AND removed_at IS NULL`;
    expect(live[0]?.n).toBe(0);

    // T3 L-1, second half: REJECT runs through the same `requirePrivilege`
    // call and had no case of its own. Asserted before the confirm below,
    // because once the application is confirmed this is unreachable.
    const rejectRefused = await post(
      `/v1/orgs/${org.org.id}/applications/${applicationId}/reject`,
      {},
      { cookies: trainer.cookies },
    );
    expect(rejectRefused.statusCode).toBe(403);
    expect((JSON.parse(rejectRefused.body) as { error: string }).error).toBe("forbidden");
    const stillPending = await sql<{ status: string }[]>`
      SELECT status FROM gym_join_applications WHERE id = ${applicationId}`;
    expect(stillPending[0]?.status).toBe("pending");

    // A manager may — Kd's "only owner and manager", 2026-08-19.
    const allowed = await post(
      `/v1/orgs/${org.org.id}/applications/${applicationId}/confirm`,
      {},
      { cookies: manager.cookies },
    );
    expect(allowed.statusCode).toBe(200);
  });

  // ── Removing a member (Part 3 §4.3; Kd ruling 2026-08-19) ────────────────
  //
  // These exist because the gap was real and Kd found it by asking the obvious
  // question: before this route, NOTHING in the product could end a membership
  // except the member deleting their whole account. Confirm was a one-way door.

  it("removes a member: the roster drops them, the row is CLOSED not deleted, and the seat is freed", { timeout: 60_000 }, async () => {
    const owner = await makeUser("rm-owner");
    const member = await makeUser("rm-member");
    const org = await makeOrg(owner.cookies, "Orgs Test Remove");
    await subscribeGym(org.org.id, CAP1_PLAN); // exactly one non-complimentary seat
    await joinAsMember(member.cookies, org, owner.cookies);

    const rosterBefore = await get(`/v1/orgs/${org.org.id}/members`, { cookies: owner.cookies });
    expect(
      (JSON.parse(rosterBefore.body) as { items: { userId: string }[] }).items.map((i) => i.userId),
    ).toContain(member.userId);

    const removed = await del(`/v1/orgs/${org.org.id}/members/${member.userId}`, {
      cookies: owner.cookies,
    });
    expect(removed.statusCode).toBe(200);
    expect(JSON.parse(removed.body)).toEqual({ status: "removed" });

    const rosterAfter = await get(`/v1/orgs/${org.org.id}/members`, { cookies: owner.cookies });
    expect(
      (JSON.parse(rosterAfter.body) as { items: { userId: string }[] }).items.map((i) => i.userId),
    ).not.toContain(member.userId);

    // HISTORY RETAINED (§4.3): the row is still there with an end date on it.
    // Asserted directly rather than through the roster, because the roster
    // filters on exactly this column and would look identical if the row had
    // been DELETED — which would silently rewrite the gym's own record of who
    // trained there.
    const row = await sql<{ removed_at: Date | null }[]>`
      SELECT removed_at FROM gym_members
      WHERE gym_id = ${org.org.id} AND user_id = ${member.userId}`;
    expect(row).toHaveLength(1);
    expect(row[0]?.removed_at).not.toBeNull();

    // THE SEAT IS FREED, and this is the half a comment cannot prove: the plan
    // caps this gym at one member, so a second person can only be confirmed if
    // the removal actually released the seat.
    const next = await makeUser("rm-next");
    const applicationId = await applyWithCode(next.cookies, org.joinCode.code);
    const confirmNext = await post(
      `/v1/orgs/${org.org.id}/applications/${applicationId}/confirm`,
      {},
      { cookies: owner.cookies },
    );
    expect(confirmNext.statusCode).toBe(200);

    // §3.3 — every mutating call writes audit_log.
    const audit = await sql<{ action: string }[]>`
      SELECT action FROM audit_log
      WHERE gym_id = ${org.org.id} AND action = 'org.member_removed'`;
    expect(audit).toHaveLength(1);
  });

  it("removing somebody from ONE gym leaves their membership of another gym alone", { timeout: 60_000 }, async () => {
    // A person can belong to two gyms — Part 3 §4.3 names it as an ordinary
    // case ("member of 2 orgs → appears in both rosters"). The tenancy that
    // matters here is inside the UPDATE, not only in the authorization above
    // it: a WHERE that forgot the gym id would close every membership this
    // person holds, and neither gym would see anything to explain it.
    const ownerA = await makeUser("rmscope-owner-a");
    const ownerB = await makeUser("rmscope-owner-b");
    const member = await makeUser("rmscope-member");
    const gymA = await makeOrg(ownerA.cookies, "Orgs Test Remove Scope A");
    const gymB = await makeOrg(ownerB.cookies, "Orgs Test Remove Scope B");
    await joinAsMember(member.cookies, gymA, ownerA.cookies);
    await joinAsMember(member.cookies, gymB, ownerB.cookies);

    expect(
      (await del(`/v1/orgs/${gymA.org.id}/members/${member.userId}`, { cookies: ownerA.cookies }))
        .statusCode,
    ).toBe(200);

    const rosterB = await get(`/v1/orgs/${gymB.org.id}/members`, { cookies: ownerB.cookies });
    expect(
      (JSON.parse(rosterB.body) as { items: { userId: string }[] }).items.map((i) => i.userId),
    ).toContain(member.userId);
    const live = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_members
      WHERE user_id = ${member.userId} AND removed_at IS NULL`;
    expect(live[0]?.n).toBe(1);
  });

  it("REMOVAL TAKES THE GYM'S PERKS AWAY IMMEDIATELY — Kd's own rule, measured against a WARM cache", { timeout: 60_000 }, async () => {
    // *"if a gym removes a user that user losses the parks and need to take
    // personal subscriptions"*. The resolver counts a membership only while
    // `removed_at` is null, so the DATABASE says free the moment the row
    // closes — but the answer is CACHED, and the bust is what makes it true
    // now rather than a minute from now.
    //
    // The read after confirming is what makes this test able to fail: it
    // leaves the cache holding the GYM'S answer, so a deleted bust means this
    // person keeps Pro. Without that read the assertion passes on a cold cache
    // and proves nothing (:10010's fixture lesson, applied on purpose).
    const owner = await makeUser("rment-owner");
    const member = await makeUser("rment-member");
    const org = await makeOrg(owner.cookies, "Orgs Test Remove Ent");
    await subscribeGym(org.org.id, "org_micro"); // member_entitlements = the Pro doc
    await joinAsMember(member.cookies, org, owner.cookies);

    const warm = await get("/v1/entitlements/me", { cookies: member.cookies });
    const warmBody = JSON.parse(warm.body) as {
      source: string;
      entitlements: { history_days: number };
    };
    expect(warmBody.source).toBe("gym_membership");
    expect(warmBody.entitlements.history_days).toBe(-1);

    expect(
      (await del(`/v1/orgs/${org.org.id}/members/${member.userId}`, { cookies: owner.cookies }))
        .statusCode,
    ).toBe(200);

    const after = await get("/v1/entitlements/me", { cookies: member.cookies });
    const afterBody = JSON.parse(after.body) as {
      source: string;
      entitlements: { history_days: number };
    };
    expect(afterBody.source).toBe("free");
    expect(afterBody.entitlements.history_days).toBe(90);
  });

  it("removing twice answers the same, and removing somebody who was never a member is a 404", { timeout: 60_000 }, async () => {
    const owner = await makeUser("rmidem-owner");
    const member = await makeUser("rmidem-member");
    const stranger = await makeUser("rmidem-stranger");
    const org = await makeOrg(owner.cookies, "Orgs Test Remove Idem");
    await joinAsMember(member.cookies, org, owner.cookies);

    // Two front-desk staff working one list, or one person pressing twice —
    // the case :12227 L-3 punished on reject, answered the same way here.
    const first = await del(`/v1/orgs/${org.org.id}/members/${member.userId}`, {
      cookies: owner.cookies,
    });
    const second = await del(`/v1/orgs/${org.org.id}/members/${member.userId}`, {
      cookies: owner.cookies,
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(JSON.parse(second.body)).toEqual({ status: "removed" });

    // …but "removed" is not an answer to a request about somebody who was
    // never here. One membership row exists in this gym, so the second tap
    // above cannot have written one.
    const never = await del(`/v1/orgs/${org.org.id}/members/${stranger.userId}`, {
      cookies: owner.cookies,
    });
    expect(never.statusCode).toBe(404);
    expect((JSON.parse(never.body) as { error: string }).error).toBe("member_not_found");
  });

  it("refuses to remove STAFF, including the owner's own §4.0-step-6 seat", { timeout: 60_000 }, async () => {
    const owner = await makeUser("rmstaff-owner");
    const manager = await makeUser("rmstaff-manager");
    const org = await makeOrg(owner.cookies, "Orgs Test Remove Staff");
    await sql`
      INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${org.org.id}, ${manager.userId}, 'manager')`;

    // The owner IS a member of their own gym, so without this guard the button
    // beside their own name would close their own seat — with no restore built
    // and no staff screen to undo it from.
    const own = await del(`/v1/orgs/${org.org.id}/members/${owner.userId}`, {
      cookies: owner.cookies,
    });
    expect(own.statusCode).toBe(409);
    expect((JSON.parse(own.body) as { error: string }).error).toBe("member_is_staff");
    const stillThere = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_members
      WHERE gym_id = ${org.org.id} AND user_id = ${owner.userId} AND removed_at IS NULL`;
    expect(stillThere[0]?.n).toBe(1);

    // And a manager cannot be removed by an owner through this door either —
    // the refusal is about STAFF, not about the caller.
    expect(
      (await del(`/v1/orgs/${org.org.id}/members/${manager.userId}`, { cookies: owner.cookies }))
        .statusCode,
    ).toBe(409);
  });

  it("only owner and manager may remove — a trainer gets 403, another gym's owner gets 404", { timeout: 60_000 }, async () => {
    const owner = await makeUser("rmpriv-owner");
    const trainer = await makeUser("rmpriv-trainer");
    const manager = await makeUser("rmpriv-manager");
    const member = await makeUser("rmpriv-member");
    const outsider = await makeUser("rmpriv-outsider");
    const org = await makeOrg(owner.cookies, "Orgs Test Remove Priv");
    await sql`
      INSERT INTO gym_staff (gym_id, user_id, role) VALUES
        (${org.org.id}, ${trainer.userId}, 'trainer'),
        (${org.org.id}, ${manager.userId}, 'manager')`;
    await joinAsMember(member.cookies, org, owner.cookies);

    const refused = await del(`/v1/orgs/${org.org.id}/members/${member.userId}`, {
      cookies: trainer.cookies,
    });
    expect(refused.statusCode).toBe(403);
    expect((JSON.parse(refused.body) as { error: string }).error).toBe("forbidden");

    // CROSS-TENANT: somebody who runs a DIFFERENT gym, holding both uuids,
    // gets 404 — membership in a gym they do not staff is not theirs to end,
    // and 403 would confirm the gym exists (R3.2).
    await makeOrg(outsider.cookies, "Orgs Test Remove Outsider");
    const foreign = await del(`/v1/orgs/${org.org.id}/members/${member.userId}`, {
      cookies: outsider.cookies,
    });
    expect(foreign.statusCode).toBe(404);

    // Neither refusal touched the row — a hidden button is not enforcement.
    const live = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_members
      WHERE gym_id = ${org.org.id} AND user_id = ${member.userId} AND removed_at IS NULL`;
    expect(live[0]?.n).toBe(1);

    // A manager may — §2.2's remove/restore row, the same pair as confirm.
    expect(
      (await del(`/v1/orgs/${org.org.id}/members/${member.userId}`, { cookies: manager.cookies }))
        .statusCode,
    ).toBe(200);
  });

  it("a removed member can apply again and be confirmed back in", { timeout: 60_000 }, async () => {
    // The partial unique index is on LIVE rows only, so a second membership
    // must be insertable after the first is closed. Without this the remove
    // button would be a permanent ban, which is not what §4.3 describes and
    // not what a mis-tap needs.
    const owner = await makeUser("rmback-owner");
    const member = await makeUser("rmback-member");
    const org = await makeOrg(owner.cookies, "Orgs Test Remove Back");
    await joinAsMember(member.cookies, org, owner.cookies);
    await del(`/v1/orgs/${org.org.id}/members/${member.userId}`, { cookies: owner.cookies });

    await joinAsMember(member.cookies, org, owner.cookies);
    const roster = await get(`/v1/orgs/${org.org.id}/members`, { cookies: owner.cookies });
    expect(
      (JSON.parse(roster.body) as { items: { userId: string }[] }).items.map((i) => i.userId),
    ).toContain(member.userId);
    const rows = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_members
      WHERE gym_id = ${org.org.id} AND user_id = ${member.userId}`;
    expect(rows[0]?.n).toBe(2);
  });

  it("refuses an unknown code with 404", { timeout: 30_000 }, async () => {
    const { cookies } = await makeUser("nocode");
    const res = await post("/v1/orgs/join", { code: "ZZZZZZ" }, { cookies });
    expect(res.statusCode).toBe(404);
    expect((JSON.parse(res.body) as { error: string }).error).toBe("code_not_found");
  });

  it("refuses a paused, expired or exhausted code with a reason", { timeout: 30_000 }, async () => {
    const owner = await makeUser("codes-owner");
    const org = await makeOrg(owner.cookies, "Orgs Test Codes");
    await sql`
      INSERT INTO gym_codes (gym_id, code, label, paused) VALUES
        (${org.org.id}, 'PAUSED', 'Paused', true)`;
    await sql`
      INSERT INTO gym_codes (gym_id, code, label, expires_at) VALUES
        (${org.org.id}, 'EXPIRD', 'Expired', now() - interval '1 day')`;
    await sql`
      INSERT INTO gym_codes (gym_id, code, label, uses, max_uses) VALUES
        (${org.org.id}, 'USEDUP', 'Used up', 3, 3)`;

    for (const [code, expected] of [
      ["PAUSED", "code_paused"],
      ["EXPIRD", "code_expired"],
      ["USEDUP", "code_exhausted"],
    ] as const) {
      const { cookies } = await makeUser(`codes-${code.toLowerCase()}`);
      const res = await post("/v1/orgs/join", { code }, { cookies });
      expect(res.statusCode).toBe(409);
      expect((JSON.parse(res.body) as { error: string }).error).toBe(expected);
    }
  });

  it("refuses to create a clinic — Kd ruling 2026-08-18, gyms and fitness centres only", { timeout: 30_000 }, async () => {
    const { cookies } = await makeUser("no-clinic");
    const res = await post(
      "/v1/orgs",
      { name: "Orgs Test No Clinic", country: "US", timezone: "America/New_York", orgType: "clinic" },
      { cookies },
    );
    expect(res.statusCode).toBe(400);
    // A studio is still a fitness business and stays available.
    const studio = await makeOrg(cookies, "Orgs Test Studio", { orgType: "studio" });
    expect(studio.org.orgType).toBe("studio");
  });

  it("a legacy clinic row still demands consent on join, and records it (Part 3 §2.4)", { timeout: 90_000 }, async () => {
    // The API can no longer CREATE a clinic, but the org type was never
    // deleted from the database and the consent gate must still protect a row
    // that already exists. Inserted directly, which is the only way such a row
    // can now come about — and the point of the test is that narrowing the
    // door did not quietly disarm the guard behind it.
    const owner = await makeUser("clinic-owner");
    const patient = await makeUser("clinic-patient");
    const inserted = await sql<{ id: string }[]>`
      INSERT INTO gyms (slug, name, org_type, timezone, locale, currency_display, owner_user_id)
      VALUES ('orgs-test-legacy-clinic', 'Orgs Test Legacy Clinic', 'clinic',
              'Asia/Kolkata', 'en', 'INR', ${owner.userId})
      RETURNING id`;
    const gymId = inserted[0]?.id;
    if (gymId === undefined) throw new Error("clinic fixture insert returned no row");
    await sql`
      INSERT INTO gym_codes (gym_id, code, label) VALUES (${gymId}, 'CLINIC', 'Front Desk')`;
    // The staff row that `POST /v1/orgs` would have written. It was not needed
    // while typing a code was the whole join; now the CONFIRM half needs a
    // human with the privilege, and without this the owner of this
    // hand-inserted clinic is not staff of it and gets the stranger's 404.
    await sql`
      INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${owner.userId}, 'owner')`;

    const refused = await post(
      "/v1/orgs/join",
      { code: "CLINIC" },
      { cookies: patient.cookies },
    );
    expect(refused.statusCode).toBe(400);
    expect((JSON.parse(refused.body) as { error: string }).error).toBe("consent_required");

    const accepted = await post(
      "/v1/orgs/join",
      { code: "CLINIC", consent: true },
      { cookies: patient.cookies },
    );
    expect(accepted.statusCode).toBe(200);
    const applicationId = (JSON.parse(accepted.body) as { application: { id: string } })
      .application.id;
    // The consent is stamped on the APPLICATION, at the moment the person
    // agreed — not at the moment the front desk got round to them.
    const applied = await sql<{ consent_at: Date | null }[]>`
      SELECT consent_at FROM gym_join_applications WHERE id = ${applicationId}`;
    const consentedAt = applied[0]?.consent_at ?? null;
    expect(consentedAt).not.toBeNull();

    const confirm = await post(
      `/v1/orgs/${gymId}/applications/${applicationId}/confirm`,
      {},
      { cookies: owner.cookies },
    );
    expect(confirm.statusCode).toBe(200);
    // …and CARRIED ONTO the membership rather than re-stamped, so the DPDP
    // record dates the agreement and not the paperwork.
    const row = await sql<{ consent_at: Date | null }[]>`
      SELECT consent_at FROM gym_members
      WHERE gym_id = ${gymId} AND user_id = ${patient.userId} AND removed_at IS NULL`;
    expect(row[0]?.consent_at).not.toBeNull();
    expect(row[0]?.consent_at?.getTime()).toBe(consentedAt?.getTime());
  });

  it("enforces the plan's seat cap, and the owner's complimentary seat does not consume one", { timeout: 90_000 }, async () => {
    const owner = await makeUser("cap-owner");
    const first = await makeUser("cap-first");
    const second = await makeUser("cap-second");
    const org = await makeOrg(owner.cookies, "Orgs Test Cap");
    await subscribeGym(org.org.id, CAP1_PLAN); // seat_cap = 1

    // The owner is already a member. If complimentary seats counted, this
    // first confirm would be the one refused.
    await joinAsMember(first.cookies, org, owner.cookies);

    // THE CAP NOW BITES AT CONFIRM, and applying is free: a full gym must
    // still ACCEPT the application, because the ruling's whole content is that
    // a waiting person consumes nothing. Refusing at the door would put the
    // seat check back on the joiner, where it was before.
    const secondApplication = await applyWithCode(second.cookies, org.joinCode.code);

    const full = await post(
      `/v1/orgs/${org.org.id}/applications/${secondApplication}/confirm`,
      {},
      { cookies: owner.cookies },
    );
    expect(full.statusCode).toBe(409);
    const body = JSON.parse(full.body) as { error: string; message: string };
    expect(body.error).toBe("seat_cap_reached");
    // THIS READER IS THE GYM, so the number IS named — the opposite of the
    // pre-ruling join, where the reader was the joiner and the cap was none of
    // their business. The owner cannot act on "no free places" without knowing
    // how many they bought.
    expect(body.message).toMatch(/\b1\b/);

    // AND THE PERSON IS STILL WAITING. A full gym must not throw the applicant
    // away — the owner adds a seat and taps again.
    const stillPending = await sql<{ status: string }[]>`
      SELECT status FROM gym_join_applications WHERE id = ${secondApplication}`;
    expect(stillPending[0]?.status).toBe("pending");
    const queue = await get(`/v1/orgs/${org.org.id}/applications`, { cookies: owner.cookies });
    expect(
      (JSON.parse(queue.body) as { items: { id: string }[] }).items.map((i) => i.id),
    ).toContain(secondApplication);

    // T3 ROUND 1 C/H-1 — the regression, carried across the rewrite. A person
    // who is ALREADY in the gym re-submits the code while the gym is full.
    // They are not asking for a seat; they hold one, and they are inside the
    // count the cap is compared against. Before the fix this answered "no free
    // places" to somebody standing in the gym.
    const rejoin = await post(
      "/v1/orgs/join",
      { code: org.joinCode.code },
      { cookies: first.cookies },
    );
    expect(rejoin.statusCode).toBe(200);
    expect((JSON.parse(rejoin.body) as { outcome: string }).outcome).toBe("already_member");

    // And the cap still bites for a genuinely new person — the fix must not
    // have opened the gate for everyone.
    const third = await makeUser("cap-third");
    const thirdApplication = await applyWithCode(third.cookies, org.joinCode.code);
    expect(
      (await post(
        `/v1/orgs/${org.org.id}/applications/${thirdApplication}/confirm`,
        {},
        { cookies: owner.cookies },
      )).statusCode,
    ).toBe(409);
  });

  it("joining a subscribed gym upgrades entitlements immediately (the §4.1 cache bust)", { timeout: 30_000 }, async () => {
    const owner = await makeUser("ent-owner");
    const member = await makeUser("ent-member");
    const org = await makeOrg(owner.cookies, "Orgs Test Ent");
    await subscribeGym(org.org.id, "org_micro"); // member_entitlements = the Pro doc

    // Populate the cache with the free answer FIRST — without this read the
    // assertion below passes on a cold cache and proves nothing.
    const before = await get("/v1/entitlements/me", { cookies: member.cookies });
    expect(before.statusCode).toBe(200);
    const beforeBody = JSON.parse(before.body) as {
      source: string;
      entitlements: { history_days: number };
    };
    expect(beforeBody.source).toBe("free");
    expect(beforeBody.entitlements.history_days).toBe(90);

    // APPLYING GRANTS NOTHING. This is the ruling's entire content on the
    // entitlements side, and it is asserted BETWEEN the two reads rather than
    // as a separate test, because the cache is warm here and nowhere else —
    // the cheap version of this assertion passes on a cold cache and proves
    // nothing (:10010's own fixture lesson, in the same test).
    const applicationId = await applyWithCode(member.cookies, org.joinCode.code);
    const pending = await get("/v1/entitlements/me", { cookies: member.cookies });
    const pendingBody = JSON.parse(pending.body) as {
      source: string;
      entitlements: { history_days: number };
    };
    expect(pendingBody.source).toBe("free");
    expect(pendingBody.entitlements.history_days).toBe(90);

    const confirmed = await post(
      `/v1/orgs/${org.org.id}/applications/${applicationId}/confirm`,
      {},
      { cookies: owner.cookies },
    );
    expect(confirmed.statusCode).toBe(200);

    const after = await get("/v1/entitlements/me", { cookies: member.cookies });
    const afterBody = JSON.parse(after.body) as {
      source: string;
      entitlements: { history_days: number };
    };
    expect(afterBody.source).toBe("gym_membership");
    expect(afterBody.entitlements.history_days).toBe(-1);
  });

  it("PERMANENT GUARD: a pending applicant is invisible to every reader of live membership", { timeout: 60_000 }, async () => {
    // :5348 rule 5 — a bug CLASS gets an automated check so it cannot silently
    // return. The class here is the one the separate table was chosen to
    // prevent: eleven places across six server files read
    // `removed_at IS NULL` as "live member", and a pending person must appear
    // in NONE of them. This test is what makes that a property of the SUITE
    // rather than a property of the design being remembered.
    const owner = await makeUser("guard-owner");
    const waiting = await makeUser("guard-waiting");
    const org = await makeOrg(owner.cookies, "Orgs Test Guard");
    await subscribeGym(org.org.id, "org_micro"); // a gym whose plan grants Pro
    await applyWithCode(waiting.cookies, org.joinCode.code);

    // 1. The §4.1 entitlement resolver — the money one.
    const ent = await get("/v1/entitlements/me", { cookies: waiting.cookies });
    expect((JSON.parse(ent.body) as { source: string }).source).toBe("free");

    // 2. The roster: the gym does not see them as a member.
    const roster = await get(`/v1/orgs/${org.org.id}/members`, { cookies: owner.cookies });
    expect(
      (JSON.parse(roster.body) as { items: { userId: string }[] }).items.map((i) => i.userId),
    ).not.toContain(waiting.userId);

    // 3. `/mine`: the applicant is not shown as belonging to the gym.
    const mine = await get("/v1/orgs/mine", { cookies: waiting.cookies });
    expect(
      (JSON.parse(mine.body) as { orgs: { id: string }[] }).orgs.map((o) => o.id),
    ).not.toContain(org.org.id);

    // 4. The §4.2 seat count: a pending person occupies nothing.
    const seats = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_members
      WHERE gym_id = ${org.org.id} AND removed_at IS NULL AND complimentary = false`;
    expect(seats[0]?.n).toBe(0);

    // 5. The three per-module spend-attribution lookups — a pending applicant
    //    must not cause a gym to be BILLED for their API calls.
    //
    //    T3 SECURITY-PASS NOTE, fixed here: this check used to assert a
    //    HAND-WRITTEN COPY of the query, which is a guard that cannot see the
    //    thing it guards — if any of the three modules changed, the copy would
    //    keep passing while the real reader drifted. The REAL functions are
    //    called instead. They are three separate implementations by R7.1
    //    (module-local), so all three are named individually rather than
    //    trusting that "they are the same query": the day one of them changes
    //    is exactly the day this check has to notice.
    expect(await coachRepo.getLiveGymId(sql, waiting.userId)).toBeNull();
    expect(await geoRepo.getLiveGymId(sql, waiting.userId)).toBeNull();
    expect(await nutritionRepo.getLiveGymId(sql, waiting.userId)).toBeNull();

    // Positive control: the same three must find the gym for a CONFIRMED
    // member, or all three assertions above are satisfied by a function that
    // returns null for everybody.
    const confirmed = await makeUser("guard-confirmed");
    await joinAsMember(confirmed.cookies, org, owner.cookies);
    expect(await coachRepo.getLiveGymId(sql, confirmed.userId)).toBe(org.org.id);
    expect(await geoRepo.getLiveGymId(sql, confirmed.userId)).toBe(org.org.id);
    expect(await nutritionRepo.getLiveGymId(sql, confirmed.userId)).toBe(org.org.id);
  });

  it("confirms somebody who ALREADY holds a seat without charging a seat or a code use", { timeout: 90_000 }, async () => {
    // WRITTEN BECAUSE TWO MUTANTS SURVIVED (this card's own audit, rule 4).
    // `claimSeat`'s already-holds branch carries two guarantees — the T3 round
    // 1 C/H-1 regression fix, and "a repeat does not burn a code use" — and
    // BOTH lost their coverage when the door became an application door,
    // because the idempotent path now short-circuits at APPLY and never
    // reaches `claimSeat` at all. A fix whose protection cannot fail is the
    // same defect with a comment on it (:5104 F5), so the state is built
    // directly here.
    //
    // It is not a contrived state for long: the roster IMPORT creates
    // memberships with no code and no application, which is exactly this.
    const owner = await makeUser("held-owner");
    const member = await makeUser("held-member");
    const org = await makeOrg(owner.cookies, "Orgs Test Held");
    await subscribeGym(org.org.id, CAP1_PLAN); // seat_cap = 1
    const applicationId = await applyWithCode(member.cookies, org.joinCode.code);

    const codeRows = await sql<{ id: string }[]>`
      SELECT id FROM gym_codes WHERE code = ${org.joinCode.code}`;
    const codeId = codeRows[0]?.id;
    if (codeId === undefined) throw new Error("code fixture missing");
    await sql`
      INSERT INTO gym_members (gym_id, user_id, code_id, complimentary)
      VALUES (${org.org.id}, ${member.userId}, ${codeId}, false)`;

    // The gym is now FULL (one non-complimentary member on a one-seat plan)
    // and the person waiting is that member. Confirming must succeed: they are
    // not asking for a seat, they are inside the count the cap is compared
    // against.
    const confirm = await post(
      `/v1/orgs/${org.org.id}/applications/${applicationId}/confirm`,
      {},
      { cookies: owner.cookies },
    );
    expect(confirm.statusCode).toBe(200);
    expect((JSON.parse(confirm.body) as { status: string }).status).toBe("confirmed");

    // Exactly one membership, and the code's counter never moved — a repeat
    // must not retire a max_uses code early.
    const live = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_members
      WHERE gym_id = ${org.org.id} AND user_id = ${member.userId} AND removed_at IS NULL`;
    expect(live[0]?.n).toBe(1);
    const uses = await sql<{ uses: number }[]>`
      SELECT uses FROM gym_codes WHERE id = ${codeId}`;
    expect(uses[0]?.uses).toBe(0);
  });

  it("walks the confirm queue by cursor without dupes or gaps, oldest first", { timeout: 90_000 }, async () => {
    // WRITTEN BECAUSE A MUTANT SURVIVED: the roster's over-read-by-one mutant
    // silently began driving THIS query instead (both read `LIMIT
    // ${input.limit + 1}`, and a string replace takes the first match), so it
    // reported on a surface its own name disowned — :11757 L2's shape — and
    // the queue's paging had no test of its own either way.
    const owner = await makeUser("qpage-owner");
    const org = await makeOrg(owner.cookies, "Orgs Test Queue Paging");
    const applied: string[] = [];
    for (const n of ["q1", "q2", "q3"]) {
      const u = await makeUser(`qpage-${n}`);
      applied.push(await applyWithCode(u.cookies, org.joinCode.code));
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let hop = 0; hop < 10; hop++) {
      const path: string =
        cursor === null
          ? `/v1/orgs/${org.org.id}/applications?limit=2`
          : `/v1/orgs/${org.org.id}/applications?limit=2&cursor=${encodeURIComponent(cursor)}`;
      const res = await get(path, { cookies: owner.cookies });
      expect(res.statusCode).toBe(200);
      const page = JSON.parse(res.body) as {
        items: { id: string }[];
        nextCursor: string | null;
        pendingCount: number;
      };
      expect(page.items.length).toBeLessThanOrEqual(2);
      // The count is over the WHOLE queue, never this page — a console
      // printing `items.length` would say "2 people waiting" out of three.
      expect(page.pendingCount).toBe(3);
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
      if (cursor === null) break;
    }
    // Oldest first, all three, each exactly once.
    expect(seen).toEqual(applied);

    // T3 L-2: a well-formed cursor naming a row THIS GYM does not have falls
    // back to the first page instead of blanking the queue. The scalar
    // subquery returns nothing, `(applied_at, id) > NULL` is NULL rather than
    // false, and NULL filters every row out — so the console showed an empty
    // list under a count still reporting three people waiting. A malformed
    // cursor already restarted; a stale one must too.
    const stale = await get(
      `/v1/orgs/${org.org.id}/applications?limit=2&cursor=33333333-3333-3333-3333-333333333333`,
      { cookies: owner.cookies },
    );
    expect(stale.statusCode).toBe(200);
    const stalePage = JSON.parse(stale.body) as {
      items: { id: string }[];
      pendingCount: number;
    };
    expect(stalePage.pendingCount).toBe(3);
    // The page and the count agree — which is the whole defect, stated as an
    // assertion rather than as "not empty".
    expect(stalePage.items.map((i) => i.id)).toEqual(applied.slice(0, 2));
  });

  it("busts a stale cache when an existing member re-types the code", { timeout: 90_000 }, async () => {
    // WRITTEN BECAUSE A MUTANT SURVIVED. The `already_member` arm's cache bust
    // was defended by a comment ("a stale free-plan answer is what a second
    // attempt is often trying to shake loose") and by nothing else. A claim in
    // a comment is not a test.
    const owner = await makeUser("stale-owner");
    const member = await makeUser("stale-member");
    const org = await makeOrg(owner.cookies, "Orgs Test Stale");
    await joinAsMember(member.cookies, org, owner.cookies);

    // Cache the FREE answer while the gym has no subscription. Without this
    // read there is nothing stale to shake loose and the assertion below is
    // satisfied by a cold cache (:10010's own fixture lesson).
    const before = await get("/v1/entitlements/me", { cookies: member.cookies });
    expect((JSON.parse(before.body) as { source: string }).source).toBe("free");

    // The gym starts paying by a route that busts nobody's cache — which is
    // what a subscription webhook looked like before P3 existed.
    await subscribeGym(org.org.id, "org_micro");

    const retype = await post(
      "/v1/orgs/join",
      { code: org.joinCode.code },
      { cookies: member.cookies },
    );
    expect(retype.statusCode).toBe(200);
    expect((JSON.parse(retype.body) as { outcome: string }).outcome).toBe("already_member");

    const after = await get("/v1/entitlements/me", { cookies: member.cookies });
    expect((JSON.parse(after.body) as { source: string }).source).toBe("gym_membership");
  });

  it("stops a deleted account waiting in a gym's queue (DPDP Day 0)", { timeout: 30_000 }, async () => {
    const owner = await makeUser("del-owner");
    const leaver = await makeUser("del-leaver");
    const org = await makeOrg(owner.cookies, "Orgs Test Delete");
    const applicationId = await applyWithCode(leaver.cookies, org.joinCode.code);

    const deleted = await api().inject({
      method: "DELETE",
      url: "/v1/users/me",
      remoteAddress: nextIp(),
      cookies: leaver.cookies,
    });
    expect(deleted.statusCode).toBe(200);

    // The row is closed, so the front desk is not offered a person who has
    // left the product — and cannot tap them back into the gym.
    const row = await sql<{ status: string }[]>`
      SELECT status FROM gym_join_applications WHERE id = ${applicationId}`;
    expect(row[0]?.status).toBe("cancelled");
    const queue = await get(`/v1/orgs/${org.org.id}/applications`, { cookies: owner.cookies });
    const page = JSON.parse(queue.body) as { items: { id: string }[]; pendingCount: number };
    expect(page.items.map((i) => i.id)).not.toContain(applicationId);
    expect(page.pendingCount).toBe(0);

    const late = await post(
      `/v1/orgs/${org.org.id}/applications/${applicationId}/confirm`,
      {},
      { cookies: owner.cookies },
    );
    expect(late.statusCode).toBe(409);
    expect((JSON.parse(late.body) as { error: string }).error).toBe("application_cancelled");
  });

  it("serves the roster to staff and hides it from everyone else (R3.2)", { timeout: 90_000 }, async () => {
    const owner = await makeUser("roster-owner");
    const member = await makeUser("roster-member");
    const stranger = await makeUser("roster-stranger");
    const org = await makeOrg(owner.cookies, "Orgs Test Roster");
    await joinAsMember(member.cookies, org, owner.cookies);

    // T3 ROUND 1 C/H-3 — THE FIXTURE IS THE ASSERTION. A SECOND gym with its
    // own owner and its own member must exist, or "this roster is scoped to
    // one gym" is proven by nothing: with a single org in the fixture, the
    // mutation `WHERE gym_id = $1 OR true` was caught only by 48 unrelated rows
    // that happened to be lying around in the shared test database. On a clean
    // database the same mutant returns the identical two rows and survives —
    // the code was right and the protection was an accident.
    const otherOwner = await makeUser("roster-other-owner");
    const otherMember = await makeUser("roster-other-member");
    const otherOrg = await makeOrg(otherOwner.cookies, "Orgs Test Roster Other");
    await joinAsMember(otherMember.cookies, otherOrg, otherOwner.cookies);

    const mine = await get(`/v1/orgs/${org.org.id}/members`, { cookies: owner.cookies });
    expect(mine.statusCode).toBe(200);
    const page = JSON.parse(mine.body) as {
      items: { userId: string; displayName: string; complimentary: boolean; groupLabel: string | null }[];
      nextCursor: string | null;
    };
    // THE SCOPING ASSERTION COMES FIRST, ON PURPOSE. It names the two people
    // this test itself put in ANOTHER gym, so when it fails it says whose row
    // leaked — and it fails on the fixture's OWN rows rather than on whatever
    // else happens to be in a shared database. Ordered ahead of the set
    // equality below because that one is satisfied by an accident of history
    // on a shared database and reports "expected 50 to equal 2", which is not
    // evidence about this test's subject at all.
    const rosterIds = page.items.map((i) => i.userId);
    expect(rosterIds).not.toContain(otherOwner.userId);
    expect(rosterIds).not.toContain(otherMember.userId);

    expect(rosterIds.slice().sort()).toEqual([owner.userId, member.userId].sort());
    expect(page.items.find((i) => i.userId === owner.userId)?.complimentary).toBe(true);
    expect(page.items.find((i) => i.userId === member.userId)?.groupLabel).toBe("Front Desk");
    // Part 3 §2.4: nothing outside the boundary is even in the shape.
    for (const item of page.items) {
      expect(Object.keys(item).sort()).toEqual(
        ["complimentary", "displayName", "groupLabel", "joinedAt", "userId"].sort(),
      );
    }

    // A stranger with the org's uuid must not learn it exists.
    const foreign = await get(`/v1/orgs/${org.org.id}/members`, { cookies: stranger.cookies });
    expect(foreign.statusCode).toBe(404);

    // A MEMBER is not staff — same answer, for the same reason.
    const asMember = await get(`/v1/orgs/${org.org.id}/members`, { cookies: member.cookies });
    expect(asMember.statusCode).toBe(404);
  });

  it("rejects a non-uuid :gymId as a 400, not a 500", { timeout: 30_000 }, async () => {
    const { cookies } = await makeUser("badid");
    expect((await get("/v1/orgs/not-a-uuid/members", { cookies })).statusCode).toBe(400);
    expect((await get("/v1/orgs/not-a-uuid/codes", { cookies })).statusCode).toBe(400);
  });

  it("serves the gym's join codes to staff and hides them from everyone else (R3.2)", { timeout: 30_000 }, async () => {
    const owner = await makeUser("jc-owner");
    const member = await makeUser("jc-member");
    const stranger = await makeUser("jc-stranger");
    const org = await makeOrg(owner.cookies, "Orgs Test Joincodes");
    await joinAsMember(member.cookies, org, owner.cookies);

    // THE FIXTURE IS THE ASSERTION (T3 round 1 C/H-3, applied before the
    // defect rather than after it). A SECOND gym with its own code has to
    // exist, or "codes are scoped to one gym" is proven by nothing — the
    // mutation `WHERE gym_id = $1 OR true` would return this gym's single code
    // and survive on a clean database.
    const otherOwner = await makeUser("jc-other-owner");
    const otherOrg = await makeOrg(otherOwner.cookies, "Orgs Test Joincodes Other");

    const mine = await get(`/v1/orgs/${org.org.id}/codes`, { cookies: owner.cookies });
    expect(mine.statusCode).toBe(200);
    const body = JSON.parse(mine.body) as {
      codes: {
        code: string;
        label: string;
        paused: boolean;
        expiresAt: string | null;
        maxUses: number | null;
        uses: number;
      }[];
    };
    const codes = body.codes.map((c) => c.code);
    // Scoping first, naming the code this test itself put in ANOTHER gym, so a
    // failure says which gym's code leaked instead of "expected 2 to equal 1".
    expect(codes).not.toContain(otherOrg.joinCode.code);
    expect(codes).toEqual([org.joinCode.code]);

    const only = body.codes[0];
    expect(only?.label).toBe("Front Desk");
    expect(only?.paused).toBe(false);
    expect(only?.expiresAt).toBeNull();
    expect(only?.maxUses).toBeNull();
    // The member joined through it, so the counter moved — proof the console is
    // reading the live row rather than an echo of the create response.
    expect(only?.uses).toBe(1);
    // The shape is closed: a field added here reaches an org-facing screen.
    for (const c of body.codes) {
      expect(Object.keys(c).sort()).toEqual(
        ["code", "expiresAt", "label", "maxUses", "paused", "uses"].sort(),
      );
    }

    // A stranger with the org's uuid must not learn it exists; a MEMBER is not
    // staff and gets the same answer — both for the roster's reasons.
    expect(
      (await get(`/v1/orgs/${org.org.id}/codes`, { cookies: stranger.cookies })).statusCode,
    ).toBe(404);
    expect(
      (await get(`/v1/orgs/${org.org.id}/codes`, { cookies: member.cookies })).statusCode,
    ).toBe(404);
  });

  it("reports a code's live state honestly, so the console cannot print a dead one", { timeout: 30_000 }, async () => {
    const owner = await makeUser("jc-state");
    const org = await makeOrg(owner.cookies, "Orgs Test Joincodes State");
    const past = new Date(Date.now() - 60_000);
    await sql`
      UPDATE gym_codes SET paused = true, expires_at = ${past}, max_uses = 5, uses = 5
      WHERE gym_id = ${org.org.id}`;

    const res = await get(`/v1/orgs/${org.org.id}/codes`, { cookies: owner.cookies });
    expect(res.statusCode).toBe(200);
    const c = (JSON.parse(res.body) as { codes: { paused: boolean; expiresAt: string | null; maxUses: number | null; uses: number }[] }).codes[0];
    expect(c?.paused).toBe(true);
    expect(c?.expiresAt).toBe(past.toISOString());
    expect(c?.maxUses).toBe(5);
    expect(c?.uses).toBe(5);
    // And the join path agrees with what the console is about to draw — the
    // two must not be able to disagree about whether a code works.
    const joiner = await makeUser("jc-state-joiner");
    const attempt = await post(
      "/v1/orgs/join",
      { code: org.joinCode.code },
      { cookies: joiner.cookies },
    );
    expect(attempt.statusCode).toBe(409);
  });

  it("never mints a slug the console's own router has already spent (T3 L-2)", { timeout: 30_000 }, async () => {
    const owner = await makeUser("jc-reserved");
    // `/console/new` is declared ahead of `/console/:orgSlug`, so a gym slugged
    // `new` shows in its owner's list and lands them on the CREATE FORM when
    // they click it. End-to-end here rather than only on the pure helper,
    // because the slug is what the ROW carries and nothing later can repair it.
    const created = await makeOrg(owner.cookies, "New");
    expect(created.org.slug).not.toBe("new");
    // Prefix rather than equality: a leftover `new-gym` from an aborted run
    // makes the create path retry with a short suffix, which is correct
    // behaviour and must not read as this test failing.
    expect(created.org.slug).toMatch(/^new-gym/);
  });

  it("bounds the codes list like every other list in this module (T3 L-1)", { timeout: 60_000 }, async () => {
    const owner = await makeUser("jc-limit");
    const org = await makeOrg(owner.cookies, "Orgs Test Joincodes Limit");
    // One over the cap, so the bound is exercised rather than merely present.
    const extra = orgRepo.ORG_CODES_LIMIT; // + the gym's own Front Desk code
    const values = Array.from({ length: extra }, (_, i) => ({
      gym_id: org.org.id,
      code: `ZZ${String(i).padStart(4, "0")}`,
      label: `Bulk ${String(i)}`,
    }));
    await sql`INSERT INTO gym_codes ${sql(values, "gym_id", "code", "label")}`;

    const res = await get(`/v1/orgs/${org.org.id}/codes`, { cookies: owner.cookies });
    expect(res.statusCode).toBe(200);
    const { codes } = JSON.parse(res.body) as { codes: { code: string }[] };
    expect(codes).toHaveLength(orgRepo.ORG_CODES_LIMIT);
    // Oldest-first is the declared order, so the gym's own first code survives
    // the truncation — the one the console actually needs.
    expect(codes[0]?.code).toBe(org.joinCode.code);
  });

  it("gives a studio TRAINER the join codes even though it holds them off the roster (§2.2)", { timeout: 30_000 }, async () => {
    const studioOwner = await makeUser("jc-trainer-owner");
    const trainer = await makeUser("jc-trainer");
    const studio = await makeOrg(studioOwner.cookies, "Orgs Test Joincodes Trainer", {
      orgType: "studio",
    });
    await sql`
      INSERT INTO gym_staff (gym_id, user_id, role)
      VALUES (${studio.org.id}, ${trainer.userId}, 'trainer')`;

    // §2.2 grants Invite to all three roles; the group-scoping hold-back is
    // about the MEMBER LIST only. A trainer who cannot read the roster can
    // still hand a walk-in the poster code.
    expect(
      (await get(`/v1/orgs/${studio.org.id}/members`, { cookies: trainer.cookies })).statusCode,
    ).toBe(403);
    const codes = await get(`/v1/orgs/${studio.org.id}/codes`, { cookies: trainer.cookies });
    expect(codes.statusCode).toBe(200);
    expect((JSON.parse(codes.body) as { codes: { code: string }[] }).codes[0]?.code).toBe(
      studio.joinCode.code,
    );
  });

  it("walks the roster by cursor without dupes or gaps (R7.3)", { timeout: 90_000 }, async () => {
    const owner = await makeUser("page-owner");
    const org = await makeOrg(owner.cookies, "Orgs Test Paging");
    for (const n of ["p1", "p2", "p3"]) {
      const u = await makeUser(`page-${n}`);
      await joinAsMember(u.cookies, org, owner.cookies);
    }
    const all = JSON.parse(
      (await get(`/v1/orgs/${org.org.id}/members?limit=100`, { cookies: owner.cookies })).body,
    ) as { items: { userId: string }[] };
    expect(all.items).toHaveLength(4); // owner + 3

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let hop = 0; hop < 10; hop++) {
      const path: string =
        cursor === null
          ? `/v1/orgs/${org.org.id}/members?limit=2`
          : `/v1/orgs/${org.org.id}/members?limit=2&cursor=${encodeURIComponent(cursor)}`;
      const res = await get(path, { cookies: owner.cookies });
      expect(res.statusCode).toBe(200);
      const page = JSON.parse(res.body) as {
        items: { userId: string }[];
        nextCursor: string | null;
      };
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((i) => i.userId));
      cursor = page.nextCursor;
      if (cursor === null) break;
    }
    expect(seen).toEqual(all.items.map((i) => i.userId));
  });

  it("gives a gym trainer the roster and holds a studio trainer back (§2.2/§2.3)", { timeout: 30_000 }, async () => {
    const owner = await makeUser("trainer-owner");
    const trainer = await makeUser("trainer-user");
    const gym = await makeOrg(owner.cookies, "Orgs Test Trainer Gym");
    const studioOwner = await makeUser("trainer-studio-owner");
    // Was a clinic before Kd's 2026-08-18 ruling. A studio exercises the same
    // branch — §2.3 makes group scoping core for studios too — and is a type
    // the product still has.
    const studio = await makeOrg(studioOwner.cookies, "Orgs Test Trainer Studio", {
      orgType: "studio",
    });
    await sql`
      INSERT INTO gym_staff (gym_id, user_id, role) VALUES
        (${gym.org.id}, ${trainer.userId}, 'trainer'),
        (${studio.org.id}, ${trainer.userId}, 'trainer')`;

    expect(
      (await get(`/v1/orgs/${gym.org.id}/members`, { cookies: trainer.cookies })).statusCode,
    ).toBe(200);
    const held = await get(`/v1/orgs/${studio.org.id}/members`, { cookies: trainer.cookies });
    expect(held.statusCode).toBe(403);
    expect((JSON.parse(held.body) as { error: string }).error).toBe("trainer_scope_unavailable");
  });

  it("lists my orgs once each, carrying both relationships", { timeout: 30_000 }, async () => {
    const owner = await makeUser("mine-owner");
    const org = await makeOrg(owner.cookies, "Orgs Test Mine");
    const res = await get("/v1/orgs/mine", { cookies: owner.cookies });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      orgs: { id: string; staffRole: string | null; isMember: boolean; joinedAt: string | null }[];
    };
    const rows = body.orgs.filter((o) => o.id === org.org.id);
    expect(rows).toHaveLength(1); // owner AND member — still one row
    expect(rows[0]?.staffRole).toBe("owner");
    expect(rows[0]?.isMember).toBe(true);
    expect(rows[0]?.joinedAt).not.toBeNull();

    // Somebody else's org is not in my list.
    const other = await makeUser("mine-other");
    const otherRes = await get("/v1/orgs/mine", { cookies: other.cookies });
    const otherBody = JSON.parse(otherRes.body) as { orgs: { id: string }[] };
    expect(otherBody.orgs.map((o) => o.id)).not.toContain(org.org.id);
  });

  it("sells the last seat exactly once under real concurrency (Part 4 §4.2's lock)", { timeout: 60_000 }, async () => {
    const owner = await makeUser("race-owner");
    const a = await makeUser("race-a");
    const b = await makeUser("race-b");
    const org = await makeOrg(owner.cookies, "Orgs Test Race");
    await subscribeGym(org.org.id, CAP1_PLAN); // seat_cap = 1

    // Two SEPARATE clients: the app's own pool is max:1 and would serialise
    // these for us, which would make the assertion true with the lock removed.
    // Both apply first — applying is free and takes no lock, so the race that
    // matters has moved to the CONFIRM tap. Two front-desk staff working the
    // queue at the same moment is the real-world version of this.
    const appA = await applyWithCode(a.cookies, org.joinCode.code);
    const appB = await applyWithCode(b.cookies, org.joinCode.code);

    const c1 = postgres(url ?? "", { prepare: false, max: 1 });
    const c2 = postgres(url ?? "", { prepare: false, max: 1 });
    try {
      const [r1, r2] = await Promise.all([
        orgRepo.confirmApplication(c1, {
          gymId: org.org.id,
          applicationId: appA,
          actorUserId: owner.userId,
        }),
        orgRepo.confirmApplication(c2, {
          gymId: org.org.id,
          applicationId: appB,
          actorUserId: owner.userId,
        }),
      ]);
      const kinds = [r1.kind, r2.kind].sort();
      expect(kinds).toEqual(["confirmed", "seat_cap"]);
    } finally {
      await c1.end({ timeout: 5 });
      await c2.end({ timeout: 5 });
    }

    const live = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_members
      WHERE gym_id = ${org.org.id} AND removed_at IS NULL AND complimentary = false`;
    expect(live[0]?.n).toBe(1);
  });

  it("collapses two simultaneous APPLIES by the same person into one application", { timeout: 60_000 }, async () => {
    const owner = await makeUser("dbl-owner");
    const eager = await makeUser("dbl-eager");
    const org = await makeOrg(owner.cookies, "Orgs Test Double");

    // Carried by `gym_join_applications_pending_uq` + ON CONFLICT, NOT by a
    // lock — the apply path deliberately takes none. That is the same honest
    // reading T3 round 1 L-6 forced on this test's ancestor: it proves the
    // idempotent path holds when two transactions genuinely overlap, and it
    // proves nothing about any FOR UPDATE.
    const c1 = postgres(url ?? "", { prepare: false, max: 1 });
    const c2 = postgres(url ?? "", { prepare: false, max: 1 });
    try {
      const results = await Promise.all([
        orgRepo.applyByCode(c1, { userId: eager.userId, code: org.joinCode.code, consent: false }),
        orgRepo.applyByCode(c2, { userId: eager.userId, code: org.joinCode.code, consent: false }),
      ]);
      expect(results.map((r) => r.kind).sort()).toEqual(["already_pending", "pending"]);
    } finally {
      await c1.end({ timeout: 5 });
      await c2.end({ timeout: 5 });
    }

    const rows = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_join_applications
      WHERE gym_id = ${org.org.id} AND user_id = ${eager.userId} AND status = 'pending'`;
    expect(rows[0]?.n).toBe(1);
    // Still nothing spent and nobody let in.
    const uses = await sql<{ uses: number }[]>`
      SELECT uses FROM gym_codes WHERE code = ${org.joinCode.code}`;
    expect(uses[0]?.uses).toBe(0);
  });

  it("collapses two simultaneous CONFIRMS of one application into one membership", { timeout: 60_000 }, async () => {
    const owner = await makeUser("dblc-owner");
    const applicant = await makeUser("dblc-applicant");
    const org = await makeOrg(owner.cookies, "Orgs Test Double Confirm");
    const applicationId = await applyWithCode(applicant.cookies, org.joinCode.code);

    // Two people at the front desk tapping the same row. The application's own
    // `FOR UPDATE` is what serialises them, so the loser reads a row that is
    // already `confirmed` rather than writing a second membership.
    const c1 = postgres(url ?? "", { prepare: false, max: 1 });
    const c2 = postgres(url ?? "", { prepare: false, max: 1 });
    try {
      const results = await Promise.all([
        orgRepo.confirmApplication(c1, {
          gymId: org.org.id,
          applicationId,
          actorUserId: owner.userId,
        }),
        orgRepo.confirmApplication(c2, {
          gymId: org.org.id,
          applicationId,
          actorUserId: owner.userId,
        }),
      ]);
      expect(results.map((r) => r.kind).sort()).toEqual(["already_confirmed", "confirmed"]);
    } finally {
      await c1.end({ timeout: 5 });
      await c2.end({ timeout: 5 });
    }

    const rows = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_members
      WHERE gym_id = ${org.org.id} AND user_id = ${applicant.userId} AND removed_at IS NULL`;
    expect(rows[0]?.n).toBe(1);
    // One membership, ONE use — a double tap must not retire a max_uses code
    // early.
    const uses = await sql<{ uses: number }[]>`
      SELECT uses FROM gym_codes WHERE code = ${org.joinCode.code}`;
    expect(uses[0]?.uses).toBe(1);
  });
});
