// @app/movement: the movement engine, made fresh (spec Part 2 §12), beside the old one in
// packages/engine, with which it shares no code. Pure TypeScript with no runtime
// dependencies (§1.3 I1), so the same code runs on the phone, in the tests and on the
// laptop. What it reads, one frame of every person the pose model found, is checked by
// `movementFrameSchema` in @app/shared before it gets here.
export type { Down, MovementFrame, SeenPerson, SeenPoint, WorldPoint } from "@app/shared";
