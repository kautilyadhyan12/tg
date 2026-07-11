// P2.2 — catalog + definition-bundle routes against REAL Postgres (R9.2).
// DATABASE_URL-gated; requires migrations 0001–0004. Runs the definitions
// seed TWICE (idempotency proof: no duplicate bundle rows), then covers:
// live-only catalog, cursor pagination, strict query validation, bundle
// serving with sha256 ETag + If-None-Match/since 304s, and the §9.3
// beta_definitions allowlist gate (GAP-3: default-to-live on malformed rules).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { seed } from "../src/db/seed.js";
import { bundleSha256 } from "../src/modules/exercises/bundle.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "exercises-test-secret-0123456789abcd-32", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;

let ipCounter = 0;
const nextIp = () =>
  `10.3.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

interface BundleBody {
  bundleVersion: number;
  channel: string;
  sha256: string;
  manifest: Record<string, number>;
  definitions: { key: string; version: number }[];
}

d("exercises routes (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  let liveBundleCountAfterSeeds = 0;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const get = (path: string, opts: { cookies?: Record<string, string>; headers?: Record<string, string> } = {}) =>
    api().inject({
      method: "GET",
      url: path,
      remoteAddress: nextIp(),
      headers: opts.headers ?? {},
      cookies: opts.cookies ?? {},
    });

  const makeUser = async (email: string) => {
    const reg = await api().inject({
      method: "POST",
      url: "/v1/auth/register",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email, password: PASSWORD, displayName: "P22 Ex Fixture" }),
    });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await api().inject({
      method: "POST",
      url: "/v1/auth/login",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };

  beforeAll(async () => {
    await sql`DELETE FROM users WHERE email LIKE 'p22e-%@example.com'`;
    await sql`DELETE FROM exercises WHERE slug IN ('zz_p22_hidden')`;
    await sql`DELETE FROM definition_bundles WHERE channel = 'beta'`;
    await sql`UPDATE feature_flags SET rules = '{}'::jsonb WHERE key = 'beta_definitions'`;

    // Seed twice — the definitions/bundle seed must be idempotent (A2).
    await seed(url ?? "");
    const afterFirst = (await sql<{ n: string }[]>`
      SELECT count(*) AS n FROM definition_bundles WHERE channel = 'live'`)[0]?.n;
    await seed(url ?? "");
    const afterSecond = (await sql<{ n: string }[]>`
      SELECT count(*) AS n FROM definition_bundles WHERE channel = 'live'`)[0]?.n;
    expect(afterSecond).toBe(afterFirst);
    liveBundleCountAfterSeeds = Number(afterSecond);

    // A non-live catalog row that must never be served.
    await sql`
      INSERT INTO exercises (slug, name_key, family, tier, status, met)
      VALUES ('zz_p22_hidden', 'exercise.zz_p22_hidden', 'F1', 'T1', 'hidden', 1.0)`;

    app = await buildApp(loadConfig(baseEnv));
  }, 120_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await sql`DELETE FROM exercises WHERE slug IN ('zz_p22_hidden')`;
    await sql`DELETE FROM definition_bundles WHERE channel = 'beta'`;
    await sql`UPDATE feature_flags SET rules = '{}'::jsonb WHERE key = 'beta_definitions'`;
    await sql.end({ timeout: 5 });
  });

  it("both endpoints require authentication", { timeout: 30_000 }, async () => {
    expect((await get("/v1/exercises")).statusCode).toBe(401);
    expect((await get("/v1/exercise-definitions")).statusCode).toBe(401);
  });

  it("catalog lists ONLY live exercises", { timeout: 30_000 }, async () => {
    const { cookies } = await makeUser("p22e-catalog@example.com");
    const res = await get("/v1/exercises", { cookies });
    expect(res.statusCode).toBe(200);
    const page = JSON.parse(res.body) as { items: { slug: string }[]; nextCursor: string | null };
    const slugs = page.items.map((i) => i.slug);
    expect(slugs).toEqual(expect.arrayContaining(["squat", "jump_squat", "chair_squat"]));
    expect(slugs).not.toContain("zz_p22_hidden");
  });

  it("cursor pagination walks the catalog without dupes or gaps (R7.3)", { timeout: 30_000 }, async () => {
    const { cookies } = await makeUser("p22e-paging@example.com");
    const all = JSON.parse((await get("/v1/exercises?limit=100", { cookies })).body) as {
      items: { slug: string }[];
    };
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let hop = 0; hop < 100; hop++) {
      const q: string = cursor === null ? "/v1/exercises?limit=2" : `/v1/exercises?limit=2&cursor=${encodeURIComponent(cursor)}`;
      const res = await get(q, { cookies });
      expect(res.statusCode).toBe(200);
      const page = JSON.parse(res.body) as { items: { slug: string }[]; nextCursor: string | null };
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((i) => i.slug));
      cursor = page.nextCursor;
      if (cursor === null) break;
    }
    expect(seen).toEqual(all.items.map((i) => i.slug)); // same order, no dupes/gaps
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("catalog query is strict: unknown params and out-of-range limit are 400", { timeout: 30_000 }, async () => {
    const { cookies } = await makeUser("p22e-badquery@example.com");
    expect((await get("/v1/exercises?limit=999", { cookies })).statusCode).toBe(400);
    expect((await get("/v1/exercises?nope=1", { cookies })).statusCode).toBe(400);
    expect((await get("/v1/exercise-definitions?since=0", { cookies })).statusCode).toBe(400);
  });

  it("serves the live bundle: manifest matches documents, stored sha256 is the ETag and recomputes", { timeout: 30_000 }, async () => {
    const { cookies } = await makeUser("p22e-bundle@example.com");
    const res = await get("/v1/exercise-definitions", { cookies });
    expect(res.statusCode).toBe(200);
    const bundle = JSON.parse(res.body) as BundleBody;
    expect(bundle.channel).toBe("live");
    expect(Object.keys(bundle.manifest).sort()).toEqual(["chair_squat", "jump_squat", "squat"]);
    for (const def of bundle.definitions) {
      expect(bundle.manifest[def.key]).toBe(def.version);
    }
    expect(res.headers["etag"]).toBe(`"${bundle.sha256}"`);
    // GAP-1: the hash is honest — recomputable from the served content.
    expect(
      bundleSha256({ channel: bundle.channel, manifest: bundle.manifest, definitions: bundle.definitions }),
    ).toBe(bundle.sha256);
  });

  it("304s on If-None-Match and on since>=current; 200 on stale since", { timeout: 30_000 }, async () => {
    const { cookies } = await makeUser("p22e-etag@example.com");
    const first = await get("/v1/exercise-definitions", { cookies });
    const bundle = JSON.parse(first.body) as BundleBody;

    const inm = await get("/v1/exercise-definitions", {
      cookies,
      headers: { "if-none-match": `"${bundle.sha256}"` },
    });
    expect(inm.statusCode).toBe(304);
    expect(inm.body).toBe("");

    const since = await get(`/v1/exercise-definitions?since=${String(bundle.bundleVersion)}`, { cookies });
    expect(since.statusCode).toBe(304);

    if (bundle.bundleVersion > 1) {
      const stale = await get(`/v1/exercise-definitions?since=${String(bundle.bundleVersion - 1)}`, { cookies });
      expect(stale.statusCode).toBe(200);
    }
  });

  it("beta allowlist routes flagged users to the beta bundle; others and malformed rules stay live (§9.3, GAP-3)", { timeout: 60_000 }, async () => {
    const flagged = await makeUser("p22e-beta@example.com");
    const unflagged = await makeUser("p22e-nobeta@example.com");

    // A beta bundle pointing at the same squat doc (content differs by channel → new sha).
    const liveRes = await get("/v1/exercise-definitions", { cookies: unflagged.cookies });
    const live = JSON.parse(liveRes.body) as BundleBody;
    const squatDoc = live.definitions.find((d) => d.key === "squat");
    if (squatDoc === undefined) throw new Error("live bundle lost its squat");
    const manifest = { squat: squatDoc.version };
    const sha = bundleSha256({ channel: "beta", manifest, definitions: [squatDoc] });
    await sql`
      INSERT INTO definition_bundles (channel, sha256, manifest)
      VALUES ('beta', ${sha}, ${sql.json(manifest)})`;
    await sql`
      UPDATE feature_flags SET rules = ${sql.json({ userIds: [flagged.userId] })}
      WHERE key = 'beta_definitions'`;

    const betaRes = await get("/v1/exercise-definitions", { cookies: flagged.cookies });
    expect(betaRes.statusCode).toBe(200);
    const beta = JSON.parse(betaRes.body) as BundleBody;
    expect(beta.channel).toBe("beta");
    expect(beta.sha256).toBe(sha);
    expect(beta.definitions.map((d) => d.key)).toEqual(["squat"]);

    const stillLive = await get("/v1/exercise-definitions", { cookies: unflagged.cookies });
    expect((JSON.parse(stillLive.body) as BundleBody).channel).toBe("live");

    // Malformed rules must fail CLOSED to live (never 500, never widen).
    await sql`
      UPDATE feature_flags SET rules = ${sql.json({ userIds: "not-an-array" })}
      WHERE key = 'beta_definitions'`;
    const fallback = await get("/v1/exercise-definitions", { cookies: flagged.cookies });
    expect(fallback.statusCode).toBe(200);
    expect((JSON.parse(fallback.body) as BundleBody).channel).toBe("live");
  });

  it("seed idempotency held: exactly the expected live bundle rows exist", { timeout: 30_000 }, async () => {
    const n = (await sql<{ n: string }[]>`
      SELECT count(*) AS n FROM definition_bundles WHERE channel = 'live'`)[0]?.n;
    expect(Number(n)).toBe(liveBundleCountAfterSeeds);
  });
});
