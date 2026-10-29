import {
  MEAL_PHOTO_KEPT_MOST,
  MEAL_PHOTO_MAX_BYTES,
  MEAL_SCAN_SAVE_SECONDS,
  cleanPhoto,
  photoSheetFileSchema,
  type MealChoice,
  type MealPhotoAnalysis,
  type MealPreview,
  type MealType,
  type OwnFoodItem,
  type PhotoSheetAmount,
  type PhotoSheetFile,
  type PhotoSheetFood,
  type PhotoSheetPick,
} from "@app/shared";
import type { Answer } from "../../session/calls";
import { count } from "../dashboard/words";
import { MONTH_NAMES, mealTypeName, sectionOf } from "./day";
import { chosenItem, dishMeasure, formatAmount } from "./measures";
import { sharesOf } from "./dishShares";

// A meal logged from a photo (ROADMAP Stage 5 33b-i), as the browser's photo sheet does it: the photo
// made small and rebuilt on the phone, so the place and time it was taken never leave it; the scan's
// foods at the amounts the server started them, each changed in the amount box, taken off, or joined
// by a food the photo missed; one save, kept on the phone until the server has it. Every number is the
// server's.

/** The photo goes up no longer than this on its longest side, as the browser's does. */
export const MAX_EDGE_PX = 768;
export const JPEG_QUALITY = 0.85;

/** The size a picture shrinks to so its longest side is at most `maxEdge`, never enlarged. */
export function fitWithin(width: number, height: number, maxEdge = MAX_EDGE_PX): { width: number; height: number } {
  const longest = Math.max(width, height);
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const VALUE = new Map(Array.from({ length: ALPHABET.length }, (_, i) => [ALPHABET.charAt(i), i]));

/** Base64 to bytes; null where it is not base64. */
export function fromBase64(text: string): Uint8Array | null {
  const clean = text.replace(/\s+/g, "");
  if (clean.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null;
  const pad = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((clean.length / 4) * 3 - pad);
  let at = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = [0, 1, 2, 3].map((k) => VALUE.get(clean[i + k] ?? "=") ?? 0);
    const word = ((n[0] ?? 0) << 18) | ((n[1] ?? 0) << 12) | ((n[2] ?? 0) << 6) | (n[3] ?? 0);
    for (const byte of [(word >> 16) & 0xff, (word >> 8) & 0xff, word & 0xff]) {
      if (at < out.length) out[at++] = byte;
    }
  }
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const word = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += ALPHABET[(word >> 18) & 63] ?? "";
    out += ALPHABET[(word >> 12) & 63] ?? "";
    out += b === undefined ? "=" : (ALPHABET[(word >> 6) & 63] ?? "");
    out += c === undefined ? "=" : (ALPHABET[word & 63] ?? "");
  }
  return out;
}

/** The photo as it is sent: the JPEG the phone drew, rebuilt by the shared cleaner from the parts
 *  that draw the picture, so no tag of the camera's (where and when it was taken) can go with it,
 *  whatever the drawing kept. Null where it is no picture: nothing is sent. */
export function photoToSend(base64: string): string | null {
  const bytes = fromBase64(base64);
  if (bytes === null) return null;
  const cleaned = cleanPhoto(bytes, MEAL_PHOTO_MAX_BYTES);
  return cleaned.ok && cleaned.type === "image/jpeg" ? toBase64(cleaned.bytes) : null;
}

/** What a scan that did not read the photo says, and what becomes of the free try the server gave.
 *  `retake`: a new free try's token, "clear" where the one held is spent, or "keep". `search`: no
 *  scans are left, so the screen offers the food search instead. */
export interface ScanTrouble {
  words: string;
  retake: { token: string } | "keep" | "clear";
  search: boolean;
}

type Refusal = Extract<Answer<unknown>, { kind: "refused" }>;

const field = (body: unknown, key: string): string | null => {
  if (typeof body !== "object" || body === null) return null;
  const v: unknown = Reflect.get(body, key);
  return typeof v === "string" && v !== "" ? v : null;
};

/** When more scans come, as a person reads it: "tomorrow", or "1 November". */
export function againWords(resetsAt: string | null, now: Date): string | null {
  if (resetsAt === null) return null;
  const at = new Date(resetsAt);
  if (Number.isNaN(at.getTime())) return null;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (at.getFullYear() === tomorrow.getFullYear() && at.getMonth() === tomorrow.getMonth() && at.getDate() === tomorrow.getDate()) return "tomorrow";
  return `on ${String(at.getDate())} ${MONTH_NAMES[at.getMonth()] ?? ""}`;
}

export function scanTrouble(answer: Refusal | { kind: "no_answer" }, now: Date): ScanTrouble {
  if (answer.kind === "no_answer") return { words: "No connection. Try again.", retake: "keep", search: false };
  const token = field(answer.body, "retakeToken");
  const free = token === null ? "" : " This try is free.";
  if (answer.status === 422) {
    return { words: token === null ? "Couldn’t read that photo. Try another one." : `Couldn’t read that photo. Try again in better light.${free}`, retake: token === null ? "keep" : { token }, search: false };
  }
  if (answer.status === 503) {
    if (answer.error === "scanner_unavailable") return { words: `Meal scanning is busy. Try again in a minute.${free}`, retake: token === null ? "keep" : { token }, search: false };
    return { words: "Meal scanning isn’t available right now. Try again later.", retake: token === null ? "keep" : { token }, search: true };
  }
  if (answer.status === 429 && answer.error === "quota_exceeded") {
    const again = againWords(field(answer.body, "resetsAt"), now);
    return { words: again === null ? "You’ve used all your meal scans for now." : `You’ve used all your meal scans. More ${again}.`, retake: "keep", search: true };
  }
  if (answer.status === 429) return { words: "Too many tries. Wait a minute, then try again.", retake: "keep", search: false };
  if (answer.error === "invalid_retake") return { words: "That free try ran out. Take the photo again.", retake: "clear", search: false };
  if (answer.error === "invalid_image" || answer.error === "validation_error") return { words: "That photo couldn’t be read. Try another one.", retake: "keep", search: false };
  return { words: "Meal scanning didn’t work. Try again.", retake: "keep", search: false };
}

/** A photo's meal while it is reviewed, as it is kept on the phone (`PhotoSheetFile`). */
export type PhotoSheet = Omit<PhotoSheetFile, "version">;

/** The amount a scanned food starts at: where the server started it. */
const startOf = (item: MealPhotoAnalysis["items"][number]): PhotoSheetAmount => ({ measure: item.startsAt.measure, amount: formatAmount(item.startsAt.amount) });

/** A scan just back: each food where the server started it, the meal the time of day says, and the
 *  photo as it was sent, kept where it is no larger than a kept photo may be. */
export function newSheet(analysis: MealPhotoAnalysis, now: Date, photo: string | null = null): PhotoSheet {
  return {
    scannedAt: now.toISOString(),
    analysis,
    amounts: analysis.items.map(startOf),
    replaced: analysis.items.map(() => null),
    extras: [],
    mealType: sectionOf({ mealType: null, takenAt: now.toISOString() }),
    ...(photo !== null && photo.length <= MEAL_PHOTO_KEPT_MOST ? { photo } : {}),
  };
}

/** How long the scan can still be saved, in milliseconds. */
export const sheetLeftMs = (sheet: Pick<PhotoSheet, "scannedAt">, now: Date): number =>
  Date.parse(sheet.scannedAt) + MEAL_SCAN_SAVE_SECONDS * 1000 - now.getTime();

/** A kept photo meal is opened again only while a save still has this long. */
export const SHEET_LEAST_LEFT_MS = 60_000;

/** Where a row's numbers come from: a list's, the scan's estimate, or the person's own. */
export type RowSource = PhotoSheetFood["source"] | "own";

/** One food on the photo's meal, as its row reads it. */
export interface SheetRow {
  key: string;
  name: string;
  /** The list's food, or null for the person's own food (`own`). */
  canonical: string | null;
  source: RowSource;
  measures: MealPhotoAnalysis["items"][number]["measures"];
  amount: PhotoSheetAmount;
  usual: PhotoSheetAmount;
  /** The scan's own guess of its amount, still untouched. */
  estimated: boolean;
  /** The scan's own numbers for it, while it is as the scan started it. */
  scanned: MealPhotoAnalysis["items"][number] | null;
  /** The person's own food: its name, grams and numbers. */
  own: OwnFoodItem | null;
  /** What the photo saw here, where the person changed it to another food: Undo puts it back. */
  wasSeen: string | null;
  added: boolean;
}

const sameAmount = (a: PhotoSheetAmount, b: PhotoSheetAmount): boolean => a.measure === b.measure && Number(a.amount) === Number(b.amount);
const GRAMS_ONLY: MealPhotoAnalysis["items"][number]["measures"] = [{ id: "g", name: "g", grams: 1 }];

/** A food the person put on the meal, as its row reads it. */
function pickRow(pick: PhotoSheetPick, key: string, wasSeen: string | null): SheetRow {
  if ("own" in pick) {
    const grams = { measure: "g", amount: formatAmount(pick.own.grams) };
    return { key, name: pick.own.name, canonical: null, source: "own", measures: GRAMS_ONLY, amount: grams, usual: grams, estimated: false, scanned: null, own: pick.own, wasSeen, added: wasSeen === null };
  }
  return {
    key,
    name: pick.food.name,
    canonical: pick.food.canonical,
    source: pick.food.source,
    measures: pick.food.measures,
    amount: pick.amount,
    usual: { measure: pick.food.startsAt.measure, amount: formatAmount(pick.food.startsAt.amount) },
    estimated: false,
    scanned: null,
    own: null,
    wasSeen,
    added: wasSeen === null,
  };
}

/** The foods on the meal now, in the order they are sent: the scan's still on it (each as the person
 *  changed it, where they did), then those added. */
export function sheetRows(sheet: PhotoSheet): SheetRow[] {
  const scanned = sheet.analysis.items.flatMap((item, i): SheetRow[] => {
    const amount = sheet.amounts[i];
    if (amount === null || amount === undefined) return [];
    const key = `s${String(i)}`;
    const replaced = sheet.replaced[i];
    if (replaced !== null && replaced !== undefined) return [pickRow(replaced, key, item.name)];
    const untouched = sameAmount(amount, startOf(item));
    return [{
      key,
      name: item.name,
      canonical: item.canonical,
      // A scanned food's numbers are never the person's own; read as the scan's estimate if ever so.
      source: item.nutritionSource === "own" ? "estimate" : item.nutritionSource,
      measures: item.measures,
      amount,
      usual: startOf(item),
      estimated: untouched && item.portionEstimated,
      scanned: untouched ? item : null,
      own: null,
      wasSeen: null,
      added: false,
    }];
  });
  return [...scanned, ...sheet.extras.map((x, i) => pickRow(x, `x${String(i)}`, null))];
}

/** What a food still needs before the meal can be priced and saved: how full its dish was, or an
 *  amount; null where it has one. One food left so stops the whole meal, so the screen names it. */
export function rowNeeds(row: Pick<SheetRow, "own" | "canonical" | "amount">): "fill" | "amount" | null {
  if (row.own !== null || row.canonical === null) return null;
  if (chosenItem(row.canonical, row.amount) !== null) return null;
  return row.amount.measure.startsWith("dish:") ? "fill" : "amount";
}

/** What is sent for the meal, or null while a food on it has no amount, or none is left on it. */
export function sheetItems(sheet: PhotoSheet): MealChoice[] | null {
  const rows = sheetRows(sheet);
  if (rows.length === 0) return null;
  const items = rows.map((r): MealChoice | null => (r.own !== null ? r.own : r.canonical === null ? null : chosenItem(r.canonical, r.amount)));
  return items.every((i): i is MealChoice => i !== null) ? items : null;
}

/** The meal still exactly as the scan saw it: the scan's own numbers stand until the server's come. */
export const atScan = (sheet: PhotoSheet): boolean =>
  sheet.extras.length === 0 &&
  sheet.amounts.every((a) => a !== null) &&
  sheet.replaced.every((r) => r === null) &&
  sheetRows(sheet).every((r) => r.scanned !== null);

/** The meal's numbers: the server's for what it holds now, or the scan's while it is as scanned. */
export function sheetNumbers(sheet: PhotoSheet, preview: MealPreview | null): MealPreview | null {
  if (preview !== null) return preview;
  return atScan(sheet) ? { items: sheet.analysis.items, totals: sheet.analysis.totals } : null;
}

const placeOf = (key: string): number => Number(key.slice(1));

/** A row's amount changed, or the row taken off (`null`). Taking off a changed food takes its place
 *  off with it. */
export function withRowAmount(sheet: PhotoSheet, key: string, amount: PhotoSheetAmount | null): PhotoSheet {
  const at = placeOf(key);
  if (key.startsWith("s")) {
    const replaced = sheet.replaced[at];
    if (amount !== null && replaced !== null && replaced !== undefined && "food" in replaced) {
      return { ...sheet, replaced: sheet.replaced.map((r, i) => (i === at ? { ...replaced, amount } : r)) };
    }
    return {
      ...sheet,
      amounts: sheet.amounts.map((a, i) => (i === at ? amount : a)),
      replaced: amount === null ? sheet.replaced.map((r, i) => (i === at ? null : r)) : sheet.replaced,
    };
  }
  if (amount === null) return { ...sheet, extras: sheet.extras.filter((_, i) => i !== at) };
  return { ...sheet, extras: sheet.extras.map((x, i) => (i === at && "food" in x ? { ...x, amount } : x)) };
}

/** A row's food put to another (`pick`), or a scanned one put back to what the photo saw (`null`). */
export function withRowFood(sheet: PhotoSheet, key: string, pick: PhotoSheetPick | null): PhotoSheet {
  const at = placeOf(key);
  if (key.startsWith("s")) return { ...sheet, replaced: sheet.replaced.map((r, i) => (i === at ? pick : r)) };
  if (pick === null) return sheet;
  return { ...sheet, extras: sheet.extras.map((x, i) => (i === at ? pick : x)) };
}

/** A food the photo missed: one the search found at the amount picked, or the person's own. */
export const withExtra = (sheet: PhotoSheet, pick: PhotoSheetPick): PhotoSheet => ({ ...sheet, extras: [...sheet.extras, pick] });

/** The foods the search may not offer: each one on the meal, and each the scan put there. The server
 *  reads a food by its own name, so one sent twice would be read as the scan's row. */
export const onSheet = (sheet: PhotoSheet): ReadonlySet<string> =>
  new Set([
    ...sheet.analysis.items.map((i) => i.canonical),
    ...[...sheet.replaced, ...sheet.extras].flatMap((x) => (x !== null && "food" in x ? [x.food.canonical] : [])),
  ]);

export const sheetFileText = (sheet: PhotoSheet): string => JSON.stringify({ version: 1, ...sheet });

/** The kept photo meal, where it is whole and can still be saved; anything else is nothing. */
export function readSheetFile(text: string | null, now: Date): PhotoSheet | null {
  if (text === null || text === "") return null;
  let raw: unknown = null;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = photoSheetFileSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { scannedAt, analysis, amounts, replaced, extras, mealType, photo } = parsed.data;
  const sheet: PhotoSheet = { scannedAt, analysis, amounts, replaced, extras, mealType, ...(photo === undefined ? {} : { photo }) };
  if (sheet.amounts.length !== sheet.analysis.items.length || sheet.replaced.length !== sheet.analysis.items.length) return null;
  return sheetLeftMs(sheet, now) >= SHEET_LEAST_LEFT_MS ? sheet : null;
}

/** The save button's words: "Save to Lunch". The meal's numbers are the line above it, so the button
 *  stays one line on the smallest phone. */
export const saveWords = (mealType: MealType): string => `Save to ${mealTypeName(mealType)}`;

/** The meal's numbers in one line, each number kept with its unit where the line wraps:
 *  "846 kcal · Protein 56 g · Carbs 51 g · Fat 47 g". */
export function totalsWords(totals: MealPreview["totals"]): string {
  const g = (n: number) => `${count(Math.round(n))} g`;
  return `${count(totals.kcalPoint)} kcal · Protein ${g(totals.proteinG)} · Carbs ${g(totals.carbsG)} · Fat ${g(totals.fatG)}`;
}

/** The whole meal eaten from one dish (Kd, 2026-10-30): each food of the lists given its part of
 *  the dish, in the proportions of what each weighs now (`grams`, by row, from the server's numbers);
 *  the person's own foods keep their grams. Null while a food's weight is not known yet. */
export function withWholeDish(sheet: PhotoSheet, dishId: string, fill: number, grams: readonly (number | null)[]): PhotoSheet | null {
  const rows = sheetRows(sheet);
  const sharing = rows.flatMap((r, i) => (r.own === null ? [{ key: r.key, grams: grams[i] ?? null }] : []));
  if (sharing.length === 0 || sharing.some((r) => r.grams === null)) return null;
  const shares = sharesOf(sharing.map((r) => r.grams ?? 0));
  return sharing.reduce(
    (next, r, i) => withRowAmount(next, r.key, { measure: dishMeasure(dishId), amount: String(fill), share: shares[i] ?? 1 }),
    sheet,
  );
}
