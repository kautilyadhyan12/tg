/**
 * poseThroughput.js — how many frames per second the camera is ACTUALLY
 * delivering to the engine.
 *
 * ── WHAT THIS IS FOR, AND WHAT IT IS NOT ────────────────────────────────────
 * Part 6 §3.6's degradation ladder is triggered by a number nothing in this app
 * measures: *"full model → lite model (delivered Hz < 15 for 10 s) → 640p
 * (still < 15) → log-only mode"* (`06-part6-mobile.md:187-188`). This module is
 * that number and **nothing else** — it steps nothing down, and no screen reads
 * it. The ladder is its own card.
 *
 * It is also the instrument the MODEL choice needs. `lite` is hard-wired today
 * while §3.3 makes `full` the default, and the reason nobody has switched it is
 * that switching would be a guess: Kd's own clips came back at 7.2–12.5 fps
 * against a 15 fps target on the LIGHTER model (OWED, "we ship the fallback pose
 * model as the default"), and **inference time has never been measured on any
 * device**. A rate that can be read off a real machine turns that from an
 * argument into a measurement.
 *
 * ── WHY IT IS MEASURED AT THE ENGINE FEED ───────────────────────────────────
 * `usePoseDetection` runs three throttles — detect ~30 Hz, overlay ~30 Hz, feed
 * ~15 Hz. This counts the FEED, for two reasons: it is the rate §3.6 names, and
 * it is the rate every number already recorded in this project was measured at
 * (the trace recorder counts inside the same interval check), so a figure from
 * here is comparable with Kd's 7.2–12.5 rather than being a fourth unrelated
 * number.
 *
 * ── WHY THE CLOCK IS AN ARGUMENT ────────────────────────────────────────────
 * Timestamps are passed in, never read. That makes the meter a pure function of
 * its inputs and testable without faking time — the same reason the engine
 * takes frame timestamps rather than reading a clock (Part 2 §1.3 I1). This
 * file lives in `apps/web`, so that invariant is not enforced on it; it is
 * simply the right shape.
 */

/** How far back a rate is computed over. Long enough that one slow frame does
 *  not swing it, short enough to notice a phone thermally throttling. Not a
 *  spec number — the spec names the THRESHOLD (15 Hz) and the DURATION it must
 *  hold (10 s), never the averaging window — so it is a reporting choice, and
 *  it is deliberately shorter than §3.6's 10 s so the ladder can observe ten
 *  seconds OF this rate rather than one reading of it. */
export const DEFAULT_WINDOW_MS = 3000;

/** Below this span the meter answers `null`, not a number.
 *
 *  THE TRAP THIS CLOSES, and it is the reason the constant exists at all: two
 *  frames 1 ms apart are a perfectly good 1000 Hz, and the first two frames of a
 *  session are also a perfectly good 0.5 Hz. Both are arithmetic on real inputs
 *  and neither is a throughput. A meter that answered anyway would hand the
 *  ladder a fabricated number at the exact moment it is most likely to act on
 *  one — the first second of every workout — and step a healthy phone down for
 *  it. `Number(null) === 0` cost this app a silently-reconfigured pose model
 *  once already (:6749); an unmeasurable rate is `null` here for the same
 *  reason, and every caller has to say what it does about that. */
export const MIN_SPAN_MS = 1000;

export class PoseThroughput {
  constructor({ windowMs = DEFAULT_WINDOW_MS, minSpanMs = MIN_SPAN_MS } = {}) {
    this._windowMs = windowMs;
    this._minSpanMs = minSpanMs;
    /** Monotonic timestamps of delivered frames, oldest first. */
    this._t = [];
  }

  /**
   * One delivered frame, at a monotonic timestamp in milliseconds.
   *
   * Out-of-order and repeated timestamps are DROPPED rather than accommodated.
   * The caller is a `performance.now()`-driven loop where they cannot occur, and
   * a meter that silently reordered them would report a rate for a sequence that
   * never happened — the shape of :7974's out-of-order frame moving a span
   * backwards.
   */
  push(t) {
    if (!Number.isFinite(t)) return;
    const last = this._t[this._t.length - 1];
    if (last !== undefined && t <= last) return;
    this._t.push(t);
    const cutoff = t - this._windowMs;
    // Oldest-first, so dropping from the front is enough.
    let drop = 0;
    while (drop < this._t.length && this._t[drop] < cutoff) drop += 1;
    if (drop > 0) this._t.splice(0, drop);
  }

  /**
   * Delivered frames per second over the trailing window, or `null` when there
   * is not yet enough evidence to say.
   *
   * Computed from the SPAN BETWEEN the first and last frame, not from a count
   * divided by the window: over a 3 s window holding 1.2 s of frames, dividing
   * by 3 reports a third of the true rate and would step down a phone that is
   * keeping up perfectly.
   */
  hz() {
    if (this._t.length < 2) return null;
    const span = this._t[this._t.length - 1] - this._t[0];
    if (span < this._minSpanMs) return null;
    return ((this._t.length - 1) * 1000) / span;
  }

  /** Frames currently inside the window. Exposed for the log line, so a rate can
   *  be read together with how much evidence produced it. */
  get frames() {
    return this._t.length;
  }

  /** A new set, or a set resumed after a pause. The gap across a pause is not a
   *  slow camera, and averaging across it reports a stall that never happened —
   *  the same rule the person check follows at `SceneGate.reset()`. */
  reset() {
    this._t = [];
  }
}
