// ROADMAP 7a-iii-b — the scanner prices every food it sees, through the routes a
// person uses: scanned, corrected, saved, edited later, and unreachable by anyone
// else. A food no table has is the model's own estimate; a table food whose
// energy is three times from what the model saw is another food, and gives way.
// ROADMAP 7a-iv-b — each row starts at one of its food's own measures where the
// photo's count of it weighs near what the photo saw, else at the photo's grams.
// The test plates — Kd's eight and PR #71's review cases — run through the same
// route and the same lookups.
//
// The foods here carry nonsense words ("qwzx…", "zqxscanroute"), and every USDA
// fixture is keyed above 90,000,000, so this file answers the same whether or not
// the machine has had `tools/import-usda.ts` run against it. The eight plates'
// USDA rows are the real ones, copied whole (below): on a machine with the table
// loaded, a real row and its copy tie on everything but the id, and the sheet
// shows the same food either way. The USDA entries our list's foods on the plates
// cite are the real ones under their own ids (fixtures/usda-plate-foods.json),
// written only where the table does not hold them and removed only if written.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { z } from "zod";
import { mealPhotoAnalysisSchema, mealPreviewSchema, mealSchema, mealVisionEvidenceSchema, type Meal, type MealPhotoAnalysis, type MealPhotoItem, type VisionEvidence, type VisionItem } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import type { FoodSearchProvider } from "../src/modules/nutrition/openfoodfacts.adapter.js";
import type { VisionProvider } from "../src/modules/nutrition/vision.adapter.js";
import * as repo from "../src/modules/nutrition/repo.js";
import { importUsda } from "../tools/usda-table.js";
import { USDA_NUTRIENTS, type UsdaEntry, type UsdaNutrient, type UsdaPortion, type UsdaRelease } from "../tools/usda-files.js";

const sentry = vi.hoisted(() => ({ init: vi.fn(), captureException: vi.fn(), httpIntegration: vi.fn() }));
vi.mock("@sentry/node", () => sentry);
// The USDA measures read, counted and passed through to the real one: a photo sheet's
// preview reads them once, not once a row (the review of PR #76, L4).
vi.mock("../src/modules/nutrition/repo.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/modules/nutrition/repo.js")>();
  return { ...real, usdaPortionsFor: vi.fn(real.usdaPortionsFor) };
});

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");
const PASSWORD = "scan7b-safe-test-password-1"; // gitleaks:allow
const env = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "scan7b-test-secret-0123456789abcdef-32", // gitleaks:allow
  LOG_LEVEL: "error",
  GROQ_API_KEY: "scan7b-fake-provider-key", // gitleaks:allow
};
const jpeg = (() => { const bytes = Buffer.alloc(1200, 1); bytes[0] = 0xff; bytes[1] = 0xd8; bytes[2] = 0xff; return bytes.toString("base64"); })();

/** This file's USDA ids. The other USDA test files hold 90,000,001–099, 201–299 and
 *  401–499, and run beside this one: an id two files share is saved over and deleted. */
const USDA_ID = 90_000_501;
/** One name, two ways made: the survey release's pickled at 34 kcal per 100 g, and
 *  SR Legacy's raw at 16, which the release rule alone would never pick. */
const PICKLED_ID = 90_000_502;
const RAW_ID = 90_000_503;
/** The eight plates' USDA rows, from here up. */
const PLATE_ROWS_FROM = 90_000_510;
const LAST_ID = 90_000_899;

/** Every USDA row the eight plates' foods can find by name (`usdaFoodForScan`'s
 *  WHERE), copied from the loaded table on 2026-09-16 — FNDDS 2024-10-31 and SR
 *  Legacy 2018-04, public domain: release, description, kcal, protein, carbohydrate,
 *  fat and fibre per 100 g, and the first household measure. The coconut, brie
 *  cheese, deli ham, sweet corn and sesame seed rows were copied the same way on
 *  2026-09-17, for the "-apart" plates, the chicken salad, garlic bread, steamed
 *  rice, baby carrot, green tea, vanilla yogurt and grilled shrimp rows the same
 *  day, for the review-names plates (ROADMAP 7a-iv-i), and the raw broccoli,
 *  roasted almond, hot milk, vegetable lasagna, soy yogurt, gluten free pasta and
 *  lactose free milk rows that evening, for the plates of the reviews of PR #80 and
 *  #81. The other plates' foods not on our list by their whole name (avocado toast,
 *  cherry tomato, toast, banana toast, egg bacon toast, sourdough toast, mashed
 *  avocado, grilled asparagus, scored pork sausage, iced latte, roasted pumpkin,
 *  steamed broccoli, cherry tomatoes, light coconut milk, oreo cookies, overnight
 *  oats, grilled corn, boiled egg whites, masala dosa, steamed dumplings, and every
 *  other food of the review plates) find none in either release. */
const PLATE_USDA_ROWS: readonly (readonly [UsdaRelease, string, number, number, number, number, number | null, number, string])[] = [
  ["fndds", "Pumpkin seeds, NFS", 574, 29.84, 14.71, 49.05, 6.5, 144, "cup, without shell"],
  ["fndds", "Pumpkin seeds, salted", 567, 29.49, 14.54, 48.47, 6.4, 144, "cup, without shell"],
  ["fndds", "Pumpkin seeds, unsalted", 574, 29.84, 14.71, 49.05, 6.5, 144, "cup, without shell"],
  ["fndds", "Lemon, raw", 29, 1.1, 9.32, 0.3, 2.8, 65, "fruit"],
  ["fndds", "Lemon pie filling", 354, 4.71, 68.92, 6.93, 0.4, 260, "cup"],
  ["fndds", "Lemon juice, 100%, NS as to form", 22, 0.35, 6.9, 0.24, 0.3, 31, "fl oz (no ice)"],
  ["fndds", "Lemon juice, 100%, freshly squeezed", 22, 0.35, 6.9, 0.24, 0.3, 31, "fl oz (no ice)"],
  ["fndds", "Lemon juice, 100%, canned or bottled", 17, 0.45, 5.62, 0.07, 0.7, 31, "fl oz (no ice)"],
  ["fndds", "Pumpkin, canned, cooked", 56, 1.08, 7.86, 2.82, 2.8, 245, "cup"],
  ["fndds", "Pumpkin, cooked", 52, 1.05, 6.77, 2.84, 0.5, 230, "cup"],
  ["fndds", "Lemon-butter sauce", 671, 0.8, 0.74, 74, 0, 16, "tablespoon"],
  ["fndds", "Iced Coffee, brewed", 1, 0.09, 0, 0.02, 0, 30, "fl oz"],
  ["fndds", "Iced Coffee, brewed, decaffeinated", 0, 0.08, 0, 0, 0, 30, "fl oz"],
  ["fndds", "Iced Coffee, pre-lightened and pre-sweetened", 31, 0.25, 4.94, 1.12, 0, 31, "fl oz"],
  ["fndds", "Coffee, Iced Latte", 27, 1.75, 2.81, 1.01, 0, 30, "fl oz"],
  ["fndds", "Coffee, Iced Latte, nonfat", 19, 1.78, 2.82, 0.07, 0, 30, "fl oz"],
  ["fndds", "Coffee, Iced Latte, with non-dairy milk", 24, 1.36, 2.83, 0.79, 0.1, 30, "fl oz"],
  ["fndds", "Coffee, Iced Latte, flavored", 40, 1.69, 6.09, 0.98, 0, 31, "fl oz"],
  ["fndds", "Coffee, Iced Latte, nonfat, flavored", 32, 1.72, 6.1, 0.08, 0, 31, "fl oz"],
  ["fndds", "Coffee, Iced Latte, with non-dairy milk, flavored", 31, 0.59, 5.16, 0.84, 0, 31, "fl oz"],
  ["fndds", "Coffee, Iced Latte, decaffeinated", 27, 1.75, 2.82, 1.01, 0, 30, "fl oz"],
  ["fndds", "Coffee, Iced Latte, decaffeinated, nonfat", 19, 1.79, 2.83, 0.07, 0, 30, "fl oz"],
  ["fndds", "Coffee, Iced Latte, decaffeinated, with non-dairy milk", 18, 0.61, 1.86, 0.86, 0.1, 30, "fl oz"],
  ["fndds", "Coffee, Iced Latte, decaffeinated, flavored", 40, 1.69, 6.12, 0.99, 0, 31, "fl oz"],
  ["fndds", "Coffee, Iced Latte, decaffeinated, nonfat, flavored", 32, 1.73, 6.13, 0.08, 0, 31, "fl oz"],
  ["fndds", "Coffee, Iced Latte, decaffeinated, with non-dairy milk, flavored", 31, 0.59, 5.18, 0.84, 0.1, 31, "fl oz"],
  ["fndds", "Coffee, Iced Cafe Mocha", 50, 1.58, 8.95, 0.91, 0, 31, "fl oz"],
  ["fndds", "Coffee, Iced Cafe Mocha, nonfat", 43, 1.61, 8.96, 0.07, 0, 31, "fl oz"],
  ["fndds", "Coffee, Iced Cafe Mocha, with non-dairy milk", 42, 0.55, 8.07, 0.78, 0, 31, "fl oz"],
  ["fndds", "Coffee, Iced Cafe Mocha, decaffeinated", 51, 1.59, 8.99, 0.92, 0, 31, "fl oz"],
  ["fndds", "Coffee, Iced Cafe Mocha, decaffeinated, nonfat", 43, 1.62, 9, 0.06, 0, 31, "fl oz"],
  ["fndds", "Coffee, Iced Cafe Mocha, decaffeinated, with non-dairy milk", 42, 0.55, 8.1, 0.78, 0, 31, "fl oz"],
  ["fndds", "Coconut cream, canned, sweetened", 357, 1.17, 53.21, 16.31, 0.2, 30, "fl oz (no ice)"],
  ["fndds", "Coconut, fresh", 354, 3.33, 15.23, 33.49, 9, 85, "cup"],
  ["fndds", "Coconut milk", 31, 0.21, 2.92, 2.08, 0, 244, "cup"],
  ["fndds", "Coconut milk, used in cooking", 230, 2.29, 5.54, 23.84, 2.2, 30, "fl oz"],
  ["fndds", "Coconut oil", 895, 0, 0.84, 99.1, 0, 224, "cup"],
  ["fndds", "Coconut, packaged", 456, 3.13, 51.85, 27.99, 9.9, 85, "cup"],
  ["fndds", "Coconut water, sweetened", 37, 0.21, 9.07, 0.02, 0, 30, "fl oz (no ice)"],
  ["fndds", "Coconut water, unsweetened", 18, 0.22, 4.24, 0, 0, 30, "fl oz (no ice)"],
  ["fndds", "Cheese, Brie", 334, 20.75, 0.45, 27.68, 0, 128, "package (4.5 oz)"],
  ["fndds", "Ham, prepackaged or deli, luncheon meat", 101, 16.7, 0.27, 3.73, 0, 28, "slice, NFS"],
  ["fndds", "Ham, prepackaged or deli, luncheon meat, reduced sodium", 101, 16.7, 0.27, 3.73, 0, 28, "slice, NFS"],
  ["fndds", "Sesame seeds", 631, 20.45, 11.73, 61.21, 11.6, 128, "cup"],
  ["sr_legacy", "Lemons, raw, without peel", 29, 1.1, 9.32, 0.3, 2.8, 212, "cup, sections"],
  ["sr_legacy", "Lemon juice, raw", 22, 0.35, 6.9, 0.24, 0.3, 244, "cup"],
  ["sr_legacy", "Lemon juice from concentrate, canned or bottled", 17, 0.45, 5.62, 0.07, 0.7, 15, "tbsp"],
  ["sr_legacy", "Lemon peel, raw", 47, 1.5, 16, 0.3, 10.6, 6, "tbsp"],
  ["sr_legacy", "Lemon juice from concentrate, bottled, CONCORD", 24, 0.4, 5.37, 0.07, null, 15, "tbsp"],
  ["sr_legacy", "Lemon juice from concentrate, bottled, REAL LEMON", 17, 0.47, 5.66, 0.07, 0.7, 15, "tbsp"],
  ["sr_legacy", "Pumpkin leaves, cooked, boiled, drained, without salt", 21, 2.72, 3.39, 0.22, 2.7, 71, "cup"],
  ["sr_legacy", "Pumpkin, raw", 26, 1, 6.5, 0.1, 0.5, 116, "cup (1\" cubes)"],
  ["sr_legacy", "Pumpkin, cooked, boiled, drained, without salt", 20, 0.72, 4.9, 0.07, 1.1, 245, "cup, mashed"],
  ["sr_legacy", "Pumpkin, canned, without salt", 34, 1.1, 8.09, 0.28, 2.9, 245, "cup"],
  ["sr_legacy", "Lemon grass (citronella), raw", 99, 1.82, 25.31, 0.49, null, 67, "cup"],
  ["sr_legacy", "Pumpkin flowers, raw", 15, 1.03, 3.28, 0.07, null, 33, "cup"],
  ["sr_legacy", "Pumpkin flowers, cooked, boiled, drained, without salt", 15, 1.09, 3.3, 0.08, 0.9, 134, "cup"],
  ["sr_legacy", "Pumpkin leaves, raw", 19, 3.15, 2.33, 0.4, null, 39, "cup"],
  ["sr_legacy", "Pumpkin pie mix, canned", 104, 1.09, 26.39, 0.13, 8.3, 270, "cup"],
  ["sr_legacy", "Pumpkin, flowers, cooked, boiled, drained, with salt", 15, 1.09, 3.18, 0.08, 0.9, 134, "cup"],
  ["sr_legacy", "Pumpkin leaves, cooked, boiled, drained, with salt", 21, 2.72, 3.39, 0.22, 2.7, 71, "cup"],
  ["sr_legacy", "Pumpkin, cooked, boiled, drained, with salt", 18, 0.72, 4.31, 0.07, 1.1, 245, "cup, mashed"],
  ["sr_legacy", "Pumpkin, canned, with salt", 34, 1.1, 8.09, 0.28, 2.9, 245, "cup"],
  ["sr_legacy", "Cheese, brie", 334, 20.75, 0.45, 27.68, 0, 28.35, "oz"],
  ["sr_legacy", "Ham, sliced, pre-packaged, deli meat (96%fat free, water added)", 107, 16.85, 0.7, 4.04, 0, 13, "slice"],
  ["sr_legacy", "Ham, turkey, sliced, extra lean, prepackaged or deli", 134, 19.6, 0.93, 5.8, 0, 138, "cup pieces"],
  ["sr_legacy", "Corn, sweet, white, canned, cream style, no salt added", 72, 1.74, 18.13, 0.42, 1.2, 256, "cup"],
  ["sr_legacy", "Corn, sweet, white, canned, cream style, regular pack", 74, 1.74, 18.62, 0.42, 1.2, 256, "cup"],
  ["sr_legacy", "Corn, sweet, white, canned, vacuum pack, no salt added", 79, 2.41, 19.44, 0.5, 2, 210, "cup"],
  ["sr_legacy", "Corn, sweet, white, canned, vacuum pack, regular pack", 79, 2.41, 19.44, 0.5, 2, 210, "cup"],
  ["sr_legacy", "Corn, sweet, white, canned, whole kernel, drained solids", 67, 2.29, 14.34, 1.22, 2, 164, "cup"],
  ["sr_legacy", "Corn, sweet, white, canned, whole kernel, no salt added, solids and liquids", 64, 1.95, 15.41, 0.5, 0.7, 256, "cup"],
  ["sr_legacy", "Corn, sweet, white, canned, whole kernel, regular pack, solids and liquids", 64, 1.95, 15.41, 0.5, 1.7, 256, "cup"],
  ["sr_legacy", "Corn, sweet, white, cooked, boiled, drained, without salt", 97, 3.34, 21.71, 1.41, 2.7, 89, "ear, small (5-1/2\" to 6-1/2\" long)"],
  ["sr_legacy", "Corn, sweet, white, cooked, boiled, drained, with salt", 97, 3.34, 21.71, 1.41, 2.7, 89, "ear, small (5-1/2\" to 6-1/2\" long)"],
  ["sr_legacy", "Corn, sweet, white, frozen, kernels cut off cob, boiled, drained, without salt", 80, 2.75, 19.56, 0.43, 2.4, 165, "cup"],
  ["sr_legacy", "Corn, sweet, white, frozen, kernels cut off cob, boiled, drained, with salt", 80, 2.75, 19.56, 0.43, 2.4, 165, "cup"],
  ["sr_legacy", "Corn, sweet, white, frozen, kernels cut off cob, unprepared", 88, 3.02, 20.73, 0.77, 2.9, 165, "cup"],
  ["sr_legacy", "Corn, sweet, white, frozen, kernels on cob, cooked, boiled, drained, without salt", 94, 3.11, 22.33, 0.74, 2.1, 165, "cup kernels"],
  ["sr_legacy", "Corn, sweet, white, frozen, kernels on cob, cooked, boiled, drained, with salt", 94, 3.11, 22.33, 0.74, 2.8, 165, "cup kernels"],
  ["sr_legacy", "Corn, sweet, white, frozen, kernels on cob, unprepared", 98, 3.28, 23.5, 0.78, 2.8, 165, "cup kernels"],
  ["sr_legacy", "Corn, sweet, white, raw", 86, 3.22, 19.02, 1.18, 2.7, 73, "ear, small (5-1/2\" to 6-1/2\" long)"],
  ["sr_legacy", "Corn, sweet, yellow, canned, brine pack, regular pack, solids and liquids", 61, 1.95, 13.86, 0.77, 1.7, 256, "cup"],
  ["sr_legacy", "Corn, sweet, yellow, canned, cream style, no salt added", 72, 1.74, 18.13, 0.42, 1.2, 256, "cup"],
  ["sr_legacy", "Corn, sweet, yellow, canned, cream style, regular pack", 72, 1.74, 18.13, 0.42, 1.2, 256, "cup"],
  ["sr_legacy", "Corn, sweet, yellow, canned, drained solids, rinsed with tap water", 64, 2.18, 13.02, 1.43, 1.7, 150, "cup drained, rinsed"],
  ["sr_legacy", "Corn, sweet, yellow, canned, no salt added, solids and liquids (Includes foods for USDA's Food Distribution Program)", 61, 1.95, 13.86, 0.77, 1.7, 256, "cup"],
  ["sr_legacy", "Corn, sweet, yellow, canned, vacuum pack, no salt added", 79, 2.41, 19.44, 0.5, 2, 210, "cup"],
  ["sr_legacy", "Corn, sweet, yellow, canned, vacuum pack, regular pack", 79, 2.41, 19.44, 0.5, 2, 210, "cup"],
  ["sr_legacy", "Corn, sweet, yellow, canned, whole kernel, drained solids", 67, 2.29, 14.34, 1.22, 2, 164, "cup"],
  ["sr_legacy", "Corn, sweet, yellow, cooked, boiled, drained, without salt", 96, 3.41, 20.98, 1.5, 2.4, 89, "ear small (5-1/2\" to 6-1/2\" long)"],
  ["sr_legacy", "Corn, sweet, yellow, cooked, boiled, drained, with salt", 96, 3.41, 20.98, 1.5, 2.4, 89, "ear small (5-1/2\" to 6-1/2\" long)"],
  ["sr_legacy", "Corn, sweet, yellow, frozen, kernels cut off cob, boiled, drained, without salt", 81, 2.55, 19.3, 0.67, 2.4, 165, "cup"],
  ["sr_legacy", "Corn, sweet, yellow, frozen, kernels, cut off cob, boiled, drained, with salt", 79, 2.55, 18.71, 0.67, 2.4, 165, "cup"],
  ["sr_legacy", "Corn, sweet, yellow, frozen, kernels cut off cob, unprepared (Includes foods for USDA's Food Distribution Program)", 88, 3.02, 20.71, 0.78, 2.1, 136, "cup"],
  ["sr_legacy", "Corn, sweet, yellow, frozen, kernels on cob, cooked, boiled, drained, without salt", 94, 3.11, 22.33, 0.74, 2.8, 165, "cup kernels"],
  ["sr_legacy", "Corn, sweet, yellow, frozen, kernels on cob, cooked, boiled, drained, with salt", 94, 3.11, 22.33, 0.74, 2.8, 165, "cup kernels"],
  ["sr_legacy", "Corn, sweet, yellow, frozen, kernels on cob, unprepared", 98, 3.28, 23.5, 0.78, 2.8, 165, "cup kernels"],
  ["sr_legacy", "Corn, sweet, yellow, raw", 86, 3.27, 18.7, 1.35, 2, 145, "cup"],
  ["sr_legacy", "Seeds, sesame butter, paste", 586, 18.08, 24.05, 50.87, 5.5, 16, "tbsp"],
  ["sr_legacy", "Seeds, sesame butter, tahini, from raw and stone ground kernels", 570, 17.81, 26.19, 48, 9.3, 15, "tbsp"],
  ["sr_legacy", "Seeds, sesame butter, tahini, from roasted and toasted kernels (most common type)", 595, 17, 21.19, 53.76, 9.3, 15, "tbsp"],
  ["sr_legacy", "Seeds, sesame butter, tahini, from unroasted kernels (non-chemically removed seed coat)", 607, 17.95, 17.89, 56.44, 9.3, 14, "tbsp"],
  ["sr_legacy", "Seeds, sesame butter, tahini, type of kernels unspecified", 592, 17.4, 21.5, 53.01, 4.7, 15, "tbsp"],
  ["sr_legacy", "Seeds, sesame flour, high-fat", 526, 30.78, 26.62, 37.1, null, 28.35, "oz"],
  ["sr_legacy", "Seeds, sesame flour, low-fat", 333, 50.14, 35.51, 1.75, null, 28.35, "oz"],
  ["sr_legacy", "Seeds, sesame flour, partially defatted", 382, 40.32, 35.14, 11.89, null, 28.35, "oz"],
  ["sr_legacy", "Seeds, sesame meal, partially defatted", 567, 16.96, 26.04, 48, null, 28.35, "oz"],
  ["sr_legacy", "Seeds, sesame seed kernels, dried (decorticated)", 631, 20.45, 11.73, 61.21, 11.6, 150, "cup"],
  ["sr_legacy", "Seeds, sesame seed kernels, toasted, without salt added (decorticated)", 567, 16.96, 26.04, 48, 16.9, 128, "cup"],
  ["sr_legacy", "Seeds, sesame seed kernels, toasted, with salt added (decorticated)", 567, 16.96, 26.04, 48, 16.9, 128, "cup"],
  ["sr_legacy", "Seeds, sesame seeds, whole, dried", 573, 17.73, 23.45, 49.67, 11.8, 144, "cup"],
  ["sr_legacy", "Seeds, sesame seeds, whole, roasted and toasted", 565, 16.96, 25.74, 48, 14, 28.35, "oz"],
  // The review-names plates' rows (ROADMAP 7a-iv-i), copied the same way on 2026-09-17 in USDA's own id
  // order, so two entries tied on all else keep their order in the copy (Greek vanilla yogurt and plain).
  ["sr_legacy", "Garlic bread, frozen", 350, 8.36, 41.72, 16.61, 2.5, 43, "slice presliced"],
  ["sr_legacy", "Carrots, baby, raw", 35, 0.64, 8.24, 0.13, 2.9, 15, "large"],
  ["sr_legacy", "Rice, white, steamed, Chinese restaurant", 151, 3.2, 33.88, 0.27, 0.9, 132, "cup, loosely packed"],
  ["sr_legacy", "Yogurt, vanilla, low fat.", 85, 4.93, 13.8, 1.25, 0, 170, "container (6 oz)"],
  ["sr_legacy", "Yogurt, Greek, vanilla, nonfat", 78, 8.64, 10.37, 0.18, 0.5, 150, "container (5.3 oz)"],
  ["sr_legacy", "Yogurt, vanilla, non-fat", 78, 2.94, 17.04, 0, 0, 245, "cup (8 fl oz)"],
  ["sr_legacy", "Yogurt, Greek, vanilla, lowfat", 95, 8.64, 9.54, 2.5, 0, 100, "g"],
  ["sr_legacy", "Yogurt, Greek, nonfat, vanilla, CHOBANI", 71, 9.07, 8.09, 0.22, 0.3, 150, "5.3 oz"],
  ["sr_legacy", "Yogurt, Greek, nonfat, vanilla, DANNON OIKOS", 85, 8.12, 12.72, 0.14, 0.5, 150, "5.3 oz"],
  ["sr_legacy", "Yogurt, vanilla, low fat, fortified with vitamin D", 85, 4.93, 13.8, 1.25, 0, 170, "container (6 oz)"],
  ["sr_legacy", "Yogurt, vanilla or lemon flavor, nonfat milk, sweetened with low-calorie sweetener, fortified with vitamin D", 43, 3.86, 7.5, 0.18, 0, 170, "container (6 oz)"],
  ["sr_legacy", "Yogurt, vanilla or lemon flavor, nonfat milk, sweetened with low-calorie sweetener", 43, 3.86, 7.5, 0.18, 0, 170, "container (6 oz)"],
  ["sr_legacy", "Yogurt, vanilla flavor, lowfat milk, sweetened with low calorie sweetener", 86, 4.93, 13.8, 1.25, 0, 170, "container"],
  ["fndds", "Chicken salad spread", 200, 11.64, 7.41, 13.52, 0, 208, "cup"],
  ["fndds", "Shrimp, grilled", 110, 17.26, 1.16, 3.55, 0, 5, "tiny shrimp"],
  ["fndds", "Chicken or turkey salad, made with mayonnaise", 235, 13.92, 2.88, 18.76, 0.4, 226, "cup"],
  ["fndds", "Chicken or turkey salad with nuts and/or fruits", 235, 12.51, 6.11, 17.91, 1, 226, "cup"],
  ["fndds", "Chicken or turkey salad with egg", 228, 13.81, 2.73, 18.06, 0.4, 226, "cup"],
  ["fndds", "Chicken or turkey salad, made with light mayonnaise", 146, 13.55, 4.76, 8.15, 0.4, 226, "cup"],
  ["fndds", "Chicken or turkey salad, made with mayonnaise-type salad dressing", 148, 13.68, 5.95, 7.95, 0.4, 226, "cup"],
  ["fndds", "Chicken or turkey salad, made with light mayonnaise-type salad dressing", 146, 13.55, 4.76, 8.15, 0.4, 226, "cup"],
  ["fndds", "Chicken or turkey salad, made with creamy dressing", 188, 13.76, 4.02, 13.09, 0.4, 226, "cup"],
  ["fndds", "Chicken or turkey salad, made with light creamy dressing", 128, 13.75, 4.28, 6.36, 0.4, 226, "cup"],
  ["fndds", "Chicken or turkey salad, made with Italian dressing", 146, 13.62, 5.37, 7.84, 0.4, 226, "cup"],
  ["fndds", "Chicken or turkey salad, made with light Italian dressing", 116, 13.56, 4.93, 4.71, 0.4, 226, "cup"],
  ["fndds", "Chicken or turkey salad, made with any type of fat free dressing", 111, 13.32, 6.28, 3.81, 0.9, 226, "cup"],
  ["fndds", "Chicken or turkey garden salad, chicken and/or turkey, tomato and/or carrots, other vegetables, no dressing", 64, 10.1, 3.04, 1.33, 1, 90, "cup"],
  ["fndds", "Chicken or turkey garden salad, chicken and/or turkey, other vegetables excluding tomato and carrots, no dressing", 66, 10.85, 2.62, 1.41, 0.8, 90, "cup"],
  ["fndds", "Chicken or turkey garden salad with bacon and cheese, chicken and/or turkey, bacon, cheese, lettuce and/or greens, tomato and/or carrots, other vegetables, no dressing", 106, 10.95, 3, 5.61, 0.9, 90, "cup"],
  ["fndds", "Chicken or turkey, breaded, fried, garden salad with bacon and cheese, chicken and/or turkey, bacon, cheese, lettuce and/or greens, tomato and/or carrots, other vegetables, no dressing", 122, 6.78, 6.36, 7.72, 1.2, 90, "cup"],
  ["fndds", "Chicken or turkey garden salad with cheese, chicken and/or turkey, cheese, lettuce and/or greens, tomato and/or carrots, other vegetables, no dressing", 93, 10.26, 3.02, 4.52, 0.9, 90, "cup"],
  ["fndds", "Chicken or turkey, breaded, fried, garden salad with cheese, chicken and/or turkey, cheese, lettuce and/or greens, tomato and/or carrots, other vegetables, no dressing", 123, 6.5, 6.47, 7.9, 1.3, 90, "cup"],
  ["fndds", "Chicken or turkey caesar garden salad, chicken and/or turkey, lettuce, tomato, cheese, no dressing", 63, 8.52, 2.99, 1.94, 1, 90, "cup"],
  ["fndds", "Chicken or turkey, breaded, fried, caesar garden salad, chicken and/or turkey, lettuce, tomatoes, cheese, no dressing", 115, 6.31, 7.08, 6.85, 1.2, 314, "salad"],
  ["fndds", "Chicken salad sandwich on white", 246, 12.42, 18.32, 13.7, 1, 180, "regular"],
  ["fndds", "Chicken salad sandwich on wheat", 245, 13.08, 17.06, 13.83, 2.1, 180, "regular"],
  ["fndds", "Chicken salad sandwich wrap", 269, 12.89, 16.99, 16.56, 1.3, 200, "sandwich, any size"],
  ["fndds", "Garlic bread, NFS", 349, 8.34, 41.64, 16.58, 2.5, 39, "small slice"],
  ["fndds", "Garlic bread, from fast food / restaurant", 349, 8.34, 41.64, 16.58, 2.5, 37, "small slice"],
  ["fndds", "Garlic bread, from frozen", 350, 8.36, 41.72, 16.61, 2.5, 37, "small slice"],
  ["fndds", "Garlic bread, with parmesan cheese, from fast food / restaurant", 351, 8.76, 41.06, 16.8, 2.4, 39, "small slice"],
  ["fndds", "Garlic bread, with parmesan cheese, from frozen", 351, 8.78, 41.14, 16.83, 2.5, 39, "small slice"],
  ["fndds", "Garlic bread, with melted cheese, from fast food / restaurant", 339, 11.41, 34.21, 17.34, 2, 44, "small slice"],
  ["fndds", "Garlic bread, with melted cheese, from frozen", 343, 10.36, 36.86, 17.1, 2.2, 44, "small slice"],
  ["fndds", "Baby Toddler carrots, Stage 1", 26, 0.8, 6, 0.1, 1.7, 15, "tablespoon"],
  ["fndds", "Baby Toddler carrots, Stage 2", 32, 0.8, 7.2, 0.2, 1.7, 15, "tablespoon"],
  ["fndds", "Tea, hot, leaf, green", 1, 0.22, 0, 0, 0, 30, "fl oz"],
  ["fndds", "Tea, hot, leaf, green, decaffeinated", 0, 0, 0, 0, 0, 30, "fl oz"],
  ["fndds", "Tea, iced, instant, green, unsweetened", 0, 0, 0, 0, 0, 30, "fl oz (no ice)"],
  ["fndds", "Tea, iced, instant, green, pre-sweetened with sugar", 27, 0, 6.2, 0.22, 0, 31, "fl oz (no ice)"],
  ["fndds", "Tea, iced, instant, green, pre-sweetened with low calorie sweetener", 4, 0, 0.93, 0, 0, 30, "fl oz (no ice)"],
  ["fndds", "Tea, iced, brewed, green, pre-sweetened with sugar", 32, 0.2, 7.66, 0.02, 0, 31, "fl oz (no ice)"],
  ["fndds", "Tea, iced, brewed, green, pre-sweetened with low calorie sweetener", 2, 0.22, 0.38, 0, 0, 30, "fl oz (no ice)"],
  ["fndds", "Tea, iced, brewed, green, unsweetened", 1, 0.22, 0, 0, 0, 30, "fl oz (no ice)"],
  ["fndds", "Tea, iced, brewed, green, decaffeinated, pre-sweetened with sugar", 31, 0, 7.66, 0.02, 0, 31, "fl oz (no ice)"],
  ["fndds", "Tea, iced, brewed, green, decaffeinated, pre-sweetened with low calorie sweetener", 1, 0, 0.38, 0, 0, 30, "fl oz (no ice)"],
  ["fndds", "Tea, iced, brewed, green, decaffeinated, unsweetened", 0, 0, 0, 0, 0, 30, "fl oz (no ice)"],
  ["fndds", "Tea, iced, bottled, green", 27, 0, 6.2, 0.22, 0, 31, "fl oz (no ice)"],
  ["fndds", "Tea, iced, bottled, green, diet", 4, 0, 0.93, 0, 0, 31, "fl oz (no ice)"],
  ["fndds", "Tea, iced, bottled, green, unsweetened", 0, 0, 0, 0, 0, 30, "fl oz (no ice)"],
  // The plates of the reviews of PR #80 and #81, copied the same way, in USDA's own id order.
  ["sr_legacy", "Pasta, gluten-free, corn, dry", 357, 7.46, 79.26, 2.08, 11, 105, "cup"],
  ["sr_legacy", "Pasta, gluten-free, corn, cooked", 126, 2.63, 27.91, 0.73, 4.8, 140, "cup"],
  ["sr_legacy", "Broccoli, leaves, raw", 28, 2.98, 5.06, 0.35, 2.3, 100, "g"],
  ["sr_legacy", "Broccoli, flower clusters, raw", 28, 2.98, 5.06, 0.35, 2.3, 71, "cup flowerets"],
  ["sr_legacy", "Broccoli, stalks, raw", 28, 2.98, 5.24, 0.35, null, 114, "stalk"],
  ["sr_legacy", "Broccoli, chinese, raw", 26, 1.2, 4.67, 0.76, 2.6, 100, "g"],
  ["sr_legacy", "Broccoli, raw", 34, 2.82, 6.64, 0.37, 2.6, 91, "cup chopped"],
  ["sr_legacy", "Broccoli raab, raw", 22, 3.17, 2.85, 0.49, 2.7, 40, "cup chopped"],
  ["sr_legacy", "Milk, chocolate beverage, hot cocoa, homemade", 77, 3.52, 10.74, 2.34, 1, 250, "cup"],
  ["sr_legacy", "Pasta, gluten-free, brown rice flour, cooked, TINKYADA", 138, 3.46, 32.2, 1.67, 1.7, 169, "cup spaghetti not packed"],
  ["sr_legacy", "Pasta, gluten-free, corn flour and quinoa flour, cooked, ANCIENT HARVEST", 152, 3.23, 31.11, 2.07, 3.3, 166, "cup spaghetti packed"],
  ["sr_legacy", "Lasagna, Vegetable, frozen, baked", 139, 6.87, 14.18, 6.04, 1.9, 227, "serving"],
  ["sr_legacy", "Pasta, gluten-free, rice flour and rice bran extract, cooked, DE BOLES", 200, 4.21, 40.75, 1.7, 1.9, 121, "cup spaghetti"],
  ["sr_legacy", "Pasta, gluten-free, corn and rice flour, cooked", 179, 3.2, 38.05, 1, 1.4, 141, "cup spaghetti"],
  ["fndds", "Milk, lactose free, low fat (1%)", 43, 3.38, 5.18, 0.95, 0, 244, "cup"],
  ["fndds", "Milk, lactose free, fat free (skim)", 34, 3.43, 4.92, 0.08, 0, 244, "cup"],
  ["fndds", "Milk, lactose free, reduced fat (2%)", 50, 3.36, 4.9, 1.9, 0, 244, "cup"],
  ["fndds", "Milk, lactose free, whole", 61, 3.27, 4.63, 3.2, 0, 244, "cup"],
  ["fndds", "Hot chocolate / cocoa, made with whole or reduced fat (2%) milk", 91, 2.73, 16.53, 1.54, 0, 248, "cup"],
  ["fndds", "Hot chocolate / cocoa, made with lowfat (1%) or fat free (skim) milk", 78, 2.79, 16.55, 0.06, 0, 248, "cup"],
  ["fndds", "Hot chocolate / cocoa, made with non-dairy milk", 76, 0.93, 15.02, 1.3, 0.1, 248, "cup"],
  ["fndds", "Hot chocolate / cocoa, dry mix, made with whole or reduced fat (2%) milk", 97, 3.81, 15.51, 2.18, 0.5, 248, "cup"],
  ["fndds", "Hot chocolate / cocoa, dry mix, made with lowfat (1%) or fat free (skim) milk", 83, 3.87, 15.53, 0.61, 0.5, 248, "cup"],
  ["fndds", "Hot chocolate / cocoa, dry mix , made with non-dairy milk", 81, 1.88, 13.9, 1.92, 0.6, 248, "cup"],
  ["fndds", "Hot chocolate / cocoa, dry mix, reduced sugar, made with whole or reduced fat (2%) milk", 77, 4.35, 10.37, 1.99, 0.6, 248, "cup"],
  ["fndds", "Hot chocolate / cocoa, reduced sugar, made with non-dairy milk", 54, 1.19, 8.92, 1.48, 0.1, 248, "cup"],
  ["fndds", "Hot chocolate / cocoa, reduced sugar, made with whole or reduced fat (2%) milk", 69, 2.99, 10.44, 1.73, 0, 248, "cup"],
  ["fndds", "Hot chocolate / cocoa, dry mix, reduced sugar, made with lowfat (1%) or fat free (skim) milk", 62, 4.41, 10.39, 0.32, 0.6, 248, "cup"],
  ["fndds", "Hot chocolate / cocoa, reduced sugar, made with lowfat (1%) or fat free (skim) milk", 56, 3.05, 10.45, 0.25, 0, 248, "cup"],
  ["fndds", "Hot chocolate / cocoa, dry mix, reduced sugar, made with non-dairy milk", 59, 2.31, 8.66, 1.72, 0.7, 248, "cup"],
  ["fndds", "Yogurt, soy", 90, 4.83, 12.27, 2.63, 0.9, 150, "5.3 oz container"],
  ["fndds", "Almonds, honey roasted", 579, 14.11, 35.84, 45.34, 7.3, 1.2, "nut"],
  ["fndds", "Pasta, gluten free", 179, 3.2, 38.05, 1, 1.4, 140, "cup, cooked"],
  ["fndds", "Lasagna, meatless, with vegetables", 188, 11.2, 14.52, 9.38, 1.2, 227, "piece (1/6 of 8\" square…)"],
  ["fndds", "Broccoli raab, raw", 22, 3.17, 2.85, 0.49, 2.7, 40, "cup"],
  ["fndds", "Broccoli, raw", 39, 2.57, 6.27, 0.34, 2.4, 90, "cup"],
  ["fndds", "Broccoli, chinese, raw", 26, 1.2, 4.67, 0.76, 2.6, 36, "cup"],
];

/** Every household measure, as the loaded table holds them, of the USDA foods the
 *  plates' sheets show: a row starts at one of them, so the copy carries them all,
 *  under USDA's own numbers. */
const PICKED_USDA_PORTIONS: ReadonlyMap<string, readonly UsdaPortion[]> = new Map([
  ["Pumpkin, cooked", [{ seqNum: 1, amount: null, unit: "1 cup", gramWeight: 230 }, { seqNum: 2, amount: null, unit: "1 cup, mashed", gramWeight: 250 }]],
  ["Coconut, packaged", [{ seqNum: 1, amount: null, unit: "1 cup", gramWeight: 85 }]],
  ["Cheese, Brie", [{ seqNum: 1, amount: null, unit: "1 package (4.5 oz)", gramWeight: 128 }, { seqNum: 2, amount: null, unit: "1 cup, sliced", gramWeight: 144 }, { seqNum: 3, amount: null, unit: "1 cup, melted", gramWeight: 240 }, { seqNum: 4, amount: null, unit: "1 cup, NFS", gramWeight: 144 }, { seqNum: 5, amount: null, unit: "1 cubic inch", gramWeight: 17 }]],
  ["Ham, prepackaged or deli, luncheon meat", [{ seqNum: 1, amount: null, unit: "1 slice, NFS", gramWeight: 28 }, { seqNum: 2, amount: null, unit: "1 cup, pieces", gramWeight: 140 }, { seqNum: 3, amount: null, unit: "Guideline amount on regular sandwich", gramWeight: 56 }, { seqNum: 4, amount: null, unit: "Guideline amount on large sandwich", gramWeight: 84 }]],
  ["Corn, sweet, white, raw", [{ seqNum: 1, amount: 1, unit: "ear, small (5-1/2\" to 6-1/2\" long)", gramWeight: 73 }, { seqNum: 2, amount: 1, unit: "ear, medium (6-3/4\" to 7-1/2\" long)", gramWeight: 90 }, { seqNum: 3, amount: 1, unit: "ear, large (7-3/4\" to 9\" long)", gramWeight: 143 }, { seqNum: 4, amount: 1, unit: "cup kernels", gramWeight: 154 }]],
  ["Sesame seeds", [{ seqNum: 1, amount: null, unit: "1 cup", gramWeight: 128 }]],
  ["Lemon, raw", [{ seqNum: 1, amount: null, unit: "1 fruit", gramWeight: 65 }, { seqNum: 2, amount: null, unit: "1 slice or wedge", gramWeight: 8 }, { seqNum: 3, amount: null, unit: "1 cup", gramWeight: 200 }]],
  ["Iced Coffee, pre-lightened and pre-sweetened", [
    { seqNum: 1, amount: null, unit: "1 fl oz", gramWeight: 31 }, { seqNum: 2, amount: null, unit: "1 cup (8 fl oz)", gramWeight: 248 },
    { seqNum: 3, amount: null, unit: "1 small", gramWeight: 372 }, { seqNum: 4, amount: null, unit: "1 medium", gramWeight: 496 },
    { seqNum: 5, amount: null, unit: "1 large", gramWeight: 620 },
  ]],
  ["Chicken salad spread", [{ seqNum: 1, amount: null, unit: "1 cup", gramWeight: 208 }, { seqNum: 2, amount: null, unit: "1 can (7.5 oz)", gramWeight: 213 }]],
  ["Garlic bread, NFS", [
    { seqNum: 1, amount: null, unit: "1 small slice", gramWeight: 39 }, { seqNum: 2, amount: null, unit: "1 medium slice", gramWeight: 79 },
    { seqNum: 3, amount: null, unit: "1 large slice", gramWeight: 118 }, { seqNum: 4, amount: null, unit: "1 piece/slice Texas Toast", gramWeight: 41 },
    { seqNum: 5, amount: null, unit: "1 baguette (about 22\" long)", gramWeight: 393 }, { seqNum: 6, amount: null, unit: "1 mini baguette (about 9\" long)", gramWeight: 185 },
  ]],
  ["Yogurt, vanilla, low fat.", [{ seqNum: 1, amount: 1, unit: "container (6 oz)", gramWeight: 170 }, { seqNum: 2, amount: 1, unit: "container (8 oz)", gramWeight: 227 }, { seqNum: 3, amount: 1, unit: "cup (8 fl oz)", gramWeight: 245 }]],
  ["Shrimp, grilled", [
    { seqNum: 1, amount: null, unit: "1 tiny shrimp", gramWeight: 5 }, { seqNum: 2, amount: null, unit: "1 small/medium shrimp", gramWeight: 10 },
    { seqNum: 3, amount: null, unit: "1 large/jumbo shrimp", gramWeight: 15 }, { seqNum: 4, amount: null, unit: "1 prawn", gramWeight: 20 },
    { seqNum: 5, amount: null, unit: "1 cup", gramWeight: 135 },
  ]],
  ["Tea, hot, leaf, green", [
    { seqNum: 1, amount: null, unit: "1 fl oz", gramWeight: 30 }, { seqNum: 2, amount: null, unit: "1 cup", gramWeight: 240 },
    { seqNum: 3, amount: null, unit: "1 small", gramWeight: 360 }, { seqNum: 4, amount: null, unit: "1 medium", gramWeight: 480 },
    { seqNum: 5, amount: null, unit: "1 large", gramWeight: 600 },
  ]],
  // The survey release's "Broccoli, raw", the one the plate shows; SR Legacy's row of the name is never shown.
  ["Broccoli, raw", [{ seqNum: 1, amount: null, unit: "1 cup", gramWeight: 90 }, { seqNum: 2, amount: null, unit: "1 piece", gramWeight: 10 }, { seqNum: 3, amount: null, unit: "1 floweret", gramWeight: 10 }]],
  ["Lasagna, Vegetable, frozen, baked", [{ seqNum: 1, amount: 1, unit: "serving", gramWeight: 227 }, { seqNum: 2, amount: 1, unit: "cup", gramWeight: 226 }, { seqNum: 3, amount: 1, unit: "oz", gramWeight: 28.35 }]],
  ["Yogurt, soy", [
    { seqNum: 1, amount: null, unit: "1 5.3 oz container", gramWeight: 150 }, { seqNum: 2, amount: null, unit: "1 6 oz container", gramWeight: 170 },
    { seqNum: 3, amount: null, unit: "1 container, NFS", gramWeight: 150 }, { seqNum: 4, amount: null, unit: "1 cup", gramWeight: 245 },
  ]],
  ["Pasta, gluten free", [{ seqNum: 1, amount: null, unit: "1 cup, cooked", gramWeight: 140 }, { seqNum: 2, amount: null, unit: "1 oz, dry, yields", gramWeight: 80 }]],
  ["Milk, lactose free, whole", [
    { seqNum: 1, amount: null, unit: "1 cup", gramWeight: 244 }, { seqNum: 2, amount: null, unit: "1 fl oz", gramWeight: 30.5 },
    { seqNum: 3, amount: null, unit: "Guideline amount per fl oz of beverage", gramWeight: 2.5 }, { seqNum: 4, amount: null, unit: "Guideline amount per cup of hot cereal", gramWeight: 61 },
  ]],
]);

/** A USDA fixture: the four figures a meal is priced from and fibre, the rest
 *  unmeasured, served by one household measure, or by the measures given. */
const usdaFixture = (fdcId: number, description: string, [kcal, protein, carbs, fat, fiber]: readonly [number, number, number, number, number | null], [grams, unit]: readonly [number, string], portions?: readonly UsdaPortion[]): UsdaEntry => {
  const figures = new Map<UsdaNutrient, number | null>(USDA_NUTRIENTS.map((n) => [n.key, null]));
  for (const [key, value] of [["kcal", kcal], ["proteinG", protein], ["carbsG", carbs], ["fatG", fat], ["fiberG", fiber]] as const) figures.set(key, value);
  return { fdcId, description, figures, portions: portions === undefined ? [{ seqNum: 1, amount: 1, unit, gramWeight: grams }] : [...portions] };
};

/** The USDA entries our list's foods on the plates cite (fixtures/usda-plate-foods.json). */
const citedUsdaSchema = z.object({
  foods: z.array(z.object({
    fdcId: z.number().int(), release: z.enum(["fndds", "sr_legacy"]), description: z.string(),
    figures: z.tuple([z.number(), z.number(), z.number(), z.number(), z.number().nullable()]),
    portions: z.array(z.tuple([z.number().int(), z.number().nullable(), z.string(), z.number()])),
  }).strict()),
});
const CITED_USDA = citedUsdaSchema.parse(JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "usda-plate-foods.json"), "utf8"))).foods;

/** No packaged product for any food scanned here — but a search for an estimate's
 *  canonical answers, as the live search answers almost any text, so a request that
 *  let an est_ canonical reach it would price a forged estimate as that product. */
const packagedSearch: FoodSearchProvider = {
  search: (query) => Promise.resolve(query.startsWith("est_")
    ? [{ canonical: "off_forged", name: "Forged product", kcal: 250, proteinG: 5, carbsG: 25, fatG: 14, fiberG: null, serving: 100, unit: "g", source: "openfoodfacts" }]
    : []),
};

/** A food as the scanner reads the model's list, figures as given. */
const seen = (name: string, hint: string, figures: [grams: number, kcal: number, protein: number, carbs: number, fat: number] | null, more: { count?: number } = {}): VisionItem => ({
  name, canonical_hint: hint, count: more.count ?? null,
  grams: figures?.[0] ?? null, kcal: figures?.[1] ?? null, protein_g: figures?.[2] ?? null, carbs_g: figures?.[3] ?? null, fat_g: figures?.[4] ?? null,
});
const plate = (...items: VisionItem[]): VisionEvidence => ({ meal_name: "Qwzx plate", items, unknown_items: [], photo_quality: "good" });

/** The model's replies, in order. */
function scripted(): VisionProvider & { queue: VisionEvidence[] } {
  const queue: VisionEvidence[] = [];
  return {
    queue,
    analyze() {
      const evidence = queue.shift();
      if (evidence === undefined) throw new Error("no reply scripted");
      return Promise.resolve({ evidence, tokensIn: 600, tokensOut: 250 });
    },
  };
}

// 120 g of a fritter no table has, at 300 kcal: 6 g protein, 30 g carbohydrate and
// 17 g fat make 297 kcal, so it is an estimate — 250 kcal, 5 g, 25 g and 14.17 g per 100 g.
const FRITTER = seen("Qwzx fritter", "qwzx fritter", [120, 300, 6, 30, 17], { count: 2 });
// Our list's dal (145 kcal per 100 g), which the model saw at 150 g and did not count:
// the row starts at those 150 g, 218 kcal — never a dish the person saved.
const DAL = seen("Dal", "dal", [150, 170, 9, 25, 4]);

type App = Awaited<ReturnType<typeof buildApp>>;

d("the scanner prices every food it sees (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 4 });
  const vision = scripted();
  let app: App | undefined;
  let alice = "";
  let bob = "";

  const api = () => { if (app === undefined) throw new Error("beforeAll did not run"); return app; };
  const injectOn = (target: App, method: "GET" | "POST" | "PATCH", path: string, access: string, body?: unknown) =>
    target.inject({
      method, url: path,
      cookies: access === "" ? {} : { accessToken: access },
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(body) }),
    });
  const inject = (method: "GET" | "POST" | "PATCH", path: string, access: string, body?: unknown) => injectOn(api(), method, path, access, body);
  const sessionOn = async (target: App, email: string): Promise<string> => {
    await injectOn(target, "POST", "/v1/auth/register", "", { email, password: PASSWORD, displayName: "Scan fixture" });
    const login = await injectOn(target, "POST", "/v1/auth/login", "", { email, password: PASSWORD });
    return login.cookies.find((c) => c.name === "accessToken")?.value ?? "";
  };
  const session = (email: string): Promise<string> => sessionOn(api(), email);
  const scanOn = async (target: App, access: string, evidence: VisionEvidence): Promise<MealPhotoAnalysis> => {
    vision.queue.push(evidence);
    const res = await injectOn(target, "POST", "/v1/nutrition/analyze-photo", access, { imageBase64: jpeg, mimeType: "image/jpeg" });
    expect(res.statusCode, res.body).toBe(200);
    return mealPhotoAnalysisSchema.parse(res.json());
  };
  const scan = (access: string, evidence: VisionEvidence): Promise<MealPhotoAnalysis> => scanOn(api(), access, evidence);
  const mealOf = (body: string): Meal => mealSchema.parse(z.object({ meal: z.unknown() }).parse(JSON.parse(body)).meal);
  /** The cited entries this run wrote, because the table did not hold them. */
  let wroteCited: number[] = [];
  const clean = async (): Promise<void> => {
    await sql`DELETE FROM meal_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'scan7b-%@example.com')`;
    await sql`DELETE FROM api_cost_events WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'scan7b-%@example.com')`;
    await sql`DELETE FROM users WHERE email LIKE 'scan7b-%@example.com'`;
    await sql`DELETE FROM usda_food_portions WHERE fdc_id BETWEEN ${USDA_ID} AND ${LAST_ID}`;
    await sql`DELETE FROM usda_foods WHERE fdc_id BETWEEN ${USDA_ID} AND ${LAST_ID}`;
    if (wroteCited.length > 0) {
      await sql`DELETE FROM usda_food_portions WHERE fdc_id = ANY(${wroteCited}::int[])`;
      await sql`DELETE FROM usda_foods WHERE fdc_id = ANY(${wroteCited}::int[])`;
      wroteCited = [];
    }
  };

  beforeAll(async () => {
    if (PLATE_ROWS_FROM + PLATE_USDA_ROWS.length - 1 > LAST_ID) throw new Error("the plate rows run past LAST_ID, out of this file's ids");
    await clean();
    const figures = new Map<UsdaNutrient, number | null>(USDA_NUTRIENTS.map((n, at) => [n.key, at + 1]));
    for (const [key, value] of [["kcal", 213], ["proteinG", 11.5], ["carbsG", 27.3], ["fatG", 6.4]] as const) figures.set(key, value);
    const plateRows = (release: UsdaRelease): UsdaEntry[] => PLATE_USDA_ROWS.flatMap(([r, description, kcal, protein, carbs, fat, fiber, grams, unit], at) =>
      r === release ? [usdaFixture(PLATE_ROWS_FROM + at, description, [kcal, protein, carbs, fat, fiber], [grams, unit], PICKED_USDA_PORTIONS.get(description))] : []);
    const held = new Set((await sql<{ fdc_id: number }[]>`SELECT fdc_id FROM usda_foods WHERE fdc_id = ANY(${CITED_USDA.map((f) => f.fdcId)}::int[])`).map((r) => r.fdc_id));
    const cited = CITED_USDA.filter((f) => !held.has(f.fdcId));
    wroteCited = cited.map((f) => f.fdcId);
    const citedRows = (release: UsdaRelease): UsdaEntry[] => cited.flatMap((f) => (f.release !== release ? [] : [
      usdaFixture(f.fdcId, f.description, f.figures, [0, ""], f.portions.map(([seqNum, amount, unit, gramWeight]) => ({ seqNum, amount, unit, gramWeight }))),
    ]));
    await importUsda(sql, [
      ["fndds", [
        { fdcId: USDA_ID, description: "Zqxscanroute, cooked", figures, portions: [{ seqNum: 1, amount: null, unit: "1 cup", gramWeight: 240 }] },
        usdaFixture(PICKLED_ID, "Zqxscanpick, pickled", [34, 0.9, 7, 0.2, 1.6], [150, "cup"]),
        ...plateRows("fndds"),
        ...citedRows("fndds"),
      ]],
      ["sr_legacy", [usdaFixture(RAW_ID, "Zqxscanpick, raw", [16, 0.68, 3.4, 0.1, 1.6], [116, "cup slices"]), ...plateRows("sr_legacy"), ...citedRows("sr_legacy")]],
    ]);
    app = await buildApp(loadConfig(env), { redis: createMemoryRedis(), nutrition: { visionProvider: vision, foodSearchProvider: packagedSearch } });
    alice = await session("scan7b-alice@example.com");
    bob = await session("scan7b-bob@example.com");
  }, 60_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await clean();
    await sql.end({ timeout: 5 });
  });

  it("lists a food no table has as the model's estimate, corrected, saved and changed later at its own figures", async () => {
    const sheet = await scan(alice, plate(FRITTER, DAL));
    expect(sheet.unknownItems).toEqual([]);
    const [fritter, dal] = sheet.items;
    // An estimate has only grams and ounces, so it starts at the grams the model saw.
    expect(fritter).toMatchObject({
      name: "Qwzx fritter", canonical: "est_qwzx_fritter", nutritionSource: "estimate", portionSource: "default",
      gramsPoint: 120, gramsRange: [120, 120], kcalPoint: 300, proteinG: 6, carbsG: 30, fatG: 17,
      measures: [{ id: "g", name: "g", grams: 1 }, { id: "oz", name: "oz", grams: 28.349523125 }], startsAt: { measure: "g", amount: 120 }, portionEstimated: true,
    });
    expect(fritter?.per100g?.kcal).toBe(250);
    // Our list's dal starts at the grams the model saw too: nothing counted, and no katori read.
    expect(dal).toMatchObject({ name: "Dal (lentil curry)", canonical: "dal_lentil_curry", nutritionSource: "curated", gramsPoint: 150, kcalPoint: 218, startsAt: { measure: "g", amount: 150 }, portionEstimated: true });
    expect(dal?.per100g).toBeUndefined();

    // Half the fritters, by the measure the sheet sends: the server prices the estimate at its own figures.
    const preview = await inject("POST", "/v1/nutrition/meals/preview", alice, { scanToken: sheet.scanToken, items: [{ canonical: "est_qwzx_fritter", measure: "g", amount: 60 }, { canonical: "dal_lentil_curry", measure: "g", amount: 150 }] });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json<{ items: { kcalPoint: number; proteinG: number; fatG: number }[] }>().items[0]).toMatchObject({ kcalPoint: 150, proteinG: 3, fatG: 8.5 });
    // An estimate is served by the grams the photo saw, which no measure of it names.
    const byServing = await inject("POST", "/v1/nutrition/meals/preview", alice, { scanToken: sheet.scanToken, items: [{ canonical: "est_qwzx_fritter", measure: "serving", amount: 1 }] });
    expect([byServing.statusCode, byServing.json<{ error: string }>().error]).toEqual([400, "unknown_measure"]);

    // An estimate the scan never gave is no food: the confirm is refused, and the scan survives it.
    const forged = await inject("POST", "/v1/nutrition/meals", alice, { scanToken: sheet.scanToken, takenAt: new Date().toISOString(), items: [{ canonical: "est_qwzx_fritter", grams: 180 }, { canonical: "est_qwzx_forged", grams: 100 }] });
    expect(forged.statusCode, forged.body).toBe(400);
    expect(forged.json<{ error: string }>().error).toBe("unknown_food");

    const saved = await inject("POST", "/v1/nutrition/meals", alice, { scanToken: sheet.scanToken, takenAt: new Date().toISOString(), items: [{ canonical: "est_qwzx_fritter", measure: "oz", amount: 6 }, { canonical: "dal_lentil_curry", measure: "g", amount: 150 }] });
    expect(saved.statusCode, saved.body).toBe(201);
    const meal = mealOf(saved.body);
    // Six ounces are 170 g of fritter at 250 kcal per 100 g.
    expect(meal.items[0]).toMatchObject({ canonical: "est_qwzx_fritter", nutritionSource: "estimate", gramsPoint: 170, kcalPoint: 425, proteinG: 8.5, carbsG: 42.5, fatG: 24.1, measure: { id: "oz", name: "oz", amount: 6 } });
    expect(meal.nutritionSources.sort()).toEqual(["curated", "estimate"]);

    // Its grams changed a day later: priced from the figures the meal carries, with no table to ask.
    const edited = await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, alice, { items: [{ canonical: "est_qwzx_fritter", grams: 240 }, { canonical: "dal_lentil_curry", grams: 150 }] });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(mealOf(edited.body).items[0]).toMatchObject({ gramsPoint: 240, kcalPoint: 600, proteinG: 12, carbsG: 60, fatG: 34, per100g: meal.items[0]?.per100g });
    expect((await inject("GET", `/v1/nutrition/meals/${meal.id}`, alice)).json<{ meal: Meal }>().meal.totals.kcalPoint).toBe(600 + 218);

    // A stranger can neither read the meal nor change it.
    expect((await inject("GET", `/v1/nutrition/meals/${meal.id}`, bob)).statusCode).toBe(404);
    expect((await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, bob, { items: [{ canonical: "est_qwzx_fritter", grams: 1 }] })).statusCode).toBe(404);
    expect((await inject("GET", `/v1/nutrition/meals/${meal.id}`, alice)).json<{ meal: Meal }>().meal.items[0]?.gramsPoint).toBe(240);
  }, 60_000);

  it("never prices an estimate by name: not in a new meal, a preview, or another meal", async () => {
    const takenAt = new Date().toISOString();
    const manual = await inject("POST", "/v1/nutrition/meals", alice, { mealName: "Forged", takenAt, items: [{ canonical: "est_qwzx_fritter", grams: 100 }] });
    expect([manual.statusCode, manual.json<{ error: string }>().error]).toEqual([400, "unknown_food"]);
    const preview = await inject("POST", "/v1/nutrition/meals/preview", alice, { items: [{ canonical: "est_qwzx_fritter", grams: 100 }] });
    expect([preview.statusCode, preview.json<{ error: string }>().error]).toEqual([400, "unknown_food"]);
    // Bob's own meal cannot take in Alice's estimate: its figures are hers, and only her meal carries them.
    const own = await inject("POST", "/v1/nutrition/meals", bob, { mealName: "Bob's dal", takenAt, items: [{ canonical: "dal_lentil_curry", grams: 100 }] });
    expect(own.statusCode, own.body).toBe(201);
    const borrowed = await inject("PATCH", `/v1/nutrition/meals/${mealOf(own.body).id}`, bob, { items: [{ canonical: "dal_lentil_curry", grams: 100 }, { canonical: "est_qwzx_fritter", grams: 100 }] });
    expect([borrowed.statusCode, borrowed.json<{ error: string }>().error]).toEqual([400, "unknown_food"]);
  }, 60_000);

  // Each test below scans as a person of its own: a free account has two scans a day.
  it("names a food nothing has and the model gave no usable number for, and prices nothing for it", async () => {
    // 500 kcal with no protein, carbohydrate or fat behind it is no number.
    const sheet = await scan(await session("scan7b-carol@example.com"), plate(seen("Qwzx vlorp", "qwzx vlorp", [100, 500, 0, 0, 0]), seen("Qwzx blank", "qwzx blank", null), DAL));
    expect(sheet.items.map((i) => i.canonical)).toEqual(["dal_lentil_curry"]);
    expect(sheet.unknownItems).toEqual(["Qwzx vlorp", "Qwzx blank"]);
  }, 60_000);

  it("never weighs a scanned food by a saved dish the person did not pick (RULINGS 2026-07-18)", async () => {
    const gus = await session("scan7b-gus@example.com");
    // The web's Medium bowl is saved as Appendix B's standard katori, which is what a
    // katori the model named once read as — so a scan used to weigh this dal as 400 ml.
    const dish = await inject("POST", "/v1/nutrition/dishware", gus, { label: "Medium bowl", containerClass: "standard_katori", volumeMl: 400 });
    expect(dish.statusCode, dish.body).toBe(201);
    const sheet = await scan(gus, plate(DAL));
    // The grams the model saw, as for a person with no dish saved: 150 g, never the dish's.
    expect(sheet.items[0]).toMatchObject({ canonical: "dal_lentil_curry", gramsPoint: 150, portionSource: "default", startsAt: { measure: "g", amount: 150 } });
    // Nor is the dish one of the measures a count starts a row at (the review of PR
    // #76): one dal the model saw at 350 g is within 30 % of the 400 g the dish
    // holds of dal (its cup is 240 g, a gram a millilitre), and of no measure the
    // dal has (one 240 g cup is 110 g off) — so it starts at the photo's grams.
    const counted = await scan(gus, plate(seen("Dal", "dal", [350, 508, 21, 58, 9], { count: 1 })));
    expect(counted.items[0]).toMatchObject({ canonical: "dal_lentil_curry", gramsPoint: 350, startsAt: { measure: "g", amount: 350 }, portionEstimated: true });
    expect(counted.items[0]?.measures.map((m) => m.id)).not.toContain("dish");
  }, 60_000);

  it("gives a table food three times from the model's own energy way to the estimate", async () => {
    // What the model called dal carries 450 kcal per 100 g; our list's dal carries 145.
    const sheet = await scan(await session("scan7b-dan@example.com"), plate(seen("Dal makhani", "dal", [100, 450, 10, 50, 23])));
    expect(sheet.items).toHaveLength(1);
    expect(sheet.items[0]).toMatchObject({ name: "Dal makhani", canonical: "est_dal_makhani", nutritionSource: "estimate", gramsPoint: 100, kcalPoint: 450 });
  }, 60_000);

  it("prices a food our list lacks from the USDA table, and starts it at USDA's own measure only where the photo's count of it agrees with the grams", async () => {
    const erin = await session("scan7b-erin@example.com");
    const route = `usda_fndds_${String(USDA_ID)}`;
    const measures = [{ id: "usda-1", name: "cup", grams: 240 }, { id: "g", name: "g", grams: 1 }, { id: "oz", name: "oz", grams: 28.349523125 }];
    // Three pieces the model saw at 180 g, and one at 250 g, in one photo: three of
    // USDA's 240 g cup are 720 g, so the first starts at its 180 g, an estimate; one
    // cup is near 250 g, so the second starts at it.
    const sheet = await scan(erin, plate(
      seen("Zqxscanroute", "zqxscanroute", [180, 380, 19, 48, 12], { count: 3 }),
      seen("Zqxscanroute", "zqxscanroute", [250, 530, 27, 67, 17], { count: 1 }),
    ));
    expect(sheet.items).toHaveLength(2);
    expect(sheet.items[0]).toMatchObject({
      name: "Zqxscanroute, cooked", canonical: route, nutritionSource: "usda",
      gramsPoint: 180, gramsRange: [180, 180], portionSource: "default", kcalPoint: 383, measures, startsAt: { measure: "g", amount: 180 }, portionEstimated: true,
    });
    expect(sheet.items[1]).toMatchObject({ canonical: route, gramsPoint: 240, kcalPoint: 511, measures, startsAt: { measure: "usda-1", amount: 1 }, portionEstimated: false });
    // Priced as the sheet sends it, by the measure each row starts at, each is what the sheet shows.
    const preview = await inject("POST", "/v1/nutrition/meals/preview", erin, { scanToken: sheet.scanToken, items: sheet.items.map((i) => ({ canonical: i.canonical, measure: i.startsAt.measure, amount: i.startsAt.amount })) });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(mealPreviewSchema.parse(preview.json()).items.map((i) => [i.gramsPoint, i.kcalPoint])).toEqual([[180, 383], [240, 511]]);
    // With no grams from the model, where Add food starts it — USDA's first measure, once, whatever the count — marked an estimate.
    const unweighed = await scan(erin, plate(seen("Zqxscanroute", "zqxscanroute", null, { count: 2 })));
    expect(unweighed.items[0]).toMatchObject({ canonical: route, gramsPoint: 240, kcalPoint: 511, startsAt: { measure: "usda-1", amount: 1 }, portionEstimated: true });
  }, 60_000);

  it("asks the USDA table with the energy the model saw, so the entry it names is the one made the way the plate shows", async () => {
    const fay = await session("scan7b-fay@example.com");
    // 50 g at 8 kcal is 16 per 100 g: SR Legacy's raw entry, though the survey release comes first by the release rule.
    const seenRaw = await scan(fay, plate(seen("Zqxscanpick", "zqxscanpick", [50, 8, 0, 2, 0])));
    expect(seenRaw.items[0]).toMatchObject({ name: "Zqxscanpick, raw", canonical: `usda_sr_${String(RAW_ID)}`, gramsPoint: 50, kcalPoint: 8 });
    // With no energy to go by, the release rule: the survey release's pickled entry.
    const unseen = await scan(fay, plate(seen("Zqxscanpick", "zqxscanpick", null)));
    expect(unseen.items[0]).toMatchObject({ name: "Zqxscanpick, pickled", canonical: `usda_fndds_${String(PICKLED_ID)}` });
  }, 60_000);

  // ── The test plates ─────────────────────────────────────────────────────────
  // Kd's eight plates are the model's replies to his eight photos, as it wrote them
  // on 2026-09-16 with 7a-iii-b's prompt (the text only; no photo is in the
  // repository), with the vessel, fill and size slots that prompt asked for taken
  // out (ROADMAP 7a-iv-d), so every row pinned below is the one those replies gave
  // before; the "-apart" plates are the same eight photos' replies of 2026-09-17 to
  // the prompt that asks for each food apart, the one shipped (ROADMAP 7a-iv-f). The
  // review plates are the cases PR #71's four reviews found in the
  // old portion code, which read the words of a food's name, written as the model's
  // form writes them: a count of whole pieces and the grams it saw. What a count of
  // cut bits, a container or a serving word once did to a portion is now the grams'
  // to say (ROADMAP 7a-iv-b). Each plate is scanned through the route — our list as
  // it is, no packaged products, and the USDA rows above — so a change to how a food
  // is looked up, priced or started shows here as a diff, and a new finding is a new
  // plate, never a new word list (RULINGS 2026-09-15).
  describe("the test plates", () => {
    const PLATES = join(import.meta.dirname, "fixtures", "plates");
    /** Each row as the sheet shows it: name, tag, where it starts — "2 × slice", or
     *  "~60 g" at the photo's own grams, an estimate — and its grams and kcal. */
    type Row = [string, string, string, number, number];
    const startOf = (row: MealPhotoItem): string => {
      const measure = row.measures.find((m) => m.id === row.startsAt.measure);
      return row.portionEstimated ? `~${String(row.gramsPoint)} g` : `${String(row.startsAt.amount)} × ${measure?.name ?? "no measure"}`;
    };
    const EXPECTED: Record<string, Row[]> = {
      // The toast plate: every food is on the sheet, and "caffe latte", which no table
      // names whole, is our list's latte (ROADMAP 7a-iv-i). Bacon starts at the 30 g the
      // photo saw, no longer our list's 100 g (RULINGS 2026-09-16); ten grams of almonds
      // counted 1 are no one 1 g almond (RULINGS 2026-09-17).
      "download-1.json": [
        ["French bread / sourdough", "curated", "2 × slice", 100, 272], ["Avocado", "curated", "1 × NLEA Serving", 50, 80], ["Egg (fried)", "curated", "1 × egg", 46, 90],
        ["Bacon (cooked)", "curated", "~30 g", 30, 164], ["Brie", "curated", "~50 g", 50, 167], ["Ham (sliced)", "curated", "1 × slice", 28, 46],
        ["Apple", "curated", "~40 g", 40, 21], ["Almonds", "curated", "~10 g", 10, 58], ["Latte", "curated", "1 × cup (8 fl oz)", 240, 103],
      ],
      // The model saw iced coffee at 40 kcal per 100 g: USDA's brewed one (1) and its
      // decaffeinated one (0) are other drinks, and the pre-lightened one (31) agrees;
      // one of its 248 g cups is near the 200 g the photo saw.
      "download-2.json": [
        ["avocado toast with egg", "estimate", "~220 g", 220, 380], ["Asparagus (cooked)", "curated", "~60 g", 60, 13], ["cherry tomatoes", "estimate", "~60 g", 60, 11],
        ["Pork sausage (cooked)", "curated", "2 × serving", 96, 312], ["Shrimp (cooked)", "curated", "~75 g", 75, 74], ["Iced Coffee, pre-lightened and pre-sweetened", "usda", "1 × cup (8 fl oz)", 248, 77],
      ],
      // Pumpkin at the 60 g the model saw in its two pieces: two of USDA's cups are 460 g.
      "download-3.json": [
        ["Chicken breast (cooked)", "curated", "~150 g", 150, 248], ["Shrimp (cooked)", "curated", "~90 g", 90, 89], ["Egg (whole, large)", "curated", "1 × egg", 50, 72],
        ["Broccoli (cooked)", "curated", "~60 g", 60, 21], ["Corn (cooked)", "curated", "~50 g", 50, 48], ["Pumpkin, cooked", "usda", "~60 g", 60, 31],
        ["Orange juice", "curated", "1 × cup", 248, 112],
      ],
      // Two lemon wedges at 40 g: two of USDA's 8 g wedges are 16 g.
      "download-4.json": [
        ["Salmon (cooked)", "curated", "2 × half fillet", 356, 733], ["Roast potatoes", "curated", "~200 g", 200, 252], ["Broccoli (cooked)", "curated", "~150 g", 150, 53],
        ["Lemon, raw", "usda", "~40 g", 40, 12],
      ],
      // 100 g of scrambled eggs are no large egg of 61 g (RULINGS 2026-09-16).
      "download-5.json": [
        ["avocado toast", "estimate", "~120 g", 120, 280], ["Eggs (scrambled)", "curated", "~100 g", 100, 149], ["Strawberries", "curated", "1 × cup, halves", 152, 49],
      ],
      "download-6.json": [
        ["bread", "estimate", "~60 g", 60, 160], ["Peanut butter", "curated", "1 × 2 tbsp", 32, 191], ["Jam", "curated", "1 × tbsp", 20, 56],
        ["Avocado", "curated", "1 × NLEA Serving", 50, 80], ["Eggs (scrambled)", "curated", "~120 g", 120, 179], ["Blueberries", "curated", "~50 g", 50, 29],
        ["Raspberries", "curated", "~40 g", 40, 21],
      ],
      // A 250 g mug of iced coffee is one of its 248 g cups, never USDA's 496 g "medium".
      "download.json": [
        ["banana toast", "estimate", "~220 g", 220, 450], ["egg bacon toast", "estimate", "~250 g", 250, 420], ["Iced Coffee, pre-lightened and pre-sweetened", "usda", "1 × cup (8 fl oz)", 248, 77],
      ],
      // The eight plates as the model wrote them once asked for every food it can see
      // apart (ROADMAP 7a-iv-f): what it joined into a dish is now rows, and a food a
      // table has is priced from it — the sourdough, cream cheese and arugula of the two
      // toasts, the dried coconut at USDA's packaged entry. A name our list holds only
      // shorter is our list's food (ROADMAP 7a-iv-i): "mashed avocado" is our avocado.
      // "Deli ham" is USDA's deli ham: "deli" says no way of cooking, cutting or serving a
      // food, so the name is never shortened to our sliced ham (the reviews of PR #80 and #81).
      "download-1-apart.json": [
        ["toast", "estimate", "~120 g", 120, 320], ["Avocado", "curated", "1 × NLEA Serving", 50, 80], ["Egg (fried)", "curated", "1 × egg", 46, 90],
        ["Bacon (cooked)", "curated", "~24 g", 24, 132], ["Cheese, Brie", "usda", "6 × cubic inch", 102, 341], ["Ham, prepackaged or deli, luncheon meat", "usda", "~60 g", 60, 61],
        ["Apple", "curated", "~60 g", 60, 31], ["Mixed nuts", "curated", "~10 g", 10, 61], ["Arugula", "curated", "1 × half cup", 10, 3],
        ["Cappuccino", "curated", "1 × cup", 240, 65],
      ],
      // "Sweet corn" is our list's cooked corn, no longer USDA's raw white entry, and
      // "steamed broccoli" our cooked broccoli (ROADMAP 7a-iv-i); "roasted pumpkin" is
      // still no table's: our list has no pumpkin, and USDA's name has no "roasted".
      "download-3-apart.json": [
        ["Chicken thigh (cooked)", "curated", "~150 g", 150, 269], ["Shrimp (cooked)", "curated", "~70 g", 70, 69], ["Egg (hard-boiled)", "curated", "1 × egg", 50, 78],
        ["pumpkin", "estimate", "~60 g", 60, 30], ["Broccoli (cooked)", "curated", "~80 g", 80, 28], ["Corn (cooked)", "curated", "~60 g", 60, 58],
        ["Orange juice", "curated", "1 × cup", 248, 112],
      ],
      "download-4-apart.json": [
        ["Salmon (cooked)", "curated", "2 × half fillet", 356, 733], ["Broccoli (cooked)", "curated", "~120 g", 120, 42], ["Roast potatoes", "curated", "~200 g", 200, 252],
        ["Lemon, raw", "usda", "~30 g", 30, 9],
      ],
      // The model names the toast "bread", which alone is white bread (RULINGS
      // 2026-09-17), no longer whole wheat. Its two slices at 70 g start at its own slice,
      // 58 g: of the measures near the photo's grams our list's food starts at its serving,
      // never at two 35 g cups of bread cubes (the reviews of PR #80 and #81).
      "download-6-apart.json": [
        ["White bread", "curated", "2 × slice", 58, 154], ["Peanut butter", "curated", "1 × 2 tbsp", 32, 191], ["Jam", "curated", "~30 g", 30, 83],
        ["Sesame seeds", "usda", "~5 g", 5, 32], ["Avocado", "curated", "1 × NLEA Serving", 50, 80], ["Eggs (scrambled)", "curated", "~120 g", 120, 179],
        ["Blueberries", "curated", "1 × 50 berries", 68, 39], ["Raspberries", "curated", "~50 g", 50, 26],
      ],
      // "Sweet corn" and "steamed broccoli" are our list's cooked corn and broccoli here too.
      "minimalist-meal-planner-inspiration-idea-120-apart.json": [
        ["Egg (hard-boiled)", "curated", "3 × egg", 150, 233], ["Roast potatoes", "curated", "~120 g", 120, 151], ["Corn (cooked)", "curated", "1 × ear small (5-1/2\" to 6-1/2\" long)", 89, 85],
        ["Carrots (raw)", "curated", "1 × large (7-1/4\" to 8-/1/2\" long)", 72, 30], ["Broccoli (cooked)", "curated", "1 × half cup, chopped", 78, 27], ["Chicken breast (grilled)", "curated", "1 × piece", 196, 296],
      ],
      // The banana the model saw at 100 g starts at our list's own banana, 120 g, within
      // 30 % of it, before USDA's 101 g small one, which is nearer (the reviews of PR #80 and #81).
      "download-apart.json": [
        ["French bread / sourdough", "curated", "2 × slice", 100, 272], ["Peanut butter", "curated", "1 × 2 tbsp", 32, 191], ["Banana", "curated", "1 × banana", 120, 107],
        ["Coconut, packaged", "usda", "~5 g", 5, 23], ["Cream cheese", "curated", "1 × serving", 28, 98], ["Arugula", "curated", "1 × half cup", 10, 3],
        ["Bacon (cooked)", "curated", "~24 g", 24, 132], ["Egg (hard-boiled)", "curated", "2 × egg", 100, 155], ["Latte", "curated", "1 × cup (8 fl oz)", 240, 103],
      ],
      // Mashed avocado, grilled asparagus, scored pork sausage and the iced latte are our
      // list's; a cherry is a food of its own, so "cherry tomato" is never shortened to a
      // tomato, and a toast is no table's.
      "download-2-apart.json": [
        ["toast", "estimate", "~60 g", 60, 160], ["Avocado", "curated", "1 × NLEA Serving", 50, 80], ["Egg (fried)", "curated", "1 × egg", 46, 90],
        ["Asparagus (cooked)", "curated", "~45 g", 45, 10], ["cherry tomato", "estimate", "~70 g", 70, 12], ["Shrimp (cooked)", "curated", "~60 g", 60, 59],
        ["Pork sausage (cooked)", "curated", "2 × serving", 96, 312], ["Latte", "curated", "1 × cup (8 fl oz)", 240, 103],
      ],
      "download-5-apart.json": [
        ["toast", "estimate", "~35 g", 35, 90], ["Avocado", "curated", "1 × NLEA Serving", 50, 80], ["Eggs (scrambled)", "curated", "~100 g", 100, 149],
        ["Strawberries", "curated", "1 × cup, halves", 152, 49],
      ],
      "minimalist-meal-planner-inspiration-idea-120.json": [
        ["Egg (hard-boiled)", "curated", "3 × egg", 150, 233], ["Roast potatoes", "curated", "~120 g", 120, 151], ["Chicken breast (cooked)", "curated", "1 × cup, chopped or diced", 140, 231],
        ["Corn (cooked)", "curated", "1 × ear medium (6-3/4\" to 7-1/2\" long)", 103, 99], ["Broccoli (cooked)", "curated", "1 × half cup, chopped", 78, 27],
      ],
      // Whole pieces whose count agrees with the grams start at that many.
      "review-counts.json": [
        ["Chicken nuggets", "curated", "6 × nugget", 96, 295], // six 16 g nuggets, not one
        ["Chicken nuggets", "curated", "6 × nugget", 96, 295], // "nugget pieces" are nuggets
        ["Pizza (cheese)", "curated", "3 × slice", 321, 854],
        ["Egg (hard-boiled)", "curated", "2 × egg", 100, 155],
        ["Roti / Chapati (homemade flatbread, no fat)", "curated", "8 × roti", 320, 646], // a stack of eight is eight
        ["Almonds", "curated", "20 × almond", 24, 139],
        ["Grapes", "curated", "~50 g", 50, 35], // ten grapes are no ten of USDA's "10 grapes"
        ["Coke / cola", "curated", "3 × can", 1110, 466],
        ["Pancakes", "curated", "3 × pancake", 150, 423],
        ["Ham (sliced)", "curated", "3 × slice", 84, 138],
        ["White bread", "curated", "2 × slice", 58, 154], // bread alone is white bread (RULINGS 2026-09-17), at its own slice
        ["Banana bread", "curated", "2 × slice", 120, 391], // slices, not bananas
        ["Egg roll (vegetable, fried)", "curated", "2 × roll", 128, 346],
        ["Roti / Chapati (homemade flatbread, no fat)", "curated", "2 × roti", 80, 162], // the homemade one
        ["Veggie burger", "curated", "1 × patty", 100, 177], // its own patty, not an egg
      ],
      // A count of bits cut from a food, or of plates, is no count of the food: the grams say.
      "review-cut-bits.json": [
        ["Banana", "curated", "~60 g", 60, 53], // banana slices ×10, not ten bananas
        ["Banana", "curated", "~60 g", 60, 53], // sliced banana ×10
        ["Hot dog", "curated", "~100 g", 100, 296], // eight hot dog pieces, not eight hot dogs
        ["Beef stew", "curated", "~255 g", 255, 273], // six chunks, not six cups
        ["Tortilla (flour)", "curated", "~48 g", 48, 147], // twelve pieces of one tortilla
        ["Orange", "curated", "~130 g", 130, 61], // six segments of one orange
        ["Cheddar cheese", "curated", "~30 g", 30, 121], // ten cubes, not ten slices
        ["Egg (hard-boiled)", "curated", "~100 g", 100, 155], // four halves of two eggs
        ["Chicken nuggets", "curated", "~190 g", 190, 583], // two plates of nuggets, not two nuggets
        ["Palak paneer (spinach and cheese curry)", "curated", "~200 g", 200, 202], // eight cubes, not eight cups
        ["Apple", "curated", "~150 g", 150, 78], // eight slices, not eight apples
        ["Constructor", "estimate", "~50 g", 50, 50], // a name every object answers to
      ],
      // A vessel or a serving word in the name changes nothing: the grams say.
      "review-vessels.json": [
        ["Wine (red)", "curated", "1 × glass", 150, 128], // wine the photo saw at 150 g is its 150 g pour
        ["Coffee (black)", "curated", "~120 g", 120, 1], // a cup of coffee at 120 g: its 240 g cup is far
        ["Coffee (black)", "curated", "2 × cup", 480, 5], // two mugs at 650 g: two cups are within 30 %
        ["Beer (regular)", "curated", "3 × can", 1068, 459], // three mugs at 975 g
        ["Yogurt (plain, low-fat)", "curated", "2 × container", 340, 214], // two pots shown as cups
        ["Cereal (cornflakes)", "curated", "~45 g", 45, 164], // a bowl, never 375 g of water
        ["Cereal (cornflakes)", "curated", "~90 g", 90, 329], // two bowls, never 750 g
        ["Almonds", "curated", "1 × cup, whole", 143, 828], // their own cup, not 240 g
        ["Rice (white, cooked)", "curated", "1 × cup", 158, 205], // its own cup, not 240 g
        ["Dal (lentil curry)", "curated", "2 × cup", 480, 696], // two large bowls at 550 g
        ["Rice (white, cooked)", "curated", "~300 g", 300, 390], // three servings in a bowl
        ["Chicken nuggets", "curated", "6 × nugget", 96, 295], // six servings of nuggets are six nuggets
        ["Beef stew", "curated", "2 × cup", 510, 546], // two bowls of stew chunks at 510 g
        ["Ramen bowl", "curated", "~9800 g", 9800, 12446], // 25 bowls would weigh more than an item may
        ["Pho (beef)", "curated", "1 × bowl", 400, 308], // pho at 400 g is its bowl
        ["Smoothie (fruit)", "curated", "1 × glass", 324, 214],
      ],
      // A name our list holds only shorter, the words before it dropped (ROADMAP
      // 7a-iv-i): our list's food where every dropped word says how the food was cooked,
      // cut or served, the food's own name does not say otherwise, and it carries the
      // kcal the model saw within its own error — over USDA's food holding every word,
      // unless that is more than 10 kcal per 100 g nearer (the reviews of PR #80 and #81).
      "review-shorter-names.json": [
        ["Corn (cooked)", "curated", "1 × ear small (5-1/2\" to 6-1/2\" long)", 89, 85],
        ["Potato (baked)", "curated", "1 × potato large", 299, 278], // a jacket potato, our baked potato by another name
        ["Rice (white, cooked)", "curated", "~150 g", 150, 195], // basmati rice, a long-grain white rice by name
        ["Egg white", "curated", "2 × white", 66, 34], // boiled egg whites
        ["Rice (white, cooked)", "curated", "~150 g", 150, 195], // steamed rice: USDA's Chinese restaurant rice is 151, ours 130, as seen
        ["Carrots (raw)", "curated", "10 × strip large (3\" long)", 70, 29], // baby carrots, a size: USDA's toddler food (26) is no nearer the 36 seen
        ["Tea, hot, leaf, green", "usda", "1 × cup", 240, 2], // "green" is what the tea is: USDA's green tea, never our black
        // A version our list does not hold is the model's estimate: "masala" is no way of
        // cooking a dosa, and our dumplings are fried, where these were steamed.
        ["Masala dosa", "estimate", "~150 g", 150, 255],
        ["Steamed dumplings", "estimate", "~180 g", 180, 270],
        // USDA's food of every word, far nearer what the model saw than ours of fewer.
        ["Yogurt, vanilla, low fat.", "usda", "1 × container (6 oz)", 170, 145], // ours is plain, 63 against 85
        ["Shrimp, grilled", "usda", "6 × large/jumbo shrimp", 90, 99], // 110 as seen, ours 99: 11 nearer
      ],
      // Names no shorter name of ours stands for.
      "review-names-kept-whole.json": [
        ["Chicken salad spread", "usda", "~150 g", 150, 300], // chicken is a food: never shortened to a salad
        ["Cherry tomatoes", "estimate", "~80 g", 80, 14], // a cherry is a food
        ["Lemon water", "estimate", "~250 g", 250, 5], // a lemon is a food, and only USDA's ("Lemon, raw"): never our water
        ["Light coconut milk", "estimate", "~120 g", 120, 37], // coconut is a food: never whole milk
        ["Coconut milk", "estimate", "~60 g", 60, 114], // USDA's coconut milk drink (31) is another food at 190, and never milk
        ["Oreo cookies", "estimate", "~34 g", 34, 160], // "cookie" alone is our pick, never a name shortened to it
        ["Overnight oats", "estimate", "~250 g", 250, 375], // dry oats carry 947 kcal at 250 g, not 375
        ["Garlic bread, NFS", "usda", "2 × small slice", 78, 272], // USDA's food of that name, before any shorter name
        // Peanut butter cups read as peanut butter, as before this card: "cups" is a
        // word the list drops as a serving (ROADMAP 10), whole-name matching, not shortening.
        ["Peanut butter", "curated", "~42 g", 42, 251],
        ["Chocolate milk", "curated", "1 × cup", 250, 190],
        ["Almond milk", "curated", "1 × cup", 262, 39],
        ["Fried rice", "curated", "~200 g", 200, 348],
        ["Fried rice", "curated", "~200 g", 200, 348], // egg fried rice
        ["Banana bread", "curated", "1 × slice", 60, 196],
      ],
      // The reviews of PR #80 and #81: a word that can say what a food is — a substitute,
      // a diet, what was taken out — is never dropped to find our list's food, however
      // near its calories, so each is USDA's food of every word or the model's estimate.
      // Each is written at the calories of the food it would otherwise read as.
      "review-substitutes.json": [
        ["Yogurt, soy", "usda", "1 × 5.3 oz container", 150, 135], // never our plain low-fat yogurt
        ["Pasta, gluten free", "usda", "~200 g", 200, 358],
        ["Milk, lactose free, whole", "usda", "1 × cup", 244, 149], // never our whole milk, at the same 61 kcal
        ["Vegan butter", "estimate", "~14 g", 14, 100], ["Vegan mayo", "estimate", "~15 g", 15, 102],
        ["Dairy free yogurt", "estimate", "~150 g", 150, 95], ["Vegan ice cream", "estimate", "~100 g", 100, 207],
        ["Vegan scrambled eggs", "estimate", "~100 g", 100, 149], ["Vegan pesto", "estimate", "~16 g", 16, 67],
        ["Vegan ghee", "estimate", "~13 g", 13, 114], ["Vegan bacon", "estimate", "~24 g", 24, 132],
        ["Quorn nuggets", "estimate", "~96 g", 96, 295], ["Eggless omelette", "estimate", "~120 g", 120, 185],
      ],
      // A dish's own kind is no way of cooking it: never our list's version of another kind.
      "review-dish-versions.json": [
        ["Lasagna, Vegetable, frozen, baked", "usda", "~250 g", 250, 348], // never our meat lasagna, tied on calories
        ["Vegan lasagna", "estimate", "~250 g", 250, 348], ["Vegan meatballs", "estimate", "~172 g", 172, 320],
        ["Veg sandwich", "estimate", "~115 g", 115, 217], ["Veg burrito", "estimate", "~200 g", 200, 418],
        ["Breakfast burrito", "estimate", "~200 g", 200, 418], ["Margherita pizza", "estimate", "~214 g", 214, 569],
        ["Hawaiian pizza", "estimate", "~214 g", 214, 569], ["Vegetable dumplings", "estimate", "~150 g", 150, 288],
        ["Veg biryani", "estimate", "~250 g", 250, 260], // never our chicken biryani, listed first
        ["Brown basmati rice", "estimate", "~150 g", 150, 185], // never our white rice
      ],
      // A way of cooking is dropped, and our list's version its own name does not contradict is the food.
      "review-cooking.json": [
        ["Carrots (cooked)", "curated", "~80 g", 80, 28], // steamed: never "Carrots (raw)", listed first
        ["Broccoli, raw", "usda", "~90 g", 90, 35], // raw: never our cooked broccoli, so USDA's
        ["Potato (boiled)", "curated", "~150 g", 150, 129], // steamed, cooked in water: never our baked potato
        ["Spinach (cooked)", "curated", "~90 g", 90, 21],
        ["Grilled tuna", "estimate", "~150 g", 150, 276], // our only tuna is canned
        ["Soft boiled egg", "estimate", "~50 g", 50, 72], // "soft" is no way of cooking: never our hard-boiled egg
        ["Almonds", "curated", "1 × oz (23 whole kernels)", 28, 162], // roasted: ours, not USDA's honey roasted, tied on calories
        ["Milk (whole)", "curated", "1 × cup", 244, 149], // hot: ours, not USDA's hot chocolate
        // Pan fried: our cooked chicken breast. Served by weight, it has no serving of its own to
        // start a count at, so its count of one starts at USDA's nearest measure, a chopped cup.
        ["Chicken breast (cooked)", "curated", "1 × cup, chopped or diced", 140, 231],
        ["Pork sausage (cooked)", "curated", "2 × link", 46, 150], // grilled: our "sausage", at its own link
      ],
    };
    const files = readdirSync(PLATES).filter((name) => name.endsWith(".json")).sort();
    const replyOf = (file: string): VisionEvidence => mealVisionEvidenceSchema.parse(JSON.parse(readFileSync(join(PLATES, file), "utf8")));
    // Apps of their own, over the same database and the same model replies: a store
    // each, so the people scanning here count against no sign-in limit the tests
    // above share (twenty requests an address). Each plate signs one person up and
    // in, two requests, so an app serves at most eight plates, clear of the twenty,
    // however many plates are added.
    const PLATES_PER_APP = 8;
    const apps: App[] = [];
    const appFor = (at: number): App => {
      const target = apps[Math.floor(at / PLATES_PER_APP)];
      if (target === undefined) throw new Error("beforeAll did not run");
      return target;
    };
    beforeAll(async () => {
      for (let n = 0; n < Math.ceil(Object.keys(EXPECTED).length / PLATES_PER_APP); n++) {
        apps.push(await buildApp(loadConfig(env), { redis: createMemoryRedis(), nutrition: { visionProvider: vision, foodSearchProvider: packagedSearch } }));
      }
    }, 60_000);
    afterAll(async () => {
      for (const target of apps) await target.close();
    });

    it("are all here, each a reply the schema reads", () => {
      expect(files).toEqual(Object.keys(EXPECTED).sort());
      for (const file of files) expect(mealVisionEvidenceSchema.safeParse(JSON.parse(readFileSync(join(PLATES, file), "utf8"))).success, file).toBe(true);
    });

    for (const [at, [file, rows]] of Object.entries(EXPECTED).entries()) {
      it(`${file}: every food the model saw is on the sheet, as pinned, and priced as the confirm will price it`, async () => {
        const evidence = replyOf(file);
        const target = appFor(at);
        const access = await sessionOn(target, `scan7b-plate-${String(at)}@example.com`);
        const sheet = await scanOn(target, access, evidence);
        if (process.env["PRINT_PLATES"] === "1") console.log(`PLATE ${file} ${JSON.stringify(sheet.items.map((i): Row => [i.name, i.nutritionSource, startOf(i), i.gramsPoint, i.kcalPoint]))}`);
        expect(sheet.items.map((i): Row => [i.name, i.nutritionSource, startOf(i), i.gramsPoint, i.kcalPoint])).toEqual(rows);
        // Nothing is dropped: every food the model listed is a row, and nothing is named as left out.
        expect(sheet.unknownItems).toEqual([]);
        expect(sheet.items).toHaveLength(evidence.items.length);
        // An estimate row carries its figures, and at the model's grams its kcal is the model's own.
        for (const [i, row] of sheet.items.entries()) {
          if (row.nutritionSource === "estimate") {
            expect(row.canonical.startsWith("est_"), row.name).toBe(true);
            expect(row.per100g, row.name).toBeDefined();
            expect(row.kcalPoint, row.name).toBe(evidence.items[i]?.kcal);
          } else {
            expect(row.per100g, row.name).toBeUndefined();
          }
        }
        // The draft behind the sheet holds the same foods and the same measures: sent as
        // the sheet sends each row, by the measure it starts at, each is what the sheet shows.
        const portionReads = vi.mocked(repo.usdaPortionsFor);
        portionReads.mockClear();
        const res = await injectOn(target, "POST", "/v1/nutrition/meals/preview", access, { scanToken: sheet.scanToken, items: sheet.items.map((i) => ({ canonical: i.canonical, measure: i.startsAt.measure, amount: i.startsAt.amount })) });
        expect(res.statusCode, res.body).toBe(200);
        // Every row goes by measure, and all their measures are ONE read.
        expect(portionReads).toHaveBeenCalledTimes(1);
        const preview = mealPreviewSchema.parse(res.json());
        expect(preview.items.map((i) => [i.name, i.nutritionSource, i.gramsPoint, i.kcalPoint])).toEqual(rows.map(([name, source, , grams, kcal]) => [name, source, grams, kcal]));
      }, 60_000);
    }
  });
});
