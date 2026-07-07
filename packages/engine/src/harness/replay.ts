// Replay runner: feeds trace frames through an engine session in order and
// collects everything the §7.4 assertion layer needs. Deterministic — the
// only time that exists is each frame's t (I1/I2).
import type { FrameResult, HoldEvent, HoldTick, RepEvent } from "@app/shared";
import type { ReplayableEngine, ReplayResult } from "./types.js";
import type { Trace } from "./trace.js";

export function replay(engine: ReplayableEngine, trace: Trace): ReplayResult {
  const repEvents: RepEvent[] = [];
  const holdTicks: HoldTick[] = [];
  const holdEvents: HoldEvent[] = [];
  engine.onRep?.((e) => repEvents.push(e));
  engine.onHoldTick?.((e) => holdTicks.push(e));
  engine.onHoldEnd?.((e) => holdEvents.push(e));

  const frameResults: FrameResult[] = [];
  for (const frame of trace.frames) {
    frameResults.push(engine.processFrame(frame));
  }
  const summary = engine.end();
  return { frameResults, repEvents, holdTicks, holdEvents, summary };
}
