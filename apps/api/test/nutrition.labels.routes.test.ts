// ROADMAP Stage 5 33b-iii-c — a pack's label through the routes a person uses, on real Postgres.
// The worst thing, first: a missed allergen, a misread number kept for good, or one person's label
// shown to another. Replies are Luna's own on 20 real labels (`fixtures/label-replies.json`).
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { barcodeReplySchema, labelDraftSchema, labelEvidenceSchema, mealPreviewSchema, photoScansLeftSchema, type LabelEvidence } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis, type RedisLike } from "../src/redis.js";
import { VisionProviderError, type LabelReader } from "../src/modules/nutrition/vision.adapter.js";
import { MEAL_PHOTO } from "./fixtures/mealPhoto.js";

const real = JSON.parse(readFileSync(new URL("./fixtures/label-replies.json", import.meta.url), "utf8")) as { code: string; evidence: unknown }[];
const replyFor = (code: string): LabelEvidence => labelEvidenceSchema.parse(real.find((r) => r.code === code)?.evidence);
/** Per 100 g, kcal and kJ both printed, protein 10. */
const NOODLES = replyFor("8901042954516");
/** A US panel, one serving of 39 g, protein "< 1 g" written as null. */
const US_PANEL = replyFor("0010700021526");
/** Allergens as the pack names them. */
const WITH_ALLERGENS = replyFor("0008077102146");

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");
const PASSWORD = "label33-safe-test-password-1"; // gitleaks:allow
const env = { NODE_ENV: "test", DATABASE_URL: url ?? "", WEB_ORIGIN: "http://localhost:5173", JWT_SECRET: "label33-test-secret-0123456789abcdefgh", LOG_LEVEL: "error" }; // gitleaks:allow
/** A valid 13-digit code in a range neither list holds (33b-iii-a counted it). */
const CODE = "1409999800018";
const CODE_2 = "1409999800025";

d("a pack's label (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 4 });
  let redis: RedisLike = createMemoryRedis();
  let next: (() => Promise<{ evidence: LabelEvidence; tokensIn: number; tokensOut: number }>) = () => Promise.resolve({ evidence: NOODLES, tokensIn: 100, tokensOut: 50 });
  let reads = 0;
  const reader: LabelReader = { read() { reads += 1; return next(); } };
  const says = (evidence: LabelEvidence) => () => Promise.resolve({ evidence, tokensIn: 100, tokensOut: 50 });
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let alice = "";
  let bob = "";
  let aliceId = "";

  const api = () => { if (app === undefined) throw new Error("beforeAll did not run"); return app; };
  const inject = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, access: string, body?: unknown, from = "203.0.113.78") =>
    api().inject({
      method, url: path, remoteAddress: from,
      cookies: access === "" ? {} : { accessToken: access },
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(body) }),
    });
  let signIns = 0;
  const session = async (email: string): Promise<string> => {
    // Each from an address of its own: sign-in's limit by address is not what is being tested.
    signIns += 1;
    const from = `198.51.100.${String(signIns)}`;
    await inject("POST", "/v1/auth/register", "", { email, password: PASSWORD, displayName: "Label fixture" }, from);
    const login = await inject("POST", "/v1/auth/login", "", { email, password: PASSWORD }, from);
    return login.cookies.find((c) => c.name === "accessToken")?.value ?? "";
  };
  const read = (access = alice, retakeToken?: string) => inject("POST", "/v1/nutrition/labels/read", access, { imageBase64: MEAL_PHOTO, mimeType: "image/jpeg", ...(retakeToken === undefined ? {} : { retakeToken }) });
  const body = { name: "Instant noodles", unit: "g", amount: 100, kcal: 365, proteinG: 10, carbsG: 63, fatG: 8, servingAmount: null, contains: ["Wheat"], mayContain: ["Mustard"] };
  const save = (id: string, code: string | null, access = alice, over: object = {}) => inject("PUT", `/v1/nutrition/labels/${id}`, access, { ...body, code, ...over });
  const left = async (access = alice) => photoScansLeftSchema.parse((await inject("GET", "/v1/nutrition/photo-scans", access)).json());
  const clean = async (): Promise<void> => {
    await sql`DELETE FROM meal_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'label33-%@example.com')`;
    await sql`DELETE FROM users WHERE email LIKE 'label33-%@example.com'`;
  };

  beforeAll(async () => {
    await clean();
    redis = createMemoryRedis();
    app = await buildApp(loadConfig(env), { redis, nutrition: { labelReader: reader, visionProvider: { analyze: () => Promise.reject(new Error("no meal scan here")) }, matchChecker: null } });
    alice = await session("label33-alice@example.com");
    bob = await session("label33-bob@example.com");
    const [row] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = 'label33-alice@example.com'`;
    aliceId = row?.id ?? "";
  }, 60_000);

  afterAll(async () => {
    await clean();
    await api().close();
    await sql.end();
  });

  describe("the worst thing", () => {
    it("one person's saved label is nobody else's: not found, not priced, not changed, not removed", async () => {
      const id = randomUUID();
      expect((await save(id, CODE)).statusCode).toBe(200);
      const theirs = barcodeReplySchema.parse((await inject("GET", `/v1/nutrition/barcode/${CODE}`, bob)).json());
      expect(theirs.status).toBe("not_found");
      const priced = await inject("POST", "/v1/nutrition/meals/preview", bob, { items: [{ canonical: `label_${id}`, grams: 100 }] });
      expect(priced.statusCode).toBe(400);
      expect(priced.json()).toMatchObject({ error: "unknown_food" });
      expect((await save(id, CODE, bob, { kcal: 1 })).statusCode).toBe(404);
      expect((await inject("DELETE", `/v1/nutrition/labels/${id}`, bob)).statusCode).toBe(404);
      const mine = barcodeReplySchema.parse((await inject("GET", `/v1/nutrition/barcode/${CODE}`, alice)).json());
      expect(mine).toMatchObject({ status: "found", labelId: id, food: { kcal: 365, source: "label" } });
      expect((await inject("DELETE", `/v1/nutrition/labels/${id}`, alice)).statusCode).toBe(204);
    });

    it("a stranger is told nothing without signing in", async () => {
      expect((await read("")).statusCode).toBe(401);
      expect((await inject("GET", "/v1/nutrition/photo-scans", "")).statusCode).toBe(401);
      expect((await save(randomUUID(), CODE, "")).statusCode).toBe(401);
      expect((await inject("DELETE", `/v1/nutrition/labels/${randomUUID()}`, "")).statusCode).toBe(401);
    });

    it("a label with no allergens read says none were read, as an empty list, never as safe", async () => {
      next = says(NOODLES);
      const res = await read(await session("label33-a1@example.com"));
      expect(res.statusCode, res.body).toBe(200);
      expect(labelDraftSchema.parse(res.json())).toMatchObject({ contains: [], mayContain: [], per: "100", kcal: 365, proteinG: 10 });
    });

    it("allergens come back in the pack's own words", async () => {
      next = says(WITH_ALLERGENS);
      const draft = labelDraftSchema.parse((await read(await session("label33-a2@example.com"))).json());
      expect(draft.contains).toEqual(["Wheat", "Milk", "Soy"]);
      expect(draft).toMatchObject({ per: "serving", amount: 15, servingAmount: 15, kcal: 80 });
    });

    it("a number that could not be read is missing, never 0, and is said", async () => {
      next = says(US_PANEL);
      const draft = labelDraftSchema.parse((await read(await session("label33-a3@example.com"))).json());
      expect(draft).toMatchObject({ per: "serving", amount: 39, kcal: 170, proteinG: null, check: "part_missing" });
    });

    it("kJ copied as kcal does not pass as fine", async () => {
      next = says({ ...NOODLES, columns: [{ ...NOODLES.columns[0] as LabelEvidence["columns"][number], kcal: 1533, kj: null }] });
      const draft = labelDraftSchema.parse((await read(await session("label33-a4@example.com"))).json());
      expect(draft.check).toBe("doesnt_add_up");
    });

    it.each([
      ["calories no 100 g can hold", { amount: 10, kcal: 365 }],
      ["a whole pack's fat on a small serving", { amount: 15, kcal: 80, proteinG: 1, carbsG: 10, fatG: 40 }],
    ])("%s are refused, and nothing is kept", async (_name, over) => {
      const id = randomUUID();
      const res = await save(id, CODE_2, alice, over);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: "label_numbers_impossible" });
      expect(barcodeReplySchema.parse((await inject("GET", `/v1/nutrition/barcode/${CODE_2}`, alice)).json()).status).toBe("not_found");
    });
  });

  it("every one of Luna's 20 real replies reads as a label or asks for the photo again; none throws", () => {
    for (const { evidence } of real) expect(labelEvidenceSchema.safeParse(evidence).success).toBe(true);
  });

  describe("the count of photo scans", () => {
    it("a read uses one and says so; a free plan has 3 a month, then is refused and costs nothing", async () => {
      const carol = await session("label33-carol@example.com");
      next = says(NOODLES);
      const before = reads;
      expect(await left(carol)).toEqual({ window: "month", limit: 3, left: 3 });
      expect((await read(carol)).statusCode).toBe(200);
      expect(await left(carol)).toEqual({ window: "month", limit: 3, left: 2 });
      expect((await read(carol)).statusCode).toBe(200);
      expect((await read(carol)).statusCode).toBe(200);
      expect((await left(carol)).left).toBe(0);
      const over = await read(carol);
      expect(over.statusCode).toBe(429);
      expect(over.json()).toMatchObject({ error: "quota_exceeded" });
      expect(reads - before).toBe(3);
      expect((await left(carol)).left).toBe(0);
    });

    it("not a label, or nothing usable: a free retake, which uses none, and is one use only", async () => {
      const dan = await session("label33-dan@example.com");
      next = says({ ...NOODLES, is_nutrition_label: false, columns: [] });
      const first = await read(dan);
      expect(first.statusCode).toBe(422);
      const token = first.json<{ retakeToken: string }>().retakeToken;
      expect(typeof token).toBe("string");
      expect((await left(dan)).left).toBe(2);
      next = says(NOODLES);
      expect((await read(dan, token)).statusCode).toBe(200);
      expect((await left(dan)).left).toBe(2);
      expect((await read(dan, token)).statusCode).toBe(400);
    });

    it("the scanner down gives the scan back", async () => {
      const erin = await session("label33-erin@example.com");
      next = () => Promise.reject(new VisionProviderError("vision HTTP 500", "unavailable"));
      expect((await read(erin)).statusCode).toBe(503);
      expect((await left(erin)).left).toBe(3);
      next = says(NOODLES);
    });

    it("a count that cannot be read is no count, never a full one", async () => {
      const frank = await session("label33-frank@example.com");
      const get = redis.get.bind(redis);
      const setex = redis.setex.bind(redis);
      redis.get = () => Promise.resolve(null);
      redis.setex = () => Promise.resolve(false);
      try {
        expect((await left(frank)).left).toBeNull();
      } finally {
        redis.get = get;
        redis.setex = setex;
      }
    });
  });

  describe("kept, and logged", () => {
    it("saved per serving is kept per 100 g, opens on the next scan at no cost, and prices a meal", async () => {
      const grace = await session("label33-grace@example.com");
      const id = randomUUID();
      const saved = await save(id, CODE, grace, { amount: 39, kcal: 170, proteinG: 1, carbsG: 27, fatG: 6, servingAmount: 39 });
      expect(saved.statusCode, saved.body).toBe(200);
      const before = (await left(grace)).left;
      const reply = barcodeReplySchema.parse((await inject("GET", `/v1/nutrition/barcode/${CODE}`, grace)).json());
      if (reply.status !== "found") throw new Error(reply.status);
      expect(reply.food.kcal).toBeCloseTo(435.9, 1);
      expect(reply.food.source).toBe("label");
      expect(reply.food.serving).toBe(39);
      expect(reply.check).toBe("fine");
      expect((await left(grace)).left).toBe(before);
      const priced = await inject("POST", "/v1/nutrition/meals/preview", grace, { items: [{ canonical: `label_${id}`, grams: 39 }] });
      expect(priced.statusCode, priced.body).toBe(200);
      const item = mealPreviewSchema.parse(priced.json()).items[0];
      expect(item).toMatchObject({ kcalPoint: 170, nutritionSource: "label" });
    });

    it("sent twice is one food; the same barcode under a new id changes the one they have", async () => {
      const hana = await session("label33-hana@example.com");
      const id = randomUUID();
      expect((await save(id, CODE, hana)).statusCode).toBe(200);
      expect((await save(id, CODE, hana, { kcal: 370 })).statusCode).toBe(200);
      const again = barcodeReplySchema.parse((await save(randomUUID(), CODE, hana, { kcal: 380 })).json());
      expect(again).toMatchObject({ status: "found", labelId: id, food: { kcal: 380 } });
      const [row] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM member_label_foods m JOIN users u ON u.id = m.user_id WHERE u.email = 'label33-hana@example.com'`;
      expect(row?.n).toBe(1);
    });

    it("a label with no barcode is kept under its own id; a store's own code is refused", async () => {
      const id = randomUUID();
      const saved = barcodeReplySchema.parse((await save(id, null)).json());
      expect(saved).toMatchObject({ status: "found", labelId: id });
      expect((await save(randomUUID(), "0200024010652")).statusCode).toBe(400);
      await inject("DELETE", `/v1/nutrition/labels/${id}`, alice);
    });

    it("removed, the barcode is not found again, and a meal already logged keeps its numbers", async () => {
      const id = randomUUID();
      await save(id, CODE, alice);
      const meal = await inject("POST", "/v1/nutrition/meals", alice, { id: randomUUID(), mealName: "Noodles", takenAt: new Date().toISOString(), mealType: "lunch", items: [{ canonical: `label_${id}`, grams: 100 }] });
      expect(meal.statusCode, meal.body).toBe(201);
      expect((await inject("DELETE", `/v1/nutrition/labels/${id}`, alice)).statusCode).toBe(204);
      expect(barcodeReplySchema.parse((await inject("GET", `/v1/nutrition/barcode/${CODE}`, alice)).json()).status).toBe("not_found");
      const rows = await sql<{ kcal_point: number }[]>`SELECT kcal_point FROM meal_logs WHERE user_id = ${aliceId}`;
      expect(rows[0]?.kcal_point).toBe(365);
    });

    it("the body is parsed: words too long, a bad id", async () => {
      expect((await save(randomUUID(), CODE, alice, { name: "x".repeat(81) })).statusCode).toBe(400);
      expect((await save(randomUUID(), CODE, alice, { contains: ["x".repeat(61)] })).statusCode).toBe(400);
      expect((await inject("PUT", "/v1/nutrition/labels/not-an-id", alice, { ...body, code: CODE })).statusCode).toBe(400);
    });
  });
});
