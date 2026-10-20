// A member's card on file, saved on Square's own form (ROADMAP 18d-ii; spec Part 3 §14.5;
// rulings/2026-10-20-18d-ii.md). The card number goes from the browser or the phone to Square
// and never reaches our server: we keep Square's ids and what a screen shows (brand, last
// four, expiry). One card a person, a new one replacing the old. The person ticks the
// agreement themselves, and its words, time and screen are kept. Only staff holding the
// payments tick (`billing.members`) see the card and remove it; a member adds or updates
// their own in the app.
import { z } from "zod";
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
  return { givenName: words.slice(0, -1).join(" "), familyName: words[words.length - 1] ?? "" };
}

export const memberCardSchema = z
  .object({
    brand: z.string().regex(/^[A-Z_]{1,40}$/),
    last4: z.string().regex(/^[0-9]{4}$/),
    expMonth: z.number().int().min(1).max(12),
    expYear: z.number().int().min(2000).max(2200),
    /** Past its expiry month, on the gym's day. */
    expired: z.boolean(),
    savedAt: z.string().datetime(),
    /** `desk`: on staff's screen; `app`: the member's own. */
    savedFrom: z.enum(["desk", "app"]),
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
export const memberCardViewSchema = z
  .object({
    state: memberCardStateSchema,
    /** Null for none, and for a card in a Square account the gym is no longer connected to. */
    card: memberCardSchema.nullable(),
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
  })
  .strict();
export type MemberCardView = z.infer<typeof memberCardViewSchema>;

export const memberCardResponseSchema = z.object({ cardOnFile: memberCardViewSchema }).strict();
export type MemberCardResponse = z.infer<typeof memberCardResponseSchema>;

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
  not_ready: "Square isn't ready to save cards for your gym. The owner can finish connecting Square in Settings.",
  declined: "The bank didn't accept this card. Try another card.",
  invalid: "Square couldn't read this card. Check the number, expiry date and security code, then try again.",
  verification: "The bank needs to check this card. Type the card again and follow the bank's steps.",
  form_expired: "The card form ran out. Type the card again.",
  processing_off: "Your Square location can't take cards yet. The owner can check it in Square.",
  connection_refused: "Square didn't accept your gym's connection. The owner can connect Square again in Settings.",
  square_unavailable: "Square didn't answer. Nothing was changed. Try again in a minute.",
  customer_gone: "Square no longer has this person in your customers. Type the card again to save it.",
  contact_refused: "Square didn't accept this person's email address or phone number. Check them with Edit, then try again.",
  expired: "This card has expired. Try another card.",
  not_supported: "This kind of card can't be saved here. Try another card.",
  not_saved: "Square didn't save this card. Try again, or try another card.",
  not_your_card: "Your gym hasn't linked your app to your membership yet. Ask at the front desk.",
  not_taken: "Your gym can't save cards right now.",
  no_card: "There's no card on file to remove.",
} as const;

/** "Card on file: Visa ending 1111 · expires 12/2028", from a card as the server sends it. */
export function cardOnFileLine(card: { brand: string; last4: string; expMonth: number; expYear: number; expired: boolean }): string {
  const when = `${String(card.expMonth).padStart(2, "0")}/${String(card.expYear)}`;
  return `${MEMBER_CARD_WORDS.title}: ${cardName(card)} · ${card.expired ? "expired" : "expires"} ${when}`;
}

/** "Priya Sharma pays for Aarav Sharma, so Priya Sharma's card is used." */
export function cardPaidByLine(payer: string, person: string): string {
  return `${payer} pays for ${person}, so ${payer}'s card is used.`;
}

/** "Only the owner of Iron House can connect Square." */
export function cardOwnerOnlyLine(gymName: string): string {
  return `Only the owner of ${gymName} can connect Square.`;
}
