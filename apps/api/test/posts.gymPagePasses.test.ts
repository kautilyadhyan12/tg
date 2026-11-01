// THE GYM PAGE'S TWO EXTRA PASSES (ROADMAP Stage 5 item 17): what they found, against real Postgres.
//
// The worst thing they found for a real person: somebody who asks for their data gets a file that leaves out
// what they wrote, with nothing to fetch the rest by. That is the first test below.
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { DISGUISED_WORDS, GYM_POST_COMMENT_COUNT_MOST, type GymPost, type GymPostComment, type GymPostCommentsResponse, type GymPostsResponse } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDiskPhotoStore } from "../src/modules/orgs/gymPage/photoStore.js";
import { buildUserExport } from "../src/modules/privacy/export.js";
import { createMemoryRedis } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "posts-gym-page-passes-secret-01234567", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
type Method = "GET" | "POST" | "PUT" | "DELETE";

const T = 180_000;
const LIVE_PLAN = "zz_gpp_live";

let ipCounter = 0;
const nextIp = () => `10.76.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

// ── Pictures, built byte by byte ──

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const named = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(named));
  return Buffer.concat([head, named, tail]);
}
/** A PNG that says it is this big; only its size is read. */
function pngOfSize(width: number, height: number): string {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, pngChunk("IHDR", ihdr), pngChunk("IDAT", Buffer.from([0x78, 0x9c, 0x63, 0, 0, 0, 1, 0, 1])), pngChunk("IEND", Buffer.alloc(0))]).toString("base64");
}
function riff(chunks: Buffer[]): Buffer {
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(body.length + 4, 4);
  head.write("WEBP", 8, "latin1");
  return Buffer.concat([head, body]);
}
function webpChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.write(type, 0, "latin1");
  head.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, data, Buffer.alloc(data.length % 2)]);
}
const u24 = (n: number): Buffer => Buffer.from([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff]);
function vp8x(width: number, height: number, flags = 0): Buffer {
  return webpChunk("VP8X", Buffer.concat([Buffer.from([flags, 0, 0, 0]), u24(width - 1), u24(height - 1)]));
}
function vp8(width: number, height: number): Buffer {
  const data = Buffer.alloc(10);
  data.set([0x9d, 0x01, 0x2a], 3);
  data.writeUInt16LE(width, 6);
  data.writeUInt16LE(height, 8);
  return webpChunk("VP8 ", data);
}
function anmf(x: number, y: number, width: number, height: number): Buffer {
  return webpChunk("ANMF", Buffer.concat([u24(x / 2), u24(y / 2), u24(width - 1), u24(height - 1), Buffer.alloc(4)]));
}

d("what the gym page's two extra passes found (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let folder = "";
  let clock = new Date("2026-10-07T06:30:00Z").getTime();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'gpp-t-%@example.com')`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_challenges WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_posts WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_post_blocks WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_post_stops WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'gpp-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: Method, path: string, cookies: Cookies, payload?: unknown, remoteAddress = nextIp()) =>
    api().inject({ method, url: path, remoteAddress, cookies, ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }) });

  interface Person {
    userId: string;
    cookies: Cookies;
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `gpp-t-${uniq()}@example.com`;
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
  const sendPost = (gym: Gym, who: Person, body: string, photos: string[] = []) => {
    clock += 1000;
    return inject("POST", `${posts(gym.id)}/mine`, who.cookies, { postKey: randomUUID(), body, photos });
  };
  const addPost = async (gym: Gym, who: Person, body = "Leg day done"): Promise<GymPost> => {
    const res = await sendPost(gym, who, body);
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { post: GymPost }).post;
  };
  const send = (gym: Gym, who: Person, postId: string, body: string, over: { replyTo?: string; commentKey?: string } = {}) => {
    clock += 1000;
    return inject("POST", onPost(gym.id, postId), who.cookies, { commentKey: randomUUID(), body, ...over });
  };
  const comment = async (gym: Gym, who: Person, postId: string, body: string, replyTo?: string): Promise<GymPostComment> => {
    const res = await send(gym, who, postId, body, replyTo === undefined ? {} : { replyTo });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { comment: GymPostComment }).comment;
  };
  const errorOf = (res: { body: string }): string => (JSON.parse(res.body) as { error: string }).error;
  const report = (gym: Gym, who: Person, commentId: string) => inject("POST", `${one(gym.id, commentId)}/report`, who.cookies, { reason: "unkind" });
  const block = (gym: Gym, who: Person, commentId: string) => inject("PUT", `${one(gym.id, commentId)}/block`, who.cookies);

  beforeAll(async () => {
    await cleanup();
    folder = await mkdtemp(join(tmpdir(), "aihg-gym-page-passes-"));
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), { redis, photoStore: createDiskPhotoStore(folder), orgs: { now: () => new Date(clock) } });
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
    "a person's download holds every comment and post they wrote, however many, each once",
    async () => {
      const gym = await makeGym("Download");
      const writer = await member(gym, "Wren Writer");
      const post = await addPost(gym, writer);
      // Past one page of what the download reads, with several at the very same instant across the page's edge.
      await sql`
        INSERT INTO gym_post_comments (gym_id, post_id, author_user_id, by_member, comment_key, body, created_at)
        SELECT ${gym.id}, ${post.id}, ${writer.userId}, true, gen_random_uuid(), 'words ' || n, timestamptz '2026-10-01T00:00:00Z' + (n / 40) * interval '1 microsecond'
        FROM generate_series(1, 2100) n`;
      await sql`
        INSERT INTO gym_posts (gym_id, author_user_id, post_key, body, by_member, created_at)
        SELECT ${gym.id}, ${writer.userId}, gen_random_uuid(), 'post ' || n, true, timestamptz '2026-09-01T00:00:00Z' + (n / 40) * interval '1 microsecond'
        FROM generate_series(1, 1500) n`;
      const out = await buildUserExport({ sql }, writer.userId);
      const comments = out.data["gym_post_comments"] as { id: string; body: string }[];
      const written = out.data["gym_posts"] as { id: string; body: string }[];
      expect(comments).toHaveLength(2100);
      expect(new Set(comments.map((c) => c.id)).size).toBe(2100);
      expect(comments.some((c) => c.body === "words 1")).toBe(true);
      expect(written).toHaveLength(1501);
      expect(new Set(written.map((p) => p.id)).size).toBe(1501);
      expect(written.some((p) => p.body === "post 1")).toBe(true);
      expect(out.truncated["gym_post_comments"]).toBeUndefined();
      expect(out.truncated["gym_posts"]).toBeUndefined();
      expect(Object.keys(comments[0] ?? {})).not.toContain("cursor_at");
      expect(Object.keys(written[0] ?? {})).not.toContain("cursor_at");
    },
    T,
  );

  // ===========================================================================
  // A REPLY THE SERVER HOLDS
  // ===========================================================================

  it(
    "a reply sent again after the comment above it was hidden, or its writer blocked, is answered with the reply: no false 'removed', no second copy",
    async () => {
      const gym = await makeGym("Reply Held");
      const writer = await member(gym, "Wes Writer");
      const replier = await member(gym, "Ria Replier");
      const post = await addPost(gym, writer);
      const parent = await comment(gym, writer, post.id, "The comment above");
      const key = randomUUID();
      const first = await send(gym, replier, post.id, "my reply", { commentKey: key, replyTo: parent.id });
      expect(first.statusCode, first.body).toBe(201);
      const replyId = (JSON.parse(first.body) as { comment: GymPostComment }).comment.id;

      for (let i = 0; i < 5; i++) {
        const reporter = await member(gym, `Reporter${String(i)} Person`);
        expect((await report(gym, reporter, parent.id)).statusCode).toBe(200);
      }
      const again = await send(gym, replier, post.id, "my reply", { commentKey: key, replyTo: parent.id });
      expect(again.statusCode, again.body).toBe(201);
      expect(JSON.parse(again.body)).toMatchObject({ firstKept: false, comment: { id: replyId, parentId: parent.id } });
      const held = await sql`SELECT id FROM gym_post_comments WHERE gym_id = ${gym.id} AND author_user_id = ${replier.userId}`;
      expect(held).toHaveLength(1);

      // The same after the person blocks the writer of the comment above.
      const other = await comment(gym, writer, post.id, "Another comment");
      const key2 = randomUUID();
      expect((await send(gym, replier, post.id, "second reply", { commentKey: key2, replyTo: other.id })).statusCode).toBe(201);
      expect((await block(gym, replier, other.id)).statusCode).toBe(200);
      const after = await send(gym, replier, post.id, "second reply", { commentKey: key2, replyTo: other.id });
      expect(after.statusCode, after.body).toBe(201);
      expect(JSON.parse(after.body)).toMatchObject({ firstKept: false });
      // A reply removed since is still told so.
      const gone = (JSON.parse(after.body) as { comment: GymPostComment }).comment.id;
      expect((await inject("DELETE", one(gym.id, gone), replier.cookies)).statusCode).toBe(200);
      const removed = await send(gym, replier, post.id, "second reply", { commentKey: key2, replyTo: other.id });
      expect(removed.statusCode).toBe(404);
    },
    T,
  );

  it(
    "a comment's key spent on one post, sent on another, is refused",
    async () => {
      const gym = await makeGym("Key Post");
      const writer = await member(gym, "Kit Keys");
      const one1 = await addPost(gym, writer, "Post one");
      const two = await addPost(gym, writer, "Post two");
      const key = randomUUID();
      expect((await send(gym, writer, one1.id, "On post one", { commentKey: key })).statusCode).toBe(201);
      const res = await send(gym, writer, two.id, "On post two", { commentKey: key });
      expect(res.statusCode).toBe(409);
      expect(errorOf(res)).toBe("comment_key_taken");
    },
    T,
  );

  // ===========================================================================
  // REACTIONS
  // ===========================================================================

  it(
    "a reaction's answer says what the server holds, with changes at once: on a post and on a comment",
    async () => {
      const gym = await makeGym("Reaction Truth");
      const writer = await member(gym, "Ros Reacts");
      const post = await addPost(gym, writer);
      const said = await comment(gym, writer, post.id, "Words");
      const asks: (string | null)[] = ["like", "love", "strong", "fire", null, "like", "love", "strong", "fire", null, "like", "love"];
      for (const path of [`${posts(gym.id)}/${post.id}/reaction`, `${one(gym.id, said.id)}/reaction`]) {
        for (let round = 0; round < 3; round++) {
          const answers = await Promise.all(asks.map((reaction) => inject("PUT", path, writer.cookies, { reaction })));
          for (const res of answers) {
            expect(res.statusCode, res.body).toBe(200);
            const { reactions, mine } = JSON.parse(res.body) as { reactions: Record<string, number>; mine: string | null };
            const total = Object.values(reactions).reduce((a, b) => a + b, 0);
            // One person: their answer's mine and its counts are one moment of the same row.
            if (mine === null) expect(total).toBe(0);
            else expect(reactions[mine]).toBe(1);
          }
        }
      }
    },
    T,
  );

  it(
    "a reaction left on a reply under somebody the giver has blocked is not counted",
    async () => {
      const gym = await makeGym("Reaction Block");
      const bully = await member(gym, "Bo Bully");
      const giver = await member(gym, "Gia Giver");
      const third = await member(gym, "Tia Third");
      const post = await addPost(gym, third);
      const parent = await comment(gym, bully, post.id, "The comment above");
      const reply = await comment(gym, third, post.id, "A reply", parent.id);
      // As a reaction landing during the block leaves it: the row is there after the block has run.
      expect((await block(gym, giver, parent.id)).statusCode).toBe(200);
      await sql`INSERT INTO gym_post_comment_reactions (gym_id, comment_id, user_id, reaction, created_at) VALUES (${gym.id}, ${reply.id}, ${giver.userId}, 'like', now())`;
      const replies = await inject("GET", `${one(gym.id, parent.id)}/replies`, third.cookies);
      expect(replies.statusCode, replies.body).toBe(200);
      const shown = (JSON.parse(replies.body) as GymPostCommentsResponse).comments.find((c) => c.id === reply.id);
      expect(shown?.reactions.like).toBe(0);
    },
    T,
  );

  // ===========================================================================
  // WHAT A POST MAY HOLD
  // ===========================================================================

  it(
    "a picture bigger than the browser sends, a WebP that lies about its size, and a moving one are refused; true ones go up",
    async () => {
      const gym = await makeGym("Pictures");
      const writer = await member(gym, "Pip Pictures");
      const webp = (chunks: Buffer[]) => riff(chunks).toString("base64");
      const refused: [string, string][] = [
        ["a PNG 6300 wide", pngOfSize(6300, 6300)],
        ["a PNG 1601 wide", pngOfSize(1601, 100)],
        ["a WebP saying 1 x 1 around 120 x 101", webp([vp8x(1, 1), vp8(120, 101)])],
        ["a moving WebP", webp([vp8x(100, 100, 0x02), webpChunk("ANIM", Buffer.alloc(6)), anmf(0, 0, 100, 100)])],
      ];
      for (const [what, photo] of refused) {
        const res = await sendPost(gym, writer, "Words", [photo]);
        expect(res.statusCode, what).toBe(400);
      }
      for (const photo of [pngOfSize(1600, 1200), webp([vp8x(120, 101), vp8(120, 101)]), webp([vp8(120, 101)])]) {
        const res = await sendPost(gym, writer, "Words", [photo]);
        expect(res.statusCode, res.body).toBe(201);
      }
    },
    T,
  );

  it(
    "posting and removing does not give photos back: the day's ten count those on removed posts",
    async () => {
      const gym = await makeGym("Photo Day");
      const writer = await member(gym, "Pat Poster");
      const photo = pngOfSize(100, 100);
      const fours = async () => {
        const res = await sendPost(gym, writer, "Four photos", [photo, photo, photo, photo]);
        return res;
      };
      for (let round = 0; round < 2; round++) {
        const res = await fours();
        expect(res.statusCode, res.body).toBe(201);
        const id = (JSON.parse(res.body) as { post: GymPost }).post.id;
        expect((await inject("DELETE", `${posts(gym.id)}/mine/${id}`, writer.cookies)).statusCode).toBe(200);
      }
      // Eight used on removed posts: four more do not fit, two do.
      const third = await fours();
      expect(third.statusCode, third.body).toBe(429);
      expect(errorOf(third)).toBe("posts_photo_day_full");
      expect((await sendPost(gym, writer, "Two photos", [photo, photo])).statusCode).toBe(201);
      // A day on, they are free again.
      clock += 25 * 60 * 60 * 1000;
      expect((await fours()).statusCode).toBe(201);
    },
    T,
  );

  it(
    "words made of nothing that shows are no post, whichever road, and direction marks or stacked marks are refused in plain words",
    async () => {
      const gym = await makeGym("Words");
      const writer = await member(gym, "Wyn Words");
      const hidden = [String.fromCodePoint(0x200b), String.fromCodePoint(0x202e), String.fromCodePoint(0x3164)];
      for (const blank of hidden) expect((await sendPost(gym, writer, blank)).statusCode).toBe(400);
      const post = await addPost(gym, writer);
      const turned = `${String.fromCodePoint(0x202e)}kcuf`;
      const stacked = `Z${String.fromCodePoint(0x0301).repeat(499)}`;
      for (const body of [turned, stacked]) {
        const asPost = await sendPost(gym, writer, body);
        expect(asPost.statusCode, asPost.body).toBe(400);
        expect((JSON.parse(asPost.body) as { message: string }).message).toBe(DISGUISED_WORDS);
        const asComment = await send(gym, writer, post.id, body);
        expect(asComment.statusCode, asComment.body).toBe(400);
        expect((JSON.parse(asComment.body) as { message: string }).message).toBe(DISGUISED_WORDS);
      }
      // Real writing is not caught: other alphabets, accents, emoji and a right-to-left mark.
      for (const body of ["Tiếng Việt rất đẹp", "आज का वर्कआउट बहुत अच्छा था", "ما شاء الله تبارك", "สวัสดีครับ", "Well done 👏🏽", `שלום${String.fromCodePoint(0x200f)}`]) {
        const res = await send(gym, writer, post.id, body);
        expect(res.statusCode, `${body}: ${res.body}`).toBe(201);
      }
    },
    T,
  );

  // ===========================================================================
  // A SHARED ADDRESS
  // ===========================================================================

  it(
    "one gym at an address cannot use up another's, and a stranger spends nothing of a gym's: posts, comments, events, challenges, leaderboard",
    async () => {
      const here = await makeGym("Same Building A");
      const there = await makeGym("Same Building B");
      const inA = await member(here, "Ann Alpha");
      const inB = await member(there, "Ben Beta");
      const post = await addPost(here, inA);
      const address = nextIp();
      const routes: [string, (gymId: string) => string, number][] = [
        ["orgs_posts_read", (g) => posts(g), 6000],
        ["orgs_events_read", (g) => `/v1/orgs/${g}/events`, 6000],
        ["orgs_challenges_read", (g) => `/v1/orgs/${g}/challenges`, 6000],
        ["orgs_leaderboard_read", (g) => `/v1/orgs/${g}/leaderboard?board=gym_days&period=this_week`, 6000],
      ];
      for (const [name, path, most] of routes) {
        // Gym A's count at this address full, as ten members at their own limit fill it.
        for (let i = 0; i < most; i++) await redis.incrWithTtl(`rl:${name}:ip:${here.id}:${address}`, 3600);
        const full = await inject("GET", path(here.id), inA.cookies, undefined, address);
        const other = await inject("GET", path(there.id), inB.cookies, undefined, address);
        expect(other.statusCode, `${name} gym B: ${other.body}`).toBe(200);
        expect(full.statusCode, `${name} gym A`).toBe(429);
      }
      // Comments have their own count, by the same rule.
      const comments = await inject("GET", onPost(here.id, post.id), inA.cookies, undefined, address);
      expect(comments.statusCode).toBe(200);
      const key = `rl:orgs_comments_read:ip:${here.id}:${address}`;
      expect(await redis.incrWithTtl(key, 3600)).toBeGreaterThan(1);
    },
    T,
  );

  it(
    "a stranger asking for a gym's leaderboard gets not found, is never refused for the limit, and is not charged to its address",
    async () => {
      const gym = await makeGym("Board Strangers");
      const stranger = await signedIn("Sid Stranger");
      const address = nextIp();
      for (const path of [`/v1/orgs/${gym.id}/leaderboard?board=gym_days&period=this_week`, `/v1/orgs/${gym.id}/leaderboard/mine?board=gym_days&period=this_week`, `/v1/orgs/${gym.id}/leaderboard/people/${gym.owner.userId}?period=this_week`]) {
        const res = await inject("GET", path, stranger.cookies, undefined, address);
        expect(res.statusCode, path).toBe(404);
      }
      expect(await redis.incrWithTtl(`rl:orgs_leaderboard_read:ip:${gym.id}:${address}`, 3600)).toBe(1);
      expect(await redis.incrWithTtl(`rl:orgs_leaderboard_read:ip:${address}`, 3600)).toBe(1);
      expect(await redis.incrWithTtl(`rl:orgs_leaderboard_read:id:${stranger.userId}`, 3600)).toBe(1);
    },
    T,
  );

  // ===========================================================================
  // A CROWDED POST
  // ===========================================================================

  it(
    "a page counts a post's comments up to the most it says, for members and staff",
    async () => {
      const gym = await makeGym("Crowded");
      const writer = await member(gym, "Cam Crowd");
      const post = await addPost(gym, writer);
      await sql`
        INSERT INTO gym_post_comments (gym_id, post_id, author_user_id, by_member, comment_key, body, created_at)
        SELECT ${gym.id}, ${post.id}, ${writer.userId}, true, gen_random_uuid(), 'words', timestamptz '2026-09-01T00:00:00Z'
        FROM generate_series(1, ${GYM_POST_COMMENT_COUNT_MOST + 50}) n`;
      const quiet = await addPost(gym, writer, "A quiet post");
      await comment(gym, writer, quiet.id, "Only one");
      const read = await inject("GET", posts(gym.id), writer.cookies);
      const feed = JSON.parse(read.body) as GymPostsResponse;
      const count = (id: string) => [...feed.pinned, ...feed.posts].find((p) => p.id === id)?.commentCount;
      expect(count(post.id)).toBe(GYM_POST_COMMENT_COUNT_MOST);
      expect(count(quiet.id)).toBe(1);
      const staff = await inject("GET", `${posts(gym.id)}/staff`, gym.owner.cookies);
      const staffFeed = JSON.parse(staff.body) as { posts: { id: string; commentCount: number }[] };
      expect(staffFeed.posts.find((p) => p.id === post.id)?.commentCount).toBe(GYM_POST_COMMENT_COUNT_MOST);
    },
    T,
  );

  // ===========================================================================
  // RACES
  // ===========================================================================

  it(
    "removing a post at the instant its comments are removed and reacted to: nobody's press gets a 500",
    async () => {
      const gym = await makeGym("Remove Race");
      const writer = await member(gym, "Rae Remover");
      for (let round = 0; round < 6; round++) {
        const post = await addPost(gym, writer, `Round ${String(round)}`);
        const said: GymPostComment[] = [];
        for (let i = 0; i < 6; i++) {
          const top = await comment(gym, writer, post.id, `Comment ${String(i)}`);
          said.push(top, await comment(gym, writer, post.id, `Reply ${String(i)}`, top.id));
        }
        const presses = [
          ...said.filter((c) => c.parentId === null).map((c) => inject("DELETE", `${one(gym.id, c.id)}/staff`, gym.owner.cookies)),
          ...said.map((c) => inject("PUT", `${one(gym.id, c.id)}/reaction`, writer.cookies, { reaction: "like" })),
          inject("DELETE", `${posts(gym.id)}/${post.id}`, gym.owner.cookies),
        ];
        const answers = await Promise.all(presses);
        for (const res of answers) expect(res.statusCode, res.body).toBeLessThan(500);
      }
    },
    T,
  );

  it(
    "Join waits for a cancel on its way, and is told so",
    async () => {
      const gym = await makeGym("Join Race");
      const joiner = await member(gym, "Jo Joiner");
      const made = await inject("POST", `/v1/orgs/${gym.id}/challenges`, gym.owner.cookies, {
        challengeKey: randomUUID(),
        name: "Join race",
        details: "",
        prize: "",
        subject: "gym_visits",
        measure: "days",
        countedBy: "app",
        startsOn: "2026-10-01",
        endsOn: "2026-10-30",
        target: null,
        who: "joined",
        teams: "none",
        teamList: [],
      });
      expect(made.statusCode, made.body).toBeLessThan(300);
      const id = (JSON.parse(made.body) as { challenge: { id: string } }).challenge.id;
      let join: ReturnType<typeof inject> | null = null;
      await sql.begin(async (tx) => {
        await tx`UPDATE gym_challenges SET cancelled_at = now() WHERE id = ${id}`;
        join = inject("PUT", `/v1/orgs/${gym.id}/challenges/${id}/joined`, joiner.cookies);
        await new Promise((resolve) => setTimeout(resolve, 300));
      });
      const res = await (join as unknown as ReturnType<typeof inject>);
      expect(res.statusCode, res.body).toBe(409);
      expect(errorOf(res)).toBe("challenge_cancelled");
      const row = await sql`SELECT 1 FROM gym_challenge_people WHERE challenge_id = ${id}`;
      expect(row).toHaveLength(0);
    },
    T,
  );
});
