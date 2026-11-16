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

export type SeenPoint = z.infer<typeof seenPointSchema>;
export type WorldPoint = z.infer<typeof worldPointSchema>;
export type SeenPerson = z.infer<typeof seenPersonSchema>;
export type Down = z.infer<typeof downSchema>;
export type MovementFrame = z.infer<typeof movementFrameSchema>;
export type BodyPointsHeader = z.infer<typeof bodyPointsHeaderSchema>;
