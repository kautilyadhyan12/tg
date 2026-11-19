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
