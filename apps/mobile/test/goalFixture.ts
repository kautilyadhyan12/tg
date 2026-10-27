import { GOAL_KIND_RULES, goalSchema, type Goal } from "@app/shared";

/** A goal as the server sends it, parsed through its own shape so no case here is one it never sends. */
export function goal(more: Partial<Goal> & Pick<Goal, "kind">): Goal {
  const rule = GOAL_KIND_RULES[more.kind];
  return goalSchema.parse({
    id: "0f8e4c2a-1b3d-4e5f-8a6b-7c8d9e0f1a2b",
    period: rule.periods.length === 0 ? null : rule.periods[0],
    exerciseId: null,
    exerciseSlug: null,
    setBy: "app",
    unit: rule.unit,
    direction: "at_least",
    target: 4,
    current: 2,
    reached: false,
    held: null,
    needs: null,
    window: null,
    createdAt: "2026-10-13T09:00:00.000Z",
    updatedAt: "2026-10-13T09:00:00.000Z",
    ...more,
  });
}
