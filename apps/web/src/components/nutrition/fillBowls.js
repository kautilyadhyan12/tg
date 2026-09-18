// ROADMAP 7a-iv-h — "How full?" needs no fractions (Kd, RULINGS 2026-09-17): each
// button carries a small bowl drawn filled to its level, in the library's own
// 24-unit line style (as onboardingIcons.js draws its own), above its word.
import { createLucideIcon } from 'lucide-react';
import { FILL_CHOICES } from './measures';

// The bowl: a half-round body open at the top and a foot under it. No line across
// the rim, which would hide the top of the contents and make three quarters and
// full one picture; full is flush with the rim's ends. The contents sit inside
// the body, clear of its stroke.
const CX = 12;
const RIM_Y = 8;
const BODY_R = 9;
const CONTENTS_R = 7;

/** How far up a round bowl its contents reach, as a share of its depth, when it
 *  holds `fill` of what it holds full. A dish's fill is a share of its VOLUME —
 *  the server weighs a dish as volume × fill (`dishwareGrams`) — and a half-round
 *  bowl half full by volume is filled to 65 % of its depth, not to half: a cap of
 *  depth h in a half-ball of radius 1 holds h²(3 − h)/2 of it. */
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

/** The contents' outline for a fill: the surface straight across at its level,
 *  and the bowl's own curve under it. */
export function contentsPath(fill) {
  const surface = RIM_Y + CONTENTS_R * (1 - fillDepth(fill));
  const halfWidth = Math.sqrt(Math.max(0, CONTENTS_R ** 2 - (surface - RIM_Y) ** 2));
  return `M${round2(CX - halfWidth)} ${round2(surface)}A${CONTENTS_R} ${CONTENTS_R} 0 0 0 ${round2(CX + halfWidth)} ${round2(surface)}Z`;
}

/** Each fill's bowl, by the fill's value. */
export const FILL_BOWL_ICONS = new Map(FILL_CHOICES.map((f) => [
  f.value,
  createLucideIcon(`bowl-${f.label.toLowerCase().replaceAll(' ', '-')}`, [
    ['path', { d: `M${CX - BODY_R} ${RIM_Y}a${BODY_R} ${BODY_R} 0 0 0 ${2 * BODY_R} 0`, key: 'body' }],
    ['path', { d: 'M8 20h8', key: 'foot' }],
    ['path', { d: contentsPath(f.value), key: 'contents', fill: 'currentColor', stroke: 'none' }],
  ]),
]));
