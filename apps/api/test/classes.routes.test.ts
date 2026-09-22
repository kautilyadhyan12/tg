// THE TIMETABLE'S DOORS — routes against REAL Postgres (R9.2, DATABASE_URL-
// gated). ROADMAP Stage 2 item 17b-i; Part 3 §13.3.
//
// **THE FIRST BLOCK IS THE WORST THING THIS CARD COULD DO TO A REAL PERSON, and
// it is first because the rulebook says it is** (CLAUDE.md §2.1, RULINGS
// 2026-09-20). The repeat rule's half of that sentence — a class at the wrong
// hour — is proved in `classes.fill.test.ts`. THIS file proves the other half:
// one gym seeing, or rewriting, another gym's timetable and the name of its
// coach.
//
// **EVERY REFUSAL IS CHECKED BY READING THE DATABASE, NOT THE REPLY.** A 404
// that answered correctly and still archived the class would pass any assertion
// about status codes, so every refusal below is followed by a count of what is
// actually on the gym's timetable and calendar.
//
// **AND EVERY REFUSAL IS PAIRED WITH A POSITIVE CONTROL ON THE SAME URL.** A
// route that does not exist answers 404, which is byte-for-byte what
// `requirePrivilege` answers a stranger — so "a stranger gets 404" would have
// passed against an empty server and would go on passing if somebody deleted
// the route.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { fillClassSessions, fillClassSessionsJob } from "../src/modules/orgs/classes/fill.js";
import { randomUUID } from "node:crypto";
import {
  CLASS_FILL_HORIZON_DAYS,
  CLASS_SCHEDULES_PER_TYPE_MAX,
  CLASS_SCHEDULE_PREVIEW_DATES,
  CLASS_TYPES_MAX,
  CLASS_ARCHIVED_PAGE,
  ROLE_PRIVILEGES,
} from "@app/shared";
import type { GymClassesResponse } from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "classes-routes-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;

const TEST_TIMEOUT_MS = 90_000;
const HOOK_TIMEOUT_MS = 90_000;

/** INR, not GBP, for `memberList.confirm.routes.test.ts`' stated reason: the
 *  orgs suite proves a gym in a currency with no price book is refused, and it
 *  picks GBP after checking GBP is unseeded. The two share one database. */
const LIVE_PLAN = "zz_classes_routes";

interface CreatedOrg {
  org: { id: string; slug: string; name: string };
  joinCode: { code: string; label: string };
}

let ipCounter = 0;
const nextIp = () => `10.61.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const MON = 1;
const WED = 3;
const at = (h: number, m = 0) => h * 60 + m;

/** The job reports what it did (R8.3); nothing here asserts on it. */
const silent = {
  info: () => {
    /* deliberately empty */
  },
};


const aClass = (over: Record<string, unknown> = {}) => ({
  name: "Yoga",
  minutes: 60,
  places: 20,
  colour: "blue",
  ...over,
});

d("the gym's timetable: who may set it, and what it answers (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const tokens = new Map<string, string>();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'cls-t-%@example.com')`;
    await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_schedules WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'cls-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (
    method: "POST" | "PUT" | "DELETE",
    path: string,
    payload: unknown,
    cookies: Record<string, string> = {},
    ip = nextIp(),
  ) =>
    api().inject({
      method,
      url: path,
      remoteAddress: ip,
      headers: { "content-type": "application/json" },
      cookies,
      payload: JSON.stringify(payload),
    });

  const post = (path: string, payload: unknown, cookies: Record<string, string> = {}) =>
    send("POST", path, payload, cookies);
  const put = (path: string, payload: unknown, cookies: Record<string, string> = {}) =>
    send("PUT", path, payload, cookies);
  const del = (path: string, cookies: Record<string, string> = {}) =>
    api().inject({ method: "DELETE", url: path, remoteAddress: nextIp(), cookies });
  const get = (path: string, cookies: Record<string, string> = {}) =>
    api().inject({ method: "GET", url: path, remoteAddress: nextIp(), cookies });

  const makeUser = async (local: string) => {
    const email = `cls-t-${local}@example.com`;
    const reg = await api().inject({
      method: "POST",
      url: "/v1/auth/register",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email, password: PASSWORD, displayName: `Cls ${local}` }),
    });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await api().inject({
      method: "POST",
      url: "/v1/auth/login",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(login.statusCode).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
  };

  const subscribeGym = async (gymId: string) => {
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
  };

  const makeOrg = async (cookies: Record<string, string>, name: string): Promise<CreatedOrg> => {
    const res = await post(
      "/v1/orgs",
      { name, city: "Leeds", country: "GB", timezone: "Europe/London" },
      cookies,
    );
    expect(res.statusCode).toBe(201);
    const created = JSON.parse(res.body) as CreatedOrg;
    await subscribeGym(created.org.id);
    return created;
  };

  const joinAsMember = async (
    memberCookies: Record<string, string>,
    org: CreatedOrg,
    staffCookies: Record<string, string>,
  ) => {
    const applied = await post("/v1/orgs/join", { code: org.joinCode.code }, memberCookies);
    expect(applied.statusCode).toBe(200);
    const id = (JSON.parse(applied.body) as { application?: { id: string } }).application?.id;
    if (id === undefined) throw new Error("apply returned no application");
    expect(
      (await post(`/v1/orgs/${org.org.id}/applications/${id}/confirm`, {}, staffCookies))
        .statusCode,
    ).toBe(200);
  };

  const classesUrl = (gymId: string) => `/v1/orgs/${gymId}/classes`;
  const typeUrl = (gymId: string, typeId: string) => `${classesUrl(gymId)}/${typeId}`;
  const repeatsUrl = (gymId: string, typeId: string) => `${typeUrl(gymId, typeId)}/repeats`;
  const restoreUrl = (gymId: string, typeId: string) => `${typeUrl(gymId, typeId)}/restore`;
  const repeatUrl = (gymId: string, id: string) => `/v1/orgs/${gymId}/class-repeats/${id}`;

  const timetable = (res: { body: string }) => JSON.parse(res.body) as GymClassesResponse;

  /** WHAT IS ACTUALLY THERE, read from the tables and never from a reply. */
  const stateOf = async (gymId: string) => {
    const [row] = await sql<{ types: number; repeats: number; sessions: number }[]>`
      SELECT
        (SELECT count(*)::int FROM gym_class_types
          WHERE gym_id = ${gymId} AND archived_at IS NULL) AS types,
        (SELECT count(*)::int FROM gym_class_schedules
          WHERE gym_id = ${gymId} AND ended_at IS NULL) AS repeats,
        (SELECT count(*)::int FROM gym_class_sessions WHERE gym_id = ${gymId}) AS sessions`;
    return row ?? { types: -1, repeats: -1, sessions: -1 };
  };

  /** A date a fixed number of days from today, in `YYYY-MM-DD`. Repeats are
   *  written against the real clock here (the routes take the server's), so the
   *  fixtures move with it rather than pinning a date that ages out. */
  const dayFromToday = (offset: number) =>
    new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

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
        sendVerificationEmail: (email, _name, rawToken) => {
          tokens.set(email.toLowerCase(), rawToken);
          return Promise.resolve();
        },
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
  // THE WORST THING: ANOTHER GYM'S TIMETABLE
  // =========================================================================

  it(
    "nobody outside this gym's ticked staff can read, add to, change, archive or stop anything on its timetable — and every refusal writes NOTHING",
    async () => {
      const owner = await makeUser("worst-owner");
      const stranger = await makeUser("worst-stranger");
      const member = await makeUser("worst-member");
      const trainer = await makeUser("worst-trainer");
      const rival = await makeUser("worst-rival");
      const org = await makeOrg(owner.cookies, "Worst Classes Gym");
      const rivalOrg = await makeOrg(rival.cookies, "Rival Classes Gym");
      await joinAsMember(member.cookies, org, owner.cookies);
      await joinAsMember(trainer.cookies, org, owner.cookies);
      expect(
        (await post(`/v1/orgs/${org.org.id}/staff`, { email: trainer.email, role: "trainer" }, owner.cookies))
          .statusCode,
      ).toBe(201);

      // The gym's own timetable, made by its owner — the POSITIVE CONTROL every
      // refusal below is measured against.
      const made = await post(classesUrl(org.org.id), aClass({ name: "Sunrise Yoga" }), owner.cookies);
      expect(made.statusCode).toBe(201);
      const typeId = timetable(made).entries[0]?.type.id;
      if (typeId === undefined) throw new Error("create answered no class");
      const repeatMade = await post(
        repeatsUrl(org.org.id, typeId),
        { weekdays: [MON, WED], startMinute: at(18), startsOn: dayFromToday(0) },
        owner.cookies,
      );
      expect(repeatMade.statusCode).toBe(201);
      const repeatId = timetable(repeatMade).entries[0]?.schedules[0]?.id;
      if (repeatId === undefined) throw new Error("repeat answered no id");

      const before = await stateOf(org.org.id);
      expect(before.types).toBe(1);
      expect(before.repeats).toBe(1);
      expect(before.sessions).toBeGreaterThan(0);

      // EVERY DOOR, EVERY OUTSIDER — and the two different refusals are the
      // information boundary, not an inconsistency.
      //
      // **A PLAIN MEMBER GETS THE SAME 404 AS A STRANGER**, measured here rather
      // than assumed (this expectation was written as 403 and the suite
      // corrected it): `requirePrivilege` reads STAFF authority, and somebody
      // who merely belongs to the gym has none — so the console cannot tell
      // them apart from somebody who is nowhere near it, which is the whole
      // tenancy answer. Only a member of STAFF, who already knows the gym
      // exists, gets a 403 saying their role does not cover this
      // (§13.3: owner and manager, never a trainer).
      const outsiders: { who: string; cookies: Record<string, string>; status: number }[] = [
        { who: "a stranger", cookies: stranger.cookies, status: 404 },
        { who: "a rival gym's owner", cookies: rival.cookies, status: 404 },
        { who: "this gym's own member", cookies: member.cookies, status: 404 },
        { who: "this gym's own trainer", cookies: trainer.cookies, status: 403 },
        { who: "nobody at all", cookies: {}, status: 401 },
      ];

      for (const outsider of outsiders) {
        const tried = [
          await get(classesUrl(org.org.id), outsider.cookies),
          await post(classesUrl(org.org.id), aClass({ name: "Theirs" }), outsider.cookies),
          await put(typeUrl(org.org.id, typeId), aClass({ name: "Renamed" }), outsider.cookies),
          await del(typeUrl(org.org.id, typeId), outsider.cookies),
          await post(
            repeatsUrl(org.org.id, typeId),
            { weekdays: [MON], startMinute: at(6), startsOn: dayFromToday(0) },
            outsider.cookies,
          ),
          await del(repeatUrl(org.org.id, repeatId), outsider.cookies),
          // The seventh door, added with Bring back: a class somebody else
          // archived is not a class a stranger may put back on their timetable.
          await post(restoreUrl(org.org.id, typeId), {}, outsider.cookies),
        ];
        for (const res of tried) {
          expect(
            res.statusCode,
            `${outsider.who} reached ${res.raw.req.method ?? "?"} ${String(res.raw.req.url)}`,
          ).toBe(outsider.status);
        }
        // AND NOTHING MOVED. The whole point of reading the tables rather than
        // the replies.
        expect(await stateOf(org.org.id)).toEqual(before);
      }

      // THE RIVAL GYM'S OWNER, ADDRESSING THIS GYM'S CLASS THROUGH THEIR OWN
      // GYM — the id-alone attack the pair-in-the-WHERE rule exists to stop. It
      // is a 404 from `classes/repo.ts`, not from the privilege gate: this
      // caller legitimately holds `schedule.manage` on `rivalOrg`.
      expect((await put(typeUrl(rivalOrg.org.id, typeId), aClass(), rival.cookies)).statusCode)
        .toBe(404);
      expect((await del(typeUrl(rivalOrg.org.id, typeId), rival.cookies)).statusCode).toBe(404);
      expect(
        (
          await post(
            repeatsUrl(rivalOrg.org.id, typeId),
            { weekdays: [MON], startMinute: at(6), startsOn: dayFromToday(0) },
            rival.cookies,
          )
        ).statusCode,
      ).toBe(404);
      expect((await del(repeatUrl(rivalOrg.org.id, repeatId), rival.cookies)).statusCode).toBe(404);
      expect((await post(restoreUrl(rivalOrg.org.id, typeId), {}, rival.cookies)).statusCode).toBe(404);
      expect(await stateOf(org.org.id)).toEqual(before);
      expect(await stateOf(rivalOrg.org.id)).toEqual({ types: 0, repeats: 0, sessions: 0 });

      // AND THE RIVAL'S OWN TIMETABLE NEVER SHOWS THIS GYM'S CLASS.
      const rivalSees = timetable(await get(classesUrl(rivalOrg.org.id), rival.cookies));
      expect(rivalSees.entries).toEqual([]);
      expect(rivalSees.archived).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a manager may set the timetable and a trainer may not — the ticks, not the role name",
    async () => {
      const owner = await makeUser("tick-owner");
      const manager = await makeUser("tick-manager");
      const org = await makeOrg(owner.cookies, "Ticks Classes Gym");
      await joinAsMember(manager.cookies, org, owner.cookies);
      expect(
        (await post(`/v1/orgs/${org.org.id}/staff`, { email: manager.email, role: "manager" }, owner.cookies))
          .statusCode,
      ).toBe(201);

      // §13.3's own words, and the migration's backfill: owner and manager start
      // with it, a trainer does not.
      expect(ROLE_PRIVILEGES.owner).toContain("schedule.manage");
      expect(ROLE_PRIVILEGES.manager).toContain("schedule.manage");
      expect(ROLE_PRIVILEGES.trainer).not.toContain("schedule.manage");

      const made = await post(classesUrl(org.org.id), aClass({ name: "Spin" }), manager.cookies);
      expect(made.statusCode).toBe(201);
      expect(timetable(made).entries[0]?.type.name).toBe("Spin");

      // TICKED DOWN, AND THE SERVER IS WHAT ENFORCES IT — not the screen. The
      // owner takes the tick away and the same manager, same cookies, is 403 on
      // the read as well as on every write.
      await put(
        `/v1/orgs/${org.org.id}/staff/${manager.userId}/privileges`,
        { privileges: ["members.read"] },
        owner.cookies,
      );
      expect((await get(classesUrl(org.org.id), manager.cookies)).statusCode).toBe(403);
      expect(
        (await post(classesUrl(org.org.id), aClass({ name: "Nope" }), manager.cookies)).statusCode,
      ).toBe(403);
      expect((await stateOf(org.org.id)).types).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // WHAT IT DOES WHEN IT WORKS
  // =========================================================================

  it(
    "saving a repeat writes its dates at once, and the screen reads them back",
    async () => {
      const owner = await makeUser("happy-owner");
      const org = await makeOrg(owner.cookies, "Happy Classes Gym");

      const empty = timetable(await get(classesUrl(org.org.id), owner.cookies));
      expect(empty).toEqual({
        timezone: "Europe/London",
        clockFormat: "24h",
        horizonDays: CLASS_FILL_HORIZON_DAYS,
        entries: [],
        archived: [],
        archivedTotal: 0,
      });

      const made = await post(
        classesUrl(org.org.id),
        aClass({ name: "Open Gym", places: null, openGym: true, description: "Just turn up." }),
        owner.cookies,
      );
      expect(made.statusCode).toBe(201);
      const type = timetable(made).entries[0]?.type;
      if (type === undefined) throw new Error("create answered no class");
      expect(type).toMatchObject({
        name: "Open Gym",
        places: null,
        openGym: true,
        description: "Just turn up.",
        coachUserId: null,
        coachName: null,
      });
      // A class with no repeat has no dates, and says so rather than looking
      // broken.
      expect(timetable(made).entries[0]?.schedules).toEqual([]);

      const withRepeat = await post(
        repeatsUrl(org.org.id, type.id),
        { weekdays: [WED, MON], startMinute: at(18, 30), startsOn: dayFromToday(0) },
        owner.cookies,
      );
      expect(withRepeat.statusCode).toBe(201);
      const schedule = timetable(withRepeat).entries[0]?.schedules[0];
      if (schedule === undefined) throw new Error("repeat answered nothing");
      // SORTED AND DE-DUPLICATED ON THE WAY IN: the screen sent Wednesday first.
      expect(schedule.weekdays).toEqual([MON, WED]);
      expect(schedule.startMinute).toBe(at(18, 30));
      expect(schedule.endsOn).toBeNull();
      // THE DATES ARE THERE BEFORE THE NIGHTLY JOB EVER RUNS — two a week over
      // eight weeks, and the screen shows the first few.
      // EXACT, not `>= 15` — round one's third weak test. A fill that ignored
      // `weekdays` altogether writes 57 dates and passed the old assertion; the
      // number this case was written for is two a week over eight weeks.
      expect(schedule.sessionsAhead).toBe(16);
      // And the server says the count is NOT the whole truth, because the
      // repeat has no end date (C/H-3).
      expect(schedule.datesComplete).toBe(false);
      expect(schedule.finished).toBe(false);
      expect(schedule.nextDates).toHaveLength(CLASS_SCHEDULE_PREVIEW_DATES);
      expect([...schedule.nextDates].sort()).toEqual(schedule.nextDates);

      // AND THEY ARE REALLY IN THE TABLE, at the right hour, in the gym's zone.
      const rows = await sql<{ minute: number; local_hour: number; n: number }[]>`
        SELECT local_start_minute AS minute,
               EXTRACT(HOUR FROM (starts_at AT TIME ZONE 'Europe/London'))::int AS local_hour,
               count(*) OVER ()::int AS n
        FROM gym_class_sessions WHERE gym_id = ${org.org.id} LIMIT 1`;
      expect(rows[0]?.minute).toBe(at(18, 30));
      expect(rows[0]?.local_hour).toBe(18);
      expect(rows[0]?.n).toBe(schedule.sessionsAhead);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "editing a class follows through to its future dates and leaves the past alone; archiving takes the future away and keeps the past",
    async () => {
      const owner = await makeUser("edit-owner");
      const org = await makeOrg(owner.cookies, "Edit Classes Gym");
      const made = await post(classesUrl(org.org.id), aClass({ name: "Pilates" }), owner.cookies);
      const type = timetable(made).entries[0]?.type;
      if (type === undefined) throw new Error("create answered no class");
      await post(
        repeatsUrl(org.org.id, type.id),
        { weekdays: [1, 2, 3, 4, 5, 6, 7], startMinute: at(7), startsOn: dayFromToday(0) },
        owner.cookies,
      );

      // A session in the PAST and a session the gym has deliberately changed —
      // built here because nothing in this card can produce either yet, and both
      // are what the edit must not touch.
      await sql`
        INSERT INTO gym_class_sessions
          (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places)
        VALUES (${org.org.id}, ${type.id}, (now() - interval '3 days')::date, ${at(7)},
                now() - interval '3 days', 60, 20)`;
      await sql`
        UPDATE gym_class_sessions SET changed_alone = true
        WHERE gym_id = ${org.org.id}
          AND local_date = (SELECT max(local_date) FROM gym_class_sessions WHERE gym_id = ${org.org.id})`;

      const edited = await put(
        typeUrl(org.org.id, type.id),
        aClass({ name: "Pilates (Reformer)", minutes: 45, places: 8 }),
        owner.cookies,
      );
      expect(edited.statusCode).toBe(200);
      expect(timetable(edited).entries[0]?.type).toMatchObject({
        name: "Pilates (Reformer)",
        minutes: 45,
        places: 8,
      });

      const shape = await sql<{ bucket: string; minutes: number; places: number; n: number }[]>`
        SELECT CASE
                 WHEN changed_alone THEN 'changed'
                 WHEN starts_at <= now() THEN 'past'
                 ELSE 'future'
               END AS bucket,
               minutes, places, count(*)::int AS n
        FROM gym_class_sessions WHERE gym_id = ${org.org.id}
        GROUP BY 1, 2, 3 ORDER BY 1`;
      const byBucket = new Map(shape.map((r) => [r.bucket, r]));
      expect(byBucket.get("future")).toMatchObject({ minutes: 45, places: 8 });
      // The past keeps what it was: changing a class must not rewrite history.
      expect(byBucket.get("past")).toMatchObject({ minutes: 60, places: 20 });
      // And so does the day the gym changed on purpose.
      expect(byBucket.get("changed")).toMatchObject({ minutes: 60, places: 20 });

      // ARCHIVE. The class leaves the live list, keeps its name in the archived
      // one, its repeats stop, its FUTURE dates go and its past dates stay.
      const archived = await del(typeUrl(org.org.id, type.id), owner.cookies);
      expect(archived.statusCode).toBe(200);
      const after = timetable(archived);
      expect(after.entries).toEqual([]);
      expect(after.archived[0]?.name).toBe("Pilates (Reformer)");
      expect(after.archived[0]?.archivedAt).not.toBeNull();

      expect(await stateOf(org.org.id)).toMatchObject({ types: 0, repeats: 0 });
      const [left] = await sql<{ future: number; past: number }[]>`
        SELECT count(*) FILTER (WHERE starts_at > now())::int AS future,
               count(*) FILTER (WHERE starts_at <= now())::int AS past
        FROM gym_class_sessions WHERE gym_id = ${org.org.id}`;
      expect(left?.future).toBe(0);
      expect(left?.past).toBeGreaterThan(0);

      // Archiving the same class twice is a 404 the second time: the thing the
      // caller asked about is no longer on the live timetable.
      expect((await del(typeUrl(org.org.id, type.id), owner.cookies)).statusCode).toBe(404);
      expect((await put(typeUrl(org.org.id, type.id), aClass(), owner.cookies)).statusCode).toBe(404);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "brings an archived class back, without bringing its old dates back",
    async () => {
      const owner = await makeUser("back-owner");
      const org = await makeOrg(owner.cookies, "Bring Back Classes Gym");
      const made = await post(classesUrl(org.org.id), aClass({ name: "Barre" }), owner.cookies);
      const type = timetable(made).entries[0]?.type;
      if (type === undefined) throw new Error("create answered no class");
      await post(
        repeatsUrl(org.org.id, type.id),
        { weekdays: [1, 2, 3, 4, 5, 6, 7], startMinute: at(7), startsOn: dayFromToday(0) },
        owner.cookies,
      );
      expect((await stateOf(org.org.id)).sessions).toBe(CLASS_FILL_HORIZON_DAYS + 1);
      expect((await del(typeUrl(org.org.id, type.id), owner.cookies)).statusCode).toBe(200);

      const back = await post(restoreUrl(org.org.id, type.id), {}, owner.cookies);
      expect(back.statusCode).toBe(200);
      const after = timetable(back);
      // LIVE AGAIN, with its name and its numbers, and the archived list empty.
      expect(after.entries[0]?.type).toMatchObject({ name: "Barre", minutes: 60, places: 20 });
      expect(after.entries[0]?.type.archivedAt).toBeNull();
      expect(after.archived).toEqual([]);

      // **AND ITS REPEATS STAY STOPPED, WHICH IS THE POINT OF THE CASE.** The
      // archive ended them and cleared their dates; un-ending them would put
      // dates back on a calendar nobody has asked for.
      expect(after.entries[0]?.schedules).toEqual([]);
      expect(await stateOf(org.org.id)).toMatchObject({ types: 1, repeats: 0 });

      // THE NIGHTLY JOB MUST NOT PUT THEM BACK EITHER — driven, not assumed,
      // because this is the one way a stopped repeat could come back to life.
      await fillClassSessions(sql, { gymIds: [org.org.id] });
      const [left] = await sql<{ future: number }[]>`
        SELECT count(*) FILTER (WHERE starts_at > now())::int AS future
        FROM gym_class_sessions WHERE gym_id = ${org.org.id}`;
      expect(left?.future).toBe(0);

      // Bringing back a class that is already live is a 404: the caller is
      // acting on a list that has moved under them.
      expect((await post(restoreUrl(org.org.id, type.id), {}, owner.cookies)).statusCode).toBe(404);

      // And the gym can simply add a repeat again — two taps, and the dates
      // are written as they always are.
      const again = await post(
        repeatsUrl(org.org.id, type.id),
        { weekdays: [1, 2, 3, 4, 5, 6, 7], startMinute: at(7), startsOn: dayFromToday(0) },
        owner.cookies,
      );
      expect(again.statusCode).toBe(201);
      expect((await stateOf(org.org.id)).sessions).toBeGreaterThan(CLASS_FILL_HORIZON_DAYS);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "stopping a repeat takes its future dates with it and never brings them back",
    async () => {
      const owner = await makeUser("stop-owner");
      const org = await makeOrg(owner.cookies, "Stop Classes Gym");
      const made = await post(classesUrl(org.org.id), aClass({ name: "Boxing" }), owner.cookies);
      const type = timetable(made).entries[0]?.type;
      if (type === undefined) throw new Error("create answered no class");
      const withRepeat = await post(
        repeatsUrl(org.org.id, type.id),
        { weekdays: [1, 2, 3, 4, 5, 6, 7], startMinute: at(7), startsOn: dayFromToday(0) },
        owner.cookies,
      );
      const schedule = timetable(withRepeat).entries[0]?.schedules[0];
      if (schedule === undefined) throw new Error("repeat answered nothing");
      expect((await stateOf(org.org.id)).sessions).toBe(CLASS_FILL_HORIZON_DAYS + 1);

      const stopped = await del(repeatUrl(org.org.id, schedule.id), owner.cookies);
      expect(stopped.statusCode).toBe(200);
      expect(timetable(stopped).entries[0]?.schedules).toEqual([]);
      const [left] = await sql<{ future: number }[]>`
        SELECT count(*) FILTER (WHERE starts_at > now())::int AS future
        FROM gym_class_sessions WHERE gym_id = ${org.org.id}`;
      expect(left?.future).toBe(0);

      // AND THE CLASS ITSELF IS STILL THERE, with no repeat — "stop this
      // repeat" is not "delete this class".
      const now = timetable(await get(classesUrl(org.org.id), owner.cookies));
      expect(now.entries[0]?.type.name).toBe("Boxing");
      expect(now.entries[0]?.schedules).toEqual([]);

      // Stopping it again is a 404, and nothing comes back.
      expect((await del(repeatUrl(org.org.id, schedule.id), owner.cookies)).statusCode).toBe(404);
      expect((await stateOf(org.org.id)).repeats).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // ROUND ONE'S THREE CRITICAL/HIGH, EACH WITH THE CASE THAT FOUND IT
  // =========================================================================

  it(
    "the nightly job cannot undo a Stop that commits while it is in flight",
    async () => {
      const owner = await makeUser("race-owner");
      const org = await makeOrg(owner.cookies, "Race Classes Gym");
      const made = await post(classesUrl(org.org.id), aClass({ name: "Race" }), owner.cookies);
      const type = timetable(made).entries[0]?.type;
      if (type === undefined) throw new Error("create answered no class");
      const withRepeat = await post(
        repeatsUrl(org.org.id, type.id),
        { weekdays: [1, 2, 3, 4, 5, 6, 7], startMinute: at(7), startsOn: dayFromToday(0) },
        owner.cookies,
      );
      const scheduleId = timetable(withRepeat).entries[0]?.schedules[0]?.id;
      if (scheduleId === undefined) throw new Error("no repeat");

      // **THE INTERLEAVING IS DRIVEN, NOT HOPED FOR, and the first version of
      // this case is why.** It started the job and the route together with
      // `Promise.all` and passed with the lock REMOVED — a test that could not
      // see the defect it was written for. The losing order is a specific one:
      // the fill's statement takes its READ COMMITTED snapshot, the console
      // write commits, and the fill then writes rows for a repeat that no longer
      // exists. So the console write is held open here until the job is in
      // flight, which is the only way to put those three events in that order
      // every time.
      //
      // The statements below are `repo.endSchedule`'s, by hand, because the
      // route commits and there would be nothing to hold open. The ROUTE's own
      // Stop is proved two cases down.
      let release = (): void => {
        throw new Error("the gate was never armed");
      };
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const stopping = sql.begin(async (tx) => {
        await tx`SELECT 1 FROM gyms WHERE id = ${org.org.id} FOR UPDATE`;
        await tx`UPDATE gym_class_schedules SET ended_at = now() WHERE id = ${scheduleId}`;
        await tx`DELETE FROM gym_class_sessions
                 WHERE schedule_id = ${scheduleId} AND starts_at > now()`;
        await gate;
      });
      await new Promise((r) => setTimeout(r, 250));

      // The job starts while the Stop is still open. Under the fix it blocks on
      // the gym's row lock and takes its snapshot AFTER the Stop commits, so it
      // sees a stopped repeat and writes nothing. Without the lock its snapshot
      // is already taken and it writes 57 dates back onto a calendar the gym was
      // told had been cleared.
      const job = fillClassSessionsJob({ sql, log: silent }, { gymIds: [org.org.id] });
      await new Promise((r) => setTimeout(r, 750));
      release();
      await stopping;
      await job;

      const [left] = await sql<{ future: number }[]>`
        SELECT count(*) FILTER (WHERE starts_at > now())::int AS future
        FROM gym_class_sessions WHERE schedule_id = ${scheduleId}`;
      expect(left?.future).toBe(0);

      // AND THE SCREEN AGREES WITH THE TABLE, which is the sentence the gym was
      // shown: "its coming dates are cleared".
      const after = timetable(await get(classesUrl(org.org.id), owner.cookies));
      expect(after.entries[0]?.schedules).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "every removed class is reachable, and the gym is told when it is seeing a page",
    async () => {
      const owner = await makeUser("page-owner");
      const org = await makeOrg(owner.cookies, "Archive Page Classes Gym");
      // Past the page, straight into the table: what is under test is the READ,
      // and pressing Remove 210 times through the route proves nothing extra.
      const over = CLASS_ARCHIVED_PAGE + 10;
      await sql`
        INSERT INTO gym_class_types (gym_id, name, minutes, places, colour, archived_at)
        SELECT ${org.org.id}, 'Old ' || lpad(n::text, 4, '0'), 60, 20, 'slate',
               now() - (n || ' minutes')::interval
        FROM generate_series(1, ${over}) AS n`;
      await post(classesUrl(org.org.id), aClass({ name: "Live one" }), owner.cookies);

      const seen = timetable(await get(classesUrl(org.org.id), owner.cookies));
      // THE LIVE LIST IS NOT EATEN BY THE ARCHIVE. Before C/H-1's sibling fix
      // one LIMIT covered both and live rows sorted first; the failure mode ran
      // the other way once a gym had enough archived rows.
      expect(seen.entries).toHaveLength(1);
      expect(seen.entries[0]?.type.name).toBe("Live one");
      // THE TOTAL IS THE GYM'S REAL NUMBER, not the length of the page.
      expect(seen.archivedTotal).toBe(over);
      expect(seen.archived).toHaveLength(CLASS_ARCHIVED_PAGE);
      // NEWEST FIRST, because what a gym comes here for is what it just removed.
      expect(seen.archived[0]?.name).toBe("Old 0001");

      // AND EVERY ONE ON THE PAGE CAN ACTUALLY BE BROUGHT BACK — the part of
      // C/H-2 that made it Critical rather than cosmetic.
      const first = seen.archived[0];
      if (first === undefined) throw new Error("no archived class");
      const back = await post(restoreUrl(org.org.id, first.id), {}, owner.cookies);
      expect(back.statusCode).toBe(200);
      expect(timetable(back).entries.some((e) => e.type.id === first.id)).toBe(true);
      expect(timetable(back).archivedTotal).toBe(over - 1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the count is the whole truth only while the repeat ends inside the window",
    async () => {
      const owner = await makeUser("count-owner");
      const org = await makeOrg(owner.cookies, "Count Classes Gym");
      const made = await post(classesUrl(org.org.id), aClass({ name: "Count" }), owner.cookies);
      const type = timetable(made).entries[0]?.type;
      if (type === undefined) throw new Error("create answered no class");

      // Ends inside the eight weeks: every date it will ever run on is written.
      const inside = await post(
        repeatsUrl(org.org.id, type.id),
        { weekdays: [MON], startMinute: at(7), startsOn: dayFromToday(0), endsOn: dayFromToday(20) },
        owner.cookies,
      );
      expect(timetable(inside).entries[0]?.schedules[0]?.datesComplete).toBe(true);

      // **ROUND ONE'S C/H-3**: a year out. The window holds a handful of
      // Mondays and the repeat runs on fifty-two, so the server says the count
      // is NOT the whole truth and the screen prints no number.
      const year = await post(
        repeatsUrl(org.org.id, type.id),
        {
          weekdays: [WED],
          startMinute: at(8),
          startsOn: dayFromToday(0),
          endsOn: dayFromToday(365),
        },
        owner.cookies,
      );
      const long = timetable(year).entries[0]?.schedules.find((x) => x.startMinute === at(8));
      expect(long?.datesComplete).toBe(false);
      expect(long?.sessionsAhead).toBeLessThan(20);
      expect(long?.finished).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the same class cannot repeat twice at the same minute on the same day",
    async () => {
      const owner = await makeUser("clash-owner");
      const org = await makeOrg(owner.cookies, "Clash Classes Gym");
      const made = await post(classesUrl(org.org.id), aClass({ name: "Clash" }), owner.cookies);
      const type = timetable(made).entries[0]?.type;
      if (type === undefined) throw new Error("create answered no class");
      const body = {
        weekdays: [MON, WED],
        startMinute: at(18, 30),
        startsOn: dayFromToday(0),
      };
      expect((await post(repeatsUrl(org.org.id, type.id), body, owner.cookies)).statusCode).toBe(201);

      // Round one, Low-4: two presses of Save put the same class on the calendar
      // twice at the same minute, which 17c would offer as two bookable places.
      const again = await post(repeatsUrl(org.org.id, type.id), body, owner.cookies);
      expect(again.statusCode).toBe(409);
      expect(JSON.parse(again.body)).toMatchObject({ error: "repeat_clashes" });

      // ONE OVERLAPPING WEEKDAY IS ENOUGH, and so is an overlapping window.
      expect(
        (await post(
          repeatsUrl(org.org.id, type.id),
          { ...body, weekdays: [WED], startsOn: dayFromToday(10) },
          owner.cookies,
        )).statusCode,
      ).toBe(409);

      // A DIFFERENT MINUTE, A DIFFERENT DAY, OR A WINDOW THAT DOES NOT TOUCH IT
      // ARE ALL FINE — the rule is a clash, not "one repeat a class".
      for (const ok of [
        { ...body, startMinute: at(19, 30) },
        { ...body, weekdays: [2] },
      ]) {
        expect((await post(repeatsUrl(org.org.id, type.id), ok, owner.cookies)).statusCode).toBe(201);
      }
      const [dates] = await sql<{ doubled: number }[]>`
        SELECT count(*)::int AS doubled FROM (
          SELECT starts_at FROM gym_class_sessions
          WHERE gym_id = ${org.org.id} AND class_type_id = ${type.id}
          GROUP BY starts_at HAVING count(*) > 1) AS d`;
      expect(dates?.doubled).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a coach must be this gym's own staff, and their name is dropped the moment they are not",
    async () => {
      const owner = await makeUser("coach-owner");
      const coach = await makeUser("coach-coach");
      const rival = await makeUser("coach-rival");
      const org = await makeOrg(owner.cookies, "Coach Classes Gym");
      const rivalOrg = await makeOrg(rival.cookies, "Coach Rival Gym");
      await joinAsMember(coach.cookies, org, owner.cookies);
      expect(
        (await post(`/v1/orgs/${org.org.id}/staff`, { email: coach.email, role: "trainer" }, owner.cookies))
          .statusCode,
      ).toBe(201);

      // SOMEBODY ELSE'S STAFF IS REFUSED, and so is a stranger — naming an
      // arbitrary user id as "the coach" would put a person who has nothing to
      // do with this gym on its calendar, and their display name on its screen.
      // `randomUUID()` and NOT `owner.userId.replace(/.$/, "0")` — round one,
      // Low-2. One uuid in sixteen already ends in `0`, so that expression
      // handed back the OWNER's own id, who IS this gym's staff, and the case
      // expected a 400 from a request that correctly answers 201. A test that
      // is right fifteen times out of sixteen is a test nobody can read a red
      // from.
      for (const outsider of [rival.userId, randomUUID()]) {
        const refused = await post(
          classesUrl(org.org.id),
          aClass({ name: "Theirs", coachUserId: outsider }),
          owner.cookies,
        );
        expect(refused.statusCode).toBe(400);
        expect(JSON.parse(refused.body)).toMatchObject({ error: "coach_not_staff" });
      }
      expect((await stateOf(org.org.id)).types).toBe(0);

      // THE POSITIVE CONTROL FOR THAT REFUSAL: the same person, named as the
      // coach of a class in THEIR OWN gym, is accepted. So the rule is "staff of
      // THIS gym" and not "we could not find that user" — which is the
      // difference a 400 on both would hide.
      const theirs = await post(
        classesUrl(rivalOrg.org.id),
        aClass({ name: "Theirs", coachUserId: rival.userId }),
        rival.cookies,
      );
      expect(theirs.statusCode).toBe(201);
      expect(timetable(theirs).entries[0]?.type).toMatchObject({ coachUserId: rival.userId });

      const made = await post(
        classesUrl(org.org.id),
        aClass({ name: "Circuits", coachUserId: coach.userId }),
        owner.cookies,
      );
      expect(made.statusCode).toBe(201);
      const type = timetable(made).entries[0]?.type;
      expect(type).toMatchObject({ coachUserId: coach.userId, coachName: "Cls coach-coach" });
      if (type === undefined) throw new Error("create answered no class");

      // THE NAME GOES WHEN THE PERSON LEAVES THE STAFF. The id stays (it is what
      // the calendar was written with); the NAME is only answered while this gym
      // can still vouch for them.
      expect(
        (await del(`/v1/orgs/${org.org.id}/staff/${coach.userId}`, owner.cookies)).statusCode,
      ).toBe(200);
      const later = timetable(await get(classesUrl(org.org.id), owner.cookies));
      expect(later.entries[0]?.type).toMatchObject({
        coachUserId: coach.userId,
        coachName: null,
      });

      // And the class can be edited back to nobody.
      const cleared = await put(
        typeUrl(org.org.id, type.id),
        aClass({ name: "Circuits", coachUserId: null }),
        owner.cookies,
      );
      expect(cleared.statusCode).toBe(200);
      expect(timetable(cleared).entries[0]?.type).toMatchObject({
        coachUserId: null,
        coachName: null,
      });
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // WHAT IT REFUSES
  // =========================================================================

  it(
    "what the gym types is parsed at the boundary, and a refusal writes nothing",
    async () => {
      const owner = await makeUser("bad-owner");
      const org = await makeOrg(owner.cookies, "Bad Classes Gym");
      const made = await post(classesUrl(org.org.id), aClass({ name: "Yoga" }), owner.cookies);
      const type = timetable(made).entries[0]?.type;
      if (type === undefined) throw new Error("create answered no class");
      const before = await stateOf(org.org.id);

      const badClasses: [string, Record<string, unknown>][] = [
        ["no name", aClass({ name: "" })],
        ["a name of spaces", aClass({ name: "   " })],
        ["a colour we do not paint", aClass({ colour: "#ff0000" })],
        ["four minutes", aClass({ minutes: 4 })],
        ["eleven hours", aClass({ minutes: 601 })],
        ["half a minute", aClass({ minutes: 30.5 })],
        ["nought places", aClass({ places: 0 })],
        ["a field we never named", aClass({ room: "Studio 2" })],
        ["a coach that is not a uuid", aClass({ coachUserId: "coach-bob" })],
      ];
      for (const [what, body] of badClasses) {
        const res = await post(classesUrl(org.org.id), body, owner.cookies);
        expect(res.statusCode, `created a class with ${what}`).toBe(400);
        expect(JSON.parse(res.body)).toMatchObject({ error: "validation_error" });
      }

      const badRepeats: [string, Record<string, unknown>][] = [
        ["no weekdays", { weekdays: [], startMinute: at(7), startsOn: dayFromToday(0) }],
        ["an eighth weekday", { weekdays: [8], startMinute: at(7), startsOn: dayFromToday(0) }],
        ["weekday nought", { weekdays: [0], startMinute: at(7), startsOn: dayFromToday(0) }],
        ["midnight at the end of the day", { weekdays: [MON], startMinute: 1440, startsOn: dayFromToday(0) }],
        ["a minute before midnight", { weekdays: [MON], startMinute: -1, startsOn: dayFromToday(0) }],
        ["a date that is not one", { weekdays: [MON], startMinute: at(7), startsOn: "07/06/2026" }],
        // 31 February matches the wire pattern and is not a day. It is the
        // SERVICE that catches it; Postgres refusing the cast would be a 500.
        ["the 31st of February", { weekdays: [MON], startMinute: at(7), startsOn: "2026-02-31" }],
        [
          "an end before its start",
          { weekdays: [MON], startMinute: at(7), startsOn: dayFromToday(7), endsOn: dayFromToday(1) },
        ],
      ];
      for (const [what, body] of badRepeats) {
        const res = await post(repeatsUrl(org.org.id, type.id), body, owner.cookies);
        expect(res.statusCode, `saved a repeat with ${what}`).toBe(400);
        expect(JSON.parse(res.body)).toMatchObject({ error: "validation_error" });
      }

      // A NON-UUID IN THE PATH IS A 400 AT THE BOUNDARY, never a 500 from
      // Postgres refusing to cast it.
      expect((await put(typeUrl(org.org.id, "not-a-uuid"), aClass(), owner.cookies)).statusCode)
        .toBe(400);
      expect((await del(repeatUrl(org.org.id, "not-a-uuid"), owner.cookies)).statusCode).toBe(400);

      expect(await stateOf(org.org.id)).toEqual(before);

      // A repeat that runs for ONE DAY is allowed and is not a mistake — it is
      // how a gym puts a single workshop on the calendar before 17b-ii's one-off
      // exists.
      const oneDay = await post(
        repeatsUrl(org.org.id, type.id),
        {
          weekdays: [1, 2, 3, 4, 5, 6, 7],
          startMinute: at(7),
          startsOn: dayFromToday(3),
          endsOn: dayFromToday(3),
        },
        owner.cookies,
      );
      expect(oneDay.statusCode).toBe(201);
      expect(timetable(oneDay).entries[0]?.schedules[0]?.sessionsAhead).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a gym with no live plan keeps reading its timetable and cannot change it",
    async () => {
      const owner = await makeUser("lapsed-owner");
      const org = await makeOrg(owner.cookies, "Lapsed Classes Gym");
      const made = await post(classesUrl(org.org.id), aClass({ name: "Yoga" }), owner.cookies);
      const type = timetable(made).entries[0]?.type;
      if (type === undefined) throw new Error("create answered no class");

      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${org.org.id}`;

      // §4.2's read-only console: the READ still answers.
      const read = await get(classesUrl(org.org.id), owner.cookies);
      expect(read.statusCode).toBe(200);
      expect(timetable(read).entries[0]?.type.name).toBe("Yoga");
      // And every write is the gate's own 409, with no vocabulary invented here.
      for (const res of [
        await post(classesUrl(org.org.id), aClass({ name: "New" }), owner.cookies),
        await put(typeUrl(org.org.id, type.id), aClass({ name: "Renamed" }), owner.cookies),
        await del(typeUrl(org.org.id, type.id), owner.cookies),
        await post(
          repeatsUrl(org.org.id, type.id),
          { weekdays: [MON], startMinute: at(7), startsOn: dayFromToday(0) },
          owner.cookies,
        ),
        await post(restoreUrl(org.org.id, type.id), {}, owner.cookies),
      ]) {
        expect(res.statusCode).toBe(409);
        expect(JSON.parse(res.body)).toMatchObject({ error: "gym_not_on_plan" });
      }
      expect(await stateOf(org.org.id)).toMatchObject({ types: 1, repeats: 0 });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the caps are counted and the gym is told what to do about it",
    async () => {
      const owner = await makeUser("cap-owner");
      const org = await makeOrg(owner.cookies, "Cap Classes Gym");

      // Straight into the table: pressing Add sixty times through the route is
      // sixty transactions to prove a number the 61st press is what tests.
      await sql`
        INSERT INTO gym_class_types (gym_id, name, minutes, places, colour)
        SELECT ${org.org.id}, 'Filler ' || n, 60, 20, 'slate'
        FROM generate_series(1, ${CLASS_TYPES_MAX}) AS n`;

      const refused = await post(classesUrl(org.org.id), aClass({ name: "One More" }), owner.cookies);
      expect(refused.statusCode).toBe(409);
      const refusal = JSON.parse(refused.body) as { error: string; message: string };
      expect(refusal.error).toBe("too_many_classes");
      // The sentence NAMES the number, so a gym is told what the limit is rather
      // than only that it hit one.
      expect(refusal.message).toContain(String(CLASS_TYPES_MAX));
      expect((await stateOf(org.org.id)).types).toBe(CLASS_TYPES_MAX);

      // ARCHIVING ONE MAKES ROOM — which is what the message tells them to do,
      // so the message is checked against the behaviour and not only its words.
      const [oldest] = await sql<{ id: string }[]>`
        SELECT id FROM gym_class_types WHERE gym_id = ${org.org.id} LIMIT 1`;
      if (oldest === undefined) throw new Error("no filler class");
      expect((await del(typeUrl(org.org.id, oldest.id), owner.cookies)).statusCode).toBe(200);
      expect((await post(classesUrl(org.org.id), aClass({ name: "One More" }), owner.cookies)).statusCode)
        .toBe(201);

      // AND THE REPEAT CAP, on one class.
      const [mine] = await sql<{ id: string }[]>`
        SELECT id FROM gym_class_types WHERE gym_id = ${org.org.id} AND name = 'One More'`;
      if (mine === undefined) throw new Error("no class");
      await sql`
        INSERT INTO gym_class_schedules
          (gym_id, class_type_id, weekdays, local_start_minute, starts_on)
        SELECT ${org.org.id}, ${mine.id}, ARRAY[1]::int[], n, current_date
        FROM generate_series(1, ${CLASS_SCHEDULES_PER_TYPE_MAX}) AS n`;
      const tooMany = await post(
        repeatsUrl(org.org.id, mine.id),
        { weekdays: [MON], startMinute: at(7), startsOn: dayFromToday(0) },
        owner.cookies,
      );
      expect(tooMany.statusCode).toBe(409);
      expect(JSON.parse(tooMany.body)).toMatchObject({ error: "too_many_classes" });

      // **BRINGING ONE BACK COUNTS AGAINST THE CAP**, because a restored class
      // is a live class — otherwise the archive would be a way round the limit.
      expect((await post(restoreUrl(org.org.id, oldest.id), {}, owner.cookies)).statusCode)
        .toBe(409);
      // Archive one and there is room for it again.
      expect((await del(typeUrl(org.org.id, mine.id), owner.cookies)).statusCode).toBe(200);
      expect((await post(restoreUrl(org.org.id, oldest.id), {}, owner.cookies)).statusCode)
        .toBe(200);
    },
    TEST_TIMEOUT_MS,
  );
});
