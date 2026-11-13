// Heart rate from a chest strap or a watch (ROADMAP Stage 5 item 37f-i). Every strap, and every watch
// whose heart rate broadcast is on, sends it in the Bluetooth Heart Rate service's one shape (Bluetooth
// SIG, Heart Rate Service 1.0, §3.1, Heart Rate Measurement 0x2A37): a flags byte, then the heart rate
// in one byte or two, then what the flags say follows (energy, the time between beats). Only the heart
// rate is read. Pure: the same bytes always give the same reading.
import { z } from "zod";
import { PACE_LINE_MOST, RUN_MAX_ELAPSED_MS, RUN_MAX_POINTS, cleanPauses, type RunPause } from "./runMaths.js";

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

// ── Pairing a monitor whose address changes (37f-ii-b) ─────────────────────────────────────────────
// Most watches, and phones and laptops sending a heart rate, change their Bluetooth address every few
// minutes (a "resolvable private address"), so a phone told only the address picked loses them. Paired once,
// Android knows them by their own lasting address (their "identity address") and finds them whatever address
// they show. Android gives an app no way to ask a paired device's lasting address, so it is read from the
// phone's own list of paired devices: the one device that joined it while this monitor was paired.

/** A monitor heard while looking (the Android code's "found"): its address, its name, how strongly it is
 *  heard, and what kind of address Android says it is (Android 15 and later; "unknown" before). */
export const heartFoundSchema = z.object({
  id: z.string().min(1).max(64),
  name: z
    .string()
    .catch("")
    .transform((name) => name.slice(0, 100)),
  rssi: z.number().catch(-100),
  type: z.enum(["public", "random", "unknown"]).catch("unknown"),
});
export type HeartFound = z.infer<typeof heartFoundSchema>;

/** The phone's list of paired devices' addresses (the Android code's `bonded`). */
export const phoneBondedSchema = z.array(z.string().min(1).max(64)).max(1000);

/** A paired-or-not change Android tells the app of (the Android code's "bond"), for any device. */
export const heartBondSchema = z.object({ device: z.string().min(1).max(64), state: z.enum(["bonded", "bonding", "none"]) });

const BLUETOOTH_ADDRESS = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/;

/** Whether a monitor's address is one that changes and that pairing can follow: a random address whose two
 *  highest bits are 0 and 1 (Bluetooth's resolvable private address). A public address (Android 15 says
 *  which) never changes. Before Android 15 the kind is unknown, and the bits alone decide: a strap whose
 *  fixed address happens to begin so is asked to pair too. It costs that person Android's pairing box once;
 *  Cancel or a refusal is seen at once and keeps it at its address, where it is found (round one, L2). */
export function addressChanges(address: string, type: HeartFound["type"]): boolean {
  const upper = address.toUpperCase();
  if (type === "public" || !BLUETOOTH_ADDRESS.test(upper)) return false;
  const first = Number.parseInt(upper.slice(0, 2), 16);
  return first >> 6 === 1;
}

/** The lasting address to keep after pairing `picked`: `picked` itself where the list holds it, else the
 *  ONE address that joined the list while it was paired. Two that joined together (another device paired at
 *  the same moment), or none, is no answer: the monitor is kept at the address picked, never at a guess. */
export function pairedAddress(picked: string, before: readonly string[], after: readonly string[]): string | null {
  const up = (a: string) => a.toUpperCase();
  const was = new Set(before.map(up));
  const now = [...new Set(after.map(up))];
  if (now.includes(up(picked))) return up(picked);
  const joined = now.filter((a) => !was.has(a) && BLUETOOTH_ADDRESS.test(a));
  return joined.length === 1 ? (joined[0] ?? null) : null;
}

export type HeartBond = z.infer<typeof heartBondSchema>;
export type PairOutcome = { kind: "waiting" } | { kind: "paired"; id: string } | { kind: "notPaired" };

/** Where pairing `picked` stands, from what Android has said since it was asked (`bonds`, in order) and the
 *  paired list before and now. The address picked joining the list is paired, whatever Android's messages
 *  say: on a Moto g35 (Android 15) the list named the laptop at the address picked, and the app never saw
 *  a message saying so (37f-ii-b's walk). Else paired only once Android says THE ONE PICKED is paired; the
 *  address to keep is then `pairedAddress`'s, and never a device Android said was pairing apart from it
 *  (earbuds paired at the same moment). Android saying the one picked is not paired (the person said
 *  Cancel, or the monitor refused) is not paired; anything else is still waiting, and the app gives up
 *  after a while. */
export function pairOutcome(picked: string, before: readonly string[], after: readonly string[], bonds: readonly HeartBond[]): PairOutcome {
  const up = (a: string) => a.toUpperCase();
  const mine = up(picked);
  if (after.some((a) => up(a) === mine) && !before.some((a) => up(a) === mine)) return { kind: "paired", id: mine };
  const others = new Set(bonds.filter((b) => up(b.device) !== mine).map((b) => up(b.device)));
  const myLast = [...bonds].reverse().find((b) => up(b.device) === mine);
  if (myLast === undefined || myLast.state === "bonding") return { kind: "waiting" };
  if (myLast.state === "none") return { kind: "notPaired" };
  const id = pairedAddress(picked, before, after);
  return id === null || others.has(id) ? { kind: "notPaired" } : { kind: "paired", id };
}

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

/** Each reading as the stretch of the run it stands for, [from ms, to ms, bpm], in order: a reading
 *  inside a pause is left out, and each stands until the next (HEART_STANDS_MS at most) and never into
 *  a pause or past the finish, so a stretch with many readings counts no more than one with few. A
 *  reading that stands for no time is in none (37f-i round one, L3). The run's average, its highest,
 *  its line and its zones are all read from these, so the four can never disagree. */
export function heartStretches(samples: readonly HeartSample[], pauses: readonly RunPause[], elapsedMs: number): [number, number, number][] {
  const elapsed = Math.max(0, Math.min(elapsedMs, RUN_MAX_ELAPSED_MS));
  const paused = cleanPauses(pauses, elapsed);
  const inOrder = samples.filter(([at, bpm]) => at >= 0 && at <= elapsed && bpm >= HEART_BPM_LEAST && bpm <= HEART_BPM_MOST).slice().sort((a, b) => a[0] - b[0]);
  const out: [number, number, number][] = [];
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
    if (end > at) out.push([at, end, bpm]);
  }
  return out;
}

const heartMs = (stretches: readonly (readonly [number, number, number])[]): number => stretches.reduce((sum, [from, to]) => sum + (to - from), 0);

/** A run's average and highest heart rate, over its time running (`heartStretches`). Null with less
 *  than HEART_LEAST_MS of it. */
export function heartSums(samples: readonly HeartSample[], pauses: readonly RunPause[], elapsedMs: number): { avg: number; max: number } | null {
  return heartSumsFrom(heartStretches(samples, pauses, elapsedMs));
}

/** One reading's stretch of the run (`heartStretches`): from, to, beats a minute. */
export type HeartStretch = readonly [fromMs: number, toMs: number, bpm: number];

/** `heartSums` from stretches already worked out, so a save works them out once for all three numbers. */
export function heartSumsFrom(stretches: readonly HeartStretch[]): { avg: number; max: number } | null {
  const counted = heartMs(stretches);
  if (counted < HEART_LEAST_MS) return null;
  const weighted = stretches.reduce((sum, [from, to, bpm]) => sum + bpm * (to - from), 0);
  return { avg: Math.round(weighted / counted), max: stretches.reduce((top, [, , bpm]) => Math.max(top, bpm), 0) };
}

// ── The heart rate chart and the five heart rate zones (ROADMAP Stage 5 37f-ii-a) ─────────────────

/** The heart rate under the pace chart: at each of the pace line's places (RunSums' `paceSpans`), the
 *  heart rate over the stretch of the run it stands for, weighted by time; 0 where there is none (the
 *  monitor had no signal there). Empty for a run with no heart rate (`heartSums` null) or no pace line. */
export function heartLineOf(samples: readonly HeartSample[], pauses: readonly RunPause[], elapsedMs: number, spans: readonly (readonly [number, number])[]): number[] {
  return heartLineFrom(heartStretches(samples, pauses, elapsedMs), spans);
}

/** `heartLineOf` from stretches already worked out. */
export function heartLineFrom(stretches: readonly HeartStretch[], spans: readonly (readonly [number, number])[]): number[] {
  if (spans.length < 2 || heartMs(stretches) < HEART_LEAST_MS) return [];
  let k = 0;
  return spans.map(([from, to]) => {
    // The spans go forward in time, so a stretch that ended before this span ended before the next.
    while (k < stretches.length && (stretches[k]?.[1] ?? 0) <= from) k++;
    let weighted = 0;
    let ms = 0;
    for (let j = k; j < stretches.length; j++) {
      const s = stretches[j];
      if (s === undefined || s[0] >= to) break;
      const overlap = Math.min(s[1], to) - Math.max(s[0], from);
      if (overlap > 0) {
        weighted += s[2] * overlap;
        ms += overlap;
      }
    }
    return ms > 0 ? Math.round(weighted / ms) : 0;
  });
}

/** A heart rate line as it is kept and sent: 0 for a place with no heart rate, else a heart's own. */
export const heartLineSchema = z
  .array(z.number().int().refine((v) => v === 0 || (v >= HEART_BPM_LEAST && v <= HEART_BPM_MOST), { message: "not a heart rate" }))
  .max(PACE_LINE_MOST);

/** A maximum heart rate a person may type for themselves: what a lab or a hard test measures. */
export const HEART_MAX_LEAST = 100;
export const HEART_MAX_MOST = 230;
export const heartMaxSchema = z.number().int().min(HEART_MAX_LEAST).max(HEART_MAX_MOST);

/** The maximum heart rate the zones are worked from: the person's own where they typed one, else 220
 *  less their age (the age-based default of Garmin, Polar and Strava, which each let a person type their
 *  own). Null with neither: the zones are never guessed. */
export function heartMaxOf(own: number | null, age: number | null): number | null {
  if (own !== null && Number.isInteger(own) && own >= HEART_MAX_LEAST && own <= HEART_MAX_MOST) return own;
  if (age !== null && Number.isInteger(age) && age >= 1 && age <= 120) return 220 - age;
  return null;
}

/** The five heart rate zones (Polar's and Garmin's five, each beginning at a share of the maximum heart
 *  rate: 50, 60, 70, 80 and 90 %). Zone 1 also holds anything under 50 %, as Strava's does, so the five
 *  add up to the run's time with a heart rate; zone 5 holds anything over the maximum. */
export const HEART_ZONES = [
  { zone: 1, name: "Very light", from: 0.5 },
  { zone: 2, name: "Light", from: 0.6 },
  { zone: 3, name: "Moderate", from: 0.7 },
  { zone: 4, name: "Hard", from: 0.8 },
  { zone: 5, name: "Maximum", from: 0.9 },
] as const;
export type HeartZoneNumber = (typeof HEART_ZONES)[number]["zone"];

/** The beats a minute each zone begins at, for a maximum: zone 1's (its own 50 %, for the words only),
 *  then zone 2's, 3's, 4's and 5's. */
export function heartZoneEdges(max: number): [number, number, number, number, number] {
  // In tenths, so a half rounds up as it does by hand (175 x 0.7 is 122.49999 in floating point).
  const at = (tenths: number): number => Math.round((max * tenths) / 10);
  return [at(5), at(6), at(7), at(8), at(9)];
}

/** The zone a heart rate is in, for a maximum. */
export function heartZoneOf(bpm: number, max: number): HeartZoneNumber {
  const [, z2, z3, z4, z5] = heartZoneEdges(max);
  return bpm >= z5 ? 5 : bpm >= z4 ? 4 : bpm >= z3 ? 3 : bpm >= z2 ? 2 : 1;
}

export type HeartZoneSeconds = [number, number, number, number, number];

/** The time a run spent in each zone, whole seconds, zone 1 first, for the maximum it was run with.
 *  They add up to the run's whole seconds with a heart rate (the largest remainders round up). Null
 *  where the run has no heart rate (`heartSums` null) or there is no maximum. */
export function heartZoneSeconds(samples: readonly HeartSample[], pauses: readonly RunPause[], elapsedMs: number, max: number | null): HeartZoneSeconds | null {
  return max === null ? null : heartZoneSecondsFrom(heartStretches(samples, pauses, elapsedMs), max);
}

/** `heartZoneSeconds` from stretches already worked out. */
export function heartZoneSecondsFrom(stretches: readonly HeartStretch[], max: number): HeartZoneSeconds | null {
  const total = heartMs(stretches);
  if (total < HEART_LEAST_MS) return null;
  const ms = [0, 0, 0, 0, 0];
  for (const [from, to, bpm] of stretches) {
    const i = heartZoneOf(bpm, max) - 1;
    ms[i] = (ms[i] ?? 0) + (to - from);
  }
  const whole = ms.map((v) => Math.floor(v / 1000));
  let short = Math.round(total / 1000) - whole.reduce((a, b) => a + b, 0);
  const byRemainder = ms.map((v, i) => ({ i, r: v % 1000 })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of byRemainder) {
    if (short <= 0) break;
    whole[i] = (whole[i] ?? 0) + 1;
    short--;
  }
  return [whole[0] ?? 0, whole[1] ?? 0, whole[2] ?? 0, whole[3] ?? 0, whole[4] ?? 0];
}

const zoneSecondsSchema = z.number().int().nonnegative().max(RUN_MAX_ELAPSED_MS / 1000);
/** A run's zones as kept and shown: the maximum they were worked from, and the seconds in each. A
 *  maximum from an age (220 less 18 to 120) or the person's own. */
export const heartZonesSchema = z.object({
  max: z.number().int().min(HEART_MAX_LEAST).max(HEART_MAX_MOST),
  seconds: z.tuple([zoneSecondsSchema, zoneSecondsSchema, zoneSecondsSchema, zoneSecondsSchema, zoneSecondsSchema]),
});
export type HeartZones = z.infer<typeof heartZonesSchema>;

/** GET and PUT /v1/geo/heart-max: the person's own maximum (null for none), the one from their age
 *  (null without an age), and the one the zones use now (null with neither). */
export const heartMaxResponseSchema = z.object({
  own: heartMaxSchema.nullable(),
  fromAge: z.number().int().positive().nullable(),
  max: z.number().int().positive().nullable(),
});
export type HeartMaxResponse = z.infer<typeof heartMaxResponseSchema>;
export const putHeartMaxRequestSchema = z.object({ own: heartMaxSchema.nullable() }).strict();
export type PutHeartMaxRequest = z.infer<typeof putHeartMaxRequestSchema>;
