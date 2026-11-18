// What the Exercise Library costs at 200 exercises (spec Part 2 §13.4 and §13.9, job 60b; CLAUDE.md §4,
// "Cost at full size"). It makes 200 exercise files from the real ones, each with its own id and name,
// and measures, against the LOCAL database, in a transaction that is rolled back:
//   - publishing: the whole time, and the part of it that holds the server (the check, the plan, the
//     text and its fingerprint), which answers nobody else meanwhile;
//   - the download: its size as sent, and gzip'd as the server's Caddy sends it;
//   - a download's own work: the first read of a new copy (its fingerprint and its check), and every
//     read after it, from memory.
// Run from apps/api:
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_ex2'; corepack pnpm exec tsx tools/measure-library.ts
import { performance } from "node:perf_hooks";
import { gzipSync } from "node:zlib";
import postgres from "postgres";
import { checkLibrary, exerciseFileSchema, libraryListSchema, type LibraryInput } from "@app/shared";
import { canonicalJson, sha256 } from "../src/modules/library/canonical.js";
import { readLibraryFolder } from "../src/modules/library/folder.js";
import { planPublish } from "../src/modules/library/plan.js";
import { publishLibrary } from "../src/modules/library/publish.js";

const SIZE = 200;
const RUNS = 5;

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("set DATABASE_URL to a LOCAL database");

function library200(): LibraryInput {
  const real = readLibraryFolder();
  const files = real.exerciseFiles.map((f) => exerciseFileSchema.parse(JSON.parse(f.text)));
  const exerciseFiles = Array.from({ length: SIZE }, (_, i) => {
    const base = files[i % files.length];
    if (base === undefined) throw new Error("the real folder is empty");
    const id = `measure_${String(i).padStart(3, "0")}`;
    const text = { en: { ...base.text.en, name: `Measure ${String(i)} ${base.text.en.name}`, otherNames: base.text.en.otherNames.map((n) => `Measure ${String(i)} ${n}`) } };
    return { name: `${id}.json`, text: JSON.stringify({ ...base, id, text }, null, 2) };
  });
  return { exerciseFiles, compendium: real.compendium };
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? Number.NaN;
};
const ms = (x: number): string => `${x.toFixed(1)} ms`;

class RolledBack extends Error {}

const input = library200();
const sql = postgres(url, { prepare: false, max: 1 });
try {
  const whole: number[] = [];
  const held: number[] = [];
  let body = "";
  for (let run = 0; run < RUNS; run++) {
    // The part that holds the server: everything publishing does that is not waiting on the database.
    const t0 = performance.now();
    const checked = checkLibrary(input);
    if (checked.compendium === null || checked.faults.length > 0) throw new Error("the measured files are faulty");
    const plan = planPublish({ files: checked.exercises, compendium: checked.compendium, rows: [], named: new Set() });
    const list = libraryListSchema.parse({ exercises: plan.list.map((l) => l.entry), camera: [] });
    body = canonicalJson(list);
    sha256(body);
    held.push(performance.now() - t0);

    const t1 = performance.now();
    await sql
      .begin(async (tx) => {
        await publishLibrary(tx, input);
        throw new RolledBack();
      })
      .catch((err: unknown) => {
        if (!(err instanceof RolledBack)) throw err;
      });
    whole.push(performance.now() - t1);
  }

  const firstRead: number[] = [];
  for (let run = 0; run < RUNS; run++) {
    const t = performance.now();
    sha256(body);
    libraryListSchema.parse(JSON.parse(body));
    firstRead.push(performance.now() - t);
  }
  const fromMemory: number[] = [];
  let sent = 0;
  for (let run = 0; run < RUNS; run++) {
    const t = performance.now();
    const reply = `{"fingerprint":"${"0".repeat(64)}","version":1,"list":${body}}`;
    sent += Buffer.byteLength(reply);
    fromMemory.push(performance.now() - t);
  }
  if (sent === 0) throw new Error("no reply was made");

  const bytes = Buffer.byteLength(body);
  const gz = gzipSync(body).length;
  console.log(`exercises: ${String(SIZE)}, runs: ${String(RUNS)}, medians`);
  console.log(`publish, whole (a new list of ${String(SIZE)}, rolled back): ${ms(median(whole))}`);
  console.log(`publish, the part that holds the server: ${ms(median(held))}`);
  console.log(`download size: ${(bytes / 1024).toFixed(1)} KB as sent by the api, ${(gz / 1024).toFixed(1)} KB gzip'd`);
  console.log(`a download, first read of a new copy (fingerprint and check): ${ms(median(firstRead))}`);
  console.log(`a download, from memory: ${ms(median(fromMemory))}`);
} finally {
  await sql.end({ timeout: 5 });
}
