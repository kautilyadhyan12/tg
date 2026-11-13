// PAYMENTS TO CHECK IN SQUARE, ON OVERVIEW (ROADMAP 18k-vi; Kd, rulings/2026-11-12-20g.md): every payment or purchase in the
// app that Square may have taken and that is on no bill or gave nothing, as the person's page says it, with a button to them.
// The rows are the person's page's own: a bill's while that bill is owed, a fee's while it is owed, a purchase's until it is
// marked as checked.
import { z } from "zod";
import { appCheckLine } from "./appPayments.js";
import { appBuyCheckLine } from "./appPurchases.js";
import { MEMBER_FEE_WORDS, memberFeeKindSchema } from "./memberBills.js";
import { dayWords } from "./paymentsDownload.js";

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The people read at most, the newest first: beyond them the card says there are more. */
export const APP_PAYMENT_CHECKS_PEOPLE = 100;
/** Rows drawn at first, and added by each Show more. */
export const APP_PAYMENT_CHECKS_SHOWN = 10;

export const appPaymentCheckRowSchema = z
  .object({
    /** The row's own key: the purchase's id, or the bill's or fee's. */
    id: z.string().min(1).max(80),
    entryId: z.uuid(),
    /** Their name on the gym's list. */
    name: z.string(),
    past: z.boolean(),
    kind: z.enum(["bill", "fee", "purchase"]),
    /** The membership the bill or fee is on, or the line bought. */
    typeName: z.string(),
    fee: memberFeeKindSchema.nullable(),
    why: z.enum(["taken", "unknown"]),
    /** What Square took, where it said; null where it is not known. */
    amountMinor: z.number().int().min(0).max(99_999_999).nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    /** The gym's day it ended. */
    on: daySchema,
    /** Who paid in the app, by their record's name; null where it is not known. */
    payerName: z.string().nullable(),
  })
  .strict();
export type AppPaymentCheckRow = z.infer<typeof appPaymentCheckRowSchema>;

export const appPaymentChecksResponseSchema = z
  .object({
    rows: z.array(appPaymentCheckRowSchema).max(2000),
    /** More people have one than were read: the newest are shown. */
    more: z.boolean(),
  })
  .strict();
export type AppPaymentChecksResponse = z.infer<typeof appPaymentChecksResponseSchema>;

export const APP_PAYMENT_CHECKS_WORDS = {
  title: "Payments to check in Square",
  intro: "Square may have taken these payments in the app, but they didn't go through here. Check each one in Square, then settle it on the member's page.",
  open: "Open their page",
  more: `Only the ${String(APP_PAYMENT_CHECKS_PEOPLE)} newest people are shown. More appear here as you settle these.`,
  showMore: "Show more",
} as const;

/** "1 payment to check in Square", "3 payments to check in Square"; null for none. */
export function appPaymentChecksHeadline(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "1 payment to check in Square" : `${String(count)} payments to check in Square`;
}

/** What it was for: "Gold Monthly · bill", "Gold Monthly · late cancel fee", "10-class pack · bought in the app". */
export function appPaymentCheckWhat(row: Pick<AppPaymentCheckRow, "kind" | "typeName" | "fee">): string {
  if (row.kind === "purchase") return `${row.typeName} · bought in the app`;
  if (row.kind === "fee" && row.fee !== null) return `${row.typeName} · ${MEMBER_FEE_WORDS[row.fee].toLowerCase()}`;
  return `${row.typeName} · bill`;
}

/** The person's page's own sentence for it. `money`: the amount in the gym's words, or null where Square did not say. */
export function appPaymentCheckSentence(row: Pick<AppPaymentCheckRow, "kind" | "typeName" | "fee" | "why" | "payerName" | "on">, money: string | null): string {
  const day = dayWords(row.on);
  if (row.kind === "purchase") return appBuyCheckLine(row, money, day);
  return appCheckLine(row, money, day, row.kind === "fee" ? row.fee : null);
}
