// Stage 1 — Ingest & validation (Part 2 §3.1).
// Port of the legacy `_valid_keypoints` verbatim: exactly 33 entries, each with
// ≥4 finite numbers (NaN via v !== v). Engine additions per §3.1: t finite and
// strictly greater than the previous frame's t (out-of-order dropped, counted);
// invalid frames drop SILENTLY — state holds, nothing counts, no event; three
// consecutive invalid frames flip visibilityOk=false.
import type { IngestResult, PoseFrame, SessionDiagnostics } from "./types.js";

export const KEYPOINT_COUNT = 33; // §2.1
export const INVALID_STREAK_FOR_VISIBILITY = 3; // §3.1

function isFiniteNumber(v: unknown): v is number {
  // NaN check `v !== v` folded into Number.isFinite.
  return typeof v === "number" && Number.isFinite(v);
}

/** Legacy `_valid_keypoints`, ported verbatim (33 × [x, y, z, vis] finite).
 *  Takes `unknown`: this is the validation boundary — the static tuple type
 *  is only true AFTER this returns. */
export function validKeypoints(kp: unknown): boolean {
  if (!Array.isArray(kp) || kp.length !== KEYPOINT_COUNT) return false;
  for (const entry of kp as unknown[]) {
    if (!Array.isArray(entry) || entry.length < 4) return false;
    for (let i = 0; i < 4; i++) {
      if (!isFiniteNumber((entry as unknown[])[i])) return false;
    }
  }
  return true;
}

export class IngestStage {
  private lastT: number | null = null;
  private invalidStreak = 0;
  private visibilityOk = true;
  readonly diagnostics: SessionDiagnostics = {
    framesSeen: 0,
    framesDropped: 0,
    droppedInvalid: 0,
    droppedOutOfOrder: 0,
  };

  accept(frame: PoseFrame): IngestResult {
    this.diagnostics.framesSeen++;

    if (!isFiniteNumber(frame.t) || !validKeypoints(frame.kp)) {
      return this.drop("invalid");
    }
    if (this.lastT !== null && frame.t <= this.lastT) {
      // Out-of-order frames are dropped and counted (§3.1). They do NOT
      // contribute to the invalid streak — the person may be perfectly visible.
      this.diagnostics.framesDropped++;
      this.diagnostics.droppedOutOfOrder++;
      return { ok: false, dropReason: "out_of_order", visibilityOk: this.visibilityOk };
    }

    this.lastT = frame.t;
    this.invalidStreak = 0;
    this.visibilityOk = true;
    return { ok: true, visibilityOk: true };
  }

  private drop(reason: "invalid"): IngestResult {
    this.diagnostics.framesDropped++;
    this.diagnostics.droppedInvalid++;
    this.invalidStreak++;
    if (this.invalidStreak >= INVALID_STREAK_FOR_VISIBILITY) {
      this.visibilityOk = false; // UI shows "step back into frame" (§3.1)
    }
    return { ok: false, dropReason: reason, visibilityOk: this.visibilityOk };
  }
}
