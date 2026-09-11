// The icons on the onboarding choice cards: clean line icons, never cartoon
// emoji (Kd, 2026-09-10). Keyed by the shared enums' values; the test pins
// every key to its enum, so a new goal or kind of equipment cannot reach a
// screen without an icon.
import {
  BicepsFlexed,
  Building2,
  createLucideIcon,
  Dumbbell,
  Footprints,
  HeartPulse,
  House,
  Infinity as InfinityIcon,
  Leaf,
  MoveRight,
  PersonStanding,
  Rocket,
  Sprout,
  TrendingDown,
  TrendingUp,
  Weight,
} from 'lucide-react';

// Drawn here, in the library's own 24-unit line style, where it has no icon
// that means the thing (Kd, 2026-09-10: its wheelchair read as flexibility and
// its arrow as a pull-up bar): a person in a side stretch, a person hanging
// from a bar, a barbell, and a person balancing on one leg.
export const SideStretch = createLucideIcon('side-stretch', [
  ['path', { d: 'm8 21 3-6 3 6', key: 'legs' }],
  ['path', { d: 'M11 15c0-2.5 1-4.5 3-6', key: 'body' }],
  ['path', { d: 'M14 9c-1.2-3 .5-5.5 4.5-6.5', key: 'arm-over' }],
  ['circle', { cx: '17', cy: '7.5', r: '1', key: 'head' }],
  ['path', { d: 'm14 9.5 2.5 3.5', key: 'arm-down' }],
]);

export const PullUpBar = createLucideIcon('pull-up-bar', [
  ['path', { d: 'M3 3h18', key: 'bar' }],
  ['path', { d: 'm8 3 2.5 6', key: 'arm-left' }],
  ['path', { d: 'm16 3-2.5 6', key: 'arm-right' }],
  ['circle', { cx: '12', cy: '7', r: '1', key: 'head' }],
  ['path', { d: 'M10.5 9h3', key: 'shoulders' }],
  ['path', { d: 'M12 9v5', key: 'body' }],
  ['path', { d: 'm9 21 3-7 3 7', key: 'legs' }],
]);

export const Barbell = createLucideIcon('barbell', [
  ['path', { d: 'M2 12h2', key: 'sleeve-left' }],
  ['rect', { x: '4', y: '6', width: '4', height: '12', rx: '1', key: 'plate-left' }],
  ['path', { d: 'M8 12h8', key: 'bar' }],
  ['rect', { x: '16', y: '6', width: '4', height: '12', rx: '1', key: 'plate-right' }],
  ['path', { d: 'M20 12h2', key: 'sleeve-right' }],
]);

export const OneLegBalance = createLucideIcon('one-leg-balance', [
  ['circle', { cx: '12', cy: '5', r: '1', key: 'head' }],
  ['path', { d: 'm6 7 6 3 6-3', key: 'arms' }],
  ['path', { d: 'M12 10v4', key: 'body' }],
  ['path', { d: 'M12 14v6', key: 'leg-standing' }],
  ['path', { d: 'm12 14 3.5 1.5-2.5 2.5', key: 'leg-raised' }],
]);

/** Screen 1's weight choice: down, level, up. */
export const WEIGHT_GOAL_ICONS = {
  lose: TrendingDown,
  maintain: MoveRight,
  gain: TrendingUp,
};

export const GOAL_ICONS = {
  muscle_gain: BicepsFlexed,
  strength: Barbell,
  general_fitness: HeartPulse,
  endurance: Footprints,
  flexibility: SideStretch,
  posture: PersonStanding,
  balance: OneLegBalance,
  stress_relief: Leaf,
};

export const LEVEL_ICONS = {
  beginner: Sprout,
  intermediate: TrendingUp,
  advanced: Rocket,
};

export const EQUIPMENT_ICONS = {
  none: House,
  dumbbells: Dumbbell,
  resistance_bands: InfinityIcon,
  kettlebells: Weight,
  pull_up_bar: PullUpBar,
  gym: Building2,
};
