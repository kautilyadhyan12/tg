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
  /** One set of a video that holds several (52a-ii-b-i): from and to, seconds of the video's own clock, its first frame
   *  at 0. A person who turns to face the phone another way between squats starts a new set here, so each way of facing
   *  is played as a set of its own, the engine started afresh for it as a live set is; a turn in the middle of a set
   *  played whole is 52d's, and the whole still counts where one was cut (usual_v04, 3 of 3: movementFloor.test.ts). */
  readonly cut?: readonly [number, number];
  /** Filmed with the phone standing on the floor (52a-ii-b-ii-a): the floor's replay is not tried on it. */
  readonly floor?: boolean;
  /** The movement it shows; null for another movement. */
  readonly movement: string | null;
  /** One name for one person. */
  readonly person: string;
  readonly view: View;
  /** Reps counted by eye; null where a person could not be sure, or the camera itself moves (a phone stands still, so a
   *  moving camera makes still feet look as if they moved): the video is then reported, never judged. */
  readonly reps: number | null;
  /** It may set the movement's numbers: its pictures were looked at, and `sha256` names that very file. */
  readonly sets: boolean;
  readonly sha256?: string;
  /** What the pictures showed, in a line. */
  readonly seen: string;
  /** A known wrong count, kept in the table in plain sight until the job named here fixes it. */
  readonly open?: string;
  /** Another movement whose dips the squat's own words reach, counted 0: why, in plain sight. Every other movement says
   *  nothing. */
  readonly told?: string;
  /** A known wrong count with this video's person left out of the numbers (`count`), the video right with every person's
   *  numbers: kept in plain sight until the job named in `why` fixes it. `replays`: the replays under which the count with
   *  the person left out is that same one (`holds` lets it through there only). */
  readonly leftOutOpen?: { readonly count: number; readonly why: string; readonly replays?: readonly string[] };
  /** A known wrong count under some replays only (replays.ts), the video right as filmed: kept in plain sight until the
   *  job named in `why` fixes it. */
  readonly replayOpen?: { readonly replays: readonly string[]; readonly why: string };
  /** A known difference between the phone's run and the laptop's (phoneCounts.ts), kept in plain sight until the job
   *  named in `why` closes it: `differences` are the judge's words for it, exactly; any other difference is a fault. */
  readonly phoneOpen?: { readonly why: string; readonly differences: readonly string[] };
}

const other = (file: string, person: string, view: View, seen: string): MovementVideo => ({ file, movement: null, person, view, reps: 0, sets: false, seen });

/** The frames of one set of a video (`cut`), or the whole video. */
export function framesOf<F extends { readonly t: number }>(entry: MovementVideo, frames: readonly F[]): readonly F[] {
  const cut = entry.cut;
  const t0 = frames[0]?.t;
  if (cut === undefined || t0 === undefined) return frames;
  return frames.filter((f) => f.t - t0 >= cut[0] * 1000 && f.t - t0 <= cut[1] * 1000);
}

/** The name a set goes by in the tables: the file's label, and for a set its time in the video. */
export function labelOf(entry: MovementVideo, label: string): string {
  return entry.cut === undefined ? label : `${label} ${String(entry.cut[0])}-${String(entry.cut[1])} s`;
}

/** A man's own videos, filmed on 2026-11-20 with his phone on the floor and on a raised stand (52a-ii-b): one person,
 *  both rooms left out together. Kept as body points only, under labels that name nobody. */
export const FLOOR_PERSON = "man, his own phone, on the floor and raised";
const floorOther = (label: string, phone: "floor" | "raised", view: View, seen: string): MovementVideo => ({ ...other(`movement-points/${label}`, FLOOR_PERSON, view, seen), ...(phone === "floor" ? { floor: true } : {}) });

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
  // ── A phone on the floor (52a-ii-b-i): a man's own squats, each way he faced a set of its own, counted by eye from
  //    pictures at 2 to 2.5 a second (exercise folder 1's reviews/floor-phone). Good-form squats: every one counts. ───
  { file: "movement-points/floor_phone_test", cut: [0, 12], floor: true, movement: "squat", person: FLOOR_PERSON, view: "side", reps: 3, sets: false,
    seen: "2026-11-20 (52a-ii-b-i), 16 frames of the set drawn with the model's points: the one man, followed in each. The phone on a shiny floor, upright; sandals. From the first picture, at the phone with his hands on the floor, as he walks back from it, then three squats side on. Judged, never setting a number: the model finds nobody in some of its first frames.",
    phoneOpen: {
      why:
        "53, where a live set begins with the person walking back from the phone: on the phone's reading the body check refuses his near " +
        "knee as a broken bone until 4.9 s (the laptop's until 4.1 s), its length learned while he was at the lens; his first squat begins at " +
        "5.0 s, before he was read standing still with his legs, and is never begun.",
      differences: [
        "the laptop counts 3, the phone 2",
        "the laptop says 5.1 s counted, the phone 7.6 s counted",
        "the laptop says 7.6 s counted, the phone 10.0 s counted",
        "the phone does not say 10.0 s counted",
      ],
    },
    leftOutOpen: {
      count: 2,
      why:
        "53, where a phone on the floor is tried in front of a live person: with his own videos left out, the numbers come from the eight people filmed from " +
        "about hip height, and \"feet stay in place\" is 5 cm; side on, on the shiny floor, the slide of his foot points reads 5 to 6 cm on one of his proper squats.",
    },
    replayOpen: {
      replays: ["8 a second", "uneven", "shaky", "chip's gap", "faster"],
      why:
        "53, where a phone on the floor is tried in front of a live person: side on, on the shiny floor, the model slides his near foot's heel and toes about on " +
        "the picture and, after he stands up from each squat, settles them 4 to 5 cm higher, so his proper squats read the feet 3 to 4 cm off the floor as " +
        "filmed (the rule is 4 cm, held there by the jumps it must refuse); a centimetre of shake, the chip's gap, pictures skipped or the same reps done " +
        "faster put a rep over it, or leave its feet unseen. Measured in 52a-ii-b-ii-b-ii: read from the foot points alone, every way that keeps these " +
        "squats lets 8 cm jumps through on this set (taken against where the feet settle, 114 of 810; against where they were just before and after, 158), " +
        "and the hips' own rise and fall, which would tell them apart, also lets a split squat's step through.",
    } },
  { file: "movement-points/floor_phone_test", cut: [13.9, 21.1], floor: true, movement: "squat", person: FLOOR_PERSON, view: "between", reps: 3, sets: true, sha256: "023bdc68c259df01ea372e9cb1be961e3c56be8c7e3ca9fb0b8797511a0920a1",
    seen: "2026-11-20 (52a-ii-b-i), 16 frames of the set drawn with the model's points: the one man, followed in each. The phone on a shiny floor: three squats half turned to it, the floor's reflection under his toes.",
    phoneOpen: {
      why:
        "53, where a phone on the floor is tried in front of a live person: on the phone's reading his third squat's feet read about 4 cm off the floor (the " +
        "laptop's 3), over the rule held at 4 by the jumps it must refuse.",
      differences: ["the laptop counts 3, the phone 2", "the phone does not say 19.3 s counted"],
    },
    replayOpen: {
      replays: ["slower", "twice as slow"],
      why:
        "53, where a phone on the floor is tried in front of a live person: the same reps done 1.5 or 2 times as slowly read the third squat's feet over the 4 cm " +
        "rule, as the phone's reading does as filmed: half turned on the shiny floor his toe point lies on the floor's reflection, up to 8 cm down the " +
        "picture, and his heel 5 cm up from the first moment of that squat.",
    } },
  { file: "movement-points/floor_phone_test", cut: [22.3, 31.4], floor: true, movement: "squat", person: FLOOR_PERSON, view: "front", reps: 3, sets: true, sha256: "023bdc68c259df01ea372e9cb1be961e3c56be8c7e3ca9fb0b8797511a0920a1",
    seen: "2026-11-20 (52a-ii-b-i), 16 frames of the set drawn with the model's points: the one man, followed in each. The phone on a shiny floor: three squats facing it." },
  { file: "movement-points/usual_v04", cut: [0, 9.2], floor: true, movement: "squat", person: FLOOR_PERSON, view: "front", reps: null, sets: false,
    seen: "The phone on a dull floor: one deep squat held about 5 s facing the phone, hands to the floor (3.6 to 9.0 s). Reported, never judged: a hold is not a rep." },
  { file: "movement-points/usual_v04", cut: [9.8, 17.5], floor: true, movement: "squat", person: FLOOR_PERSON, view: "side", reps: 2, sets: true, sha256: "490c374accbcd5e80d72c67af894dfbd4045fff42c1ce8f90becc99cfa65375f",
    seen: "2026-11-20 (52a-ii-b-i), 16 frames drawn with the model's points over 9.8 to 23.2 s, this set and the next: the one man, followed in each. The phone on a dull floor: two squats side on; sandals. From 16.9 to 19.0 s he turns round, through facing the phone, to side on the other way (his shoulder line in 3D from 73 to -75 degrees; 52a-ii-b-ii-b-ii).",
    phoneOpen: {
      why:
        "53, where the camera screen tries a phone on the floor in front of a live person: in the first picture of his second squat the phone's model " +
        "puts his near foot 10 cm up, in the next 2 cm (the laptop's stays down), a picture no real foot can be in, read as the feet leaving the floor " +
        "(9 cm) and moving (10 cm). Letting a foot reading count only where a picture beside it agrees let 14 of 540 drawn jumps count (52a-ii-b-i), " +
        "and a middle of each foot point over 0.1 s, tried in 52a-ii-b-ii-b-ii, did not take it away (the foot's travel reads it too) and let 6 " +
        "more of 810 count: neither was kept.",
      differences: ["the laptop counts 2, the phone 1", "the phone does not say 15.6 s counted"],
    } },
  { file: "movement-points/usual_v04", cut: [19.2, 23.2], floor: true, movement: "squat", person: FLOOR_PERSON, view: "side", reps: 1, sets: true, sha256: "490c374accbcd5e80d72c67af894dfbd4045fff42c1ce8f90becc99cfa65375f",
    seen: "2026-11-20 (52a-ii-b-i), 16 frames drawn with the model's points over 9.8 to 23.2 s, this set and the one before: the one man, followed in each. The phone on a dull floor: after turning round he squats once side on, facing the other way (52a-ii-b-ii-b-ii)." },
  { file: "movement-points/usual_v11", cut: [1.3, 7.4], movement: "squat", person: FLOOR_PERSON, view: "between", reps: 2, sets: true, sha256: "e9f6f3f98f7b27d7b5737c32734a3ad8025a0e88af06d0ca668c485f42e36707",
    seen: "2026-11-20 (52a-ii-b-i), 16 frames of the set drawn with the model's points: the one man, followed in each. The phone raised to about his knees or hips (not measured), upright; barefoot: two squats half turned." },
  { file: "movement-points/usual_v11", cut: [8.3, 14.2], movement: "squat", person: FLOOR_PERSON, view: "side", reps: 2, sets: true, sha256: "e9f6f3f98f7b27d7b5737c32734a3ad8025a0e88af06d0ca668c485f42e36707",
    seen: "2026-11-20 (52a-ii-b-i), 16 frames of the set drawn with the model's points: the one man, followed in each. The phone raised: two squats side on." },
  { file: "movement-points/usual_v11", cut: [15.3, 21.6], movement: "squat", person: FLOOR_PERSON, view: "front", reps: 2, sets: true, sha256: "e9f6f3f98f7b27d7b5737c32734a3ad8025a0e88af06d0ca668c485f42e36707",
    seen: "2026-11-20 (52a-ii-b-i), 16 frames of the set drawn with the model's points: the one man, followed in each. The phone raised: two squats facing it." },
  { file: "movement-points/usual_v11", cut: [22, 29.5], movement: "squat", person: FLOOR_PERSON, view: "between", reps: 2, sets: true, sha256: "e9f6f3f98f7b27d7b5737c32734a3ad8025a0e88af06d0ca668c485f42e36707",
    seen: "2026-11-20 (52a-ii-b-i), 16 frames of the set drawn with the model's points: the one man, followed in each. The phone raised: two squats half turned the other way." },
  { file: "movement-points/usual_v11", cut: [30, 39], movement: "squat", person: FLOOR_PERSON, view: "between", reps: 2, sets: true, sha256: "e9f6f3f98f7b27d7b5737c32734a3ad8025a0e88af06d0ca668c485f42e36707",
    seen: "2026-11-20 (52a-ii-b-i), 16 frames of the set drawn with the model's points: the one man, followed in each. The phone raised: two squats half turned.",
    replayOpen: {
      replays: ["shaky", "chip's gap", "slower"],
      why:
        "53, where a phone on the floor is tried in front of a live person: right with every person's numbers under all three; with his own videos left out, " +
        "the numbers come from the eight people filmed from about hip height (\"feet stay in place\" 5 cm, his own pair reading 4.8 to 5.3), and a " +
        "centimetre of shake, the chip's gap or the same reps done 1.5 times as slowly put one of these two squats over them.",
    } },
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
  // ── Looked at while the rules were chosen after all: a twin of the squat, tried, never setting a number ──────────
  { file: "movement-points/fresh_front_squat_barbell", movement: "squat", person: "woman, barbell in front", view: "side", reps: 3, sets: false,
    seen: "A barbell front squat, three reps; she gets up from the third in the last 0.3 s. Looked at for the feet's rule (the model slides her toe point 7 cm down the picture at the bottom; her heel comes up 3 cm as she stands tall), so no longer a test on a video nobody had looked at." },
  // ── Fresh videos (2026-11-19), measured after the squat's rules and numbers were fixed and never used to choose
  //    them: the test on videos nobody had looked at. Reps counted by eye before the engine was run on them. ────────
  { file: "movement-points/fresh_back_squat_barbell", movement: "squat", person: "woman, barbell on the back", view: "side", reps: null, sets: false, seen: "Fresh: a barbell back squat, side on, three reps by eye; the camera pans and zooms with her (the rack moves on the picture by her feet's 14 cm), so it is reported, never judged." },
  { file: "movement-points/fresh_squat_smith", movement: "squat", person: "man, Smith machine", view: "front", reps: 0, sets: false, seen: "Fresh: 3.5 s of a Smith machine squat that starts at the bottom and rises: no rep from standing." },
  { file: "movement-points/fresh_goblet_squat_plate", movement: "squat", person: "woman, plate at the chest", view: "side", reps: 4, sets: false, seen: "Fresh: a weight-plate goblet squat; it starts low and rises (not a rep), then four reps." },
  { file: "movement-points/fresh_front_squat_kettlebell", movement: "squat", person: "man, kettlebells in front", view: "front", reps: null, sets: false, seen: "Fresh: a kettlebell front squat facing the phone, three reps by eye; the camera tilts down in its first 0.6 s and moves later (the wall's foot and the bikes shift): reported, never judged." },
  // ── Every other movement: 0 and silence ──────────────────────────────────────────────────────────────
  other("movement-points/squat_jump_1", "woman, squat jump, dark gym", "side", "Squat jumps: the feet leave the floor at the top."),
  other("movement-points/squat_jump_2", "woman, squat jump, mirror", "between", "Squat jumps, a mirror beside her holding her reflection."),
  other("movement-points/squat_jump_3", "man, squat jump, white", "front", "Squat jumps, a title over the picture."),
  other("movement-points/squat_jump_4", "woman, squat jump, white", "between", "Squat jumps, text above her."),
  other("movement-points/squat_jack_1", "man, squat jack, turf", "front", "Squat jacks: low, the feet jumping out and in."),
  {
    ...other("movement-points/squat_jack_2", "man, squat jack, bedroom", "front", "Squat jacks."),
    replayOpen: {
      replays: ["slower", "twice as slow"],
      why:
        "52c, where jumps are counted as a kind of their own: as filmed he never stands still between jacks long enough to be read standing, " +
        "so no dip begins a rep; done 1.5 or 2 times as slowly he does, and two of his jacks read their feet 2 to 6 cm moved and 1 cm up, " +
        "under the rules, while \"stance holds\" reads nothing on this video. Two are counted done 1.5 times as slowly, one twice as slowly. " +
        "Measured in 52b-i: the standing before each is taken as his feet jump out, both moving 3.9 to 4.1 cm in that 0.2 s, where a real " +
        "squat's feet move up to 3.8 cm in the standing taken before it, so the feet's stillness cannot tell them apart.",
    },
  },
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
  other("movement-points/fresh_deadlift_kettlebell_1", "fresh: kettlebell deadlift, 1", "side", "Fresh: a kettlebell deadlift."),
  other("movement-points/fresh_deadlift_kettlebell_2", "fresh: kettlebell deadlift, 2", "front", "Fresh: a kettlebell deadlift."),
  other("movement-points/fresh_lunge_forward_kettlebell_0", "fresh: Kettlebell forward lunges, 0", "side", "Fresh: Kettlebell forward lunges."),
  other("movement-points/fresh_lunge_forward_kettlebell_2", "fresh: Kettlebell forward lunges, 2", "between", "Fresh: Kettlebell forward lunges."),
  other("movement-points/fresh_swing_kettlebell_1", "fresh: two-handed kettlebell swing, 1", "between", "Fresh: a two-handed kettlebell swing."),
  other("movement-points/fresh_swing_kettlebell_2", "fresh: two-handed kettlebell swing, 2", "between", "Fresh: a two-handed kettlebell swing."),
  other("movement-points/fresh_swing_one_hand", "fresh: one-handed kettlebell swing, one", "side", "Fresh: a one-handed kettlebell swing."),
  {
    ...other("movement-points/fresh_push_press_kettlebell", "fresh: kettlebell push press, one", "between", "Fresh: a kettlebell push press."),
    told:
      "Its dip bends the knees to 120 to 127 degrees, a quarter squat by the squat's own form standard (110 to 140), so it counts 0 since 52b-i (3 of 4 " +
      "dips before); the squat's movement does not read the arms, so to the camera the dips that went most of the way are a quarter squat, told " +
      "\"Go lower to count.\", as a quarter squat is.",
  },
  other("movement-points/fresh_snatch_kettlebell", "fresh: kettlebell snatch, one", "side", "Fresh: a kettlebell snatch."),
  other("movement-points/fresh_row_kettlebell", "fresh: one-arm kettlebell row, one", "side", "Fresh: a one-arm kettlebell row."),
  other("movement-points/fresh_good_morning_1", "fresh: barbell good morning, 1", "side", "Fresh: a barbell good morning."),
  other("movement-points/fresh_good_morning_2", "fresh: barbell good morning, 2", "side", "Fresh: a barbell good morning."),
  other("movement-points/fresh_deadlift_barbell_0", "fresh: conventional barbell deadlift, 0", "between", "Fresh: a conventional barbell deadlift."),
  other("movement-points/fresh_romanian_deadlift_barbell_0", "fresh: barbell Romanian deadlift, 0", "between", "Fresh: a barbell Romanian deadlift."),
  other("movement-points/fresh_romanian_deadlift_barbell_2", "fresh: barbell Romanian deadlift, 2", "side", "Fresh: a barbell Romanian deadlift."),
  other("movement-points/fresh_romanian_deadlift_dumbbell_0", "fresh: dumbbell Romanian deadlift, 0", "side", "Fresh: a dumbbell Romanian deadlift."),
  other("movement-points/fresh_romanian_deadlift_dumbbell_1", "fresh: dumbbell Romanian deadlift, 1", "side", "Fresh: a dumbbell Romanian deadlift."),
  other("movement-points/fresh_romanian_deadlift_dumbbell_3", "fresh: dumbbell Romanian deadlift, 3", "between", "Fresh: a dumbbell Romanian deadlift."),
  other("movement-points/fresh_lunge_reverse_dumbbell_1", "fresh: Dumbbell reverse lunges, 1", "side", "Fresh: Dumbbell reverse lunges."),
  other("movement-points/fresh_step_up_dumbbell_0", "fresh: Dumbbell step-ups, 0", "side", "Fresh: Dumbbell step-ups."),
  other("movement-points/fresh_step_up_dumbbell_1", "fresh: Dumbbell step-ups, 1", "between", "Fresh: Dumbbell step-ups."),
  other("movement-points/fresh_calf_raise_2", "fresh: Calf raises at a wall, 2", "side", "Fresh: Calf raises at a wall."),
  other("movement-points/fresh_calf_raise_dumbbell_1", "fresh: Standing dumbbell calf raises, 1", "front", "Fresh: Standing dumbbell calf raises."),
  other("movement-points/fresh_calf_raise_dumbbell_2", "fresh: Standing dumbbell calf raises, 2", "front", "Fresh: Standing dumbbell calf raises."),
  other("movement-points/fresh_split_squat_smith_0", "fresh: Smith machine split squats, 0", "side", "Fresh: Smith machine split squats."),
  other("movement-points/fresh_split_squat_smith_2", "fresh: Smith machine split squats, 2", "between", "Fresh: Smith machine split squats."),
  other("movement-points/fresh_split_squat_smith_3", "fresh: Smith machine split squats, 3", "side", "Fresh: Smith machine split squats."),
  other("movement-points/fresh_lunge_forward_barbell_2", "fresh: Barbell forward lunges, 2", "side", "Fresh: Barbell forward lunges."),
  other("movement-points/fresh_lunge_forward_plate", "fresh: Weight-plate forward lunges, one", "side", "Fresh: Weight-plate forward lunges."),
  other("movement-points/fresh_overhead_press_plate", "fresh: weight-plate overhead press, one", "front", "Fresh: a weight-plate overhead press."),
  other("movement-points/fresh_overhead_press_barbell", "fresh: barbell overhead press, one", "front", "Fresh: a barbell overhead press."),
  other("movement-points/fresh_curl_barbell", "fresh: barbell biceps curl, one", "front", "Fresh: a barbell biceps curl."),
  other("movement-points/fresh_rack_pull_barbell", "fresh: barbell rack pull, one", "between", "Fresh: a barbell rack pull."),
  other("movement-points/fresh_curl_ez_bar_1", "fresh: standing EZ-bar curl, 1", "front", "Fresh: a standing EZ-bar curl."),
  // ── A phone on the floor or raised, the usual positions of other exercises (52a-ii-b-i): no squat in any ───────────
  floorOther("usual_v02", "floor", "front", "The phone on the floor, upright: he stands and turns round slowly."),
  floorOther("usual_v03", "floor", "front", "The phone on the floor, on its long side: he stands and turns round."),
  floorOther("usual_v05", "floor", "front", "The phone on the floor, upright: he sits cross-legged and turns round."),
  floorOther("usual_v06", "floor", "side", "The phone on the floor, on its long side: on all fours, he turns round."),
  floorOther("usual_v07", "floor", "side", "The phone on the floor, on its long side: he lies on the floor, raises a leg, sits up."),
  {
    ...floorOther("usual_v08", "floor", "side", "The phone on the floor, upright; barefoot: he sits on a chair side on, gets up, sits (a chair squat's movement: 54)."),
    replayOpen: {
      replays: ["passer-by at the bottom"],
      why:
        "54, where the chair squat is made on the squat: sitting down on a chair and getting up is a chair squat's movement, which this list " +
        "counts as a twin of the squat (chair_squat_reference). As filmed he sits for several seconds each time and nothing is counted; with " +
        "somebody walking past while he sits, the sitting is hidden and one sit-and-stand counts as a squat.",
    },
  },
  floorOther("usual_v09", "floor", "side", "The phone on the floor, upright: he stands at a chair, one leg lifted and bent."),
  floorOther("usual_v10", "floor", "side", "The phone on the floor, on its long side: he sits on a chair, gets up, sits (54)."),
  floorOther("usual_v12", "raised", "between", "The phone raised, upright: he sits on a chair from the front and the side, stands, puts one knee on the chair."),
  floorOther("usual_v13", "raised", "side", "The phone raised, on its long side: he lies on a bed, raises a leg, sits up."),
  floorOther("usual_v14", "raised", "front", "The phone raised, upright: he stands and turns round."),
];
