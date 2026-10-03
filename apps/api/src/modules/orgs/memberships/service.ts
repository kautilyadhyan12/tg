// A gym's membership types (spec Part 3 §13.1; ROADMAP 17a-i).
//
// Reading the price list needs `members.read`, which every role holds: staff who
// give a person a membership (17a-ii) must see what there is to give. Changing
// it needs `memberships.manage`: owner and manager by default, and anyone on
// staff the owner ticks it for (Kd, 2026-10-04). Writes go through
// `requireWritablePrivilege`, so a gym with no live plan reads its list and
// cannot change it.
//
// The price arrives as whole minor units and the currency is never the
// caller's: it is the gym's country's own, read here when a type is made.
import type { Sql } from "postgres";
import {
  gymMembershipTypesResponseSchema,
  memberCurrencyForCountry,
  type GymMembershipTypesResponse,
  type SaveGymMembershipTypeRequest,
} from "@app/shared";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import * as repo from "./repo.js";

export interface MembershipsDeps {
  sql: Sql;
  now: () => Date;
}

/** One sentence for a type that does not exist and one that is another gym's. */
const NOT_FOUND_MESSAGE = "That membership type was not found.";

function toResponse(row: repo.PriceListRow): GymMembershipTypesResponse {
  const shape = (t: repo.MembershipTypeRow) => ({
    ...t,
    archivedAt: t.archivedAt === null ? null : t.archivedAt.toISOString(),
  });
  // Parsed, not cast: `kind`, `access` and the units are text columns under a
  // CHECK, and a value the contract does not know must fail here, not on a screen.
  return gymMembershipTypesResponseSchema.parse({
    currency: memberCurrencyForCountry(row.country),
    types: row.types.map(shape),
    archived: row.archived.map(shape),
    archivedTotal: row.archivedTotal,
    classChoices: row.classChoices,
  });
}

async function readOr404(deps: MembershipsDeps, gymId: string): Promise<GymMembershipTypesResponse> {
  const row = await repo.readPriceList(deps.sql, gymId);
  if (row === null) throw new OrgsError(404, "org_not_found", "Organisation not found.");
  return toResponse(row);
}

function throwOnFailure(outcome: repo.MembershipWriteOutcome): void {
  switch (outcome.kind) {
    case "ok":
      return;
    case "not_found":
      throw new OrgsError(404, "membership_type_not_found", NOT_FOUND_MESSAGE);
    case "too_many":
      throw new OrgsError(
        409,
        "too_many_membership_types",
        `You can have ${String(outcome.cap)} membership types. Archive one you no longer sell first.`,
      );
    case "name_taken":
      throw new OrgsError(
        409,
        "membership_type_name_taken",
        "You already have a membership type with this name. Pick another name.",
      );
    case "class_not_in_gym":
      throw new OrgsError(400, "class_not_in_gym", "Pick classes from your own timetable.");
    case "kind_fixed":
      throw new OrgsError(
        409,
        "membership_type_kind_fixed",
        "A membership type's kind can't be changed. Archive it and add a new one.",
      );
    default: {
      const never: never = outcome;
      throw new Error(`unhandled membership write outcome: ${JSON.stringify(never)}`);
    }
  }
}

/** An empty description box means "none", stored as NULL. */
function typeInput(req: SaveGymMembershipTypeRequest): repo.MembershipTypeInput {
  const description = req.description ?? "";
  return { ...req, description: description.length === 0 ? null : description };
}

export async function getMembershipTypes(
  deps: MembershipsDeps,
  userId: string,
  gymId: string,
): Promise<GymMembershipTypesResponse> {
  await requirePrivilege(deps, gymId, userId, "members.read");
  return await readOr404(deps, gymId);
}

export async function createMembershipType(
  deps: MembershipsDeps,
  userId: string,
  gymId: string,
  req: SaveGymMembershipTypeRequest,
): Promise<GymMembershipTypesResponse> {
  const { org } = await requireWritablePrivilege(deps, gymId, userId, "memberships.manage");
  const currency = memberCurrencyForCountry(org.country);
  if (currency === null) {
    throw new OrgsError(
      409,
      "no_member_currency",
      "Set your country in Settings before adding a membership type.",
    );
  }
  throwOnFailure(
    await repo.createMembershipType(deps.sql, { ...typeInput(req), gymId, currency, actorUserId: userId }),
  );
  return await readOr404(deps, gymId);
}

export async function updateMembershipType(
  deps: MembershipsDeps,
  userId: string,
  gymId: string,
  typeId: string,
  req: SaveGymMembershipTypeRequest,
): Promise<GymMembershipTypesResponse> {
  await requireWritablePrivilege(deps, gymId, userId, "memberships.manage");
  throwOnFailure(
    await repo.updateMembershipType(deps.sql, {
      ...typeInput(req),
      gymId,
      typeId,
      actorUserId: userId,
      now: deps.now(),
    }),
  );
  return await readOr404(deps, gymId);
}

export async function archiveMembershipType(
  deps: MembershipsDeps,
  userId: string,
  gymId: string,
  typeId: string,
): Promise<GymMembershipTypesResponse> {
  await requireWritablePrivilege(deps, gymId, userId, "memberships.manage");
  throwOnFailure(
    await repo.archiveMembershipType(deps.sql, { gymId, typeId, actorUserId: userId, now: deps.now() }),
  );
  return await readOr404(deps, gymId);
}

export async function restoreMembershipType(
  deps: MembershipsDeps,
  userId: string,
  gymId: string,
  typeId: string,
): Promise<GymMembershipTypesResponse> {
  await requireWritablePrivilege(deps, gymId, userId, "memberships.manage");
  throwOnFailure(
    await repo.restoreMembershipType(deps.sql, { gymId, typeId, actorUserId: userId, now: deps.now() }),
  );
  return await readOr404(deps, gymId);
}
