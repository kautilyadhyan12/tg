// The videos a movement is proven on (spec Part 2 §12.5; ROADMAP 52a). Kd gave them on 2026-11-19 (his folder
// `D:\exercise video collection`); the videos never go to git, only their body points (test/movement-points), measured
// as the phone measures (scripts/keptVideos.ts `KEPT_MODEL`).
//
// For each: which movement it shows (null: another movement, which must count 0 and say nothing); who is in it, so all
// of one person's videos are left out together when the numbers are tried on a body they were not set from; where the
// phone stood; the reps a person counts by eye (a rep is from standing, down, and back to standing: a video that
// starts low or ends half way does not count that one); and whether it may set the movement's numbers. A video sets
// numbers only when its pictures were drawn (16 frames spread over it) and the person was seen exercising, followed by
// the model, in each, and that look names the very file by its check number: asked for one person, the model gives one
// body whoever it is (51c). bodyCheck.ts `videoOf` adds what the file itself must show.

export type View = "side" | "front" | "between";

export interface MovementVideo {
  /** The body-points file, under packages/movement/test, without its ending. */
  readonly file: string;
  /** The movement it shows; null for another movement. */
  readonly movement: string | null;
  /** One name for one person. */
  readonly person: string;
  readonly view: View;
  /** Reps counted by eye; null where a person could not be sure (the video is then reported, never judged). */
  readonly reps: number | null;
  /** It may set the movement's numbers: its pictures were looked at, and `sha256` names that very file. */
  readonly sets: boolean;
  readonly sha256?: string;
  /** What the pictures showed, in a line. */
  readonly seen: string;
}

const other = (file: string, person: string, view: View, seen: string): MovementVideo => ({ file, movement: null, person, view, reps: 0, sets: false, seen });

export const MOVEMENT_VIDEOS: readonly MovementVideo[] = [
  // ── The squat: the eight people its numbers are set from ───────────────────────────────────────────────
  {
    file: "body-points/squat_reference",
    movement: "squat",
    person: "woman, light gym, arms forward",
    view: "side",
    reps: 3,
    sets: true,
    sha256: "64ba24b76a8d665aa8b80d773bee3c8403921bba66bfcb7f2e46a41af500f67c",
    seen: "2026-11-18 (51c), 16 frames: she is the only person, side on, the whole body in each. Kd's folder holds the same clip again as squat normal/squat1.mp4, left out: one person once.",
  },
  {
    file: "movement-points/squat_normal_2",
    movement: "squat",
    person: "man, green mat, arms crossed",
    view: "side",
    reps: 2,
    sets: true,
    sha256: "ce5f49dcbfcb877c92c2085088e2aeeca567c34a36430a8807d149328a629813",
    seen: "2026-11-19, 16 frames: the one man side on in each. Cut at 4.55 s: at 4.95 s the clip cuts from him half way down to him standing, hands on hips.",
  },
  {
    file: "movement-points/prisoner_squat_1",
    movement: "squat",
    person: "woman, living room, hands behind the head",
    view: "front",
    reps: 3,
    sets: true,
    sha256: "c28b8a45ebb99f1acc4caedadaed84614237be010856efb7378caf257b67d9de",
    seen: "2026-11-19, 16 frames: the one woman facing the phone in each; a play button over her in the first second.",
  },
  {
    file: "movement-points/prisoner_squat_2",
    movement: "squat",
    person: "man, red top, gym",
    view: "front",
    reps: 3,
    sets: true,
    sha256: "e14dc998fa5bbebb6db97a3c1971be8fa7cffab8131f4cfe3f8f8864925481d8",
    seen: "2026-11-19, 16 frames: the one man, a little turned, in each; at the end he talks to the camera, arms down.",
  },
  {
    file: "movement-points/prisoner_squat_3",
    movement: "squat",
    person: "woman, turf, barefoot",
    view: "between",
    reps: 5,
    sets: true,
    sha256: "8806f6f9ce1cad1aaed328bee64899efdc354d61fd0dc01f9f0d06333c46c77a",
    seen: "2026-11-19, 16 frames and the last 1.6 s: the one woman, turned half way, in each; the fifth rep ends standing as the video ends.",
  },
  {
    file: "movement-points/prisoner_squat_4",
    movement: "squat",
    person: "woman, teal sign, studio",
    view: "between",
    reps: 2,
    sets: true,
    sha256: "f092fb73104f2b4e6dcc3dfb2e82238a2f35b6513f507ca0cc24f1e2ff9e891e",
    seen: "2026-11-19, 16 frames: the one woman, turned most of the way, in each. The video starts with her low, rising: not a rep.",
  },
  {
    file: "movement-points/sumo_squat_2a",
    movement: "squat",
    person: "woman, white studio, wide feet",
    view: "front",
    reps: 3,
    sets: true,
    sha256: "94452c33a124f7ea9ff1593b6ddd1e868374312f2c2dfdc67db28d23e4ca1118",
    seen: "2026-11-19, 16 frames: the one woman in each, a title over her in the first frame and text above her. The first 12.1 s of sumo squat2.mp4, before it cuts to a man.",
  },
  {
    file: "movement-points/sumo_squat_2b",
    movement: "squat",
    person: "man, white studio, wide feet",
    view: "front",
    reps: 3,
    sets: true,
    sha256: "ead49a9f9c0baa64dabcd1b17cd85bafcbcbd064b176cb12914b3b2aa28bfd9a",
    seen: "2026-11-19, 16 frames and the last 1.6 s: the one man in each; sumo squat2.mp4 from 12.4 s, after the cut; his third rep ends standing as it ends.",
  },
  // ── Twins of the squat, tried and never setting a number: a count here is expected, not a fault ─────────
  {
    file: "body-points/chair_squat_reference",
    movement: "squat",
    person: "woman, orange wall, chair",
    view: "side",
    reps: 2,
    sets: false,
    seen: "Kd's chair squat: down to a chair and up, side on. It starts seated, so the first stand is not a rep.",
  },
  {
    file: "movement-points/goblet_squat_kettlebell",
    movement: "squat",
    person: "woman, kettlebell at the chest",
    view: "front",
    reps: 2,
    sets: false,
    seen: "2026-11-19, 16 frames and the first 1.2 s at 8 a second: the one woman in each, text above her; she stands at the start (first counted 1: the first picture was misread as half way down).",
  },
  {
    file: "movement-points/sumo_squat_1",
    movement: "squat",
    person: "man, red top, corner",
    view: "between",
    reps: null,
    sets: false,
    seen: "2026-11-19, 16 frames: a white card with nobody at 0.33 s, a text card over him at the end; he steps into his stance in the first frame. Reported only.",
  },
  // ── Every other movement: 0 and silence ──────────────────────────────────────────────────────────────
  other("movement-points/squat_jump_1", "woman, squat jump, dark gym", "side", "Squat jumps: the feet leave the floor at the top."),
  other("movement-points/squat_jump_2", "woman, squat jump, mirror", "between", "Squat jumps, a mirror beside her holding her reflection."),
  other("movement-points/squat_jump_3", "man, squat jump, white", "front", "Squat jumps, a title over the picture."),
  other("movement-points/squat_jump_4", "woman, squat jump, white", "between", "Squat jumps, text above her."),
  other("movement-points/squat_jack_1", "man, squat jack, turf", "front", "Squat jacks: low, the feet jumping out and in."),
  other("movement-points/squat_jack_2", "man, squat jack, bedroom", "front", "Squat jacks."),
  other("movement-points/deadlift_kettlebell", "kettlebell deadlift", "side", "A kettlebell deadlift."),
  other("movement-points/deadlift_barbell", "barbell deadlift", "side", "A conventional barbell deadlift."),
  other("movement-points/romanian_deadlift_barbell", "barbell Romanian deadlift", "side", "A barbell Romanian deadlift."),
  other("movement-points/romanian_deadlift_dumbbell", "dumbbell Romanian deadlift", "side", "A dumbbell Romanian deadlift."),
  other("movement-points/good_morning_barbell", "barbell good morning", "side", "A barbell good morning."),
  other("movement-points/swing_kettlebell", "kettlebell swing", "side", "A two-handed kettlebell swing."),
  other("movement-points/row_barbell", "barbell row", "side", "A bent-over barbell row."),
  other("movement-points/lunge_forward_kettlebell", "kettlebell forward lunge", "between", "Kettlebell forward lunges."),
  other("movement-points/lunge_forward_barbell", "barbell forward lunge", "side", "Barbell forward lunges."),
  other("movement-points/lunge_reverse_dumbbell", "dumbbell reverse lunge", "side", "Dumbbell reverse lunges."),
  other("movement-points/split_squat_smith", "Smith machine split squat", "side", "Split squats in a Smith machine."),
  other("movement-points/step_up_dumbbell", "dumbbell step-up", "side", "Dumbbell step-ups onto a box."),
  other("movement-points/calf_raise", "calf raise", "side", "Calf raises."),
  other("movement-points/calf_raise_dumbbell", "dumbbell calf raise", "side", "Standing dumbbell calf raises."),
  other("movement-points/overhead_press_kettlebell", "kettlebell overhead press", "front", "A kettlebell overhead press."),
  other("movement-points/halo_kettlebell", "kettlebell halo", "front", "A kettlebell halo."),
  other("movement-points/front_raise_plate", "plate front raise", "front", "A weight-plate front raise."),
  other("movement-points/curl_ez_bar", "EZ-bar curl", "side", "A standing EZ-bar curl."),
  other("body-points/bicep_curl_reference", "Kd's bicep curl", "side", "Kd's bicep curl reference."),
  other("body-points/bicycle_crunch_reference", "Kd's bicycle crunch", "side", "Kd's bicycle crunch reference, on the floor."),
  other("body-points/barbell_bench_press_reference", "Kd's barbell bench press", "between", "Kd's barbell bench press, filmed from the feet."),
  other("body-points/dumbbell_bench_press_reference_head_end", "Kd's dumbbell bench press", "between", "Kd's dumbbell bench press from the head end."),
];
