// A member's card on file, saved on Square's own form (ROADMAP 18d-ii; spec Part 3 §14.5;
// rulings/2026-10-20-18d-ii.md). The card number goes from the browser or the phone to Square
// and never reaches our server: we keep Square's ids and what a screen shows (brand, last
// four, expiry). One card a person, a new one replacing the old. The person ticks the
// agreement themselves, and its words, time and screen are kept. Only staff holding the
// payments tick (`billing.members`) see the card and remove it; a member adds or updates
// their own in the app.
import { z } from "zod";
import { SQUARE_TERMINALS_MAX, squarePracticeTerminalSchema } from "./gymPayments.js";
import { squareCardSourceSchema, squareObjectIdSchema } from "./square.js";

/** Square's card brands (its `CardBrand`), as a card names itself. Any other is a "Card". */
const BRAND_WORDS: Readonly<Record<string, string>> = {
  VISA: "Visa",
  MASTERCARD: "Mastercard",
  AMERICAN_EXPRESS: "American Express",
  DISCOVER: "Discover",
  DISCOVER_DINERS: "Diners Club",
  JCB: "JCB",
  CHINA_UNIONPAY: "UnionPay",
  INTERAC: "Interac",
  EFTPOS: "eftpos",
  FELICA: "FeliCa",
  EBT: "EBT",
};

export function cardBrandWords(brand: string): string {
  return BRAND_WORDS[brand] ?? "Card";
}

/** "Visa ending 1111". */
export function cardName(card: { brand: string; last4: string }): string {
  return `${cardBrandWords(card.brand)} ending ${card.last4}`;
}

/** A card can be used to the end of its expiry month. `today` is the gym's day, "YYYY-MM-DD". */
export function cardExpired(card: { expMonth: number; expYear: number }, today: string): boolean {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return card.expYear < year || (card.expYear === year && card.expMonth < month);
}

/** Its last month is the gym's month now (18d-iii-c): the month its holder is reminded in. */
export function cardExpiresThisMonth(card: { expMonth: number; expYear: number }, today: string): boolean {
  return card.expYear === Number(today.slice(0, 4)) && card.expMonth === Number(today.slice(5, 7));
}

/** "expires 12/2028", or "expired 12/2025" once that month is over. */
export function cardExpiryWords(card: { expMonth: number; expYear: number }, today: string): string {
  const when = `${String(card.expMonth).padStart(2, "0")}/${String(card.expYear)}`;
  return cardExpired(card, today) ? `expired ${when}` : `expires ${when}`;
}

/** What the person ticks before their card is saved (Kd, 2026-10-20): it takes the place of
 *  Square's own signed form, and is kept word for word with the time and the screen. */
export function cardAgreementWords(gymName: string): string {
  return `I agree that ${gymName} may save this card and charge it for my membership and any fees when they are due. I can remove it at the front desk at any time.`;
}

/** A full name as Square's given and family names: the last word is the family name, as gym
 *  software importing one name box does. One word is a given name alone. */
export function cardNameParts(fullName: string): { givenName: string; familyName: string } {
  const words = fullName.trim().split(/\s+/).filter((w) => w !== "");
  if (words.length <= 1) return { givenName: words[0] ?? "", familyName: "" };
  // A generation word stays with the family name: "John Smith Jr" is John, Smith Jr (18d-iii-b-ii-b-i).
  const family = words.length >= 3 && /^(jr|sr|ii|iii|iv|junior|senior)\.?$/i.test(words[words.length - 1] ?? "") ? 2 : 1;
  return { givenName: words.slice(0, -family).join(" "), familyName: words.slice(-family).join(" ") };
}

export const memberCardSchema = z
  .object({
    brand: z.string().regex(/^[A-Z_]{1,40}$/),
    last4: z.string().regex(/^[0-9]{4}$/),
    expMonth: z.number().int().min(1).max(12),
    expYear: z.number().int().min(2000).max(2200),
    /** Past its expiry month, on the gym's day. */
    expired: z.boolean(),
    /** In its expiry month, on the gym's day (18d-iii-c). */
    expiresThisMonth: z.boolean(),
    /** The reminder emailed this month to the cardholder (18d-iii-c), where the gym sends them:
     *  `sending`, `emailed` on `expiryReminderOn`, `maybe_emailed` (the email service never
     *  confirmed it), `no_email` (none on their record, the card paying for a renewal) or
     *  `not_sent`. Null where none was written. */
    expiryReminder: z.enum(["sending", "emailed", "maybe_emailed", "no_email", "not_sent"]).nullable(),
    expiryReminderOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    savedAt: z.string().datetime(),
    /** `desk`: on staff's screen; `app`: the member's own; `terminal`: on the gym's Square
     *  Terminal (18d-ii-b-ii). */
    savedFrom: z.enum(["desk", "app", "terminal"]),
  })
  .strict();
export type MemberCard = z.infer<typeof memberCardSchema>;

/** Where cards can be saved for this gym. `not_offered`: not one of Square's countries, or
 *  Square is not set up on this server: nothing is shown. `connect`: Square's country, and
 *  Square is not connected (or the gym took it off inside Square). `choose_location`: the
 *  owner is still to say which Square location the gym is. */
export const memberCardStateSchema = z.enum(["ready", "connect", "choose_location", "not_offered"]);
export type MemberCardState = z.infer<typeof memberCardStateSchema>;

/** What Square's own form needs: our app's public id, the gym's Square location, and the
 *  person, for the bank's check where the country requires one. */
export const cardFormSchema = z
  .object({
    environment: z.enum(["sandbox", "production"]),
    applicationId: z.string().regex(/^(sandbox-)?sq0id[bp]-[A-Za-z0-9_-]{10,60}$/),
    locationId: squareObjectIdSchema,
    contact: z
      .object({
        givenName: z.string().max(120),
        familyName: z.string().max(120),
        email: z.string().max(254).nullable(),
        countryCode: z.string().regex(/^[A-Z]{2}$/),
      })
      .strict(),
  })
  .strict();
export type CardForm = z.infer<typeof cardFormSchema>;

/** Card on file, on a person's page, for staff holding the payments tick. */
/** A card saved on a Square account the gym is no longer connected to: after a hand-over to a
 *  new owner, or another account connected since (Kd, 2026-10-20, `rulings/2026-10-20-4b-v.md`).
 *  It stays in that account and is never charged from here: the person is asked to add their
 *  card again. */
const earlierCardSchema = z.object({ brand: z.string().regex(/^[A-Z_]{1,40}$/), last4: z.string().regex(/^[0-9]{4}$/) }).strict();

// SAVE CARD ON TERMINAL (ROADMAP 18d-ii-b-ii; rulings/2026-10-21-18d-ii-b.md): staff press it on a
// person's page, the person reads the agreement on the gym's Square Terminal and taps I agree,
// then inserts or swipes their card there, and Square saves it on them. Typing the card (above)
// stays.

/** A Terminal a card can be saved on: a real one by its serial number, or one of Square's
 *  simulated Terminals in its sandbox. */
export const cardTerminalSchema = z
  .object({
    id: z.string().uuid(),
    serial: z.string().max(100).nullable(),
    practice: squarePracticeTerminalSchema.nullable(),
  })
  .strict();
export type CardTerminal = z.infer<typeof cardTerminalSchema>;

/** Why a save on a Terminal ended. `not_agreed`: the person didn't tap I agree;
 *  `cancelled_on_terminal`: they cancelled there; `timed_out`: Square's time on the Terminal ran
 *  out; `no_answer`: the Terminal never showed it (off, or offline); `cancelled`: staff pressed
 *  Cancel; `refused`: Square refused; `gone`: the record, its payer or the gym's Square
 *  connection changed meanwhile, so nothing was kept. */
/** `merged_away`: Square saved the card on a customer it had merged the person into, another person's, so it was let
 *  go (18d-iii-b-ii-b-ii-a). */
export const terminalSaveOutcomeSchema = z.enum(["saved", "not_agreed", "cancelled_on_terminal", "timed_out", "no_answer", "cancelled", "refused", "gone", "merged_away"]);
export type TerminalSaveOutcome = z.infer<typeof terminalSaveOutcomeSchema>;

export const terminalSaveSchema = z
  .object({
    id: z.string().uuid(),
    /** `agree`: waiting for I agree; `card`: waiting for the card; `done`: see `outcome`. */
    step: z.enum(["agree", "card", "done"]),
    outcome: terminalSaveOutcomeSchema.nullable(),
    /** The Terminal has the step on its screen (Square no longer reads it as pending). */
    pickedUp: z.boolean(),
    /** Cancel was pressed and Square has not stopped it yet. */
    stopping: z.boolean(),
    /** Square refused Cancel: the person had confirmed on the Terminal, and the card goes in. */
    tooLate: z.boolean(),
    /** How the card goes in: inserted or swiped in the US, swiped only in Canada and Australia
     *  (Square's "Save a Card on File with the Terminal API", read 2026-10-21). */
    entry: z.enum(["insert_or_swipe", "swipe"]),
    /** Null once the gym has removed the Terminal. */
    terminal: cardTerminalSchema.nullable(),
    startedAt: z.string().datetime(),
  })
  .strict();
export type TerminalSave = z.infer<typeof terminalSaveSchema>;

export const memberCardViewSchema = z
  .object({
    state: memberCardStateSchema,
    /** Null for none, and for a card in a Square account the gym is no longer connected to. */
    card: memberCardSchema.nullable(),
    earlierCard: earlierCardSchema.nullable(),
    /** Somebody else on the list pays for this person (18i): that person's card is used. */
    paidBy: z.object({ entryId: z.string().uuid(), name: z.string().max(120) }).strict().nullable(),
    /** One app account of their own holds the record: they can add a card in the app. */
    inApp: z.boolean(),
    /** Add, replace and remove: the gym is on a live plan and Square is ready. */
    canChange: z.boolean(),
    /** The gym's own owner, who alone connects Square. */
    isOwner: z.boolean(),
    gymName: z.string().max(200),
    agreement: z.string().max(600),
    /** Square's form, when a card can be added for this person now. */
    form: cardFormSchema.nullable(),
    /** The gym's Square Terminals a card can be saved on for this person now: empty unless one
     *  is paired and a card can be added. */
    terminals: z.array(cardTerminalSchema).max(SQUARE_TERMINALS_MAX),
    /** The owner, where Square saves cards on a Terminal, with none paired: Pair a Terminal. */
    pairTerminal: z.boolean(),
    /** A save waiting at a Terminal for this person, from this page or another. */
    terminalSave: terminalSaveSchema.nullable(),
  })
  .strict();
export type MemberCardView = z.infer<typeof memberCardViewSchema>;

export const memberCardResponseSchema = z.object({ cardOnFile: memberCardViewSchema }).strict();
export type MemberCardResponse = z.infer<typeof memberCardResponseSchema>;

/** Save card on Terminal. `requestKey`: the same press sent twice is one save. */
export const terminalSaveRequestSchema = z.object({ terminalId: z.string().uuid(), requestKey: z.string().uuid() }).strict();
export type TerminalSaveRequest = z.infer<typeof terminalSaveRequestSchema>;

/** Where a save on a Terminal stands, and Card on file as it is now. */
export const terminalSaveResponseSchema = z.object({ save: terminalSaveSchema, cardOnFile: memberCardViewSchema }).strict();
export type TerminalSaveResponse = z.infer<typeof terminalSaveResponseSchema>;

/** Save card: what Square's form handed back, and the agreement as the person read it and
 *  ticked it. `requestKey` is Square's idempotency key: the same press sent twice saves once. */
export const saveCardRequestSchema = z
  .object({
    sourceId: squareCardSourceSchema,
    agreed: z.literal(true),
    agreement: z.string().min(1).max(600),
    requestKey: z.string().uuid(),
  })
  .strict();
export type SaveCardRequest = z.infer<typeof saveCardRequestSchema>;

/** The member's own card, for the phone (Stage 5 item 20). `record` as My membership's: only
 *  "own" carries a card. */
export const myCardViewSchema = z
  .object({
    record: z.enum(["own", "none", "shared"]),
    state: memberCardStateSchema,
    card: memberCardSchema.nullable(),
    earlierCard: earlierCardSchema.nullable(),
    /** The name of whoever pays for them: that person's card is used. */
    paidBy: z.string().max(120).nullable(),
    canSave: z.boolean(),
    gymName: z.string().max(200),
    agreement: z.string().max(600),
    form: cardFormSchema.nullable(),
  })
  .strict();
export type MyCardView = z.infer<typeof myCardViewSchema>;

export const myCardResponseSchema = z.object({ myCard: myCardViewSchema }).strict();
export type MyCardResponse = z.infer<typeof myCardResponseSchema>;

/** The words the server answers with, and the box's own. */
export const MEMBER_CARD_WORDS = {
  title: "Card on file",
  none: "No card on file",
  connect: "Connect Square to save a card.",
  choose_location: "Choose your Square location to save a card.",
  not_agreed: "The box must be ticked to agree before the card is saved.",
  agreement_changed: "The words to agree to have changed. Read them again, then tick the box.",
  not_ready: "Square isn't ready to save cards here yet. The owner can finish connecting Square in Settings.",
  declined: "The bank didn't accept this card. Try another card.",
  invalid: "Square couldn't read this card. Check the number, expiry date and security code, then try again.",
  verification: "The bank needs to check this card. Type the card again and follow the bank's steps.",
  form_expired: "The card form ran out. Type the card again.",
  processing_off: "Your Square location can't take cards yet. The owner can check it in Square.",
  connection_refused: "Square didn't accept the connection to your Square account. The owner can connect Square again in Settings.",
  square_unavailable: "Square didn't answer. Nothing was changed. Try again in a minute.",
  customer_gone: "Square no longer has this person in your customers. Type the card again to save it.",
  /** Square had merged the person into another customer (18d-iii-b-ii-b-ii-a, round one, High 2). */
  merged_away: "In Square, this person had been merged with another customer, so the card wasn't saved. Type the card again to save it.",
  /** Their Square customer was unlinked from them while the card was being saved (18d-iii-b-ii-c-ii). */
  unlinked: "Their Square customer was unlinked from them while the card was being saved, so the card wasn't saved. Type the card again to save it.",
  contact_refused: "Square didn't accept this person's email address or phone number. Check them with Edit, then try again.",
  expired: "This card has expired. Try another card.",
  not_supported: "This kind of card can't be saved here. Try another card.",
  not_saved: "Square didn't save this card. Try again, or try another card.",
  not_your_card: "Your app isn't linked to your membership yet. Ask at the front desk.",
  not_taken: "Cards can't be saved here right now.",
  no_card: "There's no card on file to remove.",
  terminal_gone: "This Terminal is no longer paired. Choose another, or type the card instead.",
  terminal_busy: "This Terminal is busy. Try again in a minute, or choose another Terminal.",
  terminal_refused: "Square couldn't send this to the Terminal. Check it's on and signed in, then try again.",
  terminal_save_gone: "This save is no longer active.",
} as const;

/** What the Terminal shows (ConfirmationOptions: a title, the agreement, two buttons). The body
 *  is `cardAgreementWords`, word for word, as on the typed form. */
export const TERMINAL_AGREEMENT = { title: "Save your card", agree: "I agree", disagree: "I don't agree" } as const;

/** "Card on file: Visa ending 1111 · expires 12/2028", from a card as the server sends it. */
export function cardOnFileLine(card: { brand: string; last4: string; expMonth: number; expYear: number; expired: boolean }): string {
  const when = `${String(card.expMonth).padStart(2, "0")}/${String(card.expYear)}`;
  return `${MEMBER_CARD_WORDS.title}: ${cardName(card)} · ${card.expired ? "expired" : "expires"} ${when}`;
}

/** "Priya Sharma pays for Aarav Sharma, so Priya Sharma's card is used." */
export function cardPaidByLine(payer: string, person: string): string {
  return `${payer} pays for ${person}, so ${payer}'s card is used.`;
}

/** "Visa ending 1111 was saved with the Square account Iron House used before. Add the card
 *  again." */
export function cardEarlierLine(card: { brand: string; last4: string }, gymName: string): string {
  return `${cardName(card)} was saved with the Square account ${gymName} used before. Add the card again.`;
}

/** "Only the owner of Iron House can connect Square." */
export function cardOwnerOnlyLine(gymName: string): string {
  return `Only the owner of ${gymName} can connect Square.`;
}
