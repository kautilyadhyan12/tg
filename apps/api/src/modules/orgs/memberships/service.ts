// A gym's membership types (spec Part 3 §13.1; ROADMAP 17a-i).
//
// Reading the price list needs `members.read`, which every role holds: staff who
// give a person a membership (17a-ii) must see what there is to give; whoever
// holds the tick to change it may read it too. Changing
// it needs `memberships.manage`: owner and manager by default, and anyone on
// staff the owner ticks it for (Kd, 2026-10-04). Writes go through
// `requireWritablePrivilege`, so a gym with no live plan reads its list and
// cannot change it.
//
// The price arrives as whole minor units and the currency is never the
// caller's: it is the gym's country's own, read here when a type is made.
import type { Sql } from "postgres";
import {
  APP_PURCHASE_STAFF_WORDS,
  REGISTER_WORDS,
  gymMembershipTypesResponseSchema,
  memberCurrencyForCountry,
  type GymMembershipTypesResponse,
  type SaveGymMembershipTypeRequest,
  type UpdateGymMembershipTypeRequest,
  renewalReminderPreviewResponseSchema,
  type RenewalReminderPreviewRequest,
  type RenewalReminderPreviewResponse,
  type PriceRaisePreviewRequest,
  type PriceRaisePreviewResponse,
} from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { OrgsError, holdsPrivilege, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { previewLine } from "./renewalReminders.js";
import { applyRaise, previewRaise } from "./priceRaises.js";
import { typeCurrency } from "./priceRaisesRepo.js";
import { typeOfGym } from "./renewalRemindersRepo.js";
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
    updatedAt: t.updatedAt.toISOString(),
  });
  // Parsed, not cast: `kind`, `access` and the units are text columns under a
  // CHECK, and a value the contract does not know must fail here, not on a screen.
  return gymMembershipTypesResponseSchema.parse({
    currency: memberCurrencyForCountry(row.country),
    types: row.types.map(shape),
    archived: row.archived.map(shape),
    archivedTotal: row.archivedTotal,
    classChoices: row.classChoices,
    taxRates: row.taxRates,
    taxIncluded: row.taxIncluded,
    billDay: row.billDay,
    agreements: row.agreements,
    defaultAgreement: row.defaultAgreement,
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
    case "raise_not_allowed":
      throw new OrgsError(409, "price_raise_not_allowed", "Members can only be moved to a higher price of a repeating membership.");
    case "being_bought":
      throw new OrgsError(409, "type_being_bought", APP_PURCHASE_STAFF_WORDS.type_buying);
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
    case "changed":
      throw new OrgsError(
        409,
        "membership_type_changed",
        "Somebody changed this membership type while you had it open. Nothing was saved: check it and try again.",
      );
    case "no_currency":
      throw new OrgsError(
        409,
        "no_member_currency",
        "Set your country before adding a membership type.",
      );
    case "rate_not_found":
      throw new OrgsError(409, "tax_rate_not_found", REGISTER_WORDS.rate_not_found);
    case "taxes_over_cap":
      throw new OrgsError(409, "taxes_over_cap", REGISTER_WORDS.taxes_over_cap);
    default: {
      const never: never = outcome;
      throw new Error(`unhandled membership write outcome: ${JSON.stringify(never)}`);
    }
  }
}

/** An empty description box means "none", stored as NULL. */
function typeInput(req: SaveGymMembershipTypeRequest): repo.MembershipTypeInput {
  const description = req.description ?? "";
  return {
    name: req.name,
    description: description.length === 0 ? null : description,
    kind: req.kind,
    priceMinor: req.priceMinor,
    termCount: req.termCount,
    termUnit: req.termUnit,
    packClasses: req.packClasses,
    packDays: req.packDays,
    access: req.access,
    bookingsLimit: req.bookingsLimit,
    bookingsPeriod: req.bookingsPeriod,
    classTypeIds: req.classTypeIds,
    includesPt: req.includesPt,
    ptLimit: req.ptLimit,
    ptPeriod: req.ptPeriod,
    taxRateIds: req.taxRateIds,
    joiningFeeMinor: req.joiningFeeMinor,
    contractPeriods: req.contractPeriods,
    contractThen: req.contractThen,
    noticeDays: req.noticeDays,
    leaveFeeMinor: req.leaveFeeMinor,
    coolingOffDays: req.coolingOffDays,
    renewalReminderDays: req.renewalReminderDays,
    termReminderDays: req.termReminderDays,
    soldInApp: req.soldInApp,
  };
}

export async function getMembershipTypes(
  deps: MembershipsDeps,
  userId: string,
  gymId: string,
): Promise<GymMembershipTypesResponse> {
  // Whoever may change the list may read it, whatever else they hold: the owner can
  // give the tick alone. A stranger still gets `requirePrivilege`'s 404.
  if (!(await holdsPrivilege(deps, gymId, userId, "memberships.manage"))) {
    await requirePrivilege(deps, gymId, userId, "members.read");
  }
  return await readOr404(deps, gymId);
}

export async function createMembershipType(
  deps: MembershipsDeps,
  userId: string,
  gymId: string,
  req: SaveGymMembershipTypeRequest,
): Promise<GymMembershipTypesResponse> {
  await requireWritablePrivilege(deps, gymId, userId, "memberships.manage");
  throwOnFailure(await repo.createMembershipType(deps.sql, { ...typeInput(req), gymId, actorUserId: userId }));
  return await readOr404(deps, gymId);
}

export async function updateMembershipType(
  deps: MembershipsDeps & { emailKey: Buffer | null },
  userId: string,
  gymId: string,
  typeId: string,
  req: UpdateGymMembershipTypeRequest,
): Promise<GymMembershipTypesResponse> {
  await requireWritablePrivilege(deps, gymId, userId, "memberships.manage");
  const now = deps.now();
  const asked = req.raise;
  const outcome = await repo.updateMembershipType(deps.sql, {
    ...typeInput(req),
    gymId,
    typeId,
    readAt: new Date(req.updatedAt),
    actorUserId: userId,
    now,
    // Members already on it, ticked in the box before Save, pay the new price too (18w).
    raise:
      asked === undefined
        ? null
        : (tx) => applyRaise(tx, { gymId, typeId, lineMinor: req.priceMinor, noticeDays: asked.noticeDays, membershipIds: asked.membershipIds, emailKey: deps.emailKey, userId, now }),
  });
  throwOnFailure(outcome);
  const list = await readOr404(deps, gymId);
  return outcome.kind === "ok" && outcome.raised !== undefined ? { ...list, raised: outcome.raised } : list;
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

/** The box before Save of a higher price (18w): everybody on the line now, and what the new price would do to
 *  each. Whoever may change the line may read it; another gym's line is not found. */
export async function previewPriceRaise(
  deps: MembershipsDeps & { emailKey: Buffer | null },
  userId: string,
  gymId: string,
  typeId: string,
  req: PriceRaisePreviewRequest,
): Promise<PriceRaisePreviewResponse> {
  const { org } = await requirePrivilege(deps, gymId, userId, "memberships.manage");
  const currency = await typeCurrency(deps.sql, gymId, typeId);
  if (currency === null) throw new OrgsError(404, "membership_type_not_found", NOT_FOUND_MESSAGE);
  return await previewRaise(deps.sql, deps.emailKey, gymId, typeId, req.priceMinor, req.noticeDays, dayInTz(deps.now(), org.timezone), currency);
}

/** The line's box for a renewal reminder (18v-iv): everybody on the line now, and what this reminder would do
 *  for each. Whoever may change the line may read it; another gym's line is not found. */
export async function previewRenewalReminder(
  deps: MembershipsDeps & { emailKey: Buffer | null },
  userId: string,
  gymId: string,
  typeId: string,
  req: RenewalReminderPreviewRequest,
): Promise<RenewalReminderPreviewResponse> {
  const { org } = await requirePrivilege(deps, gymId, userId, "memberships.manage");
  if (!(await typeOfGym(deps.sql, gymId, typeId))) throw new OrgsError(404, "membership_type_not_found", NOT_FOUND_MESSAGE);
  return renewalReminderPreviewResponseSchema.parse(await previewLine(deps.sql, deps.emailKey, gymId, typeId, req.renewalReminder, dayInTz(deps.now(), org.timezone)));
}
