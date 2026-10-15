// The Reports page, the same period a year earlier, through its three routes against real
// Postgres (DATABASE_URL-gated). ROADMAP Stage 2 item 21d-ii; spec Part 3 §16.5.
//
// The first test is the worst thing this job could do: an owner reads "a year earlier"
// built from days other than the ones the page names, from the gym next door's rows, or
// from a year the app was not used, and somebody without the money tick reads last
// year's takings. One gym holds a joiner and a payment, both in pounds,
// on the day before each year-earlier span begins, on its first day, on its last day and
// on the day after; every year-earlier figure is the sum of exactly the days its answer names.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  REPORT_PERIODS,
  membersReportResponseSchema,
  moneyReportResponseSchema,
  type GymMembershipTypesResponse,
  type HeldMembershipsResponse,
  type ReportPeriodKey,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createIoRedis, createMemoryRedis } from "../src/redis.js";
import * as heldService from "../src/modules/orgs/memberships/heldService.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "reports-year-earlier-routes-secret-0123456", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface User {
  userId: string;
  cookies: Cookies;
}

const TEST_TIMEOUT_MS = 180_000;
const HOOK_TIMEOUT_MS = 90_000;
const LIVE_PLAN = "zz_reports_year_earlier_routes";
/** Tuesday 20 October 2026, midday in London. */
const TODAY = "2026-10-20";
const NOW = new Date(`${TODAY}T11:00:00Z`);
/** The same days a year earlier, worked out by hand from a calendar: four weeks go back
 *  52 weeks, months a calendar year. */
const SPAN: Record<ReportPeriodKey, { from: string; to: string }> = {
  "4w": { from: "2025-09-24", to: "2025-10-21" },
  "3m": { from: "2025-08-01", to: "2025-10-20" },
  "12m": { from: "2024-11-01", to: "2025-10-20" },
};
/** The day before each span, its first and last days, and the day after: something happens on each, oldest first. */
const DAYS = ["2024-10-31", "2024-11-01", "2025-07-31", "2025-08-01", "2025-09-23", "2025-09-24", "2025-10-20", "2025-10-21", "2025-10-22"] as const;
/** Inside three and twelve months a year earlier, outside four weeks. */
const PAID_ONCE = "2025-08-15";
/** Inside every span. */
const NEXT_DOOR_DAY = "2025-10-01";

const RUN_NET = String(1 + Math.floor(Math.random() * 250));
const RUN_TAG = Date.now().toString(36);
let ipCounter = 0;
const nextIp = () => `10.${RUN_NET}.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
let keyCounter = 0;
const nextKey = () => `00000000-0000-4000-8000-${String(++keyCounter).padStart(12, "0")}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
const inSpan = (day: string, key: ReportPeriodKey) => day >= SPAN[key].from && day <= SPAN[key].to;

d("Reports, a year earlier: every figure counts the days the answer names (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redisUrl = process.env["TEST_REDIS_URL"];
  const redis = redisUrl === undefined || redisUrl === "" ? createMemoryRedis() : createIoRedis(redisUrl);
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'rep-y-%@example.com')`;
    await sql`DELETE FROM gym_leads WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_attendance WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'rep-y-%@example.com'`;
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
    const email = `rep-y-${RUN_TAG}-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Rep ${local}` });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };

  const makeGym = async (owner: User, name: string, timezone = "Europe/London"): Promise<string> => {
    const res = await post("/v1/orgs", { trainsHere: false, name, city: "Leeds", country: "GB", timezone }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const gymId = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return gymId;
  };

  let personNo = 0;
  /** Records written straight into the list, at midday in London on `listedOn`; `leftOn` makes them former ones. */
  const listedMany = async (gymId: string, names: string[], listedOn: string, leftOn: string | null = null): Promise<string[]> => {
    const nos = names.map(() => (personNo += 1));
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source, created_at, former_at)
      SELECT ${gymId}, n.name, 'rep-y-listed-' || n.no || '@example.com', lpad(n.no::text, 64, '0'), 'typed',
             ${`${listedOn}T11:00:00Z`}::timestamptz, ${leftOn === null ? null : `${leftOn}T11:00:00Z`}::timestamptz
      FROM unnest(${names}::text[], ${nos}::int[]) WITH ORDINALITY AS n(name, no, ord)
      ORDER BY n.ord
      RETURNING id`;
    return rows.map((r) => r.id);
  };
  /** The services' own clock for one step: noon in London on that day. */
  const on = (day: string) => ({ sql, now: () => new Date(`${day}T11:00:00Z`) });
  const first = (page: HeldMembershipsResponse) => {
    const m = page.memberships[0];
    if (m === undefined || m.billing === null) throw new Error("no membership with its bills");
    return { ...m, billing: m.billing };
  };
  const addType = async (gymId: string, owner: User, name: string, over: Record<string, unknown>): Promise<string> => {
    const made = await post(
      `/v1/orgs/${gymId}/membership-types`,
      {
        name,
        description: null,
        kind: "recurring",
        priceMinor: 1000000,
        termCount: 3,
        termUnit: "year",
        packClasses: null,
        packDays: null,
        access: "all_classes",
        bookingsLimit: null,
        bookingsPeriod: null,
        classTypeIds: null,
        includesPt: false,
        ptLimit: null,
        ptPeriod: null,
        ...over,
      },
      owner.cookies,
    );
    expect(made.statusCode, made.body).toBe(201);
    const typeId = (JSON.parse(made.body) as GymMembershipTypesResponse).types.find((t) => t.name === name)?.id;
    if (typeId === undefined) throw new Error("no type");
    return typeId;
  };
  const give = async (gymId: string, owner: User, entryId: string, typeId: string, day: string, paid: boolean) => {
    const m = first(
      await heldService.giveHeldMembership(on(day), owner.userId, gymId, entryId, { requestKey: nextKey(), typeId, startsOn: day, paid, ...(paid ? { method: "cash" as const } : {}) }),
    );
    return { id: m.id, paymentId: m.billing.bills[0]?.payments[0]?.id ?? "" };
  };
  const pay = async (gymId: string, owner: User, entryId: string, heldId: string, day: string, amountMinor: number): Promise<string> => {
    await heldService.recordMemberPayment(on(day), owner.userId, gymId, entryId, heldId, { requestKey: nextKey(), periodIndex: 0, amountMinor, method: "cash" });
    const rows = await sql<{ id: string }[]>`
      SELECT p.id FROM gym_member_payments p WHERE p.gym_id = ${gymId} AND p.amount_minor = ${amountMinor} AND p.paid_on = ${day}::date`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no payment");
    return id;
  };

  const read = async (gymId: string, who: User, part: "members" | "money", key: ReportPeriodKey) => {
    const res = await get(`/v1/orgs/${gymId}/reports/${part}?period=${key}`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as unknown;
  };
  const membersOf = async (gymId: string, who: User, key: ReportPeriodKey) => membersReportResponseSchema.parse(await read(gymId, who, "members", key)).report;
  const moneyOf = async (gymId: string, who: User, key: ReportPeriodKey) => {
    const report = moneyReportResponseSchema.parse(await read(gymId, who, "money", key)).report;
    if (report.state !== "ok") throw new Error(`no figures: ${report.state}`);
    return report;
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'GBP', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), { redis, orgs: { now: () => NOW } });
    await api().ready();
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
    await redis.close();
  }, HOOK_TIMEOUT_MS);

  it(
    "what happened the day before a year-earlier span or the day after it is in none of its figures, its first and last days are in all of them, next door's in none, and money only for the money tick",
    async () => {
      const owner = await makeUser("own");
      const gym = await makeGym(owner, "Rep Year Gym");
      const nextOwner = await makeUser("next");
      const next = await makeGym(nextOwner, "Rep Year Next Door");

      // The list began in January 2024. On each of the nine days one person joins.
      await listedMany(gym, ["First On The List"], "2024-01-10");
      // A file imported last week gave a join date inside every span: nobody the list held a
      // year earlier, so never new then.
      await sql`
        INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source, created_at, joined_on)
        VALUES (${gym}, 'Imported Late', 'rep-y-imported-late@example.com', ${"f".repeat(64)}, 'upload', '2026-10-13T11:00:00Z', '2025-10-01')`;
      for (const day of DAYS) await listedMany(gym, [`Joined ${day}`], day);
      // Payments double day by day (1.00, 2.00 ... 256.00) on one bill of 10,000.00.
      const yearly = await addType(gym, owner, "Three Years", {});
      const [payer, sam, eve] = await listedMany(gym, ["Pat Pays In Parts", "Sam Pays Once", "Eve Pays In Euros"], "2024-03-01");
      if (payer === undefined || sam === undefined || eve === undefined) throw new Error("no payer");
      const held = await give(gym, owner, payer, yearly, "2024-10-30", false);
      for (const [i, day] of DAYS.entries()) await pay(gym, owner, payer, held.id, day, 100 * 2 ** i);
      // 10.00 paid on 15 August 2025, 0.20 of it given back on the first day of four weeks a year earlier.
      const once = await give(gym, owner, sam, await addType(gym, owner, "Monthly", { priceMinor: 1000, termCount: 1, termUnit: "month" }), PAID_ONCE, true);
      await heldService.noteMemberRefund(on("2025-09-24"), owner.userId, gym, sam, once.id, once.paymentId, { requestKey: nextKey(), amountMinor: 20, method: "cash", reason: "other" });
      // A payment inside every span that was taken back the next day is not money.
      const mistake = await pay(gym, owner, payer, held.id, NEXT_DOOR_DAY, 77700);
      await heldService.undoMemberPayment(on("2025-10-02"), owner.userId, gym, payer, held.id, mistake);
      // A payment inside every span with 3.00 refunded, the payment then taken back: neither is money.
      const refundedThenUndone = await pay(gym, owner, payer, held.id, "2025-10-05", 33300);
      // Written straight in: the app refunds only a bill paid in full, and this one is not.
      await sql`
        WITH n AS (UPDATE gyms SET receipts_issued = receipts_issued + 1 WHERE id = ${gym} RETURNING receipts_issued AS number)
        INSERT INTO gym_member_refunds (gym_id, payment_id, amount_minor, currency, method, reason, request_key, refunded_on, recorded_by, receipt_number)
        SELECT ${gym}, ${refundedThenUndone}, 300, 'GBP', 'cash', 'other', gen_random_uuid(), '2025-10-06', ${owner.userId}, n.number FROM n`;
      await sql`UPDATE gym_member_payments SET undone_at = '2025-10-07T11:00:00Z', undone_by = ${owner.userId} WHERE gym_id = ${gym} AND id = ${refundedThenUndone}`;
      // A payment in euros inside every span, and a refund in euros: the gym's money is pounds.
      const eurosHeld = await give(gym, owner, eve, yearly, "2024-10-30", false);
      const euros = (await sql<{ id: string }[]>`
        WITH n AS (UPDATE gyms SET receipts_issued = receipts_issued + 1 WHERE id = ${gym} RETURNING receipts_issued AS number)
        INSERT INTO gym_member_payments (gym_id, bill_id, amount_minor, currency, method, request_key, paid_on, recorded_by, receipt_number)
        SELECT ${gym}, b.id, 44400, 'EUR', 'cash', gen_random_uuid(), '2025-10-03', ${owner.userId}, n.number
        FROM n, gym_member_bills b JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
        WHERE b.gym_id = ${gym} AND h.id = ${eurosHeld.id} AND b.period_index = 0
        RETURNING id`)[0]?.id;
      if (euros === undefined) throw new Error("no payment in euros");
      await sql`
        WITH n AS (UPDATE gyms SET receipts_issued = receipts_issued + 1 WHERE id = ${gym} RETURNING receipts_issued AS number)
        INSERT INTO gym_member_refunds (gym_id, payment_id, amount_minor, currency, method, reason, request_key, refunded_on, recorded_by, receipt_number)
        SELECT ${gym}, ${euros}, 400, 'EUR', 'cash', 'other', gen_random_uuid(), '2025-10-04', ${owner.userId}, n.number FROM n`;
      // Today, a period's own payment: never a year earlier.
      await pay(gym, owner, payer, held.id, TODAY, 99900);

      // Next door, from 2025 on: a joiner and a payment inside every span.
      await listedMany(next, ["Their First"], "2024-01-10");
      const [theirs] = await listedMany(next, ["Their Joiner"], NEXT_DOOR_DAY);
      if (theirs === undefined) throw new Error("no record");
      const theirHeld = await give(next, nextOwner, theirs, await addType(next, nextOwner, "Three Years", {}), NEXT_DOOR_DAY, false);
      await pay(next, nextOwner, theirs, theirHeld.id, NEXT_DOOR_DAY, 5000);

      for (const key of REPORT_PERIODS) {
        const span = SPAN[key];
        const days = DAYS.filter((day) => inSpan(day, key));
        // New members: one for each of the days in the span.
        expect((await membersOf(gym, owner, key)).yearEarlier, key).toEqual({ state: "ok", ...span, joined: days.length });
        // Money: the payments of those days, less the refund where it falls in them.
        const paid = DAYS.reduce((sum, day, i) => (inSpan(day, key) ? sum + 100 * 2 ** i : sum), 0) + (inSpan(PAID_ONCE, key) ? 1000 : 0);
        const refunded = inSpan("2025-09-24", key) ? 20 : 0;
        expect((await moneyOf(gym, owner, key)).yearEarlier, key).toEqual({ state: "ok", ...span, paidMinor: paid, soldMinor: 0, refundedMinor: refunded, netMinor: paid - refunded });
      }

      // The sums, said once as numbers, so a fault in the test's own arithmetic shows.
      // Four weeks a year earlier: 24 Sep, 20 Oct and 21 Oct 2025.
      expect((await moneyOf(gym, owner, "4w")).yearEarlier).toMatchObject({ paidMinor: 3200 + 6400 + 12800, refundedMinor: 20 });
      // Three months: 1 Aug, 23 Sep, 24 Sep and 20 Oct 2025, and 15 August's 10.00.
      expect((await moneyOf(gym, owner, "3m")).yearEarlier).toMatchObject({ paidMinor: 800 + 1600 + 3200 + 6400 + 1000, netMinor: 800 + 1600 + 3200 + 6400 + 1000 - 20 });
      expect((await membersOf(gym, owner, "3m")).yearEarlier).toMatchObject({ joined: 4 });

      // Next door reads its own a year earlier, and none of this gym's: its list began in
      // 2024; its first payment came in October 2025.
      for (const key of REPORT_PERIODS) {
        const span = SPAN[key];
        expect((await membersOf(next, nextOwner, key)).yearEarlier, key).toEqual({ state: "ok", ...span, joined: 1 });
        expect((await moneyOf(next, nextOwner, key)).yearEarlier, key).toEqual({ state: "no_history", ...span, since: NEXT_DOOR_DAY });
      }

      // Somebody who may read Reports and not money reads no amount of any year: the money
      // read refuses them, and the other two carry no money at all.
      const trainer = await makeUser("trainer");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym}, ${trainer.userId}, 'trainer', ${["reports.read"]})`;
      const stranger = await makeUser("stranger");
      for (const key of REPORT_PERIODS) {
        expect((await get(`/v1/orgs/${gym}/reports/money?period=${key}`, trainer.cookies)).statusCode, key).toBe(403);
        for (const part of ["members", "attendance"] as const) {
          const body = (await get(`/v1/orgs/${gym}/reports/${part}?period=${key}`, trainer.cookies)).body;
          expect(body, `${part} ${key}`).not.toMatch(/Minor|9990|1280|"paid/);
        }
        for (const part of ["members", "attendance", "money"] as const) {
          expect((await get(`/v1/orgs/${gym}/reports/${part}?period=${key}`, stranger.cookies)).statusCode, `${part} ${key} stranger`).toBe(404);
          expect((await get(`/v1/orgs/${gym}/reports/${part}?period=${key}`)).statusCode, `${part} ${key} nobody`).toBe(401);
        }
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "one member typed by hand before the gym's real file: no new members a year earlier, and the day most of the list was added (round one's H1)",
    async () => {
      const owner = await makeUser("typed");
      const gym = await makeGym(owner, "Rep Year Typed First");
      // One member typed on 1 July 2025; the gym's file of 75 imported on 10 September 2026:
      // 35 joined in August and September 2025, 40 in August and September 2026.
      await listedMany(gym, ["Typed By Hand"], "2025-07-01");
      // One more typed on 3 December 2025, who joined on 20 September: the day named is the
      // day most of the late people came, not the first of them (the re-check's H2b).
      await sql`
        INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source, created_at, joined_on)
        VALUES (${gym}, 'Typed In December', 'rep-y-typed-december@example.com', ${"d".repeat(64)}, 'typed', '2025-12-03T11:00:00Z', '2025-09-20')`;
      await sql`
        INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source, created_at, joined_on)
        SELECT ${gym}, 'From The File ' || n, 'rep-y-file-' || n || '@example.com', lpad('e' || n::text, 64, '0'), 'upload',
               '2026-09-10T11:00:00Z', CASE WHEN n <= 35 THEN DATE '2025-08-01' + n ELSE DATE '2026-08-01' + (n - 35) END
        FROM generate_series(1, 75) AS n`;
      const r = await membersOf(gym, owner, "3m");
      expect(r.inPeriod.joined).toBe(40);
      expect(r.yearEarlier).toEqual({ state: "added_later", ...SPAN["3m"], on: "2026-09-10" });
      // Twelve months a year earlier begin on 1 November 2024, before the list did.
      expect((await membersOf(gym, owner, "12m")).yearEarlier).toEqual({ state: "no_history", ...SPAN["12m"], since: "2025-07-01" });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a gym that imports last month's joiners on the 1st of each month, joining at the same rate both years, reads the same both years: a year earlier is counted as today is (the confirm's H3)",
    async () => {
      const owner = await makeUser("monthly");
      const gym = await makeGym(owner, "Rep Year Monthly Import");
      await listedMany(gym, ["First On The List"], "2024-01-10");
      // One joiner a day from 1 August 2025 to 30 September 2026, each month's on the list
      // from the 1st of the next month: October 2026's are not imported yet, as October
      // 2025's were not on 20 October 2025.
      await sql`
        INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source, created_at, joined_on)
        SELECT ${gym}, 'Joined ' || d::date, 'rep-y-monthly-' || to_char(d, 'YYYYMMDD') || '@example.com', lpad(to_char(d, 'YYYYMMDD'), 64, 'c'), 'upload',
               (date_trunc('month', d) + interval '1 month' + interval '11 hours') AT TIME ZONE 'UTC', d::date
        FROM generate_series(DATE '2025-08-01', DATE '2026-09-30', interval '1 day') AS d`;
      // Four weeks, 23 September to 20 October 2026: the 8 of 23 to 30 September. A year
      // earlier, 24 September to 21 October 2025: the 7 of 24 to 30 September. October's
      // were imported on 1 November, a month's ordinary lag: in neither figure.
      const fourWeeks = await membersOf(gym, owner, "4w");
      expect(fourWeeks.inPeriod.joined).toBe(8);
      expect(fourWeeks.yearEarlier).toEqual({ state: "ok", ...SPAN["4w"], joined: 7 });
      // Three months: August and September, 31 + 30, in both years.
      const threeMonths = await membersOf(gym, owner, "3m");
      expect(threeMonths.inPeriod.joined).toBe(61);
      expect(threeMonths.yearEarlier).toEqual({ state: "ok", ...SPAN["3m"], joined: 61 });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a year earlier is counted on the gym's own clock: in Auckland, a record at 00:30 on a span's first day is in it, one at 23:30 the night before is not",
    async () => {
      const owner = await makeUser("auckland");
      const gym = await makeGym(owner, "Rep Year Auckland", "Pacific/Auckland");
      await listedMany(gym, ["First In Auckland"], "2024-01-10");
      // 1 August 2025 at 00:30 in Auckland (NZST, 12 hours ahead) is 31 July at 12:30 UTC.
      const at = async (name: string, instant: string) => sql`
        INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source, created_at)
        VALUES (${gym}, ${name}, ${`rep-y-akl-${name.replace(/ /g, "")}@example.com`}, ${(name === "On The First Day" ? "1" : "2").padStart(64, "a")}, 'typed', ${instant}::timestamptz)`;
      await at("On The First Day", "2025-07-31T12:30:00Z");
      await at("The Night Before", "2025-07-31T11:30:00Z");
      // Today in Auckland is 21 October 2026: three months a year earlier are 1 Aug to 21 Oct 2025.
      expect((await membersOf(gym, owner, "3m")).yearEarlier).toEqual({ state: "ok", from: "2025-08-01", to: "2025-10-21", joined: 1 });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a gym whose records begin inside a year-earlier span reads no figure for it, with the day they began, never a zero",
    async () => {
      const owner = await makeUser("young");
      const gym = await makeGym(owner, "Rep Year Young Gym");
      // The list began on 15 August 2025, inside three and twelve months a year earlier and before four weeks.
      const [pat] = await listedMany(gym, ["Pat Young"], "2025-08-15");
      if (pat === undefined) throw new Error("no record");
      const held = await give(gym, owner, pat, await addType(gym, owner, "Three Years", {}), "2025-08-15", false);
      await pay(gym, owner, pat, held.id, "2025-08-15", 4200);

      for (const key of ["3m", "12m"] as const) {
        const none = { state: "no_history", ...SPAN[key], since: "2025-08-15" };
        expect((await membersOf(gym, owner, key)).yearEarlier, key).toEqual(none);
        expect((await moneyOf(gym, owner, key)).yearEarlier, key).toEqual(none);
      }
      // Four weeks a year earlier began on 24 September 2025, after all of it: each is there, and is a zero.
      expect((await moneyOf(gym, owner, "4w")).yearEarlier).toMatchObject({ state: "ok", paidMinor: 0 });
      // The list began in August: new members are counted from 1 September, so four weeks from 24 September have a figure.
      expect((await membersOf(gym, owner, "4w")).yearEarlier).toEqual({ state: "ok", ...SPAN["4w"], joined: 0 });
    },
    TEST_TIMEOUT_MS,
  );
});
