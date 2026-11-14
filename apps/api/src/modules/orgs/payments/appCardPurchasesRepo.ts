// Buy a repeating membership in the app (ROADMAP Stage 2 item 18k-iv): the card it is paid with. Every statement names the
// gym.
//
// THE ONE RULE: a repeating line is charged only to the buyer's own card, the one their record holds in the Square account
// the gym is connected to now, on the very sentence they ticked, which names that card. Nobody pays for a buyer (18i), so
// the card is never another person's. Asked under the gym's lock, which a card's save and removal take too, so a card
// replaced meanwhile is read as it is.
import { createHash } from "node:crypto";
import { cardExpired, repeatingChargeWords, type ForSaleItem } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { renewingHeldName } from "../memberships/heldRepo.js";
import { pausedOn, chargebackStopsPayer } from "./autopayRepo.js";
import { cardStopped } from "./cardChargesRepo.js";
import type { SquareEnvironment } from "./square.js";

type SqlOrTx = Sql | TransactionSql;

export interface OwnCard {
  cardId: string;
  customerId: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

/** The card the record itself holds in this Square account; null for none. */
export async function ownCardIn(sql: SqlOrTx, gymId: string, entryId: string, environment: SquareEnvironment, accountId: string): Promise<OwnCard | null> {
  const [row] = await sql<{ card_id: string; customer_id: string; brand: string; last4: string; exp_month: number; exp_year: number }[]>`
    SELECT card_id, customer_id, brand, last4, exp_month, exp_year FROM gym_member_cards
    WHERE gym_id = ${gymId} AND entry_id = ${entryId} AND environment = ${environment} AND account_id = ${accountId}
      -- Not one staff are removing right now (round one's re-check, N1); a mark left past five minutes no longer counts.
      AND (removing_since IS NULL OR removing_since < now() - interval '5 minutes')`;
  return row === undefined
    ? null
    : { cardId: row.card_id, customerId: row.customer_id, brand: row.brand, last4: row.last4, expMonth: row.exp_month, expYear: row.exp_year };
}

export type CardCheck =
  | { kind: "ok"; card: OwnCard }
  | { kind: "card_needed" | "card_expired" | "card_stopped" | "card_paused" | "card_changed" | "verification" }
  | { kind: "renewing_held"; name: string };

/** Square's pass names the card it was made for: the card's id, `#verf:` and Square's own letters, the only shape Square
 *  gave in its test area (2026-11-14, the builder's run and round one's). Any other is refused before anything is charged:
 *  a nonce for a card typed by hand would charge a card the tick does not name (round one, L1). */
export function passFits(pass: string, cardId: string): boolean {
  return pass.startsWith(`${cardId}#verf:`);
}

/** What a purchase keeps of its pass once the pass itself is wiped (0241). */
export function passHash(pass: string): string {
  return createHash("sha256").update(pass, "utf8").digest("hex");
}

/** A pass a purchase at this gym was already charged with: Square charges a pass again under a new key (measured
 *  2026-11-14), so each is taken once. The unique index on `card_pass_hash` holds it too. */
async function passKept(tx: TransactionSql, gymId: string, pass: string): Promise<boolean> {
  const [row] = await tx<{ id: string }[]>`SELECT id FROM gym_app_payments WHERE gym_id = ${gymId} AND card_pass_hash = ${passHash(pass)} LIMIT 1`;
  return row !== undefined;
}

/** Whether the record's own card can pay for this repeating line now, on the sentence the screen showed: it has one, in
 *  date, not stopped by a decline that asked for a new card, its automatic payments not paused by staff or a chargeback,
 *  no other repeating membership of theirs still renewing, the sentence is the one worked out now, and the phone brings
 *  Square's pass for this very card, never used before (20i-ii). Under the gym's lock and the record's (the caller's). */
export async function cardCheckIn(
  tx: TransactionSql,
  c: { gymId: string; entryId: string; environment: SquareEnvironment; accountId: string; gymName: string; today: string; item: ForSaleItem; words: string; pass: string | null },
): Promise<CardCheck> {
  const card = await ownCardIn(tx, c.gymId, c.entryId, c.environment, c.accountId);
  if (card === null) return { kind: "card_needed" };
  if (cardExpired(card, c.today)) return { kind: "card_expired" };
  if (await cardStopped(tx, c.gymId, card.cardId)) return { kind: "card_stopped" };
  if ((await pausedOn(tx, c.gymId, c.entryId)) !== null || (await chargebackStopsPayer(tx, c.gymId, c.entryId))) return { kind: "card_paused" };
  const renewing = await renewingHeldName(tx, c.gymId, c.entryId, c.today);
  if (renewing !== null) return { kind: "renewing_held", name: renewing };
  if (repeatingChargeWords(c.gymName, card, c.item) !== c.words) return { kind: "card_changed" };
  // No pass, one not Square's for a saved card, or one used before: the bank's check is asked again. A pass for another
  // saved card: the card changed since.
  if (c.pass === null) return { kind: "verification" };
  if (!passFits(c.pass, card.cardId)) {
    const otherCard = c.pass.startsWith("ccof:") && c.pass !== card.cardId && !c.pass.startsWith(`${card.cardId}#`);
    return { kind: otherCard ? "card_changed" : "verification" };
  }
  if (await passKept(tx, c.gymId, c.pass)) return { kind: "verification" };
  return { kind: "ok", card };
}
