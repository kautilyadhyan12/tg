// PERSONAL TRAINING SESSIONS WHEN A PERSON LEAVES — the routes against real Postgres
// (DATABASE_URL-gated), on two api instances over one database. Spec Part 3 §13.5;
// ROADMAP 17e-iv-a.
//
// The worst thing this job could do to a real person: a member who stays loses a paid
// session because somebody else was removed, or a removed person keeps a session and
// their pack never has it back. That is the first test.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { MemberPtResponse, MemberRemovePreview, PtSessionsEnding } from "@app/shared";
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
  JWT_SECRET: "personal-training-leavers-secret-012345", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 180_000;
const LIVE_PLAN = "zz_ptl_live";
/** Wednesday 7 October 2026, 07:30 in London (summer time, one hour ahead of UTC). */
const NOW = new Date("2026-10-07T06:30:00Z");
const TODAY = "2026-10-07";
const THURSDAY = "2026-10-08";
const FRIDAY = "2026-10-09";
const MONDAY = "2026-10-12";

let ipCounter = 0;
const nextIp = () => `10.83.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
const redisUrl = process.env["TEST_REDIS_URL"];
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

/** A whole list as a gym's software exports it: name, email, status. */
const fileOf = (people: readonly [string, string, string][]): string =>
  Buffer.from(["Full Name,Email,Status", ...people.map((p) => p.join(","))].join("\r\n"), "utf8").toString("base64");

d("personal training sessions when a person leaves (real Postgres, two api instances)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let clock = NOW.getTime();
  let app: App | undefined;
  let second: App | undefined;
  let redis: RedisLike | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const other = (): App => second ?? api();

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'ptl-t-%@example.com')`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_pt_appointments WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_trainers WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_bookings WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_uploads WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'ptl-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, cookies: Cookies, payload?: unknown, target = api()) =>
    target.inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });

  interface Person {
    userId: string;
    cookies: Cookies;
    name: string;
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `ptl-t-${uniq()}@example.com`;
    const reg = await inject("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await inject("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login), name: displayName };
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
  const staff = async (gym: Gym, name: string): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${person.userId}, 'trainer', ${null})`;
    return person;
  };
  /** Somebody on the gym's list with no app. */
  const onList = async (gym: Gym, name: string, email = `ptl-l-${uniq()}@example.com`): Promise<string> => {
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName: name, email, status: "Active" });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };
  type Member = Person & { entryId: string };
  /** A member of the app whose record is on the gym's list. */
  const member = async (gym: Gym, name: string): Promise<Member> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${gym.id}, ${person.userId}, '2026-01-01T00:00:00Z')`;
    const entryId = await onList(gym, name);
    await sql`UPDATE gym_members SET entry_id = ${entryId} WHERE gym_id = ${gym.id} AND user_id = ${person.userId}`;
    return { ...person, entryId };
  };

  const typeOf = async (gym: Gym, over: { kind?: "recurring" | "pack"; name?: string } = {}): Promise<string> => {
    const pack = over.kind === "pack";
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_membership_types
        (gym_id, name, kind, price_minor, currency, term_count, term_unit, pack_classes, pack_days, access, covers_all_classes, includes_pt)
      VALUES (${gym.id}, ${over.name ?? `Type ${uniq()}`}, ${over.kind ?? "recurring"}, 4000, 'GBP', ${pack ? null : 1}, ${pack ? null : "month"},
              ${pack ? 10 : null}, ${pack ? 60 : null}, 'all_classes', true, true)
      RETURNING id`;
    if (row === undefined) throw new Error("no type");
    return row.id;
  };
  const hold = async (gym: Gym, entryId: string, typeId: string, over: { pack?: number; paidPeriods?: number } = {}): Promise<string> => {
    const pack = over.pack !== undefined;
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_held_memberships
        (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, pack_classes, pack_days,
         classes_left, starts_on, status, renews, paid_periods)
      VALUES (${gym.id}, ${entryId}, ${typeId}, gen_random_uuid(), ${pack ? "pack" : "recurring"}, 4000, 'GBP', ${pack ? null : 1}, ${pack ? null : "month"},
              ${pack ? 10 : null}, ${pack ? 60 : null}, ${over.pack ?? null}, '2026-10-01'::date, 'active', ${!pack}, ${over.paidPeriods ?? 0})
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
  const trainerWith = async (gym: Gym, name: string): Promise<Person> => {
    const person = await staff(gym, name);
    const res = await inject("PUT", `/v1/orgs/${gym.id}/pt/trainers/${person.userId}`, gym.owner.cookies, { offers: true, sessionMinutes: 60, hours: EVERY_MORNING });
    expect(res.statusCode, res.body).toBe(200);
    return person;
  };
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
  interface Row {
    id: string;
    status: string;
    pack_charged: boolean;
    cancelled: boolean;
  }
  const rows = async (gym: Gym): Promise<Map<string, Row>> => {
    const found = await sql<Row[]>`
      SELECT id, status, pack_charged, cancelled_at IS NOT NULL AS cancelled FROM gym_pt_appointments WHERE gym_id = ${gym.id}`;
    return new Map(found.map((r) => [r.id, r]));
  };
  /** [status, still charged to its pack] of each session, in the order asked. */
  const stateOf = async (gym: Gym, ids: readonly string[]): Promise<[string, boolean][]> => {
    const all = await rows(gym);
    return ids.map((id) => {
      const row = all.get(id);
      if (row === undefined) throw new Error(`no session ${id}`);
      return [row.status, row.pack_charged];
    });
  };
  const former = async (gym: Gym, entryId: string): Promise<boolean> => {
    const [row] = await sql<{ former: boolean }[]>`SELECT former_at IS NOT NULL AS former FROM gym_member_list_entries WHERE gym_id = ${gym.id} AND id = ${entryId}`;
    if (row === undefined) throw new Error("no record");
    return row.former;
  };
  const freeOn = async (gym: Gym, reader: Person, trainer: Person, day: string): Promise<number[]> => {
    const res = await inject("GET", `/v1/orgs/${gym.id}/member-pt?week=0`, reader.cookies);
    expect(res.statusCode, res.body).toBe(200);
    const view = JSON.parse(res.body) as MemberPtResponse;
    const found = view.trainers.find((t) => t.trainerId === trainer.userId)?.days.find((x) => x.localDate === day);
    if (found === undefined) throw new Error(`no ${day} for that trainer`);
    return found.free;
  };

  const takeOff = (gym: Gym, entryId: string, mark: string | null, who: Person = gym.owner, target = api()) =>
    inject("DELETE", `/v1/orgs/${gym.id}/member-list/entries/${entryId}${mark === null ? "" : `?confirmPtSessions=${mark}`}`, who.cookies, undefined, target);
  interface Asked {
    error: string;
    sessions: PtSessionsEnding;
  }
  const asked = (res: { statusCode: number; body: string }): PtSessionsEnding => {
    expect(res.statusCode, res.body).toBe(409);
    const body = JSON.parse(res.body) as Asked;
    expect(body.error).toBe("pt_sessions_ending");
    return body.sessions;
  };
  const previewOf = async (gym: Gym, entryIds: readonly string[]): Promise<MemberRemovePreview> => {
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/selected/remove-preview`, gym.owner.cookies, { selection: { kind: "ticked", entryIds } });
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { preview: MemberRemovePreview }).preview;
  };
  const removeTicked = (gym: Gym, entryIds: readonly string[], digest: string, target = api()) =>
    inject("POST", `/v1/orgs/${gym.id}/member-list/selected/remove`, gym.owner.cookies, { selection: { kind: "ticked", entryIds }, digest }, target);
  const cancelMembership = (gym: Gym, entryId: string, membershipId: string, body: Record<string, unknown>) =>
    inject("POST", `/v1/orgs/${gym.id}/member-list/entries/${entryId}/memberships/${membershipId}/cancel`, gym.owner.cookies, body);

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    redis = redisUrl === undefined || redisUrl === "" ? createMemoryRedis() : createIoRedis(redisUrl);
    for (let tries = 0; (await redis.incrWithTtl(`ptl-ready:${randomUUID()}`, 30)) === null; tries++) {
      if (tries === 100) throw new Error("the Redis at TEST_REDIS_URL never connected");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const overrides = { redis, orgs: { now: () => new Date(clock) } };
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
    "THE WORST THING: taking one person off the list ends exactly their coming sessions and gives their pack those back; nobody else's session or pack moves",
    async () => {
      clock = NOW.getTime();
      const gym = await makeGym("Worst Thing PT");
      const elsewhere = await makeGym("Other Town PT");
      const pack = await typeOf(gym, { kind: "pack", name: "PT 10" });
      const monthly = await typeOf(gym, { name: "Gold with PT" });
      const sam = await trainerWith(gym, "Sam Trainer");
      const maya = await member(gym, "Maya Member");
      const noor = await member(gym, "Noor Zzyzx");
      const wendy = await onList(gym, "Wendy Walkin Vvk");
      const mayaPack = await hold(gym, maya.entryId, pack, { pack: 10 });
      const noorPack = await hold(gym, noor.entryId, pack, { pack: 10 });
      await hold(gym, wendy, monthly);
      // Another gym, its own trainer and person, at the very same time as Maya's.
      const olgaPackType = await typeOf(elsewhere, { kind: "pack", name: "Their pack" });
      const tom = await trainerWith(elsewhere, "Tom Elsewhere");
      const olga = await onList(elsewhere, "Olga Elsewhere");
      const olgaPack = await hold(elsewhere, olga, olgaPackType, { pack: 10 });
      const olgas = await book(elsewhere, tom, olga, 600);

      // EVERY CLASS OF SESSION Maya can have, one of each.
      const coming = await book(gym, sam, maya.entryId, 600); // Friday 10:00
      const comingLater = await book(gym, sam, maya.entryId, 540, MONDAY);
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
      expect(await left(mayaPack)).toBe(4); // seven booked, one cancelled free
      // The people who stay.
      const noors = await book(gym, sam, noor.entryId, 660);
      const wendys = await book(gym, sam, wendy, 720);
      expect([await left(noorPack), await left(olgaPack)]).toEqual([9, 9]);
      // 09:30: today's session has started.
      clock = new Date("2026-10-07T08:30:00Z").getTime();

      const everybody = [coming, comingLater, started, keptLate, came, missed, cancelledFree, noors, wendys];
      const before = await stateOf(gym, everybody);

      // 1. IT ASKS FIRST, and names Maya's two coming sessions and nobody else's.
      const first = await takeOff(gym, maya.entryId, null);
      const box = asked(first);
      expect([box.count, box.packSessions, box.sessions.map((s) => s.id)]).toEqual([2, 2, [coming, comingLater]]);
      expect(box.sessions.map((s) => [s.personName, s.trainerName, s.localDate, s.localStartMinute, s.packSession])).toEqual([
        ["Maya Member", "Sam Trainer", FRIDAY, 600, true],
        ["Maya Member", "Sam Trainer", MONDAY, 540, true],
      ]);
      for (const secret of ["Noor", "Zzyzx", "Wendy", "Vvk", "Olga", noors, wendys, olgas, noor.entryId, wendy]) {
        expect(first.body.includes(secret), `the box holds "${secret}"`).toBe(false);
      }
      // Asking wrote nothing, and neither does a mark that is not this box's.
      expect(asked(await takeOff(gym, maya.entryId, "0".repeat(64))).mark).toBe(box.mark);
      expect([await stateOf(gym, everybody), await former(gym, maya.entryId), await left(mayaPack)]).toEqual([before, false, 4]);

      // 2. A STRANGER, and staff who may not change the list, do nothing with the right mark.
      const stranger = await takeOff(gym, maya.entryId, box.mark, elsewhere.owner);
      expect([403, 404]).toContain(stranger.statusCode);
      expect((await takeOff(gym, maya.entryId, box.mark, sam)).statusCode).toBe(403);
      expect((await takeOff(elsewhere, maya.entryId, box.mark, elsewhere.owner)).statusCode).toBe(404);
      expect([await stateOf(gym, everybody), await former(gym, maya.entryId), await left(mayaPack)]).toEqual([before, false, 4]);

      // 3. CONFIRMED: exactly those two end, and her pack has exactly two back.
      const done = await takeOff(gym, maya.entryId, box.mark);
      expect(done.statusCode, done.body).toBe(200);
      expect(await former(gym, maya.entryId)).toBe(true);
      const [audit] = await sql<{ meta: Record<string, string> }[]>`
        SELECT meta FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.member_list_entry_taken_off' AND target_id = ${maya.entryId}`;
      expect([audit?.meta["ptSessionsEnded"], audit?.meta["ptPackSessionsBack"]]).toEqual(["2", "2"]);
      expect(JSON.stringify(audit?.meta).includes("Maya")).toBe(false);
      expect(await stateOf(gym, everybody)).toEqual([
        ["cancelled", false], // coming: ended, given back
        ["cancelled", false], // coming later: ended, given back
        ["booked", true], // started: history, still hers and still charged
        ["late_cancelled", true], // a late cancel that kept the session used stays used
        ["attended", true],
        ["no_show", true],
        ["cancelled", false], // already cancelled: not given back a second time
        ["booked", true], // Noor's
        ["booked", false], // Wendy's, on a membership
      ]);
      expect([await left(mayaPack), await left(noorPack), await left(olgaPack)]).toEqual([6, 9, 9]);
      expect(await stateOf(elsewhere, [olgas])).toEqual([["booked", true]]);
      // The trainer's time is free again: Noor is offered Friday 10:00, and not her own 11:00.
      expect(await freeOn(gym, noor, sam, FRIDAY)).toEqual([540, 600]);

      // 4. THE SAME REQUEST AGAIN, on the other server: nothing more ends or comes back.
      const again = await takeOff(gym, maya.entryId, box.mark, gym.owner, other());
      expect(again.statusCode, again.body).toBe(200);
      expect([await left(mayaPack), await left(noorPack)]).toEqual([6, 9]);

      // 5. PUT BACK brings no session back.
      const back = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries/${maya.entryId}/restore`, gym.owner.cookies, {});
      expect(back.statusCode, back.body).toBe(200);
      expect(await former(gym, maya.entryId)).toBe(false);
      expect((await stateOf(gym, [coming, comingLater])).map(([status]) => status)).toEqual(["cancelled", "cancelled"]);
      expect(await left(mayaPack)).toBe(6);
    },
    T,
  );

  it(
    "Remove on the people ticked: the box names their sessions, a session booked while it is open shows the box again, and only the ticked lose theirs",
    async () => {
      clock = NOW.getTime();
      const gym = await makeGym("Ticked PT");
      const pack = await typeOf(gym, { kind: "pack", name: "PT 10" });
      const sam = await trainerWith(gym, "Sam Trainer");
      const ann = await member(gym, "Ann Ticked");
      const bea = await onList(gym, "Bea Ticked");
      const cy = await member(gym, "Cy Stays");
      const annPack = await hold(gym, ann.entryId, pack, { pack: 10 });
      const beaPack = await hold(gym, bea, pack, { pack: 10 });
      const cyPack = await hold(gym, cy.entryId, pack, { pack: 10 });
      const anns = await book(gym, sam, ann.entryId, 540);
      const beas = await book(gym, sam, bea, 600);
      const cys = await book(gym, sam, cy.entryId, 660);

      const ticked = [ann.entryId, bea];
      const box = await previewOf(gym, ticked);
      expect([box.ptSessions?.count, box.ptSessions?.packSessions, box.ptSessions?.sessions.map((s) => s.id)]).toEqual([2, 2, [anns, beas]]);
      // Somebody with no session has a box that says nothing about sessions.
      const dee = await onList(gym, "Dee Nosession");
      expect((await previewOf(gym, [dee])).ptSessions).toBeUndefined();

      // A session booked for Bea while the box is open: the press removes nobody.
      const late = await book(gym, sam, bea, 720);
      const stale = await removeTicked(gym, ticked, box.digest);
      expect(stale.statusCode, stale.body).toBe(409);
      const moved = JSON.parse(stale.body) as { error: string; preview: MemberRemovePreview };
      expect([moved.error, moved.preview.ptSessions?.count]).toEqual(["remove_changed", 3]);
      expect([await former(gym, ann.entryId), await former(gym, bea), await stateOf(gym, [anns, beas, late, cys])]).toEqual([
        false,
        false,
        [
          ["booked", true],
          ["booked", true],
          ["booked", true],
          ["booked", true],
        ],
      ]);

      // The box they have now read: both removed, their three sessions ended, Cy untouched.
      const done = await removeTicked(gym, ticked, moved.preview.digest, other());
      expect(done.statusCode, done.body).toBe(200);
      expect(await stateOf(gym, [anns, beas, late, cys])).toEqual([
        ["cancelled", false],
        ["cancelled", false],
        ["cancelled", false],
        ["booked", true],
      ]);
      expect([await left(annPack), await left(beaPack), await left(cyPack)]).toEqual([10, 10, 9]);
      const [summary] = await sql<{ meta: Record<string, string> }[]>`
        SELECT meta FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.member_list_selected_removed'`;
      expect([summary?.meta["moved"], summary?.meta["ptSessionsEnded"], summary?.meta["ptPackSessionsBack"]]).toEqual(["2", "3", "3"]);
      // The same press again: done already, nothing more.
      const again = await removeTicked(gym, ticked, moved.preview.digest);
      expect(again.statusCode, again.body).toBe(200);
      expect([await left(annPack), await left(beaPack), await left(cyPack)]).toEqual([10, 10, 9]);
    },
    T,
  );

  it(
    "Remove from In the app, one person and several: each asks first and ends that person's sessions with their record",
    async () => {
      clock = NOW.getTime();
      const gym = await makeGym("Roster PT");
      const pack = await typeOf(gym, { kind: "pack", name: "PT 10" });
      const sam = await trainerWith(gym, "Sam Trainer");
      const eve = await member(gym, "Eve Roster");
      const fay = await member(gym, "Fay Roster");
      const gus = await member(gym, "Gus Stays");
      const evePack = await hold(gym, eve.entryId, pack, { pack: 10 });
      const fayPack = await hold(gym, fay.entryId, pack, { pack: 10 });
      const gusPack = await hold(gym, gus.entryId, pack, { pack: 10 });
      const eves = await book(gym, sam, eve.entryId, 540);
      const fays = await book(gym, sam, fay.entryId, 600);
      const guss = await book(gym, sam, gus.entryId, 660);

      // One person, from their panel.
      const one = (mark: string | null) =>
        inject("DELETE", `/v1/orgs/${gym.id}/members/${eve.userId}${mark === null ? "" : `?confirmPtSessions=${mark}`}`, gym.owner.cookies);
      const box = asked(await one(null));
      expect([box.count, box.sessions.map((s) => s.id)]).toEqual([1, [eves]]);
      expect([await former(gym, eve.entryId), await stateOf(gym, [eves]), await left(evePack)]).toEqual([false, [["booked", true]], 9]);
      const [stillIn] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_members WHERE gym_id = ${gym.id} AND user_id = ${eve.userId} AND removed_at IS NULL`;
      expect(stillIn?.n).toBe(1);
      const gone = await one(box.mark);
      expect(gone.statusCode, gone.body).toBe(200);
      expect([await former(gym, eve.entryId), await stateOf(gym, [eves]), await left(evePack)]).toEqual([true, [["cancelled", false]], 10]);

      // Staff who may remove people from the app but may not read the list are answered no
      // box at all, with a digest of their own making or without: no name, no session.
      const desk = await signedIn("Desk Nolist");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${desk.userId}, 'manager', ${["members.remove"]})`;
      for (const [path, body] of [
        ["remove-preview", { userIds: [fay.userId] }],
        ["remove", { userIds: [fay.userId], digest: "0".repeat(64) }],
      ] as const) {
        const refused = await inject("POST", `/v1/orgs/${gym.id}/members/selected/${path}`, desk.cookies, body);
        expect(refused.statusCode, refused.body).toBe(403);
        for (const secret of [fays, "Fay Roster", "Sam Trainer", fay.entryId]) expect(refused.body.includes(secret), `${path} answers "${secret}"`).toBe(false);
      }
      const lone = await inject("DELETE", `/v1/orgs/${gym.id}/members/${fay.userId}`, desk.cookies);
      expect(lone.statusCode, lone.body).toBe(403);
      expect(lone.body.includes(fays)).toBe(false);
      expect(await stateOf(gym, [fays])).toEqual([["booked", true]]);

      // Several, ticked on In the app.
      const preview = await inject("POST", `/v1/orgs/${gym.id}/members/selected/remove-preview`, gym.owner.cookies, { userIds: [fay.userId] });
      expect(preview.statusCode, preview.body).toBe(200);
      const roster = (JSON.parse(preview.body) as { preview: MemberRemovePreview }).preview;
      expect(roster.ptSessions?.sessions.map((s) => s.id)).toEqual([fays]);
      const pressed = await inject("POST", `/v1/orgs/${gym.id}/members/selected/remove`, gym.owner.cookies, { userIds: [fay.userId], digest: roster.digest });
      expect(pressed.statusCode, pressed.body).toBe(200);
      expect([await stateOf(gym, [fays, guss]), await left(fayPack), await left(gusPack)]).toEqual([
        [
          ["cancelled", false],
          ["booked", true],
        ],
        10,
        9,
      ]);
    },
    T,
  );

  it(
    "an import's They've left ends the leavers' sessions, named in its box; somebody marked Still a member keeps theirs",
    async () => {
      clock = NOW.getTime();
      const gym = await makeGym("Import PT");
      const sam = await trainerWith(gym, "Sam Trainer");
      const leoEmail = `ptl-l-${uniq()}@example.com`;
      const ivyEmail = `ptl-l-${uniq()}@example.com`;
      const keptEmail = `ptl-l-${uniq()}@example.com`;
      const leo = await onList(gym, "Leo Leaver", leoEmail);
      const ivy = await onList(gym, "Ivy Stillhere", ivyEmail);
      const ken = await onList(gym, "Ken Infile", keptEmail);
      const leos = await book(gym, sam, leo, 540);
      const ivys = await book(gym, sam, ivy, 600);
      const kens = await book(gym, sam, ken, 660);

      const staged = await inject("POST", `/v1/orgs/${gym.id}/member-list/uploads`, gym.owner.cookies, {
        contentBase64: fileOf([["Ken Infile", keptEmail, "Active"]]),
        mode: "whole_list",
      });
      expect(staged.statusCode, staged.body).toBe(201);
      const uploadId = (JSON.parse(staged.body) as { preview: { uploadId: string } }).preview.uploadId;
      const base = `/v1/orgs/${gym.id}/member-list/uploads/${uploadId}`;
      const missing = (JSON.parse((await inject("GET", `${base}/missing`, gym.owner.cookies)).body) as { missing: { digest: string } }).missing;
      const marks = { missingDigest: missing.digest, left: [leo], stay: [ivy] };
      const boxOf = async (): Promise<MemberRemovePreview> => {
        const res = await inject("POST", `${base}/leavers`, gym.owner.cookies, { marks });
        expect(res.statusCode, res.body).toBe(200);
        return (JSON.parse(res.body) as { leavers: { preview: MemberRemovePreview } }).leavers.preview;
      };
      const box = await boxOf();
      expect(box.ptSessions?.sessions.map((s) => [s.id, s.personName])).toEqual([[leos, "Leo Leaver"]]);

      // Another session for Leo while the box is open: the import writes nothing.
      const late = await book(gym, sam, leo, 720);
      const stale = await inject("POST", `${base}/confirm`, gym.owner.cookies, { permissionConfirmed: true, marks, leaversDigest: box.digest });
      expect([stale.statusCode, (JSON.parse(stale.body) as { error: string }).error], stale.body).toEqual([409, "leavers_changed"]);
      expect([await former(gym, leo), (await stateOf(gym, [leos, late])).map(([s]) => s)]).toEqual([false, ["booked", "booked"]]);

      const fresh = await boxOf();
      expect(fresh.ptSessions?.count).toBe(2);
      const done = await inject("POST", `${base}/confirm`, gym.owner.cookies, { permissionConfirmed: true, marks, leaversDigest: fresh.digest });
      expect(done.statusCode, done.body).toBe(200);
      expect([await former(gym, leo), await former(gym, ivy), await former(gym, ken)]).toEqual([true, false, false]);
      expect((await stateOf(gym, [leos, late, ivys, kens])).map(([s]) => s)).toEqual(["cancelled", "cancelled", "booked", "booked"]);
      const [imported] = await sql<{ meta: Record<string, string> }[]>`SELECT meta FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.pt_sessions_ended'`;
      expect(imported?.meta).toEqual({ via: "import", ptSessionsEnded: "2", ptPackSessionsBack: "0" });
    },
    T,
  );

  it(
    "a membership staff cancel ends the sessions booked on it, asked first; a session on the person's other membership stays",
    async () => {
      clock = NOW.getTime();
      const gym = await makeGym("Cancel PT");
      const monthly = await typeOf(gym, { name: "Gold with PT" });
      const packType = await typeOf(gym, { kind: "pack", name: "PT 10" });
      const sam = await trainerWith(gym, "Sam Trainer");
      const pia = await member(gym, "Pia Holder");
      const quin = await onList(gym, "Quin Other");

      // Pia's pack alone first, so two sessions are charged to it; then the membership,
      // which pays first from then on.
      const piaPack = await hold(gym, pia.entryId, packType, { pack: 10 });
      const onPack = await book(gym, sam, pia.entryId, 540);
      const onPackToo = await book(gym, sam, pia.entryId, 600);
      const gold = await hold(gym, pia.entryId, monthly, { paidPeriods: 1 });
      const onGold = await book(gym, sam, pia.entryId, 660);
      const onGoldLater = await book(gym, sam, pia.entryId, 540, MONDAY);
      const quinGold = await hold(gym, quin, monthly, { paidPeriods: 1 });
      const quins = await book(gym, sam, quin, 720);
      const held = await sql<{ id: string; held_membership_id: string | null }[]>`
        SELECT id, held_membership_id FROM gym_pt_appointments WHERE gym_id = ${gym.id}`;
      const heldBy = new Map(held.map((r) => [r.id, r.held_membership_id]));
      expect([onPack, onPackToo, onGold, onGoldLater, quins].map((id) => heldBy.get(id))).toEqual([piaPack, piaPack, gold, gold, quinGold]);
      expect(await left(piaPack)).toBe(8);

      // THE MEMBERSHIP: asked first, naming the two sessions booked on it.
      const first = await cancelMembership(gym, pia.entryId, gold, { when: "today" });
      expect(first.statusCode, first.body).toBe(409);
      const ask = JSON.parse(first.body) as { error: string; message: string; ending: { booked: number; ptSessions?: PtSessionsEnding } };
      expect([ask.error, ask.ending.booked, ask.ending.ptSessions?.count, ask.ending.ptSessions?.packSessions]).toEqual(["membership_has_bookings", 0, 2, 0]);
      expect(ask.ending.ptSessions?.sessions.map((s) => s.id)).toEqual([onGold, onGoldLater]);
      expect(ask.message).toContain("personal training sessions");
      expect(first.body.includes("Quin")).toBe(false);
      const mark = ask.ending.ptSessions?.mark ?? "";
      // A mark that is not this box's, and another gym's owner, change nothing.
      expect((await cancelMembership(gym, pia.entryId, gold, { when: "today", confirmPtSessions: "0".repeat(64) })).statusCode).toBe(409);
      const elsewhere = await makeGym("Not Their Gym");
      const stranger = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries/${pia.entryId}/memberships/${gold}/cancel`, elsewhere.owner.cookies, {
        when: "today",
        confirmPtSessions: mark,
      });
      expect([403, 404]).toContain(stranger.statusCode);
      expect((await stateOf(gym, [onPack, onPackToo, onGold, onGoldLater, quins])).map(([s]) => s)).toEqual(["booked", "booked", "booked", "booked", "booked"]);

      const done = await cancelMembership(gym, pia.entryId, gold, { when: "today", confirmPtSessions: mark });
      expect(done.statusCode, done.body).toBe(200);
      expect(await stateOf(gym, [onPack, onPackToo, onGold, onGoldLater, quins])).toEqual([
        ["booked", true],
        ["booked", true],
        ["cancelled", false],
        ["cancelled", false],
        ["booked", false],
      ]);
      expect(await left(piaPack)).toBe(8);

      // THE PACK: its two sessions end and go back to it.
      const packAsk = await cancelMembership(gym, pia.entryId, piaPack, { when: "today" });
      expect(packAsk.statusCode, packAsk.body).toBe(409);
      const packBox = (JSON.parse(packAsk.body) as { ending: { ptSessions?: PtSessionsEnding } }).ending.ptSessions;
      expect([packBox?.count, packBox?.packSessions]).toEqual([2, 2]);
      const packDone = await cancelMembership(gym, pia.entryId, piaPack, { when: "today", confirmPtSessions: packBox?.mark });
      expect(packDone.statusCode, packDone.body).toBe(200);
      expect([await stateOf(gym, [onPack, onPackToo]), await left(piaPack)]).toEqual([
        [
          ["cancelled", false],
          ["cancelled", false],
        ],
        10,
      ]);
      expect(await stateOf(gym, [quins])).toEqual([["booked", false]]);
    },
    T,
  );

  it(
    "a membership cancelled at the end of what is paid keeps the sessions inside it and ends those after its last day",
    async () => {
      clock = NOW.getTime();
      const gym = await makeGym("Period End PT");
      const monthly = await typeOf(gym, { name: "Gold with PT" });
      const sam = await trainerWith(gym, "Sam Trainer");
      const rae = await onList(gym, "Rae Runsout");
      // Started 1 October, one month paid: its last day is 31 October.
      const gold = await hold(gym, rae, monthly, { paidPeriods: 1 });
      const inside = await book(gym, sam, rae, 540, "2026-10-30");
      const lastDay = await book(gym, sam, rae, 540, "2026-10-31");
      const after = await book(gym, sam, rae, 540, "2026-11-02");

      const first = await cancelMembership(gym, rae, gold, { when: "period_end" });
      expect(first.statusCode, first.body).toBe(409);
      const box = (JSON.parse(first.body) as { ending: { ptSessions?: PtSessionsEnding } }).ending.ptSessions;
      expect(box?.sessions.map((s) => [s.id, s.localDate])).toEqual([[after, "2026-11-02"]]);
      const done = await cancelMembership(gym, rae, gold, { when: "period_end", confirmPtSessions: box?.mark });
      expect(done.statusCode, done.body).toBe(200);
      expect((await stateOf(gym, [inside, lastDay, after])).map(([s]) => s)).toEqual(["booked", "booked", "cancelled"]);
    },
    T,
  );

  it(
    "a membership with classes and sessions booked on it needs both answers before it is cancelled",
    async () => {
      clock = NOW.getTime();
      const gym = await makeGym("Both PT");
      const monthly = await typeOf(gym, { name: "Gold with PT" });
      const sam = await trainerWith(gym, "Sam Trainer");
      const una = await member(gym, "Una Both");
      const gold = await hold(gym, una.entryId, monthly, { paidPeriods: 1 });
      const session = await book(gym, sam, una.entryId, 540);
      const [type] = await sql<{ id: string }[]>`
        INSERT INTO gym_class_types (gym_id, name, minutes, places, colour, open_gym) VALUES (${gym.id}, 'Spin', 60, 10, 'blue', false) RETURNING id`;
      const [cls] = await sql<{ id: string }[]>`
        INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places, status)
        VALUES (${gym.id}, ${type?.id ?? ""}, ${MONDAY}::date, 1080, '2026-10-12T17:00:00Z', 60, 10, 'scheduled') RETURNING id`;
      await sql`
        INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, held_membership_id, status, request_key, booked_at)
        VALUES (${gym.id}, ${cls?.id ?? ""}, ${una.userId}, ${una.entryId}, ${gold}, 'booked', gen_random_uuid(), now())`;

      const first = await cancelMembership(gym, una.entryId, gold, { when: "today" });
      const ask = JSON.parse(first.body) as { ending: { booked: number; mark: string; ptSessions?: PtSessionsEnding } };
      expect([first.statusCode, ask.ending.booked, ask.ending.ptSessions?.count]).toEqual([409, 1, 1]);
      const mark = ask.ending.ptSessions?.mark;
      expect((await cancelMembership(gym, una.entryId, gold, { when: "today", confirmBookings: ask.ending.mark })).statusCode).toBe(409);
      expect((await cancelMembership(gym, una.entryId, gold, { when: "today", confirmPtSessions: mark })).statusCode).toBe(409);
      expect(await stateOf(gym, [session])).toEqual([["booked", false]]);
      const done = await cancelMembership(gym, una.entryId, gold, { when: "today", confirmBookings: ask.ending.mark, confirmPtSessions: mark });
      expect(done.statusCode, done.body).toBe(200);
      expect(await stateOf(gym, [session])).toEqual([["cancelled", false]]);
      const [booking] = await sql<{ status: string }[]>`SELECT status FROM gym_class_bookings WHERE gym_id = ${gym.id}`;
      expect(booking?.status).toBe("cancelled");
    },
    T,
  );

  it(
    "a removal and a booking at one instant, on two servers: never a past member with a session still booked, and a pack session back once",
    async () => {
      clock = NOW.getTime();
      const gym = await makeGym("Race PT");
      const pack = await typeOf(gym, { kind: "pack", name: "PT 10" });
      const sam = await trainerWith(gym, "Sam Trainer");
      for (let round = 0; round < 6; round++) {
        const zed = await onList(gym, `Zed Race ${String(round)}`);
        const zedPack = await hold(gym, zed, pack, { pack: 10 });
        const day = `2026-10-${String(13 + round)}`;
        const held = await book(gym, sam, zed, 540, day);
        const box = asked(await takeOff(gym, zed, null));
        // The removal that read the box, twice, and a new booking, all at once.
        const [a, b, booked] = await Promise.all([
          takeOff(gym, zed, box.mark, gym.owner, api()),
          takeOff(gym, zed, box.mark, gym.owner, other()),
          bookRaw(gym, sam, zed, 600, day, round % 2 === 0 ? other() : api()),
        ]);
        const isFormer = await former(gym, zed);
        const [live] = await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM gym_pt_appointments WHERE gym_id = ${gym.id} AND entry_id = ${zed} AND status = 'booked'`;
        const packLeft = await left(zedPack);
        if (isFormer) {
          // Removed: nothing of theirs is still booked, and the pack is whole again, once.
          expect([live?.n, packLeft, booked.statusCode], `round ${String(round)}`).toEqual([0, 10, 404]);
          expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
        } else {
          // The booking came first: the box had moved, so nobody was removed.
          expect([live?.n, packLeft, booked.statusCode, a.statusCode, b.statusCode], `round ${String(round)}`).toEqual([2, 8, 200, 409, 409]);
        }
        expect((await stateOf(gym, [held]))[0]?.[0]).toBe(isFormer ? "cancelled" : "booked");
      }
    },
    T,
  );
  it(
    "a session that starts at this very instant has started and stays; a millisecond earlier it is still to come and ends",
    async () => {
      const gym = await makeGym("Edge PT");
      const pack = await typeOf(gym, { kind: "pack", name: "PT 10" });
      const sam = await trainerWith(gym, "Sam Trainer");
      // Friday 10:00 in London is 09:00 UTC.
      const START = new Date("2026-10-09T09:00:00.000Z").getTime();
      clock = NOW.getTime();
      const now = await onList(gym, "Nell Now");
      const before = await onList(gym, "Bea Before");
      const nowPack = await hold(gym, now, pack, { pack: 10 });
      const beforePack = await hold(gym, before, pack, { pack: 10 });
      const atStart = await book(gym, sam, now, 600);
      // A charged session whose pack row has gone has no pack to go back to.
      const orphan = await book(gym, sam, before, 660);
      const kept = await book(gym, sam, before, 720);
      const [gone] = await sql<{ id: string }[]>`
        UPDATE gym_pt_appointments SET held_membership_id = NULL WHERE id = ${orphan} RETURNING id`;
      expect(gone?.id).toBe(orphan);

      // Exactly at its start: nothing is still to come, so nothing is asked and it stays.
      clock = START;
      const straight = await takeOff(gym, now, null);
      expect(straight.statusCode, straight.body).toBe(200);
      expect([await former(gym, now), await stateOf(gym, [atStart]), await left(nowPack)]).toEqual([true, [["booked", true]], 9]);

      // One millisecond before 11:00: both of Bea's are still to come. Only one goes back to a pack.
      clock = START + 60 * 60_000 - 1;
      const box = asked(await takeOff(gym, before, null));
      expect([box.count, box.packSessions, box.sessions.map((s) => [s.id, s.packSession])]).toEqual([
        2,
        1,
        [
          [orphan, false],
          [kept, true],
        ],
      ]);
      // At 11:00 exactly the first has started: the box staff read is no longer the truth.
      clock = START + 60 * 60_000;
      const moved = asked(await takeOff(gym, before, box.mark));
      expect([moved.count, moved.sessions.map((s) => s.id)]).toEqual([1, [kept]]);
      expect(await former(gym, before)).toBe(false);
      const done = await takeOff(gym, before, moved.mark);
      expect(done.statusCode, done.body).toBe(200);
      expect([await stateOf(gym, [orphan, kept]), await left(beforePack)]).toEqual([
        [
          ["booked", true],
          ["cancelled", false],
        ],
        9,
      ]);
    },
    T,
  );

  it(
    "Remove from staff and app: somebody on the staff who trains here is asked about, and removed, the same way",
    async () => {
      clock = NOW.getTime();
      const gym = await makeGym("Staff PT");
      const pack = await typeOf(gym, { kind: "pack", name: "PT 10" });
      const sam = await trainerWith(gym, "Sam Trainer");
      const rae = await member(gym, "Rae Coach");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${rae.userId}, 'trainer', ${null})`;
      const raePack = await hold(gym, rae.entryId, pack, { pack: 10 });
      const raes = await book(gym, sam, rae.entryId, 600);
      const staffRows = async () => (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_staff WHERE gym_id = ${gym.id} AND user_id = ${rae.userId}`)[0]?.n;
      const both = (mark: string | null) =>
        inject("DELETE", `/v1/orgs/${gym.id}/members/${rae.userId}?alsoStaff=true${mark === null ? "" : `&confirmPtSessions=${mark}`}`, gym.owner.cookies);

      const box = asked(await both(null));
      expect([box.count, box.sessions.map((s) => [s.id, s.personName])]).toEqual([1, [[raes, "Rae Coach"]]]);
      // Nothing was half done: still staff, still on the list, still booked.
      expect([await staffRows(), await former(gym, rae.entryId), await stateOf(gym, [raes]), await left(raePack)]).toEqual([1, false, [["booked", true]], 9]);
      const done = await both(box.mark);
      expect(done.statusCode, done.body).toBe(200);
      expect([await staffRows(), await former(gym, rae.entryId), await stateOf(gym, [raes]), await left(raePack)]).toEqual([0, true, [["cancelled", false]], 10]);
    },
    T,
  );

  it(
    "a membership's cancel: a session booked on it while the box is open is asked about again, and a cancel and a booking at one instant leave nothing booked on a cancelled membership",
    async () => {
      clock = NOW.getTime();
      const gym = await makeGym("Stale PT");
      const monthly = await typeOf(gym, { name: "Gold with PT" });
      const sam = await trainerWith(gym, "Sam Trainer");
      const vic = await onList(gym, "Vic Stale");
      const gold = await hold(gym, vic, monthly, { paidPeriods: 1 });
      const first = await book(gym, sam, vic, 540);
      const boxOf = (res: { statusCode: number; body: string }): PtSessionsEnding => {
        expect(res.statusCode, res.body).toBe(409);
        const sessions = (JSON.parse(res.body) as { ending: { ptSessions?: PtSessionsEnding } }).ending.ptSessions;
        if (sessions === undefined) throw new Error("the cancel named no sessions");
        return sessions;
      };
      const box = boxOf(await cancelMembership(gym, vic, gold, { when: "today" }));
      // Booked while the box is open: the mark staff hold is for one session, and there are two.
      const second = await book(gym, sam, vic, 600);
      const stale = boxOf(await cancelMembership(gym, vic, gold, { when: "today", confirmPtSessions: box.mark }));
      expect([stale.count, stale.sessions.map((s) => s.id), stale.mark === box.mark]).toEqual([2, [first, second], false]);
      expect((await stateOf(gym, [first, second])).map(([s]) => s)).toEqual(["booked", "booked"]);

      // The cancel that read the new box, and a third booking, at one instant on two servers.
      const [cancelled, booked] = await Promise.all([
        inject("POST", `/v1/orgs/${gym.id}/member-list/entries/${vic}/memberships/${gold}/cancel`, gym.owner.cookies, { when: "today", confirmPtSessions: stale.mark }, other()),
        bookRaw(gym, sam, vic, 660),
      ]);
      const [live] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM gym_pt_appointments WHERE gym_id = ${gym.id} AND held_membership_id = ${gold} AND status = 'booked'`;
      const [membership] = await sql<{ status: string }[]>`SELECT status FROM gym_held_memberships WHERE id = ${gold}`;
      if (membership?.status === "cancelled") {
        // The cancel was first: nothing is booked on it, and the booking found nothing to pay.
        expect([cancelled.statusCode, live?.n, booked.statusCode === 200]).toEqual([200, 0, false]);
      } else {
        // The booking was first: the box had moved, so the membership was not cancelled.
        expect([cancelled.statusCode, booked.statusCode, live?.n, membership?.status]).toEqual([409, 200, 3, "active"]);
      }
    },
    T,
  );

  it(
    "a removal and a booking, each order on purpose: a booking first moves the box and removes nobody; a removal first leaves nobody to book",
    async () => {
      clock = NOW.getTime();
      const gym = await makeGym("Order PT");
      const pack = await typeOf(gym, { kind: "pack", name: "PT 10" });
      const sam = await trainerWith(gym, "Sam Trainer");

      // The booking first.
      const ada = await onList(gym, "Ada Order");
      const adaPack = await hold(gym, ada, pack, { pack: 10 });
      const held = await book(gym, sam, ada, 540);
      const box = asked(await takeOff(gym, ada, null));
      const later = await book(gym, sam, ada, 600);
      const moved = asked(await takeOff(gym, ada, box.mark, gym.owner, other()));
      expect([moved.sessions.map((s) => s.id), await former(gym, ada), await stateOf(gym, [held, later]), await left(adaPack)]).toEqual([
        [held, later],
        false,
        [
          ["booked", true],
          ["booked", true],
        ],
        8,
      ]);

      // The removal first.
      const done = await takeOff(gym, ada, moved.mark);
      expect(done.statusCode, done.body).toBe(200);
      const refused = await bookRaw(gym, sam, ada, 660, FRIDAY, other());
      expect([refused.statusCode, (JSON.parse(refused.body) as { error: string }).error]).toEqual([404, "person_not_found"]);
      expect([await stateOf(gym, [held, later]), await left(adaPack)]).toEqual([
        [
          ["cancelled", false],
          ["cancelled", false],
        ],
        10,
      ]);
      const [live] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_pt_appointments WHERE gym_id = ${gym.id} AND entry_id = ${ada} AND status = 'booked'`;
      expect(live?.n).toBe(0);
    },
    T,
  );
});
