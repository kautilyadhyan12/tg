// Internal stage I/O types for pipeline stages 1–3 (Part 2 §3.1–3.3).
// Private to the pipeline; the public EngineSession is assembled in P1.6.
import type { PoseFrame, View } from "@app/shared";

export type DropReason = "invalid" | "out_of_order";

export interface IngestResult {
  /** Frame accepted — safe for downstream stages. */
  ok: boolean;
  dropReason?: DropReason;
  /** §3.1: false after 3 consecutive invalid frames; true again on a valid one. */
  visibilityOk: boolean;
}

export interface SessionDiagnostics {
  framesSeen: number;
  framesDropped: number;
  droppedInvalid: number;
  droppedOutOfOrder: number;
}

export type { PoseFrame, View };
