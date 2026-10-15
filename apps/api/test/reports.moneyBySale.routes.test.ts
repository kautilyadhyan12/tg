// The Reports page's money by product and by staff, through its route against real
// Postgres (DATABASE_URL-gated). ROADMAP Stage 2 item 21b-ii; spec Part 3 §16.5.
//
// The first test is the worst thing this job could do: one gym's sales, or how much a
// worker took, shown to another gym or to a trainer not allowed to see money. Two gyms
// sell on the Sell page, through its real route, on the days either side of the period's
// edges; each reads only its own sales, to the penny, a sale taken back is not money, and
// nobody without both ticks reads an amount or a name.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { moneyReportResponseSchema, sellProductResponseSchema, type GymMembershipTypesResponse, type MoneyFigures, type MoneyReport, type SellPageResponse } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createIoRedis, createMemoryRedis } from "../src/redis.js";
import * as heldService from "../src/modules/orgs/memberships/heldService.js";
import { anonymizeUser } from "../src/modules/privacy/repo.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "reports-money-sales-secret-0123456789012", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface User {
  userId: string;
  cookies: Cookies;
  name: string;
}

const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 90_000;
const LIVE_PLAN = "zz_reports_money_sales";
/** Tuesday 20 October 2026, midday in London. Four weeks are 23 Sep to 20 Oct. */
const TODAY = "2026-10-20";

const RUN_NET = String(1 + Math.floor(Math.random() * 250));
const RUN_TAG = Date.now().toString(36);
let ipCounter = 0;
const nextIp = () => `10.${RUN_NET}.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
let keyCounter = 0;
const nextKey = () => `00000000-0000-4000-8000-${String(++keyCounter).padStart(12, "0")}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
const noon = (day: string) => new Date(`${day}T11:00:00Z`);

d("Reports, money by product and by staff: whose sales, who reads them (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redisUrl = process.env["TEST_REDIS_URL"];
  const redis = redisUrl === undefined || redisUrl === "" ? createMemoryRedis() : createIoRedis(redisUrl);
  /** The routes' clock: the Sell page stamps a sale with the gym's day by it. */
  let clock = noon(TODAY);
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  /** Accounts the test deleted: their email is gone, so the pattern below cannot find them. */
  const deleted: string[] = [];
  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'rep-s-%@example.com')`;
    await sql`DELETE FROM gym_sales WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_products WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'rep-s-%@example.com'`;
    if (deleted.length > 0) await sql`DELETE FROM users WHERE id IN ${sql(deleted)}`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const get = (path: string, cookies: Cookies = {}) => send("GET", path, cookies);
  const post = (path: string, payload: unknown, cookies: Cookies = {}) => send("POST", path, cookies, payload);

  const makeUser = async (local: string): Promise<User> => {
    const email = `rep-s-${RUN_TAG}-${local}@example.com`;
    const name = `Rep ${local}`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: name });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login), name };
  };

  const makeGym = async (owner: User, name: string): Promise<string> => {
    const res = await post("/v1/orgs", { trainsHere: false, name, city: "Leeds", country: "GB", timezone: "Europe/London" }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const gymId = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return gymId;
  };

  const makeStaff = async (gymId: string, who: User, role: "manager" | "trainer", privileges: string[]) => {
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gymId}, ${who.userId}, ${role}, ${privileges})`;
  };

  const addProduct = async (gymId: string, owner: User, name: string, priceMinor: number): Promise<string> => {
    const res = await post(`/v1/orgs/${gymId}/register/products`, { name, priceMinor, taxRateId: null, stock: null }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as SellPageResponse).products.find((p) => p.name === name);
    if (found === undefined) throw new Error(`no product named ${name}`);
    return found.id;
  };

  /** One sale through the Sell page's route, on `day` by the routes' clock. */
  const sell = async (gymId: string, who: User, productId: string, day: string, quantity: number, totalMinor: number): Promise<string> => {
    clock = noon(day);
    const res = await post(
      `/v1/orgs/${gymId}/register/sales`,
      { requestKey: nextKey(), productId, quantity, entryId: null, method: "cash", totalMinor, discountId: null },
      who.cookies,
    );
    clock = noon(TODAY);
    expect(res.statusCode, res.body).toBe(201);
    return sellProductResponseSchema.parse(JSON.parse(res.body)).saleId;
  };

  let personNo = 0;
  const listed = async (gymId: string, name: string): Promise<string> => {
    personNo += 1;
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source, created_at)
      VALUES (${gymId}, ${name}, ${`rep-s-listed-${String(personNo)}@example.com`}, ${`a${String(personNo).padStart(63, "0")}`}, 'typed',
              '2026-06-01T09:00:00Z'::timestamptz)
      RETURNING id`;
    const row = rows[0];
    if (row === undefined) throw new Error("no record");
    return row.id;
  };
  /** A membership given and paid on `day` by `who`, through the real service. */
  const givePaid = async (gymId: string, who: User, owner: User, day: string): Promise<void> => {
    const res = await post(
      `/v1/orgs/${gymId}/membership-types`,
      {
        name: `Gold ${day}`,
        description: null,
        kind: "recurring",
        priceMinor: 4000,
        termCount: 1,
        termUnit: "month",
        packClasses: null,
        packDays: null,
        access: "all_classes",
        bookingsLimit: null,
        bookingsPeriod: null,
        classTypeIds: null,
        includesPt: false,
        ptLimit: null,
        ptPeriod: null,
      },
      owner.cookies,
    );
    expect(res.statusCode, res.body).toBe(201);
    const typeId = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === `Gold ${day}`)?.id ?? "";
    const entryId = await listed(gymId, `Paid ${day}`);
    await heldService.giveHeldMembership({ sql, now: () => noon(day) }, who.userId, gymId, entryId, {
      requestKey: nextKey(),
      typeId,
      startsOn: day,
      paid: true,
      method: "cash",
    });
  };

  const moneyUrl = (gymId: string, period: string) => `/v1/orgs/${gymId}/reports/money?period=${period}`;
  const read = async (gymId: string, who: User, period = "4w"): Promise<MoneyReport> => {
    const res = await get(moneyUrl(gymId, period), who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return moneyReportResponseSchema.parse(JSON.parse(res.body)).report;
  };
  const figures = (report: MoneyReport): MoneyFigures => {
    if (report.state !== "ok") throw new Error(`no figures: ${report.state}`);
    return report;
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'GBP', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), { redis, orgs: { now: () => clock } });
    await api().ready();
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
    await redis.close();
  }, HOOK_TIMEOUT_MS);

  it(
    "each gym reads only its own sales and its own staff, to the penny; a sale taken back is not money; nobody without both ticks reads an amount or a name",
    async () => {
      const owner = await makeUser("own");
      const gym = await makeGym(owner, "Rep Sales Gym");
      const ravi = await makeUser("ravi");
      await makeStaff(gym, ravi, "manager", ["billing.members", "reports.read", "members.confirm"]);
      const tara = await makeUser("tara");
      await makeStaff(gym, tara, "trainer", ["reports.read"]);
      const nextOwner = await makeUser("next");
      const next = await makeGym(nextOwner, "Rep Sales Next Door");
      const stranger = await makeUser("stranger");

      const water = await addProduct(gym, owner, "Water", 150);
      const shake = await addProduct(gym, owner, "Shake", 500);
      const towel = await addProduct(gym, owner, "Towel", 1200);
      const theirWater = await addProduct(next, nextOwner, "Water", 999);

      // The day before four weeks begin: in twelve months, not in four weeks.
      await sell(gym, ravi, water, "2026-09-22", 10, 1500);
      // Four weeks' first day, and today.
      await sell(gym, ravi, water, "2026-09-23", 2, 300);
      await sell(gym, owner, shake, "2026-10-20", 3, 1500);
      await sell(gym, ravi, shake, "2026-10-01", 1, 500);
      // Taken back the same day: not money, and not Ravi's.
      const back = await sell(gym, ravi, towel, "2026-10-20", 1, 1200);
      const undo = await post(`/v1/orgs/${gym}/register/sales/${back}/undo`, {}, ravi.cookies);
      expect(undo.statusCode, undo.body).toBe(200);
      // A membership payment Ravi took in the period.
      await givePaid(gym, ravi, owner, "2026-10-05");

      // Next door sells more, every day of the period, and its owner is nobody here.
      for (const day of ["2026-09-22", "2026-09-23", "2026-10-01", "2026-10-20"]) await sell(next, nextOwner, theirWater, day, 5, 4995);

      const mine = figures(await read(gym, owner));
      expect(mine.inPeriod).toEqual({ paidMinor: 4000, soldMinor: 300 + 1500 + 500, refundedMinor: 0, netMinor: 6300 });
      expect(mine.products).toEqual([
        { name: "Shake", sold: 4, minor: 2000 },
        { name: "Water", sold: 2, minor: 300 },
      ]);
      expect(mine.staff).toEqual([
        { name: ravi.name, paidMinor: 4000, soldMinor: 800, totalMinor: 4800 },
        { name: owner.name, paidMinor: 0, soldMinor: 1500, totalMinor: 1500 },
      ]);
      // The staff add up to the period's money taken, and the products to its sales.
      expect(mine.staff.reduce((sum, m) => sum + m.totalMinor, 0)).toBe(mine.inPeriod.paidMinor + mine.inPeriod.soldMinor);
      expect(mine.products.reduce((sum, p) => sum + p.minor, 0)).toBe(mine.inPeriod.soldMinor);

      const year = figures(await read(gym, owner, "12m"));
      expect(year.months).toEqual([
        { month: "2026-09", paidMinor: 0, soldMinor: 1800, refundedMinor: 0, netMinor: 1800 },
        { month: "2026-10", paidMinor: 4000, soldMinor: 2000, refundedMinor: 0, netMinor: 6000 },
      ]);
      expect(year.products).toEqual([
        { name: "Shake", sold: 4, minor: 2000 },
        { name: "Water", sold: 12, minor: 1800 },
      ]);

      const theirs = figures(await read(next, nextOwner));
      expect(theirs.inPeriod).toEqual({ paidMinor: 0, soldMinor: 4995 * 3, refundedMinor: 0, netMinor: 4995 * 3 });
      expect(theirs.products).toEqual([{ name: "Water", sold: 15, minor: 4995 * 3 }]);
      expect(theirs.staff).toEqual([{ name: nextOwner.name, paidMinor: 0, soldMinor: 4995 * 3, totalMinor: 4995 * 3 }]);
      // Neither gym's answer holds the other's people.
      const mineBody = (await get(moneyUrl(gym, "12m"), owner.cookies)).body;
      expect(mineBody).not.toContain(nextOwner.name);
      expect(mineBody).not.toContain(tara.name);
      expect((await get(moneyUrl(next, "12m"), nextOwner.cookies)).body).not.toContain(ravi.name);

      // A trainer shown attendance, not money: refused, with no amount and no name.
      const trainer = await get(moneyUrl(gym, "4w"), tara.cookies);
      expect(trainer.statusCode).toBe(403);
      expect(trainer.body).not.toContain(ravi.name);
      expect(trainer.body).not.toContain("2000");
      // Somebody from another gym, and nobody signed in.
      const outsider = await get(moneyUrl(gym, "4w"), nextOwner.cookies);
      expect(outsider.statusCode).toBe(404);
      expect(outsider.body).not.toContain(ravi.name);
      expect((await get(moneyUrl(gym, "4w"), stranger.cookies)).statusCode).toBe(404);
      expect((await get(moneyUrl(gym, "4w"))).statusCode).toBe(401);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a gym that only sells at the desk has figures; a sale a year earlier is in that line; a sale in another currency and a deleted account's are said as they are",
    async () => {
      const owner = await makeUser("desk");
      const gym = await makeGym(owner, "Rep Sales Desk Only");
      const left = await makeUser("left");
      await makeStaff(gym, left, "manager", ["billing.members"]);
      const gone = await makeUser("gone");
      await makeStaff(gym, gone, "manager", ["billing.members"]);
      // Another member of staff with the owner's own name.
      const twin = await makeUser("twin");
      await makeStaff(gym, twin, "manager", ["billing.members"]);
      await sql`UPDATE users SET display_name = ${owner.name} WHERE id = ${twin.userId}`
      const bar = await addProduct(gym, owner, "Protein bar", 250);

      // Before anything is sold: no money figures, and why.
      expect((await read(gym, owner)).state).toBe("no_memberships");

      await sell(gym, owner, bar, "2025-07-15", 2, 500);
      await sell(gym, owner, bar, "2025-08-10", 1, 250);
      await sell(gym, owner, bar, "2025-10-01", 4, 1000);
      await sell(gym, owner, bar, "2026-10-02", 1, 250);
      const theirs = await sell(gym, left, bar, "2026-10-03", 1, 250);
      await sell(gym, gone, bar, "2026-10-04", 1, 250);
      await sell(gym, twin, bar, "2026-10-05", 1, 250);
      // Both accounts are deleted the way the app deletes one: marked, then made anonymous.
      for (const who of [left, gone]) {
        await sql`UPDATE users SET status = 'deleted', deleted_at = now() WHERE id = ${who.userId}`;
        await sql.begin((tx) => anonymizeUser(tx, who.userId));
        deleted.push(who.userId);
      }
      // A sale in euros, from before the gym's country changed: not counted, and said.
      await sql`
        WITH n AS (UPDATE gyms SET receipts_issued = receipts_issued + 1 WHERE id = ${gym} RETURNING receipts_issued AS number)
        INSERT INTO gym_sales (gym_id, request_key, product_id, item_name, quantity, unit_price_minor, net_minor, tax_minor, total_minor,
                               tax_bp, tax_included, currency, method, sold_on, recorded_by, receipt_number)
        SELECT gym_id, ${nextKey()}, product_id, item_name, 1, 7777, 7777, 0, 7777, 0, false, 'EUR', 'cash', '2026-10-04', recorded_by, n.number
        FROM gym_sales, n WHERE gym_id = ${gym} AND id = ${theirs}`;

      const r = figures(await read(gym, owner, "4w"));
      expect(r.firstPaidOn).toBe("2025-07-15");
      expect(r.otherCurrency).toBe(true);
      expect(r.inPeriod).toEqual({ paidMinor: 0, soldMinor: 1000, refundedMinor: 0, netMinor: 1000 });
      expect(r.products).toEqual([{ name: "Protein bar", sold: 4, minor: 1000 }]);
      // The two deleted accounts are one row with no name, last; the owner and the
      // member of staff with the same name are told apart by their email.
      expect(r.staff).toEqual([
        { name: `${owner.name} (rep-s-${RUN_TAG}-desk)`, paidMinor: 0, soldMinor: 250, totalMinor: 250 },
        { name: `${owner.name} (rep-s-${RUN_TAG}-twin)`, paidMinor: 0, soldMinor: 250, totalMinor: 250 },
        { name: null, paidMinor: 0, soldMinor: 500, totalMinor: 500 },
      ]);
      expect(JSON.stringify(r.staff)).not.toContain("Deleted user");
      expect(r.recurring).toEqual({ monthlyMinor: 0, memberships: 0 });
      expect(r.types).toEqual([]);
      // Four weeks a year earlier are 24 Sep to 21 Oct 2025.
      expect(r.yearEarlier).toEqual({ state: "ok", from: "2025-09-24", to: "2025-10-21", paidMinor: 0, soldMinor: 1000, refundedMinor: 0, netMinor: 1000 });
      // Three months a year earlier are 1 Aug to 20 Oct 2025.
      const quarter = figures(await read(gym, owner, "3m"));
      expect(quarter.yearEarlier).toEqual({ state: "ok", from: "2025-08-01", to: "2025-10-20", paidMinor: 0, soldMinor: 1250, refundedMinor: 0, netMinor: 1250 });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a year earlier sets payments and desk sales each beside their own history: a part new this period has no figure, never a zero",
    async () => {
      // A bar sold in July 2025, and membership payments that begin this month.
      const one = await makeUser("hist1");
      const oldSale = await makeGym(one, "Rep Sales Old Sale");
      const bar = await addProduct(oldSale, one, "Bar", 250);
      await sell(oldSale, one, bar, "2025-07-15", 1, 250);
      await givePaid(oldSale, one, one, "2026-10-05");
      const a = figures(await read(oldSale, one));
      expect(a.inPeriod).toEqual({ paidMinor: 4000, soldMinor: 0, refundedMinor: 0, netMinor: 4000 });
      expect(a.yearEarlier).toEqual({ state: "no_history", from: "2025-09-24", to: "2025-10-21", since: "2026-10-05" });

      // Payments recorded since July 2025, and the Sell page used for the first time today.
      const two = await makeUser("hist2");
      const newDesk = await makeGym(two, "Rep Sales New Desk");
      await givePaid(newDesk, two, two, "2025-07-01");
      const water = await addProduct(newDesk, two, "Water", 150);
      await sell(newDesk, two, water, TODAY, 2, 300);
      const b = figures(await read(newDesk, two));
      expect(b.inPeriod).toEqual({ paidMinor: 0, soldMinor: 300, refundedMinor: 0, netMinor: 300 });
      expect(b.yearEarlier).toEqual({ state: "no_sales_history", from: "2025-09-24", to: "2025-10-21", since: TODAY });
    },
    TEST_TIMEOUT_MS,
  );
});
