// What deleting many leads at once costs the server at the biggest size (ROADMAP 20c-vii;
// CLAUDE.md §4, cost at full size): a gym with 10,000 leads. For each thing staff do —
// Select all, open the Delete box, press Delete, and the same for 500 ticked — how long it
// takes and how long the server answers NOBODY meanwhile (the event loop's longest stall).
// Against a LOCAL database only:
//
//   DATABASE_URL=postgres://aihg:aihg@localhost:5433/aihg_b corepack pnpm --filter api exec tsx tools/measure-leads-delete-cost.ts
//
// LEADS=200 in the environment measures a smaller gym (the launch shape).
//
// It makes its own owner and gym (`ldcost-*`) and deletes them after.
import postgres from "postgres";
import { LEADS_MAX_PER_GYM, LEADS_TICKED_MAX } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("a LOCAL database only");
const RUNS = Number(process.env["RUNS"] ?? 3);
const LEADS = Number(process.env["LEADS"] ?? LEADS_MAX_PER_GYM);
if (!Number.isInteger(LEADS) || LEADS < 1 || LEADS > LEADS_MAX_PER_GYM) throw new Error(`LEADS must be 1 to ${String(LEADS_MAX_PER_GYM)}`);

const env = { NODE_ENV: "test", DATABASE_URL: url, WEB_ORIGIN: "http://localhost:5173", JWT_SECRET: "lead-delete-cost-secret-0123456789ab", LOG_LEVEL: "error" }; // dummy local value, gitleaks:allow
const sql = postgres(url, { prepare: false, max: 4 });
const app = await buildApp(loadConfig(env), {
  emailSender: { sendVerificationEmail: () => Promise.resolve(), sendPasswordResetEmail: () => Promise.resolve(), sendSignInCodeEmail: () => Promise.resolve() },
});
await app.ready();

const cleanup = async () => {
  const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'ldcost-%@example.com')`;
  await sql`DELETE FROM gym_leads WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM gym_codes WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM gyms WHERE id IN (${mine})`;
  await sql`DELETE FROM users WHERE email LIKE 'ldcost-%@example.com'`;
};

let ip = 0;
const inject = (method: "GET" | "POST", path: string, payload: unknown, cookies: Record<string, string>) =>
  app.inject({
    method,
    url: path,
    remoteAddress: `10.97.0.${String((ip++ % 250) + 1)}`,
    cookies,
    ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
  });

/** Runs `work`, returning its time and the longest stretch in which the server could answer
 *  nobody: the biggest gap between two turns of a `setImmediate` chain. (A timer-based
 *  reading rounds any wait up to Windows' 15.6 ms tick, so it cannot see below that.) */
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

const range = (xs: number[]) => `${Math.min(...xs).toFixed(0)}–${Math.max(...xs).toFixed(0)} ms`;
function line(label: string, times: number[], stalls: number[]): void {
  console.log(`${label}: ${range(times)}, answering nobody at most ${Math.max(...stalls).toFixed(1)} ms (runs: ${stalls.map((x) => x.toFixed(1)).join(", ")})`);
}

try {
  await cleanup();
  const email = `ldcost-${Date.now().toString(36)}@example.com`;
  await inject("POST", "/v1/auth/register", { email, password: "a-Perfectly-fine-pw-1", displayName: "Cost" }, {}); // gitleaks:allow
  const login = await inject("POST", "/v1/auth/login", { email, password: "a-Perfectly-fine-pw-1" }, {}); // gitleaks:allow
  const cookies = Object.fromEntries(login.cookies.map((c) => [c.name, c.value]));
  const created = JSON.parse((await inject("POST", "/v1/orgs", { trainsHere: true, name: "Lead Delete Cost Gym", city: "Leeds", country: "GB", timezone: "Europe/London" }, cookies)).body) as {
    org: { id: string };
  };
  const gymId = created.org.id;
  await sql`
    INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
    VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE audience = 'org' ORDER BY rank LIMIT 1), 'trialing', 'pilot')`;
  const fill = async () => {
    await sql`DELETE FROM gym_leads WHERE gym_id = ${gymId}`;
    await sql`
      INSERT INTO gym_leads (gym_id, full_name, email, source)
      SELECT ${gymId}, 'Lead ' || n, 'ldcost-lead-' || n || '@example.com', 'website'
      FROM generate_series(1, ${LEADS}) AS n`;
    await sql`ANALYZE gym_leads`;
  };
  const base = `/v1/orgs/${gymId}/leads`;

  console.log(`${String(LEADS)} leads, one gym:`);
  const times = { page: [] as number[], all: [] as number[], box: [] as number[], press: [] as number[], tickBox: [] as number[], tickPress: [] as number[] };
  const stalls = { page: [] as number[], all: [] as number[], box: [] as number[], press: [] as number[], tickBox: [] as number[], tickPress: [] as number[] };
  const keep = (key: keyof typeof times, got: { ms: number; stallMs: number }) => {
    times[key].push(got.ms);
    stalls[key].push(got.stallMs);
  };
  for (let run = 0; run < RUNS; run++) {
    await fill();
    keep("page", await measure(() => inject("GET", base, undefined, cookies)));
    const all = await measure(() => inject("POST", `${base}/selection`, { filter: {} }, cookies));
    keep("all", all);
    const chosen = (JSON.parse(all.value.body) as { selection: { count: number; digest: string } }).selection;
    const selection = { kind: "all", filter: {}, count: chosen.count, digest: chosen.digest };
    const box = await measure(() => inject("POST", `${base}/selected/delete-preview`, { selection }, cookies));
    keep("box", box);
    const digest = (JSON.parse(box.value.body) as { preview: { digest: string } }).preview.digest;
    const press = await measure(() => inject("POST", `${base}/selected/delete`, { selection, digest }, cookies));
    if (press.value.statusCode !== 200) throw new Error(`press answered ${String(press.value.statusCode)}: ${press.value.body}`);
    keep("press", press);

    await fill();
    const ids = (await sql<{ id: string }[]>`SELECT id FROM gym_leads WHERE gym_id = ${gymId} LIMIT ${LEADS_TICKED_MAX}`).map((r) => r.id);
    const ticked = { kind: "ticked", leadIds: ids };
    const tickBox = await measure(() => inject("POST", `${base}/selected/delete-preview`, { selection: ticked }, cookies));
    keep("tickBox", tickBox);
    const tickDigest = (JSON.parse(tickBox.value.body) as { preview: { digest: string } }).preview.digest;
    keep("tickPress", await measure(() => inject("POST", `${base}/selected/delete`, { selection: ticked, digest: tickDigest }, cookies)));
  }
  line("  open Leads (a page of 100)", times.page, stalls.page);
  line(`  Select all ${String(LEADS)}`, times.all, stalls.all);
  line(`  the Delete box for all ${String(LEADS)}`, times.box, stalls.box);
  line(`  press Delete, all ${String(LEADS)}`, times.press, stalls.press);
  line(`  the Delete box for ${String(Math.min(LEADS_TICKED_MAX, LEADS))} ticked`, times.tickBox, stalls.tickBox);
  line(`  press Delete, ${String(Math.min(LEADS_TICKED_MAX, LEADS))} ticked`, times.tickPress, stalls.tickPress);
} finally {
  await cleanup();
  await app.close();
  await sql.end({ timeout: 5 });
}
