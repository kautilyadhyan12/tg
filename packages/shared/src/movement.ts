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

// ── The phone test (ROADMAP Stage 5 items 51a and 51b) ───────────────────────────────
// A folder's copy of the app plays a reference video through the phone's own pose model
// (`apps/mobile/modules/phone-test`) and writes one file a run: a header line, one line a
// frame, an end line. The laptop reads each line through these before it believes a number.
// Every text the phone writes is plain characters only, so a file can never carry a path.

export const PHONE_TEST_DELEGATES = ["cpu", "gpu"] as const;
/** The most cores the main chip may be told to read with (51b): the phone has eight. */
export const PHONE_TEST_MAX_THREADS = 8;
/** How many cores the main chip was told to read with, or null for the library's own number (every 51a run, and
 *  every graphics-chip run). */
const threads = z.number().int().min(1).max(PHONE_TEST_MAX_THREADS).nullable().default(null);
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
    threads,
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
    /** The whole app's time on the phone's cores during that reading (Android's own count for the app, in whole
     *  milliseconds): over detectMs, how many cores the reading kept busy. Null in 51a's files. */
    cpuMs: milliseconds.nullable().default(null),
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
    threads,
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

// ── The live camera (ROADMAP Stage 5 item 51b-ii) ────────────────────────────────────
// The same copy's live screen (`PhoneTestLive.kt`) reads the phone's own camera, as the camera screen will, and writes
// one file a run: a header line, then, for a 20-minute run, one line a second and one a minute, or, for a still body's
// ten seconds, one line a picture with its points; then an end line. No picture is ever written.

export const PHONE_LIVE_CAMERAS = ["selfie", "back"] as const;
const percent = z.number().int().min(0).max(100);

/** The battery as Android gives it: its charge left (null when it cannot say), whether a charger is in, and whether
 *  the battery saver is on (it slows the phone). */
export const phoneBatterySchema = z.object({ percent: percent.nullable(), plugged: z.boolean(), saver: z.boolean() }).strict();

export const phoneLiveHeaderSchema = z
  .object({
    kind: z.literal("phone-live"),
    version: z.literal(1),
    plan: sha256,
    /** A still body's ten seconds, or a 20-minute run; and its place in the plan's list of that part, from 0. */
    part: z.enum(["still", "live"]),
    step: z.number().int().nonnegative().max(20),
    camera: z.enum(PHONE_LIVE_CAMERAS),
    /** The pictures the model is given, turned upright as a person sees them. */
    picture: z.object({ width: pixels, height: pixels }).strict(),
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
    threads,
    phone: z.object({ maker: phoneWords, model: phoneWords, android: phoneWords, sdk: z.number().int().min(1).max(1000), abi: plainName }).strict(),
    library: phoneWords,
    createMs: milliseconds,
    heat: phoneHeatSchema,
    battery: phoneBatterySchema,
  })
  .strict();

/** Answers to the camera's pictures of one second that may land in the next. */
export const PHONE_LIVE_LATE_ANSWERS = 5;

/** One second of a 20-minute run, counted from the model's first answer. */
export const phoneLiveSecondSchema = z
  .object({
    kind: z.literal("second"),
    s: count,
    /** The second's real length. */
    wallMs: milliseconds,
    /** Pictures the camera gave, answers the model gave (it drops a picture while it is busy, as the library's live
     *  mode does), and of those, answers that found a person. */
    camera: count,
    read: count,
    found: count,
    /** From a picture's arrival to the model's answer for it, the middle and the longest; null with no answer. */
    waitMs: z.object({ middle: milliseconds, most: milliseconds }).strict().nullable(),
    /** The whole app's time on the cores in that second: the camera, the drawing and the model. */
    cpuMs: milliseconds,
    plugged: z.boolean(),
  })
  .strict()
  // Answers that found a body are some of the answers; answers are to the camera's pictures, give or take a few that
  // land in the next second (at most 2 in the 3,600 seconds of 2026-11-18).
  .refine((s) => s.found <= s.read && s.read <= s.camera + PHONE_LIVE_LATE_ANSWERS, { message: "a second's counts do not add up" });

/** The phone at the end of each minute of a 20-minute run. */
export const phoneLiveMinuteSchema = z
  .object({
    kind: z.literal("minute"),
    m: z.number().int().min(1).max(60),
    heat: phoneHeatSchema,
    battery: phoneBatterySchema,
    /** The battery's charge left in µAh, finer than its percent, when the phone can say. */
    chargeUah: z.number().int().nonnegative().max(100_000_000).nullable(),
    /** The app's own memory, the phone's free memory, and whether Android says memory is low. */
    memory: z.object({ appMb: z.number().nonnegative().max(65_536), freeMb: z.number().nonnegative().max(65_536), low: z.boolean() }).strict(),
  })
  .strict();

/** One answer of a still body's ten seconds: the points, as the phone test's frames hold them. */
export const phoneLiveFrameSchema = z
  .object({
    kind: z.literal("frame"),
    /** From the first answer, in milliseconds. */
    t: z.number().nonnegative().max(3_600_000),
    people: z.array(seenPersonSchema).max(MAX_PEOPLE),
  })
  .strict();

export const phoneLiveEndSchema = z
  .object({
    kind: z.literal("end"),
    seconds: count,
    wallMs: milliseconds,
    heat: phoneHeatSchema,
    battery: phoneBatterySchema,
    /** Why the run stopped before its time, in the phone's words; null when it ran its whole time. */
    stopped: z.string().max(400).nullable(),
  })
  .strict();

/** A run that could not start (the camera or the model), and why. */
export const phoneLiveFailedSchema = z
  .object({ kind: z.literal("failed"), plan: sha256, part: z.enum(["still", "live"]), step: z.number().int().nonnegative().max(20), reason: z.string().max(400) })
  .strict();

/** Where the live test is, read by the laptop while the phone is on its cable. */
export const phoneLiveProgressSchema = z
  .object({
    stage: z.enum(["starting", "still", "turn", "unplug", "settle", "running", "cooling", "done", "failed"]),
    step: count,
    steps: count,
    second: count,
    seconds: count,
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
export type PhoneLiveCamera = (typeof PHONE_LIVE_CAMERAS)[number];
export type PhoneBattery = z.infer<typeof phoneBatterySchema>;
export type PhoneLiveHeader = z.infer<typeof phoneLiveHeaderSchema>;
export type PhoneLiveSecond = z.infer<typeof phoneLiveSecondSchema>;
export type PhoneLiveMinute = z.infer<typeof phoneLiveMinuteSchema>;
export type PhoneLiveFrame = z.infer<typeof phoneLiveFrameSchema>;
export type PhoneLiveEnd = z.infer<typeof phoneLiveEndSchema>;
export type PhoneLiveFailed = z.infer<typeof phoneLiveFailedSchema>;
export type PhoneLiveProgress = z.infer<typeof phoneLiveProgressSchema>;

export type SeenPoint = z.infer<typeof seenPointSchema>;
export type WorldPoint = z.infer<typeof worldPointSchema>;
export type SeenPerson = z.infer<typeof seenPersonSchema>;
export type Down = z.infer<typeof downSchema>;
export type MovementFrame = z.infer<typeof movementFrameSchema>;
export type BodyPointsHeader = z.infer<typeof bodyPointsHeaderSchema>;
