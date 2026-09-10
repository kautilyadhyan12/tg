// The icons on the onboarding choice cards: clean line icons, never cartoon
// emoji (Kd, 2026-09-10). Keyed by the shared enums' values; the test pins
// every key to its enum, so a new goal or kind of equipment cannot reach a
// screen without an icon.
import {
  Accessibility,
  ArrowUpFromLine,
  BicepsFlexed,
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

export const GOAL_ICONS = {
  weight_loss: TrendingDown,
  muscle_gain: BicepsFlexed,
  general_fitness: HeartPulse,
  flexibility: Accessibility,
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
  pull_up_bar: ArrowUpFromLine,
};
