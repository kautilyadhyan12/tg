// APP PAYMENTS TO REVIEW, ON OVERVIEW (ROADMAP 18k-vi; Kd, rulings/2026-11-12-20g.md): every payment or purchase in the
// app that Square may have taken and that is on no bill or gave nothing, as the person's page says it, with a button to them.
// The rows are the person's page's own: a bill's while that bill is owed, a fee's while it is owed, a purchase's until it is
// marked as resolved.
import { z } from "zod";
import { MEMBER_FEE_WORDS, memberFeeKindSchema } from "./memberBills.js";

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The people read at most, the newest first: beyond them the card says there are more. */
export const APP_PAYMENT_CHECKS_PEOPLE = 100;
/** Rows sent at most: past them, the newest are sent and the card says there are more. */
export const APP_PAYMENT_CHECKS_ROWS = 2000;
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
    rows: z.array(appPaymentCheckRowSchema).max(APP_PAYMENT_CHECKS_ROWS),
    /** More people, or more rows, than were sent: the newest are shown. */
    more: z.boolean(),
  })
  .strict();
export type AppPaymentChecksResponse = z.infer<typeof appPaymentChecksResponseSchema>;

export const APP_PAYMENT_CHECKS_WORDS = {
  title: "App payments to review",
  intro: "Square may have charged these members in the app, but the payments weren't applied here. Review each one in your Square Dashboard, then resolve it on the member's page.",
  open: "Review payment",
  more: `Showing the ${String(APP_PAYMENT_CHECKS_PEOPLE)} most recent members. More appear here as you resolve these.`,
  showMore: "Show more",
} as const;

/** "1 app payment to review", "3 app payments to review"; null for none. */
export function appPaymentChecksHeadline(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "1 app payment to review" : `${String(count)} app payments to review`;
}

/** What it was for: "Gold Monthly · Membership payment", "Gold Monthly · Late cancel fee", "10-class pack · App purchase". */
export function appPaymentCheckWhat(row: Pick<AppPaymentCheckRow, "kind" | "typeName" | "fee">): string {
  if (row.kind === "purchase") return `${row.typeName} · App purchase`;
  if (row.kind === "fee" && row.fee !== null) return `${row.typeName} · ${MEMBER_FEE_WORDS[row.fee]}`;
  return `${row.typeName} · Membership payment`;
}

/** Where it stands, in one sentence: "Charged $54.99 on 13 November 2026, but not applied to the bill.", or "Not confirmed by
 *  Square on 13 November 2026. The member may have been charged."; who paid where it was somebody else. `money`: the amount
 *  in the gym's words, or null where Square did not say; `day`: the day it ended, as the member's page writes it. */
export function appPaymentCheckStatus(row: Pick<AppPaymentCheckRow, "kind" | "typeName" | "why" | "name" | "payerName">, money: string | null, day: string): string {
  const charged = `Charged${money === null ? "" : ` ${money}`} on ${day}`;
  const status =
    row.why === "unknown"
      ? `Not confirmed by Square on ${day}. The member may have been charged.`
      : row.kind === "purchase"
        ? `${charged}, but ${row.typeName} wasn't added.`
        : `${charged}, but not applied to the ${row.kind === "fee" ? "fee" : "bill"}.`;
  return row.payerName !== null && row.payerName !== row.name ? `${status} Paid by ${row.payerName}.` : status;
}
