import {
  HELD_STATUS_WORDS,
  MEMBER_FEE_WORDS,
  MEMBER_PAYMENT_METHOD_WORDS,
  RECEIPT_WORDS,
  bpToTaxRateText,
  formatMinor,
  type HeldMembershipShown,
  type MemberPaymentMethod,
  type MyFee,
  type MyMembership,
  type MyMembershipResponse,
  type Receipt,
  type SaleReceipt,
} from "@app/shared";
import { MONTHS_SHORT } from "./visitsView";

// My membership's words (spec Part 3 §14.2; ROADMAP Stage 5 item 16c): what a member holds at a place, what they
// paid it, the fees of its classes and sessions, what they bought at the desk, and each receipt. Pure: the server
// decides every amount and state, and this file only puts them into words. A receipt's lines are the browser's own
// (apps/web/src/pages/console/receiptView.js), so the phone and the printed receipt never differ.

export const myMembershipPath = (gymId: string) => `/v1/orgs/${encodeURIComponent(gymId)}/my-membership`;
export const myReceiptPath = (gymId: string, number: number) => `${myMembershipPath(gymId)}/receipts/${String(number)}`;

/** "4 Oct 2026"; the day as it came for one that cannot be read. */
export function dayText(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const month = m === undefined ? undefined : MONTHS_SHORT[m - 1];
  if (y === undefined || d === undefined || month === undefined || Number.isNaN(d)) return day;
  return `${String(d)} ${month} ${String(y)}`;
}

/** "4 Oct – 3 Nov 2026"; one day says its day. */
export function daysText(covers: { from: string; to: string }): string {
  if (covers.from === covers.to) return dayText(covers.from);
  const sameYear = covers.from.slice(0, 4) === covers.to.slice(0, 4);
  const from = dayText(covers.from);
  return `${sameYear ? from.slice(0, from.lastIndexOf(" ")) : from} – ${dayText(covers.to)}`;
}

const methodWords = (method: MemberPaymentMethod): string => MEMBER_PAYMENT_METHOD_WORDS[method];
/** Inside a sentence: "Card at the desk" reads "card at the desk"; "UPI" keeps its capitals. */
const lower = (words: string) => (/^[A-Z]{2,}\b/.test(words) ? words : `${words.charAt(0).toLowerCase()}${words.slice(1)}`);

export type Tone = "good" | "orange" | "bad" | "plain";
export interface Tag {
  label: string;
  tone: Tone;
}

const STATUS_TONES: Readonly<Record<HeldMembershipShown, Tone>> = { upcoming: "plain", active: "good", frozen: "orange", ended: "plain", cancelled: "plain" };

/** The word beside a membership's name, as the gym's own list says it. */
export function statusTag(m: MyMembership): Tag {
  return { label: HELD_STATUS_WORDS[m.status], tone: STATUS_TONES[m.status] };
}

/** When it runs: "Started 4 Oct 2026 · Renews 4 Nov 2026". One taken from the gym's own list has a start day worked
 *  back from it, which is not the day they joined: none is said. Null where there is nothing to say. */
export function datesText(m: MyMembership): string | null {
  const { status, endsOn, renewsOn } = m;
  const ends = endsOn === null ? "" : dayText(endsOn);
  if (m.fromList) {
    if (status === "cancelled") return endsOn === null ? "Cancelled" : `Cancelled ${ends}`;
    if (status === "ended") return endsOn === null ? null : `Ended ${ends}`;
    if (status === "frozen") return m.frozenOn === null ? "Frozen" : `Frozen since ${dayText(m.frozenOn)}`;
    if (renewsOn !== null) return `Renews ${dayText(renewsOn)}`;
    if (endsOn === null) return null;
    return m.kind === "recurring" ? `Ends ${ends}, won’t renew` : `Ends ${ends}`;
  }
  const start = dayText(m.startsOn);
  if (status === "cancelled") {
    // Cancelled before its start day: it never started.
    const first = endsOn !== null && endsOn < m.startsOn ? `Was to start ${start}` : `Started ${start}`;
    return endsOn === null ? `${first} · Cancelled` : `${first} · Cancelled ${ends}`;
  }
  if (status === "ended") return endsOn === null ? `Started ${start}` : endsOn === m.startsOn ? `For ${start} only` : `${start} to ${ends}`;
  if (status === "frozen") return m.frozenOn === null ? `Started ${start} · Frozen` : `Started ${start} · Frozen since ${dayText(m.frozenOn)}`;
  const first = status === "upcoming" ? `Starts ${start}` : `Started ${start}`;
  if (renewsOn !== null) return `${first} · Renews ${dayText(renewsOn)}`;
  if (endsOn === null) return first;
  if (endsOn === m.startsOn) return `For ${start} only`;
  // A repeating membership with an end day was cancelled at the end of what is paid.
  return m.kind === "recurring" ? `${first} · Ends ${ends}, won’t renew` : `${first} · Ends ${ends}`;
}

/** A pack's classes: "7 of 10 classes left"; null for any other kind, a one-day pass, or a pack no longer in use. */
export function classesText(m: MyMembership): string | null {
  if (m.kind !== "pack" || m.classesLeft === null || m.packClasses === null) return null;
  if (m.status !== "active" && m.status !== "frozen" && m.status !== "upcoming") return null;
  if (m.packClasses === 1 && m.endsOn === m.startsOn) return null;
  return `${String(m.classesLeft)} of ${String(m.packClasses)} ${m.packClasses === 1 ? "class" : "classes"} left`;
}

/** What is owed on it now: "₹1,500.00 due on 4 Nov 2026." or "… overdue since …". Null where nothing is. */
export function owedText(m: MyMembership): { text: string; tone: Tone } | null {
  if (m.owed === null) return null;
  const money = formatMinor(m.owed.amountMinor, m.currency);
  return m.owed.state === "overdue"
    ? { text: `${money} overdue since ${dayText(m.owed.dueOn)}.`, tone: "bad" }
    : { text: `${money} due on ${dayText(m.owed.dueOn)}.`, tone: "orange" };
}

/** A payment's two lines: "₹1,500.00 · Cash", and "Paid 4 Oct 2026 · for 4 Oct – 3 Nov 2026". */
export function paymentText(p: MyMembership["payments"][number], currency: string): { title: string; line: string } {
  const paid = `Paid ${dayText(p.paidOn)}`;
  return { title: `${formatMinor(p.amountMinor, currency)} · ${methodWords(p.method)}`, line: p.covers === null ? paid : `${paid} · for ${daysText(p.covers)}` };
}

/** A refund's two lines, under the payment or purchase it gives back for. */
export function refundText(r: { amountMinor: number; method: MemberPaymentMethod; refundedOn: string; pending?: boolean }, currency: string): { title: string; line: string } {
  return { title: `${formatMinor(r.amountMinor, currency)} ${r.pending === true ? "refund pending" : "given back"} · ${methodWords(r.method)}`, line: dayText(r.refundedOn) };
}

/** Said under a membership given in the app with a price and nothing paid on it yet. One from the place's own list
 *  with nothing paid here is paid in its other software, as the overdue messages read it: nothing is said. */
export const NO_PAYMENTS = "No payments yet.";

/** A fee and the membership it is on, as the Fees part draws it. */
export interface FeeItem {
  fee: MyFee;
  currency: string;
  membership: string;
}

/** Every fee of these memberships, newest day first. */
export function feesOf(memberships: readonly MyMembership[]): FeeItem[] {
  return memberships
    .flatMap((m) => m.fees.map((fee) => ({ fee, currency: m.currency, membership: m.name })))
    .sort((a, b) => (a.fee.on < b.fee.on ? 1 : a.fee.on > b.fee.on ? -1 : 0));
}

const FEE_TAGS: Readonly<Record<MyFee["state"], Tag>> = {
  due: { label: "Payment due", tone: "orange" },
  overdue: { label: "Overdue", tone: "bad" },
  paid: { label: "Paid", tone: "good" },
  refunded: { label: "Refunded", tone: "plain" },
  waived: { label: "Waived", tone: "plain" },
};

/** A fee's words: "Late cancel fee · Yoga Flow", its tag, "₹200.00 · 12 Oct 2026", and where it is owed when, or
 *  that the place took it off. Only a paid fee has a receipt to open. */
export function feeText(item: FeeItem, gymName: string): { title: string; tag: Tag; line: string; note: string | null; receipt: number | null } {
  const f = item.fee;
  const note =
    f.state === "due"
      ? `Due on ${dayText(f.dueOn)}.`
      : f.state === "overdue"
        ? `Overdue since ${dayText(f.dueOn)}.`
        : f.state === "waived"
          ? `${gymName} waived this fee.`
          : f.refundPending
            ? `${gymName} is refunding this fee.`
            : f.state === "refunded"
              ? `${gymName} refunded this fee.`
              : f.refundedMinor > 0
                ? `${gymName} refunded ${formatMinor(f.refundedMinor, item.currency)} of this fee.`
                : null;
  return {
    title: `${MEMBER_FEE_WORDS[f.fee]} · ${f.forName}`,
    tag: f.refundPending ? { label: "Refund pending", tone: "plain" } : FEE_TAGS[f.state],
    line: `${formatMinor(f.amountMinor, item.currency)} · ${dayText(f.on)} · ${item.membership}`,
    note,
    receipt: f.state === "paid" || f.state === "refunded" ? f.receiptNumber : null,
  };
}

/** A desk purchase's lines: "2 × Water bottle" and what each came to. */
export function purchaseLines(p: MyMembershipResponse["purchases"][number]): { label: string; amount: string }[] {
  return p.lines.map((l) => ({ label: `${String(l.quantity)} × ${l.name}`, amount: formatMinor(l.totalMinor, p.currency) }));
}

/** "Paid by cash · 4 Oct 2026". */
export function purchasePaid(p: MyMembershipResponse["purchases"][number]): string {
  return `Paid by ${lower(methodWords(p.method))} · ${dayText(p.soldOn)}`;
}

/** What a screen reader says for a receipt's button. */
export function receiptSay(number: number, what: string, refund = false): string {
  return `View ${refund ? "refund receipt" : "receipt"} #${String(number)} for ${what}`;
}

/** Where the page holds no money for them, the one line saying why; null for their own record. */
export function noRecordText(view: MyMembershipResponse): string | null {
  const gym = view.gym.name;
  if (view.record === "none") return `${gym} hasn’t linked a membership to your account yet. Ask them to, and it shows here.`;
  if (view.record === "shared") return `Your membership at ${gym} is linked to more than one account, so it isn’t shown here. Ask ${gym} to give each person their own.`;
  return null;
}

/** Said where somebody else pays: their payments and receipts are not shown here. The payer may have no app. */
export const paidByText = (name: string, gym: string) => `Paid by ${name}. Ask ${gym} for the payments and receipts.`;

/** Said under somebody the reader pays for. */
export const paysForText = (name: string) => `You pay for ${name}’s membership.`;

/** Said where the app holds no membership: a place may keep its memberships outside the app, so never "you have none". */
export const noMembershipText = (gym: string) => `${gym} hasn’t added a membership for you here.`;
export const theirNoMembershipText = (name: string, gym: string) => `${gym} hasn’t added a membership for ${name} here.`;

/** The lines under a list the server cut short: the place keeps the rest. */
export const olderPayments = (gym: string) => `Older payments aren’t shown here. ${gym} has them.`;
export const olderMemberships = (gym: string) => `Older memberships aren’t shown here. ${gym} has them.`;
export const olderPurchases = (gym: string) => `Older purchases aren’t shown here. ${gym} has them.`;

export function couldNotRead(status: number | null, gym: string): string {
  return status === 404 ? `${gym} isn’t showing your membership right now.` : "Couldn’t load your membership.";
}

export function couldNotOpenReceipt(status: number | null): string {
  return status === 404 ? RECEIPT_WORDS.receipt_not_found : "Couldn’t open this receipt. Try again.";
}

// ── A receipt ────────────────────────────────────────────────────────────────

/** "Receipt #12", or "Refund receipt #13". */
export function receiptTitle(receipt: Receipt): string {
  return `${receipt.kind === "refund" ? "Refund receipt" : "Receipt"} #${String(receipt.number)}`;
}

/** Said at the top of one a place voided (the server sends none to a member; kept as the browser has it). */
export function cancelledLine(receipt: Receipt): string | null {
  if (!receipt.cancelled) return null;
  if (receipt.kind === "sale") return "Voided. This sale no longer counts.";
  if (receipt.kind === "refund") return "Voided. This refund no longer counts.";
  return "Voided. This payment no longer counts.";
}

/** A receipt's line: its label, its amount or none, and whether it is the total or what was paid. */
export interface ReceiptLine {
  label: string;
  amount: string | null;
  total?: boolean;
  strong?: boolean;
}

const membershipLabel = (item: { name: string; covers: { from: string; to: string } | null; part?: boolean }) =>
  item.covers === null ? item.name : `${item.name}, ${daysText(item.covers)}${item.part === true ? " (part month)" : ""}`;

const taxText = (t: { name: string | null; bp: number }) => `${t.name ?? "Tax"} ${bpToTaxRateText(t.bp)}%`;

const productLine = (line: SaleReceipt["lines"][number], money: (minor: number) => string): ReceiptLine => {
  const each = line.quantity > 1 ? ` at ${money(line.unitPriceMinor)} each` : "";
  return { label: `${String(line.quantity)} × ${line.name}${each}`, amount: money(line.amounts.listedMinor) };
};

/** The lines of a receipt, top to bottom, as the browser prints them. */
export function receiptLines(receipt: Receipt): ReceiptLine[] {
  const money = (minor: number) => formatMinor(minor, receipt.currency);
  const lines: ReceiptLine[] = [];
  if (receipt.kind === "refund") {
    lines.push({ label: `Refund for receipt #${String(receipt.forReceipt)}`, amount: null });
    lines.push({ label: membershipLabel(receipt.item), amount: null });
    lines.push({ label: `Given back by ${lower(methodWords(receipt.method))}`, amount: money(receipt.refundedMinor), strong: true });
    return lines;
  }
  if (receipt.kind === "sale") {
    const [only, ...more] = receipt.lines;
    if (only === undefined || more.length > 0) return basketLines(receipt, money);
    lines.push(productLine(only, money));
    amountLines(lines, only.amounts, money);
    lines.push({ label: `Paid by ${lower(methodWords(receipt.method))}`, amount: money(only.amounts.totalMinor), strong: true });
    return lines;
  }
  const amounts = receipt.amounts;
  // A joining fee is a line of its own, after the membership and its discount.
  const fee = receipt.joiningFeeMinor;
  // A change of membership: its full price, then the unused days of the one before off it.
  const credit = receipt.changeCredit;
  lines.push({ label: membershipLabel(receipt.item), amount: money(amounts.listedMinor - fee + (credit?.minor ?? 0)) });
  if (credit !== null) lines.push({ label: `Unused days of ${credit.fromName}`, amount: `−${money(credit.minor)}` });
  amountLines(lines, amounts, money, fee, receipt.balance !== null ? "Bill total" : "Total");
  if (receipt.balance !== null && receipt.balance.paidBeforeMinor > 0) lines.push({ label: "Paid before", amount: money(receipt.balance.paidBeforeMinor) });
  lines.push({ label: `Paid by ${lower(methodWords(receipt.method))}`, amount: money(receipt.paidMinor), strong: true });
  if (receipt.balance !== null) lines.push({ label: "Left to pay", amount: money(receipt.balance.leftMinor) });
  return lines;
}

type Amounts = SaleReceipt["lines"][number]["amounts"];

/** The discount, a joining fee, a tax added on top, the total and a tax inside the price, in that order. */
function amountLines(lines: ReceiptLine[], amounts: Amounts, money: (minor: number) => string, fee = 0, totalLabel = "Total"): void {
  if (amounts.discount !== null) lines.push({ label: `Discount: ${amounts.discount.name}`, amount: `−${money(amounts.discount.minor)}` });
  if (fee > 0) lines.push({ label: "Joining fee", amount: money(fee) });
  if (amounts.tax !== null && !amounts.tax.included) lines.push({ label: taxText(amounts.tax), amount: money(amounts.tax.minor) });
  lines.push({ label: totalLabel, amount: money(amounts.totalMinor), total: true });
  if (amounts.tax !== null && amounts.tax.included) lines.push({ label: `Includes ${taxText(amounts.tax)}`, amount: money(amounts.tax.minor) });
}

/** A sale of several products, as a till's slip: each product with its discount under it, the subtotal and each tax
 *  added on top by its rate, the total, each tax inside the prices, and how it was paid. */
function basketLines(receipt: SaleReceipt, money: (minor: number) => string): ReceiptLine[] {
  const lines: ReceiptLine[] = [];
  const taxes = new Map<string, { tax: NonNullable<Amounts["tax"]>; minor: number }>();
  let subtotal = 0;
  for (const line of receipt.lines) {
    const { amounts } = line;
    lines.push(productLine(line, money));
    if (amounts.discount !== null) lines.push({ label: `Discount: ${amounts.discount.name}`, amount: `−${money(amounts.discount.minor)}` });
    subtotal += amounts.tax !== null && !amounts.tax.included ? amounts.totalMinor - amounts.tax.minor : amounts.totalMinor;
    if (amounts.tax !== null) {
      const key = `${amounts.tax.included ? "in" : "on"} ${taxText(amounts.tax)}`;
      taxes.set(key, { tax: amounts.tax, minor: (taxes.get(key)?.minor ?? 0) + amounts.tax.minor });
    }
  }
  const onTop = [...taxes.values()].filter((t) => !t.tax.included);
  const inside = [...taxes.values()].filter((t) => t.tax.included);
  if (onTop.length > 0) {
    lines.push({ label: "Subtotal", amount: money(subtotal) });
    for (const t of onTop) lines.push({ label: taxText(t.tax), amount: money(t.minor) });
  }
  lines.push({ label: "Total", amount: money(receipt.totalMinor), total: true });
  for (const t of inside) lines.push({ label: `Includes ${taxText(t.tax)}`, amount: money(t.minor) });
  lines.push({ label: `Paid by ${lower(methodWords(receipt.method))}`, amount: money(receipt.totalMinor), strong: true });
  return lines;
}

/** The notes under the lines: each refund given back against a payment or a sale. */
export function receiptNotes(receipt: Receipt): string[] {
  if (receipt.kind === "refund") return [];
  const money = (minor: number) => formatMinor(minor, receipt.currency);
  return receipt.refunds.map((r) => {
    const what = "item" in r && typeof r.item === "string" ? ` for ${r.item}` : "";
    return `${money(r.amountMinor)} given back${what} on ${dayText(r.on)} (refund receipt #${String(r.number)}).`;
  });
}

/** The rows at its top: the day, who it is for, and who paid where somebody else did. */
export function receiptHead(receipt: Receipt): { label: string; value: string }[] {
  const rows = [
    { label: "Date", value: dayText(receipt.on) },
    { label: "For", value: receipt.person ?? (receipt.personDeleted ? "A deleted member" : "Walk-in") },
  ];
  const payerLabel = receipt.kind === "refund" ? "Given back to" : "Paid by";
  if (receipt.paidByDeleted) rows.push({ label: payerLabel, value: "A deleted member" });
  else if (receipt.paidBy !== null) rows.push({ label: payerLabel, value: receipt.paidBy.trim() === "" ? "No name on their record" : receipt.paidBy });
  return rows;
}
