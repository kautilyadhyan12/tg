// P2.5b — coach chat + threads against REAL Postgres (R9.2). DATABASE_URL-
// gated. A FAKE ChatProvider + fake embedder ride buildApp's overrides —
// Groq is never called and no ONNX loads; the real adapter is unit-tested
// with stubbed fetch in coach.llm.unit.test.ts. Requires the KB ingested
// (beforeAll runs the fake-embedder ingest so retrieval has rows).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { createFakeEmbedder } from "../src/modules/coach/embedder.js";
import { ingestKnowledgeBase } from "../src/modules/coach/ingest.js";
import { ProviderError, type ChatMessage, type ChatProvider } from "../src/modules/coach/llm.adapter.js";
import { withFallback } from "../src/modules/coach/llm.adapter.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "coach-test-secret-0123456789abcdef-32", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  GROQ_API_KEY: "dummy-groq-key-not-used-by-fake", // gitleaks:allow — overrides.coach bypasses it
};

type App = Awaited<ReturnType<typeof buildApp>>;

function fakeProvider(): ChatProvider & { calls: ChatMessage[][] } {
  const calls: ChatMessage[][] = [];
  return {
    calls,
    chat(messages) {
      calls.push(messages);
      return Promise.resolve({
        content: `answer #${String(calls.length)}`,
        model: "llama-3.1-8b-instant",
        provider: "groq" as const,
        tokensIn: 100,
        tokensOut: 200,
      });
    },
  };
}

d("coach chat + threads (real Postgres, fake provider)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  const provider = fakeProvider();
  const embedder = createFakeEmbedder();
  let app: App | undefined;
  let cookieA = "";
  let userA = "";
  let cookieB = "";
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const inject = (opts: {
    method: "GET" | "POST" | "DELETE";
    url: string;
    body?: unknown;
    access?: string;
  }) =>
    api().inject({
      method: opts.method,
      url: opts.url,
      headers: opts.body !== undefined ? { "content-type": "application/json" } : {},
      cookies: opts.access !== undefined && opts.access !== "" ? { accessToken: opts.access } : {},
      ...(opts.body !== undefined ? { payload: JSON.stringify(opts.body) } : {}),
    });

  const session = async (email: string): Promise<{ userId: string; access: string }> => {
    const reg = await inject({
      method: "POST",
      url: "/v1/auth/register",
      body: { email, password: PASSWORD, displayName: "P25b Fixture" },
    });
    if (reg.statusCode !== 201) throw new Error(`register failed: ${reg.body}`);
    const { userId } = reg.json<{ userId: string }>();
    const login = await inject({ method: "POST", url: "/v1/auth/login", body: { email, password: PASSWORD } });
    const access = login.cookies.find((c) => c.name === "accessToken")?.value ?? "";
    return { userId, access };
  };

  const chat = (message: string, access = cookieA, threadId?: string) =>
    inject({
      method: "POST",
      url: "/v1/coach/chat",
      body: threadId === undefined ? { message } : { message, threadId },
      access,
    });

  beforeAll(async () => {
    await sql`DELETE FROM coach_threads WHERE user_id IN
      (SELECT id FROM users WHERE email LIKE 'p25b-%@example.com')`;
    await sql`DELETE FROM api_cost_events WHERE user_id IN
      (SELECT id FROM users WHERE email LIKE 'p25b-%@example.com')`;
    await sql`DELETE FROM gym_members WHERE user_id IN
      (SELECT id FROM users WHERE email LIKE 'p25b-%@example.com')`;
    await sql`DELETE FROM subscriptions WHERE owner_id IN
      (SELECT id FROM gyms WHERE slug = 'p25b-gym')`;
    await sql`DELETE FROM gyms WHERE slug = 'p25b-gym'`;
    await sql`DELETE FROM users WHERE email LIKE 'p25b-%@example.com'`;
    await ingestKnowledgeBase(url ?? "", embedder); // retrieval needs chunks
    app = await buildApp(loadConfig(baseEnv), {
      redis,
      coach: { chatProvider: provider, embedder },
    });
    const a = await session("p25b-alice@example.com");
    cookieA = a.access;
    userA = a.userId;
    const b = await session("p25b-bob@example.com");
    cookieB = b.access;
  }, 120_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await sql.end({ timeout: 5 });
  });

  let firstThreadId = "";

  it("chat requires authn; threads too", { timeout: 30_000 }, async () => {
    expect((await chat("hi", "")).statusCode).toBe(401);
    expect((await inject({ method: "GET", url: "/v1/coach/threads" })).statusCode).toBe(401);
  });

  it("happy chat: thread created, exchange persisted with tokens+cost, ONE cost event (v1 §9.3)", { timeout: 30_000 }, async () => {
    const res = await chat("How deep should my squat descent go?");
    expect(res.statusCode).toBe(200);
    const body = res.json<{ threadId: string; reply: string; cached: boolean }>();
    expect(body.cached).toBe(false);
    expect(body.reply).toBe("answer #1");
    firstThreadId = body.threadId;

    const msgs = await sql<
      { role: string; model: string | null; tokens_in: number | null; tokens_out: number | null; cost_micro: string | null }[]
    >`SELECT role, model, tokens_in, tokens_out, cost_micro FROM coach_messages
      WHERE thread_id = ${body.threadId} ORDER BY created_at ASC`;
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[1]?.model).toBe("llama-3.1-8b-instant#p1"); // prompt versioning
    expect(msgs[1]?.tokens_in).toBe(100);
    expect(msgs[1]?.tokens_out).toBe(200);
    expect(msgs[1]?.cost_micro).toBe("21"); // (100·50000+200·80000)/1e6

    const events = await sql<{ provider: string; units: string; cost_micro: string; gym_id: string | null }[]>`
      SELECT provider, units, cost_micro, gym_id FROM api_cost_events WHERE user_id = ${userA}`;
    expect(events.length).toBe(1);
    expect(events[0]?.provider).toBe("groq");
    expect(Number(events[0]?.units)).toBe(300);
    expect(events[0]?.cost_micro).toBe("21");
    expect(events[0]?.gym_id).toBeNull(); // direct consumer (§3.10)

    // The provider saw: system prompt first, RAG context in the user turn.
    const sent = provider.calls[0];
    expect(sent?.[0]?.role).toBe("system");
    expect(sent?.[0]?.content).toContain("expert fitness coach");
    expect(sent?.[sent.length - 1]?.content).toContain("CONTEXT FROM KNOWLEDGE BASE:");
  });

  it("follow-up in the same thread carries history (last 12 — routers/coach.py:33)", { timeout: 30_000 }, async () => {
    const res = await chat("And how wide should my stance be?", cookieA, firstThreadId);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ threadId: string }>().threadId).toBe(firstThreadId);
    const sent = provider.calls[provider.calls.length - 1] ?? [];
    const contents = sent.map((m) => m.content);
    expect(contents.some((c) => c.includes("How deep should my squat descent go?"))).toBe(true);
    expect(contents.some((c) => c === "answer #1")).toBe(true);
  });

  it("exact-match answer cache: identical question = cached reply, NO provider call, NO cost event (GAP-3)", { timeout: 30_000 }, async () => {
    const callsBefore = provider.calls.length;
    const res = await chat("  how deep should MY squat descent   go? "); // normalization test
    expect(res.statusCode).toBe(200);
    const body = res.json<{ cached: boolean; reply: string; threadId: string }>();
    expect(body.cached).toBe(true);
    expect(body.reply).toBe("answer #1");
    expect(provider.calls.length).toBe(callsBefore);
    const events = await sql<{ n: string }[]>`
      SELECT count(*) AS n FROM api_cost_events WHERE user_id = ${userA}`;
    expect(Number(events[0]?.n)).toBe(2); // only the two REAL provider calls so far
    const [cachedMsg] = await sql<{ model: string | null }[]>`
      SELECT model FROM coach_messages WHERE thread_id = ${body.threadId}
      AND role = 'assistant' ORDER BY created_at DESC LIMIT 1`;
    expect(cachedMsg?.model).toBe("cached:llama-3.1-8b-instant");
  });

  it("quota: free coach = 5/month → the 6th question 429s with resetsAt (first REAL requireQuota wiring)", { timeout: 60_000 }, async () => {
    const q = await session("p25b-quota@example.com");
    for (let i = 1; i <= 5; i++) {
      const r = await chat(`distinct question number ${String(i)}`, q.access);
      expect(r.statusCode).toBe(200);
    }
    const sixth = await chat("distinct question number 6", q.access);
    expect(sixth.statusCode).toBe(429);
    const body = sixth.json<{ error: string; resetsAt: string }>();
    expect(body.error).toBe("quota_exceeded");
    expect(new Date(body.resetsAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("gym member: cost event carries gym_id resolved at spend time + costs:gym bump (§3.10, v1 §9.3)", { timeout: 60_000 }, async () => {
    const g = await session("p25b-gymmember@example.com");
    const gymRows = await sql<{ id: string }[]>`
      INSERT INTO gyms (slug, name, owner_user_id) VALUES ('p25b-gym', 'P25b Gym', ${g.userId})
      RETURNING id`;
    const gymId = gymRows[0]?.id;
    if (gymId === undefined) throw new Error("gym fixture failed");
    await sql`INSERT INTO gym_members (gym_id, user_id) VALUES (${gymId}, ${g.userId})`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      SELECT 'gym', ${gymId}, id, 'active', 'pilot' FROM plans WHERE code = 'org_starter'`;

    const res = await chat("a gym member question about recovery", g.access);
    expect(res.statusCode).toBe(200);
    const [event] = await sql<{ gym_id: string | null }[]>`
      SELECT gym_id FROM api_cost_events WHERE user_id = ${g.userId}`;
    expect(event?.gym_id).toBe(gymId);
    const month = new Date().toISOString().slice(0, 7).replace("-", "");
    expect(await redis.get(`costs:gym:${gymId}:${month}`)).toBe("1");
  });

  it("provider down: retriable failure with no fallback → clean 503, NOTHING stored, never a crash", { timeout: 30_000 }, async () => {
    const down: ChatProvider = { chat: () => Promise.reject(new ProviderError("groq: HTTP 503", true)) };
    const app2 = await buildApp(loadConfig(baseEnv), {
      redis: createMemoryRedis(),
      coach: { chatProvider: withFallback(down, null), embedder },
    });
    try {
      const login = await app2.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ email: "p25b-alice@example.com", password: PASSWORD }),
      });
      const access = login.cookies.find((c) => c.name === "accessToken")?.value ?? "";
      const before = await sql<{ n: string }[]>`
        SELECT count(*) AS n FROM coach_messages cm JOIN coach_threads t ON t.id = cm.thread_id
        WHERE t.user_id = ${userA}`;
      const res = await app2.inject({
        method: "POST",
        url: "/v1/coach/chat",
        headers: { "content-type": "application/json" },
        cookies: { accessToken: access },
        payload: JSON.stringify({ message: "a brand new failing question" }),
      });
      expect(res.statusCode).toBe(503);
      expect(res.json<{ error: string }>().error).toBe("coach_unavailable");
      const after = await sql<{ n: string }[]>`
        SELECT count(*) AS n FROM coach_messages cm JOIN coach_threads t ON t.id = cm.thread_id
        WHERE t.user_id = ${userA}`;
      expect(after[0]?.n).toBe(before[0]?.n);
    } finally {
      await app2.close();
    }
  });

  it("no GROQ_API_KEY and no override → coach 503s cleanly; the rest of the app runs", { timeout: 30_000 }, async () => {
    const envNoKey: Record<string, string> = { ...baseEnv };
    delete envNoKey["GROQ_API_KEY"];
    const app3 = await buildApp(loadConfig(envNoKey), { redis: createMemoryRedis(), coach: { embedder } });
    try {
      const login = await app3.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ email: "p25b-alice@example.com", password: PASSWORD }),
      });
      expect(login.statusCode).toBe(200); // app itself is healthy
      const access = login.cookies.find((c) => c.name === "accessToken")?.value ?? "";
      const res = await app3.inject({
        method: "POST",
        url: "/v1/coach/chat",
        headers: { "content-type": "application/json" },
        cookies: { accessToken: access },
        payload: JSON.stringify({ message: "hello" }),
      });
      expect(res.statusCode).toBe(503);
    } finally {
      await app3.close();
    }
  });

  it("thread CRUD: list/detail/delete; cross-tenant and malformed ids → 404 (R3.2)", { timeout: 30_000 }, async () => {
    const list = await inject({ method: "GET", url: "/v1/coach/threads?limit=50", access: cookieA });
    expect(list.statusCode).toBe(200);
    const items = list.json<{ items: { id: string }[] }>().items;
    expect(items.map((i) => i.id)).toContain(firstThreadId);

    const detail = await inject({ method: "GET", url: `/v1/coach/threads/${firstThreadId}`, access: cookieA });
    expect(detail.statusCode).toBe(200);
    const msgs = detail.json<{ messages: { role: string }[] }>().messages;
    expect(msgs[0]?.role).toBe("user");
    expect(msgs[1]?.role).toBe("assistant");

    // Cross-tenant: B can neither read nor delete A's thread.
    expect((await inject({ method: "GET", url: `/v1/coach/threads/${firstThreadId}`, access: cookieB })).statusCode).toBe(404);
    expect((await inject({ method: "DELETE", url: `/v1/coach/threads/${firstThreadId}`, access: cookieB })).statusCode).toBe(404);
    expect((await inject({ method: "GET", url: "/v1/coach/threads/not-a-uuid", access: cookieA })).statusCode).toBe(404);

    const del = await inject({ method: "DELETE", url: `/v1/coach/threads/${firstThreadId}`, access: cookieA });
    expect(del.statusCode).toBe(200);
    expect((await inject({ method: "GET", url: `/v1/coach/threads/${firstThreadId}`, access: cookieA })).statusCode).toBe(404);
  });

  it("validation: >2000 chars and unknown keys are 400", { timeout: 30_000 }, async () => {
    expect((await chat("x".repeat(2001))).statusCode).toBe(400);
    expect(
      (await inject({ method: "POST", url: "/v1/coach/chat", body: { message: "hi", evil: 1 }, access: cookieA }))
        .statusCode,
    ).toBe(400);
  });
});
