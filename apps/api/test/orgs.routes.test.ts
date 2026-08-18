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

  it("joins by code, tolerates poster typing, and is idempotent on a repeat", { timeout: 30_000 }, async () => {
    const owner = await makeUser("join-owner");
    const member = await makeUser("join-member");
    const org = await makeOrg(owner.cookies, "Orgs Test Join");

    const typed = ` ${org.joinCode.code.toLowerCase().slice(0, 3)}-${org.joinCode.code.toLowerCase().slice(3)} `;
    const first = await post("/v1/orgs/join", { code: typed }, { cookies: member.cookies });
    expect(first.statusCode).toBe(200);
    const firstBody = JSON.parse(first.body) as {
      alreadyMember: boolean;
      org: { id: string };
      membership: { groupLabel: string | null };
    };
    expect(firstBody.alreadyMember).toBe(false);
    expect(firstBody.org.id).toBe(org.org.id);
    expect(firstBody.membership.groupLabel).toBe("Front Desk");

    const usesAfterFirst = await sql<{ uses: number }[]>`
      SELECT uses FROM gym_codes WHERE code = ${org.joinCode.code}`;
    expect(usesAfterFirst[0]?.uses).toBe(1);

    const again = await post(
      "/v1/orgs/join",
      { code: org.joinCode.code },
      { cookies: member.cookies },
    );
    expect(again.statusCode).toBe(200);
    expect((JSON.parse(again.body) as { alreadyMember: boolean }).alreadyMember).toBe(true);

    // A repeat tap must not burn a use — `uses` is what max_uses is checked
    // against, so double-counting it would retire a code early.
    const usesAfterRepeat = await sql<{ uses: number }[]>`
      SELECT uses FROM gym_codes WHERE code = ${org.joinCode.code}`;
    expect(usesAfterRepeat[0]?.uses).toBe(1);
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

  it("a legacy clinic row still demands consent on join, and records it (Part 3 §2.4)", { timeout: 30_000 }, async () => {
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
    const row = await sql<{ consent_at: Date | null }[]>`
      SELECT consent_at FROM gym_members
      WHERE gym_id = ${gymId} AND user_id = ${patient.userId} AND removed_at IS NULL`;
    expect(row[0]?.consent_at).not.toBeNull();
  });

  it("enforces the plan's seat cap, and the owner's complimentary seat does not consume one", { timeout: 30_000 }, async () => {
    const owner = await makeUser("cap-owner");
    const first = await makeUser("cap-first");
    const second = await makeUser("cap-second");
    const org = await makeOrg(owner.cookies, "Orgs Test Cap");
    await subscribeGym(org.org.id, CAP1_PLAN); // seat_cap = 1

    // The owner is already a member. If complimentary seats counted, this
    // first join would be the one refused.
    const ok = await post("/v1/orgs/join", { code: org.joinCode.code }, { cookies: first.cookies });
    expect(ok.statusCode).toBe(200);

    const full = await post(
      "/v1/orgs/join",
      { code: org.joinCode.code },
      { cookies: second.cookies },
    );
    expect(full.statusCode).toBe(409);
    const body = JSON.parse(full.body) as { error: string; message: string };
    expect(body.error).toBe("seat_cap_reached");
    // The cap is the gym's commercial business — the joiner is not told it.
    expect(body.message).not.toMatch(/\d/);

    // T3 ROUND 1 C/H-1 — the regression. A member who is ALREADY in the gym
    // re-submits the code while the gym is full. They are not asking for a
    // seat; they hold one, and they are inside the count the cap is compared
    // against. Before the fix this answered 409 "no free places" to somebody
    // standing in the gym, which is §4.2's idempotent success inverted.
    const rejoin = await post(
      "/v1/orgs/join",
      { code: org.joinCode.code },
      { cookies: first.cookies },
    );
    expect(rejoin.statusCode).toBe(200);
    expect((JSON.parse(rejoin.body) as { alreadyMember: boolean }).alreadyMember).toBe(true);

    // And the cap still bites for a genuinely new person — the fix must not
    // have opened the gate for everyone.
    const third = await makeUser("cap-third");
    expect(
      (await post("/v1/orgs/join", { code: org.joinCode.code }, { cookies: third.cookies }))
        .statusCode,
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

    const joined = await post(
      "/v1/orgs/join",
      { code: org.joinCode.code },
      { cookies: member.cookies },
    );
    expect(joined.statusCode).toBe(200);

    const after = await get("/v1/entitlements/me", { cookies: member.cookies });
    const afterBody = JSON.parse(after.body) as {
      source: string;
      entitlements: { history_days: number };
    };
    expect(afterBody.source).toBe("gym_membership");
    expect(afterBody.entitlements.history_days).toBe(-1);
  });

  it("serves the roster to staff and hides it from everyone else (R3.2)", { timeout: 30_000 }, async () => {
    const owner = await makeUser("roster-owner");
    const member = await makeUser("roster-member");
    const stranger = await makeUser("roster-stranger");
    const org = await makeOrg(owner.cookies, "Orgs Test Roster");
    expect(
      (await post("/v1/orgs/join", { code: org.joinCode.code }, { cookies: member.cookies }))
        .statusCode,
    ).toBe(200);

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
    expect(
      (await post(
        "/v1/orgs/join",
        { code: otherOrg.joinCode.code },
        { cookies: otherMember.cookies },
      )).statusCode,
    ).toBe(200);

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
    expect(
      (await post("/v1/orgs/join", { code: org.joinCode.code }, { cookies: member.cookies }))
        .statusCode,
    ).toBe(200);

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

  it("walks the roster by cursor without dupes or gaps (R7.3)", { timeout: 30_000 }, async () => {
    const owner = await makeUser("page-owner");
    const org = await makeOrg(owner.cookies, "Orgs Test Paging");
    for (const n of ["p1", "p2", "p3"]) {
      const u = await makeUser(`page-${n}`);
      expect(
        (await post("/v1/orgs/join", { code: org.joinCode.code }, { cookies: u.cookies }))
          .statusCode,
      ).toBe(200);
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
    const c1 = postgres(url ?? "", { prepare: false, max: 1 });
    const c2 = postgres(url ?? "", { prepare: false, max: 1 });
    try {
      const [r1, r2] = await Promise.all([
        orgRepo.joinByCode(c1, { userId: a.userId, code: org.joinCode.code, consent: false }),
        orgRepo.joinByCode(c2, { userId: b.userId, code: org.joinCode.code, consent: false }),
      ]);
      const kinds = [r1.kind, r2.kind].sort();
      expect(kinds).toEqual(["joined", "seat_cap"]);
    } finally {
      await c1.end({ timeout: 5 });
      await c2.end({ timeout: 5 });
    }

    const live = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_members
      WHERE gym_id = ${org.org.id} AND removed_at IS NULL AND complimentary = false`;
    expect(live[0]?.n).toBe(1);
  });

  it("collapses two simultaneous joins by the SAME person into one membership", { timeout: 60_000 }, async () => {
    const owner = await makeUser("dbl-owner");
    const eager = await makeUser("dbl-eager");
    const org = await makeOrg(owner.cookies, "Orgs Test Double");

    const c1 = postgres(url ?? "", { prepare: false, max: 1 });
    const c2 = postgres(url ?? "", { prepare: false, max: 1 });
    try {
      const results = await Promise.all([
        orgRepo.joinByCode(c1, { userId: eager.userId, code: org.joinCode.code, consent: false }),
        orgRepo.joinByCode(c2, { userId: eager.userId, code: org.joinCode.code, consent: false }),
      ]);
      expect(results.map((r) => r.kind).sort()).toEqual(["already_member", "joined"]);
    } finally {
      await c1.end({ timeout: 5 });
      await c2.end({ timeout: 5 });
    }

    const rows = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_members
      WHERE gym_id = ${org.org.id} AND user_id = ${eager.userId} AND removed_at IS NULL`;
    expect(rows[0]?.n).toBe(1);
    const uses = await sql<{ uses: number }[]>`
      SELECT uses FROM gym_codes WHERE code = ${org.joinCode.code}`;
    expect(uses[0]?.uses).toBe(1);
  });
});
