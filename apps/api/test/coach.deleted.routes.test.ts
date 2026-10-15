// The AI chat coach is deleted (Kd, 2026-10-15; ROADMAP Stage 1 item 9). Its
// addresses answer "not found" to everybody, and a person's old coach chats are
// still theirs: in their data download, and removed with their account.
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

  /** A chat from before the coach was deleted, as its tables still hold it. */
  const oldChat = async (userId: string, words: string): Promise<{ threadId: string; messageId: string }> => {
    const th = await sql<{ id: string }[]>`
      INSERT INTO coach_threads (user_id, title) VALUES (${userId}, 'Old thread') RETURNING id`;
    const threadId = th[0]?.id ?? "";
    const msg = await sql<{ id: string }[]>`
      INSERT INTO coach_messages (thread_id, role, content) VALUES (${threadId}, 'user', ${words}) RETURNING id`;
    return { threadId, messageId: msg[0]?.id ?? "" };
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
        // A key set must not bring the coach back: nothing reads it for chat.
        GROQ_API_KEY: "gsk_not_a_real_key", // dummy test value, gitleaks:allow
      }),
    );
  }, 60_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await sql`DELETE FROM coach_threads WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'coach-deleted-%@example.com')`;
    await sql`DELETE FROM users WHERE email LIKE 'coach-deleted-%@example.com'`;
    await sql.end({ timeout: 5 });
  });

  it("keeps a person's old coach chats in their data download, and removes them with their account", { timeout: 60_000 }, async () => {
    const me = await signIn(`coach-deleted-mine-${String(Date.now())}@example.com`);
    const them = await signIn(`coach-deleted-theirs-${String(Date.now())}@example.com`);
    const mine = await oldChat(me.userId, "my old question about squats");
    const theirs = await oldChat(them.userId, "somebody else's old question");

    const download = await inject({ method: "GET", url: "/v1/users/me/export", cookies: me.cookies });
    expect(download.statusCode).toBe(200);
    // The message's own words: the thread's title does not hold them, so only coach_messages can.
    const file = dpdpExportSchema.parse(JSON.parse(download.body));
    expect(file.data["coach_messages"]?.map((m) => [m.thread_id, m.content])).toEqual([[mine.threadId, "my old question about squats"]]);
    expect(file.data["coach_threads"]?.length).toBe(1);
    expect(download.body).not.toContain("somebody else's old question");

    // The account is deleted and its two weeks have passed: the removal takes the chats.
    await sql`UPDATE users SET status = 'deleted', deleted_at = ${new Date(Date.now() - (DPDP_RETENTION_DAYS + 1) * DAY_MS)}
              WHERE id = ${me.userId}`;
    const cutoff = new Date(Date.now() - DPDP_RETENTION_DAYS * DAY_MS);
    expect(await sql.begin((tx) => purgeUser(tx, me.userId, cutoff))).toBe("purged");
    const left = await sql<{ threads: number; messages: number }[]>`
      SELECT (SELECT count(*)::int FROM coach_threads WHERE id = ${mine.threadId}) AS threads,
             (SELECT count(*)::int FROM coach_messages WHERE id = ${mine.messageId}) AS messages`;
    expect(left[0]).toEqual({ threads: 0, messages: 0 });
    // Somebody else's chats are untouched.
    const kept = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM coach_messages WHERE id = ${theirs.messageId}`;
    expect(kept[0]?.n).toBe(1);
  });

  it("answers 'not found' at every coach address, signed in or not", { timeout: 60_000 }, async () => {
    const me = await signIn(`coach-deleted-routes-${String(Date.now())}@example.com`);
    const { threadId } = await oldChat(me.userId, "a thread the coach can no longer show");
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
    // The DELETE above did nothing: the thread is still there for the download.
    const still = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM coach_threads WHERE id = ${threadId}`;
    expect(still[0]?.n).toBe(1);
  });
});
