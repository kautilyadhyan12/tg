// BLOCK, THE BAD-WORDS CHECK AND THE SUPPORT ADDRESS — the routes against real Postgres
// (DATABASE_URL-gated) and the real disk store in a folder of the test's own. Spec Part 3
// §15.3; ROADMAP 19b-ii-b.
//
// The worst thing this job could do to a real person: somebody who blocked a person goes
// on being sent that person's post or photo. That is the first test below.
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { BlockedGymPostersResponse, GymPost, GymPostsResponse, StaffGymPostsResponse } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDiskPhotoStore } from "../src/modules/orgs/gymPage/photoStore.js";
import { createMemoryRedis } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "posts-safety-routes-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 120_000;
const LIVE_PLAN = "zz_postss_live";
const NOON = new Date("2026-10-07T06:30:00Z");
const SUPPORT = "help@gym-app.example";

const IPHONE = readFileSync(new URL("./fixtures/photos/iphone16.jpg", import.meta.url)).toString("base64");

let ipCounter = 0;
const nextIp = () => `10.74.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("block, the bad-words check and the support address (real Postgres, real disk)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let folder = "";
  let clock = NOON.getTime();
  let app: App | undefined;
  /** A second api on the same database and folder, and the one with a support address set. */
  let second: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const other = (): App => second ?? api();
  const either = (n: number): App => (n % 2 === 0 ? api() : other());

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'postss-t-%@example.com')`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_posts WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_post_blocks WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'postss-t-%@example.com'`;
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
    const email = `postss-t-${uniq()}@example.com`;
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
  const lapse = async (gymId: string) => {
    await sql`UPDATE subscriptions SET status = 'canceled' WHERE owner_type = 'gym' AND owner_id = ${gymId}`;
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
  const feed = async (gym: Gym, who: Person, target = api()): Promise<GymPostsResponse> => {
    const res = await inject("GET", posts(gym.id), who.cookies, undefined, target);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as GymPostsResponse;
  };
  const staffFeed = async (gym: Gym, who: Person): Promise<StaffGymPostsResponse> => {
    const res = await inject("GET", `${posts(gym.id)}/staff`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as StaffGymPostsResponse;
  };
  const blockedList = async (gym: Gym, who: Person): Promise<BlockedGymPostersResponse> => {
    const res = await inject("GET", `${posts(gym.id)}/blocked`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as BlockedGymPostersResponse;
  };
  const block = (gym: Gym, who: Person, postId: string, target = api()) => inject("PUT", `${posts(gym.id)}/${postId}/block`, who.cookies, undefined, target);
  const unblock = (gym: Gym, who: Person, blockId: string) => inject("DELETE", `${posts(gym.id)}/blocked/${blockId}`, who.cookies);
  const reactTo = (gym: Gym, who: Person, postId: string, reaction: string | null) => inject("PUT", `${posts(gym.id)}/${postId}/reaction`, who.cookies, { reaction });
  const shown = (f: GymPostsResponse | StaffGymPostsResponse): string[] => [...f.pinned, ...f.posts].map((p) => p.body);
  const photoPath = (gym: Gym, post: GymPost): string => `${posts(gym.id)}/${post.id}/photos/${post.photos[0]?.id ?? ""}`;
  const filesOf = async (gymId: string): Promise<string[]> => {
    try {
      return (await readdir(join(folder, "gym-post", gymId))).sort();
    } catch {
      return [];
    }
  };
  const blockRows = async (gymId: string): Promise<number> => {
    const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_post_blocks WHERE gym_id = ${gymId}`;
    return rows[0]?.n ?? 0;
  };
  const errorOf = (res: { body: string }): string => (JSON.parse(res.body) as { error: string }).error;

  beforeAll(async () => {
    await cleanup();
    folder = await mkdtemp(join(tmpdir(), "aihg-posts-safety-test-"));
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    const overrides = { redis: createMemoryRedis(), photoStore: createDiskPhotoStore(folder), orgs: { now: () => new Date(clock) } };
    app = await buildApp(loadConfig(baseEnv), overrides);
    await api().ready();
    second = await buildApp(loadConfig({ ...baseEnv, SUPPORT_EMAIL: SUPPORT }), overrides);
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
    "a blocked person's posts, photos and reactions are gone for the one who blocked them, and for nobody else",
    async () => {
      const gym = await makeGym("Block House");
      const bully = await member(gym, "Barry Bully");
      const blocker = await member(gym, "Bea Blocker");
      const bystander = await member(gym, "Bob Bystander");
      const cruel = await add(gym, bully, "Look who skipped leg day again", [IPHONE]);
      const second = await add(gym, bully, "And here she is on the treadmill");
      const pinned = await add(gym, bully, "Pinned by the gym");
      expect((await inject("PUT", `${posts(gym.id)}/${pinned.id}/pin`, gym.owner.cookies, { pinned: true })).statusCode).toBe(200);
      const fromGym = await staffAdd(gym, "Closed on Monday");
      const neutral = await add(gym, bystander, "First 5k done");
      // The bully and the bystander both react to the bystander's post.
      expect((await reactTo(gym, bully, neutral.id, "fire")).statusCode).toBe(200);
      expect((await reactTo(gym, bystander, fromGym.id, "like")).statusCode).toBe(200);
      expect((await reactTo(gym, bully, fromGym.id, "like")).statusCode).toBe(200);
      expect((await inject("GET", photoPath(gym, cruel), blocker.cookies)).statusCode).toBe(200);
      const before = await feed(gym, bully);

      const done = await block(gym, blocker, cruel.id);
      expect(done.statusCode, done.body).toBe(200);
      expect(JSON.parse(done.body)).toEqual({ blocked: true });

      // Gone for the blocker: the feed, the pinned post, the photo by its own address, and
      // every way of touching one of those posts.
      const mine = await feed(gym, blocker);
      expect(shown(mine).sort()).toEqual(["Closed on Monday", "First 5k done"]);
      expect(mine.blockedCount).toBe(1);
      expect(JSON.stringify(mine)).not.toMatch(/Barry|skipped leg day|treadmill|Pinned by the gym/);
      expect((await inject("GET", photoPath(gym, cruel), blocker.cookies)).statusCode).toBe(404);
      for (const post of [cruel, second, pinned]) {
        expect((await reactTo(gym, blocker, post.id, "like")).statusCode).toBe(404);
        expect((await inject("POST", `${posts(gym.id)}/${post.id}/report`, blocker.cookies, { reason: "unkind" })).statusCode).toBe(404);
      }
      // Their reactions are not counted for the blocker, on a page or in a reaction's answer.
      const counted = (f: GymPostsResponse, id: string) => [...f.pinned, ...f.posts].find((p) => p.id === id)?.reactions;
      expect(counted(mine, neutral.id)).toEqual({ like: 0, love: 0, strong: 0, fire: 0 });
      expect(counted(mine, fromGym.id)).toEqual({ like: 1, love: 0, strong: 0, fire: 0 });
      const tapped = await reactTo(gym, blocker, fromGym.id, "like");
      expect((JSON.parse(tapped.body) as { reactions: unknown }).reactions).toEqual({ like: 2, love: 0, strong: 0, fire: 0 });

      // Nobody else loses anything, and the blocked person is told nothing.
      const seen = await feed(gym, bystander);
      expect(shown(seen)).toHaveLength(5);
      expect(counted(seen, neutral.id)).toEqual({ like: 0, love: 0, strong: 0, fire: 1 });
      expect((await inject("GET", photoPath(gym, cruel), bystander.cookies)).statusCode).toBe(200);
      const after = await feed(gym, bully);
      expect(shown(after)).toEqual(shown(before));
      expect(after.blockedCount).toBe(0);
      expect(JSON.stringify(after)).not.toContain(blocker.userId);
      const staff = await staffFeed(gym, gym.owner);
      expect(shown(staff)).toHaveLength(5);
      expect(JSON.stringify(staff)).not.toContain(blocker.userId);
      const logged = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gym.id} AND actor_user_id = ${blocker.userId}`;
      expect(logged[0]?.n).toBe(0);

      // A post they write afterwards is not sent either.
      await add(gym, bully, "New one after the block", [IPHONE]);
      expect(shown(await feed(gym, blocker)).sort()).toEqual(["Closed on Monday", "First 5k done"]);

      // The list names them as members see each other, and Unblock brings everything back.
      const list = await blockedList(gym, blocker);
      expect(list.people.map((p) => ({ name: p.name, initials: p.initials }))).toEqual([{ name: "Barry B.", initials: "BB" }]);
      expect(JSON.stringify(list)).not.toContain(bully.userId);
      const off = await unblock(gym, blocker, list.people[0]?.id ?? "");
      expect(off.statusCode, off.body).toBe(200);
      const back = await feed(gym, blocker);
      expect(shown(back)).toHaveLength(6);
      expect(back.blockedCount).toBe(0);
      expect((await inject("GET", photoPath(gym, cruel), blocker.cookies)).statusCode).toBe(200);
      expect((await blockedList(gym, blocker)).people).toEqual([]);
    },
    T,
  );

  it(
    "the block holds on a second page, takes the blocker's own reactions with it, answers a repeat the same, and leaves the gym's posts",
    async () => {
      const gym = await makeGym("Review House");
      const elsewhere = await makeGym("Review Second");
      const bully = await member(gym, "Barry Bully");
      const blocker = await member(gym, "Bea Blocker");
      const bystander = await member(gym, "Bob Bystander");
      // Two pages: thirty posts each, a minute apart, the two writers taking turns.
      for (const [who, label] of [[bully, "Bully"], [bystander, "Fine"]] as const) {
        await sql`
          INSERT INTO gym_posts (gym_id, author_user_id, post_key, body, by_member, created_at)
          SELECT ${gym.id}, ${who.userId}, gen_random_uuid(), ${label} || ' ' || n, true, '2026-10-01T00:00:00Z'::timestamptz + n * interval '1 minute'
          FROM generate_series(1, 30) n`;
      }
      const cruel = await add(gym, bully, "With a photo", [IPHONE]);
      const fine = await add(gym, bystander, "A fine post");
      // The blocker reacted to both before blocking.
      expect((await reactTo(gym, blocker, cruel.id, "love")).statusCode).toBe(200);
      expect((await reactTo(gym, blocker, fine.id, "love")).statusCode).toBe(200);

      expect((await block(gym, blocker, cruel.id)).statusCode).toBe(200);
      // Sent again after a lost reply: the same answer, not "this post has been removed".
      const again = await block(gym, blocker, cruel.id, other());
      expect({ status: again.statusCode, body: JSON.parse(again.body) as unknown }).toEqual({ status: 200, body: { blocked: true } });
      expect((await block(gym, blocker, randomUUID())).statusCode).toBe(404);
      expect(await blockRows(gym.id)).toBe(1);

      // Their reaction to the blocked person's post went with the block; the other stays.
      const left = await sql<{ post_id: string }[]>`SELECT post_id FROM gym_post_reactions WHERE gym_id = ${gym.id} AND user_id = ${blocker.userId}`;
      expect(left.map((r) => r.post_id)).toEqual([fine.id]);
      const theirs = [...(await feed(gym, bully)).posts].find((p) => p.id === cruel.id);
      expect(theirs?.reactions).toEqual({ like: 0, love: 0, strong: 0, fire: 0 });

      // Every page, as the blocker: none of the blocked person's 31 posts, all 31 of the other's.
      const seen: string[] = [];
      let next: string | null = null;
      let pages = 0;
      do {
        const res = await inject("GET", next === null ? posts(gym.id) : `${posts(gym.id)}?before=${encodeURIComponent(next)}`, blocker.cookies);
        expect(res.statusCode, res.body).toBe(200);
        const page = JSON.parse(res.body) as GymPostsResponse;
        seen.push(...shown(page));
        next = page.next;
        pages++;
      } while (next !== null);
      expect(pages).toBeGreaterThan(1);
      expect(seen.filter((body) => body.startsWith("Bully") || body === "With a photo")).toEqual([]);
      expect(seen).toHaveLength(31);

      // The blocked person is also staff: what they post for the gym still shows, as the
      // Block box says, and cannot be blocked.
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${bully.userId}, 'manager', NULL)`;
      const asStaff = await inject("POST", posts(gym.id), bully.cookies, { postKey: randomUUID(), body: "Closed on Monday", photos: [] });
      expect(asStaff.statusCode, asStaff.body).toBe(201);
      const gymPost = (JSON.parse(asStaff.body) as { post: GymPost }).post;
      const sent = (await feed(gym, blocker)).posts.find((p) => p.id === gymPost.id);
      expect(sent).toMatchObject({ body: "Closed on Monday", fromMember: false });
      const refused = await block(gym, blocker, gymPost.id);
      expect({ status: refused.statusCode, error: errorOf(refused) }).toEqual({ status: 400, error: "gym_post" });

      // The blocker is staff too. Without the tick they are a member, and a blocked post's
      // photo is not theirs to read; holding it, they read the console's posts anyway.
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${blocker.userId}, 'trainer', ${["members.read"]})`;
      expect((await inject("GET", photoPath(gym, cruel), blocker.cookies)).statusCode).toBe(404);
      await sql`UPDATE gym_staff SET privileges = ${["members.read", "posts.manage"]} WHERE gym_id = ${gym.id} AND user_id = ${blocker.userId}`;
      expect((await inject("GET", photoPath(gym, cruel), blocker.cookies)).statusCode).toBe(200);

      // At another gym the same two share, nothing is blocked: the post and the reaction count.
      await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${elsewhere.id}, ${bully.userId}, '2026-01-01T00:00:00Z'), (${elsewhere.id}, ${blocker.userId}, '2026-01-01T00:00:00Z')`;
      const there = await staffAdd(elsewhere, "News from the second gym");
      expect((await reactTo(elsewhere, bully, there.id, "fire")).statusCode).toBe(200);
      expect((await feed(elsewhere, blocker)).posts[0]?.reactions).toEqual({ like: 0, love: 0, strong: 0, fire: 1 });

      // A gym whose plan has lapsed still says how many they blocked, so the list can be reached.
      await lapse(gym.id);
      expect(await feed(gym, blocker)).toMatchObject({ status: "paused", blockedCount: 1 });
    },
    T,
  );

  it(
    "a member's post with a bad word is not posted: the writer is told which word, at once, and nothing is kept or sent to staff",
    async () => {
      const gym = await makeGym("Check House");
      const writer = await member(gym, "Wendy Writer");
      const reader = await member(gym, "Rita Reader");
      await add(gym, writer, "Great class tonight");

      const refused = await send(gym, writer, "The new coach is a total tosser", [IPHONE]);
      expect(refused.statusCode).toBe(400);
      expect(JSON.parse(refused.body)).toMatchObject({
        error: "post_bad_words",
        message: "Your post wasn't posted because it has a word that isn't allowed here: tosser. Take it out and post again.",
      });
      const two = await send(gym, writer, "kys you paki");
      expect(JSON.parse(two.body)).toMatchObject({
        error: "post_bad_words",
        message: "Your post wasn't posted because it has words that aren't allowed here: kys, paki. Take them out and post again.",
      });

      // Nothing is kept: no row, no photo file, nothing on anybody's page, nothing for staff.
      const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_posts WHERE gym_id = ${gym.id}`;
      expect(rows[0]?.n).toBe(1);
      expect(await filesOf(gym.id)).toEqual([]);
      for (const who of [writer, reader]) expect(shown(await feed(gym, who))).toEqual(["Great class tonight"]);
      const staff = await staffFeed(gym, gym.owner);
      expect(shown(staff)).toEqual(["Great class tonight"]);
      expect(staff.reportedCount).toBe(0);
      const logged = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.member_post_added'`;
      expect(logged[0]?.n).toBe(1);

      // The same words with the bad one taken out are posted, under the same key.
      const key = randomUUID();
      expect((await send(gym, writer, "what a wanker of a session", [], key)).statusCode).toBe(400);
      const fixed = await send(gym, writer, "what a session", [], key, other());
      expect(fixed.statusCode, fixed.body).toBe(201);
      expect(shown(await feed(gym, reader))).toEqual(["what a session", "Great class tonight"]);
    },
    T,
  );

  it(
    "a refused post uses none of the day's ten, and the gym's own posts are not checked",
    async () => {
      const gym = await makeGym("Count House");
      const writer = await member(gym, "Wendy Writer");
      const reader = await member(gym, "Rita Reader");
      for (let i = 0; i < 12; i++) expect((await send(gym, writer, `try ${String(i)} you tosser`)).statusCode).toBe(400);
      for (let i = 1; i <= 10; i++) await add(gym, writer, `Post ${String(i)}`);
      // The day is full now. The words are answered first; a clean post is told the day is full.
      const full = await send(gym, writer, "one more, tosser");
      expect({ status: full.statusCode, error: errorOf(full) }).toEqual({ status: 400, error: "post_bad_words" });
      expect((await send(gym, writer, "one more")).statusCode).toBe(429);

      // Staff write for the gym: their words are not checked.
      await staffAdd(gym, "Whoever left this mess is a tosser");
      expect(shown(await feed(gym, reader))[0]).toBe("Whoever left this mess is a tosser");
    },
    T,
  );

  // ===========================================================================
  // WHO MAY
  // ===========================================================================

  it(
    "nobody outside the gym blocks, unblocks or reads a blocked list",
    async () => {
      const gym = await makeGym("Gate House");
      const writer = await member(gym, "Wendy Writer");
      const reader = await member(gym, "Rita Reader");
      const elsewhere = await makeGym("Other House");
      const outsider = await member(elsewhere, "Olga Outsider");
      const stranger = await signedIn("Sam Stranger");
      const left = await member(gym, "Lena Left");
      await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym.id} AND user_id = ${left.userId}`;
      const post = await add(gym, writer, "Morning all");
      expect((await block(gym, reader, post.id)).statusCode).toBe(200);
      const blockId = (await blockedList(gym, reader)).people[0]?.id ?? "";

      const outside: [string, Cookies, number][] = [
        ["nobody signed in", {}, 401],
        ["a stranger", stranger.cookies, 404],
        ["another gym's member", outsider.cookies, 404],
        ["another gym's owner", elsewhere.owner.cookies, 404],
        ["a member who left", left.cookies, 404],
      ];
      for (const [who, cookies, status] of outside) {
        const answers = [
          await inject("PUT", `${posts(gym.id)}/${post.id}/block`, cookies),
          await inject("GET", `${posts(gym.id)}/blocked`, cookies),
          await inject("DELETE", `${posts(gym.id)}/blocked/${blockId}`, cookies),
        ];
        expect({ who, statuses: answers.map((r) => r.statusCode) }).toEqual({ who, statuses: [status, status, status] });
        for (const res of answers) expect(res.body).not.toMatch(/Wendy|Morning all/);
      }
      // Somebody else's block is not theirs to take off, here or named at another gym.
      expect((await unblock(gym, writer, blockId)).statusCode).toBe(404);
      expect((await unblock(elsewhere, outsider, blockId)).statusCode).toBe(404);
      expect(await blockRows(gym.id)).toBe(1);

      // What cannot be blocked: your own post, and one the gym's staff wrote.
      const own = await block(gym, writer, post.id);
      expect({ status: own.statusCode, error: errorOf(own) }).toEqual({ status: 400, error: "own_post" });
      const fromGym = await staffAdd(gym, "Closed on Monday");
      const gymBlock = await block(gym, reader, fromGym.id);
      expect({ status: gymBlock.statusCode, error: errorOf(gymBlock) }).toEqual({ status: 400, error: "gym_post" });
      for (const bad of ["nope", randomUUID()]) {
        expect([400, 404]).toContain((await inject("PUT", `${posts(gym.id)}/${bad}/block`, reader.cookies)).statusCode);
        expect([400, 404]).toContain((await inject("DELETE", `${posts(gym.id)}/blocked/${bad}`, reader.cookies)).statusCode);
      }
      expect(await blockRows(gym.id)).toBe(1);
    },
    T,
  );

  it(
    "a block pressed five times at once is one block, and a block at one gym is not a block at another",
    async () => {
      const gym = await makeGym("Twice House");
      const elsewhere = await makeGym("Second House");
      const writer = await member(gym, "Wendy Writer");
      const reader = await member(gym, "Rita Reader");
      await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${elsewhere.id}, ${writer.userId}, '2026-01-01T00:00:00Z'), (${elsewhere.id}, ${reader.userId}, '2026-01-01T00:00:00Z')`;
      const here = await add(gym, writer, "At the first gym");
      await add(elsewhere, writer, "At the second gym");
      const presses = await Promise.all([0, 1, 2, 3, 4].map((n) => block(gym, reader, here.id, either(n))));
      // The post is gone for the reader once the first lands, so a later press finds no post.
      expect(presses.map((r) => r.statusCode).filter((s) => s !== 200 && s !== 404)).toEqual([]);
      expect(presses.some((r) => r.statusCode === 200)).toBe(true);
      expect(await blockRows(gym.id)).toBe(1);
      expect(shown(await feed(gym, reader))).toEqual([]);
      expect(shown(await feed(elsewhere, reader))).toEqual(["At the second gym"]);
      expect((await blockedList(elsewhere, reader)).people).toEqual([]);
    },
    T,
  );

  it(
    "a lapsed gym's members block nobody new, and still read and undo their blocks",
    async () => {
      const gym = await makeGym("Lapsed House");
      const writer = await member(gym, "Wendy Writer");
      const reader = await member(gym, "Rita Reader");
      const post = await add(gym, writer, "Morning all");
      expect((await block(gym, reader, post.id)).statusCode).toBe(200);
      await lapse(gym.id);
      expect((await block(gym, writer, post.id)).statusCode).toBe(404);
      const list = await blockedList(gym, reader);
      expect(list.people).toHaveLength(1);
      expect((await unblock(gym, reader, list.people[0]?.id ?? "")).statusCode).toBe(200);
      expect(await blockRows(gym.id)).toBe(0);
    },
    T,
  );

  // ===========================================================================
  // THE SUPPORT ADDRESS
  // ===========================================================================

  it(
    "members are sent the support address once one is set, and none before",
    async () => {
      const gym = await makeGym("Help House");
      const reader = await member(gym, "Rita Reader");
      expect((await feed(gym, reader)).supportEmail).toBeNull();
      expect((await feed(gym, reader, other())).supportEmail).toBe(SUPPORT);
      await lapse(gym.id);
      expect(await feed(gym, reader, other())).toMatchObject({ status: "paused", supportEmail: SUPPORT, blockedCount: 0 });
      expect(() => loadConfig({ ...baseEnv, SUPPORT_EMAIL: "not an address" })).toThrow(/SUPPORT_EMAIL/);
    },
    T,
  );
});
