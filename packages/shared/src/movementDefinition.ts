// A movement as data (spec Part 2 §12.3): what the body does in one kind of rep, built and proven once, on which
// exercises sit (a squat with a barbell, with a kettlebell, to a chair). The engine reads it and never names a
// movement or an exercise. One file each in packages/movement/movements; the phone will download them with the
// exercises (§13.3), so a file is parsed here before the engine trusts it.
//
// Every rule reads the body in the person's own terms: how far the hips went down from where THIS person stands, how
// far a foot rose above where it stood, a joint's angle. Two roles:
//   - "count": how far the rep went. A rep that matched the movement but fell short of it is not counted, and says
//     why, in the rule's own words (`short`: "Go lower to count.");
//   - "match": what kind of movement it was. A rep that breaks one is another movement (a jump, a lunge, a deadlift):
//     no count and no word (Kd, 2026-11-16: "count only what matches").
// A rule the camera must see says what to do when it could not (`unseen`: "Keep your whole body in view.").
import { z } from "zod";

export const MOVEMENT_FORMAT = 1;

/** A measure's name, one of the engine's fixed list (packages/movement `MEASURE_LIST`); the engine refuses any other. */
const measureName = z.string().min(1).max(60);
const measures = z.array(measureName).min(1).max(4);

/** What a rule reads. */
export const movementReadSchema = z.discriminatedUnion("kind", [
  /** How far the drive measure went from the person's own standing value, in its unit. */
  z.object({ kind: z.literal("drop") }).strict(),
  /** The mean of the measures read (on the picture where the picture gives it, else in 3D). */
  z.object({ kind: z.literal("value"), measures }).strict(),
  /** Pair by pair, `from` less `less` (the first of each with the first of the other), the mean of the pairs read. */
  z
    .object({ kind: z.literal("gap"), from: measures, less: measures })
    .strict()
    .refine((g) => g.from.length === g.less.length, { message: "a gap pairs its measures one to one" }),
  /** How far from nothing a left-against-right measure lies, either way. */
  z.object({ kind: z.literal("apart"), measure: measureName }).strict(),
  /** The most any of these heights rose above its own value while the person stood ready, on the picture. */
  z.object({ kind: z.literal("rise"), measures }).strict(),
  /** The most any of these measures moved from its own value while the person stood ready, either way, on the
   *  picture: read only where the picture shows it. */
  z.object({ kind: z.literal("change"), measures }).strict(),
  /** How far the body's feet rose on the picture, along "down", above the lowest place each reached during the same
   *  rep: a foot's heel and toes both, and both feet where both are seen (the lesser each time), metres against the
   *  body's size while standing: a hop or a jump, whatever the body's size reading does meanwhile. */
  z.object({ kind: z.literal("lift"), points: z.literal("feet") }).strict(),
  /** The furthest the feet moved on the picture during the rep, from where they were at the top before, metres. */
  z.object({ kind: z.literal("travel"), points: z.literal("feet") }).strict(),
  /** How long the rep took, from passing half its depth on the way down to back up, seconds. Read over the rep. */
  z.object({ kind: z.literal("time") }).strict(),
]);

/** Where a number came from, in a line: which videos and which rule, or which source. */
const from = z.string().min(1).max(400);

/** Words for the screen: one short whole sentence that says what to do ("Go lower to count."). */
const words = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[A-Z][^\n]*[.!]$/);

export const movementRuleSchema = z
  .object({
    /** A short name, the same in the proof table and in a rep's reason: letters, digits and spaces only (a name like
     *  "__proto__" would be read from every object, and the rule would never fail). */
    name: z
      .string()
      .max(60)
      .regex(/^[A-Za-z0-9][A-Za-z0-9 ]*$/),
    role: z.enum(["count", "match"]),
    /** Read at the bottom of the rep (the middle of the frames nearest the deepest), or over the whole rep, its
     *  worst frame (the rep includes a moment after it, so a jump from the top is seen). */
    at: z.enum(["bottom", "rep"]),
    read: movementReadSchema,
    atLeast: z.number().optional(),
    atMost: z.number().optional(),
    /** "always": the camera must see it, or the rep decides nothing. "when-seen": checked where the camera can see it
     *  from where the phone stands, and marked "the camera cannot see this from here" where it cannot. */
    seen: z.enum(["always", "when-seen"]),
    /** A count rule set from the exercise's form standard, never from how shallow its people went: `at` is the
     *  standard's own line; `room` "camera": the tool that sets the numbers moves it the forgiving way by the camera's
     *  room on that reading, measured on the videos; "none": the line is already the least the body allows, and is used
     *  as it is. `source` says where the line comes from. */
    standard: z.object({ at: z.number(), room: z.enum(["camera", "none"]), source: from }).strict().optional(),
    /** For a count rule: what the screen says when a rep that tried falls short of it. */
    short: words.optional(),
    /** For a rule the camera must see: what the screen says when it could not. */
    unseen: words.optional(),
    from,
  })
  .strict()
  .refine((r) => (r.atLeast === undefined) !== (r.atMost === undefined), { message: "a rule has exactly one bound" })
  .refine((r) => r.read.kind !== "time" || r.at === "rep", { message: "a rep's time is read over the rep" })
  .refine((r) => (r.role === "count") === (r.short !== undefined), { message: "a count rule, and only a count rule, says what to do when a rep falls short of it" })
  .refine((r) => (r.seen === "always") === (r.unseen !== undefined), { message: "a rule the camera must see, and only such a rule, says what to do when it could not" })
  .refine((r) => r.standard === undefined || r.role === "count", { message: "only a count rule is set from a form standard" });

/** One condition of standing ready, before a rep may begin. */
export const movementReadySchema = z
  .object({
    read: movementReadSchema,
    atLeast: z.number().optional(),
    atMost: z.number().optional(),
    from,
  })
  .strict()
  .refine((r) => r.read.kind === "value" || r.read.kind === "gap" || r.read.kind === "apart", { message: "standing ready reads a body measure" })
  .refine((r) => (r.atLeast === undefined) !== (r.atMost === undefined), { message: "a condition has exactly one bound" });

export const movementSchema = z
  .object({
    format: z.literal(MOVEMENT_FORMAT),
    name: z.string().min(1).max(60),
    counting: z.literal("rep"),
    /** Where the phone stands, in a line for the person. */
    phone: z.string().min(1).max(400),
    /** The measure whose fall from standing is the rep, read on the picture. */
    drive: z.object({ measure: measureName, toward: z.literal("lower") }).strict(),
    ready: z.array(movementReadySchema).min(1).max(8),
    rules: z.array(movementRuleSchema).min(1).max(24),
  })
  .strict()
  .refine((m) => new Set(m.rules.map((r) => r.name)).size === m.rules.length, { message: "every rule has its own name" })
  .refine((m) => m.rules.filter((r) => r.read.kind === "drop" && r.role === "count").length === 1, {
    message: "a rep movement has exactly one count rule on how far the drive goes",
  })
  .refine((m) => m.rules.every((r) => r.read.kind !== "drop" || r.role !== "count" || (r.atLeast !== undefined && r.atLeast > 0)), {
    message: "how far the drive must go to count is a number above 0, at least",
  });

export type MovementRead = z.infer<typeof movementReadSchema>;
export type MovementRule = z.infer<typeof movementRuleSchema>;
export type MovementReady = z.infer<typeof movementReadySchema>;
export type Movement = z.infer<typeof movementSchema>;

// ── An exercise's camera file (spec Part 2 §12.3): the movement it uses, and its mistakes ─────────────────────────────
// Every common mistake of the exercise, from its research file and a proper source, is in the list, each marked one of:
//   - "checked": the camera checks it, inside a counted rep only, where the phone's place shows it, and says nothing
//     where it does not ("the camera cannot see this from here" for that rep);
//   - "counting": the movement's own rule (`rule`) already refuses it: a quarter squat is not counted, and says "Go
//     lower to count.";
//   - "cannot see": the camera cannot see it from where the phone stands, with why, measured where it can be;
//   - "not checked": not checked by the camera yet, with why and the job that will (a wide stance is a sumo squat's own).
// The engine reads only the picture for a mistake: a 3D reading alone never gives advice (§12.1: advice is strict).

export const EXERCISE_CAMERA_FORMAT = 1;

/** What a mistake reads, frame by frame, on the picture only. */
export const mistakeReadSchema = z.discriminatedUnion("kind", [
  /** The mean of the measures the picture gives. */
  z.object({ kind: z.literal("value"), measures }).strict(),
  /** Pair by pair, `from` less `less`, the mean of the pairs the picture gives. */
  z
    .object({ kind: z.literal("gap"), from: measures, less: measures })
    .strict()
    .refine((g) => g.from.length === g.less.length, { message: "a gap pairs its measures one to one" }),
]);

/** An exercise's own id word, as its Library file names it (spec §13.2). */
const idWord = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z][a-z0-9_]*$/);

/** A mistake's name, as a coach says it ("Leaning too far forward"). */
const mistakeName = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[A-Z][^\n]*[^.\n]$/);

const mistakeBase = {
  id: idWord,
  name: mistakeName,
  /** Where the mistake comes from: the research file's words, and a proper source where one says it. */
  source: from,
};

export const checkedMistakeSchema = z
  .object({
    ...mistakeBase,
    camera: z.literal("checked"),
    read: mistakeReadSchema,
    /** Read at the bottom of the rep (the middle of the frames nearest the deepest), on the way up from it (the most it
     *  reaches there), or over the whole rep wherever the picture gives it (its furthest). */
    at: z.enum(["bottom", "way up", "rep"]),
    /** Where the picture shows it: "side", a lean, only in frames where the body stands side on to the phone (a lean
     *  forward from the front points at the phone, and the picture shows a knee moving sideways as if it moved
     *  forward); "front", a width across the body, wherever the picture shows the body's line from left to right. Either
     *  way the judge allows for the body's turn, which shortens what the picture shows. */
    view: z.enum(["side", "front"]),
    /** What the reading is taken against: nothing (the reading itself), the same reading while the person stood ready
     *  before the rep (their own body), or, on the way up, the reading at the bottom. */
    against: z.enum(["nothing", "standing", "bottom"]),
    atLeast: z.number().optional(),
    atMost: z.number().optional(),
    /** The form standard's own line, where a proper source gives one: the line is never nearer than it, moved by the
     *  camera's own room, nor nearer than any proper rep of the videos (movement-check sets it). */
    standard: z.object({ at: z.number(), source: from }).strict().optional(),
    /** The movement's own "match" rule that refuses a rep this mistake has gone far past (the squat's "chest up": a lean
     *  past it is read as another movement). A rep that breaks that rule alone, in every other way the movement, is not
     *  counted and is told `words`, but only when the picture, read the way this mistake is read, shows it past that
     *  rule's own line too; otherwise it says nothing, as another movement does (Kd, 2026-11-23). */
    refused: z.object({ rule: z.string().min(1).max(60), words }).strict().optional(),
    from,
  })
  .strict()
  .refine((m) => (m.atLeast === undefined) !== (m.atMost === undefined), { message: "a mistake has exactly one bound" })
  .refine((m) => (m.against === "bottom") === (m.at === "way up"), { message: "a reading on the way up is taken against the bottom, and only it" });

export const exerciseMistakeSchema = z.union([
  checkedMistakeSchema,
  z.object({ ...mistakeBase, camera: z.literal("counting"), rule: z.string().min(1).max(60) }).strict(),
  z.object({ ...mistakeBase, camera: z.literal("cannot see"), why: from }).strict(),
  z.object({ ...mistakeBase, camera: z.literal("not checked"), why: from }).strict(),
]);

export const exerciseCameraSchema = z
  .object({
    format: z.literal(EXERCISE_CAMERA_FORMAT),
    /** The exercise's id word, its Library file's own. */
    id: idWord,
    /** This file's own version, raised whenever it changes: a set's summary names it (`definitionVersion`, spec §2.4). */
    version: z.number().int().positive().max(2_147_483_647),
    /** The movement it uses (`packages/movement/movements/<movement>.json`). */
    movement: z.string().min(1).max(60),
    /** Where its form comes from: the research file, named. */
    research: from,
    mistakes: z.array(exerciseMistakeSchema).min(1).max(24),
  })
  .strict()
  .refine((e) => new Set(e.mistakes.map((m) => m.id)).size === e.mistakes.length, { message: "every mistake has its own id" });

export type MistakeRead = z.infer<typeof mistakeReadSchema>;
export type CheckedMistake = z.infer<typeof checkedMistakeSchema>;
export type ExerciseMistake = z.infer<typeof exerciseMistakeSchema>;
export type ExerciseCamera = z.infer<typeof exerciseCameraSchema>;

/** The two marks an exercise's page shows beside each common mistake (Kd, 2026-11-23): one the camera checks, or one the
 *  camera's counting refuses (a quarter rep is not counted), is checked by the camera; one it cannot see, or does not
 *  check yet, is not. */
export const MISTAKE_MARKS = ["Checked by the camera", "Not checked by the camera"] as const;
export type MistakeMark = (typeof MISTAKE_MARKS)[number];

export function mistakeMark(mistake: ExerciseMistake): MistakeMark {
  switch (mistake.camera) {
    case "checked":
    case "counting":
      return "Checked by the camera";
    case "cannot see":
    case "not checked":
      return "Not checked by the camera";
  }
}
