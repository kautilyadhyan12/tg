// A BUSINESS'S MEMBERSHIP AGREEMENT — ROADMAP Stage 2 item 18u-i; rulings/2026-10-23-18u-i.md.
//
// The business writes its own agreement in Settings; the words are its own, never ours. When
// a membership is given, staff hand the screen over and the person (or, for somebody under 18,
// a parent or guardian) reads the membership's details, which the app fills in, above the
// business's words, types their name and ticks. The signature keeps both word for word, and a
// copy is emailed to them.
//
// THE WORST THING: somebody held to a price or terms they never saw. So the details are worked
// out by the server from the membership itself (`agreementFacts`), the screen sends back the
// key of the details it showed, and a signature is written only where the server works out the
// same details again: what is kept and emailed is what the screen showed.
import { z } from "zod";
import { MEMBERSHIP_TYPES_MAX, formatMinor } from "./memberships.js";
import type { HeldMembershipItem } from "./heldMemberships.js";
import type { MemberBill, MemberBilling } from "./memberBills.js";
import { coversWords, dayWords } from "./paymentsDownload.js";
import { VISIBLE_TEXT } from "./visibleText.js";
import { deskSignerSchema, signedNameSchema, waiverTextSchema, waiverToReadSchema } from "./waiver.js";

export const AGREEMENT_FACTS_MAX = 30;
export const AGREEMENT_FACT_VALUE_MAX = 600;

/** One line of the details the app fills in: "Price" · "$50.00 every month". */
export const agreementFactSchema = z
  .object({ label: z.string().min(1).max(40), value: z.string().min(1).max(AGREEMENT_FACT_VALUE_MAX) })
  .strict();
export type AgreementFact = z.infer<typeof agreementFactSchema>;
export const agreementFactsSchema = z.array(agreementFactSchema).min(1).max(AGREEMENT_FACTS_MAX);

const factsKeySchema = z.string().regex(/^[0-9a-f]{64}$/);

// ── The business's side (Settings, `org.manage`) ──

export const saveGymAgreementBodySchema = z.object({ text: waiverTextSchema }).strict();
export type SaveGymAgreementBody = z.infer<typeof saveGymAgreementBodySchema>;

// Each line of the price list may have its own agreement (18u-ii-a): the business's main one is
// the default, and its others are named, each used for the lines it is ticked for.
export const AGREEMENT_NAME_MAX = 60;
/** The most lines of the price list one save ticks. */
export const AGREEMENT_USED_FOR_MAX = MEMBERSHIP_TYPES_MAX;
/** What Settings and the price list call the business's main agreement: the one every
 *  membership uses unless another agreement is chosen for it. */
export const MAIN_AGREEMENT_NAME = "Default agreement";
export const agreementNameSchema = z.string().trim().min(1).max(AGREEMENT_NAME_MAX).regex(VISIBLE_TEXT);

const savedWordingSchema = waiverToReadSchema.extend({ savedAt: z.string() }).strict();

/** One of the business's other agreements: its name, its newest wording, and how many
 *  memberships were signed with any of its wordings. */
export const otherAgreementSchema = z
  .object({ id: z.string().uuid(), name: z.string(), agreement: savedWordingSchema, inUse: z.boolean(), signed: z.number().int().min(0) })
  .strict();
export type OtherAgreement = z.infer<typeof otherAgreementSchema>;

/** A line of the price list in use, with the other agreement it uses; null is the main one. */
export const agreementPriceSchema = z.object({ id: z.string().uuid(), name: z.string(), agreementId: z.string().uuid().nullable() }).strict();
export type AgreementPrice = z.infer<typeof agreementPriceSchema>;

export const gymAgreementResponseSchema = z
  .object({
    /** The main agreement's newest wording, or null where the business never saved one. */
    agreement: savedWordingSchema.nullable(),
    /** Memberships are signed with it. False where there is none, or it was stopped. */
    inUse: z.boolean(),
    /** How many of its memberships were signed, with any of its wordings. */
    signed: z.number().int().min(0),
    /** The business's other agreements, by name. */
    others: z.array(otherAgreementSchema).default([]),
    /** The price list, for "Used for". */
    prices: z.array(agreementPriceSchema).default([]),
  })
  .strict();
export type GymAgreementResponse = z.infer<typeof gymAgreementResponseSchema>;

/** Add another agreement, or change one: its name, its words and the lines of the price list it
 *  is used for. A line not ticked on any of them uses the main agreement. `seen` is the price list
 *  as the screen showed it, each line with the agreement it used: where another member of staff
 *  has moved a line since, nothing is saved (`prices_changed`). */
export const saveOtherAgreementBodySchema = z
  .object({
    name: agreementNameSchema,
    text: waiverTextSchema,
    usedFor: z.array(z.string().uuid()).max(AGREEMENT_USED_FOR_MAX),
    seen: z.array(z.object({ id: z.string().uuid(), agreementId: z.string().uuid().nullable() }).strict()).max(AGREEMENT_USED_FOR_MAX),
  })
  .strict();
export type SaveOtherAgreementBody = z.infer<typeof saveOtherAgreementBodySchema>;

// ── One membership, at the desk (`members.confirm`) ──

/** A signature as staff see it: who signed and the name typed, when, the member of staff who
 *  opened the screen (null where they have since left), and what was signed, word for word. */
export const agreementSignedSchema = z
  .object({
    name: z.string(),
    signer: deskSignerSchema,
    at: z.string(),
    by: z.string().nullable(),
    version: z.number().int().min(1),
    text: z.string(),
    facts: agreementFactsSchema,
    /** When the copy last went to the person's email; null where it has not. */
    emailedAt: z.string().nullable(),
    /** The name of the other agreement it was signed with (18u-ii-a); null for the main one. */
    agreementName: z.string().nullable().default(null),
    /** Signed at the desk, or by the person from the emailed link (18u-ii-b). */
    via: z.enum(["desk", "link"]).default("desk"),
  })
  .strict();
export type AgreementSigned = z.infer<typeof agreementSignedSchema>;

export const membershipAgreementResponseSchema = z
  .object({
    gymName: z.string(),
    /** The person on the list, as the business wrote them. */
    personName: z.string(),
    timezone: z.string(),
    /** Under 18 by the record's date of birth on the business's own day; null with none. */
    minor: z.boolean().nullable(),
    /** The agreement the business asks for today for this membership's line of the price list,
     *  with its name (null for the main one); null where it asks for none. */
    agreement: waiverToReadSchema.extend({ name: z.string().nullable().default(null) }).strict().nullable(),
    /** This membership's details as they would be signed now, and their key; null where the
     *  membership is over or cancelled, or frozen, and cannot be signed. */
    facts: agreementFactsSchema.nullable(),
    factsKey: factsKeySchema.nullable(),
    /** This membership's signature, or null. */
    signed: agreementSignedSchema.nullable(),
    /** The record has an email address for the copy. */
    hasEmail: z.boolean(),
    /** The person is no longer on the business's list: what they signed is shown, and nothing is signed. */
    past: z.boolean().default(false),
  })
  .strict();
export type MembershipAgreementResponse = z.infer<typeof membershipAgreementResponseSchema>;

/** What the desk sends: the wording and the details it showed, who is signing and the name. */
export const signMembershipAgreementBodySchema = z
  .object({ agreementId: z.string().uuid(), factsKey: factsKeySchema, signer: deskSignerSchema, name: signedNameSchema })
  .strict();
export type SignMembershipAgreementBody = z.infer<typeof signMembershipAgreementBodySchema>;

/** What happened to the copy: sent, nowhere to send it, an address that refuses our email
 *  (it bounced, or its owner said stop), or the email did not go. */
export const agreementEmailedSchema = z.enum(["sent", "no_email", "blocked", "failed"]);
export type AgreementEmailed = z.infer<typeof agreementEmailedSchema>;

export const signMembershipAgreementResponseSchema = z.object({ signed: agreementSignedSchema, emailed: agreementEmailedSchema }).strict();
export type SignMembershipAgreementResponse = z.infer<typeof signMembershipAgreementResponseSchema>;

export const emailAgreementCopyResponseSchema = z.object({ emailed: agreementEmailedSchema, emailedAt: z.string().nullable() }).strict();
export type EmailAgreementCopyResponse = z.infer<typeof emailAgreementCopyResponseSchema>;

// ── Signing from afar: the emailed link (18u-ii-b) ──
//
// Staff email the record's address a link to its membership's agreement. The link opens a page
// of its own, with no sign-in, that reads the same details and words as the desk's box and signs
// with the same rule. Only the newest link of a membership works, until it is used, for
// AGREEMENT_LINK_DAYS days, and only while the record's email address is the one it was sent to.

export const AGREEMENT_LINK_DAYS = 14;

/** The token in the link: 32 random bytes, base64url. */
export const agreementLinkTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** A link that works today: when it was sent and until when it works. */
export const agreementLinkSchema = z.object({ sentAt: z.string(), expiresAt: z.string() }).strict();
export type AgreementLink = z.infer<typeof agreementLinkSchema>;

/** What Email a link to sign did: the same four outcomes as a copy, and the link that works now. */
export const sendAgreementLinkResponseSchema = z.object({ emailed: agreementEmailedSchema, link: agreementLinkSchema.nullable() }).strict();
export type SendAgreementLinkResponse = z.infer<typeof sendAgreementLinkResponseSchema>;

export const agreementLinkReadBodySchema = z.object({ token: agreementLinkTokenSchema }).strict();
export type AgreementLinkReadBody = z.infer<typeof agreementLinkReadBodySchema>;

/** The page the link opens: the agreement to sign; already signed; or closed, with why. */
export const agreementLinkResponseSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("open"),
      gymName: z.string(),
      personName: z.string(),
      /** Under 18 by the record's date of birth on the business's own day; null with none. */
      minor: z.boolean().nullable(),
      agreement: waiverToReadSchema.extend({ name: z.string().nullable() }).strict(),
      facts: agreementFactsSchema,
      factsKey: factsKeySchema,
      expiresAt: z.string(),
    })
    .strict(),
  z.object({ state: z.literal("signed"), gymName: z.string() }).strict(),
  z.object({ state: z.literal("closed"), gymName: z.string(), reason: z.enum(["expired", "not_signable", "not_in_use"]) }).strict(),
]);
export type AgreementLinkResponse = z.infer<typeof agreementLinkResponseSchema>;

/** The person signs from the link: the same as the desk sends, with the link's token. */
export const agreementLinkSignBodySchema = signMembershipAgreementBodySchema.extend({ token: agreementLinkTokenSchema }).strict();
export type AgreementLinkSignBody = z.infer<typeof agreementLinkSignBodySchema>;

export const agreementLinkSignResponseSchema = z.object({ emailed: agreementEmailedSchema }).strict();
export type AgreementLinkSignResponse = z.infer<typeof agreementLinkSignResponseSchema>;

export const AGREEMENT_WORDS = {
  /** The business saved new words after the screen loaded. */
  agreement_changed: (gymName: string): string => `${gymName} has changed its membership agreement. Read the new one below, then sign it.`,
  /** The business stopped using its agreement after the screen loaded. */
  agreement_not_in_use: (gymName: string): string => `${gymName} is not asking for a membership agreement right now. There is nothing to sign.`,
  /** The membership's details are not the ones the screen showed. */
  facts_changed: "The details of this membership have changed. Read them again below, then sign.",
  membership_not_found: "We couldn't find this membership.",
  /** Add another agreement, with a name another of the business's agreements has. */
  name_taken: (name: string): string => `You already have an agreement called ${name}. Give this one another name.`,
  /** "Used for" names a line of the price list that is not the business's, or is archived. */
  price_not_found: "One of the memberships you ticked is no longer on your price list. Check the list again, then save.",
  /** Another member of staff changed which memberships use which agreement after the screen loaded. */
  prices_changed: "The memberships for your agreements were changed by someone else. Check them again, then save.",
  /** Over, cancelled or frozen: nothing to sign now. */
  membership_not_signable: "This membership is over, cancelled or frozen, so it can't be signed now.",
  /** Email a copy, for a membership nobody has signed. */
  not_signed: "This membership's agreement hasn't been signed yet.",
  nothing_to_stop: "You have no membership agreement in use.",
  /** Email a link to sign, for a membership already signed. */
  already_signed: "This membership's agreement is already signed.",
  /** A link we did not make, one sent again since, or one whose address is no longer the record's. */
  link_not_valid: "This link isn't valid. If you copied it from an email, check that you copied all of it. If it still doesn't work, ask the business for a new link.",
  /** Signing from a link that has run out. */
  link_expired: (gymName: string): string => `This link has expired. Ask ${gymName} to send you a new one.`,
  not_found: "We couldn't find that.",
} as const;

/** The line beside the tick, the same on every screen that signs. */
export const AGREEMENT_AGREE_LABEL = "I have read this agreement and I agree to it.";

// ── The details the app fills in ──

export interface AgreementFactsInput {
  gym: { name: string; postalAddress: string | null; contactPhone: string | null; contactEmail: string | null };
  personName: string;
  membership: Pick<
    HeldMembershipItem,
    "typeName" | "kind" | "priceMinor" | "currency" | "termCount" | "termUnit" | "packClasses" | "startsOn" | "discount" | "tax" | "view"
  >;
  /** Its first bill, as opened with it (`firstBillOf`); null where it has none listed. */
  firstBill: Pick<MemberBill, "amountMinor" | "joiningFeeMinor" | "part" | "covers" | "dueOn"> | null;
  /** The business's prices hold the tax, or it is added on top. */
  taxIncluded: boolean;
}

const plural = (count: number, one: string): string => (count === 1 ? one : `${String(count)} ${one}s`);
const oneLine = (text: string): string => text.replace(/\s*\n\s*/g, ", ").replace(/\s+/g, " ").trim();

/** The tax as the price says it: ", GST 18% included" or ", plus GST 18%". */
function taxWords(tax: { name: string; bp: number } | null, included: boolean): string {
  if (tax === null) return "";
  const rate = `${tax.name} ${String(tax.bp / 100)}%`;
  return included ? `, ${rate} included` : `, plus ${rate}`;
}

function priceWords(m: AgreementFactsInput["membership"], taxIncluded: boolean): string {
  if (m.priceMinor === 0) return "Free";
  const price = formatMinor(m.priceMinor, m.currency);
  const tax = taxWords(m.tax, taxIncluded);
  if (m.kind === "recurring" && m.termCount !== null && m.termUnit !== null) return `${price} every ${plural(m.termCount, m.termUnit)}${tax}`;
  if (m.kind === "pack" && m.packClasses !== null) return `${price} for ${m.packClasses === 1 ? "1 class" : `${String(m.packClasses)} classes`}${tax}`;
  if (m.kind === "one_time") return `${price}, paid once${tax}`;
  return `${price}${tax}`;
}

/** The membership's details, in the order a person reads them. Worked out from the membership
 *  as stored, never from what a screen sends. */
export function agreementFacts(input: AgreementFactsInput): AgreementFact[] {
  const { gym, membership: m } = input;
  const facts: AgreementFact[] = [{ label: "Business", value: oneLine(gym.name) }];
  const address = gym.postalAddress === null ? "" : oneLine(gym.postalAddress);
  if (address !== "") facts.push({ label: "Address", value: address });
  if (gym.contactPhone !== null && gym.contactPhone.trim() !== "") facts.push({ label: "Phone", value: gym.contactPhone.trim() });
  if (gym.contactEmail !== null && gym.contactEmail.trim() !== "") facts.push({ label: "Email", value: gym.contactEmail.trim() });
  const person = oneLine(input.personName);
  if (person !== "") facts.push({ label: "Member", value: person });
  facts.push({ label: "Membership", value: oneLine(m.typeName) });
  facts.push({ label: "Price", value: priceWords(m, input.taxIncluded) });
  if (m.discount !== null) {
    const off = formatMinor(m.discount.offMinor, m.currency);
    facts.push({
      label: "Discount",
      value: m.discount.payments === "first" ? `${m.discount.name}: ${off} off the first payment` : `${m.discount.name}: ${off} off every payment, already taken off the price`,
    });
  }
  // The first bill, as opened with the membership: the part month, the joining fee and the tax in.
  const first = input.firstBill;
  if (first !== null && first.amountMinor > 0) {
    const amount = formatMinor(first.amountMinor, m.currency);
    const part = first.part && first.covers !== null ? ` for ${coversWords(first.covers.from, first.covers.to)}` : "";
    const fee = first.joiningFeeMinor > 0 ? `, including the joining fee of ${formatMinor(first.joiningFeeMinor, m.currency)}` : "";
    facts.push({ label: "First payment", value: `${amount}${part}${fee}, due ${dayWords(first.dueOn)}` });
  }
  facts.push({ label: "Starts", value: dayWords(m.startsOn) });
  const endsOn = m.view.endsOn;
  if (m.kind === "recurring") {
    if (endsOn === null && m.termCount !== null && m.termUnit !== null) facts.push({ label: "Renews", value: `Every ${plural(m.termCount, m.termUnit)} until you cancel` });
    else if (endsOn !== null) facts.push({ label: "Ends", value: dayWords(endsOn) });
  } else if (endsOn !== null) {
    facts.push({ label: m.kind === "pack" ? "Use by" : "Ends", value: dayWords(endsOn) });
  }
  return facts;
}

/** A membership's first bill among those listed: the one for its first period. */
export const firstBillOf = (billing: MemberBilling | null): MemberBill | null => billing?.bills.find((bill) => bill.periodIndex === 0) ?? null;

/** A membership can be signed while it is running or still to start. */
export const agreementSignable = (status: HeldMembershipItem["view"]["status"]): boolean => status === "active" || status === "upcoming";
