// Invite's page (Part 3 §18.6; Kd, 2026-09-27: Invite "should show like a normal
// dashboard … showing every details and reason that is understandable by human"): the
// people an Invite with these filters would email, or those it leaves out with their
// reasons, a page at a time. The walk that makes the count and the press decides each
// person, so the page and the Send button cannot disagree; each person also carries the
// list's own App word, so a reason reads as it does on their row and their page.
import { MEMBER_INVITE_PEOPLE_PAGE, turns18On, type MemberInvitePeople, type MemberInvitePeopleQuery } from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { appViewsOf } from "../memberList/appViews.js";
import type { MemberListDeps } from "../memberList/service.js";
import { requirePrivilege } from "../service.js";
import { filtersOf, workOutGroup } from "./service.js";

export async function invitePeople(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  query: MemberInvitePeopleQuery,
  limit: () => Promise<boolean>,
): Promise<MemberInvitePeople | null> {
  const { org } = await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  const settings = deps.invites ?? null;
  if (settings === null) return { total: 0, people: [], cursor: null };
  const now = deps.now();
  const group = await workOutGroup(deps.sql, settings, gymId, filtersOf(query), dayInTz(now, org.timezone));
  const chosen = group.people.filter(({ why }) => (query.group === "reach") === (why === "reach"));
  const from = query.cursor ?? 0;
  const shown = chosen.slice(from, from + MEMBER_INVITE_PEOPLE_PAGE);
  const apps = await appViewsOf(
    deps.sql,
    settings,
    gymId,
    shown.map(({ candidate }) => ({
      id: candidate.entryId,
      fullName: candidate.fullName,
      email: candidate.email,
      dateOfBirth: candidate.dateOfBirth,
      former: false,
    })),
    group.members,
    now,
  );
  const people = shown.flatMap(({ candidate, why, sameAddressAs }, at) => {
    const app = apps[at];
    if (app === undefined) return [];
    return [
      {
        entryId: candidate.entryId,
        fullName: candidate.fullName,
        email: candidate.email,
        status: candidate.status,
        membershipType: candidate.membershipType,
        reason: why,
        turns18On: why === "underAge" && candidate.dateOfBirth !== null ? turns18On(candidate.dateOfBirth) : null,
        sameAddressAs,
        app,
      },
    ];
  });
  const next = from + MEMBER_INVITE_PEOPLE_PAGE;
  return { total: chosen.length, people, cursor: next < chosen.length ? next : null };
}
