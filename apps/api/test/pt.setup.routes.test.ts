// PERSONAL TRAINING'S LIST OF STEPS — what the page's ticks are read from, through the
// routes against real Postgres (DATABASE_URL-gated). ROADMAP Stage 2 item 23d; spec Part 3
// §13.5.
//
// The first block is the worst thing this job could do: a step shown as done because
// another gym's membership, person or session was read. One gym does every step and the
// gym beside it does none; each reads only its own.
//
// Every step is done the way a gym does it, through the route its own page calls, so a
// tick that stops following that page fails here.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { ptTrainersResponseSchema } from "@app/shared";
import type { GymMembershipTypesResponse, HeldMembershipsResponse, PtAppointment, PtSetup, PtTrainersResponse } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "personal-training-setup-secret-0123456", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 180_000;
const LIVE_PLAN = "zz_pt_setup_live";
const DAY_MS = 86_400_000;

let ipCounter = 0;
const nextIp = () => `10.78.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

/** The calendar day an instant falls on in a time zone, 'YYYY-MM-DD'. */
const dayIn = (ms: number, timeZone: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

const NOTHING: PtSetup = { typeIncludesPt: false, somebodyHoldsIt: false, listHasPeople: false, sessionBooked: false };
const EVERYTHING: PtSetup = { typeIncludesPt: true, somebodyHoldsIt: true, listHasPeople: true, sessionBooked: true };

d("personal training's list of steps: whose ticks, and what each follows (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  /** The instant the test file started; the page's clock moves from here. */
  const BASE = Date.now();
  let clock = BASE;
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'pts-t-%@example.com')`;
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
    await sql`DELETE FROM users WHERE email LIKE 'pts-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, cookies: Cookies, payload?: unknown, ip = nextIp()) =>
    api().inject({
      method,
      url: path,
      remoteAddress: ip,
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });

  interface Person {
    userId: string;
    cookies: Cookies;
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `pts-t-${uniq()}@example.com`;
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
    timezone: string;
  }
  const makeGym = async (name: string, timezone = "Europe/London", owner?: Person): Promise<Gym> => {
    const by = owner ?? (await signedIn(`${name} Owner`));
    const res = await inject("POST", "/v1/orgs", by.cookies, { trainsHere: false, name, city: "Leeds", country: "GB", timezone });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return { id, owner: by, timezone };
  };
  const onStaff = async (gym: Gym, name: string, role: "manager" | "trainer", privileges: string[] | null): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${person.userId}, ${role}, ${privileges})`;
    return person;
  };
  /** The gym's today, by the page's clock. */
  const today = (gym: Gym): string => dayIn(clock, gym.timezone);

  const trainersOf = async (gym: Gym, by: Person = gym.owner): Promise<PtTrainersResponse> => {
    const res = await inject("GET", `/v1/orgs/${gym.id}/pt/trainers`, by.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return ptTrainersResponseSchema.parse(JSON.parse(res.body));
  };
  const setupOf = async (gym: Gym, by: Person = gym.owner): Promise<PtSetup | null> => (await trainersOf(gym, by)).setup;

  // ── Each step, done the way its own page does it ──

  /** Memberships → Add a membership type. */
  const addType = async (gym: Gym, over: { includesPt: boolean; pack?: { classes: number; days: number } }): Promise<string> => {
    const name = `Type ${uniq()}`;
    const pack = over.pack ?? null;
    const res = await inject("POST", `/v1/orgs/${gym.id}/membership-types`, gym.owner.cookies, {
      name,
      description: null,
      kind: pack === null ? "recurring" : "pack",
      priceMinor: 4999,
      termCount: pack === null ? 1 : null,
      termUnit: pack === null ? "month" : null,
      packClasses: pack?.classes ?? null,
      packDays: pack?.days ?? null,
      access: "all_classes",
      bookingsLimit: null,
      bookingsPeriod: null,
      classTypeIds: null,
      includesPt: over.includesPt,
    });
    expect(res.statusCode, res.body).toBe(201);
    const made = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === name);
    if (made === undefined) throw new Error("no membership type came back");
    return made.id;
  };
  const typeUrl = (gym: Gym, typeId: string) => `/v1/orgs/${gym.id}/membership-types/${typeId}`;

  /** Members → Add member. */
  const addPerson = async (gym: Gym, fullName: string): Promise<string> => {
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName, email: `pts-l-${uniq()}@example.com` });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };
  const entryUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}`;

  /** A person's page → Add membership. Its id. */
  const give = async (gym: Gym, entryId: string, typeId: string, startsOn = today(gym)): Promise<string> => {
    const res = await inject("POST", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies, { requestKey: randomUUID(), typeId, startsOn, paid: true, method: "cash" });
    expect(res.statusCode, res.body).toBe(201);
    const held = (JSON.parse(res.body) as HeldMembershipsResponse).memberships.find((m) => m.typeId === typeId);
    if (held === undefined) throw new Error("the membership did not come back");
    return held.id;
  };
  const heldUrl = (gym: Gym, entryId: string, id: string, what: string) => `${entryUrl(gym, entryId)}/memberships/${id}/${what}`;

  /** Personal training → Add a trainer → their hours: 09:00 to 13:00 every day, an hour each. */
  const setHours = async (gym: Gym, trainer: Person): Promise<void> => {
    const res = await inject("PUT", `/v1/orgs/${gym.id}/pt/trainers/${trainer.userId}`, gym.owner.cookies, {
      offers: true,
      sessionMinutes: 60,
      hours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, fromMinute: 540, toMinute: 780 })),
    });
    expect(res.statusCode, res.body).toBe(200);
  };
  /** Personal training → a free time → the person: tomorrow at 10:00, or another morning hour. */
  const book = async (gym: Gym, trainer: Person, entryId: string, startMinute = 600): Promise<PtAppointment> => {
    const res = await inject("POST", `/v1/orgs/${gym.id}/pt/appointments`, gym.owner.cookies, {
      requestKey: randomUUID(),
      trainerId: trainer.userId,
      entryId,
      localDate: addDays(today(gym), 1),
      startMinute,
      minutes: 60,
    });
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { appointment: PtAppointment }).appointment;
  };
  const cancel = (gym: Gym, id: string) =>
    inject("POST", `/v1/orgs/${gym.id}/pt/appointments/${id}/cancel`, gym.owner.cookies, { lateOk: false, giveBack: false });

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), { orgs: { now: () => new Date(clock) } });
    await api().ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it("a gym's ticks are its own: one gym does every step and the gym beside it reads none, and nobody outside reads either", async () => {
    const setUp = await makeGym("Pts Set Up");
    const empty = await makeGym("Pts Empty");
    expect(await setupOf(setUp)).toEqual(NOTHING);
    expect(await setupOf(empty)).toEqual(NOTHING);

    // One gym does every step, each on its own page.
    const pt = await addType(setUp, { includesPt: true });
    const maya = await addPerson(setUp, "Maya Okafor");
    await give(setUp, maya, pt);
    await setHours(setUp, setUp.owner);
    await book(setUp, setUp.owner, maya);

    expect(await setupOf(setUp)).toEqual(EVERYTHING);
    // The gym beside it did none of them, and reads none.
    expect(await setupOf(empty)).toEqual(NOTHING);
    const beside = await trainersOf(empty);
    expect([beside.gymHasTypes, beside.trainers.filter((t) => t.sessionMinutes !== null)]).toEqual([false, []]);

    // And the other way: what the second gym does is its own, and the first loses nothing.
    await addPerson(empty, "Tom Reyes");
    expect(await setupOf(empty)).toEqual({ ...NOTHING, listHasPeople: true });
    expect(await setupOf(setUp)).toEqual(EVERYTHING);

    // Nobody outside reads either gym's.
    const stranger = await signedIn("Pts Stranger");
    const member = await signedIn("Pts Member");
    await sql`INSERT INTO gym_members (gym_id, user_id) VALUES (${setUp.id}, ${member.userId})`;
    const outsiders: [string, Cookies, number][] = [
      ["a stranger", stranger.cookies, 404],
      ["the other gym's owner", empty.owner.cookies, 404],
      ["this gym's own member", member.cookies, 404],
      ["nobody at all", {}, 401],
    ];
    for (const [who, cookies, status] of outsiders) {
      const res = await inject("GET", `/v1/orgs/${setUp.id}/pt/trainers`, cookies);
      expect(res.statusCode, who).toBe(status);
    }
  });

  it("the steps go to whoever runs the timetable, and to nobody else on the staff", async () => {
    const gym = await makeGym("Pts Who");
    await addType(gym, { includesPt: true });
    const manager = await onStaff(gym, "Pts Manager", "manager", null);
    const scheduler = await onStaff(gym, "Pts Scheduler", "trainer", ["members.read", "schedule.manage"]);
    const trainer = await onStaff(gym, "Pts Trainer", "trainer", null);
    const narrowed = await onStaff(gym, "Pts Narrowed", "manager", ["members.read", "members.confirm"]);

    const expected: PtSetup = { ...NOTHING, typeIncludesPt: true };
    expect(await setupOf(gym, gym.owner)).toEqual(expected);
    expect(await setupOf(gym, manager)).toEqual(expected);
    expect(await setupOf(gym, scheduler)).toEqual(expected);
    // A trainer has their own row, and a manager without the timetable theirs: no steps.
    for (const who of [trainer, narrowed]) {
      const list = await trainersOf(gym, who);
      expect([list.canManage, list.setup]).toEqual([false, null]);
    }
  });

  it("a type that includes personal training: ticked by that type alone, and not while it is archived", async () => {
    const gym = await makeGym("Pts Types");
    // A membership that does not include it is not one.
    const plain = await addType(gym, { includesPt: false });
    expect(await setupOf(gym)).toEqual(NOTHING);

    const pt = await addType(gym, { includesPt: true });
    expect(await setupOf(gym)).toEqual({ ...NOTHING, typeIncludesPt: true });
    // Archiving the other type changes nothing; archiving this one unticks it.
    expect((await inject("DELETE", typeUrl(gym, plain), gym.owner.cookies)).statusCode).toBe(200);
    expect(await setupOf(gym)).toEqual({ ...NOTHING, typeIncludesPt: true });
    expect((await inject("DELETE", typeUrl(gym, pt), gym.owner.cookies)).statusCode).toBe(200);
    expect(await setupOf(gym)).toEqual(NOTHING);
    expect((await inject("POST", `${typeUrl(gym, pt)}/restore`, gym.owner.cookies, {})).statusCode).toBe(200);
    expect(await setupOf(gym)).toEqual({ ...NOTHING, typeIncludesPt: true });

    // A pack counts as a membership does.
    const packs = await makeGym("Pts Packs", "Europe/London", gym.owner);
    await addType(packs, { includesPt: true, pack: { classes: 10, days: 60 } });
    expect(await setupOf(packs)).toEqual({ ...NOTHING, typeIncludesPt: true });
  });

  it("somebody holds it: ticked by a person on the list holding one in use, and not once it is cancelled or they are off the list", async () => {
    const gym = await makeGym("Pts Holds");
    const plain = await addType(gym, { includesPt: false });
    const pt = await addType(gym, { includesPt: true });
    const types: PtSetup = { ...NOTHING, typeIncludesPt: true };
    const maya = await addPerson(gym, "Maya Okafor");
    const tom = await addPerson(gym, "Tom Reyes");
    expect(await setupOf(gym)).toEqual({ ...types, listHasPeople: true });

    // A membership that does not include personal training is not it.
    await give(gym, tom, plain);
    expect(await setupOf(gym)).toEqual({ ...types, listHasPeople: true });

    const held = await give(gym, maya, pt);
    const holds: PtSetup = { ...types, listHasPeople: true, somebodyHoldsIt: true };
    expect(await setupOf(gym)).toEqual(holds);

    // Frozen, she still holds it; cancelled, she does not.
    expect((await inject("POST", heldUrl(gym, maya, held, "freeze"), gym.owner.cookies, {})).statusCode).toBe(200);
    expect(await setupOf(gym)).toEqual(holds);
    expect((await inject("POST", heldUrl(gym, maya, held, "unfreeze"), gym.owner.cookies, {})).statusCode).toBe(200);
    expect((await inject("POST", heldUrl(gym, maya, held, "cancel"), gym.owner.cookies, { when: "today" })).statusCode).toBe(200);
    expect(await setupOf(gym)).toEqual({ ...types, listHasPeople: true });

    // Somebody taken off the list no longer holds it for the gym, while others stay on it.
    await give(gym, maya, pt);
    expect(await setupOf(gym)).toEqual(holds);
    expect((await inject("DELETE", entryUrl(gym, maya), gym.owner.cookies)).statusCode).toBe(200);
    expect(await setupOf(gym)).toEqual({ ...types, listHasPeople: true });
    // And with the last person off it, the list has nobody.
    expect((await inject("DELETE", entryUrl(gym, tom), gym.owner.cookies)).statusCode).toBe(200);
    expect(await setupOf(gym)).toEqual(types);

    // A type archived after it was given is still held.
    const kept = await makeGym("Pts Kept", "Europe/London", gym.owner);
    const old = await addType(kept, { includesPt: true });
    await give(kept, await addPerson(kept, "Ana Lima"), old);
    expect((await inject("DELETE", typeUrl(kept, old), kept.owner.cookies)).statusCode).toBe(200);
    expect(await setupOf(kept)).toEqual({ ...NOTHING, listHasPeople: true, somebodyHoldsIt: true });
  });

  it("a pack counts while it has a session left and its days are not over, on the gym's own day", async () => {
    // A pack of one session: the gym's first booking uses it up. The gym did give it, so
    // "somebody holds it" stays ticked while the session booked on it holds its time.
    const gym = await makeGym("Pts Pack");
    const single = await addType(gym, { includesPt: true, pack: { classes: 1, days: 30 } });
    const maya = await addPerson(gym, "Maya Okafor");
    const pack = await give(gym, maya, single);
    await setHours(gym, gym.owner);
    expect(await setupOf(gym)).toEqual({ ...EVERYTHING, sessionBooked: false });
    const session = await book(gym, gym.owner, maya);
    const used = await sql<{ classes_left: number | null }[]>`SELECT classes_left FROM gym_held_memberships WHERE gym_id = ${gym.id} AND id = ${pack}`;
    expect(used[0]?.classes_left).toBe(0);
    expect(await setupOf(gym)).toEqual(EVERYTHING);
    // Cancelled in time, the pack has its session back and no session is booked.
    expect((await cancel(gym, session.id)).statusCode).toBe(200);
    expect(await setupOf(gym)).toEqual({ ...EVERYTHING, sessionBooked: false });
    // Booked again, and the session later cancelled late with the pack's session kept used:
    // nothing booked on the pack holds its time, and the pack has nothing left.
    const again = await book(gym, gym.owner, maya);
    expect(await setupOf(gym)).toEqual(EVERYTHING);
    await sql`UPDATE gym_pt_appointments SET status = 'late_cancelled', cancelled_at = now() WHERE gym_id = ${gym.id} AND id = ${again.id}`;
    expect(await setupOf(gym)).toEqual({ ...EVERYTHING, somebodyHoldsIt: false, sessionBooked: false });

    // A pack good for one day, in a gym fourteen hours ahead of UTC. It starts on the gym's
    // today, so it counts through the gym's tomorrow and not the day after.
    const far = await makeGym("Pts Far", "Pacific/Kiritimati", gym.owner);
    const short = await addType(far, { includesPt: true, pack: { classes: 5, days: 1 } });
    const start = today(far);
    await give(far, await addPerson(far, "Kai Tong"), short, start);
    const holds: PtSetup = { ...NOTHING, typeIncludesPt: true, listHasPeople: true, somebodyHoldsIt: true };
    try {
      // 09:00 UTC on the day after `start` is 23:00 that same day on Kiritimati: still inside.
      clock = Date.parse(`${addDays(start, 1)}T09:00:00Z`);
      expect(await setupOf(far)).toEqual(holds);
      // Two hours on it is 01:00 two days after `start` there, and still the day after by UTC.
      clock = Date.parse(`${addDays(start, 1)}T11:00:00Z`);
      expect(today(far)).toBe(addDays(start, 2));
      expect(await setupOf(far)).toEqual({ ...holds, somebodyHoldsIt: false });
    } finally {
      clock = BASE;
    }
  });

  it("a session booked: ticked while one is booked or took place, and not by one that was cancelled", async () => {
    // A gym with no membership types books anybody on its list.
    const gym = await makeGym("Pts Sessions");
    const maya = await addPerson(gym, "Maya Okafor");
    await setHours(gym, gym.owner);
    const listed: PtSetup = { ...NOTHING, listHasPeople: true };
    expect(await setupOf(gym)).toEqual(listed);

    const first = await book(gym, gym.owner, maya);
    expect(await setupOf(gym)).toEqual({ ...listed, sessionBooked: true });
    expect((await cancel(gym, first.id)).statusCode).toBe(200);
    expect(await setupOf(gym)).toEqual(listed);

    // One that took place stays ticked, whatever is cancelled after it.
    const came = await book(gym, gym.owner, maya, 660);
    await sql`UPDATE gym_pt_appointments SET status = 'attended' WHERE gym_id = ${gym.id} AND id = ${came.id}`;
    const later = await book(gym, gym.owner, maya, 720);
    expect((await cancel(gym, later.id)).statusCode).toBe(200);
    expect(await setupOf(gym)).toEqual({ ...listed, sessionBooked: true });

    // Those sessions were booked before the gym sold memberships, so on none: once it sells
    // one that includes personal training, nobody holds it yet.
    await addType(gym, { includesPt: true });
    expect(await setupOf(gym)).toEqual({ typeIncludesPt: true, somebodyHoldsIt: false, listHasPeople: true, sessionBooked: true });
  });
});
