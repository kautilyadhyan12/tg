// The coach's voice (spec Part 2 §12.6; ROADMAP Stage 5 53b-i): every line the coach can say, as data, in one file
// (packages/movement/voice/lines.json). Kd records the lines by hand on his ElevenLabs plan from the script this file
// makes, never through the API (RULINGS 2026-10-18); a laptop tool cuts his recording into one clip a wording and reads
// each back to check it says its own words (packages/movement/scripts/voice-cut.ts).
//
// A line belongs to one thing the engine detects (§12.6: "a line belongs to one thing the engine detects and plays only
// when that has just happened"): `when` names it. A "rule" line is what a movement's or an exercise's own words say
// (a rep's reason, "Go lower to count."; a mistake's correction, "Keep your knees in line with your toes."), found by
// those very words, so one phrase is one thing in every exercise. Two or three wordings a line, each a whole sentence,
// the first the screen's own words; the coach says another wording when a line comes back.
import { z } from "zod";

export const VOICE_FORMAT = 1;

/** What a line is said for:
 *   - "rule": the words a movement or an exercise file gives (a rep's reason, a mistake's correction), the first wording
 *     being those words exactly;
 *   - "halfway", "two more", "last one": the set's count against its target;
 *   - "set complete": the set has ended;
 *   - "lost": the camera has not seen the person for a while;
 *   - "counts now": a rep counts after the coach said why the one before did not;
 *   - "better": a mistake the coach corrected is fine on the next rep it is seen;
 *   - "get ready", "rest", "next exercise", "workout complete": the workout's own (job 64b), recorded once with the rest;
 *     "get ready" also begins a set followed along with its clip (53b-ii). */
export const VOICE_WHENS = [
  "rule",
  "halfway",
  "two more",
  "last one",
  "set complete",
  "lost",
  "counts now",
  "better",
  "get ready",
  "rest",
  "next exercise",
  "workout complete",
] as const;
export type VoiceWhen = (typeof VOICE_WHENS)[number];

/** The workout's own lines, used by job 64b: recorded with the rest so that Kd records once. */
export const WORKOUT_WHENS: readonly VoiceWhen[] = ["get ready", "rest", "next exercise", "workout complete"];

/** A wording: one short whole sentence, as the coach says it. */
const wording = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[A-Z][^\n<>]*[.!]$/);

export const voiceLineSchema = z
  .object({
    /** The line's own id word; its clips are `<id>_<n>.m4a`, n from 1, one for each wording in order. */
    id: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[a-z][a-z0-9_]*$/),
    when: z.enum(VOICE_WHENS),
    wordings: z.array(wording).min(1).max(3),
  })
  .strict()
  .refine((l) => new Set(l.wordings).size === l.wordings.length, { message: "every wording of a line is its own" });

export const voiceSchema = z
  .object({
    format: z.literal(VOICE_FORMAT),
    /** Raised whenever a wording changes: the clips are recorded for one version. */
    version: z.number().int().positive().max(2_147_483_647),
    /** The one voice and its settings, named once, so every line sounds the same (spec §11.8). */
    voice: z
      .object({
        name: z.string().min(1).max(60),
        model: z.string().min(1).max(60),
        settings: z.string().min(1).max(400),
      })
      .strict(),
    lines: z.array(voiceLineSchema).min(1).max(200),
  })
  .strict()
  .refine((v) => new Set(v.lines.map((l) => l.id)).size === v.lines.length, { message: "every line has its own id" })
  .refine((v) => new Set(v.lines.flatMap((l) => l.wordings)).size === v.lines.reduce((n, l) => n + l.wordings.length, 0), {
    message: "a wording belongs to one line",
  })
  .refine((v) => VOICE_WHENS.every((w) => w === "rule" || v.lines.filter((l) => l.when === w).length <= 1), {
    message: "the set's own lines are one each",
  });

export type VoiceLine = z.infer<typeof voiceLineSchema>;
export type Voice = z.infer<typeof voiceSchema>;

/** What the cutting tool heard each clip say (packages/movement/voice/heard.json): a clip is named by its bytes' SHA-256,
 *  so a test can check that every clip in the app is the very one heard saying its own words. */
export const voiceHeardSchema = z
  .object({
    /** The lines file's version the clips were recorded for. */
    version: z.number().int().positive(),
    voice: z.string().min(1).max(200),
    reader: z.string().min(1).max(200),
    clips: z
      .array(
        z
          .object({
            file: z.string().regex(/^[a-z][a-z0-9_]*_\d+\.m4a$/),
            words: wording,
            heard: z.string().max(400),
            /** The reader's model that heard it say exactly its wording. */
            by: z.string().min(1).max(60),
            sha256: z.string().regex(/^[0-9a-f]{64}$/),
            seconds: z.number().positive(),
          })
          .strict(),
      )
      .max(600),
  })
  .strict();

export type VoiceHeard = z.infer<typeof voiceHeardSchema>;

/** A clip's file name: the line's id and the wording's place, from 1. */
export const clipName = (line: Pick<VoiceLine, "id">, wordingIndex: number): string => `${line.id}_${String(wordingIndex + 1)}.m4a`;
