// The nightly update of our copy of Open Food Facts (ROADMAP Stage 5 33b-iii-a), run by the worker. It
// reads their daily change files, oldest first. No member's request ever waits on this or reaches them.
//
// A bad file must never empty the list: a file that reads as mostly unusable, that would remove more
// than any day does, or that is not their shape is refused whole, yesterday's rows stay, and Sentry
// hears. Each file is one transaction; a second run finds its name recorded and changes nothing.
import { createGunzip } from "node:zlib";
import { Readable, Transform, pipeline } from "node:stream";
import type { Sql } from "postgres";
import { OFF_DAILY_FILE, offDailyLineSchema } from "@app/shared";
import { applyDailyFile, appliedDailyFiles, offListLoaded } from "./packagedRepo.js";
import { offProductOfDaily, offRowOf, type OffRow, type RowResult, type WrittenRow } from "./packagedRows.js";

export const OFF_DAILY_BASE = "https://static.openfoodfacts.org/data/delta/";

/** Well past a real day: 22 to 32 MB packed, 144 MB unpacked and 6,010 lines, measured 2026-10-30. A
 *  file within the packed limit can still unpack to anything, and its rows are held in memory until it
 *  is judged, so the lines and the unpacked bytes are limited too. The time limit is for each file: the
 *  worker's other jobs wait behind this one. */
export const DAILY_LIMITS = {
  fetchMs: 3 * 60 * 1000,
  indexBytes: 64 * 1024,
  packedBytes: 128 * 1024 * 1024,
  unpackedBytes: 512 * 1024 * 1024,
  lineBytes: 8 * 1024 * 1024,
  lines: 200_000,
};
export type DailyLimits = typeof DAILY_LIMITS;

/** A file is refused below this share of usable products, or above this share of lines that are not
 *  their shape. Too few products to judge a share: read as it is. Whatever its shares, it is refused
 *  past this many removals: a real day removes at most 1,311 (950 no calories, 352 no name, 9 out of
 *  bounds), and 26% usable would otherwise pass while it emptied the list. */
const LEAST_USABLE_SHARE = 0.25;
const MOST_BAD_SHARE = 0.01;
const FEWEST_TO_JUDGE = 200;
const MOST_REMOVALS = 20_000;
/** Their file names say when they run to. One ahead of now by more than a clock can be wrong is no real
 *  file, and must never become the point every later file is measured from. */
const MOST_AHEAD_SECONDS = 3600;
/** One file's whole read, however its bytes arrive. */
const MOST_READ_MS = 10 * 60 * 1000;

export class PackagedFileRefused extends Error {}

/** Lines split on the newline byte alone. Node's `readline` also splits on U+2028, which real rows of
 *  this list hold, and would cut a product in two. */
export async function* linesOf(stream: AsyncIterable<Buffer | string>, mostLineBytes = DAILY_LIMITS.lineBytes): AsyncGenerator<Buffer> {
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
export async function readDailyFile(lines: AsyncIterable<Buffer>, mostLines = DAILY_LIMITS.lines): Promise<{ products: number; bad: number; rows: WrittenRow[]; removeCodes: string[] }> {
  const rows = new Map<string, WrittenRow>();
  const removeCodes = new Set<string>();
  let products = 0;
  let bad = 0;
  let seen = 0;
  const started = Date.now();
  for await (const line of lines) {
    // Empty lines count too: a small file can unpack to nothing but them.
    seen++;
    if (seen > mostLines) throw new PackagedFileRefused(`more than ${String(mostLines)} lines in one file`);
    if (seen % 4096 === 0 && Date.now() - started > MOST_READ_MS) throw new PackagedFileRefused("one file took too long to read");
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
export function judgeDailyFile(file: { products: number; bad: number; rows: readonly OffRow[]; removeCodes: readonly string[] }): void {
  if (file.removeCodes.length > MOST_REMOVALS) throw new PackagedFileRefused(`it would remove ${String(file.removeCodes.length)} products`);
  if (file.products < FEWEST_TO_JUDGE) return;
  if (file.bad / file.products > MOST_BAD_SHARE) throw new PackagedFileRefused(`${String(file.bad)} of ${String(file.products)} lines are not their shape`);
  if (file.rows.length / file.products < LEAST_USABLE_SHARE) throw new PackagedFileRefused(`only ${String(file.rows.length)} of ${String(file.products)} products have numbers`);
}

export interface PackagedSyncDeps {
  sql: Sql;
  fetch: typeof fetch;
  /** Their page asks for `AppName/Version (ContactEmail)`. */
  userAgent: string;
  now: () => Date;
  log: { info: (data: object, message: string) => void; warn: (data: object, message: string) => void };
  limits?: Partial<DailyLimits>;
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

/** A body read whole, up to a limit: a list of file names has no reason to be large. */
async function textOf(answer: Response, mostBytes: number): Promise<string> {
  if (answer.body === null) return "";
  const reader = answer.body.getReader();
  try {
    const parts: Uint8Array[] = [];
    let total = 0;
    for (let part = await reader.read(); !part.done; part = await reader.read()) {
      const chunk: unknown = part.value;
      if (!(chunk instanceof Uint8Array)) throw new PackagedFileRefused("the file list is not bytes");
      total += chunk.length;
      if (total > mostBytes) throw new PackagedFileRefused("the file list is larger than any real one");
      parts.push(chunk);
    }
    return Buffer.concat(parts).toString("utf8");
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** One day's file off the connection. `pipeline` carries a cut or a stall into the reader as an error;
 *  with `.pipe()` it would have nowhere to go and would end the worker, and every gym's jobs with it. On
 *  the way out, however it ends, the download is closed. */
async function readDownload(answer: Response, limits: DailyLimits): Promise<Awaited<ReturnType<typeof readDailyFile>>> {
  if (answer.body === null) throw new PackagedFileRefused("the file has no body");
  const source = Readable.fromWeb(answer.body);
  const unpack = createGunzip();
  let packed = 0;
  const counted = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      packed += chunk.length;
      if (packed > limits.packedBytes) done(new PackagedFileRefused("the file is larger than any day's"));
      else done(null, chunk);
    },
  });
  pipeline(source, counted, unpack, () => undefined);
  try {
    return await readDailyFile(linesOf(capped(unpack, limits.unpackedBytes), limits.lineBytes), limits.lines);
  } finally {
    unpack.destroy();
    source.destroy();
  }
}

/** Stops a file that unpacks to far more than any day's. */
async function* capped(stream: AsyncIterable<Buffer>, mostBytes: number): AsyncGenerator<Buffer> {
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > mostBytes) throw new PackagedFileRefused("the file unpacks to more than any day's");
    yield chunk;
  }
}

export async function updatePackagedFoods(deps: PackagedSyncDeps): Promise<PackagedSyncReport> {
  const limits: DailyLimits = { ...DAILY_LIMITS, ...deps.limits };
  const empty: PackagedSyncReport = { outcome: "up_to_date", files: 0, written: 0, removed: 0, gap: false };
  if (!(await offListLoaded(deps.sql))) return { ...empty, outcome: "not_loaded" };

  const asked = (): RequestInit => ({ headers: { "user-agent": deps.userAgent }, signal: AbortSignal.timeout(limits.fetchMs) });
  const index = await deps.fetch(`${OFF_DAILY_BASE}index.txt`, asked());
  if (!index.ok) throw new PackagedFileRefused(`the file list answered ${String(index.status)}`);
  const nowSecond = Math.floor(deps.now().getTime() / 1000);
  const named = (await textOf(index, limits.indexBytes))
    .split("\n")
    .map((name) => ({ name: name.trim(), match: OFF_DAILY_FILE.exec(name.trim()) }))
    .flatMap(({ name, match }) => (match === null ? [] : [{ name, from: Number(match[1]), to: Number(match[2]) }]));
  if (named.length === 0) throw new PackagedFileRefused("the file list holds no files");
  const listed = named.filter((file) => file.from < file.to && file.to <= nowSecond + MOST_AHEAD_SECONDS).sort((a, b) => a.to - b.to);
  if (listed.length < named.length) deps.log.warn({ event: "packaged.wrong_file_name", names: named.filter((f) => !listed.includes(f)).map((f) => f.name).slice(0, 5) }, "their list names a file that cannot be real: passed over");

  const applied = await appliedDailyFiles(deps.sql);
  const last = applied.lastToSecond;
  const waiting = listed.filter((file) => !applied.names.has(file.name) && (last === null || file.to > last));
  const earliest = listed[0];
  const gap = last !== null && earliest !== undefined && earliest.from > last;
  if (gap) deps.log.warn({ event: "packaged.update_gap", last, earliest: earliest.from }, "daily files were missed: run the full import");

  const report: PackagedSyncReport = { ...empty, gap };
  for (const file of waiting) {
    const answer = await deps.fetch(`${OFF_DAILY_BASE}${file.name}`, asked());
    if (!answer.ok) throw new PackagedFileRefused(`${file.name} answered ${String(answer.status)}`);
    const read = await readDownload(answer, limits);
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
