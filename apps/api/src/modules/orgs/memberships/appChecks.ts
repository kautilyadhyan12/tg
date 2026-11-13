// APP PAYMENTS TO REVIEW, ON OVERVIEW (ROADMAP 18k-vi; Kd, rulings/2026-11-12-20g.md). THE WORST THING is a member whose
// money Square took left off the list, so nobody gives them what they paid for. So a row is what the person's page says, by
// the page's own rules: a membership's newest page for one of its bills that ended needing a check, while that bill's period
// is the one a payment is taken for now (`owedPeriodOf`); a fee's newest, while the fee is open; a purchase, until it is
// marked as checked. The whole gym is read at once, never one page a person.
//
// One case the page shows and this does not differ on: a membership that is over and is not among the page's newest 30 of
// those (`HELD_EARLIER_PAGE`) is said here and not on the page; never the other way round.
import {
  APP_PAYMENT_CHECKS_PEOPLE,
  APP_PAYMENT_CHECKS_ROWS,
  appPaymentChecksResponseSchema,
  type AppPaymentCheckRow,
  type AppPaymentChecksResponse,
} from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { checksOfGym } from "../payments/appPaymentsRepo.js";
import { purchaseChecksOfGym } from "../payments/appPurchasesRepo.js";
import { OrgsError, requirePrivilege } from "../service.js";
import { holdersOf, peopleOf } from "./appChecksRepo.js";
import { billsFor } from "./billsSql.js";
import { heldRowsOf } from "./heldRepo.js";
import { owedPeriodOf, type HeldDeps } from "./heldService.js";

const BILLING = "billing.members";
const MEMBERS = "members.confirm";
const NO_MEMBERS = "App payments to review are resolved on the member's page, which needs \"Keep the member list and invite\". Ask the owner to turn it on for you.";

type Row = Omit<AppPaymentCheckRow, "name" | "past"> & { finishedAt: string };

/** The rows the card is sent: the newest first, by when each page ended (round one, L2); the newest \`people\` people's, and no
 *  more than \`maxRows\` in all (round one, L3). \`more\`: some were left out. */
export function keepNewest<R extends { entryId: string; finishedAt: string; id: string }>(rows: readonly R[], people: number, maxRows: number): { rows: R[]; more: boolean } {
  const sorted = [...rows].sort((a, b) => (a.finishedAt === b.finishedAt ? (a.id < b.id ? -1 : 1) : a.finishedAt < b.finishedAt ? 1 : -1));
  const order = [...new Set(sorted.map((r) => r.entryId))];
  const kept = new Set(order.slice(0, people));
  const inKept = sorted.filter((r) => kept.has(r.entryId));
  return { rows: inKept.slice(0, maxRows), more: order.length > people || inKept.length > maxRows };
}

export async function readAppPaymentChecks(deps: HeldDeps, userId: string, gymId: string): Promise<AppPaymentChecksResponse> {
  const { org, privileges } = await requirePrivilege(deps, gymId, userId, BILLING);
  if (!privileges.includes(MEMBERS)) throw new OrgsError(403, "forbidden", NO_MEMBERS);
  const today = dayInTz(deps.now(), org.timezone);
  const [checks, purchases] = await Promise.all([checksOfGym(deps.sql, gymId), purchaseChecksOfGym(deps.sql, gymId)]);
  const membershipIds = [...new Set([...checks.bills, ...checks.fees].map((c) => c.membershipId))];
  const billChecked = [...new Set(checks.bills.map((c) => c.membershipId))];
  const [held, bills, holders] = await Promise.all([heldRowsOf(deps.sql, gymId, membershipIds), billsFor(deps.sql, gymId, billChecked), holdersOf(deps.sql, gymId, membershipIds)]);
  const people = await peopleOf(deps.sql, gymId, [...new Set([...holders.values(), ...purchases.map((p) => p.entryId)])]);
  const billsOf = new Map<string, typeof bills>();
  for (const b of bills) billsOf.set(b.membershipId, [...(billsOf.get(b.membershipId) ?? []), b]);

  const rows: Row[] = [];
  for (const c of checks.bills) {
    const row = held.get(c.membershipId);
    const entryId = holders.get(c.membershipId);
    const person = entryId === undefined ? undefined : people.get(entryId);
    if (row === undefined || entryId === undefined || person === undefined) continue;
    if (owedPeriodOf(row, billsOf.get(row.id) ?? [], today, person.past) !== c.periodIndex) continue;
    rows.push({ id: `bill:${row.id}`, entryId, kind: "bill", typeName: row.typeName, fee: null, why: c.why, amountMinor: c.amountMinor, currency: row.currency, on: c.on, payerName: c.payerName, finishedAt: c.finishedAt });
  }
  for (const c of checks.fees) {
    const row = held.get(c.membershipId);
    const entryId = holders.get(c.membershipId);
    if (row === undefined || entryId === undefined || !people.has(entryId)) continue;
    rows.push({ id: `fee:${c.feeId}`, entryId, kind: "fee", typeName: row.typeName, fee: c.fee, why: c.why, amountMinor: c.amountMinor, currency: row.currency, on: c.on, payerName: c.payerName, finishedAt: c.finishedAt });
  }
  for (const c of purchases) {
    if (!people.has(c.entryId)) continue;
    rows.push({ id: `purchase:${c.id}`, entryId: c.entryId, kind: "purchase", typeName: c.typeName, fee: null, why: c.why, amountMinor: c.amountMinor, currency: c.currency, on: c.on, payerName: c.payerName, finishedAt: c.finishedAt });
  }

  const kept = keepNewest(rows, APP_PAYMENT_CHECKS_PEOPLE, APP_PAYMENT_CHECKS_ROWS);
  return appPaymentChecksResponseSchema.parse({
    rows: kept.rows.flatMap((r) => {
      const person = people.get(r.entryId);
      if (person === undefined) return [];
      const { id, entryId, kind, typeName, fee, why, amountMinor, currency, on, payerName } = r;
      return [{ id, entryId, name: person.name, past: person.past, kind, typeName, fee, why, amountMinor, currency, on, payerName }];
    }),
    more: kept.more,
  });
}
