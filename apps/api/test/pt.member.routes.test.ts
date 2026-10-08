// A MEMBER BOOKS AND CANCELS THEIR OWN PERSONAL TRAINING — the routes against real Postgres
// (DATABASE_URL-gated), on two api instances over one database. Spec Part 3 §13.5;
// ROADMAP 17e-ii.
//
// The worst thing this job could do to a real person: show a member somebody else's name
// or session, or let them cancel, or pay with, another member's. That is the first test.
import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PT_MEMBER_CANCEL_WORDS, PT_MEMBER_WORDS, PT_RECORD_SHARED_WORDS, type MemberPtResponse, type MemberPtSession, type PtWeekResponse } from "@app/shared";
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
  JWT_SECRET: "member-personal-training-secret-0123456", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 180_000;
const LIVE_PLAN = "zz_ptm_live";
/** Wednesday 7 October 2026, 07:30 in London (summer time, one hour ahead of UTC). */
const NOW = new Date("2026-10-07T06:30:00Z");
const TODAY = "2026-10-07";
/** A Friday two days on: far outside the two-hour free-cancel time. */
const FRIDAY = "2026-10-09";

let ipCounter = 0;
const nextIp = () => `10.79.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
const redisUrl = process.env["TEST_REDIS_URL"];
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("a member's own personal training (real Postgres, two api instances)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let clock = NOW.getTime();
  let app: App | undefined;
  let second: App | undefined;
  let redis: RedisLike | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const either = (n: number): App => (n % 2 === 0 ? api() : (second ?? api()));

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'ptm-t-%@example.com')`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_pt_appointments WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_trainer_time_off WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_trainers WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'ptm-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST" | "PUT", path: string, cookies: Cookies, payload?: unknown, ip = nextIp(), target = api()) =>
    target.inject({
      method,
      url: path,
      remoteAddress: ip,
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });

  interface Person {
    userId: string;
    cookies: Cookies;
    name: string;
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `ptm-t-${uniq()}@example.com`;
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
  /** Somebody using the app at this gym, with no record on its list. */
  const appOnly = async (gym: Gym, name: string): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${gym.id}, ${person.userId}, '2026-01-01T00:00:00Z')`;
    return person;
  };
  type Member = Person & { entryId: string };
  /** A member of the app whose record is on the gym's list: what a session hangs on. */
  const member = async (gym: Gym, name: string): Promise<Member> => {
    const person = await appOnly(gym, name);
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName: name, email: `ptm-l-${uniq()}@example.com` });
    expect(res.statusCode, res.body).toBe(201);
    const entryId = (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
    await sql`UPDATE gym_members SET entry_id = ${entryId} WHERE gym_id = ${gym.id} AND user_id = ${person.userId}`;
    return { ...person, entryId };
  };

  const coaches = async (gym: Gym, coach: Person, day: string, startMinute: number, minutes: number, name: string): Promise<void> => {
    const [type] = await sql<{ id: string }[]>`
      INSERT INTO gym_class_types (gym_id, name, minutes, places, colour, open_gym)
      VALUES (${gym.id}, ${name}, ${minutes}, 10, 'blue', false)
      RETURNING id`;
    if (type === undefined) throw new Error("no class type");
    await sql`
      INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places, coach_user_id, status)
      VALUES (${gym.id}, ${type.id}, ${day}::date, ${startMinute}, (${day}::date + make_interval(mins => ${startMinute})) AT TIME ZONE 'Europe/London',
              ${minutes}, 10, ${coach.userId}, 'scheduled')`;
  };

  const typeOf = async (gym: Gym, over: { kind?: "recurring" | "pack"; includesPt?: boolean; name?: string } = {}): Promise<string> => {
    const pack = over.kind === "pack";
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_membership_types
        (gym_id, name, kind, price_minor, currency, term_count, term_unit, pack_classes, pack_days, access, covers_all_classes, includes_pt)
      VALUES (${gym.id}, ${over.name ?? `Type ${uniq()}`}, ${over.kind ?? "recurring"}, 4000, 'GBP', ${pack ? null : 1}, ${pack ? null : "month"},
              ${pack ? 10 : null}, ${pack ? 60 : null}, 'all_classes', true, ${over.includesPt ?? false})
      RETURNING id`;
    if (row === undefined) throw new Error("no type");
    return row.id;
  };
  const hold = async (gym: Gym, entryId: string, typeId: string, over: { pack?: number } = {}): Promise<string> => {
    const pack = over.pack !== undefined;
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_held_memberships
        (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, pack_classes, pack_days,
         classes_left, starts_on, status, renews)
      VALUES (${gym.id}, ${entryId}, ${typeId}, gen_random_uuid(), ${pack ? "pack" : "recurring"}, 4000, 'GBP', ${pack ? null : 1}, ${pack ? null : "month"},
              ${pack ? 10 : null}, ${pack ? 60 : null}, ${over.pack ?? null}, '2026-10-01'::date, 'active', ${!pack})
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
  const MORNING = [540, 600, 660, 720];
  const trainerWith = async (gym: Gym, name: string, hours: object[] = EVERY_MORNING): Promise<Person> => {
    const person = await staff(gym, name);
    const res = await inject("PUT", `/v1/orgs/${gym.id}/pt/trainers/${person.userId}`, gym.owner.cookies, { offers: true, sessionMinutes: 60, hours });
    expect(res.statusCode, res.body).toBe(200);
    return person;
  };

  // ── The member's three routes ──
  const read = async (gym: Gym, who: Person, week = 0): Promise<MemberPtResponse> => {
    const res = await inject("GET", `/v1/orgs/${gym.id}/member-pt?week=${String(week)}`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as MemberPtResponse;
  };
  const freeOf = (view: MemberPtResponse, trainer: Person, day: string): number[] => {
    const found = view.trainers.find((t) => t.trainerId === trainer.userId)?.days.find((x) => x.localDate === day);
    if (found === undefined) throw new Error(`no ${day} for that trainer`);
    return found.free;
  };
  interface BookOpts {
    key?: string;
    day?: string;
    minute?: number;
    minutes?: number;
    ip?: string;
    target?: App;
    extra?: Record<string, unknown>;
  }
  const book = (gym: Gym, who: Person, trainer: Person, opts: BookOpts = {}) =>
    inject(
      "POST",
      `/v1/orgs/${gym.id}/member-pt/sessions`,
      who.cookies,
      { requestKey: opts.key ?? randomUUID(), trainerId: trainer.userId, localDate: opts.day ?? FRIDAY, startMinute: opts.minute ?? 600, minutes: opts.minutes ?? 60, ...opts.extra },
      opts.ip ?? nextIp(),
      opts.target ?? api(),
    );
  const cancel = (gym: Gym, who: Person, id: string, lateOk = false, target = api()) =>
    inject("POST", `/v1/orgs/${gym.id}/member-pt/sessions/${id}/cancel`, who.cookies, { lateOk }, nextIp(), target);
  const made = (res: { statusCode: number; body: string }): MemberPtSession => {
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { session: MemberPtSession }).session;
  };
  const errorOf = (res: { body: string }): string => (JSON.parse(res.body) as { error: string }).error;
  const said = (res: { statusCode: number; body: string }): [number, string, string] => {
    const body = JSON.parse(res.body) as { error: string; message: string };
    return [res.statusCode, body.error, body.message];
  };

  // ── Staff, to set the scene ──
  const staffBook = async (gym: Gym, trainer: Person, entryId: string, minute: number, day = FRIDAY): Promise<string> => {
    const res = await inject("POST", `/v1/orgs/${gym.id}/pt/appointments`, gym.owner.cookies, {
      requestKey: randomUUID(),
      trainerId: trainer.userId,
      entryId,
      localDate: day,
      startMinute: minute,
      minutes: 60,
    });
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { appointment: { id: string } }).appointment.id;
  };
  const rows = (gym: Gym) => sql<{ id: string; status: string; entry_id: string | null; pack_charged: boolean; booked_by: string | null; held_membership_id: string | null }[]>`
    SELECT id, status, entry_id, pack_charged, booked_by, held_membership_id FROM gym_pt_appointments WHERE gym_id = ${gym.id} ORDER BY starts_at, id`;
  const rowOf = async (gym: Gym, id: string) => {
    const row = (await rows(gym)).find((r) => r.id === id);
    if (row === undefined) throw new Error("no such session");
    return row;
  };

  /** A gym with no membership types, and one that sells them. */
  let open: Gym;
  let sells: Gym;
  let ptPack: string;

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    redis = redisUrl === undefined || redisUrl === "" ? createMemoryRedis() : createIoRedis(redisUrl);
    for (let tries = 0; (await redis.incrWithTtl(`ptm-ready:${randomUUID()}`, 30)) === null; tries++) {
      if (tries === 100) throw new Error("the Redis at TEST_REDIS_URL never connected");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const overrides = { redis, orgs: { now: () => new Date(clock) } };
    app = await buildApp(loadConfig(baseEnv), overrides);
    await api().ready();
    second = await buildApp(loadConfig(baseEnv), overrides);
    await second.ready();

    open = await makeGym("Open Floor");
    sells = await makeGym("Harbour PT");
    ptPack = await typeOf(sells, { kind: "pack", includesPt: true, name: "PT 10" });
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await second?.close();
    await redis?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it(
    "THE WORST THING: a member reads, cancels and pays with nothing that is another member's, in their gym or any other",
    async () => {
      const gym = await makeGym("Worst Thing Gym");
      const pack = await typeOf(gym, { kind: "pack", includesPt: true, name: "Private Pack Name" });
      const sam = await trainerWith(gym, "Sam Trainer");
      const maya = await member(gym, "Maya Member");
      const noor = await member(gym, "Noor Zzyzx");
      const mayaPack = await hold(gym, maya.entryId, pack, { pack: 10 });
      const noorPack = await hold(gym, noor.entryId, pack, { pack: 10 });
      // What takes Sam's time on Friday: Noor's session at 10:00, a class at 11:00, and a
      // session of somebody with no app at 12:00.
      const noors = await staffBook(gym, sam, noor.entryId, 600);
      await coaches(gym, sam, FRIDAY, 660, 60, "Secret Spin Qqx");
      const walkIn = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName: "Wendy Walkin Vvk", email: `ptm-l-${uniq()}@example.com` });
      const wendy = (JSON.parse(walkIn.body) as { entry: { entryId: string } }).entry.entryId;
      await hold(gym, wendy, pack, { pack: 10 });
      const wendys = await staffBook(gym, sam, wendy, 720);
      // Noor also has a session staff cancelled: her history, and nobody else's.
      const noorsOld = await staffBook(gym, sam, noor.entryId, 540, "2026-10-12");
      const called = await inject("POST", `/v1/orgs/${gym.id}/pt/appointments/${noorsOld}/cancel`, gym.owner.cookies, { lateOk: false, giveBack: false });
      expect(called.statusCode, called.body).toBe(200);
      expect(await left(noorPack)).toBe(9);

      // 1. What Maya READS: Sam's one time left, and nobody.
      const res = await inject("GET", `/v1/orgs/${gym.id}/member-pt`, maya.cookies);
      expect(res.statusCode, res.body).toBe(200);
      const view = JSON.parse(res.body) as MemberPtResponse;
      expect(freeOf(view, sam, FRIDAY)).toEqual([540]);
      expect([view.record, view.sessions, view.history]).toEqual(["own", [], []]);
      for (const secret of ["Noor", "Zzyzx", "Wendy", "Vvk", "Secret Spin", "Qqx", noor.entryId, noor.userId, wendy, noors, wendys, noorsOld, noorPack, "@example.com"]) {
        expect(res.body.includes(secret), `the read holds "${secret}"`).toBe(false);
      }
      // Noor reads her own session and her own history, and only hers.
      const hersAlone = await read(gym, noor);
      expect([hersAlone.sessions.map((s) => s.id), hersAlone.history.map((s) => [s.id, s.status])]).toEqual([[noors], [[noorsOld, "cancelled"]]]);

      // 2. Maya cannot CANCEL Noor's session, or the walk-in's, free or late.
      for (const id of [noors, wendys]) {
        for (const lateOk of [false, true]) {
          const no = await cancel(gym, maya, id, lateOk);
          expect([no.statusCode, errorOf(no)]).toEqual([404, "appointment_not_found"]);
          // The answer alone is not the proof: the session is still theirs, still booked.
          expect((await rowOf(gym, id)).status).toBe("booked");
        }
      }
      expect((await rows(gym)).map((r) => r.status)).toEqual(["booked", "booked", "cancelled"]);
      expect(await left(noorPack)).toBe(9);

      // 3. Maya cannot BOOK as Noor: the body takes no person at all.
      for (const extra of [{ entryId: noor.entryId }, { userId: noor.userId }, { heldMembershipId: noorPack }]) {
        const no = await book(gym, maya, sam, { minute: 540, extra });
        expect([no.statusCode, errorOf(no)]).toEqual([400, "validation_error"]);
        expect(await rows(gym)).toHaveLength(3);
      }
      expect(await rows(gym)).toHaveLength(3);

      // 4. Maya's own booking is hers, and charges her pack alone.
      const hers = made(await book(gym, maya, sam, { minute: 540 }));
      const row = await rowOf(gym, hers.id);
      expect([row.entry_id, row.booked_by, row.held_membership_id, row.pack_charged]).toEqual([maya.entryId, maya.userId, mayaPack, true]);
      expect([await left(mayaPack), await left(noorPack)]).toEqual([9, 9]);
      expect((await read(gym, maya)).sessions.map((s) => s.id)).toEqual([hers.id]);
      expect((await read(gym, noor)).sessions.map((s) => s.id)).toEqual([noors]);

      // 5. Nobody from outside reaches it: another gym's member and owner, a stranger,
      // somebody removed from this gym, this gym's own staff who are not members, nobody.
      const elsewhere = await makeGym("Elsewhere Gym");
      const zed = await member(elsewhere, "Zed Elsewhere");
      const gone = await member(gym, "Gina Gone");
      await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym.id} AND user_id = ${gone.userId}`;
      for (const who of [zed, elsewhere.owner, await signedIn("A Stranger"), gone, sam, gym.owner]) {
        const answers = [
          await inject("GET", `/v1/orgs/${gym.id}/member-pt`, who.cookies),
          await book(gym, who, sam, { minute: 540, day: "2026-10-10" }),
          await cancel(gym, who, hers.id),
          await cancel(gym, who, hers.id, true),
        ];
        expect(answers.map((r) => `${String(r.statusCode)} ${errorOf(r)}`), who.name).toEqual(Array.from({ length: 4 }, () => "404 org_not_found"));
      }
      // Zed, asking his OWN gym for this gym's trainer and this gym's session.
      const crossed = await book(elsewhere, zed, sam);
      expect([crossed.statusCode, errorOf(crossed)]).toEqual([404, "trainer_not_found"]);
      const crossedCancel = await cancel(elsewhere, zed, hers.id, true);
      expect([crossedCancel.statusCode, errorOf(crossedCancel)]).toEqual([404, "appointment_not_found"]);
      const signedOut = [
        await inject("GET", `/v1/orgs/${gym.id}/member-pt`, {}),
        await inject("POST", `/v1/orgs/${gym.id}/member-pt/sessions`, {}, {}),
        await inject("POST", `/v1/orgs/${gym.id}/member-pt/sessions/${hers.id}/cancel`, {}, { lateOk: true }),
      ];
      expect(signedOut.map((r) => r.statusCode)).toEqual([401, 401, 401]);

      expect((await rows(gym)).map((r) => [r.status, r.entry_id])).toEqual([
        ["booked", maya.entryId],
        ["booked", noor.entryId],
        ["booked", wendy],
        ["cancelled", noor.entryId],
      ]);
      expect([await left(mayaPack), await left(noorPack)]).toEqual([9, 9]);
    },
    T,
  );

  it(
    "THE WORST THING, where one record is not one person: two app members left on ONE record read, cancel and pay with nothing of each other's",
    async () => {
      const gym = await makeGym("Shared Record Gym");
      const pack = await typeOf(gym, { kind: "pack", includesPt: true });
      const sam = await trainerWith(gym, "Sam Shared");
      const asha = await member(gym, "Asha Shared");
      const bela = await member(gym, "Bela Shared");
      const ashaPack = await hold(gym, asha.entryId, pack, { pack: 10 });
      const belaPack = await hold(gym, bela.entryId, pack, { pack: 10 });
      const ashas = made(await book(gym, asha, sam, { minute: 600 }));
      const belas = made(await book(gym, bela, sam, { minute: 660 }));
      expect((await read(gym, bela)).sessions.map((x) => x.id)).toEqual([belas.id]);

      // The owner joins Bela's record into Asha's on the console, through the real route:
      // two live app accounts now hold one record.
      const joined = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries/${bela.entryId}/merge`, gym.owner.cookies, {
        keepEntryId: asha.entryId,
        acknowledgeLeavesList: true,
      });
      expect(joined.statusCode, joined.body).toBe(200);
      const holders = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM gym_members WHERE gym_id = ${gym.id} AND entry_id = ${asha.entryId} AND removed_at IS NULL`;
      expect(holders[0]?.n, "the join left two accounts on one record").toBe(2);
      const before = [await left(ashaPack), await left(belaPack)];

      for (const who of [asha, bela]) {
        // Neither reads a session: the record's sessions are no longer one person's.
        const res = await inject("GET", `/v1/orgs/${gym.id}/member-pt`, who.cookies);
        expect(res.statusCode, res.body).toBe(200);
        const view = JSON.parse(res.body) as MemberPtResponse;
        expect([view.record, view.sessions, view.history], who.name).toEqual(["shared", [], []]);
        expect(view.days.map((x) => [x.pays, x.why]), who.name).toEqual(Array.from({ length: 7 }, () => [null, null]));
        for (const secret of [ashas.id, belas.id]) expect(res.body.includes(secret), who.name).toBe(false);
        // Neither cancels one, their own old one included, free or late.
        for (const id of [ashas.id, belas.id]) {
          for (const lateOk of [false, true]) {
            const no = await cancel(gym, who, id, lateOk);
            expect([no.statusCode, errorOf(no)], who.name).toEqual([404, "appointment_not_found"]);
            expect((await rowOf(gym, id)).status, who.name).toBe("booked");
          }
        }
        // Neither books on the shared record, so neither pays with the other's pack.
        const no = await book(gym, who, sam, { minute: 540 });
        expect(said(no), who.name).toEqual([409, "record_shared", PT_RECORD_SHARED_WORDS]);
      }
      // Staff still run both sessions from the console, by the record.
      const byStaff = await inject("POST", `/v1/orgs/${gym.id}/pt/appointments/${belas.id}/cancel`, gym.owner.cookies, { lateOk: false, giveBack: false });
      expect(byStaff.statusCode, byStaff.body).toBe(200);
      // One of the two leaves the gym: the record is one person's again, and hers to read.
      await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym.id} AND user_id = ${bela.userId}`;
      const alone = await read(gym, asha);
      expect([alone.record, alone.sessions.map((x) => x.id)]).toEqual(["own", [ashas.id]]);
      expect((await rows(gym)).map((r) => r.status)).toEqual(["booked", "cancelled"]);
      expect(await left(ashaPack)).toBe(before[0]);
    },
    T,
  );

  it(
    "fifty members press the same time at the same instant on the gym's wi-fi: one has it, and one pack is charged",
    async () => {
      const sam = await trainerWith(sells, "Crowd Trainer");
      const people: (Member & { pack: string })[] = [];
      for (let n = 0; n < 50; n++) {
        const m = await member(sells, `Crowd Member ${String(n)}`);
        people.push({ ...m, pack: await hold(sells, m.entryId, ptPack, { pack: 10 }) });
      }
      const wifi = nextIp();
      const answers = await Promise.all(people.map((p, n) => book(sells, p, sam, { ip: wifi, target: either(n) })));
      const booked = answers.filter((r) => r.statusCode === 200);
      const refused = answers.filter((r) => r.statusCode !== 200);
      expect(booked).toHaveLength(1);
      expect(new Set(refused.map(said).map((s) => s.join(" | ")))).toEqual(new Set([`409 | time_taken | ${PT_MEMBER_WORDS.time_taken}`]));
      const winner = made(booked[0] ?? { statusCode: 0, body: "" });
      const taken = (await rows(sells)).filter((r) => r.id === winner.id);
      expect(taken).toHaveLength(1);
      const lefts = await Promise.all(people.map(async (p) => ({ entryId: p.entryId, left: await left(p.pack) })));
      expect(lefts.filter((p) => p.left === 9).map((p) => p.entryId)).toEqual([taken[0]?.entry_id]);
      expect(lefts.filter((p) => p.left === 10)).toHaveLength(49);
    },
    T,
  );

  it("the same press sent five times at once is one session and one charge; its key on another time, or in another member's hands, is refused", async () => {
    const sam = await trainerWith(sells, "Key Trainer");
    const maya = await member(sells, "Maya Key");
    const other = await member(sells, "Other Key");
    const pack = await hold(sells, maya.entryId, ptPack, { pack: 10 });
    const otherPack = await hold(sells, other.entryId, ptPack, { pack: 10 });
    const key = randomUUID();
    const answers = await Promise.all([0, 1, 2, 3, 4].map((n) => book(sells, maya, sam, { key, target: either(n) })));
    expect(answers.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
    expect(new Set(answers.map((r) => made(r).id)).size).toBe(1);
    expect(await left(pack)).toBe(9);
    expect(made(await book(sells, maya, sam, { key })).id).toBe(made(answers[0] ?? { statusCode: 0, body: "" }).id);
    expect(await left(pack)).toBe(9);

    const moved = await book(sells, maya, sam, { key, minute: 660 });
    expect([moved.statusCode, errorOf(moved)]).toEqual([409, "request_reused"]);
    // Another member sending Maya's key is not answered with Maya's session.
    const stolen = await book(sells, other, sam, { key });
    expect([stolen.statusCode, errorOf(stolen)]).toEqual([409, "request_reused"]);
    expect(stolen.body.includes(made(answers[0] ?? { statusCode: 0, body: "" }).id)).toBe(false);
    expect([await left(pack), await left(otherPack)]).toEqual([9, 10]);
  });

  it("a time the list shows can be booked, and a time it does not show is refused: a class, time off, somebody's session, their own session", async () => {
    const gym = await makeGym("Agree Gym");
    const sam = await trainerWith(gym, "Sam Agree");
    const ann = await trainerWith(gym, "Ann Agree");
    const maya = await member(gym, "Maya Agree");
    const noor = await member(gym, "Noor Agree");
    // Sam on Friday: 09:00 somebody else's, 10:00 a class, 11:00 free, 12:00 time off.
    await staffBook(gym, sam, noor.entryId, 540);
    await coaches(gym, sam, FRIDAY, 600, 60, "Spin");
    const off = await inject("POST", `/v1/orgs/${gym.id}/pt/trainers/${sam.userId}/time-off`, gym.owner.cookies, {
      requestKey: randomUUID(),
      fromDate: FRIDAY,
      toDate: FRIDAY,
      fromMinute: 720,
      toMinute: 780,
    });
    expect(off.statusCode, off.body).toBe(200);
    // Maya is with Ann at 11:00 on Saturday, booked for her by staff.
    const SATURDAY = "2026-10-10";
    await staffBook(gym, ann, maya.entryId, 660, SATURDAY);

    const view = await read(gym, maya);
    expect(freeOf(view, sam, FRIDAY)).toEqual([660]);
    expect(freeOf(view, ann, FRIDAY)).toEqual(MORNING);
    // Her own session takes her own time with every trainer.
    expect(freeOf(view, sam, SATURDAY)).toEqual([540, 600, 720]);
    expect(freeOf(view, ann, SATURDAY)).toEqual([540, 600, 720]);
    expect(view.sessions.map((s) => [s.trainerName, s.localDate, s.localStartMinute, s.cancel])).toEqual([["Ann Agree", SATURDAY, 660, "free"]]);

    // Every time NOT shown is refused, and why the trainer's time went is not said.
    const gone = PT_MEMBER_WORDS.trainer_in_class;
    expect(said(await book(gym, maya, sam, { minute: 540 }))).toEqual([409, "time_taken", PT_MEMBER_WORDS.time_taken]);
    expect(said(await book(gym, maya, sam, { minute: 600 }))).toEqual([409, "trainer_in_class", gone]);
    expect(said(await book(gym, maya, sam, { minute: 720 }))).toEqual([409, "trainer_off", gone]);
    expect(said(await book(gym, maya, sam, { minute: 660, day: SATURDAY }))).toEqual([409, "person_busy", PT_MEMBER_WORDS.person_busy]);
    expect(said(await book(gym, maya, sam, { minute: 780 }))).toEqual([409, "not_a_time", PT_MEMBER_WORDS.not_a_time]);
    expect(said(await book(gym, maya, sam, { minute: 660, minutes: 30 }))).toEqual([409, "not_a_time", PT_MEMBER_WORDS.not_a_time]);
    expect(said(await book(gym, maya, sam, { minute: 540, day: "2026-10-06" }))[1]).toBe("time_passed");
    expect(await rows(gym)).toHaveLength(2);

    // Every time shown is booked.
    for (const [trainer, day, minute] of [
      [sam, FRIDAY, 660],
      [ann, FRIDAY, 540],
      [sam, SATURDAY, 720],
    ] as const) {
      made(await book(gym, maya, trainer, { day, minute }));
    }
    const after = await read(gym, maya);
    expect(freeOf(after, sam, FRIDAY)).toEqual([]);
    expect(freeOf(after, ann, FRIDAY)).toEqual([600, 720]);
    expect(after.sessions).toHaveLength(4);
    // The trainer's own week names her, as it names anybody staff book.
    const week = JSON.parse((await inject("GET", `/v1/orgs/${gym.id}/pt/week?trainer=${sam.userId}`, gym.owner.cookies)).body) as PtWeekResponse;
    expect(week.days.find((x) => x.localDate === FRIDAY)?.appointments.map((a) => [a.localStartMinute, a.name])).toEqual([
      [540, "Noor Agree"],
      [660, "Maya Agree"],
    ]);
  });

  it("a member's booking opens when the gym's class bookings do, to the minute; staff still book the eight weeks", async () => {
    const gym = await makeGym("Opens Gym");
    // 07:00 to 09:00 every day: 07:00 and 08:00. Now is 07:30 on Wednesday the 7th.
    const sam = await trainerWith(gym, "Sam Opens", [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, fromMinute: 420, toMinute: 540 })));
    const maya = await member(gym, "Maya Opens");
    const NEXT_WED = "2026-10-14";
    const first = await read(gym, maya);
    expect([first.today, first.from, first.to, first.lastDay]).toEqual([TODAY, TODAY, "2026-10-13", NEXT_WED]);
    // Today 07:00 has started; 08:00 has not.
    expect(freeOf(first, sam, TODAY)).toEqual([480]);
    expect(freeOf(first, sam, "2026-10-13")).toEqual([420, 480]);
    // Seven days on to the minute: 07:00 is open (07:30 has not come round), 08:00 is not.
    const next = await read(gym, maya, 1);
    expect(freeOf(next, sam, NEXT_WED)).toEqual([420]);
    expect(freeOf(next, sam, "2026-10-15")).toEqual([]);
    expect(said(await book(gym, maya, sam, { day: NEXT_WED, minute: 480 }))).toEqual([409, "not_open_yet", PT_MEMBER_WORDS.not_open_yet]);
    expect(said(await book(gym, maya, sam, { day: "2026-11-20", minute: 480 }))[1]).toBe("not_open_yet");
    made(await book(gym, maya, sam, { day: NEXT_WED, minute: 420 }));
    // Staff book her for a day a member cannot reach yet.
    await staffBook(gym, sam, maya.entryId, 480, "2026-11-20");
    expect((await read(gym, maya)).sessions.map((s) => s.localDate)).toEqual([NEXT_WED, "2026-11-20"]);

    // The gym opens bookings 14 days ahead: the same time is now hers to book.
    await sql`UPDATE gyms SET booking_opens_days = 14 WHERE id = ${gym.id}`;
    expect((await read(gym, maya)).lastDay).toBe("2026-10-21");
    made(await book(gym, maya, sam, { day: NEXT_WED, minute: 480 }));
    // Never past the days sessions run, whatever the setting.
    await sql`UPDATE gyms SET booking_opens_days = 56 WHERE id = ${gym.id}`;
    expect((await read(gym, maya, 7)).lastDay).toBe("2026-12-01");
    expect(said(await book(gym, maya, sam, { day: "2026-12-02", minute: 480 }))[1]).toBe("too_far");
  });

  it("what pays is the booking's own rule, and the list says the same before the press", async () => {
    const sam = await trainerWith(sells, "Sam Pays");
    const club = await typeOf(sells, { includesPt: true, name: "Club with PT" });
    const plain = await typeOf(sells, { includesPt: false, name: "Gym only" });
    const cases: { name: string; give: (m: Member) => Promise<string | null>; pays: MemberPtResponse["days"][number]["pays"]; why: string | null; minute: number }[] = [
      { name: "a pack with sessions left", give: (m) => hold(sells, m.entryId, ptPack, { pack: 3 }), pays: { membership: "PT 10", sessionsLeft: 3 }, why: null, minute: 540 },
      { name: "a membership that includes it", give: (m) => hold(sells, m.entryId, club), pays: { membership: "Club with PT", sessionsLeft: null }, why: null, minute: 600 },
      { name: "a membership that does not", give: (m) => hold(sells, m.entryId, plain), pays: null, why: "not_covered", minute: 660 },
      { name: "a pack with nothing left", give: (m) => hold(sells, m.entryId, ptPack, { pack: 0 }), pays: null, why: "pack_used", minute: 660 },
      { name: "nothing at all", give: () => Promise.resolve(null), pays: null, why: "no_membership", minute: 660 },
    ];
    for (const c of cases) {
      const who = await member(sells, `Pays ${c.name}`);
      const heldId = await c.give(who);
      const day = (await read(sells, who)).days.find((x) => x.localDate === FRIDAY);
      expect([day?.pays, day?.why], c.name).toEqual([c.pays, c.why]);
      const res = await book(sells, who, sam, { minute: c.minute });
      if (c.why !== null) {
        expect(said(res), c.name).toEqual([409, c.why, PT_MEMBER_WORDS[c.why as "not_covered"]]);
        continue;
      }
      const session = made(res);
      const row = await rowOf(sells, session.id);
      expect([row.held_membership_id, session.packCharged], c.name).toEqual([heldId, c.pays?.sessionsLeft !== null]);
      if (heldId !== null && c.pays?.sessionsLeft !== null) expect(await left(heldId), c.name).toBe(2);
    }
    // A membership pays before a pack is touched.
    const both = await member(sells, "Pays Both");
    const bothPack = await hold(sells, both.entryId, ptPack, { pack: 5 });
    await hold(sells, both.entryId, club);
    expect(made(await book(sells, both, sam, { minute: 720 })).packCharged).toBe(false);
    expect(await left(bothPack)).toBe(5);

    // A gym that sells no memberships: anybody on its list books, and nothing is charged.
    const tom = await trainerWith(open, "Tom Open");
    const anyone = await member(open, "Anyone Open");
    const day = (await read(open, anyone)).days.find((x) => x.localDate === FRIDAY);
    expect([day?.pays, day?.why]).toEqual([{ membership: null, sessionsLeft: null }, null]);
    const free = made(await book(open, anyone, tom));
    expect([(await rowOf(open, free.id)).held_membership_id, free.packCharged]).toEqual([null, false]);
  });

  it("cancel: free gives the pack its session and the time back; late asks first and keeps the session used; a member never gives one back", async () => {
    const gym = await makeGym("Cancel Gym");
    const pack = await typeOf(gym, { kind: "pack", includesPt: true });
    const sam = await trainerWith(gym, "Sam Cancel");
    const maya = await member(gym, "Maya Cancel");
    const held = await hold(gym, maya.entryId, pack, { pack: 10 });

    // Free: two days ahead.
    const one = made(await book(gym, maya, sam));
    expect([one.cancel, one.freeCancelUntil, await left(held)]).toEqual(["free", "2026-10-09T07:00:00.000Z", 9]);
    const freed = made(await cancel(gym, maya, one.id));
    expect([freed.status, freed.packCharged, freed.cancel, await left(held)]).toEqual(["cancelled", false, null, 10]);
    // Sent again, on the other server: done already, and nothing more comes back.
    expect(made(await cancel(gym, maya, one.id, false, either(1))).status).toBe("cancelled");
    expect(await left(held)).toBe(10);
    expect(freeOf(await read(gym, maya), sam, FRIDAY)).toEqual(MORNING);

    // A session staff booked for her is hers to cancel too.
    const byStaff = await staffBook(gym, sam, maya.entryId, 660);
    expect(await left(held)).toBe(9);
    expect(made(await cancel(gym, maya, byStaff)).status).toBe("cancelled");
    expect(await left(held)).toBe(10);

    const two = made(await book(gym, maya, sam));
    try {
      // An hour before it starts: inside the gym's two hours.
      clock = new Date("2026-10-09T08:00:00Z").getTime();
      expect((await read(gym, maya)).sessions.map((s) => s.cancel)).toEqual(["late"]);
      const asked = await cancel(gym, maya, two.id);
      expect([asked.statusCode, JSON.parse(asked.body)]).toMatchObject([409, { error: "late_cancel", packCharged: true }]);
      expect([(await rowOf(gym, two.id)).status, await left(held)]).toEqual(["booked", 9]);
      // The body has no way to ask for the session back.
      const sneaky = await inject("POST", `/v1/orgs/${gym.id}/member-pt/sessions/${two.id}/cancel`, maya.cookies, { lateOk: true, giveBack: true });
      expect(sneaky.statusCode).toBe(400);
      expect((await rowOf(gym, two.id)).status).toBe("booked");

      const late = made(await cancel(gym, maya, two.id, true));
      expect([late.status, late.packCharged, late.cancel, await left(held)]).toEqual(["late_cancelled", true, null, 9]);
      // Again: the same answer. As a plain cancel: told the session stays used, never "cancelled".
      expect(made(await cancel(gym, maya, two.id, true)).status).toBe("late_cancelled");
      const plain = await cancel(gym, maya, two.id);
      expect(said(plain)).toEqual([409, "kept_used", PT_MEMBER_CANCEL_WORDS.kept_used]);
      // The other way round: cancelled free, and asked again as a late cancel.
      expect(said(await cancel(gym, maya, one.id, true))).toEqual([409, "not_kept", PT_MEMBER_CANCEL_WORDS.not_kept]);
      expect(await left(held)).toBe(9);
      // The trainer's time is free again for somebody else.
      const afterLate = await read(gym, maya);
      expect(freeOf(afterLate, sam, FRIDAY)).toEqual([600, 660, 720]);
      // What happened to each stays readable, the newest first; nothing in it can be cancelled.
      expect(afterLate.sessions).toEqual([]);
      expect(afterLate.history.map((s) => [s.localStartMinute, s.status, s.packCharged, s.cancel])).toEqual([
        [660, "cancelled", false, null],
        [600, "late_cancelled", true, null],
        [600, "cancelled", false, null],
      ]);

      // A session that has started cannot be cancelled.
      const three = made(await book(gym, maya, sam, { minute: 660 }));
      clock = new Date("2026-10-09T10:05:00Z").getTime();
      const started = await cancel(gym, maya, three.id, true);
      expect(said(started)).toEqual([409, "started", PT_MEMBER_CANCEL_WORDS.started]);
      expect([(await rowOf(gym, three.id)).status, await left(held)]).toEqual(["booked", 8]);
      // A session that is over moves from the coming list to the history.
      clock = new Date("2026-10-09T11:05:00Z").getTime();
      const over = await read(gym, maya);
      expect([over.sessions, over.history[0]?.id, over.history[0]?.status]).toEqual([[], three.id, "booked"]);
      // Older than the history's days, it is not listed.
      clock = new Date("2026-12-20T10:00:00Z").getTime();
      expect((await read(gym, maya)).history).toEqual([]);
    } finally {
      clock = NOW.getTime();
    }
  });

  it("somebody using the app with no record on the gym's list is told so, and books nothing", async () => {
    const tom = await trainerWith(open, "Tom NoRecord");
    const loose = await appOnly(open, "Loose Member");
    const view = await read(open, loose);
    expect([view.record, view.sessions, view.history, view.days.map((x) => [x.pays, x.why])]).toEqual(["none", [], [], Array.from({ length: 7 }, () => [null, null])]);
    expect(freeOf(view, tom, FRIDAY)).toEqual(MORNING);
    const no = await book(open, loose, tom);
    expect([no.statusCode, errorOf(no)]).toEqual([409, "not_on_list"]);
    // A record that is a past member's is no record.
    const past = await member(open, "Past Record");
    await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE id = ${past.entryId}`;
    expect((await read(open, past)).record).toBe("none");
    expect(errorOf(await book(open, past, tom, { minute: 660 }))).toBe("not_on_list");
    expect((await rows(open)).filter((r) => r.entry_id === past.entryId)).toHaveLength(0);
  });

  it("a trainer who is also a member is not offered a session with themself", async () => {
    const gym = await makeGym("Self Gym");
    const sam = await trainerWith(gym, "Sam Self");
    const ann = await trainerWith(gym, "Ann Self");
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${gym.id}, ${sam.userId}, '2026-01-01T00:00:00Z')`;
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName: "Sam Self", email: `ptm-l-${uniq()}@example.com` });
    const entryId = (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
    await sql`UPDATE gym_members SET entry_id = ${entryId} WHERE gym_id = ${gym.id} AND user_id = ${sam.userId}`;
    expect((await read(gym, sam)).trainers.map((t) => t.name)).toEqual(["Ann Self"]);
    expect(errorOf(await book(gym, sam, sam))).toBe("not_a_time");
    made(await book(gym, sam, ann));
  });

  it("a trainer with no hours, or switched off, is not listed; a gym with none answers an empty list", async () => {
    const gym = await makeGym("Empty Gym");
    const maya = await member(gym, "Maya Empty");
    expect((await read(gym, maya)).trainers).toEqual([]);
    await staff(gym, "Never Set Up");
    const off = await staff(gym, "Switched Off");
    await inject("PUT", `/v1/orgs/${gym.id}/pt/trainers/${off.userId}`, gym.owner.cookies, { offers: false, sessionMinutes: 60, hours: EVERY_MORNING });
    const none = await staff(gym, "No Hours");
    await inject("PUT", `/v1/orgs/${gym.id}/pt/trainers/${none.userId}`, gym.owner.cookies, { offers: true, sessionMinutes: 60, hours: [] });
    expect((await read(gym, maya)).trainers).toEqual([]);
    expect(said(await book(gym, maya, off))).toEqual([409, "trainer_not_offering", PT_MEMBER_WORDS.trainer_not_offering]);
  });

  it("a request that does not parse is a 400 that changes nothing", async () => {
    const tom = await trainerWith(open, "Tom Parse");
    const maya = await member(open, "Maya Parse");
    const good = { requestKey: randomUUID(), trainerId: tom.userId, localDate: FRIDAY, startMinute: 600, minutes: 60 };
    const post = (payload: unknown) => inject("POST", `/v1/orgs/${open.id}/member-pt/sessions`, maya.cookies, payload);
    const answers = await Promise.all([
      post({ ...good, startMinute: 601 }),
      post({ ...good, localDate: "9 Oct" }),
      post({ ...good, trainerId: "tom" }),
      post({ ...good, minutes: undefined }),
      post({}),
      inject("GET", `/v1/orgs/${open.id}/member-pt?week=8`, maya.cookies),
      inject("GET", `/v1/orgs/${open.id}/member-pt?week=-1`, maya.cookies),
      inject("GET", `/v1/orgs/${open.id}/member-pt?week=1&x=1`, maya.cookies),
      inject("POST", `/v1/orgs/${open.id}/member-pt/sessions/not-an-id/cancel`, maya.cookies, { lateOk: false }),
      inject("POST", `/v1/orgs/${open.id}/member-pt/sessions/${randomUUID()}/cancel`, maya.cookies, {}),
    ]);
    expect(answers.map((r) => r.statusCode)).toEqual(Array.from({ length: 10 }, () => 400));
    expect((await rows(open)).filter((r) => r.entry_id === maya.entryId)).toHaveLength(0);
  });

  it("a gym whose plan has lapsed, or that has been closed, answers a member nothing and changes nothing", async () => {
    for (const end of ["lapsed", "closed"] as const) {
      const gym = await makeGym(`Ended ${end}`);
      const sam = await trainerWith(gym, "Sam Ended");
      const maya = await member(gym, "Maya Ended");
      const session = made(await book(gym, maya, sam));
      if (end === "lapsed") await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gym.id}`;
      else await sql`UPDATE gyms SET status = 'archived' WHERE id = ${gym.id}`;
      const answers = [await inject("GET", `/v1/orgs/${gym.id}/member-pt`, maya.cookies), await book(gym, maya, sam, { minute: 660 }), await cancel(gym, maya, session.id)];
      expect(answers.map((r) => `${String(r.statusCode)} ${errorOf(r)}`), end).toEqual(Array.from({ length: 3 }, () => "404 org_not_found"));
      expect((await rows(gym)).map((r) => r.status), end).toEqual(["booked"]);
    }
  });

  it("each write is noted with who did it, as the member's own", async () => {
    const gym = await makeGym("Audit Gym");
    const sam = await trainerWith(gym, "Sam Audit");
    const maya = await member(gym, "Maya Audit");
    const session = made(await book(gym, maya, sam));
    made(await cancel(gym, maya, session.id));
    const notes = await sql<{ action: string; actor_user_id: string | null }[]>`
      SELECT action, actor_user_id FROM audit_log WHERE gym_id = ${gym.id} AND target_id = ${session.id} ORDER BY action`;
    expect(notes.map((n) => [n.action, n.actor_user_id])).toEqual([
      ["member.pt_booked", maya.userId],
      ["member.pt_cancelled", maya.userId],
    ]);
  });

  it("more sessions than one read answers: the newest 20 of the past and the first 100 to come, never a failed read", async () => {
    const gym = await makeGym("Caps Gym");
    const sam = await trainerWith(gym, "Sam Caps");
    const maya = await member(gym, "Maya Caps");
    // 25 cancelled sessions on past days and 105 booked on coming ones, an hour each.
    await sql`
      INSERT INTO gym_pt_appointments
        (gym_id, trainer_user_id, entry_id, local_date, local_start_minute, starts_at, ends_at, minutes, status, cancelled_at, pack_charged, request_key, booked_by, created_at)
      SELECT ${gym.id}, ${sam.userId}, ${maya.entryId}, d.day, 600,
             (d.day + interval '10 hours') AT TIME ZONE 'Europe/London', (d.day + interval '11 hours') AT TIME ZONE 'Europe/London',
             60, CASE WHEN d.n < 0 THEN 'cancelled' ELSE 'booked' END, CASE WHEN d.n < 0 THEN ${NOW}::timestamptz END, false, gen_random_uuid(), ${gym.owner.userId}, ${NOW}
      FROM (SELECT ${TODAY}::date + n AS day, n FROM generate_series(-25, 105) AS n WHERE n <> 0) d`;
    const view = await read(gym, maya);
    expect([view.sessions.length, view.history.length]).toEqual([100, 20]);
    expect([view.sessions[0]?.localDate, view.history[0]?.localDate, view.history[19]?.localDate]).toEqual(["2026-10-08", "2026-10-06", "2026-09-17"]);
  });

  it("one member's reads are limited too: the 1,201st in an hour is told to slow down", async () => {
    const gym = await makeGym("Read Limit Gym");
    const maya = await member(gym, "Maya Reads");
    const wifi = `10.81.${String(randomInt(250))}.${String(randomInt(1, 251))}`;
    const statuses: number[] = [];
    for (let done = 0; done < 1205; done += 50) {
      const chunk = await Promise.all(
        Array.from({ length: Math.min(50, 1205 - done) }, (_, n) => inject("GET", `/v1/orgs/${gym.id}/member-pt`, maya.cookies, undefined, wifi, either(n))),
      );
      statuses.push(...chunk.map((r) => r.statusCode));
    }
    expect([statuses.filter((x) => x === 200).length, statuses.filter((x) => x === 429).length]).toEqual([1200, 5]);
  }, T);

  it("one member's writes are limited: the 121st in an hour is told to slow down, and their reads still answer", async () => {
    const gym = await makeGym("Limit Gym");
    const maya = await member(gym, "Maya Limit");
    const wifi = `10.80.${String(randomInt(250))}.${String(randomInt(1, 251))}`;
    const statuses: number[] = [];
    for (let done = 0; done < 125; done += 25) {
      const chunk = await Promise.all(
        Array.from({ length: 25 }, (_, n) =>
          inject("POST", `/v1/orgs/${gym.id}/member-pt/sessions/${randomUUID()}/cancel`, maya.cookies, { lateOk: false }, wifi, either(n)),
        ),
      );
      statuses.push(...chunk.map((r) => r.statusCode));
    }
    expect(statuses.filter((s) => s === 404)).toHaveLength(120);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
    expect((await inject("GET", `/v1/orgs/${gym.id}/member-pt`, maya.cookies, undefined, wifi)).statusCode).toBe(200);
    // Two hundred members on that same wi-fi are not held to one member's number.
    const other = await member(gym, "Other Limit");
    expect((await inject("POST", `/v1/orgs/${gym.id}/member-pt/sessions/${randomUUID()}/cancel`, other.cookies, { lateOk: false }, wifi)).statusCode).toBe(404);
  }, T);
});
