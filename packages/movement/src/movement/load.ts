// A movement file, or an exercise's camera file, parsed before the engine trusts it (CLAUDE.md §4, "Parse, don't
// trust"): the shape by its schema, then every measure it names checked against the engine's own list.
import { exerciseCameraSchema, holdMovementSchema, movementFileSchema, movementSchema, type ExerciseCamera, type HoldMovement, type Movement, type MovementFile } from "@app/shared";
import { checkExercise } from "./form.js";
import { checkHold } from "./hold.js";
import { checkMovement } from "./matcher.js";

export function parseMovement(json: unknown): Movement {
  const movement = movementSchema.parse(json);
  checkMovement(movement);
  return movement;
}

/** A hold's file (`holdMovementSchema`). */
export function parseHold(json: unknown): HoldMovement {
  const hold = holdMovementSchema.parse(json);
  checkHold(hold);
  return hold;
}

/** Any movement file, by its kind of counting: counted by reps, a hold, or timed only (the camera judging nothing). */
export function parseMovementFile(json: unknown): MovementFile {
  const file = movementFileSchema.parse(json);
  if (file.counting === "hold") checkHold(file);
  else if (file.counting !== "timed only") checkMovement(file);
  return file;
}

/** An exercise's camera file, checked against the movement it says it uses. */
export function parseExercise(json: unknown, movement: Movement): ExerciseCamera {
  const exercise = exerciseCameraSchema.parse(json);
  checkExercise(exercise, movement);
  return exercise;
}
