// CHANGING A TIME SLOT FROM A DATE — routes against real Postgres (R9.2,
// DATABASE_URL-gated). ROADMAP Stage 2 item 17b-ii-b-ii; Part 3 §13.3.
//
// The first test is the job's worst thing: a time slot moved "from a date" that
// also moves the classes BEFORE that date, so people turn up at the old time to
// an empty room — or another gym moving it with an id it came by. Every refusal
// is checked by reading the rows, never only the reply, and every refused URL
// has a positive control. The time-of-day cases run the repo on a fixed clock.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { fillClassSessions } from "../src/modules/orgs/classes/fill.js";
import {
  changeSlotFrom,
  createSchedule,
  readTimetable,
} from "../src/modules/orgs/classes/repo.js";
import type { GymClassWeekResponse, GymClassesResponse } from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "class-slots-secret-0123456789abcdef", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;

const TEST_TIMEOUT_MS = 90_000;
const HOOK_TIMEOUT_MS = 90_000;
const LIVE_PLAN = "zz_class_slots_routes";

interface CreatedOrg {
  org: { id: string; slug: string; name: string };
  joinCode: { code: string; label: string };
}

let ipCounter = 0;
const nextIp = () =>
  `10.63.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

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

d("changing a time slot from a date (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'clsslot-t-%@example.com')`;
    await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_schedules WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'clsslot-t-%@example.com'`;
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
    const email = `clsslot-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", {
      email,
      password: PASSWORD,
      displayName: `Slot ${local}`,
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
  const weekUrl = (gymId: string, week?: string) =>
    `/v1/orgs/${gymId}/class-sessions${week === undefined ? "" : `?week=${week}`}`;
  const dayUrl = (gymId: string, id: string) => `/v1/orgs/${gymId}/class-sessions/${id}`;
  const cancelUrl = (gymId: string, id: string) => `${dayUrl(gymId, id)}/cancel`;
  const repeatUrl = (gymId: string, id: string) => `/v1/orgs/${gymId}/class-repeats/${id}`;

  const weekOf = (res: { body: string }) => JSON.parse(res.body) as GymClassWeekResponse;
  const timetableOf = (res: { body: string }) => JSON.parse(res.body) as GymClassesResponse;

  const gymToday = async (gymId: string, cookies: Record<string, string>) =>
    weekOf(await get(weekUrl(gymId), cookies)).today;

  /** A class running every day at `minute`, from two days ago. */
  const dailyClass = async (
    gymId: string,
    cookies: Record<string, string>,
    name: string,
    minute = at(18),
  ) => {
    const made = await post(classesUrl(gymId), { name, minutes: 60, places: 20, colour: "teal" }, cookies);
    expect(made.statusCode).toBe(201);
    const type = timetableOf(made).entries.find((e) => e.type.name === name)?.type;
    if (type === undefined) throw new Error("create answered no class");
    const repeated = await post(
      `${classesUrl(gymId)}/${type.id}/repeats`,
      {
        ...RUN,
        weekdays: EVERY_DAY,
        startMinute: minute,
        startsOn: new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10),
      },
      cookies,
    );
    expect(repeated.statusCode).toBe(201);
    const repeat = timetableOf(repeated)
      .entries.find((e) => e.type.id === type.id)
      ?.schedules.find((s) => s.startMinute === minute);
    if (repeat === undefined) throw new Error("repeat answered nothing");
    return { typeId: type.id, repeatId: repeat.id };
  };

  /** Every class of a class type, in date and time order. */
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
      ORDER BY starts_on, id`;

  const onDate = async (typeId: string, day: string, minute = at(18)) => {
    const row = (await classRows(typeId)).find(
      (r) => r.local_date === day && r.local_start_minute === minute,
    );
    if (row === undefined) throw new Error(`no class on ${day} at ${String(minute)}`);
    return row;
  };

  /** Staff change one class on its own: another time and size. */
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

  const hhmm = (minute: number) =>
    `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

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
    "a time slot moved from a date leaves every class before that date exactly as it was — and nobody outside the gym can move it",
    async () => {
      const owner = await makeUser("worst-owner");
      const stranger = await makeUser("worst-stranger");
      const member = await makeUser("worst-member");
      const trainer = await makeUser("worst-trainer");
      const rival = await makeUser("worst-rival");
      const org = await makeOrg(owner.cookies, "Worst Slots Gym");
      const rivalOrg = await makeOrg(rival.cookies, "Worst Slots Rival");
      await joinAsStaff(member, org, owner.cookies, null);
      await joinAsStaff(trainer, org, owner.cookies, "trainer");
      const gym = org.org.id;
      const { typeId, repeatId } = await dailyClass(gym, owner.cookies, "Spin");
      const today = await gymToday(gym, owner.cookies);
      const from = addDays(today, 10);

      // Before the date, one class cancelled and one changed on its own: the
      // two kinds of class a careless move would sweep up.
      const cancelled = await onDate(typeId, addDays(from, -3));
      expect((await post(cancelUrl(gym, cancelled.id), {}, owner.cookies)).statusCode).toBe(200);
      const alone = await onDate(typeId, addDays(from, -2));
      await changeAlone(gym, owner.cookies, alone.id, at(19));

      const all = await classRows(typeId);
      const before = all.filter((r) => r.local_date < from);
      const fromOn = all.filter((r) => r.local_date >= from);
      // Today and the nine days after it (the calendar writes no history).
      expect(before.length).toBe(10);
      expect(fromOn.length).toBeGreaterThan(40);
      const slotsBefore = await slotRows(typeId);
      const move = { updateFrom: from, weekdays: EVERY_DAY, startMinute: at(18, 30), ...RUN };
      const opened = fromOn[0];
      if (opened === undefined) throw new Error("no class on the date");
      const moveThisOn = { scope: "future", ...RUN, startMinute: at(18, 30) };

      // Everybody outside the gym's ticked staff, through both doors.
      const outsiders: { who: string; cookies: Record<string, string>; status: number }[] = [
        { who: "a stranger", cookies: stranger.cookies, status: 404 },
        { who: "a rival gym's owner", cookies: rival.cookies, status: 404 },
        { who: "this gym's own member", cookies: member.cookies, status: 404 },
        { who: "this gym's own trainer", cookies: trainer.cookies, status: 403 },
        { who: "nobody at all", cookies: {}, status: 401 },
      ];
      for (const outsider of outsiders) {
        for (const res of [
          await put(repeatUrl(gym, repeatId), move, outsider.cookies),
          await put(dayUrl(gym, opened.id), moveThisOn, outsider.cookies),
        ]) {
          expect(res.statusCode, `${outsider.who} reached ${String(res.raw.req.url)}`).toBe(
            outsider.status,
          );
        }
      }
      // Another gym's owner with our ids under THEIR gym.
      expect((await put(repeatUrl(rivalOrg.org.id, repeatId), move, rival.cookies)).statusCode).toBe(404);
      expect((await put(dayUrl(rivalOrg.org.id, opened.id), moveThisOn, rival.cookies)).statusCode).toBe(404);
      expect(await classRows(typeId)).toEqual(all);
      expect(await slotRows(typeId)).toEqual(slotsBefore);

      // THE POSITIVE CONTROL: the owner moves it, through the same URL.
      const moved = await put(repeatUrl(gym, repeatId), move, owner.cookies);
      expect(moved.statusCode).toBe(200);

      const after = await classRows(typeId);
      // Every class before the date: the same rows, every column, the cancelled
      // one still cancelled and the one changed on its own still at 19:00.
      expect(after.filter((r) => r.local_date < from)).toEqual(before);
      // From the date on: every class at 18:30, none left at 18:00, on the new
      // time slot.
      const later = after.filter((r) => r.local_date >= from);
      expect(later.length).toBe(fromOn.length);
      expect(new Set(later.map((r) => r.local_start_minute))).toEqual(new Set([at(18, 30)]));
      const slots = await slotRows(typeId);
      expect(slots).toHaveLength(2);
      const [old, next] = slots;
      expect(old).toMatchObject({ id: repeatId, ends_on: addDays(from, -1), ended_at: null });
      expect(next).toMatchObject({
        starts_on: from,
        ends_on: null,
        local_start_minute: at(18, 30),
        weekdays: EVERY_DAY,
      });
      expect(new Set(later.map((r) => r.schedule_id))).toEqual(new Set([next?.id]));

      // The screen says the same: the old time until the day before, the new
      // one from the date.
      const listed = timetableOf(moved).entries[0]?.schedules ?? [];
      expect(listed.map((s) => [s.startMinute, s.startsOn, s.endsOn])).toEqual(
        expect.arrayContaining([
          [at(18), slots[0]?.starts_on, addDays(from, -1)],
          [at(18, 30), from, null],
        ]),
      );

      // The audit names ids and times, never a person's name.
      const [audit] = await sql<{ meta: Record<string, string> }[]>`
        SELECT meta FROM audit_log
        WHERE gym_id = ${gym} AND action = 'org.class_schedule_moved' AND target_id = ${repeatId}`;
      expect(audit?.meta).toMatchObject({
        from,
        startMinute: `${String(at(18))} -> ${String(at(18, 30))}`,
        newSchedule: next?.id,
        changedAloneReplaced: "0",
      });
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // A NEW LENGTH, SIZE OR COACH FROM A DATE
  // =========================================================================

  it(
    "a new coach, size and length from a date: the classes before keep theirs, the ones from it take them — except one changed on its own; a cancelled one stays cancelled",
    async () => {
      const owner = await makeUser("fields-owner");
      const coach = await makeUser("fields-coach");
      const org = await makeOrg(owner.cookies, "Fields Slots Gym");
      await joinAsStaff(coach, org, owner.cookies, "trainer");
      const gym = org.org.id;
      const { typeId, repeatId } = await dailyClass(gym, owner.cookies, "Pilates");
      const today = await gymToday(gym, owner.cookies);
      const from = addDays(today, 10);

      const cancelled = await onDate(typeId, addDays(from, 1));
      expect((await post(cancelUrl(gym, cancelled.id), {}, owner.cookies)).statusCode).toBe(200);
      const alone = await onDate(typeId, addDays(from, 2));
      await changeAlone(gym, owner.cookies, alone.id, at(19));

      const all = await classRows(typeId);
      const before = all.filter((r) => r.local_date < from);
      const laterIds = all.filter((r) => r.local_date >= from).map((r) => r.id);

      const changed = await put(
        repeatUrl(gym, repeatId),
        {
          updateFrom: from,
          weekdays: EVERY_DAY,
          startMinute: at(18),
          minutes: 45,
          places: 12,
          coachUserId: coach.userId,
        },
        owner.cookies,
      );
      expect(changed.statusCode).toBe(200);

      const after = await classRows(typeId);
      expect(after.filter((r) => r.local_date < from)).toEqual(before);
      const later = after.filter((r) => r.local_date >= from);
      // The same classes, not new ones: their ids, cancellations and own
      // changes go with them to the new time slot.
      expect(later.map((r) => r.id).sort()).toEqual([...laterIds].sort());
      const slots = await slotRows(typeId);
      expect(slots).toHaveLength(2);
      const [old, next] = slots;
      expect(old).toMatchObject({ id: repeatId, ends_on: addDays(from, -1), minutes: 60, places: 20 });
      expect(next).toMatchObject({
        starts_on: from,
        local_start_minute: at(18),
        minutes: 45,
        places: 12,
        coach_user_id: coach.userId,
      });
      expect(new Set(later.map((r) => r.schedule_id))).toEqual(new Set([next?.id]));

      for (const row of later) {
        if (row.id === alone.id) {
          expect(row).toMatchObject({ local_start_minute: at(19), places: 5, changed_alone: true });
        } else if (row.id === cancelled.id) {
          expect(row).toMatchObject({
            status: "cancelled",
            minutes: 45,
            places: 12,
            coach_user_id: coach.userId,
          });
        } else {
          expect(row, row.local_date).toMatchObject({
            status: "scheduled",
            local_start_minute: at(18),
            minutes: 45,
            places: 12,
            coach_user_id: coach.userId,
            changed_alone: false,
          });
        }
      }

      // The nightly job writes nothing more over either half.
      expect((await fillClassSessions(sql, { gymIds: [gym] })).sessions).toBe(0);
      expect(await classRows(typeId)).toEqual(after);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "from today it is changed where it stands: one time slot, and every class that has not started takes the change",
    async () => {
      const owner = await makeUser("today-owner");
      const org = await makeOrg(owner.cookies, "Today Slots Gym");
      const gym = org.org.id;
      const { typeId, repeatId } = await dailyClass(gym, owner.cookies, "Yoga");
      const today = await gymToday(gym, owner.cookies);
      const res = await put(
        repeatUrl(gym, repeatId),
        { updateFrom: today, weekdays: EVERY_DAY, startMinute: at(18), minutes: 30, places: 40, coachUserId: null },
        owner.cookies,
      );
      expect(res.statusCode).toBe(200);
      expect(await slotRows(typeId)).toEqual([
        expect.objectContaining({ id: repeatId, ends_on: null, ended_at: null, minutes: 30, places: 40 }),
      ]);
      const [counts] = await sql<{ fresh: number; stale: number }[]>`
        SELECT count(*) FILTER (WHERE minutes = 30 AND places = 40)::int AS fresh,
               count(*) FILTER (WHERE minutes <> 30 OR places <> 40)::int AS stale
        FROM gym_class_sessions WHERE class_type_id = ${typeId} AND starts_at > now()`;
      expect(counts?.stale).toBe(0);
      expect(counts?.fresh).toBeGreaterThan(50);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // A MOVE ASKS FIRST
  // =========================================================================

  it(
    "a move that would replace classes changed or cancelled on their own asks first with the count, writes nothing until the same count comes back, then replaces them",
    async () => {
      const owner = await makeUser("ask-owner");
      const org = await makeOrg(owner.cookies, "Ask Slots Gym");
      const gym = org.org.id;
      const { typeId, repeatId } = await dailyClass(gym, owner.cookies, "Box");
      const from = addDays(await gymToday(gym, owner.cookies), 7);
      const cancelled = await onDate(typeId, addDays(from, 1));
      expect((await post(cancelUrl(gym, cancelled.id), {}, owner.cookies)).statusCode).toBe(200);
      const alone = await onDate(typeId, addDays(from, 3));
      await changeAlone(gym, owner.cookies, alone.id, at(20));

      const rows = await classRows(typeId);
      const slots = await slotRows(typeId);
      const move = { updateFrom: from, weekdays: EVERY_DAY, startMinute: at(7), ...RUN };

      const asked = await put(repeatUrl(gym, repeatId), move, owner.cookies);
      expect(asked.statusCode).toBe(409);
      expect(JSON.parse(asked.body)).toMatchObject({ error: "class_slot_replaces", replaces: 2 });
      expect(await classRows(typeId)).toEqual(rows);
      expect(await slotRows(typeId)).toEqual(slots);

      // A count that is not the one the server holds is asked again.
      const wrong = await put(repeatUrl(gym, repeatId), { ...move, confirmReplace: 1 }, owner.cookies);
      expect(wrong.statusCode).toBe(409);
      expect(JSON.parse(wrong.body)).toMatchObject({ replaces: 2 });
      expect(await classRows(typeId)).toEqual(rows);

      const confirmed = await put(repeatUrl(gym, repeatId), { ...move, confirmReplace: 2 }, owner.cookies);
      expect(confirmed.statusCode).toBe(200);
      const later = (await classRows(typeId)).filter((r) => r.local_date >= from);
      expect(later.every((r) => r.local_start_minute === at(7) && r.status === "scheduled")).toBe(true);
      expect(later.some((r) => r.changed_alone)).toBe(false);
      // Before the date nothing moved.
      expect((await classRows(typeId)).filter((r) => r.local_date < from)).toEqual(
        rows.filter((r) => r.local_date < from),
      );
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // "THIS AND FUTURE CLASSES" ON THE CALENDAR
  // =========================================================================

  it(
    "This and future classes: a new coach from the opened class on, a new time moves the time slot from its date, and the opened class is never counted in the question",
    async () => {
      const owner = await makeUser("future-owner");
      const coach = await makeUser("future-coach");
      const org = await makeOrg(owner.cookies, "Future Slots Gym");
      await joinAsStaff(coach, org, owner.cookies, "trainer");
      const gym = org.org.id;
      const { typeId } = await dailyClass(gym, owner.cookies, "Row");
      const today = await gymToday(gym, owner.cookies);

      // A new coach from the class on day +5: the opened one and every one after
      // it takes the coach; the one changed on its own on day +7 keeps its own.
      const opened = await onDate(typeId, addDays(today, 5));
      const alone = await onDate(typeId, addDays(today, 7));
      await changeAlone(gym, owner.cookies, alone.id, at(19));
      const beforeRows = (await classRows(typeId)).filter((r) => r.local_date < opened.local_date);
      const coached = await put(
        dayUrl(gym, opened.id),
        { scope: "future", ...RUN, startMinute: at(18), coachUserId: coach.userId },
        owner.cookies,
      );
      expect(coached.statusCode).toBe(200);
      // The answer is the week of the opened class, showing it.
      const week = weekOf(coached);
      expect(week.sessions.find((s) => s.id === opened.id)?.coachUserId).toBe(coach.userId);
      const rows = await classRows(typeId);
      expect(rows.filter((r) => r.local_date < opened.local_date)).toEqual(beforeRows);
      for (const r of rows.filter((x) => x.local_date >= opened.local_date)) {
        if (r.id === alone.id) expect(r.coach_user_id).toBeNull();
        else expect(r.coach_user_id, r.local_date).toBe(coach.userId);
      }

      // A new time from day +10, where the opened class was itself changed on
      // its own: it moves with the time slot and is not counted — the one
      // changed on day +12 is.
      const second = await onDate(typeId, addDays(today, 10));
      await changeAlone(gym, owner.cookies, second.id, at(19, 30));
      const other = await onDate(typeId, addDays(today, 12));
      await changeAlone(gym, owner.cookies, other.id, at(20));
      const moveBody = { scope: "future", ...RUN, startMinute: at(19, 30), coachUserId: coach.userId };
      const asked = await put(dayUrl(gym, second.id), moveBody, owner.cookies);
      expect(asked.statusCode).toBe(409);
      expect(JSON.parse(asked.body)).toMatchObject({ error: "class_slot_replaces", replaces: 1 });
      const moved = await put(dayUrl(gym, second.id), { ...moveBody, confirmReplace: 1 }, owner.cookies);
      expect(moved.statusCode).toBe(200);
      const after = await classRows(typeId);
      const fromOn = after.filter((r) => r.local_date >= second.local_date);
      expect(fromOn.every((r) => r.local_start_minute === at(19, 30))).toBe(true);
      expect(fromOn.every((r) => r.coach_user_id === coach.userId && !r.changed_alone)).toBe(true);
      // The day before it still runs at 18:00 with its own coach.
      expect((await onDate(typeId, addDays(today, 9))).coach_user_id).toBe(coach.userId);
      const movedWeek = weekOf(moved);
      expect(
        movedWeek.sessions.find((s) => s.localDate === second.local_date && s.classTypeId === typeId)
          ?.startMinute,
      ).toBe(at(19, 30));

      // A cancelled class is un-cancelled before it is edited, either way.
      const off = await onDate(typeId, addDays(today, 20), at(19, 30));
      expect((await post(cancelUrl(gym, off.id), {}, owner.cookies)).statusCode).toBe(200);
      const onCancelled = await put(
        dayUrl(gym, off.id),
        { scope: "future", ...RUN, startMinute: at(19, 30) },
        owner.cookies,
      );
      expect(onCancelled.statusCode).toBe(409);
      expect(JSON.parse(onCancelled.body)).toMatchObject({ error: "class_day_cancelled" });
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // WHICH DATES, AND WHICH TIMES
  // =========================================================================

  it(
    "a date in the past, past the calendar or outside the time slot is refused, a clash with another time slot is refused, and a refusal writes nothing",
    async () => {
      const owner = await makeUser("range-owner");
      const org = await makeOrg(owner.cookies, "Range Slots Gym");
      const gym = org.org.id;
      const { typeId, repeatId } = await dailyClass(gym, owner.cookies, "Core");
      const today = await gymToday(gym, owner.cookies);
      // A second time slot of the same class, Mondays at 07:00.
      expect(
        (
          await post(
            `${classesUrl(gym)}/${typeId}/repeats`,
            { ...RUN, weekdays: [1], startMinute: at(7), startsOn: today },
            owner.cookies,
          )
        ).statusCode,
      ).toBe(201);
      // And a short course, for the ends of a time slot.
      const course = await post(
        `${classesUrl(gym)}/${typeId}/repeats`,
        { ...RUN, weekdays: [3], startMinute: at(12), startsOn: addDays(today, 7), endsOn: addDays(today, 21) },
        owner.cookies,
      );
      expect(course.statusCode).toBe(201);
      const courseId = timetableOf(course).entries[0]?.schedules.find((s) => s.startMinute === at(12))?.id;
      if (courseId === undefined) throw new Error("course answered nothing");

      const rows = await classRows(typeId);
      const slots = await slotRows(typeId);
      const body = (updateFrom: string, weekdays = EVERY_DAY, startMinute = at(18, 30)) => ({
        updateFrom,
        weekdays,
        startMinute,
        ...RUN,
      });
      const refusals: [string, string, unknown, string][] = [
        ["yesterday", repeatId, body(addDays(today, -1)), "class_update_from"],
        ["past the calendar", repeatId, body(addDays(today, 57)), "class_update_from"],
        ["before the course starts", courseId, body(addDays(today, 6), [3], at(13)), "class_update_from"],
        ["after the course ends", courseId, body(addDays(today, 22), [3], at(13)), "class_update_from"],
        ["onto Monday 07:00, where the class already has a time slot", repeatId, body(addDays(today, 3), [1, 2], at(7)), "repeat_clashes"],
      ];
      for (const [what, id, payload, error] of refusals) {
        const res = await put(repeatUrl(gym, id), payload, owner.cookies);
        expect(res.statusCode, what).toBe(409);
        expect(JSON.parse(res.body), what).toMatchObject({ error });
      }
      expect((await put(repeatUrl(gym, repeatId), body("2026-02-31"), owner.cookies)).statusCode).toBe(400);
      expect(await classRows(typeId)).toEqual(rows);
      expect(await slotRows(typeId)).toEqual(slots);

      // The positive controls, on the same two time slots: the last day on the
      // calendar, and the course's own first and last days.
      expect((await put(repeatUrl(gym, repeatId), body(addDays(today, 56)), owner.cookies)).statusCode).toBe(200);
      expect(
        (await put(repeatUrl(gym, courseId), body(addDays(today, 7), [3], at(13)), owner.cookies)).statusCode,
      ).toBe(200);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "on a fixed clock: the next dates start at now, a move from today keeps the class that already ran and replaces the old time slot, and a time already gone today is refused",
    async () => {
      const owner = await makeUser("clock-owner");
      const org = await makeOrg(owner.cookies, "Clock Slots Gym");
      const gym = org.org.id;
      // Monday 5 October 2026, 13:00 in London.
      const now = new Date("2026-10-05T12:00:00Z");
      const makeType = async (name: string) => {
        const made = await post(classesUrl(gym), { name, minutes: 60, places: 20, colour: "blue" }, owner.cookies);
        const id = timetableOf(made).entries.find((e) => e.type.name === name)?.type.id;
        if (id === undefined) throw new Error("create answered no class");
        const slot = await createSchedule(sql, {
          gymId: gym,
          classTypeId: id,
          weekdays: EVERY_DAY,
          startMinute: at(7),
          startsOn: "2026-10-01",
          endsOn: null,
          ...RUN,
          actorUserId: owner.userId,
          now,
        });
        expect(slot.kind).toBe("ok");
        const [row] = await slotRows(id);
        if (row === undefined) throw new Error("no time slot");
        return { typeId: id, slotId: row.id };
      };
      const change = (
        slotId: string,
        updateFrom: string,
        startMinute: number,
        over: Partial<typeof RUN> = {},
      ) =>
        changeSlotFrom(sql, {
          gymId: gym,
          target: { by: "slot", scheduleId: slotId, updateFrom, weekdays: EVERY_DAY },
          startMinute,
          ...RUN,
          ...over,
          confirmReplace: null,
          actorUserId: owner.userId,
          now,
        });

      // THE NEXT DATES START AT NOW: this morning's 07:00 has run.
      const a = await makeType("Early");
      expect((await classRows(a.typeId))[0]).toMatchObject({ local_date: "2026-10-05" });
      const read = await readTimetable(sql, gym, { now });
      expect(read?.schedules.find((s) => s.id === a.slotId)?.nextDates[0]).toBe("2026-10-06");
      // Round one, L-4: the screen is told today's class has run, so it offers
      // tomorrow as the first date a move can start from.
      expect(read?.schedules.find((s) => s.id === a.slotId)?.startedToday).toBe(true);

      // A MOVE FROM TODAY: the 07:00 that ran stays on the old time slot, the
      // old time slot leaves the list, and today's 18:00 is written.
      expect(await change(a.slotId, "2026-10-05", at(18))).toEqual({ kind: "ok", localDate: "2026-10-05" });
      const todays = (await classRows(a.typeId)).filter((r) => r.local_date === "2026-10-05");
      expect(todays.map((r) => [hhmm(r.local_start_minute), r.schedule_id === a.slotId])).toEqual([
        ["07:00", true],
        ["18:00", false],
      ]);
      const [oldSlot] = await slotRows(a.typeId);
      expect(oldSlot).toMatchObject({ id: a.slotId, ends_on: null });
      expect(oldSlot?.ended_at).not.toBeNull();
      const listed = (await readTimetable(sql, gym, { now }))?.schedules.filter(
        (s) => s.classTypeId === a.typeId,
      );
      expect(listed?.map((s) => [s.startMinute, s.startsOn, s.nextDates[0]])).toEqual([
        [at(18), "2026-10-05", "2026-10-05"],
      ]);
      // Today's 18:00 has not started yet.
      expect(listed?.[0]?.startedToday).toBe(false);

      // A TIME ALREADY GONE TODAY is refused and writes nothing; from tomorrow
      // it is fine.
      const b = await makeType("Late");
      const bRows = await classRows(b.typeId);
      expect(await change(b.slotId, "2026-10-05", at(9))).toEqual({ kind: "time_passed" });
      expect(await classRows(b.typeId)).toEqual(bRows);
      expect((await change(b.slotId, "2026-10-06", at(9))).kind).toBe("ok");
      // Round one, T-2: its only class before the date has run, so the old time
      // slot is stopped outright — never left with an end date and no next class.
      const bSlots = await slotRows(b.typeId);
      expect(bSlots).toHaveLength(2);
      expect(bSlots[0]).toMatchObject({ id: b.slotId, ends_on: null });
      expect(bSlots[0]?.ended_at).not.toBeNull();
      expect(
        (await readTimetable(sql, gym, { now }))?.schedules
          .filter((s) => s.classTypeId === b.typeId)
          .map((s) => [s.startMinute, s.startsOn]),
      ).toEqual([[at(9), "2026-10-06"]]);

      // A NEW LENGTH FROM TODAY: the class that ran keeps the length it ran at.
      const c = await makeType("Steady");
      expect((await change(c.slotId, "2026-10-05", at(7), { minutes: 45 })).kind).toBe("ok");
      const cRows = await classRows(c.typeId);
      expect(cRows.find((r) => r.local_date === "2026-10-05")?.minutes).toBe(60);
      expect(cRows.filter((r) => r.local_date > "2026-10-05").every((r) => r.minutes === 45)).toBe(true);
      expect(await slotRows(c.typeId)).toHaveLength(1);

      // THIS AND FUTURE on a class that has started is refused.
      const ran = cRows.find((r) => r.local_date === "2026-10-05");
      if (ran === undefined) throw new Error("no class today");
      expect(
        await changeSlotFrom(sql, {
          gymId: gym,
          target: { by: "session", sessionId: ran.id },
          startMinute: at(8),
          ...RUN,
          confirmReplace: null,
          actorUserId: owner.userId,
          now,
        }),
      ).toEqual({ kind: "started" });
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // TWO AT ONCE
  // =========================================================================

  it(
    "two staff at two app servers moving the same time slot at the same moment: one moves it, the other is refused, and every date holds one class",
    async () => {
      const owner = await makeUser("race-owner");
      const org = await makeOrg(owner.cookies, "Race Slots Gym");
      const gym = org.org.id;
      const { typeId, repeatId } = await dailyClass(gym, owner.cookies, "Race");
      const from = addDays(await gymToday(gym, owner.cookies), 5);
      const second = await buildApp(loadConfig(baseEnv), {
        emailSender: {
          sendVerificationEmail: () => Promise.resolve(),
          sendPasswordResetEmail: () => Promise.resolve(),
          sendSignInCodeEmail: () => Promise.resolve(),
        },
      });
      await second.ready();
      try {
        const desk = "10.63.250.1";
        const answers = await Promise.all([
          inject(
            "PUT",
            repeatUrl(gym, repeatId),
            owner.cookies,
            { updateFrom: from, weekdays: EVERY_DAY, startMinute: at(18, 30), ...RUN },
            api(),
            desk,
          ),
          inject(
            "PUT",
            repeatUrl(gym, repeatId),
            owner.cookies,
            { updateFrom: from, weekdays: EVERY_DAY, startMinute: at(19), ...RUN },
            second,
            desk,
          ),
        ]);
        expect(answers.map((a) => a.statusCode).sort()).toEqual([200, 409]);
        const slots = await slotRows(typeId);
        expect(slots).toHaveLength(2);
        const [dupes] = await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM (
            SELECT local_date FROM gym_class_sessions
            WHERE class_type_id = ${typeId} GROUP BY local_date HAVING count(*) > 1) x`;
        expect(dupes?.n).toBe(0);
      } finally {
        await second.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // THE CAP
  // =========================================================================

  it(
    "a time slot whose last day has passed no longer counts toward the class's limit of time slots",
    async () => {
      const owner = await makeUser("cap-owner");
      const org = await makeOrg(owner.cookies, "Cap Slots Gym");
      const gym = org.org.id;
      const made = await post(classesUrl(gym), { name: "Full", minutes: 30, places: 10, colour: "red" }, owner.cookies);
      const typeId = timetableOf(made).entries[0]?.type.id;
      if (typeId === undefined) throw new Error("create answered no class");
      const today = await gymToday(gym, owner.cookies);
      const add = (minute: number) =>
        post(
          `${classesUrl(gym)}/${typeId}/repeats`,
          { ...RUN, weekdays: [1], startMinute: minute, startsOn: today },
          owner.cookies,
        );
      for (let n = 0; n < 12; n += 1) expect((await add(at(6 + n))).statusCode).toBe(201);
      const full = await add(at(20));
      expect(full.statusCode).toBe(409);
      expect(JSON.parse(full.body)).toMatchObject({ error: "too_many_classes" });

      // One of them ran its course before today.
      await sql`
        UPDATE gym_class_schedules
        SET starts_on = ${addDays(today, -30)}::date, ends_on = ${addDays(today, -1)}::date
        WHERE class_type_id = ${typeId} AND local_start_minute = ${at(6)}`;
      expect((await add(at(20))).statusCode).toBe(201);
      expect((await add(at(21))).statusCode).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // ROUND ONE
  // =========================================================================

  // H-1: one class never runs twice at one time on one date, through "This and
  // future classes" as through "This class only".
  it(
    "This and future classes cannot put the opened class at a time the same class already runs that day",
    async () => {
      const owner = await makeUser("h1-owner");
      const org = await makeOrg(owner.cookies, "H1 Slots Gym");
      const gym = org.org.id;
      const { typeId } = await dailyClass(gym, owner.cookies, "Yoga", at(18));
      expect(
        (
          await post(
            `${classesUrl(gym)}/${typeId}/repeats`,
            { ...RUN, weekdays: EVERY_DAY, startMinute: at(7), startsOn: await gymToday(gym, owner.cookies) },
            owner.cookies,
          )
        ).statusCode,
      ).toBe(201);
      const day = addDays(await gymToday(gym, owner.cookies), 5);
      const a = await onDate(typeId, day, at(18));
      const b = await onDate(typeId, day, at(7));
      await changeAlone(gym, owner.cookies, a.id, at(7, 30));
      await changeAlone(gym, owner.cookies, b.id, at(18));
      const rows = await classRows(typeId);
      const slots = await slotRows(typeId);

      // The control that already held: this class only.
      const only = await put(dayUrl(gym, a.id), { scope: "this", ...RUN, startMinute: at(18) }, owner.cookies);
      expect(only.statusCode).toBe(409);
      expect(JSON.parse(only.body)).toMatchObject({ error: "class_day_clashes" });
      // This and future classes, with nothing else changed, and with a new coach.
      for (const body of [
        { scope: "future", ...RUN, startMinute: at(18) },
        { scope: "future", ...RUN, startMinute: at(18), minutes: 45 },
      ]) {
        const res = await put(dayUrl(gym, a.id), body, owner.cookies);
        expect(res.statusCode, JSON.stringify(body)).toBe(409);
        expect(JSON.parse(res.body)).toMatchObject({ error: "class_day_clashes" });
      }
      expect(await classRows(typeId)).toEqual(rows);
      expect(await slotRows(typeId)).toEqual(slots);

      // The positive control: with 18:00 free again, the same request goes through.
      await changeAlone(gym, owner.cookies, b.id, at(7));
      const freed = await put(dayUrl(gym, a.id), { scope: "future", ...RUN, startMinute: at(18) }, owner.cookies);
      expect(freed.statusCode).toBe(200);
      expect((await onDate(typeId, day, at(18))).id).toBe(a.id);
    },
    TEST_TIMEOUT_MS,
  );

  // H-2: a time slot that starts past the calendar can be changed from its own
  // first day; no date past the calendar is otherwise taken.
  it(
    "a time slot starting past the calendar is changed from its own first day, and a later date past the calendar is still refused",
    async () => {
      const owner = await makeUser("h2-owner");
      const org = await makeOrg(owner.cookies, "H2 Slots Gym");
      const gym = org.org.id;
      const made = await post(classesUrl(gym), { name: "Term", minutes: 60, places: 20, colour: "green" }, owner.cookies);
      const typeId = timetableOf(made).entries[0]?.type.id;
      if (typeId === undefined) throw new Error("create answered no class");
      const today = await gymToday(gym, owner.cookies);
      const first = addDays(today, 90);
      const res = await post(
        `${classesUrl(gym)}/${typeId}/repeats`,
        { ...RUN, weekdays: [2], startMinute: at(18), startsOn: first },
        owner.cookies,
      );
      expect(res.statusCode).toBe(201);
      const slotId = timetableOf(res).entries[0]?.schedules[0]?.id;
      if (slotId === undefined) throw new Error("no time slot");
      const body = (updateFrom: string, over: Record<string, unknown> = {}) => ({
        updateFrom,
        weekdays: [2],
        startMinute: at(18),
        ...RUN,
        ...over,
      });

      const later = await put(repeatUrl(gym, slotId), body(addDays(first, 1), { minutes: 30 }), owner.cookies);
      expect(later.statusCode).toBe(409);
      expect(JSON.parse(later.body)).toMatchObject({ error: "class_update_from" });

      const coached = await put(repeatUrl(gym, slotId), body(first, { minutes: 30 }), owner.cookies);
      expect(coached.statusCode).toBe(200);
      expect(await slotRows(typeId)).toEqual([
        expect.objectContaining({ id: slotId, starts_on: first, minutes: 30, ended_at: null }),
      ]);
      const moved = await put(repeatUrl(gym, slotId), body(first, { weekdays: [4], minutes: 30 }), owner.cookies);
      expect(moved.statusCode).toBe(200);
      const live = (await slotRows(typeId)).filter((s) => s.ended_at === null);
      expect(live).toEqual([expect.objectContaining({ starts_on: first, weekdays: [4] })]);
    },
    TEST_TIMEOUT_MS,
  );

  // L-1: a move or a split asks the class's limits. Each move from a later date
  // leaves one more half listed until its date, and the listed limit (24) is
  // what stops a chain of them (17b-ii-b-ii-b: twelve RUNNING at once).
  it(
    "moves and splits count toward the limit of time slots listed and not yet finished",
    async () => {
      const owner = await makeUser("l1-owner");
      const org = await makeOrg(owner.cookies, "L1 Slots Gym");
      const gym = org.org.id;
      const { typeId, repeatId } = await dailyClass(gym, owner.cookies, "Often", at(6));
      const today = await gymToday(gym, owner.cookies);
      const answers: number[] = [];
      let current = repeatId;
      for (let k = 2; k <= 26; k += 1) {
        const res = await put(
          repeatUrl(gym, current),
          { updateFrom: addDays(today, k), weekdays: EVERY_DAY, startMinute: at(6, k), ...RUN },
          owner.cookies,
        );
        answers.push(res.statusCode);
        if (res.statusCode !== 200) {
          expect(JSON.parse(res.body)).toMatchObject({ error: "too_many_classes" });
          break;
        }
        const next = timetableOf(res).entries[0]?.schedules.find((s) => s.startMinute === at(6, k));
        if (next === undefined) throw new Error("no new time slot");
        current = next.id;
      }
      expect(answers).toEqual([...Array<number>(23).fill(200), 409]);
      const [open] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM gym_class_schedules
        WHERE class_type_id = ${typeId} AND ended_at IS NULL`;
      expect(open?.n).toBe(24);
      // Changed from its own first day, a time slot changes where it stands and
      // adds none, so the limit does not stop it.
      const inPlace = await put(
        repeatUrl(gym, current),
        { updateFrom: addDays(today, 24), weekdays: EVERY_DAY, startMinute: at(6, 24), ...RUN, minutes: 30 },
        owner.cookies,
      );
      expect(inPlace.statusCode).toBe(200);
      const [still] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM gym_class_schedules
        WHERE class_type_id = ${typeId} AND ended_at IS NULL`;
      expect(still?.n).toBe(24);
    },
    TEST_TIMEOUT_MS,
  );

  // L-2: the two halves of a split are listed in date order, every time.
  it(
    "the two halves of a split are listed with the earlier one first",
    async () => {
      const owner = await makeUser("l2-owner");
      const org = await makeOrg(owner.cookies, "L2 Slots Gym");
      const gym = org.org.id;
      const today = await gymToday(gym, owner.cookies);
      const ids: string[] = [];
      for (let n = 0; n < 6; n += 1) {
        const { typeId, repeatId } = await dailyClass(gym, owner.cookies, `Split ${String(n)}`, at(9, n));
        expect(
          (
            await put(
              repeatUrl(gym, repeatId),
              { updateFrom: addDays(today, 5), weekdays: EVERY_DAY, startMinute: at(9, n), ...RUN, minutes: 30 },
              owner.cookies,
            )
          ).statusCode,
        ).toBe(200);
        ids.push(typeId);
      }
      const listed = timetableOf(await get(classesUrl(gym), owner.cookies));
      for (const typeId of ids) {
        const halves = listed.entries.find((e) => e.type.id === typeId)?.schedules ?? [];
        expect(halves.map((s) => s.startsOn)).toEqual([halves[0]?.startsOn, addDays(today, 5)]);
        expect(halves[0]?.endsOn).toBe(addDays(today, 4));
      }
    },
    TEST_TIMEOUT_MS,
  );
});
