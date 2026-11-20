// Numbers remembered for a while, each with when it was seen: a body's lengths and its size,
// which the checks take as the middle of the last few seconds, never one frame's.
interface Timed {
  readonly t: number;
  readonly v: number;
}

export class Memory {
  private items: Timed[] = [];

  add(t: number, v: number): void {
    this.items.push({ t, v });
  }
  /** Forgets what is older than `before`. */
  forget(before: number): void {
    let drop = 0;
    while (drop < this.items.length && (this.items[drop]?.t ?? before) < before) drop++;
    if (drop > 0) this.items = this.items.slice(drop);
  }
  /** How long ago the oldest number remembered was seen. */
  span(t: number): number {
    const first = this.items[0];
    return first === undefined ? 0 : t - first.t;
  }
  median(): number | null {
    if (this.items.length === 0) return null;
    const sorted = this.items.map((x) => x.v).sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    const hi = sorted[mid] ?? 0;
    return sorted.length % 2 === 1 ? hi : ((sorted[mid - 1] ?? hi) + hi) / 2;
  }
}

/** Numbers remembered for a long while, kept in order so the middle is read at once, frame after frame: a body's own
 *  lengths, which do not change while it is followed. */
export class LongMemory {
  private items: Timed[] = [];
  private sorted: number[] = [];

  add(t: number, v: number): void {
    this.items.push({ t, v });
    this.sorted.splice(this.place(v), 0, v);
  }
  /** Forgets what is older than `before`; how many numbers it forgot. */
  forget(before: number): number {
    let gone = 0;
    while (this.items.length > 0 && (this.items[0]?.t ?? before) < before) {
      const old = this.items.shift();
      if (old !== undefined) this.sorted.splice(this.place(old.v), 1);
      gone++;
    }
    return gone;
  }
  clear(): void {
    this.items = [];
    this.sorted = [];
  }
  /** When the newest number was seen; null when none is remembered. */
  newest(): number | null {
    return this.items[this.items.length - 1]?.t ?? null;
  }
  /** When the oldest number remembered was seen; null when none is. */
  oldest(): number | null {
    return this.items[0]?.t ?? null;
  }
  median(): number | null {
    const n = this.sorted.length;
    if (n === 0) return null;
    const hi = this.sorted[n >> 1] ?? 0;
    return n % 2 === 1 ? hi : ((this.sorted[(n >> 1) - 1] ?? hi) + hi) / 2;
  }
  /** Where `v` stands in the sorted numbers: the first place not below it. */
  private place(v: number): number {
    let lo = 0;
    let hi = this.sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.sorted[mid] ?? v) < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}
