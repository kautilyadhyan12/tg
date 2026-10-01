// What a gym page's photos cost the server (ROADMAP 20c-iv-b; CLAUDE.md §4, cost at full
// size): for each thing people do — add a photo, open the page, fetch its ten photos,
// remove one — how long it takes and how long the server answers NOBODY meanwhile (the
// event loop's longest stall). Against a LOCAL database only:
//
//   DATABASE_URL=postgres://aihg:aihg@localhost:5433/aihg_b corepack pnpm --filter api exec tsx tools/measure-photo-cost.ts <photo.jpg>
//
// It makes its own owner and gym (`gphoto-cost-*`) and deletes them after.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDiskPhotoStore } from "../src/modules/orgs/gymPage/photoStore.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("a LOCAL database only");
const photoPath = process.argv[2];
if (photoPath === undefined) throw new Error("usage: measure-photo-cost.ts <photo>");

const sql = postgres(url, { prepare: false, max: 2 });
const folder = await mkdtemp(join(tmpdir(), "aihg-photo-cost-"));
const app = await buildApp(
  loadConfig({ NODE_ENV: "test", DATABASE_URL: url, WEB_ORIGIN: "http://localhost:5173", JWT_SECRET: "photo-cost-secret-0123456789abcdefgh", LOG_LEVEL: "error" }), // dummy local value, gitleaks:allow
  {
    emailSender: { sendVerificationEmail: () => Promise.resolve(), sendPasswordResetEmail: () => Promise.resolve(), sendSignInCodeEmail: () => Promise.resolve() },
    photoStore: createDiskPhotoStore(folder),
  },
);
await app.ready();

const cleanup = async () => {
  const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'gphoto-cost-%@example.com')`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
  await sql`DELETE FROM gyms WHERE id IN (${mine})`;
  await sql`DELETE FROM users WHERE email LIKE 'gphoto-cost-%@example.com'`;
};

let ip = 0;
const inject = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, payload?: unknown, cookies: Record<string, string> = {}) =>
  app.inject({
    method,
    url: path,
    remoteAddress: `10.99.0.${String((ip++ % 250) + 1)}`,
    cookies,
    ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
  });

/** Runs `work`, returning its time and the event loop's longest stall meanwhile. */
async function measure<T>(work: () => Promise<T>): Promise<{ ms: number; stallMs: number; value: T }> {
  const h = monitorEventLoopDelay({ resolution: 1 });
  h.enable();
  const start = process.hrtime.bigint();
  const value = await work();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  h.disable();
  return { ms, stallMs: h.max / 1e6, value };
}

try {
  await cleanup();
  const email = `gphoto-cost-${Date.now().toString(36)}@example.com`;
  await inject("POST", "/v1/auth/register", { email, password: "a-Perfectly-fine-pw-1", displayName: "Cost" }); // gitleaks:allow
  const login = await inject("POST", "/v1/auth/login", { email, password: "a-Perfectly-fine-pw-1" }); // gitleaks:allow
  const cookies = Object.fromEntries(login.cookies.map((c) => [c.name, c.value]));
  const created = JSON.parse((await inject("POST", "/v1/orgs", { trainsHere: true, name: "Cost Gym", city: "Leeds", country: "GB", timezone: "Europe/London" }, cookies)).body) as {
    org: { id: string; slug: string };
  };
  const gym = created.org;
  await sql`
    INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
    VALUES ('gym', ${gym.id}, (SELECT id FROM plans WHERE audience = 'org' ORDER BY rank LIMIT 1), 'trialing', 'pilot')`;
  await inject("PUT", `/v1/orgs/${gym.id}/page`, { shown: true, about: "", facilities: [], ownFacilities: [] }, cookies);

  const bytes = await readFile(photoPath);
  const contentBase64 = bytes.toString("base64");
  console.log(`photo: ${String(bytes.length)} bytes (${String(contentBase64.length)} as base64)`);

  const ids: string[] = [];
  const adds: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = await measure(() => inject("POST", `/v1/orgs/${gym.id}/page/photos`, { contentBase64, uploadKey: randomUUID() }, cookies));
    if (r.value.statusCode !== 201) throw new Error(`add ${String(i)}: ${String(r.value.statusCode)} ${r.value.body}`);
    ids.push((JSON.parse(r.value.body) as { photo: { id: string } }).photo.id);
    adds.push(`${r.ms.toFixed(0)} ms (stall ≤ ${r.stallMs.toFixed(1)})`);
  }
  console.log(`add a photo, 10 times: ${adds.join(" · ")}`);

  for (let run = 1; run <= 3; run++) {
    const page = await measure(() => inject("GET", `/v1/public/gyms/${gym.slug}`));
    const photos = await measure(async () => {
      for (const id of ids) {
        const res = await inject("GET", `/v1/public/gyms/${gym.slug}/photos/${id}`);
        if (res.statusCode !== 200) throw new Error(`photo ${String(res.statusCode)}`);
      }
    });
    const console_ = await measure(() => inject("GET", `/v1/orgs/${gym.id}/page`, undefined, cookies));
    console.log(
      `run ${String(run)}: public page ${page.ms.toFixed(1)} ms (stall ≤ ${page.stallMs.toFixed(1)}) · its 10 photos ${photos.ms.toFixed(0)} ms (stall ≤ ${photos.stallMs.toFixed(1)}) · console page ${console_.ms.toFixed(1)} ms (stall ≤ ${console_.stallMs.toFixed(1)})`,
    );
  }
  await measure(() => inject("PUT", `/v1/orgs/${gym.id}/page/photos/order`, { photoIds: [...ids].reverse() }, cookies));
  // The second: the first also pays for the database driver learning the array types, once.
  // The same ten photos over real HTTP, fetched by curl in a process of its own, so the
  // stall is the server's alone (inject's client runs in this process and turns each
  // 2 MB reply into a string).
  const address = await app.listen({ port: 0, host: "127.0.0.1" });
  for (let run = 1; run <= 3; run++) {
    const overHttp = await measure(async () => {
      for (const id of ids) {
        await new Promise<void>((resolve, reject) => {
          execFile("curl", ["-s", "-o", devNull, "-w", "%{http_code}", `${address}/v1/public/gyms/${gym.slug}/photos/${id}`], (err, out) => {
            if (err !== null) reject(new Error(err.message));
            else if (out === "200") resolve();
            else reject(new Error(out));
          });
        });
      }
    });
    console.log(`run ${String(run)}, over HTTP: its 10 photos ${overHttp.ms.toFixed(0)} ms (stall ≤ ${overHttp.stallMs.toFixed(1)})`);
  }
  const order = await measure(() => inject("PUT", `/v1/orgs/${gym.id}/page/photos/order`, { photoIds: ids }, cookies));
  const remove = await measure(() => inject("DELETE", `/v1/orgs/${gym.id}/page/photos/${ids[0] ?? ""}`, undefined, cookies));
  console.log(`reorder 10: ${order.ms.toFixed(1)} ms (stall ≤ ${order.stallMs.toFixed(1)}) · remove one: ${remove.ms.toFixed(1)} ms (stall ≤ ${remove.stallMs.toFixed(1)})`);
} finally {
  await cleanup();
  await app.close();
  await sql.end({ timeout: 5 });
  await rm(folder, { recursive: true, force: true });
}
