// The contract the harness drives (Part 2 §2.4's three event levels + one
// document). Pipeline tasks P1.4–P1.6 implement this; amending it happens in
// those task cards, visibly — never ad hoc.
// TYPE-ONLY imports from @app/shared: erased at compile, so the engine keeps
// zero runtime dependencies (I1 / Part IV #10).
import type { FrameResult, HoldEvent, HoldTick, PoseFrame, RepEvent, SetSummary } from "@app/shared";

export interface EngineSession {
  /** Feed one frame; returns the per-frame result for overlay/UI. */
  processFrame(frame: PoseFrame): FrameResult;
  /** End the set and produce the §2.4 SetSummary. */
  end(): SetSummary;
}

/** Everything a replay collects; the §7.4 assertion layer reads only this. */
export interface ReplayResult {
  frameResults: FrameResult[];
  repEvents: RepEvent[];
  holdTicks: HoldTick[];
  holdEvents: HoldEvent[];
  summary: SetSummary;
}

/** Optional event taps an engine can expose; the replay runner subscribes. */
export interface EngineSessionEvents {
  onRep?(listener: (e: RepEvent) => void): void;
  onHoldTick?(listener: (e: HoldTick) => void): void;
  onHoldEnd?(listener: (e: HoldEvent) => void): void;
}

export type ReplayableEngine = EngineSession & EngineSessionEvents;
