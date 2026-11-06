// Give a meal plan to the people selected on Members (ROADMAP Stage 2 24a-ii; spec Part 6 §16.6): the
// list's own tick boxes and action bar. The asker opens the list (`members.confirm`) and writes the
// gym's plans (`plans.manage`); a "Select all" is resolved against its own digest; who is given it is
// the gym's current records among those selected, and nobody else.
import type { GiveGymMealPlanToSelectedRequest, GymMealPlanGivePreview, GymMealPlanGivenToSelected } from "@app/shared";
import * as giving from "../../nutrition/gymMealPlanGivingService.js";
import { requirePrivilege, requireWritablePrivilege } from "../service.js";
import { selectedIds } from "./selection.js";
import type { MemberListDeps } from "./service.js";

export async function previewMealPlanSelected(
  deps: MemberListDeps, userId: string, gymId: string, request: GiveGymMealPlanToSelectedRequest, limit: () => Promise<boolean>,
): Promise<GymMealPlanGivePreview | null> {
  await requirePrivilege(deps, gymId, userId, "members.confirm");
  await requirePrivilege(deps, gymId, userId, "plans.manage");
  if (!(await limit())) return null;
  const ids = await selectedIds(deps, gymId, request.selection);
  return await giving.previewGiveToRecords(deps, gymId, request.planId, ids);
}

export async function giveMealPlanSelected(
  deps: MemberListDeps, userId: string, gymId: string, request: GiveGymMealPlanToSelectedRequest, limit: () => Promise<boolean>,
): Promise<GymMealPlanGivenToSelected | null> {
  await requirePrivilege(deps, gymId, userId, "members.confirm");
  await requireWritablePrivilege(deps, gymId, userId, "plans.manage");
  if (!(await limit())) return null;
  const ids = await selectedIds(deps, gymId, request.selection);
  return await giving.giveToRecords(deps, userId, gymId, request.planId, ids);
}
