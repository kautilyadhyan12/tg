// What a gym's challenges cost at full size (ROADMAP 19d-i; CLAUDE.md §4 "Cost at full size").
// One gym of 200 live app members (--members= for another size) with three years of desk
// visits and app workouts, and the most challenges a member can be sent: six that have not
// ended and three that ended in the last fortnight. Each runs for most of a year, half count
// gym days and half workout days, and every second one is a challenge people join, which
// everybody has joined. Two numbers each, over several runs:
//   - total: how long it takes (a read holds up to four of the pool's ten connections);
//   - server thread busy: how long the server's one thread answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_b'
//   corepack pnpm --filter api exec tsx tools/measure-challenges-cost.ts [--members=200] [--challenges=9] [--teams] [--results=23] [--keep]
//
// --teams puts every challenge in the most teams one can have (eight) with every member in
// one, and also times a member's pick, a whole gym picking at once and staff's save
// (ROADMAP 19d-ii-a).
//
// --results=N adds N challenges that ended three weeks ago after 300 days, each with its
// result post, three of them pinned, and times a page of Updates that carries them beside
// the same page of plain posts (ROADMAP 19d-ii-b). 23 is the most one page can carry. It
// also runs the posting step over the whole database, which posts whatever is due there.
//
// --keep leaves the gym in place after the reads (for EXPLAIN); the next run removes it first.
//
// LOCAL DATABASES ONLY: it writes a gym, its accounts, visits, workouts and challenges, and
// removes them.
import { randomUUID } from "node:crypto";
import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import postgres from "postgres";
import { GYM_CHALLENGES_CURRENT_MAX, GYM_CHALLENGES_ENDED_SHOWN, GYM_CHALLENGE_RESULT_POST_ENDING, GYM_CHALLENGE_TEAMS_MAX, GYM_POSTS_PAGE, GYM_POST_MAX_PINNED } from "@app/shared";
import { postChallengeResults } from "../src/modules/orgs/challenges/resultPosts.js";
import { getPosts, getStaffPosts } from "../src/modules/orgs/posts/service.js";
import { addChallenge, getBoard, getChallenges, getStaffBoard, getStaffChallenges, pickTeam, setCancelled, setJoined, setScores, setTeamPeople } from "../src/modules/orgs/challenges/service.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-challenges-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
// Ten connections, as the api holds (Stage 4 item 11).
const sql = postgres(url, { prepare: false, max: 10 });
const arg = (name: string, otherwise: number): number => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found === undefined ? otherwise : Number(found.slice(name.length + 3));
};
const MEMBERS = arg("members", 200);
const MOST = GYM_CHALLENGES_CURRENT_MAX + GYM_CHALLENGES_ENDED_SHOWN;
const CHALLENGES = Math.min(MOST, arg("challenges", MOST));
/** How many people do one thing at the same instant: a launch gym's whole membership. */
const CROWD = Math.min(MEMBERS, 200);
const YEARS = 3;
const KEEP = process.argv.includes("--keep");
const TEAMS = process.argv.includes("--teams");
const RESULTS = Math.min(GYM_POSTS_PAGE + GYM_POST_MAX_PINNED, arg("results", 0));
const RUNS = 5;
const PLAN = "zz_challenges_cost";
const PREFIX = "challenges-cost-";

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  const users = sql`SELECT id FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_challenges WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_attendance WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_checkin_devices WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_members WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM workouts WHERE user_id IN (${users})`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
  await sql`DELETE FROM plans WHERE code = ${PLAN}`;
}

interface Seeded {
  gymId: string;
  owner: string;
  members: string[];
  /** A running challenge everybody is in, one people join, and one nobody has joined. */
  everyone: string;
  joined: string;
  empty: string;
  /** The teams of "Nobody yet", where members pick; none without --teams. */
  emptyTeams: string[];
}

async function seed(): Promise<Seeded> {
  await sql`
    INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
    VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
  const users = Array.from({ length: MEMBERS + 1 }, (_, i) => ({ id: randomUUID(), email: `${PREFIX}${String(i)}-${randomUUID()}@example.com`, display_name: `Member${String(i)} Person${String(i % 97)}` }));
  for (let i = 0; i < users.length; i += 1000) await sql`INSERT INTO users ${sql(users.slice(i, i + 1000))}`;
  const owner = users[0]?.id ?? "";
  const gymId = randomUUID();
  await sql`INSERT INTO gyms (id, slug, name, timezone, owner_user_id) VALUES (${gymId}, ${PREFIX + gymId}, 'Cost Gym', 'Asia/Kolkata', ${owner})`;
  await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${owner}, 'owner')`;
  await sql`
    INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
    VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${PLAN}), 'active', 'pilot')`;
  const device = randomUUID();
  await sql`INSERT INTO gym_checkin_devices (id, gym_id, name) VALUES (${device}, ${gymId}, 'Desk')`;
  const memberIds = users.slice(1).map((u) => u.id);
  // Everybody joined the gym before the three years began, so every workout is inside a membership.
  const joinedAt = new Date(Date.now() - (365 * YEARS + 30) * 86_400_000);
  const rows = memberIds.map((id) => ({ gym_id: gymId, user_id: id, joined_at: joinedAt }));
  for (let i = 0; i < rows.length; i += 1000) await sql`INSERT INTO gym_members ${sql(rows.slice(i, i + 1000))}`;
  // Three years of visits and of app workouts: each member on about two days in seven.
  await sql`
    INSERT INTO gym_attendance (gym_id, user_id, device_id, day, marked_at, method, hours_status, slot_key)
    SELECT ${gymId}, m.user_id, ${device}, d::date, d + time '18:00', 'key_tag', 'hours_unset', 'hours_unset'
    FROM gym_members m
    CROSS JOIN generate_series((now() AT TIME ZONE 'Asia/Kolkata')::date - ${365 * YEARS}::int, (now() AT TIME ZONE 'Asia/Kolkata')::date, interval '1 day') d
    WHERE m.gym_id = ${gymId} AND random() < 0.3`;
  await sql`
    INSERT INTO workouts (id, user_id, started_at, platform, engine_version, sets_count, total_reps, created_at)
    SELECT gen_random_uuid(), m.user_id, t.at, 'android', 'cost', 3, 30, t.at + interval '40 minutes'
    FROM gym_members m
    CROSS JOIN generate_series((now() AT TIME ZONE 'Asia/Kolkata')::date - ${365 * YEARS}::int, (now() AT TIME ZONE 'Asia/Kolkata')::date - 1, interval '1 day') d
    CROSS JOIN LATERAL (SELECT (d::date + time '07:00') AT TIME ZONE 'Asia/Kolkata' AS at) t
    WHERE m.gym_id = ${gymId} AND random() < 0.3`;
  // All but one of the running ones started 300 days ago with 60 to go (the last is
  // "Nobody yet", below); the rest ended in the last few days after 300 days. Odd ones
  // count workout days; every second pair is a challenge people join.
  const running = Math.min(CHALLENGES, GYM_CHALLENGES_CURRENT_MAX) - 1;
  const made = await sql<{ id: string; n: number; who: string }[]>`
    INSERT INTO gym_challenges (gym_id, challenge_key, name, details, prize, counts, starts_on, ends_on, target, who)
    SELECT ${gymId}, gen_random_uuid(), 'Challenge ' || n, repeat('Words of a challenge. ', 22), repeat('P', 120),
           CASE WHEN n % 2 = 0 THEN 'gym_days' ELSE 'workout_days' END,
           t.today - 300 - CASE WHEN n > ${running} THEN n ELSE 0 END,
           CASE WHEN n > ${running} THEN t.today - (n - ${running}) ELSE t.today + 60 END,
           CASE WHEN n % 3 = 0 THEN 80 END,
           CASE WHEN n % 4 < 2 THEN 'everyone' ELSE 'joined' END
    FROM generate_series(1, ${CHALLENGES - 1}) AS n, LATERAL (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS today) AS t
    RETURNING id, (substring(name from 11))::int AS n, who`;
  const joinedOnes = made.filter((c) => c.who === "joined").map((c) => c.id);
  // Challenges that ended three weeks ago, off a member's list, for the result posts.
  if (RESULTS > 0) {
    await sql`
      INSERT INTO gym_challenges (gym_id, challenge_key, name, prize, counts, starts_on, ends_on, who)
      SELECT ${gymId}, gen_random_uuid(), 'Ended ' || n, repeat('P', 120),
             CASE WHEN n % 2 = 0 THEN 'gym_days' ELSE 'workout_days' END, t.today - 321 - n, t.today - 21 - n, 'everyone'
      FROM generate_series(1, ${RESULTS}) AS n, LATERAL (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS today) AS t`;
  }
  // One challenge people join that nobody has: the crowd below joins it.
  const [empty] = await sql<{ id: string }[]>`
    INSERT INTO gym_challenges (gym_id, challenge_key, name, counts, starts_on, ends_on, who)
    SELECT ${gymId}, gen_random_uuid(), 'Nobody yet', 'gym_days', t.today - 20, t.today + 10, 'joined'
    FROM (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS today) AS t
    RETURNING id`;
  if (joinedOnes.length > 0) {
    await sql`
      INSERT INTO gym_challenge_people (gym_id, challenge_id, user_id)
      SELECT ${gymId}, c.id, m.id FROM unnest(${joinedOnes}::uuid[]) AS c(id), unnest(${memberIds}::uuid[]) AS m(id)`;
  }
  let emptyTeams: string[] = [];
  if (TEAMS) {
    // Every challenge in eight teams, every member in one; "Nobody yet" is the one members pick in.
    await sql`UPDATE gym_challenges SET teams = CASE WHEN id = ${empty?.id ?? ""} THEN 'members' ELSE 'staff' END WHERE gym_id = ${gymId}`;
    await sql`
      INSERT INTO gym_challenge_teams (gym_id, challenge_id, name, position)
      SELECT ${gymId}, c.id, 'Team ' || (n + 1), n FROM gym_challenges c, generate_series(0, ${GYM_CHALLENGE_TEAMS_MAX - 1}) AS n WHERE c.gym_id = ${gymId}`;
    await sql`
      INSERT INTO gym_challenge_team_people (gym_id, challenge_id, team_id, user_id)
      SELECT ${gymId}, c.id, t.id, m.user_id
      FROM gym_challenges c
      JOIN (SELECT user_id, (row_number() OVER (ORDER BY user_id) - 1) % ${GYM_CHALLENGE_TEAMS_MAX} AS slot FROM gym_members WHERE gym_id = ${gymId}) m ON true
      JOIN gym_challenge_teams t ON t.challenge_id = c.id AND t.position = m.slot
      WHERE c.gym_id = ${gymId} AND c.id <> ${empty?.id ?? ""}`;
    const rows = await sql<{ id: string }[]>`SELECT id FROM gym_challenge_teams WHERE challenge_id = ${empty?.id ?? ""} ORDER BY position`;
    emptyTeams = rows.map((row) => row.id);
    await sql`ANALYZE gym_challenge_teams`;
    await sql`ANALYZE gym_challenge_team_people`;
  }
  await sql`VACUUM ANALYZE gym_attendance`;
  await sql`VACUUM ANALYZE workouts`;
  await sql`ANALYZE gym_challenges`;
  await sql`ANALYZE gym_challenge_people`;
  const first = (who: string): string => made.find((c) => c.who === who && c.n <= running)?.id ?? "";
  return { gymId, owner, members: memberIds, everyone: first("everyone"), joined: first("joined"), empty: empty?.id ?? "", emptyTeams };
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;

async function time(fn: () => Promise<unknown>): Promise<{ wall: number; js: number }> {
  const before = performance.eventLoopUtilization();
  const start = performance.now();
  await fn();
  const wall = performance.now() - start;
  return { wall, js: performance.eventLoopUtilization(before).active };
}

function report(name: string, runs: { wall: number; js: number }[]): void {
  const walls = runs.map((r) => r.wall);
  const jss = runs.map((r) => r.js);
  console.log(`${name.padEnd(58)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · server thread busy median ${fmt(median(jss))} (worst ${fmt(Math.max(...jss))})`);
}

await cleanup();
const { gymId, owner, members, everyone, joined, empty, emptyTeams } = await seed();
try {
  const deps = { sql, now: () => new Date() };
  const allowed = (): Promise<boolean> => Promise.resolve(true);
  const viewer = members[0] ?? "";
  const crowd = members.slice(0, CROWD);
  const counted = await sql<{ visits: number; workouts: number; challenges: number; joins: number }[]>`
    SELECT (SELECT count(*)::int FROM gym_attendance WHERE gym_id = ${gymId}) AS visits,
           (SELECT count(*)::int FROM workouts WHERE user_id = ANY(${members}::uuid[])) AS workouts,
           (SELECT count(*)::int FROM gym_challenges WHERE gym_id = ${gymId}) AS challenges,
           (SELECT count(*)::int FROM gym_challenge_people WHERE gym_id = ${gymId}) AS joins`;
  const c = counted[0];
  console.log(
    `one gym: ${String(MEMBERS)} members, ${String(c?.visits ?? 0)} visits and ${String(c?.workouts ?? 0)} workouts over ${String(YEARS)} years, ${String(c?.challenges ?? 0)} challenges, ${String(c?.joins ?? 0)} joins; cpu ${String(cpus()[0]?.speed ?? 0)} MHz; ${String(RUNS)} runs each`,
  );
  const list = await getChallenges(deps, viewer, gymId, allowed);
  console.log(`a member's list: ${String(list?.challenges.length ?? 0)} challenges, ${String(JSON.stringify(list).length)} bytes of JSON`);

  const reads: [string, () => Promise<unknown>][] = [
    ["member, the challenges with their own numbers", () => getChallenges(deps, viewer, gymId, allowed)],
    [`${String(CROWD)} members ask for the list at the same instant`, () => Promise.all(crowd.map((id) => getChallenges(deps, id, gymId, allowed)))],
    ["member, one whole board (everyone's challenge)", () => getBoard(deps, viewer, gymId, everyone, allowed)],
    ["member, one whole board (a challenge people join)", () => getBoard(deps, viewer, gymId, joined, allowed)],
    ["staff, the challenges", () => getStaffChallenges(deps, owner, gymId, allowed)],
    ["staff, one board, a page of a hundred", () => getStaffBoard(deps, owner, gymId, everyone, 1, allowed)],
  ];
  for (const [name, fn] of reads) {
    await fn();
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await time(fn));
    report(name, runs);
  }

  if (RESULTS > 0) {
    const postsDeps = { ...deps, supportEmail: null };
    // The same page twice: plain posts first, then the same number of result posts.
    const page = async (results: boolean): Promise<void> => {
      await sql`DELETE FROM gym_posts WHERE gym_id = ${gymId}`;
      await sql`
        INSERT INTO gym_posts (gym_id, post_key, body, created_at, pinned_at, challenge_id)
        SELECT ${gymId}, gen_random_uuid(), c.name || ${GYM_CHALLENGE_RESULT_POST_ENDING}, now() - make_interval(mins => c.n::int),
               CASE WHEN c.n <= ${GYM_POST_MAX_PINNED} THEN now() END, CASE WHEN ${results} THEN c.id END
        FROM (SELECT id, name, row_number() OVER (ORDER BY ends_on DESC) AS n FROM gym_challenges WHERE gym_id = ${gymId} AND name LIKE 'Ended %') c`;
    };
    for (const results of [false, true]) {
      await page(results);
      const feed = await getPosts(postsDeps, viewer, gymId, undefined, allowed);
      const carried = [...(feed?.pinned ?? []), ...(feed?.posts ?? [])];
      const what = results ? "result posts" : "plain posts";
      console.log(`a page of Updates: ${String(carried.length)} ${what}, ${String(carried.filter((p) => p.challengeResult !== null).length)} with a result, ${String(JSON.stringify(feed).length)} bytes of JSON`);
      const pageReads: [string, () => Promise<unknown>][] = [
        [`member, a page of ${String(carried.length)} ${what}`, () => getPosts(postsDeps, viewer, gymId, undefined, allowed)],
        [`${String(CROWD)} members ask for that page at the same instant`, () => Promise.all(crowd.map((id) => getPosts(postsDeps, id, gymId, undefined, allowed)))],
        [`staff, a page of ${String(carried.length)} ${what}`, () => getStaffPosts(postsDeps, owner, gymId, undefined, allowed)],
      ];
      for (const [name, fn] of pageReads) {
        await fn();
        const runs = [];
        for (let i = 0; i < RUNS; i++) runs.push(await time(fn));
        report(name, runs);
      }
    }
    // The posting step itself, over every gym in this database, with nothing left to post.
    const all = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_challenges`;
    const sweeps = [];
    for (let i = 0; i < RUNS; i++) sweeps.push(await time(() => postChallengeResults({ sql, log: { info: () => undefined } })));
    report(`the posting step over ${String(all[0]?.n ?? 0)} challenges, nothing to post`, sweeps);
  }

  if (KEEP) {
    console.log(`kept: gym ${gymId}, a member ${viewer}`);
    process.exit(0);
  }

  if (TEAMS) {
    const teamOf = (n: number): string => emptyTeams[n % emptyTeams.length] ?? "";
    const picks = [];
    const crowdPicks = [];
    const saves = [];
    const clear = async (): Promise<void> => {
      await sql`DELETE FROM gym_challenge_team_people WHERE gym_id = ${gymId} AND challenge_id = ${empty}`;
      await sql`DELETE FROM gym_challenge_people WHERE gym_id = ${gymId} AND challenge_id = ${empty}`;
    };
    for (let i = 0; i < RUNS; i++) {
      await clear();
      picks.push(await time(() => pickTeam(deps, viewer, gymId, empty, teamOf(0), allowed)));
      await clear();
      // Every member picks at once: each is a short step holding the challenge's row shared, and one read back.
      crowdPicks.push(await time(() => Promise.all(crowd.map((id, n) => pickTeam(deps, id, gymId, empty, teamOf(n), allowed)))));
      // Staff move every one of them in one save, under the gym's row.
      const people = crowd.map((userId, n) => ({ userId, teamId: teamOf(n + 1 + i) }));
      saves.push(await time(() => setTeamPeople(deps, owner, gymId, empty, { people }, allowed)));
    }
    report("one member picks a team", picks);
    report(`${String(CROWD)} members pick a team at the same instant`, crowdPicks);
    report(`staff move ${String(CROWD)} people between teams in one save`, saves);
    await clear();
  }

  const joins = [];
  const leaves = [];
  const crowds = [];
  for (let i = 0; i < RUNS; i++) {
    await sql`DELETE FROM gym_challenge_people WHERE gym_id = ${gymId} AND challenge_id = ${empty}`;
    joins.push(await time(() => setJoined(deps, viewer, gymId, empty, true, allowed)));
    leaves.push(await time(() => setJoined(deps, viewer, gymId, empty, false, allowed)));
    // Every member joins one challenge at once: each is one insert and one read of it back.
    crowds.push(await time(() => Promise.all(crowd.map((id) => setJoined(deps, id, gymId, empty, true, allowed)))));
  }
  report("one member joins", joins);
  report("and leaves", leaves);
  report(`${String(CROWD)} members join one challenge at the same instant`, crowds);

  // Staff's writes, each under the gym's row. "Nobody yet" is removed first to make room.
  const adds = [];
  const cancels = [];
  await sql`DELETE FROM gym_challenges WHERE gym_id = ${gymId} AND id = ${empty}`;
  const today = (await sql<{ today: string }[]>`SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date)::text AS today`)[0]?.today ?? "";
  for (let i = 0; i < RUNS; i++) {
    let id = "";
    adds.push(
      await time(async () => {
        const made = await addChallenge(deps, owner, gymId, { challengeKey: randomUUID(), name: "Added", details: "", prize: "", counts: "gym_days", startsOn: today, endsOn: today, target: null, who: "everyone", unit: "", lowestWins: false, teams: "none", teamList: [] }, allowed);
        id = made?.id ?? "";
      }),
    );
    cancels.push(await time(() => setCancelled(deps, owner, gymId, id, true, allowed)));
    await sql`DELETE FROM gym_challenges WHERE gym_id = ${gymId} AND id = ${id}`;
  }
  // The gym's own count: staff save a page's worth of typed numbers, under the gym's row.
  const [own] = await sql<{ id: string }[]>`
    INSERT INTO gym_challenges (gym_id, challenge_key, name, counts, unit, starts_on, ends_on, who)
    VALUES (${gymId}, gen_random_uuid(), 'Own count', 'own', 'push-ups', ${today}::date, ${today}::date, 'everyone') RETURNING id`;
  const typed = [];
  for (let i = 0; i < RUNS; i++) {
    const scores = crowd.map((userId, n) => ({ userId, value: 1 + ((n + i) % 90) }));
    typed.push(await time(() => setScores(deps, owner, gymId, own?.id ?? "", { scores }, allowed)));
  }
  report(`staff save ${String(CROWD)} typed numbers`, typed);
  report("staff add a challenge", adds);
  report("staff cancel one", cancels);
} finally {
  if (!KEEP) await cleanup();
  await sql.end({ timeout: 5 });
}
