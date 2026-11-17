// The movement engine's input (spec Part 2 §12.2): one frame from a pose model, on the
// phone or from a reference video on the laptop. It holds EVERY person the model found,
// each with the picture's points, the model's 3D points and how sure it is of each, and
// which way is down. Which person is the one exercising is decided later (job 52d), so
// the order of `people` says nothing about who is who.
import { z } from "zod";
import { KEYPOINT_COUNT, MAX_ASPECT, MAX_FPS, MIN_ASPECT, MIN_FPS } from "./pose.js";

/** The most people one frame may hold. A busy gym rarely puts more in the picture. */
export const MAX_PEOPLE = 6;

/** No real point lies a hundred pictures, or a hundred metres, away: a frame holding
 *  one is broken and is refused whole. */
export const POINT_LIMIT = 100;

/** How far "down" may be from length 1: the phone's reading is made a unit first. */
export const DOWN_TOLERANCE = 0.01;

const coordinate = z.number().min(-POINT_LIMIT).max(POINT_LIMIT);
const share = z.number().min(0).max(1);

/** One point on the picture: [x, y, z, visibility, presence].
 *  x and y are shares of the picture's width and height from its top left, y downward;
 *  either may lie outside 0..1 for a part out of the picture. z is the model's own depth
 *  on x's scale, centred on the hips. Visibility: how sure the model is that the point
 *  is in sight; presence: how sure it is that the point is inside the picture at all. */
export const seenPointSchema = z.tuple([coordinate, coordinate, coordinate, share, share]);

/** One 3D point, [x, y, z] in metres, centred between the hips, y downward. */
export const worldPointSchema = z.tuple([coordinate, coordinate, coordinate]);

export const seenPersonSchema = z
  .object({
    points: z.array(seenPointSchema).length(KEYPOINT_COUNT),
    /** Null when the pose model gives no 3D points. */
    world: z.array(worldPointSchema).length(KEYPOINT_COUNT).nullable(),
  })
  .strict();

/** Which way is down, as a unit vector in the picture's own frame: x to the right of
 *  the picture, y down it, z away from the camera. An upright phone, or a reference
 *  video, gives [0, 1, 0]. */
export const downSchema = z
  .tuple([z.number(), z.number(), z.number()])
  .refine(([x, y, zz]) => Math.abs(Math.hypot(x, y, zz) - 1) <= DOWN_TOLERANCE, {
    message: "down must be a unit vector",
  });

export const movementFrameSchema = z
  .object({
    /** Milliseconds since the set began, from a clock that never goes back. */
    t: z.number().nonnegative(),
    /** The picture's width / height. */
    aspect: z.number().min(MIN_ASPECT).max(MAX_ASPECT),
    /** Null when the phone cannot say: nothing that needs it is decided. */
    down: downSchema.nullable(),
    people: z.array(seenPersonSchema).max(MAX_PEOPLE),
  })
  .strict();

// A body-points file's header (`packages/movement/scripts/bodyPoints.ts`): what a
// measurement was made from and how. Only plain characters, so the file can never
// carry a path or a name typed by somebody else.
const plainName = z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/);
const pixels = z.number().int().positive().max(20000);

export const bodyPointsHeaderSchema = z
  .object({
    label: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
    /** A reference video measured on the laptop. The phone's own recordings come with job 51. */
    source: z.literal("video"),
    picture: z.object({ width: pixels, height: pixels }).strict(),
    /** The video's own frames a second, and the rate the measurement took. */
    videoFps: z.number().positive().max(1000),
    fps: z.number().min(MIN_FPS).max(MAX_FPS),
    model: z
      .object({
        file: plainName,
        people: z.number().int().min(1).max(MAX_PEOPLE),
        minDetection: share,
        minPresence: share,
        minTracking: share,
      })
      .strict(),
    madeWith: z.object({ tool: z.literal("measure-points"), version: z.number().int().positive() }).strict(),
  })
  .strict();

// ── The phone test (ROADMAP Stage 5 item 51a) ─────────────────────────────────────
// A folder's copy of the app plays a reference video through the phone's own pose model
// (`apps/mobile/modules/phone-test`) and writes one file a run: a header line, one line a
// frame, an end line. The laptop reads each line through these before it believes a number.
// Every text the phone writes is plain characters only, so a file can never carry a path.

export const PHONE_TEST_DELEGATES = ["cpu", "gpu"] as const;
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const milliseconds = z.number().nonnegative().max(3_600_000);
const phoneWords = z.string().regex(/^[A-Za-z0-9 _.,:()+/-]{1,80}$/);
const label = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const count = z.number().int().nonnegative().max(1_000_000);

/** How warm the phone is: Android's own thermal status (0 none to 6 shut down; -1 when the
 *  phone cannot say) and the battery's temperature in °C, or null when it gives none. */
export const phoneHeatSchema = z
  .object({ thermal: z.number().int().min(-1).max(6), batteryC: z.number().min(-40).max(100).nullable() })
  .strict();

export const phoneRunHeaderSchema = z
  .object({
    kind: z.literal("phone-run"),
    version: z.literal(1),
    label,
    /** The plan the run was made for, by its check sum, so a folder's older file is never read as a new one. Null in
     *  51a's first files, made before it was written (2026-11-17). */
    plan: sha256.nullable().default(null),
    /** The video file as the phone holds it, and how many frames the phone itself counts in it. */
    video: z.object({ sha256, frames: count }).strict(),
    /** The pictures' shape, turned as a person sees them. */
    picture: z.object({ width: pixels, height: pixels }).strict(),
    /** Where the pictures came from: the phone's own video decoder, or the laptop's decoded pictures, sent as
     *  they are (to tell the decoder's part from the model's). A file that does not say is the decoder's. */
    pictures: z.enum(["video", "laptop"]).default("video"),
    model: z
      .object({
        file: plainName,
        sha256,
        people: z.number().int().min(1).max(MAX_PEOPLE),
        minDetection: share,
        minPresence: share,
        minTracking: share,
      })
      .strict(),
    delegate: z.enum(PHONE_TEST_DELEGATES),
    phone: z.object({ maker: phoneWords, model: phoneWords, android: phoneWords, sdk: z.number().int().min(1).max(1000), abi: plainName }).strict(),
    /** The pose library and its version, as the app was built with it. */
    library: phoneWords,
    /** How long the model took to start, before its first picture. */
    createMs: milliseconds,
    heat: phoneHeatSchema,
  })
  .strict();

export const phoneRunFrameSchema = z
  .object({
    /** The frame's number in the video, counted from 0 in the order it plays. */
    i: count,
    /** The laptop's time for that frame, as the plan gave it; the model was given its whole milliseconds. */
    t: z.number().nonnegative(),
    /** The phone's own time for that frame, from the video's first frame. */
    at: z.number().nonnegative(),
    /** Turning the video into this picture, and the pose model's reading of it. */
    decodeMs: milliseconds,
    detectMs: milliseconds,
    people: z.array(seenPersonSchema).max(MAX_PEOPLE),
  })
  .strict();

export const phoneRunEndSchema = z
  .object({
    kind: z.literal("end"),
    frames: count,
    /** People the model gave with a broken number, left out of their frames as the laptop does. */
    leftOut: count,
    wallMs: milliseconds,
    heat: phoneHeatSchema,
  })
  .strict();

/** A run that could not be made, and why, in the phone's words. */
export const phoneRunFailedSchema = z
  .object({
    kind: z.literal("failed"),
    label,
    plan: sha256.nullable().default(null),
    model: plainName,
    delegate: z.enum(PHONE_TEST_DELEGATES),
    reason: z.string().max(400),
  })
  .strict();

/** The phone's own word on where the test is, read by the laptop while it waits. */
export const phoneProgressSchema = z
  .object({
    state: z.enum(["running", "done", "failed"]),
    run: count,
    runs: count,
    frame: count,
    frames: count,
    reason: z.string().max(400).nullable(),
  })
  .strict();

/** What the laptop's points.py says of a video before the phone test: each frame its measuring keeps, by its
 *  number in the video and its time, the picture's shape, and how many frames the video holds in all. */
export const videoFramesSchema = z
  .object({
    picture: z.object({ width: pixels, height: pixels }).strict(),
    videoFps: z.number().positive().max(1000),
    fps: z.number().min(MIN_FPS).max(MAX_FPS),
    read: count,
    frames: z.array(z.tuple([count, z.number().nonnegative()])).min(1),
  })
  .strict();

export type VideoFrames = z.infer<typeof videoFramesSchema>;
export type PhoneHeat = z.infer<typeof phoneHeatSchema>;
export type PhoneRunHeader = z.infer<typeof phoneRunHeaderSchema>;
export type PhoneRunFrame = z.infer<typeof phoneRunFrameSchema>;
export type PhoneRunEnd = z.infer<typeof phoneRunEndSchema>;
export type PhoneRunFailed = z.infer<typeof phoneRunFailedSchema>;
export type PhoneProgress = z.infer<typeof phoneProgressSchema>;
export type PhoneTestDelegate = (typeof PHONE_TEST_DELEGATES)[number];

export type SeenPoint = z.infer<typeof seenPointSchema>;
export type WorldPoint = z.infer<typeof worldPointSchema>;
export type SeenPerson = z.infer<typeof seenPersonSchema>;
export type Down = z.infer<typeof downSchema>;
export type MovementFrame = z.infer<typeof movementFrameSchema>;
export type BodyPointsHeader = z.infer<typeof bodyPointsHeaderSchema>;
