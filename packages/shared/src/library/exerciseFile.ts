// One exercise's file, the Library's part (spec Part 2 §13.2, job 60a), and the table of the
// Compendium of Physical Activities that an exercise's energy is read from. A file is outside
// input: it crosses into the app through these schemas and nothing else. Every object is strict,
// so a misspelt fact ("equipmnt") is refused, never quietly ignored.
import { z } from "zod";
import {
  EXERCISE_EQUIPMENT,
  EXERCISE_KINDS,
  EXERCISE_LEVELS,
  EXERCISE_MUSCLES,
  EXERCISE_STATUSES,
  SET_WEIGHTS,
} from "./words.js";

/** An id word: lower case, words joined by "_". It is the file's name and is never changed. */
export const exerciseIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/, { message: "an id is lower case words joined by _ (e.g. barbell_curl)" })
  .max(60);

/** A whole sentence: a capital letter or a digit first, a full stop (or ! ?) last. */
const sentence = (max: number) =>
  z
    .string()
    .max(max)
    .regex(/^[A-Z0-9].*[.!?]$/s, { message: "a whole sentence: a capital letter first and a full stop last" })
    .refine((s) => s === s.trim() && !/\s{2}/.test(s), { message: "no spaces at either end, and no double spaces" });

const nameSchema = z
  .string()
  .min(2)
  .max(60)
  .regex(/^[A-Z0-9]/, { message: "a name starts with a capital letter" })
  .refine((s) => s === s.trim() && !/\s{2}/.test(s), { message: "no spaces at either end, and no double spaces" });

const mistakeSchema = z.object({ id: exerciseIdSchema, says: sentence(200) }).strict();

/** The words a person reads, in one language. */
const exerciseTextSchema = z
  .object({
    name: nameSchema,
    /** For search: "Press-up" finds Push-up. */
    otherNames: z.array(nameSchema).max(8),
    about: sentence(400).pipe(z.string().min(20)),
    steps: z.array(sentence(220)).min(3).max(10),
    mistakes: z.array(mistakeSchema).min(2).max(10),
    /** Safety lines, as strong as the source says them; never softened (CLAUDE.md §4). */
    cautions: z.array(sentence(200)).max(4),
  })
  .strict();

const muscleSchema = z.enum(EXERCISE_MUSCLES);
const weightSchema = z.enum(SET_WEIGHTS);
const setsSchema = z.number().int().min(1).max(10);

/** What a set is measured in, and the numbers offered when it is added to a workout. */
const setSchema = z.discriminatedUnion("measuredIn", [
  z
    .object({
      measuredIn: z.literal("reps"),
      weight: weightSchema,
      eachSide: z.boolean(),
      start: z.object({ sets: setsSchema, reps: z.number().int().min(1).max(100) }).strict(),
    })
    .strict(),
  z
    .object({
      measuredIn: z.literal("time"),
      weight: weightSchema,
      eachSide: z.boolean(),
      start: z.object({ sets: setsSchema, seconds: z.number().int().min(5).max(600) }).strict(),
    })
    .strict(),
]);

const sourceSchema = z
  .object({
    name: z.string().min(3).max(160),
    url: z.url({ protocol: /^https$/, message: "a source's address starts with https://" }),
  })
  .strict();

/** A Compendium activity code: five digits. */
const compendiumCodeSchema = z.string().regex(/^\d{5}$/, { message: "a Compendium code is five digits, e.g. 02056" });

export const exerciseFileSchema = z
  .object({
    id: exerciseIdSchema,
    status: z.enum(EXERCISE_STATUSES),
    kind: z.enum(EXERCISE_KINDS),
    level: z.enum(EXERCISE_LEVELS),
    /** Three rows, each from the file's source (§13.2): main (primary), also worked (other movers),
     *  keeps you steady (stabilisers). A muscle is named once in all three. */
    muscles: z
      .object({
        main: z.array(muscleSchema).min(1).max(6),
        also: z.array(muscleSchema).max(10),
        steady: z.array(muscleSchema).max(10),
      })
      .strict(),
    /** Empty means no equipment. */
    equipment: z.array(z.enum(EXERCISE_EQUIPMENT)).max(4),
    set: setSchema,
    /** The energy is READ from the Compendium table by this code, never typed in the file. */
    energy: z.object({ compendium: compendiumCodeSchema }).strict(),
    text: z.object({ en: exerciseTextSchema }).strict(),
    /** The proper sources the words were checked against (§11.3 step 5). */
    sources: z.array(sourceSchema).min(1).max(6),
    /** Empty until job 62 makes clips. */
    clip: z.null(),
    picture: z.null(),
  })
  .strict();
export type ExerciseFile = z.infer<typeof exerciseFileSchema>;

/** A MET is a whole number of tenths from 1.0 (sitting still) to 23.0 (the Compendium's fastest
 *  running), so 80 typed for 8.0, or 0.8, is refused. */
export const metSchema = z
  .number()
  .min(1)
  .max(23)
  .refine((met) => Math.abs(met * 10 - Math.round(met * 10)) < 1e-9, { message: "a MET has at most one decimal" });

/** The rows of the 2024 Adult Compendium of Physical Activities the Library uses, copied from
 *  its own pages: the code, the MET and the activity's words exactly, its double spaces included. */
export const compendiumTableSchema = z
  .object({
    edition: z.literal("2024 Adult Compendium of Physical Activities"),
    rows: z
      .array(
        z
          .object({
            code: compendiumCodeSchema,
            met: metSchema,
            words: z.string().min(3).max(300),
            page: z.url({ protocol: /^https$/ }),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type CompendiumTable = z.infer<typeof compendiumTableSchema>;
