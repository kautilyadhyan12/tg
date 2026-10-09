// A TRAINER LEAVES THE STAFF, AND CAME OR NO-SHOW — the routes against real Postgres
// (DATABASE_URL-gated), on two api instances over one database. Spec Part 3 §13.5;
// ROADMAP 17e-iv-b.
//
// The worst thing this job could do to a real person: a member loses a booked, paid session
// because a DIFFERENT trainer was removed, or a removed trainer's sessions stay booked with
// nobody to give them and the pack never has them back. That is the first test.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { MemberPtResponse, PtAppointment, PtSessionsEnding, PtWeekResponse } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createIoRedis, createMemoryRedis, type RedisLike } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "personal-training-trainer-leaves-secret", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 180_000;
const LIVE_PLAN = "zz_ptt_live";
/** Wednesday 7 October 2026, 07:30 in London (summer time, one hour ahead of UTC). */
const NOW = new Date("2026-10-07T06:30:00Z");
/** 09:30 that morning: a 09:00 session has started. */
const HALF_NINE = new Date("2026-10-07T08:30:00Z");
const TUESDAY = "2026-10-06";
const TODAY = "2026-10-07";
const THURSDAY = "2026-10-08";
const FRIDAY = "2026-10-09";
const MONDAY = "2026-10-12";

let ipCounter = 0;
const nextIp = () => `10.84.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
const redisUrl = process.env["TEST_REDIS_URL"];
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("a trainer leaves the staff, and came or no-show (real Postgres, two api instances)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let clock = NOW.getTime();
  let app: App | undefined;
  let second: App | undefined;
  let redis: RedisLike | undefined;
  const deleteCodes = new Map<string, string>();
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const other = (): App => second ?? api();

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'ptt-t-%@example.com')`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_pt_appointments WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_trainers WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'ptt-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  /** Set, every request comes from this one address: a gym's staff behind one front desk. */
  let oneAddress: string | null = null;
  const inject = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, cookies: Cookies, payload?: unknown, target = api()) =>
    target.inject({
      method,
      url: path,
      remoteAddress: oneAddress ?? nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });

  interface Person {
    userId: string;
    cookies: Cookies;
    name: string;
    email: string;
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `ptt-t-${uniq()}@example.com`;
    const reg = await inject("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await inject("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login), name: displayName, email };
  };

  interface Gym {
    id: string;
    owner: Person;
  }
  const makeGym = async (name: string): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Leeds", country: "GB", timezone: "Europe/London" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return { id, owner };
  };
  const staff = async (gym: Gym, name: string, role: "trainer" | "manager" | "owner" = "trainer", privileges: string[] | null = null): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${person.userId}, ${role}, ${privileges})`;
    return person;
  };
  /** Somebody on the gym's list with no app. */
  const onList = async (gym: Gym, name: string, email = `ptt-l-${uniq()}@example.com`): Promise<string> => {
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName: name, email, status: "Active" });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };
  type Member = Person & { entryId: string };
  /** `person` made a member of the app whose record is on the gym's list. */
  const joined = async (gym: Gym, person: Person): Promise<Member> => {
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${gym.id}, ${person.userId}, '2026-01-01T00:00:00Z')`;
    const entryId = await onList(gym, person.name);
    await sql`UPDATE gym_members SET entry_id = ${entryId} WHERE gym_id = ${gym.id} AND user_id = ${person.userId}`;
    return { ...person, entryId };
  };
  const member = async (gym: Gym, name: string): Promise<Member> => joined(gym, await signedIn(name));

  const typeOf = async (gym: Gym, over: { kind?: "recurring" | "pack"; name?: string; aWeek?: number } = {}): Promise<string> => {
    const pack = over.kind === "pack";
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_membership_types
        (gym_id, name, kind, price_minor, currency, term_count, term_unit, pack_classes, pack_days, access, covers_all_classes, includes_pt,
         pt_limit, pt_period)
      VALUES (${gym.id}, ${over.name ?? `Type ${uniq()}`}, ${over.kind ?? "recurring"}, 4000, 'GBP', ${pack ? null : 1}, ${pack ? null : "month"},
              ${pack ? 10 : null}, ${pack ? 60 : null}, 'all_classes', true, true,
              ${over.aWeek ?? null}, ${over.aWeek === undefined ? null : "week"})
      RETURNING id`;
    if (row === undefined) throw new Error("no type");
    return row.id;
  };
  const hold = async (gym: Gym, entryId: string, typeId: string, over: { pack?: number } = {}): Promise<string> => {
    const pack = over.pack !== undefined;
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_held_memberships
        (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, pack_classes, pack_days,
         classes_left, starts_on, status, renews, paid_periods)
      VALUES (${gym.id}, ${entryId}, ${typeId}, gen_random_uuid(), ${pack ? "pack" : "recurring"}, 4000, 'GBP', ${pack ? null : 1}, ${pack ? null : "month"},
              ${pack ? 10 : null}, ${pack ? 60 : null}, ${over.pack ?? null}, '2026-10-01'::date, 'active', ${!pack}, 0)
      RETURNING id`;
    if (row === undefined) throw new Error("no membership");
    return row.id;
  };
  const left = async (heldId: string): Promise<number | null> => {
    const [row] = await sql<{ classes_left: number | null }[]>`SELECT classes_left FROM gym_held_memberships WHERE id = ${heldId}`;
    if (row === undefined) throw new Error("no membership");
    return row.classes_left;
  };

  /** 09:00 to 13:00 every day, in sessions of an hour: 09:00, 10:00, 11:00 and 12:00. */
  const EVERY_MORNING = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, fromMinute: 540, toMinute: 780 }));
  const offering = async (gym: Gym, person: Person): Promise<Person> => {
    const res = await inject("PUT", `/v1/orgs/${gym.id}/pt/trainers/${person.userId}`, gym.owner.cookies, { offers: true, sessionMinutes: 60, hours: EVERY_MORNING });
    expect(res.statusCode, res.body).toBe(200);
    return person;
  };
  const trainerWith = async (gym: Gym, name: string): Promise<Person> => offering(gym, await staff(gym, name));
  const bookRaw = (gym: Gym, trainer: Person, entryId: string, minute: number, day = FRIDAY, target = api()) =>
    inject(
      "POST",
      `/v1/orgs/${gym.id}/pt/appointments`,
      gym.owner.cookies,
      { requestKey: randomUUID(), trainerId: trainer.userId, entryId, localDate: day, startMinute: minute, minutes: 60 },
      target,
    );
  const book = async (gym: Gym, trainer: Person, entryId: string, minute: number, day = FRIDAY): Promise<string> => {
    const res = await bookRaw(gym, trainer, entryId, minute, day);
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { appointment: { id: string } }).appointment.id;
  };
  /** [status, still charged to its pack] of each session, in the order asked. */
  const stateOf = async (gym: Gym, ids: readonly string[]): Promise<[string, boolean][]> => {
    const found = await sql<{ id: string; status: string; pack_charged: boolean }[]>`
      SELECT id, status, pack_charged FROM gym_pt_appointments WHERE gym_id = ${gym.id}`;
    const all = new Map(found.map((r) => [r.id, r]));
    return ids.map((id) => {
      const row = all.get(id);
      if (row === undefined) throw new Error(`no session ${id}`);
      return [row.status, row.pack_charged];
    });
  };
  const isStaff = async (gym: Gym, who: Person): Promise<boolean> =>
    (await sql`SELECT 1 FROM gym_staff WHERE gym_id = ${gym.id} AND user_id = ${who.userId}`).length === 1;
  const trainersSeenBy = async (gym: Gym, reader: Person): Promise<string[]> => {
    const res = await inject("GET", `/v1/orgs/${gym.id}/member-pt?week=0`, reader.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as MemberPtResponse).trainers.map((t) => t.trainerId);
  };

  const withMark = (mark: string | null, more = ""): string => {
    const parts = [...(more === "" ? [] : [more]), ...(mark === null ? [] : [`confirmPtSessions=${mark}`])];
    return parts.length === 0 ? "" : `?${parts.join("&")}`;
  };
  /** Remove from staff: they keep their place in the app. */
  const offStaff = (gym: Gym, who: Person, mark: string | null, by: Person = gym.owner, target = api()) =>
    inject("DELETE", `/v1/orgs/${gym.id}/staff/${who.userId}${withMark(mark)}`, by.cookies, undefined, target);
  /** Remove from staff and from the app, in one step. */
  const offStaffAndApp = (gym: Gym, who: Person, mark: string | null, by: Person = gym.owner) =>
    inject("DELETE", `/v1/orgs/${gym.id}/members/${who.userId}${withMark(mark, "alsoStaff=true")}`, by.cookies);
  const asked = (res: { statusCode: number; body: string }): PtSessionsEnding => {
    expect(res.statusCode, res.body).toBe(409);
    const body = JSON.parse(res.body) as { error: string; sessions: PtSessionsEnding };
    expect(body.error).toBe("pt_sessions_ending");
    return body.sessions;
  };
  const markRaw = (gym: Gym, id: string, status: unknown, by: Person = gym.owner, target = api()) =>
    inject("POST", `/v1/orgs/${gym.id}/pt/appointments/${id}/mark`, by.cookies, { status }, target);
  const marked = async (gym: Gym, id: string, status: "attended" | "no_show", by: Person = gym.owner): Promise<PtAppointment> => {
    const res = await markRaw(gym, id, status, by);
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { appointment: PtAppointment }).appointment;
  };
  const weekOf = async (gym: Gym, trainer: Person, from: string | null, by: Person = gym.owner): Promise<PtWeekResponse> => {
    const res = await inject("GET", `/v1/orgs/${gym.id}/pt/week?trainer=${trainer.userId}${from === null ? "" : `&from=${from}`}`, by.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as PtWeekResponse;
  };
  const auditOf = async (gym: Gym, action: string, targetId: string): Promise<Record<string, string>[]> =>
    (await sql<{ meta: Record<string, string> }[]>`
      SELECT meta FROM audit_log WHERE gym_id = ${gym.id} AND action = ${action} AND target_id = ${targetId} ORDER BY at, id`).map((r) => r.meta);

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    redis = redisUrl === undefined || redisUrl === "" ? createMemoryRedis() : createIoRedis(redisUrl);
    for (let tries = 0; (await redis.incrWithTtl(`ptt-ready:${randomUUID()}`, 30)) === null; tries++) {
      if (tries === 100) throw new Error("the Redis at TEST_REDIS_URL never connected");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const overrides = {
      redis,
      orgs: { now: () => new Date(clock) },
      usersEmailSender: {
        sendAccountDeleteCodeEmail: (to: string, code: string) => {
          deleteCodes.set(to.toLowerCase(), code);
          return Promise.resolve();
        },
        sendAccountDeletionEmail: () => Promise.resolve(),
      },
    };
    app = await buildApp(loadConfig(baseEnv), overrides);
    await api().ready();
    second = await buildApp(loadConfig(baseEnv), overrides);
    await second.ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await second?.close();
    await redis?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it(
    "THE WORST THING: removing one trainer from the staff ends exactly the coming sessions booked WITH them and gives those packs their sessions back; no other trainer's session and nobody else's pack moves",
    async () => {
      clock = NOW.getTime();
      const gym = await makeGym("Worst Thing Trainer");
      const elsewhere = await makeGym("Other Town Trainer");
      const pack = await typeOf(gym, { kind: "pack", name: "PT 10" });
      const monthly = await typeOf(gym, { name: "Gold with PT" });
      const sam = await trainerWith(gym, "Sam Leaving");
      const tara = await trainerWith(gym, "Tara Staying Qqx");
      const manager = await staff(gym, "Mona Manager", "manager");
      const maya = await member(gym, "Maya Member");
      const noor = await member(gym, "Noor Member");
      const wendy = await onList(gym, "Wendy Walkin");
      const mayaPack = await hold(gym, maya.entryId, pack, { pack: 10 });
      const noorPack = await hold(gym, noor.entryId, pack, { pack: 10 });
      await hold(gym, wendy, monthly);
      // Another gym, its own trainer and person, at the very same time as Maya's with Sam.
      const theirPack = await typeOf(elsewhere, { kind: "pack", name: "Their pack" });
      const tom = await trainerWith(elsewhere, "Tom Elsewhere Zzk");
      const olga = await onList(elsewhere, "Olga Elsewhere Zzk");
      const olgaPack = await hold(elsewhere, olga, theirPack, { pack: 10 });
      const olgas = await book(elsewhere, tom, olga, 600);

      // EVERY CLASS OF SESSION booked with Sam, one of each.
      const coming = await book(gym, sam, maya.entryId, 600); // Friday 10:00, Maya's pack
      const comingOther = await book(gym, sam, noor.entryId, 660); // Friday 11:00, Noor's pack
      const comingMembership = await book(gym, sam, wendy, 540, MONDAY); // on a membership: no pack
      const started = await book(gym, sam, maya.entryId, 540, TODAY); // 09:00 today
      const keptLate = await book(gym, sam, maya.entryId, 540, THURSDAY);
      const came = await book(gym, sam, maya.entryId, 600, THURSDAY);
      const missed = await book(gym, sam, maya.entryId, 660, THURSDAY);
      const cancelledFree = await book(gym, sam, maya.entryId, 720, THURSDAY);
      await sql`UPDATE gym_pt_appointments SET status = 'late_cancelled', cancelled_at = now() WHERE id = ${keptLate}`;
      await sql`UPDATE gym_pt_appointments SET status = 'attended' WHERE id = ${came}`;
      await sql`UPDATE gym_pt_appointments SET status = 'no_show' WHERE id = ${missed}`;
      const freed = await inject("POST", `/v1/orgs/${gym.id}/pt/appointments/${cancelledFree}/cancel`, gym.owner.cookies, { lateOk: false, giveBack: false });
      expect(freed.statusCode, freed.body).toBe(200);
      // THE OTHER TRAINER'S: the same people, one of them at the very time of a session of Sam's.
      const tarasMaya = await book(gym, tara, maya.entryId, 720); // Friday 12:00
      const tarasNoor = await book(gym, tara, noor.entryId, 600); // Friday 10:00, as Maya's with Sam
      const tarasWendy = await book(gym, tara, wendy, 600, MONDAY);
      expect([await left(mayaPack), await left(noorPack), await left(olgaPack)]).toEqual([4, 8, 9]);
      // 09:30: today's session has started.
      clock = HALF_NINE.getTime();

      const everything = [coming, comingOther, comingMembership, started, keptLate, came, missed, cancelledFree, tarasMaya, tarasNoor, tarasWendy];
      const before = await stateOf(gym, everything);

      // 1. IT ASKS FIRST, and names the three coming sessions booked with Sam and no other.
      const first = await offStaff(gym, sam, null);
      const box = asked(first);
      expect([box.count, box.packSessions, box.sessions.map((s) => s.id)]).toEqual([3, 2, [coming, comingOther, comingMembership]]);
      expect(box.sessions.map((s) => [s.personName, s.trainerName, s.localDate, s.localStartMinute, s.packSession])).toEqual([
        ["Maya Member", "Sam Leaving", FRIDAY, 600, true],
        ["Noor Member", "Sam Leaving", FRIDAY, 660, true],
        ["Wendy Walkin", "Sam Leaving", MONDAY, 540, false],
      ]);
      for (const secret of ["Tara", "Qqx", "Zzk", tarasMaya, tarasNoor, tarasWendy, olgas, tara.userId]) {
        expect(first.body.includes(secret), `the box holds "${secret}"`).toBe(false);
      }
      // Asking wrote nothing, and neither does a mark that is not this box's.
      expect(asked(await offStaff(gym, sam, "0".repeat(64))).mark).toBe(box.mark);
      const untouched = async () => [await stateOf(gym, everything), await isStaff(gym, sam), await left(mayaPack), await left(noorPack)];
      expect(await untouched()).toEqual([before, true, 4, 8]);

      // 2. A STRANGER, a trainer, the trainer themself and a manager do nothing with the right mark.
      expect([403, 404]).toContain((await offStaff(gym, sam, box.mark, elsewhere.owner)).statusCode);
      expect((await offStaff(gym, sam, box.mark, tara)).statusCode).toBe(403);
      expect((await offStaff(gym, sam, box.mark, sam)).statusCode).toBe(403);
      expect((await offStaff(gym, sam, box.mark, manager)).statusCode).toBe(403);
      expect((await offStaff(elsewhere, sam, box.mark, elsewhere.owner)).statusCode).toBe(404);
      expect(await untouched()).toEqual([before, true, 4, 8]);

      // 3. CONFIRMED: exactly those three end, and each pack has exactly its one back.
      const done = await offStaff(gym, sam, box.mark);
      expect(done.statusCode, done.body).toBe(200);
      expect(await isStaff(gym, sam)).toBe(false);
      expect(await stateOf(gym, everything)).toEqual([
        ["cancelled", false], // Maya's coming with Sam: ended, given back
        ["cancelled", false], // Noor's coming with Sam: ended, given back
        ["cancelled", false], // Wendy's coming with Sam, on a membership
        ["booked", true], // started: history, still charged
        ["late_cancelled", true], // a late cancel that kept the session used stays used
        ["attended", true],
        ["no_show", true],
        ["cancelled", false], // already cancelled: not given back a second time
        ["booked", true], // Tara's with Maya
        ["booked", true], // Tara's with Noor, at the time of Maya's with Sam
        ["booked", false], // Tara's with Wendy
      ]);
      expect([await left(mayaPack), await left(noorPack), await left(olgaPack)]).toEqual([5, 9, 9]);
      expect(await stateOf(elsewhere, [olgas])).toEqual([["booked", true]]);
      const [audit] = await auditOf(gym, "org.staff_removed", sam.userId);
      expect([audit?.["ptSessionsEnded"], audit?.["ptPackSessionsBack"]]).toEqual(["3", "2"]);
      expect(/Maya|Noor|Wendy/.test(JSON.stringify(audit))).toBe(false);
      // Members are offered Tara and no longer Sam; nobody can be booked with Sam.
      expect(await trainersSeenBy(gym, maya)).toEqual([tara.userId]);
      expect((await bookRaw(gym, sam, wendy, 720)).statusCode).toBe(404);

      // 4. THE SAME REQUEST AGAIN, on the other server: they are not staff, and nothing more moves.
      const again = await offStaff(gym, sam, box.mark, gym.owner, other());
      expect(again.statusCode, again.body).toBe(404);
      expect([await left(mayaPack), await left(noorPack)]).toEqual([5, 9]);
      expect((await stateOf(gym, [tarasMaya, tarasNoor, tarasWendy])).map(([status]) => status)).toEqual(["booked", "booked", "booked"]);

      // 5. A TRAINER WITH NOTHING COMING goes at the first press, and nothing is asked.
      const idle = await trainerWith(gym, "Ivy Idle");
      const gone = await offStaff(gym, idle, null);
      expect(gone.statusCode, gone.body).toBe(200);
      expect((await auditOf(gym, "org.staff_removed", idle.userId))[0]?.["ptSessionsEnded"]).toBeUndefined();
    },
    T,
  );

  it(
    "removed from staff AND the app in one step: ONE box names the sessions booked with them and the ones booked for them, and one press ends both; removed from the app alone, the sessions they give stay",
    async () => {
      clock = NOW.getTime();
      const gym = await makeGym("Both At Once");
      const pack = await typeOf(gym, { kind: "pack", name: "PT 10" });
      const tara = await trainerWith(gym, "Tara Staying");
      // Sam trains here and is a member here too, with his own sessions booked with Tara.
      const sam = await joined(gym, await trainerWith(gym, "Sam Both"));
      const maya = await member(gym, "Maya Member");
      const samPack = await hold(gym, sam.entryId, pack, { pack: 10 });
      const mayaPack = await hold(gym, maya.entryId, pack, { pack: 10 });
      const gives = await book(gym, sam, maya.entryId, 600); // Friday 10:00, Sam trains Maya
      const takes = await book(gym, tara, sam.entryId, 660); // Friday 11:00, Tara trains Sam
      const tarasMaya = await book(gym, tara, maya.entryId, 720);
      expect([await left(samPack), await left(mayaPack)]).toEqual([9, 8]);

      // From the app ALONE: only the session booked FOR him is named, and he stays a trainer.
      const appOnly = asked(await inject("DELETE", `/v1/orgs/${gym.id}/members/${sam.userId}`, gym.owner.cookies));
      expect(appOnly.sessions.map((s) => s.id)).toEqual([takes]);

      // From staff AND the app: one box, both sessions, one mark.
      const first = await offStaffAndApp(gym, sam, null);
      const box = asked(first);
      expect([box.count, box.packSessions, box.sessions.map((s) => s.id)]).toEqual([2, 2, [gives, takes]]);
      expect(first.body.includes(tarasMaya)).toBe(false);
      // The mark of half of it (the app-only box's) is not this box's: nothing happens.
      expect(asked(await offStaffAndApp(gym, sam, appOnly.mark)).mark).toBe(box.mark);
      expect([await stateOf(gym, [gives, takes, tarasMaya]), await isStaff(gym, sam)]).toEqual([
        [
          ["booked", true],
          ["booked", true],
          ["booked", true],
        ],
        true,
      ]);

      const done = await offStaffAndApp(gym, sam, box.mark);
      expect(done.statusCode, done.body).toBe(200);
      expect(await isStaff(gym, sam)).toBe(false);
      expect(await stateOf(gym, [gives, takes, tarasMaya])).toEqual([
        ["cancelled", false],
        ["cancelled", false],
        ["booked", true],
      ]);
      expect([await left(samPack), await left(mayaPack)]).toEqual([10, 9]);
      const [staffAudit] = await auditOf(gym, "org.staff_removed", sam.userId);
      expect([staffAudit?.["ptSessionsEnded"], staffAudit?.["ptPackSessionsBack"], staffAudit?.["removedWith"]]).toEqual(["1", "1", "membership"]);

      // REMOVED FROM THE APP ALONE (the tick left off): the sessions he gives stay booked.
      const ben = await joined(gym, await trainerWith(gym, "Ben Stays Staff"));
      const bensGiven = await book(gym, ben, maya.entryId, 540, MONDAY);
      const out = await inject("DELETE", `/v1/orgs/${gym.id}/members/${ben.userId}`, gym.owner.cookies);
      expect(out.statusCode, out.body).toBe(200);
      expect([await isStaff(gym, ben), await stateOf(gym, [bensGiven])]).toEqual([true, [["booked", true]]]);
    },
    T,
  );

  it(
    "a trainer who deletes their own account: the sessions booked with them end with no box, at their gym and no other; an owner who deletes theirs keeps the gym and its sessions",
    async () => {
      clock = NOW.getTime();
      const gym = await makeGym("Account Gone");
      const pack = await typeOf(gym, { kind: "pack", name: "PT 10" });
      const sam = await trainerWith(gym, "Sam Deleting");
      const tara = await trainerWith(gym, "Tara Staying");
      await offering(gym, gym.owner);
      const maya = await onList(gym, "Maya Listed");
      const mayaPack = await hold(gym, maya, pack, { pack: 10 });
      const sams = await book(gym, sam, maya, 600);
      const samsStarted = await book(gym, sam, maya, 540, TODAY);
      const taras = await book(gym, tara, maya, 660);
      const owners = await book(gym, gym.owner, maya, 720);
      expect(await left(mayaPack)).toBe(6);
      clock = HALF_NINE.getTime();

      const deleteAccount = async (who: Person) => {
        expect((await inject("POST", "/v1/users/me/delete-code", who.cookies, {})).statusCode).toBe(200);
        const code = deleteCodes.get(who.email);
        if (code === undefined) throw new Error("no delete code");
        const res = await inject("DELETE", "/v1/users/me", who.cookies, { code });
        expect(res.statusCode, res.body).toBe(200);
      };
      await deleteAccount(sam);
      expect(await isStaff(gym, sam)).toBe(false);
      expect(await stateOf(gym, [sams, samsStarted, taras, owners])).toEqual([
        ["cancelled", false],
        ["booked", true], // it had started
        ["booked", true],
        ["booked", true],
      ]);
      expect(await left(mayaPack)).toBe(7);
      const [audit] = await auditOf(gym, "org.staff_removed", sam.userId);
      expect([audit?.["removedWith"], audit?.["ptSessionsEnded"], audit?.["ptPackSessionsBack"]]).toEqual(["account_deleted", "1", "1"]);

      // The owner's account: the gym keeps its owner, so the sessions booked with them stay.
      await deleteAccount(gym.owner);
      expect(await stateOf(gym, [owners, taras])).toEqual([
        ["booked", true],
        ["booked", true],
      ]);
      expect(await left(mayaPack)).toBe(7);

      // AT EVERY GYM THEY TRAIN AT, AND NO OTHER: Uli trains at two gyms and is a member,
      // with a session of his own, at a third.
      clock = NOW.getTime();
      const [north, south, third] = [await makeGym("Uli North"), await makeGym("Uli South"), await makeGym("Uli Member Here")];
      const uli = await signedIn("Uli Two Gyms");
      for (const g of [north, south]) {
        await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${g.id}, ${uli.userId}, 'trainer', ${null})`;
        await offering(g, uli);
      }
      const [nia, sol] = [await onList(north, "Nia North"), await onList(south, "Sol South")];
      const northStays = await trainerWith(north, "Nell Stays");
      const thirdTrainer = await trainerWith(third, "Theo Third");
      const uliThere = await joined(third, uli);
      const [atNorth, atSouth, northOther, uliOwn] = [
        await book(north, uli, nia, 600),
        await book(south, uli, sol, 600),
        await book(north, northStays, nia, 660),
        await book(third, thirdTrainer, uliThere.entryId, 600),
      ];
      await deleteAccount(uli);
      expect([await stateOf(north, [atNorth, northOther]), await stateOf(south, [atSouth]), await stateOf(third, [uliOwn])]).toEqual([
        [
          ["cancelled", false],
          ["booked", false],
        ],
        [["cancelled", false]],
        // His own session as a member is held by his record, which is still on that gym's list.
        [["booked", false]],
      ]);
      for (const g of [north, south]) {
        expect((await auditOf(g, "org.staff_removed", uli.userId)).map((m) => [m["removedWith"], m["ptSessionsEnded"]])).toEqual([["account_deleted", "1"]]);
      }

      // AN ACCOUNT DELETED AND A BOOKING WITH THEM AT ONE INSTANT, on two servers: never a
      // booked session left with a trainer who is gone.
      const race = await makeGym("Delete Race");
      const racePack = await typeOf(race, { kind: "pack", name: "PT 10" });
      for (let round = 0; round < 4; round++) {
        const vic = await trainerWith(race, `Vic Round ${String(round)}`);
        const person = await onList(race, `Pat Round ${String(round)}`);
        const held = await hold(race, person, racePack, { pack: 10 });
        await book(race, vic, person, 600);
        expect((await inject("POST", "/v1/users/me/delete-code", vic.cookies, {})).statusCode).toBe(200);
        const code = deleteCodes.get(vic.email);
        if (code === undefined) throw new Error("no delete code");
        const [gone, booking] = await Promise.all([
          inject("DELETE", "/v1/users/me", vic.cookies, { code }, round % 2 === 0 ? api() : other()),
          bookRaw(race, vic, person, 660, FRIDAY, round % 2 === 0 ? other() : api()),
        ]);
        expect(gone.statusCode, gone.body).toBe(200);
        expect([200, 404]).toContain(booking.statusCode);
        const still = await sql`SELECT 1 FROM gym_pt_appointments WHERE gym_id = ${race.id} AND trainer_user_id = ${vic.userId} AND status = 'booked'`;
        expect([await isStaff(race, vic), still.length, await left(held)], `round ${String(round)}`).toEqual([false, 0, 10]);
      }
    },
    T,
  );

  it(
    "a removal and a booking that wait for the gym together: whichever was first is the one the other sees, in BOTH orders",
    async () => {
      clock = NOW.getTime();
      const gym = await makeGym("In Order Trainer");
      const pack = await typeOf(gym, { kind: "pack", name: "PT 10" });
      // The order is made certain, not raced: the test holds the gym's row, sends one request
      // and waits until the database says it is waiting, sends the other and waits again,
      // then lets go. Only requests held up behind THIS transaction are counted.
      const lockWaits = async (holder: number): Promise<number> => {
        const waiting = await sql<{ pid: number; behind: number[] }[]>`
          SELECT pid, pg_blocking_pids(pid) AS behind FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'`;
        const queued = new Set<number>([holder]);
        for (let grew = true; grew; ) {
          grew = false;
          for (const row of waiting) {
            if (!queued.has(row.pid) && row.behind.some((pid) => queued.has(pid))) {
              queued.add(row.pid);
              grew = true;
            }
          }
        }
        return queued.size - 1;
      };
      const waitsReach = async (holder: number, n: number): Promise<void> => {
        for (let tries = 0; (await lockWaits(holder)) < n; tries++) {
          if (tries === 400) throw new Error(`only ${String(await lockWaits(holder))} of ${String(n)} requests are waiting for the gym's lock`);
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      };
      const inOrder = async (firstIs: "removal" | "booking") => {
        const sam = await trainerWith(gym, `Sam ${firstIs} first`);
        const maya = await onList(gym, `Maya ${firstIs}`);
        const noor = await onList(gym, `Noor ${firstIs}`);
        const mayaPack = await hold(gym, maya, pack, { pack: 10 });
        const noorPack = await hold(gym, noor, pack, { pack: 10 });
        await book(gym, sam, maya, 600);
        const box = asked(await offStaff(gym, sam, null));
        let letGo: () => void = () => undefined;
        let taken: (pid: number) => void = () => undefined;
        const isTaken = new Promise<number>((resolve) => (taken = resolve));
        const holding = sql.begin(async (tx) => {
          const [row] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid FROM gyms WHERE id = ${gym.id} FOR UPDATE`;
          if (row === undefined) throw new Error("no gym to hold");
          taken(row.pid);
          await new Promise<void>((resolve) => (letGo = resolve));
        });
        const holder = await isTaken;
        const remove = () => offStaff(gym, sam, box.mark, gym.owner, other());
        const bookNoor = () => bookRaw(gym, sam, noor, 660, FRIDAY, api());
        let removal: Awaited<ReturnType<typeof remove>>;
        let booking: Awaited<ReturnType<typeof bookNoor>>;
        try {
          const one = firstIs === "removal" ? remove() : bookNoor();
          await waitsReach(holder, 1);
          const two = firstIs === "removal" ? bookNoor() : remove();
          await waitsReach(holder, 2);
          letGo();
          const [a, b] = await Promise.all([one, two]);
          [removal, booking] = firstIs === "removal" ? [a, b] : [b, a];
        } finally {
          letGo();
          await holding;
        }
        const booked = await sql<{ entry_id: string }[]>`
          SELECT entry_id FROM gym_pt_appointments WHERE gym_id = ${gym.id} AND trainer_user_id = ${sam.userId} AND status = 'booked'`;
        return { codes: [removal.statusCode, booking.statusCode], staff: await isStaff(gym, sam), booked: booked.length, packs: [await left(mayaPack), await left(noorPack)] };
      };
      // The removal first: it goes through, and the booking finds nobody to book with.
      expect(await inOrder("removal")).toEqual({ codes: [200, 404], staff: false, booked: 0, packs: [10, 10] });
      // The booking first: the box no longer names everything, so nobody is removed.
      expect(await inOrder("booking")).toEqual({ codes: [409, 200], staff: true, booked: 2, packs: [9, 9] });
    },
    T,
  );

  it(
    "no box promises a removal the press cannot make: staff who may not change the list, and a trainer who was never a member, are answered before anything is asked",
    async () => {
      clock = NOW.getTime();
      const gym = await makeGym("Refused First");
      const pack = await typeOf(gym, { kind: "pack", name: "PT 10" });
      const maya = await onList(gym, "Maya Listed");
      const mayaPack = await hold(gym, maya, pack, { pack: 10 });
      // An owner ticked down: may manage staff and remove members, may not change the list.
      const ticked = await staff(gym, "Olive Ticked Down", "owner", ["staff.manage", "members.read", "members.remove"]);
      // Sam trains here and is a member here: removing him from the app takes his record off the list.
      const sam = await joined(gym, await trainerWith(gym, "Sam Both"));
      const sams = await book(gym, sam, maya, 600);
      const refused = await offStaffAndApp(gym, sam, null, ticked);
      expect([refused.statusCode, (JSON.parse(refused.body) as { error: string }).error]).toEqual([403, "forbidden"]);
      // The whole owner is asked, as before.
      expect(asked(await offStaffAndApp(gym, sam, null)).sessions.map((s) => s.id)).toEqual([sams]);

      // Tara is staff only. "Remove from staff and app" is not hers: 404 at the first press.
      const tara = await trainerWith(gym, "Tara Staff Only");
      const taras = await book(gym, tara, maya, 660);
      const never = await offStaffAndApp(gym, tara, null);
      expect([never.statusCode, (JSON.parse(never.body) as { error: string }).error]).toEqual([404, "member_not_found"]);
      expect([await isStaff(gym, sam), await isStaff(gym, tara), await stateOf(gym, [sams, taras]), await left(mayaPack)]).toEqual([
        true,
        true,
        [
          ["booked", true],
          ["booked", true],
        ],
        8,
      ]);
      // Remove from staff is hers, and asks.
      expect(asked(await offStaff(gym, tara, null)).sessions.map((s) => s.id)).toEqual([taras]);
    },
    T,
  );

  it(
    "the staff removal is limited for one person, and one gym's presses at an address slow nobody else there",
    async () => {
      clock = NOW.getTime();
      const gym = await makeGym("Limited Removal");
      const elsewhere = await makeGym("Same Address Gym");
      const sam = await trainerWith(gym, "Sam Trainer");
      const tom = await trainerWith(elsewhere, "Tom Trainer");
      const maya = await onList(gym, "Maya Listed");
      const olga = await onList(elsewhere, "Olga Listed");
      await book(gym, sam, maya, 600);
      await book(elsewhere, tom, olga, 600);
      // This run's own address: its count lives an hour in the real Redis.
      oneAddress = `10.85.${String(Math.floor(Math.random() * 250))}.${String(1 + Math.floor(Math.random() * 250))}`;
      try {
        const codes: number[] = [];
        for (let n = 0; n < 62; n++) codes.push((await offStaff(gym, sam, null)).statusCode);
        expect([codes.slice(0, 60).every((code) => code === 409), codes[60], codes[61]]).toEqual([true, 429, 429]);
        // Another gym's owner, at the very same address, is asked as usual.
        expect((await offStaff(elsewhere, tom, null, elsewhere.owner)).statusCode).toBe(409);
        expect([await isStaff(gym, sam), await isStaff(elsewhere, tom)]).toEqual([true, true]);
      } finally {
        oneAddress = null;
      }
    },
    T,
  );

  it(
    "a removal and a booking with that trainer at one instant, on two servers: never a trainer off the staff with a coming session still booked, and the pack always agrees",
    async () => {
      clock = NOW.getTime();
      const gym = await makeGym("One Instant Trainer");
      const pack = await typeOf(gym, { kind: "pack", name: "PT 10" });
      const outcomes = new Set<string>();
      for (let round = 0; round < 8; round++) {
        // Each round has its own trainer and its own two people.
        const sam = await trainerWith(gym, `Sam Round ${String(round)}`);
        const maya = await onList(gym, `Maya Round ${String(round)}`);
        const noor = await onList(gym, `Noor Round ${String(round)}`);
        const mayaPack = await hold(gym, maya, pack, { pack: 10 });
        const noorPack = await hold(gym, noor, pack, { pack: 10 });
        await book(gym, sam, maya, 600);
        const box = asked(await offStaff(gym, sam, null));
        const [removal, booking] = await Promise.all([
          offStaff(gym, sam, box.mark, gym.owner, round % 2 === 0 ? api() : other()),
          bookRaw(gym, sam, noor, 660, FRIDAY, round % 2 === 0 ? other() : api()),
        ]);
        outcomes.add(`${String(removal.statusCode)}/${String(booking.statusCode)}`);
        const booked = await sql<{ entry_id: string }[]>`
          SELECT entry_id FROM gym_pt_appointments WHERE gym_id = ${gym.id} AND trainer_user_id = ${sam.userId} AND status = 'booked'`;
        if (await isStaff(gym, sam)) {
          // The booking landed first: the box no longer named everything, so nobody was removed.
          expect([removal.statusCode, booking.statusCode], `round ${String(round)}`).toEqual([409, 200]);
          expect(booked.map((b) => b.entry_id).sort()).toEqual([maya, noor].sort());
          expect([await left(mayaPack), await left(noorPack)]).toEqual([9, 9]);
        } else {
          // The removal landed first: the booking found nobody to book with.
          expect([removal.statusCode, booking.statusCode], `round ${String(round)}`).toEqual([200, 404]);
          expect(booked).toEqual([]);
          expect([await left(mayaPack), await left(noorPack)]).toEqual([10, 10]);
        }
      }
      for (const outcome of outcomes) expect(["200/404", "409/200"]).toContain(outcome);
    },
    T,
  );

  it(
    "CAME OR NO-SHOW: only once the session has started, never a cancelled one, by whoever runs the timetable or the session's own trainer; the mark can be changed, and the pack stays charged",
    async () => {
      clock = NOW.getTime();
      const gym = await makeGym("Came Or Not");
      const elsewhere = await makeGym("Came Elsewhere");
      const pack = await typeOf(gym, { kind: "pack", name: "PT 10" });
      const sam = await trainerWith(gym, "Sam Trainer");
      const tara = await trainerWith(gym, "Tara Trainer");
      const tom = await trainerWith(elsewhere, "Tom Elsewhere");
      const maya = await onList(gym, "Maya Listed");
      const mayaPack = await hold(gym, maya, pack, { pack: 10 });
      const nine = await book(gym, sam, maya, 540, TODAY); // 09:00
      const ten = await book(gym, sam, maya, 600, TODAY); // 10:00
      const cancelled = await book(gym, sam, maya, 660, TODAY);
      const late = await book(gym, sam, maya, 720, TODAY);
      expect((await inject("POST", `/v1/orgs/${gym.id}/pt/appointments/${cancelled}/cancel`, gym.owner.cookies, { lateOk: false, giveBack: false })).statusCode).toBe(200);
      expect(await left(mayaPack)).toBe(7);

      // BEFORE IT STARTS nothing can be marked, to the millisecond.
      const notYet = await markRaw(gym, nine, "attended");
      expect([notYet.statusCode, (JSON.parse(notYet.body) as { error: string }).error]).toEqual([409, "not_started"]);
      clock = new Date("2026-10-07T08:00:00Z").getTime() - 1;
      expect((await markRaw(gym, nine, "no_show")).statusCode).toBe(409);
      expect((await weekOf(gym, sam, null)).days[0]?.appointments.map((a) => [a.id, a.canMark])).toEqual([
        [nine, false],
        [ten, false],
        [late, false],
      ]);
      // AT THE VERY INSTANT it starts, it has started.
      clock = new Date("2026-10-07T08:00:00Z").getTime();
      expect((await weekOf(gym, sam, null)).days[0]?.appointments.map((a) => [a.id, a.canMark, a.cancel])).toEqual([
        [nine, true, null],
        [ten, false, "late"],
        [late, false, "free"], // 12:00 is three hours off, and the gym's free time is two
      ]);
      expect((await stateOf(gym, [nine]))[0]).toEqual(["booked", true]);

      // WHO MAY: not a stranger, not another gym's staff, not another trainer of this gym.
      expect((await markRaw(gym, nine, "attended", elsewhere.owner)).statusCode).toBe(404);
      expect((await markRaw(gym, nine, "attended", tom)).statusCode).toBe(404);
      expect((await markRaw(elsewhere, nine, "attended", elsewhere.owner)).statusCode).toBe(404);
      expect((await markRaw(gym, nine, "attended", tara)).statusCode).toBe(403);
      expect((await markRaw(gym, randomUUID(), "attended")).statusCode).toBe(404);
      // WHAT: only came or no-show.
      for (const bad of ["booked", "cancelled", "late_cancelled", "", null, 1]) expect((await markRaw(gym, nine, bad)).statusCode).toBe(400);
      expect((await stateOf(gym, [nine]))[0]).toEqual(["booked", true]);

      // The session's own trainer marks it; the same mark again changes nothing; whoever
      // runs the timetable changes it, on the other server.
      const cameView = await marked(gym, nine, "attended", sam);
      expect([cameView.status, cameView.canMark, cameView.cancel, cameView.packCharged]).toEqual(["attended", true, null, true]);
      expect((await marked(gym, nine, "attended", sam)).status).toBe("attended");
      const changed = await markRaw(gym, nine, "no_show", gym.owner, other());
      expect([changed.statusCode, (JSON.parse(changed.body) as { appointment: PtAppointment }).appointment.status]).toEqual([200, "no_show"]);
      expect((await marked(gym, nine, "attended")).status).toBe("attended");
      expect((await auditOf(gym, "org.pt_marked", nine)).map((m) => [m["was"], m["status"]])).toEqual([
        ["booked", "attended"],
        ["attended", "no_show"],
        ["no_show", "attended"],
      ]);
      // A session that took place cannot be cancelled, and its time is still the trainer's.
      expect((await inject("POST", `/v1/orgs/${gym.id}/pt/appointments/${nine}/cancel`, gym.owner.cookies, { lateOk: true, giveBack: true })).statusCode).toBe(409);

      // A CANCELLED session, free or late, is never marked.
      clock = new Date("2026-10-07T09:30:00Z").getTime();
      expect((await inject("POST", `/v1/orgs/${gym.id}/pt/appointments/${late}/cancel`, gym.owner.cookies, { lateOk: true, giveBack: false })).statusCode).toBe(200);
      clock = new Date("2026-10-07T12:30:00Z").getTime();
      for (const id of [cancelled, late]) {
        const res = await markRaw(gym, id, "attended");
        expect([res.statusCode, (JSON.parse(res.body) as { error: string }).error]).toEqual([409, "mark_cancelled"]);
      }
      await marked(gym, ten, "no_show");
      expect(await stateOf(gym, [nine, ten, cancelled, late])).toEqual([
        ["attended", true],
        ["no_show", true],
        ["cancelled", false],
        ["late_cancelled", true],
      ]);
      // No mark moved the pack: three sessions stay used, the free cancel came back before.
      expect(await left(mayaPack)).toBe(7);

      // SEVERAL STAFF AT ONE ADDRESS (a front desk): sixty marks by three people, none slowed.
      const manager = await staff(gym, "Mona Manager", "manager");
      oneAddress = `10.86.${String(Math.floor(Math.random() * 250))}.${String(1 + Math.floor(Math.random() * 250))}`;
      try {
        const codes: number[] = [];
        for (let n = 0; n < 20; n++) {
          for (const who of [gym.owner, sam, manager]) codes.push((await markRaw(gym, nine, n % 2 === 0 ? "no_show" : "attended", who)).statusCode);
        }
        expect([codes.length, codes.every((code) => code === 200)]).toEqual([60, true]);
      } finally {
        oneAddress = null;
      }

      // A TRAINER TAKEN OFF THE STAFF marks nothing, not even their own old session; whoever
      // runs the timetable still can.
      expect((await offStaff(gym, sam, null)).statusCode).toBe(200); // nothing of his is still to come
      expect((await markRaw(gym, ten, "attended", sam)).statusCode).toBe(404);
      expect((await stateOf(gym, [ten]))[0]).toEqual(["no_show", true]);
      expect((await marked(gym, ten, "attended", manager)).status).toBe("attended");
    },
    T,
  );

  it(
    "a session marked came or no-show still counts against a membership's limit a week (17e-v), where a free cancel does not",
    async () => {
      clock = NOW.getTime();
      const gym = await makeGym("Limit Still Counts");
      const twoAWeek = await typeOf(gym, { name: "Two a week", aWeek: 2 });
      const sam = await trainerWith(gym, "Sam Trainer");
      const maya = await onList(gym, "Maya Limited");
      await hold(gym, maya, twoAWeek);
      const first = await book(gym, sam, maya, 540, TODAY);
      const secondOne = await book(gym, sam, maya, 600, TODAY);
      const refusedAt = async (minute: number, day: string): Promise<[number, string]> => {
        const res = await bookRaw(gym, sam, maya, minute, day);
        return [res.statusCode, (JSON.parse(res.body) as { error?: string }).error ?? ""];
      };
      expect(await refusedAt(540, FRIDAY)).toEqual([409, "limit_week"]);

      clock = new Date("2026-10-07T09:30:00Z").getTime(); // both have started
      await marked(gym, first, "attended");
      await marked(gym, secondOne, "no_show");
      // Both marked: the week's two are still used, by the came one and by the missed one.
      expect(await refusedAt(540, FRIDAY)).toEqual([409, "limit_week"]);
      await marked(gym, first, "no_show");
      await marked(gym, secondOne, "attended");
      expect(await refusedAt(540, FRIDAY)).toEqual([409, "limit_week"]);
      // The week after has its own two.
      const next = await book(gym, sam, maya, 540, MONDAY);
      // THE CONTROL: a free cancel does give one back, so the refusals above were the marks'.
      expect((await inject("POST", `/v1/orgs/${gym.id}/pt/appointments/${next}/cancel`, gym.owner.cookies, { lateOk: false, giveBack: false })).statusCode).toBe(200);
      await book(gym, sam, maya, 600, MONDAY);
      await book(gym, sam, maya, 660, MONDAY);
      expect(await refusedAt(720, MONDAY)).toEqual([409, "limit_week"]);
    },
    T,
  );

  it(
    "the week turns back to days gone by, so yesterday's session can be marked: nothing on them is free, and no further back than four weeks",
    async () => {
      clock = new Date("2026-10-06T06:30:00Z").getTime(); // Tuesday morning
      const gym = await makeGym("Yesterday");
      const sam = await trainerWith(gym, "Sam Trainer");
      const tara = await trainerWith(gym, "Tara Trainer");
      const maya = await onList(gym, "Maya Listed");
      const tuesdays = await book(gym, sam, maya, 540, TUESDAY);
      clock = HALF_NINE.getTime(); // Wednesday 09:30

      const back = await weekOf(gym, sam, TUESDAY, sam);
      expect([back.from, back.today, back.firstDay]).toEqual([TUESDAY, TODAY, "2026-09-09"]);
      const [tuesday, wednesday] = back.days;
      expect([tuesday?.localDate, tuesday?.free, tuesday?.appointments.map((a) => [a.id, a.status, a.canMark, a.cancel])]).toEqual([
        TUESDAY,
        [],
        [[tuesdays, "booked", true, null]],
      ]);
      // Today, at 09:30: 09:00 has gone, the rest of the morning is free.
      expect(wednesday?.free).toEqual([600, 660, 720]);
      expect((await marked(gym, tuesdays, "no_show", sam)).status).toBe("no_show");
      expect((await weekOf(gym, sam, TUESDAY, sam)).days[0]?.appointments.map((a) => a.status)).toEqual(["no_show"]);
      // Further back than four weeks is the first day it can show; with no day, today.
      expect((await weekOf(gym, sam, "2026-01-01")).from).toBe("2026-09-09");
      expect((await weekOf(gym, sam, null)).from).toBe(TODAY);
      // Another trainer still cannot read this trainer's days, back or forward.
      expect((await inject("GET", `/v1/orgs/${gym.id}/pt/week?trainer=${sam.userId}&from=${TUESDAY}`, tara.cookies)).statusCode).toBe(403);
    },
    T,
  );
});
