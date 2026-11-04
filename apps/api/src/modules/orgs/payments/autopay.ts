// PAUSE AUTOMATIC PAYMENTS (ROADMAP 18d-iv-f; spec Part 3 §14.8; Kd, rulings/2026-11-02-18d-iv-e-ii-a.md): under Card on file, staff
// with the payments tick stop the app charging a person's saved card by itself, for every membership that card pays for, and keep the
// card. Bills still come due; staff take payment at the desk, or charge the card by hand.
//
// THE WORST THING here is a member who asked to pay at the desk having their saved card charged anyway: by the bill's date, by a retry
// after a decline, or as the payer for somebody else. So the pause is read by the one rule every automatic charge and retry is found by
// (`appCharges`), and again by the write, under the record's lock, before a charge is sent (`startCharge`). Pause takes the gym's lock,
// not each record's: a charge whose write checked a moment before the press, or one already waiting on Square, may still go through,
// as with Remove card.
import { autopayPreviewSchema, type AutopayPreview, type MemberCardResponse } from "@app/shared";
import { payerOf } from "../payers/repo.js";
import { requirePrivilege, requireWritablePrivilege } from "../service.js";
import * as autopay from "./autopayRepo.js";
import { BILLING, entryNotFound, orgNotFound, paidBy, shownCard, staffView } from "./cards.js";
import * as cards from "./cardsRepo.js";
import * as repo from "./repo.js";
import type { PaymentsDeps } from "./service.js";

/** How many memberships the box names before "and N more". */
const NAMES_SHOWN = 50;

/** The record, which must pay for itself: a person somebody else pays for is paused on that payer's page. */
async function payingSelf(deps: PaymentsDeps, gymId: string, entryId: string): Promise<void> {
  const person = await cards.readPerson(deps.sql, gymId, entryId);
  if (person === null) throw entryNotFound();
  const payer = await payerOf(deps.sql, gymId, entryId);
  if (payer !== null) throw paidBy(payer.name, person.fullName);
}

/** What Pause or Resume changes: the card, each renewing membership it pays for, and whether a chargeback stops them too. */
export async function readAutopay(deps: PaymentsDeps, userId: string, gymId: string, entryId: string): Promise<AutopayPreview> {
  await requirePrivilege(deps, gymId, userId, BILLING);
  const gym = await repo.readGym(deps.sql, gymId);
  if (gym === null) throw orgNotFound();
  await payingSelf(deps, gymId, entryId);
  const row = deps.square === null ? null : await repo.readConnection(deps.sql, gymId, deps.square.environment);
  const [card, pausedOn, { people, total }, chargebackStops] = await Promise.all([
    cards.readCard(deps.sql, gymId, entryId),
    autopay.pausedOn(deps.sql, gymId, entryId),
    autopay.renewingPaidBy(deps.sql, gymId, entryId, NAMES_SHOWN, deps.now()),
    autopay.chargebackStopsPayer(deps.sql, gymId, entryId),
  ]);
  const shown = shownCard(card, deps.square, row);
  return autopayPreviewSchema.parse({
    pausedOn,
    people,
    more: Math.max(0, total - people.length),
    card: shown === null ? null : { brand: shown.brand, last4: shown.last4 },
    squareConnected: row?.state === "connected",
    chargebackStops,
  });
}

/** Pause automatic payments. Pressed twice, paused once. */
export async function pauseAutopay(deps: PaymentsDeps, userId: string, gymId: string, entryId: string): Promise<MemberCardResponse> {
  const { org } = await requireWritablePrivilege(deps, gymId, userId, BILLING);
  await payingSelf(deps, gymId, entryId);
  await autopay.pause(deps.sql, gymId, entryId, userId, deps.now());
  return await staffView(deps, org, userId, entryId);
}

/** Resume automatic payments. Pressed twice, resumed once. */
export async function resumeAutopay(deps: PaymentsDeps, userId: string, gymId: string, entryId: string): Promise<MemberCardResponse> {
  const { org } = await requireWritablePrivilege(deps, gymId, userId, BILLING);
  await payingSelf(deps, gymId, entryId);
  await autopay.resume(deps.sql, gymId, entryId, userId, deps.now());
  return await staffView(deps, org, userId, entryId);
}
