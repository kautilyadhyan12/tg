// WHAT A GYM SELLS IN THE APP (ROADMAP Stage 2 item 18k-i; Kd, 2026-11-06, `rulings/2026-11-06-18k-i.md`), for the
// phone (Stage 5 item 20). THE ONE RULE: a live member of the gym reads its lines ticked "Sell in the app", each as
// Add membership would give it today (`forSaleItem`); a stranger to the gym gets 404, as every member route answers.
// Nothing is listed while the gym cannot take a payment through Square, or has no live plan with us: a member is never
// shown something they cannot buy.
import { forSaleItem, forSaleResponseSchema, type ForSaleResponse } from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { gymContact } from "../agreement/repo.js";
import { billDayOf } from "../memberships/billsSql.js";
import { readerOf } from "../myMembership/repo.js";
import { taxIncludedOf } from "../register/taxRepo.js";
import { gymHasLivePlan } from "../repo.js";
import { orgNotFound, stateOf } from "./cards.js";
import { readPerson } from "./cardsRepo.js";
import { soldInApp } from "./forSaleRepo.js";
import * as repo from "./repo.js";
import type { PaymentsDeps } from "./service.js";

type Limit = () => Promise<boolean>;

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
  const [lines, contact, billDay, taxIncluded, person] = await Promise.all([
    soldInApp(deps.sql, gymId),
    gymContact(deps.sql, gymId),
    billDayOf(deps.sql, gymId),
    taxIncludedOf(deps.sql, gymId),
    record === "own" && reader.entryId !== null ? readPerson(deps.sql, gymId, reader.entryId) : Promise.resolve(null),
  ]);
  if (taxIncluded === null) throw orgNotFound();
  const today = dayInTz(deps.now(), gym.timezone);
  const items = lines.flatMap((line) => {
    const item = forSaleItem({ type: line.type, taxes: line.taxes, taxIncluded, billDay, today, gym: { name: gym.name, ...contact }, personName: person?.fullName ?? "" });
    return item === null ? [] : [item];
  });
  return forSaleResponseSchema.parse({ ...empty, items });
}
