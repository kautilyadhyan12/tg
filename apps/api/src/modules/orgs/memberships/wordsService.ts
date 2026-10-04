// A list's membership word linked to a type (spec Part 3 §13.2; ROADMAP 17a-iii).
//
// All four need `members.confirm`, the tick that gives one person a membership on
// their page: a preview names people and what each owes. Linking and unlinking go
// through `requireWritablePrivilege`, so a gym with no live plan reads and cannot
// change. Every date is worked out on the gym's own day.
import type { Sql } from "postgres";
import {
  MEMBERSHIP_LINK_GROUPS,
  MEMBERSHIP_WORD_PEOPLE_SHOWN,
  heldMembershipView,
  membershipLinkPreviewResponseSchema,
  membershipLinkResponseSchema,
  membershipWordsResponseSchema,
  addDays,
  type MembershipLinkPerson,
  type MembershipLinkPreviewRequest,
  type MembershipLinkPreviewResponse,
  type MembershipLinkRequest,
  type MembershipLinkResponse,
  type MembershipUnlinkRequest,
  type MembershipWordsResponse,
} from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import type { PlacedPerson } from "./words.js";
import * as repo from "./wordsRepo.js";

export interface WordsDeps {
  sql: Sql;
  now: () => Date;
}

const wordNotFound = () =>
  new OrgsError(409, "membership_word_not_found", "Nobody on your list has that membership now. Check your list and try again.");
const typeNotFound = () =>
  new OrgsError(409, "membership_type_not_found", "That membership type is no longer on your price list. Pick another.");

async function words(deps: WordsDeps, gymId: string): Promise<MembershipWordsResponse> {
  return membershipWordsResponseSchema.parse(await repo.readWords(deps.sql, gymId));
}

/** One person as the box shows them: the days their membership would read. */
function shown(placed: PlacedPerson, today: string): MembershipLinkPerson {
  const { person, group, membership } = placed;
  const base = { entryId: person.entryId, fullName: person.fullName, group, dated: person.endsOn !== null };
  if (membership === null) {
    // The last day the list gave them: "Renews 3 Aug" covers up to the day before.
    const last =
      group === "ended" && person.endsOn !== null
        ? person.endsOnKind === "renews"
          ? addDays(person.endsOn, -1)
          : person.endsOn
        : null;
    return { ...base, renewsOn: null, endsOn: last, since: null };
  }
  const view = heldMembershipView(membership, today);
  return {
    ...base,
    renewsOn: view.renewsOn,
    endsOn: view.endsOn,
    since: group === "due" && view.payment?.state === "due" ? view.payment.since : null,
  };
}

export async function getMembershipWords(deps: WordsDeps, userId: string, gymId: string): Promise<MembershipWordsResponse> {
  await requirePrivilege(deps, gymId, userId, "members.confirm");
  return await words(deps, gymId);
}

export async function previewMembershipLink(
  deps: WordsDeps,
  userId: string,
  gymId: string,
  req: MembershipLinkPreviewRequest,
): Promise<MembershipLinkPreviewResponse> {
  const { org } = await requirePrivilege(deps, gymId, userId, "members.confirm");
  const today = dayInTz(deps.now(), org.timezone);
  const preview = await repo.previewLink(deps.sql, { gymId, word: req.word, typeId: req.typeId, today });
  if (preview.kind === "word_not_found") throw wordNotFound();
  if (preview.kind === "type_not_found") throw typeNotFound();

  const count = (group: PlacedPerson["group"]) => preview.placed.filter((p) => p.group === group).length;
  return membershipLinkPreviewResponseSchema.parse({
    today,
    word: preview.word,
    type: preview.type,
    counts: {
      settled: count("settled"),
      due: count("due"),
      ask: count("ask"),
      has: count("has"),
      full: count("full"),
      ended: count("ended"),
      day: count("day"),
      past: preview.past,
    },
    // The first of each group by name; the counts above are of everybody.
    people: MEMBERSHIP_LINK_GROUPS.flatMap((group) =>
      preview.placed
        .filter((p) => p.group === group)
        .slice(0, MEMBERSHIP_WORD_PEOPLE_SHOWN)
        .map((p) => shown(p, today)),
    ),
  });
}

export async function linkMembershipWord(
  deps: WordsDeps,
  userId: string,
  gymId: string,
  req: MembershipLinkRequest,
): Promise<MembershipLinkResponse> {
  const { org } = await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  const outcome = await repo.linkWord(deps.sql, {
    gymId,
    word: req.word,
    typeId: req.typeId,
    groups: req.groups,
    expected: req.expected,
    paid: req.paid,
    today: dayInTz(deps.now(), org.timezone),
    actorUserId: userId,
  });
  switch (outcome.kind) {
    case "ok":
      return membershipLinkResponseSchema.parse({ given: outcome.given, list: await words(deps, gymId) });
    case "word_not_found":
      throw wordNotFound();
    case "type_not_found":
      throw typeNotFound();
    case "linked_elsewhere":
      throw new OrgsError(
        409,
        "membership_word_linked",
        `This membership is already linked to ${outcome.typeName}. Remove that link first.`,
      );
    case "changed":
      throw new OrgsError(
        409,
        "membership_link_changed",
        "Your list has changed since this was opened. Nobody was given a membership: check the names and try again.",
      );
    case "paid_not_answered":
      throw new OrgsError(400, "paid_not_answered", "Say whether these people have paid.");
    default: {
      const never: never = outcome;
      throw new Error(`unhandled link outcome: ${JSON.stringify(never)}`);
    }
  }
}

export async function unlinkMembershipWord(
  deps: WordsDeps,
  userId: string,
  gymId: string,
  req: MembershipUnlinkRequest,
): Promise<MembershipWordsResponse> {
  await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  await repo.unlinkWord(deps.sql, { gymId, word: req.word, actorUserId: userId });
  return await words(deps, gymId);
}
