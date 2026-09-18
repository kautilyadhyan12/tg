// ROADMAP 7a-iv-h — each "How full?" button's dish, drawn filled to its level
// (Kd, RULINGS 2026-09-17): a bowl, or a mug for a straight-sided dish.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FILL_BOWL_ICONS, FILL_MUG_ICONS, contentsPath, fillDepth, fillIcon, mugContentsPath } from './fillBowls';
import { FILL_CHOICES } from './measures';

/** What a half-round bowl holds when filled to a share of its depth. */
const held = (depth) => (depth * depth * (3 - depth)) / 2;
const surfaceOf = (path) => Number(/^M[\d.]+ ([\d.]+)[AV]/.exec(path)[1]);
const round2 = (x) => Math.round(x * 100) / 100;
/** The contents path an icon draws. */
const drawn = (Icon) => /d="([^"]+)" fill="currentColor"/.exec(renderToStaticMarkup(createElement(Icon)))[1];

describe('the bowl on each fill button', () => {
  it('holds its fill by volume, as the server weighs a dish', () => {
    for (const f of FILL_CHOICES) expect(held(fillDepth(f.value)), f.label).toBeCloseTo(f.value, 9);
    // Half full by volume sits well above half the depth.
    expect(fillDepth(0.5)).toBeCloseTo(0.6527, 4);
    expect(fillDepth(1)).toBeCloseTo(1, 9);
  });

  it('draws each surface at the depth that holds its fill, from a rim at 5 down 9 to the bottom', () => {
    for (const f of FILL_CHOICES) {
      expect(surfaceOf(contentsPath(f.value)), f.label).toBe(round2(5 + 9 * (1 - fillDepth(f.value))));
    }
    // Half, pinned: at 65 % of the depth, not at half (which would be 9.5).
    expect(surfaceOf(contentsPath(0.5))).toBe(8.13);
    expect(surfaceOf(contentsPath(1))).toBe(5); // the rim
    // Three quarters stands clear of full: more than a unit and a half below the rim.
    expect(surfaceOf(contentsPath(0.75)) - surfaceOf(contentsPath(1))).toBeGreaterThan(1.5);
  });
});

describe('the mug on each fill button', () => {
  it('draws each surface at its share of the height: straight sides hold volume as height', () => {
    expect(FILL_CHOICES.map((f) => surfaceOf(mugContentsPath(f.value)))).toEqual([15, 12, 9, 6]);
  });
});

describe('the picture a saved dish gets', () => {
  it('draws every fill with its own contents, a bowl and a mug each', () => {
    expect([...FILL_BOWL_ICONS.keys()]).toEqual(FILL_CHOICES.map((f) => f.value));
    expect([...FILL_MUG_ICONS.keys()]).toEqual(FILL_CHOICES.map((f) => f.value));
    for (const f of FILL_CHOICES) {
      expect(drawn(FILL_BOWL_ICONS.get(f.value)), f.label).toBe(contentsPath(f.value));
      expect(drawn(FILL_MUG_ICONS.get(f.value)), f.label).toBe(mugContentsPath(f.value));
    }
  });

  it('is a mug for a cup or a mug, and a bowl for any other dish', () => {
    for (const kind of ['cup', 'mug']) expect(fillIcon(kind, 0.5), kind).toBe(FILL_MUG_ICONS.get(0.5));
    for (const kind of ['cereal_bowl', 'custom', 'katori', undefined]) expect(fillIcon(kind, 0.5), String(kind)).toBe(FILL_BOWL_ICONS.get(0.5));
  });
});
