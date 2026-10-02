// How long a bystander waits beside slow requests (ROADMAP Stage 4 item 11): the api's
// connections to Postgres are DATABASE_POOL_MAX (was one). A gym with 10,000 leads opens
// the Delete box for all of them — one of the slower things staff do — while another
// person's request (`GET /health`, one `SELECT 1`) is timed over and over.
// Against a LOCAL database only, once with each pool size:
//
//   DATABASE_URL=postgres://aihg:aihg@localhost:5433/aihg_b DATABASE_POOL_MAX=1 corepack pnpm --filter api exec tsx tools/measure-pool-cost.ts
//   DATABASE_URL=postgres://aihg:aihg@localhost:5433/aihg_b DATABASE_POOL_MAX=10 corepack pnpm --filter api exec tsx tools/measure-pool-cost.ts
//
// It makes its own owner and gym (`poolcost-*`) and deletes them after.
import postgres from "postgres";
import { LEADS_MAX_PER_GYM } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("a LOCAL database only");
const RUNS = Number(process.env["RUNS"] ?? 3);
const STAFF = Number(process.env["STAFF"] ?? 4);

const env = {
  NODE_ENV: "test",
  DATABASE_URL: url,
  DATABASE_POOL_MAX: process.env["DATABASE_POOL_MAX"] ?? "10",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "pool-cost-secret-0123456789abcdefgh", // dummy local value, gitleaks:allow
  LOG_LEVEL: "error",
};
const config = loadConfig(env);
const sql = postgres(url, { prepare: false, max: 2 });
const app = await buildApp(config, {
  emailSender: { sendVerificationEmail: () => Promise.resolve(), sendPasswordResetEmail: () => Promise.resolve(), sendSignInCodeEmail: () => Promise.resolve() },
});
await app.ready();

const cleanup = async () => {
  const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'poolcost-%@example.com')`;
  await sql`DELETE FROM gym_leads WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM gym_codes WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM gyms WHERE id IN (${mine})`;
  await sql`DELETE FROM users WHERE email LIKE 'poolcost-%@example.com'`;
};

let ip = 0;
const inject = (method: "GET" | "POST", path: string, payload: unknown, cookies: Record<string, string>) =>
  app.inject({
    method,
    url: path,
    remoteAddress: `10.98.0.${String((ip++ % 250) + 1)}`,
    cookies,
    ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
  });

let probe = 0;
/** Times `GET /health` back to back until `work` settles; returns every wait. */
async function bystander(work: Promise<unknown>): Promise<number[]> {
  const state = { done: false };
  void work.finally(() => {
    state.done = true;
  });
  const waits: number[] = [];
  while (!state.done) {
    const start = process.hrtime.bigint();
    // Each from its own address, so the app-wide limit never answers in the database's place.
    const res = await app.inject({ method: "GET", url: "/health", remoteAddress: `10.99.${String(Math.floor(probe / 250) % 250)}.${String((probe % 250) + 1)}` });
    probe++;
    if (res.statusCode !== 200) throw new Error(`/health answered ${String(res.statusCode)}`);
    waits.push(Number(process.hrtime.bigint() - start) / 1e6);
  }
  await work;
  return waits;
}

const pct = (xs: number[], p: number) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
};
const report = (label: string, waits: number[], took: number): void => {
  console.log(
    `${label}: took ${took.toFixed(0)} ms; bystander ${String(waits.length)} requests, median ${pct(waits, 0.5).toFixed(1)} ms, worst ${Math.max(...waits).toFixed(1)} ms`,
  );
};

try {
  await cleanup();
  const email = `poolcost-${Date.now().toString(36)}@example.com`;
  await inject("POST", "/v1/auth/register", { email, password: "a-Perfectly-fine-pw-1", displayName: "Cost" }, {}); // gitleaks:allow
  const login = await inject("POST", "/v1/auth/login", { email, password: "a-Perfectly-fine-pw-1" }, {}); // gitleaks:allow
  const cookies = Object.fromEntries(login.cookies.map((c) => [c.name, c.value]));
  const created = JSON.parse(
    (await inject("POST", "/v1/orgs", { trainsHere: true, name: "Pool Cost Gym", city: "Leeds", country: "GB", timezone: "Europe/London" }, cookies)).body,
  ) as { org: { id: string } };
  const gymId = created.org.id;
  await sql`
    INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
    VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE audience = 'org' ORDER BY rank LIMIT 1), 'trialing', 'pilot')`;
  await sql`
    INSERT INTO gym_leads (gym_id, full_name, email, source)
    SELECT ${gymId}, 'Lead ' || n, 'poolcost-lead-' || n || '@example.com', 'website'
    FROM generate_series(1, ${LEADS_MAX_PER_GYM}) AS n`;
  await sql`ANALYZE gym_leads`;
  const base = `/v1/orgs/${gymId}/leads`;
  const chosen = (JSON.parse((await inject("POST", `${base}/selection`, { filter: {} }, cookies)).body) as { selection: { count: number; digest: string } }).selection;
  const selection = { kind: "all", filter: {}, count: chosen.count, digest: chosen.digest };
  const box = async () => {
    const res = await inject("POST", `${base}/selected/delete-preview`, { selection }, cookies);
    if (res.statusCode !== 200) throw new Error(`the box answered ${String(res.statusCode)}`);
  };

  console.log(`pool ${String(config.DATABASE_POOL_MAX)}, ${String(LEADS_MAX_PER_GYM)} leads:`);
  for (let run = 0; run < RUNS; run++) {
    let start = performance.now();
    report("  one Delete box for all", await bystander(box()), performance.now() - start);
    start = performance.now();
    const busy = Promise.all(Array.from({ length: STAFF }, async () => {
      for (let i = 0; i < 3; i++) await box();
    }));
    report(`  ${String(STAFF)} staff opening it 3 times each`, await bystander(busy), performance.now() - start);
  }
} finally {
  await cleanup();
  await app.close();
  await sql.end({ timeout: 5 });
}
