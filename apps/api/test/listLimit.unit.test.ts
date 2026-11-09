// The most list items one request may carry (`src/listLimit.ts`). No database: every request here
// is signed out, so a request the check lets through is answered 401 by the route's sign-in, and
// one it refuses is answered 413 before the route reads anything.
// The first block is the job's worst thing: a member's longest run refused and lost.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RUN_MAX_PAUSES, RUN_MAX_POINTS } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { countListItems, LIST_ITEMS_MOST } from "../src/listLimit.js";

type App = Awaited<ReturnType<typeof buildApp>>;

/** Twelve hours of one point a second and the most pauses the phone keeps, as the phone sends them. */
function longestRun(extraPoints = 0): unknown {
  const points: (number | null)[][] = [];
  for (let i = 0; i < RUN_MAX_POINTS + extraPoints; i++) points.push([i * 1000, 26.1445 + i / 110_760, 91.7362, i % 2 === 0 ? 5 : null]);
  const pauses: number[][] = [];
  for (let i = 0; i < RUN_MAX_PAUSES; i++) pauses.push([i * 20_000 + 1000, i * 20_000 + 2000]);
  return {
    runId: "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e",
    startedAt: "2026-11-08T05:00:00.000Z",
    elapsedMs: RUN_MAX_POINTS * 1000,
    name: "Long Run",
    effort: 8,
    note: null,
    points,
    pauses,
  };
}

describe("the most list items one request may carry", () => {
  let app: App | undefined;
  let ip = 0;
  const post = (url: string, payload: unknown) => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app.inject({
      method: "POST",
      url,
      remoteAddress: `10.77.0.${String((ip++ % 250) + 1)}`,
      headers: { "content-type": "application/json" },
      payload: typeof payload === "string" ? payload : JSON.stringify(payload),
    });
  };

  beforeAll(async () => {
    app = await buildApp(
      loadConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgres://x:y@localhost:5432/z",
        WEB_ORIGIN: "http://localhost:5173",
        JWT_SECRET: "list-limit-secret-0123456789abcdef-32", // dummy test value, gitleaks:allow
        LOG_LEVEL: "error",
      }),
    );
  });
  afterAll(async () => {
    await app?.close();
  });

  describe("the worst thing: a member's longest run is refused", () => {
    it("twelve hours of points and 2,000 pauses pass the check on both run routes", async () => {
      const run = longestRun();
      expect(countListItems(run, Number.MAX_SAFE_INTEGER)).toBe(RUN_MAX_POINTS * 5 + RUN_MAX_PAUSES * 3);
      for (const url of ["/v1/geo/runs", "/v1/geo/runs/climb"]) {
        const res = await post(url, run);
        expect(res.statusCode, `${url} ${res.body}`).toBe(401);
      }
    });

    it("one point past what a run may hold is refused on both", async () => {
      for (const url of ["/v1/geo/runs", "/v1/geo/runs/climb"]) {
        expect((await post(url, longestRun(1))).statusCode, url).toBe(413);
      }
    });
  });

  it(`an ordinary route takes ${LIST_ITEMS_MOST.toLocaleString("en")} list items and refuses one more`, async () => {
    expect((await post("/v1/geo/saved-routes", { points: new Array(LIST_ITEMS_MOST).fill(0) })).statusCode).toBe(401);
    const res = await post("/v1/geo/saved-routes", { points: new Array(LIST_ITEMS_MOST + 1).fill(0) });
    expect(res.statusCode).toBe(413);
    const body: unknown = JSON.parse(res.body);
    expect(body).toMatchObject({ error: "too_many_items", message: "This request holds too many items. Send fewer at a time." });
  });

  it("lists are counted together, however they are spread or nested", async () => {
    const half = Math.ceil((LIST_ITEMS_MOST + 1) / 2);
    expect((await post("/v1/geo/saved-routes", { a: new Array(half).fill(1), b: { c: new Array(half).fill(1) } })).statusCode).toBe(413);
    // 5,001 lists of five: 5,001 items in the outer list and 25,005 inside.
    expect((await post("/v1/geo/saved-routes", new Array(5001).fill([1, 2, 3, 4, 5]))).statusCode).toBe(413);
  });

  it("a 1 MB body of 500,000 junk items is refused at once, and nothing it held is said back", async () => {
    const junk = JSON.stringify({ points: new Array(500_000).fill(7) });
    const started = performance.now();
    const res = await post("/v1/geo/saved-routes", junk);
    const ms = performance.now() - started;
    expect(res.statusCode).toBe(413);
    expect(res.body).not.toContain("7,7");
    expect(ms).toBeLessThan(500);
  });

  it("a list in the query string is counted as well", async () => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    const query = new Array(LIST_ITEMS_MOST + 1).fill("a=1").join("&");
    const res = await app.inject({ method: "GET", url: `/v1/geo/runs?${query}`, remoteAddress: "10.77.1.1" });
    expect(res.statusCode).toBe(413);
  });

  describe("countListItems", () => {
    it("counts items, not lists, and nothing outside a list", () => {
      expect(countListItems(null, 10)).toBe(0);
      expect(countListItems("a string of [1,2,3]", 10)).toBe(0);
      expect(countListItems({ a: 1, b: { c: "x" } }, 10)).toBe(0);
      expect(countListItems([], 10)).toBe(0);
      // three in the outer list, two in [2, 3], one in [4]
      expect(countListItems([1, [2, 3], { d: [4] }], 10)).toBe(6);
    });

    it("stops as soon as the most is passed", () => {
      expect(countListItems([new Array(1000).fill(0), new Array(1000).fill(0)], 10)).toBe(1002);
      expect(countListItems([1, 2, 3], 2)).toBe(3);
    });

    it("a list nested 200,000 deep is counted without running out of stack", () => {
      let deep: unknown = [];
      for (let i = 0; i < 200_000; i++) deep = [deep];
      expect(countListItems(deep, Number.MAX_SAFE_INTEGER)).toBe(200_000);
    });
  });
});
