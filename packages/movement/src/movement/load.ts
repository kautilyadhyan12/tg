// A movement file, parsed before the engine trusts it (CLAUDE.md §4, "Parse, don't trust"): the shape by
// `movementSchema`, then every measure it names checked against the engine's own list.
import { movementSchema, type Movement } from "@app/shared";
import { checkMovement } from "./matcher.js";

export function parseMovement(json: unknown): Movement {
  const movement = movementSchema.parse(json);
  checkMovement(movement);
  return movement;
}
