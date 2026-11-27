// The coach's lines (spec Part 2 §12.6; ROADMAP 53b-i), read from packages/movement/voice/lines.json: the script Kd
// pastes into ElevenLabs, part by part, and the check that every sentence a movement or an exercise file can make the
// screen say has a line, and every rule line is said by one.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkedOf, parseExercise, parseMovementFile } from "../src/index.js";
import { voiceSchema, type MovementFile, type Voice, type VoiceLine } from "@app/shared";

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), "..");
export const VOICE_FILE = join(PACKAGE, "voice", "lines.json");
/** What each clip was heard saying when it was cut (voice-cut). */
export const HEARD_FILE = join(PACKAGE, "voice", "heard.json");
const MOVEMENTS = join(PACKAGE, "movements");
const EXERCISES = join(PACKAGE, "exercises");
/** Where the app keeps the clips. */
export const CLIPS = join(PACKAGE, "..", "..", "apps", "mobile", "assets", "voice");

export function readVoice(): Voice {
  return voiceSchema.parse(JSON.parse(readFileSync(VOICE_FILE, "utf8")));
}

/** The pause the script asks for between two wordings. Eleven v4, the model Kd uses (2026-11-27), takes no SSML break
 *  tag: ElevenLabs' v4 guide asks for an audio tag and the text's own structure, so each wording is a paragraph of its
 *  own with "[long pause]" between (his first v4 take of `<break time="1.5s" />` left 0.3 to 0.5 s between lines). The
 *  cutting never leans on the pause alone: it finds each wording by its words (voiceCut.ts). */
export const PAUSE = "[long pause]";
/** The most wordings in one part of the script: ElevenLabs' own help warns that many pauses in one generation can make
 *  the speech faster or add noise, so the script is pasted in a few parts, each generated and downloaded on its own. */
export const PART_SIZE = 12;

/** Every wording, in the script's order, with its line and its place in the line. */
export interface Wording {
  readonly line: VoiceLine;
  readonly index: number;
  readonly words: string;
}

export function wordingsOf(voice: Voice): Wording[] {
  return voice.lines.flatMap((line) => line.wordings.map((words, index) => ({ line, index, words })));
}

/** The script, in parts of at most `size` wordings: what each part's text says, in order. */
export function scriptParts(voice: Voice, size: number = PART_SIZE): Wording[][] {
  const all = wordingsOf(voice);
  const count = Math.ceil(all.length / size);
  // Parts as even as they can be, so that no last part holds a lone wording.
  const each = Math.ceil(all.length / count);
  return Array.from({ length: count }, (_, i) => all.slice(i * each, (i + 1) * each));
}

/** One part's text, as Kd pastes it: each wording on its own line, a pause between two. */
export function scriptText(part: readonly Wording[]): string {
  return part.map((w) => w.words).join(`\n\n${PAUSE}\n\n`);
}

/** Every movement and exercise file, parsed. */
export function readFiles(): { movements: { name: string; file: MovementFile }[]; exercises: ReturnType<typeof parseExercise>[] } {
  const movements = readdirSync(MOVEMENTS)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ name: f.replace(/\.json$/, ""), file: parseMovementFile(JSON.parse(readFileSync(join(MOVEMENTS, f), "utf8"))) }));
  const exercises = readdirSync(EXERCISES)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const json: unknown = JSON.parse(readFileSync(join(EXERCISES, f), "utf8"));
      const named = typeof json === "object" && json !== null && "movement" in json && typeof json.movement === "string" ? json.movement : "";
      const movement = movements.find((m) => m.name === named)?.file;
      if (movement === undefined || !("rules" in movement)) throw new Error(`${f} names no movement counted by reps.`);
      return parseExercise(json, movement);
    });
  return { movements, exercises };
}

/** Every sentence the engine can give the screen, from the movement and exercise files: a rep's reason, a hold's, and
 *  each mistake's correction the coach says. */
export function ruleWords(files: ReturnType<typeof readFiles>): string[] {
  const out = new Set<string>();
  for (const { file } of files.movements) {
    if ("rules" in file) for (const r of file.rules) for (const w of [r.short, r.unseen]) if (w !== undefined) out.add(w);
    if ("unseen" in file) out.add(file.unseen);
  }
  for (const e of files.exercises)
    for (const m of checkedOf(e)) {
      if (m.refused !== undefined) out.add(m.refused.words);
      if ("words" in m.coach) out.add(m.coach.words);
    }
  return [...out].sort();
}

/** What is wrong between the lines and the files: a sentence with no line, a rule line no file says. */
export function voiceGaps(voice: Voice, words: readonly string[]): string[] {
  const rules = voice.lines.filter((l) => l.when === "rule");
  const firsts = new Set(rules.map((l) => l.wordings[0]));
  const unvoiced = words.filter((w) => !firsts.has(w)).map((w) => `no line says "${w}"`);
  const unused = rules.filter((l) => !words.includes(l.wordings[0] ?? "")).map((l) => `nothing says the line ${l.id}`);
  return [...unvoiced, ...unused];
}
