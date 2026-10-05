// PERSONAL TRAINING — the routes against real Postgres (DATABASE_URL-gated), on two api
// instances over one database. Spec Part 3 §13.5; ROADMAP 17e-i.
//
// The worst thing this job could do to a real person: book two people with one trainer at
// the same time, so one is turned away, or take a session off somebody's pack for a
// booking that never happened. Those are the first tests below.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { PtAppointment, PtPeopleResponse, PtTrainersResponse, PtWeekResponse } from "@app/shared";
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
  JWT_SECRET: "personal-training-routes-secret-01234567", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 180_000;
const LIVE_PLAN = "zz_pt_live";
/** Wednesday 7 October 2026, 07:30 in London (summer time, one hour ahead of UTC). */
const NOW = new Date("2026-10-07T06:30:00Z");
const TODAY = "2026-10-07";
/** A Friday two days on: far outside the two-hour free-cancel time. */
const FRIDAY = "2026-10-09";

let ipCounter = 0;
const nextIp = () => `10.77.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
const redisUrl = process.env["TEST_REDIS_URL"];
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("personal training (real Postgres, two api instances)", () => {
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
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'ptr-t-%@example.com')`;
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
    await sql`DELETE FROM users WHERE email LIKE 'ptr-t-%@example.com'`;
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
    const email = `ptr-t-${uniq()}@example.com`;
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
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName: name, email: `ptr-l-${uniq()}@example.com` });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
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
    ip?: string;
    target?: App;
  }
  const book = (gym: Gym, trainer: Person, entryId: string, opts: BookOpts = {}) =>
    inject(
      "POST",
      `/v1/orgs/${gym.id}/pt/appointments`,
      (opts.by ?? gym.owner).cookies,
      { requestKey: opts.key ?? randomUUID(), trainerId: trainer.userId, entryId, localDate: opts.day ?? FRIDAY, startMinute: opts.minute ?? 600 },
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
    for (let tries = 0; (await redis.incrWithTtl(`ptr-ready:${randomUUID()}`, 30)) === null; tries++) {
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

  it(
    "fifty people booked with one trainer for the same time at the same instant: exactly one has it, and one pack is charged",
    async () => {
      const sam = await trainerWith(sells, "Sam Trainer");
      const people: { entryId: string; pack: string }[] = [];
      for (let n = 0; n < 50; n++) {
        const entryId = await listed(sells, `Crowd Person ${String(n)}`);
        people.push({ entryId, pack: await hold(sells, entryId, ptPack, { pack: 10 }) });
      }
      // One front desk: every request from the same address, across two servers.
      const desk = nextIp();
      const answers = await Promise.all(people.map((p, n) => book(sells, sam, p.entryId, { ip: desk, target: either(n) })));
      const booked = answers.filter((r) => r.statusCode === 200);
      const refused = answers.filter((r) => r.statusCode !== 200);
      expect(booked).toHaveLength(1);
      expect(refused).toHaveLength(49);
      expect(new Set(refused.map((r) => `${String(r.statusCode)} ${errorOf(r)}`))).toEqual(new Set(["409 time_taken"]));

      const rows = await sessions(sells, sam);
      expect(rows).toHaveLength(1);
      const winner = made(booked[0] ?? { statusCode: 0, body: "" });
      expect(rows[0]?.id).toBe(winner.id);
      const lefts = await Promise.all(people.map(async (p) => ({ entryId: p.entryId, left: await left(p.pack) })));
      expect(lefts.filter((p) => p.left === 9).map((p) => p.entryId)).toEqual([rows[0]?.entry_id]);
      expect(lefts.filter((p) => p.left === 10)).toHaveLength(49);
    },
    T,
  );

  it(
    "the same request sent five times at once makes one session and charges the pack once; its key on another time is refused",
    async () => {
      const sam = await trainerWith(sells, "Key Trainer");
      const maya = await listed(sells, "Maya Key");
      const pack = await hold(sells, maya, ptPack, { pack: 10 });
      const key = randomUUID();
      const answers = await Promise.all([0, 1, 2, 3, 4].map((n) => book(sells, sam, maya, { key, target: either(n) })));
      expect(answers.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
      expect(new Set(answers.map((r) => made(r).id)).size).toBe(1);
      expect(await sessions(sells, sam)).toHaveLength(1);
      expect(await left(pack)).toBe(9);

      // Later, the same request again: still that session, still one charge.
      const again = made(await book(sells, sam, maya, { key }));
      expect(again.id).toBe(made(answers[0] ?? { statusCode: 0, body: "" }).id);
      expect(await left(pack)).toBe(9);

      const other = await book(sells, sam, maya, { key, minute: 660 });
      expect([other.statusCode, errorOf(other)]).toEqual([409, "request_reused"]);
      expect(await sessions(sells, sam)).toHaveLength(1);
    },
    T,
  );

  it("the database itself refuses a second session of one trainer that overlaps, and a cancelled one holds no time", async () => {
    const sam = await trainerWith(open, "Rule Trainer");
    const row = (startsAt: string, minutes: number, status = "booked") => ({
      gym_id: open.id,
      trainer_user_id: sam.userId,
      local_date: "2026-11-02",
      local_start_minute: 600,
      starts_at: startsAt,
      ends_at: new Date(new Date(startsAt).getTime() + minutes * 60_000).toISOString(),
      minutes,
      status,
      cancelled_at: status === "cancelled" ? "2026-10-07T06:30:00Z" : null,
      request_key: randomUUID(),
    });
    const insert = async (r: ReturnType<typeof row>): Promise<string> => {
      try {
        await sql`INSERT INTO gym_pt_appointments ${sql(r)}`;
        return "ok";
      } catch (err) {
        return (err as { constraint_name?: string }).constraint_name ?? String(err);
      }
    };
    expect(await insert(row("2026-11-02T10:00:00Z", 60))).toBe("ok");
    // The same time, one that starts inside it, one that ends inside it, one around it.
    expect(await insert(row("2026-11-02T10:00:00Z", 60))).toBe("gym_pt_appointments_trainer_no_overlap");
    expect(await insert(row("2026-11-02T10:30:00Z", 60))).toBe("gym_pt_appointments_trainer_no_overlap");
    expect(await insert(row("2026-11-02T09:30:00Z", 45))).toBe("gym_pt_appointments_trainer_no_overlap");
    expect(await insert(row("2026-11-02T09:45:00Z", 90))).toBe("gym_pt_appointments_trainer_no_overlap");
    expect(await insert(row("2026-11-02T10:15:00Z", 30, "attended"))).toBe("gym_pt_appointments_trainer_no_overlap");
    // Straight after it and straight before it are different times; a cancelled one is no time.
    expect(await insert(row("2026-11-02T11:00:00Z", 60))).toBe("ok");
    expect(await insert(row("2026-11-02T09:00:00Z", 60))).toBe("ok");
    expect(await insert(row("2026-11-02T10:00:00Z", 60, "cancelled"))).toBe("ok");
    // Another trainer has their own time.
    const other = await trainerWith(open, "Rule Other");
    expect(await insert({ ...row("2026-11-02T10:00:00Z", 60), trainer_user_id: other.userId })).toBe("ok");
  });

  it("a free cancel gives the pack its session back and the time to somebody else; a cancel sent again changes nothing", async () => {
    const sam = await trainerWith(sells, "Cancel Trainer");
    const maya = await listed(sells, "Maya Cancel");
    const leo = await listed(sells, "Leo Cancel");
    const pack = await hold(sells, maya, ptPack, { pack: 10 });
    await hold(sells, leo, ptPack, { pack: 10 });
    const session = made(await book(sells, sam, maya));
    expect([session.cancel, session.packCharged, await left(pack)]).toEqual(["free", true, 9]);
    const taken = await book(sells, sam, leo);
    expect([taken.statusCode, errorOf(taken)]).toEqual([409, "time_taken"]);

    // Twice at once, on two servers, then once more.
    const both = await Promise.all([cancel(sells, session.id), cancel(sells, session.id, { target: second ?? api() })]);
    expect(both.map((r) => made(r).status)).toEqual(["cancelled", "cancelled"]);
    expect(made(await cancel(sells, session.id, { lateOk: true, giveBack: true })).packCharged).toBe(false);
    expect(await left(pack)).toBe(10);

    expect(made(await book(sells, sam, leo)).status).toBe("booked");
    expect((await sessions(sells, sam)).map((r) => [r.entry_id, r.status]).sort()).toEqual(
      [
        [maya, "cancelled"],
        [leo, "booked"],
      ].sort(),
    );
  });

  it("inside the free-cancel time a cancel asks first: late keeps the session used, called off by the gym gives it back", async () => {
    const sam = await trainerWith(sells, "Late Trainer");
    const maya = await listed(sells, "Maya Late");
    const leo = await listed(sells, "Leo Late");
    const mayaPack = await hold(sells, maya, ptPack, { pack: 10 });
    const leoPack = await hold(sells, leo, ptPack, { pack: 10 });
    // Today at 09:00 and 10:00; it is 07:30, so 09:00 is inside the two hours and 10:00 is not.
    const late = made(await book(sells, sam, maya, { day: TODAY, minute: 540 }));
    const calledOff = made(await book(sells, sam, leo, { day: TODAY, minute: 600 }));
    expect([late.cancel, calledOff.cancel]).toEqual(["late", "free"]);

    const asked = await cancel(sells, late.id);
    expect(asked.statusCode, asked.body).toBe(409);
    expect(JSON.parse(asked.body)).toMatchObject({ error: "late_cancel", packCharged: true });
    expect((await sessions(sells, sam)).map((r) => r.status)).toEqual(["booked", "booked"]);

    const kept = made(await cancel(sells, late.id, { lateOk: true }));
    expect([kept.status, kept.packCharged, await left(mayaPack)]).toEqual(["late_cancelled", true, 9]);

    // An hour on, Leo's session is inside the two hours too: the trainer is ill.
    clock = NOW.getTime() + 60 * 60_000;
    try {
      const back = made(await cancel(sells, calledOff.id, { lateOk: true, giveBack: true }));
      expect([back.status, back.packCharged, await left(leoPack)]).toEqual(["cancelled", false, 10]);
    } finally {
      clock = NOW.getTime();
    }
  });

  it("a session that has started cannot be cancelled, and its time cannot be booked", async () => {
    const sam = await trainerWith(sells, "Started Trainer");
    const maya = await listed(sells, "Maya Started");
    const pack = await hold(sells, maya, ptPack, { pack: 10 });
    const session = made(await book(sells, sam, maya, { day: TODAY, minute: 660 }));
    clock = new Date("2026-10-07T10:00:00Z").getTime(); // 11:00 in London: it starts now
    try {
      const res = await cancel(sells, session.id, { lateOk: true, giveBack: true });
      expect([res.statusCode, errorOf(res)]).toEqual([409, "started"]);
      expect(await left(pack)).toBe(9);
      const passed = await book(sells, sam, await listed(sells, "Leo Started"), { day: TODAY, minute: 600 });
      expect([passed.statusCode, errorOf(passed)]).toEqual([409, "time_passed"]);
      expect(dayOf(await week(sells, sells.owner, sam), TODAY).free).toEqual([720]);
    } finally {
      clock = NOW.getTime();
    }
  });

  it("what pays: a pack, a membership that includes it, and the people nothing pays for", async () => {
    const sam = await trainerWith(sells, "Cover Trainer");
    const classesOnly = await typeOf(sells);
    const unlimitedPt = await typeOf(sells, { includesPt: true });
    const classPack = await typeOf(sells, { kind: "pack" });
    const at = (n: number) => ({ day: "2026-10-12", minute: 540 + n * 60 });

    const nobody = await listed(sells, "No Membership");
    const none = await book(sells, sam, nobody, at(0));
    expect([none.statusCode, errorOf(none)]).toEqual([409, "no_membership"]);

    const gold = await listed(sells, "Classes Only");
    await hold(sells, gold, classesOnly);
    const goldPack = await hold(sells, gold, classPack, { pack: 10 });
    const notCovered = await book(sells, sam, gold, at(0));
    expect([notCovered.statusCode, errorOf(notCovered)]).toEqual([409, "not_covered"]);
    expect(await left(goldPack)).toBe(10);

    const used = await listed(sells, "Used Up");
    await hold(sells, used, ptPack, { pack: 0 });
    const usedUp = await book(sells, sam, used, at(0));
    expect([usedUp.statusCode, errorOf(usedUp)]).toEqual([409, "pack_used"]);

    // Both a PT membership and a PT pack: the membership pays and the pack is kept.
    const both = await listed(sells, "Both Kinds");
    const bothPack = await hold(sells, both, ptPack, { pack: 10 });
    await hold(sells, both, unlimitedPt);
    const session = made(await book(sells, sam, both, at(0)));
    expect([session.packCharged, await left(bothPack)]).toEqual([false, 10]);

    // The last session of a pack.
    const last = await listed(sells, "Last One");
    const lastPack = await hold(sells, last, ptPack, { pack: 1 });
    expect(made(await book(sells, sam, last, at(1))).packCharged).toBe(true);
    expect(await left(lastPack)).toBe(0);
    const empty = await book(sells, sam, last, at(2));
    expect(empty.statusCode, empty.body).toBe(409);

    expect((await sessions(sells, sam)).map((r) => r.pack_charged)).toEqual([false, true]);
  });

  it("the price list's tick is what makes a membership pay: saved through the route, read back, and changed", async () => {
    const gym = await makeGym("Tick PT");
    const sam = await trainerWith(gym, "Tick Trainer");
    const maya = await listed(gym, "Maya Tick");
    const types = `/v1/orgs/${gym.id}/membership-types`;
    const pack = {
      name: "PT 10", description: null, kind: "pack", priceMinor: 30000, termCount: null, termUnit: null, packClasses: 10, packDays: 90,
      access: "all_classes", bookingsLimit: null, bookingsPeriod: null,
    };
    // No class at all needs the tick: a pack that pays for nothing is refused.
    expect((await inject("POST", types, gym.owner.cookies, { ...pack, classTypeIds: [] })).statusCode).toBe(400);
    expect((await inject("POST", types, gym.owner.cookies, { ...pack, classTypeIds: [], includesPt: false })).statusCode).toBe(400);
    const created = await inject("POST", types, gym.owner.cookies, { ...pack, classTypeIds: [], includesPt: true });
    expect(created.statusCode, created.body).toBe(201);
    interface Listed { id: string; name: string; includesPt: boolean; classTypes: unknown[] | null; updatedAt: string }
    const [type] = (JSON.parse(created.body) as { types: Listed[] }).types;
    expect([type?.includesPt, type?.classTypes]).toEqual([true, []]);
    if (type === undefined) throw new Error("no type");

    const held = await hold(gym, maya, type.id, { pack: 10 });
    expect(made(await book(gym, sam, maya)).packCharged).toBe(true);
    expect(await left(held)).toBe(9);

    // The tick taken off: the same pack, for every class now, no longer pays for a session.
    const changed = await inject("PUT", `${types}/${type.id}`, gym.owner.cookies, { ...pack, classTypeIds: null, includesPt: false, updatedAt: type.updatedAt });
    expect(changed.statusCode, changed.body).toBe(200);
    expect((JSON.parse(changed.body) as { types: Listed[] }).types[0]?.includesPt).toBe(false);
    const refused = await book(gym, sam, maya, { minute: 660 });
    expect([refused.statusCode, errorOf(refused)]).toEqual([409, "not_covered"]);
    expect(await left(held)).toBe(9);
    // A type saved by a form that does not know the tick has it off.
    const old = await inject("POST", types, gym.owner.cookies, { ...pack, name: "Class 10", classTypeIds: null });
    expect(old.statusCode, old.body).toBe(201);
    expect((JSON.parse(old.body) as { types: Listed[] }).types.find((t) => t.name === "Class 10")?.includesPt).toBe(false);
  });

  it("a gym with no membership types books anybody on its list; a past member and another gym's person are not found", async () => {
    const sam = await trainerWith(open, "Open Trainer");
    const tom = await listed(open, "Tom Open");
    const session = made(await book(open, sam, tom));
    expect([session.name, session.membership, session.packCharged]).toEqual(["Tom Open", null, false]);

    const gone = await listed(open, "Gone Former");
    await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE id = ${gone}`;
    const former = await book(open, sam, gone, { minute: 660 });
    expect([former.statusCode, errorOf(former)]).toEqual([404, "person_not_found"]);

    const theirs = await listed(sells, "Other Gym Person");
    const foreign = await book(open, sam, theirs, { minute: 660 });
    expect([foreign.statusCode, errorOf(foreign)]).toEqual([404, "person_not_found"]);
    expect(await sessions(open, sam)).toHaveLength(1);
  });

  it("one person is not booked with two trainers at once", async () => {
    const sam = await trainerWith(open, "Twin Sam");
    const ana = await trainerWith(open, "Twin Ana");
    const tom = await listed(open, "Tom Twin");
    made(await book(open, sam, tom));
    const clash = await book(open, ana, tom);
    expect([clash.statusCode, errorOf(clash)]).toEqual([409, "person_busy"]);
    expect(made(await book(open, ana, tom, { minute: 660 })).status).toBe("booked");
  });

  it("only a time the trainer offers can be booked: not off their hours, not past eight weeks, not when they take none", async () => {
    const sam = await trainerWith(open, "Times Trainer");
    const tom = await listed(open, "Tom Times");
    const refused = async (opts: BookOpts): Promise<[number, string]> => {
      const res = await book(open, sam, tom, opts);
      return [res.statusCode, errorOf(res)];
    };
    expect(await refused({ minute: 480 })).toEqual([409, "not_a_time"]); // 08:00, before their hours
    expect(await refused({ minute: 780 })).toEqual([409, "not_a_time"]); // 13:00, when they end
    expect(await refused({ minute: 570 })).toEqual([409, "not_a_time"]); // 09:30, between two sessions
    expect(await refused({ day: "2026-10-06", minute: 600 })).toEqual([409, "time_passed"]); // yesterday
    expect(await refused({ day: TODAY, minute: 420 })).toEqual([409, "not_a_time"]);
    // The last day is eight weeks from today less one; the day after is too far.
    expect(made(await book(open, sam, tom, { day: "2026-12-01" })).localDate).toBe("2026-12-01");
    expect(await refused({ day: "2026-12-02" })).toEqual([409, "too_far"]);

    expect((await setHours(open, open.owner, sam, { offers: false })).statusCode).toBe(200);
    expect(await refused({ minute: 660 })).toEqual([409, "trainer_not_offering"]);
    const w = await week(open, open.owner, sam);
    expect(w.offers).toBe(false);
    expect(w.days.flatMap((x) => x.free)).toEqual([]);

    const never = await staff(open, "Never Set Up");
    const res = await book(open, never, tom, { by: open.owner });
    expect([res.statusCode, errorOf(res)]).toEqual([409, "trainer_not_offering"]);
    const stranger = await signedIn("Not Staff");
    const notStaff = await book(open, stranger, tom, { by: open.owner });
    expect([notStaff.statusCode, errorOf(notStaff)]).toEqual([404, "trainer_not_found"]);
  });

  it("the week: free times are the hours less what is booked, on the gym's clock through a clock change", async () => {
    const sam = await trainerWith(open, "Week Trainer");
    const tom = await listed(open, "Tom Week");
    made(await book(open, sam, tom, { minute: 660 }));
    const w = await week(open, open.owner, sam);
    expect([w.today, w.from, w.to, w.lastDay, w.timezone, w.sessionMinutes]).toEqual([TODAY, TODAY, "2026-10-13", "2026-12-01", "Europe/London", 60]);
    // It is 07:30: all four of today's are still to come.
    expect(dayOf(w, TODAY).free).toEqual([540, 600, 660, 720]);
    const friday = dayOf(w, FRIDAY);
    expect(friday.free).toEqual([540, 600, 720]);
    expect(friday.appointments.map((a) => [a.name, a.localStartMinute, a.minutes, a.startsAt, a.status])).toEqual([
      ["Tom Week", 660, 60, "2026-10-09T10:00:00.000Z", "booked"],
    ]);

    // A longer session from now on: the one booked stays an hour, and blocks what it runs into.
    expect((await setHours(open, open.owner, sam, { sessionMinutes: 90 })).statusCode).toBe(200);
    expect(dayOf(await week(open, open.owner, sam), FRIDAY).free).toEqual([540]);

    // The clocks go back on Sunday 25 October: 10:00 is 09:00 UTC before it and 10:00 UTC after.
    expect((await setHours(open, open.owner, sam)).statusCode).toBe(200);
    const before = made(await book(open, sam, tom, { day: "2026-10-24", minute: 600 }));
    const after = made(await book(open, sam, tom, { day: "2026-10-26", minute: 600 }));
    expect([before.startsAt, after.startsAt]).toEqual(["2026-10-24T09:00:00.000Z", "2026-10-26T10:00:00.000Z"]);

    // A week asked for before today starts today; one past the last day ends on it.
    expect((await week(open, open.owner, sam, "2026-09-01")).from).toBe(TODAY);
    const lastWeek = await week(open, open.owner, sam, "2027-01-01");
    expect(lastWeek.from).toBe("2026-12-01");
    expect(lastWeek.days.slice(1).flatMap((x) => x.free)).toEqual([]);
  });

  it("the hour the clocks skip is never offered", async () => {
    // Sunday 28 March 2027: in London 01:00 to 02:00 does not happen.
    clock = new Date("2027-03-25T09:00:00Z").getTime();
    try {
      const sam = await staff(open, "Skip Trainer");
      const set = await setHours(open, open.owner, sam, { hours: [{ weekday: 7, fromMinute: 0, toMinute: 180 }] });
      expect(set.statusCode, set.body).toBe(200);
      expect(dayOf(await week(open, open.owner, sam), "2027-03-28").free).toEqual([0, 120]);
      const tom = await listed(open, "Tom Skip");
      const skipped = await book(open, sam, tom, { day: "2027-03-28", minute: 60 });
      expect([skipped.statusCode, errorOf(skipped)]).toEqual([409, "not_a_time"]);
      expect(made(await book(open, sam, tom, { day: "2027-03-28", minute: 120 })).startsAt).toBe("2027-03-28T01:00:00.000Z");
    } finally {
      clock = NOW.getTime();
    }
  });

  it("a trainer keeps their own hours and sessions, and nobody else's", async () => {
    // Sam is a trainer the owner also lets read the member list; Ana is on a trainer's usual ticks.
    const sam = await staff(open, "Own Sam", ["members.read", "attendance.read", "members.confirm"]);
    const ana = await trainerWith(open, "Own Ana");
    const tom = await listed(open, "Tom Own");

    // Their own hours: saved by themselves.
    const mine = await setHours(open, sam, sam, { sessionMinutes: 45, hours: [{ weekday: 5, fromMinute: 960, toMinute: 1200 }] });
    expect(mine.statusCode, mine.body).toBe(200);
    const list = JSON.parse(mine.body) as PtTrainersResponse;
    expect([list.canManage, list.canBook, list.freeCancelMinutes]).toEqual([false, true, 120]);
    expect(list.trainers.map((t) => [t.name, t.mine, t.offers, t.sessionMinutes, t.hours])).toEqual([
      ["Own Sam", true, true, 45, [{ weekday: 5, fromMinute: 960, toMinute: 1200 }]],
    ]);
    expect(dayOf(await week(open, sam, sam), FRIDAY).free).toEqual([960, 1005, 1050, 1095, 1140]);

    // Somebody else's: not theirs to save, read, book or cancel.
    expect((await setHours(open, sam, ana)).statusCode).toBe(403);
    expect((await inject("GET", `/v1/orgs/${open.id}/pt/week?trainer=${ana.userId}`, sam.cookies)).statusCode).toBe(403);
    expect((await book(open, ana, tom, { by: sam })).statusCode).toBe(403);
    const anas = made(await book(open, ana, tom, { minute: 720 }));
    expect((await cancel(open, anas.id, { by: sam })).statusCode).toBe(403);
    expect((await cancel(open, randomUUID(), { by: sam })).statusCode).toBe(404);

    // Their own session: booked and cancelled by themselves.
    const own = made(await book(open, sam, tom, { by: sam, minute: 960 }));
    expect([own.name, own.entryId]).toEqual(["Tom Own", tom]);
    expect(made(await cancel(open, own.id, { by: sam })).status).toBe("cancelled");

    // A trainer on the usual ticks sees their own sessions by name, cannot book (they
    // cannot read the member list), is sent no record id, and can cancel their own.
    const anasList = JSON.parse((await inject("GET", `/v1/orgs/${open.id}/pt/trainers`, ana.cookies)).body) as PtTrainersResponse;
    expect([anasList.canManage, anasList.canBook, anasList.trainers.map((t) => t.userId)]).toEqual([false, false, [ana.userId]]);
    expect((await book(open, ana, tom, { by: ana, minute: 660 })).statusCode).toBe(403);
    expect(dayOf(await week(open, ana, ana), FRIDAY).appointments.map((a) => [a.name, a.entryId])).toEqual([["Tom Own", null]]);
    expect(dayOf(await week(open, open.owner, ana), FRIDAY).appointments.map((a) => a.entryId)).toEqual([tom]);
    expect(made(await cancel(open, anas.id, { by: ana })).status).toBe("cancelled");

    // The owner sees every member of staff, their own row among them.
    const all = JSON.parse((await inject("GET", `/v1/orgs/${open.id}/pt/trainers`, open.owner.cookies)).body) as PtTrainersResponse;
    expect(all.canManage).toBe(true);
    expect(all.trainers.filter((t) => t.mine).map((t) => t.userId)).toEqual([open.owner.userId]);
    expect(all.trainers.map((t) => t.userId)).toEqual(expect.arrayContaining([sam.userId, ana.userId]));


  });

  it("hours that make no sense are refused whole, and the old ones stay", async () => {
    const sam = await trainerWith(open, "Bad Hours");
    const bad: object[][] = [
      [{ weekday: 1, fromMinute: 600, toMinute: 540 }],
      [
        { weekday: 1, fromMinute: 600, toMinute: 720 },
        { weekday: 1, fromMinute: 660, toMinute: 780 },
      ],
      [{ weekday: 9, fromMinute: 600, toMinute: 660 }],
      [{ weekday: 1, fromMinute: 601, toMinute: 660 }],
    ];
    for (const hours of bad) expect((await setHours(open, open.owner, sam, { hours })).statusCode).toBe(400);
    for (const minutes of [5, 52, 245]) expect((await setHours(open, open.owner, sam, { sessionMinutes: minutes })).statusCode).toBe(400);
    const kept = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_trainer_hours WHERE gym_id = ${open.id} AND user_id = ${sam.userId}`;
    expect(kept[0]?.n).toBe(7);
    const notStaff = await signedIn("Hours Stranger");
    const res = await setHours(open, open.owner, notStaff);
    expect([res.statusCode, errorOf(res)]).toEqual([404, "trainer_not_found"]);
  });

  it("a session is as long as the gym says: 20 minutes and 75 minutes make their own times and are booked at that length", async () => {
    const sam = await staff(open, "Length Trainer");
    const tom = await listed(open, "Tom Length");
    const hours = [{ weekday: 5, fromMinute: 540, toMinute: 660 }];
    expect((await setHours(open, open.owner, sam, { sessionMinutes: 20, hours })).statusCode).toBe(200);
    expect(dayOf(await week(open, open.owner, sam), FRIDAY).free).toEqual([540, 560, 580, 600, 620, 640]);
    const short = made(await book(open, sam, tom, { minute: 560 }));
    expect([short.minutes, short.startsAt]).toEqual([20, "2026-10-09T08:20:00.000Z"]);
    // 75 minutes from now on: one fits in the two hours, and the 20 minutes booked blocks it.
    expect((await setHours(open, open.owner, sam, { sessionMinutes: 75, hours })).statusCode).toBe(200);
    expect(dayOf(await week(open, open.owner, sam), FRIDAY).free).toEqual([]);
    expect(made(await cancel(open, short.id)).status).toBe("cancelled");
    expect(dayOf(await week(open, open.owner, sam), FRIDAY).free).toEqual([540]);
    expect(made(await book(open, sam, tom, { minute: 540 })).minutes).toBe(75);
  });

  it("the people to pick from: those with personal training first, found by part of a name, and only for staff who may read the list", async () => {
    const gym = await makeGym("Picker PT");
    const sam = await trainerWith(gym, "Picker Trainer");
    const pack = await typeOf(gym, { kind: "pack", includesPt: true });
    const unlimited = await typeOf(gym, { includesPt: true });
    const classes = await typeOf(gym);
    const zara = await listed(gym, "Zara Pack");
    const yan = await listed(gym, "Yan Unlimited");
    const abe = await listed(gym, "Abe Classes");
    await listed(gym, "Bea Nothing");
    const used = await listed(gym, "Cal Used_Up");
    const gone = await listed(gym, "Dee Former");
    await hold(gym, zara, pack, { pack: 7 });
    await hold(gym, yan, unlimited);
    await hold(gym, abe, classes);
    await hold(gym, used, pack, { pack: 0 });
    await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE id = ${gone}`;
    const people = async (by: Person, query?: string): Promise<PtPeopleResponse> => {
      const res = await inject("GET", `/v1/orgs/${gym.id}/pt/people${query === undefined ? "" : `?query=${encodeURIComponent(query)}`}`, by.cookies);
      expect(res.statusCode, res.body).toBe(200);
      return JSON.parse(res.body) as PtPeopleResponse;
    };
    const all = await people(gym.owner);
    expect(all.gymHasTypes).toBe(true);
    expect(all.people.map((p) => [p.name, p.pt])).toEqual([
      ["Yan Unlimited", { membership: expect.stringMatching(/^Type /) as string, sessionsLeft: null }],
      ["Zara Pack", { membership: expect.stringMatching(/^Type /) as string, sessionsLeft: 7 }],
      ["Abe Classes", null],
      ["Bea Nothing", null],
      ["Cal Used_Up", null],
    ]);
    expect(all.more).toBe(false);
    // Part of a name, whatever its capitals; a typed `_` or `%` is a letter, not "anything".
    expect((await people(gym.owner, "zAR")).people.map((p) => p.entryId)).toEqual([zara]);
    expect((await people(gym.owner, "used_")).people.map((p) => p.entryId)).toEqual([used]);
    expect((await people(gym.owner, "a_e")).people).toEqual([]);
    expect((await people(gym.owner, "%")).people).toEqual([]);
    expect((await people(gym.owner, "Former")).people).toEqual([]);
    // What the list says is what the booking then does.
    expect(made(await book(gym, sam, zara)).packCharged).toBe(true);
    expect((await people(gym.owner, "Zara")).people[0]?.pt?.sessionsLeft).toBe(6);

    // A trainer on the usual ticks cannot read the member list here either; nor anybody outside the gym.
    expect((await inject("GET", `/v1/orgs/${gym.id}/pt/people`, sam.cookies)).statusCode).toBe(403);
    expect((await inject("GET", `/v1/orgs/${gym.id}/pt/people`, open.owner.cookies)).statusCode).toBe(404);
    expect((await inject("GET", `/v1/orgs/${gym.id}/pt/people`, {})).statusCode).toBe(401);
    expect((await inject("GET", `/v1/orgs/${gym.id}/pt/people?query=${"x".repeat(101)}`, gym.owner.cookies)).statusCode).toBe(400);
    // A gym that sells no memberships says so, and nobody has anything to show.
    const none = JSON.parse((await inject("GET", `/v1/orgs/${open.id}/pt/people?query=Tom%20Length`, open.owner.cookies)).body) as PtPeopleResponse;
    expect([none.gymHasTypes, none.people.map((p) => p.pt)]).toEqual([false, [null]]);
  });

  it("a stranger, another gym's owner and somebody signed out get nothing, and a member of the gym is not staff", async () => {
    const sam = await trainerWith(open, "Tenancy Trainer");
    const tom = await listed(open, "Tom Tenancy");
    const session = made(await book(open, sam, tom));
    const member = await signedIn("Tenancy Member");
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${open.id}, ${member.userId}, '2026-01-01T00:00:00Z')`;

    for (const who of [sells.owner, await signedIn("Tenancy Stranger"), member]) {
      const answers = await Promise.all([
        inject("GET", `/v1/orgs/${open.id}/pt/trainers`, who.cookies),
        inject("GET", `/v1/orgs/${open.id}/pt/week?trainer=${sam.userId}`, who.cookies),
        setHours(open, who, sam),
        book(open, sam, tom, { by: who, minute: 660 }),
        cancel(open, session.id, { by: who }),
      ]);
      expect(answers.map((r) => r.statusCode)).toEqual([404, 404, 404, 404, 404]);
      expect(new Set(answers.map(errorOf))).toEqual(new Set(["org_not_found"]));
    }
    // The other gym's owner, asking their own gym for this gym's trainer and session.
    expect((await inject("GET", `/v1/orgs/${sells.id}/pt/week?trainer=${sam.userId}`, sells.owner.cookies)).statusCode).toBe(404);
    expect((await cancel(sells, session.id)).statusCode).toBe(404);
    const crossed = await book(sells, sam, await listed(sells, "Crossed Person"));
    expect([crossed.statusCode, errorOf(crossed)]).toEqual([404, "trainer_not_found"]);

    const signedOut = await Promise.all([
      inject("GET", `/v1/orgs/${open.id}/pt/trainers`, {}),
      inject("GET", `/v1/orgs/${open.id}/pt/week?trainer=${sam.userId}`, {}),
      inject("PUT", `/v1/orgs/${open.id}/pt/trainers/${sam.userId}`, {}, { offers: true, sessionMinutes: 60, hours: [] }),
      inject("POST", `/v1/orgs/${open.id}/pt/appointments`, {}, {}),
      inject("POST", `/v1/orgs/${open.id}/pt/appointments/${session.id}/cancel`, {}, { lateOk: false, giveBack: false }),
    ]);
    expect(signedOut.map((r) => r.statusCode)).toEqual([401, 401, 401, 401, 401]);
    expect((await sessions(open, sam)).map((r) => r.status)).toEqual(["booked"]);
  });

  it("a request that does not parse is a 400 that changes nothing", async () => {
    const sam = await trainerWith(open, "Parse Trainer");
    const tom = await listed(open, "Tom Parse");
    const post = (payload: unknown) => inject("POST", `/v1/orgs/${open.id}/pt/appointments`, open.owner.cookies, payload);
    const good = { requestKey: randomUUID(), trainerId: sam.userId, entryId: tom, localDate: FRIDAY, startMinute: 600 };
    const answers = await Promise.all([
      post({ ...good, startMinute: 601 }),
      post({ ...good, localDate: "9 Oct" }),
      post({ ...good, entryId: "tom" }),
      post({ ...good, extra: true }),
      post({}),
      inject("GET", `/v1/orgs/${open.id}/pt/week?trainer=sam`, open.owner.cookies),
      inject("GET", `/v1/orgs/${open.id}/pt/week`, open.owner.cookies),
    ]);
    expect(answers.map((r) => r.statusCode)).toEqual([400, 400, 400, 400, 400, 400, 400]);
    expect(await sessions(open, sam)).toHaveLength(0);
  });

  it("a gym whose plan has lapsed reads its sessions and changes nothing", async () => {
    const lapsed = await makeGym("Lapsed PT");
    const sam = await trainerWith(lapsed, "Lapsed Trainer");
    const tom = await listed(lapsed, "Tom Lapsed");
    const session = made(await book(lapsed, sam, tom));
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${lapsed.id}`;
    const answers = await Promise.all([setHours(lapsed, lapsed.owner, sam), book(lapsed, sam, tom, { minute: 660 }), cancel(lapsed, session.id)]);
    expect(answers.map((r) => [r.statusCode, errorOf(r)])).toEqual([
      [409, "gym_not_on_plan"],
      [409, "gym_not_on_plan"],
      [409, "gym_not_on_plan"],
    ]);
    expect(dayOf(await week(lapsed, lapsed.owner, sam), FRIDAY).appointments).toHaveLength(1);
  });

  it("two records of one person joined: the sessions booked for the one not kept are the kept one's", async () => {
    const sam = await trainerWith(open, "Join Trainer");
    const gone = await listed(open, "Dana Join");
    const keep = await listed(open, "Dana Joined-Record");
    const session = made(await book(open, sam, gone));
    const joined = await inject("POST", `/v1/orgs/${open.id}/member-list/entries/${gone}/merge`, open.owner.cookies, { keepEntryId: keep, acknowledgeLeavesList: true });
    expect(joined.statusCode, joined.body).toBe(200);
    expect((await sessions(open, sam)).map((r) => [r.id, r.entry_id, r.status])).toEqual([[session.id, keep, "booked"]]);
  });
});
