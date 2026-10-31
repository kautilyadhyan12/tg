// COMMENTS AND REPLIES ON UPDATES — the routes against real Postgres (DATABASE_URL-gated).
// ROADMAP Stage 5 17e; spec Part 3 §15.2.
//
// The worst thing this job could do to a real person: somebody they blocked, or a comment hidden
// after reports, still shows on their screen. That is the first test below.
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { GYM_MEMBER_COMMENTS_A_DAY, GYM_POST_COMMENT_MAX_CHARS, GYM_POST_COMMENT_WORDS, type GymPost, type GymPostComment, type GymPostCommentsResponse, type GymPostsResponse } from "@app/shared";
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
  JWT_SECRET: "posts-comments-routes-secret-012345678", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
type Method = "GET" | "POST" | "PUT" | "DELETE";

const T = 120_000;
const LIVE_PLAN = "zz_postc_live";

let ipCounter = 0;
const nextIp = () => `10.75.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("comments and replies on Updates (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let folder = "";
  let clock = new Date("2026-10-07T06:30:00Z").getTime();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'postc-t-%@example.com')`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_posts WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_post_blocks WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_post_stops WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'postc-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: Method, path: string, cookies: Cookies, payload?: unknown, remoteAddress = nextIp()) =>
    api().inject({ method, url: path, remoteAddress, cookies, ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }) });

  interface Person {
    userId: string;
    cookies: Cookies;
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `postc-t-${uniq()}@example.com`;
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
  const makeGym = async (name: string): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Leeds", country: "GB", timezone: "Europe/London" });
    expect(res.statusCode).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider) VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    expect((await inject("PUT", `/v1/orgs/${id}/posts/settings`, owner.cookies, { membersCanPost: true })).statusCode).toBe(200);
    return { id, owner };
  };
  const member = async (gym: Gym, name: string): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${gym.id}, ${person.userId}, '2026-01-01T00:00:00Z')`;
    return person;
  };

  const posts = (gymId: string) => `/v1/orgs/${gymId}/posts`;
  const onPost = (gymId: string, postId: string) => `${posts(gymId)}/${postId}/comments`;
  const one = (gymId: string, commentId: string) => `/v1/orgs/${gymId}/post-comments/${commentId}`;
  const addPost = async (gym: Gym, who: Person, body = "Leg day done"): Promise<GymPost> => {
    clock += 1000;
    const res = await inject("POST", `${posts(gym.id)}/mine`, who.cookies, { postKey: randomUUID(), body, photos: [] });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { post: GymPost }).post;
  };
  const send = (gym: Gym, who: Person, postId: string, body: string, over: { replyTo?: string; commentKey?: string } = {}, address?: string) => {
    clock += 1000;
    return inject("POST", onPost(gym.id, postId), who.cookies, { commentKey: randomUUID(), body, ...over }, address);
  };
  const comment = async (gym: Gym, who: Person, postId: string, body: string, replyTo?: string): Promise<GymPostComment> => {
    const res = await send(gym, who, postId, body, replyTo === undefined ? {} : { replyTo });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { comment: GymPostComment }).comment;
  };
  const read = async (gym: Gym, who: Person, postId: string): Promise<GymPostCommentsResponse> => {
    const res = await inject("GET", onPost(gym.id, postId), who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as GymPostCommentsResponse;
  };
  const replies = async (gym: Gym, who: Person, commentId: string): Promise<GymPostCommentsResponse> => {
    const res = await inject("GET", `${one(gym.id, commentId)}/replies`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as GymPostCommentsResponse;
  };
  const words = (page: GymPostCommentsResponse): string[] => page.comments.map((c) => c.body);
  const countOn = async (gym: Gym, who: Person, postId: string): Promise<number | undefined> => {
    const res = await inject("GET", posts(gym.id), who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    const feed = JSON.parse(res.body) as GymPostsResponse;
    return [...feed.pinned, ...feed.posts].find((p) => p.id === postId)?.commentCount;
  };
  const errorOf = (res: { body: string }): string => (JSON.parse(res.body) as { error: string }).error;
  const report = (gym: Gym, who: Person, commentId: string, reason = "unkind") => inject("POST", `${one(gym.id, commentId)}/report`, who.cookies, { reason });
  const block = (gym: Gym, who: Person, commentId: string) => inject("PUT", `${one(gym.id, commentId)}/block`, who.cookies);
  const reactTo = (gym: Gym, who: Person, commentId: string, reaction: string | null) => inject("PUT", `${one(gym.id, commentId)}/reaction`, who.cookies, { reaction });

  beforeAll(async () => {
    await cleanup();
    folder = await mkdtemp(join(tmpdir(), "aihg-posts-comments-test-"));
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), { redis: createMemoryRedis(), photoStore: createDiskPhotoStore(folder), orgs: { now: () => new Date(clock) } });
    await api().ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
    await rm(folder, { recursive: true, force: true });
  }, T);

  // ===========================================================================
  // THE WORST THING, FIRST
  // ===========================================================================

  it(
    "a blocked person's comments, and any comment hidden after reports, are not on the reader's screen by any road",
    async () => {
      const gym = await makeGym("Block Comments");
      const bully = await member(gym, "Barry Bully");
      const blocker = await member(gym, "Bea Blocker");
      const bystander = await member(gym, "Bob Bystander");
      const post = await addPost(gym, bystander);
      const cruel = await comment(gym, bully, post.id, "Look who skipped leg day");
      const under = await comment(gym, bystander, post.id, "Be kind", cruel.id);
      const fine = await comment(gym, bystander, post.id, "Well done");
      const cruelReply = await comment(gym, bully, post.id, "And you", fine.id);
      const answersBully = await comment(gym, bystander, post.id, "Stop it", cruelReply.id);

      expect((await block(gym, blocker, cruel.id)).statusCode).toBe(200);

      // The list, the replies under the comment left, and the count all agree.
      expect(words(await read(gym, blocker, post.id))).toEqual(["Well done"]);
      const left = await replies(gym, blocker, fine.id);
      expect(words(left)).toEqual(["Stop it"]);
      // The reply answering the blocked person does not name them to the one who blocked them.
      expect(left.comments[0]?.replyingTo).toBeNull();
      expect(await countOn(gym, blocker, post.id)).toBe(2);
      // By the comment's own addresses too.
      expect((await inject("GET", `${one(gym.id, cruel.id)}/replies`, blocker.cookies)).statusCode).toBe(404);
      expect((await reactTo(gym, blocker, cruel.id, "like")).statusCode).toBe(404);
      expect((await send(gym, blocker, post.id, "Hello", { replyTo: cruel.id })).statusCode).toBe(404);
      expect((await inject("GET", `${one(gym.id, under.id)}/replies`, blocker.cookies)).statusCode).toBe(404);

      // Nobody else loses anything.
      expect(words(await read(gym, bystander, post.id))).toEqual(["Look who skipped leg day", "Well done"]);
      expect((await replies(gym, bystander, fine.id)).comments.find((c) => c.id === answersBully.id)?.replyingTo).toBe("Barry B.");
      expect(await countOn(gym, bystander, post.id)).toBe(5);

      // Five people report the comment: gone for everyone but its writer, its replies with it.
      const reporters = await Promise.all(["A", "B", "C", "D", "E"].map((n) => member(gym, `Rep ${n}orter`)));
      for (const r of reporters.slice(0, 4)) expect((await report(gym, r, fine.id)).statusCode).toBe(200);
      expect(words(await read(gym, bully, post.id))).toContain("Well done");
      const last = reporters[4];
      if (last === undefined) throw new Error("no reporter");
      expect((await report(gym, last, fine.id)).statusCode).toBe(200);
      expect(words(await read(gym, bully, post.id))).not.toContain("Well done");
      expect((await inject("GET", `${one(gym.id, fine.id)}/replies`, bully.cookies)).statusCode).toBe(404);
      expect(await countOn(gym, bully, post.id)).toBe(2);
      // Its writer still reads it, marked. One of the five sending theirs again is answered as the first time.
      const own = (await read(gym, bystander, post.id)).comments.find((c) => c.id === fine.id);
      expect(own?.hidden).toBe(true);
      expect((await report(gym, last, fine.id)).statusCode).toBe(200);
    },
    T,
  );

  // ===========================================================================
  // STRANGERS
  // ===========================================================================

  it(
    "a stranger, a member of another gym, a former member and a lapsed gym's member all get the same 404",
    async () => {
      const gym = await makeGym("Tenancy Comments");
      const other = await makeGym("Other Comments");
      const writer = await member(gym, "Wendy Writer");
      const stranger = await signedIn("Sid Stranger");
      const elsewhere = await member(other, "Olive Other");
      const former = await member(gym, "Fred Former");
      await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym.id} AND user_id = ${former.userId}`;
      const post = await addPost(gym, writer);
      const c = await comment(gym, writer, post.id, "Words");
      const add = { commentKey: randomUUID(), body: "In" };
      const calls: [Method, string, unknown][] = [
        ["GET", onPost(gym.id, post.id), undefined],
        ["POST", onPost(gym.id, post.id), add],
        ["GET", `${one(gym.id, c.id)}/replies`, undefined],
        ["DELETE", one(gym.id, c.id), undefined],
        ["PUT", `${one(gym.id, c.id)}/reaction`, { reaction: "like" }],
        ["POST", `${one(gym.id, c.id)}/report`, { reason: "spam" }],
        ["PUT", `${one(gym.id, c.id)}/block`, undefined],
      ];
      for (const person of [stranger, elsewhere, former]) {
        for (const [method, path, body] of calls) {
          const res = await inject(method, path, person.cookies, body);
          expect({ path, status: res.statusCode, error: errorOf(res) }).toEqual({ path, status: 404, error: "org_not_found" });
          expect(res.body).not.toContain("Words");
        }
      }
      // Another gym's post and comment, through this gym's address: not found, and nothing kept.
      const theirPost = await addPost(other, elsewhere);
      const theirs = await comment(other, elsewhere, theirPost.id, "Theirs");
      expect((await inject("GET", onPost(gym.id, theirPost.id), writer.cookies)).statusCode).toBe(404);
      expect((await send(gym, writer, theirPost.id, "Cross")).statusCode).toBe(404);
      expect((await send(gym, writer, post.id, "Cross", { replyTo: theirs.id })).statusCode).toBe(404);
      expect((await reactTo(gym, writer, theirs.id, "like")).statusCode).toBe(404);
      expect((await inject("DELETE", one(gym.id, theirs.id), writer.cookies)).statusCode).toBe(404);
      const rows = await sql`SELECT 1 FROM gym_post_comments WHERE body = 'Cross'`;
      expect(rows.length).toBe(0);
      // The gym's plan lapses: its members are sent nothing.
      await sql`UPDATE subscriptions SET status = 'canceled' WHERE owner_type = 'gym' AND owner_id = ${gym.id}`;
      expect((await inject("GET", onPost(gym.id, post.id), writer.cookies)).statusCode).toBe(404);
      expect((await send(gym, writer, post.id, "After")).statusCode).toBe(404);
      // Signed out.
      expect((await inject("GET", onPost(gym.id, post.id), {})).statusCode).toBe(401);
    },
    T,
  );

  // ===========================================================================
  // COMMENTS, REPLIES, ORDER
  // ===========================================================================

  it(
    "replies sit one level under a comment, oldest first, 20 a page, and a reply to a reply names who it answers",
    async () => {
      const gym = await makeGym("Replies");
      const asha = await member(gym, "Asha Rao");
      const ben = await member(gym, "Ben Stone");
      const post = await addPost(gym, asha);
      const first = await comment(gym, asha, post.id, "First");
      const r1 = await comment(gym, ben, post.id, "Reply one", first.id);
      expect(r1.parentId).toBe(first.id);
      expect(r1.replyingTo).toBeNull();
      const r2 = await comment(gym, asha, post.id, "Reply two", r1.id);
      expect(r2.parentId).toBe(first.id);
      expect(r2.replyingTo).toBe("Ben S.");
      const top = await read(gym, ben, post.id);
      expect(words(top)).toEqual(["First"]);
      expect(top.comments[0]?.replyCount).toBe(2);
      expect(top.commenting).toBe("on");
      expect(words(await replies(gym, ben, first.id))).toEqual(["Reply one", "Reply two"]);
      expect(await countOn(gym, ben, post.id)).toBe(3);
      // A reply's address for a comment that is on another post.
      const otherPost = await addPost(gym, asha, "Other");
      expect((await send(gym, ben, otherPost.id, "Wrong post", { replyTo: first.id })).statusCode).toBe(404);

      // Pages: oldest first, never one twice, all of them reached.
      const many = await addPost(gym, asha, "Many");
      for (let i = 0; i < 23; i += 1) await comment(gym, ben, many.id, `c${String(i)}`);
      const p1 = await read(gym, ben, many.id);
      expect(p1.comments.length).toBe(20);
      expect(p1.comments[0]?.body).toBe("c0");
      expect(p1.next).not.toBeNull();
      const res = await inject("GET", `${onPost(gym.id, many.id)}?after=${encodeURIComponent(p1.next ?? "")}`, ben.cookies);
      const p2 = JSON.parse(res.body) as GymPostCommentsResponse;
      expect(words(p2)).toEqual(["c20", "c21", "c22"]);
      expect(p2.next).toBeNull();
      expect((await inject("GET", `${onPost(gym.id, many.id)}?after=nonsense`, ben.cookies)).statusCode).toBe(400);
    },
    T,
  );

  it(
    "words: 500 at most counted as the screen counts them, none is refused, and the bad-words check keeps nothing",
    async () => {
      const gym = await makeGym("Words");
      const asha = await member(gym, "Asha Rao");
      const post = await addPost(gym, asha);
      expect((await send(gym, asha, post.id, "😀".repeat(GYM_POST_COMMENT_MAX_CHARS))).statusCode).toBe(201);
      expect((await send(gym, asha, post.id, "a".repeat(GYM_POST_COMMENT_MAX_CHARS + 1))).statusCode).toBe(400);
      expect((await send(gym, asha, post.id, "   ")).statusCode).toBe(400);
      // Nothing that draws: it would show as a blank comment.
      expect((await send(gym, asha, post.id, "\u200B\u200B")).statusCode).toBe(400);
      // Room the screen counts after trimming, and the words kept trimmed.
      expect((await send(gym, asha, post.id, `${"😀".repeat(GYM_POST_COMMENT_MAX_CHARS)}\n`)).statusCode).toBe(201);
      expect((await send(gym, asha, post.id, `${"a".repeat(GYM_POST_COMMENT_MAX_CHARS)}${" ".repeat(600)}`)).statusCode).toBe(201);
      const res = await send(gym, asha, post.id, "you are a bastard");
      expect(res.statusCode).toBe(400);
      expect(errorOf(res)).toBe("comment_bad_words");
      expect(res.body).toContain("bastard");
      // Staff's filter words do not count against the day either: nothing was kept.
      const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_post_comments WHERE post_id = ${post.id}`;
      expect(rows[0]?.n).toBe(3);
      const saved = await comment(gym, asha, post.id, "  spaced out  ");
      expect(saved.body).toBe("spaced out");
    },
    T,
  );

  // ===========================================================================
  // SENT TWICE, AND THE DAY'S LIMIT
  // ===========================================================================

  it(
    "the same comment sent twice, one after the other or at once, is one comment; somebody else's key reads nothing",
    async () => {
      const gym = await makeGym("Twice");
      const asha = await member(gym, "Asha Rao");
      const ben = await member(gym, "Ben Stone");
      const post = await addPost(gym, asha);
      const commentKey = randomUUID();
      const a = await send(gym, asha, post.id, "Once", { commentKey });
      expect(a.statusCode).toBe(201);
      expect((JSON.parse(a.body) as { firstKept: boolean }).firstKept).toBe(true);
      const b = await send(gym, asha, post.id, "Changed since", { commentKey });
      expect(b.statusCode).toBe(201);
      const again = JSON.parse(b.body) as { firstKept: boolean; comment: GymPostComment };
      expect(again.firstKept).toBe(false);
      expect(again.comment.body).toBe("Once");
      const theirs = await send(gym, ben, post.id, "Not mine", { commentKey });
      expect(theirs.statusCode).toBe(409);
      expect(theirs.body).not.toContain("Once");

      const atOnceKey = randomUUID();
      const results = await Promise.all(Array.from({ length: 6 }, () => send(gym, asha, post.id, "At once", { commentKey: atOnceKey })));
      for (const r of results) expect(r.statusCode, r.body).toBe(201);
      expect(results.filter((r) => (JSON.parse(r.body) as { firstKept: boolean }).firstKept).length).toBe(1);
      const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_post_comments WHERE comment_key = ${atOnceKey}`;
      expect(rows[0]?.n).toBe(1);

      // Sent again after it was removed: said, and not made a second time.
      const gone = randomUUID();
      const first = JSON.parse((await send(gym, asha, post.id, "Soon gone", { commentKey: gone })).body) as { comment: GymPostComment };
      expect((await inject("DELETE", one(gym.id, first.comment.id), asha.cookies)).statusCode).toBe(200);
      const late = await send(gym, asha, post.id, "Soon gone", { commentKey: gone });
      expect(late.statusCode).toBe(404);
      expect(errorOf(late)).toBe("comment_not_found");
    },
    T,
  );

  it(
    "100 in any 24 hours, comments and replies together, removed ones counted, two at once counted in turn; another member is untouched",
    async () => {
      const gym = await makeGym("Day Limit");
      const asha = await member(gym, "Asha Rao");
      const ben = await member(gym, "Ben Stone");
      const post = await addPost(gym, asha);
      const c = await comment(gym, asha, post.id, "One");
      // The day filled through the database: the route's own limit would stop a loop first.
      const at = new Date(clock - 60 * 60 * 1000);
      await sql`
        INSERT INTO gym_post_comments (gym_id, post_id, author_user_id, by_member, comment_key, body, created_at, removed_at)
        SELECT ${gym.id}, ${post.id}, ${asha.userId}, true, gen_random_uuid(), 'filled', ${at}, ${at}
        FROM generate_series(1, ${GYM_MEMBER_COMMENTS_A_DAY - 2})`;
      const results = await Promise.all([send(gym, asha, post.id, "Race 1", { replyTo: c.id }), send(gym, asha, post.id, "Race 2")]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([201, 429]);
      const refused = results.find((r) => r.statusCode === 429);
      expect(refused === undefined ? "" : errorOf(refused)).toBe("comments_day_full");
      expect(refused?.body).toContain(GYM_POST_COMMENT_WORDS.day_full(23));
      // One that was kept, sent again on a full day, is answered with what was kept.
      const kept = JSON.parse(results.find((r) => r.statusCode === 201)?.body ?? "{}") as { comment: GymPostComment };
      const rows = await sql<{ comment_key: string }[]>`SELECT comment_key FROM gym_post_comments WHERE id = ${kept.comment.id}`;
      expect((await send(gym, asha, post.id, "again", { commentKey: rows[0]?.comment_key ?? "" })).statusCode).toBe(201);
      expect((await send(gym, ben, post.id, "Mine still goes")).statusCode).toBe(201);
      // A day on, it counts no more.
      clock += 24 * 60 * 60 * 1000;
      expect((await send(gym, asha, post.id, "Tomorrow")).statusCode).toBe(201);
    },
    T,
  );

  it(
    "fifty members at one fixed address can all read, comment and react",
    async () => {
      const gym = await makeGym("One Address");
      const owner = await member(gym, "Olga Owner");
      const post = await addPost(gym, owner);
      const people = await Promise.all(Array.from({ length: 50 }, (_, i) => member(gym, `Person ${String(i)}`)));
      const address = "10.76.0.9";
      for (const p of people) {
        const made = await send(gym, p, post.id, "Hello", {}, address);
        expect(made.statusCode, made.body).toBe(201);
        const id = (JSON.parse(made.body) as { comment: GymPostComment }).comment.id;
        expect((await inject("PUT", `${one(gym.id, id)}/reaction`, p.cookies, { reaction: "fire" }, address)).statusCode).toBe(200);
        expect((await inject("GET", onPost(gym.id, post.id), p.cookies, undefined, address)).statusCode).toBe(200);
      }
    },
    T,
  );

  // ===========================================================================
  // THE SWITCH AND THE STOP
  // ===========================================================================

  it(
    "comments off: those made stay and none can be added; a person stopped from posting can't comment, and still reads",
    async () => {
      const gym = await makeGym("Switch");
      const asha = await member(gym, "Asha Rao");
      const ben = await member(gym, "Ben Stone");
      const post = await addPost(gym, asha);
      const kept = randomUUID();
      expect((await send(gym, asha, post.id, "Before", { commentKey: kept })).statusCode).toBe(201);

      await sql`UPDATE gyms SET members_can_comment = false WHERE id = ${gym.id}`;
      const page = await read(gym, ben, post.id);
      expect(words(page)).toEqual(["Before"]);
      expect(page.commenting).toBe("off");
      const off = await send(gym, ben, post.id, "After");
      expect(off.statusCode).toBe(403);
      expect(errorOf(off)).toBe("commenting_off");
      // A reply lost on the way back still gets its answer.
      expect((await send(gym, asha, post.id, "Before", { commentKey: kept })).statusCode).toBe(201);
      const feed = JSON.parse((await inject("GET", posts(gym.id), ben.cookies)).body) as GymPostsResponse;
      expect(feed.commenting).toBe("off");
      await sql`UPDATE gyms SET members_can_comment = true WHERE id = ${gym.id}`;

      expect((await inject("PUT", `${posts(gym.id)}/stopped/${ben.userId}`, gym.owner.cookies)).statusCode).toBe(200);
      const stopped = await send(gym, ben, post.id, "Stopped");
      expect(stopped.statusCode).toBe(403);
      expect(errorOf(stopped)).toBe("commenting_stopped");
      expect((await read(gym, ben, post.id)).commenting).toBe("stopped");
      expect((await read(gym, asha, post.id)).commenting).toBe("on");
    },
    T,
  );

  // ===========================================================================
  // REACTIONS, REPORT, BLOCK, REMOVE
  // ===========================================================================

  it(
    "one reaction a person a comment or reply: set, changed and taken off; those of people who left don't count",
    async () => {
      const gym = await makeGym("Reactions");
      const asha = await member(gym, "Asha Rao");
      const ben = await member(gym, "Ben Stone");
      const post = await addPost(gym, asha);
      const c = await comment(gym, asha, post.id, "C");
      const r = await comment(gym, ben, post.id, "R", c.id);
      const first = JSON.parse((await reactTo(gym, ben, c.id, "like")).body) as { reactions: Record<string, number>; mine: string };
      expect(first.mine).toBe("like");
      expect(first.reactions["like"]).toBe(1);
      const changed = JSON.parse((await reactTo(gym, ben, c.id, "fire")).body) as { reactions: Record<string, number>; mine: string };
      expect(changed.reactions).toEqual({ like: 0, love: 0, strong: 0, fire: 1 });
      expect((await reactTo(gym, asha, r.id, "love")).statusCode).toBe(200);
      expect((await replies(gym, ben, c.id)).comments[0]?.reactions["love"]).toBe(1);
      const seen = (await read(gym, asha, post.id)).comments[0];
      expect(seen?.reactions["fire"]).toBe(1);
      expect(seen?.mine).toBeNull();
      expect((await reactTo(gym, ben, c.id, "nope")).statusCode).toBe(400);
      await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym.id} AND user_id = ${ben.userId}`;
      expect((await read(gym, asha, post.id)).comments[0]?.reactions["fire"]).toBe(0);
      await sql`UPDATE gym_members SET removed_at = NULL WHERE gym_id = ${gym.id} AND user_id = ${ben.userId}`;
      const cleared = JSON.parse((await reactTo(gym, ben, c.id, null)).body) as { reactions: Record<string, number>; mine: string | null };
      expect(cleared.mine).toBeNull();
      expect(cleared.reactions["fire"]).toBe(0);
    },
    T,
  );

  it(
    "report: once a person, with a reason, not on your own and with no audit line that names who; the reason list has no photo",
    async () => {
      const gym = await makeGym("Report");
      const asha = await member(gym, "Asha Rao");
      const ben = await member(gym, "Ben Stone");
      const post = await addPost(gym, asha);
      const c = await comment(gym, asha, post.id, "C");
      expect(errorOf(await report(gym, asha, c.id))).toBe("own_comment");
      expect((await report(gym, ben, c.id, "photo_of_someone")).statusCode).toBe(400);
      expect((await report(gym, ben, c.id)).statusCode).toBe(200);
      expect((await report(gym, ben, c.id, "spam")).statusCode).toBe(200);
      const rows = await sql<{ reason: string }[]>`SELECT reason FROM gym_post_comment_reports WHERE comment_id = ${c.id}`;
      expect(rows.map((r) => r.reason)).toEqual(["unkind"]);
      expect((await read(gym, ben, post.id)).comments[0]?.reported).toBe(true);
      expect((await read(gym, asha, post.id)).comments[0]?.reported).toBe(false);
      const audit = await sql`SELECT 1 FROM audit_log WHERE gym_id = ${gym.id} AND actor_user_id = ${ben.userId}`;
      expect(audit.length).toBe(0);
    },
    T,
  );

  it(
    "block: staff's comments can't be, your own can't be, the reactions go, and sending it twice is answered the same",
    async () => {
      const gym = await makeGym("Block");
      const asha = await member(gym, "Asha Rao");
      const ben = await member(gym, "Ben Stone");
      const post = await addPost(gym, ben);
      const c = await comment(gym, asha, post.id, "C");
      const mine = await comment(gym, ben, post.id, "Mine");
      expect((await reactTo(gym, ben, c.id, "like")).statusCode).toBe(200);
      expect((await inject("PUT", `${posts(gym.id)}/${(await addPost(gym, asha, "A post")).id}/reaction`, ben.cookies, { reaction: "love" })).statusCode).toBe(200);
      expect(errorOf(await block(gym, ben, mine.id))).toBe("own_comment");
      await sql`INSERT INTO gym_post_comments (gym_id, post_id, author_user_id, by_member, comment_key, body) VALUES (${gym.id}, ${post.id}, ${gym.owner.userId}, false, gen_random_uuid(), 'From staff')`;
      const page = await read(gym, ben, post.id);
      const staffs = page.comments.find((x) => x.body === "From staff");
      expect(staffs?.fromMember).toBe(false);
      expect(staffs?.authorId).toBeNull();
      expect(errorOf(await block(gym, ben, staffs?.id ?? ""))).toBe("gym_comment");

      expect((await block(gym, ben, c.id)).statusCode).toBe(200);
      expect((await block(gym, ben, c.id)).statusCode).toBe(200);
      const left = await sql`SELECT 1 FROM gym_post_comment_reactions WHERE comment_id = ${c.id}`;
      expect(left.length).toBe(0);
      const postReactions = await sql`SELECT 1 FROM gym_post_reactions WHERE gym_id = ${gym.id} AND user_id = ${ben.userId}`;
      expect(postReactions.length).toBe(0);
      // Their posts go too: one block.
      const feed = JSON.parse((await inject("GET", posts(gym.id), ben.cookies)).body) as GymPostsResponse;
      expect(feed.posts.map((p) => p.body)).not.toContain("A post");
      // Unblocked, they are back.
      const list = JSON.parse((await inject("GET", `${posts(gym.id)}/blocked`, ben.cookies)).body) as { people: { id: string }[] };
      expect((await inject("DELETE", `${posts(gym.id)}/blocked/${list.people[0]?.id ?? ""}`, ben.cookies)).statusCode).toBe(200);
      expect(words(await read(gym, ben, post.id))).toContain("C");
    },
    T,
  );

  it(
    "remove: your own only, and a comment's replies go with it; a removed post takes all of it; a post that goes mid-comment keeps none",
    async () => {
      const gym = await makeGym("Remove");
      const asha = await member(gym, "Asha Rao");
      const ben = await member(gym, "Ben Stone");
      const post = await addPost(gym, ben);
      const c = await comment(gym, asha, post.id, "C");
      const r = await comment(gym, ben, post.id, "R", c.id);
      const r2 = await comment(gym, asha, post.id, "R2", c.id);
      expect((await reactTo(gym, ben, r2.id, "like")).statusCode).toBe(200);
      expect((await report(gym, ben, r2.id)).statusCode).toBe(200);
      // Not theirs, not even as the post's writer.
      expect((await inject("DELETE", one(gym.id, c.id), ben.cookies)).statusCode).toBe(404);

      // A reply goes alone.
      expect((await inject("DELETE", one(gym.id, r.id), ben.cookies)).statusCode).toBe(200);
      expect(words(await replies(gym, asha, c.id))).toEqual(["R2"]);
      expect((await read(gym, asha, post.id)).comments[0]?.replyCount).toBe(1);
      // A comment takes its replies, their reactions and answers their reports.
      expect((await inject("DELETE", one(gym.id, c.id), asha.cookies)).statusCode).toBe(200);
      expect(words(await read(gym, ben, post.id))).toEqual([]);
      expect(await countOn(gym, ben, post.id)).toBe(0);
      expect((await inject("DELETE", one(gym.id, c.id), asha.cookies)).statusCode).toBe(404);
      expect((await send(gym, asha, post.id, "Too late", { replyTo: c.id })).statusCode).toBe(404);
      expect((await sql`SELECT 1 FROM gym_post_comment_reactions WHERE comment_id = ${r2.id}`).length).toBe(0);
      const report1 = await sql<{ outcome: string }[]>`SELECT outcome FROM gym_post_comment_reports WHERE comment_id = ${r2.id}`;
      expect(report1[0]?.outcome).toBe("removed");

      // A post removed by staff: everything on it is gone and marked so.
      const big = await addPost(gym, ben, "Big");
      const onBig = await comment(gym, asha, big.id, "On big");
      await comment(gym, ben, big.id, "Under", onBig.id);
      expect((await inject("DELETE", `${posts(gym.id)}/${big.id}`, gym.owner.cookies)).statusCode).toBe(200);
      expect((await inject("GET", onPost(gym.id, big.id), asha.cookies)).statusCode).toBe(404);
      const left = await sql`SELECT 1 FROM gym_post_comments WHERE post_id = ${big.id} AND removed_at IS NULL`;
      expect(left.length).toBe(0);

      // Comments racing a removal: whichever way the two fall, none stays live on a removed post.
      const raced = await addPost(gym, ben, "Raced");
      const races = await Promise.all([
        ...Array.from({ length: 6 }, (_, i) => send(gym, asha, raced.id, `Race ${String(i)}`)),
        inject("DELETE", `${posts(gym.id)}/${raced.id}`, gym.owner.cookies),
      ]);
      for (const res of races) expect([200, 201, 404]).toContain(res.statusCode);
      const alive = await sql`SELECT 1 FROM gym_post_comments WHERE post_id = ${raced.id} AND removed_at IS NULL`;
      expect(alive.length).toBe(0);
    },
    T,
  );

  it(
    "a writer who leaves takes their comment and the replies under it off the page, and brings them back on return",
    async () => {
      const gym = await makeGym("Leaver");
      const asha = await member(gym, "Asha Rao");
      const ben = await member(gym, "Ben Stone");
      const post = await addPost(gym, asha);
      const c = await comment(gym, ben, post.id, "By Ben");
      await comment(gym, asha, post.id, "Under Ben", c.id);
      await comment(gym, asha, post.id, "By Asha");
      expect(await countOn(gym, asha, post.id)).toBe(3);
      await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym.id} AND user_id = ${ben.userId}`;
      expect(words(await read(gym, asha, post.id))).toEqual(["By Asha"]);
      expect(await countOn(gym, asha, post.id)).toBe(1);
      expect((await inject("GET", `${one(gym.id, c.id)}/replies`, asha.cookies)).statusCode).toBe(404);
      await sql`UPDATE gym_members SET removed_at = NULL WHERE gym_id = ${gym.id} AND user_id = ${ben.userId}`;
      expect(words(await read(gym, asha, post.id))).toEqual(["By Ben", "By Asha"]);
      expect(await countOn(gym, asha, post.id)).toBe(3);
      // A deleted account hides them the same way, from the day it is deleted.
      await sql`UPDATE users SET status = 'deleted' WHERE id = ${ben.userId}`;
      expect(words(await read(gym, asha, post.id))).toEqual(["By Asha"]);
      await sql`UPDATE users SET status = 'active' WHERE id = ${ben.userId}`;
    },
    T,
  );

  it(
    "a post hidden after reports has no comments for anybody but its writer",
    async () => {
      const gym = await makeGym("Hidden By Reports");
      const asha = await member(gym, "Asha Rao");
      const ben = await member(gym, "Ben Stone");
      const post = await addPost(gym, asha);
      const c = await comment(gym, ben, post.id, "Under a post");
      await sql`UPDATE gym_posts SET hidden_at = now() WHERE id = ${post.id}`;
      expect((await inject("GET", onPost(gym.id, post.id), ben.cookies)).statusCode).toBe(404);
      expect((await inject("GET", `${one(gym.id, c.id)}/replies`, ben.cookies)).statusCode).toBe(404);
      expect((await reactTo(gym, ben, c.id, "like")).statusCode).toBe(404);
      expect(words(await read(gym, asha, post.id))).toEqual(["Under a post"]);
    },
    T,
  );

  it(
    "a blocked person's reaction isn't counted for the one who blocked them, and is for everybody else; one given to somebody the giver blocked counts for nobody",
    async () => {
      const gym = await makeGym("Reaction Block");
      const bully = await member(gym, "Barry Bully");
      const blocker = await member(gym, "Bea Blocker");
      const dev = await member(gym, "Dev Patel");
      const post = await addPost(gym, dev);
      const byDev = await comment(gym, dev, post.id, "By Dev");
      const byBully = await comment(gym, bully, post.id, "By Barry");
      expect((await reactTo(gym, bully, byDev.id, "fire")).statusCode).toBe(200);
      expect((await reactTo(gym, blocker, byDev.id, "fire")).statusCode).toBe(200);
      expect((await block(gym, blocker, byBully.id)).statusCode).toBe(200);
      const firesFor = async (who: Person) => (await read(gym, who, post.id)).comments.find((c) => c.id === byDev.id)?.reactions["fire"];
      expect(await firesFor(blocker)).toBe(1);
      expect(await firesFor(dev)).toBe(2);
      // One that landed just after the giver blocked the writer, past the block's own delete.
      await sql`INSERT INTO gym_post_comment_reactions (gym_id, comment_id, user_id, reaction) VALUES (${gym.id}, ${byBully.id}, ${blocker.userId}, 'love')`;
      expect((await read(gym, dev, post.id)).comments.find((c) => c.id === byBully.id)?.reactions["love"]).toBe(0);
    },
    T,
  );

  it(
    "a reaction given to a reply stays the giver's to take off after blocking who it sits under",
    async () => {
      const gym = await makeGym("Stuck Reaction");
      const asha = await member(gym, "Asha Rao");
      const ben = await member(gym, "Ben Stone");
      const dev = await member(gym, "Dev Patel");
      const post = await addPost(gym, dev);
      const byBen = await comment(gym, ben, post.id, "By Ben");
      const reply = await comment(gym, dev, post.id, "By Dev", byBen.id);
      expect((await reactTo(gym, asha, reply.id, "love")).statusCode).toBe(200);
      expect((await block(gym, asha, byBen.id)).statusCode).toBe(200);
      expect((await reactTo(gym, asha, reply.id, "love")).statusCode).toBe(404);
      expect((await reactTo(gym, asha, reply.id, null)).statusCode).toBe(200);
      expect((await replies(gym, dev, byBen.id)).comments[0]?.reactions["love"]).toBe(0);
      expect((await reactTo(gym, asha, reply.id, null)).statusCode).toBe(404);
    },
    T,
  );

  it(
    "a comment racing its post's removal: the removal held open, the comment waits and keeps nothing; a post removed answers its reactions and reports",
    async () => {
      const gym = await makeGym("Held Removal");
      const asha = await member(gym, "Asha Rao");
      const ben = await member(gym, "Ben Stone");
      const post = await addPost(gym, ben);
      const c = await comment(gym, asha, post.id, "Marked");
      expect((await reactTo(gym, ben, c.id, "like")).statusCode).toBe(200);
      expect((await report(gym, ben, c.id)).statusCode).toBe(200);
      expect((await inject("DELETE", `${posts(gym.id)}/${post.id}`, gym.owner.cookies)).statusCode).toBe(200);
      expect((await sql`SELECT 1 FROM gym_post_comment_reactions WHERE comment_id = ${c.id}`).length).toBe(0);
      const answered = await sql<{ outcome: string }[]>`SELECT outcome FROM gym_post_comment_reports WHERE comment_id = ${c.id}`;
      expect(answered[0]?.outcome).toBe("removed");

      const held = await addPost(gym, ben, "Held");
      let sent: Awaited<ReturnType<typeof send>> | undefined;
      await sql.begin(async (tx) => {
        await tx`UPDATE gym_posts SET removed_at = now() WHERE id = ${held.id}`;
        const away = send(gym, asha, held.id, "On its way").then((res) => {
          sent = res;
          return res;
        });
        void away;
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(sent).toBeUndefined();
      });
      await expect.poll(() => sent?.statusCode, { timeout: 10_000 }).toBe(404);
      expect((await sql`SELECT 1 FROM gym_post_comments WHERE post_id = ${held.id}`).length).toBe(0);
    },
    T,
  );

  it(
    "a post the reader may not read has no comments for them: by somebody they blocked",
    async () => {
      const gym = await makeGym("Hidden Post");
      const asha = await member(gym, "Asha Rao");
      const ben = await member(gym, "Ben Stone");
      const post = await addPost(gym, asha);
      const c = await comment(gym, ben, post.id, "Under a post");
      const blockRes = await inject("PUT", `${posts(gym.id)}/${post.id}/block`, ben.cookies);
      expect(blockRes.statusCode).toBe(200);
      expect((await inject("GET", onPost(gym.id, post.id), ben.cookies)).statusCode).toBe(404);
      expect((await send(gym, ben, post.id, "Still here")).statusCode).toBe(404);
      expect((await reactTo(gym, ben, c.id, "like")).statusCode).toBe(404);
      expect((await inject("GET", `${one(gym.id, c.id)}/replies`, ben.cookies)).statusCode).toBe(404);
      // Their own comment on it can still be removed: it is theirs.
      expect((await inject("DELETE", one(gym.id, c.id), ben.cookies)).statusCode).toBe(200);
    },
    T,
  );
});
