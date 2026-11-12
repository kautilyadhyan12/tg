// Heart rate from a chest strap or a watch (ROADMAP Stage 5 item 37f-i). Every strap, and every watch
// whose heart rate broadcast is on, sends it in the Bluetooth Heart Rate service's one shape (Bluetooth
// SIG, Heart Rate Service 1.0, §3.1, Heart Rate Measurement 0x2A37): a flags byte, then the heart rate
// in one byte or two, then what the flags say follows (energy, the time between beats). Only the heart
// rate is read. Pure: the same bytes always give the same reading.
import { z } from "zod";
import { RUN_MAX_ELAPSED_MS, RUN_MAX_POINTS, cleanPauses, type RunPause } from "./runMaths.js";

export const HEART_SERVICE_UUID = "0000180d-0000-1000-8000-00805f9b34fb";
export const HEART_MEASUREMENT_UUID = "00002a37-0000-1000-8000-00805f9b34fb";

/** Below and above what a heart beats while a person moves. A strap sends 0 while it starts or has
 *  slipped (polar-ble-sdk issue 197: "HR=0 that is Almost Certainly Invalid"); such a number is the
 *  strap's, never a heart rate. */
export const HEART_BPM_LEAST = 30;
export const HEART_BPM_MOST = 240;

/** Whether the strap feels skin: bits 1 and 2 of the flags. "unknown" is a strap that does not say. */
export type SkinContact = "on" | "off" | "unknown";
export interface HeartReading {
  bpm: number;
  contact: SkinContact;
}

const isByte = (b: number): boolean => Number.isInteger(b) && b >= 0 && b <= 255;

/** One notification of Heart Rate Measurement, read; null for anything that is not one. A reading
 *  whose strap says it feels no skin, or outside a heart's own range, is returned as no reading. */
export function heartReadingOf(bytes: readonly number[]): HeartReading | null {
  const flags = bytes[0];
  if (flags === undefined || !bytes.every(isByte)) return null;
  const wide = (flags & 0x01) !== 0;
  const low = bytes[1];
  const high = bytes[2];
  if (low === undefined || (wide && high === undefined)) return null;
  const bpm = wide ? low + (high ?? 0) * 256 : low;
  const status = (flags >> 1) & 0x03;
  const contact: SkinContact = status === 3 ? "on" : status === 2 ? "off" : "unknown";
  if (contact === "off" || bpm < HEART_BPM_LEAST || bpm > HEART_BPM_MOST) return null;
  return { bpm, contact };
}

/** A notification as the phone's Bluetooth code hands it over: which monitor sent it (its Bluetooth
 *  address), when it came (ms since 1970, the phone's clock) and its bytes. */
export const phoneHeartSamplesSchema = z
  .array(
    z.object({
      device: z.string().min(1).max(64),
      at: z.number(),
      bytes: z.array(z.number().int().min(0).max(255)).min(1).max(64),
    }),
  )
  .max(100_000);
export type PhoneHeartSample = z.infer<typeof phoneHeartSamplesSchema>[number];

/** The monitor a person connected, kept on their phone: its Bluetooth address and its own name. */
export const keptHeartMonitorSchema = z.object({ id: z.string().min(1).max(64), name: z.string().max(100) });

/** A heart rate kept with a run: milliseconds into it and beats a minute. */
export type HeartSample = readonly [atMs: number, bpm: number];

/** The heart rate sent with a run (POST /v1/geo/runs): at most one a second, so no more than its
 *  points. Too many is refused before one is read. */
export const heartSamplesSchema = z
  .custom<unknown[]>((value) => !Array.isArray(value) || value.length <= RUN_MAX_POINTS, { message: "too many heart rates" })
  .pipe(z.array(z.tuple([z.number().int().min(0).max(RUN_MAX_ELAPSED_MS), z.number().int().min(HEART_BPM_LEAST).max(HEART_BPM_MOST)])));

/** A reading stands for the time until the next one, and no longer than this: a strap that stopped
 *  for a minute adds nothing for that minute. */
export const HEART_STANDS_MS = 5000;
/** A run with less heart rate than this has none shown: a few seconds are not its average. */
export const HEART_LEAST_MS = 60_000;

/** A run's average and highest heart rate, over its time running: a reading inside a pause is left
 *  out, and each counts for the time until the next (HEART_STANDS_MS at most), so a stretch with many
 *  readings counts no more than one with few. Null with less than HEART_LEAST_MS of it. */
export function heartSums(samples: readonly HeartSample[], pauses: readonly RunPause[], elapsedMs: number): { avg: number; max: number } | null {
  const elapsed = Math.max(0, Math.min(elapsedMs, RUN_MAX_ELAPSED_MS));
  const paused = cleanPauses(pauses, elapsed);
  const inOrder = samples.filter(([at, bpm]) => at >= 0 && at <= elapsed && bpm >= HEART_BPM_LEAST && bpm <= HEART_BPM_MOST).slice().sort((a, b) => a[0] - b[0]);
  let weighted = 0;
  let counted = 0;
  let max = 0;
  let p = 0;
  for (let i = 0; i < inOrder.length; i++) {
    const sample = inOrder[i];
    if (sample === undefined) continue;
    const [at, bpm] = sample;
    while (p < paused.length && (paused[p]?.[1] ?? 0) <= at) p++;
    const pause = paused[p];
    if (pause !== undefined && pause[0] <= at) continue; // inside a pause
    const next = inOrder[i + 1]?.[0] ?? elapsed;
    const end = Math.min(next, at + HEART_STANDS_MS, pause?.[0] ?? elapsed, elapsed);
    const ms = Math.max(0, end - at);
    if (ms <= 0) continue; // a reading that stands for no time is in neither number (round one, L3)
    weighted += bpm * ms;
    counted += ms;
    max = Math.max(max, bpm);
  }
  if (counted < HEART_LEAST_MS) return null;
  return { avg: Math.round(weighted / counted), max };
}
