// Cost of Stage 4 item 14 at full size: 20 gone gyms of 200 records (with leads, invitations,
// app members and visits) among 1,000 paying gyms whose staff sign in. Times: the nightly
// read over every gym, each email night, and the deletion night (how long each gym's row
// is held). Run: DATABASE_URL=<a local database> node --import tsx tools/measure-gone-for-good-cost.ts
import postgres from "postgres";
import { sweepGoneForGood } from "../src/modules/orgs/goneForGood/sweep.js";
import { dueGyms } from "../src/modules/orgs/goneForGood/repo.js";

const url = process.env["DATABASE_URL"] ?? "";
const sql = postgres(url, { prepare: false, max: 2 });
const P = "cost414-";
const T0 = new Date("2031-01-10T04:40:00Z");
const addMonths = (at: Date, m: number): Date => { const o = new Date(at.getTime()); o.setUTCMonth(o.getUTCMonth() + m); return o; };
const plusDays = (at: Date, d: number): Date => new Date(at.getTime() + d * 86_400_000);

async function cleanup(): Promise<void> {
  const g = sql`SELECT id FROM gyms WHERE slug LIKE ${`${P}%`}`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${g})`;
  await sql`DELETE FROM gym_attendance WHERE gym_id IN (${g})`;
  await sql`DELETE FROM gym_members WHERE gym_id IN (${g})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${g})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${g})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${`${P}%`}`;
  await sql`DELETE FROM users WHERE display_name LIKE ${`${P}%`}`;
}

async function main(): Promise<void> {
  await cleanup();
  const [plan] = await sql<{ id: string }[]>`SELECT id FROM plans WHERE audience = 'org' ORDER BY code LIMIT 1`;
  if (plan === undefined) throw new Error("seed first");
  // 1,000 paying gyms, 3 staff each, 20 sign-ins each.
  await sql`
    WITH u AS (
      INSERT INTO users (email, display_name)
      SELECT ${P} || 'p' || i || '@example.com', ${P} || 'p' || i FROM generate_series(1, 3000) i RETURNING id, display_name
    ), owners AS (
      SELECT id, (substring(display_name from '[0-9]+$'))::int AS n FROM u
    ), g AS (
      INSERT INTO gyms (slug, name, owner_user_id, timezone)
      SELECT ${P} || 'paying-' || n, 'Paying ' || n, id, 'UTC' FROM owners WHERE n <= 1000 RETURNING id, owner_user_id, (substring(slug from '[0-9]+$'))::int AS n
    ), s AS (
      INSERT INTO gym_staff (gym_id, user_id, role)
      SELECT g.id, o.id, CASE WHEN o.n = g.n THEN 'owner' ELSE 'trainer' END
      FROM g JOIN owners o ON o.n = g.n OR o.n = g.n + 1000 OR o.n = g.n + 2000 RETURNING gym_id
    )
    INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider) SELECT 'gym', g.id, ${plan.id}, 'active', 'paddle' FROM g`;
  await sql`
    INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, created_at)
    SELECT u.id, gen_random_uuid(), md5(random()::text) || u.id, now() + interval '30 days', ${T0}::timestamptz - (k || ' days')::interval
    FROM users u, generate_series(1, 20) k WHERE u.display_name LIKE ${`${P}p%`}`;
  // 20 gone gyms of 200 records, 50 leads, 5 invitations, 100 app members with a visit each.
  const gone: string[] = [];
  for (let i = 1; i <= 20; i += 1) {
    const [owner] = await sql<{ id: string }[]>`INSERT INTO users (email, display_name) VALUES (${`${P}g${String(i)}@example.com`}, ${`${P}g${String(i)}`}) RETURNING id`;
    if (owner === undefined) throw new Error("owner");
    const [gym] = await sql<{ id: string }[]>`INSERT INTO gyms (slug, name, owner_user_id, timezone, created_at) VALUES (${`${P}gone-${String(i)}`}, ${`Gone ${String(i)}`}, ${owner.id}, 'UTC', ${addMonths(T0, -24)}) RETURNING id`;
    if (gym === undefined) throw new Error("gym");
    gone.push(gym.id);
    await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gym.id}, ${owner.id}, 'owner')`;
    await sql`INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider, ended_at) VALUES ('gym', ${gym.id}, ${plan.id}, 'expired', 'paddle', ${T0})`;
    await sql`INSERT INTO gym_member_lists (gym_id) VALUES (${gym.id})`;
    await sql`
      INSERT INTO gym_member_list_entries (gym_id, identity_key, source, full_name, email)
      SELECT ${gym.id}, encode(sha256((${gym.id}::text || k)::bytea), 'hex'), 'upload', 'Person ' || k, 'p' || k || '@example.com'
      FROM generate_series(1, 200) k`;
    await sql`
      WITH m AS (
        INSERT INTO users (email, display_name) SELECT ${`${P}m${String(i)}-`} || k || '@example.com', ${`${P}m`} || k FROM generate_series(1, 100) k RETURNING id, (substring(email from '-([0-9]+)@'))::int AS k
      ), e AS (
        SELECT id, row_number() OVER (ORDER BY id) AS k FROM gym_member_list_entries WHERE gym_id = ${gym.id}
      ), gm AS (
        INSERT INTO gym_members (gym_id, user_id, entry_id) SELECT ${gym.id}, m.id, e.id FROM m JOIN e ON e.k = m.k RETURNING user_id, entry_id
      )
      INSERT INTO gym_attendance (gym_id, user_id, entry_id, marked_by_user_id, day, method, hours_status, slot_key)
      SELECT ${gym.id}, user_id, entry_id, ${owner.id}, '2030-12-01', 'manual', 'hours_unset', 'hours_unset' FROM gm`;
    await sql`INSERT INTO gym_leads (gym_id, full_name, source, email) SELECT ${gym.id}, 'Lead ' || k, 'walk_in', 'l' || k || '@example.com' FROM generate_series(1, 50) k`;
    await sql`
      INSERT INTO gym_staff_invites (gym_id, email, role, privileges, created_at, expires_at)
      SELECT ${gym.id}, 'c' || k || '@example.com', 'trainer', '{}', ${T0}, ${plusDays(T0, 3650)} FROM generate_series(1, 5) k`;
  }
  const [sizes] = await sql<{ gyms: number; tokens: number }[]>`SELECT (SELECT count(*)::int FROM gyms) AS gyms, (SELECT count(*)::int FROM refresh_tokens) AS tokens`;
  console.log("database:", sizes);

  const log = { info: (): void => undefined, error: (): void => undefined };
  const mail = { webOrigin: "http://localhost", transport: { send: (): Promise<void> => Promise.resolve() } };
  const deleteDay = addMonths(T0, 6);
  // Only this script's gyms are ever written to; the read is timed over every gym.
  const ours = (await sql<{ id: string }[]>`SELECT id FROM gyms WHERE slug LIKE ${`${P}%`}`).map((r) => r.id);
  const time = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    const runs: number[] = [];
    for (let r = 0; r < 3; r += 1) {
      const t = performance.now();
      await fn();
      runs.push(Math.round((performance.now() - t) * 10) / 10);
    }
    console.log(label, runs.join(" / "), "ms");
  };
  await time("the nightly read over every gym, a quiet night:", () => dueGyms(sql, plusDays(T0, 10), null));
  await time("the nightly read over every gym, on the month-email night:", () => dueGyms(sql, plusDays(deleteDay, -30), null));
  let t = performance.now();
  console.log("month-email night, 20 gyms:", await sweepGoneForGood({ sql, log, mail }, { now: plusDays(deleteDay, -30), gymIds: ours }), Math.round(performance.now() - t), "ms");
  t = performance.now();
  console.log("week-email night, 20 gyms:", await sweepGoneForGood({ sql, log, mail }, { now: plusDays(deleteDay, -7), gymIds: ours }), Math.round(performance.now() - t), "ms");
  // The deletion night, one gym at a time, so each gym's held row is timed.
  const held: number[] = [];
  for (const id of gone) {
    t = performance.now();
    await sweepGoneForGood({ sql, log, mail }, { now: deleteDay, gymIds: [id] });
    held.push(Math.round(performance.now() - t));
  }
  held.sort((a, b) => a - b);
  console.log("deletion night, each gym of 200 (ms, sorted):", held.join(" "));
  const [left] = await sql<{ entries: number; leads: number; visits: number }[]>`
    SELECT (SELECT count(*)::int FROM gym_member_list_entries WHERE gym_id = ANY(${gone})) AS entries,
           (SELECT count(*)::int FROM gym_leads WHERE gym_id = ANY(${gone})) AS leads,
           (SELECT count(*)::int FROM gym_attendance WHERE gym_id = ANY(${gone})) AS visits`;
  console.log("left after:", left);
  await cleanup();
  await sql.end();
}

await main();
