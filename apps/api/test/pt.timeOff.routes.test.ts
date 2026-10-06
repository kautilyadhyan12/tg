// A TRAINER'S TIME OFF — the routes against real Postgres (DATABASE_URL-gated), on two api
// instances over one database. Spec Part 3 §13.5; ROADMAP 17e-iii-b.
//
// The worst thing this job could do to a real person: somebody is booked with a trainer
// for a time the trainer is away, and turns up to nobody. A booking and a time off for
// the same time at the same instant is the first test below: one of them always sees the other.
import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { PtAppointment, PtTimeOffOver, PtTrainersResponse, PtWeekResponse } from "@app/shared";
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
  JWT_SECRET: "trainer-time-off-routes-secret-012345678", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 180_000;
const LIVE_PLAN = "zz_pto_live";
/** Wednesday 7 October 2026, 07:30 in London (summer time, one hour ahead of UTC). */
const NOW = new Date("2026-10-07T06:30:00Z");
const TODAY = "2026-10-07";
/** A Friday two days on: far outside the two-hour free-cancel time. */
const FRIDAY = "2026-10-09";

let ipCounter = 0;
const nextIp = () => `10.78.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
const redisUrl = process.env["TEST_REDIS_URL"];
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("a trainer's time off (real Postgres, two api instances)", { timeout: T }, () => {
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
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'pto-t-%@example.com')`;
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
    await sql`DELETE FROM users WHERE email LIKE 'pto-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH", path: string, cookies: Cookies, payload?: unknown, ip = nextIp(), target = api()) =>
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
    const email = `pto-t-${uniq()}@example.com`;
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
  const subscribe = (gymId: string) => sql`
    INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
    VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
  const makeGym = async (name: string): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Leeds", country: "GB", timezone: "Europe/London" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await subscribe(id);
    return { id, owner };
  };
  /** A member of staff on the trainer's usual ticks (the member list and attendance, to read). */
  const staff = async (gym: Gym, name: string, privileges: string[] | null = null): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${person.userId}, 'trainer', ${privileges})`;
    return person;
  };
  /** A person on the gym's list, with no app account: a session hangs on the record. */
  const listed = async (gym: Gym, name: string): Promise<string> => {
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName: name, email: `pto-l-${uniq()}@example.com` });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };

  /** One class on the gym's calendar, coached by `coach`, at a clock time on a day of the gym's. */
  const coaches = async (
    gym: Gym,
    coach: Person,
    day: string,
    startMinute: number,
    minutes: number,
    over: { name?: string; openGym?: boolean; cancelled?: boolean } = {},
  ): Promise<void> => {
    const [type] = await sql<{ id: string }[]>`
      INSERT INTO gym_class_types (gym_id, name, minutes, places, colour, open_gym)
      VALUES (${gym.id}, ${over.name ?? `Class ${uniq()}`}, ${minutes}, 10, 'blue', ${over.openGym ?? false})
      RETURNING id`;
    if (type === undefined) throw new Error("no class type");
    await sql`
      INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places, coach_user_id, status)
      VALUES (${gym.id}, ${type.id}, ${day}::date, ${startMinute}, (${day}::date + make_interval(mins => ${startMinute})) AT TIME ZONE 'Europe/London',
              ${minutes}, 10, ${coach.userId}, ${over.cancelled === true ? "cancelled" : "scheduled"})`;
  };

  const typeOf = async (gym: Gym, over: { kind?: "recurring" | "pack"; includesPt?: boolean } = {}): Promise<string> => {
    const pack = over.kind === "pack";
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_membership_types
        (gym_id, name, kind, price_minor, currency, term_count, term_unit, pack_classes, pack_days, access, covers_all_classes, includes_pt)
      VALUES (${gym.id}, ${`Type ${uniq()}`}, ${over.kind ?? "recurring"}, 4000, 'GBP', ${pack ? null : 1}, ${pack ? null : "month"},
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
  const setHours = (gym: Gym, by: Person, trainer: Person, over: { offers?: boolean; sessionMinutes?: number; hours?: object[] } = {}) =>
    inject("PUT", `/v1/orgs/${gym.id}/pt/trainers/${trainer.userId}`, by.cookies, {
      offers: over.offers ?? true,
      sessionMinutes: over.sessionMinutes ?? 60,
      hours: over.hours ?? EVERY_MORNING,
    });
  const trainerWith = async (gym: Gym, name: string): Promise<Person> => {
    const person = await staff(gym, name);
    const res = await setHours(gym, gym.owner, person);
    expect(res.statusCode, res.body).toBe(200);
    return person;
  };

  interface BookOpts {
    by?: Person;
    key?: string;
    day?: string;
    minute?: number;
    /** The session's length as the screen showed it; an hour unless said. */
    minutes?: number;
    ip?: string;
    target?: App;
  }
  const book = (gym: Gym, trainer: Person, entryId: string, opts: BookOpts = {}) =>
    inject(
      "POST",
      `/v1/orgs/${gym.id}/pt/appointments`,
      (opts.by ?? gym.owner).cookies,
      { requestKey: opts.key ?? randomUUID(), trainerId: trainer.userId, entryId, localDate: opts.day ?? FRIDAY, startMinute: opts.minute ?? 600, minutes: opts.minutes ?? 60 },
      opts.ip ?? nextIp(),
      opts.target ?? api(),
    );
  const cancel = (gym: Gym, id: string, over: { by?: Person; lateOk?: boolean; giveBack?: boolean; target?: App } = {}) =>
    inject(
      "POST",
      `/v1/orgs/${gym.id}/pt/appointments/${id}/cancel`,
      (over.by ?? gym.owner).cookies,
      { lateOk: over.lateOk ?? false, giveBack: over.giveBack ?? false },
      nextIp(),
      over.target ?? api(),
    );
  const made = (res: { statusCode: number; body: string }): PtAppointment => {
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { appointment: PtAppointment }).appointment;
  };
  const errorOf = (res: { body: string }): string => (JSON.parse(res.body) as { error: string }).error;
  const week = async (gym: Gym, by: Person, trainer: Person, from?: string): Promise<PtWeekResponse> => {
    const res = await inject("GET", `/v1/orgs/${gym.id}/pt/week?trainer=${trainer.userId}${from === undefined ? "" : `&from=${from}`}`, by.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as PtWeekResponse;
  };
  const dayOf = (w: PtWeekResponse, day: string) => {
    const found = w.days.find((x) => x.localDate === day);
    if (found === undefined) throw new Error(`no ${day} in the week`);
    return found;
  };
  const sessions = (gym: Gym, trainer: Person) => sql<{ id: string; status: string; entry_id: string | null; pack_charged: boolean }[]>`
    SELECT id, status, entry_id, pack_charged FROM gym_pt_appointments WHERE gym_id = ${gym.id} AND trainer_user_id = ${trainer.userId} ORDER BY starts_at, id`;

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
    for (let tries = 0; (await redis.incrWithTtl(`pto-ready:${randomUUID()}`, 30)) === null; tries++) {
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
    ptPack = await typeOf(sells, { kind: "pack", includesPt: true });
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await second?.close();
    await redis?.close();
    await sql.end({ timeout: 5 });
  }, T);

  const DESK = "10.78.249.1";
  interface OffBody {
    fromDate?: string;
    toDate?: string;
    fromMinute?: number | null;
    toMinute?: number | null;
    confirm?: string;
    key?: string;
  }
  const off = (gym: Gym, trainer: Person, body: OffBody = {}, opts: { by?: Person; target?: App; ip?: string } = {}) =>
    inject(
      "POST",
      `/v1/orgs/${gym.id}/pt/trainers/${trainer.userId}/time-off`,
      (opts.by ?? gym.owner).cookies,
      {
        requestKey: body.key ?? randomUUID(),
        fromDate: body.fromDate ?? FRIDAY,
        toDate: body.toDate ?? body.fromDate ?? FRIDAY,
        fromMinute: body.fromMinute ?? null,
        toMinute: body.toMinute ?? null,
        ...(body.confirm === undefined ? {} : { confirm: body.confirm }),
      },
      opts.ip ?? nextIp(),
      opts.target ?? api(),
    );
  const removeOff = (gym: Gym, trainer: Person, id: string, by: Person = gym.owner) =>
    inject("DELETE", `/v1/orgs/${gym.id}/pt/trainers/${trainer.userId}/time-off/${id}`, by.cookies);
  const offRows = (gym: Gym, trainer: Person) => sql<{ id: string; from_date: string; to_date: string; starts_at: Date; ends_at: Date }[]>`
    SELECT id, from_date::text AS from_date, to_date::text AS to_date, starts_at, ends_at
    FROM gym_trainer_time_off WHERE gym_id = ${gym.id} AND user_id = ${trainer.userId} ORDER BY starts_at, ends_at, id`;
  const overOf = (res: { statusCode: number; body: string }): PtTimeOffOver => {
    expect(res.statusCode, res.body).toBe(409);
    const body = JSON.parse(res.body) as { error: string; over: PtTimeOffOver };
    expect(body.error).toBe("time_off_over_bookings");
    return body.over;
  };
  const trainersOf = (res: { statusCode: number; body: string }): PtTrainersResponse => {
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as PtTrainersResponse;
  };
  const audits = async (gym: Gym): Promise<number> => {
    const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gym.id}`;
    return row?.n ?? -1;
  };
  const plus = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

  it(
    "a booking and a time off for the same time at the same instant, on two servers: the booking is refused or the time off names it, never neither",
    async () => {
      const sam = await trainerWith(open, "Race Trainer");
      for (let round = 0; round < 12; round++) {
        const day = plus(FRIDAY, round);
        const maya = await listed(open, `Race Person ${String(round)}`);
        const booking = () => book(open, sam, maya, { day, minute: 600, ip: DESK, target: either(round) });
        const timeOff = () => off(open, sam, { fromDate: day }, { ip: DESK, target: either(round + 1) });
        // Which request is sent first changes from round to round.
        const [b, o] = round % 2 === 0 ? await Promise.all([booking(), timeOff()]) : (await Promise.all([timeOff(), booking()])).reverse();
        if (b === undefined || o === undefined) throw new Error("no answers");
        const [session] = await sql<{ id: string }[]>`
          SELECT id FROM gym_pt_appointments WHERE gym_id = ${open.id} AND trainer_user_id = ${sam.userId} AND local_date = ${day}::date AND status = 'booked'`;
        const [row] = await sql<{ id: string }[]>`
          SELECT id FROM gym_trainer_time_off WHERE gym_id = ${open.id} AND user_id = ${sam.userId} AND from_date = ${day}::date`;
        if (b.statusCode === 200) {
          // The booking was first: the time off saw it, named it and wrote nothing.
          const over = overOf(o);
          expect(over.sessions.shown.map((s) => s.id)).toEqual([made(b).id]);
          expect(row).toBeUndefined();
          expect(session?.id).toBe(made(b).id);
        } else {
          // The time off was first: the booking saw it and was refused.
          expect([b.statusCode, errorOf(b)]).toEqual([409, "trainer_off"]);
          expect(o.statusCode, o.body).toBe(200);
          expect(row).toBeDefined();
          expect(session).toBeUndefined();
        }
      }
    },
    T,
  );

  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  /** Two requests in a known order: the gym's row is held, `first` is sent and seen waiting
   *  for it, `second` is sent and seen waiting behind, and only then is the row let go. */
  const oneThenOther = async <A, B>(gym: Gym, first: () => PromiseLike<A>, second: () => PromiseLike<B>): Promise<[A, B]> => {
    const sent: { a?: Promise<A>; b?: Promise<B> } = {};
    await sql.begin(async (tx) => {
      await tx`SELECT 1 FROM gyms WHERE id = ${gym.id} FOR UPDATE`;
      const [me] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      if (me === undefined) throw new Error("no backend");
      const waitingOn = async (pids: number[]): Promise<number[]> =>
        (
          await sql<{ pid: number }[]>`
            SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND pg_blocking_pids(pid) && ${pids}::int[]`
        ).map((r) => r.pid);
      sent.a = (async () => await first())();
      let ahead: number[] = [];
      for (let tries = 0; ahead.length === 0; tries++) {
        if (tries === 400) throw new Error("the first request never waited for the gym's row");
        await pause(25);
        ahead = await waitingOn([me.pid]);
      }
      sent.b = (async () => await second())();
      for (let tries = 0; (await waitingOn([me.pid, ...ahead])).every((pid) => ahead.includes(pid)); tries++) {
        if (tries === 400) throw new Error("the second request never waited behind the first");
        await pause(25);
      }
    });
    if (sent.a === undefined || sent.b === undefined) throw new Error("nothing was sent");
    return [await sent.a, await sent.b];
  };

  it(
    "both orders, each made to happen on two servers: the time off first refuses the booking; the booking first is named by the time off",
    async () => {
      const sam = await trainerWith(open, "Order Trainer");
      const maya = await listed(open, "Maya Order");
      const [offFirst, refused] = await oneThenOther(
        open,
        () => off(open, sam, {}, { ip: DESK, target: api() }),
        () => book(open, sam, maya, { ip: DESK, target: second ?? api() }),
      );
      expect(offFirst.statusCode, offFirst.body).toBe(200);
      expect([refused.statusCode, errorOf(refused)]).toEqual([409, "trainer_off"]);
      expect(await sessions(open, sam)).toHaveLength(0);

      const monday = "2026-10-12";
      const [bookedFirst, asked] = await oneThenOther(
        open,
        () => book(open, sam, maya, { day: monday, ip: DESK, target: second ?? api() }),
        () => off(open, sam, { fromDate: monday }, { ip: DESK, target: api() }),
      );
      expect(overOf(asked).sessions.shown.map((s) => s.id)).toEqual([made(bookedFirst).id]);
      expect((await offRows(open, sam)).map((r) => r.from_date)).toEqual([FRIDAY]);
    },
    T,
  );

  it(
    "time off takes the free times to the minute, and a booking in it is refused and charges nothing",
    async () => {
      const sam = await trainerWith(sells, "Minute Trainer");
      const maya = await listed(sells, "Maya Minute");
      const pack = await hold(sells, maya, ptPack, { pack: 10 });
      // Friday 10:30 to 12:00: the 10:00 and 11:00 sessions run into it.
      const added = trainersOf(await off(sells, sam, { fromMinute: 630, toMinute: 720 }));
      const mine = added.trainers.find((t) => t.userId === sam.userId)?.timeOff ?? [];
      expect(mine.map((o) => [o.fromDate, o.toDate, o.fromMinute, o.toMinute])).toEqual([[FRIDAY, FRIDAY, 630, 720]]);
      // The weekend, whole days.
      trainersOf(await off(sells, sam, { fromDate: "2026-10-10", toDate: "2026-10-11" }));

      const w = await week(sells, sells.owner, sam);
      expect(dayOf(w, FRIDAY).free).toEqual([540, 720]);
      expect(dayOf(w, FRIDAY).timeOff.map((o) => [o.fromMinute, o.toMinute])).toEqual([[630, 720]]);
      expect(dayOf(w, "2026-10-10").free).toEqual([]);
      expect(dayOf(w, "2026-10-11").free).toEqual([]);
      expect(dayOf(w, "2026-10-11").timeOff.map((o) => [o.fromMinute, o.toMinute])).toEqual([[null, null]]);
      expect(dayOf(w, "2026-10-08").free).toEqual([540, 600, 660, 720]);
      expect(dayOf(w, "2026-10-08").timeOff).toEqual([]);
      expect(dayOf(w, "2026-10-12").free).toEqual([540, 600, 660, 720]);

      for (const [day, minute] of [[FRIDAY, 600], [FRIDAY, 660], ["2026-10-10", 540], ["2026-10-11", 720]] as const) {
        const res = await book(sells, sam, maya, { day, minute });
        expect([day, minute, res.statusCode, errorOf(res)]).toEqual([day, minute, 409, "trainer_off"]);
      }
      expect(await left(pack)).toBe(10);
      expect(await sessions(sells, sam)).toHaveLength(0);
      // Either side of it is still theirs to book.
      made(await book(sells, sam, maya, { minute: 540 }));
      made(await book(sells, sam, maya, { minute: 720 }));
      made(await book(sells, sam, maya, { day: "2026-10-12", minute: 540 }));
      expect(await left(pack)).toBe(7);
    },
    T,
  );

  it(
    "a session already booked in it is named and nothing is written; a wrong mark and a stale one ask again; the right one saves and no session or pack changes",
    async () => {
      const sam = await trainerWith(sells, "Sam Asked");
      const tom = await trainerWith(sells, "Tom Other");
      const maya = await listed(sells, "Maya Lopez");
      const leo = await listed(sells, "Leo Park");
      const zed = await listed(sells, "Zed Hall");
      const packs = { maya: await hold(sells, maya, ptPack, { pack: 10 }), leo: await hold(sells, leo, ptPack, { pack: 10 }), zed: await hold(sells, zed, ptPack, { pack: 10 }) };
      const mayas = made(await book(sells, sam, maya, { minute: 600 }));
      // Another trainer's session at the same time, and Sam's own on another day, are not this time off's.
      made(await book(sells, tom, zed, { minute: 600 }));
      const mondays = made(await book(sells, sam, zed, { day: "2026-10-12", minute: 600 }));
      const before = await audits(sells);

      const first = overOf(await off(sells, sam));
      expect(first.sessions.count).toBe(1);
      expect(first.sessions.shown).toEqual([{ id: mayas.id, name: "Maya Lopez", localDate: FRIDAY, localStartMinute: 600, minutes: 60 }]);
      expect(first.classes).toEqual({ count: 0, shown: [] });
      expect(await offRows(sells, sam)).toHaveLength(0);

      // A mark that is not theirs.
      overOf(await off(sells, sam, { confirm: "f".repeat(64) }));
      // Leo is booked while the box is open: the mark shown is stale.
      const leos = made(await book(sells, sam, leo, { minute: 660 }));
      const second = overOf(await off(sells, sam, { confirm: first.mark }));
      expect(second.sessions.shown.map((s) => s.id)).toEqual([mayas.id, leos.id]);
      expect(second.mark).not.toBe(first.mark);
      // One cancelled and another booked: the number is the same, the sessions are not.
      made(await cancel(sells, leos.id));
      const zeds = made(await book(sells, sam, zed, { minute: 540 }));
      const third = overOf(await off(sells, sam, { confirm: second.mark }));
      expect(third.sessions.count).toBe(2);
      expect(third.sessions.shown.map((s) => s.id)).toEqual([zeds.id, mayas.id]);
      expect(await offRows(sells, sam)).toHaveLength(0);
      // Nothing but the booking, the cancel and the booking was written.
      expect(await audits(sells)).toBe(before + 3);

      const saved = trainersOf(await off(sells, sam, { confirm: third.mark }));
      expect(saved.trainers.find((t) => t.userId === sam.userId)?.timeOff).toHaveLength(1);
      expect(saved.trainers.find((t) => t.userId === tom.userId)?.timeOff).toEqual([]);
      expect(await offRows(sells, sam)).toHaveLength(1);
      const booked = (await sessions(sells, sam)).filter((s) => s.status === "booked").map((s) => s.id);
      expect(booked).toEqual([zeds.id, mayas.id, mondays.id]);
      expect([await left(packs.maya), await left(packs.leo), await left(packs.zed)]).toEqual([9, 10, 7]);
      // The session is still on the trainer's day, beside the time off, and nothing is free.
      const friday = dayOf(await week(sells, sells.owner, sam), FRIDAY);
      expect(friday.appointments.map((a) => a.id)).toEqual([zeds.id, mayas.id]);
      expect(friday.timeOff).toHaveLength(1);
      expect(friday.free).toEqual([]);
    },
    T,
  );

  it(
    "a class they coach in it is named too: taught, running and theirs, and nothing else",
    async () => {
      const sam = await trainerWith(open, "Sam Coach");
      const tom = await trainerWith(open, "Tom Coach");
      await coaches(open, sam, FRIDAY, 600, 45, { name: "Spin" });
      await coaches(open, sam, FRIDAY, 660, 45, { name: "Open Floor Hour", openGym: true });
      await coaches(open, sam, FRIDAY, 720, 45, { name: "Called Off", cancelled: true });
      await coaches(open, tom, FRIDAY, 600, 45, { name: "Toms Class" });
      await coaches(open, sam, "2026-10-10", 600, 45, { name: "Saturday Spin" });
      // One that ends as the time off starts is not in it.
      await coaches(open, sam, "2026-10-08", 1395, 45, { name: "Late Thursday" });

      const over = overOf(await off(open, sam));
      expect(over.sessions).toEqual({ count: 0, shown: [] });
      expect(over.classes.count).toBe(1);
      expect(over.classes.shown.map((c) => [c.name, c.localDate, c.localStartMinute, c.minutes])).toEqual([["Spin", FRIDAY, 600, 45]]);
      expect(over.classesUpTo).toBe(plus(TODAY, 55));
      expect(await offRows(open, sam)).toHaveLength(0);
      trainersOf(await off(open, sam, { confirm: over.mark }));
      // The class is still Sam's on the calendar.
      const [spin] = await sql<{ status: string; coach_user_id: string }[]>`
        SELECT s.status, s.coach_user_id FROM gym_class_sessions s JOIN gym_class_types t ON t.id = s.class_type_id
        WHERE s.gym_id = ${open.id} AND t.name = 'Spin'`;
      expect(spin).toEqual({ status: "scheduled", coach_user_id: sam.userId });
    },
    T,
  );

  it(
    "a class given to the trainer while the box is open makes the mark stale: asked again, naming it",
    async () => {
      const sam = await trainerWith(open, "Sam Marked");
      await coaches(open, sam, FRIDAY, 600, 45, { name: "Spin" });
      const first = overOf(await off(open, sam));
      expect(first.classes.shown.map((c) => c.name)).toEqual(["Spin"]);
      await coaches(open, sam, FRIDAY, 720, 45, { name: "Row" });
      const second = overOf(await off(open, sam, { confirm: first.mark }));
      expect(second.classes.shown.map((c) => c.name)).toEqual(["Spin", "Row"]);
      expect(second.mark).not.toBe(first.mark);
      expect(await offRows(open, sam)).toHaveLength(0);
      trainersOf(await off(open, sam, { confirm: second.mark }));
    },
    T,
  );

  it(
    "a class at the far edge of the calendar that was not written yet is written first, and named",
    async () => {
      const gym = await makeGym(`Edge Off ${uniq()}`);
      const sam = await trainerWith(gym, "Sam Edge");
      const made = await inject("POST", `/v1/orgs/${gym.id}/classes`, gym.owner.cookies, { name: "Spin", minutes: 45, places: 10, colour: "blue" });
      expect(made.statusCode, made.body).toBe(201);
      const typeId = (JSON.parse(made.body) as { entries: { type: { id: string; name: string } }[] }).entries.find((e) => e.type.name === "Spin")?.type.id ?? "";
      const slot = await inject("POST", `/v1/orgs/${gym.id}/classes/${typeId}/repeats`, gym.owner.cookies, {
        weekdays: [5],
        startMinute: 630,
        minutes: 45,
        places: 10,
        coachUserId: sam.userId,
        startsOn: TODAY,
      });
      expect(slot.statusCode, slot.body).toBe(201);
      // Friday 27 November is in the calendar's last week. The nightly job missed it.
      const far = "2026-11-27";
      const gone = await sql`DELETE FROM gym_class_sessions WHERE gym_id = ${gym.id} AND local_date = ${far}::date`;
      expect(gone.count).toBe(1);
      const over = overOf(await off(gym, sam, { fromDate: far }));
      expect(over.classes.shown.map((c) => [c.name, c.localDate, c.localStartMinute])).toEqual([["Spin", far, 630]]);
      expect(await offRows(gym, sam)).toHaveLength(0);
    },
    T,
  );

  it(
    "one member of staff's writes are limited on both routes: after three hundred, a Remove and an Add are told to slow down; a colleague at that address is not",
    async () => {
      const gym = await makeGym(`Limit Off ${uniq()}`);
      const sam = await trainerWith(gym, "Sam Limit");
      const tom = await trainerWith(gym, "Tom Limit");
      // An address no other run has used: the address is counted for an hour too.
      const desk = `10.78.${String(randomInt(250))}.${String(randomInt(1, 251))}`;
      const removeNothing = (by: Person, target: App) =>
        inject("DELETE", `/v1/orgs/${gym.id}/pt/trainers/${by.userId}/time-off/${randomUUID()}`, by.cookies, undefined, desk, target);
      const statuses: number[] = [];
      for (let done = 0; done < 300; done += 25) {
        statuses.push(...(await Promise.all(Array.from({ length: 25 }, (_, n) => removeNothing(sam, either(n))))).map((r) => r.statusCode));
      }
      expect(statuses.filter((s) => s === 200)).toHaveLength(300);
      expect((await removeNothing(sam, api())).statusCode).toBe(429);
      expect((await off(gym, sam, {}, { by: sam, ip: desk })).statusCode).toBe(429);
      expect(await offRows(gym, sam)).toHaveLength(0);
      // Somebody else at the same address is answered.
      expect((await removeNothing(tom, api())).statusCode).toBe(200);
      expect((await off(gym, tom, {}, { by: tom, ip: desk })).statusCode).toBe(200);
    },
    T,
  );

  it(
    "after the gym changes its time zone a day off is still that day, off: no free time on it, and no booking",
    async () => {
      const gym = await makeGym(`Zone Off ${uniq()}`);
      const sam = await trainerWith(gym, "Sam Zone");
      const maya = await listed(gym, "Maya Zone");
      trainersOf(await off(gym, sam));
      trainersOf(await off(gym, sam, { fromDate: "2026-10-10", fromMinute: 600, toMinute: 660 }));
      expect(dayOf(await week(gym, gym.owner, sam), FRIDAY).free).toEqual([]);

      // 07:30 on Wednesday in London is 19:30 on Wednesday in Auckland, thirteen hours ahead.
      const moved = await inject("PATCH", `/v1/orgs/${gym.id}`, gym.owner.cookies, { timezone: "Pacific/Auckland" });
      expect(moved.statusCode, moved.body).toBe(200);
      const w = await week(gym, gym.owner, sam);
      expect(dayOf(w, FRIDAY).free).toEqual([]);
      expect(dayOf(w, FRIDAY).timeOff.map((o) => [o.fromMinute, o.toMinute])).toEqual([[null, null]]);
      expect(dayOf(w, "2026-10-10").free).toEqual([540, 660, 720]);
      for (const [day, minute] of [[FRIDAY, 540], [FRIDAY, 720], ["2026-10-10", 600]] as const) {
        const res = await book(gym, sam, maya, { day, minute });
        expect([day, minute, res.statusCode, errorOf(res)]).toEqual([day, minute, 409, "trainer_off"]);
      }
      made(await book(gym, sam, maya, { day: "2026-10-08", minute: 540 }));
      made(await book(gym, sam, maya, { day: "2026-10-10", minute: 540 }));
      // The two instants are the gym's own Friday and Saturday hour in the zone it has now.
      expect((await offRows(gym, sam)).map((r) => [r.starts_at.toISOString(), r.ends_at.toISOString()])).toEqual([
        ["2026-10-08T11:00:00.000Z", "2026-10-09T11:00:00.000Z"],
        ["2026-10-09T21:00:00.000Z", "2026-10-09T22:00:00.000Z"],
      ]);
    },
    T,
  );

  it(
    "hours on the night the clocks go forward: a time the clock skips is refused in words, never kept as another hour",
    async () => {
      const sam = await trainerWith(open, "Spring Trainer");
      // London, Sunday 28 March 2027: 01:00 becomes 02:00, so 01:00 to 01:55 is on no clock.
      const sunday = "2027-03-28";
      for (const [fromMinute, toMinute] of [[60, 120], [90, 150], [60, 90], [30, 60], [0, 115]] as const) {
        const res = await off(open, sam, { fromDate: sunday, fromMinute, toMinute });
        expect([fromMinute, toMinute, res.statusCode, errorOf(res)]).toEqual([fromMinute, toMinute, 409, "time_off_not_a_time"]);
      }
      expect(await offRows(open, sam)).toHaveLength(0);
      // Times the clock has that night are taken, each as the instant it is.
      trainersOf(await off(open, sam, { fromDate: sunday, fromMinute: 0, toMinute: 120 }));
      trainersOf(await off(open, sam, { fromDate: sunday, fromMinute: 120, toMinute: 180 }));
      // The whole day is the twenty-three hours it has. Two of the three start at the same
      // instant: the rows are read by their start and then their end.
      trainersOf(await off(open, sam, { fromDate: sunday }));
      expect((await offRows(open, sam)).map((r) => [r.starts_at.toISOString(), r.ends_at.toISOString()])).toEqual([
        ["2027-03-28T00:00:00.000Z", "2027-03-28T01:00:00.000Z"],
        ["2027-03-28T00:00:00.000Z", "2027-03-28T23:00:00.000Z"],
        ["2027-03-28T01:00:00.000Z", "2027-03-28T02:00:00.000Z"],
      ]);
    },
    T,
  );

  it(
    "only what runs into it is asked about: a session that ends as it starts or starts as it ends is not, nor one already over",
    async () => {
      const sam = await trainerWith(open, "Edge Trainer");
      const maya = await listed(open, "Maya Edge");
      const leo = await listed(open, "Leo Edge");
      made(await book(open, sam, maya, { minute: 540 }));
      made(await book(open, sam, leo, { minute: 660 }));
      // 10:00 to 11:00 on Friday, between the two.
      trainersOf(await off(open, sam, { fromMinute: 600, toMinute: 660 }));

      // Today's 09:00 session, then the clock moves past its end: today off names nobody.
      made(await book(open, sam, maya, { day: TODAY, minute: 540 }));
      clock = Date.parse("2026-10-07T09:30:00Z");
      try {
        trainersOf(await off(open, sam, { fromDate: TODAY }));
      } finally {
        clock = NOW.getTime();
      }
    },
    T,
  );

  it(
    "who may: a stranger and another gym's owner get 404, a trainer keeps their own and nobody else's, and nobody signed in gets 401",
    async () => {
      const sam = await trainerWith(open, "Sam Own");
      const tom = await trainerWith(open, "Tom Own");
      const desk = await staff(open, "Desk No Hours");
      const stranger = await signedIn("A Stranger");
      const toms = trainersOf(await off(open, tom)).trainers.find((t) => t.userId === tom.userId)?.timeOff[0]?.id ?? "";
      expect(toms).not.toBe("");

      for (const who of [stranger, sells.owner]) {
        const add = await off(open, sam, {}, { by: who });
        expect([add.statusCode, errorOf(add)]).toEqual([404, "org_not_found"]);
        const del = await removeOff(open, tom, toms, who);
        expect([del.statusCode, errorOf(del)]).toEqual([404, "org_not_found"]);
      }
      expect((await inject("POST", `/v1/orgs/${open.id}/pt/trainers/${sam.userId}/time-off`, {}, {})).statusCode).toBe(401);
      expect((await inject("DELETE", `/v1/orgs/${open.id}/pt/trainers/${tom.userId}/time-off/${toms}`, {})).statusCode).toBe(401);

      // A trainer: their own, yes. Somebody else's, no.
      const own = trainersOf(await off(open, sam, {}, { by: sam }));
      expect(own.trainers.map((t) => t.userId)).toEqual([sam.userId]);
      expect((await off(open, tom, {}, { by: sam })).statusCode).toBe(403);
      expect((await removeOff(open, tom, toms, sam)).statusCode).toBe(403);
      // Tom's time off asked for under Sam's own name is not found there, and stays.
      expect((await removeOff(open, sam, toms, sam)).statusCode).toBe(200);
      expect(await offRows(open, tom)).toHaveLength(1);
      // Another gym's owner naming this gym's time off under their own gym and trainer: it stays.
      const theirs = await trainerWith(sells, "Their Trainer");
      expect((await removeOff(sells, theirs, toms)).statusCode).toBe(200);
      expect(await offRows(open, tom)).toHaveLength(1);

      // Staff with no hours are not trainers yet; somebody not on the staff is nobody.
      const none = await off(open, desk);
      expect([none.statusCode, errorOf(none)]).toEqual([409, "time_off_no_hours"]);
      const nobody = await off(open, stranger);
      expect([nobody.statusCode, errorOf(nobody)]).toEqual([404, "trainer_not_found"]);
      expect(await offRows(open, sam)).toHaveLength(1);
    },
    T,
  );

  it(
    "the same request five times at once adds one; its key on other days is refused; a time off written wrong is a 400",
    async () => {
      const sam = await trainerWith(open, "Key Trainer");
      const key = randomUUID();
      const answers = await Promise.all([0, 1, 2, 3, 4].map((n) => off(open, sam, { key }, { ip: DESK, target: either(n) })));
      expect(answers.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
      expect(await offRows(open, sam)).toHaveLength(1);
      const [audit] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${open.id} AND action = 'org.trainer_time_off_added' AND target_id = ${sam.userId}`;
      expect(audit?.n).toBe(1);
      const reused = await off(open, sam, { key, fromDate: "2026-10-12" });
      expect([reused.statusCode, errorOf(reused)]).toEqual([409, "request_reused"]);

      for (const bad of [
        { fromDate: FRIDAY, toDate: "2026-10-08" },
        { fromMinute: 540 },
        { fromMinute: 720, toMinute: 540 },
        { fromDate: FRIDAY, toDate: "2026-10-10", fromMinute: 540, toMinute: 720 },
        { fromDate: "2027-02-30", toDate: "2027-03-01" },
        { fromMinute: 541, toMinute: 720 },
      ]) {
        const res = await off(open, sam, bad);
        expect([JSON.stringify(bad), res.statusCode, errorOf(res)]).toEqual([JSON.stringify(bad), 400, "validation_error"]);
      }
      expect(await offRows(open, sam)).toHaveLength(1);
    },
    T,
  );

  it(
    "by the clock: one already over is refused, one still running is taken, one starting more than a year ahead is refused, and the fifty-first",
    async () => {
      const sam = await trainerWith(open, "Clock Trainer");
      // It is 07:30 on Wednesday at the gym.
      const yesterday = await off(open, sam, { fromDate: "2026-10-06" });
      expect([yesterday.statusCode, errorOf(yesterday)]).toEqual([409, "time_off_ended"]);
      const earlier = await off(open, sam, { fromDate: TODAY, fromMinute: 360, toMinute: 450 });
      expect([earlier.statusCode, errorOf(earlier)]).toEqual([409, "time_off_ended"]);
      trainersOf(await off(open, sam, { fromDate: TODAY, fromMinute: 420, toMinute: 480 }));
      trainersOf(await off(open, sam, { fromDate: "2026-10-06", toDate: TODAY }));
      trainersOf(await off(open, sam, { fromDate: plus(TODAY, 366) }));
      const far = await off(open, sam, { fromDate: plus(TODAY, 367) });
      expect([far.statusCode, errorOf(far)]).toEqual([409, "time_off_too_far"]);

      // Three are there; forty-seven more is fifty.
      for (let n = 0; n < 47; n++) trainersOf(await off(open, sam, { fromDate: plus(TODAY, 100 + n) }));
      expect(await offRows(open, sam)).toHaveLength(50);
      const more = await off(open, sam, { fromDate: plus(TODAY, 200) });
      expect([more.statusCode, errorOf(more)]).toEqual([409, "time_off_too_many"]);
      // One that is over no longer counts, and is not listed.
      clock = Date.parse("2026-10-07T07:30:00Z");
      try {
        const list = trainersOf(await off(open, sam, { fromDate: plus(TODAY, 200) }));
        expect(list.trainers.find((t) => t.userId === sam.userId)?.timeOff).toHaveLength(50);
        expect(await offRows(open, sam)).toHaveLength(51);
      } finally {
        clock = NOW.getTime();
      }
    },
    T,
  );

  it(
    "Remove gives the times back, and removing it again is the same answer",
    async () => {
      const sam = await trainerWith(open, "Back Trainer");
      const id = trainersOf(await off(open, sam)).trainers.find((t) => t.userId === sam.userId)?.timeOff[0]?.id ?? "";
      expect(dayOf(await week(open, open.owner, sam), FRIDAY).free).toEqual([]);
      const gone = trainersOf(await removeOff(open, sam, id));
      expect(gone.trainers.find((t) => t.userId === sam.userId)?.timeOff).toEqual([]);
      const friday = dayOf(await week(open, open.owner, sam), FRIDAY);
      expect(friday.free).toEqual([540, 600, 660, 720]);
      expect(friday.timeOff).toEqual([]);
      trainersOf(await removeOff(open, sam, id));
      const [audit] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${open.id} AND action = 'org.trainer_time_off_removed' AND target_id = ${sam.userId}`;
      expect(audit?.n).toBe(1);
      made(await book(open, sam, await listed(open, "Maya Back"), { minute: 600 }));
    },
    T,
  );

  it(
    "the table itself refuses a time off that is not one, and a trainer's time off goes with their row",
    async () => {
      const sam = await trainerWith(open, "Table Trainer");
      const base = { from_date: FRIDAY, to_date: FRIDAY, from_minute: null as number | null, to_minute: null as number | null, starts: "2026-10-08T23:00:00Z", ends: "2026-10-09T23:00:00Z", key: randomUUID() };
      const put = async (over: Partial<typeof base>, userId = sam.userId): Promise<string> => {
        const r = { ...base, ...over };
        try {
          await sql`
            INSERT INTO gym_trainer_time_off (gym_id, user_id, from_date, to_date, from_minute, to_minute, starts_at, ends_at, request_key)
            VALUES (${open.id}, ${userId}, ${r.from_date}::date, ${r.to_date}::date, ${r.from_minute}, ${r.to_minute}, ${r.starts}::timestamptz, ${r.ends}::timestamptz, ${r.key})`;
          return "ok";
        } catch (err) {
          return (err as { constraint_name?: string }).constraint_name ?? String(err);
        }
      };
      expect(await put({})).toBe("ok");
      expect(await put({})).toBe("gym_trainer_time_off_request_uq");
      const fresh = () => ({ key: randomUUID() });
      expect(await put({ ...fresh(), to_date: "2026-10-08" })).toBe("gym_trainer_time_off_days_check");
      expect(await put({ ...fresh(), from_minute: 540 })).toBe("gym_trainer_time_off_hours_check");
      expect(await put({ ...fresh(), to_minute: 720 })).toBe("gym_trainer_time_off_hours_check");
      expect(await put({ ...fresh(), from_minute: 720, to_minute: 540 })).toBe("gym_trainer_time_off_hours_check");
      expect(await put({ ...fresh(), from_minute: 540, to_minute: 540 })).toBe("gym_trainer_time_off_hours_check");
      expect(await put({ ...fresh(), from_minute: 0, to_minute: 1445 })).toBe("gym_trainer_time_off_hours_check");
      expect(await put({ ...fresh(), to_date: "2026-10-10", from_minute: 540, to_minute: 720 })).toBe("gym_trainer_time_off_hours_check");
      expect(await put({ ...fresh(), ends: base.starts })).toBe("gym_trainer_time_off_span_check");
      expect(await put({ ...fresh(), from_minute: 540, to_minute: 1440 })).toBe("ok");
      // Somebody on the staff who is no trainer has no time off.
      const desk = await staff(open, "Table Desk");
      expect(await put(fresh(), desk.userId)).toBe("gym_trainer_time_off_trainer_fk");
      expect(await offRows(open, sam)).toHaveLength(2);
      await sql`DELETE FROM gym_trainers WHERE gym_id = ${open.id} AND user_id = ${sam.userId}`;
      expect(await offRows(open, sam)).toHaveLength(0);
    },
    T,
  );

  it(
    "the day the clocks go back is off for all twenty-five hours of it, and the day after is not",
    async () => {
      const sam = await trainerWith(open, "Clocks Trainer");
      // London leaves summer time at 02:00 on Sunday 25 October 2026.
      trainersOf(await off(open, sam, { fromDate: "2026-10-25" }));
      const [row] = await offRows(open, sam);
      expect([row?.starts_at.toISOString(), row?.ends_at.toISOString()]).toEqual(["2026-10-24T23:00:00.000Z", "2026-10-26T00:00:00.000Z"]);
      const maya = await listed(open, "Maya Clocks");
      const sunday = await book(open, sam, maya, { day: "2026-10-25", minute: 720 });
      expect([sunday.statusCode, errorOf(sunday)]).toEqual([409, "trainer_off"]);
      made(await book(open, sam, maya, { day: "2026-10-24", minute: 720 }));
      made(await book(open, sam, maya, { day: "2026-10-26", minute: 540 }));
      const w = await week(open, open.owner, sam, "2026-10-24");
      expect([dayOf(w, "2026-10-24").free, dayOf(w, "2026-10-25").free, dayOf(w, "2026-10-26").free]).toEqual([[540, 600, 660], [], [600, 660, 720]]);
    },
    T,
  );
});
