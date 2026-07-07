// Stage 2 — Conditioning: smoothing + visibility gating (Part 2 §3.2).
// Two channels, deliberately:
//   smoothed  — 7-frame rolling mean (legacy RepCounter.angle_buffer), read by
//               FSM/fault evaluation. Time-aware: at low fps the window uses
//               FEWER samples rather than stretching latency past ~470 ms.
//   raw       — 3-frame spike filter only, read by elevation signals (airborne
//               detection): a 7-frame mean at 15 fps is ~470 ms of lag and a
//               jump flight phase is 300–500 ms — smoothing would erase it.
// Visibility gating with hysteresis: usable at vis ≥ 0.30, unusable only below
// 0.15 — the gap stops boundary flicker toggling signals per frame.

export const SMOOTHING_WINDOW_FRAMES = 7; // §3.2 (legacy angle_buffer)
export const SMOOTHING_MAX_LATENCY_MS = 470; // §3.2 "~470 ms" lag ceiling
export const SPIKE_FILTER_FRAMES = 3; // §3.2 raw-channel spike filter
export const VIS_USABLE = 0.3; // §3.2 / §2.1 (legacy threshold)
export const VIS_UNUSABLE = 0.15; // §3.2 hysteresis floor

/** Rolling-mean smoother: ≤7 samples AND ≤470 ms of history, whichever is
 *  tighter. Preallocated ring — no per-frame allocation (I5). */
export class SmoothingBuffer {
  private readonly ts = new Float64Array(SMOOTHING_WINDOW_FRAMES);
  private readonly vs = new Float64Array(SMOOTHING_WINDOW_FRAMES);
  private head = 0; // next write slot
  private count = 0;

  push(t: number, value: number): number {
    this.ts[this.head] = t;
    this.vs[this.head] = value;
    this.head = (this.head + 1) % SMOOTHING_WINDOW_FRAMES;
    if (this.count < SMOOTHING_WINDOW_FRAMES) this.count++;
    return this.value(t);
  }

  /** Mean of buffered samples no older than the latency ceiling. */
  private value(now: number): number {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head - 1 - i + SMOOTHING_WINDOW_FRAMES) % SMOOTHING_WINDOW_FRAMES;
      const ts = this.ts[idx] ?? 0;
      if (now - ts > SMOOTHING_MAX_LATENCY_MS) break; // older samples: stop (ring is time-ordered)
      sum += this.vs[idx] ?? 0;
      n++;
    }
    return n > 0 ? sum / n : 0;
  }

  reset(): void {
    this.count = 0;
    this.head = 0;
  }
}

/** Raw channel: median-of-3 spike filter — kills a single-frame glitch while
 *  passing genuine 300–500 ms elevation changes through with ≤1 frame delay. */
export class SpikeFilter {
  private readonly buf = new Float64Array(SPIKE_FILTER_FRAMES);
  private count = 0;
  private head = 0;

  push(value: number): number {
    this.buf[this.head] = value;
    this.head = (this.head + 1) % SPIKE_FILTER_FRAMES;
    if (this.count < SPIKE_FILTER_FRAMES) this.count++;
    if (this.count < SPIKE_FILTER_FRAMES) return value; // not enough history: pass through
    const a = this.buf[0] ?? 0;
    const b = this.buf[1] ?? 0;
    const c = this.buf[2] ?? 0;
    return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c)); // median of 3
  }

  reset(): void {
    this.count = 0;
    this.head = 0;
  }
}

/** Per-landmark visibility gate with §3.2 hysteresis. */
export class VisibilityGate {
  private readonly usable: boolean[];

  constructor(landmarkCount: number) {
    this.usable = new Array<boolean>(landmarkCount).fill(false);
  }

  /** Update one landmark's state from this frame's vis score. */
  update(index: number, vis: number): boolean {
    const wasUsable = this.usable[index] ?? false;
    const nowUsable = wasUsable ? vis >= VIS_UNUSABLE : vis >= VIS_USABLE;
    this.usable[index] = nowUsable;
    return nowUsable;
  }

  isUsable(index: number): boolean {
    return this.usable[index] ?? false;
  }

  /** All of the given landmarks currently usable? */
  allUsable(indices: readonly number[]): boolean {
    for (const i of indices) {
      if (!this.isUsable(i)) return false;
    }
    return true;
  }
}
