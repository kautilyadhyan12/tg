// Invite's page (Part 3 §18.6; Kd, 2026-09-27: Invite "should show like a normal
// dashboard … showing every details and reason that is understandable by human"): the
// people an Invite with these filters, or of the people selected (§18.5), would email, or
// those it leaves out with their reasons, a page at a time. The walk that makes the count and the press decides each
// person, so the page and the Send button cannot disagree; each person also carries the
// list's own App word, so a reason reads as it does on their row and their page.
import {
  MEMBER_INVITE_PEOPLE_PAGE,
  heldListWords,
  heldNamesLine,
  turns18On,
  type MemberInvitePeople,
  type MemberInvitePeopleQuery,
  type MemberInviteSelectedPeopleRequest,
} from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { appViewsOf } from "../memberList/appViews.js";
import { heldOnListOf } from "../memberships/onList.js";
import type { MemberListDeps } from "../memberList/service.js";
import { OrgsError, requirePrivilege } from "../service.js";
import { entrySeq } from "./repo.js";
import { filtersFor, workOutGroup } from "./service.js";

export async function invitePeople(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  query: MemberInvitePeopleQuery | MemberInviteSelectedPeopleRequest,
  limit: () => Promise<boolean>,
): Promise<MemberInvitePeople | null> {
  const { org } = await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  const settings = deps.invites ?? null;
  if (settings === null) return { total: 0, people: [], cursor: null };
  const now = deps.now();
  const today = dayInTz(now, org.timezone);
  const group = await workOutGroup(deps.sql, settings, gymId, await filtersFor(deps, gymId, query), today);
  const chosen = group.people.filter(({ why }) => (query.group === "reach") === (why === "reach"));
  // A page continues after the last person the one before showed, in the list's order
  // (a keyset): the group can gain or lose people in between — another press, the
  // sender — and an offset would then skip some or show them twice.
  const after = query.cursor === undefined ? null : await entrySeq(deps.sql, gymId, query.cursor);
  if (query.cursor !== undefined && after === null) {
    throw new OrgsError(400, "bad_cursor", "That page of names could not be read. Open Invite again.");
  }
  const rest = after === null ? chosen : chosen.filter(({ candidate }) => candidate.listedSeq > after);
  const shown = rest.slice(0, MEMBER_INVITE_PEOPLE_PAGE);
  // Each person's Status and Membership as their row on the list says them (23a-i).
  const held = await heldOnListOf(
    deps.sql,
    gymId,
    today,
    shown.map(({ candidate }) => candidate.entryId),
  );
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
    const mine = held.get(candidate.entryId);
    const words = mine === undefined ? null : heldListWords(mine.shown);
    return [
      {
        entryId: candidate.entryId,
        fullName: candidate.fullName,
        email: candidate.email,
        status: words === null ? candidate.status : words.status,
        membershipType: words === null ? candidate.membershipType : heldNamesLine(words.memberships),
        reason: why,
        turns18On: why === "underAge" && candidate.dateOfBirth !== null ? turns18On(candidate.dateOfBirth) : null,
        sameAddressAs,
        app,
      },
    ];
  });
  const last = shown[shown.length - 1];
  return { total: chosen.length, people, cursor: rest.length > shown.length && last !== undefined ? last.candidate.entryId : null };
}
