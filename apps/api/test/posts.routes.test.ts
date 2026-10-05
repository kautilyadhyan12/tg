// A GYM'S UPDATES — the routes against real Postgres (DATABASE_URL-gated) and the real disk
// store in a folder of the test's own. Spec Part 3 §15.2; ROADMAP 19b-i.
//
// The worst thing this job could do to a real person: a gym's post or photo read by
// somebody outside that gym, or a photo kept with the place it was taken. Those are the
// first two tests below.
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { GYM_POSTS_PAGE, type GymPost, type GymPostReactionResponse, type GymPostsResponse, type StaffGymPostsResponse } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { cleanPhoto } from "../src/modules/orgs/gymPage/photoBytes.js";
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
  JWT_SECRET: "gym-posts-routes-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 120_000;
const LIVE_PLAN = "zz_posts_live";
const NOON = new Date("2026-10-07T06:30:00Z");

const photo = (name: string): string => readFileSync(new URL(`./fixtures/photos/${name}`, import.meta.url)).toString("base64");
const IPHONE = photo("iphone16.jpg");
const PNG = photo("iphone16-exif.png");
/** One emoji: one character on the screen, two units in a JavaScript string. */
const FLEX = String.fromCodePoint(0x1f4aa);

/** The GPS block's tag, either byte order, anywhere before the picture starts. */
const hasGps = (bytes: Uint8Array): boolean => {
  const s = Buffer.from(bytes).toString("latin1");
  const scan = s.indexOf("\xff\xda", s.indexOf("\xff\xc0"));
  const header = s.slice(0, scan === -1 ? s.length : scan);
  return /\x88\x25|\x25\x88/.test(header) || header.includes("iPhone");
};

let ipCounter = 0;
const nextIp = () => `10.71.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
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
const uniq =(): string => `${String(Date.now())}${String(seq++)}`;

d("a gym's Updates (real Postgres, real disk)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let folder = "";
  let clock = NOON.getTime();
  let app: App | undefined;
  /** A second api on the same database, folder and Redis: one api holds one connection, so
   *  two requests race only across two of them. */
  let second: App | undefined;
  let redis: RedisLike | undefined;
  const limits = (): RedisLike => {
    if (redis === undefined) throw new Error("beforeAll did not make the Redis");
    return redis;
  };
  const either = (n: number): App => (n % 2 === 0 ? api() : (second ?? api()));
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'posts-t-%@example.com')`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_posts WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'posts-t-%@example.com'`;
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
    const email = `posts-t-${uniq()}@example.com`;
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

  const makeGym = async (name: string, live = true): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Leeds", country: "GB", timezone: "Europe/London" });
    expect(res.statusCode).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    if (live) {
      await sql`
        INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
        VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    }
    return { id, owner };
  };
  const lapse = async (gymId: string) => {
    await sql`UPDATE subscriptions SET status = 'canceled' WHERE owner_type = 'gym' AND owner_id = ${gymId}`;
  };

  const addStaff = async (gymId: string, userId: string, role: "manager" | "trainer", privileges: string[] | null) => {
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gymId}, ${userId}, ${role}, ${privileges})`;
  };
  const joinGym = async (gymId: string, userId: string): Promise<void> => {
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${gymId}, ${userId}, '2026-01-01T00:00:00Z')`;
  };
  const member = async (gym: Gym, name: string): Promise<Person> => {
    const person = await signedIn(name);
    await joinGym(gym.id, person.userId);
    return person;
  };

  const posts = (gymId: string) => `/v1/orgs/${gymId}/posts`;
  const add = async (gym: Gym, who: Person, body: string, photos: string[] = [], postKey = randomUUID()): Promise<GymPost> => {
    clock += 1000;
    const res = await inject("POST", posts(gym.id), who.cookies, { postKey, body, photos });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { post: GymPost }).post;
  };
  const feed = async (gym: Gym, who: Person, before?: string): Promise<GymPostsResponse> => {
    const res = await inject("GET", `${posts(gym.id)}${before === undefined ? "" : `?before=${encodeURIComponent(before)}`}`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as GymPostsResponse;
  };
  const staffFeed = async (gym: Gym, who: Person): Promise<StaffGymPostsResponse> => {
    const res = await inject("GET", `${posts(gym.id)}/staff`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as StaffGymPostsResponse;
  };
  const react = (gym: Gym, who: Person, postId: string, reaction: string | null, target = api()) =>
    inject("PUT", `${posts(gym.id)}/${postId}/reaction`, who.cookies, { reaction }, nextIp(), target);
  /** A photo asked for again by a browser that already holds it. */
  const again = (path: string, photoId: string, cookies: Cookies) =>
    api().inject({ method: "GET", url: path, remoteAddress: nextIp(), cookies, headers: { "if-none-match": `"${photoId}"` } });
  const rowsOf = async (table: "gym_posts" | "gym_post_photos" | "gym_post_reactions", gymId: string): Promise<number> => {
    const rows =
      table === "gym_posts"
        ? await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_posts WHERE gym_id = ${gymId}`
        : table === "gym_post_photos"
          ? await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_post_photos WHERE gym_id = ${gymId}`
          : await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_post_reactions WHERE gym_id = ${gymId}`;
    return rows[0]?.n ?? 0;
  };
  const filesOf = async (gymId: string): Promise<string[]> => {
    try {
      return (await readdir(join(folder, "gym-post", gymId))).sort();
    } catch {
      return [];
    }
  };
  const audits = async (gymId: string, action: string): Promise<number> => {
    const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gymId} AND action = ${action}`;
    return rows[0]?.n ?? 0;
  };

  beforeAll(async () => {
    await cleanup();
    folder = await mkdtemp(join(tmpdir(), "aihg-posts-test-"));
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    // The real Redis where there is one (`test:local` and CI's database job set
    // TEST_REDIS_URL), so the limits run as the Lua production runs.
    redis = redisUrl === undefined || redisUrl === "" ? createMemoryRedis() : createIoRedis(redisUrl);
    for (let tries = 0; (await redis.incrWithTtl(`posts-ready:${randomUUID()}`, 30)) === null; tries++) {
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
    "nobody outside the gym reads a post, a name or a photo, or changes anything",
    async () => {
      const gym = await makeGym("Private House");
      const post = await add(gym, gym.owner, "Closed on Friday for the floor to be laid", [IPHONE]);
      const photoId = post.photos[0]?.id ?? "";
      const inside = await member(gym, "Vera Viewer");
      const other = await makeGym("Other House");
      const outsider = await member(other, "Olga Outsider");
      const stranger = await signedIn("Sam Stranger");
      const left = await member(gym, "Lena Left");
      await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym.id} AND user_id = ${left.userId}`;
      const trainer = await signedIn("Tara Trainer");
      await addStaff(gym.id, trainer.userId, "trainer", ["members.read", "attendance.read"]);
      const defaultTrainer = await signedIn("Dev Default");
      await addStaff(gym.id, defaultTrainer.userId, "trainer", null);

      const memberFeed = posts(gym.id);
      const staffRead = `${posts(gym.id)}/staff`;
      const photoPath = `${posts(gym.id)}/${post.id}/photos/${photoId}`;
      // A member's reaction: who gave it is for this gym's staff holding the tick alone.
      expect((await react(gym, inside, post.id, "fire")).statusCode).toBe(200);
      const whoReacted = `${posts(gym.id)}/${post.id}/reactions?reaction=fire`;
      const leaks = /Closed on Friday|floor to be laid|Private House Owner|Owner|Vera|Viewer/;

      // who, cookies, then the status of: the member feed, the staff feed, the photo, a
      // staff write, a reaction.
      const refused: [string, Cookies, number, number, number, number, number][] = [
        ["another gym's owner", other.owner.cookies, 404, 404, 404, 404, 404],
        ["another gym's member", outsider.cookies, 404, 404, 404, 404, 404],
        ["a stranger", stranger.cookies, 404, 404, 404, 404, 404],
        ["somebody the gym removed", left.cookies, 404, 404, 404, 404, 404],
        ["a trainer without the tick", trainer.cookies, 404, 403, 404, 403, 404],
        ["a trainer on the role's own ticks", defaultTrainer.cookies, 404, 403, 404, 403, 404],
        ["nobody signed in", {}, 401, 401, 401, 401, 401],
      ];
      for (const [who, cookies, feedStatus, staffStatus, photoStatus, writeStatus, reactStatus] of refused) {
        const reads: [string, number][] = [
          [memberFeed, feedStatus],
          [staffRead, staffStatus],
          [whoReacted, staffStatus],
          [photoPath, photoStatus],
        ];
        for (const [path, status] of reads) {
          const res = await inject("GET", path, cookies);
          expect(res.statusCode, `${who} GET ${path}`).toBe(status);
          expect(res.body, `${who} GET ${path}`).not.toMatch(leaks);
          expect(res.headers["content-type"], `${who} GET ${path}`).not.toMatch(/^image\//);
        }
        const writes = [
          await inject("POST", posts(gym.id), cookies, { postKey: randomUUID(), body: "Written by an outsider", photos: [] }),
          await inject("PUT", `${posts(gym.id)}/${post.id}/pin`, cookies, { pinned: true }),
          await inject("DELETE", `${posts(gym.id)}/${post.id}`, cookies),
        ];
        for (const res of writes) expect(res.statusCode, `${who} staff write`).toBe(writeStatus);
        expect((await react(gym, { userId: "", cookies }, post.id, "like")).statusCode, `${who} reaction`).toBe(reactStatus);
      }
      // A browser that says it already holds the photo is asked the same question: nobody
      // outside is told "the one you have".
      for (const [who, cookies, , , photoStatus] of refused) {
        expect((await again(photoPath, photoId, cookies)).statusCode, `${who} asking again`).toBe(photoStatus);
      }
      // A member of this gym is not its staff.
      expect((await inject("GET", staffRead, inside.cookies)).statusCode).toBe(404);
      // Nor is a member told who reacted, their own reaction included.
      const asMember = await inject("GET", whoReacted, inside.cookies);
      expect([asMember.statusCode, /Vera/.test(asMember.body)]).toEqual([404, false]);
      expect((await inject("GET", `${posts(other.id)}/${post.id}/reactions?reaction=fire`, other.owner.cookies)).statusCode).toBe(404);
      // This gym's owner reads it.
      const asOwner = await inject("GET", whoReacted, gym.owner.cookies);
      expect([asOwner.statusCode, JSON.parse(asOwner.body)]).toEqual([200, { reaction: "fire", total: 1, people: [{ name: "Vera Viewer", initials: "VV" }] }]);
      expect((await inject("DELETE", `${posts(gym.id)}/${post.id}`, inside.cookies)).statusCode).toBe(404);
      // This gym's post is not reached through another gym's address, by that gym's own people.
      expect((await inject("GET", `${posts(other.id)}/${post.id}/photos/${photoId}`, outsider.cookies)).statusCode).toBe(404);
      expect((await react(other, outsider, post.id, "like")).statusCode).toBe(404);
      expect((await inject("DELETE", `${posts(other.id)}/${post.id}`, other.owner.cookies)).statusCode).toBe(404);
      expect((await inject("PUT", `${posts(other.id)}/${post.id}/pin`, other.owner.cookies, { pinned: true })).statusCode).toBe(404);

      // Nothing was written by any of them.
      expect(await rowsOf("gym_posts", gym.id)).toBe(1);
      expect(await rowsOf("gym_post_reactions", gym.id)).toBe(1);
      expect(await rowsOf("gym_posts", other.id)).toBe(0);
      const kept = await sql<{ pinned_at: Date | null; removed_at: Date | null }[]>`SELECT pinned_at, removed_at FROM gym_posts WHERE id = ${post.id}`;
      expect(kept).toEqual([{ pinned_at: null, removed_at: null }]);
      // And the member inside reads all of it.
      expect((await feed(gym, inside)).posts.map((p) => p.body)).toEqual(["Closed on Friday for the floor to be laid"]);
      expect((await inject("GET", photoPath, inside.cookies)).statusCode).toBe(200);
    },
    T,
  );

  it(
    "a phone's photo is kept and sent without the place it was taken",
    async () => {
      expect(hasGps(Buffer.from(IPHONE, "base64")), "the fixture carries a position").toBe(true);
      const gym = await makeGym("Photo House");
      const viewer = await member(gym, "Vera Viewer");
      const post = await add(gym, gym.owner, "", [IPHONE, PNG]);
      expect(post.photos).toHaveLength(2);
      const files = await filesOf(gym.id);
      expect(files).toHaveLength(2);
      for (const file of files) expect(hasGps(await readFile(join(folder, "gym-post", gym.id, file))), file).toBe(false);
      for (const p of post.photos) {
        for (const who of [viewer, gym.owner]) {
          const res = await inject("GET", `${posts(gym.id)}/${post.id}/photos/${p.id}`, who.cookies);
          expect(res.statusCode).toBe(200);
          expect(res.headers["x-content-type-options"]).toBe("nosniff");
          expect(res.headers["cache-control"]).toBe("private, no-cache");
          expect(res.headers["etag"]).toBe(`"${p.id}"`);
          expect(hasGps(res.rawPayload)).toBe(false);
          expect(res.rawPayload.toString("latin1")).not.toMatch(/eXIf|iPhone/);
        }
      }
      const types = await sql<{ content_type: string }[]>`SELECT content_type FROM gym_post_photos WHERE post_id = ${post.id} ORDER BY position`;
      expect(types.map((r) => r.content_type)).toEqual(["image/jpeg", "image/png"]);
    },
    T,
  );

  // ===========================================================================
  // POSTING
  // ===========================================================================

  it(
    "staff post; members read it with the author's first name, staff with the whole name",
    async () => {
      const gym = await makeGym("Iron House");
      const manager = await signedIn("Maya Okafor");
      await addStaff(gym.id, manager.userId, "manager", null);
      const trainer = await signedIn("Tom Reed");
      await addStaff(gym.id, trainer.userId, "trainer", ["members.read", "posts.manage"]);
      const viewer = await member(gym, "Vera Viewer");

      const first = await add(gym, manager, "  New squat racks arrive Monday.\nCome and try them.  ");
      const later = await add(gym, trainer, "Saturday class moves to 10:00");
      expect(first.body).toBe("New squat racks arrive Monday.\nCome and try them.");
      expect(first.author).toEqual({ name: "Maya Okafor", initials: "MO" });

      const seen = await feed(gym, viewer);
      expect(seen).toMatchObject({ gymId: gym.id, gymName: "Iron House", status: "shown", pinned: [], next: null });
      expect(seen.posts.map((p) => [p.id, p.author.name, p.pinned, p.mine])).toEqual([
        [later.id, "Tom R.", false, null],
        [first.id, "Maya O.", false, null],
      ]);
      const forStaff = await staffFeed(gym, gym.owner);
      expect(forStaff.posts.map((p) => p.author.name)).toEqual(["Tom Reed", "Maya Okafor"]);
      expect(await audits(gym.id, "org.post_added")).toBe(2);
      const stored = await sql<{ author_user_id: string }[]>`SELECT author_user_id FROM gym_posts WHERE id = ${first.id}`;
      expect(stored[0]?.author_user_id).toBe(manager.userId);

      // An author whose app name is only their email's first part is never shown by it: the
      // gym's own name stands in, or their name on the gym's list once they have one.
      await sql`UPDATE users SET display_name = split_part(email::text, '@', 1) WHERE id = ${manager.userId}`;
      expect((await feed(gym, viewer)).posts[1]?.author).toEqual({ name: null, initials: "" });
      expect((await staffFeed(gym, gym.owner)).posts[1]?.author).toEqual({ name: null, initials: "" });
      const entry = await sql<{ id: string }[]>`
        INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source)
        VALUES (${gym.id}, 'Maya Okafor-Reid', ${`posts-r-${uniq()}@example.com`}, encode(sha256(${`posts-${uniq()}`}::bytea), 'hex'), 'typed')
        RETURNING id`;
      await sql`INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at) VALUES (${gym.id}, ${manager.userId}, ${entry[0]?.id ?? ""}, now())`;
      expect((await feed(gym, viewer)).posts[1]?.author).toEqual({ name: "Maya O.", initials: "MO" });
      expect((await staffFeed(gym, gym.owner)).posts[1]?.author).toEqual({ name: "Maya Okafor-Reid", initials: "MO" });

      // An author whose account is no longer active is not named.
      await sql`UPDATE users SET status = 'deleted' WHERE id = ${trainer.userId}`;
      expect((await feed(gym, viewer)).posts[0]?.author).toEqual({ name: null, initials: "" });
      expect((await staffFeed(gym, gym.owner)).posts[0]?.author).toEqual({ name: null, initials: "" });
    },
    T,
  );

  it("a post takes four photos of 1 MB each, and a photo one byte heavier is refused with nothing kept", async () => {
    const gym = await makeGym("Weigh House");
    // A real phone photo with its picture data made longer, so it weighs what is asked.
    const real = readFileSync(new URL("./fixtures/photos/iphone16.jpg", import.meta.url));
    const end = real.lastIndexOf(Buffer.from([0xff, 0xd9]));
    const weighing = (bytes: number): Buffer => Buffer.concat([real.subarray(0, end), Buffer.alloc(bytes - real.length, 0x55), real.subarray(end)]);
    // Written out, not read from the code: 1 MB is the rule.
    const MB = 1024 * 1024;
    const atLimit = weighing(MB);
    const over = weighing(MB + 1);
    const res = await inject("POST", posts(gym.id), gym.owner.cookies, { postKey: randomUUID(), body: "x", photos: [PNG, over.toString("base64")] });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ error: "photo_too_big", message: "Photo 2: This photo is bigger than 1 MB. Choose a smaller one." });
    // Well over, the request itself is refused: one photo by its length, four by the body's size.
    const heavy = await inject("POST", posts(gym.id), gym.owner.cookies, { postKey: randomUUID(), body: "x", photos: [weighing(MB + MB / 2).toString("base64")] });
    expect([heavy.statusCode, (JSON.parse(heavy.body) as { error: string }).error]).toEqual([400, "validation_error"]);
    const two = weighing(2 * MB).toString("base64");
    expect((await inject("POST", posts(gym.id), gym.owner.cookies, { postKey: randomUUID(), body: "x", photos: [two, two, two, two] })).statusCode).toBe(413);
    expect(await rowsOf("gym_posts", gym.id)).toBe(0);
    expect(await filesOf(gym.id)).toEqual([]);
    // The reader itself refuses it for a post and still takes it for a gym page.
    expect(cleanPhoto(new Uint8Array(over), MB)).toEqual({ ok: false, problem: "too_big" });
    expect(cleanPhoto(new Uint8Array(over)).ok).toBe(true);
    // The phone photos kept as fixtures come out of a post's reader as they do the gym page's: taken, the same bytes, the same turn.
    for (const name of ["iphone16.jpg", "samsung-a56-meta.jpg", "pixel7-meta.jpg"]) {
      const bytes = new Uint8Array(readFileSync(new URL(`./fixtures/photos/${name}`, import.meta.url)));
      const read = cleanPhoto(bytes, MB);
      expect(read.ok, name).toBe(true);
      expect(read, name).toEqual(cleanPhoto(bytes));
    }
    const b64 = atLimit.toString("base64");
    const full = await add(gym, gym.owner, "Four at the limit", [b64, b64, b64, b64]);
    expect(full.photos).toHaveLength(4);
    expect(await filesOf(gym.id)).toHaveLength(4);
  });

  it(
    "a post with nothing in it, too many words, too many photos or a file that is no photo is refused and nothing is kept",
    async () => {
      const gym = await makeGym("Strict House");
      const notAPhoto = Buffer.from("<html><script>alert(1)</script></html>").toString("base64");
      const refused: [string, unknown, number][] = [
        ["no words and no photo", { postKey: randomUUID(), body: "   ", photos: [] }, 400],
        ["2,001 characters", { postKey: randomUUID(), body: "a".repeat(2001), photos: [] }, 400],
        ["2,001 characters, eleven of them emoji", { postKey: randomUUID(), body: "a".repeat(1990) + FLEX.repeat(11), photos: [] }, 400],
        ["five photos", { postKey: randomUUID(), body: "x", photos: [PNG, PNG, PNG, PNG, PNG] }, 400],
        ["a key that is no key", { postKey: "nope", body: "x", photos: [] }, 400],
        ["a field nobody asked for", { postKey: randomUUID(), body: "x", photos: [], pinned: true }, 400],
        ["a character the database cannot keep", { postKey: randomUUID(), body: `a${String.fromCharCode(0)}b`, photos: [] }, 400],
        ["a web page named as a photo", { postKey: randomUUID(), body: "x", photos: [PNG, notAPhoto] }, 400],
      ];
      for (const [what, payload, status] of refused) {
        const res = await inject("POST", posts(gym.id), gym.owner.cookies, payload);
        expect(res.statusCode, what).toBe(status);
      }
      const bad = await inject("POST", posts(gym.id), gym.owner.cookies, { postKey: randomUUID(), body: "x", photos: [PNG, notAPhoto] });
      expect((JSON.parse(bad.body) as { message: string }).message).toBe("Photo 2: Choose a photo saved as JPEG, PNG or WebP.");
      expect(await rowsOf("gym_posts", gym.id)).toBe(0);
      expect(await filesOf(gym.id)).toEqual([]);
      // Exactly 2,000 characters and four photos are taken.
      const full = await add(gym, gym.owner, "a".repeat(2000), [PNG, PNG, PNG, PNG]);
      expect(full.photos).toHaveLength(4);
      expect(await filesOf(gym.id)).toHaveLength(4);
      // A character is one however a string holds it: 1,990 letters and ten emoji are the
      // 2,000 the screen counts, taken and sent back whole to staff and to a member.
      const emoji = "a".repeat(1990) + FLEX.repeat(10);
      expect(emoji.length).toBe(2010);
      const kept = await add(gym, gym.owner, emoji);
      expect(kept.body).toBe(emoji);
      const viewer = await member(gym, "Vera Viewer");
      expect((await feed(gym, viewer)).posts[0]?.body).toBe(emoji);
      expect((await staffFeed(gym, gym.owner)).posts[0]?.body).toBe(emoji);
    },
    T,
  );

  it(
    "a post's body is read only for somebody who may post: anyone else is answered without it",
    async () => {
      const gym = await makeGym("Unread House");
      const inside = await member(gym, "Vera Viewer");
      const stranger = await signedIn("Sam Stranger");
      const trainer = await signedIn("Tara Trainer");
      await addStaff(gym.id, trainer.userId, "trainer", ["members.read"]);
      // Not JSON at all: a server that read it first would answer 400 to everybody.
      const broken = (cookies: Cookies) =>
        api().inject({ method: "POST", url: posts(gym.id), remoteAddress: nextIp(), cookies, headers: { "content-type": "application/json" }, payload: '{"postKey": ' });
      expect((await broken({})).statusCode).toBe(401);
      expect((await broken(stranger.cookies)).statusCode).toBe(404);
      expect((await broken(inside.cookies)).statusCode).toBe(404);
      expect((await broken(trainer.cookies)).statusCode).toBe(403);
      expect((await broken(gym.owner.cookies)).statusCode).toBe(400);
      // An address that names no gym: answered for the address, its body never read (a
      // server that read it would say the JSON is broken).
      for (const cookies of [stranger.cookies, gym.owner.cookies]) {
        const res = await api().inject({ method: "POST", url: "/v1/orgs/not-a-gym/posts", remoteAddress: nextIp(), cookies, headers: { "content-type": "application/json" }, payload: '{"postKey": ' });
        expect([res.statusCode, (JSON.parse(res.body) as { error: string }).error]).toEqual([400, "validation_error"]);
      }
      expect((await api().inject({ method: "POST", url: "/v1/orgs/not-a-gym/posts", remoteAddress: nextIp(), headers: { "content-type": "application/json" }, payload: '{"postKey": ' })).statusCode).toBe(401);
      await lapse(gym.id);
      expect((await broken(gym.owner.cookies)).statusCode).toBe(409);
    },
    T,
  );

  it(
    "the same post sent five times at once, and once more later, is one post with one set of photos",
    async () => {
      const gym = await makeGym("Twice House");
      const postKey = randomUUID();
      const payload = { postKey, body: "Sent again and again", photos: [PNG] };
      const all = await Promise.all([1, 2, 3, 4, 5].map((n) => inject("POST", posts(gym.id), gym.owner.cookies, payload, nextIp(), either(n))));
      expect(all.map((r) => r.statusCode)).toEqual([201, 201, 201, 201, 201]);
      const ids = new Set(all.map((r) => (JSON.parse(r.body) as { post: GymPost }).post.id));
      expect(ids.size).toBe(1);
      const again = await add(gym, gym.owner, "Sent again and again", [PNG], postKey);
      expect(ids.has(again.id)).toBe(true);
      expect(await rowsOf("gym_posts", gym.id)).toBe(1);
      expect(await rowsOf("gym_post_photos", gym.id)).toBe(1);
      expect(await filesOf(gym.id)).toHaveLength(1);
      expect(await audits(gym.id, "org.post_added")).toBe(1);
    },
    T,
  );

  // ===========================================================================
  // REACTIONS
  // ===========================================================================

  it(
    "a member has one reaction a post: set, changed, taken off; five taps at once are one",
    async () => {
      const gym = await makeGym("React House");
      const post = await add(gym, gym.owner, "We reopen at six");
      const asha = await member(gym, "Asha Rao");
      const bilal = await member(gym, "Bilal Khan");
      const answer = async (who: Person, reaction: string | null): Promise<GymPostReactionResponse> => {
        const res = await react(gym, who, post.id, reaction);
        expect(res.statusCode, res.body).toBe(200);
        return JSON.parse(res.body) as GymPostReactionResponse;
      };

      expect(await answer(asha, "like")).toEqual({ reactions: { like: 1, strong: 0, fire: 0, love: 0 }, mine: "like" });
      expect(await answer(bilal, "like")).toEqual({ reactions: { like: 2, strong: 0, fire: 0, love: 0 }, mine: "like" });
      expect(await answer(asha, "fire")).toEqual({ reactions: { like: 1, strong: 0, fire: 1, love: 0 }, mine: "fire" });
      const seen = (await feed(gym, asha)).posts[0];
      expect([seen?.reactions, seen?.mine]).toEqual([{ like: 1, strong: 0, fire: 1, love: 0 }, "fire"]);
      expect((await feed(gym, bilal)).posts[0]?.mine).toBe("like");
      // Staff see the counts, and no reaction of their own.
      const forStaff = (await staffFeed(gym, gym.owner)).posts[0];
      expect([forStaff?.reactions, forStaff?.mine]).toEqual([{ like: 1, strong: 0, fire: 1, love: 0 }, null]);

      const taps = await Promise.all([1, 2, 3, 4, 5].map((n) => react(gym, bilal, post.id, "love", either(n))));
      expect(taps.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
      expect(await rowsOf("gym_post_reactions", gym.id)).toBe(2);
      expect(await answer(asha, null)).toEqual({ reactions: { like: 0, strong: 0, fire: 0, love: 1 }, mine: null });
      expect(await answer(asha, null)).toEqual({ reactions: { like: 0, strong: 0, fire: 0, love: 1 }, mine: null });

      // Staff see who gave each reaction, by whole name, newest first; members never do.
      const who = async (reaction: string) => {
        const res = await inject("GET", `${posts(gym.id)}/${post.id}/reactions?reaction=${reaction}`, gym.owner.cookies);
        return [res.statusCode, res.statusCode === 200 ? (JSON.parse(res.body) as { total: number; people: { name: string | null }[] }) : null] as const;
      };
      expect((await react(gym, asha, post.id, "fire")).statusCode).toBe(200);
      expect(await who("love")).toEqual([200, { reaction: "love", total: 1, people: [{ name: "Bilal Khan", initials: "BK" }] }]);
      expect(await who("fire")).toEqual([200, { reaction: "fire", total: 1, people: [{ name: "Asha Rao", initials: "AR" }] }]);
      expect(await who("like")).toEqual([200, { reaction: "like", total: 0, people: [] }]);
      expect((await who("angry"))[0]).toBe(400);
      expect((await inject("GET", `${posts(gym.id)}/${randomUUID()}/reactions?reaction=fire`, gym.owner.cookies)).statusCode).toBe(404);

      // Not one of the four, and a post that is not there.
      expect((await react(gym, asha, post.id, "angry")).statusCode).toBe(400);
      expect((await react(gym, asha, randomUUID(), "like")).statusCode).toBe(404);
      expect((await react(gym, asha, randomUUID(), null)).statusCode).toBe(404);
    },
    T,
  );

  it(
    "a reaction counts, and its giver is named, only while they are a live member with an active account; the names stop at 100",
    async () => {
      const gym = await makeGym("Counted House");
      const post = await add(gym, gym.owner, "Who is still here");
      const asha = await member(gym, "Asha Rao");
      const bilal = await member(gym, "Bilal Khan");
      const chen = await member(gym, "Chen Wu");
      for (const who of [asha, bilal, chen]) expect((await react(gym, who, post.id, "fire")).statusCode).toBe(200);
      const fire = async () => {
        const res = await inject("GET", `${posts(gym.id)}/${post.id}/reactions?reaction=fire`, gym.owner.cookies);
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as { total: number; people: { name: string | null }[] };
        return { total: body.total, names: body.people.map((p) => p.name).sort() };
      };
      expect(await fire()).toEqual({ total: 3, names: ["Asha Rao", "Bilal Khan", "Chen Wu"] });

      // The gym removes Bilal, and Chen's account is deleted: neither is counted or named,
      // for staff or for members, and the number always matches the names.
      await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym.id} AND user_id = ${bilal.userId}`;
      await sql`UPDATE users SET status = 'deleted' WHERE id = ${chen.userId}`;
      expect(await fire()).toEqual({ total: 1, names: ["Asha Rao"] });
      expect((await feed(gym, asha)).posts[0]?.reactions).toEqual({ like: 0, love: 0, strong: 0, fire: 1 });
      expect((await staffFeed(gym, gym.owner)).posts[0]?.reactions).toEqual({ like: 0, love: 0, strong: 0, fire: 1 });
      // Back in the gym, Bilal's reaction is his again.
      await sql`UPDATE gym_members SET removed_at = NULL WHERE gym_id = ${gym.id} AND user_id = ${bilal.userId}`;
      expect(await fire()).toEqual({ total: 2, names: ["Asha Rao", "Bilal Khan"] });

      // 105 more people: every one is counted, and the newest hundred are named.
      await sql`
        WITH made AS (
          INSERT INTO users (email, display_name)
          SELECT 'posts-t-many-' || n || '-' || ${uniq()} || '@example.com', 'Member ' || n FROM generate_series(1, 105) n
          RETURNING id
        ), joined AS (
          INSERT INTO gym_members (gym_id, user_id, joined_at) SELECT ${gym.id}, id, now() FROM made RETURNING user_id
        )
        INSERT INTO gym_post_reactions (gym_id, post_id, user_id, reaction, created_at)
        SELECT ${gym.id}, ${post.id}, user_id, 'fire', ${new Date(clock + 3_600_000)} FROM joined`;
      const many = await inject("GET", `${posts(gym.id)}/${post.id}/reactions?reaction=fire`, gym.owner.cookies);
      const body = JSON.parse(many.body) as { total: number; people: { name: string | null }[] };
      expect([body.total, body.people.length]).toEqual([107, 100]);
      expect(body.people.every((p) => p.name?.startsWith("Member ") === true)).toBe(true);
      expect((await feed(gym, asha)).posts[0]?.reactions.fire).toBe(107);
    },
    T,
  );

  it(
    "a reaction given at the moment its post is removed leaves nothing behind (two api instances, 25 rounds)",
    async () => {
      const gym = await makeGym("Moment House");
      const viewer = await member(gym, "Vera Viewer");
      for (let round = 0; round < 25; round++) {
        const post = await add(gym, gym.owner, `Round ${String(round)}`);
        const [reacted, removed] = await Promise.all([
          react(gym, viewer, post.id, "fire", either(round)),
          inject("DELETE", `${posts(gym.id)}/${post.id}`, gym.owner.cookies, undefined, nextIp(), either(round + 1)),
        ]);
        expect(removed.statusCode, `round ${String(round)}`).toBe(200);
        expect([200, 404], `round ${String(round)}`).toContain(reacted.statusCode);
      }
      expect(await rowsOf("gym_post_reactions", gym.id)).toBe(0);
    },
    T,
  );

  // ===========================================================================
  // PINNING AND REMOVING
  // ===========================================================================

  it(
    "up to three posts are pinned and come first; two pins at once never make a fourth",
    async () => {
      const gym = await makeGym("Pin House");
      const viewer = await member(gym, "Vera Viewer");
      const made: GymPost[] = [];
      for (const n of [1, 2, 3, 4, 5]) made.push(await add(gym, gym.owner, `Post ${String(n)}`));
      const id = (n: number): string => made[n - 1]?.id ?? "";
      const pin = (n: number, pinned: boolean) => {
        clock += 1000;
        return inject("PUT", `${posts(gym.id)}/${id(n)}/pin`, gym.owner.cookies, { pinned }, nextIp(), either(n));
      };

      expect((await pin(1, true)).statusCode).toBe(200);
      expect((await pin(1, true)).statusCode).toBe(200);
      expect((await pin(2, true)).statusCode).toBe(200);
      const seen = await feed(gym, viewer);
      expect(seen.pinned.map((p) => [p.body, p.pinned])).toEqual([
        ["Post 2", true],
        ["Post 1", true],
      ]);
      expect(seen.posts.map((p) => p.body)).toEqual(["Post 5", "Post 4", "Post 3"]);

      const both = await Promise.all([pin(3, true), pin(4, true)]);
      expect(both.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      const full = await pin(5, true);
      expect(full.statusCode).toBe(409);
      expect((JSON.parse(full.body) as { message: string }).message).toBe("You can pin up to 3 posts. Unpin one to pin this.");
      expect((await feed(gym, viewer)).pinned).toHaveLength(3);

      expect((await pin(1, false)).statusCode).toBe(200);
      expect((await pin(5, true)).statusCode).toBe(200);
      expect((await feed(gym, viewer)).pinned.map((p) => p.body)).not.toContain("Post 1");
      expect((await pin(1, true)).statusCode).toBe(409);
      expect((await inject("PUT", `${posts(gym.id)}/${randomUUID()}/pin`, gym.owner.cookies, { pinned: true })).statusCode).toBe(404);
      // Pinning the same post twice is one note.
      expect(await audits(gym.id, "org.post_pinned")).toBe(4);
    },
    T,
  );

  it(
    "a removed post is gone for everyone: the lists, its photos, its files and its reactions",
    async () => {
      const gym = await makeGym("Remove House");
      const viewer = await member(gym, "Vera Viewer");
      const keep = await add(gym, gym.owner, "This one stays", [PNG]);
      const post = await add(gym, gym.owner, "This one goes", [IPHONE, PNG]);
      expect((await inject("PUT", `${posts(gym.id)}/${post.id}/pin`, gym.owner.cookies, { pinned: true })).statusCode).toBe(200);
      expect((await react(gym, viewer, post.id, "strong")).statusCode).toBe(200);
      expect((await react(gym, viewer, keep.id, "like")).statusCode).toBe(200);
      const photoPath = `${posts(gym.id)}/${post.id}/photos/${post.photos[0]?.id ?? ""}`;
      expect((await inject("GET", photoPath, viewer.cookies)).statusCode).toBe(200);
      // A browser holding the photo is told to use it, with nothing sent again.
      const held = await again(photoPath, post.photos[0]?.id ?? "", viewer.cookies);
      expect([held.statusCode, held.rawPayload.length, held.headers["cache-control"]]).toEqual([304, 0, "private, no-cache"]);
      expect(await filesOf(gym.id)).toHaveLength(3);

      const removed = await inject("DELETE", `${posts(gym.id)}/${post.id}`, gym.owner.cookies);
      expect(removed.statusCode).toBe(200);
      expect(JSON.parse(removed.body)).toEqual({ removed: true });

      for (const list of [await feed(gym, viewer), await staffFeed(gym, gym.owner)]) {
        expect(list.pinned).toEqual([]);
        expect(list.posts.map((p) => p.body)).toEqual(["This one stays"]);
      }
      for (const who of [viewer, gym.owner]) {
        expect((await inject("GET", photoPath, who.cookies)).statusCode).toBe(404);
        // …and the browser that still holds it is told it is gone, not to go on showing it.
        expect((await again(photoPath, post.photos[0]?.id ?? "", who.cookies)).statusCode).toBe(404);
      }
      expect(await filesOf(gym.id)).toHaveLength(1);
      expect(await rowsOf("gym_post_photos", gym.id)).toBe(1);
      expect(await rowsOf("gym_post_reactions", gym.id)).toBe(1);
      const row = await sql<{ removed_by_user_id: string | null; pinned_at: Date | null; gone: boolean }[]>`
        SELECT removed_by_user_id, pinned_at, removed_at IS NOT NULL AS gone FROM gym_posts WHERE id = ${post.id}`;
      expect(row).toEqual([{ removed_by_user_id: gym.owner.userId, pinned_at: null, gone: true }]);
      expect(await audits(gym.id, "org.post_removed")).toBe(1);

      // Nothing more can be done to it.
      expect((await inject("DELETE", `${posts(gym.id)}/${post.id}`, gym.owner.cookies)).statusCode).toBe(404);
      expect((await inject("PUT", `${posts(gym.id)}/${post.id}/pin`, gym.owner.cookies, { pinned: true })).statusCode).toBe(404);
      expect((await react(gym, viewer, post.id, "like")).statusCode).toBe(404);
      expect(await rowsOf("gym_post_reactions", gym.id)).toBe(1);
      expect(await audits(gym.id, "org.post_removed")).toBe(1);
    },
    T,
  );

  it(
    "five removals at once remove it once",
    async () => {
      const gym = await makeGym("Race House");
      const post = await add(gym, gym.owner, "Removed by everyone", [PNG]);
      const all = await Promise.all([1, 2, 3, 4, 5].map((n) => inject("DELETE", `${posts(gym.id)}/${post.id}`, gym.owner.cookies, undefined, nextIp(), either(n))));
      expect(all.map((r) => r.statusCode).sort()).toEqual([200, 404, 404, 404, 404]);
      expect(await audits(gym.id, "org.post_removed")).toBe(1);
      expect(await filesOf(gym.id)).toEqual([]);
    },
    T,
  );

  // ===========================================================================
  // A GYM WHOSE PLAN HAS LAPSED
  // ===========================================================================

  it(
    "a gym with no live plan: members are sent nothing, staff read and change nothing",
    async () => {
      const gym = await makeGym("Lapsed House");
      const viewer = await member(gym, "Vera Viewer");
      const post = await add(gym, gym.owner, "Written while we were open", [PNG]);
      await lapse(gym.id);

      const seen = await inject("GET", posts(gym.id), viewer.cookies);
      expect(seen.statusCode).toBe(200);
      expect(seen.body).not.toMatch(/Written while/);
      expect(JSON.parse(seen.body)).toEqual({ gymId: gym.id, gymName: "Lapsed House", status: "paused", posting: "off", blockedCount: 0, supportEmail: null, pinned: [], posts: [], next: null });
      const photoPath = `${posts(gym.id)}/${post.id}/photos/${post.photos[0]?.id ?? ""}`;
      expect((await inject("GET", photoPath, viewer.cookies)).statusCode).toBe(404);
      expect((await react(gym, viewer, post.id, "like")).statusCode).toBe(404);

      const forStaff = await staffFeed(gym, gym.owner);
      expect(forStaff.posts.map((p) => p.body)).toEqual(["Written while we were open"]);
      expect((await inject("GET", photoPath, gym.owner.cookies)).statusCode).toBe(200);
      const writes = [
        await inject("POST", posts(gym.id), gym.owner.cookies, { postKey: randomUUID(), body: "x", photos: [] }),
        await inject("PUT", `${posts(gym.id)}/${post.id}/pin`, gym.owner.cookies, { pinned: true }),
        await inject("DELETE", `${posts(gym.id)}/${post.id}`, gym.owner.cookies),
      ];
      expect(writes.map((r) => r.statusCode)).toEqual([409, 409, 409]);
      expect(await rowsOf("gym_posts", gym.id)).toBe(1);
    },
    T,
  );

  // ===========================================================================
  // A LONG LIST
  // ===========================================================================

  it(
    "a long list comes a page at a time, every post once, newest first",
    async () => {
      const gym = await makeGym("Long House");
      const viewer = await member(gym, "Vera Viewer");
      const total = GYM_POSTS_PAGE * 2 + 3;
      // Two posts in the same instant, so the page's edge is told apart by the id.
      for (let n = 1; n <= total; n++) {
        await sql`
          INSERT INTO gym_posts (gym_id, author_user_id, post_key, body, created_at)
          VALUES (${gym.id}, ${gym.owner.userId}, gen_random_uuid(), ${`Post ${String(n)}`},
                  ${new Date(NOON.getTime() + Math.floor(n / 2) * 1000)})`;
      }
      const pinnedId = (await sql<{ id: string }[]>`SELECT id FROM gym_posts WHERE gym_id = ${gym.id} AND body = 'Post 7'`)[0]?.id ?? "";
      expect((await inject("PUT", `${posts(gym.id)}/${pinnedId}/pin`, gym.owner.cookies, { pinned: true })).statusCode).toBe(200);

      const seen: string[] = [];
      let before: string | undefined;
      let pages = 0;
      for (;;) {
        const page = await feed(gym, viewer, before);
        pages += 1;
        expect(page.pinned.map((p) => p.body)).toEqual(pages === 1 ? ["Post 7"] : []);
        seen.push(...page.posts.map((p) => p.body));
        if (page.next === null) break;
        expect(page.posts).toHaveLength(GYM_POSTS_PAGE);
        before = page.next;
      }
      expect(pages).toBe(3);
      expect(seen).toHaveLength(total - 1);
      expect(new Set(seen).size).toBe(total - 1);
      expect(seen).not.toContain("Post 7");
      const order = await sql<{ body: string }[]>`
        SELECT body FROM gym_posts WHERE gym_id = ${gym.id} AND pinned_at IS NULL ORDER BY created_at DESC, id DESC`;
      expect(seen).toEqual(order.map((r) => r.body));
      // A `before` that is not one is refused, never read as "the first page".
      const real = `2026-10-07T06:30:00.000Z_${pinnedId}`;
      expect((await inject("GET", `${posts(gym.id)}?before=${encodeURIComponent(real)}`, viewer.cookies)).statusCode).toBe(200);
      const notPlaces = [
        "yesterday",
        "2026-13-45T99:99:99Z_------------------------------------",
        "2026-10-07T06:30:00Z_------------------------------------",
        `2026-10-07T::::Z_${pinnedId}`,
        `0000-01-01T00:00:00Z_${pinnedId}`,
        `1969-12-31T23:59:59Z_${pinnedId}`,
        `2026-10-07T06:30:00.000Z${pinnedId}`,
        `_${pinnedId}`,
        "2026-10-07T06:30:00.000Z_",
        `2026-10-07 06:30:00_${pinnedId}`,
        `2026-10-07T06:30:00.000Z_${pinnedId}'; DROP TABLE gym_posts; --`,
        "x".repeat(81),
      ];
      for (const before of notPlaces) {
        for (const [who, path] of [
          [viewer, posts(gym.id)],
          [gym.owner, `${posts(gym.id)}/staff`],
        ] as const) {
          const res = await inject("GET", `${path}?before=${encodeURIComponent(before)}`, who.cookies);
          expect(res.statusCode, `${path} before=${before}`).toBe(400);
        }
      }
    },
    T,
  );

  // ===========================================================================
  // THE LIMIT
  // ===========================================================================

  it(
    "one member of staff posts 60 times an hour; a colleague at the same address is not held",
    async () => {
      const gym = await makeGym("Busy House");
      const colleague = await signedIn("Cara Colleague");
      await addStaff(gym.id, colleague.userId, "manager", null);
      const ip = desk();
      const send = (who: Person) => inject("POST", posts(gym.id), who.cookies, { postKey: randomUUID(), body: "Again", photos: [] }, ip);
      for (let n = 1; n <= 60; n++) expect((await send(gym.owner)).statusCode, `post ${String(n)}`).toBe(201);
      expect((await send(gym.owner)).statusCode).toBe(429);
      // Held before the body is read: one the schema would refuse is answered the same.
      expect((await inject("POST", posts(gym.id), gym.owner.cookies, { postKey: "nope" }, ip)).statusCode).toBe(429);
      expect((await send(colleague)).statusCode).toBe(201);
      expect(await rowsOf("gym_posts", gym.id)).toBe(61);
    },
    T,
  );

  it(
    "every limit: past a person's allowance they are refused and somebody else at the same address is not; the address has a ceiling of its own",
    async () => {
      const gym = await makeGym("Limits House");
      const post = await add(gym, gym.owner, "Limits", [PNG]);
      const photoPath = `${posts(gym.id)}/${post.id}/photos/${post.photos[0]?.id ?? ""}`;
      const members = [await member(gym, "Asha Rao"), await member(gym, "Bilal Khan"), await member(gym, "Chen Wu")];
      const staff = [gym.owner, await signedIn("Maya Manager"), await signedIn("Noor Manager")];
      for (const person of staff.slice(1)) await addStaff(gym.id, person.userId, "manager", null);
      /** Sets a counter to where that many requests would have left it, in one write: tens
       *  of thousands of real ones held the shared Redis and timed other suites out in CI. */
      const fill = async (key: string, n: number) => {
        const now = Number((await limits().get(key)) ?? "0");
        expect(await limits().setex(key, 3600, String(now + n))).toBe(true);
      };
      const rows: { name: string; max: number; ipMax: number; people: Person[]; ok: number; ask: (who: Person, ip: string) => Promise<{ statusCode: number }> }[] = [
        { name: "orgs_posts_read", max: 600, ipMax: 6000, people: members, ok: 200, ask: (who, ip) => inject("GET", posts(gym.id), who.cookies, undefined, ip) },
        { name: "orgs_posts_photo", max: 6000, ipMax: 60_000, people: members, ok: 200, ask: (who, ip) => inject("GET", photoPath, who.cookies, undefined, ip) },
        { name: "orgs_posts_react", max: 300, ipMax: 6000, people: members, ok: 200, ask: (who, ip) => inject("PUT", `${posts(gym.id)}/${post.id}/reaction`, who.cookies, { reaction: "like" }, ip) },
        { name: "orgs_posts_staff_read", max: 1200, ipMax: 6000, people: staff, ok: 200, ask: (who, ip) => inject("GET", `${posts(gym.id)}/staff`, who.cookies, undefined, ip) },
        { name: "orgs_posts_staff_write", max: 300, ipMax: 1500, people: staff, ok: 200, ask: (who, ip) => inject("PUT", `${posts(gym.id)}/${post.id}/pin`, who.cookies, { pinned: false }, ip) },
        { name: "orgs_posts_staff_post", max: 60, ipMax: 300, people: staff, ok: 201, ask: (who, ip) => inject("POST", posts(gym.id), who.cookies, { postKey: randomUUID(), body: "x", photos: [] }, ip) },
      ];
      for (const row of rows) {
        const [first, second, third] = row.people;
        if (first === undefined || second === undefined || third === undefined) throw new Error("three people a row");
        // One person at the allowance: refused, and the person beside them is not.
        const shared = desk();
        expect((await row.ask(first, shared)).statusCode, `${row.name}: before the allowance is used`).toBe(row.ok);
        await fill(`rl:${row.name}:id:${first.userId}`, row.max - 1);
        expect((await row.ask(first, shared)).statusCode, `${row.name}: the person's ${String(row.max + 1)}th`).toBe(429);
        expect((await row.ask(second, shared)).statusCode, `${row.name}: somebody else at the same address`).toBe(row.ok);
        // An address at its ceiling: refused there, whoever asks, and not anywhere else.
        const full = desk();
        await fill(`rl:${row.name}:ip:${full}`, row.ipMax);
        expect((await row.ask(third, full)).statusCode, `${row.name}: an address past ${String(row.ipMax)}`).toBe(429);
        expect((await row.ask(third, desk())).statusCode, `${row.name}: the same person elsewhere`).toBe(row.ok);
      }
      // The staff feed's other reader, who reacted: under its own limit.
      const who = `${posts(gym.id)}/${post.id}/reactions?reaction=like`;
      expect((await inject("GET", who, gym.owner.cookies, undefined, desk())).statusCode).toBe(429);
      expect((await inject("GET", who, staff[1]?.cookies ?? {}, undefined, desk())).statusCode).toBe(200);
    },
    T,
  );
});
