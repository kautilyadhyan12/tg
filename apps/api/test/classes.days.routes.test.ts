// THE WEEK VIEW AND "THIS DAY ONLY" — routes against real Postgres (R9.2,
// DATABASE_URL-gated). ROADMAP Stage 2 item 17b-ii-b-i; Part 3 §13.3.
//
// The first test is the job's worst thing: a class the gym cancelled coming back
// onto the calendar, or another gym cancelling it with an id it came by, so a
// member turns up to a locked room. Every refusal is checked by reading the row,
// never only the reply, and every refused URL has a positive control.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { fillClassSessions, fillClassSessionsJob } from "../src/modules/orgs/classes/fill.js";
import { readWeek } from "../src/modules/orgs/classes/repo.js";
import type { GymClassSession, GymClassWeekResponse, GymClassesResponse } from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "class-days-secret-0123456789abcdef", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;

const TEST_TIMEOUT_MS = 90_000;
const HOOK_TIMEOUT_MS = 90_000;
const LIVE_PLAN = "zz_class_days_routes";

interface CreatedOrg {
  org: { id: string; slug: string; name: string };
  joinCode: { code: string; label: string };
}

let ipCounter = 0;
const nextIp = () =>
  `10.62.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];
const at = (h: number, m = 0) => h * 60 + m;
const RUN = { minutes: 60, places: 20, coachUserId: null };

const silent = {
  info: () => {
    /* deliberately empty */
  },
};

/** `YYYY-MM-DD` plus whole days, in UTC so no zone enters the arithmetic. */
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** `Tuesday 29 September`, independent of the server's own formatting. */
const dayLabel = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August",
    "September", "October", "November", "December"];
  return `${days[d.getUTCDay()] ?? ""} ${String(d.getUTCDate())} ${months[d.getUTCMonth()] ?? ""}`;
};
const isoWeekday = (day: string) => {
  const js = new Date(`${day}T00:00:00Z`).getUTCDay();
  return js === 0 ? 7 : js;
};

d("the week view and this day only (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'clsday-t-%@example.com')`;
    await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_schedules WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'clsday-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (
    method: "GET" | "POST" | "PUT",
    path: string,
    cookies: Record<string, string>,
    payload?: unknown,
  ) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
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
    const email = `clsday-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", {
      email,
      password: PASSWORD,
      displayName: `Day ${local}`,
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

  const weekUrl = (gymId: string, week?: string) =>
    `/v1/orgs/${gymId}/class-sessions${week === undefined ? "" : `?week=${week}`}`;
  const dayUrl = (gymId: string, id: string) => `/v1/orgs/${gymId}/class-sessions/${id}`;
  const cancelUrl = (gymId: string, id: string) => `${dayUrl(gymId, id)}/cancel`;
  const restoreUrl = (gymId: string, id: string) => `${dayUrl(gymId, id)}/restore`;
  const repeatUrl = (gymId: string, id: string) => `/v1/orgs/${gymId}/class-repeats/${id}`;

  const weekOf = (res: { body: string }) => JSON.parse(res.body) as GymClassWeekResponse;

  /** A class running every day at `minute`, from today. */
  const dailyClass = async (
    gymId: string,
    cookies: Record<string, string>,
    name: string,
    minute = at(18),
  ) => {
    const made = await post(
      `/v1/orgs/${gymId}/classes`,
      { name, minutes: 60, places: 20, colour: "teal" },
      cookies,
    );
    expect(made.statusCode).toBe(201);
    const type = (JSON.parse(made.body) as GymClassesResponse).entries.find(
      (e) => e.type.name === name,
    )?.type;
    if (type === undefined) throw new Error("create answered no class");
    const repeated = await post(
      `/v1/orgs/${gymId}/classes/${type.id}/repeats`,
      {
        ...RUN,
        weekdays: EVERY_DAY,
        startMinute: minute,
        startsOn: new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10),
      },
      cookies,
    );
    expect(repeated.statusCode).toBe(201);
    const repeat = (JSON.parse(repeated.body) as GymClassesResponse).entries
      .find((e) => e.type.id === type.id)
      ?.schedules.find((s) => s.startMinute === minute);
    if (repeat === undefined) throw new Error("repeat answered nothing");
    return { typeId: type.id, repeatId: repeat.id };
  };

  /** Next week: every date in it is in the future whatever the hour. */
  const nextWeek = async (gymId: string, cookies: Record<string, string>) => {
    const now = weekOf(await get(weekUrl(gymId), cookies));
    const res = await get(weekUrl(gymId, addDays(now.weekStart, 7)), cookies);
    expect(res.statusCode).toBe(200);
    return weekOf(res);
  };

  const sessionIn = (week: GymClassWeekResponse, typeId: string, n = 0): GymClassSession => {
    const found = week.sessions.filter((s) => s.classTypeId === typeId)[n];
    if (found === undefined) throw new Error("no session of that class in the week");
    return found;
  };

  const rowOf = async (id: string) => {
    const [row] = await sql<
      {
        status: string;
        changed_alone: boolean;
        local_start_minute: number;
        starts_at: Date;
        minutes: number;
        places: number | null;
        coach_user_id: string | null;
      }[]
    >`
      SELECT status, changed_alone, local_start_minute, starts_at, minutes, places, coach_user_id
      FROM gym_class_sessions WHERE id = ${id}`;
    if (row === undefined) throw new Error(`session ${id} is gone`);
    return row;
  };

  const auditCount = async (gymId: string, action: string) => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gymId} AND action = ${action}`;
    return row?.n ?? -1;
  };

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
    "a cancelled day stays cancelled through the nightly fill and an edit of its repeat — and nobody outside the gym can cancel, change or read it",
    async () => {
      const owner = await makeUser("worst-owner");
      const stranger = await makeUser("worst-stranger");
      const member = await makeUser("worst-member");
      const trainer = await makeUser("worst-trainer");
      const rival = await makeUser("worst-rival");
      const org = await makeOrg(owner.cookies, "Worst Days Gym");
      const rivalOrg = await makeOrg(rival.cookies, "Worst Days Rival");
      await joinAsStaff(member, org, owner.cookies, null);
      await joinAsStaff(trainer, org, owner.cookies, "trainer");
      const { typeId, repeatId } = await dailyClass(org.org.id, owner.cookies, "Spin");

      const week = await nextWeek(org.org.id, owner.cookies);
      const tuesday = sessionIn(week, typeId, 1);
      const wednesday = sessionIn(week, typeId, 2);

      // The positive control: the owner cancels it, through the same URL the
      // outsiders are refused on below.
      const cancelled = await post(cancelUrl(org.org.id, tuesday.id), {}, owner.cookies);
      expect(cancelled.statusCode).toBe(200);
      const shown = weekOf(cancelled).sessions.find((s) => s.id === tuesday.id);
      expect(shown?.status).toBe("cancelled");
      expect((await rowOf(tuesday.id)).status).toBe("cancelled");

      // Everything that writes the calendar, run over it.
      await fillClassSessions(sql, { gymIds: [org.org.id] });
      await fillClassSessions(sql, { gymIds: [org.org.id] });
      await fillClassSessionsJob({ sql, log: silent }, { gymIds: [org.org.id] });
      expect(
        (
          await put(
            repeatUrl(org.org.id, repeatId),
            { ...RUN, minutes: 45, places: 12, coachUserId: trainer.userId },
            owner.cookies,
          )
        ).statusCode,
      ).toBe(200);

      const tuesdayRow = await rowOf(tuesday.id);
      expect(tuesdayRow.status).toBe("cancelled");
      // Still one row for that date, not a second one written beside it.
      const [onThatDate] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM gym_class_sessions
        WHERE class_type_id = ${typeId} AND local_date = ${tuesday.localDate}::date`;
      expect(onThatDate?.n).toBe(1);
      // The repeat's timetable leaves it out of the coming dates.
      const listed = JSON.parse(
        (await get(`/v1/orgs/${org.org.id}/classes`, owner.cookies)).body,
      ) as GymClassesResponse;
      const repeat = listed.entries[0]?.schedules[0];
      expect(repeat?.nextDates).not.toContain(tuesday.localDate);
      // And the week still says cancelled.
      const again = weekOf(await get(weekUrl(org.org.id, week.weekStart), owner.cookies));
      expect(again.sessions.find((s) => s.id === tuesday.id)?.status).toBe("cancelled");

      // Put back on, it runs as its repeat now runs.
      const restored = await post(restoreUrl(org.org.id, tuesday.id), {}, owner.cookies);
      expect(restored.statusCode).toBe(200);
      expect(await rowOf(tuesday.id)).toMatchObject({
        status: "scheduled",
        changed_alone: false,
        minutes: 45,
        places: 12,
        coach_user_id: trainer.userId,
      });
      expect(
        (await post(cancelUrl(org.org.id, tuesday.id), {}, owner.cookies)).statusCode,
      ).toBe(200);

      const before = { tue: await rowOf(tuesday.id), wed: await rowOf(wednesday.id) };
      const outsiders: { who: string; cookies: Record<string, string>; status: number }[] = [
        { who: "a stranger", cookies: stranger.cookies, status: 404 },
        { who: "a rival gym's owner", cookies: rival.cookies, status: 404 },
        { who: "this gym's own member", cookies: member.cookies, status: 404 },
        { who: "this gym's own trainer", cookies: trainer.cookies, status: 403 },
        { who: "nobody at all", cookies: {}, status: 401 },
      ];
      for (const outsider of outsiders) {
        const tried = [
          await get(weekUrl(org.org.id, week.weekStart), outsider.cookies),
          await post(restoreUrl(org.org.id, tuesday.id), {}, outsider.cookies),
          await post(cancelUrl(org.org.id, wednesday.id), {}, outsider.cookies),
          await put(
            dayUrl(org.org.id, wednesday.id),
            { ...RUN, startMinute: at(7) },
            outsider.cookies,
          ),
        ];
        for (const res of tried) {
          expect(
            res.statusCode,
            `${outsider.who} reached ${res.raw.req.method ?? "?"} ${String(res.raw.req.url)}`,
          ).toBe(outsider.status);
        }
        expect({ tue: await rowOf(tuesday.id), wed: await rowOf(wednesday.id) }).toEqual(before);
      }

      // The rival addresses this gym's dates through its OWN gym, where it does
      // hold schedule.manage: the pair in the WHERE is what refuses it.
      for (const res of [
        await post(restoreUrl(rivalOrg.org.id, tuesday.id), {}, rival.cookies),
        await post(cancelUrl(rivalOrg.org.id, wednesday.id), {}, rival.cookies),
        await put(dayUrl(rivalOrg.org.id, wednesday.id), { ...RUN, startMinute: at(7) }, rival.cookies),
      ]) {
        expect(res.statusCode).toBe(404);
      }
      expect({ tue: await rowOf(tuesday.id), wed: await rowOf(wednesday.id) }).toEqual(before);

      // And the rival's own week never shows this gym's classes.
      const rivalWeek = weekOf(await get(weekUrl(rivalOrg.org.id, week.weekStart), rival.cookies));
      expect(rivalWeek.sessions).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  /** Every Spin on `day`, as the calendar holds it: "HH:MM status". */
  const spinsOn = async (typeId: string, day: string) =>
    (
      await sql<{ m: number; status: string }[]>`
        SELECT local_start_minute AS m, status FROM gym_class_sessions
        WHERE class_type_id = ${typeId} AND local_date = ${day}::date
        ORDER BY local_start_minute, status`
    ).map((r) => `${String(Math.floor(r.m / 60)).padStart(2, "0")}:${String(r.m % 60).padStart(2, "0")} ${r.status}`);

  // Round one, H-1: another repeat's date filled in where the gym had cancelled.
  it(
    "a cancelled date that was moved onto another repeat's time is not filled in again by that repeat",
    async () => {
      const owner = await makeUser("h1-owner");
      const org = await makeOrg(owner.cookies, "H1 Days Gym");
      const { typeId } = await dailyClass(org.org.id, owner.cookies, "Spin", at(18));
      const wed = sessionIn(await nextWeek(org.org.id, owner.cookies), typeId, 2);

      expect(
        (await put(dayUrl(org.org.id, wed.id), { ...RUN, startMinute: at(19) }, owner.cookies)).statusCode,
      ).toBe(200);
      expect(
        (
          await post(
            `/v1/orgs/${org.org.id}/classes/${typeId}/repeats`,
            { ...RUN, weekdays: EVERY_DAY, startMinute: at(19), startsOn: new Date().toISOString().slice(0, 10) },
            owner.cookies,
          )
        ).statusCode,
      ).toBe(201);
      expect(await spinsOn(typeId, wed.localDate)).toEqual(["19:00 scheduled"]);

      expect((await post(cancelUrl(org.org.id, wed.id), {}, owner.cookies)).statusCode).toBe(200);
      await fillClassSessionsJob({ sql, log: silent }, { gymIds: [org.org.id] });
      await fillClassSessions(sql, { gymIds: [org.org.id] });

      expect(await spinsOn(typeId, wed.localDate)).toEqual(["19:00 cancelled"]);
    },
    TEST_TIMEOUT_MS,
  );

  // Round one, H-2: Stop and Remove took the gym's cancellations with them, and
  // a new repeat then wrote those dates fresh.
  it(
    "a cancelled date outlives its repeat being stopped or its class removed and keeps that class off the day, until the gym lets it run",
    async () => {
      const owner = await makeUser("h2-owner");
      const org = await makeOrg(owner.cookies, "H2 Days Gym");
      const { typeId, repeatId } = await dailyClass(org.org.id, owner.cookies, "Spin", at(18));
      const week = await nextWeek(org.org.id, owner.cookies);
      const tue = sessionIn(week, typeId, 1);
      const wed = sessionIn(week, typeId, 2);
      expect((await post(cancelUrl(org.org.id, tue.id), {}, owner.cookies)).statusCode).toBe(200);

      // Stop: the running dates go, the cancelled one stays, and says its repeat stopped.
      const stopped = await api().inject({
        method: "DELETE",
        url: repeatUrl(org.org.id, repeatId),
        remoteAddress: nextIp(),
        cookies: owner.cookies,
      });
      expect(stopped.statusCode).toBe(200);
      expect(await spinsOn(typeId, tue.localDate)).toEqual(["18:00 cancelled"]);
      expect(await spinsOn(typeId, wed.localDate)).toEqual([]);
      const shown = weekOf(await get(weekUrl(org.org.id, tue.localDate), owner.cookies)).sessions;
      expect(shown.find((s) => s.id === tue.id)).toMatchObject({ status: "cancelled", repeatStopped: true });

      // With no live repeat of Spin on Tuesdays, there is nothing to let run:
      // it says so and the day stays as it is (re-check, N-1).
      const back = await post(restoreUrl(org.org.id, tue.id), {}, owner.cookies);
      expect(back.statusCode).toBe(409);
      expect(JSON.parse(back.body)).toMatchObject({
        error: "class_no_repeat_that_day",
        message: `No Spin repeat would add a class on ${dayLabel(tue.localDate)}, so this day stays as it is.`,
      });
      expect((await rowOf(tue.id)).status).toBe("cancelled");

      // A new repeat at the same time, and one at a new time: neither runs that Tuesday.
      for (const minute of [at(18), at(18, 30)]) {
        expect(
          (
            await post(
              `/v1/orgs/${org.org.id}/classes/${typeId}/repeats`,
              { ...RUN, weekdays: EVERY_DAY, startMinute: minute, startsOn: new Date().toISOString().slice(0, 10) },
              owner.cookies,
            )
          ).statusCode,
        ).toBe(201);
      }
      await fillClassSessionsJob({ sql, log: silent }, { gymIds: [org.org.id] });
      expect(await spinsOn(typeId, tue.localDate)).toEqual(["18:00 cancelled"]);
      expect(await spinsOn(typeId, wed.localDate)).toEqual(["18:00 scheduled", "18:30 scheduled"]);

      // Remove the class and bring it back: the cancellation is still there, and
      // a repeat added afterwards still leaves that Tuesday off.
      expect(
        (
          await api().inject({
            method: "DELETE",
            url: `/v1/orgs/${org.org.id}/classes/${typeId}`,
            remoteAddress: nextIp(),
            cookies: owner.cookies,
          })
        ).statusCode,
      ).toBe(200);
      expect(await spinsOn(typeId, tue.localDate)).toEqual(["18:00 cancelled"]);
      expect(await spinsOn(typeId, wed.localDate)).toEqual([]);
      expect((await post(`/v1/orgs/${org.org.id}/classes/${typeId}/restore`, {}, owner.cookies)).statusCode).toBe(200);
      expect(
        (
          await post(
            `/v1/orgs/${org.org.id}/classes/${typeId}/repeats`,
            { ...RUN, weekdays: EVERY_DAY, startMinute: at(7), startsOn: new Date().toISOString().slice(0, 10) },
            owner.cookies,
          )
        ).statusCode,
      ).toBe(201);
      expect(await spinsOn(typeId, tue.localDate)).toEqual(["18:00 cancelled"]);
      expect(await spinsOn(typeId, wed.localDate)).toEqual(["07:00 scheduled"]);

      // THE HOLD LIFTS (re-check, N-1): putting the kept day back lets the class's
      // live repeats run that day — here the 07:00, an extra class rather than
      // the old one moved — and the cancelled row goes, with an audit row.
      const lifted = await post(restoreUrl(org.org.id, tue.id), {}, owner.cookies);
      expect(lifted.statusCode).toBe(200);
      expect(await spinsOn(typeId, tue.localDate)).toEqual(["07:00 scheduled"]);
      expect(weekOf(lifted).sessions.some((s) => s.localDate === tue.localDate && s.startMinute === at(7))).toBe(true);
      expect(await auditCount(org.org.id, "org.class_session_hold_lifted")).toBe(1);
      // And the nightly job does not bring the old 18:00 back.
      await fillClassSessionsJob({ sql, log: silent }, { gymIds: [org.org.id] });
      expect(await spinsOn(typeId, tue.localDate)).toEqual(["07:00 scheduled"]);
    },
    TEST_TIMEOUT_MS,
  );

  // Second re-check, N-2 and N-3: the lift clears every hold of the class on that
  // date, and when no repeat would add a class there it changes nothing and says
  // so in words that are true.
  it(
    "letting a class run on a held day clears every hold of it that day, and changes nothing when no repeat would add a class",
    async () => {
      const owner = await makeUser("n3-owner");
      const org = await makeOrg(owner.cookies, "N3 Days Gym");
      const stop = async (id: string) =>
        { expect(
          (
            await api().inject({
              method: "DELETE",
              url: repeatUrl(org.org.id, id),
              remoteAddress: nextIp(),
              cookies: owner.cookies,
            })
          ).statusCode,
        ).toBe(200); };
      const addRepeat = async (typeId: string, minute: number, startsOn: string) =>
        { expect(
          (
            await post(
              `/v1/orgs/${org.org.id}/classes/${typeId}/repeats`,
              { ...RUN, weekdays: EVERY_DAY, startMinute: minute, startsOn },
              owner.cookies,
            )
          ).statusCode,
        ).toBe(201); };
      const today = new Date().toISOString().slice(0, 10);

      // N-3: two repeats of Box, both cancelled on Tuesday, both stopped, and a new
      // 19:00. One press clears both holds and the 19:00 runs.
      const box = await dailyClass(org.org.id, owner.cookies, "Box", at(7));
      await addRepeat(box.typeId, at(18), today);
      const boxWeek = await nextWeek(org.org.id, owner.cookies);
      const boxTue = boxWeek.sessions.filter((s) => s.classTypeId === box.typeId && s.localDate === addDays(boxWeek.weekStart, 1));
      expect(boxTue).toHaveLength(2);
      for (const s of boxTue) expect((await post(cancelUrl(org.org.id, s.id), {}, owner.cookies)).statusCode).toBe(200);
      const boxRepeats = await sql<{ id: string }[]>`
        SELECT id FROM gym_class_schedules WHERE class_type_id = ${box.typeId} AND ended_at IS NULL`;
      for (const r of boxRepeats) await stop(r.id);
      await addRepeat(box.typeId, at(19), today);
      const day = boxTue[0]?.localDate ?? "";
      expect(await spinsOn(box.typeId, day)).toEqual(["07:00 cancelled", "18:00 cancelled"]);
      const first = boxTue[0];
      if (first === undefined) throw new Error("no Tuesday");
      expect((await post(restoreUrl(org.org.id, first.id), {}, owner.cookies)).statusCode).toBe(200);
      expect(await spinsOn(box.typeId, day)).toEqual(["19:00 scheduled"]);

      // N-2: a new repeat that starts after the held day is no repeat for that day.
      // Nothing is added, so nothing changes and the sentence says why.
      const row = await dailyClass(org.org.id, owner.cookies, "Row", at(18));
      const rowTue = sessionIn(await nextWeek(org.org.id, owner.cookies), row.typeId, 1);
      expect((await post(cancelUrl(org.org.id, rowTue.id), {}, owner.cookies)).statusCode).toBe(200);
      await stop(row.repeatId);
      await addRepeat(row.typeId, at(18, 30), addDays(rowTue.localDate, 14));
      const later = await post(restoreUrl(org.org.id, rowTue.id), {}, owner.cookies);
      expect(later.statusCode).toBe(409);
      expect(JSON.parse(later.body)).toMatchObject({
        error: "class_no_repeat_that_day",
        message: `No Row repeat would add a class on ${dayLabel(rowTue.localDate)}, so this day stays as it is.`,
      });
      expect(await spinsOn(row.typeId, rowTue.localDate)).toEqual(["18:00 cancelled"]);

      // A class already running that day, and no repeat to add one: the hold is
      // not lifted for nothing.
      const pil = await dailyClass(org.org.id, owner.cookies, "Pilates", at(7));
      await addRepeat(pil.typeId, at(18), today);
      const pilWeek = await nextWeek(org.org.id, owner.cookies);
      const pilEvening = pilWeek.sessions.find(
        (s) => s.classTypeId === pil.typeId && s.startMinute === at(18) && s.localDate === addDays(pilWeek.weekStart, 1),
      );
      if (pilEvening === undefined) throw new Error("no evening Pilates");
      expect((await post(cancelUrl(org.org.id, pilEvening.id), {}, owner.cookies)).statusCode).toBe(200);
      const evening = await sql<{ id: string }[]>`
        SELECT id FROM gym_class_schedules
        WHERE class_type_id = ${pil.typeId} AND local_start_minute = ${at(18)} AND ended_at IS NULL`;
      for (const r of evening) await stop(r.id);
      expect(await spinsOn(pil.typeId, pilEvening.localDate)).toEqual(["07:00 scheduled", "18:00 cancelled"]);
      const nothing = await post(restoreUrl(org.org.id, pilEvening.id), {}, owner.cookies);
      expect(nothing.statusCode).toBe(409);
      expect(JSON.parse(nothing.body)).toMatchObject({ error: "class_no_repeat_that_day" });
      expect(await spinsOn(pil.typeId, pilEvening.localDate)).toEqual(["07:00 scheduled", "18:00 cancelled"]);
      expect(await auditCount(org.org.id, "org.class_session_hold_lifted")).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  // Round one, L-3: a time the gym's clock skips on that date.
  it(
    "a day cannot be moved to a time the clocks skip on that date, and a day already at one can still change its places",
    async () => {
      const owner = await makeUser("gap-owner");
      const org = await makeOrg(owner.cookies, "Gap Days Gym");
      const made = await post(
        `/v1/orgs/${org.org.id}/classes`,
        { name: "Early", minutes: 60, places: 10, colour: "blue" },
        owner.cookies,
      );
      const typeId = (JSON.parse(made.body) as GymClassesResponse).entries[0]?.type.id;
      if (typeId === undefined) throw new Error("no class");
      // London's clocks go forward at 01:00 on Sunday 28 March 2027: 01:30 does not exist.
      const [a, b] = await sql<{ id: string }[]>`
        INSERT INTO gym_class_schedules
          (gym_id, class_type_id, weekdays, local_start_minute, starts_on, ends_on, minutes)
        VALUES (${org.org.id}, ${typeId}, ARRAY[7]::int[], ${at(9)}, '2027-03-28', '2027-03-28', 60),
               (${org.org.id}, ${typeId}, ARRAY[7]::int[], ${at(1, 30)}, '2027-03-28', '2027-03-28', 60)
        RETURNING id`;
      if (a === undefined || b === undefined) throw new Error("no repeats");
      await fillClassSessions(sql, { gymIds: [org.org.id], now: new Date("2027-03-22T12:00:00Z") });
      const days = weekOf(await get(weekUrl(org.org.id, "2027-03-28"), owner.cookies)).sessions;
      const nine = days.find((s) => s.startMinute === at(9));
      const gap = days.find((s) => s.startMinute === at(1, 30));
      if (nine === undefined || gap === undefined) throw new Error("fill wrote nothing");

      const refused = await put(dayUrl(org.org.id, nine.id), { ...RUN, startMinute: at(1, 45) }, owner.cookies);
      expect(refused.statusCode).toBe(409);
      expect(JSON.parse(refused.body)).toMatchObject({ error: "class_time_missing" });
      expect((await rowOf(nine.id)).local_start_minute).toBe(at(9));
      // 00:30 and 02:30 exist that night.
      expect(
        (await put(dayUrl(org.org.id, nine.id), { ...RUN, startMinute: at(2, 30) }, owner.cookies)).statusCode,
      ).toBe(200);

      // The fill already put a repeat at 01:30 there; changing only its places is allowed.
      const places = await put(
        dayUrl(org.org.id, gap.id),
        { ...RUN, startMinute: at(1, 30), places: 5 },
        owner.cookies,
      );
      expect(places.statusCode).toBe(200);
      expect((await rowOf(gap.id)).places).toBe(5);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // A DAY CHANGED ON ITS OWN
  // =========================================================================

  it(
    "a day changed on its own keeps its own time, length, places and coach when its repeat is changed; the other days follow the repeat",
    async () => {
      const owner = await makeUser("alone-owner");
      const coach = await makeUser("alone-coach");
      const org = await makeOrg(owner.cookies, "Alone Days Gym");
      await joinAsStaff(coach, org, owner.cookies, "trainer");
      const { typeId, repeatId } = await dailyClass(org.org.id, owner.cookies, "Pilates");
      const week = await nextWeek(org.org.id, owner.cookies);
      const monday = sessionIn(week, typeId, 0);
      const friday = sessionIn(week, typeId, 4);

      const changed = await put(
        dayUrl(org.org.id, friday.id),
        { startMinute: at(19, 30), minutes: 90, places: 8, coachUserId: coach.userId },
        owner.cookies,
      );
      expect(changed.statusCode).toBe(200);
      const drawn = weekOf(changed).sessions.find((s) => s.id === friday.id);
      expect(drawn).toMatchObject({
        startMinute: at(19, 30),
        minutes: 90,
        places: 8,
        coachUserId: coach.userId,
        coachName: "Day alone-coach",
        changedAlone: true,
        status: "scheduled",
      });
      // The instant follows the new clock time in the gym's zone.
      const [expected] = await sql<{ at: Date }[]>`
        SELECT ((${friday.localDate}::date + make_interval(mins => ${at(19, 30)}))
                AT TIME ZONE 'Europe/London') AS at`;
      expect((await rowOf(friday.id)).starts_at.toISOString()).toBe(expected?.at.toISOString());
      expect(await auditCount(org.org.id, "org.class_session_changed")).toBe(1);
      const [audit] = await sql<{ meta: Record<string, string> }[]>`
        SELECT meta FROM audit_log
        WHERE gym_id = ${org.org.id} AND action = 'org.class_session_changed'`;
      expect(audit?.meta["coach"]).toBe(`none -> ${coach.userId}`);
      expect(JSON.stringify(audit?.meta)).not.toContain("alone-coach");

      // The repeat is changed: Monday follows it, Friday keeps its own.
      expect(
        (await put(repeatUrl(org.org.id, repeatId), { ...RUN, minutes: 30, places: 40 }, owner.cookies))
          .statusCode,
      ).toBe(200);
      expect(await rowOf(monday.id)).toMatchObject({ minutes: 30, places: 40, changed_alone: false });
      expect(await rowOf(friday.id)).toMatchObject({
        local_start_minute: at(19, 30),
        minutes: 90,
        places: 8,
        coach_user_id: coach.userId,
        changed_alone: true,
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the coach of one day must be this gym's own active staff, and their name goes when they leave",
    async () => {
      const owner = await makeUser("coach-owner");
      const rival = await makeUser("coach-rival");
      const theirs = await makeUser("coach-theirs");
      const ours = await makeUser("coach-ours");
      const justAMember = await makeUser("coach-member");
      const org = await makeOrg(owner.cookies, "Coach Days Gym");
      const rivalOrg = await makeOrg(rival.cookies, "Coach Days Rival");
      await joinAsStaff(theirs, rivalOrg, rival.cookies, "trainer");
      await joinAsStaff(ours, org, owner.cookies, "trainer");
      await joinAsStaff(justAMember, org, owner.cookies, null);
      const { typeId } = await dailyClass(org.org.id, owner.cookies, "Boxing");
      const day = sessionIn(await nextWeek(org.org.id, owner.cookies), typeId, 3);
      const before = await rowOf(day.id);

      for (const [who, coachUserId] of [
        ["another gym's trainer", theirs.userId],
        ["another gym's owner", rival.userId],
        ["our member who is not staff", justAMember.userId],
        ["a uuid that is nobody", randomUUID()],
      ] as const) {
        const res = await put(dayUrl(org.org.id, day.id), { ...RUN, startMinute: at(18), coachUserId }, owner.cookies);
        expect(res.statusCode, `${who} was accepted`).toBe(400);
        expect(JSON.parse(res.body)).toMatchObject({ error: "coach_not_staff" });
        expect(await rowOf(day.id)).toEqual(before);
      }

      const good = await put(
        dayUrl(org.org.id, day.id),
        { ...RUN, startMinute: at(18), coachUserId: ours.userId },
        owner.cookies,
      );
      expect(good.statusCode).toBe(200);
      expect(weekOf(good).sessions.find((s) => s.id === day.id)?.coachName).toBe("Day coach-ours");

      expect(
        (
          await api().inject({
            method: "DELETE",
            url: `/v1/orgs/${org.org.id}/staff/${ours.userId}`,
            remoteAddress: nextIp(),
            cookies: owner.cookies,
          })
        ).statusCode,
      ).toBe(200);
      const after = weekOf(await get(weekUrl(org.org.id, day.localDate), owner.cookies));
      const shown = after.sessions.find((s) => s.id === day.id);
      expect(shown?.coachUserId).toBe(ours.userId);
      expect(shown?.coachName).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // THE DAY RULE, THROUGH THE WIRE
  // =========================================================================

  it(
    "a day that has started cannot be changed, cancelled or put back; a cancelled day must be put back before it is changed; a time already passed is refused; repeats of the same request write once",
    async () => {
      const owner = await makeUser("rule-owner");
      const org = await makeOrg(owner.cookies, "Rule Days Gym");
      const { typeId } = await dailyClass(org.org.id, owner.cookies, "Yoga");
      const week = await nextWeek(org.org.id, owner.cookies);
      const [a, b, c, e] = [0, 1, 2, 3].map((n) => sessionIn(week, typeId, n));
      if (a === undefined || b === undefined || c === undefined || e === undefined) {
        throw new Error("fewer than four days");
      }

      // STARTED: moved into the past by hand. Its time is untouched, so only
      // `started` can be what refuses it.
      await sql`UPDATE gym_class_sessions SET starts_at = now() - interval '5 minutes' WHERE id = ${a.id}`;
      const startedBefore = await rowOf(a.id);
      for (const res of [
        await put(dayUrl(org.org.id, a.id), { ...RUN, startMinute: at(20) }, owner.cookies),
        await post(cancelUrl(org.org.id, a.id), {}, owner.cookies),
        await post(restoreUrl(org.org.id, a.id), {}, owner.cookies),
      ]) {
        expect(res.statusCode).toBe(409);
        expect(JSON.parse(res.body)).toMatchObject({ error: "class_started" });
      }
      expect(await rowOf(a.id)).toEqual(startedBefore);
      await sql`UPDATE gym_class_sessions SET status = 'cancelled' WHERE id = ${a.id}`;
      const restoreStarted = await post(restoreUrl(org.org.id, a.id), {}, owner.cookies);
      expect(JSON.parse(restoreStarted.body)).toMatchObject({ error: "class_started" });
      expect((await rowOf(a.id)).status).toBe("cancelled");

      // CANCELLED, then CHANGED: refused until it is put back.
      expect((await post(cancelUrl(org.org.id, b.id), {}, owner.cookies)).statusCode).toBe(200);
      const onCancelled = await put(dayUrl(org.org.id, b.id), { ...RUN, startMinute: at(20) }, owner.cookies);
      expect(onCancelled.statusCode).toBe(409);
      expect(JSON.parse(onCancelled.body)).toMatchObject({ error: "class_day_cancelled" });
      expect((await rowOf(b.id)).local_start_minute).toBe(at(18));

      // THE SAME CANCEL TWICE: one write, one audit row.
      expect((await post(cancelUrl(org.org.id, b.id), {}, owner.cookies)).statusCode).toBe(200);
      expect(await auditCount(org.org.id, "org.class_session_cancelled")).toBe(1);
      // PUTTING BACK A RUNNING DAY: nothing written.
      expect((await post(restoreUrl(org.org.id, c.id), {}, owner.cookies)).statusCode).toBe(200);
      expect(await auditCount(org.org.id, "org.class_session_restored")).toBe(0);

      // A CHANGE TO WHAT IT ALREADY IS: nothing written, and the day is NOT
      // marked as changed on its own, so it still follows its repeat.
      const same = await put(dayUrl(org.org.id, c.id), { ...RUN, startMinute: at(18) }, owner.cookies);
      expect(same.statusCode).toBe(200);
      expect((await rowOf(c.id)).changed_alone).toBe(false);
      expect(await auditCount(org.org.id, "org.class_session_changed")).toBe(0);

      // A TIME ALREADY PASSED ON THAT DAY: the date is set to yesterday while its
      // instant stays in the future, so only the NEW time can be what refuses.
      await sql`UPDATE gym_class_sessions SET local_date = local_date - 14 WHERE id = ${e.id}`;
      const passed = await put(dayUrl(org.org.id, e.id), { ...RUN, startMinute: at(9) }, owner.cookies);
      expect(passed.statusCode).toBe(409);
      expect(JSON.parse(passed.body)).toMatchObject({ error: "class_time_passed" });
      expect((await rowOf(e.id)).local_start_minute).toBe(at(18));
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "one class, one time, one date: a day cannot be moved or put back onto a time the class already runs, and a new repeat does not write a second one",
    async () => {
      const owner = await makeUser("clash-owner");
      const org = await makeOrg(owner.cookies, "Clash Days Gym");
      const { typeId } = await dailyClass(org.org.id, owner.cookies, "HIIT", at(18));
      const later = await post(
        `/v1/orgs/${org.org.id}/classes/${typeId}/repeats`,
        { ...RUN, weekdays: EVERY_DAY, startMinute: at(19), startsOn: new Date().toISOString().slice(0, 10) },
        owner.cookies,
      );
      expect(later.statusCode).toBe(201);
      const week = await nextWeek(org.org.id, owner.cookies);
      const sixes = week.sessions.filter((s) => s.startMinute === at(18));
      const sevens = week.sessions.filter((s) => s.startMinute === at(19));
      const six = sixes[2];
      const seven = sevens[2];
      if (six === undefined || seven === undefined) throw new Error("missing days");
      expect(seven.localDate).toBe(six.localDate);

      const onto = await put(dayUrl(org.org.id, six.id), { ...RUN, startMinute: at(19) }, owner.cookies);
      expect(onto.statusCode).toBe(409);
      expect(JSON.parse(onto.body)).toMatchObject({ error: "class_day_clashes" });

      // With the 19:00 cancelled that day, the 18:00 may move there...
      expect((await post(cancelUrl(org.org.id, seven.id), {}, owner.cookies)).statusCode).toBe(200);
      expect(
        (await put(dayUrl(org.org.id, six.id), { ...RUN, startMinute: at(19) }, owner.cookies)).statusCode,
      ).toBe(200);
      // ...and then the cancelled 19:00 cannot be put back on top of it.
      const back = await post(restoreUrl(org.org.id, seven.id), {}, owner.cookies);
      expect(back.statusCode).toBe(409);
      expect(JSON.parse(back.body)).toMatchObject({ error: "class_day_clashes" });
      expect((await rowOf(seven.id)).status).toBe("cancelled");

      // The moved day now holds 20:00; a new 20:00 repeat must not write that
      // date a second time.
      expect(
        (await put(dayUrl(org.org.id, six.id), { ...RUN, startMinute: at(20) }, owner.cookies)).statusCode,
      ).toBe(200);
      expect(
        (
          await post(
            `/v1/orgs/${org.org.id}/classes/${typeId}/repeats`,
            { ...RUN, weekdays: EVERY_DAY, startMinute: at(20), startsOn: new Date().toISOString().slice(0, 10) },
            owner.cookies,
          )
        ).statusCode,
      ).toBe(201);
      await fillClassSessions(sql, { gymIds: [org.org.id] });
      const [atEight] = await sql<{ n: number; others: number }[]>`
        SELECT count(*)::int AS n,
               (SELECT count(*)::int FROM gym_class_sessions
                 WHERE class_type_id = ${typeId} AND local_start_minute = ${at(20)}
                   AND local_date = ${six.localDate}::date + 1) AS others
        FROM gym_class_sessions
        WHERE class_type_id = ${typeId} AND local_start_minute = ${at(20)}
          AND local_date = ${six.localDate}::date AND status = 'scheduled'`;
      // One at 20:00 that day; the new repeat still wrote the next day.
      expect(atEight).toEqual({ n: 1, others: 1 });
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // THE WEEK READ
  // =========================================================================

  it(
    "the week runs Monday to Sunday in the gym's calendar, holds only its own seven days, and stops at the last whole written week",
    async () => {
      const owner = await makeUser("week-owner");
      const org = await makeOrg(owner.cookies, "Week Days Gym");
      const { typeId } = await dailyClass(org.org.id, owner.cookies, "Row", at(6, 30));
      await dailyClass(org.org.id, owner.cookies, "Abs", at(6, 30));

      const now = weekOf(await get(weekUrl(org.org.id), owner.cookies));
      expect(isoWeekday(now.weekStart)).toBe(1);
      expect(now.today >= now.weekStart && now.today <= addDays(now.weekStart, 6)).toBe(true);

      // Any day of a week answers that week.
      const next = addDays(now.weekStart, 7);
      for (const inside of [next, addDays(next, 3), addDays(next, 6)]) {
        expect(weekOf(await get(weekUrl(org.org.id, inside), owner.cookies)).weekStart).toBe(next);
      }
      const full = weekOf(await get(weekUrl(org.org.id, next), owner.cookies));
      expect(full.sessions.map((s) => s.localDate)).toEqual(
        [0, 1, 2, 3, 4, 5, 6].flatMap((n) => [addDays(next, n), addDays(next, n)]),
      );
      // Same minute: ordered by name.
      expect(full.sessions.slice(0, 2).map((s) => s.name)).toEqual(["Abs", "Row"]);
      expect(full.sessions.every((s) => !s.started)).toBe(true);

      // The last whole written week: a Monday, all seven days inside the fill's
      // window, and the week after it not.
      const edge = addDays(now.today, 55);
      expect(isoWeekday(now.lastWeekStart)).toBe(1);
      expect(addDays(now.lastWeekStart, 6) <= edge).toBe(true);
      expect(addDays(now.lastWeekStart, 13) > edge).toBe(true);
      const last = weekOf(await get(weekUrl(org.org.id, now.lastWeekStart), owner.cookies));
      expect(last.sessions.filter((s) => s.classTypeId === typeId)).toHaveLength(7);

      for (const bad of ["2026-02-31", "yesterday", "2026-9-1"]) {
        expect((await get(weekUrl(org.org.id, bad), owner.cookies)).statusCode).toBe(400);
      }
    },
    TEST_TIMEOUT_MS,
  );

  // Round one, test 2: the last written week, by a fixed clock on every weekday
  // and near midnight far from UTC, against literal dates worked out by hand.
  it(
    "the last whole written week is the same literal date whichever day of the week it is asked",
    async () => {
      const owner = await makeUser("edge-owner");
      const org = await makeOrg(owner.cookies, "Edge Days Gym");
      const at12 = (day: string) => new Date(`${day}T12:00:00Z`);
      const cases: [Date, string, string, string][] = [
        // now (London)             today         weekStart     lastWeekStart
        [at12("2026-09-21"), "2026-09-21", "2026-09-21", "2026-11-09"],
        [at12("2026-09-22"), "2026-09-22", "2026-09-21", "2026-11-09"],
        [at12("2026-09-23"), "2026-09-23", "2026-09-21", "2026-11-09"],
        [at12("2026-09-24"), "2026-09-24", "2026-09-21", "2026-11-09"],
        [at12("2026-09-25"), "2026-09-25", "2026-09-21", "2026-11-09"],
        [at12("2026-09-26"), "2026-09-26", "2026-09-21", "2026-11-09"],
        // Sunday: today + 56 would be a Sunday and move the answer a week on.
        [at12("2026-09-27"), "2026-09-27", "2026-09-21", "2026-11-09"],
        [at12("2026-09-28"), "2026-09-28", "2026-09-28", "2026-11-16"],
      ];
      for (const [now, today, weekStart, lastWeekStart] of cases) {
        const row = await readWeek(sql, org.org.id, { week: null, now });
        expect(row, now.toISOString()).toMatchObject({ today, weekStart, lastWeekStart });
      }

      await sql`UPDATE gyms SET timezone = 'Pacific/Auckland' WHERE id = ${org.org.id}`;
      expect(
        await readWeek(sql, org.org.id, { week: null, now: new Date("2026-09-27T10:59:00Z") }),
      ).toMatchObject({ today: "2026-09-27", weekStart: "2026-09-21", lastWeekStart: "2026-11-09" });
      expect(
        await readWeek(sql, org.org.id, { week: null, now: new Date("2026-09-27T11:00:00Z") }),
      ).toMatchObject({ today: "2026-09-28", weekStart: "2026-09-28", lastWeekStart: "2026-11-16" });
    },
    TEST_TIMEOUT_MS,
  );

  // Round one, test 3: the gym's row lock is what keeps one class at one time.
  // Two app instances (one database connection each) at one desk address: every
  // date gets "move the 18:00 onto 19:00" from one and "put the cancelled 19:00
  // back" from the other, at the same moment. Exactly one may win each date.
  it(
    "two staff at two app servers cannot both put the same class at the same time on one date",
    async () => {
      const owner = await makeUser("race-owner");
      const org = await makeOrg(owner.cookies, "Race Days Gym");
      const { typeId } = await dailyClass(org.org.id, owner.cookies, "Box", at(18));
      expect(
        (
          await post(
            `/v1/orgs/${org.org.id}/classes/${typeId}/repeats`,
            { ...RUN, weekdays: EVERY_DAY, startMinute: at(19), startsOn: new Date().toISOString().slice(0, 10) },
            owner.cookies,
          )
        ).statusCode,
      ).toBe(201);
      const now = weekOf(await get(weekUrl(org.org.id), owner.cookies));
      const pairs: { six: string; seven: string; day: string }[] = [];
      for (const offset of [7, 14]) {
        const week = weekOf(await get(weekUrl(org.org.id, addDays(now.weekStart, offset)), owner.cookies));
        for (const s of week.sessions.filter((x) => x.startMinute === at(18))) {
          const seven = week.sessions.find((x) => x.localDate === s.localDate && x.startMinute === at(19));
          if (seven === undefined) throw new Error("no 19:00 that day");
          expect((await post(cancelUrl(org.org.id, seven.id), {}, owner.cookies)).statusCode).toBe(200);
          pairs.push({ six: s.id, seven: seven.id, day: s.localDate });
        }
      }
      expect(pairs.length).toBe(14);

      const second = await buildApp(loadConfig(baseEnv), {
        emailSender: {
          sendVerificationEmail: () => Promise.resolve(),
          sendPasswordResetEmail: () => Promise.resolve(),
          sendSignInCodeEmail: () => Promise.resolve(),
        },
      });
      await second.ready();
      try {
        const desk = "10.62.250.1";
        const answers = await Promise.all(
          pairs.flatMap((p) => [
            api().inject({
              method: "PUT",
              url: dayUrl(org.org.id, p.six),
              remoteAddress: desk,
              cookies: owner.cookies,
              headers: { "content-type": "application/json" },
              payload: JSON.stringify({ ...RUN, startMinute: at(19) }),
            }),
            second.inject({
              method: "POST",
              url: restoreUrl(org.org.id, p.seven),
              remoteAddress: desk,
              cookies: owner.cookies,
              headers: { "content-type": "application/json" },
              payload: "{}",
            }),
          ]),
        );
        const codes = answers.map((a) => a.statusCode);
        expect(codes.filter((c) => c === 200).length).toBe(14);
        expect(codes.filter((c) => c === 409).length).toBe(14);
        for (const p of pairs) {
          expect(await spinsOn(typeId, p.day), p.day).toContain("19:00 scheduled");
          expect((await spinsOn(typeId, p.day)).filter((x) => x === "19:00 scheduled"), p.day).toHaveLength(1);
        }
      } finally {
        await second.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a week across the clocks going back keeps six o'clock at six o'clock",
    async () => {
      const owner = await makeUser("dst-owner");
      const org = await makeOrg(owner.cookies, "Clocks Days Gym");
      const made = await post(
        `/v1/orgs/${org.org.id}/classes`,
        { name: "Evening", minutes: 60, places: 10, colour: "blue" },
        owner.cookies,
      );
      const typeId = (JSON.parse(made.body) as GymClassesResponse).entries[0]?.type.id;
      if (typeId === undefined) throw new Error("no class");
      // Written straight into the table and filled with a fixed clock, so the
      // test does not depend on today's date.
      const [schedule] = await sql<{ id: string }[]>`
        INSERT INTO gym_class_schedules
          (gym_id, class_type_id, weekdays, local_start_minute, starts_on, ends_on, minutes)
        VALUES (${org.org.id}, ${typeId}, ARRAY[1,2,3,4,5,6,7]::int[], ${at(18)},
                '2026-10-19', '2026-11-01', 60)
        RETURNING id`;
      if (schedule === undefined) throw new Error("no repeat");
      await fillClassSessions(sql, {
        gymIds: [org.org.id],
        scheduleIds: [schedule.id],
        now: new Date("2026-10-19T09:00:00Z"),
      });

      const week = weekOf(await get(weekUrl(org.org.id, "2026-10-21"), owner.cookies));
      expect(week.weekStart).toBe("2026-10-19");
      expect(week.sessions).toHaveLength(7);
      expect(week.sessions.every((s) => s.startMinute === at(18))).toBe(true);
      const byDate = new Map(week.sessions.map((s) => [s.localDate, s.startsAt]));
      expect(new Date(byDate.get("2026-10-24") ?? "").toISOString()).toBe("2026-10-24T17:00:00.000Z");
      expect(new Date(byDate.get("2026-10-25") ?? "").toISOString()).toBe("2026-10-25T18:00:00.000Z");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a manager may cancel a day; a gym with no live plan reads its week and changes nothing",
    async () => {
      const owner = await makeUser("gate-owner");
      const manager = await makeUser("gate-manager");
      const org = await makeOrg(owner.cookies, "Gate Days Gym");
      await joinAsStaff(manager, org, owner.cookies, "manager");
      const { typeId } = await dailyClass(org.org.id, owner.cookies, "Stretch");
      const day = sessionIn(await nextWeek(org.org.id, owner.cookies), typeId, 1);

      expect((await post(cancelUrl(org.org.id, day.id), {}, manager.cookies)).statusCode).toBe(200);

      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${org.org.id}`;
      expect((await get(weekUrl(org.org.id, day.localDate), owner.cookies)).statusCode).toBe(200);
      for (const res of [
        await post(restoreUrl(org.org.id, day.id), {}, owner.cookies),
        await post(cancelUrl(org.org.id, day.id), {}, owner.cookies),
        await put(dayUrl(org.org.id, day.id), { ...RUN, startMinute: at(7) }, owner.cookies),
      ]) {
        expect(res.statusCode).toBe(409);
        expect(JSON.parse(res.body)).toMatchObject({ error: "gym_not_on_plan" });
      }
      expect((await rowOf(day.id)).status).toBe("cancelled");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a malformed request is a 400 and a date that is not this gym's is a 404",
    async () => {
      const owner = await makeUser("shape-owner");
      const org = await makeOrg(owner.cookies, "Shape Days Gym");
      const { typeId } = await dailyClass(org.org.id, owner.cookies, "Core");
      const day = sessionIn(await nextWeek(org.org.id, owner.cookies), typeId, 2);
      const before = await rowOf(day.id);

      for (const body of [
        { ...RUN },
        { ...RUN, startMinute: 1440 },
        { ...RUN, startMinute: at(9), minutes: 4 },
        { ...RUN, startMinute: at(9), places: 0 },
        { ...RUN, startMinute: at(9), localDate: "2026-12-01" },
      ]) {
        expect((await put(dayUrl(org.org.id, day.id), body, owner.cookies)).statusCode).toBe(400);
      }
      expect((await post(cancelUrl(org.org.id, "not-a-uuid"), {}, owner.cookies)).statusCode).toBe(400);
      expect((await post(cancelUrl(org.org.id, randomUUID()), {}, owner.cookies)).statusCode).toBe(404);
      expect(await rowOf(day.id)).toEqual(before);
    },
    TEST_TIMEOUT_MS,
  );
});
