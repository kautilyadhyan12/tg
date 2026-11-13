// PAYMENTS TO CHECK IN SQUARE, ON OVERVIEW (ROADMAP 18k-vi; Kd, rulings/2026-11-12-20g.md). THE WORST THING is a member whose
// money Square took left off the list, so nobody gives them what they paid for. So the list is never worked out a second
// way: each person who may have one is read through their own page (`readOr404`), and a row is what that page says is to
// check, and nothing else. A row goes as it goes from the page: a bill's once it is paid or cancelled, a fee's once it is
// paid or waived, a purchase's once it is marked as checked.
import {
  APP_PAYMENT_CHECKS_PEOPLE,
  appPaymentChecksResponseSchema,
  type AppPaymentCheckRow,
  type AppPaymentChecksResponse,
  type HeldMembershipsResponse,
} from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { OrgsError, requirePrivilege } from "../service.js";
import { peopleToCheck } from "./appChecksRepo.js";
import { readOr404, type HeldDeps } from "./heldService.js";

const BILLING = "billing.members";
const MEMBERS = "members.confirm";
const NO_MEMBERS = "Payments to check are settled on the member's page, which needs \"Keep the member list and invite\". Ask the owner to turn it on for you.";
/** Pages read at once: a gym with many waits a little longer, and the database is never asked for them all together. */
const AT_ONCE = 4;

/** What one person's page says is to check, as rows. */
export function rowsOfPage(entryId: string, name: string, page: HeldMembershipsResponse): AppPaymentCheckRow[] {
  const base = { entryId, name, past: page.past };
  const rows: AppPaymentCheckRow[] = [];
  for (const m of page.memberships) {
    const billing = m.billing;
    if (billing === null) continue;
    if (billing.appCheck !== null) {
      const c = billing.appCheck;
      rows.push({ ...base, id: `bill:${m.id}`, kind: "bill", typeName: m.typeName, fee: null, why: c.why, amountMinor: c.amountMinor, currency: m.currency, on: c.on, payerName: c.payerName });
    }
    for (const f of billing.fees) {
      if (f.appCheck === null) continue;
      const c = f.appCheck;
      rows.push({ ...base, id: `fee:${f.id}`, kind: "fee", typeName: m.typeName, fee: f.fee, why: c.why, amountMinor: c.amountMinor, currency: m.currency, on: c.on, payerName: c.payerName });
    }
  }
  for (const c of page.appBuyChecks) {
    rows.push({ ...base, id: `purchase:${c.id}`, kind: "purchase", typeName: c.typeName, fee: null, why: c.why, amountMinor: c.amountMinor, currency: c.currency, on: c.on, payerName: c.payerName });
  }
  return rows;
}

export async function readAppPaymentChecks(deps: HeldDeps, userId: string, gymId: string): Promise<AppPaymentChecksResponse> {
  const { org, privileges } = await requirePrivilege(deps, gymId, userId, BILLING);
  if (!privileges.includes(MEMBERS)) throw new OrgsError(403, "forbidden", NO_MEMBERS);
  const today = dayInTz(deps.now(), org.timezone);
  const people = await peopleToCheck(deps.sql, gymId, APP_PAYMENT_CHECKS_PEOPLE + 1);
  const read = people.slice(0, APP_PAYMENT_CHECKS_PEOPLE);
  const pages: (AppPaymentCheckRow[] | null)[] = new Array<AppPaymentCheckRow[] | null>(read.length).fill(null);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < read.length) {
      const at = next++;
      const person = read[at];
      if (person === undefined) return;
      try {
        pages[at] = rowsOfPage(person.entryId, person.name, await readOr404(deps, gymId, person.entryId, today, true, false));
      } catch (err) {
        // Deleted for good since the list was read: it has no page, and nothing to check on one.
        if (err instanceof OrgsError && err.statusCode === 404) continue;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, read.length) }, worker));
  // The newest day first; on one day, the person whose page ended last first.
  const rows = pages
    .flatMap((p, i) => (p ?? []).map((row) => ({ row, i })))
    .sort((a, b) => (a.row.on === b.row.on ? a.i - b.i : a.row.on < b.row.on ? 1 : -1))
    .map((x) => x.row);
  return appPaymentChecksResponseSchema.parse({ rows, more: people.length > APP_PAYMENT_CHECKS_PEOPLE });
}
