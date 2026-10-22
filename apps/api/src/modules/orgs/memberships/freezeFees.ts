// A FEE WHILE FROZEN (spec Part 3 §14.8; ROADMAP 18z).
//
// The worst thing this could do to a real person: charge a freeze fee they do not owe: twice for
// one month, for a month after they were unfrozen, at a gym that never set one, or on a freeze
// staff made with no fee. So a fee is opened only for a membership stored frozen with its own
// fee above 0 (set at the freeze, from the gym's fee then, or 0 where staff unticked it), of a
// person still on the gym's list, and only for the month today falls in (`freezeFeeMonth`); one
// fee a month of a membership is held by `gym_member_bills_freeze_fee_uq` (0155). An unfreeze or
// a cancel takes off, unpaid, the fees of months that begin that day or later.
//
// A freeze fee is a fee bill like a late cancel's (`feesRepo.ts`): paid all at once, with a
// receipt, or waived; it moves no date and no count of paid periods. With `feesRepo.ts`,
// `billsSql.ts` and `billsRepo.ts`, the only files that write the bills.
import type { Sql, TransactionSql } from "postgres";
import { freezeFeeMonth } from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { lockGym } from "../memberList/repo.js";
import { insertAudit } from "../repo.js";
import { billOf } from "./billsSql.js";

/** The gym's freeze fee a month, in minor units; 0 is none. */
export async function freezeFeeOf(sql: Sql | TransactionSql, gymId: string): Promise<number> {
  const [row] = await sql<{ freeze_fee_minor: number }[]>`SELECT freeze_fee_minor FROM gyms WHERE id = ${gymId}`;
  return row?.freeze_fee_minor ?? 0;
}

export async function setFreezeFee(tx: TransactionSql, gymId: string, minor: number): Promise<void> {
  await tx`UPDATE gyms SET freeze_fee_minor = ${minor} WHERE id = ${gymId}`;
}

type Frozen = {
  id: string;
  gym_id: string;
  frozen_on: string;
  fee: number;
  currency: string;
  type_name: string;
  timezone: string;
  tax_name: string | null;
  tax_bp: number | null;
  /** The months of this freeze that already have a fee that stands, or one staff waived. */
  billed: string[];
  /** An earlier freeze's fee still owed covers the freeze day: unfrozen and frozen again inside
   *  its month, those days are not charged twice, so this freeze's first month opens no fee. */
  covered: boolean;
};

/** The memberships owed a freeze fee: stored frozen with a fee of their own, of a current record of
 *  a gym that is open. Which month is owed is `freezeFeeMonth`'s to say. */
const frozen = (sql: Sql | TransactionSql, gymIds: readonly string[] | null, membershipIds: readonly string[] | null) => {
  const gyms = gymIds === null ? null : [...gymIds];
  const ids = membershipIds === null ? null : [...membershipIds];
  return sql<Frozen[]>`
    SELECT h.id, h.gym_id, h.frozen_on::text AS frozen_on, h.freeze_fee_minor AS fee, h.currency,
           left(t.name, 80) AS type_name, g.timezone, r.name AS tax_name, r.rate_bp AS tax_bp,
           ARRAY(SELECT b.covers_from::text FROM gym_member_bills b
                 WHERE b.gym_id = h.gym_id AND b.held_membership_id = h.id AND b.fee = 'freeze'
                   AND b.covers_from >= h.frozen_on AND (b.status <> 'void' OR b.void_reason = 'waived')) AS billed,
           EXISTS (SELECT 1 FROM gym_member_bills c
                   WHERE c.gym_id = h.gym_id AND c.held_membership_id = h.id AND c.fee = 'freeze' AND NOT c.freeze_stopped
                     AND c.covers_from < h.frozen_on AND c.covers_to >= h.frozen_on
                     AND (c.status <> 'void' OR c.void_reason = 'waived')) AS covered
    FROM gym_held_memberships h
    JOIN gyms g ON g.id = h.gym_id AND g.status = 'active'
    JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
    JOIN gym_member_list_entries e ON e.gym_id = h.gym_id AND e.id = h.entry_id AND e.former_at IS NULL
    LEFT JOIN gym_tax_rates r ON r.gym_id = h.gym_id AND r.id = h.tax_rate_id
    WHERE h.status = 'frozen' AND h.freeze_fee_minor > 0 AND h.frozen_on IS NOT NULL
      AND (${gyms}::uuid[] IS NULL OR h.gym_id = ANY(${gyms}::uuid[]))
      AND (${ids}::uuid[] IS NULL OR h.id = ANY(${ids}::uuid[]))`;
};

type Opening = { m: string; a: number; tm: number; tb: number; tn: string | null; ti: boolean | null; c: string; n: string; from: string; to: string };

function owedFees(rows: readonly Frozen[], now: Date): Map<string, Opening[]> {
  const byGym = new Map<string, Opening[]>();
  // The gym's day, worked out once a time zone: one for every row kept the thread busy a second
  // over 6,000 frozen memberships (`tools/measure-member-bills-cost.ts`).
  const days = new Map<string, string>();
  const dayIn = (timezone: string): string => {
    let day = days.get(timezone);
    if (day === undefined) {
      day = dayInTz(now, timezone);
      days.set(timezone, day);
    }
    return day;
  };
  for (const row of rows) {
    const month = freezeFeeMonth(row.frozen_on, dayIn(row.timezone));
    if (month === null || row.billed.includes(month.from)) continue;
    if (row.covered && month.from === row.frozen_on) continue;
    // The amount the gym set is what the person pays: the membership's rate is inside it, as a late cancel's is.
    const tax = row.tax_name === null || row.tax_bp === null ? null : { name: row.tax_name, bp: row.tax_bp, included: true };
    const bill = billOf(row.fee, tax);
    const opening: Opening = {
      m: row.id,
      a: bill.amountMinor,
      tm: bill.tax?.minor ?? 0,
      tb: bill.tax?.bp ?? 0,
      tn: bill.tax?.name ?? null,
      ti: bill.tax?.included ?? null,
      c: row.currency,
      n: row.type_name,
      from: month.from,
      to: month.to,
    };
    const list = byGym.get(row.gym_id);
    if (list === undefined) byGym.set(row.gym_id, [opening]);
    else list.push(opening);
  }
  return byGym;
}

async function insertFreezeFees(tx: TransactionSql, gymId: string, opening: readonly Opening[], now: Date): Promise<number> {
  if (opening.length === 0) return 0;
  const opened = await tx<{ id: string }[]>`
    INSERT INTO gym_member_bills
      (gym_id, held_membership_id, period_index, fee, fee_for, amount_minor, tax_minor, tax_bp, tax_name, tax_included,
       currency, due_on, covers_from, covers_to, created_at, updated_at)
    SELECT ${gymId}, r.m, NULL, 'freeze', r.n, r.a, r.tm, r.tb, r.tn, r.ti, r.c, r.from, r.from, r.to, ${now}, ${now}
    FROM jsonb_to_recordset(${tx.json(opening)}) AS r(m uuid, a int, tm int, tb int, tn text, ti boolean, c text, n text, "from" date, "to" date)
    ON CONFLICT (held_membership_id, covers_from) WHERE fee = 'freeze' AND (status <> 'void' OR void_reason = 'waived') DO NOTHING
    RETURNING id`;
  if (opened.length > 0) {
    await insertAudit(tx, {
      actorUserId: null,
      gymId,
      action: "org.member_fees_opened",
      targetType: "gym",
      targetId: gymId,
      meta: { fee: "freeze", bills: String(opened.length) },
    });
  }
  return opened.length;
}

/** THIS MEMBERSHIP WAS JUST FROZEN WITH A FEE: its first month's fee, in the freeze's own
 *  transaction, so the page shows it at once. Answers how many it opened. */
export async function openFreezeFee(tx: TransactionSql, gymId: string, membershipId: string, now: Date): Promise<number> {
  // Unfrozen and frozen again on the day a month began: that month's fee, paid and marked no longer
  // owed by the unfreeze, is owed again, and stands for this freeze's first month.
  await tx`
    UPDATE gym_member_bills b SET freeze_stopped = false, updated_at = ${now}
    FROM gym_held_memberships h
    WHERE h.gym_id = ${gymId} AND h.id = ${membershipId} AND h.status = 'frozen'
      AND b.gym_id = h.gym_id AND b.held_membership_id = h.id AND b.fee = 'freeze' AND b.freeze_stopped
      AND b.status = 'paid' AND b.covers_from = h.frozen_on`;
  const work = owedFees(await frozen(tx, [gymId], [membershipId]), now).get(gymId) ?? [];
  return await insertFreezeFees(tx, gymId, work, now);
}

/** THIS MEMBERSHIP IS NO LONGER FROZEN (unfrozen or cancelled): the fees of months that begin
 *  `fromDay` or later are no longer owed (`freeze_stopped`). An unpaid one comes off, kept and
 *  marked; one paid stays paid, reads No longer owed, and voiding its payment takes it off instead
 *  of owing it again. In the caller's transaction. Answers how many it took off unpaid. */
export async function removeFreezeFees(tx: TransactionSql, gymId: string, membershipId: string, fromDay: string, now: Date): Promise<number> {
  const rows = await tx<{ id: string; was: string }[]>`
    UPDATE gym_member_bills b SET status = CASE WHEN b.status = 'open' THEN 'void' ELSE b.status END, freeze_stopped = true, updated_at = ${now}
    FROM gym_member_bills old
    WHERE old.id = b.id AND b.gym_id = ${gymId} AND b.held_membership_id = ${membershipId} AND b.fee = 'freeze'
      AND b.status IN ('open','paid') AND NOT b.freeze_stopped AND b.covers_from >= ${fromDay}::date
    RETURNING b.id, old.status AS was`;
  const removed = rows.filter((r) => r.was === "open");
  if (removed.length > 0) {
    await insertAudit(tx, {
      actorUserId: null,
      gymId,
      action: "org.member_fees_removed",
      targetType: "gym",
      targetId: gymId,
      meta: { bills: String(removed.length), fee: "freeze" },
    });
  }
  return removed.length;
}

/** Opens every freeze fee that has fallen due, on each gym's own day, beside `openDueBills`. A
 *  plain read finds the gyms with one to open; each is then one transaction under its lock that
 *  reads again, so a membership unfrozen a moment before is not charged. Safe to run twice and at
 *  once: a month has one fee. A gym that fails is logged and tried on the next run. */
export async function openDueFreezeFees(
  deps: { sql: Sql; log: { info: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void } },
  opts: { now?: Date; gymIds?: readonly string[] } = {},
): Promise<{ opened: number; failed: number }> {
  const now = opts.now ?? new Date();
  const first = owedFees(await frozen(deps.sql, opts.gymIds ?? null, null), now);
  let opened = 0;
  let failed = 0;
  for (const gymId of first.keys()) {
    try {
      opened += await deps.sql.begin(async (tx) => {
        await lockGym(tx, gymId);
        return await insertFreezeFees(tx, gymId, owedFees(await frozen(tx, [gymId], null), now).get(gymId) ?? [], now);
      });
    } catch (err) {
      failed += 1;
      deps.log.error({ event: "freeze_fees.gym_failed", gymId, err }, "opening a gym's freeze fees failed");
    }
  }
  if (opened > 0) deps.log.info({ event: "freeze_fees.opened", opened }, "freeze fees opened");
  return { opened, failed };
}
