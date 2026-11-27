// Cutting Kd's recording into the coach's clips (spec Part 2 §12.6; ROADMAP 53b-i), the parts the laptop tool decides
// with: where each wording lies in a part, and whether a clip says its own words. A clip cut or named wrongly would
// speak the wrong advice (§12.6), so every clip is read back as text by a speech reader and must say exactly its own
// wording; one that does not stops the whole cut, and nothing is written.

/** A quiet stretch of a part, seconds. */
export interface Silence {
  readonly start: number;
  readonly end: number;
}

/** One wording's stretch of a part, seconds, padded into the quiet on each side. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/** How quiet is quiet: ffmpeg's silencedetect at -40 dB, held this long (s). Kd's first v4 take (2026-11-27) put 0.27 to
 *  0.59 s between lines where no pause was asked for; with "[long pause]", 0.64 to 1.99 s. */
export const QUIET_DB = -40;
export const QUIET_S = 0.2;
/** The shortest pause taken between two wordings, seconds: "[long pause]" gave 0.64 s and more. A pause inside a line
 *  ("Better. That one counts.") is shorter, and the read-back refuses a clip cut there. */
export const LEAST_GAP = 0.45;
/** Room kept before and after a wording's sound, seconds, inside its pauses: speech starts and ends softer than -40 dB. */
export const PAD_BEFORE = 0.08;
export const PAD_AFTER = 0.15;

/** The quiet stretches in ffmpeg's silencedetect log. A part that ends in silence has no end line for it: it ends at the
 *  part's end. */
export function silencesOf(log: string, duration: number): Silence[] {
  const out: Silence[] = [];
  let start: number | null = null;
  for (const m of log.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    const at = Number(m[2]);
    if (m[1] === "start") start = Math.max(0, at);
    else if (start !== null) {
      out.push({ start, end: at });
      start = null;
    }
  }
  if (start !== null) out.push({ start, end: duration });
  return out;
}

/** Each wording's stretch, for a part of `n` wordings: the cuts are the `n - 1` longest pauses between sounds, each at
 *  least `LEAST_GAP`; a quiet start or end of the part is never a cut. Refused, with why, when the part does not hold
 *  `n` wordings so. */
export function spansOf(silences: readonly Silence[], duration: number, n: number): Span[] | string {
  const inner = silences.filter((s) => s.start > 0.01 && s.end < duration - 0.01);
  const lead = silences.find((s) => s.start <= 0.01);
  const tail = silences.find((s) => s.end >= duration - 0.01);
  const cuts = [...inner]
    .sort((a, b) => b.end - b.start - (a.end - a.start))
    .slice(0, n - 1)
    .sort((a, b) => a.start - b.start);
  const long = cuts.filter((s) => s.end - s.start >= LEAST_GAP);
  if (long.length < n - 1) return `${String(long.length + 1)} wordings found where ${String(n)} were asked for: a pause between two lines is missing or shorter than ${String(LEAST_GAP)} s.`;
  const soundStart = lead?.end ?? 0;
  const soundEnd = tail?.start ?? duration;
  const bounds = [{ start: 0, end: soundStart }, ...cuts, { start: soundEnd, end: duration }];
  const spans: Span[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const before = bounds[i];
    const after = bounds[i + 1];
    if (before === undefined || after === undefined) continue;
    const from = Math.max((before.start + before.end) / 2, before.end - PAD_BEFORE);
    const to = Math.min((after.start + after.end) / 2, after.start + PAD_AFTER);
    if (to - from < 0.2) return `wording ${String(i + 1)} is shorter than 0.2 s.`;
    spans.push({ start: from, end: to });
  }
  return spans;
}

/** A clip quieter than this as recorded holds no speech, LUFS: a spoken line from ElevenLabs reads about -20, and a
 *  silent stretch -70 or "-inf". */
export const LOUDEST_SILENCE = -45;

export const silentClip = (lufs: number): boolean => !(lufs > LOUDEST_SILENCE);

/** The loudness ffmpeg's loudnorm measured, from its log (`print_format=json`, the last block it prints). */
export interface Loudness {
  readonly input_i: string;
  readonly input_tp: string;
  readonly input_lra: string;
  readonly input_thresh: string;
  readonly target_offset: string;
}

export function loudnessOf(log: string): Loudness {
  const block = log.slice(log.lastIndexOf("{"), log.lastIndexOf("}") + 1);
  const json: unknown = JSON.parse(block);
  const field = (key: string): string => {
    const v: unknown = typeof json === "object" && json !== null ? Object.getOwnPropertyDescriptor(json, key)?.value : undefined;
    if (typeof v !== "string" || !/^-?(\d+(\.\d+)?|inf)$/.test(v)) throw new Error(`loudnorm gave no ${key}: ${block}`);
    return v;
  };
  // The offset is only the second pass's fine-tune; on a short clip loudnorm can print "inf", which its second pass
  // refuses ("That one counts.", 1.18 s, 2026-11-27), so a number that is not finite is no fine-tune at all.
  const offset = field("target_offset");
  return {
    input_i: field("input_i"),
    input_tp: field("input_tp"),
    input_lra: field("input_lra"),
    input_thresh: field("input_thresh"),
    target_offset: Number.isFinite(Number(offset)) ? offset : "0",
  };
}

const NUMBERS: Readonly<Record<string, string>> = { "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four", "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "nine", "10": "ten" };

/** Words as the read-back is compared: lower case, no punctuation or apostrophes, a lone number as its word. */
export function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => NUMBERS[w] ?? w);
}

/** Whether a clip's read-back says exactly its own wording: every word, in order, nothing more. Never near enough: a
 *  clip that says another line, half a line, or two lines run together is refused. */
export function saysIt(heard: string, wording: string): boolean {
  const a = wordsOf(heard);
  const b = wordsOf(wording);
  return a.length === b.length && a.every((w, i) => w === b[i]);
}

/** The speech reader's own text: whisper.cpp's command line prints each piece on its own line, with its times when they
 *  are not turned off; a bracketed note ("[BLANK_AUDIO]") is no words. */
export function heardOf(stdout: string): string {
  return stdout
    .split(/\r?\n/)
    .map((l) => l.replace(/^\[[\d:.]+ --> [\d:.]+\]\s*/, "").trim())
    .filter((l) => l.length > 0 && !/^\[[A-Z_ ]+\]$/.test(l))
    .join(" ");
}
