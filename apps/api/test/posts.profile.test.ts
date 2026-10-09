// ONE PERSON'S POSTS ON THEIR PROFILE, AND THE DAY'S PHOTO POSTS — the routes against real
// Postgres (DATABASE_URL-gated) and the real disk store in a folder of the test's own.
// Spec Part 3 §15.2, §15.3; ROADMAP 19b-ii-c.
//
// The worst thing this job could do to a real person: a profile sends its reader what
// Updates would not, the posts of somebody they blocked or of somebody who has left the
// gym. That is the first test below.
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  GYM_MEMBER_PHOTO_POSTS_A_DAY,
  GYM_POSTS_PAGE,
  type GymPost,
  type GymPostsResponse,
  type PersonGymPostsResponse,
  type StaffPersonGymPostsResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDiskPhotoStore } from "../src/modules/orgs/gymPage/photoStore.js";
import { getPersonPosts } from "../src/modules/orgs/posts/service.js";
import { createMemoryRedis } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "posts-profile-routes-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 120_000;
const HOUR = 60 * 60 * 1000;
const LIVE_PLAN = "zz_postsp_live";
const NOON = new Date("2026-10-07T06:30:00Z");

const IPHONE = readFileSync(new URL("./fixtures/photos/iphone16.jpg", import.meta.url)).toString("base64");

let ipCounter = 0;
const nextIp = () => `10.75.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("a person's posts on their profile, and the day's photo posts (real Postgres, real disk)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let folder = "";
  let clock = NOON.getTime();
  let app: App | undefined;
  /** A second api on the same database and folder. */
  let second: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const either = (n: number): App => (n % 2 === 0 ? api() : (second ?? api()));

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'postsp-t-%@example.com')`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_posts WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_post_blocks WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'postsp-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, cookies: Cookies, payload?: unknown, target = api()) =>
    target.inject({
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
    const email = `postsp-t-${uniq()}@example.com`;
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
  /** A gym on a live plan whose members may post. */
  const makeGym = async (name: string): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Leeds", country: "GB", timezone: "Europe/London" });
    expect(res.statusCode).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    expect((await inject("PUT", `/v1/orgs/${id}/posts/settings`, owner.cookies, { membersCanPost: true })).statusCode).toBe(200);
    return { id, owner };
  };
  const member = async (gym: Gym, name: string): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${gym.id}, ${person.userId}, '2026-01-01T00:00:00Z')`;
    return person;
  };

  const posts = (gymId: string) => `/v1/orgs/${gymId}/posts`;
  const send = (gym: Gym, who: Person, body: string, photos: string[] = [], postKey = randomUUID(), target = api()) => {
    clock += 1000;
    return inject("POST", `${posts(gym.id)}/mine`, who.cookies, { postKey, body, photos }, target);
  };
  const add = async (gym: Gym, who: Person, body: string, photos: string[] = []): Promise<GymPost> => {
    const res = await send(gym, who, body, photos);
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { post: GymPost }).post;
  };
  const staffAdd = async (gym: Gym, body: string): Promise<GymPost> => {
    clock += 1000;
    const res = await inject("POST", posts(gym.id), gym.owner.cookies, { postKey: randomUUID(), body, photos: [] });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { post: GymPost }).post;
  };
  const profilePath = (gym: Gym, userId: string, before?: string) => `${posts(gym.id)}/people/${userId}${before === undefined ? "" : `?before=${encodeURIComponent(before)}`}`;
  const staffPath = (gym: Gym, userId: string, before?: string) => `${posts(gym.id)}/staff/people/${userId}${before === undefined ? "" : `?before=${encodeURIComponent(before)}`}`;
  const profile = async (gym: Gym, reader: Person, userId: string, before?: string): Promise<PersonGymPostsResponse> => {
    const res = await inject("GET", profilePath(gym, userId, before), reader.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as PersonGymPostsResponse;
  };
  const staffProfile = async (gym: Gym, reader: Person, userId: string, before?: string): Promise<StaffPersonGymPostsResponse> => {
    const res = await inject("GET", staffPath(gym, userId, before), reader.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as StaffPersonGymPostsResponse;
  };
  const feed = async (gym: Gym, who: Person): Promise<GymPostsResponse> => {
    const res = await inject("GET", posts(gym.id), who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as GymPostsResponse;
  };
  const bodies = (p: { posts: { body: string }[] }): string[] => p.posts.map((post) => post.body);
  const photoPath = (gym: Gym, post: GymPost): string => `${posts(gym.id)}/${post.id}/photos/${post.photos[0]?.id ?? ""}`;
  const filesOf = async (gymId: string): Promise<string[]> => {
    try {
      return (await readdir(join(folder, "gym-post", gymId))).sort();
    } catch {
      return [];
    }
  };
  const errorOf = (res: { body: string }): string => (JSON.parse(res.body) as { error: string }).error;
  const NOBODY: PersonGymPostsResponse = { posts: [], next: null, total: 0, blocked: false };
  const NOBODY_STAFF = { posts: [], next: null, total: 0 };

  beforeAll(async () => {
    await cleanup();
    folder = await mkdtemp(join(tmpdir(), "aihg-posts-profile-test-"));
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    const overrides = { redis: createMemoryRedis(), photoStore: createDiskPhotoStore(folder), orgs: { now: () => new Date(clock) } };
    app = await buildApp(loadConfig(baseEnv), overrides);
    await api().ready();
    second = await buildApp(loadConfig(baseEnv), overrides);
    await second.ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await second?.close();
    await sql.end({ timeout: 5 });
    await rm(folder, { recursive: true, force: true });
  }, T);

  // ===========================================================================
  // THE WORST THING, FIRST
  // ===========================================================================

  it(
    "a profile sends its reader only what Updates sends them: nothing of a person they blocked, nothing of a person who has left, nothing the gym's staff wrote",
    async () => {
      const gym = await makeGym("Profile House");
      const writer = await member(gym, "Wendy Writer");
      const blocker = await member(gym, "Bea Blocker");
      const reader = await member(gym, "Rob Reader");
      const leaver = await member(gym, "Liam Leaver");
      // The owner also trains here, and posts for the gym as staff.
      await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${gym.id}, ${gym.owner.userId}, '2026-01-01T00:00:00Z')`;

      const first = await add(gym, writer, "Wendy's first", [IPHONE]);
      const pinned = await add(gym, writer, "Wendy's pinned one");
      expect((await inject("PUT", `${posts(gym.id)}/${pinned.id}/pin`, gym.owner.cookies, { pinned: true })).statusCode).toBe(200);
      await add(gym, writer, "Wendy's newest");
      const removed = await add(gym, writer, "Wendy took this down");
      expect((await inject("DELETE", `${posts(gym.id)}/mine/${removed.id}`, writer.cookies)).statusCode).toBe(200);
      await add(gym, reader, "Rob's own");
      await add(gym, leaver, "Liam's last session", [IPHONE]);
      await staffAdd(gym, "Closed on Monday");

      // Her posts, newest first, the pinned one in its own place, and nobody else's.
      const hers = await profile(gym, reader, writer.userId);
      expect(bodies(hers)).toEqual(["Wendy's newest", "Wendy's pinned one", "Wendy's first"]);
      expect(hers.blocked).toBe(false);
      expect(hers.next).toBeNull();
      // The number beside "Posts" is what the reader is sent: the removed one is not in it.
      expect(hers.total).toBe(3);
      expect(hers.posts.map((p) => p.authorId)).toEqual([writer.userId, writer.userId, writer.userId]);
      expect(hers.posts.map((p) => ({ name: p.author.name, own: p.own, fromMember: p.fromMember }))).toEqual(
        [0, 1, 2].map(() => ({ name: "Wendy W.", own: false, fromMember: true })),
      );
      // Her own profile is hers to remove from.
      expect((await profile(gym, writer, writer.userId)).posts.every((p) => p.own)).toBe(true);
      // The name on Updates carries the id the profile is asked by; a staff post carries none.
      const page = await feed(gym, reader);
      const onPage = [...page.pinned, ...page.posts];
      expect(onPage.find((p) => p.body === "Wendy's first")?.authorId).toBe(writer.userId);
      expect(onPage.find((p) => p.body === "Closed on Monday")?.authorId).toBeNull();

      // BLOCKED: the blocker is sent none of it, by the profile either.
      expect((await inject("PUT", `${posts(gym.id)}/${first.id}/block`, blocker.cookies)).statusCode).toBe(200);
      const blockedView = await inject("GET", profilePath(gym, writer.userId), blocker.cookies);
      expect(JSON.parse(blockedView.body)).toEqual({ posts: [], next: null, total: 0, blocked: true });
      expect(blockedView.body).not.toMatch(/Wendy/);
      expect((await inject("GET", photoPath(gym, first), blocker.cookies)).statusCode).toBe(404);
      // Nobody else loses anything.
      expect(bodies(await profile(gym, reader, writer.userId))).toHaveLength(3);

      // LEFT: gone with them, for members and for staff, and back if they rejoin.
      const liams = (await profile(gym, reader, leaver.userId)).posts;
      expect(liams.map((p) => p.body)).toEqual(["Liam's last session"]);
      await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym.id} AND user_id = ${leaver.userId}`;
      expect(await profile(gym, reader, leaver.userId)).toEqual(NOBODY);
      expect(await staffProfile(gym, gym.owner, leaver.userId)).toEqual(NOBODY_STAFF);
      expect((await inject("GET", profilePath(gym, writer.userId), leaver.cookies)).statusCode).toBe(404);
      // An id that is nobody's reads exactly as somebody who left, or who never posted.
      expect(await profile(gym, reader, randomUUID())).toEqual(NOBODY);
      expect(await profile(gym, reader, blocker.userId)).toEqual(NOBODY);
      await sql`UPDATE gym_members SET removed_at = NULL WHERE gym_id = ${gym.id} AND user_id = ${leaver.userId}`;
      expect(bodies(await profile(gym, reader, leaver.userId))).toEqual(["Liam's last session"]);
      // A deleted account's posts are gone too.
      await sql`UPDATE users SET status = 'deleted' WHERE id = ${leaver.userId}`;
      expect(await profile(gym, reader, leaver.userId)).toEqual(NOBODY);

      // THE GYM'S OWN POSTS are nobody's profile, though the owner trains here too.
      expect(await profile(gym, reader, gym.owner.userId)).toEqual(NOBODY);
      expect(await staffProfile(gym, gym.owner, gym.owner.userId)).toEqual(NOBODY_STAFF);

      // STAFF read the same posts by whole name, with whether the person is stopped.
      expect((await inject("PUT", `${posts(gym.id)}/stopped/${writer.userId}`, gym.owner.cookies)).statusCode).toBe(200);
      const staffView = await staffProfile(gym, gym.owner, writer.userId);
      expect(bodies(staffView)).toEqual(["Wendy's newest", "Wendy's pinned one", "Wendy's first"]);
      expect(staffView.total).toBe(3);
      expect(staffView.posts.map((p) => ({ name: p.author.name, authorId: p.authorId, stopped: p.authorStopped }))).toEqual(
        [0, 1, 2].map(() => ({ name: "Wendy Writer", authorId: writer.userId, stopped: true })),
      );
    },
    T,
  );

  it(
    "everybody outside the gym gets the 404 of a gym that does not exist, staff without the tick 403, and a lapsed gym sends its members nothing",
    async () => {
      const gym = await makeGym("Door House");
      const elsewhere = await makeGym("Other House");
      const writer = await member(gym, "Wendy Writer");
      const outsider = await member(elsewhere, "Otto Outsider");
      const nobody = await signedIn("Nina Nobody");
      const trainer = await signedIn("Tara Trainer");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${trainer.userId}, 'trainer', ${["members.read"]})`;
      const poster = await signedIn("Pat Poster");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${poster.userId}, 'trainer', ${["members.read", "posts.manage"]})`;
      await add(gym, writer, "Only for this gym");

      const tries: [string, Cookies, number, number][] = [
        ["nobody signed in", {}, 401, 401],
        ["somebody in no gym", nobody.cookies, 404, 404],
        ["another gym's member", outsider.cookies, 404, 404],
        ["another gym's owner", elsewhere.owner.cookies, 404, 404],
        ["this gym's trainer without the tick", trainer.cookies, 404, 403],
        ["this gym's trainer with the tick, who is no member", poster.cookies, 404, 200],
        ["this gym's member", writer.cookies, 200, 404],
        ["this gym's owner, who is no member", gym.owner.cookies, 404, 200],
      ];
      for (const [who, cookies, asMember, asStaff] of tries) {
        const m = await inject("GET", profilePath(gym, writer.userId), cookies);
        const s = await inject("GET", staffPath(gym, writer.userId), cookies);
        expect({ who, member: m.statusCode, staff: s.statusCode }).toEqual({ who, member: asMember, staff: asStaff });
        if (asMember !== 200) expect(m.body).not.toContain("Only for this gym");
        if (asStaff !== 200) expect(s.body).not.toContain("Only for this gym");
      }
      // A person of this gym asked for at another gym: that gym's posts only, which are none.
      expect(await profile(elsewhere, outsider, writer.userId)).toEqual(NOBODY);

      // What is not an id, or not a place in the list, is refused before anything is read.
      for (const path of [`${posts(gym.id)}/people/not-an-id`, `${posts(gym.id)}/staff/people/not-an-id`, profilePath(gym, writer.userId, "yesterday"), `${profilePath(gym, writer.userId)}?page=2`]) {
        const cookies = path.includes("/staff/") ? gym.owner.cookies : writer.cookies;
        expect({ path, status: (await inject("GET", path, cookies)).statusCode }).toEqual({ path, status: 400 });
      }

      // A lapsed gym: its members are sent nothing, its staff still read.
      await sql`UPDATE subscriptions SET status = 'canceled' WHERE owner_type = 'gym' AND owner_id = ${gym.id}`;
      const lapsed = await inject("GET", profilePath(gym, writer.userId), writer.cookies);
      expect(lapsed.statusCode).toBe(404);
      expect(lapsed.body).not.toContain("Only for this gym");
      expect(bodies(await staffProfile(gym, gym.owner, writer.userId))).toEqual(["Only for this gym"]);
    },
    T,
  );

  it(
    "a person's posts come a page at a time, each once, newest first, and never with anybody else's among them",
    async () => {
      const gym = await makeGym("Pages House");
      const writer = await member(gym, "Wendy Writer");
      const reader = await member(gym, "Rob Reader");
      const total = GYM_POSTS_PAGE * 2 + 5;
      for (const [who, label] of [[writer, "Wendy"], [reader, "Rob"]] as const) {
        await sql`
          INSERT INTO gym_posts (gym_id, author_user_id, post_key, body, by_member, created_at)
          SELECT ${gym.id}, ${who.userId}, gen_random_uuid(), ${label} || ' ' || n, true, '2026-10-01T00:00:00Z'::timestamptz + n * interval '1 minute'
          FROM generate_series(1, ${total}) n`;
      }
      // Two posts of the same instant sit either side of a page's edge.
      await sql`UPDATE gym_posts SET created_at = '2026-10-01T00:26:00Z' WHERE gym_id = ${gym.id} AND author_user_id = ${writer.userId} AND body = 'Wendy 25'`;

      const expected = Array.from({ length: total }, (_, i) => `Wendy ${String(total - i)}`);
      for (const read of [
        (before?: string) => profile(gym, reader, writer.userId, before),
        (before?: string) => staffProfile(gym, gym.owner, writer.userId, before),
      ]) {
        const seen: string[] = [];
        const sizes: number[] = [];
        let before: string | undefined;
        for (let i = 0; i < 5; i++) {
          const page = await read(before);
          sizes.push(page.posts.length);
          expect(page.total).toBe(total);
          seen.push(...bodies(page));
          if (page.next === null) break;
          before = page.next;
        }
        expect(sizes).toEqual([GYM_POSTS_PAGE, GYM_POSTS_PAGE, 5]);
        expect([...seen].sort()).toEqual([...expected].sort());
        expect(new Set(seen).size).toBe(total);
        expect(seen.filter((b) => b !== "Wendy 25" && b !== "Wendy 26")).toEqual(expected.filter((b) => b !== "Wendy 25" && b !== "Wendy 26"));
      }
    },
    T,
  );

  // ===========================================================================
  // THE DAY'S PHOTO POSTS (RULINGS 2026-10-05)
  // ===========================================================================

  it(
    "the day's ten say when the next post may be made, and a photo post that waits on both limits is told the later hour",
    async () => {
      const gym = await makeGym("Hours House");
      const writer = await member(gym, "Wendy Writer");
      const at = (hoursAgo: number) => new Date(clock - hoursAgo * HOUR);
      // Ten posts: the oldest, words alone, 20 hours old; the three with photos 10 hours old.
      await sql`
        INSERT INTO gym_posts (gym_id, author_user_id, post_key, body, by_member, created_at)
        SELECT ${gym.id}, ${writer.userId}, gen_random_uuid(), 'Words ' || n, true, ${at(20)}::timestamptz + n * interval '1 second'
        FROM generate_series(0, 6) n`;
      await sql`
        WITH p AS (
          INSERT INTO gym_posts (gym_id, author_user_id, post_key, body, by_member, created_at)
          SELECT ${gym.id}, ${writer.userId}, gen_random_uuid(), 'Photo ' || n, true, ${at(10)}::timestamptz + n * interval '1 second'
          FROM generate_series(0, 2) n
          RETURNING gym_id, id)
        INSERT INTO gym_post_photos (gym_id, post_id, storage_key, content_type, byte_size, width, height, position)
        SELECT gym_id, id, 'gym-post/' || gym_id || '/' || gen_random_uuid() || '.jpg', 'image/jpeg', 1000, 100, 100, 0 FROM p`;
      const message = (res: { body: string }): string => (JSON.parse(res.body) as { message: string }).message;

      const words = await send(gym, writer, "An eleventh");
      expect({ status: words.statusCode, error: errorOf(words) }).toEqual({ status: 429, error: "posts_day_full" });
      expect(message(words)).toBe("You've posted 10 times in the last 24 hours, which is the most allowed. You can post again in about 4 hours.");
      // With photos it waits for the oldest photo post too, 14 hours off: told that, not 4.
      const photo = await send(gym, writer, "An eleventh, with a photo", [IPHONE]);
      expect({ status: photo.statusCode, error: errorOf(photo) }).toEqual({ status: 429, error: "posts_day_full" });
      expect(message(photo)).toBe("You've posted 10 times in the last 24 hours, which is the most allowed. You can post again in about 14 hours.");
      // Four hours on the oldest words post has gone: words post, photos still wait ten hours.
      clock += 4 * HOUR + 60 * 1000;
      expect((await send(gym, writer, "Now there is room")).statusCode).toBe(201);
    },
    T,
  );

  it(
    "who is reading is asked before the limit: a stranger is 404 and the limit is never asked; a member's read asks it once",
    async () => {
      const gym = await makeGym("Limit House");
      const writer = await member(gym, "Wendy Writer");
      const stranger = await signedIn("Sid Stranger");
      // The route's limit is the last argument (the whole api's own ceiling of requests
      // sits in front of every route, so the order cannot be seen by counting replies).
      let asked = 0;
      const limit = (): Promise<boolean> => {
        asked += 1;
        return Promise.resolve(true);
      };
      await expect(getPersonPosts({ sql, now: () => new Date() }, stranger.userId, gym.id, writer.userId, undefined, limit)).rejects.toMatchObject({ statusCode: 404 });
      expect(asked).toBe(0);
      expect(await getPersonPosts({ sql, now: () => new Date() }, writer.userId, gym.id, writer.userId, undefined, limit)).toEqual(NOBODY);
      expect(asked).toBe(1);
      // A limit that has already answered leaves the read undone.
      expect(await getPersonPosts({ sql, now: () => new Date() }, writer.userId, gym.id, writer.userId, undefined, () => Promise.resolve(false))).toBeNull();
    },
    T,
  );

  it(
    `a member posts photos ${String(GYM_MEMBER_PHOTO_POSTS_A_DAY)} times in 24 hours and goes on posting words, however the posts arrive`,
    async () => {
      const gym = await makeGym("Photo House");
      const writer = await member(gym, "Wendy Writer");
      const quiet = await member(gym, "Quinn Quiet");
      const firstPhoto = await add(gym, writer, "Photo 1", [IPHONE]);
      for (let i = 2; i < GYM_MEMBER_PHOTO_POSTS_A_DAY; i++) await add(gym, writer, `Photo ${String(i)}`, [IPHONE]);
      // One left, and four sent at the same moment across two servers: one lands.
      const keys = [0, 1, 2, 3].map(() => randomUUID());
      const burst = await Promise.all([0, 1, 2, 3].map((n) => send(gym, writer, `Burst ${String(n)}`, [IPHONE], keys[n], either(n))));
      expect(burst.map((r) => r.statusCode).sort()).toEqual([201, 429, 429, 429]);
      expect(burst.filter((r) => r.statusCode === 429).map(errorOf)).toEqual(["posts_photo_day_full", "posts_photo_day_full", "posts_photo_day_full"]);
      expect(await filesOf(gym.id)).toHaveLength(GYM_MEMBER_PHOTO_POSTS_A_DAY);
      // The day's last photo post sent again under its key after a lost reply: the same post back.
      const landed = burst.findIndex((r) => r.statusCode === 201);
      const again = await send(gym, writer, `Burst ${String(landed)}`, [IPHONE], keys[landed]);
      expect(again.statusCode, again.body).toBe(201);
      expect((JSON.parse(again.body) as { post: GymPost }).post.id).toBe((JSON.parse(burst[landed]?.body ?? "{}") as { post: GymPost }).post.id);

      // Refused before a photo is cleaned or written, and in words that say what to do.
      // A post of photos alone is not told to take them off: nothing would be left to post.
      const bare = await send(gym, writer, "", ["AAAA"]);
      expect((JSON.parse(bare.body) as { message: string }).message).toBe(
        "You've posted photos 3 times in the last 24 hours, which is the most allowed. You can post photos again in about 24 hours.",
      );
      const unread = await send(gym, writer, "With a photo that is no photo", ["AAAA"]);
      expect({ status: unread.statusCode, error: errorOf(unread) }).toEqual({ status: 429, error: "posts_photo_day_full" });
      // It says when: the first photo post of the three is a few seconds old.
      expect((JSON.parse(unread.body) as { message: string }).message).toBe(
        "You've posted photos 3 times in the last 24 hours, which is the most allowed. Take the photos off to post the words now, or post photos again in about 24 hours.",
      );
      expect(await filesOf(gym.id)).toHaveLength(GYM_MEMBER_PHOTO_POSTS_A_DAY);

      // Words alone still post, and somebody else's photos are not held up.
      expect((await send(gym, writer, "Words are fine")).statusCode).toBe(201);
      expect((await send(gym, quiet, "My first", [IPHONE])).statusCode).toBe(201);
      // The gym's own posts carry photos without a count.
      for (let i = 0; i < GYM_MEMBER_PHOTO_POSTS_A_DAY + 1; i++) {
        clock += 1000;
        const res = await inject("POST", posts(gym.id), gym.owner.cookies, { postKey: randomUUID(), body: `Gym ${String(i)}`, photos: [IPHONE] });
        expect(res.statusCode, res.body).toBe(201);
      }

      // A photo post staff remove gives its place back as well: its photos are gone either way.
      const taken = await send(gym, quiet, "Second", [IPHONE]);
      await send(gym, quiet, "Third", [IPHONE]);
      expect((await send(gym, quiet, "Fourth", [IPHONE])).statusCode).toBe(429);
      expect((await inject("DELETE", `${posts(gym.id)}/${(JSON.parse(taken.body) as { post: GymPost }).post.id}`, gym.owner.cookies)).statusCode).toBe(200);
      expect((await send(gym, quiet, "After staff took one down", [IPHONE])).statusCode).toBe(201);

      // A photo post the member removes, its files gone, gives its place back.
      expect((await inject("DELETE", `${posts(gym.id)}/mine/${firstPhoto.id}`, writer.cookies)).statusCode).toBe(200);
      expect((await send(gym, writer, "In its place", [IPHONE])).statusCode).toBe(201);
      expect((await send(gym, writer, "One too many", [IPHONE])).statusCode).toBe(429);

      // A photo post from yesterday evening still counts this morning, and the sentence says
      // how long is left (Kd's click-through: two photo posts today, the third refused).
      clock += 19 * HOUR;
      // A words-only post older than every photo post: the hours are the photo posts' own.
      await sql`
        INSERT INTO gym_posts (gym_id, author_user_id, post_key, body, by_member, created_at)
        VALUES (${gym.id}, ${writer.userId}, gen_random_uuid(), 'Words from last night', true, ${new Date(clock - 23 * HOUR)})`;
      const morning = await send(gym, writer, "Next morning", [IPHONE]);
      expect(morning.statusCode).toBe(429);
      expect((JSON.parse(morning.body) as { message: string }).message).toMatch(/post photos again in about 5 hours\.$/);
      clock += 4 * HOUR + 50 * 60 * 1000;
      expect((JSON.parse((await send(gym, writer, "Nearly", [IPHONE])).body) as { message: string }).message).toMatch(/post photos again in under an hour\.$/);
      // 24 hours after the last of them, none counts.
      clock += 24 * HOUR;
      expect((await send(gym, writer, "A new day", [IPHONE])).statusCode).toBe(201);
    },
    T,
  );
});
