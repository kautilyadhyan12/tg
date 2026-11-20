// The long memory a body's own leg and trunk and the floor are kept in (52a-ii-b-i): numbers kept in order, so the middle
// is read at once, frame after frame, and forgotten by time.
import { describe, expect, it } from "vitest";
import { LongMemory } from "../src/body/memory.js";

describe("a long memory keeps its numbers in order", () => {
  it("the middle of an odd and of an even count; nothing remembered, no middle", () => {
    const m = new LongMemory();
    expect(m.median()).toBeNull();
    for (const [t, v] of [[0, 5], [1, 1], [2, 9]] as const) m.add(t, v);
    expect(m.median()).toBe(5);
    m.add(3, 3);
    expect(m.median()).toBe(4);
  });

  it("forgets by time, the oldest first, and says how many it forgot; one of two equal numbers leaves the other", () => {
    const m = new LongMemory();
    for (const [t, v] of [[0, 7], [10, 7], [20, 2], [30, 4]] as const) m.add(t, v);
    expect([m.oldest(), m.newest()]).toEqual([0, 30]);
    expect(m.forget(5)).toBe(1);
    expect(m.median()).toBe(4);
    expect(m.forget(15)).toBe(1);
    expect(m.median()).toBe(3);
    expect(m.forget(15)).toBe(0);
    expect(m.oldest()).toBe(20);
  });

  it("the middle after many numbers added and forgotten is the middle of those still remembered", () => {
    const m = new LongMemory();
    const kept: number[] = [];
    for (let t = 0; t < 200; t++) {
      const v = (t * 37) % 101;
      m.add(t, v);
      kept.push(v);
      if (t >= 60) {
        m.forget(t - 59);
        kept.shift();
      }
      const s = [...kept].sort((a, b) => a - b);
      const mid = s.length % 2 === 1 ? s[s.length >> 1] : ((s[(s.length >> 1) - 1] ?? 0) + (s[s.length >> 1] ?? 0)) / 2;
      expect([t, m.median()]).toEqual([t, mid]);
    }
  });

  it("clear forgets everything", () => {
    const m = new LongMemory();
    m.add(0, 1);
    m.clear();
    expect([m.median(), m.newest(), m.oldest()]).toEqual([null, null, null]);
  });
});
