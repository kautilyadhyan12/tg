// The phone's own runs judged by the laptop's count and reasons, never by its numbers (spec Part 2 §12.5; ROADMAP 52a-iii).
//
// The phone's chosen set-up (full model, main chip, 4 cores; 51b-ii) read the laptop's own pictures of every proof video,
// asked for one person (phone-test --pictures laptop --people 1). Asked for one, the phone's points drift a centimetre or so
// from the laptop's (51b-i), so its points are never compared here: each video is played through the same movement twice,
// once from the laptop's kept file and once from the phone's, and the phone is the same only when what a person would be
// told is the same:
//   - the count;
//   - every rep that says something on the screen (counted; short, with the rule that fell short; unseen, where the camera
//     could not judge it), in the same order, each the same verdict and the same rule, at the same place in the video (the
//     two reps overlap);
//   - for a movement counted one side at a time (52c-i), each of those reps' side, the leg a lunge is given;
//   - for an exercise's form check (52b-ii-a), the mistakes marked in each rep both count, paired by when it was (so
//     even where the two count apart), the same ones;
//   - and the coach's lines, once there are any (53 makes them): until then there is nothing more to compare.
// A dip read as another movement says nothing and is not compared, only counted in the table.
// A phone file is judged only when it is the phone's own reading of the very frames of the kept file under its name, from
// the chosen set-up; anything else is refused and never judged, and a video with no phone file is never "the same": the
// table is all the same only when every video has a judged phone run and each is the same.
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { phonePointsManifestSchema, type ExerciseCamera, type Movement, type PhonePointsManifest } from "@app/shared";
import type { RepResult } from "../src/index.js";
import { KEPT_MODEL } from "./keptVideos.js";
import { readKept, type KeptFile, type Video } from "./bodyCheck.js";
import { LEAD_IN, runMovement, type Run } from "./movementCheck.js";
import { MOVEMENT_VIDEOS, framesOf, labelOf, type MovementVideo } from "./movementVideos.js";
import { PHONE_GAPS, phoneLabel } from "./replays.js";

const TEST = join(import.meta.dirname, "../test");

/** The phone's chosen set-up (51b-ii's pick), by the name its runs carry. */
export const CHOSEN_RUN = PHONE_GAPS[0].run;

/** Two frames are the same frame when their times are this close, ms (the phone writes the laptop's own times). */
const SAME_TIME = 0.5;

/** Where the phone's run of a proof video is kept. */
export function phoneFileOf(entry: MovementVideo, run: string = CHOSEN_RUN): string {
  return join(TEST, "phone-points", `${basename(entry.file)}.${run}.bodypoints`);
}

/** Why a phone file cannot be judged against the kept file, or null when it can: it must be the phone's reading, from the
 *  chosen set-up, under the kept file's own phone label, of the very frames the kept file holds, and read against this
 *  very kept file (`madeFrom`: the kept file's check number the manifest wrote for it; null when none was written). */
export function refusal(kept: KeptFile, phone: KeptFile, madeFrom: string | null, run: string = CHOSEN_RUN): string | null {
  const h = phone.header;
  if (h.source !== "phone") return "it is not the phone's reading";
  if (madeFrom === null) return "the manifest names no kept file it was read against";
  if (madeFrom !== kept.sha256) return "it was read against another kept file: the video was measured again since";
  if (h.label !== phoneLabel(kept.header.label, run)) return `it is labelled ${h.label}, not ${phoneLabel(kept.header.label, run)}: another video or another set-up`;
  if (h.model.file !== KEPT_MODEL.file || h.model.people !== KEPT_MODEL.people) return "it is not the phone's own model asked for one person";
  if (h.fps !== kept.header.fps || h.picture.width !== kept.header.picture.width || h.picture.height !== kept.header.picture.height) {
    return "it was read at another rate or from pictures of another size";
  }
  if (phone.frames.length !== kept.frames.length) return `it holds ${String(phone.frames.length)} frames, the kept file ${String(kept.frames.length)}`;
  const off = phone.frames.findIndex((f, k) => Math.abs(f.t - (kept.frames[k]?.t ?? Number.NaN)) > SAME_TIME);
  if (off >= 0) return `its frame ${String(off + 1)} is at another time than the kept file's`;
  return null;
}

/** What a rep says on the screen: every rep but another movement's dip, which says nothing. */
export const says = (r: RepResult): boolean => r.verdict !== "other";

/** A rep in words, at its time in the video (a run holds a lead-in first). */
const repWords = (r: RepResult): string => `${((r.start - LEAD_IN) / 1000).toFixed(1)} s ${r.verdict}${r.rule === null ? "" : ` (${r.rule})`}`;
const overlap = (a: RepResult, b: RepResult): boolean => a.start < b.end && b.start < a.end;
/** The mistakes marked made in a rep, in its exercise file's order. */
const madeIn = (r: RepResult): string => r.form.filter((f) => f.status === "made").map((f) => f.mistake).join(", ");
const overlapMs = (a: RepResult, b: RepResult): number => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

/** Each rep both runs counted, paired by when it was (the phone's rep overlapping the laptop's most, and the other way
 *  round), with the mistakes each marked in it: compared even where the two count apart. */
export function pairedMarks(laptop: Run, phone: Run): { at: string; laptop: string; phone: string }[] {
  const counted = (run: Run): RepResult[] => run.reps.filter((r) => r.verdict === "counted");
  const best = (r: RepResult, among: readonly RepResult[]): RepResult | undefined =>
    among.reduce<RepResult | undefined>((top, x) => (overlapMs(r, x) > (top === undefined ? 0 : overlapMs(r, top)) ? x : top), undefined);
  const a = counted(laptop);
  const b = counted(phone);
  return a.flatMap((x) => {
    const y = best(x, b);
    return y === undefined || best(y, a) !== x ? [] : [{ at: repWords(x), laptop: madeIn(x), phone: madeIn(y) }];
  });
}

/** What differs between the laptop's run and the phone's, in words; empty when a person would be told the same. */
export function differences(laptop: Run, phone: Run): string[] {
  const out: string[] = [];
  if (laptop.count !== phone.count) out.push(`the laptop counts ${String(laptop.count)}, the phone ${String(phone.count)}`);
  const a = laptop.reps.filter(says);
  const b = phone.reps.filter(says);
  for (let k = 0; k < Math.max(a.length, b.length); k++) {
    const x = a[k];
    const y = b[k];
    if (x === undefined && y !== undefined) out.push(`the phone also says ${repWords(y)}`);
    else if (y === undefined && x !== undefined) out.push(`the phone does not say ${repWords(x)}`);
    else if (x !== undefined && y !== undefined && (x.verdict !== y.verdict || x.rule !== y.rule || !overlap(x, y))) {
      out.push(`the laptop says ${repWords(x)}, the phone ${repWords(y)}`);
    } else if (x !== undefined && y !== undefined && x.side !== y.side) {
      // A movement counted one side at a time (52c-i): the same rep given another leg is told differently.
      out.push(`the laptop says ${repWords(x)} on the ${x.side ?? "unknown"} leg, the phone on the ${y.side ?? "unknown"} leg`);
    }
  }
  for (const p of pairedMarks(laptop, phone)) {
    if (p.laptop !== p.phone) out.push(`at ${p.at} the laptop marks ${p.laptop || "no mistake"}, the phone ${p.phone || "no mistake"}`);
  }
  return out;
}

export type PhoneVerdict = "same" | "differs" | "refused" | "no run";

export interface PhoneRow {
  readonly label: string;
  readonly entry: MovementVideo;
  readonly verdict: PhoneVerdict;
  /** The differences, the refusal, or why there is no run. */
  readonly why: readonly string[];
  readonly laptop: Run;
  readonly phone: Run | null;
}

const asVideo = (file: KeptFile): Video => ({ label: file.header.label, frames: file.frames, sets: false, why: "judged, never setting a number" });

/** One proof video: the laptop's kept file against the phone's file (null: none was kept). */
export function judgePhone(movement: Movement, entry: MovementVideo, kept: KeptFile, phone: KeptFile | null, madeFrom: string | null, run: string = CHOSEN_RUN, exercise: ExerciseCamera | null = null): PhoneRow {
  const laptop = runMovement(movement, asVideo(kept), exercise);
  const label = kept.header.label;
  if (phone === null) return { label, entry, verdict: "no run", why: ["the phone has not run this video"], laptop, phone: null };
  const refused = refusal(kept, phone, madeFrom, run);
  if (refused !== null) return { label, entry, verdict: "refused", why: [refused], laptop, phone: null };
  const phoneRun = runMovement(movement, asVideo(phone), exercise);
  const diff = differences(laptop, phoneRun);
  return { label, entry, verdict: diff.length === 0 ? "same" : "differs", why: diff, laptop, phone: phoneRun };
}

const readFile = (path: string): KeptFile => readKept(new Uint8Array(readFileSync(path)));

/** test/phone-points/manifest.json, read through its schema; empty when there is none. */
export function readManifest(): PhonePointsManifest {
  const path = join(TEST, "phone-points", "manifest.json");
  return existsSync(path) ? phonePointsManifestSchema.parse(JSON.parse(readFileSync(path, "utf8"))) : { files: {} };
}

/** Every proof video, the laptop against the phone's kept run of it; with `exercise`, its mistakes judged too. */
export function phoneTable(movement: Movement, entries: readonly MovementVideo[] = MOVEMENT_VIDEOS, run: string = CHOSEN_RUN, exercise: ExerciseCamera | null = null): PhoneRow[] {
  const manifest = readManifest();
  // A set of a video (`cut`) is the same stretch of both files: the phone writes the laptop's own frame times.
  const cutOf = (entry: MovementVideo, file: KeptFile): KeptFile => ({ ...file, frames: framesOf(entry, file.frames) });
  return entries.map((entry) => {
    const kept = readFile(join(TEST, `${entry.file}.bodypoints`));
    const path = phoneFileOf(entry, run);
    const phone = existsSync(path) ? cutOf(entry, readFile(path)) : null;
    const row = judgePhone(movement, entry, cutOf(entry, kept), phone, manifest.files[basename(path)]?.kept ?? null, run, exercise);
    return { ...row, label: labelOf(entry, row.label) };
  });
}

/** A known open case that differs exactly as its note says, no more and no less. */
export const asWritten = (r: PhoneRow): boolean =>
  r.verdict === "differs" && r.entry.phoneOpen !== undefined && JSON.stringify(r.why) === JSON.stringify(r.entry.phoneOpen.differences);

/** The table holds only when every video has a judged phone run and each is the same. */
export const allSame = (rows: readonly PhoneRow[]): boolean => rows.length > 0 && rows.every((r) => r.verdict === "same");
