// What a search for people costs the server (V1-e-ii; CLAUDE.md §4, cost at full size): one
// business at the biggest size the app allows (10,000 on its list, 10,000 leads) and at the
// launch shape (200 of each). For each kind of word staff type, how long one search takes and how
// long the server answers NOBODY meanwhile (the event loop's longest stall). A LOCAL database only:
//
//   DATABASE_URL=postgres://aihg:aihg@localhost:5433/aihg corepack pnpm --filter api exec tsx tools/measure-console-search-cost.ts
//
// SIZE=200 measures the launch shape. It makes its own owner and business (`cscost-*`) and
// deletes them after.
import postgres from "postgres";
import { LEADS_MAX_PER_GYM, MEMBER_LIST_MAX_DATA_ROWS } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("a LOCAL database only");
const RUNS = Number(process.env["RUNS"] ?? 5);
const SIZE = Number(process.env["SIZE"] ?? Math.min(MEMBER_LIST_MAX_DATA_ROWS, LEADS_MAX_PER_GYM));
if (!Number.isInteger(SIZE) || SIZE < 1 || SIZE > MEMBER_LIST_MAX_DATA_ROWS) throw new Error(`SIZE must be 1 to ${String(MEMBER_LIST_MAX_DATA_ROWS)}`);

const env = { NODE_ENV: "test", DATABASE_URL: url, WEB_ORIGIN: "http://localhost:5173", JWT_SECRET: "console-search-cost-secret-0123456", LOG_LEVEL: "error" }; // dummy local value, gitleaks:allow
const sql = postgres(url, { prepare: false, max: 4 });
const app = await buildApp(loadConfig(env), {
  emailSender: { sendVerificationEmail: () => Promise.resolve(), sendPasswordResetEmail: () => Promise.resolve(), sendSignInCodeEmail: () => Promise.resolve() },
});
await app.ready();

const cleanup = async () => {
  const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'cscost-%@example.com')`;
  await sql`DELETE FROM gym_leads WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM gym_codes WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM gyms WHERE id IN (${mine})`;
  await sql`DELETE FROM users WHERE email LIKE 'cscost-%@example.com'`;
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

/** Runs `work`, returning its time and the longest stretch in which the server could answer
 *  nobody: the biggest gap between two turns of a `setImmediate` chain. */
async function measure<T>(work: () => Promise<T>): Promise<{ ms: number; stallMs: number; value: T }> {
  let last = process.hrtime.bigint();
  let worst = 0n;
  let on = true;
  const turn = (): void => {
    const now = process.hrtime.bigint();
    if (now - last > worst) worst = now - last;
    last = now;
    if (on) setImmediate(turn);
  };
  setImmediate(turn);
  const start = process.hrtime.bigint();
  const value = await work();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  on = false;
  return { ms, stallMs: Number(worst) / 1e6, value };
}

try {
  await cleanup();
  const email = `cscost-${Date.now().toString(36)}@example.com`;
  await inject("POST", "/v1/auth/register", { email, password: "a-Perfectly-fine-pw-1", displayName: "Cost" }, {}); // gitleaks:allow
  const login = await inject("POST", "/v1/auth/login", { email, password: "a-Perfectly-fine-pw-1" }, {}); // gitleaks:allow
  const cookies = Object.fromEntries(login.cookies.map((c) => [c.name, c.value]));
  const created = JSON.parse((await inject("POST", "/v1/orgs", { trainsHere: true, name: "Search Cost Gym", city: "Leeds", country: "GB", timezone: "Europe/London" }, cookies)).body) as {
    org: { id: string };
  };
  const gymId = created.org.id;
  await sql`
    INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
    VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE audience = 'org' ORDER BY rank LIMIT 1), 'trialing', 'pilot')`;
  // The list, its leads, and as many people in the app: the list's search reads who is in the
  // app to say who of the list is.
  await sql`
    INSERT INTO gym_member_list_entries (gym_id, full_name, email, member_number, status, membership_type, payment_status, identity_key, source)
    SELECT ${gymId}, 'Member ' || n || ' Rivera', 'cscost-entry-' || n || '@example.com', 'M' || n, 'Active', 'Gold Monthly', 'Paid',
           encode(sha256(convert_to('cscost-' || n, 'UTF8')), 'hex'), 'typed'
    FROM generate_series(1, ${SIZE}) AS n`;
  await sql`
    INSERT INTO gym_leads (gym_id, full_name, email, source)
    SELECT ${gymId}, 'Lead ' || n || ' Rivera', 'cscost-lead-' || n || '@example.com', 'website'
    FROM generate_series(1, ${SIZE}) AS n`;
  await sql`
    WITH made AS (
      INSERT INTO users (email, display_name)
      SELECT 'cscost-app-' || n || '@example.com', 'App ' || n FROM generate_series(1, ${SIZE}) AS n
      RETURNING id)
    INSERT INTO gym_members (gym_id, user_id) SELECT ${gymId}, id FROM made`;
  await sql`ANALYZE gym_member_list_entries`;
  await sql`ANALYZE gym_leads`;

  const words = [
    { label: "a name that finds one person", typed: "Member 4321 Rivera" },
    { label: "two letters that find everybody", typed: "ri" },
    { label: "an email domain that finds everybody", typed: "example.com" },
    { label: "a word that finds nobody", typed: "zebedee" },
  ];
  console.log(`${String(SIZE)} on the list, ${String(SIZE)} leads, ${String(SIZE)} in the app, one business:`);
  for (const { label, typed } of words) {
    const times: number[] = [];
    const stalls: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      const got = await measure(() => inject("GET", `/v1/orgs/${gymId}/search/people?query=${encodeURIComponent(typed)}`, undefined, cookies));
      if (got.value.statusCode !== 200) throw new Error(`search answered ${String(got.value.statusCode)}`);
      times.push(got.ms);
      stalls.push(got.stallMs);
    }
    // The first run warms the statement plans; the rest are what staff wait for.
    const warm = times.slice(1);
    const warmStalls = stalls.slice(1);
    console.log(
      `  ${label}: ${Math.min(...warm).toFixed(0)}–${Math.max(...warm).toFixed(0)} ms, answering nobody at most ${Math.max(...warmStalls).toFixed(1)} ms (first run ${times[0]?.toFixed(0) ?? "?"} ms, stall ${stalls[0]?.toFixed(1) ?? "?"} ms)`,
    );
  }
} finally {
  await cleanup();
  await app.close();
  await sql.end({ timeout: 5 });
}
