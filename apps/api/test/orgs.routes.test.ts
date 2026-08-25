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
import * as orgService from "../src/modules/orgs/service.js";
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

  const patch = (
    path: string,
    payload: unknown,
    opts: { cookies?: Record<string, string> } = {},
  ) =>
    api().inject({
      method: "PATCH",
      url: path,
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      cookies: opts.cookies ?? {},
      payload: JSON.stringify(payload),
    });

  /** The ticks route replaces a whole set, so it is a PUT. `fastify.inject`
   *  cannot see the CORS preflight this needs in a browser — `app.ts` lists the
   *  method and the SMOKE is what proves it (Card 4's dead-method precedent). */
  const put = (
    path: string,
    payload: unknown,
    opts: { cookies?: Record<string, string> } = {},
  ) =>
    api().inject({
      method: "PUT",
      url: path,
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      cookies: opts.cookies ?? {},
      payload: JSON.stringify(payload),
    });

  interface CodeBody {
    code: string;
    label: string;
    paused: boolean;
    expiresAt: string | null;
    maxUses: number | null;
    /** People in the gym NOW through this code — see `orgCodeSchema`. */
    joined: number;
  }

  const readCodes = async (gymId: string, cookies: Record<string, string>) => {
    const res = await get(`/v1/orgs/${gymId}/codes`, { cookies });
    expect(res.statusCode).toBe(200);
    return (JSON.parse(res.body) as { codes: CodeBody[] }).codes;
  };

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
    // The code-management card's three, added HERE rather than in its own
    // block, because L-1's finding was precisely that a card can add routes and
    // leave this list naming the old ones. The list is the claim; it has to
    // grow with the module.
    const someCode = "K7QM2X";
    expect((await post(`/v1/orgs/${someGym}/codes`, {})).statusCode).toBe(401);
    expect((await patch(`/v1/orgs/${someGym}/codes/${someCode}`, { paused: true })).statusCode).toBe(
      401,
    );
    expect((await post(`/v1/orgs/${someGym}/codes/${someCode}/rotate`, {})).statusCode).toBe(401);
    // T3 L-2: added the day removal shipped, because this list had already been
    // named in its own comment as the thing a new card forgets. Twice now.
    expect((await del(`/v1/orgs/${someGym}/codes/${someCode}`)).statusCode).toBe(401);
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
    await subscribeGym(org.org.id, "org_b1_in_m"); // member_entitlements = the gym-member doc
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
    // FULL means "the people it let in are still in" — the fixture has to put a
    // real member behind the code, because a `uses` counter is no longer what the
    // door measures (Kd's smoke, 2026-08-21). Setting `uses = 3` here would have
    // been a fixture that proves nothing while staying green (:5104 F5).
    const usedUp = await sql<{ id: string }[]>`
      INSERT INTO gym_codes (gym_id, code, label, max_uses) VALUES
        (${org.org.id}, 'USEDUP', 'Used up', 1) RETURNING id`;
    const filler = await makeUser("codes-filler");
    await sql`
      INSERT INTO gym_members (gym_id, user_id, code_id, complimentary)
      VALUES (${org.org.id}, ${filler.userId}, ${usedUp[0]?.id ?? null}, false)`;

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
    await subscribeGym(org.org.id, "org_b1_in_m"); // member_entitlements = the gym-member doc

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
    await subscribeGym(org.org.id, "org_b1_in_m"); // a gym whose plan grants the member block
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
    await subscribeGym(org.org.id, "org_b1_in_m");

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
    //
    // `takesSeat` was argued INTO this list on 2026-08-22 (:14953), not waved
    // through: it is a fact about the gym's own bill, the same kind as
    // `complimentary` beside it, and it deliberately does not say "staff".
    for (const item of page.items) {
      expect(Object.keys(item).sort()).toEqual(
        ["complimentary", "displayName", "groupLabel", "joinedAt", "takesSeat", "userId"].sort(),
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
        joined: number;
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
    // The member joined through it, so the count moved — proof the console is
    // reading the live row rather than an echo of the create response. ONE and
    // not two: the owner's own seat carries this code and is complimentary.
    expect(only?.joined).toBe(1);
    // The shape is closed: a field added here reaches an org-facing screen.
    for (const c of body.codes) {
      expect(Object.keys(c).sort()).toEqual(
        ["code", "expiresAt", "joined", "label", "maxUses", "paused"].sort(),
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

  it("reports a code's live state honestly, so the console cannot print a dead one", { timeout: 60_000 }, async () => {
    const owner = await makeUser("jc-state");
    const member = await makeUser("jc-state-member");
    const org = await makeOrg(owner.cookies, "Orgs Test Joincodes State");
    // A REAL member behind the code, so `joined` is a number this test can be
    // wrong about. The owner's own §4.0-step-6 seat carries this same code and
    // is complimentary, so the answer below is 1 and not 2 — which is the whole
    // defect Kd's smoke found.
    await joinAsMember(member.cookies, org, owner.cookies);
    const past = new Date(Date.now() - 60_000);
    await sql`
      UPDATE gym_codes SET paused = true, expires_at = ${past}, max_uses = 5
      WHERE gym_id = ${org.org.id}`;

    const res = await get(`/v1/orgs/${org.org.id}/codes`, { cookies: owner.cookies });
    expect(res.statusCode).toBe(200);
    const c = (JSON.parse(res.body) as { codes: CodeBody[] }).codes[0];
    expect(c?.paused).toBe(true);
    expect(c?.expiresAt).toBe(past.toISOString());
    expect(c?.maxUses).toBe(5);
    expect(c?.joined).toBe(1);
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

  // ── CODE MANAGEMENT (Part 3 §2.2 "Create / rotate / expire codes", §3.3's
  //    write half, §7's leaked-code answer) ────────────────────────────────
  //
  // The state machine these tests pin was ALREADY BUILT AND ALREADY ENFORCED —
  // `applyByCode` has refused paused, expired and exhausted codes since the
  // door was built. What was missing was any way for a gym to REACH those
  // states, so every assertion below that ends in a join attempt is checking
  // the two halves agree, which is the whole risk in this card: a console that
  // says "paused" over a code the join path still honours is the false-on-screen
  // defect (:5807), and the only way to catch it is to drive both sides.

  it("makes a new code that a member can actually join with", { timeout: 60_000 }, async () => {
    const owner = await makeUser("mkcode-owner");
    const joiner = await makeUser("mkcode-joiner");
    const org = await makeOrg(owner.cookies, "Orgs Test Make Code");

    const res = await post(`/v1/orgs/${org.org.id}/codes`, {}, { cookies: owner.cookies });
    expect(res.statusCode).toBe(201);
    const { code } = JSON.parse(res.body) as { code: CodeBody };

    // A DIFFERENT code from the gym's first, on the alphabet, with the two
    // restrictions genuinely absent rather than defaulted to something.
    expect(code.code).not.toBe(org.joinCode.code);
    expect(code.code).toHaveLength(6);
    // Indexed rather than spread: the alphabet is ASCII by construction, but a
    // spread over a string is UTF-16-naive in general and the linter is right
    // to say so. `charAt` cannot mishandle what this alphabet contains.
    for (let i = 0; i < code.code.length; i++) {
      expect(JOIN_CODE_ALPHABET).toContain(code.code.charAt(i));
    }
    expect(code.expiresAt).toBeNull();
    expect(code.maxUses).toBeNull();
    expect(code.joined).toBe(0);

    // THE HALF THAT MATTERS: the join door honours it. A create that returns a
    // plausible six characters nobody can join with would pass every assertion
    // above.
    const applied = await post("/v1/orgs/join", { code: code.code }, { cookies: joiner.cookies });
    expect(applied.statusCode).toBe(200);
    expect((JSON.parse(applied.body) as { outcome: string }).outcome).toBe("pending");

    // BOTH codes are live at once, and that is the design: making a code does
    // not retire the old one — rotate is the call that does both.
    const codes = await readCodes(org.org.id, owner.cookies);
    expect(codes).toHaveLength(2);
    expect(codes.every((c) => !c.paused)).toBe(true);
  });

  it("pauses a code — the join door refuses it — then wakes it up again", { timeout: 60_000 }, async () => {
    const owner = await makeUser("pause-owner");
    const joiner = await makeUser("pause-joiner");
    const org = await makeOrg(owner.cookies, "Orgs Test Pause Code");
    const target = org.joinCode.code;

    const paused = await patch(
      `/v1/orgs/${org.org.id}/codes/${target}`,
      { paused: true },
      { cookies: owner.cookies },
    );
    expect(paused.statusCode).toBe(200);
    expect((JSON.parse(paused.body) as { code: CodeBody }).code.paused).toBe(true);

    const refused = await post("/v1/orgs/join", { code: target }, { cookies: joiner.cookies });
    expect(refused.statusCode).toBe(409);
    expect((JSON.parse(refused.body) as { error: string }).error).toBe("code_paused");

    // REVERSIBLE, which is the whole difference between pause and expiry. A
    // pause that could not be undone is a delete with a friendlier word on it.
    const woken = await patch(
      `/v1/orgs/${org.org.id}/codes/${target}`,
      { paused: false },
      { cookies: owner.cookies },
    );
    expect(woken.statusCode).toBe(200);
    expect((JSON.parse(woken.body) as { code: CodeBody }).code.paused).toBe(false);

    const allowed = await post("/v1/orgs/join", { code: target }, { cookies: joiner.cookies });
    expect(allowed.statusCode).toBe(200);
  });

  it("sets a join limit, and the door refuses the person who would exceed it", { timeout: 90_000 }, async () => {
    const owner = await makeUser("codelimit-owner");
    const first = await makeUser("codelimit-first");
    const second = await makeUser("codelimit-second");
    const org = await makeOrg(owner.cookies, "Orgs Test Code Limit");
    const target = org.joinCode.code;

    const limited = await patch(
      `/v1/orgs/${org.org.id}/codes/${target}`,
      { maxUses: 1 },
      { cookies: owner.cookies },
    );
    expect(limited.statusCode).toBe(200);
    expect((JSON.parse(limited.body) as { code: CodeBody }).code.maxUses).toBe(1);

    // `joined` counts MEMBERSHIPS, not applications — burning a place at apply
    // time would let a stranger with a leaked code exhaust a gym's poster without
    // ever getting in. So the limit is only spent once the front desk confirms.
    await joinAsMember(first.cookies, org, owner.cookies);
    expect((await readCodes(org.org.id, owner.cookies))[0]?.joined).toBe(1);

    const refused = await post("/v1/orgs/join", { code: target }, { cookies: second.cookies });
    expect(refused.statusCode).toBe(409);
    expect((JSON.parse(refused.body) as { error: string }).error).toBe("code_exhausted");
  });

  it("refuses a limit BELOW the number who already joined, and names the count", { timeout: 60_000 }, async () => {
    const owner = await makeUser("below-owner");
    const member = await makeUser("below-member");
    const org = await makeOrg(owner.cookies, "Orgs Test Limit Below");
    await joinAsMember(member.cookies, org, owner.cookies);

    const res = await patch(
      `/v1/orgs/${org.org.id}/codes/${org.joinCode.code}`,
      { maxUses: 0 },
      { cookies: owner.cookies },
    );
    // 400 from the SCHEMA — `maxUses` is `.min(1)`, because "a limit of zero"
    // is pause wearing a number.
    expect(res.statusCode).toBe(400);

    // 1 is a legal number and still below this code's live `uses`, which is the
    // case the repo has to catch rather than the parser.
    const memberTwo = await makeUser("below-member-2");
    await joinAsMember(memberTwo.cookies, org, owner.cookies);
    const below = await patch(
      `/v1/orgs/${org.org.id}/codes/${org.joinCode.code}`,
      { maxUses: 1 },
      { cookies: owner.cookies },
    );
    expect(below.statusCode).toBe(409);
    const body = JSON.parse(below.body) as { error: string; message: string };
    expect(body.error).toBe("max_uses_below_uses");
    // The COUNT is in the sentence: an owner told "that's too low" without
    // being told what it is too low FOR has to go and count the roster.
    expect(body.message).toContain("2");

    // AND THE ROW IS UNCHANGED. A refusal that half-applied would be worse than
    // one that never ran.
    expect((await readCodes(org.org.id, owner.cookies))[0]?.maxUses).toBeNull();
  });

  it("refuses an end date in the past rather than storing a dead code", { timeout: 60_000 }, async () => {
    const owner = await makeUser("expast-owner");
    const org = await makeOrg(owner.cookies, "Orgs Test Expiry Past");

    const past = new Date(Date.now() - 60_000).toISOString();
    const created = await post(
      `/v1/orgs/${org.org.id}/codes`,
      { expiresAt: past },
      { cookies: owner.cookies },
    );
    expect(created.statusCode).toBe(400);
    expect((JSON.parse(created.body) as { error: string }).error).toBe("expiry_in_past");

    const patched = await patch(
      `/v1/orgs/${org.org.id}/codes/${org.joinCode.code}`,
      { expiresAt: past },
      { cookies: owner.cookies },
    );
    expect(patched.statusCode).toBe(400);
    expect((JSON.parse(patched.body) as { error: string }).error).toBe("expiry_in_past");

    // Nothing was created and nothing was changed — the gym still has exactly
    // its original code, unexpiring.
    const codes = await readCodes(org.org.id, owner.cookies);
    expect(codes).toHaveLength(1);
    expect(codes[0]?.expiresAt).toBeNull();
  });

  it("stores a FUTURE end date, and clearing it back to null is allowed", { timeout: 60_000 }, async () => {
    const owner = await makeUser("exfut-owner");
    const org = await makeOrg(owner.cookies, "Orgs Test Expiry Future");
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const set = await patch(
      `/v1/orgs/${org.org.id}/codes/${org.joinCode.code}`,
      { expiresAt: future },
      { cookies: owner.cookies },
    );
    expect(set.statusCode).toBe(200);
    expect((JSON.parse(set.body) as { code: CodeBody }).code.expiresAt).not.toBeNull();

    // `expiresAt: null` means "never expires" and MUST NOT be run past the
    // future check — a PATCH that refused it would leave an owner unable to
    // undo a date they had just set.
    const cleared = await patch(
      `/v1/orgs/${org.org.id}/codes/${org.joinCode.code}`,
      { expiresAt: null },
      { cookies: owner.cookies },
    );
    expect(cleared.statusCode).toBe(200);
    expect((JSON.parse(cleared.body) as { code: CodeBody }).code.expiresAt).toBeNull();
  });

  it("leaves fields the caller did not send ALONE (PATCH, not PUT)", { timeout: 60_000 }, async () => {
    const owner = await makeUser("patchonly-owner");
    const org = await makeOrg(owner.cookies, "Orgs Test Patch Only");
    const target = org.joinCode.code;
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await patch(
      `/v1/orgs/${org.org.id}/codes/${target}`,
      { expiresAt: future, maxUses: 25 },
      { cookies: owner.cookies },
    );
    // A screen that only knows about the pause switch sends only `paused` — and
    // must not silently wipe an expiry and a limit it never displayed.
    const res = await patch(
      `/v1/orgs/${org.org.id}/codes/${target}`,
      { paused: true },
      { cookies: owner.cookies },
    );
    expect(res.statusCode).toBe(200);
    const { code } = JSON.parse(res.body) as { code: CodeBody };
    expect(code.paused).toBe(true);
    expect(code.expiresAt).not.toBeNull();
    expect(code.maxUses).toBe(25);
  });

  it("refuses an empty change rather than reporting a success that did nothing", { timeout: 30_000 }, async () => {
    const owner = await makeUser("empty-owner");
    const org = await makeOrg(owner.cookies, "Orgs Test Empty Patch");
    const res = await patch(
      `/v1/orgs/${org.org.id}/codes/${org.joinCode.code}`,
      {},
      { cookies: owner.cookies },
    );
    expect(res.statusCode).toBe(400);
    // An unknown key is a 400 too (`.strict()`), so a client typo cannot be
    // read as a field this route quietly ignores.
    expect(
      (
        await patch(
          `/v1/orgs/${org.org.id}/codes/${org.joinCode.code}`,
          { label: "Morning Batch" },
          { cookies: owner.cookies },
        )
      ).statusCode,
    ).toBe(400);
  });

  it("rotates: the new code works, the old one stops, and BOTH land together", { timeout: 90_000 }, async () => {
    const owner = await makeUser("rot-owner");
    const oldJoiner = await makeUser("rot-old");
    const newJoiner = await makeUser("rot-new");
    const org = await makeOrg(owner.cookies, "Orgs Test Rotate");
    const leaked = org.joinCode.code;

    // THE OLD CODE IS GIVEN BOTH RESTRICTIONS FIRST, and that is what makes the
    // "carries none of them forward" assertions below able to fail at all.
    // The first draft rotated the gym's ORIGINAL code, which has no expiry and
    // no limit — so a rotate that copied them forward copied `null` and `null`,
    // and mutant O61 SURVIVED against a test that looked like it covered this.
    // The fixture was the hole, not the assertion (:5104 F5's shape).
    await patch(
      `/v1/orgs/${org.org.id}/codes/${leaked}`,
      { expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), maxUses: 5 },
      { cookies: owner.cookies },
    );

    const res = await post(
      `/v1/orgs/${org.org.id}/codes/${leaked}/rotate`,
      {},
      { cookies: owner.cookies },
    );
    expect(res.statusCode).toBe(201);
    const { code, replaced } = JSON.parse(res.body) as { code: CodeBody; replaced: CodeBody };

    expect(replaced.code).toBe(leaked);
    expect(replaced.paused).toBe(true);
    expect(code.code).not.toBe(leaked);
    expect(code.paused).toBe(false);
    // The new code carries the old one's LABEL and none of its restrictions —
    // copying an expiry forward would hand back a code that is already dead,
    // and copying the limit forward one that is already exhausted. Both are
    // asserted against an old code that genuinely HAS them (see the patch
    // above), so each assertion can fail.
    expect(code.label).toBe(replaced.label);
    expect(replaced.expiresAt).not.toBeNull();
    expect(replaced.maxUses).toBe(5);
    expect(code.expiresAt).toBeNull();
    expect(code.maxUses).toBeNull();

    // BOTH DIRECTIONS AGAINST THE REAL DOOR: the leaked one is shut, the
    // replacement is open. Either assertion alone would pass under a rotate
    // that did only half its job — which is exactly the failure the single
    // transaction exists to prevent.
    const onOld = await post("/v1/orgs/join", { code: leaked }, { cookies: oldJoiner.cookies });
    expect(onOld.statusCode).toBe(409);
    expect((JSON.parse(onOld.body) as { error: string }).error).toBe("code_paused");

    const onNew = await post("/v1/orgs/join", { code: code.code }, { cookies: newJoiner.cookies });
    expect(onNew.statusCode).toBe(200);
  });

  it("rotating does not touch anybody who already joined with the old code", { timeout: 90_000 }, async () => {
    const owner = await makeUser("rotkeep-owner");
    const member = await makeUser("rotkeep-member");
    const org = await makeOrg(owner.cookies, "Orgs Test Rotate Keeps");
    await joinAsMember(member.cookies, org, owner.cookies);

    const before = await get(`/v1/orgs/${org.org.id}/members?limit=100`, { cookies: owner.cookies });
    const beforeIds = (JSON.parse(before.body) as { items: { userId: string }[] }).items.map(
      (m) => m.userId,
    );
    expect(beforeIds).toContain(member.userId);

    await post(`/v1/orgs/${org.org.id}/codes/${org.joinCode.code}/rotate`, {}, { cookies: owner.cookies });

    // THE PROMISE MADE TO KD IN PLAIN WORDS: "anyone who already joined stays a
    // member". Turning a door off is not the same as evicting the people who
    // came through it.
    const after = await get(`/v1/orgs/${org.org.id}/members?limit=100`, { cookies: owner.cookies });
    const afterIds = (JSON.parse(after.body) as { items: { userId: string }[] }).items.map(
      (m) => m.userId,
    );
    expect(afterIds.sort()).toEqual(beforeIds.sort());
  });

  it("scopes every write to the OWNING gym — another gym's code is a 404, not a 403", { timeout: 90_000 }, async () => {
    const ownerA = await makeUser("xt-a-owner");
    const ownerB = await makeUser("xt-b-owner");
    const orgA = await makeOrg(ownerA.cookies, "Orgs Test XTenant A");
    const orgB = await makeOrg(ownerB.cookies, "Orgs Test XTenant B");

    // THE IDOR THIS TEST EXISTS FOR: a code is globally unique, so
    // `WHERE code = $1` alone would have found B's row and let A pause it.
    // Addressing B's code THROUGH A's gym must find nothing.
    const crossPatch = await patch(
      `/v1/orgs/${orgA.org.id}/codes/${orgB.joinCode.code}`,
      { paused: true },
      { cookies: ownerA.cookies },
    );
    expect(crossPatch.statusCode).toBe(404);

    const crossRotate = await post(
      `/v1/orgs/${orgA.org.id}/codes/${orgB.joinCode.code}/rotate`,
      {},
      { cookies: ownerA.cookies },
    );
    expect(crossRotate.statusCode).toBe(404);

    // Removal is the same IDOR wearing a third method: `WHERE code = $1` would
    // find B's row and take B's poster off B's screen.
    await patch(
      `/v1/orgs/${orgB.org.id}/codes/${orgB.joinCode.code}`,
      { paused: true },
      { cookies: ownerB.cookies },
    );
    const crossDelete = await del(`/v1/orgs/${orgA.org.id}/codes/${orgB.joinCode.code}`, {
      cookies: ownerA.cookies,
    });
    expect(crossDelete.statusCode).toBe(404);
    expect(await readCodes(orgB.org.id, ownerB.cookies)).toHaveLength(1);
    await patch(
      `/v1/orgs/${orgB.org.id}/codes/${orgB.joinCode.code}`,
      { paused: false },
      { cookies: ownerB.cookies },
    );

    // B's code is untouched and still opens B's door — the assertion that
    // proves the refusals above were refusals and not silent no-ops.
    const bCodes = await readCodes(orgB.org.id, ownerB.cookies);
    expect(bCodes).toHaveLength(1);
    expect(bCodes[0]?.paused).toBe(false);

    // And A cannot reach B's gym at all: 404 rather than 403, so a uuid is not
    // an oracle for which gyms exist.
    expect(
      (await post(`/v1/orgs/${orgB.org.id}/codes`, {}, { cookies: ownerA.cookies })).statusCode,
    ).toBe(404);
  });

  it("lets a MANAGER manage codes and refuses a TRAINER (§2.2's two separate rows)", { timeout: 90_000 }, async () => {
    const owner = await makeUser("cmpriv-owner");
    const manager = await makeUser("cmpriv-manager");
    const trainer = await makeUser("cmpriv-trainer");
    const org = await makeOrg(owner.cookies, "Orgs Test Code Privileges");
    await sql`
      INSERT INTO gym_staff (gym_id, user_id, role) VALUES
        (${org.org.id}, ${manager.userId}, 'manager'),
        (${org.org.id}, ${trainer.userId}, 'trainer')`;

    const managerMade = await post(`/v1/orgs/${org.org.id}/codes`, {}, { cookies: manager.cookies });
    expect(managerMade.statusCode).toBe(201);
    const spare = (JSON.parse(managerMade.body) as { code: CodeBody }).code.code;

    // THE SPLIT THAT MATTERS AND IS EASY TO GET WRONG: §2.2 grants Invite to
    // all three roles and "Create / rotate / expire codes" to two. So the same
    // trainer READS 200 and WRITES 403 — merging the two ticks would hand them
    // the gym's door under cover of a read they already had.
    expect(
      (await get(`/v1/orgs/${org.org.id}/codes`, { cookies: trainer.cookies })).statusCode,
    ).toBe(200);
    expect(
      (await post(`/v1/orgs/${org.org.id}/codes`, {}, { cookies: trainer.cookies })).statusCode,
    ).toBe(403);
    expect(
      (
        await patch(
          `/v1/orgs/${org.org.id}/codes/${org.joinCode.code}`,
          { paused: true },
          { cookies: trainer.cookies },
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await post(
          `/v1/orgs/${org.org.id}/codes/${org.joinCode.code}/rotate`,
          {},
          { cookies: trainer.cookies },
        )
      ).statusCode,
    ).toBe(403);
    // Tidying a code away is the last step of expiring one, so it sits on the
    // same tick — a trainer who cannot pause a code cannot make one vanish.
    // Done on the SPARE code the manager just minted: the gym's own Front Desk
    // code has to keep working for the member join below.
    await patch(`/v1/orgs/${org.org.id}/codes/${spare}`, { paused: true }, { cookies: owner.cookies });
    expect(
      (await del(`/v1/orgs/${org.org.id}/codes/${spare}`, { cookies: trainer.cookies })).statusCode,
    ).toBe(403);
    expect(
      (await del(`/v1/orgs/${org.org.id}/codes/${spare}`, { cookies: manager.cookies })).statusCode,
    ).toBe(200);

    // A plain MEMBER — not staff at all — gets the module's standing 404 on
    // every one of them.
    const member = await makeUser("cmpriv-member");
    await joinAsMember(member.cookies, org, owner.cookies);
    expect(
      (await post(`/v1/orgs/${org.org.id}/codes`, {}, { cookies: member.cookies })).statusCode,
    ).toBe(404);
  });

  // ── WHAT THE NUMBER MEANS (Kd's smoke, 2026-08-21) ──────────────────────
  //
  // He read "2 people have joined with it" off a code ONE person had ever used
  // — they joined, were removed, and joined again — and the same counter gated
  // the code's limit, so a member who left took their place with them. These
  // four tests pin the replacement: PEOPLE WHO ARE IN NOW, owner excluded.

  it("counts PEOPLE who are in, not times a code was used", { timeout: 90_000 }, async () => {
    const owner = await makeUser("count-owner");
    const member = await makeUser("count-member");
    const org = await makeOrg(owner.cookies, "Orgs Test Code Count");

    // THE OWNER IS NOT A JOINER. Their §4.0-step-6 seat is complimentary and
    // carries this very code, so a count that forgot to exclude it says 1 here.
    expect((await readCodes(org.org.id, owner.cookies))[0]?.joined).toBe(0);

    await joinAsMember(member.cookies, org, owner.cookies);
    expect((await readCodes(org.org.id, owner.cookies))[0]?.joined).toBe(1);

    // OUT: the number falls. The membership row stays in the table with
    // `removed_at` set, which is exactly what the old counter could not see.
    const removed = await del(`/v1/orgs/${org.org.id}/members/${member.userId}`, {
      cookies: owner.cookies,
    });
    expect(removed.statusCode).toBe(200);
    expect((await readCodes(org.org.id, owner.cookies))[0]?.joined).toBe(0);

    // BACK IN: one person, counted once. Under the old `uses` column this said
    // TWO, which is the sentence Kd was shown.
    await joinAsMember(member.cookies, org, owner.cookies);
    expect((await readCodes(org.org.id, owner.cookies))[0]?.joined).toBe(1);

    // And the claims column is untouched underneath — it really did admit
    // somebody twice, and that is the question it answers.
    const claims = await sql<{ uses: number }[]>`
      SELECT uses FROM gym_codes WHERE code = ${org.joinCode.code}`;
    expect(claims[0]?.uses).toBe(2);
  });

  it("frees a place in a code's limit when a member leaves", { timeout: 90_000 }, async () => {
    const owner = await makeUser("freeup-owner");
    const first = await makeUser("freeup-first");
    const second = await makeUser("freeup-second");
    const org = await makeOrg(owner.cookies, "Orgs Test Limit Frees");
    const target = org.joinCode.code;

    expect(
      (
        await patch(
          `/v1/orgs/${org.org.id}/codes/${target}`,
          { maxUses: 1 },
          { cookies: owner.cookies },
        )
      ).statusCode,
    ).toBe(200);

    await joinAsMember(first.cookies, org, owner.cookies);
    const shut = await post("/v1/orgs/join", { code: target }, { cookies: second.cookies });
    expect(shut.statusCode).toBe(409);
    expect((JSON.parse(shut.body) as { error: string }).error).toBe("code_exhausted");

    // The first member leaves. A gym that limits a code to one person means one
    // person AT A TIME; under the old counter this door stayed shut forever.
    expect(
      (await del(`/v1/orgs/${org.org.id}/members/${first.userId}`, { cookies: owner.cookies }))
        .statusCode,
    ).toBe(200);

    const open = await post("/v1/orgs/join", { code: target }, { cookies: second.cookies });
    expect(open.statusCode).toBe(200);
    expect((JSON.parse(open.body) as { outcome: string }).outcome).toBe("pending");
  });

  // ── TIDYING A CODE OFF THE LIST (Kd 2026-08-21: "codes will pile up") ────

  it("takes a switched-off code off the list and leaves the members it made", { timeout: 90_000 }, async () => {
    const owner = await makeUser("tidy-owner");
    const member = await makeUser("tidy-member");
    const org = await makeOrg(owner.cookies, "Orgs Test Code Tidy");
    await joinAsMember(member.cookies, org, owner.cookies);

    // A LIVE code cannot be tidied away — that would take a working door off
    // the only screen that watches it.
    const early = await del(`/v1/orgs/${org.org.id}/codes/${org.joinCode.code}`, {
      cookies: owner.cookies,
    });
    expect(early.statusCode).toBe(409);
    expect((JSON.parse(early.body) as { error: string }).error).toBe("code_still_usable");
    expect(await readCodes(org.org.id, owner.cookies)).toHaveLength(1);

    await patch(
      `/v1/orgs/${org.org.id}/codes/${org.joinCode.code}`,
      { paused: true },
      { cookies: owner.cookies },
    );
    const gone = await del(`/v1/orgs/${org.org.id}/codes/${org.joinCode.code}`, {
      cookies: owner.cookies,
    });
    expect(gone.statusCode).toBe(200);
    expect(await readCodes(org.org.id, owner.cookies)).toHaveLength(0);

    // THE MEMBER IS STILL A MEMBER, and the row that records HOW they joined is
    // still there. This is the whole reason removal is not a DELETE.
    const roster = await get(`/v1/orgs/${org.org.id}/members`, { cookies: owner.cookies });
    expect(
      (JSON.parse(roster.body) as { items: { userId: string }[] }).items.map((i) => i.userId),
    ).toContain(member.userId);
    const link = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_members m
      JOIN gym_codes c ON c.id = m.code_id
      WHERE m.user_id = ${member.userId} AND c.code = ${org.joinCode.code}`;
    expect(link[0]?.n).toBe(1);

    // A tidied code is DEAD AT THE DOOR TOO — removal pauses it in the same
    // statement, so "not on the list" and "still lets people in" cannot part.
    const stranger = await makeUser("tidy-stranger");
    const knock = await post(
      "/v1/orgs/join",
      { code: org.joinCode.code },
      { cookies: stranger.cookies },
    );
    expect(knock.statusCode).toBe(409);
    expect((JSON.parse(knock.body) as { error: string }).error).toBe("code_paused");

    // Removing twice answers the same way — the second tap of a slow button.
    expect(
      (await del(`/v1/orgs/${org.org.id}/codes/${org.joinCode.code}`, { cookies: owner.cookies }))
        .statusCode,
    ).toBe(200);

    // And a tidied code can no longer be changed or replaced: it is on no
    // screen, so nothing legitimate is asking.
    expect(
      (
        await patch(
          `/v1/orgs/${org.org.id}/codes/${org.joinCode.code}`,
          { paused: false },
          { cookies: owner.cookies },
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await post(
          `/v1/orgs/${org.org.id}/codes/${org.joinCode.code}/rotate`,
          {},
          { cookies: owner.cookies },
        )
      ).statusCode,
    ).toBe(404);
  });

  it("removes an EXPIRED code without asking the owner to pause it first", { timeout: 60_000 }, async () => {
    const owner = await makeUser("tidy-exp-owner");
    const org = await makeOrg(owner.cookies, "Orgs Test Code Tidy Expired");
    // Past the end date and never paused — dead at the door already, so making
    // the owner switch off something that is off would be theatre.
    await sql`
      UPDATE gym_codes SET expires_at = now() - interval '1 day'
      WHERE gym_id = ${org.org.id}`;

    expect(
      (await del(`/v1/orgs/${org.org.id}/codes/${org.joinCode.code}`, { cookies: owner.cookies }))
        .statusCode,
    ).toBe(200);
    expect(await readCodes(org.org.id, owner.cookies)).toHaveLength(0);

    // AND IT WAS SWITCHED OFF ON THE WAY OUT. This assertion is the whole
    // safety argument, and it was MISSING until mutant O69 survived a sweep:
    // every other test removed a code that was ALREADY paused, so nothing
    // noticed when removal stopped pausing. Without it, "off the list" and
    // "cannot let anybody in" are two separate facts that happen to agree today
    // — this makes them one statement.
    const row = await sql<{ paused: boolean; removed_at: Date | null }[]>`
      SELECT paused, removed_at FROM gym_codes WHERE code = ${org.joinCode.code}`;
    expect(row[0]?.paused).toBe(true);
    expect(row[0]?.removed_at).not.toBeNull();
  });

  it("frees a place under the code cap when one is removed", { timeout: 90_000 }, async () => {
    const owner = await makeUser("tidy-cap-owner");
    const org = await makeOrg(owner.cookies, "Orgs Test Code Tidy Cap");
    // Fill the gym to its cap: the Front Desk code plus one short of it.
    const bulk = Array.from({ length: orgRepo.ORG_CODES_MAX - 1 }, (_, i) => ({
      gym_id: org.org.id,
      code: `YY${String(i).padStart(4, "0")}`,
      label: `Bulk ${String(i)}`,
      paused: true,
    }));
    await sql`INSERT INTO gym_codes ${sql(bulk, "gym_id", "code", "label", "paused")}`;

    const full = await post(`/v1/orgs/${org.org.id}/codes`, {}, { cookies: owner.cookies });
    expect(full.statusCode).toBe(409);
    expect((JSON.parse(full.body) as { error: string }).error).toBe("too_many_codes");
    // The refusal names the fix, and the fix has to be one the owner can carry
    // out — "remove one from the list" is a button that exists.
    expect((JSON.parse(full.body) as { message: string }).message).toContain("Remove one");

    expect(
      (await del(`/v1/orgs/${org.org.id}/codes/YY0000`, { cookies: owner.cookies })).statusCode,
    ).toBe(200);
    expect((await post(`/v1/orgs/${org.org.id}/codes`, {}, { cookies: owner.cookies })).statusCode).toBe(
      201,
    );
  });

  it("writes an audit row for every code change (Part 3 §3.3)", { timeout: 60_000 }, async () => {
    const owner = await makeUser("audit-owner");
    const org = await makeOrg(owner.cookies, "Orgs Test Code Audit");

    await post(`/v1/orgs/${org.org.id}/codes`, {}, { cookies: owner.cookies });
    await patch(
      `/v1/orgs/${org.org.id}/codes/${org.joinCode.code}`,
      { paused: true },
      { cookies: owner.cookies },
    );
    await post(`/v1/orgs/${org.org.id}/codes/${org.joinCode.code}/rotate`, {}, { cookies: owner.cookies });
    // The rotate paused the old code, so it can be tidied away — and that write
    // has to leave a row too, or "where did that code go" has no answer.
    await del(`/v1/orgs/${org.org.id}/codes/${org.joinCode.code}`, { cookies: owner.cookies });

    // Ordered by the identity column, not by the timestamp: four writes inside
    // one test can share a `at` value to the microsecond, and an order this
    // test asserts must not depend on a tie-break Postgres never promised.
    const rows = await sql<{ action: string; actor_user_id: string | null }[]>`
      SELECT action, actor_user_id FROM audit_log
      WHERE gym_id = ${org.org.id} AND action LIKE 'org.code_%'
      ORDER BY id ASC`;
    expect(rows.map((r) => r.action)).toEqual([
      "org.code_created",
      "org.code_updated",
      "org.code_rotated",
      "org.code_removed",
    ]);
    // A HUMAN did each of these, so every row names one — unlike the expiry
    // sweep, which writes `actor_user_id = NULL` because nobody decided.
    expect(rows.every((r) => r.actor_user_id === owner.userId)).toBe(true);
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

  it("admits exactly one code past the cap when two staff create at once (T3 L-3)", { timeout: 90_000 }, async () => {
    const owner = await makeUser("caprace-owner");
    const org = await makeOrg(owner.cookies, "Orgs Test Cap Race");
    // ONE PLACE LEFT, so the two creates below contend for it. `MAX - 2` and not
    // `MAX - 1`: the gym already holds its own Front Desk code, so this puts it
    // at 99. The first draft used `MAX - 1`, filled the gym TO the cap, and both
    // calls were correctly refused — a fixture that made the test pass for the
    // wrong reason and would have gone green with the lock deleted (:5104 F5,
    // fix the fixture and never the assertion).
    const bulk = Array.from({ length: orgRepo.ORG_CODES_MAX - 2 }, (_, i) => ({
      gym_id: org.org.id,
      code: `XR${String(i).padStart(4, "0")}`,
      label: `Bulk ${String(i)}`,
    }));
    await sql`INSERT INTO gym_codes ${sql(bulk, "gym_id", "code", "label")}`;

    // TWO SEPARATE CLIENTS for the reason the seat race names: the app's pool is
    // max:1 and would serialise these for us, making the assertion true with the
    // lock removed. Under READ COMMITTED and no lock, both transactions read the
    // same count of 99, both pass the check, and the gym ends up holding 101
    // codes — one of which `listCodes`' `LIMIT 100` can never show, while the
    // join door honours it happily.
    const c1 = postgres(url ?? "", { prepare: false, max: 1 });
    const c2 = postgres(url ?? "", { prepare: false, max: 1 });
    try {
      const [r1, r2] = await Promise.all([
        orgRepo.createCode(c1, {
          gymId: org.org.id,
          code: "RACEAA",
          label: "Front Desk",
          expiresAt: null,
          maxUses: null,
          actorUserId: owner.userId,
        }),
        orgRepo.createCode(c2, {
          gymId: org.org.id,
          code: "RACEBB",
          label: "Front Desk",
          expiresAt: null,
          maxUses: null,
          actorUserId: owner.userId,
        }),
      ]);
      expect([r1.kind, r2.kind].sort()).toEqual(["created", "too_many"]);
    } finally {
      await c1.end({ timeout: 5 });
      await c2.end({ timeout: 5 });
    }

    // AND THE LIST IS STILL WHOLE, which is the guarantee the cap exists for:
    // every visible code is one `listCodes` can return.
    const visible = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_codes
      WHERE gym_id = ${org.org.id} AND removed_at IS NULL`;
    expect(visible[0]?.n).toBe(orgRepo.ORG_CODES_MAX);
    expect(await readCodes(org.org.id, owner.cookies)).toHaveLength(orgRepo.ORG_CODES_MAX);
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

  // -------------------------------------------------------------------------
  // STAFF (Part 3 §4.7). Before this card the only `INSERT INTO gym_staff` in
  // the product was the owner's own, written when the gym was created.
  // -------------------------------------------------------------------------

  interface StaffBody {
    userId: string;
    displayName: string;
    email: string | null;
    role: string;
    /** The EFFECTIVE ticks — what the server would enforce, not the role's
     *  template. Optional in the contract for the expand-then-contract reason
     *  `takesSeat` is (:12660), so it is optional here too rather than asserted
     *  into existence by the test's own type. */
    privileges?: string[];
    since: string;
    isYou: boolean;
  }

  const readStaff = async (gymId: string, cookies: Record<string, string>) => {
    const res = await get(`/v1/orgs/${gymId}/staff`, { cookies });
    expect(res.statusCode).toBe(200);
    return (JSON.parse(res.body) as { staff: StaffBody[] }).staff;
  };

  /** `complimentary` as the DATABASE holds it.
   *
   *  **This is now asserted NOT to move when somebody is appointed** (T3 round
   *  1, C/H-1). The flag means "this person did not JOIN" — the owner's
   *  §4.0-step-6 seat — and the console's joined count, the join door's
   *  `max_uses` gate and `orgCodeSchema.joined` all read it that way. Kd's
   *  "staff seats free" is enforced in the seat CAP instead, which the
   *  `SEAT CAP` test below is what actually proves. */
  const complimentaryFlag = async (gymId: string, userId: string) => {
    const rows = await sql<{ complimentary: boolean }[]>`
      SELECT complimentary FROM gym_members
      WHERE gym_id = ${gymId} AND user_id = ${userId} AND removed_at IS NULL`;
    return rows[0]?.complimentary;
  };

  /** The role `requirePrivilege` would honour — `getStaffAuthority`'s answer
   *  narrowed to the half these particular assertions are about.
   *
   *  It exists so the ghost, cross-gym and both-readers tests below read exactly
   *  as they did when the function was called `getStaffRole`: those tests are
   *  about WHOSE staff row counts at all, and the ticks card changed the shape
   *  of the answer without changing one of their claims. */
  const staffRoleOf = async (gymId: string, userId: string) =>
    (await orgRepo.getStaffAuthority(sql, gymId, userId))?.role ?? null;

  /** The ticks as the DATABASE holds them — `null` for a row written before the
   *  column existed, which is the one state `privilegesFor` turns back into the
   *  role's defaults. */
  const storedPrivileges = async (gymId: string, userId: string) => {
    const rows = await sql<{ privileges: string[] | null }[]>`
      SELECT privileges FROM gym_staff WHERE gym_id = ${gymId} AND user_id = ${userId}`;
    return rows[0]?.privileges ?? null;
  };

  it("lists the owner as staff, and marks the row as the viewer's own", async () => {
    const owner = await makeUser("staff-list-owner");
    const org = await makeOrg(owner.cookies, "Orgs Test Staff List");

    const staff = await readStaff(org.org.id, owner.cookies);
    expect(staff).toHaveLength(1);
    expect(staff[0]?.userId).toBe(owner.userId);
    expect(staff[0]?.role).toBe("owner");
    expect(staff[0]?.isYou).toBe(true);
    expect(staff[0]?.email).toBe("orgs-t-staff-list-owner@example.com");
  });

  it("appoints a member as a trainer", async () => {
    const owner = await makeUser("staff-add-owner");
    const hire = await makeUser("staff-add-hire");
    const org = await makeOrg(owner.cookies, "Orgs Test Staff Add");
    await joinAsMember(hire.cookies, org, owner.cookies);

    const res = await post(
      `/v1/orgs/${org.org.id}/staff`,
      { email: "orgs-t-staff-add-hire@example.com", role: "trainer" },
      { cookies: owner.cookies },
    );
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { staff: StaffBody };
    expect(body.staff.userId).toBe(hire.userId);
    expect(body.staff.role).toBe("trainer");
    expect(body.staff.isYou).toBe(false);

    const staff = await readStaff(org.org.id, owner.cookies);
    expect(staff.map((s) => s.role)).toEqual(["owner", "trainer"]);

    const audit = await sql<{ action: string; meta: { role?: string } }[]>`
      SELECT action, meta FROM audit_log
      WHERE gym_id = ${org.org.id} AND action = 'org.staff_added'`;
    expect(audit).toHaveLength(1);
    expect(audit[0]?.meta.role).toBe("trainer");
  });

  /** KD RULING 2026-08-22, "yes staff seats free" — and this is what proves it,
   *  because the first implementation "proved" it by flipping a flag that means
   *  something else (T3 round 1, C/H-1). A seat is free if and only if the SEAT
   *  CAP stops counting it, so the assertion is a gym at its cap admitting one
   *  more person. */
  // THE TIMEOUT ON THIS AND THREE SIBLINGS, AND THE TWO MEASUREMENTS DISAGREE —
  // T3 Low-4, which is why both are written here instead of one.
  //
  // All four are seat-cap tests driving a subscription, a join, a confirm and an
  // appointment through real HTTP against real Postgres, and none carried an
  // explicit timeout though the file gives one to every other DB-heavy test.
  //   · AUTHOR, on this machine, whole-file run at HEAD (`9a4e022`), local
  //     Postgres in Docker Desktop: 4782 · 5020 · 4762 · 5017 ms — two ALREADY
  //     FAILING the 5000 ms default before the ticks card existed, which is how
  //     this was found at all.
  //   · REVIEWER, same suite, two consecutive local runs: 1412 · 1716 · 1363 ·
  //     1348 ms. Roughly 3x faster and nowhere near the limit.
  // Neither reading is disputed and NOBODY HAS EXPLAINED THE GAP — most likely
  // the author's machine was running these back to back against a database
  // already busy with the same suite. **The honest state is that the runtime is
  // environment-dependent by ~3x, and a chat quoting either number alone is
  // quoting one machine.**
  //
  // 30_000 is the file's own convention rather than a fitted number, and the
  // cost is stated: against the reviewer's baseline it is ~21x headroom, so a
  // real 10x regression would pass silently here. A tighter bound would re-open
  // the flake on the slower reading. Nothing about the assertions changes — the
  // only edit to each of the four is this options object, and a timeout cannot
  // weaken an assertion.
  it("SEAT CAP: appointing a member frees their seat, and removing them takes it back", { timeout: 30_000 }, async () => {
    const owner = await makeUser("staff-seat-owner");
    const hire = await makeUser("staff-seat-hire");
    const walkIn = await makeUser("staff-seat-walkin");
    const org = await makeOrg(owner.cookies, "Orgs Test Staff Seat Cap");
    await subscribeGym(org.org.id, CAP1_PLAN); // one paid seat
    await joinAsMember(hire.cookies, org, owner.cookies);

    // The gym is FULL: one paid seat, one paying member (the owner's own seat is
    // complimentary and has never counted).
    const full = await post("/v1/orgs/join", { code: org.joinCode.code }, {
      cookies: walkIn.cookies,
    });
    expect(full.statusCode).toBe(200);
    expect((JSON.parse(full.body) as { outcome: string }).outcome).toBe("pending");
    const blocked = await post(
      `/v1/orgs/${org.org.id}/applications/${
        (
          JSON.parse(
            (await get(`/v1/orgs/${org.org.id}/applications`, { cookies: owner.cookies })).body,
          ) as { items: { id: string; userId: string }[] }
        ).items.find((a) => a.userId === walkIn.userId)?.id ?? "none"
      }/confirm`,
      {},
      { cookies: owner.cookies },
    );
    expect(blocked.statusCode).toBe(409);

    // Appoint the paying member. Their seat stops being billed, so the gym has
    // room again — WITHOUT `complimentary` moving.
    const appointed = await post(
      `/v1/orgs/${org.org.id}/staff`,
      { email: "orgs-t-staff-seat-hire@example.com", role: "trainer" },
      { cookies: owner.cookies },
    );
    expect(appointed.statusCode).toBe(201);
    expect(await complimentaryFlag(org.org.id, hire.userId)).toBe(false);

    const queue = JSON.parse(
      (await get(`/v1/orgs/${org.org.id}/applications`, { cookies: owner.cookies })).body,
    ) as { items: { id: string; userId: string }[] };
    const pending = queue.items.find((a) => a.userId === walkIn.userId)?.id ?? "none";
    const admitted = await post(
      `/v1/orgs/${org.org.id}/applications/${pending}/confirm`,
      {},
      { cookies: owner.cookies },
    );
    expect(admitted.statusCode).toBe(200);

    // AND THE SEAT COMES BACK. T3 round 2's Low-1: this test's title promised
    // the return half and only ever checked the outward half — and the round-1
    // fix had deleted the two flag assertions that used to stand in for it.
    // The gym is now at 2 of 1 paid seats, so taking the trainer's keys back
    // means the next person is refused.
    const another = await makeUser("staff-seat-another");
    await del(`/v1/orgs/${org.org.id}/staff/${hire.userId}`, { cookies: owner.cookies });
    await applyWithCode(another.cookies, org.joinCode.code);
    const queue2 = JSON.parse(
      (await get(`/v1/orgs/${org.org.id}/applications`, { cookies: owner.cookies })).body,
    ) as { items: { id: string; userId: string }[] };
    const pending2 = queue2.items.find((a) => a.userId === another.userId)?.id ?? "none";
    const refused = await post(
      `/v1/orgs/${org.org.id}/applications/${pending2}/confirm`,
      {},
      { cookies: owner.cookies },
    );
    expect(refused.statusCode).toBe(409);
  });

  /** THE BADGE AND THE CAP ARE ONE QUESTION, AND THIS TEST DRIVES BOTH ENDS OF
   *  IT ON ONE FIXTURE — the anchor :14953 and `OWED.md` require, following
   *  :14013's six-site precedent.
   *
   *  **What Kd found:** the roster drew its "Complimentary" badge off
   *  `gym_members.complimentary`, which is deliberately never written for staff,
   *  so a trainer sat there looking exactly like somebody occupying a paid
   *  place. The door and the screen disagreed about who costs money.
   *
   *  **Why the rule is written out TWICE** (`claimSeat`'s count and
   *  `listMembers`' `takes_seat`): a shared `sql` fragment is R3.8's forbidden
   *  shape, so the duplication is deliberate and THIS is what stops it drifting.
   *  The roster's own answer is what the cap assertions are derived from — not a
   *  number typed in here — so the two cannot pass while disagreeing.
   *
   *  It fails on EITHER half losing EITHER condition: drop `complimentary =
   *  false` from the roster and the owner reads as taking a seat; drop the
   *  `NOT EXISTS` and the appointed trainer does; drop either from the count and
   *  the gym stays full where this expects room. */
  it("ROSTER + CAP: the badge and the seat count answer the same question", { timeout: 30_000 }, async () => {
    const owner = await makeUser("seat-both-owner");
    const payer = await makeUser("seat-both-payer");
    const walkIn = await makeUser("seat-both-walkin");
    const org = await makeOrg(owner.cookies, "Orgs Test Seat Both Ends");
    await subscribeGym(org.org.id, CAP1_PLAN); // one paid seat

    interface RosterRow {
      userId: string;
      complimentary: boolean;
      takesSeat: boolean;
    }
    const roster = async (): Promise<RosterRow[]> => {
      const res = await get(`/v1/orgs/${org.org.id}/members`, { cookies: owner.cookies });
      expect(res.statusCode).toBe(200);
      const page = JSON.parse(res.body) as { items: RosterRow[]; nextCursor: string | null };
      // Every assertion below counts the WHOLE roster, so a truncated page
      // would make this test say something it cannot know.
      expect(page.nextCursor).toBeNull();
      return page.items;
    };
    const seatsTaken = (rows: RosterRow[]) => rows.filter((r) => r.takesSeat).length;
    const rowFor = (rows: RosterRow[], userId: string) => rows.find((r) => r.userId === userId);
    /** Ask the DOOR whether there is room, by the only means that answers
     *  honestly: put a real person in front of it.
     *
     *  Applies only if this person is not already in the queue — a refused
     *  confirm leaves the application PENDING (a full gym must not throw the
     *  applicant away), and re-applying answers `already_pending`. */
    const confirmWalkIn = async (who: { userId: string; cookies: Record<string, string> }) => {
      const queue = JSON.parse(
        (await get(`/v1/orgs/${org.org.id}/applications`, { cookies: owner.cookies })).body,
      ) as { items: { id: string; userId: string }[] };
      const waiting = queue.items.find((a) => a.userId === who.userId)?.id;
      const id = waiting ?? (await applyWithCode(who.cookies, org.joinCode.code));
      return await post(
        `/v1/orgs/${org.org.id}/applications/${id}/confirm`,
        {},
        { cookies: owner.cookies },
      );
    };

    // (1) OWNER ONLY. Their §4.0-step-6 seat is complimentary, so the screen
    // says it costs nothing and the cap agrees the gym is empty.
    const justOwner = await roster();
    expect(rowFor(justOwner, owner.userId)?.takesSeat).toBe(false);
    expect(seatsTaken(justOwner)).toBe(0);

    // (1b) A COMPED MEMBER WHO IS NOT STAFF, and the mutation audit is what
    // demanded them: O92 — deleting `complimentary = false` from the roster's
    // rule — SURVIVED the first run of this test. **THE OWNER IS EXCLUDED
    // TWICE**, being complimentary AND holding a staff row, so with that
    // condition gone their place still read as free and the assertion above
    // could not fail. :14401's O3 exactly, repeating on the roster's copy of
    // the rule a card later, and :5104 F5's shape: a guarantee whose protection
    // cannot fail is the same gap with a comment on it.
    //
    // This person is the only subject in the product that isolates the
    // complimentary half. Comped by hand for the reason the door's own test
    // gives: nothing writes this flag today except the wizard's owner seat.
    const comped = await makeUser("seat-both-comped");
    await joinAsMember(comped.cookies, org, owner.cookies);
    await sql`UPDATE gym_members SET complimentary = true
              WHERE gym_id = ${org.org.id} AND user_id = ${comped.userId} AND removed_at IS NULL`;
    expect(await staffRoleOf(org.org.id, comped.userId)).toBeNull();

    const withComped = await roster();
    expect(rowFor(withComped, comped.userId)?.complimentary).toBe(true);
    expect(rowFor(withComped, comped.userId)?.takesSeat).toBe(false);
    expect(seatsTaken(withComped)).toBe(0);

    // (2) ONE PAYING MEMBER. The badge is absent and the gym is full — both
    // read off the same fact, and the cap assertion follows the ROSTER's count.
    await joinAsMember(payer.cookies, org, owner.cookies);
    const withPayer = await roster();
    expect(rowFor(withPayer, payer.userId)?.takesSeat).toBe(true);
    expect(seatsTaken(withPayer)).toBe(1); // === the plan's seat_cap
    expect((await confirmWalkIn(walkIn)).statusCode).toBe(409);

    // (3) APPOINT THEM. The screen now says their place is free, `complimentary`
    // has NOT moved (that is :14401 C/H-1, and this is the assertion that keeps
    // the obvious wrong fix out), and the door lets the next person in.
    expect(
      (
        await post(
          `/v1/orgs/${org.org.id}/staff`,
          { email: "orgs-t-seat-both-payer@example.com", role: "trainer" },
          { cookies: owner.cookies },
        )
      ).statusCode,
    ).toBe(201);
    const withTrainer = await roster();
    expect(rowFor(withTrainer, payer.userId)?.takesSeat).toBe(false);
    expect(rowFor(withTrainer, payer.userId)?.complimentary).toBe(false);
    expect(seatsTaken(withTrainer)).toBe(0);
    expect((await confirmWalkIn(walkIn)).statusCode).toBe(200);

    // (4) AND BACK AGAIN. Taking the keys away puts the place back on the bill,
    // on the screen and at the door together.
    const withWalkIn = await roster();
    expect(rowFor(withWalkIn, walkIn.userId)?.takesSeat).toBe(true);
    expect(seatsTaken(withWalkIn)).toBe(1);

    await del(`/v1/orgs/${org.org.id}/staff/${payer.userId}`, { cookies: owner.cookies });
    const afterRemoval = await roster();
    expect(rowFor(afterRemoval, payer.userId)?.takesSeat).toBe(true);
    expect(seatsTaken(afterRemoval)).toBe(2); // over the cap, as the door will now say
    const last = await makeUser("seat-both-last");
    expect((await confirmWalkIn(last)).statusCode).toBe(409);
  });

  /** T3 round 1, C/H-1 — the regression that fails without the fix. The three
   *  readers of `complimentary` must not move when somebody is appointed. */
  it("appointing somebody changes NO number a member or the door can see", async () => {
    const owner = await makeUser("staff-numbers-owner");
    const hire = await makeUser("staff-numbers-hire");
    const later = await makeUser("staff-numbers-later");
    const org = await makeOrg(owner.cookies, "Orgs Test Staff Numbers");
    await joinAsMember(hire.cookies, org, owner.cookies);

    // Limit the code to the one person who has used it, so the gate is armed.
    const limited = await patch(
      `/v1/orgs/${org.org.id}/codes/${org.joinCode.code}`,
      { maxUses: 1 },
      { cookies: owner.cookies },
    );
    expect(limited.statusCode).toBe(200);
    const before = await readCodes(org.org.id, owner.cookies);
    expect(before[0]?.joined).toBe(1);

    await post(
      `/v1/orgs/${org.org.id}/staff`,
      { email: "orgs-t-staff-numbers-hire@example.com", role: "trainer" },
      { cookies: owner.cookies },
    );

    // (1) the code panel's own count, (2) the roster flag the console's
    // "nobody has joined yet" sentence is computed from, and (3) the join
    // door's `max_uses` gate — an exhausted code must STAY exhausted.
    const after = await readCodes(org.org.id, owner.cookies);
    expect(after[0]?.joined).toBe(1);
    expect(await complimentaryFlag(org.org.id, hire.userId)).toBe(false);
    const roster = JSON.parse(
      (await get(`/v1/orgs/${org.org.id}/members`, { cookies: owner.cookies })).body,
    ) as { items: { userId: string; complimentary: boolean }[] };
    expect(roster.items.filter((m) => !m.complimentary)).toHaveLength(1);

    const turnedAway = await post("/v1/orgs/join", { code: org.joinCode.code }, {
      cookies: later.cookies,
    });
    expect(turnedAway.statusCode).toBe(409);
  });

  it("the appointment is EMAIL-matched case-insensitively (the column is citext)", async () => {
    const owner = await makeUser("staff-case-owner");
    const hire = await makeUser("staff-case-hire");
    const org = await makeOrg(owner.cookies, "Orgs Test Staff Case");
    await joinAsMember(hire.cookies, org, owner.cookies);

    const res = await post(
      `/v1/orgs/${org.org.id}/staff`,
      { email: "ORGS-T-STAFF-CASE-HIRE@EXAMPLE.COM", role: "manager" },
      { cookies: owner.cookies },
    );
    expect(res.statusCode).toBe(201);
    expect((JSON.parse(res.body) as { staff: StaffBody }).staff.role).toBe("manager");
  });

  /** THE ORACLE TEST, and it is the security property of the whole route: the
   *  lookup is scoped to THIS gym's roster, so a real account that belongs to
   *  somebody else's gym answers exactly like an address nobody has ever used.
   *  If these two ever diverge, a gym owner can enumerate who has an account. */
  it("refuses an email that is not a member HERE — and a stranger's real account answers identically", async () => {
    const owner = await makeUser("staff-oracle-owner");
    const outsider = await makeUser("staff-oracle-outsider");
    const otherOwner = await makeUser("staff-oracle-other");
    const org = await makeOrg(owner.cookies, "Orgs Test Staff Oracle");
    const otherOrg = await makeOrg(otherOwner.cookies, "Orgs Test Staff Oracle Two");
    // The outsider is a REAL, live member — of the wrong gym.
    await joinAsMember(outsider.cookies, otherOrg, otherOwner.cookies);

    const real = await post(
      `/v1/orgs/${org.org.id}/staff`,
      { email: "orgs-t-staff-oracle-outsider@example.com", role: "trainer" },
      { cookies: owner.cookies },
    );
    const fictional = await post(
      `/v1/orgs/${org.org.id}/staff`,
      { email: "orgs-t-staff-oracle-nobody@example.com", role: "trainer" },
      { cookies: owner.cookies },
    );

    expect(real.statusCode).toBe(404);
    expect(fictional.statusCode).toBe(404);
    // The same ERROR and the same MESSAGE, not merely both-404: a difference in
    // the wording is the same oracle wearing a different hat. `requestId` is
    // per-request and is excluded deliberately — comparing whole bodies is an
    // assertion that can never pass, which is how the first draft of this test
    // failed.
    const shape = (body: string) => {
      const parsed = JSON.parse(body) as { error: string; message: string };
      return { error: parsed.error, message: parsed.message };
    };
    expect(shape(real.body)).toEqual(shape(fictional.body));
  });

  it("refuses a member who has LEFT the gym", async () => {
    const owner = await makeUser("staff-left-owner");
    const leaver = await makeUser("staff-left-leaver");
    const org = await makeOrg(owner.cookies, "Orgs Test Staff Left");
    await joinAsMember(leaver.cookies, org, owner.cookies);
    const removed = await del(`/v1/orgs/${org.org.id}/members/${leaver.userId}`, {
      cookies: owner.cookies,
    });
    expect(removed.statusCode).toBe(200);

    const res = await post(
      `/v1/orgs/${org.org.id}/staff`,
      { email: "orgs-t-staff-left-leaver@example.com", role: "trainer" },
      { cookies: owner.cookies },
    );
    expect(res.statusCode).toBe(404);
  });

  it("a second appointment REPORTS the existing role and never overwrites it", async () => {
    const owner = await makeUser("staff-dup-owner");
    const hire = await makeUser("staff-dup-hire");
    const org = await makeOrg(owner.cookies, "Orgs Test Staff Dup");
    await joinAsMember(hire.cookies, org, owner.cookies);

    const first = await post(
      `/v1/orgs/${org.org.id}/staff`,
      { email: "orgs-t-staff-dup-hire@example.com", role: "manager" },
      { cookies: owner.cookies },
    );
    expect(first.statusCode).toBe(201);

    // A stale screen offering "add as trainer" must not silently DEMOTE them.
    const second = await post(
      `/v1/orgs/${org.org.id}/staff`,
      { email: "orgs-t-staff-dup-hire@example.com", role: "trainer" },
      { cookies: owner.cookies },
    );
    expect(second.statusCode).toBe(409);

    const staff = await readStaff(org.org.id, owner.cookies);
    expect(staff.find((s) => s.userId === hire.userId)?.role).toBe("manager");
  });

  it("changes a role, records BOTH ends in the audit row, and repeats without a second row", async () => {
    const owner = await makeUser("staff-role-owner");
    const hire = await makeUser("staff-role-hire");
    const org = await makeOrg(owner.cookies, "Orgs Test Staff Role");
    await joinAsMember(hire.cookies, org, owner.cookies);
    await post(
      `/v1/orgs/${org.org.id}/staff`,
      { email: "orgs-t-staff-role-hire@example.com", role: "trainer" },
      { cookies: owner.cookies },
    );

    const res = await patch(
      `/v1/orgs/${org.org.id}/staff/${hire.userId}`,
      { role: "manager" },
      { cookies: owner.cookies },
    );
    expect(res.statusCode).toBe(200);
    expect((JSON.parse(res.body) as { staff: StaffBody }).staff.role).toBe("manager");

    const again = await patch(
      `/v1/orgs/${org.org.id}/staff/${hire.userId}`,
      { role: "manager" },
      { cookies: owner.cookies },
    );
    expect(again.statusCode).toBe(200);

    // ONE row, not two: a no-op tap did not happen, so the history must not say
    // it did.
    const audit = await sql<{ meta: { from?: string; to?: string } }[]>`
      SELECT meta FROM audit_log
      WHERE gym_id = ${org.org.id} AND action = 'org.staff_role_changed'`;
    expect(audit).toHaveLength(1);
    expect(audit[0]?.meta.from).toBe("trainer");
    expect(audit[0]?.meta.to).toBe("manager");
  });

  it("refuses to change the OWNER's role, and refuses to hand the owner role out", async () => {
    const owner = await makeUser("staff-ownrole-owner");
    const hire = await makeUser("staff-ownrole-hire");
    const org = await makeOrg(owner.cookies, "Orgs Test Staff Owner Role");
    await joinAsMember(hire.cookies, org, owner.cookies);
    await post(
      `/v1/orgs/${org.org.id}/staff`,
      { email: "orgs-t-staff-ownrole-hire@example.com", role: "manager" },
      { cookies: owner.cookies },
    );

    // Demoting the owner is last-owner lockout by another door (:11429 rule 2).
    const demote = await patch(
      `/v1/orgs/${org.org.id}/staff/${owner.userId}`,
      { role: "manager" },
      { cookies: owner.cookies },
    );
    expect(demote.statusCode).toBe(409);

    // Promoting is refused at the BOUNDARY — `owner` is not an assignable role —
    // so it is a 400 and never reaches the row.
    const promote = await patch(
      `/v1/orgs/${org.org.id}/staff/${hire.userId}`,
      { role: "owner" },
      { cookies: owner.cookies },
    );
    expect(promote.statusCode).toBe(400);

    const staff = await readStaff(org.org.id, owner.cookies);
    expect(staff.filter((s) => s.role === "owner").map((s) => s.userId)).toEqual([owner.userId]);
  });

  // TITLE TRIMMED (T3 round 2, Low-1): it used to promise "and puts their seat
  // back", which this body has never checked — the seat's return is proved by
  // the SEAT CAP test above, against the cap itself. A title is a claim.
  it("removing somebody from staff leaves them a MEMBER", async () => {
    const owner = await makeUser("staff-rm-owner");
    const hire = await makeUser("staff-rm-hire");
    const org = await makeOrg(owner.cookies, "Orgs Test Staff Remove");
    await joinAsMember(hire.cookies, org, owner.cookies);
    await post(
      `/v1/orgs/${org.org.id}/staff`,
      { email: "orgs-t-staff-rm-hire@example.com", role: "trainer" },
      { cookies: owner.cookies },
    );

    const res = await del(`/v1/orgs/${org.org.id}/staff/${hire.userId}`, {
      cookies: owner.cookies,
    });
    expect(res.statusCode).toBe(200);

    // THE DISTINCTION KD WAS GIVEN BEFORE APPROVING THIS CARD: the keys go, the
    // membership stays. Read from the roster the console actually draws.
    const roster = await get(`/v1/orgs/${org.org.id}/members`, { cookies: owner.cookies });
    expect(roster.statusCode).toBe(200);
    const members = (JSON.parse(roster.body) as { items: { userId: string }[] }).items;
    expect(members.map((m) => m.userId)).toContain(hire.userId);

    // ONE row went, not the gym's whole staff list: the DELETE is scoped by the
    // PAIR (gym, user), and a `WHERE gym_id` that lost its user half would take
    // the owner out with them — silently, since the caller still gets a 200.
    const left = await readStaff(org.org.id, owner.cookies);
    expect(left.map((s) => s.userId)).toEqual([owner.userId]);

    // Idempotent-ish: a second tap is a 404 because they are no longer staff,
    // which is the honest answer to "remove this staff row".
    const twice = await del(`/v1/orgs/${org.org.id}/staff/${hire.userId}`, {
      cookies: owner.cookies,
    });
    expect(twice.statusCode).toBe(404);
  });

  /** T3 round 1, rule 4: the first version of this test had ONE staff row, so
   *  it could not tell "count the OWNERS" from "count the staff" — the reviewer
   *  deleted `AND role = 'owner'` from the guard and the whole suite stayed
   *  green. The gym now holds a trainer as well, which is the discriminator. */
  it("a gym cannot be left with nobody in charge — the last owner cannot be removed", async () => {
    const owner = await makeUser("staff-lastowner-owner");
    const other = await makeUser("staff-lastowner-other");
    const org = await makeOrg(owner.cookies, "Orgs Test Staff Last Owner");
    await joinAsMember(other.cookies, org, owner.cookies);
    await post(
      `/v1/orgs/${org.org.id}/staff`,
      { email: "orgs-t-staff-lastowner-other@example.com", role: "trainer" },
      { cookies: owner.cookies },
    );

    // A THIRD ROW, WITH NO TICKS, AND IT IS THE SUBJECT RATHER THAN SCENERY.
    //
    // T3 round 2's fix taught this guard to count owners who still HOLD the
    // keys, and **that quietly made O87 unobservable**: with a `privileges @>`
    // clause in the query, an ordinary trainer fails it anyway, so deleting
    // `role = 'owner'` changed nothing the test could see and the mutant came
    // back ALIVE. The row that isolates it is one whose privileges are NULL —
    // a staff row written before the ticks column existed — because NULL counts
    // as "holds the template" by design (the deploy window). Without the role
    // filter, that legacy trainer would be counted as somebody who can still run
    // the gym, and the last owner could walk out.
    //
    // Inserted directly because no route can produce it any more; that IS the
    // point — it is what a row from the previous deploy looks like.
    const legacy = await makeUser("staff-lastowner-legacy");
    await joinAsMember(legacy.cookies, org, owner.cookies);
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges)
              VALUES (${org.org.id}, ${legacy.userId}, 'trainer', NULL)`;

    // Three staff rows, ONE owner. A guard counting STAFF — or counting anybody
    // whose ticks merely look sufficient — would let this through.
    const res = await del(`/v1/orgs/${org.org.id}/staff/${owner.userId}`, {
      cookies: owner.cookies,
    });
    expect(res.statusCode).toBe(409);
    expect(await readStaff(org.org.id, owner.cookies)).toHaveLength(3);
  });

  /** T3 round 1, C/H-2 — the regression, and it fails without the org lock.
   *  Appointing reads live membership; removing from the member list reads
   *  `gym_staff`. Interleaved without a shared lock they commit a staff row
   *  over a closed membership: somebody running a gym they are not in. */
  it("RACE: appointing cannot cross with removing, in either order", async () => {
    const owner = await makeUser("staff-race-owner");
    const target = await makeUser("staff-race-target");
    const org = await makeOrg(owner.cookies, "Orgs Test Staff Race");
    await joinAsMember(target.cookies, org, owner.cookies);

    // Two real connections: `buildApp`'s pool is `max: 1`, so two `app.inject`
    // calls would be serialised BY THE CLIENT and the test could not fail
    // (:10010's recorded fixture lesson).
    const c1 = postgres(url ?? "", { prepare: false, max: 1 });
    const c2 = postgres(url ?? "", { prepare: false, max: 1 });
    try {
      await Promise.all([
        orgRepo.addStaff(c1, {
          gymId: org.org.id,
          email: "orgs-t-staff-race-target@example.com",
          role: "manager",
          privileges: orgService.defaultPrivilegesFor("manager"),
          actorUserId: owner.userId,
        }),
        orgRepo.removeMember(c2, {
          gymId: org.org.id,
          userId: target.userId,
          actorUserId: owner.userId,
        }),
      ]);
    } finally {
      await c1.end({ timeout: 5 });
      await c2.end({ timeout: 5 });
    }

    // WHICHEVER order the lock granted, the two facts must agree: a staff row
    // exists only alongside a live membership.
    const staffRows = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_staff
      WHERE gym_id = ${org.org.id} AND user_id = ${target.userId}`;
    const liveRows = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_members
      WHERE gym_id = ${org.org.id} AND user_id = ${target.userId} AND removed_at IS NULL`;
    expect(staffRows[0]?.n).toBe(liveRows[0]?.n);

    // And the authorisation answer agrees with both — the second line of
    // defence, which holds even if a future edit drops the lock.
    const role = await staffRoleOf(org.org.id, target.userId);
    if ((liveRows[0]?.n ?? 0) === 0) expect(role).toBeNull();
    else expect(role).toBe("manager");
  });

  /** T3 round 1, C/H-3 — the regression. Deleting an account closes memberships
   *  and leaves `gym_staff` standing, and restore deliberately does not reopen
   *  a membership; without the fix that hands a non-member the whole roster. */
  it("GHOST: a deleted account's staff row grants nothing, before or after a restore", async () => {
    const owner = await makeUser("staff-ghost-owner");
    const ghost = await makeUser("staff-ghost-ghost");
    const org = await makeOrg(owner.cookies, "Orgs Test Staff Ghost");
    await joinAsMember(ghost.cookies, org, owner.cookies);
    await post(
      `/v1/orgs/${org.org.id}/staff`,
      { email: "orgs-t-staff-ghost-ghost@example.com", role: "manager" },
      { cookies: owner.cookies },
    );
    expect(await staffRoleOf(org.org.id, ghost.userId)).toBe("manager");

    // The DPDP Day-0 cascade: memberships close, `gym_staff` is untouched.
    await sql`UPDATE gym_members SET removed_at = now()
              WHERE gym_id = ${org.org.id} AND user_id = ${ghost.userId} AND removed_at IS NULL`;
    await sql`UPDATE users SET status = 'deleted', deleted_at = now() WHERE id = ${ghost.userId}`;
    expect(await staffRoleOf(org.org.id, ghost.userId)).toBeNull();

    // Restore. The account is live again; the membership deliberately is not.
    await sql`UPDATE users SET status = 'active', deleted_at = NULL WHERE id = ${ghost.userId}`;
    expect(await staffRoleOf(org.org.id, ghost.userId)).toBeNull();

    // The OWNER is exempt and must stay exempt — a gym whose owner opted out of
    // membership (`gyms.owner_included_as_member`) must not be locked out.
    await sql`UPDATE gym_members SET removed_at = now()
              WHERE gym_id = ${org.org.id} AND user_id = ${owner.userId} AND removed_at IS NULL`;
    expect(await staffRoleOf(org.org.id, owner.userId)).toBe("owner");

    // STAFF WHO WERE NEVER MEMBERS — the state §4.7's invite-by-email flow will
    // produce, and the ONLY case the account-status check carries on its own.
    // Added because mutant O86 SURVIVED without it: the arms above all deny on
    // the closed membership, so deleting the status check changed nothing they
    // could see, and a no-op mutation reports ALIVE — "this guarantee has no
    // test" (:5104 F5, found by the instrument rather than by reading).
    const invited = await makeUser("staff-ghost-invited");
    await sql`INSERT INTO gym_staff (gym_id, user_id, role)
              VALUES (${org.org.id}, ${invited.userId}, 'trainer')`;
    expect(await staffRoleOf(org.org.id, invited.userId)).toBe("trainer");
    await sql`UPDATE users SET status = 'deleted', deleted_at = now() WHERE id = ${invited.userId}`;
    expect(await staffRoleOf(org.org.id, invited.userId)).toBeNull();
  });

  /** T3 round 2, C/H-1. Round 1's three fixes added three `gym_id` predicates
   *  and NOT ONE had a test — deleting any of them left all 88 green. The code
   *  was right; nothing would have noticed it going wrong. These two tests are
   *  the alarm, and each names the cost of the predicate it guards. */
  it("CROSS-GYM: being staff at one gym does not free your seat at another", { timeout: 30_000 }, async () => {
    const ownerA = await makeUser("xg-seat-owner-a");
    const ownerB = await makeUser("xg-seat-owner-b");
    const dual = await makeUser("xg-seat-dual");
    const walkIn = await makeUser("xg-seat-walkin");
    const gymA = await makeOrg(ownerA.cookies, "Orgs Test Cross Seat A");
    const gymB = await makeOrg(ownerB.cookies, "Orgs Test Cross Seat B");
    await subscribeGym(gymB.org.id, CAP1_PLAN); // gym B has ONE paid seat

    // The same person trains at B and works the desk at A.
    await joinAsMember(dual.cookies, gymA, ownerA.cookies);
    await joinAsMember(dual.cookies, gymB, ownerB.cookies);
    await post(
      `/v1/orgs/${gymA.org.id}/staff`,
      { email: "orgs-t-xg-seat-dual@example.com", role: "trainer" },
      { cookies: ownerA.cookies },
    );

    // Gym B is FULL. Their staff badge belongs to gym A and must not spend
    // gym B's money — without the gym scope on the staff exclusion, B's one
    // paid seat reads as free and B under-counts what it sold.
    await applyWithCode(walkIn.cookies, gymB.joinCode.code);
    const queue = JSON.parse(
      (await get(`/v1/orgs/${gymB.org.id}/applications`, { cookies: ownerB.cookies })).body,
    ) as { items: { id: string; userId: string }[] };
    const pending = queue.items.find((a) => a.userId === walkIn.userId)?.id ?? "none";
    const refused = await post(
      `/v1/orgs/${gymB.org.id}/applications/${pending}/confirm`,
      {},
      { cookies: ownerB.cookies },
    );
    expect(refused.statusCode).toBe(409);

    // AND THE ROSTER MUST SAY THE SAME THING — T3 L-1 on the badge card
    // (:15093), which added a FOURTH `gym_id` predicate and gave it no
    // observer. Measured before it was written: deleting `s.gym_id = m.gym_id`
    // from the roster's own copy left the whole 92-test file green, including
    // the both-ends test the record names as what stops the two copies
    // drifting. **:14401 round 2 wrote O88–O90 for exactly this class — "round
    // 1's three fixes added three `gym_id` predicates and NOT ONE had a test" —
    // and this card repeated the omission one predicate later.**
    //
    // Asserted HERE rather than in a new test, on the fixture that already
    // exists, because the door's refusal three lines up and the roster's answer
    // are the two ends of one rule: this person's keys belong to gym A, so gym B
    // both charges for them and must SAY it charges for them.
    const rosterB = JSON.parse(
      (await get(`/v1/orgs/${gymB.org.id}/members`, { cookies: ownerB.cookies })).body,
    ) as { items: { userId: string; takesSeat: boolean }[] };
    expect(rosterB.items.find((m) => m.userId === dual.userId)?.takesSeat).toBe(true);
    // The control, so this cannot pass by reporting everybody as paying: gym A,
    // where the keys actually are, says the same person's place is free.
    const rosterA = JSON.parse(
      (await get(`/v1/orgs/${gymA.org.id}/members`, { cookies: ownerA.cookies })).body,
    ) as { items: { userId: string; takesSeat: boolean }[] };
    expect(rosterA.items.find((m) => m.userId === dual.userId)?.takesSeat).toBe(false);
  });

  it("CROSS-GYM: authority at one gym is never decided by membership at another", { timeout: 30_000 }, async () => {
    const ownerA = await makeUser("xg-auth-owner-a");
    const ownerB = await makeUser("xg-auth-owner-b");
    const exMember = await makeUser("xg-auth-ex");
    const invited = await makeUser("xg-auth-invited");
    const gymA = await makeOrg(ownerA.cookies, "Orgs Test Cross Auth A");
    const gymB = await makeOrg(ownerB.cookies, "Orgs Test Cross Auth B");

    // (a) LEFT gym A, still trains at gym B. The live-member arm must not be
    // rescued by the WRONG gym's membership — that is C/H-3's hole reopened
    // sideways.
    await joinAsMember(exMember.cookies, gymA, ownerA.cookies);
    await joinAsMember(exMember.cookies, gymB, ownerB.cookies);
    await post(
      `/v1/orgs/${gymA.org.id}/staff`,
      { email: "orgs-t-xg-auth-ex@example.com", role: "manager" },
      { cookies: ownerA.cookies },
    );
    await del(`/v1/orgs/${gymA.org.id}/staff/${exMember.userId}`, { cookies: ownerA.cookies });
    await del(`/v1/orgs/${gymA.org.id}/members/${exMember.userId}`, { cookies: ownerA.cookies });
    await sql`INSERT INTO gym_staff (gym_id, user_id, role)
              VALUES (${gymA.org.id}, ${exMember.userId}, 'manager')`;
    expect(await staffRoleOf(gymA.org.id, exMember.userId)).toBeNull();

    // (b) NEVER a member of gym A — §4.7's invited manager — who happens to
    // train at gym B. The never-a-member arm must look at gym A only, or the
    // allow silently becomes a deny.
    await joinAsMember(invited.cookies, gymB, ownerB.cookies);
    await sql`INSERT INTO gym_staff (gym_id, user_id, role)
              VALUES (${gymA.org.id}, ${invited.userId}, 'trainer')`;
    expect(await staffRoleOf(gymA.org.id, invited.userId)).toBe("trainer");
  });

  /** T3 round 2, Low-2. The list and the authority check are two readers of
   *  `gym_staff` and must never disagree about who holds keys — the round-1 fix
   *  taught one of them and not the other. This test drives BOTH, which is what
   *  keeps two written-out copies honest (:14013's precedent). */
  it("the staff LIST and the authority check agree about every row", async () => {
    const owner = await makeUser("agree-owner");
    const ghost = await makeUser("agree-ghost");
    const live = await makeUser("agree-live");
    const org = await makeOrg(owner.cookies, "Orgs Test Staff Agreement");
    await joinAsMember(ghost.cookies, org, owner.cookies);
    await joinAsMember(live.cookies, org, owner.cookies);
    for (const [who, role] of [
      ["orgs-t-agree-ghost@example.com", "manager"],
      ["orgs-t-agree-live@example.com", "trainer"],
    ] as const) {
      await post(`/v1/orgs/${org.org.id}/staff`, { email: who, role }, { cookies: owner.cookies });
    }
    expect((await readStaff(org.org.id, owner.cookies)).map((s) => s.role)).toEqual([
      "owner",
      "manager",
      "trainer",
    ]);

    // Delete one account, the way the DPDP Day-0 cascade does.
    await sql`UPDATE gym_members SET removed_at = now()
              WHERE gym_id = ${org.org.id} AND user_id = ${ghost.userId} AND removed_at IS NULL`;
    await sql`UPDATE users SET status = 'deleted', deleted_at = now() WHERE id = ${ghost.userId}`;

    const listed = await readStaff(org.org.id, owner.cookies);
    for (const person of [owner, ghost, live]) {
      const onList = listed.some((s) => s.userId === person.userId);
      const hasAuthority = (await staffRoleOf(org.org.id, person.userId)) !== null;
      expect({ userId: person.userId, onList }).toEqual({
        userId: person.userId,
        onList: hasAuthority,
      });
    }
    // And concretely: the deleted manager is gone from the screen, not shown
    // holding a role they no longer hold.
    expect(listed.map((s) => s.userId)).not.toContain(ghost.userId);
  });

  /** O3's subject, restored. That mutant deletes `complimentary = false` from
   *  the seat count, and it SURVIVED once the staff exclusion landed — because
   *  the only complimentary member in the product is the owner, who is also
   *  staff and is therefore excluded twice over. The clause is still the spec's
   *  own wording (§4.2, "count live, non-complimentary members") and still the
   *  column's meaning, so it stays; what it needed was a case where the two
   *  exclusions do not overlap. */
  it("a COMPLIMENTARY member who is not staff still does not consume a paid seat", async () => {
    const owner = await makeUser("staff-comp-owner");
    const comped = await makeUser("staff-comp-comped");
    const walkIn = await makeUser("staff-comp-walkin");
    const org = await makeOrg(owner.cookies, "Orgs Test Comped Seat");
    await subscribeGym(org.org.id, CAP1_PLAN); // one paid seat
    await joinAsMember(comped.cookies, org, owner.cookies);

    // Comped by hand: nothing in the product writes this today except the
    // owner's own seat, and the column exists precisely to say "unpaid".
    await sql`UPDATE gym_members SET complimentary = true
              WHERE gym_id = ${org.org.id} AND user_id = ${comped.userId} AND removed_at IS NULL`;
    expect(await staffRoleOf(org.org.id, comped.userId)).toBeNull();

    // The one paid seat is therefore still free.
    await applyWithCode(walkIn.cookies, org.joinCode.code);
    const queue = JSON.parse(
      (await get(`/v1/orgs/${org.org.id}/applications`, { cookies: owner.cookies })).body,
    ) as { items: { id: string; userId: string }[] };
    const pending = queue.items.find((a) => a.userId === walkIn.userId)?.id ?? "none";
    const admitted = await post(
      `/v1/orgs/${org.org.id}/applications/${pending}/confirm`,
      {},
      { cookies: owner.cookies },
    );
    expect(admitted.statusCode).toBe(200);
  });

  it("a MANAGER and a TRAINER are refused all five staff routes with 403", async () => {
    const owner = await makeUser("staff-403-owner");
    const manager = await makeUser("staff-403-manager");
    const trainer = await makeUser("staff-403-trainer");
    const org = await makeOrg(owner.cookies, "Orgs Test Staff Denied");
    await joinAsMember(manager.cookies, org, owner.cookies);
    await joinAsMember(trainer.cookies, org, owner.cookies);
    await post(
      `/v1/orgs/${org.org.id}/staff`,
      { email: "orgs-t-staff-403-manager@example.com", role: "manager" },
      { cookies: owner.cookies },
    );
    await post(
      `/v1/orgs/${org.org.id}/staff`,
      { email: "orgs-t-staff-403-trainer@example.com", role: "trainer" },
      { cookies: owner.cookies },
    );

    // 403 and NOT 404: these two are staff of this gym, so they already know it
    // exists — the 404 disguise is for strangers, and using it here would be a
    // lie to somebody standing inside the building.
    for (const who of [manager, trainer]) {
      expect((await get(`/v1/orgs/${org.org.id}/staff`, { cookies: who.cookies })).statusCode).toBe(
        403,
      );
      const added = await post(
        `/v1/orgs/${org.org.id}/staff`,
        { email: "orgs-t-staff-403-owner@example.com", role: "trainer" },
        { cookies: who.cookies },
      );
      expect(added.statusCode).toBe(403);
      const changed = await patch(
        `/v1/orgs/${org.org.id}/staff/${trainer.userId}`,
        { role: "manager" },
        { cookies: who.cookies },
      );
      expect(changed.statusCode).toBe(403);
      const removed = await del(`/v1/orgs/${org.org.id}/staff/${trainer.userId}`, {
        cookies: who.cookies,
      });
      expect(removed.statusCode).toBe(403);
      // THE TICKS ROUTE, and this comment says LESS than it used to on purpose
      // (T3 round 2, Low-3). Round 1 found it claiming to shut ":11429 rule 1's
      // privilege-escalation door" while that door stood wide open and this test
      // stayed green — it asserts the DEFAULT state (a manager holds no
      // `staff.manage`, so the route refuses them), never the invariant.
      // **What shuts the escalation door is the ESCALATION test above**, which
      // fails without the refusal in `setStaffPrivileges`; this one proves the
      // route is not reachable by a staff member who was never granted the tick.
      const ticked = await put(
        `/v1/orgs/${org.org.id}/staff/${who.userId}/privileges`,
        { privileges: ["members.read", "codes.invite", "staff.manage"] },
        { cookies: who.cookies },
      );
      expect(ticked.statusCode).toBe(403);
    }

    expect(await readStaff(org.org.id, owner.cookies)).toHaveLength(3);
    // And the refusals left nothing behind: neither of them holds the tick they
    // tried to hand themselves.
    for (const who of [manager, trainer]) {
      expect(await storedPrivileges(org.org.id, who.userId)).not.toContain("staff.manage");
    }
  });

  /** R3.2's required case, for all four routes at once: another gym's OWNER —
   *  somebody with a real session and real authority somewhere else — must not
   *  reach this gym, and must not learn that it exists. */
  it("another gym's owner gets 404 from every staff route", async () => {
    const owner = await makeUser("staff-tenant-owner");
    const hire = await makeUser("staff-tenant-hire");
    const stranger = await makeUser("staff-tenant-stranger");
    const org = await makeOrg(owner.cookies, "Orgs Test Staff Tenancy");
    await makeOrg(stranger.cookies, "Orgs Test Staff Tenancy Other");
    await joinAsMember(hire.cookies, org, owner.cookies);

    expect(
      (await get(`/v1/orgs/${org.org.id}/staff`, { cookies: stranger.cookies })).statusCode,
    ).toBe(404);
    expect(
      (
        await post(
          `/v1/orgs/${org.org.id}/staff`,
          { email: "orgs-t-staff-tenant-hire@example.com", role: "trainer" },
          { cookies: stranger.cookies },
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await patch(
          `/v1/orgs/${org.org.id}/staff/${owner.userId}`,
          { role: "trainer" },
          { cookies: stranger.cookies },
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await put(
          `/v1/orgs/${org.org.id}/staff/${owner.userId}/privileges`,
          { privileges: [] },
          { cookies: stranger.cookies },
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (await del(`/v1/orgs/${org.org.id}/staff/${owner.userId}`, { cookies: stranger.cookies }))
        .statusCode,
    ).toBe(404);

    // Nothing moved. The ticks line is not decoration: a 404 that had already
    // written would be the worst possible pass — the gym's owner stripped of
    // everything by somebody who was told the gym does not exist.
    expect(await readStaff(org.org.id, owner.cookies)).toHaveLength(1);
    expect(await storedPrivileges(org.org.id, owner.userId)).toContain("staff.manage");
  });

  it("rejects a malformed staff request at the boundary", async () => {
    const owner = await makeUser("staff-400-owner");
    const org = await makeOrg(owner.cookies, "Orgs Test Staff Validation");

    // Unknown role.
    expect(
      (
        await post(
          `/v1/orgs/${org.org.id}/staff`,
          { email: "orgs-t-staff-400-owner@example.com", role: "receptionist" },
          { cookies: owner.cookies },
        )
      ).statusCode,
    ).toBe(400);
    // Unknown key — `.strict()` rejects rather than silently carrying it.
    expect(
      (
        await post(
          `/v1/orgs/${org.org.id}/staff`,
          { email: "orgs-t-staff-400-owner@example.com", role: "trainer", privileges: ["all"] },
          { cookies: owner.cookies },
        )
      ).statusCode,
    ).toBe(400);
    // A non-uuid in the path is a 400 at the boundary, never a 500 from
    // Postgres refusing the cast (:4483's shape).
    expect(
      (await get(`/v1/orgs/not-a-uuid/staff`, { cookies: owner.cookies })).statusCode,
    ).toBe(400);
    expect(
      (
        await del(`/v1/orgs/${org.org.id}/staff/not-a-uuid`, { cookies: owner.cookies })
      ).statusCode,
    ).toBe(400);
  });

  it("every staff route requires a session", async () => {
    const owner = await makeUser("staff-anon-owner");
    const org = await makeOrg(owner.cookies, "Orgs Test Staff Anon");
    const id = org.org.id;

    expect((await get(`/v1/orgs/${id}/staff`)).statusCode).toBe(401);
    expect(
      (await post(`/v1/orgs/${id}/staff`, { email: "a@example.com", role: "trainer" })).statusCode,
    ).toBe(401);
    expect(
      (await patch(`/v1/orgs/${id}/staff/${owner.userId}`, { role: "trainer" })).statusCode,
    ).toBe(401);
    // The ticks route is named HERE and not only in its own tests, because
    // :12227's L-1 is precisely this test claiming to cover "every route" while
    // naming five of nine — a route added later inherits the claim and none of
    // the checking.
    expect(
      (await put(`/v1/orgs/${id}/staff/${owner.userId}/privileges`, { privileges: [] })).statusCode,
    ).toBe(401);
    expect((await del(`/v1/orgs/${id}/staff/${owner.userId}`)).statusCode).toBe(401);
  });

  // -------------------------------------------------------------------------
  // PER-STAFF PRIVILEGE TICKS (Kd ruling :11429, amended :14745, and the
  // snapshot-vs-named-role question settled by him on 2026-08-22: nothing
  // changes on its own, an owner taps to push a change).
  //
  // The ROLE picks the starting ticks; the TICKS are what the server enforces.
  // Every test below therefore proves the change through a ROUTE the ticked
  // person calls, never by reading the column — a stored array nobody consults
  // is not a permission (:11429 rule 4).
  // -------------------------------------------------------------------------

  it("gives a new appointment the ticks its role starts with", async () => {
    const owner = await makeUser("ticks-start-owner");
    const hire = await makeUser("ticks-start-hire");
    const org = await makeOrg(owner.cookies, "Orgs Test Ticks Start");
    await joinAsMember(hire.cookies, org, owner.cookies);
    await post(
      `/v1/orgs/${org.org.id}/staff`,
      { email: "orgs-t-ticks-start-hire@example.com", role: "trainer" },
      { cookies: owner.cookies },
    );

    // The row carries its set from the first moment (:11429's snapshot): a
    // staff record that is briefly tick-less would be a staff record whose
    // authority depends on when you looked.
    expect(await storedPrivileges(org.org.id, hire.userId)).toEqual([
      "codes.invite",
      "members.read",
    ]);
    // The owner's own row got one when the gym was created, through the same
    // path — nothing about this is special-cased for appointments.
    expect(await storedPrivileges(org.org.id, owner.userId)).toContain("staff.manage");

    const staff = await readStaff(org.org.id, owner.cookies);
    expect(staff.find((s) => s.userId === hire.userId)?.privileges).toEqual([
      "codes.invite",
      "members.read",
    ]);
  });

  /** T3 ROUND 1 C/H-1, THE SERVER HALF. `/v1/orgs/mine` told a caller their
   *  ROLE and never their POWERS, so the console had no way to ask the question
   *  the server answers — it asked "are you a manager?" instead, and a trainer
   *  handed `codes.manage` got a stored tick with no control anywhere.
   *
   *  Asserted for a TRAINER WHO HOLDS A TICK THEIR ROLE DOES NOT GRANT, which is
   *  the only shape that can tell this apart from the old behaviour: for anybody
   *  on their role's defaults, "the role's template" and "the stored set" are
   *  the same list, so a test on a default row would pass against a server that
   *  still sends nothing but the role (:5104 F5 — a fix whose protection cannot
   *  fail). The default-row and non-staff cases are the controls beneath it. */
  // 30s for the same reason four neighbours carry it (:15381 Low-4): this walks
  // create → join → confirm → appoint → tick → read → create-a-code, and on the
  // remote database that is well past the 5s default. The margin is headroom,
  // not a performance claim.
  it("tells a caller what they may DO here, not just what they are called", { timeout: 30_000 }, async () => {
    const owner = await makeUser("mine-privs-owner");
    const desk = await makeUser("mine-privs-desk");
    const org = await makeOrg(owner.cookies, "Orgs Test Mine Privileges");
    await joinAsMember(desk.cookies, org, owner.cookies);
    await post(
      `/v1/orgs/${org.org.id}/staff`,
      { email: "orgs-t-mine-privs-desk@example.com", role: "trainer" },
      { cookies: owner.cookies },
    );

    type MineRow = { id: string; staffRole: string | null; privileges?: string[] };
    const readMine = async (cookies: Record<string, string>): Promise<MineRow> => {
      const res = await get("/v1/orgs/mine", { cookies });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { orgs: MineRow[] };
      const row = body.orgs.find((o) => o.id === org.org.id);
      // Thrown rather than `!`-asserted: R2.2 bans the non-null assertion, and a
      // throw names the missing gym instead of failing later on `undefined`.
      if (row === undefined) throw new Error(`gym ${org.org.id} missing from /orgs/mine`);
      return row;
    };

    // CONTROL: on their role's defaults the two answers agree, which is exactly
    // why this row cannot carry the claim on its own.
    const before = await readMine(desk.cookies);
    expect(before.staffRole).toBe("trainer");
    expect(before.privileges).toEqual(["codes.invite", "members.read"]);

    // THE SUBJECT: the owner ticks on a power the trainer's role does not grant.
    expect(
      (
        await put(
          `/v1/orgs/${org.org.id}/staff/${desk.userId}/privileges`,
          { privileges: ["members.read", "codes.invite", "codes.manage"] },
          { cookies: owner.cookies },
        )
      ).statusCode,
    ).toBe(200);

    const after = await readMine(desk.cookies);
    // Still a trainer — the ROLE did not move, and the screen still says so.
    expect(after.staffRole).toBe("trainer");
    // ...but the answer the console gates on now differs from the role's
    // template, which is the whole point.
    expect(after.privileges).toContain("codes.manage");
    expect(after.privileges).not.toEqual(before.privileges);

    // AND IT AGREES WITH THE DOOR. Without this the response is just a field:
    // the claim is that what a screen draws and what the server allows are the
    // same answer, so the route the tick unlocks is exercised too (:14013's
    // both-ends precedent).
    expect(
      (await post(`/v1/orgs/${org.org.id}/codes`, {}, { cookies: desk.cookies })).statusCode,
    ).toBe(201);

    // CONTROL: somebody who staffs nothing gets an empty set, never a fallback
    // to a role they do not hold.
    const plain = await makeUser("mine-privs-plain");
    await joinAsMember(plain.cookies, org, owner.cookies);
    const plainRow = await readMine(plain.cookies);
    expect(plainRow.staffRole).toBeNull();
    expect(plainRow.privileges).toEqual([]);
  });

  /** THE FEATURE, IN THE DIRECTION KD ASKED FOR FIRST (:11891 — "if owner gives
   *  permission others can also add"): a gym whose front desk is a TRAINER
   *  could not let anybody in, and now can.
   *
   *  Proven through the confirm ROUTE at both ends, because that is the whole
   *  claim. A test that only read the column back would pass just as happily
   *  against a server that ignores it. */
  it("WIDEN: an owner can give one trainer the power to let people in", async () => {
    const owner = await makeUser("ticks-widen-owner");
    const desk = await makeUser("ticks-widen-desk");
    const joiner = await makeUser("ticks-widen-joiner");
    const org = await makeOrg(owner.cookies, "Orgs Test Ticks Widen");
    await joinAsMember(desk.cookies, org, owner.cookies);
    await post(
      `/v1/orgs/${org.org.id}/staff`,
      { email: "orgs-t-ticks-widen-desk@example.com", role: "trainer" },
      { cookies: owner.cookies },
    );
    await applyWithCode(joiner.cookies, org.joinCode.code);
    const queued = JSON.parse(
      (await get(`/v1/orgs/${org.org.id}/applications`, { cookies: owner.cookies })).body,
    ) as { items: { id: string; userId: string }[] };
    const application = queued.items.find((a) => a.userId === joiner.userId)?.id ?? "none";

    // BEFORE: §2.2 gives a trainer no say in who is in the gym.
    const refused = await post(
      `/v1/orgs/${org.org.id}/applications/${application}/confirm`,
      {},
      { cookies: desk.cookies },
    );
    expect(refused.statusCode).toBe(403);

    const ticked = await put(
      `/v1/orgs/${org.org.id}/staff/${desk.userId}/privileges`,
      { privileges: ["members.read", "codes.invite", "members.confirm"] },
      { cookies: owner.cookies },
    );
    expect(ticked.statusCode).toBe(200);
    expect((JSON.parse(ticked.body) as { staff: StaffBody }).staff.privileges).toEqual([
      "codes.invite",
      "members.confirm",
      "members.read",
    ]);

    // AFTER: the same call, the same person, now allowed — and the member is
    // actually in, not merely un-refused.
    const allowed = await post(
      `/v1/orgs/${org.org.id}/applications/${application}/confirm`,
      {},
      { cookies: desk.cookies },
    );
    expect(allowed.statusCode).toBe(200);
    const roster = JSON.parse(
      (await get(`/v1/orgs/${org.org.id}/members`, { cookies: owner.cookies })).body,
    ) as { items: { userId: string }[] };
    expect(roster.items.map((m) => m.userId)).toContain(joiner.userId);
  });

  /** THE OTHER DIRECTION, and the one a gym reaches for after somebody
   *  mis-uses a control: narrowing has to actually narrow. */
  it("NARROW: an owner can take one power off a manager and leave the rest", async () => {
    const owner = await makeUser("ticks-narrow-owner");
    const manager = await makeUser("ticks-narrow-manager");
    const member = await makeUser("ticks-narrow-member");
    const org = await makeOrg(owner.cookies, "Orgs Test Ticks Narrow");
    await joinAsMember(manager.cookies, org, owner.cookies);
    await joinAsMember(member.cookies, org, owner.cookies);
    await post(
      `/v1/orgs/${org.org.id}/staff`,
      { email: "orgs-t-ticks-narrow-manager@example.com", role: "manager" },
      { cookies: owner.cookies },
    );

    // A manager may remove members by default (§2.2's own row).
    expect(
      (await get(`/v1/orgs/${org.org.id}/members`, { cookies: manager.cookies })).statusCode,
    ).toBe(200);

    const ticked = await put(
      `/v1/orgs/${org.org.id}/staff/${manager.userId}/privileges`,
      { privileges: ["members.read", "codes.invite", "members.confirm", "codes.manage"] },
      { cookies: owner.cookies },
    );
    expect(ticked.statusCode).toBe(200);

    // The one power that was taken away is gone...
    const removal = await del(`/v1/orgs/${org.org.id}/members/${member.userId}`, {
      cookies: manager.cookies,
    });
    expect(removal.statusCode).toBe(403);
    // ...and the member is still there, which is the half that would matter to
    // a person: a 403 that had already deleted somebody is not a refusal.
    const roster = JSON.parse(
      (await get(`/v1/orgs/${org.org.id}/members`, { cookies: owner.cookies })).body,
    ) as { items: { userId: string }[] };
    expect(roster.items.map((m) => m.userId)).toContain(member.userId);
    // ...while everything NOT unticked still works. Without this the test would
    // pass just as well against a server that refuses a narrowed person
    // everything.
    expect(
      (await get(`/v1/orgs/${org.org.id}/members`, { cookies: manager.cookies })).statusCode,
    ).toBe(200);
    expect(
      (await get(`/v1/orgs/${org.org.id}/codes`, { cookies: manager.cookies })).statusCode,
    ).toBe(200);
  });

  /** :11429 RULE 2 — the hole this ruling opens and must therefore close. §4.7
   *  blocks removing the last owner; ticking away the same power reaches the
   *  identical lockout through another door, and NOBODY INSIDE THE GYM COULD
   *  REPAIR IT, because handing out `staff.manage` requires `staff.manage`. */
  it("LOCKOUT: the last owner cannot be ticked out of managing staff", async () => {
    const owner = await makeUser("ticks-lockout-owner");
    const org = await makeOrg(owner.cookies, "Orgs Test Ticks Lockout");

    const attempt = await put(
      `/v1/orgs/${org.org.id}/staff/${owner.userId}/privileges`,
      { privileges: ["members.read", "codes.invite"] },
      { cookies: owner.cookies },
    );
    expect(attempt.statusCode).toBe(409);
    expect((JSON.parse(attempt.body) as { error: string }).error).toBe("last_owner_locked");

    // NOTHING WAS WRITTEN. A 409 that had already saved would lock the gym out
    // while telling the owner it had refused.
    expect(await storedPrivileges(org.org.id, owner.userId)).toContain("staff.manage");
    expect(
      (await get(`/v1/orgs/${org.org.id}/staff`, { cookies: owner.cookies })).statusCode,
    ).toBe(200);

    // And the guard is not "an owner may change nothing": the same owner can
    // still edit their OWN other ticks, as long as the keys stay. Without this
    // the test above passes against a server that refuses owners outright.
    const allowed = await put(
      `/v1/orgs/${org.org.id}/staff/${owner.userId}/privileges`,
      { privileges: ["members.read", "staff.manage"] },
      { cookies: owner.cookies },
    );
    expect(allowed.statusCode).toBe(200);
    expect(await storedPrivileges(org.org.id, owner.userId)).toEqual([
      "members.read",
      "staff.manage",
    ]);
  });

  /** T3 C/H-1's REGRESSION TEST, and it fails without the fix (:5348 rule 3).
   *
   *  **The escalation the reviewer proved by running it:** `staff.manage` gates
   *  this very route, so one owner action handed a manager the power to change
   *  anybody's ticks — the owner's included. His chain was grant → the manager
   *  strips the owner → the owner gets 403 on their own roster. The route's gate
   *  was owner-only only because nothing could grant that tick, and granting
   *  ticks is what this card built: **the card made its own gate's premise
   *  false.** :11429 rule 1 restored.
   *
   *  Asserted at BOTH ends deliberately — the refusal, and that the refusal
   *  wrote nothing. A 409 that had already saved would be the escalation with a
   *  polite message on top. */
  it("ESCALATION: the owner's own power to manage staff cannot be given away", async () => {
    const owner = await makeUser("ticks-esc-owner");
    const manager = await makeUser("ticks-esc-manager");
    const trainer = await makeUser("ticks-esc-trainer");
    const org = await makeOrg(owner.cookies, "Orgs Test Ticks Escalation");
    await joinAsMember(manager.cookies, org, owner.cookies);
    await joinAsMember(trainer.cookies, org, owner.cookies);
    await post(
      `/v1/orgs/${org.org.id}/staff`,
      { email: "orgs-t-ticks-esc-manager@example.com", role: "manager" },
      { cookies: owner.cookies },
    );
    await post(
      `/v1/orgs/${org.org.id}/staff`,
      { email: "orgs-t-ticks-esc-trainer@example.com", role: "trainer" },
      { cookies: owner.cookies },
    );

    for (const who of [manager, trainer]) {
      const attempt = await put(
        `/v1/orgs/${org.org.id}/staff/${who.userId}/privileges`,
        { privileges: ["members.read", "staff.manage"] },
        { cookies: owner.cookies },
      );
      expect(attempt.statusCode).toBe(409);
      expect((JSON.parse(attempt.body) as { error: string }).error).toBe("owner_only_privilege");
      // NOTHING WAS WRITTEN — not the forbidden tick, and not the rest of the
      // set either: a refusal that half-applied would leave a set nobody chose.
      expect(await storedPrivileges(org.org.id, who.userId)).not.toContain("staff.manage");
      // ...and the door itself is still shut, which is the claim that matters.
      expect(
        (await get(`/v1/orgs/${org.org.id}/staff`, { cookies: who.cookies })).statusCode,
      ).toBe(403);
    }

    // THE POSITIVE CONTROL, without which this test passes just as happily
    // against a server that refuses every tick change: everything NOT
    // owner-only is still grantable, and the owner keeps their own.
    const allowed = await put(
      `/v1/orgs/${org.org.id}/staff/${manager.userId}/privileges`,
      { privileges: ["members.read", "codes.invite", "codes.manage", "members.confirm"] },
      { cookies: owner.cookies },
    );
    expect(allowed.statusCode).toBe(200);
    expect(await storedPrivileges(org.org.id, owner.userId)).toContain("staff.manage");
  });

  /** T3 Low-1 (latent Critical): the guard counted owner ROWS, and stripping a
   *  privilege removes no row, so with two owners each could strip the other
   *  and the count never fell — both left unable to manage staff, and nobody
   *  inside the gym able to repair it.
   *
   *  Unreachable through the product today (`staffAssignableRoleSchema` is
   *  `manager|trainer` and `createOrgAttempt` writes one owner), so the second
   *  owner is inserted directly — the same way :14401's O87 test had to build
   *  the case its own count could not tell apart. */
  it("LOCKOUT: a second owner counts only while they still HOLD the power", async () => {
    const owner = await makeUser("ticks-two-owner");
    const second = await makeUser("ticks-two-second");
    const org = await makeOrg(owner.cookies, "Orgs Test Ticks Two Owners");
    await joinAsMember(second.cookies, org, owner.cookies);
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges)
              VALUES (${org.org.id}, ${second.userId}, 'owner',
                      ARRAY['codes.invite','codes.manage','members.confirm','members.read','members.remove','staff.manage']::text[])`;

    // Stripping the SECOND owner is allowed — the first still holds it. This
    // arm is the positive control: without it the test passes against a guard
    // that refuses every owner.
    const first = await put(
      `/v1/orgs/${org.org.id}/staff/${second.userId}/privileges`,
      { privileges: ["members.read"] },
      { cookies: owner.cookies },
    );
    expect(first.statusCode).toBe(200);
    expect(await storedPrivileges(org.org.id, second.userId)).toEqual(["members.read"]);

    // Now the first owner is the last HOLDER, though not the last owner ROW —
    // which is the distinction the old count could not make.
    const second_ = await put(
      `/v1/orgs/${org.org.id}/staff/${owner.userId}/privileges`,
      { privileges: ["members.read"] },
      { cookies: owner.cookies },
    );
    expect(second_.statusCode).toBe(409);
    expect((JSON.parse(second_.body) as { error: string }).error).toBe("last_owner_locked");
    expect(await storedPrivileges(org.org.id, owner.userId)).toContain("staff.manage");

    // And the gym is still runnable by somebody, which is the whole point of
    // the guard rather than a property of the error code.
    expect(
      (await get(`/v1/orgs/${org.org.id}/staff`, { cookies: owner.cookies })).statusCode,
    ).toBe(200);
  });

  /** T3 round 2, Low-1 — ONE FIXTURE, BOTH DOORS, because the rule is written
   *  out twice and this is what stops the copies drifting (:14013's precedent,
   *  the same instrument :14493 Low-2 chose for the same reason).
   *
   *  **The defect it pins: `removeStaff` still counted owner ROWS.** Counting
   *  rows was right while a row was the only thing carrying authority; since the
   *  ticks card an owner can be ticked DOWN, so two owner rows can mean ONE
   *  person who can manage staff — remove that person and the gym keeps an owner
   *  and loses the ability to appoint anybody. **Third time this guard has been
   *  copied and got the same thing wrong** (:14401's O87 at this door, round 1's
   *  Low-1 at the ticks door, this).
   *
   *  Both arms are here in one test on purpose: an edit that fixes one door and
   *  leaves the other fails HERE rather than in whichever suite nobody re-ran. */
  it("LOCKOUT: both doors refuse to leave a gym with an owner who cannot run it", async () => {
    const owner = await makeUser("ticks-doors-owner");
    const second = await makeUser("ticks-doors-second");
    const org = await makeOrg(owner.cookies, "Orgs Test Ticks Both Doors");
    await joinAsMember(second.cookies, org, owner.cookies);
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges)
              VALUES (${org.org.id}, ${second.userId}, 'owner',
                      ARRAY['codes.invite','codes.manage','members.confirm','members.read','members.remove','staff.manage']::text[])`;

    // Tick the second owner down. Allowed — the first still holds the keys.
    expect(
      (
        await put(
          `/v1/orgs/${org.org.id}/staff/${second.userId}/privileges`,
          { privileges: ["members.read"] },
          { cookies: owner.cookies },
        )
      ).statusCode,
    ).toBe(200);

    // DOOR 1, the ticks route: the first owner may not strip themselves.
    const stripped = await put(
      `/v1/orgs/${org.org.id}/staff/${owner.userId}/privileges`,
      { privileges: ["members.read"] },
      { cookies: owner.cookies },
    );
    expect(stripped.statusCode).toBe(409);
    expect((JSON.parse(stripped.body) as { error: string }).error).toBe("last_owner_locked");

    // DOOR 2, the remove route — THE ARM THAT WAS MISSING. Two owner ROWS exist,
    // so a row count says "go ahead"; only one of them can manage staff.
    const removed = await del(`/v1/orgs/${org.org.id}/staff/${owner.userId}`, {
      cookies: owner.cookies,
    });
    expect(removed.statusCode).toBe(409);
    expect((JSON.parse(removed.body) as { error: string }).error).toBe("last_owner");

    // THE CONTROL, without which both arms above pass against a guard that
    // simply refuses every owner: give the second owner the keys back and the
    // first may leave.
    expect(
      (
        await put(
          `/v1/orgs/${org.org.id}/staff/${second.userId}/privileges`,
          { privileges: ["members.read", "staff.manage"] },
          { cookies: owner.cookies },
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (await del(`/v1/orgs/${org.org.id}/staff/${owner.userId}`, { cookies: owner.cookies }))
        .statusCode,
    ).toBe(200);

    // And the gym is still runnable by the person who is left, which is the
    // whole point of both guards rather than a property of their error codes.
    expect(
      (await get(`/v1/orgs/${org.org.id}/staff`, { cookies: second.cookies })).statusCode,
    ).toBe(200);
  });

  /** A DEMOTION HAS TO DEMOTE. Without the reset, "change them to trainer"
   *  would leave every manager tick standing — the one control an owner reaches
   *  for to REDUCE somebody's access would reduce nothing. */
  it("changing somebody's role RESETS their ticks to that role's defaults", async () => {
    const owner = await makeUser("ticks-reset-owner");
    const person = await makeUser("ticks-reset-person");
    const member = await makeUser("ticks-reset-member");
    const org = await makeOrg(owner.cookies, "Orgs Test Ticks Reset");
    await joinAsMember(person.cookies, org, owner.cookies);
    await joinAsMember(member.cookies, org, owner.cookies);
    await post(
      `/v1/orgs/${org.org.id}/staff`,
      { email: "orgs-t-ticks-reset-person@example.com", role: "manager" },
      { cookies: owner.cookies },
    );
    // Hand-ticked WIDER than a manager starts: this is the state the reset has
    // to be able to clear.
    await put(
      `/v1/orgs/${org.org.id}/staff/${person.userId}/privileges`,
      { privileges: ["members.read", "codes.invite", "members.remove", "members.confirm"] },
      { cookies: owner.cookies },
    );

    const demoted = await patch(
      `/v1/orgs/${org.org.id}/staff/${person.userId}`,
      { role: "trainer" },
      { cookies: owner.cookies },
    );
    expect(demoted.statusCode).toBe(200);
    expect(await storedPrivileges(org.org.id, person.userId)).toEqual([
      "codes.invite",
      "members.read",
    ]);

    // Proven at a route, not only in the column: the power they were hand-given
    // is gone.
    expect(
      (await del(`/v1/orgs/${org.org.id}/members/${member.userId}`, { cookies: person.cookies }))
        .statusCode,
    ).toBe(403);

    // The audit row records the ticks the change reset them to, not only the
    // role — a role change is now also a permission change.
    const audit = await sql<{ meta: { to?: string; privileges?: string[] } }[]>`
      SELECT meta FROM audit_log
      WHERE gym_id = ${org.org.id} AND action = 'org.staff_role_changed'`;
    expect(audit).toHaveLength(1);
    expect(audit[0]?.meta.to).toBe("trainer");
    expect(audit[0]?.meta.privileges).toEqual(["codes.invite", "members.read"]);
  });

  it("writes an audit row naming both ends, and none at all when nothing changed", async () => {
    const owner = await makeUser("ticks-audit-owner");
    const hire = await makeUser("ticks-audit-hire");
    const org = await makeOrg(owner.cookies, "Orgs Test Ticks Audit");
    await joinAsMember(hire.cookies, org, owner.cookies);
    await post(
      `/v1/orgs/${org.org.id}/staff`,
      { email: "orgs-t-ticks-audit-hire@example.com", role: "trainer" },
      { cookies: owner.cookies },
    );

    const next = ["members.read", "codes.invite", "members.confirm"];
    expect(
      (
        await put(
          `/v1/orgs/${org.org.id}/staff/${hire.userId}/privileges`,
          { privileges: next },
          { cookies: owner.cookies },
        )
      ).statusCode,
    ).toBe(200);

    const rows = async () =>
      await sql<{ meta: { from?: string[]; to?: string[] } }[]>`
        SELECT meta FROM audit_log
        WHERE gym_id = ${org.org.id} AND action = 'org.staff_privileges_changed'`;
    const after = await rows();
    expect(after).toHaveLength(1);
    // BOTH ends: the question asked weeks later is "what could they do before",
    // which the new set alone cannot answer.
    expect(after[0]?.meta.from).toEqual(["codes.invite", "members.read"]);
    expect(after[0]?.meta.to).toEqual(["codes.invite", "members.confirm", "members.read"]);

    // Saving the same set again is a 200 and writes NOTHING: "the owner changed
    // what they can do" is a claim about something that happened, and re-saving
    // an unchanged set did not happen. Sent in a DIFFERENT order on purpose —
    // "did anything change" is a question about access, never about ordering.
    const repeat = await put(
      `/v1/orgs/${org.org.id}/staff/${hire.userId}/privileges`,
      { privileges: ["members.confirm", "members.read", "codes.invite"] },
      { cookies: owner.cookies },
    );
    expect(repeat.statusCode).toBe(200);
    expect(await rows()).toHaveLength(1);
  });

  /** THE DEPLOY WINDOW R4.4's expand-then-contract creates, and the reason
   *  `privilegesFor` has a null branch at all: a row written by code that
   *  predates the column must behave exactly as it did before, not as somebody
   *  with no privileges. Locking a gym's owner out of their own console for the
   *  length of a deploy would be a self-inflicted outage. */
  it("a staff row written before the ticks existed still works, as its role", async () => {
    const owner = await makeUser("ticks-legacy-owner");
    const legacy = await makeUser("ticks-legacy-manager");
    const org = await makeOrg(owner.cookies, "Orgs Test Ticks Legacy");
    await joinAsMember(legacy.cookies, org, owner.cookies);
    await post(
      `/v1/orgs/${org.org.id}/staff`,
      { email: "orgs-t-ticks-legacy-manager@example.com", role: "manager" },
      { cookies: owner.cookies },
    );

    // Exactly what old code left behind: a role, and no ticks.
    await sql`UPDATE gym_staff SET privileges = NULL
              WHERE gym_id = ${org.org.id} AND user_id = ${legacy.userId}`;
    expect(await storedPrivileges(org.org.id, legacy.userId)).toBeNull();

    // They can still do a manager's job...
    expect(
      (await get(`/v1/orgs/${org.org.id}/codes`, { cookies: legacy.cookies })).statusCode,
    ).toBe(200);
    // ...and no more than one: the fallback is the ROLE's defaults, not
    // everything. Without this line the test would pass against a null branch
    // that grants the lot.
    expect(
      (await get(`/v1/orgs/${org.org.id}/staff`, { cookies: legacy.cookies })).statusCode,
    ).toBe(403);
    // The screen shows the same effective set rather than an empty list.
    const listed = await readStaff(org.org.id, owner.cookies);
    expect(listed.find((s) => s.userId === legacy.userId)?.privileges).toEqual([
      "codes.invite",
      "codes.manage",
      "members.confirm",
      "members.read",
      "members.remove",
    ]);
  });

  it("refuses a tick nobody defined, and an unknown key", async () => {
    const owner = await makeUser("ticks-400-owner");
    const hire = await makeUser("ticks-400-hire");
    const org = await makeOrg(owner.cookies, "Orgs Test Ticks Validation");
    await joinAsMember(hire.cookies, org, owner.cookies);
    await post(
      `/v1/orgs/${org.org.id}/staff`,
      { email: "orgs-t-ticks-400-hire@example.com", role: "trainer" },
      { cookies: owner.cookies },
    );

    for (const body of [
      { privileges: ["members.read", "everything"] },
      { privileges: "members.read" },
      { privileges: ["members.read"], role: "manager" },
      {},
    ]) {
      const res = await put(`/v1/orgs/${org.org.id}/staff/${hire.userId}/privileges`, body, {
        cookies: owner.cookies,
      });
      expect(res.statusCode).toBe(400);
    }
    // Untouched by every refusal.
    expect(await storedPrivileges(org.org.id, hire.userId)).toEqual([
      "codes.invite",
      "members.read",
    ]);

    // Somebody who does not run this gym at all is a 404 from this route, the
    // same answer every other staff route gives about a person who is not on it.
    const outsider = await makeUser("ticks-400-outsider");
    const missing = await put(
      `/v1/orgs/${org.org.id}/staff/${outsider.userId}/privileges`,
      { privileges: ["members.read"] },
      { cookies: owner.cookies },
    );
    expect(missing.statusCode).toBe(404);
    expect((JSON.parse(missing.body) as { error: string }).error).toBe("not_staff");
  });

  /** The other half of the two-tap flow Kd was shown: while somebody is staff,
   *  the MEMBER remove button refuses them. This is pre-existing behaviour
   *  (`repo.removeMember`'s `is_staff` arm) and it is asserted HERE because this
   *  card is what finally makes a non-owner staff member reachable — before it,
   *  that arm could only ever fire on the owner. */
  it("a staff member cannot be removed from the member list until their keys are taken", async () => {
    const owner = await makeUser("staff-order-owner");
    const hire = await makeUser("staff-order-hire");
    const org = await makeOrg(owner.cookies, "Orgs Test Staff Order");
    await joinAsMember(hire.cookies, org, owner.cookies);
    await post(
      `/v1/orgs/${org.org.id}/staff`,
      { email: "orgs-t-staff-order-hire@example.com", role: "trainer" },
      { cookies: owner.cookies },
    );

    const blocked = await del(`/v1/orgs/${org.org.id}/members/${hire.userId}`, {
      cookies: owner.cookies,
    });
    expect(blocked.statusCode).toBe(409);

    await del(`/v1/orgs/${org.org.id}/staff/${hire.userId}`, { cookies: owner.cookies });
    const allowed = await del(`/v1/orgs/${org.org.id}/members/${hire.userId}`, {
      cookies: owner.cookies,
    });
    expect(allowed.statusCode).toBe(200);
  });
});
