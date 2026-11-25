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

/** A picture's or a clip's file on the server: its own sha256, so the name can only ever fetch those bytes, and a
 *  file swapped or broken on the way is refused by its name (job 62a). Nothing else may be asked for. */
export const libraryMediaFileSchema = z.string().regex(/^[0-9a-f]{64}\.(?:webp|mp4)$/, { message: "a picture or clip is named by its sha256: 64 hex digits, then .webp or .mp4" });
export type LibraryMediaFile = z.infer<typeof libraryMediaFileSchema>;

const sideSchema = z.number().int().min(16).max(4096);

/** The exercise's still picture, made small from Kd's `final.png` by `tools/library-media.ts` (job 62a). `ground` is
 *  the colour round its edge, measured from the picture, so the phone runs it to the screen's edges. */
export const exercisePictureSchema = z
  .object({
    file: z.string().regex(/^[0-9a-f]{64}\.webp$/, { message: "a picture is named by its sha256, then .webp" }),
    width: sideSchema,
    height: sideSchema,
    bytes: z.number().int().min(1).max(2_000_000),
    ground: z.string().regex(/^#[0-9A-F]{6}$/, { message: "a colour as #RRGGBB, capitals" }),
  })
  .strict();
export type ExercisePicture = z.infer<typeof exercisePictureSchema>;

/** The exercise's clip, made small from Kd's `final.mp4` by the same command: no sound, H.264 (job 62a). */
export const exerciseClipSchema = z
  .object({
    file: z.string().regex(/^[0-9a-f]{64}\.mp4$/, { message: "a clip is named by its sha256, then .mp4" }),
    width: sideSchema,
    height: sideSchema,
    bytes: z.number().int().min(1).max(20_000_000),
    seconds: z.number().min(0.5).max(60),
    /** The bottom corner KWAZO is in (62b): left unless the person reaches it, then right. A clip made before says none. */
    mark: z.enum(["left", "right"]).default("left"),
  })
  .strict();
export type ExerciseClip = z.infer<typeof exerciseClipSchema>;

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
    /** Made by `tools/library-media.ts` from Kd's `final` folder (job 62a); null until it is. */
    clip: exerciseClipSchema.nullable(),
    picture: exercisePictureSchema.nullable(),
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
