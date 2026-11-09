// WHAT A GYM SELLS IN THE APP (ROADMAP Stage 2 item 18k-i; Kd, 2026-11-06, `rulings/2026-11-06-18k-i.md`), for the
// phone (Stage 5 item 20). THE ONE RULE: a live member of the gym reads its lines ticked "Sell in the app", each as
// Add membership would give it today (`forSaleItem`); a stranger to the gym gets 404, as every member route answers.
// Nothing is listed while the gym cannot take a payment through Square, or has no live plan with us: a member is never
// shown something they cannot buy.
//
// For buying it (18k-iii-a), each line comes with the key of its details and the agreement it asks them to sign, and is
// worked out with the Refer a friend gifts Add membership would fill in for the reader's own record: what Buy is checked
// against (`appPurchasesRepo.ts`).
import { discountFits, forSaleResponseSchema, forSaleWorked, isUnder18, type ForSaleFriendGift, type ForSaleLine, type ForSaleResponse } from "@app/shared";
import type { Sql } from "postgres";
import { z } from "zod";
import { dayInTz } from "../../gamification/streak.js";
import { factsKeyOf } from "../agreement/factsKey.js";
import { gymContact, typeDocumentSql } from "../agreement/repo.js";
import { billDayOf } from "../memberships/billsSql.js";
import { appMemberValues } from "../memberList/placeOnList.js";
import { detailsRecordOf } from "./appPurchaseHome.js";
import { memberContact } from "../memberList/repo.js";
import { readerOf } from "../myMembership/repo.js";
import { friendGiftOffer } from "../referrals/friendGift.js";
import { waitingGiftFor } from "../referrals/memberGiftRepo.js";
import { taxIncludedOf } from "../register/taxRepo.js";
import { gymHasLivePlan } from "../repo.js";
import { orgNotFound, stateOf } from "./cards.js";
import { soldInApp } from "./forSaleRepo.js";
import * as repo from "./repo.js";
import type { PaymentsDeps } from "./service.js";

type Limit = () => Promise<boolean>;

const wordingSchema = z.object({ type_id: z.uuid(), id: z.uuid(), version: z.number().int(), body: z.string(), name: z.string().nullable() });

/** The newest wording, not stopped, of the agreement each line sold in the app asks for, by line. */
async function wordingsOf(sql: Sql, gymId: string): Promise<Map<string, ForSaleLine["agreement"]>> {
  const rows = await sql`
    SELECT t.id AS type_id, a.id, a.version, a.body, d.name
    FROM gym_membership_types t
    JOIN gym_agreements a ON a.gym_id = t.gym_id AND a.document_id = ${typeDocumentSql(sql)}
    JOIN gym_agreement_documents d ON d.gym_id = a.gym_id AND d.id = a.document_id
    WHERE t.gym_id = ${gymId} AND t.sold_in_app AND t.archived_at IS NULL AND a.stopped_at IS NULL
      AND a.version = (SELECT max(x.version) FROM gym_agreements x WHERE x.gym_id = a.gym_id AND x.document_id = a.document_id)`;
  const found = new Map<string, ForSaleLine["agreement"]>();
  for (const raw of rows) {
    const r = wordingSchema.parse(raw);
    found.set(r.type_id, { id: r.id, name: r.name, version: r.version, text: r.body });
  }
  return found;
}

/** The record's name and date of birth; a past member's too, whose record comes back on the list by what they buy. */
async function personOf(sql: Sql, gymId: string, entryId: string): Promise<{ fullName: string; dateOfBirth: string | null } | null> {
  const [row] = await sql<{ full_name: string; date_of_birth: string | null }[]>`
    SELECT full_name, date_of_birth::text AS date_of_birth FROM gym_member_list_entries WHERE gym_id = ${gymId} AND id = ${entryId}`;
  return row === undefined ? null : { fullName: row.full_name.trim(), dateOfBirth: row.date_of_birth };
}

export async function readForSale(deps: PaymentsDeps, userId: string, gymId: string, limit: Limit): Promise<ForSaleResponse | null> {
  const reader = await readerOf(deps.sql, gymId, userId);
  if (reader === null) throw orgNotFound();
  if (!(await limit())) return null;
  const record = reader.entryId === null ? "none" : reader.holders === 1 ? "own" : "shared";
  const gym = await repo.readGym(deps.sql, gymId);
  if (gym === null) throw orgNotFound();
  const empty = forSaleResponseSchema.parse({ gym: { name: gym.name }, record, items: [] });
  const connection = deps.square === null ? null : await repo.readConnection(deps.sql, gymId, deps.square.environment);
  if (stateOf(deps.square, gym, connection) !== "ready" || !(await gymHasLivePlan(deps.sql, gymId))) return empty;
  const today = dayInTz(deps.now(), gym.timezone);
  // A member not on the list yet: the record already holding their very details, which nobody holds in the app, is read as
  // theirs, as Buy checks it (round one H1); with none, they are named as the record made for them will name them.
  const buyer = record === "none" ? await memberContact(deps.sql, gymId, userId) : null;
  const details =
    buyer === null || buyer.email === null
      ? null
      : await deps.sql.begin(async (tx) => await detailsRecordOf(tx, gymId, { name: appMemberValues(buyer).fullName, email: buyer.email ?? "", phone: buyer.phone }));
  const own = record === "own" && reader.entryId !== null ? reader.entryId : details !== null && details.holders.length === 0 ? details.id : null;
  const [lines, contact, billDay, taxIncluded, person, wordings, friendOffer, memberGift] = await Promise.all([
    soldInApp(deps.sql, gymId),
    gymContact(deps.sql, gymId),
    billDayOf(deps.sql, gymId),
    taxIncludedOf(deps.sql, gymId),
    own !== null ? personOf(deps.sql, gymId, own) : Promise.resolve(buyer === null ? null : { fullName: appMemberValues(buyer).fullName, dateOfBirth: null }),
    wordingsOf(deps.sql, gymId),
    // The gifts Add membership fills in for this record (18k-iii-a).
    own === null ? Promise.resolve(null) : friendGiftOffer(deps.sql, gymId, own, today),
    own === null ? Promise.resolve(null) : waitingGiftFor(deps.sql, gymId, own, "membership"),
  ]);
  if (taxIncluded === null) throw orgNotFound();
  const minor = person === null ? null : isUnder18(person.dateOfBirth, today);
  const items = lines.flatMap((line): ForSaleLine[] => {
    const d = friendOffer?.discount ?? null;
    const friendGift: ForSaleFriendGift | null =
      d !== null && discountFits({ ...d, archived: d.archivedAt !== null }, { today, membershipTypeId: line.type.id, currency: line.type.currency }).ok
        ? { id: d.id, name: d.name, kind: d.kind, percentBp: d.percentBp, amountMinor: d.amountMinor, membershipPayments: d.membershipPayments }
        : null;
    const worked = forSaleWorked({
      type: line.type,
      taxes: line.taxes,
      taxIncluded,
      billDay,
      today,
      gym: { name: gym.name, ...contact },
      personName: person?.fullName ?? "",
      friendGift,
      memberGift: memberGift === null ? null : { id: memberGift.id, kind: memberGift.kind, percentBp: memberGift.percentBp, amountMinor: memberGift.amountMinor, currency: memberGift.currency },
    });
    return worked === null ? [] : [{ ...worked.item, factsKey: factsKeyOf(worked.item.facts), agreement: wordings.get(line.type.id) ?? null }];
  });
  return forSaleResponseSchema.parse({ ...empty, signer: minor === true ? "guardian" : minor === false ? "person" : "either", items });
}
