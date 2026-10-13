// The Reports page's money figures, through its route against real Postgres
// (DATABASE_URL-gated). ROADMAP Stage 2 item 21b-i; spec Part 3 §16.5.
//
// The first test is the worst thing this job could do: an owner reads money that is
// false (a payment taken back or a refund still counted as collected, a cancelled bill
// still owed), or reads another gym's money. Two gyms hold a dated notebook written by
// the real services, each step on its own day; each gym reads only its own, to the penny,
// and nobody without both ticks reads either.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  membersReportResponseSchema,
  moneyReportResponseSchema,
  type GymMembershipTypesResponse,
  type HeldMembershipsResponse,
  type MoneyFigures,
  type MoneyReport,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createIoRedis, createMemoryRedis } from "../src/redis.js";
import { openDueBills } from "../src/modules/orgs/memberships/billsRepo.js";
import * as heldService from "../src/modules/orgs/memberships/heldService.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "reports-money-routes-secret-012345678901", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface User {
  userId: string;
  cookies: Cookies;
}

const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 90_000;
const LIVE_PLAN = "zz_reports_money_routes";
/** Tuesday 20 October 2026, midday in London. */
const TODAY = new Date("2026-10-20T11:00:00Z");

// The limits are counted in the real Redis, which outlives a run: each run signs up its
// own email addresses, from network addresses of its own.
const RUN_NET = String(1 + Math.floor(Math.random() * 250));
const RUN_TAG = Date.now().toString(36);
let ipCounter = 0;
const nextIp = () => `10.${RUN_NET}.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
let keyCounter = 0;
const nextKey = () => `00000000-0000-4000-8000-${String(++keyCounter).padStart(12, "0")}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const type = (name: string, over: Record<string, unknown>) => ({
  name,
  description: null,
  kind: "recurring",
  priceMinor: 4999,
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
  ...over,
});

d("Reports, money: whose figures, who reads them, and what counts as money (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redisUrl = process.env["TEST_REDIS_URL"];
  const redis = redisUrl === undefined || redisUrl === "" ? createMemoryRedis() : createIoRedis(redisUrl);
  /** The routes' clock. */
  let clock = TODAY;
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'rep-m-%@example.com')`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'rep-m-%@example.com'`;
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
    const email = `rep-m-${RUN_TAG}-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Rep ${local}` });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
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

  /** Somebody on the gym's staff, holding exactly these ticks, or the role's own with null. */
  const makeStaff = async (gymId: string, who: User, role: "manager" | "trainer", privileges: string[] | null) => {
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gymId}, ${who.userId}, ${role}, ${privileges})`;
  };

  let personNo = 0;
  /** A record on the gym's list since 1 June 2026. */
  const listed = async (gymId: string, name: string): Promise<string> => {
    personNo += 1;
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source, created_at)
      VALUES (${gymId}, ${name}, ${`rep-m-listed-${String(personNo)}@example.com`}, ${String(personNo).padStart(64, "0")}, 'typed',
              '2026-06-01T09:00:00Z'::timestamptz)
      RETURNING id`;
    const row = rows[0];
    if (row === undefined) throw new Error("no record");
    return row.id;
  };

  const addType = async (gymId: string, owner: User, body: { name: string }): Promise<string> => {
    const res = await post(`/v1/orgs/${gymId}/membership-types`, body, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === body.name);
    if (found === undefined) throw new Error(`no type named ${body.name}`);
    return found.id;
  };

  /** The services' own clock for one step: noon in London on that day. */
  const on = (day: string) => ({ sql, now: () => new Date(`${day}T11:00:00Z`) });
  /** The hourly run that opens the bills due, on that day. */
  const run = (gymId: string, day: string) =>
    openDueBills({ sql, log: { info: () => undefined, error: () => undefined } }, { now: new Date(`${day}T11:00:00Z`), gymIds: [gymId] });

  const first = (page: HeldMembershipsResponse) => {
    const m = page.memberships[0];
    if (m === undefined || m.billing === null) throw new Error("no membership with its bills");
    return { ...m, billing: m.billing };
  };
  const idOf = (thing: { id: string } | undefined): string => {
    if (thing === undefined) throw new Error("nothing there");
    return thing.id;
  };

  interface Held {
    entryId: string;
    id: string;
    billId: string;
    paymentId: string | null;
  }
  /** A membership given by the real service on `day`, starting that day unless told. */
  const give = async (gymId: string, owner: User, name: string, typeId: string, day: string, paid: boolean, startsOn = day): Promise<Held> => {
    const entryId = await listed(gymId, name);
    const m = first(
      await heldService.giveHeldMembership(on(day), owner.userId, gymId, entryId, {
        requestKey: nextKey(),
        typeId,
        startsOn,
        paid,
        ...(paid ? { method: "cash" as const } : {}),
      }),
    );
    const bill = m.billing.bills[0];
    return { entryId, id: m.id, billId: bill?.id ?? "", paymentId: bill?.payments[0]?.id ?? null };
  };
  const pay = async (gymId: string, owner: User, h: Held, day: string, periodIndex: number, amountMinor: number) =>
    first(await heldService.recordMemberPayment(on(day), owner.userId, gymId, h.entryId, h.id, { requestKey: nextKey(), periodIndex, amountMinor, method: "card_at_desk" }));

  const moneyUrl = (gymId: string) => `/v1/orgs/${gymId}/reports/money`;
  const read = async (gymId: string, who: User): Promise<MoneyReport> => {
    const res = await get(moneyUrl(gymId), who.cookies);
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
    "each gym reads its own money to the penny: nothing taken back, refunded or cancelled is counted, and nobody without both ticks reads it",
    async () => {
      clock = TODAY;
      const owner = await makeUser("own");
      const gym = await makeGym(owner, "Rep Money Gym");
      const nextOwner = await makeUser("next");
      const next = await makeGym(nextOwner, "Rep Money Next Door");

      const gold = await addType(gym, owner, type("Gold Monthly", {}));
      const annual = await addType(gym, owner, type("Annual", { priceMinor: 48000, termUnit: "year" }));
      const weekly = await addType(gym, owner, type("Weekly", { priceMinor: 1200, termUnit: "week" }));
      const oneMonth = await addType(gym, owner, type("One month", { kind: "one_time", priceMinor: 6000 }));
      const free = await addType(gym, owner, type("Staff family", { priceMinor: 0 }));
      const theirs = await addType(next, nextOwner, type("Gold Monthly", { priceMinor: 3000 }));

      // June. Hal never pays for his one month; Ana pays every month from here on.
      const hal = await give(gym, owner, "Hal Never Paid", oneMonth, "2026-06-05", false);
      const ana = await give(gym, owner, "Ana Every Month", gold, "2026-06-10", true);
      const jon = await give(gym, owner, "Jon Frozen", annual, "2026-06-12", true);
      // July.
      const ben = await give(gym, owner, "Ben Annual", annual, "2026-07-01", true);
      await run(gym, "2026-07-10");
      await pay(gym, owner, ana, "2026-07-10", 1, 4999);
      // Gus's payment is taken back the next day; he cancels, and staff cancel his bill.
      const gus = await give(gym, owner, "Gus Taken Back", gold, "2026-07-15", true);
      const gusAfter = first(await heldService.undoMemberPayment(on("2026-07-16"), owner.userId, gym, gus.entryId, gus.id, gus.paymentId ?? ""));
      await heldService.moveHeldMembership(on("2026-07-20"), owner.userId, gym, gus.entryId, gus.id, { type: "cancel", when: "today" });
      await heldService.cancelMemberBill(on("2026-07-21"), owner.userId, gym, gus.entryId, gus.id, idOf(gusAfter.billing.bills[0]), { reason: "mistake" });
      // August. Hal is taken off the list, still owing.
      await sql`UPDATE gym_member_list_entries SET former_at = '2026-08-01T11:00:00Z' WHERE gym_id = ${gym} AND id = ${hal.entryId}`;
      const eve = await give(gym, owner, "Eve Part Paid", gold, "2026-08-05", true);
      await run(gym, "2026-08-10");
      await pay(gym, owner, ana, "2026-08-10", 2, 4999);
      const fay = await give(gym, owner, "Fay Part Refunded", oneMonth, "2026-08-10", true);
      // September. Fay is given some back; Eve pays part of her second month.
      await heldService.noteMemberRefund(on("2026-09-03"), owner.userId, gym, fay.entryId, fay.id, fay.paymentId ?? "", {
        requestKey: nextKey(),
        amountMinor: 2000,
        method: "cash",
        reason: "charged_too_much",
      });
      await run(gym, "2026-09-05");
      await pay(gym, owner, eve, "2026-09-05", 1, 2000);
      await run(gym, "2026-09-10");
      await pay(gym, owner, ana, "2026-09-10", 3, 4999);
      const dee = await give(gym, owner, "Dee Never Paid", gold, "2026-09-25", false);
      const lou = await give(gym, owner, "Lou All Refunded", oneMonth, "2026-09-28", true);
      // October. Lou gets it all back; a refund noted for Ben by mistake is taken back.
      await heldService.moveHeldMembership(on("2026-10-01"), owner.userId, gym, jon.entryId, jon.id, { type: "freeze" });
      await give(gym, owner, "Kim Free", free, "2026-10-01", false);
      await heldService.noteMemberRefund(on("2026-10-02"), owner.userId, gym, lou.entryId, lou.id, lou.paymentId ?? "", {
        requestKey: nextKey(),
        amountMinor: 6000,
        method: "cash",
        reason: "other",
      });
      const benNoted = first(
        await heldService.noteMemberRefund(on("2026-10-03"), owner.userId, gym, ben.entryId, ben.id, ben.paymentId ?? "", {
          requestKey: nextKey(),
          amountMinor: 1000,
          method: "cash",
          reason: "paid_twice",
        }),
      );
      await heldService.undoMemberRefund(on("2026-10-03"), owner.userId, gym, ben.entryId, ben.id, ben.paymentId ?? "", idOf(benNoted.billing.bills[0]?.payments[0]?.refunds[0]));
      await run(gym, "2026-10-10");
      await pay(gym, owner, ana, "2026-10-10", 4, 4999);
      await give(gym, owner, "Cal Weekly", weekly, "2026-10-14", true);
      // Ivy's starts next week: nothing is owed for it yet, and it is not in use.
      await give(gym, owner, "Ivy Next Week", gold, "2026-10-19", false, "2026-10-25");
      // A bill reads Overdue 20 days after it fell due, so Eve's October bill is due and not overdue.
      await sql`UPDATE gyms SET bills_overdue_days = 20 WHERE id = ${gym}`;

      // Next door: one person, one payment, in October.
      const tia = await give(next, nextOwner, "Tia Next Door", theirs, "2026-10-01", true);
      expect(tia.paymentId).not.toBeNull();
      expect(dee.billId).not.toBe("");

      const report = figures(await read(gym, owner));
      expect(report.currency).toBe("GBP");
      expect(report.firstPaidOn).toBe("2026-06-10");
      expect(report.otherCurrency).toBe(false);
      // Ana, Dee and Eve at 49.99; Ben's 480.00 a year as 40.00; Cal's 12.00 a week as 52.00.
      // Not Jon (frozen), Gus (cancelled), Ivy (not started), Kim (free), nor a one-off.
      expect(report.recurring).toEqual({ monthlyMinor: 4999 * 3 + 4000 + 5200, memberships: 5 });
      expect(report.months).toEqual([
        { month: "2026-06", paidMinor: 4999 + 48000, refundedMinor: 0, netMinor: 52999 },
        // Gus's 49.99 was taken back: not money.
        { month: "2026-07", paidMinor: 4999 + 48000, refundedMinor: 0, netMinor: 52999 },
        { month: "2026-08", paidMinor: 4999 + 4999 + 6000, refundedMinor: 0, netMinor: 15998 },
        { month: "2026-09", paidMinor: 4999 + 2000 + 6000, refundedMinor: 2000, netMinor: 10999 },
        // Ben's refund was taken back: not counted.
        { month: "2026-10", paidMinor: 4999 + 1200, refundedMinor: 6000, netMinor: 199 },
      ]);
      expect(report.thisMonth).toEqual({ month: "2026-10", paidMinor: 6199, refundedMinor: 6000, netMinor: 199 });
      // Dee's 49.99; Eve's 29.99 left of September and all of October. Gus's cancelled bill
      // is owed by nobody, Ivy's has not fallen due, and Hal is a past member.
      expect(report.owed).toEqual({
        minor: 4999 + 2999 + 4999,
        people: 2,
        // The Members list marks the same two, and nobody else.
        listOnlyPeople: 0,
        pastMinor: 6000,
        pastPeople: 1,
        // Due before 30 September: Dee's, Eve's September and Hal's.
        overdueMinor: 4999 + 2999 + 6000,
        overduePeople: 3,
        overdueAfterDays: 20,
      });
      expect(report.types).toEqual([
        { name: "Annual", inUse: 1, monthlyMinor: 4000, monthNetMinor: 0, yearNetMinor: 96000 },
        { name: "Gold Monthly", inUse: 3, monthlyMinor: 14997, monthNetMinor: 4999, yearNetMinor: 5 * 4999 + 4999 + 2000 },
        { name: "One month", inUse: 1, monthlyMinor: 0, monthNetMinor: -6000, yearNetMinor: 6000 - 2000 },
        { name: "Weekly", inUse: 1, monthlyMinor: 5200, monthNetMinor: 1200, yearNetMinor: 1200 },
        { name: "Staff family", inUse: 1, monthlyMinor: 0, monthNetMinor: 0, yearNetMinor: 0 },
      ]);

      // Lifetime value divides by the Members figures' own churn: the same months, and the
      // money of those months for each member who left in them (Gus, Hal and Fay).
      const membersRes = await get(`/v1/orgs/${gym}/reports/members`, owner.cookies);
      const members = membersReportResponseSchema.parse(JSON.parse(membersRes.body)).report;
      expect(members.churnMonths).toEqual(["2026-07", "2026-08", "2026-09"]);
      expect(members.months.filter((m) => members.churnMonths.includes(m.month)).map((m) => m.left)).toEqual([1, 1, 1]);
      expect(report.lifetimeValue).toEqual({ state: "ok", minor: Math.round((52999 + 15998 + 10999) / 3), months: members.churnMonths, leavers: 3 });

      // Next door reads its own, and only its own.
      const theirReport = figures(await read(next, nextOwner));
      expect(theirReport.recurring).toEqual({ monthlyMinor: 3000, memberships: 1 });
      expect(theirReport.months).toEqual([{ month: "2026-10", paidMinor: 3000, refundedMinor: 0, netMinor: 3000 }]);
      expect(theirReport.owed).toMatchObject({ minor: 0, people: 0, pastMinor: 0, pastPeople: 0 });
      expect(theirReport.types).toEqual([{ name: "Gold Monthly", inUse: 1, monthlyMinor: 3000, monthNetMinor: 3000, yearNetMinor: 3000 }]);
      expect(theirReport.lifetimeValue).toEqual({ state: "nobody_left" });

      // Who reads it: both ticks, and this gym's staff.
      const manager = await makeUser("manager");
      await makeStaff(gym, manager, "manager", null);
      const both = await makeUser("both");
      await makeStaff(gym, both, "trainer", ["reports.read", "billing.members"]);
      const reportsOnly = await makeUser("reports-only");
      await makeStaff(gym, reportsOnly, "trainer", ["reports.read"]);
      const billsOnly = await makeUser("bills-only");
      await makeStaff(gym, billsOnly, "trainer", ["billing.members"]);
      const stranger = await makeUser("stranger");
      expect(await read(gym, manager)).toEqual(report);
      expect(await read(gym, both)).toEqual(report);
      expect((await get(moneyUrl(gym), reportsOnly.cookies)).statusCode).toBe(403);
      // The same person still reads the figures their tick is for.
      expect((await get(`/v1/orgs/${gym}/reports/attendance`, reportsOnly.cookies)).statusCode).toBe(200);
      expect((await get(moneyUrl(gym), billsOnly.cookies)).statusCode).toBe(403);
      expect((await get(moneyUrl(gym), nextOwner.cookies)).statusCode).toBe(404);
      expect((await get(moneyUrl(gym), stranger.cookies)).statusCode).toBe(404);
      expect((await get(moneyUrl(gym))).statusCode).toBe(401);
      expect((await get("/v1/orgs/not-a-gym/reports/money", owner.cookies)).statusCode).toBe(400);
      // A refusal carries no figure.
      expect((await get(moneyUrl(gym), reportsOnly.cookies)).body).not.toMatch(/Minor|GBP/);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a gym that records no payment here is told why and shown no zero; one payment taken back is none",
    async () => {
      clock = TODAY;
      const owner = await makeUser("empty");
      const gym = await makeGym(owner, "Rep Money Empty");
      expect(await read(gym, owner)).toEqual({ state: "no_memberships", timezone: "Europe/London", today: "2026-10-20" });

      const gold = await addType(gym, owner, type("Gold Monthly", {}));
      expect((await read(gym, owner)).state).toBe("no_memberships");
      const amy = await give(gym, owner, "Amy Unpaid", gold, "2026-10-12", false);
      expect(await read(gym, owner)).toEqual({ state: "no_payments", timezone: "Europe/London", today: "2026-10-20" });

      const paid = await pay(gym, owner, amy, "2026-10-15", 0, 4999);
      const report = figures(await read(gym, owner));
      expect(report).toMatchObject({
        firstPaidOn: "2026-10-15",
        recurring: { monthlyMinor: 4999, memberships: 1 },
        thisMonth: { paidMinor: 4999, refundedMinor: 0, netMinor: 4999 },
        owed: { minor: 0, people: 0 },
        lifetimeValue: { state: "nobody_left" },
      });

      await heldService.undoMemberPayment(on("2026-10-16"), owner.userId, gym, amy.entryId, amy.id, idOf(paid.billing.bills[0]?.payments[0]));
      expect((await read(gym, owner)).state).toBe("no_payments");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Payment due counts the people the Members list and Overview count, and the edges of due and overdue fall on the right day",
    async () => {
      clock = TODAY;
      const owner = await makeUser("edges");
      const gym = await makeGym(owner, "Rep Money Edges");
      const gold = await addType(gym, owner, type("Gold Monthly", {}));
      await sql`UPDATE gyms SET bills_overdue_days = 20 WHERE id = ${gym}`;
      await give(gym, owner, "Zoe Paid", gold, "2026-10-10", true);
      // Due today: owed, and not overdue. Due 20 days ago: the last day it is not overdue.
      await give(gym, owner, "Tom Due Today", gold, "2026-10-20", false);
      await give(gym, owner, "Uma On The Edge", gold, "2026-09-30", false);
      await give(gym, owner, "Vic Overdue", gold, "2026-09-29", false);
      // A past member whose repeating membership is still stored in use brings in nothing.
      const wes = await give(gym, owner, "Wes Past", gold, "2026-10-05", true);
      await sql`UPDATE gym_member_list_entries SET former_at = '2026-10-12T11:00:00Z' WHERE gym_id = ${gym} AND id = ${wes.entryId}`;
      // Two people the gym's own file marks Payment due, with no bill here.
      for (const name of ["Xia File Only", "Yan File Only"]) {
        const id = await listed(gym, name);
        await sql`UPDATE gym_member_list_entries SET payment_status = 'Payment due' WHERE gym_id = ${gym} AND id = ${id}`;
      }

      const report = figures(await read(gym, owner));
      expect(report.recurring).toEqual({ monthlyMinor: 4 * 4999, memberships: 4 });
      expect(report.owed).toEqual({
        minor: 3 * 4999,
        people: 3,
        listOnlyPeople: 2,
        pastMinor: 0,
        pastPeople: 0,
        overdueMinor: 4999,
        overduePeople: 1,
        overdueAfterDays: 20,
      });

      // One answer with Overview's box and the Members list's own chip.
      const weekRes = await get(`/v1/orgs/${gym}/week`, owner.cookies);
      expect(weekRes.statusCode, weekRes.body).toBe(200);
      const week = (JSON.parse(weekRes.body) as { week: { paymentDue: { count: number; past: number } | null } }).week;
      expect(week.paymentDue).toEqual({ count: report.owed.people + report.owed.listOnlyPeople, past: report.owed.pastPeople });
      const listRes = await get(`/v1/orgs/${gym}/member-list`, owner.cookies);
      expect(listRes.statusCode, listRes.body).toBe(200);
      const { list } = JSON.parse(listRes.body) as { list: { paymentStatuses: { label: string; count: number }[] } };
      const chip = list.paymentStatuses.filter((c) => c.label.toLowerCase() === "payment due").reduce((sum, c) => sum + c.count, 0);
      expect(chip).toBe(report.owed.people + report.owed.listOnlyPeople);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a gym whose country changed still reads the money it recorded, in the currency it was recorded in",
    async () => {
      clock = TODAY;
      const owner = await makeUser("moved");
      const gym = await makeGym(owner, "Rep Money Moved");
      const gold = await addType(gym, owner, type("Gold Monthly", {}));
      await give(gym, owner, "Amy Pounds", gold, "2026-10-10", true);
      await give(gym, owner, "Abe Owes Pounds", gold, "2026-10-12", false);
      const before = figures(await read(gym, owner));
      expect(before).toMatchObject({ currency: "GBP", otherCurrency: false, thisMonth: { paidMinor: 4999 }, owed: { minor: 4999, people: 1 } });

      const moved = await api().inject({
        method: "PATCH",
        url: `/v1/orgs/${gym}`,
        remoteAddress: nextIp(),
        cookies: owner.cookies,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ name: "Rep Money Moved", city: "Austin", country: "US", timezone: "Europe/London" }),
      });
      expect(moved.statusCode, moved.body).toBe(200);
      // The same figures as before: nothing is lost, and nothing reads "no payment".
      expect(figures(await read(gym, owner))).toEqual(before);

      // A payment in the new currency: the figures follow the newest money, and say the
      // older money is left out.
      const dollars = await addType(gym, owner, type("Dollar Monthly", { priceMinor: 3000 }));
      await give(gym, owner, "Bea Dollars", dollars, "2026-10-18", true);
      const after = figures(await read(gym, owner));
      expect(after).toMatchObject({
        currency: "USD",
        otherCurrency: true,
        recurring: { monthlyMinor: 3000, memberships: 1 },
        thisMonth: { paidMinor: 3000, refundedMinor: 0, netMinor: 3000 },
        owed: { minor: 0, people: 0 },
      });
      expect(after.types.map((t) => t.name)).toEqual(["Dollar Monthly"]);

      // Somebody still paying in pounds does not turn the page back: the country's own
      // currency stands once a payment is in it.
      await give(gym, owner, "Cy Pounds Later", gold, "2026-10-19", true);
      expect(figures(await read(gym, owner))).toEqual(after);
    },
    TEST_TIMEOUT_MS,
  );
});
