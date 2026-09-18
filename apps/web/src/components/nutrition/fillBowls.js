// ROADMAP 7a-iv-h — "How full?" needs no fractions (Kd, RULINGS 2026-09-17): each
// button carries a small dish drawn filled to its level, in the library's own
// 24-unit line style (as onboardingIcons.js draws its own), above its word.
import { createLucideIcon } from 'lucide-react';
import { FILL_CHOICES } from './measures';

// A dish's fill is a share of its VOLUME: the server weighs a saved dish as volume ×
// fill (`dishwareGrams`). So each picture is filled to the height that holds that
// share in its own shape, and a person matching a real dish to it picks the fill
// the server will weigh.

// The bowl: a deep half-round body open at the top and a foot under it. No line
// across the rim, which would hide the top of the contents; full is flush with the
// rim's ends. Deeper than wide so three quarters and full stand apart. The contents
// sit inside the body, clear of its stroke.
const CX = 12;
const RIM_Y = 5;
const BODY_RX = 9;
const BODY_RY = 11;
const CONTENTS_RX = 7;
const CONTENTS_RY = 9;

// The mug: straight sides, rounded at the foot, and a handle. The contents run
// from the inside of its foot to its rim.
const MUG_TOP = 6;
const MUG_BOTTOM = 18;

/** How far up a round bowl its contents reach, as a share of its depth, when it
 *  holds `fill` of what it holds full: a half-round bowl half full by volume is
 *  filled to 65 % of its depth, not to half. A cap of depth h in a half-ball of
 *  radius 1 holds h²(3 − h)/2 of it, and a bowl deeper or wider than round is the
 *  same shares stretched, so the rule holds for it too. */
export function fillDepth(fill) {
  let low = 0;
  let high = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    if ((mid * mid * (3 - mid)) / 2 < fill) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

const round2 = (x) => Math.round(x * 100) / 100;

/** A bowl's contents for a fill: the surface straight across at its level, and
 *  the bowl's own curve under it. */
export function contentsPath(fill) {
  const surface = RIM_Y + CONTENTS_RY * (1 - fillDepth(fill));
  const halfWidth = CONTENTS_RX * Math.sqrt(Math.max(0, 1 - ((surface - RIM_Y) / CONTENTS_RY) ** 2));
  return `M${round2(CX - halfWidth)} ${round2(surface)}A${CONTENTS_RX} ${CONTENTS_RY} 0 0 0 ${round2(CX + halfWidth)} ${round2(surface)}Z`;
}

/** A mug's contents for a fill: straight sides hold a share of the volume at the
 *  same share of the height. */
export function mugContentsPath(fill) {
  const surface = round2(MUG_BOTTOM - (MUG_BOTTOM - MUG_TOP) * fill);
  return `M6 ${surface}V16a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V${surface}Z`;
}

const slug = (label) => label.toLowerCase().replaceAll(' ', '-');

/** Each fill's bowl, by the fill's value. */
export const FILL_BOWL_ICONS = new Map(FILL_CHOICES.map((f) => [
  f.value,
  createLucideIcon(`bowl-${slug(f.label)}`, [
    ['path', { d: `M${CX - BODY_RX} ${RIM_Y}a${BODY_RX} ${BODY_RY} 0 0 0 ${2 * BODY_RX} 0`, key: 'body' }],
    ['path', { d: `M8 ${RIM_Y + BODY_RY + 3}h8`, key: 'foot' }],
    ['path', { d: contentsPath(f.value), key: 'contents', fill: 'currentColor', stroke: 'none' }],
  ]),
]));

/** Each fill's mug, by the fill's value. */
export const FILL_MUG_ICONS = new Map(FILL_CHOICES.map((f) => [
  f.value,
  createLucideIcon(`mug-${slug(f.label)}`, [
    ['path', { d: 'M4 5v11a4 4 0 0 0 4 4h6a4 4 0 0 0 4-4V5', key: 'body' }],
    ['path', { d: 'M18 9h1a2.5 2.5 0 0 1 0 5h-1', key: 'handle' }],
    ['path', { d: mugContentsPath(f.value), key: 'contents', fill: 'currentColor', stroke: 'none' }],
  ]),
]));

/** The dishes the app saves with straight sides (MeasurePicker's DISH_SIZES):
 *  a cup and a mug. Any other kind, a size typed in ml included, is drawn a bowl. */
const STRAIGHT_SIDED = new Set(['cup', 'mug']);

/** The picture for a saved dish at a fill: a mug for a straight-sided dish, a bowl
 *  for any other. */
export const fillIcon = (containerClass, fill) => (STRAIGHT_SIDED.has(containerClass) ? FILL_MUG_ICONS : FILL_BOWL_ICONS).get(fill);
