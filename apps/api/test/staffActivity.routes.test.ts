// STAFF ACTIVITY, through its route against real Postgres (ROADMAP Stage 2 item 4d).
// DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: show one gym's staff, members or
// what its staff did to somebody outside that gym's owner — another gym's owner, or this
// gym's own manager or trainer. That is the first test, with a second gym's busy log at
// hand so that a leak would have something to show.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { STAFF_ACTIVITY_PAGE, staffActivityResponseSchema, type StaffActivityResponse } from "@app/shared";
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
  JWT_SECRET: "staff-activity-test-secret-0123456789abc", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 120_000;
const LIVE_PLAN = "zz_staff_activity_live";

let ipCounter = 0;
const nextIp = () => `10.94.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("Staff activity: who may read it, what it says and what it leaves out (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'staffact-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'staffact-t-%@example.com'`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_member_notes WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_attendance WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_attendance_removed WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_bookings WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_leads WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM user_fitness_profiles WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM refresh_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM consent_log WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM users WHERE email LIKE 'staffact-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST" | "DELETE", path: string, cookies: Cookies, payload?: unknown, remoteAddress: string = nextIp()) =>
    api().inject({
      method,
      url: path,
      remoteAddress,
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });

  interface Person {
    userId: string;
    cookies: Cookies;
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `staffact-t-${uniq()}@example.com`;
    const reg = await inject("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await inject("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };

  interface Gym {
    id: string;
    owner: Person;
    ownerName: string;
  }
  const makeGym = async (name: string): Promise<Gym> => {
    const ownerName = `${name} Owner`;
    const owner = await signedIn(ownerName);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Jorhat", country: "IN", timezone: "Asia/Kolkata" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return { id, owner, ownerName };
  };
  const onStaff = async (gym: Gym, name: string, role: "manager" | "trainer"): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${person.userId}, ${role}, ${null})`;
    return person;
  };
  /** Somebody added to the gym's list by hand, through the real route. */
  const addPerson = async (gym: Gym, fullName: string, by: Person = gym.owner): Promise<string> => {
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, by.cookies, { fullName, email: `staffact-l-${uniq()}@example.com` });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };
  /** A note in the gym's log, written as the server writes one, at a moment chosen. */
  const write = async (gym: Gym, input: { actor: string | null; action: string; targetType?: string; targetId?: string; meta?: Record<string, string>; at?: string }): Promise<void> => {
    await sql`
      INSERT INTO audit_log (actor_user_id, gym_id, action, target_type, target_id, meta, at)
      VALUES (${input.actor}, ${gym.id}, ${input.action}, ${input.targetType ?? "gym"}, ${input.targetId ?? gym.id}, ${sql.json(input.meta ?? {})},
              COALESCE(${input.at ?? null}::timestamptz, now()))`;
  };

  const activityUrl = (gym: Gym, query = "") => `/v1/orgs/${gym.id}/staff-activity${query === "" ? "" : `?${query}`}`;
  const read = async (gym: Gym, query = "", who: Person = gym.owner, address?: string): Promise<StaffActivityResponse> => {
    const res = await inject("GET", activityUrl(gym, query), who.cookies, undefined, address);
    expect(res.statusCode, res.body).toBe(200);
    return staffActivityResponseSchema.parse(JSON.parse(res.body));
  };
  const linesOf = (page: StaffActivityResponse): string[] => page.lines.map((l) => `${l.worker}: ${l.line}`);

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig({ ...baseEnv }), { redis });
  }, T);

  afterAll(async () => {
    await app?.close();
    await cleanup();
    await sql.end();
  }, T);

  it(
    "only the gym's own owner reads it: another gym's owner, this gym's manager and trainer, a member and nobody signed in are refused, and nothing of the other gym is in it",
    async () => {
      const riverside = await makeGym(`Riverside ${uniq()}`);
      const hilltop = await makeGym(`Hilltop ${uniq()}`);
      const manager = await onStaff(riverside, "Ravi Manager", "manager");
      const trainer = await onStaff(riverside, "Tara Trainer", "trainer");
      const member = await signedIn("Mona Member");
      await sql`INSERT INTO gym_members (gym_id, user_id) VALUES (${riverside.id}, ${member.userId})`;
      // Hilltop's staff are busy with Hilltop's people.
      const hilltopDesk = await onStaff(hilltop, "Hari Hilltop Desk", "manager");
      await addPerson(hilltop, "Hema Hilltop Secret", hilltopDesk);
      await addPerson(riverside, "Priya Riverside", manager);

      for (const [who, status] of [
        [hilltop.owner, 404],
        [manager, 403],
        [trainer, 403],
        [member, 404],
      ] as const) {
        const res = await inject("GET", activityUrl(riverside), who.cookies);
        expect(res.statusCode, res.body).toBe(status);
        expect(res.body).not.toContain("Priya Riverside");
        expect(res.body).not.toContain("Ravi Manager");
      }
      const nobody = await inject("GET", activityUrl(riverside), {});
      expect(nobody.statusCode).toBe(401);

      const page = await read(riverside);
      expect(linesOf(page)).toContain("Ravi Manager: Added Priya Riverside to the member list");
      const body = JSON.stringify(page);
      expect(body).not.toContain("Hilltop");
      expect(body).not.toContain("Hema");
      expect(body).not.toContain("Hari");
      // And Hilltop's owner reads Hilltop's, never Riverside's.
      const theirs = JSON.stringify(await read(hilltop));
      expect(theirs).toContain("Hema Hilltop Secret");
      expect(theirs).not.toContain("Priya");
      expect(theirs).not.toContain("Ravi");
    },
    T,
  );

  it(
    "a note whose target is another gym's person names nobody: the name is looked up at this gym only",
    async () => {
      const riverside = await makeGym(`Riverside ${uniq()}`);
      const hilltop = await makeGym(`Hilltop ${uniq()}`);
      const theirs = await addPerson(hilltop, "Hidden Hilltop Person");
      const theirLead = await sql<{ id: string }[]>`INSERT INTO gym_leads (gym_id, full_name, email, source, status) VALUES (${hilltop.id}, 'Hidden Hilltop Lead', ${`staffact-lead-${uniq()}@example.com`}, 'walk_in', 'new') RETURNING id`;
      await write(riverside, { actor: riverside.owner.userId, action: "org.member_note_added", targetType: "member_list_entry", targetId: theirs });
      await write(riverside, { actor: riverside.owner.userId, action: "org.lead_added", targetType: "lead", targetId: theirLead[0]?.id ?? "" });
      await write(riverside, { actor: riverside.owner.userId, action: "org.member_removed", targetType: "gym_member", targetId: randomUUID() });
      const page = await read(riverside);
      const body = JSON.stringify(page);
      expect(body).not.toContain("Hidden Hilltop");
      expect(page.lines.map((l) => l.line)).toEqual(
        expect.arrayContaining(["Added a note to a member no longer on your list", "Added a lead since deleted", "Removed a member no longer on your list from the app"]),
      );
    },
    T,
  );

  it(
    "what staff do through the real routes is listed, newest first, under the worker who did it; a removed worker's lines stay and they stay in the filter",
    async () => {
      const gym = await makeGym(`Iron House ${uniq()}`);
      const manager = await onStaff(gym, "Anita Desk", "manager");
      const entryId = await addPerson(gym, "Amit Rao", manager);
      const noted = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries/${entryId}/notes`, manager.cookies, { body: "Bad knee", requestKey: randomUUID() });
      expect(noted.statusCode, noted.body).toBeLessThan(300);
      const removed = await inject("DELETE", `/v1/orgs/${gym.id}/staff/${manager.userId}`, gym.owner.cookies);
      expect(removed.statusCode, removed.body).toBeLessThan(300);

      const page = await read(gym);
      expect(linesOf(page).slice(0, 3)).toEqual([
        `${gym.ownerName}: Removed Anita Desk from the staff`,
        "Anita Desk: Added a note to Amit Rao",
        "Anita Desk: Added Amit Rao to the member list",
      ]);
      expect(page.lines[0]?.workerId).toBe(gym.owner.userId);
      expect(JSON.stringify(page)).not.toContain("Bad knee");
      expect(page.workers.map((w) => [w.userId, w.current])).toEqual([
        [gym.owner.userId, true],
        [manager.userId, false],
      ]);
      // The filter on the former worker still finds what they did.
      const theirs = await read(gym, `worker=${manager.userId}`);
      expect(linesOf(theirs)).toEqual(["Anita Desk: Added a note to Amit Rao", "Anita Desk: Added Amit Rao to the member list"]);
    },
    T,
  );

  it(
    "what members did themselves, what the app did on its own and a waiver signed in the app are left out; a waiver signed at the desk is staff's",
    async () => {
      const gym = await makeGym(`Studio North ${uniq()}`);
      const member = await signedIn("Meera Member");
      const entryId = await addPerson(gym, "Meera Member");
      await write(gym, { actor: member.userId, action: "member.pt_booked", targetType: "gym_pt_appointment", targetId: randomUUID(), meta: { entryId } });
      await write(gym, { actor: member.userId, action: "org.join_applied", targetType: "gym_join_application", targetId: randomUUID() });
      await write(gym, { actor: member.userId, action: "org.waiver_signed", targetType: "gym_waiver", targetId: randomUUID(), meta: { via: "app" } });
      await write(gym, { actor: null, action: "org.join_expired", targetType: "gym_join_application", targetId: randomUUID() });
      await write(gym, { actor: null, action: "org.lead_follow_up_sent", targetType: "lead", targetId: randomUUID(), meta: { by: "app" } });
      await write(gym, { actor: gym.owner.userId, action: "org.waiver_signed", targetType: "gym_waiver", targetId: randomUUID(), meta: { via: "desk", signer: "person", entryId } });
      const page = await read(gym);
      expect(page.lines.map((l) => l.line)).toEqual(["Had Meera Member sign the waiver at the desk", "Added Meera Member to the member list", "Set up the gym in the app"]);
      expect(page.workers.map((w) => w.userId)).not.toContain(member.userId);
    },
    T,
  );

  it(
    "the dates are the gym's own days: a note at 00:30 in Kolkata is on that day, not the day before in UTC",
    async () => {
      const gym = await makeGym(`Date Gym ${uniq()}`);
      // 2026-03-10 19:00 UTC is 11 March 00:30 in Kolkata; 18:00 UTC is 10 March 23:30.
      await write(gym, { actor: gym.owner.userId, action: "org.hours_set", at: "2026-03-10T19:00:00Z" });
      await write(gym, { actor: gym.owner.userId, action: "org.booking_settings_changed", at: "2026-03-10T18:00:00Z" });
      const eleventh = await read(gym, "from=2026-03-11&to=2026-03-11");
      expect(eleventh.lines.map((l) => [l.day, l.minute, l.line])).toEqual([["2026-03-11", 30, "Changed the opening hours"]]);
      const tenth = await read(gym, "from=2026-03-10&to=2026-03-10");
      expect(tenth.lines.map((l) => [l.day, l.minute, l.line])).toEqual([["2026-03-10", 1410, "Changed the booking rules"]]);
      const both = await read(gym, "from=2026-03-10&to=2026-03-11");
      expect(both.lines).toHaveLength(2);
    },
    T,
  );

  it(
    "Show more walks every line once, in order, even where many notes share one moment",
    async () => {
      const gym = await makeGym(`Busy Gym ${uniq()}`);
      const total = STAFF_ACTIVITY_PAGE * 2 + 20;
      // Forty notes share each moment, to the microsecond, as one bulk action's now() writes
      // them; a cursor that lost its microseconds skipped the rest of that moment.
      await sql`
        INSERT INTO audit_log (actor_user_id, gym_id, action, target_type, target_id, meta, at)
        SELECT ${gym.owner.userId}, ${gym.id}, 'org.post_added', 'post', gen_random_uuid()::text, '{}'::jsonb,
               '2026-05-01T10:00:00.123456Z'::timestamptz + (n / 40) * interval '1 second'
        FROM generate_series(1, ${total}) AS n`;
      const seen: string[] = [];
      let after: string | null = null;
      let pages = 0;
      do {
        const page: StaffActivityResponse = await read(gym, after === null ? "" : `after=${encodeURIComponent(after)}`);
        seen.push(...page.lines.map((l) => l.id));
        after = page.next;
        pages += 1;
      } while (after !== null && pages < 10);
      // The gym's own creation note is the one more.
      expect(pages).toBe(3);
      expect(seen).toHaveLength(total + 1);
      expect(new Set(seen).size).toBe(total + 1);
      const ids = await sql<{ id: string }[]>`SELECT id::text AS id FROM audit_log WHERE gym_id = ${gym.id} ORDER BY at DESC, id DESC`;
      expect(seen).toEqual(ids.map((r) => r.id));
    },
    T,
  );

  it(
    "a visit added and then removed through the real routes names the person still on the list on both lines",
    async () => {
      const gym = await makeGym(`Visit Gym ${uniq()}`);
      const desk = await onStaff(gym, "Dev Desk", "manager");
      const entryId = await addPerson(gym, "Amit Rao");
      const yesterday = (await sql<{ d: string }[]>`SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date - 1)::text AS d`)[0]?.d ?? "";
      const added = await inject("POST", `/v1/orgs/${gym.id}/attendance/visits`, desk.cookies, { pick: { entryId }, day: yesterday });
      expect(added.statusCode, added.body).toBe(200);
      const visitId = (await sql<{ id: string }[]>`SELECT id FROM gym_attendance WHERE gym_id = ${gym.id} AND entry_id = ${entryId}`)[0]?.id ?? "";
      const removed = await inject("DELETE", `/v1/orgs/${gym.id}/attendance/visits/${visitId}`, desk.cookies);
      expect(removed.statusCode, removed.body).toBe(200);
      const lines = (await read(gym, `worker=${desk.userId}`)).lines.map((l) => l.line);
      expect(lines[0]).toMatch(/^Removed Amit Rao's visit on /);
      expect(lines[1]).toMatch(/^Added a visit for Amit Rao on /);
    },
    T,
  );

  it(
    "a class booking marked through the real route keeps its person's name after the booking goes with its class",
    async () => {
      const gym = await makeGym(`Class Gym ${uniq()}`);
      const entryId = await addPerson(gym, "Meena Iyer");
      const account = (await sql<{ id: string }[]>`INSERT INTO users (email, display_name) VALUES (${`staffact-t-m-${uniq()}@example.com`}, 'Meena I') RETURNING id`)[0]?.id ?? "";
      await sql`INSERT INTO gym_members (gym_id, user_id, entry_id) VALUES (${gym.id}, ${account}, ${entryId})`;
      const type =
        (await sql<{ id: string }[]>`
        INSERT INTO gym_class_types (gym_id, name, minutes, places, colour, open_gym) VALUES (${gym.id}, 'Spin', 45, 20, 'blue', false) RETURNING id`)[0]?.id ?? "";
      const session =
        (await sql<{ id: string }[]>`
        INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places, status)
        VALUES (${gym.id}, ${type}, ((now() AT TIME ZONE 'Asia/Kolkata')::date - 1), 600, now() - interval '1 day', 45, 20, 'scheduled')
        RETURNING id`)[0]?.id ?? "";
      const booking =
        (await sql<{ id: string }[]>`
        INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, request_key, status, pack_charged, booked_at)
        VALUES (${gym.id}, ${session}, ${account}, ${entryId}, gen_random_uuid(), 'booked', false, now() - interval '2 days')
        RETURNING id`)[0]?.id ?? "";
      const marked = await inject("POST", `/v1/orgs/${gym.id}/class-sessions/${session}/bookings/${booking}/mark`, gym.owner.cookies, { status: "attended" });
      expect(marked.statusCode, marked.body).toBeLessThan(300);
      // The class goes, and its bookings with it (classes/bookingsRepo.ts deleteBookingsOf).
      await sql`DELETE FROM gym_class_bookings WHERE gym_id = ${gym.id} AND session_id = ${session}`;
      expect((await read(gym)).lines[0]?.line).toBe("Marked Meena Iyer as attended in a class");
    },
    T,
  );

  it(
    "a paid mark taken back reads as taken back, never as marked paid",
    async () => {
      const gym = await makeGym(`Mark Gym ${uniq()}`);
      const entryId = await addPerson(gym, "Amit Rao");
      // As `undoMark` (memberships/billsRepo.ts) writes it.
      await write(gym, {
        actor: gym.owner.userId,
        action: "org.held_membership_paid",
        targetType: "gym_held_membership",
        targetId: randomUUID(),
        meta: { entryId, type: "Gold", on: "2026-10-15", paidBefore: "2", paidAfter: "1" },
      });
      expect((await read(gym)).lines[0]?.line).toBe("Took back a paid mark on Amit Rao's Gold membership");
    },
    T,
  );

  it(
    "two gyms' owners and a manager reading at ONE address each get their own answer",
    async () => {
      const address = "203.0.113.77";
      const north = await makeGym(`North ${uniq()}`);
      const south = await makeGym(`South ${uniq()}`);
      const northDesk = await onStaff(north, "Neha North", "manager");
      await addPerson(north, "Norah North Member", northDesk);
      await addPerson(south, "Sami South Member");
      for (let i = 0; i < 3; i++) {
        expect(JSON.stringify(await read(north, "", north.owner, address))).toContain("Norah North Member");
        const theirs = JSON.stringify(await read(south, "", south.owner, address));
        expect(theirs).toContain("Sami South Member");
        expect(theirs).not.toContain("Norah");
        const refused = await inject("GET", activityUrl(north), northDesk.cookies, undefined, address);
        expect(refused.statusCode).toBe(403);
        expect(refused.body).not.toContain("Norah");
      }
    },
    T,
  );

  it(
    "a query it cannot read is refused with nothing read: a worker that is no id, half a date range, a range backwards, a stray field, forged cursors",
    async () => {
      const gym = await makeGym(`Strict Gym ${uniq()}`);
      const forged = ["2026-01-01T00:00:00.000000Z_9999999999999999999", "2026-01-01T99:99:99.000000Z_1", "2026-13-45T00:00:00.000000Z_1", "2026-02-30T00:00:00.000000Z_1", "2026-01-01T00:00:00Z_1"];
      for (const query of [
        "worker=bob",
        "from=2026-03-01",
        "to=2026-03-01",
        "from=2026-03-02&to=2026-03-01",
        "from=2026-02-30&to=2026-03-01",
        "colour=red",
        "after=1%3B%20DROP",
        ...forged.map((c) => `after=${encodeURIComponent(c)}`),
      ]) {
        const res = await inject("GET", activityUrl(gym, query), gym.owner.cookies);
        expect(res.statusCode, query).toBe(400);
        expect(res.body).not.toContain("DROP");
      }
    },
    T,
  );
});
