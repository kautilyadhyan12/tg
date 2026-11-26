// The videos a movement is proven on (spec Part 2 §12.5; ROADMAP 52a). Kd gave them on 2026-11-19 (his folder
// `D:\exercise video collection`); the videos never go to git, only their body points (test/movement-points), measured
// as the phone measures (scripts/keptVideos.ts `KEPT_MODEL`).
//
// For each: which movement it shows (null: none the engine has, which must count 0 and say nothing under every one; a
// video of one movement must count 0 and say nothing under every other); who is in it, so all
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
  /** The movement it shows (a file in movements/); null for one the engine does not have. Under every other movement it
   *  must count 0 and say nothing. */
  readonly movement: string | null;
  /** For a movement counted one side at a time, each rep's side by eye, in order (the person's own left and right, as the
   *  pictures show them): every counted rep must be given the side the eye gave it. */
  readonly sides?: readonly ("left" | "right")[];
  /** The known cases under another movement than the squat, by its name: `open`, `told`, `leftOutOpen`, `replayOpen` and
   *  `phoneOpen` below are about the squat (`forMovement`). */
  readonly under?: Readonly<Record<string, KnownCases>>;
  /** One name for one person. */
  readonly person: string;
  readonly view: View;
  /** Reps counted by eye; null where a person could not be sure, or the camera itself moves (a phone stands still, so a
   *  moving camera makes still feet look as if they moved): the video is then reported, never judged. */
  readonly reps: number | null;
  /** For a hold (52c-ii), when the pictures show it held, seconds of the video's own clock: from the first picture held to
   *  the last, each hold a pair. Its clock must give that time, and every other video none. */
  readonly held?: readonly (readonly [number, number])[];
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
  readonly leftOutOpen?: LeftOutOpen;
  /** A known wrong count under some replays only (replays.ts), the video right as filmed: kept in plain sight until the
   *  job named in `why` fixes it. */
  readonly replayOpen?: { readonly replays: readonly string[]; readonly why: string };
  /** A known difference between the phone's run and the laptop's (phoneCounts.ts), kept in plain sight until the job
   *  named in `why` closes it: `differences` are the judge's words for it, exactly; any other difference is a fault. */
  readonly phoneOpen?: { readonly why: string; readonly differences: readonly string[] };
}

/** A known wrong count with a video's person left out of the numbers (`count`), the video right with every person's
 *  numbers. `replays`: the replays under which the count with the person left out is that same one. `fewer`: with the
 *  person left out the video counts fewer than by eye, never more, as filmed and under every replay (the numbers then come
 *  from people who do not move as this one does, and their reps read as another movement). */
export interface LeftOutOpen {
  readonly count: number;
  readonly why: string;
  readonly replays?: readonly string[];
  readonly fewer?: boolean;
}

/** The known cases of a video under one movement (`MovementVideo.under`). */
export interface KnownCases {
  readonly open?: string;
  readonly leftOutOpen?: LeftOutOpen;
  readonly replayOpen?: { readonly replays: readonly string[]; readonly why: string };
  readonly phoneOpen?: { readonly why: string; readonly differences: readonly string[] };
}

const other = (file: string, person: string, view: View, seen: string): MovementVideo => ({ file, movement: null, person, view, reps: 0, sets: false, seen });

/** The entry as a movement reads it: the known cases about the squat only under the squat; under another movement its own
 *  (`under`). */
export function forMovement(entry: MovementVideo, movement: string): MovementVideo {
  if (movement === "squat") return entry;
  const read: { -readonly [K in keyof MovementVideo]: MovementVideo[K] } = { ...entry };
  delete read.open;
  delete read.told;
  delete read.leftOutOpen;
  delete read.replayOpen;
  delete read.phoneOpen;
  delete read.under;
  return { ...read, ...(entry.under?.[movement] ?? {}) };
}

/** The split squat in the Smith machine, a twin of the lunge (52c-i): known, until the split squat is made. */
const SPLIT_SQUAT_STAYS_SPLIT =
  "54, where the split squat is made on the lunge: it stays in its split stance between reps, the back knee bent, so it is seldom " +
  "standing tall (both knees within 20 degrees of straight), and a rep is begun only from a standing; side on, the far leg is hidden " +
  "at the bottom in most pictures, so its legs' split goes unread. The four videos count 4 of 10 by eye (fresh_split_squat_smith_0, standing tall between his, 3 of 3).";

/** Kd's two squat-jack videos under the squat jump (52c-i), counted there: known, until the squat jack is made. */
const SQUAT_JACK_AS_A_JUMP =
  "54, where the squat jack is made: each of his wide squats ends with a jump up as his feet come in, so to the squat jump's rules it is a " +
  "squat jump in a wide stance. The stance rule refuses it only where the picture reads the feet's width; from the 3D points the width " +
  "moves as much on real squat jumps filmed side on (0.42 to 0.74 of a trunk) as on his jacks (0.27 to 0.92), so it cannot tell them apart. " +
  "Kd's research file calls standing up between jacks a mistake: the squat jack done as it describes, staying low, never jumps up out of a dip.";

/** Whether the video shows another movement than this one: it must count 0 and say nothing under it. */
export const isOther = (entry: MovementVideo, movement: string): boolean => entry.movement !== movement;

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
  // ── The squat jump (52c-i): Kd's four videos (squat/Squat Jump), each a different person, counted by eye from pictures
  //    at 4 a second; a rep is a dip and the jump out of it, so a dip begun before the video, or one it ends in, does not
  //    count. None stands still between jumps: a standing is read on the move (matcher.ts `movingStanding`), from the few
  //    pictures a jumper is upright on the floor. Each starts low, as a clip cut from a set does, where a live set begins
  //    with the person standing: so each is played from the first picture of them upright on the floor, held for a second
  //    as every video's first picture is (at 15 or 8 pictures a second the first such picture of a clip is often never
  //    taken, and the reps before it go unmeasured). ────────────────────────────────────────────────────────────────
  {
    file: "movement-points/squat_jump_1",
    cut: [0.69, 6.7],
    movement: "squat-jump",
    person: "woman, squat jump, dark gym",
    view: "side",
    reps: 4,
    under: {
      "squat-jump": {
        leftOutOpen: {
          count: 1,
          fewer: true,
          why:
            "54, once more squat-jump videos come: she leans 51 to 54 degrees at the bottom of each dip, further than any of the other three " +
            "squat-jump people or the squat's nine (at most 44), so with her left out \"chest up\" is set at 51 and three of her four dips read as " +
            "another movement. With every person's numbers she counts 4 of 4; her research file's moderate lean is 30 to 45 degrees.",
        },
      },
    },
    sets: true,
    sha256: "1fca93c957e5de8ec1a930367d4115c7a273e15448477a0815d4253dc21316e9",
    seen: "2026-11-23 (52c-i), 16 frames drawn with the model's points: the one woman, side on, in each. She starts low and jumps at 0.75 s; played from 0.7 s, the first picture of her upright on the floor, as she takes off. Then four dips each with its jump (2.0, 3.4, 4.75 and 6.0 s); she is in a dip again as it ends.",
  },
  {
    file: "movement-points/squat_jump_2",
    cut: [1.86, 7.2],
    movement: "squat-jump",
    under: {
      "squat-jump": {
        replayOpen: {
          replays: ["twice as slow"],
          why:
            "none: a jump cannot be done twice as slowly, gravity sets its time in the air. Played so, her third jump leaves the floor " +
            "more than the moment after the rep (0.4 s) after she is back up, and reads under the jump's line, so that rep is another " +
            "movement, with no word; done 1.5 times as slowly every rep counts.",
        },
      },
    },
    person: "woman, squat jump, mirror",
    view: "between",
    reps: 4,
    sets: true,
    sha256: "507a46a0a187350e871f152d769da8d1ae4cfab6bfa9b72811afc8a635fbde07",
    seen: "2026-11-23 (52c-i), 16 frames drawn with the model's points: the woman followed in each, never her reflection in the mirror beside her. She starts low and jumps at 0.5 s, lands straight into a dip and jumps out of it at 1.5 s; played from 1.87 s, the first picture of her upright on the floor, as she lands. Then four dips each with its jump (2.75, 3.75, 5.0 and 6.25 s); she is rising out of a dip as it ends.",
  },
  {
    file: "movement-points/squat_jump_3",
    cut: [0.69, 8.6],
    movement: "squat-jump",
    person: "man, squat jump, white",
    view: "front",
    reps: 5,
    sets: true,
    sha256: "046e1b6931d78e3dbf2ca316cffbaff7fa71f055245963efb5e5d740f0ee8eba",
    seen: "2026-11-23 (52c-i), 16 frames drawn with the model's points: the one man, facing the phone, in each; a title from 1.75 s. He starts low; played from 0.7 s, the first picture of him upright on the floor, as he takes off. Then five dips each with its jump (2.2, 3.6, 5.1, 6.5 and 7.9 s); he is in a dip again as it ends.",
  },
  {
    file: "movement-points/squat_jump_4",
    cut: [0.42, 5.4],
    movement: "squat-jump",
    person: "woman, squat jump, white",
    view: "between",
    reps: 3,
    sets: true,
    sha256: "286bcc1484ce9f77293a726f15951f12b938db5b3ddc6644f5a78a6b2b6f4d30",
    seen: "2026-11-23 (52c-i), 16 frames drawn with the model's points: the one woman in each; text above her. Played from 0.43 s, the first picture of her upright on the floor, as she takes off from her low start, to 5.4 s: at 5.5 s the video cuts to her close up, her feet off the picture. Then three dips each with its jump (1.9, 3.25 and 4.75 s), and she is in a dip as the cut comes.",
  },
  // ── The lunge (52c-i), counted one side at a time: Kd's forward and reverse lunges, counted by eye from pictures at 2 a
  //    second, each rep's front leg from pictures of its bottom (which leg lies nearer the phone, and the person's own
  //    left and right from the way they face). A lunge is from standing, a step, down, and back up. ──────────────────
  {
    file: "movement-points/lunge_forward_kettlebell",
    movement: "lunge",
    person: "man, green top, kettlebell at the chest",
    view: "side",
    reps: 3,
    sides: ["left", "left", "left"],
    sets: true,
    sha256: "89be33a47047da134772bc83df59a430240f110f8f034767c1bef8d9d957d9a0",
    seen: "2026-11-23 (52c-i): the one man, side on, facing right, his right side to the phone. Three forward lunges, each with his left leg in front (the far leg).",
  },
  {
    file: "movement-points/fresh_lunge_forward_kettlebell_0",
    movement: "lunge",
    person: "man, blue top, black gym",
    view: "side",
    reps: 3,
    sides: ["right", "left", "right"],
    sets: true,
    sha256: "d3f3758c41a7d541b6501fad8eb50974a69b87b43ae2b3737ef59876936b5565",
    seen: "2026-11-23 (52c-i): the one man, side on, facing left, his left side to the phone, kettlebells at his sides. Three forward lunges, the legs taking turns: right (the far leg), left (the near), right.",
  },
  {
    file: "movement-points/fresh_lunge_forward_plate",
    movement: "lunge",
    person: "man, blue top, black gym",
    view: "side",
    reps: 3,
    sides: ["left", "right", "left"],
    sets: true,
    sha256: "2e162d1c8a62b94b9f7ad9cf53776ad38163ff0f29d1857b3e4a044808a46158",
    seen: "2026-11-23 (52c-i): the same man as the kettlebell lunges (the same gym), a plate at his chest, facing left. He is already stepping into his first lunge in the first picture (right leg in front: not a rep), then three, the legs taking turns: left, right, left.",
  },
  {
    file: "movement-points/lunge_forward_barbell",
    movement: "lunge",
    person: "man, barbell, white gym",
    view: "side",
    reps: 2,
    under: {
      lunge: {
        leftOutOpen: {
          count: 1,
          fewer: true,
          why:
            "54, once more lunge videos come: side on, the bar's plate over him, his shins read 46 to 57 degrees apart at the bottom, the " +
            "narrowest of the six lunge people (the others 60 or more), so with his own videos left out \"legs split\" is set at 49 and his " +
            "first lunge reads as another movement. With every person's numbers (25) he counts 2 of 2, and every squat counts 0.",
        },
      },
    },
    sides: ["right", "right"],
    sets: true,
    sha256: "c9b9b67569294fa3bc24dc0da063da898bb85f8fe39e40f3b12284a7c5a3cfbf",
    seen: "2026-11-23 (52c-i): the one man, facing right and a little away, the bar's plate over his back. Two forward lunges, each with his right leg in front (the near leg, its foot lower on the picture).",
  },
  {
    file: "movement-points/fresh_lunge_forward_barbell_2",
    cut: [0, 3.45],
    movement: "lunge",
    person: "man, barbell, rooftop",
    view: "side",
    reps: 1,
    sides: ["left"],
    sets: true,
    sha256: "2613636862a1dcce25b42742297c0ee89cad216b4d304a83516a9fc0c1b0fd8d",
    seen: "2026-11-23 (52c-i): the one man on a rooftop, facing left, his left side to the phone. The video fades from one take to the next at 3.5 s (the same place; the person lost for half a second, which a phone's live picture never does), so each take is a set of its own. This one: one forward lunge, his left leg in front (the near leg).",
  },
  {
    file: "movement-points/fresh_lunge_forward_barbell_2",
    cut: [4.33, 11.3],
    movement: "lunge",
    person: "man, barbell, rooftop",
    view: "side",
    reps: 3,
    sides: ["left", "left", "left"],
    sets: true,
    sha256: "2613636862a1dcce25b42742297c0ee89cad216b4d304a83516a9fc0c1b0fd8d",
    seen: "2026-11-23 (52c-i): the second take, after the fade, standing at its start: three forward lunges, each with his left leg in front (the near leg).",
  },
  {
    file: "movement-points/lunge_reverse_dumbbell",
    movement: "lunge",
    person: "woman, dumbbells, green turf",
    view: "side",
    reps: 2,
    sides: ["right", "right"],
    sets: true,
    sha256: "45747edf338bc8f8793a7f4ba66d872ece941f8c741a4892096a0aa388efef22",
    seen: "2026-11-23 (52c-i): the one woman, facing left, her left side to the phone. She starts at the bottom of a reverse lunge (not a rep), then two, each with her right leg in front (the far leg: her near arm and back leg lie in front of it).",
  },
  {
    file: "movement-points/fresh_lunge_reverse_dumbbell_1",
    movement: "lunge",
    person: "woman, dumbbells, white studio",
    view: "between",
    reps: 3,
    sides: ["right", "right", "right"],
    sets: true,
    sha256: "20bcb06d679d7851af810b9837d6deae4abfa613b96bb2cedd19db7a53a8eb68",
    seen: "2026-11-23 (52c-i): the one woman, turned half way to the phone, facing its left. Three reverse lunges, each with her right leg in front (on the picture's left as she faces it).",
  },
  {
    file: "movement-points/fresh_lunge_forward_kettlebell_2",
    movement: "lunge",
    person: "woman, kettlebells, cream room",
    view: "between",
    reps: 3,
    sides: ["left", "left", "left"],
    under: {
      lunge: {
        replayOpen: {
          replays: ["shaky", "slower", "twice as slow"],
          why:
            "53, where a live set begins with the person standing: her first lunge begins 0.2 s after the video's first picture, from a " +
            "stance at the very edge of standing tall (her knees 156 and 169 degrees, the line 160), so shaken, or slowed, the camera has not " +
            "taken her standing before she goes down, and that lunge is not measured. Her other two count under every replay.",
        },
      },
    },
    sets: false,
    seen: "2026-11-23 (52c-i), judged, never setting a number: the one woman, half turned, facing left. In the first picture she has already stepped forward, upright, then goes down and back up (a lunge: first counted as begun low from pictures at 2 a second, put right from pictures drawn at 0, 0.1, 0.2, 0.3, 0.43 and 0.6 s), then two more, each with her left leg in front (the near leg, its foot lowest on the picture); she is stepping back up out of the last, her hips up, as the video ends.",
  },
  // ── The sit-up (52c-ii), floor work: Kd's weighted sit-ups and decline sit-ups (Weight plates/Weight-Plate Weighted
  //    Sit-Up, Parallel-Bar Dip/decline sit up), each a different person, counted by eye from 16 pictures drawn with the
  //    model's points. A sit-up is from lying back, up, and back down; a video that starts sat up does not count its first
  //    lying back, and a set may end sat up after its last sit-up (the movement's `lastRep`). ──────────────────────────
  {
    file: "movement-points/sit_up_plate_0",
    movement: "sit-up",
    person: "man, green turf, plate held up",
    view: "side",
    reps: 3,
    sets: true,
    sha256: "95f54ecf94327105d6b406b451129d874b84a2bd427ee6174d4702fa763db541",
    seen: "2026-11-24 (52c-ii), 16 frames drawn with the model's points: the one man, side on, his legs straight, the plate held up over him in each. He starts lying, then three sit-ups (the tops at 1.6, 4.8 and 8.0 s), and is lying again as it ends; a play button over him in the first second.",
  },
  {
    file: "movement-points/sit_up_plate_1",
    movement: "sit-up",
    person: "woman, blue gym, plate overhead",
    view: "side",
    reps: 2,
    sets: true,
    sha256: "f32b3183ef8ecad24d7cf413aa97ce815ac3a63e8fca4e562a1e8ef4c16a7807",
    seen: "2026-11-24 (52c-ii), 16 frames drawn with the model's points: the one woman, side on, her knees bent, in each. She lies until 1.2 s, then two sit-ups (the tops at 2.1 and 4.0 s), and is lying back as it ends at 4.8 s; a play button over her from 1.3 to 1.6 s.",
  },
  {
    file: "movement-points/sit_up_plate_2",
    movement: "sit-up",
    person: "man, grey top, GO ALL OUT",
    view: "side",
    reps: 3,
    sets: true,
    sha256: "c91fb9ce8435d1bb528251aa7beb4a528bdaf67ad0f40ca3e9489f6032cc32dd",
    seen: "2026-11-24 (52c-ii), 16 frames drawn with the model's points: the one man, side on, his knees bent, a plate at his chest, in each. He starts sat up and lies back (not a rep), then three sit-ups (the tops at 3.4, 5.3 and 8.1 s), and is still sat up after the third as it ends.",
  },
  {
    file: "movement-points/sit_up_plate_3",
    movement: "sit-up",
    person: "man, black top, mat on a wooden floor",
    view: "between",
    reps: 2,
    under: {
      "sit-up": {
        leftOutOpen: {
          count: 0,
          fewer: true,
          why:
            "54, once more sit-up videos filmed from the feet come: the only one of the five people filmed from his feet and turned, the picture " +
            "shortens his legs and his hips read 0.14 to 0.15 of a leg moved while he sits up, where the four filmed side on read at most 0.11, so " +
            "with his own video left out \"hips stay down\" is set at 0.14 and his sit-ups read as another movement. With every person's numbers " +
            "(0.21) he counts 2 of 2, and a hip thrust's lowering, its hips dropping 0.24 or more, is never a sit-up.",
        },
      },
    },
    sets: true,
    sha256: "40a6a00d8713e6f02999ecadd65228dc55ec4c13e1c67429cddb9d413f18ba3c",
    seen: "2026-11-24 (52c-ii), 16 frames drawn with the model's points: the one man, his feet towards the phone and turned to its left, in each. He starts sat up, the plate overhead, and lies back (not a rep), then two sit-ups (the tops at 3.6 and 6.2 s), and is lying as it ends.",
  },
  {
    file: "movement-points/decline_sit_up_1",
    cut: [2.9, 9.0],
    movement: "sit-up",
    person: "man, teal wall, decline bench",
    view: "side",
    reps: 2,
    sets: true,
    sha256: "f5efa03d0ea3ad562170ba8f422d4d8d9135b491f497843611d57ba79fb8d46b",
    seen: "2026-11-24 (52c-ii), 16 frames drawn with the model's points, and 4 more from 0 to 0.4 s: the one man on a decline bench, side on, his hands at his head, in each. It starts with him half way up and rising (not a rep), then he lies back at 2.9 s and does two sit-ups (the tops at 4.2 and 7.3 s), lying back as it ends. Played from 2.9 s, the first picture of him lying back, as a live set begins: held a second as every first picture is, a picture half way up reads as lying back already (his trunk 60 degrees and more from upright), and a rep would be counted that began before the video.",
  },
  {
    file: "movement-points/decline_sit_up_2",
    movement: "sit-up",
    person: "man, black cap, decline bench, muscle figure",
    view: "side",
    reps: null,
    sets: false,
    seen:
      "2026-11-24 (52c-ii), 16 frames drawn with the model's points: the man on a decline bench in each, never the drawn muscle figure beside him; the video draws its own green arc and circles over his hips and shoulders. Reported, never judged: by the camera his trunk comes up 25 to 35 degrees from the bench in each, a decline crunch by Kd's research file's own measure (30 to 45 degrees of curl), and by eye his rises are hard to tell from one.",
  },
  // ── The hip thrust (52c-ii), floor work: Kd's dumbbell, barbell and Smith machine hip thrusts, counted by eye from 16
  //    pictures drawn with the model's points. A hip thrust is from the hips low, up until the body is level, and back down.
  {
    file: "movement-points/hip_thrust_dumbbell",
    movement: "hip-thrust",
    person: "woman, white cap, dumbbell",
    view: "side",
    reps: 3,
    under: {
      "hip-thrust": {
        leftOutOpen: {
          count: 0,
          fewer: true,
          why:
            "54, once more hip-thrust videos come: two people can be judged (the barbell and the second Smith machine videos are reported), " +
            "she side on and the other woman facing the phone, so with her left out every line is set from one woman whose shoulders barely move " +
            "on the picture from the front (0.04 to 0.06 of a leg), \"shoulders stay\" is set at 0.07, and her own shoulders, read side on, move " +
            "0.12 to 0.14. With both women's numbers (0.15) she counts 3 of 3.",
        },
      },
    },
    sets: true,
    sha256: "9c332ba365d67cb9acc604028a0357f56092831a88a32960aa4ff699b84b684e",
    seen: "2026-11-24 (52c-ii), 16 frames drawn with the model's points: the one woman, side on, her upper back on the bench, a dumbbell at her hips, in each; people walk about far behind her. Low until 2.1 s, then three hip thrusts (the tops at 3.2, 7.2 and 11.0 s), and low again as it ends.",
  },
  {
    file: "movement-points/hip_thrust_barbell",
    movement: "hip-thrust",
    person: "man, barbell, wooden platform",
    view: "between",
    reps: null,
    sets: false,
    seen:
      "2026-11-24 (52c-ii), 16 frames drawn with the model's points: the one man in each, filmed from in front of his feet and above. He settles low, then three hip thrusts (the tops at 3.3, 6.0 and 8.9 s), and slides down off the bench to the floor as it ends. " +
      "Reported, never judged: from there the picture shortens his thighs at the top of each thrust, and his hips' height on the picture is not given for longer than a break (3.4 to 4.2, 6.3 to 6.6 and 9.0 to 9.6 s), nor his feet on the floor line from 6.9 to 7.5 s; a hip thrust's phone stands side-on (movements/hip-thrust.json).",
    under: {
      "hip-thrust": {
        phoneOpen: {
          why:
            "None: a video reported, never judged. From in front and above, the laptop's reading loses his hips' height at the top of his " +
            "first thrust for longer than a break, the phone's does not, so the phone counts it where the laptop says it could not see it.",
          differences: ["the laptop counts 0, the phone 1", "the laptop says 2.6 s unseen (depth), the phone 2.6 s counted"],
        },
      },
    },
  },
  {
    file: "movement-points/hip_thrust_smith_1",
    movement: "hip-thrust",
    person: "woman, Smith machine, blue top",
    view: "front",
    reps: 2,
    under: {
      "hip-thrust": {
        leftOutOpen: {
          count: 0,
          fewer: true,
          why:
            "54, once more hip-thrust videos come: of the two people judged she alone faces the phone, so her trunk at the top, level and pointing " +
            "at the camera, reads 57 degrees from upright on the picture, where the woman filmed side on reads 92; with her left out \"back on the bench\" " +
            "is set at 92 from that one woman. With both women's numbers she counts 2 of 2.",
        },
        replayOpen: {
          replays: ["slower", "twice as slow"],
          why:
            "54, once more hip-thrust videos come: facing the phone, her thighs point at the camera near the bottom of each thrust, and her " +
            "hips' height on the picture is not given in stretches there (before her first thrust, and in her second); played 1.5 or 2 times as " +
            "slowly those stretches pass the break, so her first thrust has no start position read and is not measured, and her second decides " +
            "nothing (1.5 times) or is split in two, its last 0.9 s read as a short thrust (twice). A hip thrust's phone stands side-on: the " +
            "woman filmed side on counts every thrust under every replay.",
        },
        phoneOpen: {
          why:
            "53 and 54: facing the phone, as she lowers after her second thrust the phone's reading puts her hips back up 0.17 of a leg before " +
            "the video ends, so it would tell her \"Push your hips higher to count.\" for a thrust she never began (the laptop reads her down). " +
            "A hip thrust's phone stands side-on; the side-on woman's thrusts read the same on both.",
          differences: ["the phone also says 8.3 s short (hips open)"],
        },
      },
    },
    sets: true,
    sha256: "e4b38c8f0604fe3fcb9ddf066485e870b253f776e8a7b245c8ee47fc47a4e716",
    seen: "2026-11-24 (52c-ii), 16 frames drawn with the model's points: the one woman in each, facing the phone, the Smith machine's bar on her hips. Two hip thrusts (the tops at 2.1 and 6.5 s), low between them and as it ends.",
  },
  {
    file: "movement-points/hip_thrust_smith_2",
    movement: "hip-thrust",
    person: "man, Smith machine, Legend rack",
    view: "side",
    reps: null,
    sets: false,
    seen:
      "2026-11-24 (52c-ii), 16 frames drawn with the model's points: reported, never judged. The model loses the man in places (no body at 6.9 s, his legs alone at 2.3 s), a title runs over him from 2 s, and the video ends on a black card from 7.9 s: his thrusts cannot be told apart by eye in the pictures.",
  },
  // ── Holds (52c-ii): Kd's L-sits on the bars, timed by eye from 16 pictures drawn with the model's points (Parallel-Bar
  //    Dip/Parallel-Bar Tuck L-Sit: both clips are of the full L-sit, the legs straight), and his support hold, which is
  //    timed only (movements/support-hold.json says why). ──────────────────────────────────────────────────────────────
  {
    file: "movement-points/l_sit_bars_1",
    movement: "l-sit",
    person: "man, beanie, parallel bars",
    view: "side",
    reps: 0,
    held: [[0, 7.87]],
    under: {
      "l-sit": {
        leftOutOpen: {
          count: 0,
          fewer: true,
          why:
            "54, once more L-sit videos come: two people, so with him left out every line is set from the one man on the dip station, whose " +
            "legs read 93 to 97 degrees from hanging; his own legs, a little below level all through, read 76 to 88, under the 93 then set. With " +
            "both men's numbers (71) his whole hold is timed, 7.87 s.",
        },
      },
    },
    sets: true,
    sha256: "00649cf9cd23c245ad4fa7fa421d1c6ef81cd8544fd4ce9ba7ce0ee7a3dd5666",
    seen: "2026-11-24 (52c-ii), 16 frames drawn with the model's points: the one man, side on, in an L-sit on the bars in each, his legs straight out in front, from the first picture to the last (7.87 s); a play and pause button over him in places.",
  },
  {
    file: "movement-points/l_sit_bars_2",
    movement: "l-sit",
    person: "man, dip station, TikTok",
    view: "between",
    reps: 0,
    held: [[0, 3.1]],
    under: {
      "l-sit": {
        leftOutOpen: {
          count: 0,
          fewer: true,
          why:
            "54, once more L-sit videos come: two people, so with him left out every line is set from the one man on the bars, whose trunk " +
            "stands within 2 degrees of upright; his own trunk, leaning 6 to 8 degrees forward (his research file allows a slight forward lean), " +
            "is past the 3 then set. With both men's numbers (9) his whole hold is timed, 3.10 s.",
        },
      },
    },
    sets: true,
    sha256: "516d1a71c33de618423c339973044fd48cd315caf8faef905de930b11c0041fb",
    seen: "2026-11-24 (52c-ii), 16 frames drawn with the model's points and 6 more from 3.07 to 3.23 s: the one man in an L-sit on a dip station, turned half way, from the first picture to 3.10 s; at 3.13 s the video cuts to him in a support with his knees bent and hanging (\"Bent leg sit\"), to its end at 3.83 s.",
  },
  {
    file: "movement-points/support_hold_bars",
    movement: "support-hold",
    person: "man, parallel bars, text panel",
    view: "front",
    reps: 0,
    held: [[0, 6.7]],
    sets: false,
    seen: "2026-11-24 (52c-ii), 16 frames drawn with the model's points: the one man facing the phone in a support hold on the bars in each, his arms straight and his legs hanging, until 6.7 s; then he bends his elbows and steps down. A text panel beside him. Timed only, so it sets no number.",
  },
  // ── Every other movement: 0 and silence ──────────────────────────────────────────────────────────────
  {
    ...other("movement-points/squat_jack_1", "man, squat jack, turf", "front", "Squat jacks: the feet jumping out into a wide squat, then in as he jumps up."),
    under: { "squat-jump": { open: SQUAT_JACK_AS_A_JUMP } },
  },
  {
    ...other("movement-points/squat_jack_2", "man, squat jack, bedroom", "front", "Squat jacks: the feet jumping out into a wide squat, then in as he jumps up."),
    under: { "squat-jump": { open: SQUAT_JACK_AS_A_JUMP } },
    replayOpen: {
      replays: ["slower", "twice as slow"],
      why:
        "54, where the squat jack is made (52c-i made the squat jump, which counts his jacks too: SQUAT_JACK_AS_A_JUMP): as filmed he never " +
        "stands still between jacks long enough to be read standing, " +
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
  { file: "movement-points/split_squat_smith", movement: "lunge", person: "Smith machine split squat", view: "side", reps: 2, sets: false, under: { lunge: { open: SPLIT_SQUAT_STAYS_SPLIT } },
    seen: "2026-11-23 (52c-i), counted by eye from pictures at 2 and 4 a second, a twin of the lunge never setting a number. From behind and to the side: she starts low, then two split squats (the bottoms at 2.5 and 5.2 s), and is going down again as it ends." },
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
  other("movement-points/fresh_step_up_dumbbell_0", "fresh: Dumbbell step-ups, 0", "side", "Fresh: Dumbbell step-ups."),
  other("movement-points/fresh_step_up_dumbbell_1", "fresh: Dumbbell step-ups, 1", "between", "Fresh: Dumbbell step-ups."),
  other("movement-points/fresh_calf_raise_2", "fresh: Calf raises at a wall, 2", "side", "Fresh: Calf raises at a wall."),
  other("movement-points/fresh_calf_raise_dumbbell_1", "fresh: Standing dumbbell calf raises, 1", "front", "Fresh: Standing dumbbell calf raises."),
  other("movement-points/fresh_calf_raise_dumbbell_2", "fresh: Standing dumbbell calf raises, 2", "front", "Fresh: Standing dumbbell calf raises."),
  { file: "movement-points/fresh_split_squat_smith_0", movement: "lunge", person: "fresh: Smith machine split squats, 0", view: "side", reps: 3, sides: ["right", "right", "right"], sets: false,
    seen: "2026-11-23 (52c-i), counted by eye from pictures at 2 and 4 a second, a twin of the lunge never setting a number. Side on: he steps into his split stance, then three split squats (the bottoms at 2.0, 4.8 and 7.3 s), each with his right leg in front (drawn with the model's points at those three times; facing right, his back half to the phone); a card from 8.5 s." },
  { file: "movement-points/fresh_split_squat_smith_2", movement: "lunge", person: "fresh: Smith machine split squats, 2", view: "between", reps: 3, sets: false, under: { lunge: { open: SPLIT_SQUAT_STAYS_SPLIT } },
    seen: "2026-11-23 (52c-i), counted by eye from pictures at 2 and 4 a second, a twin of the lunge never setting a number. Facing the phone: three split squats (the bottoms at 2.1, 4.3 and 6.6 s), never standing tall between them." },
  { file: "movement-points/fresh_split_squat_smith_3", movement: "lunge", person: "fresh: Smith machine split squats, 3", view: "side", reps: 2, sets: false, under: { lunge: { open: SPLIT_SQUAT_STAYS_SPLIT } },
    seen: "2026-11-23 (52c-i), counted by eye from pictures at 2 and 4 a second, a twin of the lunge never setting a number. Side on, his back half to the phone: he sets up until 3.5 s, steps back, then two split squats (the bottoms at 4.3 and 6.8 s)." },
  other("movement-points/fresh_overhead_press_plate", "fresh: weight-plate overhead press, one", "front", "Fresh: a weight-plate overhead press."),
  other("movement-points/fresh_overhead_press_barbell", "fresh: barbell overhead press, one", "front", "Fresh: a barbell overhead press."),
  other("movement-points/fresh_curl_barbell", "fresh: barbell biceps curl, one", "front", "Fresh: a barbell biceps curl."),
  other("movement-points/fresh_rack_pull_barbell", "fresh: barbell rack pull, one", "between", "Fresh: a barbell rack pull."),
  other("movement-points/fresh_curl_ez_bar_1", "fresh: standing EZ-bar curl, 1", "front", "Fresh: a standing EZ-bar curl."),
  // Lying, seated or held on the bars (52c-ii): the movements nearest floor work and holds, never counted or timed.
  other("movement-points/floor_press_kettlebell_0", "kettlebell floor press, 0", "side", "A close-grip kettlebell floor press: lying, the knees bent and the feet flat, the arms pressing up."),
  other("movement-points/floor_press_kettlebell_2", "kettlebell floor press, 2", "side", "A close-grip kettlebell floor press: lying, the knees bent and the feet flat, the arms pressing up, filmed from above."),
  other("movement-points/reverse_crunch_decline_1", "decline reverse crunch, 1", "side", "A decline-bench reverse crunch: lying on a decline bench, the knees drawn up to the chest."),
  other("movement-points/reverse_crunch_decline_2", "decline reverse crunch, 2", "side", "A decline-bench reverse crunch, a variation: lying on a decline bench, the knees drawn up to the chest."),
  other("movement-points/triceps_extension_lying_ez", "lying EZ-bar triceps extension", "side", "A lying EZ-bar triceps extension on a bench, the forearms moving; no body in 108 of its frames."),
  other("movement-points/leg_raise_bars", "leg raise on the bars", "front", "A leg raise on the parallel bars: held on straight arms, the straight legs raised to level and lowered."),
  other("movement-points/knee_raise_bars", "knee raise on the bars", "side", "A knee raise on the parallel bars: held on straight arms, the knees raised and lowered."),
  other("movement-points/straight_leg_raise_chair", "captain's chair straight-leg raise", "between", "A captain's chair straight-leg raise: the forearms on the pads, the straight legs raised and lowered."),
  // ── A phone on the floor or raised, the usual positions of other exercises (52a-ii-b-i): no squat in any ───────────
  floorOther("usual_v02", "floor", "front", "The phone on the floor, upright: he stands and turns round slowly."),
  floorOther("usual_v03", "floor", "front", "The phone on the floor, on its long side: he stands and turns round."),
  floorOther("usual_v05", "floor", "front", "The phone on the floor, upright: he sits cross-legged and turns round."),
  floorOther("usual_v06", "floor", "side", "The phone on the floor, on its long side: on all fours, he turns round."),
  {
    ...floorOther("usual_v07", "floor", "side", "The phone on the floor, on its long side: he lies on the floor, raises a leg, sits up."),
    movement: "sit-up",
    reps: 2,
    seen:
      "The phone on the floor, on its long side: he lies on the floor and raises a leg, bent and straight (8 to 21 s); then two sit-ups, his legs straight, lying flat, sitting up and lying back (the tops at 22.8 and 26.8 s, drawn 2026-11-24, 52c-ii); then, a knee bent, he rolls onto his side and crawls to the phone. Judged under the sit-up from a phone on the floor, never setting a number.",
  },
  {
    ...floorOther("usual_v08", "floor", "side", "The phone on the floor, upright; barefoot: he sits on a chair side on, gets up, sits (a chair squat's movement: 54)."),
    open:
      "54, where the chair squat is made on the squat: sitting down on a chair and getting up is a chair squat's movement, which this list " +
      "counts as a twin of the squat (chair_squat_reference). Drawn 2026-11-25 (52d-i), a picture a second: he walks from the phone, sits at " +
      "2 s, stands at 12 s turning the chair round, sits again facing the other way at 14 s and stands at 17 s, then walks to the phone. Under " +
      "the squat his second sit-and-stand (13.8 to 17.1 s, the hips 0.24 of a leg down, the knees at 100 degrees) counts 1 as filmed, a chair " +
      "squat by eye; the first, begun as he walks to the chair and ended turning it, is another movement. Before 52d-i nothing was counted: the " +
      "standing taken while he was at the phone, found again 1.3 to 1.8 times smaller, was kept and no dip began; the lock now takes him afresh. " +
      "Under the replays it counts 0 to 2 (onePerson.test.ts has each); at 8 pictures a second it tells two of his sits \"Go lower to count.\", " +
      "false for a person on a chair, written down for 54 by Kd's choice (rulings/2026-11-25-52d-i.md).",
    phoneOpen: {
      why:
        "54, where the chair squat is made: on the phone's reading his first sit, begun as he walks to the chair, is read as a chair squat " +
        "that stopped short and told to go lower, and his second sit-and-stand is judged 0.2 s later; the laptop reads the first as another movement.",
      differences: ["the laptop says 13.8 s counted, the phone 2.9 s short (depth)", "the phone also says 14.0 s counted"],
    },
  },
  floorOther("usual_v09", "floor", "side", "The phone on the floor, upright: he stands at a chair, one leg lifted and bent."),
  floorOther("usual_v10", "floor", "side", "The phone on the floor, on its long side: he sits on a chair, gets up, sits (54)."),
  floorOther("usual_v12", "raised", "between", "The phone raised, upright: he sits on a chair from the front and the side, stands, puts one knee on the chair."),
  {
    ...floorOther("usual_v13", "raised", "side", "The phone raised, on its long side: he lies on a bed, raises a leg, sits up."),
    movement: "sit-up",
    reps: 2,
    seen:
      "The phone raised, on its long side: he sits on the bed and lies down; two sit-ups, his legs straight, lying flat, sitting up and lying back (the tops at 9.2 and 13.5 s, drawn 2026-11-24, 52c-ii); he raises a leg, then both (16 to 20 s), sits up with his knees bent and gets off the bed. Judged under the sit-up, never setting a number.",
  },
  floorOther("usual_v14", "raised", "front", "The phone raised, upright: he stands and turns round."),
];
