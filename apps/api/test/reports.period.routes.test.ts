// The Reports page's period, through its three routes against real Postgres
// (DATABASE_URL-gated). ROADMAP Stage 2 item 21d-i; spec Part 3 §16.5.
//
// The first test is the worst thing this job could do: an owner reads a figure for days
// other than the ones the page names, such as four weeks of takings said to be twelve
// months'. One gym holds a payment, a refund, a joiner, a leaver, visits and a class on
// the day before each period begins and on its first day, and today; every figure of
// every period is the sum of exactly the days the answer itself names.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  REPORT_PERIODS,
  attendanceReportResponseSchema,
  daysBetween,
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
  JWT_SECRET: "reports-period-routes-secret-01234567890", // dummy test value, gitleaks:allow
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
const LIVE_PLAN = "zz_reports_period_routes";
/** Tuesday 20 October 2026, midday in London. */
const TODAY = "2026-10-20";
const NOW = new Date(`${TODAY}T11:00:00Z`);
/** The first day of each period on that day, and the day before it. */
const FROM: Record<ReportPeriodKey, string> = { "4w": "2026-09-23", "3m": "2026-08-01", "12m": "2025-11-01" };
const BEFORE: Record<ReportPeriodKey, string> = { "4w": "2026-09-22", "3m": "2026-07-31", "12m": "2025-10-31" };
/** Those six days and today, oldest first: something happens on each. */
const DAYS = [BEFORE["12m"], FROM["12m"], BEFORE["3m"], FROM["3m"], BEFORE["4w"], FROM["4w"], TODAY] as const;
/** A day inside three months and outside four weeks. */
const PAID_ONCE = "2026-08-15";

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

d("Reports, the period: every figure counts the days the answer names (real Postgres)", () => {
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
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'rep-p-%@example.com')`;
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
    await sql`DELETE FROM users WHERE email LIKE 'rep-p-%@example.com'`;
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
    const email = `rep-p-${RUN_TAG}-${local}@example.com`;
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

  let personNo = 0;
  /** A record written straight into the list on a day, at midday in London; `leftOn` makes it a former one. */
  const listed = async (gymId: string, name: string, listedOn: string, leftOn: string | null = null): Promise<string> => {
    personNo += 1;
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source, created_at, former_at)
      VALUES (${gymId}, ${name}, ${`rep-p-listed-${String(personNo)}@example.com`}, ${String(personNo).padStart(64, "0")}, 'typed',
              ${`${listedOn}T11:00:00Z`}::timestamptz, ${leftOn === null ? null : `${leftOn}T11:00:00Z`}::timestamptz)
      RETURNING id`;
    const row = rows[0];
    if (row === undefined) throw new Error("no record");
    return row.id;
  };

  /** A visit as staff's Check in leaves it, at nine in the morning of that day. */
  const visit = async (gymId: string, ownerId: string, entryId: string, day: string) => {
    await sql`
      INSERT INTO gym_attendance (gym_id, user_id, entry_id, marked_by_user_id, day, method, hours_status, slot_key, marked_at)
      VALUES (${gymId}, null, ${entryId}, ${ownerId}, ${day}::date, 'staff', 'hours_unset', 'hours_unset', ${`${day}T09:00:00Z`}::timestamptz)`;
  };

  /** One class with ten places at an instant. */
  const classAt = async (gymId: string, typeId: string, at: string) => {
    await sql`
      INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places, status)
      SELECT ${gymId}, ${typeId}, l::date, (EXTRACT(HOUR FROM l) * 60 + EXTRACT(MINUTE FROM l))::int, ${at}::timestamptz, 45, 10, 'scheduled'
      FROM (SELECT ${at}::timestamptz AT TIME ZONE 'Europe/London' AS l) x`;
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
        priceMinor: 100000,
        termCount: 1,
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
  /** A membership given by the real service on `day`, paid in full that day or not at all. */
  const give = async (gymId: string, owner: User, entryId: string, typeId: string, day: string, paid: boolean) => {
    const m = first(
      await heldService.giveHeldMembership(on(day), owner.userId, gymId, entryId, { requestKey: nextKey(), typeId, startsOn: day, paid, ...(paid ? { method: "cash" as const } : {}) }),
    );
    return { id: m.id, paymentId: m.billing.bills[0]?.payments[0]?.id ?? "" };
  };

  /** A part payment on the first bill, on `day`; answers the payment's id. */
  const pay = async (gymId: string, owner: User, entryId: string, heldId: string, day: string, amountMinor: number): Promise<string> => {
    await heldService.recordMemberPayment(on(day), owner.userId, gymId, entryId, heldId, { requestKey: nextKey(), periodIndex: 0, amountMinor, method: "cash" });
    const rows = await sql<{ id: string }[]>`
      SELECT p.id FROM gym_member_payments p WHERE p.gym_id = ${gymId} AND p.amount_minor = ${amountMinor} AND p.paid_on = ${day}::date`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no payment");
    return id;
  };
  const refund = (gymId: string, owner: User, entryId: string, heldId: string, paymentId: string, day: string, amountMinor: number) =>
    heldService.noteMemberRefund(on(day), owner.userId, gymId, entryId, heldId, paymentId, { requestKey: nextKey(), amountMinor, method: "cash", reason: "other" });

  const membersOf = async (gymId: string, who: User, period: ReportPeriodKey | null) => {
    const res = await get(`/v1/orgs/${gymId}/reports/members${period === null ? "" : `?period=${period}`}`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return membersReportResponseSchema.parse(JSON.parse(res.body)).report;
  };
  const attendanceOf = async (gymId: string, who: User, period: ReportPeriodKey | null) => {
    const res = await get(`/v1/orgs/${gymId}/reports/attendance${period === null ? "" : `?period=${period}`}`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return attendanceReportResponseSchema.parse(JSON.parse(res.body)).report;
  };
  const moneyOf = async (gymId: string, who: User, period: ReportPeriodKey | null) => {
    const res = await get(`/v1/orgs/${gymId}/reports/money${period === null ? "" : `?period=${period}`}`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    const report = moneyReportResponseSchema.parse(JSON.parse(res.body)).report;
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
    "a payment, a refund, a joiner, a leaver, a visit and a class on the day before a period begins are in none of its figures, and those on its first day are in all of them",
    async () => {
      const owner = await makeUser("own");
      const gym = await makeGym(owner, "Rep Period Gym");
      const nextOwner = await makeUser("next");
      const next = await makeGym(nextOwner, "Rep Period Next Door");

      // The list began in January 2025. On each of the seven days one person joins and one leaves.
      await listed(gym, "First On The List", "2025-01-10");
      for (const day of DAYS) {
        await listed(gym, `Joined ${day}`, day);
        await listed(gym, `Left ${day}`, "2025-02-01", day);
      }
      // Visits double day by day (1, 2, 4, 8, 16, 32), made by the first so many of 32 regulars; 3 come today.
      const regulars: string[] = [];
      for (let i = 0; i < 32; i += 1) regulars.push(await listed(gym, `Regular ${String(i)}`, "2025-03-01"));
      const visitsOn = new Map<string, number>(DAYS.map((day, i) => [day, day === TODAY ? 3 : 2 ** i]));
      for (const [day, n] of visitsOn) for (const entryId of regulars.slice(0, n)) await visit(gym, owner.userId, entryId, day);
      // A class at five in the afternoon on each of the days; today's has not started.
      const spin = (await sql<{ id: string }[]>`
        INSERT INTO gym_class_types (gym_id, name, minutes, places, colour, open_gym) VALUES (${gym}, 'Spin', 45, 10, 'blue', false) RETURNING id`)[0]?.id;
      if (spin === undefined) throw new Error("no class type");
      for (const day of DAYS) await classAt(gym, spin, `${day}T17:00:00Z`);
      // Payments double day by day (1.00, 2.00, 4.00 ... 64.00) on one yearly bill of 1,000.00, so every sum names its days.
      const yearly = await addType(gym, owner, "Annual", {});
      const payer = await listed(gym, "Pat Pays In Parts", "2025-03-01");
      const held = await give(gym, owner, payer, yearly, BEFORE["12m"], false);
      for (const [i, day] of DAYS.entries()) await pay(gym, owner, payer, held.id, day, 100 * 2 ** i);
      // Two people pay 10.00 for their first month on 15 August, inside three months and outside four weeks. Money goes
      // back to one on the day before four weeks begin (0.10) and to the other on their first day (0.20).
      const oneMonth = await addType(gym, owner, "Monthly", { priceMinor: 1000, termUnit: "month" });
      const [ray, sue] = [await listed(gym, "Ray Refunded Before", "2025-03-01"), await listed(gym, "Sue Refunded On", "2025-03-01")];
      const rays = await give(gym, owner, ray, oneMonth, PAID_ONCE, true);
      const sues = await give(gym, owner, sue, oneMonth, PAID_ONCE, true);
      await refund(gym, owner, ray, rays.id, rays.paymentId, BEFORE["4w"], 10);
      await refund(gym, owner, sue, sues.id, sues.paymentId, FROM["4w"], 20);
      // A payment inside every period that was taken back the next day is not money.
      const mistake = await pay(gym, owner, payer, held.id, "2026-10-05", 12800);
      await heldService.undoMemberPayment(on("2026-10-06"), owner.userId, gym, payer, held.id, mistake);

      // Next door: one joiner, one visit and one payment, inside every period.
      await listed(next, "Their First", "2025-01-10");
      const theirs = await listed(next, "Their Joiner", "2026-10-01");
      await visit(next, nextOwner.userId, theirs, "2026-10-01");
      const theirHeld = await give(next, nextOwner, theirs, await addType(next, nextOwner, "Annual", {}), "2026-10-01", false);
      await pay(next, nextOwner, theirs, theirHeld.id, "2026-10-01", 5000);

      const yearlyFrom = (from: string) => DAYS.reduce((sum, day, i) => (day >= from ? sum + 100 * 2 ** i : sum), 0);
      const onceFrom = (from: string) => (PAID_ONCE >= from ? 2000 : 0);
      const paidFrom = (from: string) => yearlyFrom(from) + onceFrom(from);
      const visitsFrom = (from: string) => [...visitsOn].reduce((sum, [day, n]) => (day >= from ? sum + n : sum), 0);
      const daysFrom = (from: string) => DAYS.filter((day) => day >= from).length;

      for (const key of REPORT_PERIODS) {
        const from = FROM[key];
        const period = { key, from, to: TODAY };
        const members = await membersOf(gym, owner, key);
        const attendance = await attendanceOf(gym, owner, key);
        const money = await moneyOf(gym, owner, key);

        // The three parts of the page name the same days.
        expect([members.period, attendance.period, money.period], key).toEqual([period, period, period]);

        // Members: one joiner and one leaver for each of the days from the first on.
        expect(members.inPeriod, key).toEqual({ joined: daysFrom(from), joinedFrom: from, left: daysFrom(from) });
        expect(members.months[0]?.month, key).toBe(from.slice(0, 7));
        expect(members.months.at(-1)?.month, key).toBe("2026-10");
        const stayed = DAYS.filter((day) => day >= from).map((day) => daysBetween("2025-02-01", day));
        expect(members.averageStay, key).toEqual({ state: "ok", days: Math.round(stayed.reduce((a, b) => a + b, 0) / stayed.length), leavers: stayed.length });
        // Who is a member today does not move with the period: 1 + 7 joiners + 32 regulars + the three who pay.
        expect(members.activeNow, key).toBe(43);

        // Attendance: the visits of those days, and the first day shown is the period's own.
        expect(attendance.inPeriod, key).toEqual({ visits: visitsFrom(from), people: 32 });
        expect(attendance.days[0], key).toEqual({ day: from, visits: visitsOn.get(from) });
        expect(attendance.days.at(-1), key).toEqual({ day: TODAY, visits: 3 });
        expect(attendance.days, key).toHaveLength(daysBetween(from, TODAY) + 1);
        expect(attendance.weeks.reduce((sum, w) => sum + w.visits, 0), key).toBe(visitsFrom(from));
        expect(attendance.weeks[0]?.weekStart, key).toBe(from);
        // Classes that have started, from the first day on: today's has not.
        expect(attendance.classes, key).toMatchObject({ state: "ok", from, classes: daysFrom(from) - 1 });

        // Money: the payments of those days, less the refunds of those days.
        const refunded = key === "4w" ? 20 : 30;
        expect(money.inPeriod, key).toEqual({ paidMinor: paidFrom(from), refundedMinor: refunded, netMinor: paidFrom(from) - refunded });
        expect(money.months[0]?.month, key).toBe(from.slice(0, 7));
        expect(money.types, key).toEqual([
          { name: "Annual", inUse: 1, monthlyMinor: 8333, monthNetMinor: 6400, periodNetMinor: yearlyFrom(from) },
          { name: "Monthly", inUse: 2, monthlyMinor: 2000, monthNetMinor: 0, periodNetMinor: onceFrom(from) - refunded },
        ]);
      }

      // The sums, said once as numbers, so a fault in the test's own arithmetic shows.
      expect((await moneyOf(gym, owner, "4w")).inPeriod.netMinor).toBe(3200 + 6400 - 20);
      expect((await moneyOf(gym, owner, "3m")).inPeriod.netMinor).toBe(800 + 1600 + 3200 + 6400 + 2000 - 30);
      expect((await moneyOf(gym, owner, "12m")).inPeriod.netMinor).toBe(200 + 400 + 800 + 1600 + 3200 + 6400 + 2000 - 30);
      expect((await attendanceOf(gym, owner, "4w")).inPeriod.visits).toBe(35);
      expect((await attendanceOf(gym, owner, "12m")).inPeriod.visits).toBe(65);

      // Four weeks list whole months, each its own figure: September holds the day before too.
      const fourWeeks = await moneyOf(gym, owner, "4w");
      expect(fourWeeks.months).toEqual([
        { month: "2026-09", paidMinor: 1600 + 3200, refundedMinor: 30, netMinor: 4770 },
        { month: "2026-10", paidMinor: 6400, refundedMinor: 0, netMinor: 6400 },
      ]);

      // What is true today is the same under every period.
      const still = async (key: ReportPeriodKey) => {
        const [m, a, y] = [await membersOf(gym, owner, key), await attendanceOf(gym, owner, key), await moneyOf(gym, owner, key)];
        return [m.activeNow, m.churn, m.retention, m.churnMonths, a.firstVisitOn, a.fullWeeks, y.recurring, y.owed, y.lifetimeValue, y.thisMonth];
      };
      expect(await still("4w")).toEqual(await still("12m"));
      expect(await still("3m")).toEqual(await still("12m"));

      // A read that names no period is twelve months.
      expect(await membersOf(gym, owner, null)).toEqual(await membersOf(gym, owner, "12m"));
      expect(await attendanceOf(gym, owner, null)).toEqual(await attendanceOf(gym, owner, "12m"));
      expect(await moneyOf(gym, owner, null)).toEqual(await moneyOf(gym, owner, "12m"));

      // Next door reads its own under every period, and none of this gym's.
      for (const key of REPORT_PERIODS) {
        expect((await membersOf(next, nextOwner, key)).inPeriod, key).toEqual({ joined: 1, joinedFrom: FROM[key], left: 0 });
        expect((await attendanceOf(next, nextOwner, key)).inPeriod, key).toEqual({ visits: 1, people: 1 });
        expect((await moneyOf(next, nextOwner, key)).inPeriod, key).toEqual({ paidMinor: 5000, refundedMinor: 0, netMinor: 5000 });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a period is one of the three choices; anything else is refused, and so is anybody who may not read, whatever period they name",
    async () => {
      const owner = await makeUser("own2");
      const gym = await makeGym(owner, "Rep Period Refusals");
      const stranger = await makeUser("stranger");
      const trainer = await makeUser("trainer");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym}, ${trainer.userId}, 'trainer', ${["reports.read"]})`;
      const desk = await makeUser("desk");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym}, ${desk.userId}, 'trainer', ${["billing.members"]})`;

      for (const part of ["members", "attendance", "money"]) {
        const at = `/v1/orgs/${gym}/reports/${part}`;
        for (const bad of ["?period=1y", "?period=", "?period=12M", "?period=4w&period=12m", "?period=12m&from=2020-01-01", "?from=2020-01-01"]) {
          const res = await get(`${at}${bad}`, owner.cookies);
          expect(res.statusCode, `${part} ${bad}`).toBe(400);
          // The refusal names the field and the fault, never what was sent.
          const said = (JSON.parse(res.body) as { message: string }).message;
          expect(said, `${part} ${bad}`).toMatch(/^(period: invalid_enum_value|period: invalid_type|: unrecognized_keys)$/);
        }
        for (const key of REPORT_PERIODS) {
          expect((await get(`${at}?period=${key}`)).statusCode, `${part} ${key} nobody`).toBe(401);
          expect((await get(`${at}?period=${key}`, stranger.cookies)).statusCode, `${part} ${key} stranger`).toBe(404);
          expect((await get(`${at}?period=${key}`, desk.cookies)).statusCode, `${part} ${key} no tick`).toBe(403);
          // Reports alone reads members and attendance, and never money.
          expect((await get(`${at}?period=${key}`, trainer.cookies)).statusCode, `${part} ${key} reports only`).toBe(part === "money" ? 403 : 200);
          expect((await get(`${at}?period=${key}`, owner.cookies)).statusCode, `${part} ${key} owner`).toBe(200);
        }
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a gym younger than the period is shown from its own first day, and what it has no history for is said, never a zero",
    async () => {
      const owner = await makeUser("own3");
      const gym = await makeGym(owner, "Rep Period New Gym");
      // Opened three weeks ago: a list from 29 September, check-ins from 1 October.
      const a = await listed(gym, "Ada Early", "2026-09-29");
      const b = await listed(gym, "Bo Later", "2026-10-06");
      await visit(gym, owner.userId, a, "2026-10-01");
      await visit(gym, owner.userId, b, "2026-10-07");

      for (const key of REPORT_PERIODS) {
        const members = await membersOf(gym, owner, key);
        // September is the list's first month, whose people are not new; October's one is.
        expect(members.months.map((m) => [m.month, m.joined]), key).toEqual([
          ["2026-09", null],
          ["2026-10", 1],
        ]);
        expect(members.inPeriod, key).toEqual({ joined: 1, joinedFrom: "2026-10-01", left: 0 });
        expect([members.churn, members.retention, members.averageStay], key).toEqual([{ state: "nobody_left" }, { state: "nobody_left" }, { state: "nobody_left" }]);

        const attendance = await attendanceOf(gym, owner, key);
        expect(attendance.days[0], key).toEqual({ day: "2026-10-01", visits: 1 });
        expect(attendance.days, key).toHaveLength(20);
        expect(attendance.inPeriod, key).toEqual({ visits: 2, people: 2 });
        expect(attendance.classes, key).toEqual({ state: "none_ever" });

        const money = await get(`/v1/orgs/${gym}/reports/money?period=${key}`, owner.cookies);
        expect(moneyReportResponseSchema.parse(JSON.parse(money.body)).report, key).toEqual({ state: "no_memberships", timezone: "Europe/London", today: TODAY });
      }
      // Two whole weeks of check-ins are behind it (5 and 12 October): enough for a busiest time in every period.
      expect((await attendanceOf(gym, owner, "4w")).hours).toMatchObject({ state: "ok", from: "2026-10-05", to: "2026-10-18", weeks: 2 });
      expect((await attendanceOf(gym, owner, "12m")).hours).toMatchObject({ state: "ok", from: "2026-10-05", to: "2026-10-18", weeks: 2 });
    },
    TEST_TIMEOUT_MS,
  );
});
