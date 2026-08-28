// THE GYM'S PRICE LIST AND THE ARM SELECTOR BEHIND THE UNSKIPPABLE PROMPT —
// Kd's rulings of 2026-08-28 (:22215, :22697), against REAL Postgres (R9.2).
// DATABASE_URL-gated.
//
// WHAT THIS FILE IS ACTUALLY GUARDING, because two of the four are guarantees
// rather than features:
//
//   1. **`GET /v1/orgs/:gymId/plans`** — the first time a price has ever left
//      this server. Asserted against the REAL SEEDED BOOK and not a fixture
//      (:18652's C/H-1: a suite whose every subject is a hand-made row proves
//      the mechanism and says nothing about the product), so these numbers are
//      Kd's ratified ones and a re-priced seed turns this red on purpose.
//
//   2. **`ownerTrialUsed` SURVIVES THE TRIAL ENDING.** This is the whole reason
//      the field exists. `subscription` goes null when a trial expires — the
//      LATERAL serves live statuses only — and that null is byte-identical to a
//      gym that never trialled, which is what put "Start your 30-day free trial"
//      over a button answering 409 (:22341 §7). A test that only checked the
//      field on a FRESH gym would pass with the whole defect intact.
//
//   3. **THE FIELD AND THE DOOR ARE DRIVEN ON ONE FIXTURE.** The rule "this
//      owner has spent their one trial" is now written in TWO places —
//      `listOrgsForUser`'s EXISTS and `startGymTrial`'s `used` query — and R3.8
//      forbids sharing them as an `sql` fragment. :14493's Low-2 is what drift
//      costs, so one test asserts the FIELD says used and the DOOR says 409, in
//      the same breath, on the same gym. :14013's six-site precedent.
//
//   4. **EVERY SUPPORTED COUNTRY CAN ACTUALLY BUY SOMETHING.** The country map
//      and the price book are separate files that nothing tied together, and
//      that gap is exactly how Canada, the UK and the euro area came to be
//      creatable but untrialable (:21157's gap (a), settled at :22215 §3.5).
//      Behind an unskippable prompt an empty book is a person sealed out of
//      their own console, so this walks the whole supported list every run.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { SUPPORTED_COUNTRIES, currencyForCountry } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "orgplans-test-secret-0123456789abc", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;

/** Vitest's default 5 s does not cover a registration (bcrypt cost 10), a login
 *  and a gym. Raised here and not globally (R1.1). */
const TEST_TIMEOUT_MS = 30_000;
const HOOK_TIMEOUT_MS = 60_000;

let ipCounter = 0;
const nextIp = () =>
  `10.9.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

interface CreatedOrg {
  org: { id: string; name: string; currencyDisplay: string };
  joinCode: { code: string; label: string };
}

interface PlanOffer {
  code: string;
  priceLabel: string;
  currency: string;
  interval: string;
  seatCap: number | null;
}

interface MyOrg {
  id: string;
  subscription: { status: string } | null;
  ownerTrialUsed: boolean | null;
}

d("gym price list + trial-arm selector (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  type Account = { userId: string; cookies: Record<string, string> };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'orgplans-t-%@example.com')`;
    // Order and reason are the sibling suites': the FKs have no cascade, so a
    // stray child blocks the parent DELETE with a 23503 naming nothing useful
    // (:10726 Low-2). `subscriptions.owner_id` is polymorphic and carries no FK.
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'orgplans-t-%@example.com'`;
  };

  beforeAll(async () => {
    await cleanup();
    app = await buildApp(loadConfig(baseEnv));
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
  const makeUser = async (tag: string): Promise<Account> => {
    const local = `${tag}-${String(userSeq++)}-${String(Date.now() % 100000)}`;
    const email = `orgplans-t-${local}@example.com`;
    const reg = await api().inject({
      method: "POST",
      url: "/v1/auth/register",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email, password: PASSWORD, displayName: `Plans ${local}` }),
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
  const makeOrg = async (
    cookies: Record<string, string>,
    country = "US",
  ): Promise<CreatedOrg> => {
    const res = await post(
      "/v1/orgs",
      {
        name: `Org Plans ${String(orgSeq++)} ${String(Date.now() % 100000)}`,
        city: "Austin",
        country,
        timezone: "Asia/Kolkata",
      },
      cookies,
    );
    expect(res.statusCode).toBe(201);
    return JSON.parse(res.body) as CreatedOrg;
  };

  const readPlans = async (gymId: string, cookies: Record<string, string>) => {
    const res = await get(`/v1/orgs/${gymId}/plans`, cookies);
    expect(res.statusCode).toBe(200);
    return (JSON.parse(res.body) as { plans: PlanOffer[] }).plans;
  };

  const readMyOrg = async (gymId: string, cookies: Record<string, string>): Promise<MyOrg> => {
    const res = await get("/v1/orgs/mine", cookies);
    expect(res.statusCode).toBe(200);
    const found = (JSON.parse(res.body) as { orgs: MyOrg[] }).orgs.find((o) => o.id === gymId);
    if (found === undefined) throw new Error(`gym ${gymId} missing from /v1/orgs/mine`);
    return found;
  };

  // ── 1 · THE PRICE LIST ──────────────────────────────────────────────────────

  /** KD'S RATIFIED USD BOOK, DRAWN THE WAY THE PROMPT WILL DRAW IT.
   *
   *  The five bands and their boundaries are :17902 (bands 1–2, $35/$50, and
   *  every boundary) and :16702 (bands 3–5, $59→$69/$79→$99/$99→$129 as ratified
   *  the same day) — quoted from the seed, never recalled (Part 0 rule 4). The
   *  ORDER is the assertion that matters as much as the numbers: `seat_cap ASC
   *  NULLS LAST`, which is the same rule `startGymTrial` picks band 1 by, so the
   *  list a buyer reads is the ladder Kd priced.
   *
   *  **USD AND NOT INR, DELIBERATELY.** `db.migration.test.ts` reactivates the
   *  legacy INR row `org_micro` mid-run to prove the seed deactivates it again,
   *  so an exact-list assertion in INR is a race against a sibling suite. The
   *  USD book is touched by nothing. */
  it(
    "serves the gym's own currency book, cheapest band first, at the ratified prices",
    async () => {
      const owner = await makeUser("book");
      const org = await makeOrg(owner.cookies, "US");
      expect(org.org.currencyDisplay).toBe("USD");

      const plans = await readPlans(org.org.id, owner.cookies);

      expect(plans.map((p) => p.seatCap)).toEqual([300, 500, 1000, 1500, 2100]);
      expect(plans.map((p) => p.priceLabel)).toEqual(["$35", "$50", "$69", "$99", "$129"]);
      expect(plans.map((p) => p.code)).toEqual([
        "org_b1_us_m",
        "org_b2_us_m",
        "org_b3_us_m",
        "org_b4_us_m",
        "org_b5_us_m",
      ]);
      for (const p of plans) {
        expect(p.currency).toBe("USD");
        expect(p.interval).toBe("month");
      }

      // NO MINOR-UNIT INTEGER ON THE WIRE, which is the shared schema's own
      // design rather than an oversight: one money field, already a sentence, so
      // there is nothing on a screen to divide by 100 (R10.4). A field added
      // later without reading that comment turns this red.
      expect(Object.keys(plans[0] ?? {}).sort()).toEqual([
        "code",
        "currency",
        "interval",
        "priceLabel",
        "seatCap",
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  /** THE CURRENCY IS THE GYM'S AND THE CALLER CANNOT CHOOSE IT (R3.1). An Indian
   *  gym is quoted in rupees by the same route, off the same code path — and the
   *  rupee symbol is the observable that a US-shaped answer could not fake.
   *
   *  Asserted loosely on CONTENT because of the `db.migration` race above: what
   *  is pinned is that every row is INR and none is a dollar. */
  it(
    "quotes an Indian gym in rupees, from the gym's row and never from the caller",
    async () => {
      const owner = await makeUser("book-inr");
      const org = await makeOrg(owner.cookies, "IN");
      expect(org.org.currencyDisplay).toBe("INR");

      const plans = await readPlans(org.org.id, owner.cookies);
      expect(plans.length).toBeGreaterThan(0);
      for (const p of plans) {
        expect(p.currency).toBe("INR");
        expect(p.priceLabel.startsWith("₹")).toBe(true);
      }
      // The ratified INR band 1 is ₹1,500 (:18488's book, `seed.ts`). Named
      // rather than range-checked: a formatter that dropped the thousands
      // separator or the minor units would still be "greater than zero".
      expect(plans.find((p) => p.code === "org_b1_in_m")?.priceLabel).toBe("₹1,500");

      /** A RETIRED BAND IS NEVER QUOTED TO A BUYER — and this assertion exists
       *  because MUTANT O148 SURVIVED WITHOUT IT.
       *
       *  Deleting `active = true` from the query changed nothing observable,
       *  because every retired row in the book is INR and the only exact list
       *  asserted anywhere was the USD one. The guard was real and the test was
       *  missing — the opposite of :21580's C88, where the guard itself turned
       *  out to be doing nothing. Asked the C88 question first (is the guarantee
       *  OBSERVABLE?) and the answer here is yes: these are Kd's PRE-:18488
       *  prices, ₹999 to ₹4,999 at caps of 25 to 400, and quoting one is quoting
       *  a price we do not sell at.
       *
       *  **`org_micro` IS DELIBERATELY NOT IN THIS LIST**, and leaving it out is
       *  not laziness: `db.migration.test.ts` reactivates exactly that row
       *  mid-run to prove the seed retires it again, and four suites share one
       *  database. Naming it here would be a race against a sibling. The other
       *  five retired rows are touched by nothing. */
      const retired = [
        "org_starter",
        "org_standard",
        "org_growth",
        "org_scale",
        "org_micro_clinic",
      ];
      const offered = new Set(plans.map((p) => p.code));
      expect(retired.filter((c) => offered.has(c)), "retired bands on sale").toEqual([]);

      // THE CONTROL — the five codes above must still EXIST and be inactive, or
      // the assertion is satisfied by rows that were simply deleted and proves
      // nothing about the filter (:15093's O92 shape).
      const rows = await sql<{ code: string; active: boolean }[]>`
        SELECT code, active FROM plans WHERE code = ANY(${retired})`;
      expect(rows).toHaveLength(retired.length);
      for (const r of rows) expect(r.active, `${r.code} must be a retired row`).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  /** THE CROSS-TENANT DENIAL (R3.2/R9.2). A price book is not secret, but the
   *  ROUTE names a gym, and a route that answers about a gym the caller has no
   *  relationship with is the IDOR shape regardless of how dull the payload is —
   *  it also leaks that the gym exists. `requirePrivilege` 404s before a plan is
   *  read. */
  it(
    "a stranger asking for another gym's price list gets 404, not a price",
    async () => {
      const owner = await makeUser("book-owner");
      const stranger = await makeUser("book-stranger");
      const org = await makeOrg(owner.cookies, "US");

      const res = await get(`/v1/orgs/${org.org.id}/plans`, stranger.cookies);
      expect(res.statusCode).toBe(404);
      expect((JSON.parse(res.body) as { error: string }).error).toBe("org_not_found");
    },
    TEST_TIMEOUT_MS,
  );

  /** ONLY WHOEVER CAN PAY SEES WHAT IT COSTS — `billing.manage`, never
   *  `role === "owner"` (:11429's seam, :15534's C/H-1 the cost of getting it
   *  wrong). It is the same privilege the trial door beside it asks for, and it
   *  matches Kd's ruling of 2026-08-28 that the prompt stops only the person who
   *  can act on it: a trainer never meets a price list they cannot use.
   *
   *  The staff row is inserted directly. `getStaffAuthority` accepts a staff row
   *  with no membership row at all (its third arm), so this is a state the
   *  product genuinely produces and not a fixture the code would reject. */
  it(
    "a trainer is refused the price list, and the owner beside them is not",
    async () => {
      const owner = await makeUser("book-priv-owner");
      const trainer = await makeUser("book-priv-trainer");
      const org = await makeOrg(owner.cookies, "US");

      await sql`
        INSERT INTO gym_staff (gym_id, user_id, role)
        VALUES (${org.org.id}, ${trainer.userId}, 'trainer')`;

      const refused = await get(`/v1/orgs/${org.org.id}/plans`, trainer.cookies);
      expect(refused.statusCode).toBe(403);
      expect((JSON.parse(refused.body) as { error: string }).error).toBe("forbidden");

      // THE CONTROL, and it is the half that makes the 403 mean something: a
      // route that simply refused everybody would satisfy the assertion above
      // (:7104's PG1).
      expect((await get(`/v1/orgs/${org.org.id}/plans`, owner.cookies)).statusCode).toBe(200);
    },
    TEST_TIMEOUT_MS,
  );

  /** EVERY SUPPORTED COUNTRY CAN ACTUALLY BUY SOMETHING — the permanent guard
   *  (:5348 rule 5) over the class of defect that produced Kd's currency ruling.
   *
   *  `COUNTRY_CURRENCY` and the seeded price book are separate files and nothing
   *  tied them together, so Canada, the UK and the twenty euro-area countries
   *  were creatable and then refused their own trial — for eleven days, and it
   *  took Kd noticing. Behind a prompt that cannot be skipped that is a person
   *  sealed out of their own console (:22215 §4).
   *
   *  This walks the SUPPORTED LIST rather than the countries anybody remembered,
   *  so the next country added without prices fails here instead of in front of
   *  its owner. It reads the table directly: the subject is the BOOK, not a
   *  route, and there is no gym to authenticate as. */
  it(
    "no supported country can be created into an empty price book",
    async () => {
      const rows = await sql<{ currency: string; n: number }[]>`
        SELECT currency, count(*)::int AS n
        FROM plans
        WHERE audience = 'org' AND active = true AND interval = 'month'
        GROUP BY currency`;
      const byCurrency = new Map(rows.map((r) => [r.currency, r.n]));

      const stranded: string[] = [];
      for (const country of SUPPORTED_COUNTRIES) {
        const currency = currencyForCountry(country);
        if (currency === null || (byCurrency.get(currency) ?? 0) === 0) {
          stranded.push(`${country} → ${currency ?? "no currency"}`);
        }
      }
      expect(stranded, "supported countries with nothing to buy").toEqual([]);

      // THE CONTROL: the walk above is only worth anything if this list is the
      // real one and the lookup can actually fail. Both halves checked.
      expect(SUPPORTED_COUNTRIES.length).toBeGreaterThan(20);
      expect(currencyForCountry("ZZ")).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  /** KD'S CURRENCY RULING, END TO END, THROUGH THE DOOR IT WAS MADE FOR
   *  (:22215 §3.5). A Canadian gym could be created and then refused its own
   *  trial with "We're not open for business in your country yet" — the brick
   *  wall an unskippable prompt turns into a dead end. It now trials on the USD
   *  band like any American gym, and gets the same 300 seats. */
  it(
    "a Canadian gym starts its trial on the dollar book, at the same 300 seats",
    async () => {
      const owner = await makeUser("ca-trial");
      const org = await makeOrg(owner.cookies, "CA");
      expect(org.org.currencyDisplay).toBe("USD");

      const started = await post(`/v1/orgs/${org.org.id}/trial`, {}, owner.cookies);
      expect(started.statusCode, "Canada could not trial at all before :22215").toBe(200);
      const body = JSON.parse(started.body) as {
        outcome: string;
        subscription: { status: string; seatCap: number | null };
      };
      expect(body.outcome).toBe("started");
      expect(body.subscription.seatCap).toBe(300);

      expect((await readPlans(org.org.id, owner.cookies)).map((p) => p.priceLabel)).toEqual([
        "$35",
        "$50",
        "$69",
        "$99",
        "$129",
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  // ── 2 · THE ARM SELECTOR ────────────────────────────────────────────────────

  /** A GYM WHOSE OWNER HAS NEVER TRIALLED SAYS SO — the trial arm. */
  it(
    "a fresh gym reports its owner has not used a trial",
    async () => {
      const owner = await makeUser("arm-fresh");
      const org = await makeOrg(owner.cookies, "US");

      const mine = await readMyOrg(org.org.id, owner.cookies);
      expect(mine.ownerTrialUsed).toBe(false);
      expect(mine.subscription).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  /** **THE ONE THAT MATTERS: THE ANSWER SURVIVES THE TRIAL ENDING.**
   *
   *  This is :22341 §7's defect, asserted from the other side. When the sweep
   *  moves a trial to `expired` the gym drops out of the subscription LATERAL
   *  and `subscription` goes null — byte for byte what a gym that never trialled
   *  looks like — which is why the console offered the trial again over a button
   *  that could only 409. The pair asserted here is the whole fix: SUBSCRIPTION
   *  NULL, TRIAL USED TRUE.
   *
   *  The row is expired with a scoped UPDATE rather than by running the sweep.
   *  The sweep is table-wide by nature and four suites share one database, so
   *  calling it here would end live trials mid-assertion in a sibling — the
   *  lesson `orgs.trialSweep.test.ts` opens with. Its own behaviour is that
   *  file's subject; what this one needs is the STATE it leaves behind. */
  it(
    "an expired trial still reports the owner's trial as used, with no live plan",
    async () => {
      const owner = await makeUser("arm-expired");
      const org = await makeOrg(owner.cookies, "US");

      expect((await post(`/v1/orgs/${org.org.id}/trial`, {}, owner.cookies)).statusCode).toBe(200);
      const during = await readMyOrg(org.org.id, owner.cookies);
      expect(during.subscription?.status).toBe("trialing");
      expect(during.ownerTrialUsed).toBe(true);

      await sql`
        UPDATE subscriptions SET status = 'expired'
        WHERE owner_type = 'gym' AND owner_id = ${org.org.id}`;

      const after = await readMyOrg(org.org.id, owner.cookies);
      expect(after.subscription, "an ended plan is not a live one").toBeNull();
      expect(after.ownerTrialUsed, "and the trial is still spent").toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  /** THE FIELD AND THE DOOR, ON ONE FIXTURE (:14013's precedent, :14493's Low-2
   *  the cost of skipping it).
   *
   *  "This owner has spent their one trial" is now written twice — the EXISTS in
   *  `listOrgsForUser` and the `used` query in `startGymTrial` — because R3.8
   *  forbids sharing them as an `sql` fragment. Nothing but this test stops them
   *  drifting, and drift in either direction is a visible defect: a screen that
   *  offers a trial the door refuses (:22341 §7 again), or a screen that hides
   *  one the owner is entitled to.
   *
   *  It also pins that the rule is per OWNER and not per GYM, which is Part 5
   *  §12 and the reason "make another gym" is not the way round it. */
  it(
    "a second gym reports the trial as used, and its trial door agrees",
    async () => {
      const owner = await makeUser("arm-second");
      const first = await makeOrg(owner.cookies, "US");
      const second = await makeOrg(owner.cookies, "US");

      // Both gyms, before anything: neither owner-trial is spent.
      expect((await readMyOrg(first.org.id, owner.cookies)).ownerTrialUsed).toBe(false);
      expect((await readMyOrg(second.org.id, owner.cookies)).ownerTrialUsed).toBe(false);

      expect((await post(`/v1/orgs/${first.org.id}/trial`, {}, owner.cookies)).statusCode).toBe(
        200,
      );

      // THE FIELD, on the gym that never had one of its own.
      const secondAfter = await readMyOrg(second.org.id, owner.cookies);
      expect(secondAfter.ownerTrialUsed, "one trial per OWNER, not per gym").toBe(true);
      expect(secondAfter.subscription, "the second gym is on nothing").toBeNull();

      // THE DOOR, same gym, same breath.
      const refused = await post(`/v1/orgs/${second.org.id}/trial`, {}, owner.cookies);
      expect(refused.statusCode).toBe(409);
      expect((JSON.parse(refused.body) as { error: string }).error).toBe("trial_already_used");

      // AND A DIFFERENT OWNER IS UNAFFECTED — the control that stops "true for
      // everybody" passing every assertion above.
      const other = await makeUser("arm-second-other");
      const theirs = await makeOrg(other.cookies, "US");
      expect((await readMyOrg(theirs.org.id, other.cookies)).ownerTrialUsed).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  /** A PLAIN MEMBER IS TOLD NOTHING — §2.4's boundary, the same line that
   *  withholds `subscription` and `seatsUsed`. When a gym's trial ran out is the
   *  gym's business, not its members'.
   *
   *  **AND THE OWNER IS THE CONTROL**, reading the SAME gym through the SAME
   *  response shape — :21580's own construction. Without it the assertion is
   *  satisfied by a field that is null for everybody. */
  it(
    "a plain member is told nothing about the owner's trial, and the owner is",
    async () => {
      const owner = await makeUser("arm-member-owner");
      const member = await makeUser("arm-member");
      const org = await makeOrg(owner.cookies, "US");

      expect((await post(`/v1/orgs/${org.org.id}/trial`, {}, owner.cookies)).statusCode).toBe(200);

      // A live membership with no staff row — what a member of the gym is.
      await sql`
        INSERT INTO gym_members (gym_id, user_id, joined_at)
        VALUES (${org.org.id}, ${member.userId}, now())`;

      const asMember = await readMyOrg(org.org.id, member.cookies);
      expect(asMember.ownerTrialUsed).toBeNull();
      expect(asMember.subscription).toBeNull();

      const asOwner = await readMyOrg(org.org.id, owner.cookies);
      expect(asOwner.ownerTrialUsed, "the same gym, read by staff").toBe(true);
      expect(asOwner.subscription?.status).toBe("trialing");
    },
    TEST_TIMEOUT_MS,
  );
});
