// MEMBERS POST, REPORT, AND THE STAFF LIST — the routes against real Postgres
// (DATABASE_URL-gated) and the real disk store in a folder of the test's own. Spec Part 3
// §15.2, §15.3; ROADMAP 19b-ii-a.
//
// The worst thing this job could do to a real person: a cruel post, or a photo of
// somebody, left in front of their whole gym after it was reported. That is the first
// test below.
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type TransactionSql } from "postgres";
import {
  GYM_MEMBER_POSTS_A_DAY,
  GYM_POST_REPORTS_SHOWN,
  GYM_POST_REPORT_NOTES_SHOWN,
  GYM_POST_STOPS_SHOWN,
  type GymPost,
  type GymPostsResponse,
  type ReportedGymPostsResponse,
  type StaffGymPostsResponse,
  type StoppedGymPostersResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDiskPhotoStore, type PhotoStore } from "../src/modules/orgs/gymPage/photoStore.js";
import { removeLeftovers, removeListed } from "../src/modules/orgs/posts/photoFiles.js";
import { createIoRedis, createMemoryRedis, type RedisLike } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "member-posts-routes-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 120_000;
const LIVE_PLAN = "zz_postsm_live";
const NOON = new Date("2026-10-07T06:30:00Z");
const HOUR = 60 * 60 * 1000;

const IPHONE = readFileSync(new URL("./fixtures/photos/iphone16.jpg", import.meta.url)).toString("base64");

let ipCounter = 0;
const nextIp = () => `10.72.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
/** An address of this run's own for a limit test: a real Redis keeps its counters for the
 *  hour, across runs. */
const desk = (): string => {
  const hex = randomUUID().replaceAll("-", "");
  return `10.${String(100 + (parseInt(hex.slice(0, 2), 16) % 100))}.${String(parseInt(hex.slice(2, 4), 16))}.${String((parseInt(hex.slice(4, 6), 16) % 254) + 1)}`;
};
const redisUrl = process.env["TEST_REDIS_URL"];
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("members post, Report and the staff list (real Postgres, real disk)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let folder = "";
  let clock = NOON.getTime();
  let app: App | undefined;
  /** A second api on the same database, folder and Redis: two requests race only across two. */
  let second: App | undefined;
  let redis: RedisLike | undefined;
  /** The folder's own store, and whether the one the apps are given refuses to remove a file. */
  let disk: PhotoStore | undefined;
  let storeDown = false;
  const store = (): PhotoStore => {
    if (disk === undefined) throw new Error("beforeAll did not make the store");
    return disk;
  };
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const either = (n: number): App => (n % 2 === 0 ? api() : (second ?? api()));

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'postsm-t-%@example.com')`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM photo_files_to_remove WHERE split_part(storage_key, '/', 2) IN (SELECT id::text FROM (${mine}) g)`;
    await sql`DELETE FROM gym_posts WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_post_stops WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'postsm-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, cookies: Cookies, payload?: unknown, ip = nextIp(), target = api()) =>
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
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `postsm-t-${uniq()}@example.com`;
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
  }
  /** A gym on a live plan; `open`: its members may post. */
  const makeGym = async (name: string, open = true): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Leeds", country: "GB", timezone: "Europe/London" });
    expect(res.statusCode).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    const gym = { id, owner };
    if (open) expect((await setSwitch(gym, owner, true)).statusCode).toBe(200);
    return gym;
  };
  const lapse = async (gymId: string) => {
    await sql`UPDATE subscriptions SET status = 'canceled' WHERE owner_type = 'gym' AND owner_id = ${gymId}`;
  };
  const addStaff = async (gymId: string, userId: string, role: "manager" | "trainer", privileges: string[] | null) => {
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gymId}, ${userId}, ${role}, ${privileges})`;
  };
  const member = async (gym: Gym, name: string): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${gym.id}, ${person.userId}, '2026-01-01T00:00:00Z')`;
    return person;
  };
  const leave = async (gym: Gym, who: Person) => {
    await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym.id} AND user_id = ${who.userId}`;
  };

  const posts = (gymId: string) => `/v1/orgs/${gymId}/posts`;
  const setSwitch = (gym: Gym, who: Person, membersCanPost: boolean) => inject("PUT", `${posts(gym.id)}/settings`, who.cookies, { membersCanPost });
  const send = (gym: Gym, who: Person, body: string, photos: string[] = [], postKey = randomUUID(), ip = nextIp(), target = api()) => {
    clock += 1000;
    return inject("POST", `${posts(gym.id)}/mine`, who.cookies, { postKey, body, photos }, ip, target);
  };
  const add = async (gym: Gym, who: Person, body: string, photos: string[] = []): Promise<GymPost> => {
    const res = await send(gym, who, body, photos);
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { post: GymPost }).post;
  };
  const feed = async (gym: Gym, who: Person): Promise<GymPostsResponse> => {
    const res = await inject("GET", posts(gym.id), who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as GymPostsResponse;
  };
  const staffFeed = async (gym: Gym, who: Person): Promise<StaffGymPostsResponse> => {
    const res = await inject("GET", `${posts(gym.id)}/staff`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as StaffGymPostsResponse;
  };
  const report = (gym: Gym, who: Person, postId: string, reason: string, target = api(), note?: string) =>
    inject("POST", `${posts(gym.id)}/${postId}/report`, who.cookies, note === undefined ? { reason } : { reason, note }, nextIp(), target);
  const reported = async (gym: Gym, who: Person): Promise<ReportedGymPostsResponse> => {
    const res = await inject("GET", `${posts(gym.id)}/reported`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as ReportedGymPostsResponse;
  };
  /** Which reports staff were shown: how many, and the one value for exactly those. */
  interface Shown {
    allReports: number;
    reportsMark: string;
  }
  /** Keep, saying which reports staff were shown (every one the post has now, unless the
   *  test says what they saw). */
  const keep = async (gym: Gym, who: Person, postId: string, shown?: Shown) => {
    const had = await sql<{ n: number; mark: string }[]>`
      SELECT count(*)::int AS n, md5(coalesce(string_agg(id::text, ',' ORDER BY id), '')) AS mark FROM gym_post_reports WHERE post_id = ${postId}`;
    const now = { allReports: Math.max(1, had[0]?.n ?? 0), reportsMark: had[0]?.mark ?? "" };
    const sent = shown ?? now;
    return await inject("POST", `${posts(gym.id)}/${postId}/keep`, who.cookies, { allReports: sent.allReports, reportsMark: sent.reportsMark });
  };
  /** The photo files of this gym still written down to remove. */
  const listedOf = async (gymId: string): Promise<string[]> =>
    (await sql<{ storage_key: string }[]>`SELECT storage_key FROM photo_files_to_remove WHERE storage_key LIKE ${`gym-post/${gymId}/%`}`).map((r) => r.storage_key);
  /** Holds what `take` locks, in a step of its own, until the function it returns is
   *  called; `last` runs in that step before it ends. */
  const hold = async (take: (tx: TransactionSql) => Promise<unknown>): Promise<(last?: (tx: TransactionSql) => Promise<unknown>) => Promise<void>> => {
    let got: () => void = () => undefined;
    let go: (last: ((tx: TransactionSql) => Promise<unknown>) | undefined) => void = () => undefined;
    const taken = new Promise<void>((resolve) => {
      got = resolve;
    });
    const freed = new Promise<((tx: TransactionSql) => Promise<unknown>) | undefined>((resolve) => {
      go = resolve;
    });
    const done = sql.begin(async (tx) => {
      await take(tx);
      got();
      const last = await freed;
      if (last !== undefined) await last(tx);
    });
    await taken;
    return async (last) => {
      go(last);
      await done;
    };
  };
  /** Waits until `n` statements like this one are waiting for a lock. */
  const waitingFor = async (like: string, n: number): Promise<void> => {
    for (let tries = 0; tries < 400; tries++) {
      const rows = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE ${like}`;
      if ((rows[0]?.n ?? 0) >= n) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`never saw ${String(n)} waiting: ${like}`);
  };
  const stop = (gym: Gym, who: Person, userId: string, stopped: boolean) => inject(stopped ? "PUT" : "DELETE", `${posts(gym.id)}/stopped/${userId}`, who.cookies);
  const shown = (f: GymPostsResponse | StaffGymPostsResponse): string[] => [...f.pinned, ...f.posts].map((p) => p.body);
  const filesOf = async (gymId: string): Promise<string[]> => {
    try {
      return (await readdir(join(folder, "gym-post", gymId))).sort();
    } catch {
      return [];
    }
  };
  const count = async (table: "posts" | "live_posts" | "reports" | "open_reports" | "stops", gymId: string): Promise<number> => {
    const rows =
      table === "posts"
        ? await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_posts WHERE gym_id = ${gymId}`
        : table === "live_posts"
          ? await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_posts WHERE gym_id = ${gymId} AND removed_at IS NULL`
          : table === "reports"
            ? await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_post_reports WHERE gym_id = ${gymId}`
            : table === "open_reports"
              ? await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_post_reports WHERE gym_id = ${gymId} AND closed_at IS NULL`
              : await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_post_stops WHERE gym_id = ${gymId}`;
    return rows[0]?.n ?? 0;
  };
  const errorOf = (res: { body: string }): string => (JSON.parse(res.body) as { error: string }).error;
  const audits = async (gymId: string, action: string): Promise<number> => {
    const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gymId} AND action = ${action}`;
    return rows[0]?.n ?? 0;
  };

  beforeAll(async () => {
    await cleanup();
    folder = await mkdtemp(join(tmpdir(), "aihg-member-posts-test-"));
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    redis = redisUrl === undefined || redisUrl === "" ? createMemoryRedis() : createIoRedis(redisUrl);
    for (let tries = 0; (await redis.incrWithTtl(`postsm-ready:${randomUUID()}`, 30)) === null; tries++) {
      if (tries === 100) throw new Error("the Redis at TEST_REDIS_URL never connected");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const real = createDiskPhotoStore(folder);
    disk = real;
    const photoStore: PhotoStore = { ...real, remove: (key) => (storeDown ? Promise.reject(new Error("store is down")) : real.remove(key)) };
    const overrides = { redis, photoStore, orgs: { now: () => new Date(clock) } };
    app = await buildApp(loadConfig(baseEnv), overrides);
    await api().ready();
    second = await buildApp(loadConfig(baseEnv), overrides);
    await second.ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await second?.close();
    await redis?.close();
    await sql.end({ timeout: 5 });
    await rm(folder, { recursive: true, force: true });
  }, T);

  // ===========================================================================
  // THE WORST THING, FIRST
  // ===========================================================================

  it("a member's photo one byte over 1 MB is refused in words and nothing is kept", async () => {
    const gym = await makeGym("Heavy House");
    const writer = await member(gym, "Wendy Writer");
    const real = Buffer.from(IPHONE, "base64");
    const end = real.lastIndexOf(Buffer.from([0xff, 0xd9]));
    const over = Buffer.concat([real.subarray(0, end), Buffer.alloc(1024 * 1024 + 1 - real.length, 0x55), real.subarray(end)]).toString("base64");
    const res = await inject("POST", `${posts(gym.id)}/mine`, writer.cookies, { postKey: randomUUID(), body: "Too heavy", photos: [over] });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ error: "photo_too_big", message: "Photo 1: This photo is bigger than 1 MB. Choose a smaller one." });
    expect(await filesOf(gym.id)).toEqual([]);
  }, T);

  it(
    "a reported post staff remove in one tap is gone for everyone, its photo with it",
    async () => {
      const gym = await makeGym("Report House");
      const writer = await member(gym, "Wendy Writer");
      const reader = await member(gym, "Rita Reader");
      const other = await member(gym, "Omar Other");
      const post = await add(gym, writer, "Look at the state of him on the bench", [IPHONE]);
      const photoPath = `${posts(gym.id)}/${post.id}/photos/${post.photos[0]?.id ?? ""}`;
      expect(await filesOf(gym.id)).toHaveLength(1);
      expect((await inject("GET", photoPath, reader.cookies)).statusCode).toBe(200);

      expect((await report(gym, reader, post.id, "unkind")).statusCode).toBe(200);
      expect((await report(gym, other, post.id, "photo_of_someone")).statusCode).toBe(200);
      const list = await reported(gym, gym.owner);
      expect(list.total).toBe(1);
      expect(list.items.map((i) => ({ id: i.post.id, reports: i.reports, reasons: i.reasons }))).toEqual([
        { id: post.id, reports: 2, reasons: { unkind: 1, photo_of_someone: 1, nudity: 0, spam: 0, other: 0 } },
      ]);
      expect((await staffFeed(gym, gym.owner)).reportedCount).toBe(1);

      // One tap.
      expect((await inject("DELETE", `${posts(gym.id)}/${post.id}`, gym.owner.cookies)).statusCode).toBe(200);

      for (const who of [writer, reader, other]) {
        expect(shown(await feed(gym, who))).toEqual([]);
        expect((await inject("GET", photoPath, who.cookies)).statusCode).toBe(404);
      }
      const staff = await staffFeed(gym, gym.owner);
      expect(shown(staff)).toEqual([]);
      expect(staff.reportedCount).toBe(0);
      expect((await inject("GET", photoPath, gym.owner.cookies)).statusCode).toBe(404);
      expect(await filesOf(gym.id)).toEqual([]);
      expect((await reported(gym, gym.owner)).items).toEqual([]);
      expect(await count("open_reports", gym.id)).toBe(0);
      const outcomes = await sql<{ outcome: string | null }[]>`SELECT outcome FROM gym_post_reports WHERE post_id = ${post.id}`;
      expect(outcomes.map((r) => r.outcome)).toEqual(["removed", "removed"]);
    },
    T,
  );

  it(
    "staff are never told who reported a post, and nothing they can read records it",
    async () => {
      const gym = await makeGym("Quiet House");
      const writer = await member(gym, "Wendy Writer");
      const reporter = await member(gym, "Zebedee Quillfeather");
      const quiet = await member(gym, "Quentin Quietly");
      const blank = await member(gym, "Bea Blank");
      const post = await add(gym, writer, "Protein shakes for sale, message me");
      // What a reporter types is kept as typed, less the space around it; nothing typed, or
      // only spaces, is no note.
      expect((await report(gym, reporter, post.id, "spam", api(), "  He sells these in the changing room\ntoo  ")).statusCode).toBe(200);
      clock += 1000;
      expect((await report(gym, quiet, post.id, "spam")).statusCode).toBe(200);
      clock += 1000;
      expect((await report(gym, blank, post.id, "other", api(), "   ")).statusCode).toBe(200);

      const res = await inject("GET", `${posts(gym.id)}/reported`, gym.owner.cookies);
      expect(res.statusCode).toBe(200);
      const [item] = (JSON.parse(res.body) as ReportedGymPostsResponse).items;
      expect({ reports: item?.reports, notes: item?.notes }).toEqual({ reports: 3, notes: ["He sells these in the changing room\ntoo"] });
      expect(res.body).not.toMatch(/Zebedee|Quillfeather|Quentin|Quietly|Bea Blank/);
      expect(res.body).not.toContain(reporter.userId);
      const staffBody = (await inject("GET", `${posts(gym.id)}/staff`, gym.owner.cookies)).body;
      expect(staffBody).not.toContain(reporter.userId);
      const logged = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gym.id} AND actor_user_id = ${reporter.userId}`;
      expect(logged[0]?.n).toBe(0);
      // The writer is not told either: their own view of the post says nothing of it.
      const mine = (await feed(gym, writer)).posts[0];
      expect(mine).toMatchObject({ own: true, reported: false });
      expect((await feed(gym, reporter)).posts[0]).toMatchObject({ own: false, reported: true });
    },
    T,
  );

  // ===========================================================================
  // WHO MAY POST
  // ===========================================================================

  it(
    "only a live member of a gym that lets its members post can post, and nobody else's body is read",
    async () => {
      const gym = await makeGym("Open House");
      const inside = await member(gym, "Ina Inside");
      const closed = await makeGym("Closed House", false);
      const closedMember = await member(closed, "Cleo Closed");
      const outsider = await member(closed, "Olga Outsider");
      const stranger = await signedIn("Sam Stranger");
      const left = await member(gym, "Lena Left");
      await leave(gym, left);
      const stopped = await member(gym, "Stan Stopped");
      expect((await stop(gym, gym.owner, stopped.userId, true)).statusCode).toBe(200);
      const lapsed = await makeGym("Lapsed House");
      const lapsedMember = await member(lapsed, "Lara Lapsed");
      await lapse(lapsed.id);

      const cases: [string, Gym, Cookies, number, string][] = [
        ["nobody signed in", gym, {}, 401, "unauthorized"],
        ["a stranger", gym, stranger.cookies, 404, "org_not_found"],
        ["another gym's member", gym, outsider.cookies, 404, "org_not_found"],
        ["a member who left", gym, left.cookies, 404, "org_not_found"],
        ["a member of a gym that has not switched it on", closed, closedMember.cookies, 403, "posting_off"],
        ["a member staff stopped", gym, stopped.cookies, 403, "posting_stopped"],
        ["a member of a gym whose plan lapsed", lapsed, lapsedMember.cookies, 404, "org_not_found"],
      ];
      for (const [who, where, cookies, status, error] of cases) {
        const res = await inject("POST", `${posts(where.id)}/mine`, cookies, { postKey: randomUUID(), body: "hello", photos: [IPHONE] });
        expect({ who, status: res.statusCode }).toEqual({ who, status });
        if (status !== 401) expect({ who, error: errorOf(res) }).toEqual({ who, error });
        // Refused before the body is read: one that cannot be read is refused the same way.
        const broken = await api().inject({
          method: "POST",
          url: `${posts(where.id)}/mine`,
          remoteAddress: nextIp(),
          cookies,
          headers: { "content-type": "application/json" },
          payload: '{"postKey":',
        });
        expect({ who, broken: broken.statusCode }).toEqual({ who, broken: status });
      }
      for (const where of [gym, closed, lapsed]) {
        expect(await count("posts", where.id)).toBe(0);
        expect(await filesOf(where.id)).toEqual([]);
      }

      // The member who may: posted under their own name, and theirs to remove.
      const post = await add(gym, inside, "First time on the rower today", [IPHONE]);
      expect(post).toMatchObject({ fromMember: true, own: true, reported: false, author: { name: "Ina I.", initials: "II" } });
      expect((await feed(gym, stopped)).posts[0]).toMatchObject({ fromMember: true, own: false, author: { name: "Ina I." } });
      expect((await feed(gym, inside)).posting).toBe("on");
      expect((await feed(gym, stopped)).posting).toBe("stopped");
      expect((await feed(closed, closedMember)).posting).toBe("off");
      // Staff read whose it is, and post themselves whatever the switch says.
      expect((await staffFeed(gym, gym.owner)).posts[0]).toMatchObject({ fromMember: true, authorId: inside.userId, authorStopped: false, author: { name: "Ina Inside" } });
      const staffPost = await inject("POST", posts(closed.id), closed.owner.cookies, { postKey: randomUUID(), body: "From the gym", photos: [] });
      expect(staffPost.statusCode).toBe(201);
      expect((JSON.parse(staffPost.body) as { post: { fromMember: boolean; authorId: string | null } }).post).toMatchObject({ fromMember: false, authorId: null });
    },
    T,
  );

  it(
    "a member's post is validated as staff's is, and one key is one post",
    async () => {
      const gym = await makeGym("Key House");
      const writer = await member(gym, "Wendy Writer");
      const rival = await member(gym, "Rhea Rival");
      for (const payload of [{ postKey: randomUUID(), body: "", photos: [] }, { postKey: "nope", body: "x", photos: [] }, { postKey: randomUUID(), body: "x", photos: [], pinned: true }]) {
        const res = await inject("POST", `${posts(gym.id)}/mine`, writer.cookies, payload);
        expect(res.statusCode).toBe(400);
      }
      const key = randomUUID();
      const sends = await Promise.all([0, 1, 2, 3, 4].map((n) => send(gym, writer, "Sent five times at once", [IPHONE], key, nextIp(), either(n))));
      expect(sends.map((r) => r.statusCode)).toEqual([201, 201, 201, 201, 201]);
      expect(new Set(sends.map((r) => (JSON.parse(r.body) as { post: GymPost }).post.id)).size).toBe(1);
      expect(await count("posts", gym.id)).toBe(1);
      expect(await filesOf(gym.id)).toHaveLength(1);
      // Somebody else's key is not a way to read their post back, or to post.
      const taken = await send(gym, rival, "Mine now", [], key);
      expect(taken.statusCode).toBe(409);
      expect(taken.body).not.toContain("Sent five times");
      expect(await count("posts", gym.id)).toBe(1);
    },
    T,
  );

  it(
    `a member posts ${String(GYM_MEMBER_POSTS_A_DAY)} times in 24 hours and no more, however the posts arrive`,
    async () => {
      const gym = await makeGym("Flood House");
      const writer = await member(gym, "Wendy Writer");
      const quiet = await member(gym, "Quinn Quiet");
      const first = await add(gym, writer, "Post 1");
      for (let i = 2; i < GYM_MEMBER_POSTS_A_DAY; i++) await add(gym, writer, `Post ${String(i)}`);
      // One left, and four sent at the same moment across two servers: one lands.
      const keys = [0, 1, 2, 3].map(() => randomUUID());
      const burst = await Promise.all([0, 1, 2, 3].map((n) => send(gym, writer, `Burst ${String(n)}`, [], keys[n], nextIp(), either(n))));
      expect(burst.map((r) => r.statusCode).sort()).toEqual([201, 429, 429, 429]);
      // The day's last post, sent again under its key after a lost reply: the same post
      // back, not "try again tomorrow".
      const landed = burst.findIndex((r) => r.statusCode === 201);
      const again = await send(gym, writer, `Burst ${String(landed)}`, [], keys[landed]);
      expect(again.statusCode, again.body).toBe(201);
      expect((JSON.parse(again.body) as { post: GymPost }).post.id).toBe((JSON.parse(burst[landed]?.body ?? "{}") as { post: GymPost }).post.id);
      expect(burst.filter((r) => r.statusCode === 429).map(errorOf)).toEqual(["posts_day_full", "posts_day_full", "posts_day_full"]);
      expect(await count("posts", gym.id)).toBe(GYM_MEMBER_POSTS_A_DAY);

      // Removing one gives none back; somebody else is not held up by it.
      expect((await inject("DELETE", `${posts(gym.id)}/mine/${first.id}`, writer.cookies)).statusCode).toBe(200);
      expect((await send(gym, writer, "One more")).statusCode).toBe(429);
      // Refused before a photo is cleaned or written: a photo that cannot be read is never
      // looked at, so the answer is the day's, not the photo's.
      const unread = await send(gym, writer, "With a photo that is no photo", ["AAAA"]);
      expect({ status: unread.statusCode, error: errorOf(unread) }).toEqual({ status: 429, error: "posts_day_full" });
      expect(await filesOf(gym.id)).toEqual([]);
      expect((await send(gym, quiet, "My first")).statusCode).toBe(201);

      // 24 hours after the first, it no longer counts.
      clock += 24 * HOUR;
      expect((await send(gym, writer, "A new day")).statusCode).toBe(201);
    },
    T,
  );

  it(
    "a flood of tries is stopped for the person, not for the gym's wi-fi",
    async () => {
      const gym = await makeGym("Wifi House");
      const noisy = await member(gym, "Nora Noisy");
      const calm = await member(gym, "Cal Calm");
      const wifi = desk();
      // Tries that may post, so their body is read, and that keep nothing: thirty an hour.
      const codes: string[] = [];
      for (let i = 0; i < 31; i++) {
        const res = await inject("POST", `${posts(gym.id)}/mine`, noisy.cookies, { postKey: randomUUID(), body: "", photos: [] }, wifi);
        codes.push(errorOf(res));
      }
      expect([codes[0], codes[29], codes[30]]).toEqual(["validation_error", "validation_error", "rate_limited"]);
      expect(await count("posts", gym.id)).toBe(0);
      expect((await send(gym, calm, "Same wi-fi, my own allowance", [], randomUUID(), wifi)).statusCode).toBe(201);
    },
    T,
  );

  // ===========================================================================
  // REMOVING ONE'S OWN
  // ===========================================================================

  it(
    "a member removes their own post and nobody else's",
    async () => {
      const gym = await makeGym("Own House");
      const writer = await member(gym, "Wendy Writer");
      const rival = await member(gym, "Rhea Rival");
      const other = await makeGym("Other Own House");
      const outsider = await member(other, "Olga Outsider");
      const post = await add(gym, writer, "Mine to take down", [IPHONE]);
      const gymPost = await inject("POST", posts(gym.id), gym.owner.cookies, { postKey: randomUUID(), body: "The gym's own", photos: [] });
      const gymPostId = (JSON.parse(gymPost.body) as { post: { id: string } }).post.id;
      expect((await report(gym, rival, post.id, "other")).statusCode).toBe(200);

      const mine = (id: string) => `${posts(gym.id)}/mine/${id}`;
      expect((await inject("DELETE", mine(post.id), {})).statusCode).toBe(401);
      expect((await inject("DELETE", mine(post.id), rival.cookies)).statusCode).toBe(404);
      expect((await inject("DELETE", mine(post.id), outsider.cookies)).statusCode).toBe(404);
      expect((await inject("DELETE", `${posts(other.id)}/mine/${post.id}`, writer.cookies)).statusCode).toBe(404);
      // Staff who wrote the gym's post are not its "member author", and a member is not staff.
      expect((await inject("DELETE", mine(gymPostId), gym.owner.cookies)).statusCode).toBe(404);
      expect((await inject("DELETE", `${posts(gym.id)}/${post.id}`, writer.cookies)).statusCode).toBe(404);
      expect(await count("live_posts", gym.id)).toBe(2);

      expect((await inject("DELETE", mine(post.id), writer.cookies)).statusCode).toBe(200);
      expect(shown(await feed(gym, rival))).toEqual(["The gym's own"]);
      expect(await filesOf(gym.id)).toEqual([]);
      expect(await count("open_reports", gym.id)).toBe(0);
      expect((await inject("DELETE", mine(post.id), writer.cookies)).statusCode).toBe(404);
    },
    T,
  );

  it(
    "a member who leaves, is removed or deletes their account takes their posts and photos off the page",
    async () => {
      const gym = await makeGym("Leaving House");
      const leaver = await member(gym, "Lena Leaver");
      const reader = await member(gym, "Rita Reader");
      const post = await add(gym, leaver, "My last session here", [IPHONE]);
      const photoPath = `${posts(gym.id)}/${post.id}/photos/${post.photos[0]?.id ?? ""}`;
      expect((await inject("PUT", `${posts(gym.id)}/${post.id}/pin`, gym.owner.cookies, { pinned: true })).statusCode).toBe(200);
      expect((await report(gym, reader, post.id, "other")).statusCode).toBe(200);
      expect(shown(await feed(gym, reader))).toEqual(["My last session here"]);

      const gone = async () => {
        expect(shown(await feed(gym, reader))).toEqual([]);
        const staff = await staffFeed(gym, gym.owner);
        expect(shown(staff)).toEqual([]);
        expect(staff.reportedCount).toBe(0);
        expect((await reported(gym, gym.owner)).items).toEqual([]);
        expect((await inject("GET", photoPath, reader.cookies)).statusCode).toBe(404);
        expect((await inject("GET", photoPath, gym.owner.cookies)).statusCode).toBe(404);
        expect((await inject("PUT", `${posts(gym.id)}/${post.id}/reaction`, reader.cookies, { reaction: "like" })).statusCode).toBe(404);
        expect((await report(gym, reader, post.id, "spam")).statusCode).toBe(404);
      };

      await leave(gym, leaver);
      await gone();
      // Back in the gym, the post is back.
      await sql`UPDATE gym_members SET removed_at = NULL WHERE gym_id = ${gym.id} AND user_id = ${leaver.userId}`;
      expect(shown(await feed(gym, reader))).toEqual(["My last session here"]);
      // An account on its way to being deleted.
      await sql`UPDATE users SET status = 'deleted', deleted_at = now() WHERE id = ${leaver.userId}`;
      await gone();
    },
    T,
  );

  // ===========================================================================
  // REPORT
  // ===========================================================================

  it(
    "a report is one a person a post, from a live member of that gym, about somebody else's post",
    async () => {
      const gym = await makeGym("Rules House");
      const writer = await member(gym, "Wendy Writer");
      const reporter = await member(gym, "Rex Reporter");
      const other = await makeGym("Other Rules House");
      const outsider = await member(other, "Olga Outsider");
      const stranger = await signedIn("Sam Stranger");
      const left = await member(gym, "Lena Left");
      await leave(gym, left);
      const post = await add(gym, writer, "Reported once");
      const removed = await add(gym, writer, "Already gone");
      expect((await inject("DELETE", `${posts(gym.id)}/mine/${removed.id}`, writer.cookies)).statusCode).toBe(200);

      expect((await report(gym, { userId: "", cookies: {} }, post.id, "spam")).statusCode).toBe(401);
      for (const who of [outsider, stranger, left]) expect((await report(gym, who, post.id, "spam")).statusCode).toBe(404);
      // The post named under another gym's address is not found there.
      expect((await report(other, outsider, post.id, "spam")).statusCode).toBe(404);
      expect((await report(gym, reporter, removed.id, "spam")).statusCode).toBe(404);
      expect((await report(gym, reporter, randomUUID(), "spam")).statusCode).toBe(404);
      for (const reason of ["rude", "", null, 7]) {
        expect((await inject("POST", `${posts(gym.id)}/${post.id}/report`, reporter.cookies, { reason })).statusCode).toBe(400);
      }
      // What is typed beside the reason: 300 characters, an emoji one of them, and no more.
      const bad = [{ reason: "spam", extra: "x" }, { reason: "spam", note: 7 }, { reason: "spam", note: "a".repeat(301) }, { reason: "spam", note: `a${String.fromCharCode(0)}b` }, { note: "no reason given" }];
      for (const payload of bad) {
        expect((await inject("POST", `${posts(gym.id)}/${post.id}/report`, reporter.cookies, payload)).statusCode).toBe(400);
      }
      const full = await member(gym, "Flo Full");
      const longest = "a".repeat(290) + String.fromCodePoint(0x1f4aa).repeat(10);
      expect((await report(gym, full, post.id, "other", api(), longest)).statusCode).toBe(200);
      expect((await reported(gym, gym.owner)).items[0]?.notes).toEqual([longest]);
      expect((await keep(gym, gym.owner, post.id)).statusCode).toBe(200);
      const own = await report(gym, writer, post.id, "spam");
      expect({ status: own.statusCode, error: errorOf(own) }).toEqual({ status: 400, error: "own_post" });
      expect(await count("reports", gym.id)).toBe(1);

      // Five taps at once, across two servers: one report.
      const taps = await Promise.all([0, 1, 2, 3, 4].map((n) => report(gym, reporter, post.id, n === 0 ? "spam" : "unkind", either(n))));
      expect(taps.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
      expect(await count("reports", gym.id)).toBe(2);
      expect((await reported(gym, gym.owner)).items[0]?.reports).toBe(1);
    },
    T,
  );

  it(
    "Keep clears a post from the list, and only a new person's report brings it back",
    async () => {
      const gym = await makeGym("Keep House");
      const writer = await member(gym, "Wendy Writer");
      const first = await member(gym, "Fay First");
      const next = await member(gym, "Ned Next");
      const older = await add(gym, writer, "Reported first");
      const newer = await add(gym, writer, "Reported second");
      clock += 1000;
      expect((await report(gym, first, older.id, "other")).statusCode).toBe(200);
      clock += 1000;
      expect((await report(gym, first, newer.id, "nudity")).statusCode).toBe(200);
      // Longest waiting first.
      expect((await reported(gym, gym.owner)).items.map((i) => i.post.body)).toEqual(["Reported first", "Reported second"]);

      expect((await keep(gym, gym.owner, older.id)).statusCode).toBe(200);
      expect((await reported(gym, gym.owner)).items.map((i) => i.post.body)).toEqual(["Reported second"]);
      // Still there for everyone: Keep removes nothing.
      expect(shown(await feed(gym, next))).toEqual(["Reported second", "Reported first"]);
      // The same person again changes nothing; kept twice is kept.
      expect((await report(gym, first, older.id, "spam")).statusCode).toBe(200);
      expect((await keep(gym, gym.owner, older.id)).statusCode).toBe(200);
      expect((await reported(gym, gym.owner)).total).toBe(1);
      const kept = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.post_kept'`;
      expect(kept[0]?.n).toBe(1);
      // Somebody new reports it: back on the list, with their report alone.
      clock += 1000;
      expect((await report(gym, next, older.id, "unkind")).statusCode).toBe(200);
      const again = await reported(gym, gym.owner);
      expect(again.items.map((i) => [i.post.body, i.reports])).toEqual([
        ["Reported second", 1],
        ["Reported first", 1],
      ]);
      expect((await keep(gym, gym.owner, randomUUID())).statusCode).toBe(404);
      const mark = "a".repeat(32);
      for (const bad of [undefined, {}, { allReports: 1 }, { reportsMark: mark }, { allReports: 0, reportsMark: mark }, { allReports: "1", reportsMark: mark }, { allReports: 1.5, reportsMark: mark }, { allReports: 1, reportsMark: "A".repeat(32) }, { allReports: 1, reportsMark: mark, all: true }, { upTo: new Date(clock).toISOString() }]) {
        expect((await inject("POST", `${posts(gym.id)}/${older.id}/keep`, gym.owner.cookies, bad)).statusCode).toBe(400);
      }
    },
    T,
  );

  it(
    "Keep answers only the reports staff were shown: one that arrives while they look stays, and so does the post",
    async () => {
      const gym = await makeGym("Late House");
      const writer = await member(gym, "Wendy Writer");
      const first = await member(gym, "Fay First");
      const late = await member(gym, "Lars Late");
      const post = await add(gym, writer, "Look at the state of him");
      clock += 1000;
      expect((await report(gym, first, post.id, "spam")).statusCode).toBe(200);
      // Staff open the page and read the list.
      const seen = (await reported(gym, gym.owner)).items[0];
      expect(seen?.reports).toBe(1);
      // While it is open, somebody else reports the post, with words.
      clock += 1000;
      expect((await report(gym, late, post.id, "photo_of_someone", api(), "That is my brother in the photo")).statusCode).toBe(200);

      const res = await keep(gym, gym.owner, post.id, seen);
      expect({ status: res.statusCode, body: JSON.parse(res.body) as unknown }).toEqual({ status: 200, body: { kept: false, waiting: 1 } });
      // Nothing was answered: the post is still on the list, with the report nobody read.
      const after = await reported(gym, gym.owner);
      expect(after.items.map((i) => ({ id: i.post.id, reports: i.reports, notes: i.notes }))).toEqual([
        { id: post.id, reports: 2, notes: ["That is my brother in the photo"] },
      ]);
      const open = async () =>
        (await sql<{ reason: string; outcome: string | null }[]>`SELECT reason, outcome FROM gym_post_reports WHERE post_id = ${post.id} ORDER BY reason`).map((r) => [r.reason, r.outcome]);
      expect(await open()).toEqual([
        ["photo_of_someone", null],
        ["spam", null],
      ]);
      expect(await audits(gym.id, "org.post_kept")).toBe(0);
      // Read again and kept: nothing is waiting now.
      const again = await keep(gym, gym.owner, post.id, after.items[0]);
      expect(JSON.parse(again.body)).toEqual({ kept: true, waiting: 0 });
      expect((await reported(gym, gym.owner)).items).toEqual([]);
      expect(await open()).toEqual([
        ["photo_of_someone", "kept"],
        ["spam", "kept"],
      ]);
    },
    T,
  );

  // THE WORST THING: staff press Keep and a report they were never shown is answered with
  // it. A report's time is read by the api before the report is stored, so one can land
  // after staff read the list and still carry an EARLIER time than the newest they saw.
  it(
    "Keep never answers a report staff were not shown, whatever time that report carries",
    async () => {
      const gym = await makeGym("Unread House");
      const writer = await member(gym, "Wendy Writer");
      const shownOne = await member(gym, "Yan Shown");
      const unread = await member(gym, "Xena Unread");
      const post = await add(gym, writer, "Look who I caught at the squat rack");
      clock += 5000;
      expect((await report(gym, shownOne, post.id, "spam")).statusCode).toBe(200);
      const seen = (await reported(gym, gym.owner)).items[0];
      expect({ reports: seen?.reports, all: seen?.allReports, notes: seen?.notes }).toEqual({ reports: 1, all: 1, notes: [] });
      // It lands now, stamped two seconds BEFORE the one staff were shown.
      await sql`
        INSERT INTO gym_post_reports (gym_id, post_id, user_id, reason, note, created_at)
        VALUES (${gym.id}, ${post.id}, ${unread.userId}, 'photo_of_someone', 'That is me in the photo and I did not agree to it', ${new Date(clock - 2000)})`;

      const res = await keep(gym, gym.owner, post.id, seen);
      expect({ status: res.statusCode, body: JSON.parse(res.body) as unknown }).toEqual({ status: 200, body: { kept: false, waiting: 1 } });
      const rows = await sql<{ reason: string; outcome: string | null }[]>`SELECT reason, outcome FROM gym_post_reports WHERE post_id = ${post.id} ORDER BY reason`;
      expect(rows.map((r) => [r.reason, r.outcome])).toEqual([
        ["photo_of_someone", null],
        ["spam", null],
      ]);
      const after = await reported(gym, gym.owner);
      expect(after.items.map((i) => ({ id: i.post.id, reports: i.reports, all: i.allReports, notes: i.notes }))).toEqual([
        { id: post.id, reports: 2, all: 2, notes: ["That is me in the photo and I did not agree to it"] },
      ]);
      expect(await audits(gym.id, "org.post_kept")).toBe(0);

      // Somebody else on the staff answered them meanwhile, and a third person reports:
      // the first reader's Keep, still saying two, answers nothing of the third's.
      const manager = await signedIn("Maya Manager");
      await addStaff(gym.id, manager.userId, "manager", null);
      const two = after.items[0];
      expect(JSON.parse((await keep(gym, manager, post.id, two)).body)).toEqual({ kept: true, waiting: 0 });
      const third = await member(gym, "Theo Third");
      clock += 1000;
      expect((await report(gym, third, post.id, "unkind")).statusCode).toBe(200);
      expect(JSON.parse((await keep(gym, gym.owner, post.id, two)).body)).toEqual({ kept: false, waiting: 1 });
      expect(await count("open_reports", gym.id)).toBe(1);
      const three = (await reported(gym, gym.owner)).items[0];
      expect(three?.allReports).toBe(3);
      // A reporter's account has gone since the list was read: fewer reports than staff were
      // shown, so the list is read again and nothing is answered.
      await sql`DELETE FROM gym_post_reports WHERE post_id = ${post.id} AND user_id = ${shownOne.userId}`;
      const fewer = await keep(gym, gym.owner, post.id, three);
      expect({ status: fewer.statusCode, error: errorOf(fewer) }).toEqual({ status: 409, error: "reports_changed" });
      expect(await count("open_reports", gym.id)).toBe(1);
      // …and a new report arrives in the same look: the post has three again, the number
      // staff were shown, and they are not the same three. Nothing is answered.
      const fourth = await member(gym, "Fern Fourth");
      clock += 1000;
      expect((await report(gym, fourth, post.id, "nudity")).statusCode).toBe(200);
      const same = await keep(gym, gym.owner, post.id, three);
      expect({ status: same.statusCode, error: errorOf(same) }).toEqual({ status: 409, error: "reports_changed" });
      expect(await count("open_reports", gym.id)).toBe(2);
      // Told what is true now, Keep answers them.
      expect(JSON.parse((await keep(gym, gym.owner, post.id)).body)).toEqual({ kept: true, waiting: 0 });
      expect(await count("open_reports", gym.id)).toBe(0);
    },
    T,
  );

  it(
    "a photo file that will not go is written down and removed later; a kept post's file never is",
    async () => {
      const gym = await makeGym("Leftover House");
      const writer = await member(gym, "Wendy Writer");
      const kept = await add(gym, writer, "Stays", [IPHONE]);
      const taken = await add(gym, writer, "Taken down by staff", [IPHONE]);
      const own = await add(gym, writer, "Taken down by me", [IPHONE]);
      expect(await filesOf(gym.id)).toHaveLength(3);
      // Nothing of a post that was kept is on the list.
      expect(await listedOf(gym.id)).toEqual([]);

      storeDown = true;
      try {
        expect((await inject("DELETE", `${posts(gym.id)}/${taken.id}`, gym.owner.cookies)).statusCode).toBe(200);
        expect((await inject("DELETE", `${posts(gym.id)}/mine/${own.id}`, writer.cookies)).statusCode).toBe(200);
      } finally {
        storeDown = false;
      }
      // The posts are gone for everyone and their rows with them; the two files are not,
      // and each is written down.
      expect(shown(await feed(gym, writer))).toEqual(["Stays"]);
      const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_post_photos WHERE gym_id = ${gym.id}`;
      expect(rows[0]?.n).toBe(1);
      expect(await filesOf(gym.id)).toHaveLength(3);
      const left = await listedOf(gym.id);
      expect(left).toHaveLength(2);
      const names = await filesOf(gym.id);
      for (const key of left) expect(names).toContain(key.split("/")[2]);

      // The nightly run leaves alone what was listed within the hour: a post being made
      // lists its files before it writes them.
      await removeLeftovers({ sql, photos: store() });
      expect(await filesOf(gym.id)).toHaveLength(3);
      await sql`UPDATE photo_files_to_remove SET created_at = now() - interval '2 hours' WHERE storage_key = ANY(${left})`;
      await removeLeftovers({ sql, photos: store() });
      expect(await listedOf(gym.id)).toEqual([]);
      // The kept post's file is the one left, and it is still served.
      expect(await filesOf(gym.id)).toHaveLength(1);
      expect((await inject("GET", `${posts(gym.id)}/${kept.id}/photos/${kept.photos[0]?.id ?? ""}`, writer.cookies)).statusCode).toBe(200);

      // A file that is not on the list is never removed, whoever asks: a post whose reply
      // was lost is kept, and the clean-up after the error must not take its photos.
      const keys = (await sql<{ storage_key: string }[]>`SELECT storage_key FROM gym_post_photos WHERE gym_id = ${gym.id}`).map((r) => r.storage_key);
      expect(keys).toHaveLength(1);
      expect(await removeListed({ sql, photos: store() }, keys, true)).toBe(0);
      expect(await filesOf(gym.id)).toHaveLength(1);

      // A listed key whose file has already gone (the file went and the list could not be
      // written at that instant). A store rooted somewhere else finds no file either, and
      // must not clear it; the store that holds this gym's kept photo may.
      const stuck = `gym-post/${gym.id}/${randomUUID()}.jpg`;
      await sql`INSERT INTO photo_files_to_remove (storage_key, created_at) VALUES (${stuck}, now() - interval '2 hours')`;
      const elsewhere = await mkdtemp(join(tmpdir(), "aihg-member-posts-elsewhere-"));
      try {
        await removeLeftovers({ sql, photos: createDiskPhotoStore(elsewhere) });
        expect(await listedOf(gym.id)).toEqual([stuck]);
      } finally {
        await rm(elsewhere, { recursive: true, force: true });
      }
      await removeLeftovers({ sql, photos: store() });
      expect(await listedOf(gym.id)).toEqual([]);
      expect(await filesOf(gym.id)).toHaveLength(1);
    },
    T,
  );

  it(
    "the day's last post sent twice at once is one post, and both are answered with it",
    async () => {
      const gym = await makeGym("Last House");
      const writer = await member(gym, "Wendy Writer");
      for (let n = 1; n < GYM_MEMBER_POSTS_A_DAY; n++) await add(gym, writer, `Post ${String(n)}`);
      clock += 1000;
      const body = { postKey: randomUUID(), body: "The tenth", photos: [IPHONE] };
      // Both are held at the person's membership, past the first look for the key.
      const release = await hold((tx) => tx`SELECT 1 FROM gym_members WHERE gym_id = ${gym.id} AND user_id = ${writer.userId} FOR UPDATE`);
      const both = [0, 1].map((n) => inject("POST", `${posts(gym.id)}/mine`, writer.cookies, body, nextIp(), either(n)));
      try {
        await waitingFor("%FROM gym_members WHERE gym_id%FOR UPDATE%", 2);
      } finally {
        await release();
      }
      const answers = await Promise.all(both);
      expect(answers.map((r) => r.statusCode)).toEqual([201, 201]);
      const ids = answers.map((r) => (JSON.parse(r.body) as { post: GymPost }).post.id);
      expect(ids[0]).toBe(ids[1]);
      expect(await count("posts", gym.id)).toBe(GYM_MEMBER_POSTS_A_DAY);
      // One set of photos, and nothing left to remove.
      expect(await filesOf(gym.id)).toHaveLength(1);
      expect(await listedOf(gym.id)).toEqual([]);
      // An eleventh is still refused.
      expect((await send(gym, writer, "One more")).statusCode).toBe(429);
    },
    T,
  );

  it(
    "a post removed while it is being pinned is not pinned, and the record does not say it was",
    async () => {
      const gym = await makeGym("Pin Race House");
      const writer = await member(gym, "Wendy Writer");
      const post = await add(gym, writer, "Pinned or gone");
      // The pin has read the post and waits to write; the removal lands first.
      const release = await hold((tx) => tx`SELECT 1 FROM gym_posts WHERE id = ${post.id} FOR UPDATE`);
      const pin = inject("PUT", `${posts(gym.id)}/${post.id}/pin`, gym.owner.cookies, { pinned: true });
      try {
        await waitingFor("%UPDATE gym_posts SET pinned_at%", 1);
      } finally {
        await release((tx) => tx`UPDATE gym_posts SET removed_at = now(), pinned_at = NULL WHERE id = ${post.id}`);
      }
      const res = await pin;
      expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 404, error: "post_not_found" });
      expect(await audits(gym.id, "org.post_pinned")).toBe(0);
    },
    T,
  );

  it(
    "a reaction that lands after its giver blocked the writer is neither counted nor named",
    async () => {
      const gym = await makeGym("Stray House");
      const writer = await member(gym, "Wendy Writer");
      const reader = await member(gym, "Rita Reader");
      const friend = await member(gym, "Fred Friend");
      const post = await add(gym, writer, "Blocked by one reader");
      const reactions = `${posts(gym.id)}/${post.id}/reaction`;
      expect((await inject("PUT", reactions, friend.cookies, { reaction: "love" })).statusCode).toBe(200);
      expect((await inject("PUT", `${posts(gym.id)}/${post.id}/block`, reader.cookies)).statusCode).toBe(200);
      // Sent a moment before the block and stored a moment after it.
      await sql`INSERT INTO gym_post_reactions (gym_id, post_id, user_id, reaction) VALUES (${gym.id}, ${post.id}, ${reader.userId}, 'love')`;

      const own = (await feed(gym, writer)).posts.find((p) => p.id === post.id);
      expect(own?.reactions).toEqual({ like: 0, strong: 0, fire: 0, love: 1 });
      const who = await inject("GET", `${posts(gym.id)}/${post.id}/reactions?reaction=love`, gym.owner.cookies);
      expect(JSON.parse(who.body)).toEqual({ reaction: "love", total: 1, people: [{ name: "Fred Friend", initials: "FF" }] });
      expect((await staffFeed(gym, gym.owner)).posts.find((p) => p.id === post.id)?.reactions).toEqual({ like: 0, strong: 0, fire: 0, love: 1 });
    },
    T,
  );

  it(
    "a key a member used for their own post is not answered to staff with that post",
    async () => {
      const gym = await makeGym("Key House");
      const writer = await member(gym, "Wendy Writer");
      const postKey = randomUUID();
      expect((await send(gym, writer, "A member's own words", [], postKey)).statusCode).toBe(201);
      const res = await inject("POST", posts(gym.id), gym.owner.cookies, { postKey, body: "The gym's news", photos: [] });
      expect({ status: res.statusCode, error: errorOf(res) }).toEqual({ status: 409, error: "post_key_taken" });
      expect(res.body).not.toContain("A member's own words");
      expect(await count("posts", gym.id)).toBe(1);
    },
    T,
  );

  it(
    "a pinned member's post whose writer leaves gives its pin back, and three pins stay three when they return",
    async () => {
      const gym = await makeGym("Pin House");
      const leaver = await member(gym, "Lena Leaver");
      const staffPost = async (body: string): Promise<string> => {
        clock += 1000;
        const res = await inject("POST", posts(gym.id), gym.owner.cookies, { postKey: randomUUID(), body, photos: [] });
        expect(res.statusCode).toBe(201);
        return (JSON.parse(res.body) as { post: { id: string } }).post.id;
      };
      const pin = (id: string, pinned = true) => {
        clock += 1000;
        return inject("PUT", `${posts(gym.id)}/${id}/pin`, gym.owner.cookies, { pinned });
      };
      const theirs = await add(gym, leaver, "Pinned, then I left");
      const one = await staffPost("Staff pin one");
      const two = await staffPost("Staff pin two");
      const three = await staffPost("Staff pin three");
      for (const id of [theirs.id, one, two]) expect((await pin(id)).statusCode).toBe(200);
      expect((await pin(three)).statusCode).toBe(409);

      await leave(gym, leaver);
      expect((await staffFeed(gym, gym.owner)).pinned.map((p) => p.body)).toEqual(["Staff pin two", "Staff pin one"]);
      // The hidden post no longer holds a pin: a third can be pinned.
      expect((await pin(three)).statusCode).toBe(200);
      expect((await staffFeed(gym, gym.owner)).pinned.map((p) => p.body)).toEqual(["Staff pin three", "Staff pin two", "Staff pin one"]);

      // The writer comes back: their post is back among the others, not a fourth pin, and
      // the page still reads for staff and members.
      await sql`UPDATE gym_members SET removed_at = NULL WHERE gym_id = ${gym.id} AND user_id = ${leaver.userId}`;
      const staff = await staffFeed(gym, gym.owner);
      expect(staff.pinned).toHaveLength(3);
      expect(staff.posts.map((p) => p.body)).toEqual(["Pinned, then I left"]);
      expect((await feed(gym, leaver)).pinned).toHaveLength(3);
      const pins = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_posts WHERE gym_id = ${gym.id} AND pinned_at IS NOT NULL`;
      expect(pins[0]?.n).toBe(3);
    },
    T,
  );

  it(
    "a stop, or the switch going off, that lands while a post is on its way refuses that post",
    async () => {
      // The post passes the check made before its body is read, then waits for the person's
      // membership, which this test holds while it makes the change: the check made again
      // inside that step is what refuses it.
      for (const change of ["stop", "switch"] as const) {
        const gym = await makeGym(`Lock House ${change}`);
        const writer = await member(gym, "Wendy Writer");
        let sent: ReturnType<typeof send> | undefined;
        await sql.begin(async (tx) => {
          await tx`SELECT 1 FROM gym_members WHERE gym_id = ${gym.id} AND user_id = ${writer.userId} FOR UPDATE`;
          sent = send(gym, writer, "Sent at the same moment");
          await new Promise((resolve) => setTimeout(resolve, 1500));
          if (change === "stop") await tx`INSERT INTO gym_post_stops (gym_id, user_id) VALUES (${gym.id}, ${writer.userId})`;
          else await tx`UPDATE gyms SET members_can_post = false WHERE id = ${gym.id}`;
        });
        const res = await sent;
        expect({ change, status: res?.statusCode, error: res === undefined ? "" : errorOf(res) }).toEqual({
          change,
          status: 403,
          error: change === "stop" ? "posting_stopped" : "posting_off",
        });
        expect(await count("posts", gym.id)).toBe(0);
      }
    },
    T,
  );

  it(
    "the staff lists hold at their caps: 50 reported posts, 20 typed notes a post, 200 people stopped",
    async () => {
      const gym = await makeGym("Cap House");
      const crowd = GYM_POST_STOPS_SHOWN + 1;
      const tag = uniq();
      await sql`
        INSERT INTO users (email, display_name)
        SELECT 'postsm-t-crowd-' || ${tag} || '-' || n || '@example.com', 'Crowd Person' FROM generate_series(1, ${crowd}) n`;
      const people = sql`SELECT id FROM users WHERE email LIKE ${"postsm-t-crowd-" + tag + "-%"}`;
      await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) SELECT ${gym.id}, id, now() FROM (${people}) p`;
      await sql`INSERT INTO gym_post_stops (gym_id, user_id) SELECT ${gym.id}, id FROM (${people}) p`;
      // One more reported post than the list carries, each by the same member; the oldest
      // of them reported by one more person with words than a post's notes carry.
      await sql`
        INSERT INTO gym_posts (gym_id, author_user_id, post_key, body, by_member, created_at)
        SELECT ${gym.id}, (SELECT id FROM (${people}) p LIMIT 1), gen_random_uuid(), 'Reported ' || n, true, now() - n * interval '1 minute'
        FROM generate_series(1, ${GYM_POST_REPORTS_SHOWN + 1}) n`;
      await sql`
        INSERT INTO gym_post_reports (gym_id, post_id, user_id, reason, created_at)
        SELECT gym_id, id, ${gym.owner.userId}, 'spam', created_at + interval '1 second' FROM gym_posts WHERE gym_id = ${gym.id}`;
      await sql`
        INSERT INTO gym_post_reports (gym_id, post_id, user_id, reason, note, created_at)
        SELECT ${gym.id}, (SELECT id FROM gym_posts WHERE gym_id = ${gym.id} ORDER BY created_at LIMIT 1), p.id, 'other', 'A note', now()
        FROM (${people} LIMIT ${GYM_POST_REPORT_NOTES_SHOWN + 1} OFFSET 1) p`;

      const list = await reported(gym, gym.owner);
      expect({ items: list.items.length, total: list.total }).toEqual({ items: GYM_POST_REPORTS_SHOWN, total: GYM_POST_REPORTS_SHOWN + 1 });
      expect({ reports: list.items[0]?.reports, notes: list.items[0]?.notes.length }).toEqual({
        reports: GYM_POST_REPORT_NOTES_SHOWN + 2,
        notes: GYM_POST_REPORT_NOTES_SHOWN,
      });
      expect((await staffFeed(gym, gym.owner)).reportedCount).toBe(GYM_POST_REPORTS_SHOWN + 1);
      const stoppedRes = await inject("GET", `${posts(gym.id)}/stopped`, gym.owner.cookies);
      expect(stoppedRes.statusCode).toBe(200);
      expect((JSON.parse(stoppedRes.body) as StoppedGymPostersResponse).people).toHaveLength(GYM_POST_STOPS_SHOWN);
    },
    T,
  );

  it(
    "staff who also train are not offered Report on a post they wrote for the gym",
    async () => {
      const gym = await makeGym("Both House");
      await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${gym.id}, ${gym.owner.userId}, '2026-01-01T00:00:00Z')`;
      const reader = await member(gym, "Rita Reader");
      const res = await inject("POST", posts(gym.id), gym.owner.cookies, { postKey: randomUUID(), body: "From the gym", photos: [] });
      expect(res.statusCode).toBe(201);
      // Theirs, so no Report; a staff post, so no member's Remove either.
      expect((await feed(gym, gym.owner)).posts[0]).toMatchObject({ wrote: true, own: false, fromMember: false });
      expect((await feed(gym, reader)).posts[0]).toMatchObject({ wrote: false, own: false });
      const mine = await add(gym, reader, "From a member");
      expect(mine).toMatchObject({ wrote: true, own: true });
    },
    T,
  );

  it(
    "a stranger pressing Report or Remove again and again is told 'not found' every time, never 'slow down'",
    async () => {
      const gym = await makeGym("Order House");
      const writer = await member(gym, "Wendy Writer");
      const post = await add(gym, writer, "Not yours to touch");
      const stranger = await signedIn("Sam Stranger");
      const wifi = desk();
      const answers = new Set<number>();
      for (let i = 0; i < 62; i++) {
        answers.add((await inject("POST", `${posts(gym.id)}/${post.id}/report`, stranger.cookies, { reason: "spam" }, wifi)).statusCode);
        answers.add((await inject("DELETE", `${posts(gym.id)}/mine/${post.id}`, stranger.cookies, undefined, wifi)).statusCode);
      }
      expect([...answers]).toEqual([404]);
      // A member's own limit is still there: the 61st press in the hour is refused.
      const presser = await member(gym, "Pat Presser");
      const codes: number[] = [];
      for (let i = 0; i < 61; i++) codes.push((await inject("POST", `${posts(gym.id)}/${post.id}/report`, presser.cookies, { reason: "spam" }, wifi)).statusCode);
      expect([codes[0], codes[59], codes[60]]).toEqual([200, 200, 429]);
    },
    T,
  );

  it(
    "a report and a removal at the same moment leave no open report behind",
    async () => {
      const gym = await makeGym("Race House");
      const writer = await member(gym, "Wendy Writer");
      const reporter = await member(gym, "Rex Reporter");
      for (let round = 0; round < 25; round++) {
        clock += 25 * HOUR;
        const post = await add(gym, writer, `Round ${String(round)}`);
        const [reportRes, removeRes] = await Promise.all([
          report(gym, reporter, post.id, "spam", either(round)),
          inject("DELETE", `${posts(gym.id)}/${post.id}`, gym.owner.cookies, undefined, nextIp(), either(round + 1)),
        ]);
        expect(removeRes.statusCode).toBe(200);
        expect([200, 404]).toContain(reportRes.statusCode);
      }
      expect(await count("open_reports", gym.id)).toBe(0);
      expect((await staffFeed(gym, gym.owner)).reportedCount).toBe(0);
    },
    T,
  );

  // ===========================================================================
  // THE STAFF TOOLS
  // ===========================================================================

  it(
    "the list, Keep, the switch and stopping a person are for this gym's staff holding the tick",
    async () => {
      const gym = await makeGym("Staff House");
      const writer = await member(gym, "Wendy Writer");
      const reporter = await member(gym, "Rex Reporter");
      const post = await add(gym, writer, "A private word about the gym");
      expect((await report(gym, reporter, post.id, "other")).statusCode).toBe(200);
      const other = await makeGym("Other Staff House");
      const stranger = await signedIn("Sam Stranger");
      const trainer = await signedIn("Tara Trainer");
      await addStaff(gym.id, trainer.userId, "trainer", ["members.read", "attendance.read"]);
      const ticked = await signedIn("Tina Ticked");
      await addStaff(gym.id, ticked.userId, "trainer", ["posts.manage"]);

      const calls: [string, "GET" | "POST" | "PUT" | "DELETE", string, unknown][] = [
        ["the reported list", "GET", `${posts(gym.id)}/reported`, undefined],
        ["Keep", "POST", `${posts(gym.id)}/${post.id}/keep`, { allReports: 1, reportsMark: "a".repeat(32) }],
        ["the switch", "PUT", `${posts(gym.id)}/settings`, { membersCanPost: false }],
        ["the stopped list", "GET", `${posts(gym.id)}/stopped`, undefined],
        ["stop a person", "PUT", `${posts(gym.id)}/stopped/${writer.userId}`, undefined],
        ["let a person post again", "DELETE", `${posts(gym.id)}/stopped/${writer.userId}`, undefined],
      ];
      const who: [string, Cookies, number][] = [
        ["nobody signed in", {}, 401],
        ["a stranger", stranger.cookies, 404],
        ["another gym's owner", other.owner.cookies, 404],
        ["a member", reporter.cookies, 404],
        ["a trainer without the tick", trainer.cookies, 403],
      ];
      for (const [name, cookies, status] of who) {
        for (const [what, method, path, payload] of calls) {
          const res = await inject(method, path, cookies, payload);
          expect({ name, what, status: res.statusCode }).toEqual({ name, what, status });
          expect(res.body).not.toMatch(/private word|Wendy/);
        }
      }
      expect(await count("open_reports", gym.id)).toBe(1);
      expect(await count("stops", gym.id)).toBe(0);
      expect((await staffFeed(gym, gym.owner)).membersCanPost).toBe(true);

      // A trainer the owner ticked can do all of it.
      expect((await reported(gym, ticked)).items).toHaveLength(1);
      expect((await stop(gym, ticked, writer.userId, true)).statusCode).toBe(200);
      expect((await keep(gym, ticked, post.id)).statusCode).toBe(200);

      // A person who was never this gym's member cannot be stopped here, and the other
      // gym's staff cannot reach this gym's member through their own address.
      expect((await stop(gym, gym.owner, stranger.userId, true)).statusCode).toBe(404);
      expect((await stop(other, other.owner, writer.userId, true)).statusCode).toBe(404);
      expect(await count("stops", other.id)).toBe(0);
      for (const bad of [{ membersCanPost: "yes" }, {}, { membersCanPost: true, extra: 1 }]) {
        expect((await inject("PUT", `${posts(gym.id)}/settings`, gym.owner.cookies, bad)).statusCode).toBe(400);
      }

      // A gym whose plan has lapsed: staff read, and change nothing.
      await lapse(gym.id);
      expect((await inject("GET", `${posts(gym.id)}/reported`, gym.owner.cookies)).statusCode).toBe(200);
      expect((await inject("GET", `${posts(gym.id)}/stopped`, gym.owner.cookies)).statusCode).toBe(200);
      expect((await setSwitch(gym, gym.owner, false)).statusCode).toBe(409);
      expect((await stop(gym, gym.owner, writer.userId, false)).statusCode).toBe(409);
      expect((await keep(gym, gym.owner, post.id)).statusCode).toBe(409);
    },
    T,
  );

  it(
    "a stopped person cannot post until staff let them, and their posts stay",
    async () => {
      const gym = await makeGym("Stop House");
      const writer = await member(gym, "Wendy Writer");
      const post = await add(gym, writer, "Before the stop");

      expect((await stop(gym, gym.owner, writer.userId, true)).statusCode).toBe(200);
      // Twice is once.
      expect((await stop(gym, gym.owner, writer.userId, true)).statusCode).toBe(200);
      expect(await count("stops", gym.id)).toBe(1);
      const refused = await send(gym, writer, "After the stop");
      expect({ status: refused.statusCode, error: errorOf(refused) }).toEqual({ status: 403, error: "posting_stopped" });
      expect((JSON.parse(refused.body) as { message: string }).message).toBe("The staff at Stop House have stopped you posting here. Speak to them at the front desk.");
      expect(shown(await feed(gym, writer))).toEqual(["Before the stop"]);
      expect((await staffFeed(gym, gym.owner)).posts[0]).toMatchObject({ id: post.id, authorId: writer.userId, authorStopped: true });
      // They still read, react and report, and remove their own.
      expect((await inject("PUT", `${posts(gym.id)}/${post.id}/reaction`, writer.cookies, { reaction: "like" })).statusCode).toBe(200);

      const list = await inject("GET", `${posts(gym.id)}/stopped`, gym.owner.cookies);
      expect((JSON.parse(list.body) as StoppedGymPostersResponse).people.map((p) => [p.userId, p.name])).toEqual([[writer.userId, "Wendy Writer"]]);

      expect((await stop(gym, gym.owner, writer.userId, false)).statusCode).toBe(200);
      expect((await send(gym, writer, "Allowed again")).statusCode).toBe(201);
      expect((JSON.parse((await inject("GET", `${posts(gym.id)}/stopped`, gym.owner.cookies)).body) as StoppedGymPostersResponse).people).toEqual([]);
      const logged = await sql<{ action: string; target_id: string }[]>`
        SELECT action, target_id::text AS target_id FROM audit_log
        WHERE gym_id = ${gym.id} AND action IN ('org.posting_stopped','org.posting_allowed') ORDER BY id`;
      expect(logged.map((r) => [r.action, r.target_id])).toEqual([
        ["org.posting_stopped", writer.userId],
        ["org.posting_allowed", writer.userId],
      ]);
    },
    T,
  );

  it(
    "the switch is off to start, and switching it off again leaves members' posts where they are",
    async () => {
      const gym = await makeGym("Switch House", false);
      const writer = await member(gym, "Wendy Writer");
      expect((await staffFeed(gym, gym.owner)).membersCanPost).toBe(false);
      expect((await feed(gym, writer)).posting).toBe("off");
      expect((await send(gym, writer, "Too early")).statusCode).toBe(403);

      expect((await setSwitch(gym, gym.owner, true)).statusCode).toBe(200);
      expect((await setSwitch(gym, gym.owner, true)).statusCode).toBe(200);
      await add(gym, writer, "While it was on");
      expect((await setSwitch(gym, gym.owner, false)).statusCode).toBe(200);
      expect((await send(gym, writer, "Too late")).statusCode).toBe(403);
      expect(shown(await feed(gym, writer))).toEqual(["While it was on"]);
      const logged = await sql<{ action: string }[]>`
        SELECT action FROM audit_log WHERE gym_id = ${gym.id} AND action LIKE 'org.member_posts_%' ORDER BY id`;
      expect(logged.map((r) => r.action)).toEqual(["org.member_posts_on", "org.member_posts_off"]);
    },
    T,
  );
});
