// The nightly update of our copy of Open Food Facts (ROADMAP Stage 5 33b-iii-a), run by the worker. It
// reads their daily change files, oldest first. No member's request ever waits on this or reaches them.
//
// A bad file must never empty the list: a file that reads as mostly unusable, or as not their shape, is
// refused whole, yesterday's rows stay, and Sentry hears. Each file is one transaction; a second run
// finds its name recorded and changes nothing.
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import type { Sql } from "postgres";
import { OFF_DAILY_FILE, offDailyLineSchema } from "@app/shared";
import { applyDailyFile, appliedDailyFiles, offListLoaded } from "./packagedRepo.js";
import { offProductOfDaily, offRowOf, type OffRow, type RowResult } from "./packagedRows.js";

export const OFF_DAILY_BASE = "https://static.openfoodfacts.org/data/delta/";
const FETCH_TIMEOUT_MS = 10 * 60 * 1000;
/** Well past what they send: 22 to 32 MB packed and 144 MB unpacked a day, measured 2026-10-30. */
const MOST_PACKED_BYTES = 256 * 1024 * 1024;
const MOST_UNPACKED_BYTES = 2 * 1024 * 1024 * 1024;
const MOST_LINE_BYTES = 8 * 1024 * 1024;
/** A file is refused below this share of usable products (a real day: 6,010 products, most usable),
 *  or above this share of lines that are not their shape. Too few products to judge: read as it is. */
const LEAST_USABLE_SHARE = 0.25;
const MOST_BAD_SHARE = 0.01;
const FEWEST_TO_JUDGE = 200;

export class PackagedFileRefused extends Error {}

/** Lines split on the newline byte alone. Node's `readline` also splits on U+2028, which real rows of
 *  this list hold, and would cut a product in two. */
export async function* linesOf(stream: AsyncIterable<Buffer | string>, mostLineBytes = MOST_LINE_BYTES): AsyncGenerator<Buffer> {
  let rest: Buffer = Buffer.alloc(0);
  for await (const piece of stream) {
    const chunk = typeof piece === "string" ? Buffer.from(piece) : piece;
    const buffer = rest.length === 0 ? chunk : Buffer.concat([rest, chunk]);
    let from = 0;
    let at = buffer.indexOf(10, from);
    while (at !== -1) {
      yield buffer.subarray(from, at);
      from = at + 1;
      at = buffer.indexOf(10, from);
    }
    rest = buffer.subarray(from);
    if (rest.length > mostLineBytes) throw new PackagedFileRefused("a line is longer than any product");
  }
  if (rest.length > 0) yield rest;
}

/** One line of the daily file or the JSONL export, or null where it is not their shape. */
export function rowOfJsonLine(line: Buffer): RowResult | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line.toString("utf8"));
  } catch {
    return null;
  }
  const parsed = offDailyLineSchema.safeParse(raw);
  return parsed.success ? offRowOf(offProductOfDaily(parsed.data)) : null;
}

/** What one daily file says: the rows it changed, the codes that no longer have numbers. */
export async function readDailyFile(lines: AsyncIterable<Buffer>): Promise<{ products: number; bad: number; rows: OffRow[]; removeCodes: string[] }> {
  const rows = new Map<string, OffRow>();
  const removeCodes = new Set<string>();
  let products = 0;
  let bad = 0;
  for await (const line of lines) {
    if (line.length === 0) continue;
    products++;
    const result = rowOfJsonLine(line);
    if (result === null) {
      bad++;
      continue;
    }
    if ("row" in result) {
      rows.set(result.row.code, result.row);
      removeCodes.delete(result.row.code);
    } else if (result.code !== null) {
      removeCodes.add(result.code);
      rows.delete(result.code);
    }
  }
  return { products, bad, rows: [...rows.values()], removeCodes: [...removeCodes] };
}

/** Raises when a file cannot be what they mean to send. */
export function judgeDailyFile(file: { products: number; bad: number; rows: readonly OffRow[] }): void {
  if (file.products < FEWEST_TO_JUDGE) return;
  if (file.bad / file.products > MOST_BAD_SHARE) throw new PackagedFileRefused(`${String(file.bad)} of ${String(file.products)} lines are not their shape`);
  if (file.rows.length / file.products < LEAST_USABLE_SHARE) throw new PackagedFileRefused(`only ${String(file.rows.length)} of ${String(file.products)} products have numbers`);
}

export interface PackagedSyncDeps {
  sql: Sql;
  fetch: typeof fetch;
  /** Their page asks for `AppName/Version (ContactEmail)`. */
  userAgent: string;
  log: { info: (data: object, message: string) => void; warn: (data: object, message: string) => void };
}

export interface PackagedSyncReport {
  /** `not_loaded`: the list has never been filled here, so there is nothing to keep current. */
  outcome: "not_loaded" | "up_to_date" | "updated";
  files: number;
  written: number;
  removed: number;
  /** Files were missed: their index keeps two weeks. The full import puts that right. */
  gap: boolean;
}

export async function updatePackagedFoods(deps: PackagedSyncDeps): Promise<PackagedSyncReport> {
  const empty: PackagedSyncReport = { outcome: "up_to_date", files: 0, written: 0, removed: 0, gap: false };
  if (!(await offListLoaded(deps.sql))) return { ...empty, outcome: "not_loaded" };

  const asked = { headers: { "user-agent": deps.userAgent }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) };
  const index = await deps.fetch(`${OFF_DAILY_BASE}index.txt`, asked);
  if (!index.ok) throw new PackagedFileRefused(`the file list answered ${String(index.status)}`);
  const listed = (await index.text())
    .split("\n")
    .map((name) => ({ name: name.trim(), match: OFF_DAILY_FILE.exec(name.trim()) }))
    .flatMap(({ name, match }) => (match === null ? [] : [{ name, from: Number(match[1]), to: Number(match[2]) }]))
    .sort((a, b) => a.to - b.to);
  if (listed.length === 0) throw new PackagedFileRefused("the file list holds no files");

  const applied = await appliedDailyFiles(deps.sql);
  const last = applied.lastToSecond;
  const waiting = listed.filter((file) => !applied.names.has(file.name) && (last === null || file.to > last));
  const earliest = listed[0];
  const gap = last !== null && earliest !== undefined && earliest.from > last;
  if (gap) deps.log.warn({ event: "packaged.update_gap", last, earliest: earliest.from }, "daily files were missed: run the full import");

  const report: PackagedSyncReport = { ...empty, gap };
  for (const file of waiting) {
    const answer = await deps.fetch(`${OFF_DAILY_BASE}${file.name}`, asked);
    if (!answer.ok || answer.body === null) throw new PackagedFileRefused(`${file.name} answered ${String(answer.status)}`);
    const packed = Number(answer.headers.get("content-length") ?? 0);
    if (packed > MOST_PACKED_BYTES) throw new PackagedFileRefused(`${file.name} is ${String(packed)} bytes`);
    const read = await readDailyFile(linesOf(capped(Readable.fromWeb(answer.body).pipe(createGunzip()))));
    judgeDailyFile(read);
    const done = await applyDailyFile(deps.sql, { name: file.name, toSecond: file.to, products: read.products }, read.rows, read.removeCodes);
    if (done !== null) {
      report.outcome = "updated";
      report.files++;
      report.written += done.written;
      report.removed += done.removed;
      deps.log.info({ event: "packaged.file_applied", file: file.name, products: read.products, ...done }, "daily file applied");
    }
  }
  return report;
}

/** Stops a file that unpacks to far more than any day's. */
async function* capped(stream: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > MOST_UNPACKED_BYTES) throw new PackagedFileRefused("the file unpacks to more than any day's");
    yield chunk;
  }
}
