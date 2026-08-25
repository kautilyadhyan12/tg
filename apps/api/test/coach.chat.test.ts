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
// Imported, never re-typed: a hard-coded 11 would stay green against a changed
// constant, i.e. the test would pin the old number and not the behaviour (T3 R9).
import {
  COACH_CAP_MAX,
  COACH_CAP_WINDOW_S,
  coachIdempotencyKeys,
} from "../src/modules/coach/idempotency.js";

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
        model: "openai/gpt-oss-20b",
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
    expect(msgs[1]?.model).toBe("openai/gpt-oss-20b#p2"); // prompt versioning
    expect(msgs[1]?.tokens_in).toBe(100);
    expect(msgs[1]?.tokens_out).toBe(200);
    // gpt-oss-20b prices (2026-07-22): (100·75000+200·300000+500000)/1e6 = 68
    // (67.5 rounded half-up).
    expect(msgs[1]?.cost_micro).toBe("68");

    const events = await sql<{ provider: string; units: string; cost_micro: string; gym_id: string | null }[]>`
      SELECT provider, units, cost_micro, gym_id FROM api_cost_events WHERE user_id = ${userA}`;
    expect(events.length).toBe(1);
    expect(events[0]?.provider).toBe("groq");
    expect(Number(events[0]?.units)).toBe(300);
    expect(events[0]?.cost_micro).toBe("68"); // same gpt-oss-20b price as above
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
    expect(cachedMsg?.model).toBe("cached:openai/gpt-oss-20b");
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

  it("a 400 does NOT consume a quota slot (T3 finding 1: validate before meter)", { timeout: 60_000 }, async () => {
    const u = await session("p25b-badreq@example.com");
    // Five malformed requests (>2000 chars) — all 400, none should meter.
    for (let i = 0; i < 5; i++) {
      const bad = await chat("x".repeat(2001), u.access);
      expect(bad.statusCode).toBe(400);
    }
    // All 5 real monthly slots must still be available.
    for (let i = 1; i <= 5; i++) {
      const r = await chat(`badreq distinct question ${String(i)}`, u.access);
      expect(r.statusCode).toBe(200);
    }
    const sixth = await chat("badreq distinct question 6", u.access);
    expect(sixth.statusCode).toBe(429); // meter counted only the 5 valid ones
  });

  it("answer cache does NOT leak across different profiles (T3 finding 2)", { timeout: 60_000 }, async () => {
    // A sets a weight, then asks a nutrition question → answer cached under
    // A's profile fingerprint.
    const a = await session("p25b-weighted@example.com");
    await api().inject({
      method: "PATCH",
      url: "/v1/users/me",
      headers: { "content-type": "application/json" },
      cookies: { accessToken: a.access },
      payload: JSON.stringify({ weightKg: 95 }),
    });
    const callsBefore = provider.calls.length;
    const q = "how many grams of protein should I target each day";
    const aRes = await chat(q, a.access);
    expect(aRes.statusCode).toBe(200);
    expect(aRes.json<{ cached: boolean }>().cached).toBe(false);
    expect(provider.calls.length).toBe(callsBefore + 1);

    // B (no weight set → different fingerprint) asks the SAME question: must
    // NOT get A's cached answer — a real provider call fires.
    const b = await session("p25b-noweight@example.com");
    const bRes = await chat(q, b.access);
    expect(bRes.statusCode).toBe(200);
    expect(bRes.json<{ cached: boolean }>().cached).toBe(false);
    expect(provider.calls.length).toBe(callsBefore + 2); // B did NOT hit A's cache

    // A re-asks (same profile) → cache hit, no new provider call.
    const aAgain = await chat(q, a.access);
    expect(aAgain.json<{ cached: boolean }>().cached).toBe(true);
    expect(provider.calls.length).toBe(callsBefore + 2);
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
      SELECT 'gym', ${gymId}, id, 'active', 'pilot' FROM plans WHERE code = 'org_b1_in_m'`;

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

  // ── retry protection: Idempotency-Key + short-window cap ───────────────────
  // The owed follow-up from DECISIONS 2026-07-12 (P2.5b T3 minor) and Kd's
  // D1(b) ruling 2026-07-16. Three harms, each pinned below: a retry must not
  // (1) open a SECOND thread, (2) burn a SECOND quota slot, (3) duplicate the
  // messages. Placement is the card: the guard runs after validateChatBody and
  // BEFORE requireQuota, which increments the counter itself (quotas/service.ts).

  /** The auth limiter allows 20 register+login attempts per HOUR per IP
   *  (DECISIONS 2026-07-11 GAP-4), and every inject() shares 127.0.0.1 — so a
   *  block that mints a fixture user per test trips a PRODUCTION control, not
   *  a bug. Each fixture therefore registers from its own address, exactly as
   *  nine real users would; the limiter is left fully armed (its own proof
   *  lives in the auth suite) rather than cleared out of the way. */
  let fixtureIp = 0;
  const freshSession = async (email: string): Promise<{ userId: string; access: string }> => {
    fixtureIp += 1;
    const remoteAddress = `10.42.0.${String(fixtureIp)}`;
    const json = { "content-type": "application/json" };
    const reg = await api().inject({
      method: "POST",
      url: "/v1/auth/register",
      remoteAddress,
      headers: json,
      payload: JSON.stringify({ email, password: PASSWORD, displayName: "P25b Fixture" }),
    });
    if (reg.statusCode !== 201) throw new Error(`register failed: ${reg.body}`);
    const { userId } = reg.json<{ userId: string }>();
    const login = await api().inject({
      method: "POST",
      url: "/v1/auth/login",
      remoteAddress,
      headers: json,
      payload: JSON.stringify({ email, password: PASSWORD }),
    });
    const access = login.cookies.find((c) => c.name === "accessToken")?.value ?? "";
    if (access === "") throw new Error(`login failed: ${login.body}`);
    return { userId, access };
  };

  /** Direct inject so the shared `inject`/`chat` helpers stay untouched (R1.1). */
  const chatK = (message: string, access: string, key?: string, threadId?: string) =>
    api().inject({
      method: "POST",
      url: "/v1/coach/chat",
      headers: {
        "content-type": "application/json",
        ...(key === undefined ? {} : { "idempotency-key": key }),
      },
      cookies: { accessToken: access },
      payload: JSON.stringify(threadId === undefined ? { message } : { message, threadId }),
    });

  const threadCount = async (userId: string): Promise<number> => {
    const [row] = await sql<{ n: string }[]>`
      SELECT count(*) AS n FROM coach_threads WHERE user_id = ${userId}`;
    return Number(row?.n ?? "0");
  };
  const messageCount = async (userId: string): Promise<number> => {
    const [row] = await sql<{ n: string }[]>`
      SELECT count(*) AS n FROM coach_messages cm
      JOIN coach_threads t ON t.id = cm.thread_id WHERE t.user_id = ${userId}`;
    return Number(row?.n ?? "0");
  };

  it("REPLAY: the same key returns the first answer, and spends NO quota slot, NO second thread, NO duplicate messages, NO provider call", { timeout: 90_000 }, async () => {
    const u = await freshSession("p25b-idem-replay@example.com");
    const key = "replay-key-0001";
    const callsBefore = provider.calls.length;

    const first = await chatK("how should I warm up before squatting", u.access, key);
    expect(first.statusCode).toBe(200);
    const firstBody = first.json<{ threadId: string; reply: string; cached: boolean }>();
    expect(provider.calls.length).toBe(callsBefore + 1);

    // Two replays: byte-identical body, flagged as a replay, provider untouched.
    for (let i = 0; i < 2; i++) {
      const again = await chatK("how should I warm up before squatting", u.access, key);
      expect(again.statusCode).toBe(200);
      expect(again.json<{ threadId: string; reply: string; cached: boolean }>()).toEqual(firstBody);
      expect(again.headers["idempotent-replay"]).toBe("true");
      expect(provider.calls.length).toBe(callsBefore + 1); // harm 3: no second call
    }
    expect(await threadCount(u.userId)).toBe(1); // harm 1: no second thread
    expect(await messageCount(u.userId)).toBe(2); // harm 3: one user + one assistant

    // harm 2 — the house proof (mirrors "a 400 does NOT consume a quota slot"):
    // if the replays had metered, fewer than four slots would remain.
    for (let i = 2; i <= 5; i++) {
      expect((await chatK(`replay distinct question ${String(i)}`, u.access)).statusCode).toBe(200);
    }
    const sixth = await chatK("replay distinct question 6", u.access);
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json<{ error: string }>().error).toBe("quota_exceeded");
  });

  it("a DIFFERENT key is a genuinely new request", { timeout: 60_000 }, async () => {
    const u = await freshSession("p25b-idem-distinct@example.com");
    const callsBefore = provider.calls.length;
    const a = await chatK("is a leg day every week enough", u.access, "distinct-key-a");
    const b = await chatK("what about deload weeks in a program", u.access, "distinct-key-b");
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(b.headers["idempotent-replay"]).toBeUndefined();
    expect(provider.calls.length).toBe(callsBefore + 2);
    expect(await threadCount(u.userId)).toBe(2);
  });

  it("NO header → behaviour is exactly as before (today's client must not break)", { timeout: 60_000 }, async () => {
    const u = await freshSession("p25b-idem-nokey@example.com");
    const first = await chatK("should I stretch after a workout", u.access);
    const second = await chatK("should I stretch after a workout", u.access);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.headers["idempotent-replay"]).toBeUndefined();
    expect(second.headers["idempotent-replay"]).toBeUndefined();
    expect(await threadCount(u.userId)).toBe(2); // unchanged: two sends, two threads
  });

  it("CROSS-USER (R3.2): B replaying A's key gets NOTHING of A's", { timeout: 60_000 }, async () => {
    const a = await freshSession("p25b-idem-tenant-a@example.com");
    const b = await freshSession("p25b-idem-tenant-b@example.com");
    const shared = "a-key-both-users-send";

    const aRes = await chatK("A's own private question about knees", a.access, shared);
    expect(aRes.statusCode).toBe(200);
    const aBody = aRes.json<{ threadId: string; reply: string }>();

    const bRes = await chatK("B's own private question about shoulders", b.access, shared);
    expect(bRes.statusCode).toBe(200);
    const bBody = bRes.json<{ threadId: string; reply: string }>();
    expect(bRes.headers["idempotent-replay"]).toBeUndefined(); // not treated as a replay
    expect(bBody.threadId).not.toBe(aBody.threadId);
    expect(await threadCount(a.userId)).toBe(1);
    expect(await threadCount(b.userId)).toBe(1);
    // B's thread must contain B's question, never A's.
    const [row] = await sql<{ content: string }[]>`
      SELECT cm.content FROM coach_messages cm
      JOIN coach_threads t ON t.id = cm.thread_id
      WHERE t.user_id = ${b.userId} AND cm.role = 'user'`;
    expect(row?.content).toBe("B's own private question about shoulders");
  });

  it("a malformed or oversized key is rejected loudly and costs nothing", { timeout: 60_000 }, async () => {
    const u = await freshSession("p25b-idem-badkey@example.com");
    for (const bad of ["", "x".repeat(201)]) {
      const res = await chatK("a perfectly fine question", u.access, bad);
      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: string }>().error).toBe("invalid_idempotency_key");
    }
    expect(await threadCount(u.userId)).toBe(0); // nothing was opened
    // …and none of the five monthly slots was metered by those 400s.
    for (let i = 1; i <= 5; i++) {
      expect((await chatK(`badkey distinct question ${String(i)}`, u.access)).statusCode).toBe(200);
    }
    expect((await chatK("badkey distinct question 6", u.access)).statusCode).toBe(429);
  });

  it("CONCURRENT duplicates: whichever way the race lands, ONE thread, ONE exchange, ONE provider call", { timeout: 60_000 }, async () => {
    const u = await freshSession("p25b-idem-concurrent@example.com");
    const callsBefore = provider.calls.length;
    const key = "concurrent-key-0001";
    const msg = "can I train the same muscle two days in a row";
    const [r1, r2] = await Promise.all([chatK(msg, u.access, key), chatK(msg, u.access, key)]);

    // The loser is EITHER turned away as in-flight OR fast enough to be served
    // the stored reply — asserting only one of those would be flaky, so the
    // invariants below are what the guard actually promises.
    const codes = [r1.statusCode, r2.statusCode].sort((x, y) => x - y);
    expect(codes[0]).toBe(200);
    expect([200, 409]).toContain(codes[1]);
    if (codes[1] === 409) {
      const conflict = [r1, r2].find((r) => r.statusCode === 409);
      expect(conflict?.json<{ error: string }>().error).toBe("request_in_flight");
    }
    expect(provider.calls.length).toBe(callsBefore + 1);
    expect(await threadCount(u.userId)).toBe(1);
    expect(await messageCount(u.userId)).toBe(2);
  });

  it("a FAILED attempt does not strand the key, and the retry REUSES the conversation it opened", { timeout: 60_000 }, async () => {
    // The design correction this card turns on: releasing the key on failure
    // would let the retry open a SECOND thread — the exact harm the card
    // exists to close, since the thread is created (service.ts) BEFORE the
    // provider is called and is committed on its own.
    const u = await freshSession("p25b-idem-recover@example.com");
    let calls = 0;
    const flaky: ChatProvider = {
      chat: () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new ProviderError("groq: HTTP 503", true))
          : Promise.resolve({
              content: "recovered answer",
              model: "openai/gpt-oss-20b",
              provider: "groq" as const,
              tokensIn: 10,
              tokensOut: 20,
            });
      },
    };
    const app2 = await buildApp(loadConfig(baseEnv), {
      redis: createMemoryRedis(), // one redis shared by both attempts below
      coach: { chatProvider: withFallback(flaky, null), embedder },
    });
    try {
      const send = (key: string) =>
        app2.inject({
          method: "POST",
          url: "/v1/coach/chat",
          headers: { "content-type": "application/json", "idempotency-key": key },
          cookies: { accessToken: u.access },
          payload: JSON.stringify({ message: "why do my knees ache after squats" }),
        });
      const failed = await send("recover-key-0001");
      expect(failed.statusCode).toBe(503);
      expect(await threadCount(u.userId)).toBe(1); // the orphan the retry must reuse

      const retry = await send("recover-key-0001");
      expect(retry.statusCode).toBe(200); // not stranded on 409
      expect(retry.json<{ reply: string }>().reply).toBe("recovered answer");
      expect(await threadCount(u.userId)).toBe(1); // harm 1: still ONE thread
      expect(await messageCount(u.userId)).toBe(2);
    } finally {
      await app2.close();
    }
  });

  it("Redis down → dedupe is skipped but the question still goes through (fail-open, coach doctrine)", { timeout: 60_000 }, async () => {
    const u = await freshSession("p25b-idem-redisdown@example.com");
    const dead = createMemoryRedis();
    dead.down = true;
    const app4 = await buildApp(loadConfig(baseEnv), {
      redis: dead,
      coach: { chatProvider: provider, embedder },
    });
    try {
      const send = () =>
        app4.inject({
          method: "POST",
          url: "/v1/coach/chat",
          headers: { "content-type": "application/json", "idempotency-key": "redis-down-key" },
          cookies: { accessToken: u.access },
          payload: JSON.stringify({ message: "a question asked while redis is down" }),
        });
      expect((await send()).statusCode).toBe(200);
      expect((await send()).statusCode).toBe(200); // no dedupe possible, never a 500
    } finally {
      await app4.close();
    }
  });

  it("short-window cap: the 11th message in a window is refused as too fast, and the window then RESETS", { timeout: 90_000 }, async () => {
    // Driven on an INJECTED clock (createMemoryRedis already takes one), not
    // wall time: 11 round trips to real Postgres inside a real 60 s window is a
    // race the suite would eventually lose, and it would lose it as
    // "quota_exceeded on the 11th" — a failure that looks like a code fault
    // and is not one. Frozen time also lets the reset be asserted rather than
    // waited for. (T3 R9.)
    const u = await freshSession("p25b-idem-cap@example.com");
    let clockMs = Date.now();
    const capRedis = createMemoryRedis(() => clockMs);
    const app5 = await buildApp(loadConfig(baseEnv), {
      redis: capRedis,
      coach: { chatProvider: provider, embedder },
    });
    try {
      const send = (message: string) =>
        app5.inject({
          method: "POST",
          url: "/v1/coach/chat",
          headers: { "content-type": "application/json" },
          cookies: { accessToken: u.access },
          payload: JSON.stringify({ message }),
        });
      // The free plan's 5 monthly questions answer; everything up to the cap
      // then reports the QUOTA (the cap lets them through, so the user hears
      // the true reason); the request AFTER the cap trips the cap itself.
      for (let i = 1; i <= 5; i++) {
        expect((await send(`cap distinct question ${String(i)}`)).statusCode).toBe(200);
      }
      for (let i = 6; i <= COACH_CAP_MAX; i++) {
        const res = await send(`cap distinct question ${String(i)}`);
        expect(res.statusCode).toBe(429);
        expect(res.json<{ error: string }>().error).toBe("quota_exceeded");
      }
      const overCap = await send(`cap distinct question ${String(COACH_CAP_MAX + 1)}`);
      expect(overCap.statusCode).toBe(429);
      expect(overCap.json<{ error: string }>().error).toBe("rate_limited");

      // One window later the burst allowance is gone and the honest reason
      // returns — asserted, not waited for, because the clock is ours.
      clockMs += COACH_CAP_WINDOW_S * 1000 + 1000;
      const afterWindow = await send("cap distinct question after the window");
      expect(afterWindow.statusCode).toBe(429);
      expect(afterWindow.json<{ error: string }>().error).toBe("quota_exceeded");
    } finally {
      await app5.close();
    }
  });

  it("the SAME key with a DIFFERENT message is rejected loudly, never answered from the first", { timeout: 60_000 }, async () => {
    // T3 R3.5: the record was keyed on user+key only, so a client reusing one
    // key for another question was silently handed the FIRST question's answer.
    // The workouts sync path already rejects this class by name; same contract.
    const u = await freshSession("p25b-idem-mismatch@example.com");
    const key = "one-key-two-questions";
    const first = await chatK("how many rest days should I take", u.access, key);
    expect(first.statusCode).toBe(200);
    const firstReply = first.json<{ reply: string }>().reply;

    const reused = await chatK("a completely different question about grip", u.access, key);
    expect(reused.statusCode).toBe(400);
    expect(reused.json<{ error: string }>().error).toBe("idempotency_key_mismatch");
    expect(reused.body).not.toContain(firstReply); // never the wrong answer

    // The original key still replays its OWN message correctly.
    const honest = await chatK("how many rest days should I take", u.access, key);
    expect(honest.statusCode).toBe(200);
    expect(honest.headers["idempotent-replay"]).toBe("true");
  });

  it("the key/message binding holds on the FAILURE path too, not just after a success", { timeout: 60_000 }, async () => {
    // T3 round 3 F1, and the third instance of this card's recurring fault:
    // round 2 bound the message to the stored ANSWER but not to the remembered
    // THREAD, so one key used for two questions was rejected loudly after a
    // success and accepted SILENTLY after a failure — question 2's exchange
    // landing in the thread titled with question 1. Two paths honour the key;
    // the guarantee has to hold on both or it holds on neither.
    const u = await freshSession("p25b-idem-failbind@example.com");
    let calls = 0;
    const flaky: ChatProvider = {
      chat: () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new ProviderError("groq: HTTP 503", true))
          : Promise.resolve({
              content: "second question answered",
              model: "openai/gpt-oss-20b",
              provider: "groq" as const,
              tokensIn: 10,
              tokensOut: 20,
            });
      },
    };
    const app7 = await buildApp(loadConfig(baseEnv), {
      redis: createMemoryRedis(),
      coach: { chatProvider: withFallback(flaky, null), embedder },
    });
    try {
      const send = (message: string) =>
        app7.inject({
          method: "POST",
          url: "/v1/coach/chat",
          headers: { "content-type": "application/json", "idempotency-key": "one-key-two-questions-fail" },
          cookies: { accessToken: u.access },
          payload: JSON.stringify({ message }),
        });

      // Attempt 1 fails, leaving a thread titled with question ONE.
      expect((await send("MESSAGE ONE about squats")).statusCode).toBe(503);
      const [thread] = await sql<{ title: string }[]>`
        SELECT title FROM coach_threads WHERE user_id = ${u.userId}`;
      expect(thread?.title).toBe("MESSAGE ONE about squats");

      // Same key, DIFFERENT question: must be refused, NOT folded into that
      // thread. (Before the fix this returned 200 and appended here.)
      const different = await send("MESSAGE TWO about deadlifts");
      expect(different.statusCode).toBe(400);
      expect(different.json<{ error: string }>().error).toBe("idempotency_key_mismatch");
      expect(await messageCount(u.userId)).toBe(0); // nothing written anywhere
      expect(await threadCount(u.userId)).toBe(1); // and no second thread

      // The ORIGINAL question still resumes its own thread and succeeds.
      const retry = await send("MESSAGE ONE about squats");
      expect(retry.statusCode).toBe(200);
      expect(await threadCount(u.userId)).toBe(1);
      const [still] = await sql<{ title: string }[]>`
        SELECT title FROM coach_threads WHERE user_id = ${u.userId}`;
      expect(still?.title).toBe("MESSAGE ONE about squats");
    } finally {
      await app7.close();
    }
  });

  it("the SAME text in a DIFFERENT thread is a DIFFERENT request — not a replay", { timeout: 60_000 }, async () => {
    // T3 round 4 F1, the fourth instance of this card's recurring fault. The
    // fingerprint covered the MESSAGE only, so a key reused with the same text
    // in another thread replayed the first thread's answer: 200,
    // Idempotent-Replay: true, and the client's write into the second thread
    // silently never happened. "ok thanks" / "why?" / "more" is exactly the
    // repeated short text a chat UI produces across threads.
    const u = await freshSession("p25b-idem-threadbind@example.com");
    const t1 = await chatK("start of thread one", u.access);
    const t2 = await chatK("start of thread two", u.access);
    const threadOne = t1.json<{ threadId: string }>().threadId;
    const threadTwo = t2.json<{ threadId: string }>().threadId;
    expect(threadOne).not.toBe(threadTwo);

    const key = "same-text-two-threads";
    const first = await chatK("ok thanks", u.access, key, threadOne);
    expect(first.statusCode).toBe(200);
    expect(first.json<{ threadId: string }>().threadId).toBe(threadOne);

    // Same key, same text, DIFFERENT thread: a different request. Must be
    // refused — never answered from thread one, and never silently dropped.
    const second = await chatK("ok thanks", u.access, key, threadTwo);
    expect(second.statusCode).toBe(400);
    expect(second.json<{ error: string }>().error).toBe("idempotency_key_mismatch");
    expect(second.headers["idempotent-replay"]).toBeUndefined();

    // Thread two must be untouched by the refused request…
    const [two] = await sql<{ n: string }[]>`
      SELECT count(*) AS n FROM coach_messages WHERE thread_id = ${threadTwo}`;
    expect(Number(two?.n)).toBe(2); // its own opening exchange only
    // …and the original request still replays correctly under its own key.
    const replay = await chatK("ok thanks", u.access, key, threadOne);
    expect(replay.statusCode).toBe(200);
    expect(replay.headers["idempotent-replay"]).toBe("true");
    expect(replay.json<{ threadId: string }>().threadId).toBe(threadOne);
  });

  it("an unrecoverable stored reply says so — it does NOT claim a send is in flight", { timeout: 60_000 }, async () => {
    // T3 round 3 F4: the old message was "That message is already being sent",
    // asserted one line after the record had been DELETED, so nothing was in
    // flight. An error must not describe a situation that is not happening.
    const u = await freshSession("p25b-idem-unreadable@example.com");
    const corruptRedis = createMemoryRedis();
    const app8 = await buildApp(loadConfig(baseEnv), {
      redis: corruptRedis,
      coach: { chatProvider: provider, embedder },
    });
    try {
      const send = () =>
        app8.inject({
          method: "POST",
          url: "/v1/coach/chat",
          headers: { "content-type": "application/json", "idempotency-key": "unreadable-record-key" },
          cookies: { accessToken: u.access },
          payload: JSON.stringify({ message: "a question whose stored reply goes bad" }),
        });
      expect((await send()).statusCode).toBe(200);

      // Corrupt the stored reply the way a format change or a truncated write
      // would (this also covers a legacy PRE-ENVELOPE record). The key comes
      // from the module's own builder, never a copy of the recipe.
      const { recordKey } = coachIdempotencyKeys(u.userId, "unreadable-record-key");
      expect(await corruptRedis.get(recordKey)).not.toBeNull(); // it really is the right key
      await corruptRedis.setex(recordKey, 600, "{not valid json");

      const refused = await send();
      expect(refused.statusCode).toBe(409);
      expect(refused.json<{ error: string }>().error).toBe("retry_not_replayable");
      expect(refused.json<{ message: string }>().message).not.toContain("already being sent");

      // …and the bad record was dropped, so the very next attempt re-runs.
      expect((await send()).statusCode).toBe(200);
    } finally {
      await app8.close();
    }
  });

  it("a DUPLICATED header dedupes stably — Node JOINS the values, it does not array them", { timeout: 60_000 }, async () => {
    // The joined-header behaviour was asserted in a code comment and tested
    // nowhere (T3 R9.2). Writing the test also CORRECTED the review's premise:
    // it asked for an array-value case too, but a duplicate header never
    // becomes an array — `idempotency-key` is not special-cased by Node, and
    // light-my-request joins an explicit array the same way (probed: an
    // injected ["a","b"] arrives as the string "a,b"). So the array arm is
    // type narrowing, not a reachable path, and is documented as such instead
    // of being "tested" against a case that cannot occur.
    const u = await freshSession("p25b-idem-dupheader@example.com");
    const joined = "dup-key-a, dup-key-a"; // what two identical headers become
    const first = await chatK("does the joined header dedupe", u.access, joined);
    expect(first.statusCode).toBe(200);
    const again = await chatK("does the joined header dedupe", u.access, joined);
    expect(again.statusCode).toBe(200);
    expect(again.headers["idempotent-replay"]).toBe("true");
    expect(await threadCount(u.userId)).toBe(1);

    // An explicitly array-valued header takes the SAME joined path: one
    // ordinary key, honoured, never a 500 or an odd stringification.
    const arrayHeader = await api().inject({
      method: "POST",
      url: "/v1/coach/chat",
      headers: { "content-type": "application/json", "idempotency-key": ["arr-a", "arr-b"] },
      cookies: { accessToken: u.access },
      payload: JSON.stringify({ message: "an array-valued key" }),
    });
    expect(arrayHeader.statusCode).toBe(200);
  });

  it("a quota 429 RELEASES the key: the retry hears the real reason, never 'already being sent'", { timeout: 90_000 }, async () => {
    // The onSend hook exists for exactly this path and nothing pinned it (T3
    // R9.2). requireQuota rejects from a preHandler, so the handler never runs;
    // if the claim were not released there, a user who is simply out of
    // questions would be told their message is in flight for the next 120 s —
    // the wrong reason, on the one screen where the right reason matters.
    const u = await freshSession("p25b-idem-quota-release@example.com");
    for (let i = 1; i <= 5; i++) {
      expect((await chatK(`release distinct question ${String(i)}`, u.access)).statusCode).toBe(200);
    }
    const key = "quota-release-key";
    const first = await chatK("one question too many", u.access, key);
    expect(first.statusCode).toBe(429);
    expect(first.json<{ error: string }>().error).toBe("quota_exceeded");

    const retry = await chatK("one question too many", u.access, key);
    expect(retry.statusCode).toBe(429);
    expect(retry.json<{ error: string }>().error).toBe("quota_exceeded"); // NOT request_in_flight
  });

  it("if the user DELETES the thread a failed attempt opened, the retry starts a fresh one instead of 404ing", { timeout: 60_000 }, async () => {
    // T3 R9.2, the worst finding: the remembered thread id was cleared only on
    // success, and repo.deleteThread is a hard DELETE — so tidying away the
    // empty conversation a failure left behind made every retry under that key
    // inject a dead id and 404 for the full replay window, on a request that
    // never mentioned a thread. The "Try again" control this card is built for
    // resends the SAME key, so that is precisely the path that dead-ended.
    const u = await freshSession("p25b-idem-deleted-thread@example.com");
    let calls = 0;
    const flaky: ChatProvider = {
      chat: () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new ProviderError("groq: HTTP 503", true))
          : Promise.resolve({
              content: "answer after the tidy-up",
              model: "openai/gpt-oss-20b",
              provider: "groq" as const,
              tokensIn: 10,
              tokensOut: 20,
            });
      },
    };
    const sharedRedis = createMemoryRedis();
    const app6 = await buildApp(loadConfig(baseEnv), {
      redis: sharedRedis,
      coach: { chatProvider: withFallback(flaky, null), embedder },
    });
    try {
      const send = () =>
        app6.inject({
          method: "POST",
          url: "/v1/coach/chat",
          headers: { "content-type": "application/json", "idempotency-key": "deleted-thread-key" },
          cookies: { accessToken: u.access },
          payload: JSON.stringify({ message: "a question whose first attempt fails" }),
        });

      expect((await send()).statusCode).toBe(503);
      const [orphan] = await sql<{ id: string }[]>`
        SELECT id FROM coach_threads WHERE user_id = ${u.userId}`;
      expect(orphan?.id).toBeDefined();

      // The user tidies away the empty conversation.
      const del = await app6.inject({
        method: "DELETE",
        url: `/v1/coach/threads/${orphan?.id ?? ""}`,
        cookies: { accessToken: u.access },
      });
      expect(del.statusCode).toBe(200);
      expect(await threadCount(u.userId)).toBe(0);

      // Try again: must answer in a NEW thread, not 404 on the deleted one.
      const retry = await send();
      expect(retry.statusCode).toBe(200);
      expect(retry.json<{ reply: string }>().reply).toBe("answer after the tidy-up");
      expect(await threadCount(u.userId)).toBe(1);
    } finally {
      await app6.close();
    }
  });
});
