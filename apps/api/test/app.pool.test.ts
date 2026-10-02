// The API's connections to Postgres (ROADMAP Stage 4 item 11). With one connection, a
// request waiting inside the database held every other request, `GET /health` included.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { EmailSender } from "../src/modules/auth/email.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "postgres://nobody:nothing@127.0.0.1:1/void",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "pool-test-secret-0123456789abcdef-32", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

const quietSender: EmailSender = {
  sendVerificationEmail: () => Promise.resolve(),
  sendPasswordResetEmail: () => Promise.resolve(),
  sendSignInCodeEmail: () => Promise.resolve(),
};

describe("DATABASE_POOL_MAX", () => {
  it("is 10 unless set, and refuses 0 and anything over 50", () => {
    expect(loadConfig(baseEnv).DATABASE_POOL_MAX).toBe(10);
    expect(loadConfig({ ...baseEnv, DATABASE_POOL_MAX: "4" }).DATABASE_POOL_MAX).toBe(4);
    expect(() => loadConfig({ ...baseEnv, DATABASE_POOL_MAX: "0" })).toThrow();
    expect(() => loadConfig({ ...baseEnv, DATABASE_POOL_MAX: "51" })).toThrow();
  });
});

d("one request waiting in the database (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 2 });
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  beforeAll(async () => {
    app = await buildApp(loadConfig(baseEnv), { emailSender: quietSender });
  });
  afterAll(async () => {
    if (app !== undefined) await app.close();
    await sql.end({ timeout: 5 });
  });

  it("does not stop anybody else: /health answers while a sign-in code waits on its address's lock", async () => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    const api = app;
    const email = `pool-${String(Date.now())}@example.com`;
    let release = (): void => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked = (): void => undefined;
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    // Another process holds the address's lock, as a second request for it would.
    const holder = sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`${email}|sign_in`}))`;
      locked();
      await released;
    });
    try {
      await isLocked;
      const waiting = api.inject({
        method: "POST",
        url: "/v1/auth/code/send",
        remoteAddress: "10.77.0.1",
        body: { email },
      });
      // The send is inside its transaction, waiting on the lock.
      for (let i = 0; i < 100; i++) {
        const [row] = await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND query LIKE '%pg_advisory_xact_lock%' AND pid <> pg_backend_pid()`;
        if ((row?.n ?? 0) > 0) break;
        await new Promise((resolve) => {
          setTimeout(resolve, 20);
        });
      }
      const started = performance.now();
      const health = await Promise.race([
        api.inject({ method: "GET", url: "/health" }),
        new Promise<"stuck">((resolve) => {
          setTimeout(() => {
            resolve("stuck");
          }, 3_000);
        }),
      ]);
      expect(health === "stuck" ? "stuck" : health.statusCode).toBe(200);
      expect(performance.now() - started).toBeLessThan(3_000);
      release();
      expect((await waiting).statusCode).toBe(200);
    } finally {
      release();
      await holder;
    }
  }, 30_000);
});
