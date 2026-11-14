import { APP_PURCHASE_WORDS, PROMO_CODE_WORDS, cardName, coversWords, formatMinor, type AppPurchase, type AppPurchaseRequest, type DeskSigner, type ForSaleLine, type ForSaleResponse, type ForSaleSigner } from "@app/shared";
import { NOT_PAID, PAY_CHECK, PAY_NOT_OPENED, PAY_WAITING, type PaySaid } from "./payView";

// Buy in the app (ROADMAP Stage 5 item 20g; the server's `/for-sale` and `/for-sale/purchases`, built in 18k-iii). The
// gym's packs, day passes and memberships paid once that it sells in the app, each with what it gives; a line's page
// with every detail in the agreement's own words, the agreement to sign where the gym asks for one, and Pay on Square's
// own page. Pure: the server works out each line, what is paid today and how a page ended. A repeating membership (20i-i,
// the server's 18k-iv) is paid with the card saved in the app, on a tick of its own the server words: no page opens. A
// promo code typed on a line's page (20j, the server's 18k-v) reads the list again with it: each line it takes something
// off carries it, and Pay sends the code of the line shown with that line's amount, never the box's words.

const gymPath = (gymId: string): string => `/v1/orgs/${encodeURIComponent(gymId)}`;
export const forSalePath = (gymId: string): string => `${gymPath(gymId)}/for-sale`;
/** The list with its repeating memberships too, which this phone pays with the saved card (20i-i), and worked out with
 *  the promo code applied, if any (20j). */
export const forSaleListPath = (gymId: string, code = ""): string =>
  `${forSalePath(gymId)}?repeating=true${code === "" ? "" : `&code=${encodeURIComponent(code)}`}`;
export const purchasesPath = (gymId: string): string => `${forSalePath(gymId)}/purchases`;
export const purchaseClosePath = (gymId: string, purchaseId: string): string => `${purchasesPath(gymId)}/${encodeURIComponent(purchaseId)}/close`;

export const BUY = "Buy";
export const BUY_HEADING = "Memberships and packs";
export const BUY_SECURE = "Paid securely through Square.";
export const PAY_SECURE = "Secure checkout by Square";
export const TODAY_TITLE = "You pay today";
export const FACTS_HEADING = "The membership";
export const BUY_A_MEMBERSHIP = "Buy a membership";
export const VIEW_MEMBERSHIP = "View My membership";
export const TO_MEMBERSHIP = "Go to My membership";
export const PAID_TITLE = "Payment successful";
export const CANCELLED_TITLE = "Payment cancelled";
export const PENDING_TITLE = "Payment pending";
export const NOT_COMPLETED_TITLE = "Payment not completed";
export const CONFIRMING_TITLE = "Confirming your payment";
export const SHOW_PASS = "Show my pass";
export const PASS_LINE = "Show your pass at the front desk when you arrive.";
export const WHAT_YOU_GET = "What you get";
export const MY_PURCHASES = "My purchases and receipts";
export const WHO_SIGNS = "Who is signing?";
export const SIGNER_LABELS: Readonly<Record<DeskSigner, string>> = { person: "Me", guardian: "My parent or guardian" };
export const NOT_READY = "Type the full name and tick the box to pay.";
export const NOT_READY_WHO = "Choose who is signing, type the full name and tick the box to pay.";
/** A repeating membership with the gym's agreement: two ticks, the agreement's and the card's. */
export const NOT_READY_BOTH = "Type the full name and tick both boxes to pay.";
export const NOT_READY_WHO_BOTH = "Choose who is signing, type the full name and tick both boxes to pay.";
export const NOT_READY_CARD = "Tick the box to pay.";
export const PAID_WITH = "Paid with";
export const CHARGING = "Charging your card…";
/** Under Pay on a repeating membership: "Your Visa ending 1111 is charged through Square." */
export const chargedThrough = (card: { brand: string; last4: string }): string => `Your ${cardName(card)} is charged through Square.`;
/** The bank's check before Pay on a repeating membership (20i-ii): under Pay while Square checks, the box's title where the
 *  card's bank asks, and how a check that sent nothing ended. */
export const CHECKING_BANK = "Verifying with your bank…";
export const BANK_TITLE = "Verify your payment";
export const BANK_NO = "Your bank couldn’t verify this payment. You weren’t charged. Try again or update your card.";
export const BANK_CLOSED = "Payment cancelled. You weren’t charged.";
export const BANK_NOT_REACHED = "Couldn’t connect. You weren’t charged. Check your internet and try again.";
/** A card charge that ended with nothing taken, said after Check status. */
export const CARD_NOT_TAKEN = "Square didn’t take this payment, so nothing was charged.";

export const PROMO_LABEL = "Promo code";
export const PROMO_APPLY = "Apply";
export const PROMO_REMOVE = "Remove";
export const PROMO_CHECKING = "Checking your code…";
/** Under Pay while a code is typed and not applied: Pay waits, so nobody pays thinking a code came off. */
export const PROMO_PRESS_APPLY = "Press Apply to use your code, or clear the box.";
export const PROMO_NOT_CHECKED = "Couldn’t check the code. Check your internet and try again.";
/** A gym's codes are letters and numbers, at most 20 (the console's own rule). */
export const PROMO_MAX = 20;
/** The box's words as they are sent: in capitals, as the gym writes its codes. */
export const codeOf = (typed: string): string => typed.trim().toUpperCase();
/** Once a code takes something off: "SPRING20 applied". */
export const promoApplied = (code: string): string => `${code} applied`;
/** Under "You pay today": "SPRING20 · Spring offer: −$18.00". Null where no code is used on the line. A first payment
 *  for part of a month is worked out from the price with the code off, so it saves less than the code's own amount: the
 *  code is named with no amount (round one, H2). */
export function promoLine(line: Pick<ForSaleLine, "firstPayment" | "currency">): string | null {
  const p = line.firstPayment.promo;
  if (p === null) return null;
  if (line.firstPayment.part) return `${p.code} · ${p.name}`;
  // A word joiner keeps the minus with its amount, so a narrow line never breaks between them.
  return `${p.code} · ${p.name}: −\u2060${formatMinor(p.offMinor, line.currency)}`;
}
/** Where the code is used in place of the member's Refer a friend discount. */
export const PROMO_INSTEAD = PROMO_CODE_WORDS.instead;

/** What a screen reader says for Buy: "Buy 10-class pack, $90.00". */
export const buySay = (line: Pick<ForSaleLine, "name" | "priceMinor" | "currency">): string => `Buy ${line.name}, ${formatMinor(line.priceMinor, line.currency)}`;
/** "Pay $90.00". */
export const payLabel = (line: Pick<ForSaleLine, "firstPayment" | "currency">): string => `Pay ${formatMinor(line.firstPayment.amountMinor, line.currency)}`;

export const nothingForSale = (gym: string): string => `${gym} isn’t selling anything in the app right now. Ask at the front desk.`;
export const notSoldNow = (gym: string): string => `This isn’t sold in the app at ${gym} right now. Ask at the front desk.`;
export function couldNotLoadForSale(status: number | null, gym: string): string {
  return status === 404 ? `${gym} isn’t showing what it sells right now.` : "Couldn’t load what’s for sale. Check your internet and try again.";
}

const factOf = (line: Pick<ForSaleLine, "facts">, label: string): string | null => line.facts.find((f) => f.label === label)?.value ?? null;

/** Under a line's name: its price as its agreement words it ("$90.00 for 10 classes"), and until when it lasts ("Use by
 *  11 January 2027"), both read from the agreement's own lines. */
export function lineSummary(line: Pick<ForSaleLine, "facts" | "priceMinor" | "currency">): { price: string; until: string | null } {
  const price = factOf(line, "Price") ?? formatMinor(line.priceMinor, line.currency);
  const useBy = factOf(line, "Use by");
  const ends = factOf(line, "Ends");
  return { price, until: useBy !== null ? `Use by ${useBy}` : ends !== null ? `Ends ${ends}` : null };
}

const andList = (items: readonly string[]): string => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`);

/** What they pay today where it is not the price: "$145.00 today, with a $25.00 joining fee". Null where it is. */
export function todayLine(line: Pick<ForSaleLine, "firstPayment" | "priceMinor" | "currency">): string | null {
  const fp = line.firstPayment;
  if (fp.amountMinor === line.priceMinor) return null;
  const reasons: string[] = [];
  if (fp.joiningFeeMinor > 0) reasons.push(`a ${formatMinor(fp.joiningFeeMinor, line.currency)} joining fee`);
  if (fp.promo !== null) reasons.push(`the code ${fp.promo.code}`);
  if (fp.friendGift !== null || fp.memberGiftOffMinor > 0) reasons.push("your Refer a friend gift");
  // What those make up; anything else is tax added on top of the price (round one, L2). Part of a month is not the price
  // at all, so it says which days it pays for instead of guessing at tax (20j round one, H2).
  const explained = fp.joiningFeeMinor - (fp.friendGift?.offMinor ?? 0) - fp.memberGiftOffMinor - (fp.promo?.offMinor ?? 0);
  if (!fp.part && fp.amountMinor - line.priceMinor !== explained) reasons.push("tax");
  const span = fp.part && fp.covers !== null ? ` for ${coversWords(fp.covers.from, fp.covers.to)}` : "";
  const today = `${formatMinor(fp.amountMinor, line.currency)} today${span}`;
  return reasons.length === 0 ? today : `${today}, with ${andList(reasons)}`;
}

/** Under "You pay today": the price and the joining fee, where those two alone make the amount. */
export function todayParts(line: Pick<ForSaleLine, "firstPayment" | "priceMinor" | "currency">): string | null {
  const fp = line.firstPayment;
  if (fp.joiningFeeMinor === 0 || line.priceMinor + fp.joiningFeeMinor !== fp.amountMinor) return null;
  return `${formatMinor(line.priceMinor, line.currency)} + ${formatMinor(fp.joiningFeeMinor, line.currency)} joining fee`;
}

/** Who signs, where the server already knows (by the record's date of birth); null where they choose. */
export const signerOf = (signer: ForSaleSigner): DeskSigner | null => (signer === "either" ? null : signer);
export const nameLabel = (signer: DeskSigner | null): string => (signer === "guardian" ? "Parent or guardian’s full name" : "Full name");
/** Above the name, for somebody under 18. */
export const GUARDIAN_LINE = APP_PURCHASE_WORDS.guardian_needed;

/** What Pay sends but its key: the line, what its list showed (today's amount and the key of its details) and, where the
 *  gym asks for its agreement, the wording read, who signed and the name typed. The promo code is the line's own, the one
 *  its amount was worked out with (20j): a line read without one sends none. */
export function buyBody(
  line: Pick<ForSaleLine, "typeId" | "firstPayment" | "factsKey" | "agreement" | "repeats" | "charge">,
  sign: { signer: DeskSigner; name: string } | null,
): Omit<AppPurchaseRequest, "requestKey"> {
  return {
    typeId: line.typeId,
    amountMinor: line.firstPayment.amountMinor,
    factsKey: line.factsKey,
    agreement: line.agreement === null || sign === null ? null : { agreementId: line.agreement.id, signer: sign.signer, name: sign.name },
    // A repeating membership: the card's tick word for word as the server sent it. Square's pass from the bank's check is
    // added by Pay once the check ends (20i-ii).
    ...(line.repeats && line.charge !== null ? { charge: { words: line.charge, verificationToken: null } } : {}),
    ...(line.firstPayment.promo === null ? {} : { code: line.firstPayment.promo.code }),
  };
}

/** How a repeating membership is paid, for the reader: on their card (with its tick), or what stands in the way first. A
 *  line paid once is `page`, Square's own page. */
export type PaidHow =
  | { kind: "page" }
  | { kind: "card"; card: { brand: string; last4: string }; words: string }
  | { kind: "no_record"; line: string }
  | { kind: "add_card"; line: string }
  | { kind: "update_card"; line: string }
  /** A card in date and no tick from the server: what was read no longer fits together. */
  | { kind: "changed"; line: string };

export function paidHow(line: Pick<ForSaleLine, "repeats" | "charge">, view: Pick<ForSaleResponse, "record" | "card">): PaidHow {
  if (!line.repeats) return { kind: "page" };
  if (view.record !== "own") return { kind: "no_record", line: APP_PURCHASE_WORDS.card_no_record };
  if (view.card === null) return { kind: "add_card", line: APP_PURCHASE_WORDS.card_needed };
  if (view.card.expired) return { kind: "update_card", line: APP_PURCHASE_WORDS.card_expired };
  if (line.charge === null) return { kind: "changed", line: APP_PURCHASE_WORDS.card_changed };
  return { kind: "card", card: { brand: view.card.brand, last4: view.card.last4 }, words: line.charge };
}

/** Under Pay while it cannot be pressed yet: what is still to do. */
export function notReadyLine(agreement: boolean, card: boolean, signerKnown: boolean): string {
  if (!agreement) return NOT_READY_CARD;
  if (!card) return signerKnown ? NOT_READY : NOT_READY_WHO;
  return signerKnown ? NOT_READY_BOTH : NOT_READY_WHO_BOTH;
}

/** "$15.00 paid. Day pass is yours.", where whether an agreement was signed is not known here. */
export const paidShortLine = (p: Pick<AppPurchase, "amountMinor" | "currency" | "name">): string => `${formatMinor(p.amountMinor, p.currency)} paid. ${p.name} is yours.`;

/** What a line gives, in the order a member reads it: what the price list says it includes, how many classes and until
 *  when, then the gym's own description. */
export function whatYouGet(line: Pick<ForSaleLine, "includes" | "facts" | "priceMinor" | "currency" | "description">): string[] {
  const summary = lineSummary(line);
  const out = [...line.includes, summary.price, ...(summary.until === null ? [] : [summary.until])];
  const d = line.description?.trim() ?? "";
  return d === "" ? out : [...out, d];
}

export interface BuySaid extends PaySaid {
  /** How a page ended, or that Square has not said: shown in the box in the middle of the screen. */
  ended?: boolean;
  /** A Go to My membership button in place of Pay: what stands in the way is paid there. */
  toMembership?: boolean;
  /** What was shown has changed: the list is read again. */
  reread?: boolean;
  /** An Update card button beside it: the card is what stands in the way. */
  updateCard?: boolean;
}

/** How a page ended that was not paid; null while Square has not said, and for paid, which the page says in full. */
export function endedBuySaid(p: Pick<AppPurchase, "state">, card = false): BuySaid | null {
  switch (p.state) {
    case "closed":
      // A card charged has no page to cancel: closed is Square taking nothing (20i-i).
      return card ? { tone: "bad", line: CARD_NOT_TAKEN, ended: true } : { tone: "plain", line: NOT_PAID, ended: true };
    case "check":
      return { tone: "warn", line: PAY_CHECK, ended: true };
    case "open":
      return { tone: "warn", line: PAY_WAITING, again: true, ended: true };
    case "paid":
      return null;
  }
}

const REREAD = new Set([
  "app_payment_changed",
  "app_payment_not_found",
  "agreement_changed",
  "guardian_needed",
  "person_signs",
  // The card or the payments changed, or the card is gone: the list names the card now (20i-i).
  "app_purchase_card_changed",
  "app_purchase_card_needed",
  "app_purchase_card_expired",
  // The code can't be used now (its last use taken, or it ended at midnight): the list says why, without it (20j).
  "app_purchase_promo",
]);
/** How a bank's check that sent nothing ended (20i-ii), beside Pay. */
export function bankSaid(outcome: "bank_no" | "closed" | "not_reached"): BuySaid {
  if (outcome === "bank_no") return { tone: "bad", line: BANK_NO, updateCard: true };
  if (outcome === "closed") return { tone: "warn", line: BANK_CLOSED };
  return { tone: "bad", line: BANK_NOT_REACHED };
}

/** Pay's body with Square's pass from the bank's check (20i-ii). */
export function withPass(body: Omit<AppPurchaseRequest, "requestKey">, pass: string): Omit<AppPurchaseRequest, "requestKey"> {
  return body.charge === undefined ? body : { ...body, charge: { ...body.charge, verificationToken: pass } };
}

/** The card is what stands in the way: Update card beside the words. */
const UPDATE_CARD_CODES = new Set(["app_purchase_declined", "app_purchase_card_stopped", "app_purchase_card_expired"]);

/** A refused Pay, in the member's words: the server's own, written for the member. What changed reads the list again; money
 *  owed here is paid on My membership. */
export function buyRefusalSaid(code: string, serverWords: string): BuySaid {
  const line = serverWords === "" ? PAY_NOT_OPENED : serverWords;
  if (REREAD.has(code)) return { tone: "warn", line, reread: true, ...(UPDATE_CARD_CODES.has(code) ? { updateCard: true } : {}) };
  if (UPDATE_CARD_CODES.has(code)) return { tone: "bad", line, updateCard: true };
  if (code === "app_purchase_owed") return { tone: "bad", line, toMembership: true };
  if (code === "app_payment_check") return { tone: "warn", line };
  return { tone: "bad", line };
}
