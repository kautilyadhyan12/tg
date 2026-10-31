// What comments on Updates cost at full size (ROADMAP Stage 5 17e; CLAUDE.md §4 "Cost at full size").
// One gym of 2,000 live app members (--members= for another size), the biggest band. A first page of
// 20 posts, each with --perPost= comments and replies (a busy gym's busiest posts), one comment holding
// 500 replies, 1,000 people blocked by nobody but the reader's one block. Two numbers each, over runs:
//   - total: how long it takes (a read holds one of the pool's connections meanwhile);
//   - server thread busy: how long the server's one thread answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg'
//   corepack pnpm --filter api exec tsx tools/measure-comments-cost.ts [--members=200] [--perPost=5000]
//
// LOCAL DATABASES ONLY: it writes a gym, its accounts and comments, and removes them.
import { randomUUID } from "node:crypto";
import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import postgres from "postgres";
import { addComment, getComments, getReplies, reactToComment } from "../src/modules/orgs/posts/commentsService.js";
import { getPosts, removePost } from "../src/modules/orgs/posts/service.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-comments-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
const sql = postgres(url, { prepare: false, max: 4 });
const argOf = (name: string, fallback: number): number => {
  const given = process.argv.find((a) => a.startsWith(`--${name}=`));
  return given === undefined ? fallback : Number(given.slice(name.length + 3));
};
const MEMBERS = argOf("members", 2000);
const PER_POST = argOf("perPost", 5000);
const POSTS = 23;
const REPLIES = 500;
const RUNS = 5;
const PLAN = "zz_comments_cost";
const PREFIX = "comments-cost-";

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_posts WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_post_blocks WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_members WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
  await sql`DELETE FROM plans WHERE code = ${PLAN}`;
}

async function seed(): Promise<{ gymId: string; owner: string; viewer: string; firstPost: string; busyComment: string; lastPost: string }> {
  await sql`
    INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
    VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
  const owner = (await sql<{ id: string }[]>`INSERT INTO users (email, display_name) VALUES (${`${PREFIX}owner@example.com`}, 'Owner') RETURNING id`)[0]?.id ?? "";
  const gymId = (await sql<{ id: string }[]>`INSERT INTO gyms (slug, name, owner_user_id) VALUES (${`${PREFIX}${randomUUID()}`}, 'Cost gym', ${owner}) RETURNING id`)[0]?.id ?? "";
  await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${owner}, 'owner')`;
  await sql`INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider) VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${PLAN}), 'trialing', 'pilot')`;
  const users = await sql<{ id: string }[]>`
    INSERT INTO users (email, display_name)
    SELECT ${PREFIX} || i || '@example.com', 'Member ' || i FROM generate_series(1, ${MEMBERS}) i
    RETURNING id`;
  const ids = users.map((u) => u.id);
  await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) SELECT ${gymId}, u, '2026-01-01T00:00:00Z' FROM unnest(${ids}::uuid[]) u`;
  const viewer = ids[0] ?? "";
  const posts = await sql<{ id: string }[]>`
    INSERT INTO gym_posts (gym_id, author_user_id, post_key, body, by_member, created_at)
    SELECT ${gymId}, ${owner}, gen_random_uuid(), 'A post', false, now() - make_interval(mins => i) FROM generate_series(1, ${POSTS}) i
    RETURNING id`;
  const postIds = posts.map((p) => p.id);
  await sql`
    INSERT INTO gym_post_comments (gym_id, post_id, author_user_id, by_member, comment_key, body, created_at)
    SELECT ${gymId}, p, (${ids}::uuid[])[1 + (random() * ${MEMBERS - 1})::int], true, gen_random_uuid(), repeat('w', 100), now() - make_interval(secs => i)
    FROM unnest(${postIds}::uuid[]) p, generate_series(1, ${PER_POST}) i`;
  const firstPost = postIds[0] ?? "";
  const lastPost = postIds[postIds.length - 1] ?? "";
  const busyComment = (await sql<{ id: string }[]>`SELECT id FROM gym_post_comments WHERE post_id = ${firstPost} ORDER BY created_at LIMIT 1`)[0]?.id ?? "";
  await sql`
    INSERT INTO gym_post_comments (gym_id, post_id, parent_id, author_user_id, by_member, comment_key, body)
    SELECT ${gymId}, ${firstPost}, ${busyComment}, (${ids}::uuid[])[1 + (random() * ${MEMBERS - 1})::int], true, gen_random_uuid(), repeat('w', 100)
    FROM generate_series(1, ${REPLIES})`;
  // Each reply answers the one before it, the page whose names are read most.
  await sql`
    UPDATE gym_post_comments c SET reply_to_id = p.prev
    FROM (SELECT id, lag(id) OVER (ORDER BY created_at, id) AS prev FROM gym_post_comments WHERE parent_id = ${busyComment}) p
    WHERE c.id = p.id AND p.prev IS NOT NULL`;
  await sql`
    INSERT INTO gym_post_comment_reactions (gym_id, comment_id, user_id, reaction)
    SELECT ${gymId}, ${busyComment}, u, 'fire' FROM unnest(${ids}::uuid[]) u`;
  await sql`ANALYZE gym_post_comments`;
  await sql`ANALYZE gym_post_comment_reactions`;
  return { gymId, owner, viewer, firstPost, busyComment, lastPost };
}

async function time<T>(fn: () => Promise<T>): Promise<{ wall: number; js: number; value: T }> {
  await new Promise((resolve) => setImmediate(resolve));
  const c0 = process.cpuUsage();
  const t0 = performance.now();
  const value = await fn();
  const wall = performance.now() - t0;
  const c = process.cpuUsage(c0);
  return { wall, js: (c.user + c.system) / 1000, value };
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;
const line = (name: string, runs: { wall: number; js: number }[]) => {
  const walls = runs.map((r) => r.wall);
  const jss = runs.map((r) => r.js);
  console.log(`${name.padEnd(40)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · server thread busy median ${fmt(median(jss))} (worst ${fmt(Math.max(...jss))})`);
};

const open = () => Promise.resolve(true);
const log = { warn: () => undefined };

try {
  await cleanup();
  const { gymId, viewer, owner, firstPost, busyComment, lastPost } = await seed();
  const deps = { sql, now: () => new Date(), supportEmail: null };
  const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_post_comments WHERE gym_id = ${gymId}`;
  console.log(`one gym: ${String(MEMBERS)} members, ${String(POSTS)} posts of ${String(PER_POST)} comments, ${String(rows[0]?.n)} rows; cpu ${String(cpus()[0]?.speed ?? 0)} MHz; ${String(RUNS)} runs each`);
  const reads: [string, () => Promise<unknown>][] = [
    ["Updates, one page, with its comment counts", () => getPosts(deps, viewer, gymId, undefined, open)],
    ["one post's comments, first page", () => getComments(deps, viewer, gymId, firstPost, undefined, open)],
    ["one comment's replies, first page", () => getReplies(deps, viewer, gymId, busyComment, undefined, open)],
    ["a reaction on a comment", () => reactToComment(deps, viewer, gymId, busyComment, "love", open)],
    ["a comment written", () => addComment(deps, viewer, gymId, firstPost, { commentKey: randomUUID(), body: "A new comment" })],
  ];
  for (const [name, fn] of reads) {
    const runs: { wall: number; js: number }[] = [];
    await fn();
    for (let i = 0; i < RUNS; i += 1) runs.push(await time(fn));
    line(name, runs);
  }
  const photos = { put: () => Promise.resolve(), get: () => Promise.resolve(null), remove: () => Promise.resolve(true) };
  const removal = await time(() => removePost({ ...deps, photos, log }, owner, gymId, lastPost, open));
  line(`a post of ${String(PER_POST)} comments removed`, [removal]);
  // The Day-14 purge really deletes a member's post, in its own transaction.
  const purged = await time(() => sql`DELETE FROM gym_posts WHERE gym_id = ${gymId} AND id = ${firstPost}`);
  line(`a post of ${String(PER_POST)} comments deleted`, [purged]);
} finally {
  await cleanup();
  await sql.end({ timeout: 5 });
}
