// What a gym's Updates cost at full size (ROADMAP 19b-i; CLAUDE.md §4 "Cost at full size").
// One gym of 2,100 live app members (--members= for another size) with three years of
// posts, two a day, three pinned; the newest 60 reacted to by four members in ten, the rest
// by one in twenty. Read as a member and as staff read them, a reaction, and a post of four
// photos at the biggest size the app takes. Two numbers each, over several runs:
//   - total: how long it takes (a read holds one of the pool's connections meanwhile);
//   - server thread busy: how long the server's one thread answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_b'
//   corepack pnpm --filter api exec tsx tools/measure-posts-cost.ts [--members=200]
//
// LOCAL DATABASES ONLY: it writes a gym, its accounts, posts and reactions, and removes them.
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import postgres from "postgres";
import { GYM_PAGE_PHOTO_MAX_BYTES, addGymPostRequestSchema } from "@app/shared";
import { createDiskPhotoStore } from "../src/modules/orgs/gymPage/photoStore.js";
import { addPost, getPhoto, getPosts, getStaffPosts, react, removePost } from "../src/modules/orgs/posts/service.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-posts-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
const sql = postgres(url, { prepare: false, max: 4 });
const membersArg = process.argv.find((a) => a.startsWith("--members="));
const MEMBERS = membersArg === undefined ? 2100 : Number(membersArg.slice("--members=".length));
const POSTS = 3 * 365 * 2;
const RUNS = 5;
const PLAN = "zz_posts_cost";
const PREFIX = "posts-cost-";

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_posts WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_members WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
  await sql`DELETE FROM plans WHERE code = ${PLAN}`;
}

async function seed(): Promise<{ gymId: string; owner: string; viewer: string }> {
  await sql`
    INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
    VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
  const users = Array.from({ length: MEMBERS }, (_, i) => ({
    id: randomUUID(),
    email: `${PREFIX}${String(i)}-${randomUUID()}@example.com`,
    display_name: `Member${String(i)} Person${String(i % 97)}`,
  }));
  for (let i = 0; i < users.length; i += 1000) await sql`INSERT INTO users ${sql(users.slice(i, i + 1000))}`;
  const owner = users[0]?.id ?? "";
  const gymId = randomUUID();
  await sql`INSERT INTO gyms (id, slug, name, timezone, owner_user_id) VALUES (${gymId}, ${PREFIX + gymId}, 'Cost Gym', 'Asia/Kolkata', ${owner})`;
  await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${owner}, 'owner')`;
  await sql`
    INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
    VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${PLAN}), 'active', 'pilot')`;
  const members = users.map((u) => ({ gym_id: gymId, user_id: u.id, joined_at: new Date(Date.now() - 4 * 365 * 86_400_000) }));
  for (let i = 0; i < members.length; i += 1000) await sql`INSERT INTO gym_members ${sql(members.slice(i, i + 1000))}`;
  // Three years of posts, two a day, each of 300 characters; the newest three pinned.
  await sql`
    INSERT INTO gym_posts (gym_id, author_user_id, post_key, body, created_at, pinned_at)
    SELECT ${gymId}, ${owner}, gen_random_uuid(), repeat('Words of a post. ', 18),
           now() - n * interval '12 hours', CASE WHEN n <= 3 THEN now() END
    FROM generate_series(1, ${POSTS}) n`;
  // Four photo rows a post on the newest 60 (the rows a page reads; no files behind them).
  await sql`
    INSERT INTO gym_post_photos (gym_id, post_id, storage_key, content_type, byte_size, width, height, position)
    SELECT p.gym_id, p.id, 'gym-post/' || p.gym_id || '/' || gen_random_uuid() || '.jpg', 'image/jpeg', 500000, 2000, 1500, i
    FROM (SELECT gym_id, id FROM gym_posts WHERE gym_id = ${gymId} ORDER BY created_at DESC LIMIT 60) p
    CROSS JOIN generate_series(0, 3) i`;
  await sql`
    INSERT INTO gym_post_reactions (gym_id, post_id, user_id, reaction)
    SELECT p.gym_id, p.id, m.user_id, (ARRAY['like','love','strong','fire'])[1 + floor(random() * 4)::int]
    FROM (SELECT gym_id, id, row_number() OVER (ORDER BY created_at DESC) AS rn FROM gym_posts WHERE gym_id = ${gymId}) p
    JOIN gym_members m ON m.gym_id = p.gym_id
    WHERE random() < CASE WHEN p.rn <= 60 THEN 0.4 ELSE 0.05 END`;
  await sql`VACUUM ANALYZE gym_posts`;
  await sql`VACUUM ANALYZE gym_post_photos`;
  await sql`VACUUM ANALYZE gym_post_reactions`;
  return { gymId, owner, viewer: users[1]?.id ?? "" };
}

/** A JPEG of the biggest size the app takes: the fixture photo with its picture data made
 *  longer. Nothing here decodes a picture, so the cleaner walks every byte as it would a
 *  real one. */
async function biggestPhoto(): Promise<string> {
  const small = await readFile(new URL("../test/fixtures/photos/iphone16.jpg", import.meta.url));
  const end = small.lastIndexOf(Buffer.from([0xff, 0xd9]));
  const filler = Buffer.alloc(GYM_PAGE_PHOTO_MAX_BYTES - small.length, 0x55);
  return Buffer.concat([small.subarray(0, end), filler, small.subarray(end)]).toString("base64");
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;

async function time<T>(fn: () => Promise<T>): Promise<{ wall: number; js: number; value: T }> {
  const before = performance.eventLoopUtilization();
  const start = performance.now();
  const value = await fn();
  const wall = performance.now() - start;
  return { wall, js: performance.eventLoopUtilization(before).active, value };
}

function report(name: string, runs: { wall: number; js: number }[]): void {
  const walls = runs.map((r) => r.wall);
  const jss = runs.map((r) => r.js);
  console.log(`${name.padEnd(34)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · server thread busy median ${fmt(median(jss))} (worst ${fmt(Math.max(...jss))})`);
}

await cleanup();
const { gymId, owner, viewer } = await seed();
const folder = await mkdtemp(join(tmpdir(), "aihg-posts-cost-"));
const counts = await sql<{ posts: string; reactions: string }[]>`
  SELECT (SELECT count(*) FROM gym_posts WHERE gym_id = ${gymId}) AS posts,
         (SELECT count(*) FROM gym_post_reactions WHERE gym_id = ${gymId}) AS reactions`;
console.log(`one gym: ${String(MEMBERS)} members, ${counts[0]?.posts ?? "?"} posts, ${counts[0]?.reactions ?? "?"} reactions; cpu ${String(cpus()[0]?.speed ?? 0)} MHz; ${String(RUNS)} runs each`);

const deps = { sql, now: () => new Date(), photos: createDiskPhotoStore(folder), log: { warn: () => undefined } };
const allowed = (): Promise<boolean> => Promise.resolve(true);

const first = await getPosts(deps, viewer, gymId, undefined);
const newest = first.posts[0]?.id ?? "";
// The last page: reached by walking every page before it.
let cursor = first.next;
let last: string | undefined;
while (cursor !== null) {
  last = cursor;
  cursor = (await getPosts(deps, viewer, gymId, cursor)).next;
}
const reads: [string, () => Promise<unknown>][] = [
  ["member, the first page", () => getPosts(deps, viewer, gymId, undefined)],
  ["member, the oldest page", () => getPosts(deps, viewer, gymId, last)],
  ["staff, the first page", () => getStaffPosts(deps, owner, gymId, undefined, allowed)],
];
let flip = false;
reads.push([
  "member, a reaction",
  () => {
    flip = !flip;
    return react(deps, viewer, gymId, newest, flip ? "fire" : "like");
  },
]);
for (const [name, fn] of reads) {
  await fn(); // warm
  const runs: { wall: number; js: number }[] = [];
  for (let i = 0; i < RUNS; i++) runs.push(await time(fn));
  report(name, runs);
}

// A post of four photos, each the biggest the app takes: the request's own JSON read and
// checked (what the route does before the service), then the post kept; then one photo
// read back, and the post removed.
const photo = await biggestPhoto();
const parses: { wall: number; js: number }[] = [];
const adds: { wall: number; js: number }[] = [];
const photoReads: { wall: number; js: number }[] = [];
const removes: { wall: number; js: number }[] = [];
for (let i = 0; i < RUNS + 1; i++) {
  const payload = JSON.stringify({ postKey: randomUUID(), body: "Four photos at full size", photos: [photo, photo, photo, photo] });
  const parsed = await time(() => Promise.resolve(addGymPostRequestSchema.parse(JSON.parse(payload))));
  parses.push(parsed);
  const added = await time(() => addPost(deps, owner, gymId, parsed.value));
  adds.push(added);
  const post = added.value;
  if (i === 0) {
    const kept = await sql<{ bytes: number }[]>`SELECT byte_size AS bytes FROM gym_post_photos WHERE post_id = ${post.id} ORDER BY position`;
    console.log(`each photo sent: ${String(Buffer.from(photo, "base64").length)} bytes; kept: ${kept.map((k) => String(k.bytes)).join(", ")} bytes`);
  }
  photoReads.push(await time(() => getPhoto(deps, viewer, gymId, post.id, post.photos[0]?.id ?? "")));
  removes.push(await time(() => removePost(deps, owner, gymId, post.id, allowed)));
}
// The first of each is the warm-up, as for the reads.
report("staff post, the request read", parses.slice(1));
report("staff post, 4 photos kept", adds.slice(1));
report("member, one photo read", photoReads.slice(1));
report("staff remove a post", removes.slice(1));

await cleanup();
await rm(folder, { recursive: true, force: true });
await sql.end({ timeout: 5 });
