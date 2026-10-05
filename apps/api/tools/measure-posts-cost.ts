// What a gym's Updates cost at full size (ROADMAP 19b-i, 19b-ii-a; CLAUDE.md §4 "Cost at
// full size"). One gym of 2,100 live app members (--members= for another size) with three
// years of posts, two a day, three pinned, every second one a member's own; the newest 60
// reacted to by four members in ten, the rest by one in twenty; 60 posts reported by 40
// people each and 200 people stopped from posting; and one person who has posted ten times
// a day for all three years, whose profile is the longest there can be (19b-ii-c). Read as a
// member and as staff read them,
// a reaction, a report, the reported list, and a post of four photos at the biggest size
// the app takes, by staff and by a member. Two numbers each, over several runs:
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
import { GYM_POST_PHOTO_MAX_BYTES, addGymPostRequestSchema, gymPostsQuerySchema } from "@app/shared";
import { createDiskPhotoStore } from "../src/modules/orgs/gymPage/photoStore.js";
import {
  addMemberPost,
  addPost,
  getPhoto,
  getPosts,
  getReported,
  getStaffPosts,
  getBlocked,
  getPersonPosts,
  getStaffPersonPosts,
  getStopped,
  react,
  removeOwnPost,
  removePost,
  report as reportPost,
} from "../src/modules/orgs/posts/service.js";
import { badWordsIn } from "../src/modules/orgs/posts/badWords.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-posts-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
const sql = postgres(url, { prepare: false, max: 4 });
const membersArg = process.argv.find((a) => a.startsWith("--members="));
const MEMBERS = membersArg === undefined ? 2100 : Number(membersArg.slice("--members=".length));
const POSTS = 3 * 365 * 2;
/** One person's posts at the day's limit of ten, every day for three years. */
const PROLIFIC = 3 * 365 * 10;
const RUNS = 5;
const PLAN = "zz_posts_cost";
const PREFIX = "posts-cost-";

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_posts WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_post_stops WHERE gym_id IN (${gyms})`;
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
  await sql`INSERT INTO gyms (id, slug, name, timezone, owner_user_id, members_can_post) VALUES (${gymId}, ${PREFIX + gymId}, 'Cost Gym', 'Asia/Kolkata', ${owner}, true)`;
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
  // Every second post that is not pinned is a member's own, the members taking turns.
  await sql`
    WITH p AS (SELECT id, row_number() OVER (ORDER BY created_at) AS rn FROM gym_posts WHERE gym_id = ${gymId} AND pinned_at IS NULL),
         m AS (SELECT user_id, row_number() OVER (ORDER BY user_id) AS rn FROM gym_members WHERE gym_id = ${gymId})
    UPDATE gym_posts g SET by_member = true, author_user_id = m.user_id
    FROM p JOIN m ON m.rn = 1 + (p.rn % ${MEMBERS})
    WHERE g.id = p.id AND p.rn % 2 = 0`;
  // One person at the day's limit for three years. They are neither blocked nor stopped below.
  await sql`
    INSERT INTO gym_posts (gym_id, author_user_id, post_key, body, by_member, created_at)
    SELECT ${gymId}, ${owner}, gen_random_uuid(), repeat('Words of a post. ', 18), true, now() - n * interval '144 minutes'
    FROM generate_series(1, ${PROLIFIC}) n`;
  // The newest 60 members' posts are each reported by 40 people; 200 people are stopped.
  await sql`
    INSERT INTO gym_post_reports (gym_id, post_id, user_id, reason, note)
    SELECT p.gym_id, p.id, m.user_id, (ARRAY['unkind','photo_of_someone','nudity','spam','other'])[1 + floor(random() * 5)::int], repeat('Words of a note. ', 17)
    FROM (SELECT gym_id, id FROM gym_posts WHERE gym_id = ${gymId} AND by_member ORDER BY created_at DESC LIMIT 60) p
    CROSS JOIN (SELECT user_id FROM gym_members WHERE gym_id = ${gymId} ORDER BY user_id LIMIT 40 OFFSET 10) m`;
  await sql`
    INSERT INTO gym_post_stops (gym_id, user_id)
    SELECT gym_id, user_id FROM gym_members WHERE gym_id = ${gymId} AND user_id <> ALL (${[owner, users[1]?.id ?? owner]}::uuid[])
    ORDER BY user_id LIMIT 200`;
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
  // The viewer has blocked 200 members.
  await sql`
    INSERT INTO gym_post_blocks (gym_id, user_id, blocked_user_id)
    SELECT gym_id, ${users[1]?.id ?? owner}, user_id FROM gym_members
    WHERE gym_id = ${gymId} AND user_id <> ALL (${[owner, users[1]?.id ?? owner]}::uuid[])
    ORDER BY user_id DESC LIMIT 200`;
  await sql`VACUUM ANALYZE gym_post_blocks`;
  await sql`VACUUM ANALYZE gym_posts`;
  await sql`VACUUM ANALYZE gym_post_photos`;
  await sql`VACUUM ANALYZE gym_post_reactions`;
  await sql`VACUUM ANALYZE gym_post_reports`;
  await sql`VACUUM ANALYZE gym_post_stops`;
  return { gymId, owner, viewer: users[1]?.id ?? "" };
}

/** A JPEG of the biggest size the app takes: the fixture photo with its picture data made
 *  longer. Nothing here decodes a picture, so the cleaner walks every byte as it would a
 *  real one. */
async function biggestPhoto(): Promise<string> {
  const small = await readFile(new URL("../test/fixtures/photos/iphone16.jpg", import.meta.url));
  const end = small.lastIndexOf(Buffer.from([0xff, 0xd9]));
  const filler = Buffer.alloc(GYM_POST_PHOTO_MAX_BYTES - small.length, 0x55);
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
const counts = await sql<{ posts: string; own: string; reactions: string; reports: string; stops: string; blocks: string }[]>`
  SELECT (SELECT count(*) FROM gym_posts WHERE gym_id = ${gymId}) AS posts,
         (SELECT count(*) FROM gym_posts WHERE gym_id = ${gymId} AND by_member) AS own,
         (SELECT count(*) FROM gym_post_reactions WHERE gym_id = ${gymId}) AS reactions,
         (SELECT count(*) FROM gym_post_reports WHERE gym_id = ${gymId}) AS reports,
         (SELECT count(*) FROM gym_post_stops WHERE gym_id = ${gymId}) AS stops,
         (SELECT count(*) FROM gym_post_blocks WHERE gym_id = ${gymId}) AS blocks`;
console.log(
  `one gym: ${String(MEMBERS)} members, ${counts[0]?.posts ?? "?"} posts (${counts[0]?.own ?? "?"} by members, ${String(PROLIFIC)} of them one person's), ${counts[0]?.reactions ?? "?"} reactions, ${counts[0]?.reports ?? "?"} reports, ${counts[0]?.stops ?? "?"} people stopped, ${counts[0]?.blocks ?? "?"} blocked by the reader; cpu ${String(cpus()[0]?.speed ?? 0)} MHz; ${String(RUNS)} runs each`,
);

const deps = { sql, now: () => new Date(), photos: createDiskPhotoStore(folder), supportEmail: null, log: { warn: () => undefined } };
const allowed = (): Promise<boolean> => Promise.resolve(true);

const feed = async (before?: ReturnType<typeof place>) => {
  const page = await getPosts(deps, viewer, gymId, before, allowed);
  if (page === null) throw new Error("the limit answered");
  return page;
};
const first = await feed();
const newest = first.posts[0]?.id ?? "";
// The last page: reached by walking every page before it.
const place = (next: string) => gymPostsQuerySchema.parse({ before: next }).before;
let cursor = first.next;
let last: ReturnType<typeof place>;
while (cursor !== null) {
  last = place(cursor);
  cursor = (await feed(last)).next;
}
// The oldest page of the one person's posts: from their 21st-oldest post on.
const edge = await sql<{ at: Date; id: string }[]>`
  SELECT created_at AS at, id FROM gym_posts WHERE gym_id = ${gymId} AND author_user_id = ${owner} AND by_member
  ORDER BY created_at, id OFFSET 20 LIMIT 1`;
const personLast = place(`${edge[0]?.at.toISOString() ?? ""}_${edge[0]?.id ?? ""}`);
// Somebody with a single post, as most people's profile is.
const single = await sql<{ id: string }[]>`
  SELECT author_user_id AS id FROM gym_posts WHERE gym_id = ${gymId} AND by_member AND author_user_id <> ${owner}
    AND author_user_id NOT IN (SELECT blocked_user_id FROM gym_post_blocks WHERE gym_id = ${gymId}) LIMIT 1`;
const others1 = single[0]?.id ?? "";
const reads: [string, () => Promise<unknown>][] = [
  ["member, one person's posts", () => getPersonPosts(deps, viewer, gymId, owner, undefined, allowed)],
  ["member, that person's oldest page", () => getPersonPosts(deps, viewer, gymId, owner, personLast, allowed)],
  ["member, a person with one post", () => getPersonPosts(deps, viewer, gymId, others1, undefined, allowed)],
  ["staff, one person's posts", () => getStaffPersonPosts(deps, owner, gymId, owner, undefined, allowed)],
  ["member, the first page", () => feed()],
  ["member, the oldest page", () => feed(last)],
  ["staff, the first page", () => getStaffPosts(deps, owner, gymId, undefined, allowed)],
  ["staff, the reported list", () => getReported(deps, owner, gymId, allowed)],
  ["staff, who is stopped", () => getStopped(deps, owner, gymId, allowed)],
  ["member, who they blocked", () => getBlocked(deps, viewer, gymId, allowed)],
  // The word check on the longest post a member can write, clean, so every word is read.
  ["the word check, 2,000 characters", () => Promise.resolve(badWordsIn("Words of a post. ".repeat(118).slice(0, 2000)))],
  // Its worst shapes at the same length: one letter run on, and a listed word with no spaces.
  ["the word check, one letter x 1,998", () => Promise.resolve(badWordsIn("ki" + "l".repeat(1998)))],
  ["the word check, a word x 500", () => Promise.resolve(badWordsIn("fuck".repeat(500)))],
];
// A post the viewer did not write, to report: the same statement runs each time.
const others = [...first.pinned, ...first.posts].find((p) => !p.own)?.id ?? "";
reads.push(["member, a report", () => reportPost(deps, viewer, gymId, others, "spam", "Selling things in every post", allowed)]);
let flip = false;
reads.push([
  "member, a reaction",
  () => {
    flip = !flip;
    return react(deps, viewer, gymId, newest, flip ? "fire" : "like", allowed);
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
  photoReads.push(await time(() => getPhoto(deps, viewer, gymId, post.id, post.photos[0]?.id ?? "", true, allowed)));
  removes.push(await time(() => removePost(deps, owner, gymId, post.id, allowed)));
}
// The first of each is the warm-up, as for the reads.
report("staff post, the request read", parses.slice(1));
report("staff post, 4 photos kept", adds.slice(1));
report("member, one photo read", photoReads.slice(1));
report("staff remove a post", removes.slice(1));

// The same post by a member: the gym's switch, a stop and the day's ten are asked as well.
const memberAdds: { wall: number; js: number }[] = [];
const ownRemoves: { wall: number; js: number }[] = [];
for (let i = 0; i < RUNS + 1; i++) {
  const body = addGymPostRequestSchema.parse({ postKey: randomUUID(), body: "Four photos at full size", photos: [photo, photo, photo, photo] });
  const added = await time(() => addMemberPost(deps, viewer, gymId, body));
  memberAdds.push(added);
  ownRemoves.push(await time(() => removeOwnPost(deps, viewer, gymId, added.value.id, allowed)));
}
report("member post, 4 photos kept", memberAdds.slice(1));
report("member removes their own post", ownRemoves.slice(1));

await cleanup();
await rm(folder, { recursive: true, force: true });
await sql.end({ timeout: 5 });
