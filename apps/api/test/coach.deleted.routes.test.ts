// The AI chat coach is deleted (Kd, 2026-10-15; ROADMAP Stage 1 item 9). Its
// addresses answer "not found" to everybody. Its old chats went with its tables
// (ROADMAP 9b), and a person's data download and account removal work as before.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { dpdpExportSchema } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { purgeUser } from "../src/modules/privacy/purge.js";
import { DPDP_RETENTION_DAYS } from "../src/retention.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");
const DAY_MS = 24 * 60 * 60 * 1000;

d("the deleted chat coach (real Postgres)", () => {
  const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
  const sql = postgres(url ?? "", { prepare: false, max: 4 });
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let ipCounter = 0;
  const nextIp = () => `10.9.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

  const api = () => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const inject = (o: { method: "GET" | "POST" | "DELETE"; url: string; body?: unknown; cookies?: Record<string, string> }) =>
    api().inject({
      method: o.method,
      url: o.url,
      remoteAddress: nextIp(),
      headers: o.body !== undefined ? { "content-type": "application/json" } : {},
      cookies: o.cookies ?? {},
      ...(o.body !== undefined ? { payload: JSON.stringify(o.body) } : {}),
    });

  const signIn = async (email: string): Promise<{ userId: string; cookies: Record<string, string> }> => {
    const reg = await inject({ method: "POST", url: "/v1/auth/register", body: { email, password: PASSWORD, displayName: "Old Coach User" } });
    expect(reg.statusCode).toBe(201);
    const login = await inject({ method: "POST", url: "/v1/auth/login", body: { email, password: PASSWORD } });
    expect(login.statusCode).toBe(200);
    const row = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`;
    return { userId: row[0]?.id ?? "", cookies: Object.fromEntries(login.cookies.map((c) => [c.name, c.value])) };
  };

  const weighIn = async (userId: string, kg: number): Promise<string> => {
    const row = await sql<{ id: string }[]>`
      INSERT INTO body_measurements (user_id, measured_at, weight_kg) VALUES (${userId}, now(), ${kg}) RETURNING id`;
    return row[0]?.id ?? "";
  };

  beforeAll(async () => {
    await sql`DELETE FROM users WHERE email LIKE 'coach-deleted-%@example.com'`;
    app = await buildApp(
      loadConfig({
        NODE_ENV: "test",
        DATABASE_URL: url ?? "",
        WEB_ORIGIN: "http://localhost:5173",
        JWT_SECRET: "coach-deleted-secret-0123456789abcdef-32", // dummy test value, gitleaks:allow
        LOG_LEVEL: "error",
        // An AI key set must not bring the coach back: nothing reads it for chat.
        OPENAI_API_KEY: "sk-not-a-real-key", // dummy test value, gitleaks:allow
      }),
    );
  }, 60_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await sql`DELETE FROM body_measurements WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'coach-deleted-%@example.com')`;
    await sql`DELETE FROM users WHERE email LIKE 'coach-deleted-%@example.com'`;
    await sql.end({ timeout: 5 });
  });

  it("with the chat tables gone, a person's data download and account removal still work, and take nobody else's data", { timeout: 60_000 }, async () => {
    const me = await signIn(`coach-deleted-mine-${String(Date.now())}@example.com`);
    const them = await signIn(`coach-deleted-theirs-${String(Date.now())}@example.com`);
    const mine = await weighIn(me.userId, 71.5);
    const theirs = await weighIn(them.userId, 64.25);

    const download = await inject({ method: "GET", url: "/v1/users/me/export", cookies: me.cookies });
    expect(download.statusCode).toBe(200);
    const file = dpdpExportSchema.parse(JSON.parse(download.body));
    expect(file.data["body_measurements"]?.map((m) => m.id)).toEqual([mine]);
    expect(Object.keys(file.data).filter((t) => t.startsWith("coach"))).toEqual([]);
    expect(download.body).not.toContain(theirs);

    // The account is deleted and its two weeks have passed.
    await sql`UPDATE users SET status = 'deleted', deleted_at = ${new Date(Date.now() - (DPDP_RETENTION_DAYS + 1) * DAY_MS)}
              WHERE id = ${me.userId}`;
    const cutoff = new Date(Date.now() - DPDP_RETENTION_DAYS * DAY_MS);
    expect(await sql.begin((tx) => purgeUser(tx, me.userId, cutoff))).toBe("purged");
    const left = await sql<{ id: string }[]>`SELECT id FROM body_measurements WHERE id IN (${mine}, ${theirs})`;
    expect(left.map((r) => r.id)).toEqual([theirs]);
  });

  // 0125's plan and badge statements are tested on rows that hold them, in db.migration.test.ts.
  it("the chat tables are gone from the database", { timeout: 60_000 }, async () => {
    const tables = await sql<{ t: string }[]>`
      SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('coach_threads', 'coach_messages', 'kb_chunks')`;
    expect(tables).toEqual([]);
  });

  it("answers 'not found' at every coach address, signed in or not", { timeout: 60_000 }, async () => {
    const me = await signIn(`coach-deleted-routes-${String(Date.now())}@example.com`);
    const threadId = "00000000-0000-4000-8000-000000000009";
    const addresses: { method: "GET" | "POST" | "DELETE"; url: string; body?: unknown }[] = [
      { method: "POST", url: "/v1/coach/chat", body: { message: "hi" } },
      { method: "GET", url: "/v1/coach/threads" },
      { method: "GET", url: `/v1/coach/threads/${threadId}` },
      { method: "DELETE", url: `/v1/coach/threads/${threadId}` },
    ];
    for (const a of addresses) {
      for (const cookies of [me.cookies, {}]) {
        const res = await inject({ ...a, cookies });
        expect({ at: `${a.method} ${a.url}`, status: res.statusCode }).toEqual({ at: `${a.method} ${a.url}`, status: 404 });
      }
    }
  });
});
