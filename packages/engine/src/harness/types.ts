// The contract the harness drives (Part 2 §2.4's three event levels + one
// document). Pipeline tasks P1.4–P1.6 implement this; amending it happens in
// those task cards, visibly — never ad hoc.
// TYPE-ONLY imports from @app/shared: erased at compile, so the engine keeps
// zero runtime dependencies (I1 / Part IV #10).
import type { FrameResult, HoldEvent, HoldTick, PoseFrame, RepEvent, SetSummary } from "@app/shared";

export interface EngineSession {
  /** Feed one frame; returns the per-frame result for overlay/UI. */
  processFrame(frame: PoseFrame): FrameResult;
  /** THE CALLER HAS STOPPED FEEDING FRAMES — a pause, a hidden tab, a camera
   *  torn down. The engine cannot deduce this: no frames arriving looks exactly
   *  like a slow camera from in here, and the timestamps inside the frames that
   *  eventually resume have moved on regardless. So the one party that knows
   *  has to say it, and this is how.
   *
   *  Measured before it existed: a 120 s pause swept across a squat clip billed
   *  127,000 ms of exercise against 8,400 ms really watched — 14.82 kcal where
   *  the truth is 0.98 (DECISIONS :7730).
   *
   *  Idempotent, and safe between sets. It is ON THE INTERFACE rather than on
   *  one implementation deliberately: three of the four rep modes do not exist
   *  yet, and this is the question each of them must answer rather than
   *  silently inherit nothing (:7575). */
  loseSight(): void;
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
