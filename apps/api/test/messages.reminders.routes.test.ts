// THE CLASS REMINDER — against real Postgres, with classes booked, cancelled, waited for,
// moved and taken off by the real routes (spec Part 3 §16.2; ROADMAP 20b-iii).
// DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: remind somebody of a class they
// cancelled, were only on the waitlist for, or that the gym cancelled or moved, remind
// somebody the gym removed, or remind anybody twice. That is the first test below.
//
// The booking routes, the settings and the sender share one clock here (`clock`).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { GYM_MESSAGE_SETTING_KINDS, type GymInboxResponse, type GymMessageSettingsRequest, type GymMessageSettingsResponse } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { sendDueMessages } from "../src/modules/orgs/messages/send.js";
import { createMemoryRedis } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "gym-msg-reminders-test-secret-01234567", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 180_000;
const LIVE_PLAN = "zz_msg_reminders_live";
/** Wednesday 7 October 2026 in London: summer time, one hour ahead of UTC. */
const TODAY = "2026-10-07";
const TOMORROW = "2026-10-08";
const YESTERDAY = "2026-10-06";
/** That minute of the day on the gym's clock, as an instant. */
const at = (day: string, hour: number, minute = 0): Date => new Date(new Date(`${day}T00:00:00Z`).getTime() + ((hour - 1) * 60 + minute) * 60_000);

let ipCounter = 0;
const nextIp = () => `10.93.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("the class reminder (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  let clock = at(TODAY, 9);

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'msgr-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'msgr-t-%@example.com'`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_member_messages WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_messages_off WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_message_settings WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_message_days WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_pt_appointments WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_trainers WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_bookings WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM user_fitness_profiles WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM refresh_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM consent_log WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM users WHERE email LIKE 'msgr-t-%@example.com'`;
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

  interface Person {
    userId: string;
    cookies: Cookies;
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `msgr-t-${uniq()}@example.com`;
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
    name: string;
    owner: Person;
  }
  /** A gym in London on a plan, with no price list: anybody in its app can book. */
  const makeGym = async (name: string): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Leeds", country: "GB", timezone: "Europe/London" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return { id, name, owner };
  };
  const record = async (gym: Gym, fullName: string): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source)
      VALUES (${gym.id}, ${fullName}, ${`msgr-r-${uniq()}@example.com`}, encode(sha256(${`msgr-${uniq()}`}::bytea), 'hex'), 'typed')
      RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no record");
    return id;
  };
  interface Member extends Person {
    entryId: string;
  }
  /** Somebody on the gym's list and in its app since January. `entryId`: a record somebody else holds too. */
  const member = async (gym: Gym, name: string, entryId?: string): Promise<Member> => {
    const person = await signedIn(name);
    const entry = entryId ?? (await record(gym, name));
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at) VALUES (${gym.id}, ${person.userId}, ${entry}, '2026-01-01T00:00:00Z')`;
    return { ...person, entryId: entry };
  };

  /** A class on the gym's calendar, starting at that time on its clock. */
  const classAt = async (gym: Gym, name: string, day: string, hour: number, minute = 0, places: number | null = null): Promise<string> => {
    const [type] = await sql<{ id: string }[]>`
      INSERT INTO gym_class_types (gym_id, name, minutes, places, colour) VALUES (${gym.id}, ${name}, 45, ${places}, 'blue') RETURNING id`;
    if (type === undefined) throw new Error("no class type");
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places, status)
      VALUES (${gym.id}, ${type.id}, ${day}::date, ${hour * 60 + minute}, ${at(day, hour, minute)}, 45, ${places}, 'scheduled')
      RETURNING id`;
    if (row === undefined) throw new Error("no class");
    return row.id;
  };
  const bookingUrl = (gym: Gym, sessionId: string) => `/v1/orgs/${gym.id}/class-sessions/${sessionId}/booking`;
  const book = async (gym: Gym, who: Person, sessionId: string, wants: "booked" | "waitlisted" = "booked"): Promise<string> => {
    const res = await inject("POST", bookingUrl(gym, sessionId), who.cookies, { requestKey: randomUUID(), joinWaitlist: wants === "waitlisted" });
    expect(res.statusCode, res.body).toBe(200);
    const rows = await sql<{ id: string; status: string }[]>`
      SELECT id, status FROM gym_class_bookings WHERE session_id = ${sessionId} AND user_id = ${who.userId} ORDER BY seq DESC LIMIT 1`;
    expect(rows[0]?.status).toBe(wants);
    return rows[0]?.id ?? "";
  };
  /** A change staff make that asks first when people are booked: sent again with its mark. */
  const confirmed = async (send: (confirmBookings?: string) => Promise<{ statusCode: number; body: string }>): Promise<void> => {
    const first = await send();
    if (first.statusCode === 200) return;
    expect(first.statusCode, first.body).toBe(409);
    const mark = (JSON.parse(first.body) as { ending: { mark: string } }).ending.mark;
    const second = await send(mark);
    expect(second.statusCode, second.body).toBe(200);
  };

  /** 09:00 to 20:00 every day, in sessions of an hour. */
  const ALL_DAY = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, fromMinute: 540, toMinute: 1200 }));
  const trainerWith = async (gym: Gym, name: string): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${person.userId}, 'trainer', ${null})`;
    const res = await inject("PUT", `/v1/orgs/${gym.id}/pt/trainers/${person.userId}`, gym.owner.cookies, { offers: true, sessionMinutes: 60, hours: ALL_DAY });
    expect(res.statusCode, res.body).toBe(200);
    return person;
  };
  /** A session booked by the member's own route. Answers its id. */
  const bookSession = async (gym: Gym, who: Person, trainer: Person, hour: number): Promise<string> => {
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-pt/sessions`, who.cookies, { requestKey: randomUUID(), trainerId: trainer.userId, localDate: TODAY, startMinute: hour * 60, minutes: 60 });
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { session: { id: string } }).session.id;
  };

  const log = { info: () => undefined, error: () => undefined };
  const run = async (gyms: readonly Gym[], when: Date) => {
    clock = when;
    return await sendDueMessages({ sql, log }, { now: when, gymIds: gyms.map((g) => g.id) });
  };
  const sentBy = async (gym: Gym): Promise<{ user_id: string; kind: string; occasion: string; body: string }[]> =>
    await sql`SELECT user_id, kind, occasion, body FROM gym_member_messages WHERE gym_id = ${gym.id} ORDER BY sent_at, body`;
  /** Who was sent what by the gym, by the names given here. */
  const got = async (gym: Gym, people: Record<string, Person>): Promise<string[]> => {
    const nameOf = new Map(Object.entries(people).map(([name, p]) => [p.userId, name]));
    return (await sentBy(gym)).map((row) => `${nameOf.get(row.user_id) ?? row.user_id}: ${row.body}`).sort();
  };

  const settingsPath = (gym: Gym) => `/v1/orgs/${gym.id}/message-settings`;
  const START: GymMessageSettingsRequest = {
    messages: GYM_MESSAGE_SETTING_KINDS.map((kind) => ({ kind, on: true, ownLine: null })),
    missYouDays: 10,
    milestones: [50, 100],
    trialCheckInDay: 2,
    trialEndingDays: 2,
    membershipEndingDays: 7,
    classReminderHours: 2,
  };
  const reminder = (change: { on?: boolean; ownLine?: string | null }, over: Partial<GymMessageSettingsRequest> = {}): GymMessageSettingsRequest => ({
    ...START,
    ...over,
    messages: START.messages.map((m) => (m.kind === "class_reminder" ? { ...m, ...change } : m)),
  });
  const save = async (gym: Gym, body: unknown, by: Person = gym.owner) => await inject("PUT", settingsPath(gym), by.cookies, body);
  const saved = async (gym: Gym, body: GymMessageSettingsRequest): Promise<GymMessageSettingsResponse> => {
    const res = await save(gym, body);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as GymMessageSettingsResponse;
  };
  const settings = async (gym: Gym): Promise<GymMessageSettingsResponse> => {
    const res = await inject("GET", settingsPath(gym), gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as GymMessageSettingsResponse;
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), { redis, orgs: { now: () => clock } });
    await api().ready();
  }, T);

  beforeEach(() => {
    clock = at(TODAY, 9);
  });

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it(
    "THE WORST THING: a reminder reaches only a live member who still holds a place in a class that is still on, at its own time, never somebody who cancelled, is waiting, was taken off, left, switched it off, shares the record, or whose class the gym cancelled, and never twice",
    async () => {
      const gym = await makeGym("Remind Iron House");
      const next = await makeGym("Remind Next Door");
      const quiet = await makeGym("Remind Switched Off");
      const lapsed = await makeGym("Remind No Plan");
      await saved(quiet, reminder({ on: false }));

      // 09:00. Everything below is at 18:00 today unless it says otherwise.
      const yoga = await classAt(gym, "Yoga", TODAY, 18);
      const maya = await member(gym, "Maya Booked");
      await book(gym, maya, yoga);

      const cal = await member(gym, "Cal Cancelled");
      await book(gym, cal, yoga);
      expect((await inject("POST", `${bookingUrl(gym, yoga)}/cancel`, cal.cookies, { lateOk: false })).statusCode).toBe(200);

      // One place: Bo has it and Wim waits.
      const spin = await classAt(gym, "Spin", TODAY, 18, 0, 1);
      const bo = await member(gym, "Bo Has The Place");
      await book(gym, bo, spin);
      const wim = await member(gym, "Wim Waits");
      await book(gym, wim, spin, "waitlisted");

      // The gym cancels Pilates, by its own route.
      const pilates = await classAt(gym, "Pilates", TODAY, 18);
      const gia = await member(gym, "Gia Gym Cancelled");
      await book(gym, gia, pilates);
      await confirmed((confirmBookings) => inject("POST", `/v1/orgs/${gym.id}/class-sessions/${pilates}/cancel`, gym.owner.cookies, confirmBookings === undefined ? {} : { confirmBookings }));
      // A cancelled class whose booking still reads booked: the class's own status is read.
      const barre = await classAt(gym, "Barre", TODAY, 18);
      const ben = await member(gym, "Ben Booked A Cancelled Class");
      await book(gym, ben, barre);
      await sql`UPDATE gym_class_sessions SET status = 'cancelled' WHERE id = ${barre}`;

      // Staff take Rex off Boxing.
      const boxing = await classAt(gym, "Boxing", TODAY, 18);
      const rex = await member(gym, "Rex Removed From Class");
      const rexBooking = await book(gym, rex, boxing);
      expect((await inject("POST", `/v1/orgs/${gym.id}/class-sessions/${boxing}/bookings/${rexBooking}/remove`, gym.owner.cookies, {})).statusCode).toBe(200);

      // The gym moves HIIT from 18:00 to 19:30.
      const hiit = await classAt(gym, "HIIT", TODAY, 18);
      const mo = await member(gym, "Mo Moved");
      await book(gym, mo, hiit);
      await confirmed((confirmBookings) =>
        inject("PUT", `/v1/orgs/${gym.id}/class-sessions/${hiit}`, gym.owner.cookies, { scope: "this", startMinute: 19 * 60 + 30, minutes: 45, places: null, coachUserId: null, ...(confirmBookings === undefined ? {} : { confirmBookings }) }),
      );

      // People the gym no longer has, each still holding a booking that reads booked.
      const rem = await member(gym, "Rem Removed From Gym");
      await book(gym, rem, yoga);
      await sql`UPDATE gym_members SET removed_at = ${clock}, removed_entry_id = entry_id, entry_id = NULL WHERE gym_id = ${gym.id} AND user_id = ${rem.userId}`;
      const fay = await member(gym, "Fay Former");
      await book(gym, fay, yoga);
      await sql`UPDATE gym_member_list_entries SET former_at = ${clock} WHERE id = ${fay.entryId}`;
      const del = await member(gym, "Del Deleted");
      await book(gym, del, yoga);
      await sql`UPDATE users SET status = 'deleted' WHERE id = ${del.userId}`;

      // Olga switched the reminder off for herself.
      const olga = await member(gym, "Olga Off");
      await book(gym, olga, yoga);
      expect((await inject("PUT", `/v1/orgs/${gym.id}/inbox/switches`, olga.cookies, { kind: "class_reminder", on: false })).statusCode).toBe(200);

      // Tomorrow at 06:00: its reminder's time is in the night, so it goes this evening.
      const dawn = await classAt(gym, "Dawn Run", TOMORROW, 6);
      const eve = await member(gym, "Eve Early");
      await book(gym, eve, dawn);

      // Personal training with Sam: Tia at 18:00; Uma cancelled hers; Hal and Hana share
      // one record, and its session is nobody's.
      const sam = await trainerWith(gym, "Sam Trainer");
      const tia = await member(gym, "Tia Trains");
      await bookSession(gym, tia, sam, 18);
      const uma = await member(gym, "Uma Unbooked");
      const umas = await bookSession(gym, uma, sam, 17);
      expect((await inject("POST", `/v1/orgs/${gym.id}/member-pt/sessions/${umas}/cancel`, uma.cookies, { lateOk: false })).statusCode).toBe(200);
      const hal = await member(gym, "Hal Household");
      const hana = await member(gym, "Hana Household", hal.entryId);
      const shared = await inject("POST", `/v1/orgs/${gym.id}/pt/appointments`, gym.owner.cookies, { requestKey: randomUUID(), trainerId: sam.userId, entryId: hal.entryId, localDate: TODAY, startMinute: 19 * 60, minutes: 60 });
      expect(shared.statusCode, shared.body).toBe(200);

      // Next door, a gym with the reminder switched off, and a gym on no plan.
      const ned = await member(next, "Ned Next Door");
      await book(next, ned, await classAt(next, "Zumba", TODAY, 18));
      const quinn = await member(quiet, "Quinn Quiet Gym");
      await book(quiet, quinn, await classAt(quiet, "Stretch", TODAY, 18));
      const pam = await member(lapsed, "Pam No Plan");
      await book(lapsed, pam, await classAt(lapsed, "Rowing", TODAY, 18));
      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${lapsed.id}`;

      // 16:10: Lea books Yoga after its reminder's time (16:00).
      clock = at(TODAY, 16, 10);
      const lea = await member(gym, "Lea Late");
      await book(gym, lea, yoga);

      const people = { maya, cal, bo, wim, gia, ben, rex, mo, rem, fay, del, olga, eve, tia, uma, hal, hana, lea, ned, quinn, pam, sam };
      const gyms = [gym, next, quiet, lapsed];

      // 15:49: nobody yet.
      expect((await run(gyms, at(TODAY, 15, 49))).sent).toBe(0);

      // 16:19, two runs at one instant and then a third.
      const both = await Promise.all([run(gyms, at(TODAY, 16, 19)), run(gyms, at(TODAY, 16, 19))]);
      expect(both[0].sent + both[1].sent).toBe(4);
      expect((await run(gyms, at(TODAY, 16, 19))).sent).toBe(0);
      const first = [
        "bo: Hi Bo, you're booked for Spin today at 18:00 at Remind Iron House. See you there.",
        "maya: Hi Maya, you're booked for Yoga today at 18:00 at Remind Iron House. See you there.",
        "tia: Hi Tia, you have a personal training session with Sam today at 18:00 at Remind Iron House. See you there.",
      ];
      expect(await got(gym, people)).toEqual(first);
      expect(await got(next, people)).toEqual(["ned: Hi Ned, you're booked for Zumba today at 18:00 at Remind Next Door. See you there."]);
      expect(await got(quiet, people)).toEqual([]);
      expect(await got(lapsed, people)).toEqual([]);
      expect((await sentBy(gym)).map((row) => row.kind)).toEqual(["class_reminder", "class_reminder", "class_reminder"]);

      // 17:34: the class the gym moved, by its new time.
      expect((await run(gyms, at(TODAY, 17, 34))).sent).toBe(1);
      const second = [...first, "mo: Hi Mo, you're booked for HIIT today at 19:30 at Remind Iron House. See you there."].sort();
      expect(await got(gym, people)).toEqual(second);

      // 18:04: tomorrow's 06:00 class. Everything at 18:00 has started.
      expect((await run(gyms, at(TODAY, 18, 4))).sent).toBe(1);
      const third = [...second, "eve: Hi Eve, you're booked for Dawn Run tomorrow at 06:00 at Remind Iron House. See you there."].sort();
      expect(await got(gym, people)).toEqual(third);

      // The rest of the evening, the night and the next morning: nothing more.
      for (const when of [at(TODAY, 19, 4), at(TODAY, 20, 49), at(TODAY, 23, 4), at(TOMORROW, 5, 4), at(TOMORROW, 8, 4)]) expect((await run(gyms, when)).sent, when.toISOString()).toBe(0);
      expect(await got(gym, people)).toEqual(third);
      expect(await got(next, people)).toHaveLength(1);
    },
    T,
  );

  it(
    "a reminder goes on a day another automatic message went, and the day's message still goes after a reminder",
    async () => {
      const gym = await makeGym("Remind Same Day");
      const nia = await member(gym, "Nia New");
      // She joined at 10:00 today, and booked the 13:00 class.
      await sql`UPDATE gym_members SET joined_at = ${at(TODAY, 10)} WHERE gym_id = ${gym.id} AND user_id = ${nia.userId}`;
      clock = at(TODAY, 10, 5);
      await book(gym, nia, await classAt(gym, "Lunch Spin", TODAY, 13));
      await book(gym, nia, await classAt(gym, "Evening Yoga", TODAY, 19));

      expect((await run([gym], at(TODAY, 10, 19))).sent).toBe(1);
      expect((await run([gym], at(TODAY, 11, 4))).sent).toBe(1);
      expect((await run([gym], at(TODAY, 17, 4))).sent).toBe(1);
      expect((await sentBy(gym)).map((row) => row.kind).sort()).toEqual(["class_reminder", "class_reminder", "welcome"]);

      // The other way round: reminded first, welcomed the same morning.
      const other = await makeGym("Remind Then Welcome");
      const omar = await member(other, "Omar New");
      // He joined at 22:00 last night and booked this morning's 10:00 class there and then.
      await sql`UPDATE gym_members SET joined_at = ${at(YESTERDAY, 22)} WHERE gym_id = ${other.id} AND user_id = ${omar.userId}`;
      clock = at(YESTERDAY, 22, 5);
      await book(other, omar, await classAt(other, "Morning Spin", TODAY, 10));
      // 08:04: the reminder and the Welcome that waited for the morning, in one run.
      expect((await run([other], at(TODAY, 8, 4))).sent).toBe(2);
      expect((await sentBy(other)).map((row) => row.kind).sort()).toEqual(["class_reminder", "welcome"]);
    },
    T,
  );

  it(
    "the gym's number of hours, its own line and its clock are the sender's; the box says whether anything can be booked",
    async () => {
      const gym = await makeGym("Remind Settings");
      const before = await settings(gym);
      expect(before.messages.map((m) => m.kind)).toEqual([...GYM_MESSAGE_SETTING_KINDS]);
      expect(before.messages.find((m) => m.kind === "class_reminder")).toEqual({ kind: "class_reminder", on: true, ownLine: null });
      expect([before.classReminderHours, before.bookings]).toEqual([2, false]);

      const yoga = await classAt(gym, "Yoga", TOMORROW, 18);
      expect((await settings(gym)).bookings).toBe(true);
      const maya = await member(gym, "Maya Rao");
      await book(gym, maya, yoga);

      // A number that is not on offer is refused, and nothing is kept.
      for (const classReminderHours of [0, 4, 48, 2.5, "2"]) expect((await save(gym, reminder({}, { classReminderHours } as Partial<GymMessageSettingsRequest>))).statusCode, String(classReminderHours)).toBe(400);
      expect((await settings(gym)).classReminderHours).toBe(2);

      const kept = await saved(gym, reminder({ ownLine: "Bring a mat." }, { classReminderHours: 24 }));
      expect(kept.classReminderHours).toBe(24);
      expect(kept.messages.find((m) => m.kind === "class_reminder")?.ownLine).toBe("Bring a mat.");
      // A page loaded before this kind saves what it knows: the reminder keeps its own.
      const olderBody: GymMessageSettingsRequest = {
        messages: START.messages.filter((m) => m.kind !== "class_reminder"),
        missYouDays: 10,
        milestones: [50, 100],
        trialCheckInDay: 2,
        trialEndingDays: 2,
        membershipEndingDays: 7,
      };
      expect((await saved(gym, olderBody)).classReminderHours).toBe(24);
      expect((await settings(gym)).messages.find((m) => m.kind === "class_reminder")?.ownLine).toBe("Bring a mat.");

      // 24 hours before tomorrow's 18:00 is 18:00 today.
      expect((await run([gym], at(TODAY, 17, 49))).sent).toBe(0);
      await sql`UPDATE gyms SET clock_format = '12h' WHERE id = ${gym.id}`;
      expect((await run([gym], at(TODAY, 18, 4))).sent).toBe(1);
      expect((await sentBy(gym)).map((row) => row.body)).toEqual(["Hi Maya, you're booked for Yoga tomorrow at 6:00 PM at Remind Settings. See you there.\nBring a mat."]);

      // She reads it in her Inbox, and can switch the reminder off and on again.
      clock = at(TODAY, 18, 10);
      const inbox = JSON.parse((await inject("GET", `/v1/orgs/${gym.id}/inbox`, maya.cookies)).body) as GymInboxResponse;
      expect(inbox.messages.map((m) => [m.kind, m.read])).toEqual([["class_reminder", false]]);
      expect(inbox.unread).toBe(1);
      const off = await inject("PUT", `/v1/orgs/${gym.id}/inbox/switches`, maya.cookies, { kind: "class_reminder", on: false });
      expect(JSON.parse(off.body)).toEqual({ off: ["class_reminder"] });
      const on = await inject("PUT", `/v1/orgs/${gym.id}/inbox/switches`, maya.cookies, { kind: "class_reminder", on: true });
      expect(JSON.parse(on.body)).toEqual({ off: [] });

      // Next door's owner, a member and nobody are refused the box.
      const stranger = await makeGym("Remind Stranger");
      expect((await inject("GET", settingsPath(gym), stranger.owner.cookies)).statusCode).toBe(404);
      expect((await save(gym, reminder({ on: false }), stranger.owner)).statusCode).toBe(404);
      expect((await save(gym, reminder({ on: false }), maya)).statusCode).toBe(404);
      expect((await inject("GET", settingsPath(gym), {})).statusCode).toBe(401);
      expect((await settings(gym)).messages.find((m) => m.kind === "class_reminder")?.on).toBe(true);
      // A member of another gym cannot switch this gym's reminder.
      expect((await inject("PUT", `/v1/orgs/${gym.id}/inbox/switches`, stranger.owner.cookies, { kind: "class_reminder", on: false })).statusCode).toBe(404);
    },
    T,
  );
});
