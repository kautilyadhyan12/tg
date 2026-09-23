// BULK EDIT — several time slots of one class from a date, against real
// Postgres (DATABASE_URL-gated). ROADMAP Stage 2 item 17b-ii-b-ii-b; Part 3 §13.3.
//
// The first test is the job's worst thing: a bulk edit "from a date" that also
// changes the classes BEFORE that date, or reaches a time slot of another class
// or another gym, so people turn up expecting the wrong coach or class size.
// Every refusal is checked by reading the rows, never only the reply, and every
// refused request has a positive control.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { bulkChangeSlots, createSchedule } from "../src/modules/orgs/classes/repo.js";
import type { GymClassWeekResponse, GymClassesResponse } from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "class-bulk-secret-0123456789abcdef", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;

const TEST_TIMEOUT_MS = 90_000;
const HOOK_TIMEOUT_MS = 90_000;
const LIVE_PLAN = "zz_class_bulk_routes";

interface CreatedOrg {
  org: { id: string; slug: string; name: string };
  joinCode: { code: string; label: string };
}

let ipCounter = 0;
const nextIp = () =>
  `10.64.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];
const at = (h: number, m = 0) => h * 60 + m;
const RUN = { minutes: 60, places: 20, coachUserId: null };

/** `YYYY-MM-DD` plus whole days, in UTC so no zone enters the arithmetic. */
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

interface SessionRow {
  id: string;
  schedule_id: string | null;
  local_date: string;
  local_start_minute: number;
  starts_at: Date;
  minutes: number;
  places: number | null;
  coach_user_id: string | null;
  status: string;
  changed_alone: boolean;
}

interface SlotRow {
  id: string;
  weekdays: number[];
  local_start_minute: number;
  starts_on: string;
  ends_on: string | null;
  ended_at: Date | null;
  minutes: number;
  places: number | null;
  coach_user_id: string | null;
}

d("bulk edit of a class's time slots (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'clsbulk-t-%@example.com')`;
    await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_schedules WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'clsbulk-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (
    method: "GET" | "POST" | "PUT",
    path: string,
    cookies: Record<string, string>,
    payload?: unknown,
    on: App = api(),
    remoteAddress = nextIp(),
  ) =>
    on.inject({
      method,
      url: path,
      remoteAddress,
      cookies,
      ...(payload === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const get = (path: string, cookies: Record<string, string> = {}) => inject("GET", path, cookies);
  const post = (path: string, payload: unknown, cookies: Record<string, string> = {}) =>
    inject("POST", path, cookies, payload);
  const put = (path: string, payload: unknown, cookies: Record<string, string> = {}) =>
    inject("PUT", path, cookies, payload);

  const makeUser = async (local: string) => {
    const email = `clsbulk-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", {
      email,
      password: PASSWORD,
      displayName: `Bulk ${local}`,
    });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
  };

  const makeOrg = async (cookies: Record<string, string>, name: string): Promise<CreatedOrg> => {
    const res = await post(
      "/v1/orgs",
      { name, city: "Leeds", country: "GB", timezone: "Europe/London" },
      cookies,
    );
    expect(res.statusCode).toBe(201);
    const created = JSON.parse(res.body) as CreatedOrg;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${created.org.id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}),
              'trialing', 'pilot')`;
    return created;
  };

  const joinAsStaff = async (
    person: { email: string; cookies: Record<string, string> },
    org: CreatedOrg,
    ownerCookies: Record<string, string>,
    role: "trainer" | "manager" | null,
  ) => {
    const applied = await post("/v1/orgs/join", { code: org.joinCode.code }, person.cookies);
    expect(applied.statusCode).toBe(200);
    const id = (JSON.parse(applied.body) as { application?: { id: string } }).application?.id;
    if (id === undefined) throw new Error("apply returned no application");
    expect(
      (await post(`/v1/orgs/${org.org.id}/applications/${id}/confirm`, {}, ownerCookies))
        .statusCode,
    ).toBe(200);
    if (role !== null) {
      expect(
        (await post(`/v1/orgs/${org.org.id}/staff`, { email: person.email, role }, ownerCookies))
          .statusCode,
      ).toBe(201);
    }
  };

  const classesUrl = (gymId: string) => `/v1/orgs/${gymId}/classes`;
  const bulkUrl = (gymId: string, typeId: string) => `${classesUrl(gymId)}/${typeId}/bulk-edit`;
  const weekUrl = (gymId: string) => `/v1/orgs/${gymId}/class-sessions`;
  const dayUrl = (gymId: string, id: string) => `/v1/orgs/${gymId}/class-sessions/${id}`;
  const cancelUrl = (gymId: string, id: string) => `${dayUrl(gymId, id)}/cancel`;

  const timetableOf = (res: { body: string }) => JSON.parse(res.body) as GymClassesResponse;
  const gymToday = async (gymId: string, cookies: Record<string, string>) =>
    (JSON.parse((await get(weekUrl(gymId), cookies)).body) as GymClassWeekResponse).today;

  const makeClass = async (gymId: string, cookies: Record<string, string>, name: string) => {
    const made = await post(classesUrl(gymId), { name, minutes: 60, places: 20, colour: "teal" }, cookies);
    expect(made.statusCode).toBe(201);
    const type = timetableOf(made).entries.find((e) => e.type.name === name)?.type;
    if (type === undefined) throw new Error("create answered no class");
    return type.id;
  };

  /** A time slot of `typeId`; answers its id. */
  const addSlot = async (
    gymId: string,
    cookies: Record<string, string>,
    typeId: string,
    slot: {
      weekdays?: number[];
      startMinute: number;
      startsOn: string;
      endsOn?: string | null;
      minutes?: number;
      places?: number | null;
      coachUserId?: string | null;
    },
  ) => {
    const known = new Set((await slotRows(typeId)).map((s) => s.id));
    const res = await post(
      `${classesUrl(gymId)}/${typeId}/repeats`,
      { ...RUN, weekdays: EVERY_DAY, ...slot },
      cookies,
    );
    expect(res.statusCode, res.body).toBe(201);
    const made = (await slotRows(typeId)).filter((s) => !known.has(s.id));
    if (made.length !== 1 || made[0] === undefined) throw new Error("repeat answered nothing");
    return made[0].id;
  };

  const classRows = (typeId: string) =>
    sql<SessionRow[]>`
      SELECT id, schedule_id, local_date::text AS local_date, local_start_minute, starts_at,
             minutes, places, coach_user_id, status, changed_alone
      FROM gym_class_sessions WHERE class_type_id = ${typeId}
      ORDER BY local_date, local_start_minute, id`;

  const slotRows = (typeId: string) =>
    sql<SlotRow[]>`
      SELECT id, weekdays, local_start_minute, starts_on::text AS starts_on,
             ends_on::text AS ends_on, ended_at, minutes, places, coach_user_id
      FROM gym_class_schedules WHERE class_type_id = ${typeId}
      ORDER BY starts_on, local_start_minute, id`;

  const onDate = async (typeId: string, day: string, minute: number) => {
    const row = (await classRows(typeId)).find(
      (r) => r.local_date === day && r.local_start_minute === minute,
    );
    if (row === undefined) throw new Error(`no class on ${day} at ${String(minute)}`);
    return row;
  };

  const changeAlone = async (
    gymId: string,
    cookies: Record<string, string>,
    sessionId: string,
    startMinute: number,
  ) => {
    const res = await put(
      dayUrl(gymId, sessionId),
      { scope: "this", ...RUN, startMinute, places: 5 },
      cookies,
    );
    expect(res.statusCode).toBe(200);
  };

  const bulkAudits = (gymId: string) =>
    sql<{ target_id: string; meta: Record<string, string> }[]>`
      SELECT target_id, meta FROM audit_log
      WHERE gym_id = ${gymId} AND action = 'org.class_schedule_updated' AND meta->>'bulk' = 'true'`;

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                         seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month',
              100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), {
      emailSender: {
        sendVerificationEmail: () => Promise.resolve(),
        sendPasswordResetEmail: () => Promise.resolve(),
        sendSignInCodeEmail: () => Promise.resolve(),
      },
    });
    await api().ready();
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, HOOK_TIMEOUT_MS);

  // =========================================================================
  // THE WORST THING
  // =========================================================================

  it(
    "a bulk edit from a date leaves every class before it exactly as it was, and reaches no time slot of another class or another gym",
    async () => {
      const owner = await makeUser("worst-owner");
      const coach = await makeUser("worst-coach");
      const stranger = await makeUser("worst-stranger");
      const member = await makeUser("worst-member");
      const trainer = await makeUser("worst-trainer");
      const rival = await makeUser("worst-rival");
      const org = await makeOrg(owner.cookies, "Worst Bulk Gym");
      const rivalOrg = await makeOrg(rival.cookies, "Worst Bulk Rival");
      await joinAsStaff(coach, org, owner.cookies, "trainer");
      await joinAsStaff(member, org, owner.cookies, null);
      await joinAsStaff(trainer, org, owner.cookies, "trainer");
      const gym = org.org.id;
      const today = await gymToday(gym, owner.cookies);
      const from = addDays(today, 10);
      const started = addDays(today, -2);

      const spin = await makeClass(gym, owner.cookies, "Spin");
      const evening = await addSlot(gym, owner.cookies, spin, { startMinute: at(18), startsOn: started });
      const morning = await addSlot(gym, owner.cookies, spin, { startMinute: at(7), startsOn: started });
      const yoga = await makeClass(gym, owner.cookies, "Yoga");
      const yogaSlot = await addSlot(gym, owner.cookies, yoga, { startMinute: at(18), startsOn: started });
      const rivalClass = await makeClass(rivalOrg.org.id, rival.cookies, "Rival Spin");
      const rivalSlot = await addSlot(rivalOrg.org.id, rival.cookies, rivalClass, {
        startMinute: at(18),
        startsOn: started,
      });

      // Before the date, a class cancelled and one changed on its own; after
      // it, the same two kinds.
      const cancelledBefore = await onDate(spin, addDays(from, -3), at(18));
      expect((await post(cancelUrl(gym, cancelledBefore.id), {}, owner.cookies)).statusCode).toBe(200);
      await changeAlone(gym, owner.cookies, (await onDate(spin, addDays(from, -2), at(7))).id, at(7, 30));
      const cancelledAfter = await onDate(spin, addDays(from, 1), at(18));
      expect((await post(cancelUrl(gym, cancelledAfter.id), {}, owner.cookies)).statusCode).toBe(200);
      const aloneAfter = await onDate(spin, addDays(from, 2), at(18));
      await changeAlone(gym, owner.cookies, aloneAfter.id, at(19));

      const all = await classRows(spin);
      const before = all.filter((r) => r.local_date < from);
      const fromOn = all.filter((r) => r.local_date >= from);
      expect(before.length).toBe(20);
      expect(fromOn.length).toBeGreaterThan(80);
      const slotsBefore = await slotRows(spin);
      const yogaBefore = await classRows(yoga);
      const rivalBefore = await classRows(rivalClass);
      const body = (scheduleIds: string[]) => ({
        scheduleIds,
        updateFrom: from,
        set: { minutes: 45, places: 12, coachUserId: coach.userId },
      });

      const outsiders: { who: string; cookies: Record<string, string>; status: number }[] = [
        { who: "a stranger", cookies: stranger.cookies, status: 404 },
        { who: "a rival gym's owner", cookies: rival.cookies, status: 404 },
        { who: "this gym's own member", cookies: member.cookies, status: 404 },
        { who: "this gym's own trainer", cookies: trainer.cookies, status: 403 },
        { who: "nobody at all", cookies: {}, status: 401 },
      ];
      for (const outsider of outsiders) {
        const res = await post(bulkUrl(gym, spin), body([evening, morning]), outsider.cookies);
        expect(res.statusCode, outsider.who).toBe(outsider.status);
      }
      // Ids that are not this class's time slots, in this gym, however mixed.
      const wrong: [string, string, string[], Record<string, string>][] = [
        ["our ids under the rival's gym", bulkUrl(rivalOrg.org.id, spin), [evening, morning], rival.cookies],
        ["the rival's time slot beside ours", bulkUrl(gym, spin), [evening, rivalSlot], owner.cookies],
        ["Yoga's time slot beside Spin's", bulkUrl(gym, spin), [evening, yogaSlot], owner.cookies],
        ["Spin's time slots under Yoga", bulkUrl(gym, yoga), [evening, morning], owner.cookies],
        ["the rival's class under our gym", bulkUrl(gym, rivalClass), [rivalSlot], owner.cookies],
      ];
      for (const [label, path, ids, cookies] of wrong) {
        const res = await post(path, body(ids), cookies);
        expect(res.statusCode, label).toBe(404);
        expect(JSON.parse(res.body), label).toMatchObject({ error: "class_not_found" });
      }
      expect(await classRows(spin)).toEqual(all);
      expect(await slotRows(spin)).toEqual(slotsBefore);
      expect(await classRows(yoga)).toEqual(yogaBefore);
      expect(await classRows(rivalClass)).toEqual(rivalBefore);
      expect(await bulkAudits(gym)).toEqual([]);

      // THE POSITIVE CONTROL: the owner, the same request.
      const done = await post(bulkUrl(gym, spin), body([evening, morning]), owner.cookies);
      expect(done.statusCode, done.body).toBe(200);

      const after = await classRows(spin);
      // Every class before the date: the same rows, every column.
      expect(after.filter((r) => r.local_date < from)).toEqual(before);
      // From the date: the same classes, each with the new values, except the
      // one changed on its own; the cancelled one is still cancelled.
      const later = after.filter((r) => r.local_date >= from);
      expect(later.map((r) => r.id).sort()).toEqual(fromOn.map((r) => r.id).sort());
      for (const row of later) {
        if (row.id === aloneAfter.id) {
          expect(row).toMatchObject({ local_start_minute: at(19), places: 5, minutes: 60, coach_user_id: null, changed_alone: true });
          continue;
        }
        expect(row, row.local_date).toMatchObject({ minutes: 45, places: 12, coach_user_id: coach.userId });
        expect(row.status).toBe(row.id === cancelledAfter.id ? "cancelled" : "scheduled");
      }
      // Other classes and the other gym: untouched.
      expect(await classRows(yoga)).toEqual(yogaBefore);
      expect(await classRows(rivalClass)).toEqual(rivalBefore);

      // Each time slot ends the day before and is followed by one from the date.
      const slots = await slotRows(spin);
      expect(slots).toHaveLength(4);
      for (const id of [evening, morning]) {
        const old = slots.find((s) => s.id === id);
        expect(old).toMatchObject({ ends_on: addDays(from, -1), minutes: 60, places: 20, coach_user_id: null });
      }
      const fresh = slots.filter((s) => s.starts_on === from);
      expect(fresh.map((s) => s.local_start_minute).sort((a, b) => a - b)).toEqual([at(7), at(18)]);
      for (const s of fresh) {
        expect(s).toMatchObject({ ends_on: null, minutes: 45, places: 12, coach_user_id: coach.userId });
      }
      expect(new Set(later.map((r) => r.schedule_id))).toEqual(new Set(fresh.map((s) => s.id)));

      // The screen answers with the same: both halves of each.
      const listed = timetableOf(done).entries.find((e) => e.type.id === spin)?.schedules ?? [];
      expect(listed).toHaveLength(4);

      // One audit row a time slot, ids and never a name.
      const audits = await bulkAudits(gym);
      expect(audits.map((a) => a.target_id).sort()).toEqual([evening, morning].sort());
      for (const a of audits) {
        expect(a.meta).toMatchObject({ from, coach: `none -> ${coach.userId}`, places: "20 -> 12" });
        expect(JSON.stringify(a.meta)).not.toContain("Bulk worst-coach");
      }
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // WHAT IS KEPT
  // =========================================================================

  it(
    "a field left out keeps each time slot's own value, and a bulk edit that changes nothing writes nothing",
    async () => {
      const owner = await makeUser("keep-owner");
      const coach = await makeUser("keep-coach");
      const org = await makeOrg(owner.cookies, "Keep Bulk Gym");
      await joinAsStaff(coach, org, owner.cookies, "trainer");
      const gym = org.org.id;
      const today = await gymToday(gym, owner.cookies);
      const from = addDays(today, 7);
      const type = await makeClass(gym, owner.cookies, "Circuit");
      const a = await addSlot(gym, owner.cookies, type, {
        weekdays: [1, 3],
        startMinute: at(18),
        startsOn: today,
        minutes: 60,
        places: 20,
      });
      const b = await addSlot(gym, owner.cookies, type, {
        weekdays: [2, 4],
        startMinute: at(7),
        startsOn: today,
        minutes: 30,
        places: 8,
        coachUserId: coach.userId,
      });

      // Only the size, and "no limit" at that.
      const res = await post(
        bulkUrl(gym, type),
        { scheduleIds: [a, b], updateFrom: from, set: { places: null } },
        owner.cookies,
      );
      expect(res.statusCode, res.body).toBe(200);
      const fresh = (await slotRows(type)).filter((s) => s.starts_on === from);
      expect(fresh.map((s) => [s.local_start_minute, s.minutes, s.places, s.coach_user_id])).toEqual(
        expect.arrayContaining([
          [at(18), 60, null, null],
          [at(7), 30, null, coach.userId],
        ]),
      );
      const later = (await classRows(type)).filter((r) => r.local_date >= from);
      expect(later.length).toBeGreaterThan(0);
      for (const row of later) {
        expect(row.places).toBeNull();
        expect(row.minutes).toBe(row.local_start_minute === at(18) ? 60 : 30);
        expect(row.coach_user_id).toBe(row.local_start_minute === at(18) ? null : coach.userId);
      }

      // The same again: nothing differs, so nothing is written.
      const rows = await classRows(type);
      const slots = await slotRows(type);
      const audits = await bulkAudits(gym);
      const freshIds = fresh.map((s) => s.id);
      const again = await post(
        bulkUrl(gym, type),
        { scheduleIds: freshIds, updateFrom: from, set: { places: null } },
        owner.cookies,
      );
      expect(again.statusCode).toBe(200);
      expect(await classRows(type)).toEqual(rows);
      expect(await slotRows(type)).toEqual(slots);
      expect(await bulkAudits(gym)).toEqual(audits);

      // The old halves end the day before the date: a second bulk edit of them
      // from the same date is refused, and writes nothing.
      const stale = await post(
        bulkUrl(gym, type),
        { scheduleIds: [a, b], updateFrom: from, set: { minutes: 50 } },
        owner.cookies,
      );
      expect(stale.statusCode).toBe(409);
      expect(JSON.parse(stale.body)).toMatchObject({ error: "class_update_from" });
      expect(await classRows(type)).toEqual(rows);
      expect(await slotRows(type)).toEqual(slots);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a time slot starting after the date changes from its own first day, where it stands",
    async () => {
      const owner = await makeUser("later-owner");
      const org = await makeOrg(owner.cookies, "Later Bulk Gym");
      const gym = org.org.id;
      const today = await gymToday(gym, owner.cookies);
      const type = await makeClass(gym, owner.cookies, "Boxing");
      const now = await addSlot(gym, owner.cookies, type, { startMinute: at(18), startsOn: today });
      const soon = await addSlot(gym, owner.cookies, type, { startMinute: at(9), startsOn: addDays(today, 20) });
      const from = addDays(today, 5);
      const res = await post(
        bulkUrl(gym, type),
        { scheduleIds: [now, soon], updateFrom: from, set: { minutes: 40 } },
        owner.cookies,
      );
      expect(res.statusCode, res.body).toBe(200);
      const slots = await slotRows(type);
      // The running one split; the later one changed in place, no second half.
      expect(slots).toHaveLength(3);
      expect(slots.find((s) => s.id === soon)).toMatchObject({ starts_on: addDays(today, 20), minutes: 40, ends_on: null });
      const nine = (await classRows(type)).filter((r) => r.local_start_minute === at(9));
      expect(nine.length).toBeGreaterThan(0);
      expect(new Set(nine.map((r) => r.minutes))).toEqual(new Set([40]));
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // ALL OR NOTHING
  // =========================================================================

  it(
    "one time slot that cannot take the change refuses the whole bulk edit, and nothing is written",
    async () => {
      const owner = await makeUser("all-owner");
      const rival = await makeUser("all-rival");
      const org = await makeOrg(owner.cookies, "All Bulk Gym");
      await makeOrg(rival.cookies, "All Bulk Rival");
      const gym = org.org.id;
      const today = await gymToday(gym, owner.cookies);
      const from = addDays(today, 10);
      const type = await makeClass(gym, owner.cookies, "Row");
      const open = await addSlot(gym, owner.cookies, type, { startMinute: at(18), startsOn: today });
      const ending = await addSlot(gym, owner.cookies, type, {
        startMinute: at(7),
        startsOn: today,
        endsOn: addDays(from, -5),
      });
      const rows = await classRows(type);
      const slots = await slotRows(type);

      const refusals: [string, unknown, number, string][] = [
        [
          "a time slot that ends before the date",
          { scheduleIds: [open, ending], updateFrom: from, set: { minutes: 45 } },
          409,
          "class_update_from",
        ],
        [
          "a date that has passed",
          { scheduleIds: [open], updateFrom: addDays(today, -1), set: { minutes: 45 } },
          409,
          "class_update_from",
        ],
        [
          "a date past the calendar",
          { scheduleIds: [open], updateFrom: addDays(today, 60), set: { minutes: 45 } },
          409,
          "class_update_from",
        ],
        [
          "a coach who is not this gym's staff",
          { scheduleIds: [open, ending], updateFrom: addDays(today, 2), set: { coachUserId: rival.userId } },
          400,
          "coach_not_staff",
        ],
        ["nothing to change", { scheduleIds: [open], updateFrom: from, set: {} }, 400, "validation_error"],
        [
          "a time slot twice",
          { scheduleIds: [open, open], updateFrom: from, set: { minutes: 45 } },
          400,
          "validation_error",
        ],
        [
          "not a real date",
          { scheduleIds: [open], updateFrom: "2026-02-31", set: { minutes: 45 } },
          400,
          "validation_error",
        ],
        [
          "a start time, which moves a time slot",
          { scheduleIds: [open], updateFrom: from, set: { startMinute: at(19) } },
          400,
          "validation_error",
        ],
      ];
      for (const [label, payload, status, error] of refusals) {
        const res = await post(bulkUrl(gym, type), payload, owner.cookies);
        expect(res.statusCode, label).toBe(status);
        expect(JSON.parse(res.body), label).toMatchObject({ error });
      }
      expect(await classRows(type)).toEqual(rows);
      expect(await slotRows(type)).toEqual(slots);
      expect(await bulkAudits(gym)).toEqual([]);

      // The positive control: both, from a date both run on.
      const ok = await post(
        bulkUrl(gym, type),
        { scheduleIds: [open, ending], updateFrom: addDays(today, 2), set: { minutes: 45 } },
        owner.cookies,
      );
      expect(ok.statusCode, ok.body).toBe(200);
      expect(await bulkAudits(gym)).toHaveLength(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "two staff at two app servers bulk editing the same class at the same moment: one changes it, the other is refused, and every date holds one class",
    async () => {
      const owner = await makeUser("race-owner");
      const org = await makeOrg(owner.cookies, "Race Bulk Gym");
      const gym = org.org.id;
      const today = await gymToday(gym, owner.cookies);
      const type = await makeClass(gym, owner.cookies, "Race");
      const a = await addSlot(gym, owner.cookies, type, { startMinute: at(18), startsOn: today });
      const b = await addSlot(gym, owner.cookies, type, { startMinute: at(7), startsOn: today });
      const from = addDays(today, 5);
      const second = await buildApp(loadConfig(baseEnv), {
        emailSender: {
          sendVerificationEmail: () => Promise.resolve(),
          sendPasswordResetEmail: () => Promise.resolve(),
          sendSignInCodeEmail: () => Promise.resolve(),
        },
      });
      await second.ready();
      try {
        const desk = "10.64.250.1";
        const runs: [App, number][] = [
          [api(), 45],
          [second, 50],
        ];
        const answers = await Promise.all(
          runs.map(([on, minutes]) =>
            inject(
              "POST",
              bulkUrl(gym, type),
              owner.cookies,
              { scheduleIds: [a, b], updateFrom: from, set: { minutes } },
              on,
              desk,
            ),
          ),
        );
        expect(answers.map((r) => r.statusCode).sort()).toEqual([200, 409]);
        expect(await slotRows(type)).toHaveLength(4);
        expect(await bulkAudits(gym)).toHaveLength(2);
        const [dupes] = await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM (
            SELECT local_date, local_start_minute FROM gym_class_sessions
            WHERE class_type_id = ${type}
            GROUP BY local_date, local_start_minute HAVING count(*) > 1) x`;
        expect(dupes?.n).toBe(0);
        const later = (await classRows(type)).filter((r) => r.local_date >= from);
        expect(new Set(later.map((r) => r.minutes)).size).toBe(1);
      } finally {
        await second.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  // Round one, weak test: nothing sent a bulk edit for a gym with no live plan.
  it(
    "a gym with no live plan cannot bulk edit, and nothing is written",
    async () => {
      const owner = await makeUser("lapsed-owner");
      const org = await makeOrg(owner.cookies, "Lapsed Bulk Gym");
      const gym = org.org.id;
      const today = await gymToday(gym, owner.cookies);
      const type = await makeClass(gym, owner.cookies, "Lapsed");
      const a = await addSlot(gym, owner.cookies, type, { startMinute: at(18), startsOn: today });
      const b = await addSlot(gym, owner.cookies, type, { startMinute: at(7), startsOn: today });
      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gym}`;
      const rows = await classRows(type);
      const slots = await slotRows(type);
      const res = await post(
        bulkUrl(gym, type),
        { scheduleIds: [a, b], updateFrom: addDays(today, 3), set: { minutes: 45 } },
        owner.cookies,
      );
      expect(res.statusCode).toBe(409);
      expect(await classRows(type)).toEqual(rows);
      expect(await slotRows(type)).toEqual(slots);
      expect(await bulkAudits(gym)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  // Round one, weak test: from today, with today's class already begun.
  it(
    "on a fixed clock: a bulk edit from today leaves the class that has started as it was, and changes the one still to come",
    async () => {
      const owner = await makeUser("clock-owner");
      const org = await makeOrg(owner.cookies, "Clock Bulk Gym");
      const gym = org.org.id;
      // Monday 5 October 2026, 13:00 in London.
      const now = new Date("2026-10-05T12:00:00Z");
      const type = await makeClass(gym, owner.cookies, "Clock");
      for (const minute of [at(7), at(18)]) {
        const made = await createSchedule(sql, {
          gymId: gym,
          classTypeId: type,
          weekdays: EVERY_DAY,
          startMinute: minute,
          startsOn: "2026-10-01",
          endsOn: null,
          ...RUN,
          actorUserId: owner.userId,
          now,
        });
        expect(made.kind).toBe("ok");
      }
      const ids = (await slotRows(type)).map((s) => s.id);
      const out = await bulkChangeSlots(sql, {
        gymId: gym,
        classTypeId: type,
        scheduleIds: ids,
        updateFrom: "2026-10-05",
        set: { minutes: 45 },
        actorUserId: owner.userId,
        now,
      });
      expect(out).toEqual({ kind: "ok", localDate: "2026-10-05" });
      const todays = (await classRows(type)).filter((r) => r.local_date === "2026-10-05");
      expect(todays.map((r) => [r.local_start_minute, r.minutes])).toEqual([
        [at(7), 60],
        [at(18), 45],
      ]);
      // Nothing before the date is left to run, so neither is split.
      expect(await slotRows(type)).toHaveLength(2);
      const tomorrow = (await classRows(type)).filter((r) => r.local_date === "2026-10-06");
      expect(new Set(tomorrow.map((r) => r.minutes))).toEqual(new Set([45]));
    },
    TEST_TIMEOUT_MS,
  );

  // Round one, H-1: the listed limit says what is full, and never tells the gym
  // to cancel or archive anything.
  it(
    "the listed limit says so in its own words, for a bulk edit and for a new time slot",
    async () => {
      const owner = await makeUser("listed-owner");
      const org = await makeOrg(owner.cookies, "Listed Bulk Gym");
      const gym = org.org.id;
      const today = await gymToday(gym, owner.cookies);
      const type = await makeClass(gym, owner.cookies, "Weekly");
      for (const day of EVERY_DAY) {
        await addSlot(gym, owner.cookies, type, { weekdays: [day], startMinute: at(18), startsOn: today });
      }
      const listedIds = async () => (await slotRows(type)).map((s) => s.id);
      // Three bulk edits, each from an earlier date, each ticking every one listed.
      const answers: { statusCode: number; body: string }[] = [];
      for (const k of [20, 10, 5]) {
        answers.push(
          await post(
            bulkUrl(gym, type),
            { scheduleIds: await listedIds(), updateFrom: addDays(today, k), set: { minutes: 30 + k } },
            owner.cookies,
          ),
        );
      }
      expect(answers.map((a) => a.statusCode)).toEqual([200, 200, 409]);
      const refusal = JSON.parse(answers[2]?.body ?? "{}") as { error: string; message: string };
      expect(refusal.error).toBe("too_many_listed");
      // The real numbers, and the advice that works (re-check, H-1): a later
      // date splits every time slot again. 21 are listed, and each with a class
      // still to start before the date would split: counted from the calendar,
      // since it depends on the hour the test runs.
      const [splitting] = await sql<{ n: number }[]>`
        SELECT count(DISTINCT schedule_id)::int AS n FROM gym_class_sessions
        WHERE class_type_id = ${type} AND local_date < ${addDays(today, 5)}::date
          AND starts_at > now()`;
      const would = 21 + (splitting?.n ?? 0);
      expect(would).toBeGreaterThan(24);
      expect(refusal.message).toBe(
        `This class can list 24 time slots, counting ones changed from a date that has not come yet, and this change would make ${String(would)}. Pick the earliest Update from date, or wait until those dates have passed.`,
      );
      expect(await slotRows(type)).toHaveLength(21);
      // A later date is refused the same way; the earliest date goes through
      // and lists no more.
      const later = await post(
        bulkUrl(gym, type),
        { scheduleIds: await listedIds(), updateFrom: addDays(today, 8), set: { minutes: 30 } },
        owner.cookies,
      );
      expect(later.statusCode).toBe(409);
      const earliest = await post(
        bulkUrl(gym, type),
        { scheduleIds: await listedIds(), updateFrom: today, set: { minutes: 30 } },
        owner.cookies,
      );
      expect(earliest.statusCode, earliest.body).toBe(200);
      expect(await slotRows(type)).toHaveLength(21);

      // Three more make 24 listed with only 10 running at once; one more is
      // refused by the listed limit, in words for adding one.
      for (const minute of [at(6), at(7), at(8)]) {
        await addSlot(gym, owner.cookies, type, { weekdays: [1], startMinute: minute, startsOn: today });
      }
      const added = await post(
        `${classesUrl(gym)}/${type}/repeats`,
        { ...RUN, weekdays: [2], startMinute: at(9), startsOn: today },
        owner.cookies,
      );
      expect(added.statusCode).toBe(409);
      expect(JSON.parse(added.body)).toEqual(
        expect.objectContaining({
          error: "too_many_listed",
          message:
            "This class can list 24 time slots, counting ones changed from a date that has not come yet, and already has 24. Add this one once those dates have passed.",
        }),
      );

      // The Calendar's "This and future classes" has no Update from box, so its
      // refusal names what it does have (second re-check, L-4). The last class
      // of a Monday time slot: one of its classes before it is still to come.
      const [monday] = await sql<{ id: string }[]>`
        SELECT s.id FROM gym_class_sessions s
        JOIN gym_class_schedules c ON c.id = s.schedule_id
        WHERE s.class_type_id = ${type} AND c.local_start_minute = ${at(6)}
        ORDER BY s.local_date DESC LIMIT 1`;
      if (monday === undefined) throw new Error("no Monday class");
      const future = await put(
        dayUrl(gym, monday.id),
        { scope: "future", ...RUN, startMinute: at(6), minutes: 50 },
        owner.cookies,
      );
      expect(future.statusCode).toBe(409);
      expect(JSON.parse(future.body)).toEqual(
        expect.objectContaining({
          error: "too_many_listed",
          message:
            "This class can list 24 time slots, counting ones changed from a date that has not come yet, and this change would make 25. Pick an earlier class, or wait until those dates have passed.",
        }),
      );
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // THE LIMITS
  // =========================================================================

  it(
    "a class that runs every day, bulk edited, can still take an eighth time slot; twelve bulk edited list twenty-four, and no more",
    async () => {
      const owner = await makeUser("cap-owner");
      const org = await makeOrg(owner.cookies, "Cap Bulk Gym");
      const gym = org.org.id;
      const today = await gymToday(gym, owner.cookies);
      const from = addDays(today, 7);

      // Seven time slots, one a weekday.
      const daily = await makeClass(gym, owner.cookies, "Daily");
      const seven: string[] = [];
      for (const day of EVERY_DAY) {
        seven.push(await addSlot(gym, owner.cookies, daily, { weekdays: [day], startMinute: at(18), startsOn: today }));
      }
      const edited = await post(
        bulkUrl(gym, daily),
        { scheduleIds: seven, updateFrom: from, set: { minutes: 45 } },
        owner.cookies,
      );
      expect(edited.statusCode, edited.body).toBe(200);
      expect(timetableOf(edited).entries.find((e) => e.type.id === daily)?.schedules).toHaveLength(14);
      // Fourteen listed, seven running at once: an eighth, from today.
      await addSlot(gym, owner.cookies, daily, { weekdays: [1], startMinute: at(7), startsOn: today });

      // Twelve, each bulk edited: twenty-four listed, all of them on the screen.
      const full = await makeClass(gym, owner.cookies, "Full");
      const twelve: string[] = [];
      for (let n = 0; n < 12; n += 1) {
        twelve.push(await addSlot(gym, owner.cookies, full, { weekdays: [1], startMinute: at(6 + n), startsOn: today }));
      }
      const thirteenth = await post(
        `${classesUrl(gym)}/${full}/repeats`,
        { ...RUN, weekdays: [2], startMinute: at(6), startsOn: today },
        owner.cookies,
      );
      expect(thirteenth.statusCode).toBe(409);
      expect(JSON.parse(thirteenth.body)).toMatchObject({
        error: "too_many_classes",
        message: "This class is at its limit of 12 time slots. Cancel one you no longer run first.",
      });

      const all = await post(
        bulkUrl(gym, full),
        { scheduleIds: twelve, updateFrom: from, set: { places: 15 } },
        owner.cookies,
      );
      expect(all.statusCode, all.body).toBe(200);
      const listed = timetableOf(all).entries.find((e) => e.type.id === full)?.schedules ?? [];
      expect(listed).toHaveLength(24);

      // The new twelve, bulk edited again from a later date, would list
      // thirty-six: refused, and nothing written.
      const fresh = (await slotRows(full)).filter((s) => s.starts_on === from).map((s) => s.id);
      expect(fresh).toHaveLength(12);
      const rows = await classRows(full);
      const slots = await slotRows(full);
      const again = await post(
        bulkUrl(gym, full),
        { scheduleIds: fresh, updateFrom: addDays(from, 7), set: { places: 10 } },
        owner.cookies,
      );
      expect(again.statusCode).toBe(409);
      expect(JSON.parse(again.body)).toMatchObject({ error: "too_many_listed" });
      expect(await classRows(full)).toEqual(rows);
      expect(await slotRows(full)).toEqual(slots);
    },
    TEST_TIMEOUT_MS,
  );
});
