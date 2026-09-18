// ROADMAP 7a-iv-h — each "How full?" button's bowl, drawn filled to its level
// (Kd, RULINGS 2026-09-17).
import { describe, expect, it } from 'vitest';
import { FILL_BOWL_ICONS, contentsPath, fillDepth } from './fillBowls';
import { FILL_CHOICES } from './measures';

/** What a half-round bowl holds when filled to a share of its depth. */
const held = (depth) => (depth * depth * (3 - depth)) / 2;
const surfaceOf = (fill) => Number(/^M[\d.]+ ([\d.]+)A/.exec(contentsPath(fill))[1]);

describe('the bowl on each fill button', () => {
  it('holds its fill by volume, as the server weighs a dish', () => {
    for (const f of FILL_CHOICES) expect(held(fillDepth(f.value)), f.label).toBeCloseTo(f.value, 9);
    // Half full by volume sits well above half the depth.
    expect(fillDepth(0.5)).toBeCloseTo(0.6527, 4);
    expect(fillDepth(1)).toBeCloseTo(1, 9);
  });

  it('draws a fuller bowl with a higher surface, and a full one to the rim', () => {
    const surfaces = FILL_CHOICES.map((f) => surfaceOf(f.value));
    expect(surfaces).toEqual([...surfaces].sort((a, b) => b - a));
    expect(new Set(surfaces).size).toBe(FILL_CHOICES.length);
    expect(surfaceOf(1)).toBe(8); // the rim
    for (const y of surfaces) expect(y).toBeLessThan(8 + 7);
  });

  it('has a bowl for every fill a dish can be picked at', () => {
    expect([...FILL_BOWL_ICONS.keys()]).toEqual(FILL_CHOICES.map((f) => f.value));
    for (const Icon of FILL_BOWL_ICONS.values()) expect(Icon.displayName).toMatch(/^Bowl/);
  });
});
