// The "Start here" list on Overview (spec Part 3 §5.1; ROADMAP 23b).
//
// Every member of staff may read it and is sent only the steps their own ticks let them
// do. Hiding it, for the whole gym, needs `org.manage` and a live plan, as every other
// change to the gym does.
import type { Sql } from "postgres";
import {
  START_HERE_HIDE_PRIVILEGE,
  startHereResponseSchema,
  startHereStepsFor,
  startHereStoredSchema,
  type OrgPrivilege,
  type StartHereResponse,
} from "@app/shared";
import { insertAudit, lockOrgRow } from "../repo.js";
import { OrgsError, requireStaff, requireWritablePrivilege } from "../service.js";
import * as repo from "./repo.js";

export interface StartHereDeps {
  sql: Sql;
  now: () => Date;
}

const notFound = (): OrgsError => new OrgsError(404, "org_not_found", "Organisation not found.");

/** Hidden only when the column says so in as many words; anything else shows the list. */
function isHidden(activation: unknown): boolean {
  const stored = startHereStoredSchema.safeParse(activation);
  return stored.success && stored.data.startHereHidden === true;
}

function toResponse(row: repo.StartHereRow, privileges: readonly OrgPrivilege[]): StartHereResponse {
  return startHereResponseSchema.parse({
    startHere: {
      hidden: isHidden(row.activation),
      canHide: privileges.includes(START_HERE_HIDE_PRIVILEGE),
      steps: startHereStepsFor(privileges).map((step) => ({ step, done: row.done[step] })),
    },
  });
}

export async function getStartHere(deps: StartHereDeps, userId: string, gymId: string): Promise<StartHereResponse> {
  const { privileges } = await requireStaff(deps, gymId, userId);
  const row = await repo.readStartHere(deps.sql, gymId, deps.now());
  if (row === null) throw notFound();
  return toResponse(row, privileges);
}

/** Hide the list for the whole gym, or show it again. The same answer twice changes
 *  nothing the second time. */
export async function setStartHereHidden(
  deps: StartHereDeps,
  userId: string,
  gymId: string,
  hidden: boolean,
): Promise<StartHereResponse> {
  const { privileges } = await requireWritablePrivilege(deps, gymId, userId, START_HERE_HIDE_PRIVILEGE);
  const row = await deps.sql.begin(async (tx) => {
    await lockOrgRow(tx, gymId);
    const before = await repo.readStartHere(tx, gymId, deps.now());
    if (before === null) return null;
    if (isHidden(before.activation) === hidden) return before;
    await repo.writeHidden(tx, gymId, hidden);
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: hidden ? "org.start_here_hidden" : "org.start_here_shown",
      targetType: "gym",
      targetId: gymId,
      meta: {},
    });
    return await repo.readStartHere(tx, gymId, deps.now());
  });
  if (row === null) throw notFound();
  return toResponse(row, privileges);
}
