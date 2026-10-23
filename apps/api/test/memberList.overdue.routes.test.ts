// THE MEMBERS LIST SAYS OVERDUE — the routes against real Postgres (DATABASE_URL-gated).
// ROADMAP Stage 2 item 17i-ii; spec Part 3 §13.4.
//
// The worst thing this job could do to a real person: show a member who has paid, or whose
// payment is not late yet by the gym's own days of grace, or who is not the one who owes, as
// "Overdue" in red, so staff chase them for nothing. That is the first test.
//
// Bills are rows of the gym's own bills table, as the hourly run opens them; the clock is the
// test's own.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { MemberListEntriesPage, MemberListEntryDetail } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "member-list-overdue-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 180_000;
const LIVE_PLAN = "zz_mlod_live";
/** Wednesday 7 October 2026, 07:30 in London. */
const NOW = new Date("2026-10-07T06:30:00Z");
/** The gym's days of grace before an unpaid bill reads Overdue. */
const GRACE = 3;

let ipCounter = 0;
const nextIp = () => `10.84.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("the Members list says Overdue (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const clock = NOW.getTime();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'mlod-t-%@example.com')`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_member_payments WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_bills WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'mlod-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const ok = (res: { statusCode: number; body: string }): unknown => {
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body);
  };

  interface Person {
    userId: string;
    cookies: Cookies;
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `mlod-t-${uniq()}@example.com`;
    const reg = await inject("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await inject("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  interface Gym {
    id: string;
    owner: Person;
    gold: string;
  }
  const makeGym = async (name: string): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Leeds", country: "GB", timezone: "Europe/London" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    await sql`UPDATE gyms SET bills_overdue_days = ${GRACE} WHERE id = ${id}`;
    const [gold] = await sql<{ id: string }[]>`
      INSERT INTO gym_membership_types (gym_id, name, kind, price_minor, currency, term_count, term_unit, access, covers_all_classes)
      VALUES (${id}, 'Gold Monthly', 'recurring', 4000, 'GBP', 1, 'month', 'all_classes', true) RETURNING id`;
    if (gold === undefined) throw new Error("no type");
    return { id, owner, gold: gold.id };
  };
  const record = async (gym: Gym, name: string, email = `mlod-l-${uniq()}@example.com`): Promise<string> => {
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName: name, email });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };
  /** Gold Monthly from 1 October, its first month paid. */
  const hold = async (gym: Gym, entryId: string): Promise<string> => {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_held_memberships
        (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit,
         starts_on, status, renews, paid_periods)
      VALUES (${gym.id}, ${entryId}, ${gym.gold}, gen_random_uuid(), 'recurring', 4000, 'GBP', 1, 'month',
              '2026-10-01'::date, 'active', true, 1)
      RETURNING id`;
    if (row === undefined) throw new Error("no membership");
    return row.id;
  };
  /** An unpaid bill on a membership, due on `dueOn`. */
  const owes = async (gym: Gym, heldId: string, dueOn: string): Promise<void> => {
    await sql`UPDATE gym_held_memberships SET paid_periods = 0 WHERE id = ${heldId}`;
    await sql`
      INSERT INTO gym_member_bills (gym_id, held_membership_id, period_index, amount_minor, currency, due_on, covers_from, covers_to)
      VALUES (${gym.id}, ${heldId}, 0, 4000, 'GBP', ${dueOn}::date, ${dueOn}::date, (${dueOn}::date + interval '1 month' - interval '1 day')::date)`;
  };
  const staffWith = async (gym: Gym, name: string, privileges: string[]): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${person.userId}, 'trainer', ${privileges})`;
    return person;
  };
  /** Each person on a page of the list: [Payment word as the row reads it, overdue]. */
  const listOf = async (gym: Gym, who: Person, records: "current" | "former" = "current"): Promise<Record<string, [string | null, boolean]>> => {
    const page = (ok(await inject("GET", `/v1/orgs/${gym.id}/member-list/entries?records=${records}`, who.cookies)) as { page: MemberListEntriesPage }).page;
    return Object.fromEntries(
      page.entries.map((e) => [e.fullName, [e.held?.payment?.state ?? (e.owedSince === null ? null : "due"), e.overdue] as [string | null, boolean]]),
    );
  };
  const exportOf = async (gym: Gym, who: Person, entryIds: string[]): Promise<string> => {
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/export.csv`, who.cookies, { selection: { kind: "ticked", entryIds } });
    expect(res.statusCode, res.body).toBe(200);
    return res.body;
  };
  const csvPayment = (csv: string, name: string): string | undefined => {
    const lines = csv.replace(/^﻿/, "").split("\r\n");
    const cells = (line: string): string[] => line.split(",").map((cell) => cell.replace(/^"|"$/g, ""));
    const head = cells(lines[0] ?? "");
    const at = head.indexOf("Payment status");
    const line = lines.find((l) => l.startsWith(`"${name}",`));
    return line === undefined ? undefined : cells(line)[at];
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), { redis: createMemoryRedis(), orgs: { now: () => new Date(clock) } });
    await api().ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it("THE WORST THING: only the person whose own oldest bill reads Overdue is said to be Overdue", async () => {
    const gym = await makeGym("Worst Thing Gym");
    const email = `mlod-family-${uniq()}@example.com`;
    // Paid up, at the same address as her son, whose bill is 6 days late.
    const priya = await record(gym, "Priya Sharma", email);
    await hold(gym, priya);
    const aarav = await record(gym, "Aarav Sharma", email);
    await owes(gym, await hold(gym, aarav), "2026-10-01");
    // Due 2 days ago, and on the last of the gym's 3 days of grace: neither is Overdue yet.
    const dev = await record(gym, "Dev Patel");
    await owes(gym, await hold(gym, dev), "2026-10-05");
    const lee = await record(gym, "Lee Chan");
    await owes(gym, await hold(gym, lee), "2026-10-04");
    // Due today.
    const tom = await record(gym, "Tom Reid");
    await owes(gym, await hold(gym, tom), "2026-10-07");
    // 4 days late, one more than the gym's grace.
    const ana = await record(gym, "Ana Lopez");
    await owes(gym, await hold(gym, ana), "2026-10-03");

    expect(await listOf(gym, gym.owner)).toEqual({
      "Priya Sharma": ["paid", false],
      "Aarav Sharma": ["due", true],
      "Dev Patel": ["due", false],
      "Lee Chan": ["due", false],
      "Tom Reid": ["due", false],
      "Ana Lopez": ["due", true],
    });

    // Paid in full, the bill is not owed and the row is not Overdue.
    await sql`UPDATE gym_member_bills SET status = 'paid' WHERE held_membership_id IN (SELECT id FROM gym_held_memberships WHERE entry_id = ${ana})`;
    await sql`UPDATE gym_held_memberships SET paid_periods = 1 WHERE entry_id = ${ana}`;
    expect((await listOf(gym, gym.owner))["Ana Lopez"]).toEqual(["paid", false]);
  });

  it("reads the gym's own days of grace", async () => {
    const gym = await makeGym("Grace Gym");
    const ana = await record(gym, "Ana Lopez");
    await owes(gym, await hold(gym, ana), "2026-10-03");
    expect((await listOf(gym, gym.owner))["Ana Lopez"]).toEqual(["due", true]);
    await sql`UPDATE gyms SET bills_overdue_days = 10 WHERE id = ${gym.id}`;
    expect((await listOf(gym, gym.owner))["Ana Lopez"]).toEqual(["due", false]);
    await sql`UPDATE gyms SET bills_overdue_days = 0 WHERE id = ${gym.id}`;
    const tom = await record(gym, "Tom Reid");
    await owes(gym, await hold(gym, tom), "2026-10-06");
    expect((await listOf(gym, gym.owner))["Tom Reid"]).toEqual(["due", true]);
  });

  it("a past member who left a bill unpaid is Overdue by the same rule", async () => {
    const gym = await makeGym("Past Gym");
    const ben = await record(gym, "Ben Okafor");
    await owes(gym, await hold(gym, ben), "2026-10-01");
    const kai = await record(gym, "Kai Tong");
    await owes(gym, await hold(gym, kai), "2026-10-06");
    await sql`UPDATE gym_held_memberships SET status = 'cancelled', cancelled_on = '2026-10-05' WHERE entry_id IN (${ben}, ${kai})`;
    await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE id IN (${ben}, ${kai})`;
    expect(await listOf(gym, gym.owner, "former")).toEqual({ "Ben Okafor": ["due", true], "Kai Tong": ["due", false] });
  });

  it("is said to staff who record members' payments, never to staff who only see the list", async () => {
    const gym = await makeGym("Staff Gym");
    const ana = await record(gym, "Ana Lopez");
    await owes(gym, await hold(gym, ana), "2026-10-01");
    const desk = await staffWith(gym, "Desk Only", ["members.confirm"]);
    const till = await staffWith(gym, "Takes Payments", ["members.confirm", "billing.members"]);

    expect((await listOf(gym, desk))["Ana Lopez"]).toEqual(["due", false]);
    expect((await listOf(gym, till))["Ana Lopez"]).toEqual(["due", true]);

    // The person's own page gives the same answer.
    const page = (who: Person) =>
      inject("GET", `/v1/orgs/${gym.id}/member-list/entries/${ana}`, who.cookies).then((res) => (ok(res) as { entry: MemberListEntryDetail }).entry.overdue);
    expect(await page(gym.owner)).toBe(true);
    expect(await page(till)).toBe(true);
    expect(await page(desk)).toBe(false);

    // And so does the download.
    expect(csvPayment(await exportOf(gym, gym.owner, [ana]), "Ana Lopez")).toBe("Overdue");
    expect(csvPayment(await exportOf(gym, desk, [ana]), "Ana Lopez")).toBe("Payment due");
  });

  it("another gym's owner reads none of it", async () => {
    const gym = await makeGym("Home Gym");
    const other = await makeGym("Other Gym");
    const ana = await record(gym, "Ana Lopez");
    await owes(gym, await hold(gym, ana), "2026-10-01");
    const list = await inject("GET", `/v1/orgs/${gym.id}/member-list/entries`, other.owner.cookies);
    expect([403, 404]).toContain(list.statusCode);
    expect(list.body).not.toContain("Ana Lopez");
    const page = await inject("GET", `/v1/orgs/${gym.id}/member-list/entries/${ana}`, other.owner.cookies);
    expect([403, 404]).toContain(page.statusCode);
    expect(page.body).not.toContain("Ana Lopez");
  });
});
