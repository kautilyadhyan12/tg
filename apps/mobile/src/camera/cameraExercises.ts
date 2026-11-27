import { parseExercise, parseMovementFile, type CameraCounts } from "@app/movement";
import squatCamera from "@app/movement/exercises/squat.json";
import hipThrust from "@app/movement/movements/hip-thrust.json";
import lSit from "@app/movement/movements/l-sit.json";
import lunge from "@app/movement/movements/lunge.json";
import sitUp from "@app/movement/movements/sit-up.json";
import squatJump from "@app/movement/movements/squat-jump.json";
import squat from "@app/movement/movements/squat.json";
import type { ExerciseCamera } from "@app/shared";
import type { PictureName } from "../look/pictures";

// What the camera can count today (ROADMAP Stage 5 53a): the movements exercise folder 1 has built and proven (spec Part 2
// §12.5), carried in the app and checked by the engine's own code before they are used. Until the Library's download
// carries each exercise's camera files (§13.3), this list is what a folder's copy offers under "Try the camera". An
// exercise is data: adding one here adds no code.

export interface CameraExercise {
  readonly key: string;
  readonly name: string;
  readonly counts: CameraCounts;
  /** Its camera file, where it has one: its mistakes, judged in each rep, and its set's summary. */
  readonly camera: ExerciseCamera | null;
  /** The Library's exercise whose picture and clip are the reference, where the Library has one. */
  readonly libraryId: string | null;
  /** The app's own picture of it, the reference until the Library has a picture of its own (as the Library's cards show). */
  readonly picture: PictureName | null;
  readonly measuredIn: "reps" | "time";
  /** The set's target to start from: reps, or seconds. */
  readonly target: number;
}

function counted(json: unknown): CameraCounts {
  const file = parseMovementFile(json);
  if (file.counting === "timed only") throw new Error(`${file.name} is timed only: the camera does not count it.`);
  return file.counting === "hold" ? { hold: file } : { movement: file, exercise: null };
}

function withCamera(json: unknown, cameraJson: unknown): { counts: CameraCounts; camera: ExerciseCamera } {
  const counts = counted(json);
  if (!("movement" in counts)) throw new Error("A camera file's mistakes are judged in reps.");
  const camera = parseExercise(cameraJson, counts.movement);
  return { counts: { movement: counts.movement, exercise: camera }, camera };
}

const squatWithCamera = withCamera(squat, squatCamera);

export const CAMERA_EXERCISES: readonly CameraExercise[] = [
  { key: "squat", name: "Squat", ...squatWithCamera, libraryId: "squat", picture: "squat", measuredIn: "reps", target: 10 },
  // The squat's twin by declaration (§12.3): counted by the squat's movement, its own mistakes not yet written (54).
  { key: "goblet", name: "Kettlebell Goblet Squat", counts: counted(squat), camera: null, libraryId: "kettlebell_goblet_squat", picture: null, measuredIn: "reps", target: 10 },
  { key: "squat-jump", name: "Squat Jump", counts: counted(squatJump), camera: null, libraryId: null, picture: "jumpsquat", measuredIn: "reps", target: 10 },
  { key: "lunge", name: "Lunge", counts: counted(lunge), camera: null, libraryId: null, picture: null, measuredIn: "reps", target: 10 },
  { key: "sit-up", name: "Sit-up", counts: counted(sitUp), camera: null, libraryId: null, picture: null, measuredIn: "reps", target: 10 },
  { key: "hip-thrust", name: "Hip Thrust", counts: counted(hipThrust), camera: null, libraryId: null, picture: null, measuredIn: "reps", target: 10 },
  { key: "l-sit", name: "L-sit", counts: counted(lSit), camera: null, libraryId: null, picture: null, measuredIn: "time", target: 20 },
];
