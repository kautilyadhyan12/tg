// The heart rate monitor the person connected (ROADMAP Stage 5 item 37f-i): a chest strap, or a watch
// whose heart rate broadcast is on. Connected once, in Settings or on the Running page, and kept on this
// phone for this person (a file naming them, so it goes with their account). A run reads it; a workout
// (item 64) will read the same.
//
// THE WORST THING HERE: a heart rate that is not the person's shown as theirs, so they push harder than is
// safe. So a reading counts only from the one monitor the app was told to watch, by its Bluetooth address,
// never another strap near by with the same name; a reading the strap says has no skin under it, or that
// no heart beats, is no reading (`heartReadingOf`); and a reading older than HEART_FRESH_MS is never shown
// as now: the screen says No signal.
import { useEffect, useReducer, useSyncExternalStore } from "react";
import { PermissionsAndroid, Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import {
  addressChanges,
  heartBondSchema,
  heartReadingOf,
  keptHeartMonitorSchema,
  pairOutcome,
  phoneBondedSchema,
  phoneHeartSamplesSchema,
  type HeartBond,
  type HeartFound,
} from "@app/shared";
import { heartNative, type HeartNative } from "./heartNative";

/** A reading older than this is not the heart rate now. Straps send one a second. */
export const HEART_FRESH_MS = 5000;
/** At most this many readings wait for the run to take them (hours of one a second). */
const PENDING_MOST = 20_000;

export interface Monitor {
  /** Its Bluetooth address. */
  id: string;
  /** What it calls itself ("Polar H10 9EF6E824"); "" when it says nothing. */
  name: string;
}
export interface Reading {
  /** The phone's clock, ms since 1970. */
  at: number;
  bpm: number;
}

/** Where the monitor is kept: a file, or a test's stand-in. */
export interface HeartFiles {
  read: (name: string) => Promise<string | null>;
  write: (name: string, text: string) => Promise<void>;
  remove: (name: string) => void;
}
const phoneFiles: HeartFiles = {
  read: async (name) => {
    const file = new File(Paths.document, name);
    return file.exists ? await file.text() : null;
  },
  write: (name, text) => {
    const file = new File(Paths.document, name);
    if (!file.exists) file.create();
    file.write(text);
    return Promise.resolve();
  },
  remove: (name) => {
    const file = new File(Paths.document, name);
    if (file.exists) file.delete();
  },
};
const fileFor = (userId: string) => `heart-monitor-${userId}.json`;

let native: HeartNative | null = heartNative;
let files: HeartFiles = phoneFiles;
let person: string | null = null;
let saved: Monitor | null = null;
/** What the Bluetooth code was told to watch; null for nothing. */
let watching: string | null = null;
/** A monitor picked in the box and not yet saved: watched in place of the saved one while it is tried. */
let trying: string | null = null;
let holds = 0;
/** Bumped by resetHeart: a hold taken before it is not let go after it. */
let generation = 0;
let latest: (Reading & { device: string }) | null = null;
let pending: Reading[] = [];
let changes = 0;
const listeners = new Set<() => void>();

const same = (a: string | null, b: string | null): boolean => a !== null && b !== null && a.toUpperCase() === b.toUpperCase();
const tell = () => {
  changes += 1;
  for (const l of listeners) l();
};

export function subscribeHeart(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const heartChanges = (): number => changes;
export const monitorNow = (): Monitor | null => saved;

/** Tests hand in their own Bluetooth and files, and start from nothing. */
export function resetHeart(withNative: HeartNative | null = heartNative, withFiles: HeartFiles = phoneFiles): void {
  native = withNative;
  files = withFiles;
  person = null;
  saved = null;
  watching = null;
  trying = null;
  holds = 0;
  generation += 1;
  latest = null;
  pending = [];
  tell();
}

function rewatch(): void {
  const target = trying ?? (holds > 0 ? (saved?.id ?? null) : null);
  if (same(target, watching) || (target === null && watching === null)) return;
  watching = target;
  latest = null;
  if (native === null) return;
  if (target === null) native.unwatch();
  else native.watch(target);
}

/** This person's monitor, read once they are signed in. Anything unreadable is no monitor. */
export async function loadMonitor(userId: string): Promise<void> {
  if (person === userId) return;
  person = userId;
  saved = null;
  try {
    const text = await files.read(fileFor(userId));
    const kept = text === null ? null : keptHeartMonitorSchema.safeParse(JSON.parse(text));
    if (person === userId && kept?.success === true) saved = kept.data;
  } catch {
    // No monitor.
  }
  rewatch();
  tell();
}

export async function saveMonitor(monitor: Monitor): Promise<void> {
  if (person === null) return;
  saved = { id: monitor.id, name: monitor.name.slice(0, 100) };
  trying = null;
  await files.write(fileFor(person), JSON.stringify(saved));
  rewatch();
  tell();
}

export function forgetMonitor(): void {
  if (person !== null) files.remove(fileFor(person));
  saved = null;
  pending = [];
  rewatch();
  tell();
}

/** Keep the saved monitor connected while something shows or records its heart rate. */
export function holdHeart(): () => void {
  holds += 1;
  rewatch();
  const mine = generation;
  let released = false;
  return () => {
    if (released || mine !== generation) return;
    released = true;
    holds -= 1;
    rewatch();
  };
}

/** Watch a monitor picked in the box, in place of the saved one, until `endTry`. */
export function tryMonitor(id: string): void {
  trying = id;
  rewatch();
  tell();
}
export function endTry(): void {
  trying = null;
  rewatch();
  tell();
}
export const tryingNow = (): string | null => trying;

/** Takes what the Bluetooth code has kept since the last look. Only the watched monitor's readings
 *  count; the saved one's wait for the run (`takeHeartReadings`), a monitor being tried keeps none. */
export function pullHeart(): void {
  if (native === null) return;
  const parsed = phoneHeartSamplesSchema.safeParse(native.take());
  if (!parsed.success) return;
  let moved = false;
  for (const sample of parsed.data) {
    if (!same(sample.device, watching)) continue;
    const reading = heartReadingOf(sample.bytes);
    if (reading === null) continue;
    // Readings come in the order the monitor sent them: the newest to come is the heart rate now, even
    // where the phone's clock was moved back since the one before.
    latest = { device: sample.device, at: sample.at, bpm: reading.bpm };
    moved = true;
    if (trying === null && same(sample.device, saved?.id ?? null)) {
      pending.push({ at: sample.at, bpm: reading.bpm });
      if (pending.length > PENDING_MOST) pending = pending.slice(-PENDING_MOST);
    }
  }
  if (moved) tell();
}

/** The saved monitor's readings since the run last took them. */
export function takeHeartReadings(): Reading[] {
  pullHeart();
  const out = pending;
  pending = [];
  return out;
}

/** The heart rate now from the watched monitor, or null: none yet, another monitor's, or older than
 *  HEART_FRESH_MS. */
export function heartNow(now: number): number | null {
  if (latest === null || !same(latest.device, watching)) return null;
  if (now - latest.at > HEART_FRESH_MS || latest.at - now > HEART_FRESH_MS) return null;
  return latest.bpm;
}

/** The heart rate now from the person's SAVED monitor, for the run's voice (37f-ii-b): null while another
 *  is tried in the box, when the saved one is not the one watched, or as heartNow. */
export function savedHeartNow(now: number): number | null {
  pullHeart();
  if (trying !== null || !same(watching, saved?.id ?? null)) return null;
  return heartNow(now);
}

// ── Pairing a monitor whose address changes (37f-ii-b) ──────────────────────────────────────────────

/** How long Android's pairing box waits for the person before the monitor is kept unpaired. */
export const PAIR_WAIT_MS = 60_000;
/** The paired list is read again this often while pairing: Android's own message may name another address. */
const PAIR_LOOK_MS = 1000;
export type Paired = { kind: "paired"; id: string } | { kind: "notPaired" } | { kind: "notNeeded" };

/** The addresses of the devices paired with this phone. */
export function bondedNow(): string[] {
  if (native === null) return [];
  const parsed = phoneBondedSchema.safeParse(native.bonded());
  return parsed.success ? parsed.data : [];
}
export const isPaired = (id: string): boolean => bondedNow().some((a) => same(a, id));

/** Whether Save pairs this monitor first: its address changes, and it is not paired at it already. */
export const needsPairing = (found: HeartFound): boolean => native !== null && addressChanges(found.id, found.type) && !isPaired(found.id);

/** Pairs a monitor whose address changes, so Android finds it whatever address it shows: the lasting
 *  address to keep, once Android says the one picked is paired (`pairOutcome`). One with a fixed address,
 *  or already paired at the address picked, needs none. Cancel, a refusal, or no answer in PAIR_WAIT_MS is
 *  not paired: it is kept at the address picked. Android's messages are read as they come, and the one picked
 *  is also asked each PAIR_LOOK_MS, so Cancel is seen at once where a message is lost (round one, H1). */
export function pairMonitor(found: HeartFound, waitMs: number = PAIR_WAIT_MS): Promise<Paired> {
  const bt = native;
  if (bt === null || !needsPairing(found)) return Promise.resolve({ kind: "notNeeded" });
  const before = bondedNow();
  return new Promise((resolve) => {
    const bonds: HeartBond[] = [];
    let done = false;
    let listening: { remove: () => void } | null = null;
    let late: ReturnType<typeof setTimeout> | null = null;
    let looking: ReturnType<typeof setInterval> | null = null;
    const finish = (out: Paired) => {
      if (done) return;
      done = true;
      listening?.remove();
      if (late !== null) clearTimeout(late);
      if (looking !== null) clearInterval(looking);
      resolve(out);
    };
    const look = () => {
      const asked = bt.bondState(found.id);
      const after = bondedNow();
      const mineLast = [...bonds].reverse().find((b) => same(b.device, found.id))?.state;
      const began = bonds.some((b) => same(b.device, found.id) && b.state === "bonding");
      // "none" counts only after it was pairing: before Android begins, the one picked reads "none" too. "bonded"
      // counts once the paired list has changed: read a moment before the list catches up, it would find nothing
      // new and end not paired (round one's re-check, L5); the next look sees both.
      const listChanged = after.some((a) => !before.some((b) => same(a, b)));
      const counts = asked === "bonding" || (asked === "bonded" && listChanged) || (asked === "none" && began);
      if (counts && asked !== mineLast) bonds.push({ device: found.id, state: asked });
      const out = pairOutcome(found.id, before, after, bonds);
      if (out.kind !== "waiting") finish(out);
    };
    listening = bt.addListener("bond", (raw) => {
      const bond = heartBondSchema.safeParse(raw);
      if (!bond.success) return;
      bonds.push(bond.data);
      look();
    });
    looking = setInterval(look, PAIR_LOOK_MS);
    late = setTimeout(() => {
      // One last look: paired in the last moment is paired.
      look();
      finish({ kind: "notPaired" });
    }, waitMs);
    const answer = bt.pair(found.id);
    // Android says it is paired already: it finds it, as it does any device it has paired (round one, L1).
    if (answer === "already") finish({ kind: "paired", id: found.id });
    else if (answer !== "started") finish({ kind: "notPaired" });
  });
}

export type BluetoothState = "none" | "denied" | "off" | "on";
export function bluetoothState(): BluetoothState {
  if (native === null) return "none";
  const radio = native.radio();
  if (radio === "none") return "none";
  if (!native.allowed()) return "denied";
  return radio === "on" ? "on" : "off";
}

/** Android's "Nearby devices" (12 and later), or the location older Androids need to find a monitor.
 *  "blocked": the person said Don't allow before, so only the app's settings can change it. */
export async function askNearby(): Promise<"granted" | "denied" | "blocked"> {
  if (Platform.OS !== "android") return "denied";
  const needs =
    typeof Platform.Version === "number" && Platform.Version >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const answers = await PermissionsAndroid.requestMultiple(needs);
  const said = needs.map((p) => answers[p]);
  if (said.every((a) => a === PermissionsAndroid.RESULTS.GRANTED)) return "granted";
  return said.some((a) => a === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) ? "blocked" : "denied";
}

export const askBluetoothOn = (): void => {
  native?.askRadio();
};

export function useMonitor(): Monitor | null {
  return useSyncExternalStore(subscribeHeart, monitorNow);
}

/** While `active`: the saved monitor kept connected, read each second; the heart rate now, or null. */
export function useHeartNow(active: boolean): { monitor: Monitor | null; bpm: number | null; bluetooth: BluetoothState } {
  const monitor = useMonitor();
  useSyncExternalStore(subscribeHeart, heartChanges);
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!active || monitor === null) return;
    const release = holdHeart();
    const every = setInterval(() => {
      pullHeart();
      tick();
    }, 1000);
    return () => {
      clearInterval(every);
      release();
    };
  }, [active, monitor]);
  return { monitor, bpm: monitor === null ? null : heartNow(Date.now()), bluetooth: bluetoothState() };
}
