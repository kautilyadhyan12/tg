// What a meal scan costs on the real scanner (ROADMAP 7a-iii-b). Each photo goes
// through the production OpenAI adapter — the prompt, picture detail and thinking
// setting a person's scan uses — and the tool prints each call's tokens and cost,
// the foods it read with the model's own estimates, and the average a scan
// against Kd's gate of $0.00086 (RULINGS 2026-09-16).
//
//   corepack pnpm --filter api exec tsx tools/measure-scan-cost.ts --env=<file with OPENAI_API_KEY> --out=<folder outside the repo> <photo or folder> ...
//
// EVERY PHOTO IS A PAID CALL, and Kd counts them (RULINGS 2026-09-15: one test
// call, never a sweep): at most ten photos a run, one call each, never retried.
// The key comes from the OPENAI_API_KEY line of --env and nothing else in that
// file is read; it is never printed. The repository is public, so --out may not
// be inside it, and no photo belongs in it either.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { openAiCompletionSchema } from "@app/shared";
import { VisionProviderError, createOpenAiVisionProvider, visionCostMicro, type MealVisionModel } from "../src/modules/nutrition/vision.adapter.js";
import { MAX_PHOTOS_PER_RUN, PHOTO_TYPES, SCAN_KEY_NAME, keyFrom, scanCostArgs, summarizeScanCost, type ScanCall } from "./scan-cost.js";

const MODEL: MealVisionModel = "gpt-6-luna";

/** Between calls, so a free-plan key stays under its requests-a-minute limit. */
const PAUSE_MS = 8_000;

const repoRoot = resolve(import.meta.dirname, "../../..");
const args = scanCostArgs(process.argv.slice(2), repoRoot);
if ("problem" in args) {
  console.error(`measure-scan-cost: ${args.problem}`);
  process.exit(2);
}

const photos = args.paths.flatMap((path) =>
  statSync(path).isDirectory()
    ? readdirSync(path).filter((name) => PHOTO_TYPES.has(extname(name).toLowerCase())).sort().map((name) => join(path, name))
    : [path],
);
if (photos.length === 0 || photos.length > MAX_PHOTOS_PER_RUN) {
  console.error(`measure-scan-cost: ${String(photos.length)} photos named; a run takes 1 to ${String(MAX_PHOTOS_PER_RUN)}, each a paid call`);
  process.exit(2);
}
const key = keyFrom(readFileSync(args.envFile, "utf8"), SCAN_KEY_NAME);
if (key === null) {
  console.error(`measure-scan-cost: no ${SCAN_KEY_NAME} line with a value in ${args.envFile}`);
  process.exit(2);
}
mkdirSync(args.outDir, { recursive: true });

/** The model's own text out of the reply envelope, and the thinking it billed
 *  (OpenAI counts it inside completion_tokens). */
const modelText = (envelope: string): { text: string; thoughts: number } | null => {
  try {
    const completion = openAiCompletionSchema.safeParse(JSON.parse(envelope));
    if (!completion.success) return null;
    return { text: completion.data.choices[0].message.content ?? "", thoughts: completion.data.usage.completion_tokens_details.reasoning_tokens };
  } catch {
    return null;
  }
};

const calls: ScanCall[] = [];
const results: unknown[] = [];
for (const [at, photo] of photos.entries()) {
  if (at > 0) await new Promise((done) => setTimeout(done, PAUSE_MS));
  const name = basename(photo);
  const mimeType = PHOTO_TYPES.get(extname(photo).toLowerCase()) ?? "image/jpeg";
  let envelope = "";
  const keepReply: typeof fetch = async (input, init) => {
    const res = await fetch(input, init);
    envelope = await res.text();
    return new Response(envelope, { status: res.status, headers: res.headers });
  };
  const started = Date.now();
  const scanner = createOpenAiVisionProvider(key, MODEL, keepReply);
  let usage: ScanCall["usage"] = null;
  let outcome: string;
  let foods: string[] = [];
  try {
    const read = await scanner.analyze(readFileSync(photo).toString("base64"), mimeType);
    usage = { tokensIn: read.tokensIn, tokensOut: read.tokensOut };
    outcome = `${String(read.evidence.items.length)} foods, photo ${read.evidence.photo_quality}`;
    foods = read.evidence.items.map((i) =>
      `${i.name} (${i.canonical_hint})${i.count === null ? "" : ` ×${String(i.count)}`} · ${String(i.grams)} g ${String(i.kcal)} kcal · P ${String(i.protein_g)} C ${String(i.carbs_g)} F ${String(i.fat_g)}`);
    if (read.evidence.unknown_items.length > 0) foods.push(`unknown: ${read.evidence.unknown_items.join(", ")}`);
  } catch (err) {
    if (!(err instanceof VisionProviderError)) throw err;
    usage = err.usage ?? null;
    outcome = `FAILED ${err.kind}: ${err.message}`;
  }
  const ms = Date.now() - started;
  const reply = modelText(envelope);
  // "download (3).jpg.768.jpg" → "download-3": the shrunk copy's suffix, then the photo's own extension.
  const slug = name.replace(/\.768\.jpg$/i, "").replace(/\.[a-z]+$/i, "").replaceAll(/[^A-Za-z0-9]+/g, "-").replaceAll(/^-|-$/g, "").toLowerCase();
  if (reply !== null) writeFileSync(join(args.outDir, `${slug}.reply.json`), reply.text);
  calls.push({ photo: name, usage });
  const cost = usage === null ? null : visionCostMicro(MODEL, usage.tokensIn, usage.tokensOut);
  results.push({ photo: name, ms, outcome, tokensIn: usage?.tokensIn ?? null, tokensOut: usage?.tokensOut ?? null, thoughtTokens: reply?.thoughts ?? null, costMicroUsd: cost === null ? null : Number(cost), replyChars: reply?.text.length ?? null, foods });
  console.log(`${name}: ${outcome} · ${usage === null ? "nothing billed" : `${String(usage.tokensIn)} in + ${String(usage.tokensOut)} out (thinking ${String(reply?.thoughts ?? 0)})`}` +
    `${cost === null ? "" : ` · $${(Number(cost) / 1e6).toFixed(6)}`} · ${String(ms)} ms`);
  for (const food of foods) console.log(`   ${food}`);
  writeFileSync(join(args.outDir, "results.json"), JSON.stringify(results, null, 2));
}

const summary = summarizeScanCost(calls, MODEL);
const average = summary.averageMicroUsd === null ? "none billed" : `$${(summary.averageMicroUsd / 1e6).toFixed(6)} a scan`;
console.log(`\n${String(summary.billed)} of ${String(summary.calls)} calls billed · average ${average} · gate $0.00086: ${summary.overGate ? "OVER — stop, and give Kd the number" : "under"}`);
