import {
  CONSOLE_SEARCH_PEOPLE_MAX,
  consoleSearchResponseSchema,
  type ConsoleSearchQuery,
  type ConsoleSearchResponse,
} from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { filterInput } from "../leads/service.js";
import * as leadsRepo from "../leads/repo.js";
import { searchEntries, type MemberListDeps } from "../memberList/service.js";
import { listStaff } from "../repo.js";
import { requireStaff } from "../service.js";

// PEOPLE IN THE CONSOLE'S SEARCH (spec Part 3 §17.11, V1-e-ii). One route, three kinds, each
// read only for whoever may open its list: members and leads with `members.confirm`, as the
// Members and Leads lists are; staff with `staff.manage`, as the Staff tab is. Somebody who is
// not staff of this business is refused by `requireStaff` before anything is read.

export type SearchDeps = MemberListDeps;

/** Case folded and nothing else, as the lists' own `ILIKE` folds it: one answer about one name. */
function folded(text: string): string {
  return text.toLowerCase();
}

export async function searchPeople(
  deps: SearchDeps,
  userId: string,
  gymId: string,
  query: ConsoleSearchQuery,
  limit: () => Promise<boolean>,
): Promise<ConsoleSearchResponse | null> {
  const { org, privileges } = await requireStaff(deps, gymId, userId);
  const seesList = privileges.includes("members.confirm");
  const seesStaff = privileges.includes("staff.manage");
  if (!seesList && !seesStaff) return { members: null, leads: null, staff: null };
  if (!(await limit())) return null;
  const typed = query.query;
  const max = CONSOLE_SEARCH_PEOPLE_MAX;
  const today = dayInTz(deps.now(), org.timezone);

  const [members, leads, staff] = await Promise.all([
    seesList ? searchEntries(deps, gymId, org.timezone, typed, max, privileges.includes("billing.members")) : null,
    seesList
      ? leadsRepo
          .leadsPage(deps.sql, {
            // The Leads list's own search; no follow-up is asked, so the sending facts are not read.
            ...filterInput(gymId, { q: typed }, today, { on: false, roomLeft: false, pageStopped: false, localHour: 0 }),
            cursor: null,
            limit: max + 1,
          })
          .then((page) => ({
            people: page.rows.slice(0, max).map((row) => ({
              id: row.id,
              fullName: row.fullName,
              email: row.email,
              status: row.status,
              createdAt: row.createdAt.toISOString(),
            })),
            more: page.rows.length > max,
          }))
      : null,
    seesStaff
      ? listStaff(deps.sql, gymId).then((rows) => {
          const wanted = folded(typed);
          const hits = rows.filter((r) => folded(r.displayName).includes(wanted) || (r.email !== null && folded(r.email).includes(wanted)));
          return {
            people: hits.slice(0, max).map((r) => ({ userId: r.userId, displayName: r.displayName, role: r.role, roleName: r.roleName, coOwner: r.coOwner })),
            more: hits.length > max,
          };
        })
      : null,
  ]);
  // Parsed on the way out, as every list of people in this module is.
  return consoleSearchResponseSchema.parse({ members, leads, staff });
}
