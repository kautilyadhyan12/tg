// A person's memberships (spec Part 3 §13.2; ROADMAP 17a-ii).
//
// Reading them needs `members.confirm`, the tick the person's page itself needs, so
// what somebody owes is shown to nobody who cannot open that page. Giving one and
// changing one need the same tick through `requireWritablePrivilege`: a gym with no
// live plan reads them and cannot change them.
//
// Every date is worked out on the gym's own day: the server's clock read in the
// gym's time zone, never the caller's.
import type { Sql } from "postgres";
import {
  HELD_EARLIER_PAGE,
  MEMBER_LIST_BY_HAND_WORDS,
  heldMembershipView,
  heldMembershipsResponseSchema,
  type ClassBookingsEnding,
  type GiveHeldMembershipRequest,
  type HeldMembershipEvent,
  type HeldMembershipShown,
  type HeldMembershipsResponse,
} from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { endMembershipBookings, membershipBookingsAsk } from "../classes/bookingChanges.js";
import { endingPerson, type BookingsAnswer } from "../classes/service.js";
import * as repo from "./heldRepo.js";

export interface HeldDeps {
  sql: Sql;
  now: () => Date;
}

const notFound = (): OrgsError => new OrgsError(404, "entry_not_found", MEMBER_LIST_BY_HAND_WORDS.entry_not_found);

/** In use first, then the ones that are over; newest start first within each. */
const ORDER: Record<HeldMembershipShown, number> = { active: 0, frozen: 0, upcoming: 1, ended: 2, cancelled: 2 };

async function readOr404(deps: HeldDeps, gymId: string, entryId: string, today: string): Promise<HeldMembershipsResponse> {
  const list = await repo.readHeld(deps.sql, gymId, entryId);
  if (list === null) throw notFound();
  const all = [...list.inUse, ...list.over]
    .map((row) => ({
      id: row.id,
      typeId: row.typeId,
      typeName: row.typeName,
      kind: row.membership.kind,
      priceMinor: row.priceMinor,
      currency: row.currency,
      termCount: row.membership.termCount,
      termUnit: row.membership.termUnit,
      packClasses: row.membership.packClasses,
      packDays: row.membership.packDays,
      startsOn: row.membership.startsOn,
      frozenOn: row.membership.frozenOn,
      classesLeft: row.membership.classesLeft,
      fromList: row.fromList,
      view: heldMembershipView(row.membership, today),
    }))
    .sort(
      (a, b) =>
        ORDER[a.view.status] - ORDER[b.view.status] ||
        (a.startsOn < b.startsOn ? 1 : a.startsOn > b.startsOn ? -1 : 0) ||
        (a.id < b.id ? -1 : 1),
    );
  // Every one in use, and a page of the ones that are over: the ones the clock has
  // ended since the last write come first among those, being the newest.
  const inUse = all.filter((m) => ORDER[m.view.status] < 2);
  const over = all.filter((m) => ORDER[m.view.status] === 2);
  const shown = over.slice(0, HELD_EARLIER_PAGE);
  const stored = list.overTotal - list.over.length;
  return heldMembershipsResponseSchema.parse({
    today,
    past: list.past,
    memberships: [...inUse, ...shown],
    earlierNotShown: over.length - shown.length + stored,
    types: list.types,
    listed: list.listed,
  });
}

function throwOnFailure(outcome: repo.HeldWriteOutcome): void {
  switch (outcome.kind) {
    case "ok":
      return;
    case "entry_not_found":
      throw notFound();
    case "membership_not_found":
      throw new OrgsError(404, "held_membership_not_found", "That membership was not found.");
    case "type_not_found":
      throw new OrgsError(
        409,
        "membership_type_not_found",
        "That membership type is no longer on your price list. Pick another.",
      );
    case "past_member":
      throw new OrgsError(409, "past_member", "This is a past member. Put them back on your list first.");
    case "too_many":
      throw new OrgsError(
        409,
        "too_many_held_memberships",
        `One person can have ${String(outcome.cap)} memberships running at once. Cancel one they no longer use first.`,
      );
    case "start_out_of_range":
      throw new OrgsError(400, "start_out_of_range", "Pick a start date no more than a year from today.");
    case "already_over":
      throw new OrgsError(
        409,
        "membership_already_over",
        "With that start date this membership would already be over. Pick a later start date.",
      );
    case "already_held":
      throw new OrgsError(
        409,
        "membership_already_held",
        outcome.ends
          ? `They already have ${outcome.typeName}. Cancel that one first, or pick a start date after it ends.`
          : `They already have ${outcome.typeName}. Cancel that one first.`,
      );
    case "request_reused":
      throw new OrgsError(409, "request_reused", "That was already saved for somebody else. Open the form again.");
    case "not_allowed":
      throw new OrgsError(
        409,
        "held_membership_changed",
        "This membership has changed since you opened it. Nothing was saved: check it and try again.",
      );
    default: {
      const never: never = outcome;
      throw new Error(`unhandled held membership outcome: ${JSON.stringify(never)}`);
    }
  }
}

export async function getHeldMemberships(
  deps: HeldDeps,
  userId: string,
  gymId: string,
  entryId: string,
): Promise<HeldMembershipsResponse> {
  const { org } = await requirePrivilege(deps, gymId, userId, "members.confirm");
  return await readOr404(deps, gymId, entryId, dayInTz(deps.now(), org.timezone));
}

export async function giveHeldMembership(
  deps: HeldDeps,
  userId: string,
  gymId: string,
  entryId: string,
  req: GiveHeldMembershipRequest,
): Promise<HeldMembershipsResponse> {
  const { org } = await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  const now = deps.now();
  const today = dayInTz(now, org.timezone);
  throwOnFailure(
    await repo.giveHeld(deps.sql, {
      gymId,
      entryId,
      typeId: req.typeId,
      requestKey: req.requestKey,
      startsOn: req.startsOn,
      paid: req.paid,
      today,
      actorUserId: userId,
      now,
    }),
  );
  return await readOr404(deps, gymId, entryId, today);
}

const CANCEL_BOOKINGS = { ask: membershipBookingsAsk, end: endMembershipBookings };

export async function moveHeldMembership(
  deps: HeldDeps,
  userId: string,
  gymId: string,
  entryId: string,
  membershipId: string,
  event: HeldMembershipEvent,
  confirmBookings: string | null = null,
  confirmPtSessions: string | null = null,
): Promise<BookingsAnswer<HeldMembershipsResponse>> {
  const { org } = await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  const now = deps.now();
  const today = dayInTz(now, org.timezone);
  const outcome = await repo.moveHeld(deps.sql, CANCEL_BOOKINGS, {
    gymId,
    entryId,
    membershipId,
    event,
    today,
    confirmBookings,
    confirmPtSessions,
    actorUserId: userId,
    now,
  });
  if (outcome.kind === "has_bookings") {
    const ending: ClassBookingsEnding = { ...outcome.ending, people: outcome.ending.people.map(endingPerson) };
    // `ptSessions` rides along as it is: the sessions booked on this membership.
    return { kind: "bookings", ending };
  }
  throwOnFailure(outcome);
  return { kind: "ok", body: await readOr404(deps, gymId, entryId, today) };
}
