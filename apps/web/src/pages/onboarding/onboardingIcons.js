// The icons on the onboarding choice cards: clean line icons, never cartoon
// emoji (Kd, 2026-09-10). Keyed by the shared enums' values; the test pins
// every key to its enum, so a new goal or kind of equipment cannot reach a
// screen without an icon.
import {
  BicepsFlexed,
  createLucideIcon,
  Dumbbell,
  Footprints,
  HeartPulse,
  House,
  Infinity as InfinityIcon,
  Leaf,
  PersonStanding,
  Rocket,
  Sprout,
  TrendingDown,
  TrendingUp,
  Weight,
} from 'lucide-react';

// Two drawn here, in the library's own 24-unit line style, because it has no
// icon that means either (Kd, 2026-09-10: its wheelchair read as flexibility
// and its arrow as a pull-up bar): a person in a side stretch, and a person
// hanging from a bar.
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

export const GOAL_ICONS = {
  weight_loss: TrendingDown,
  muscle_gain: BicepsFlexed,
  general_fitness: HeartPulse,
  flexibility: SideStretch,
  endurance: Footprints,
  posture: PersonStanding,
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
};
