// What the admin page's list costs at full size (ROADMAP Stage 2 item 14a-i; CLAUDE.md §4 "Cost at
// full size"): 10,000 more people, 4,000 of them members of 20 gyms of 200 on a live plan, 500 with
// Kd's own numbers, all taken out again at the end, whatever happens.
//
//   DATABASE_URL=postgres://… corepack pnpm --filter api exec tsx tools/measure-admin-people-cost.ts
//
// Prints the whole read of one page (the database and the server) and the server's own work on it
// (the time it answers nobody: its CPU time, averaged over 20 reads, as Windows counts CPU time in
// steps of about 15 ms), for the first page, a search and a later page.
import postgres from "postgres";
import { createMemoryRedis } from "../src/redis.js";
import { listPeople } from "../src/modules/admin/service.js";

const url = process.env["DATABASE_URL"];
if (url === undefined || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
  throw new Error("DATABASE_URL must be a local database");
}
const sql = postgres(url, { prepare: false, max: 10 });

const PEOPLE = 10_000;
const GYMS = 20;
const PER_GYM = 200;
const SET = 500;

const median = (xs: number[]): string => {
  const s = [...xs].sort((a, b) => a - b);
  return (s[Math.floor(s.length / 2)] ?? 0).toFixed(1);
};

const tx = sql;
const cleanUp = async (): Promise<void> => {
  const mine = sql`SELECT id FROM users WHERE email LIKE 'measure-admin-%@gmail.com'`;
  await sql`DELETE FROM usage_limits WHERE user_id IN (${mine})`;
  await sql`DELETE FROM gym_members WHERE user_id IN (${mine})`;
  await sql`DELETE FROM subscriptions WHERE owner_id IN (SELECT id FROM gyms WHERE slug LIKE 'measure-admin-%')`;
  await sql`DELETE FROM gyms WHERE slug LIKE 'measure-admin-%'`;
  await sql`DELETE FROM users WHERE email LIKE 'measure-admin-%@gmail.com'`;
};

try {
  await cleanUp();
  {
    const people = (await tx<{ id: string }[]>`
      INSERT INTO users (email, display_name, created_at)
      SELECT 'measure-admin-' || i || '@gmail.com', 'Measure Person ' || i, now() - make_interval(mins => i)
      FROM generate_series(1, ${PEOPLE}) AS i ORDER BY i RETURNING id`).map((r) => r.id);
    const gyms = (await tx<{ id: string }[]>`
      INSERT INTO gyms (slug, name, owner_user_id)
      SELECT 'measure-admin-' || g, 'Measure Gym ' || g, (${people}::uuid[])[g] FROM generate_series(1, ${GYMS}) AS g RETURNING id`).map((r) => r.id);
    await tx`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      SELECT 'gym', g, (SELECT id FROM plans WHERE code = 'org_b1_us_m'), 'active', 'pilot' FROM unnest(${gyms}::uuid[]) AS g`;
    await tx`
      INSERT INTO gym_members (gym_id, user_id)
      SELECT (${gyms}::uuid[])[1 + (i - 1) / ${PER_GYM}], (${people}::uuid[])[i] FROM generate_series(1, ${GYMS * PER_GYM}) AS i`;
    await tx`
      INSERT INTO usage_limits (user_id, meal_scans_a_day)
      SELECT (${people}::uuid[])[i], 15 FROM generate_series(1, ${PEOPLE}, ${PEOPLE / SET}) AS i`;
    const total = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM users WHERE status = 'active'`;
    console.log(`people using the app in this database: ${String(total[0]?.n ?? 0)}`);

    const first = await listPeople({ sql: tx, redis: createMemoryRedis() }, {});
    const cases = [
      { said: "first page", query: {} },
      { said: "a search (\"person 99\")", query: { search: "person 99" } },
      { said: "a later page", query: first.next === null ? {} : { after: first.next } },
    ];
    const READS = 20;
    for (const c of cases) {
      const whole: number[] = [];
      let shown = 0;
      const cpu = process.cpuUsage();
      for (let k = 0; k < READS; k++) {
        const t = performance.now();
        shown = (await listPeople({ sql: tx, redis: createMemoryRedis() }, c.query)).people.length;
        whole.push(performance.now() - t);
      }
      const used = process.cpuUsage(cpu);
      const own = (used.user + used.system) / 1000 / READS;
      console.log(`${c.said}: ${String(shown)} people; whole read median ${median(whole)} ms; the server's own work (answering nobody) ${own.toFixed(1)} ms a read`);
    }
  }
} finally {
  await cleanUp();
  await sql.end();
}
