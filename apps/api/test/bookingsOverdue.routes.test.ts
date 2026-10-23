// NO NEW BOOKINGS WHILE A PAYMENT IS OVERDUE — the routes against real Postgres
// (DATABASE_URL-gated). ROADMAP Stage 2 item 17i; spec Part 3 §13.4.
//
// The worst thing this job could do to a real person: stop a member who has paid, or whose
// payment is not late yet by the gym's own days of grace, or who is not the one who owes,
// from booking their class. That is the first test: under Stop new bookings, everybody but
// the one person whose own bill reads Overdue books as before.
//
// Bills are rows of the gym's own bills table, as the hourly run opens them; the clock is the
// test's own.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  CLASS_BOOKING_WORDS,
  OVERDUE_BOOKING_WORDS,
  PT_MEMBER_WORDS,
  type ClassBookingSettingsResponse,
  type ClassBookingView,
  type HeldMembershipsResponse,
  type MemberClassesResponse,
  type MemberPtResponse,
} from "@app/shared";
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
  JWT_SECRET: "bookings-overdue-routes-secret-01234567", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 180_000;
const LIVE_PLAN = "zz_bkod_live";
/** Wednesday 7 October 2026, 07:30 in London. */
const NOW = new Date("2026-10-07T06:30:00Z");
const HOUR = 60 * 60 * 1000;
/** A Friday two days on, inside personal training's 7 days. */
const FRIDAY = "2026-10-09";
/** The gym's days of grace before an unpaid bill reads Overdue. */
const GRACE = 3;

let ipCounter = 0;
const nextIp = () => `10.83.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("no new bookings while a payment is overdue (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const clock = NOW.getTime();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'bkod-t-%@example.com')`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_member_payments WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_bills WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_bookings WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_pt_appointments WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_trainers WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'bkod-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST" | "PUT", path: string, cookies: Cookies, payload?: unknown) =>
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
  const said = (res: { statusCode: number; body: string }): [number, string, string] => {
    const body = JSON.parse(res.body) as { error: string; message: string };
    return [res.statusCode, body.error, body.message];
  };

  interface Person {
    userId: string;
    cookies: Cookies;
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `bkod-t-${uniq()}@example.com`;
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
    ptPack: string;
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
    const [pt] = await sql<{ id: string }[]>`
      INSERT INTO gym_membership_types (gym_id, name, kind, price_minor, currency, pack_classes, pack_days, access, covers_all_classes, includes_pt)
      VALUES (${id}, 'PT 10', 'pack', 30000, 'GBP', 10, 60, 'all_classes', true, true) RETURNING id`;
    if (gold === undefined || pt === undefined) throw new Error("no types");
    return { id, owner, gold: gold.id, ptPack: pt.id };
  };
  /** A record on the gym's list; `email` shares an address with another record. */
  const record = async (gym: Gym, name: string, email = `bkod-l-${uniq()}@example.com`): Promise<string> => {
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName: name, email });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };
  type Member = Person & { entryId: string; gold: string };
  /** An app member on their own record, holding Gold Monthly from 1 October. */
  const member = async (gym: Gym, name: string, entryId?: string): Promise<Member> => {
    const person = await signedIn(name);
    const entry = entryId ?? (await record(gym, name));
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at, entry_id) VALUES (${gym.id}, ${person.userId}, '2026-01-01T00:00:00Z', ${entry})`;
    return { ...person, entryId: entry, gold: await hold(gym, entry, gym.gold) };
  };
  const hold = async (gym: Gym, entryId: string, typeId: string, pack = false): Promise<string> => {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_held_memberships
        (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, pack_classes, pack_days,
         classes_left, starts_on, status, renews, paid_periods)
      VALUES (${gym.id}, ${entryId}, ${typeId}, gen_random_uuid(), ${pack ? "pack" : "recurring"}, 4000, 'GBP', ${pack ? null : 1}, ${pack ? null : "month"},
              ${pack ? 10 : null}, ${pack ? 60 : null}, ${pack ? 10 : null}, '2026-10-01'::date, 'active', ${!pack}, 1)
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
  const classAt = async (gym: Gym, hours: number, places: number): Promise<string> => {
    const [type] = await sql<{ id: string }[]>`
      INSERT INTO gym_class_types (gym_id, name, minutes, places, colour, open_gym)
      VALUES (${gym.id}, ${`Spin ${uniq()}`}, 45, ${places}, 'blue', false) RETURNING id`;
    if (type === undefined) throw new Error("no class type");
    const startsAt = new Date(clock + hours * HOUR);
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places, status)
      SELECT ${gym.id}, ${type.id}, l::date, (EXTRACT(HOUR FROM l) * 60 + EXTRACT(MINUTE FROM l))::int, ${startsAt}, 45, ${places}, 'scheduled'
      FROM (SELECT ${startsAt}::timestamptz AT TIME ZONE 'Europe/London' AS l) x
      RETURNING id`;
    if (row === undefined) throw new Error("no class");
    return row.id;
  };
  const bookingUrl = (gym: Gym, sessionId: string) => `/v1/orgs/${gym.id}/class-sessions/${sessionId}/booking`;
  const book = (gym: Gym, who: Person, sessionId: string, joinWaitlist = false) =>
    inject("POST", bookingUrl(gym, sessionId), who.cookies, { requestKey: randomUUID(), joinWaitlist });
  const seen = async (gym: Gym, who: Person, sessionId: string): Promise<ClassBookingView> =>
    (ok(await inject("GET", bookingUrl(gym, sessionId), who.cookies)) as { booking: ClassBookingView }).booking;
  const statusOf = async (sessionId: string, who: Person): Promise<string | null> => {
    const [row] = await sql<{ status: string }[]>`
      SELECT status FROM gym_class_bookings WHERE session_id = ${sessionId} AND user_id = ${who.userId} ORDER BY seq DESC LIMIT 1`;
    return row?.status ?? null;
  };
  const settingsOf = async (gym: Gym, who: Person): Promise<ClassBookingSettingsResponse> =>
    ok(await inject("GET", `/v1/orgs/${gym.id}/booking-settings`, who.cookies)) as ClassBookingSettingsResponse;
  const setOverdue = async (gym: Gym, who: Person, overdue: "let_book" | "stop") => {
    const now = await settingsOf(gym, gym.owner);
    return await inject("PUT", `/v1/orgs/${gym.id}/booking-settings`, who.cookies, { ...now.settings, pt: now.pt, overdue });
  };
  const staffWith = async (gym: Gym, name: string, privileges: string[]): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${person.userId}, 'trainer', ${privileges})`;
    return person;
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

  it("THE WORST THING: under Stop new bookings, only the person whose own bill reads Overdue is stopped", async () => {
    const gym = await makeGym("Worst Thing Gym");
    // Paid up.
    const priya = await member(gym, "Priya Sharma");
    // Her son, on a record of his own at her address, whose bill is 6 days late.
    const aarav = await record(gym, "Aarav Sharma", `bkod-family-${uniq()}@example.com`);
    await owes(gym, await hold(gym, aarav, gym.gold), "2026-10-01");
    await sql`UPDATE gym_member_list_entries SET email = (SELECT email FROM gym_member_list_entries WHERE id = ${aarav}) WHERE id = ${priya.entryId}`;
    // Due 2 days ago, and on the last of the gym's 3 days of grace: neither is Overdue yet.
    const dev = await member(gym, "Dev Patel");
    await owes(gym, dev.gold, "2026-10-05");
    const lee = await member(gym, "Lee Chan");
    await owes(gym, lee.gold, "2026-10-04");
    // A coach who trains here too, 6 days late: staff are never stopped, as at the desk.
    const kim = await member(gym, "Kim Coach");
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${kim.userId}, 'trainer', ${null})`;
    await owes(gym, kim.gold, "2026-10-01");
    // 4 days late, one more than the gym's grace.
    const ana = await member(gym, "Ana Lopez");
    await owes(gym, ana.gold, "2026-10-02");

    expect((await setOverdue(gym, gym.owner, "stop")).statusCode).toBe(200);
    const spin = await classAt(gym, 48, 10);
    for (const who of [priya, dev, lee, kim]) {
      expect((await book(gym, who, spin)).statusCode).toBe(200);
      expect(await statusOf(spin, who)).toBe("booked");
    }
    const refused = await book(gym, ana, spin);
    expect(said(refused)).toEqual([403, "payment_overdue", OVERDUE_BOOKING_WORDS]);
    expect(await statusOf(spin, ana)).toBeNull();
    expect(CLASS_BOOKING_WORDS.payment_overdue).toBe("Your payment is overdue. Please pay at the front desk to book.");
  });

  it("every gym starts letting everybody book, and the switch changes only new bookings", async () => {
    const gym = await makeGym("Starts Open Gym");
    expect((await settingsOf(gym, gym.owner)).overdue.rule).toBe("let_book");
    const ana = await member(gym, "Ana Lopez");
    await owes(gym, ana.gold, "2026-09-20");
    const first = await classAt(gym, 30, 10);
    const second = await classAt(gym, 50, 10);
    expect((await book(gym, ana, first)).statusCode).toBe(200);
    // Switched on: the class she holds stays hers and she can cancel it; a new one is refused.
    expect((await setOverdue(gym, gym.owner, "stop")).statusCode).toBe(200);
    const view = await seen(gym, ana, second);
    expect(view.can).toMatchObject({ book: false, joinWaitlist: false, claim: false, why: "payment_overdue" });
    expect((await seen(gym, ana, first)).mine?.status).toBe("booked");
    expect((await book(gym, ana, second)).statusCode).toBe(403);
    const list = ok(await inject("GET", `/v1/orgs/${gym.id}/member-classes?week=0`, ana.cookies)) as MemberClassesResponse;
    expect(list.classes.find((c) => c.sessionId === second)?.can.why).toBe("payment_overdue");
    expect(list.classes.find((c) => c.sessionId === first)?.mine?.status).toBe("booked");
    expect((await inject("POST", `${bookingUrl(gym, first)}/cancel`, ana.cookies, { lateOk: false })).statusCode).toBe(200);
    expect(await statusOf(first, ana)).toBe("cancelled");
    // She pays at the desk: she books again at once.
    const pay = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries/${ana.entryId}/memberships/${ana.gold}/payments`, gym.owner.cookies, {
      requestKey: randomUUID(),
      periodIndex: 0,
      amountMinor: 4000,
      method: "cash",
    });
    expect(pay.statusCode, pay.body).toBe(200);
    expect((await book(gym, ana, second)).statusCode).toBe(200);
    // Switched off again: nobody is stopped.
    const ben = await member(gym, "Ben Owes");
    await owes(gym, ben.gold, "2026-09-20");
    expect((await setOverdue(gym, gym.owner, "let_book")).statusCode).toBe(200);
    expect((await book(gym, ben, second)).statusCode).toBe(200);
  });

  it("a waitlist: an overdue person joins none, keeps the place in line they had, and is passed over for a freed place", async () => {
    const gym = await makeGym("Waitlist Gym");
    const priya = await member(gym, "Priya Sharma");
    const ana = await member(gym, "Ana Lopez");
    const dev = await member(gym, "Dev Patel");
    const ben = await member(gym, "Ben Owes");
    const full = await classAt(gym, 48, 1);
    expect((await book(gym, priya, full)).statusCode).toBe(200);
    // Ana joins the line before she owes anything, then Dev.
    expect((await book(gym, ana, full, true)).statusCode).toBe(200);
    expect((await book(gym, dev, full, true)).statusCode).toBe(200);
    await owes(gym, ana.gold, "2026-10-01");
    await owes(gym, ben.gold, "2026-10-01");
    expect((await setOverdue(gym, gym.owner, "stop")).statusCode).toBe(200);
    expect(said(await book(gym, ben, full, true))).toEqual([403, "payment_overdue", OVERDUE_BOOKING_WORDS]);
    // Ana is still waiting, first in line; pressing again changes nothing.
    expect((await seen(gym, ana, full)).mine).toMatchObject({ status: "waitlisted", waitlistPlace: 1 });
    // Priya cancels: the freed place goes past Ana to Dev, and Ana keeps her place.
    expect((await inject("POST", `${bookingUrl(gym, full)}/cancel`, priya.cookies, { lateOk: false })).statusCode).toBe(200);
    expect(await statusOf(full, dev)).toBe("booked");
    expect(await statusOf(full, ana)).toBe("waitlisted");
    expect(await statusOf(full, ben)).toBeNull();
  });

  it("personal training: a member's own booking is refused and every day says why; staff still book for them", async () => {
    const gym = await makeGym("PT Gym");
    const sam = await staffWith(gym, "Sam Trainer", ["members.read"]);
    const hours = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, fromMinute: 540, toMinute: 780 }));
    expect((await inject("PUT", `/v1/orgs/${gym.id}/pt/trainers/${sam.userId}`, gym.owner.cookies, { offers: true, sessionMinutes: 60, hours })).statusCode).toBe(200);
    const ana = await member(gym, "Ana Lopez");
    await hold(gym, ana.entryId, gym.ptPack, true);
    await owes(gym, ana.gold, "2026-10-01");
    const dev = await member(gym, "Dev Patel");
    await hold(gym, dev.entryId, gym.ptPack, true);
    expect((await setOverdue(gym, gym.owner, "stop")).statusCode).toBe(200);

    const mine = ok(await inject("GET", `/v1/orgs/${gym.id}/member-pt?week=0`, ana.cookies)) as MemberPtResponse;
    expect(mine.days.every((day) => day.why === "payment_overdue" && day.pays === null)).toBe(true);
    expect(PT_MEMBER_WORDS.payment_overdue).toBe(OVERDUE_BOOKING_WORDS);
    const session = { trainerId: sam.userId, localDate: FRIDAY, startMinute: 600, minutes: 60 };
    expect(said(await inject("POST", `/v1/orgs/${gym.id}/member-pt/sessions`, ana.cookies, { requestKey: randomUUID(), ...session }))).toEqual([
      403,
      "payment_overdue",
      OVERDUE_BOOKING_WORDS,
    ]);
    const theirs = ok(await inject("GET", `/v1/orgs/${gym.id}/member-pt?week=0`, dev.cookies)) as MemberPtResponse;
    expect(theirs.days.some((day) => day.why === "payment_overdue")).toBe(false);
    expect((await inject("POST", `/v1/orgs/${gym.id}/member-pt/sessions`, dev.cookies, { requestKey: randomUUID(), ...session })).statusCode).toBe(200);
    // The owner books Ana a session at 11:00 at the desk.
    const desk = await inject("POST", `/v1/orgs/${gym.id}/pt/appointments`, gym.owner.cookies, { requestKey: randomUUID(), ...session, startMinute: 660, entryId: ana.entryId });
    expect(desk.statusCode, desk.body).toBe(200);
  });

  it("Booking settings: who owes today by name for staff who take payments, the switch only theirs, and another gym gets nothing", async () => {
    const gym = await makeGym("Settings Gym");
    const ana = await member(gym, "Ana Lopez");
    await owes(gym, ana.gold, "2026-10-01");
    const dev = await member(gym, "Dev Patel");
    await owes(gym, dev.gold, "2026-10-05");
    const kim = await member(gym, "Kim Coach");
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${kim.userId}, 'trainer', ${null})`;
    await owes(gym, kim.gold, "2026-10-01");
    const gone = await member(gym, "Gone Member");
    await owes(gym, gone.gold, "2026-10-01");
    await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE id = ${gone.entryId}`;

    const owner = await settingsOf(gym, gym.owner);
    expect(owner.overdue).toEqual({ rule: "let_book", afterDays: GRACE, stopped: { count: 1, people: [{ entryId: ana.entryId, name: "Ana Lopez" }] } });

    // A manager of the timetable who does not take payments: no names, and the switch is not theirs.
    const planner = await staffWith(gym, "Pat Planner", ["members.read", "schedule.manage"]);
    expect((await settingsOf(gym, planner)).overdue).toEqual({ rule: "let_book", afterDays: GRACE, stopped: null });
    const refused = await setOverdue(gym, planner, "stop");
    expect(refused.statusCode).toBe(403);
    expect((await settingsOf(gym, gym.owner)).overdue.rule).toBe("let_book");
    // Their save of the other settings is not refused for leaving it as it is.
    expect((await setOverdue(gym, planner, "let_book")).statusCode).toBe(200);

    const saved = await setOverdue(gym, gym.owner, "stop");
    expect((ok(saved) as ClassBookingSettingsResponse).overdue.rule).toBe("stop");
    const audit = await sql<{ meta: Record<string, string> }[]>`
      SELECT meta FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.booking_settings_changed' ORDER BY at DESC, id DESC LIMIT 1`;
    expect(audit[0]?.meta).toEqual({ overdue: "let_book -> stop" });

    // The person's page says it beside Ana's bill, and not beside Dev's or the coach's.
    const page = async (entryId: string) =>
      (ok(await inject("GET", `/v1/orgs/${gym.id}/member-list/entries/${entryId}/memberships`, gym.owner.cookies)) as HeldMembershipsResponse).bookingsStopped;
    expect(await page(ana.entryId)).toBe(true);
    expect(await page(dev.entryId)).toBe(false);
    expect(await page(kim.entryId)).toBe(false);

    // Another gym's owner reads and changes nothing here.
    const other = await makeGym("Other Gym");
    const read = await inject("GET", `/v1/orgs/${gym.id}/booking-settings`, other.owner.cookies);
    expect([403, 404]).toContain(read.statusCode);
    expect(read.body).not.toContain("Ana Lopez");
    expect([403, 404]).toContain((await setOverdue(gym, other.owner, "let_book")).statusCode);
    expect((await settingsOf(gym, gym.owner)).overdue.rule).toBe("stop");
    // A value that is not one of the two is refused.
    const now = await settingsOf(gym, gym.owner);
    expect((await inject("PUT", `/v1/orgs/${gym.id}/booking-settings`, gym.owner.cookies, { ...now.settings, pt: now.pt, overdue: "see_staff" })).statusCode).toBe(400);
  });
});
