// ROADMAP Stage 5 33b-iii-d — the food search and the meal scan read our own copy of the lists, through
// the routes a person uses, on real Postgres and the real search (no fake list). Names are real ones,
// from the download of 2026-10-29, each with a word no food has, so this file finds its own rows
// whether or not the machine has the whole list loaded. It removes those codes and no others.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { z } from "zod";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { packagedCodesFor } from "../src/modules/nutrition/packagedRepo.js";
import { packagedSearchText } from "../src/modules/nutrition/packagedRows.js";
import type { VisionEvidence } from "@app/shared";
import type { VisionProvider, VisionResult } from "../src/modules/nutrition/vision.adapter.js";
import { MEAL_PHOTO } from "./fixtures/mealPhoto.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");
const PASSWORD = "search33-safe-test-password-1"; // gitleaks:allow
const env = { NODE_ENV: "test", DATABASE_URL: url ?? "", WEB_ORIGIN: "http://localhost:5173", JWT_SECRET: "search33-test-secret-0123456789abcdef", LOG_LEVEL: "error" };

const checkDigit = (body: string): string => {
  let sum = 0;
  for (const [at, digit] of Array.from(body).reverse().entries()) sum += Number(digit) * (at % 2 === 0 ? 3 : 1);
  return String((10 - (sum % 10)) % 10);
};
/** A valid 13-digit code in a range neither list holds. */
let nextCode = 0;
const newCode = (): string => {
  nextCode++;
  const body = `14098888${String(nextCode).padStart(4, "0")}`;
  return `${body}${checkDigit(body)}`;
};

interface Row { name: string; kcal: number; protein?: number | null; carbs?: number | null; fat?: number | null; scans?: number; fit?: boolean; allergens?: string[] }

const shape = z.object({ items: z.array(z.object({ canonical: z.string(), name: z.string(), kcal: z.number(), source: z.string(), measures: z.array(z.object({ id: z.string() })), packaged: z.object({ check: z.string(), allergens: z.array(z.string()), mayContain: z.array(z.string()), listedAsTyped: z.array(z.string()), allergensFrom: z.string().nullable() }).optional() })) });

d("the food search reads our own copy", () => {
  const sql = postgres(url ?? "", { max: 2, prepare: false });
  const redis = createMemoryRedis();
  const evidence: { now: VisionEvidence | null } = { now: null };
  const vision: VisionProvider = {
    analyze: () => {
      if (evidence.now === null) throw new Error("no evidence set");
      return Promise.resolve({ evidence: evidence.now, tokensIn: 10, tokensOut: 10 } satisfies VisionResult);
    },
  };
  let app: Awaited<ReturnType<typeof buildApp>>;
  let cookie = "";
  const codes: string[] = [];

  const addOff = async (row: Row): Promise<string> => {
    const code = newCode();
    codes.push(code);
    await sql`INSERT INTO off_products (code, name, kcal, protein_g, carbs_g, fat_g, numbers_fit, allergens, traces, listed_as_typed, scans, search_text)
      VALUES (${code}, ${row.name}, ${row.kcal}, ${row.protein === undefined ? 1 : row.protein}, ${row.carbs === undefined ? 1 : row.carbs}, ${row.fat === undefined ? 1 : row.fat}, ${row.fit ?? true}, ${sql.array(row.allergens ?? [])}, '{}', '{}', ${row.scans ?? 0}, ${packagedSearchText(row.name)})`;
    return code;
  };
  const addUsda = async (row: Row): Promise<string> => {
    const code = newCode();
    codes.push(code);
    await sql`INSERT INTO usda_branded_products (code, name, kcal, protein_g, carbs_g, fat_g, numbers_fit, search_text)
      VALUES (${code}, ${row.name}, ${row.kcal}, 1, 1, 1, ${row.fit ?? true}, ${packagedSearchText(row.name)})`;
    return code;
  };
  const search = async (q: string, limit = 10) => {
    const res = await app.inject({ method: "GET", url: `/v1/nutrition/foods?q=${encodeURIComponent(q)}&limit=${String(limit)}`, cookies: { accessToken: cookie } });
    expect(res.statusCode, res.body).toBe(200);
    return shape.parse(res.json()).items;
  };

  beforeAll(async () => {
    app = await buildApp(loadConfig(env), { redis, nutrition: { visionProvider: vision } });
    const email = "search33-a@example.com";
    await sql`DELETE FROM users WHERE email = ${email}`;
    await app.inject({ method: "POST", url: "/v1/auth/register", headers: { "content-type": "application/json" }, payload: JSON.stringify({ email, password: PASSWORD, displayName: "Search A" }) });
    const login = await app.inject({ method: "POST", url: "/v1/auth/login", headers: { "content-type": "application/json" }, payload: JSON.stringify({ email, password: PASSWORD }) });
    cookie = login.cookies.find((c) => c.name === "accessToken")?.value ?? "";
  }, 60_000);

  afterAll(async () => {
    await sql`DELETE FROM off_products WHERE code = ANY(${sql.array(codes)})`;
    await sql`DELETE FROM usda_branded_products WHERE code = ANY(${sql.array(codes)})`;
    await sql`DELETE FROM meal_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'search33-%@example.com')`;
    await sql`DELETE FROM users WHERE email LIKE 'search33-%@example.com'`;
    await app.close();
    await sql.end();
  }, 60_000);

  // The worst thing: a wrong number taken because it is popular. Parle-G's real row reads 3.4 kcal per
  // 100 g and is scanned more than the true one at 448.
  it("numbers that do not add up come after those that do, however often they are scanned", async () => {
    const wrong = await addOff({ name: "Parle-G zqxone", kcal: 3.4, protein: 6.9, carbs: 77, fat: 14, scans: 38, fit: false });
    const right = await addOff({ name: "Parle-G Biscuit zqxone", kcal: 448, protein: 7, carbs: 77, fat: 12, scans: 37 });
    const shown = await search("zqxone");
    expect(shown.map((f) => f.canonical)).toEqual([`off_${right}`, `off_${wrong}`]);
    expect(shown[0]?.kcal).toBe(448);
    // Where it is all there is, the person is told, as a barcode tells them.
    expect(shown.map((f) => f.packaged?.check)).toEqual(["fine", "doesnt_add_up"]);
  });

  it("a search says what a barcode says: why to check the numbers, and the allergens", async () => {
    const milk = await addOff({ name: "Dairy Milk zqxallergen", kcal: 534, protein: 7, carbs: 57, fat: 30, scans: 9, allergens: ["milk"] });
    const blank = await addOff({ name: "Marmite zqxallergen", kcal: 260, protein: 34, carbs: 30, fat: null, scans: 5 });
    const shown = await search("zqxallergen");
    expect(shown.find((f) => f.canonical === `off_${milk}`)?.packaged).toEqual({ check: "fine", allergens: ["milk"], mayContain: [], listedAsTyped: [], allergensFrom: "openfoodfacts" });
    expect(shown.find((f) => f.canonical === `off_${blank}`)?.packaged?.check).toBe("part_missing");
  });

  it("the same goes for 0 kcal on a blank panel, and a stated 0 stays in its place", async () => {
    const blank = await addOff({ name: "Chicken fillet zqxtwo", kcal: 0, protein: null, carbs: null, fat: null, scans: 500 });
    const zero = await addOff({ name: "Coke Zero zqxtwo", kcal: 0.3, protein: 0, carbs: 0, fat: 0, scans: 7 });
    const water = await addOff({ name: "Mineral water zqxtwo", kcal: 0, protein: 0, carbs: 0, fat: 0, scans: 5 });
    expect((await search("zqxtwo")).map((f) => f.canonical)).toEqual([`off_${zero}`, `off_${water}`, `off_${blank}`]);
  });

  it("a pick costs what it was shown at, and is found again by its code", async () => {
    const code = await addOff({ name: "Oreo Original zqxthree", kcal: 480, protein: 5, carbs: 69, fat: 20, scans: 9 });
    const [shown] = await search("zqxthree");
    expect(shown).toMatchObject({ canonical: `off_${code}`, kcal: 480, source: "openfoodfacts" });
    const preview = await app.inject({ method: "POST", url: "/v1/nutrition/meals/preview", cookies: { accessToken: cookie }, headers: { "content-type": "application/json" }, payload: JSON.stringify({ items: [{ canonical: `off_${code}`, grams: 50 }] }) });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(z.object({ items: z.array(z.object({ kcalPoint: z.number() })) }).parse(preview.json()).items[0]?.kcalPoint).toBe(240);
  });

  it("a product named just what was typed comes before a more scanned one that only holds the word", async () => {
    const holds = await addOff({ name: "Choc zqxfour bar · Lindt", kcal: 500, carbs: 60, fat: 30, protein: 5, scans: 900 });
    const starts = await addOff({ name: "zqxfour chocolate bar", kcal: 530, carbs: 60, fat: 30, protein: 8, scans: 200 });
    const named = await addOff({ name: "zqxfour · Amul", kcal: 58, carbs: 5, fat: 3, protein: 3, scans: 19 });
    expect((await search("zqxfour")).map((f) => f.canonical)).toEqual([`off_${named}`, `off_${starts}`, `off_${holds}`]);
  });

  it("the most scanned first among equals, and one product listed twice shows once", async () => {
    const most = await addOff({ name: "Nutella zqxfive", kcal: 539, carbs: 57, fat: 31, protein: 6, scans: 853 });
    await addOff({ name: "Nutella zqxfive", kcal: 539, carbs: 57, fat: 31, protein: 6, scans: 804 });
    const fewer = await addOff({ name: "Nutella Plant-Based zqxfive", kcal: 534, carbs: 57, fat: 31, protein: 6, scans: 514 });
    expect((await search("zqxfive")).map((f) => f.canonical)).toEqual([`off_${most}`, `off_${fewer}`]);
  });

  it("a full page of scanned products is the answer: the rest of the list is not read for that word", async () => {
    const page: string[] = [];
    for (let n = 0; n < 12; n++) page.push(await addOff({ name: `Zqxfull product ${String(n)}`, kcal: 100 + n, carbs: 20, fat: 1, protein: 1, scans: 100 - n }));
    await addOff({ name: "zqxfull", kcal: 300, carbs: 40, fat: 10, protein: 10, scans: 2 });
    await addUsda({ name: "Zqxfull usda only", kcal: 50 });
    expect(await packagedCodesFor(sql, "zqxfull", 12)).toEqual(page);
  });

  it("a page one short takes the best of the rest, then a product only USDA has, once each", async () => {
    const scanned = await addOff({ name: "Zqxshort scanned", kcal: 100, carbs: 20, fat: 1, protein: 1, scans: 50 });
    const named = await addOff({ name: "zqxshort", kcal: 300, carbs: 40, fat: 10, protein: 10, scans: 0 });
    const usda = await addUsda({ name: "Zqxshort usda only", kcal: 50 });
    expect(await packagedCodesFor(sql, "zqxshort", 12)).toEqual([scanned, named, usda]);
    expect(await packagedCodesFor(sql, "zqxshort", 2)).toEqual([scanned, named]);
  });

  it("a product scanned by few, and one only USDA has, are still found", async () => {
    const popular = await addOff({ name: "Quinoa zqxsix", kcal: 120, carbs: 20, fat: 2, protein: 4, scans: 3 });
    const few = await addOff({ name: "Quinoa zqxsix Kale", kcal: 56, carbs: 8, fat: 1, protein: 3, scans: 2 });
    const usda = await addUsda({ name: "Swanson Broth zqxsix", kcal: 16 });
    const shown = await search("zqxsix");
    expect(shown.map((f) => f.canonical)).toEqual([`off_${popular}`, `off_${few}`, `off_${usda}`]);
    expect(shown[2]?.source).toBe("usda");
  });

  it("USDA's numbers show where the two lists are far apart, as a barcode's do", async () => {
    const code = await addOff({ name: "Amy's quinoa zqxseven", kcal: 106, carbs: 1, fat: 1, protein: 1, scans: 6 });
    await sql`INSERT INTO usda_branded_products (code, name, kcal, protein_g, carbs_g, fat_g, numbers_fit, search_text) VALUES (${code}, 'Amy''s quinoa', 18, 1, 1, 1, true, 'amy s quinoa')`;
    expect((await search("zqxseven"))[0]).toMatchObject({ canonical: `off_${code}`, kcal: 18, source: "usda", packaged: { check: "lists_differ", allergensFrom: "openfoodfacts" } });
  });

  // Real words from real labels, and words our rule has never seen. Typed as a person types them.
  it.each([
    ["crème fraîche zqxeight", "creme fraiche zqxeight", "accents typed plain"],
    ["Yaourt à la Grecque zqxeight", "YAOURT grecque zqxeight", "capitals, and a word in the middle"],
    ["Coca-Cola Original zqxeight", "coca cola zqxeight", "a hyphen in the name"],
    ["Parle-G zqxeight", "parle g zqxeight", "a one-letter word after a hyphen"],
    ["Weizenbrötchen zqxeight", "zqxeight weizenbrotchen", "another language, words in another order"],
    // Both sides lose the vowel marks, so this proves they agree; no name on the real list holds this word.
    ["दूध zqxeight", "दूध zqxeight", "Hindi"],
    ["牛奶 zqxeight", "牛奶 zqxeight", "Chinese"],
    ["Kit Kat Chunky zqxeight", "zqxeight kit ka", "still being typed"],
  ])("%s is found by %s (%s)", async (name, typed) => {
    const code = await addOff({ name, kcal: 300, carbs: 40, fat: 10, protein: 10, scans: 4 });
    const shown = await search(typed);
    await sql`DELETE FROM off_products WHERE code = ${code}`;
    expect(shown.map((f) => f.canonical)).toContain(`off_${code}`);
  });

  it("one letter alone, and what a search box must not read as an instruction, find nothing and break nothing", async () => {
    // Their first words are in no name a person would type, so none of these can find a product.
    const code = await addOff({ name: "Zqxtwelve DROP TABLE", kcal: 300, carbs: 40, fat: 10, protein: 10, scans: 4 });
    for (const typed of ["'; DROP TABLE zqxnothing; --", "zqxnothing & b | !c", ":*", "(((", "the of"]) {
      expect((await search(typed)).filter((f) => f.canonical.startsWith("off_")), typed).toEqual([]);
    }
    const [held] = await sql<{ n: string }[]>`SELECT count(*) AS n FROM off_products WHERE code = ${code}`;
    expect(held?.n).toBe("1");
    for (const typed of ["x", "q", "the c", "and m", "or b", "a c"]) {
      expect((await packagedCodesFor(sql, typed, 10)), typed).toEqual([]);
    }
  });

  it("nothing is asked over the internet: a search and a meal scan send nothing out", { timeout: 60_000 }, async () => {
    const out = vi.spyOn(globalThis, "fetch");
    const scanned = await addOff({ name: "Zqxnine sauce", kcal: 100, carbs: 20, fat: 1, protein: 1, scans: 4 });
    try {
      await search("zqxnine");
      await search("nothing anybody lists zzzqqq");
      evidence.now = { meal_name: "Plate", items: [{ name: "Zqxnine sauce", canonical_hint: "zqxnine sauce", count: null, grams: 50, kcal: null, protein_g: null, carbs_g: null, fat_g: null }], unknown_items: [], photo_quality: "good" };
      const scan = await app.inject({ method: "POST", url: "/v1/nutrition/analyze-photo", cookies: { accessToken: cookie }, headers: { "content-type": "application/json" }, payload: JSON.stringify({ imageBase64: MEAL_PHOTO, mimeType: "image/jpeg" }) });
      expect(scan.statusCode, scan.body).toBe(200);
      expect(z.object({ items: z.array(z.object({ canonical: z.string() })) }).parse(scan.json()).items[0]?.canonical).toBe(`off_${scanned}`);
      expect(out.mock.calls).toEqual([]);
    } finally {
      out.mockRestore();
    }
  });

  it("a meal scan does not take numbers that do not add up, or that the lists disagree on: it is left for the person to name", { timeout: 60_000 }, async () => {
    const wrong = await addOff({ name: "Zqxten biscuit", kcal: 3.4, protein: 7, carbs: 77, fat: 12, scans: 40, fit: false });
    const blank = await addOff({ name: "Zqxthirteen tartine", kcal: 635, protein: 5, carbs: null, fat: 70, scans: 40 });
    const apart = await addOff({ name: "Zqxeleven soup", kcal: 106, protein: 1, carbs: 1, fat: 1, scans: 40 });
    await sql`INSERT INTO usda_branded_products (code, name, kcal, protein_g, carbs_g, fat_g, numbers_fit, search_text) VALUES (${apart}, 'Zqxeleven soup', 18, 1, 1, 1, true, 'zqxeleven soup')`;
    evidence.now = {
      meal_name: "Plate",
      items: [
        { name: "Banana", canonical_hint: "banana", count: 1, grams: null, kcal: null, protein_g: null, carbs_g: null, fat_g: null },
        { name: "Zqxten biscuit", canonical_hint: "zqxten biscuit", count: null, grams: 50, kcal: null, protein_g: null, carbs_g: null, fat_g: null },
        { name: "Zqxeleven soup", canonical_hint: "zqxeleven soup", count: null, grams: 200, kcal: null, protein_g: null, carbs_g: null, fat_g: null },
        { name: "Zqxthirteen tartine", canonical_hint: "zqxthirteen tartine", count: null, grams: 40, kcal: null, protein_g: null, carbs_g: null, fat_g: null },
      ],
      unknown_items: [],
      photo_quality: "good",
    };
    const scan = await app.inject({ method: "POST", url: "/v1/nutrition/analyze-photo", cookies: { accessToken: cookie }, headers: { "content-type": "application/json" }, payload: JSON.stringify({ imageBase64: MEAL_PHOTO, mimeType: "image/jpeg" }) });
    expect(scan.statusCode, scan.body).toBe(200);
    const items = z.object({ items: z.array(z.object({ canonical: z.string() })) }).parse(scan.json()).items;
    expect(items.map((i) => i.canonical)).not.toContain(`off_${wrong}`);
    expect(items.map((i) => i.canonical)).not.toContain(`off_${apart}`);
    expect(items.map((i) => i.canonical)).not.toContain(`off_${blank}`);
    expect(items.map((i) => i.canonical)).toContain("banana");
  });

  it("a name sent as a food takes no product whose numbers want checking", async () => {
    await addOff({ name: "Zqxfourteen biscuit", kcal: 144, protein: 8, carbs: 57, fat: 20, scans: 40, fit: false });
    const res = await app.inject({ method: "POST", url: "/v1/nutrition/meals/preview", cookies: { accessToken: cookie }, headers: { "content-type": "application/json" }, payload: JSON.stringify({ items: [{ canonical: "Zqxfourteen biscuit", grams: 50 }] }) });
    expect(res.statusCode, res.body).not.toBe(200);
  });

  it("punctuation does not ask the same search again", async () => {
    const asked = vi.spyOn(redis, "setex");
    await search("zqxfifteen cola");
    await addOff({ name: "Zqxfifteen cola", kcal: 42, carbs: 10, fat: 0, protein: 0, scans: 9 });
    const first = await search("zqxfifteen cola");
    const again = await search("zqxfifteen, cola!!");
    expect(again.map((f) => f.canonical)).toEqual(first.map((f) => f.canonical));
    const keys = asked.mock.calls.map((c) => c[0]).filter((k) => k.startsWith("food:pack:"));
    expect(new Set(keys).size).toBe(1);
    asked.mockRestore();
  });
});
