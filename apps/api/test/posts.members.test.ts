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
import postgres from "postgres";
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
import { createDiskPhotoStore } from "../src/modules/orgs/gymPage/photoStore.js";
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
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const either = (n: number): App => (n % 2 === 0 ? api() : (second ?? api()));

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'postsm-t-%@example.com')`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
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
  /** Keep, answering the reports made up to `upTo` (now, unless the test says what staff saw). */
  const keep = (gym: Gym, who: Person, postId: string, upTo = new Date(clock).toISOString()) =>
    inject("POST", `${posts(gym.id)}/${postId}/keep`, who.cookies, { upTo });
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
    const overrides = { redis, photoStore: createDiskPhotoStore(folder), orgs: { now: () => new Date(clock) } };
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
      for (const bad of [undefined, {}, { upTo: "yesterday" }, { upTo: new Date(clock).toISOString(), all: true }]) {
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

      const res = await keep(gym, gym.owner, post.id, seen?.lastReportedAt);
      expect({ status: res.statusCode, body: JSON.parse(res.body) as unknown }).toEqual({ status: 200, body: { kept: true, waiting: 1 } });
      // The report nobody read is still open, and the post is still on the list with it.
      const after = await reported(gym, gym.owner);
      expect(after.items.map((i) => ({ id: i.post.id, reports: i.reports, notes: i.notes }))).toEqual([
        { id: post.id, reports: 1, notes: ["That is my brother in the photo"] },
      ]);
      const rows = await sql<{ reason: string; outcome: string | null }[]>`SELECT reason, outcome FROM gym_post_reports WHERE post_id = ${post.id} ORDER BY created_at`;
      expect(rows.map((r) => [r.reason, r.outcome])).toEqual([
        ["spam", "kept"],
        ["photo_of_someone", null],
      ]);
      // Read again and kept: nothing is waiting now.
      const again = await keep(gym, gym.owner, post.id, after.items[0]?.lastReportedAt);
      expect(JSON.parse(again.body)).toEqual({ kept: true, waiting: 0 });
      expect((await reported(gym, gym.owner)).items).toEqual([]);
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
        ["Keep", "POST", `${posts(gym.id)}/${post.id}/keep`, { upTo: new Date(clock).toISOString() }],
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
