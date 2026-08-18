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
   * Delivered frames per second over the trailing window ENDING AT `now`, or
   * `null` when there is not enough evidence to say.
   *
   * Computed as the frames received SINCE the oldest surviving one, divided by
   * the time from that frame TO `now` — never by the fixed window, and never up
   * to the last frame that happened to arrive.
   *
   * Both halves of that are load-bearing, and each was learned from a defect.
   * Dividing by the WINDOW is wrong at the start of a set: over a 3 s window
   * holding 1.2 s of frames it reports a third of the true rate and would step
   * down a phone that is keeping up perfectly. Ending the span at the LAST FRAME
   * is wrong whenever frames are slowing or have stopped, because the gap at the
   * end — the only part of the window that says so — is then invisible: measured
   * 2026-08-17, sixty frames at 67 ms and then silence still read "14.9 of
   * 14.9/s" at 1,990 ms of quiet, when 5.3 was what had really arrived. Ending
   * it at `now` makes the trailing silence part of the measurement, so the
   * reading falls away smoothly instead of holding and then vanishing.
   *
   * WHY THE READING HAS TO BE TOLD WHAT TIME IT IS. Until 2026-08-17 it was not,
   * and the consequence was the worst thing an instrument can do: the window was
   * trimmed only by `push`, so with no frames arriving nothing ever left it and
   * this answered THE LAST RATE IT EVER SAW, for ever. A camera that died — or
   * simply a paused set — left "14.9 of 14.9/s" on screen, measured at 5½
   * minutes after the final frame, in exactly the two moments where a reader
   * asks "why did it miss my squat?". Resetting on a stall cannot close it: the
   * gap IS the thing being misreported, and the reset only arrives with the
   * resume that ends it. So the reading expires by itself — frames older than
   * the window are not evidence about `now`, whether or not a new one has come
   * in to say so.
   *
   * NO CLOCK, NO ANSWER. `now` is required and a missing or non-finite one is
   * `null` rather than a fallback to "the last frame's own time", which would
   * silently restore the stale-for-ever behaviour at any caller that forgot it.
   * The clock stays an ARGUMENT, for the reason at the top of this file.
   *
   * TWO ROUNDS FOUND THE SAME MISTAKE HERE, and that is worth stating plainly
   * because it is what makes the shape correct rather than merely patched: both
   * were the reading describing a stretch of time it had no evidence about.
   * Round 1 fixed WHICH frames count (the cutoff is applied at read time, not
   * only when a frame arrives); round 2 fixed WHAT THEY ARE DIVIDED BY. `now`
   * now governs both ends of the measurement, which is the only way an answer
   * about "right now" can be honest.
   */
  hz(now) {
    if (!Number.isFinite(now)) return null;
    const t = this._t;
    if (t.length < 2) return null;
    // A CLOCK THAT RAN BACKWARDS is not evidence about `now` either, and it is
    // the one reading shape that would make the row incoherent: more frames than
    // the span can hold, i.e. a rate ABOVE the ceiling printed beside it
    // (measured before this guard: 22.59 against a 14.93 ceiling). Unreachable
    // from today's only caller — `readPoseHz` passes `performance.now()`, which
    // is monotonic and always at or after the newest pushed frame — so this is
    // belt-and-braces, not a fix for an observed defect. It exists because
    // `push` guards its own mirror of this case explicitly and says why, and a
    // meter that refuses out-of-order INPUT while accepting an out-of-order
    // READ is only half-guarded. T3 round 3, L-3.
    if (now < t[t.length - 1]) return null;
    const cutoff = now - this._windowMs;
    // Same cutoff rule as `push`, so a reading does not depend on whether a
    // frame happened to arrive to trigger the trim.
    let first = 0;
    while (first < t.length && t[first] < cutoff) first += 1;
    const count = t.length - first;
    if (count < 2) return null;
    const span = now - t[first];
    if (span < this._minSpanMs) return null;
    return ((count - 1) * 1000) / span;
  }

  /** Frames retained SINCE THE LAST ONE ARRIVED — which is NOT "frames inside
   *  the window right now", the guarantee this comment used to assert (T3 round
   *  3, L-3). `push` trims against the newest frame's own time; `hz` applies its
   *  cutoff against `now`. So between frames this counts samples a reading has
   *  already discarded: measured on this module, at 330,000 ms of silence it
   *  answers 45 while `hz` answers `null`.
   *
   *  Harmless where it is read, and the reason is worth stating rather than
   *  assuming — its only caller is the DEV log line, which runs immediately
   *  after a `push`, where the two agree exactly. Anything reading it at an
   *  arbitrary moment wants `hz`'s own cutoff, not this. Exposed so a rate can
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
