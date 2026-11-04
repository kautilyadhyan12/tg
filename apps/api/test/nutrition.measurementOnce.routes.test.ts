// ROADMAP Stage 5 35c-ii — a body measurement logged on the phone carries the phone's own id
// until the server has it, so the same entry sent twice is kept once, one removed stays removed,
// and an id that is somebody else's entry changes nothing. Through the routes a person uses, on
// the real Postgres.
//
// The worst thing (the plan's line): another member's measurement shown or changed because their
// entry's id was sent.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { z } from "zod";
import { bodyMeasurementListResponseSchema, bodyMeasurementSchema, type BodyMeasurement } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");
const PASSWORD = "bm35c-safe-test-password-1"; // gitleaks:allow
const env = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "bm35c-test-secret-0123456789abcdef-353535", // gitleaks:allow
  LOG_LEVEL: "error",
};
const PATH = "/v1/nutrition/body-measurements";

d("a body measurement sent twice, removed, or under somebody else's id (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 4 });
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let alice = "";
  let bob = "";

  const api = () => { if (app === undefined) throw new Error("beforeAll did not run"); return app; };
  const inject = (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, access: string, body?: unknown) =>
    api().inject({
      method, url: path,
      cookies: access === "" ? {} : { accessToken: access },
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(body) }),
    });
  const session = async (email: string): Promise<string> => {
    await inject("POST", "/v1/auth/register", "", { email, password: PASSWORD, displayName: "Body fixture" });
    const login = await inject("POST", "/v1/auth/login", "", { email, password: PASSWORD });
    return login.cookies.find((c) => c.name === "accessToken")?.value ?? "";
  };
  const entryOf = (body: string): BodyMeasurement => bodyMeasurementSchema.parse(z.object({ measurement: z.unknown() }).parse(JSON.parse(body)).measurement);
  const list = async (access: string): Promise<BodyMeasurement[]> => {
    const res = await inject("GET", `${PATH}?limit=100`, access);
    expect(res.statusCode, res.body).toBe(200);
    return bodyMeasurementListResponseSchema.parse(res.json()).items;
  };
  const rowsWith = async (id: string) => await sql<{ user_id: string; weight_kg: string | null }[]>`SELECT user_id, weight_kg FROM body_measurements WHERE id = ${id}`;
  const entry = (weightKg: number, extra: Record<string, unknown> = {}) => ({ measuredAt: new Date(Date.now() - 60_000).toISOString(), weightKg, metrics: { waist_cm: 82 }, ...extra });
  const clean = async (): Promise<void> => {
    await sql`DELETE FROM body_measurements WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'bm35c-%@example.com')`;
    await sql`DELETE FROM body_measurement_removed_ids WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'bm35c-%@example.com')`;
    await sql`DELETE FROM users WHERE email LIKE 'bm35c-%@example.com'`;
  };

  beforeAll(async () => {
    await clean();
    app = await buildApp(loadConfig(env), { redis: createMemoryRedis() });
    alice = await session("bm35c-alice@example.com");
    bob = await session("bm35c-bob@example.com");
  }, 60_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await clean();
    await sql.end({ timeout: 5 });
  });

  it("the worst thing: an id that is somebody else's entry is refused, shows nothing of theirs and changes nothing", async () => {
    const id = randomUUID();
    const mine = await inject("POST", PATH, alice, entry(70.25, { id }));
    expect(mine.statusCode, mine.body).toBe(201);

    const theirs = await inject("POST", PATH, bob, entry(99.5, { id, metrics: { waist_cm: 120 } }));
    expect(theirs.statusCode, theirs.body).toBe(404);
    expect(theirs.body).not.toContain("70.25");
    expect(theirs.body).not.toContain("waist_cm");

    expect(await rowsWith(id)).toEqual([{ user_id: expect.any(String) as string, weight_kg: "70.25" }]);
    expect((await list(alice)).filter((m) => m.id === id).map((m) => [m.weightKg, m.metrics])).toEqual([[70.25, { waist_cm: 82 }]]);
    expect((await list(bob)).some((m) => m.id === id)).toBe(false);

    // Nor can Bob remove it, and his try leaves no mark that would stop Alice's own phone.
    expect((await inject("DELETE", `${PATH}/${id}`, bob)).statusCode).toBe(404);
    expect(await rowsWith(id)).toHaveLength(1);
    expect(await sql`SELECT 1 FROM body_measurement_removed_ids WHERE id = ${id}`).toHaveLength(0);
  });

  it("the same entry sent twice is kept once, and the second answer is the entry as it is", async () => {
    const id = randomUUID();
    const first = await inject("POST", PATH, alice, entry(71.4, { id }));
    expect(first.statusCode, first.body).toBe(201);
    const again = await inject("POST", PATH, alice, entry(71.4, { id }));
    expect(again.statusCode, again.body).toBe(201);
    expect(entryOf(again.body)).toEqual(entryOf(first.body));
    expect(await rowsWith(id)).toHaveLength(1);

    // A second send never changes what the first kept.
    const changed = await inject("POST", PATH, alice, entry(80, { id }));
    expect(entryOf(changed.body).weightKg).toBe(71.4);
    expect(await rowsWith(id)).toHaveLength(1);
  });

  it("two sends at the same moment keep one entry", async () => {
    const id = randomUUID();
    const answers = await Promise.all([1, 2, 3, 4].map(() => inject("POST", PATH, alice, entry(72.1, { id }))));
    expect(answers.map((a) => a.statusCode)).toEqual([201, 201, 201, 201]);
    expect(new Set(answers.map((a) => entryOf(a.body).id))).toEqual(new Set([id]));
    expect(await rowsWith(id)).toHaveLength(1);
  });

  it("an entry removed stays removed though a late copy of its save arrives", async () => {
    const id = randomUUID();
    expect((await inject("POST", PATH, alice, entry(73, { id }))).statusCode).toBe(201);
    expect((await inject("DELETE", `${PATH}/${id}`, alice)).statusCode).toBe(204);
    const late = await inject("POST", PATH, alice, entry(73, { id }));
    expect(late.statusCode, late.body).toBe(404);
    expect(await rowsWith(id)).toHaveLength(0);
    expect((await list(alice)).some((m) => m.id === id)).toBe(false);
  });

  it("a removal and a save of one id at the same moment never leave the entry behind", async () => {
    for (let i = 0; i < 5; i += 1) {
      const id = randomUUID();
      expect((await inject("POST", PATH, alice, entry(74, { id }))).statusCode).toBe(201);
      const [gone] = await Promise.all([inject("DELETE", `${PATH}/${id}`, alice), inject("POST", PATH, alice, entry(74, { id }))]);
      expect(gone.statusCode).toBe(204);
      expect(await rowsWith(id)).toHaveLength(0);
    }
  });

  it("an id in capitals is the same entry, kept in small letters", async () => {
    const id = randomUUID();
    const up = await inject("POST", PATH, alice, entry(75, { id: id.toUpperCase() }));
    expect(up.statusCode, up.body).toBe(201);
    expect(entryOf(up.body).id).toBe(id);
    expect((await inject("POST", PATH, alice, entry(75, { id }))).statusCode).toBe(201);
    expect(await rowsWith(id)).toHaveLength(1);
  });

  it("without an id every send is a new entry, as the browser's is", async () => {
    const a = entryOf((await inject("POST", PATH, alice, entry(76))).body);
    const b = entryOf((await inject("POST", PATH, alice, entry(76))).body);
    expect(a.id).not.toBe(b.id);
  });

  it("an id that is not an id is refused, and a change can never move an entry to another id", async () => {
    const bad = await inject("POST", PATH, alice, entry(77, { id: "not-an-id" }));
    expect(bad.statusCode, bad.body).toBe(400);
    const made = entryOf((await inject("POST", PATH, alice, entry(77))).body);
    const moved = await inject("PATCH", `${PATH}/${made.id}`, alice, { id: randomUUID(), weightKg: 78 });
    expect(moved.statusCode, moved.body).toBe(400);
  });

  it("signed out, nothing is kept", async () => {
    const id = randomUUID();
    expect((await inject("POST", PATH, "", entry(79, { id }))).statusCode).toBe(401);
    expect(await rowsWith(id)).toHaveLength(0);
  });
});
