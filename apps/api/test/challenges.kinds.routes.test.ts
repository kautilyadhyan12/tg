// EVERY KIND OF CHALLENGE READS THE SAME NUMBERS (ROADMAP 19d-iii-a-i; spec Part 3
// §15.10.7). DATABASE_URL-gated.
//
// The worst thing 19d-iii-a-i could do to a real person: a challenge made before it counts
// something else after it, so somebody wins or loses a prize they did not earn. This file
// was written and run green BEFORE the change, on the code that stored `counts`: every
// number, place and board below is what that code gave. After the change only how a
// challenge is asked for is different (`kind`); what it reads must not be.
//
// Each person has a different number of gym days, workout days and typed numbers, so a
// challenge that counted the wrong thing would give different numbers and places.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { GymChallengesResponse, MemberGymChallenge, StaffGymChallenge, StaffGymChallengeBoardResponse, StaffGymChallengesResponse } from "@app/shared";
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
  JWT_SECRET: "gym-challenge-kinds-test-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 120_000;
const LIVE_PLAN = "zz_chalk_live";
/** Wednesday 7 October 2026, noon in Kolkata: its week is Mon 5 to Sun 11 October. */
const WEDNESDAY = new Date("2026-10-07T06:30:00Z");

let ipCounter = 0;
const nextIp = () => `10.83.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

/** The three kinds a gym could make before 19d-iii-a-i, as a challenge is now asked for:
 *  as `0118` moves the ones already made. */
type Kind = "gym_days" | "workout_days" | "own";
const KINDS: Record<Kind, Record<string, unknown>> = {
  gym_days: { subject: "gym_visits", measure: "days", countedBy: "app" },
  workout_days: { subject: "workouts", measure: "days", countedBy: "app" },
  own: { subject: "own", measure: null, countedBy: "staff" },
};
const kind = (k: Kind): Record<string, unknown> => KINDS[k];

/** What the code that stored `counts` gave, read on 2026-10-15 before the change. */
const APP_COUNTS = {
  gymMost: {
    member: {
      me: {
        value: 2,
        place: 2,
        reached: false,
        toNext: 1,
        days: 2,
      },
      board: {
        status: "shown",
        ranked: 4,
        leaders: 1,
        reached: null,
        top: [
          ["Asha R.", 1, 3, false],
          ["Bilal K.", 2, 2, false],
          ["Vera V.", 2, 2, false],
        ],
      },
      teams: null,
    },
    staff: {
      top: [
        ["Asha Rao", 1, 3],
        ["Bilal Khan", 2, 2],
        ["Vera Viewer", 2, 2],
      ],
      withNumber: 4,
      teams: [],
      board: {
        memberStatus: "shown",
        ranked: 4,
        total: 4,
        reached: null,
        rows: [
          ["Asha Rao", 1, 3, false],
          ["Bilal Khan", 2, 2, false],
          ["Vera Viewer", 2, 2, false],
          ["Chen Wu", 4, 1, false],
        ],
        teams: [],
      },
    },
  },
  gymTarget: {
    member: {
      me: {
        value: 2,
        place: 2,
        reached: true,
        toNext: 1,
        days: 2,
      },
      board: {
        status: "shown",
        ranked: 4,
        leaders: 1,
        reached: 3,
        top: [
          ["Asha R.", 1, 3, true],
          ["Bilal K.", 2, 2, true],
          ["Vera V.", 2, 2, true],
        ],
      },
      teams: null,
    },
    staff: {
      top: [
        ["Asha Rao", 1, 3],
        ["Bilal Khan", 2, 2],
        ["Vera Viewer", 2, 2],
      ],
      withNumber: 4,
      teams: [],
      board: {
        memberStatus: "shown",
        ranked: 4,
        total: 4,
        reached: 3,
        rows: [
          ["Asha Rao", 1, 3, true],
          ["Bilal Khan", 2, 2, true],
          ["Vera Viewer", 2, 2, true],
          ["Chen Wu", 4, 1, false],
        ],
        teams: [],
      },
    },
  },
  workMost: {
    member: {
      me: {
        value: 0,
        place: null,
        reached: false,
        toNext: null,
        days: 0,
      },
      board: {
        status: "shown",
        ranked: 3,
        leaders: 1,
        reached: null,
        top: [
          ["Bilal K.", 1, 3, false],
          ["Chen W.", 2, 2, false],
          ["Asha R.", 3, 1, false],
        ],
      },
      teams: null,
    },
    staff: {
      top: [
        ["Bilal Khan", 1, 3],
        ["Chen Wu", 2, 2],
        ["Asha Rao", 3, 1],
      ],
      withNumber: 3,
      teams: [],
      board: {
        memberStatus: "shown",
        ranked: 3,
        total: 3,
        reached: null,
        rows: [
          ["Bilal Khan", 1, 3, false],
          ["Chen Wu", 2, 2, false],
          ["Asha Rao", 3, 1, false],
        ],
        teams: [],
      },
    },
  },
  workJoined: {
    member: {
      me: {
        value: 0,
        place: null,
        reached: false,
        toNext: null,
        days: 0,
      },
      board: {
        status: "shown",
        ranked: 3,
        leaders: 1,
        reached: 2,
        top: [
          ["Bilal K.", 1, 3, true],
          ["Chen W.", 2, 2, true],
          ["Asha R.", 3, 1, false],
        ],
      },
      teams: null,
    },
    staff: {
      top: [
        ["Bilal Khan", 1, 3],
        ["Chen Wu", 2, 2],
        ["Asha Rao", 3, 1],
      ],
      withNumber: 3,
      teams: [],
      board: {
        memberStatus: "shown",
        ranked: 3,
        total: 4,
        reached: 2,
        rows: [
          ["Bilal Khan", 1, 3, true],
          ["Chen Wu", 2, 2, true],
          ["Asha Rao", 3, 1, false],
          ["Vera Viewer", null, 0, false],
        ],
        teams: [],
      },
    },
  },
  gymTeams: {
    member: {
      me: {
        value: 2,
        place: 2,
        reached: false,
        toNext: 1,
        days: 2,
      },
      board: {
        status: "shown",
        ranked: 4,
        leaders: 1,
        reached: null,
        top: [
          ["Asha R.", 1, 3, false],
          ["Bilal K.", 2, 2, false],
          ["Vera V.", 2, 2, false],
        ],
      },
      teams: [
        ["Reds", 4, 1, 2, 0, false],
        ["Blues", 4, 1, 2, 0, false],
      ],
    },
    staff: {
      top: [
        ["Asha Rao", 1, 3],
        ["Bilal Khan", 2, 2],
        ["Vera Viewer", 2, 2],
      ],
      withNumber: 4,
      teams: [
        ["Reds", 2, 4, 1],
        ["Blues", 2, 4, 1],
      ],
      board: {
        memberStatus: "shown",
        ranked: 4,
        total: 4,
        reached: null,
        rows: [
          ["Asha Rao", 1, 3, false],
          ["Bilal Khan", 2, 2, false],
          ["Vera Viewer", 2, 2, false],
          ["Chen Wu", 4, 1, false],
        ],
        teams: [
          [4, 1],
          [4, 1],
        ],
      },
    },
  },
  gymEnded: {
    member: {
      me: {
        value: 1,
        place: 2,
        reached: false,
        toNext: 1,
        days: 1,
      },
      board: {
        status: "shown",
        ranked: 3,
        leaders: 1,
        reached: null,
        top: [
          ["Chen W.", 1, 2, false],
          ["Asha R.", 2, 1, false],
          ["Vera V.", 2, 1, false],
        ],
      },
      teams: null,
    },
    staff: {
      top: [],
      withNumber: null,
      teams: [],
      board: {
        memberStatus: "shown",
        ranked: 3,
        total: 3,
        reached: null,
        rows: [
          ["Chen Wu", 1, 2, false],
          ["Asha Rao", 2, 1, false],
          ["Vera Viewer", 2, 1, false],
        ],
        teams: [],
      },
    },
  },
};
const OWN_COUNTS = {
  most: {
    member: {
      me: {
        value: 45,
        place: 2,
        reached: false,
        toNext: 10,
        days: 0,
      },
      board: {
        status: "shown",
        ranked: 4,
        leaders: 1,
        reached: null,
        top: [
          ["Bilal K.", 1, 55, false],
          ["Vera V.", 2, 45, false],
          ["Asha R.", 3, 40, false],
        ],
      },
      teams: null,
    },
    staff: {
      top: [
        ["Bilal Khan", 1, 55],
        ["Vera Viewer", 2, 45],
        ["Asha Rao", 3, 40],
      ],
      withNumber: 4,
      teams: [],
      board: {
        memberStatus: "shown",
        ranked: 4,
        total: 4,
        reached: null,
        rows: [
          ["Bilal Khan", 1, 55, false],
          ["Vera Viewer", 2, 45, false],
          ["Asha Rao", 3, 40, false],
          ["Chen Wu", 4, 30, false],
        ],
        teams: [],
      },
    },
  },
  target: {
    member: {
      me: {
        value: 49,
        place: 3,
        reached: false,
        toNext: 1,
        days: 0,
      },
      board: {
        status: "shown",
        ranked: 4,
        leaders: 1,
        reached: 2,
        top: [
          ["Chen W.", 1, 62, true],
          ["Asha R.", 2, 50, true],
          ["Vera V.", 3, 49, false],
        ],
      },
      teams: null,
    },
    staff: {
      top: [
        ["Chen Wu", 1, 62],
        ["Asha Rao", 2, 50],
        ["Vera Viewer", 3, 49],
      ],
      withNumber: 4,
      teams: [],
      board: {
        memberStatus: "shown",
        ranked: 4,
        total: 4,
        reached: 2,
        rows: [
          ["Chen Wu", 1, 62, true],
          ["Asha Rao", 2, 50, true],
          ["Vera Viewer", 3, 49, false],
          ["Bilal Khan", 4, 1, false],
        ],
        teams: [],
      },
    },
  },
  lowest: {
    member: {
      me: {
        value: 1450,
        place: 2,
        reached: false,
        toNext: 130,
        days: 0,
      },
      board: {
        status: "shown",
        ranked: 4,
        leaders: 1,
        reached: null,
        top: [
          ["Bilal K.", 1, 1320, false],
          ["Vera V.", 2, 1450, false],
          ["Asha R.", 3, 1500, false],
        ],
      },
      teams: null,
    },
    staff: {
      top: [
        ["Bilal Khan", 1, 1320],
        ["Vera Viewer", 2, 1450],
        ["Asha Rao", 3, 1500],
      ],
      withNumber: 4,
      teams: [],
      board: {
        memberStatus: "shown",
        ranked: 4,
        total: 4,
        reached: null,
        rows: [
          ["Bilal Khan", 1, 1320, false],
          ["Vera Viewer", 2, 1450, false],
          ["Asha Rao", 3, 1500, false],
          ["Chen Wu", 4, 1800, false],
        ],
        teams: [],
      },
    },
  },
  teams: {
    member: {
      me: {
        value: 500,
        place: 4,
        reached: false,
        toNext: 100,
        days: 0,
      },
      board: {
        status: "shown",
        ranked: 4,
        leaders: 1,
        reached: null,
        top: [
          ["Bilal K.", 1, 350, false],
          ["Chen W.", 2, 380, false],
          ["Asha R.", 3, 400, false],
        ],
      },
      teams: [
        ["Reds", 780, 1, 2, 0, false],
        ["Blues", 850, 2, 2, 0, false],
      ],
    },
    staff: {
      top: [
        ["Bilal Khan", 1, 350],
        ["Chen Wu", 2, 380],
        ["Asha Rao", 3, 400],
      ],
      withNumber: 4,
      teams: [
        ["Reds", 2, 780, 1],
        ["Blues", 2, 850, 2],
      ],
      board: {
        memberStatus: "shown",
        ranked: 4,
        total: 4,
        reached: null,
        rows: [
          ["Bilal Khan", 1, 350, false],
          ["Chen Wu", 2, 380, false],
          ["Asha Rao", 3, 400, false],
          ["Vera Viewer", 4, 500, false],
        ],
        teams: [
          [780, 1],
          [850, 2],
        ],
      },
    },
  },
};

d("every kind of challenge reads the same numbers (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let clock = WEDNESDAY;
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'chalk-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'chalk-t-%@example.com'`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_posts WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_challenges WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_attendance WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_checkin_devices WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM workouts WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM refresh_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM consent_log WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM users WHERE email LIKE 'chalk-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST" | "PUT", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });

  interface Person {
    userId: string;
    cookies: Cookies;
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `chalk-t-${uniq()}@example.com`;
    const reg = await inject("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await inject("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  const account = async (displayName: string): Promise<{ userId: string }> => {
    const rows = await sql<{ id: string }[]>`INSERT INTO users (email, display_name) VALUES (${`chalk-t-p-${uniq()}@example.com`}, ${displayName}) RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no user");
    return { userId: id };
  };

  interface Gym {
    id: string;
    owner: Person;
    deviceId: string;
  }
  const makeGym = async (name: string): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Jorhat", country: "IN", timezone: "Asia/Kolkata" });
    expect(res.statusCode).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    const dev = await sql<{ id: string }[]>`INSERT INTO gym_checkin_devices (gym_id, name) VALUES (${id}, 'Front desk') RETURNING id`;
    return { id, owner, deviceId: dev[0]?.id ?? "" };
  };
  const inGym = async (gymId: string, userId: string): Promise<void> => {
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${gymId}, ${userId}, '2026-01-01T00:00:00Z')`;
  };
  /** A finished app workout at 07:30 on a day of Kolkata's calendar, saved half an hour later. */
  const workouts = async (userId: string, days: readonly string[]): Promise<void> => {
    for (const day of days) {
      await sql`
        INSERT INTO workouts (id, user_id, started_at, platform, engine_version, sets_count, total_reps, created_at)
        VALUES (gen_random_uuid(), ${userId}, ${`${day}T02:00:00Z`}, 'web', 'test', 1, 10, ${`${day}T02:30:00Z`})`;
    }
  };
  /** A front-desk scan at noon on each day of the gym's calendar. */
  const visits = async (gym: Gym, userId: string, days: readonly string[]): Promise<void> => {
    for (const day of days) {
      await sql`
        INSERT INTO gym_attendance
          (gym_id, user_id, device_id, day, marked_at, method, hours_status, session_opens_minute, session_closes_minute, slot_key)
        VALUES (${gym.id}, ${userId}, ${gym.deviceId}, ${day}::date, (${day}::date + time '12:00') AT TIME ZONE 'Asia/Kolkata', 'pass',
                'in_session', 360, 420, '360-420')`;
    }
  };

  const base = (gymId: string) => `/v1/orgs/${gymId}/challenges`;
  const add = async (gym: Gym, k: Kind, over: Record<string, unknown>): Promise<StaffGymChallenge> => {
    const res = await inject("POST", base(gym.id), gym.owner.cookies, {
      challengeKey: randomUUID(),
      details: "",
      prize: "",
      startsOn: "2026-10-05",
      endsOn: "2026-10-11",
      target: null,
      who: "everyone",
      ...kind(k),
      ...over,
    });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { challenge: StaffGymChallenge }).challenge;
  };
  const scores = async (gym: Gym, id: string, values: readonly [Person | { userId: string }, number][]) => {
    const res = await inject("PUT", `${base(gym.id)}/${id}/scores`, gym.owner.cookies, { scores: values.map(([p, value]) => ({ userId: p.userId, value })) });
    expect(res.statusCode, res.body).toBe(200);
  };
  const teamUp = async (gym: Gym, challenge: StaffGymChallenge, teams: readonly (readonly { userId: string }[])[]) => {
    const people = teams.flatMap((team, at) => team.map((p) => ({ userId: p.userId, teamId: challenge.teamList[at]?.id ?? "" })));
    const res = await inject("PUT", `${base(gym.id)}/${challenge.id}/team-people`, gym.owner.cookies, { people });
    expect(res.statusCode, res.body).toBe(200);
  };
  const join = async (gym: Gym, who: Person, id: string) => {
    expect((await inject("PUT", `${base(gym.id)}/${id}/joined`, who.cookies)).statusCode).toBe(200);
  };
  const putIn = async (gymId: string, id: string, userIds: readonly string[]) => {
    for (const userId of userIds) await sql`INSERT INTO gym_challenge_people (gym_id, challenge_id, user_id) VALUES (${gymId}, ${id}, ${userId})`;
  };
  const memberList = async (gym: Gym, who: Person): Promise<GymChallengesResponse> => {
    const res = await inject("GET", base(gym.id), who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as GymChallengesResponse;
  };
  const staffList = async (gym: Gym): Promise<StaffGymChallengesResponse> => {
    const res = await inject("GET", `${base(gym.id)}/staff`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as StaffGymChallengesResponse;
  };
  const staffBoard = async (gym: Gym, id: string): Promise<StaffGymChallengeBoardResponse> => {
    const res = await inject("GET", `${base(gym.id)}/${id}/board/staff`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as StaffGymChallengeBoardResponse;
  };

  /** What one member reads of a challenge: their own line, the board, and the teams. */
  const asMember = (c: MemberGymChallenge | undefined) => {
    if (c === undefined) throw new Error("the challenge is not on the member's list");
    return {
      me: c.me === null ? null : { value: c.me.value, place: c.me.place, reached: c.me.reached, toNext: c.me.toNextPlace, days: c.me.days.length },
      board: { status: c.board.status, ranked: c.board.ranked, leaders: c.board.leaders, reached: c.board.reached, top: c.board.top.map((r) => [r.name, r.place, r.value, r.reached]) },
      teams: c.teamBoard === null ? null : c.teamBoard.rows.map((r) => [r.name, r.value, r.place, r.people, r.waiting, r.reached]),
    };
  };
  /** What staff read: the card's first three and count, and the whole board. */
  const asStaff = async (gym: Gym, c: StaffGymChallenge | undefined) => {
    if (c === undefined) throw new Error("the challenge is not on the staff list");
    const board = await staffBoard(gym, c.id);
    return {
      top: c.top.map((r) => [r.name, r.place, r.value]),
      withNumber: c.withNumber,
      teams: c.teamList.map((t) => [t.name, t.people, t.value, t.place]),
      board: {
        memberStatus: board.memberStatus,
        ranked: board.ranked,
        total: board.total,
        reached: board.reached,
        rows: board.rows.map((r) => [r.name, r.place, r.value, r.reached]),
        teams: board.teams.map((t) => [t.value, t.place]),
      },
    };
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), { redis, orgs: { now: () => clock } });
    await api().ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it(
    "the app's counts: gym days and workout days, most and a target, everyone and who joined, alone and in teams, and one that has ended",
    async () => {
      const gym = await makeGym("Kinds Hall");
      const vera = await signedIn("Vera Viewer");
      const asha = await account("Asha Rao");
      const bilal = await account("Bilal Khan");
      const chen = await account("Chen Wu");
      for (const p of [vera, asha, bilal, chen]) await inGym(gym.id, p.userId);

      // This week: gym days Asha 3 · Bilal 2 · Vera 2 · Chen 1; workout days Bilal 3 · Chen 2 · Asha 1 · Vera 0.
      await visits(gym, asha.userId, ["2026-10-05", "2026-10-06", "2026-10-07"]);
      await visits(gym, bilal.userId, ["2026-10-05", "2026-10-06"]);
      await visits(gym, vera.userId, ["2026-10-06", "2026-10-07"]);
      await visits(gym, chen.userId, ["2026-10-07"]);
      await workouts(bilal.userId, ["2026-10-05", "2026-10-06", "2026-10-07"]);
      await workouts(chen.userId, ["2026-10-05", "2026-10-06"]);
      await workouts(asha.userId, ["2026-10-07"]);
      // Last week, for the one that has ended: gym days Chen 2 · Vera 1 · Asha 1; workout days Vera 3.
      await visits(gym, chen.userId, ["2026-09-29", "2026-09-30"]);
      await visits(gym, vera.userId, ["2026-10-01"]);
      await visits(gym, asha.userId, ["2026-10-02"]);
      await workouts(vera.userId, ["2026-09-29", "2026-09-30", "2026-10-01"]);

      const gymMost = await add(gym, "gym_days", { name: "Most gym days" });
      const gymTarget = await add(gym, "gym_days", { name: "Two gym days", target: 2 });
      const workMost = await add(gym, "workout_days", { name: "Most workout days" });
      const workJoined = await add(gym, "workout_days", { name: "Two workout days, joiners", target: 2, who: "joined" });
      const gymTeams = await add(gym, "gym_days", { name: "Gym days in teams", teams: "staff", teamList: [{ id: null, name: "Reds" }, { id: null, name: "Blues" }] });
      // Made while it ran, as a challenge is: one whose last day has passed cannot be made.
      clock = new Date("2026-10-01T06:30:00Z");
      const gymEnded = await add(gym, "gym_days", { name: "Last week", startsOn: "2026-09-28", endsOn: "2026-10-04" });
      clock = WEDNESDAY;
      await join(gym, vera, workJoined.id);
      await putIn(gym.id, workJoined.id, [asha.userId, bilal.userId, chen.userId]);
      await teamUp(gym, gymTeams, [[asha, chen], [bilal, vera]]);

      const mine = await memberList(gym, vera);
      const of = (c: StaffGymChallenge) => asMember(mine.challenges.find((x) => x.id === c.id));
      const staff = await staffList(gym);
      const card = (c: StaffGymChallenge) => asStaff(gym, [...staff.current, ...staff.past].find((x) => x.id === c.id));
      const read: Record<string, unknown> = {};
      for (const [name, c] of Object.entries({ gymMost, gymTarget, workMost, workJoined, gymTeams, gymEnded })) read[name] = { member: of(c), staff: await card(c) };
      expect(read).toEqual(APP_COUNTS);
      // Each is sent as what it is about, who counts it, and the words that say so.
      const about = (c: MemberGymChallenge) => [c.name, c.subject, c.measure, c.countedBy, c.words.about, c.words.howLine, c.words.one, c.words.many, c.words.perDay];
      const GYM_DAYS = ["Visits", "Checked in at the front desk", "visit", "visits", true];
      const WORKOUT_DAYS = ["Workouts in the app", "Counted by the app", "workout day", "workout days", true];
      expect(mine.challenges.map(about).sort()).toEqual([
        ["Gym days in teams", "gym_visits", "days", "app", ...GYM_DAYS],
        ["Last week", "gym_visits", "days", "app", ...GYM_DAYS],
        ["Most gym days", "gym_visits", "days", "app", ...GYM_DAYS],
        ["Most workout days", "workouts", "days", "app", ...WORKOUT_DAYS],
        ["Two gym days", "gym_visits", "days", "app", ...GYM_DAYS],
        ["Two workout days, joiners", "workouts", "days", "app", ...WORKOUT_DAYS],
      ]);
      const explained = new Map(mine.challenges.map((c) => [c.name, c.words.explain]));
      expect(explained.get("Most gym days")).toBe(
        "A visit is a day you're checked in at Kinds Hall: a scan at the front desk, or a check-in by staff. Two check-ins on one day are one visit. It is the same count as the Leaderboard.",
      );
      expect(explained.get("Most workout days")).toBe("A workout day is a day you finish a workout in the app, at the gym or at home. Two on one day are one. It is the same count as the Leaderboard.");
    },
    T,
  );

  it(
    "the gym's own count: most, a target and the lowest, alone and in teams",
    async () => {
      const gym = await makeGym("Own Count Hall");
      const vera = await signedIn("Vera Viewer");
      const asha = await account("Asha Rao");
      const bilal = await account("Bilal Khan");
      const chen = await account("Chen Wu");
      for (const p of [vera, asha, bilal, chen]) await inGym(gym.id, p.userId);
      // Gym days and workouts of their own, which a count of the gym's own never reads.
      await visits(gym, chen.userId, ["2026-10-05", "2026-10-06", "2026-10-07"]);
      await workouts(chen.userId, ["2026-10-05", "2026-10-06", "2026-10-07"]);

      const most = await add(gym, "own", { name: "Push-up week", unit: "push-ups" });
      const target = await add(gym, "own", { name: "Fifty boxes", unit: "boxes", target: 50 });
      const lowest = await add(gym, "own", { name: "5 km race", unit: "seconds", lowestWins: true, who: "joined" });
      const teams = await add(gym, "own", { name: "Rowing teams", unit: "metres", teams: "staff", lowestWins: true, teamList: [{ id: null, name: "Reds" }, { id: null, name: "Blues" }] });
      await scores(gym, most.id, [[asha, 40], [bilal, 55], [chen, 30], [vera, 45]]);
      await scores(gym, target.id, [[asha, 50], [bilal, 1], [chen, 62], [vera, 49]]);
      await putIn(gym.id, lowest.id, [vera.userId, asha.userId, bilal.userId, chen.userId]);
      await scores(gym, lowest.id, [[asha, 1500], [bilal, 1320], [chen, 1800], [vera, 1450]]);
      await teamUp(gym, teams, [[asha, chen], [bilal, vera]]);
      await scores(gym, teams.id, [[asha, 400], [bilal, 350], [chen, 380], [vera, 500]]);

      const mine = await memberList(gym, vera);
      const of = (c: StaffGymChallenge) => asMember(mine.challenges.find((x) => x.id === c.id));
      const staff = await staffList(gym);
      const card = (c: StaffGymChallenge) => asStaff(gym, staff.current.find((x) => x.id === c.id));
      const read: Record<string, unknown> = {};
      for (const [name, c] of Object.entries({ most, target, lowest, teams })) read[name] = { member: of(c), staff: await card(c) };
      expect(read).toEqual(OWN_COUNTS);
      const about = (c: MemberGymChallenge) => [c.name, c.subject, c.measure, c.countedBy, c.words.about, c.words.howLine, c.words.one, c.words.many, c.words.perDay];
      const STAFF = "Counted by the staff at Own Count Hall";
      expect(mine.challenges.map(about).sort()).toEqual([
        ["5 km race", "own", null, "staff", "Seconds", STAFF, "second", "seconds", false],
        ["Fifty boxes", "own", null, "staff", "Boxes", STAFF, "box", "boxes", false],
        ["Push-up week", "own", null, "staff", "Push-ups", STAFF, "push-up", "push-ups", false],
        ["Rowing teams", "own", null, "staff", "Metres", STAFF, "metre", "metres", false],
      ]);
      expect(mine.challenges.find((c) => c.name === "Push-up week")?.words.explain).toBe(
        "The staff at Own Count Hall count the push-ups and add each person's number. If yours is missing or wrong, ask at the front desk.",
      );
      // The replies staff are sent when they add a challenge carry the gym's own name too.
      expect([most.words.howLine, lowest.words.howLine]).toEqual([STAFF, STAFF]);
    },
    T,
  );
});
