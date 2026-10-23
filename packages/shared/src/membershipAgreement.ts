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
import { formatMinor } from "./memberships.js";
import type { HeldMembershipItem } from "./heldMemberships.js";
import type { MemberBill, MemberBilling } from "./memberBills.js";
import { coversWords, dayWords } from "./paymentsDownload.js";
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

export const gymAgreementResponseSchema = z
  .object({
    /** The newest wording the business saved, or null where it never saved one. */
    agreement: waiverToReadSchema.extend({ savedAt: z.string() }).strict().nullable(),
    /** Memberships are signed with it. False where there is none, or it was stopped. */
    inUse: z.boolean(),
    /** How many memberships were signed with the newest wording. */
    signed: z.number().int().min(0),
  })
  .strict();
export type GymAgreementResponse = z.infer<typeof gymAgreementResponseSchema>;

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
    /** The agreement the business asks for today, or null where it asks for none. */
    agreement: waiverToReadSchema.nullable(),
    /** This membership's details as they would be signed now, and their key; null where the
     *  membership is over or cancelled, or frozen, and cannot be signed. */
    facts: agreementFactsSchema.nullable(),
    factsKey: factsKeySchema.nullable(),
    /** This membership's signature, or null. */
    signed: agreementSignedSchema.nullable(),
    /** The record has an email address for the copy. */
    hasEmail: z.boolean(),
  })
  .strict();
export type MembershipAgreementResponse = z.infer<typeof membershipAgreementResponseSchema>;

/** What the desk sends: the wording and the details it showed, who is signing and the name. */
export const signMembershipAgreementBodySchema = z
  .object({ agreementId: z.string().uuid(), factsKey: factsKeySchema, signer: deskSignerSchema, name: signedNameSchema })
  .strict();
export type SignMembershipAgreementBody = z.infer<typeof signMembershipAgreementBodySchema>;

/** What happened to the copy: sent, nowhere to send it, or the email did not go. */
export const agreementEmailedSchema = z.enum(["sent", "no_email", "failed"]);
export type AgreementEmailed = z.infer<typeof agreementEmailedSchema>;

export const signMembershipAgreementResponseSchema = z.object({ signed: agreementSignedSchema, emailed: agreementEmailedSchema }).strict();
export type SignMembershipAgreementResponse = z.infer<typeof signMembershipAgreementResponseSchema>;

export const emailAgreementCopyResponseSchema = z.object({ emailed: agreementEmailedSchema, emailedAt: z.string().nullable() }).strict();
export type EmailAgreementCopyResponse = z.infer<typeof emailAgreementCopyResponseSchema>;

export const AGREEMENT_WORDS = {
  /** The business saved new words after the screen loaded. */
  agreement_changed: (gymName: string): string => `${gymName} has changed its membership agreement. Read the new one below, then sign it.`,
  /** The business stopped using its agreement after the screen loaded. */
  agreement_not_in_use: (gymName: string): string => `${gymName} is not asking for a membership agreement right now. There is nothing to sign.`,
  /** The membership's details are not the ones the screen showed. */
  facts_changed: "The details of this membership have changed. Read them again below, then sign.",
  membership_not_found: "We couldn't find this membership.",
  /** Over, cancelled or frozen: nothing to sign now. */
  membership_not_signable: "This membership is over, cancelled or frozen, so it can't be signed now.",
  /** Email a copy, for a membership nobody has signed. */
  not_signed: "This membership's agreement hasn't been signed yet.",
  nothing_to_stop: "You have no membership agreement in use.",
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
