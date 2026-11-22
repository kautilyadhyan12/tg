// A movement file, or an exercise's camera file, parsed before the engine trusts it (CLAUDE.md §4, "Parse, don't
// trust"): the shape by its schema, then every measure it names checked against the engine's own list.
import { exerciseCameraSchema, movementSchema, type ExerciseCamera, type Movement } from "@app/shared";
import { checkExercise } from "./form.js";
import { checkMovement } from "./matcher.js";

export function parseMovement(json: unknown): Movement {
  const movement = movementSchema.parse(json);
  checkMovement(movement);
  return movement;
}

/** An exercise's camera file, checked against the movement it says it uses. */
export function parseExercise(json: unknown, movement: Movement): ExerciseCamera {
  const exercise = exerciseCameraSchema.parse(json);
  checkExercise(exercise, movement);
  return exercise;
}
