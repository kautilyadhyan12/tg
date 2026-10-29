// The database half of Unlink on a person's page (ROADMAP 18d-iii-b-ii-c-ii; `squareUnlink.ts`): the customers Match linked to
// a record, what Unlink does to them under the gym's lock, and the memory that staff unlinked them, which every way of linking
// reads (`linkCustomer`, Members in Square's rule, Match's tick, a card being saved).
import type { Sql, TransactionSql } from "postgres";
import type { SquareEnvironment } from "./square.js";

type SqlOrTx = Sql | TransactionSql;

export interface MatchedLinkRow {
  environment: SquareEnvironment;
  accountId: string;
  customerId: string;
  also: boolean;
  linkedAt: Date;
  from: { amountMinor: number; currency: string; takenAt: Date } | null;
}

/** The customers Match linked to this record in this environment, oldest first: their customer (`gym_square_customers.matched_at`)
 *  and any second one (`gym_square_old_customers.matched_at`), each with the payment whose Match linked it, where it is still here. */
export async function matchedLinks(sql: SqlOrTx, gymId: string, entryId: string, environment: SquareEnvironment): Promise<MatchedLinkRow[]> {
  const rows = await sql<
    { account_id: string; customer_id: string; also: boolean; linked_at: Date; amount_minor: number | null; currency: string | null; taken_at: Date | null }[]
  >`
    WITH links AS (
      SELECT account_id, customer_id, false AS also, matched_at AS linked_at FROM gym_square_customers
      WHERE gym_id = ${gymId} AND entry_id = ${entryId} AND environment = ${environment} AND matched_at IS NOT NULL AND customer_id IS NOT NULL
      UNION ALL
      SELECT account_id, customer_id, true, matched_at FROM gym_square_old_customers
      WHERE gym_id = ${gymId} AND entry_id = ${entryId} AND environment = ${environment} AND matched_at IS NOT NULL
    )
    SELECT l.account_id, l.customer_id, l.also, l.linked_at, p.amount_minor, p.currency, p.taken_at
    FROM links l
    LEFT JOIN LATERAL (
      SELECT amount_minor, currency, taken_at FROM gym_square_app_payments
      WHERE gym_id = ${gymId} AND environment = ${environment} AND account_id = l.account_id AND customer_id = l.customer_id
        AND link_result IN ('linked', 'also')
      ORDER BY (updated_at = l.linked_at) DESC, updated_at DESC
      LIMIT 1
    ) p ON true
    ORDER BY l.linked_at, l.customer_id
    LIMIT 20`;
  return rows.map((r) => ({
    environment,
    accountId: r.account_id,
    customerId: r.customer_id,
    also: r.also,
    linkedAt: r.linked_at,
    from: r.amount_minor === null || r.currency === null || r.taken_at === null ? null : { amountMinor: r.amount_minor, currency: r.currency, takenAt: r.taken_at },
  }));
}

/** The customer ids a link stands for: the customer, and the old ids Square merged into it (a payment taken under an old id is
 *  the record's through it). */
async function idsOf(sql: SqlOrTx, a: { environment: SquareEnvironment; accountId: string; customerId: string }): Promise<string[]> {
  const rows = await sql<{ from_customer_id: string }[]>`
    SELECT from_customer_id FROM gym_square_customer_merges
    WHERE environment = ${a.environment} AND account_id = ${a.accountId} AND to_customer_id = ${a.customerId}`;
  return [a.customerId, ...rows.map((r) => r.from_customer_id)];
}

/** Payments whose reason says nothing about who paid: kept as they are once the customer is nobody's. */
const ANYBODY_REASONS = ["refunded", "other_location"] as const;

/** What Unlink would do, read before anything changes, for its box. */
export async function unlinkFacts(
  sql: SqlOrTx,
  a: { gymId: string; entryId: string; environment: SquareEnvironment; accountId: string; customerId: string; also: boolean },
): Promise<{
  waiting: number;
  waitingMinor: number;
  currency: string | null;
  shopItems: number;
  shopItemsMinor: number;
  notBill: number;
  matched: number;
  card: { brand: string; last4: string } | null;
  added: boolean;
}> {
  const ids = await idsOf(sql, a);
  const [counts] = await sql<{ waiting: number; waiting_minor: number; currency: string | null; shop_items: number; shop_items_minor: number; not_bill: number; matched: number }[]>`
    SELECT count(*) FILTER (WHERE state = 'waiting' AND entry_id = ${a.entryId} AND reason <> 'shop_items')::int AS waiting,
           coalesce(sum(amount_minor) FILTER (WHERE state = 'waiting' AND entry_id = ${a.entryId} AND reason <> 'shop_items'), 0)::int AS waiting_minor,
           min(currency) FILTER (WHERE state IN ('waiting', 'not_bill') AND entry_id = ${a.entryId}) AS currency,
           count(*) FILTER (WHERE state IN ('waiting', 'not_bill') AND entry_id = ${a.entryId} AND reason = 'shop_items')::int AS shop_items,
           coalesce(sum(amount_minor) FILTER (WHERE state IN ('waiting', 'not_bill') AND entry_id = ${a.entryId} AND reason = 'shop_items'), 0)::int AS shop_items_minor,
           count(*) FILTER (WHERE state = 'not_bill' AND entry_id = ${a.entryId} AND reason <> 'shop_items')::int AS not_bill,
           count(*) FILTER (WHERE state = 'recorded')::int AS matched
    FROM gym_square_app_payments
    WHERE gym_id = ${a.gymId} AND environment = ${a.environment} AND account_id = ${a.accountId} AND customer_id = ANY(${ids}::text[])`;
  // A second customer can hold the person's card too: a join of two records moves the card of the one not kept (round one, High 1).
  const card = (await cardOn(sql, a, ids))[0];
  return {
    waiting: counts?.waiting ?? 0,
    waitingMinor: counts?.waiting_minor ?? 0,
    currency: counts?.currency ?? null,
    shopItems: counts?.shop_items ?? 0,
    shopItemsMinor: counts?.shop_items_minor ?? 0,
    notBill: counts?.not_bill ?? 0,
    matched: counts?.matched ?? 0,
    card: card === undefined ? null : { brand: card.brand, last4: card.last4 },
    added: !a.also && (await addsByItself(sql, a)),
  };
}

/** The record's card on file saved on one of these customers. */
async function cardOn(
  sql: SqlOrTx,
  a: { gymId: string; entryId: string; environment: SquareEnvironment; accountId: string },
  ids: readonly string[],
  lock = false,
): Promise<{ card_id: string; brand: string; last4: string }[]> {
  return lock
    ? await sql<{ card_id: string; brand: string; last4: string }[]>`
        SELECT card_id, brand, last4 FROM gym_member_cards
        WHERE gym_id = ${a.gymId} AND entry_id = ${a.entryId} AND environment = ${a.environment} AND account_id = ${a.accountId}
          AND customer_id = ANY(${[...ids]}::text[])
        FOR UPDATE`
    : await sql<{ card_id: string; brand: string; last4: string }[]>`
        SELECT card_id, brand, last4 FROM gym_member_cards
        WHERE gym_id = ${a.gymId} AND entry_id = ${a.entryId} AND environment = ${a.environment} AND account_id = ${a.accountId}
          AND customer_id = ANY(${[...ids]}::text[])`;
}

/** Members in Square adds this record by itself once it has no customer here: the gym's members were added to this Square account
 *  and the record is a current one. */
async function addsByItself(sql: SqlOrTx, a: { gymId: string; entryId: string; environment: SquareEnvironment; accountId: string }): Promise<boolean> {
  const [row] = await sql<{ yes: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM gym_square_member_runs r JOIN gym_member_list_entries e ON e.gym_id = r.gym_id AND e.id = ${a.entryId} AND e.former_at IS NULL
      WHERE r.gym_id = ${a.gymId} AND r.environment = ${a.environment} AND r.account_id = ${a.accountId} AND r.automatic) AS yes`;
  return row?.yes === true;
}

/** What an earlier press with this key did, for the same press sent twice; null where none did. */
export async function unlinkedBefore(
  sql: SqlOrTx,
  a: { gymId: string; entryId: string; environment: SquareEnvironment; customerId: string; requestKey: string },
): Promise<{ accountId: string; moved: number; card: { brand: string; last4: string } | null; added: boolean } | null> {
  const [row] = await sql<{ account_id: string; moved: number; card_brand: string | null; card_last4: string | null; added: boolean }[]>`
    SELECT account_id, moved, card_brand, card_last4, added FROM gym_square_unlinked_customers
    WHERE gym_id = ${a.gymId} AND entry_id = ${a.entryId} AND environment = ${a.environment} AND customer_id = ${a.customerId}
      AND request_key = ${a.requestKey}`;
  if (row === undefined) return null;
  return {
    accountId: row.account_id,
    moved: row.moved,
    card: row.card_brand === null || row.card_last4 === null ? null : { brand: row.card_brand, last4: row.card_last4 },
    added: row.added,
  };
}

export type UnlinkStep =
  | { kind: "gone" }
  | { kind: "changed" }
  | { kind: "busy" }
  | { kind: "unlinked"; also: boolean; moved: number; card: { brand: string; last4: string } | null; disableId: string | null; added: boolean };

/** Unlink, under the gym's lock (the caller's): the link goes, with the old ids it stood for; the person's card on file saved on
 *  that customer goes and is owed its stop at Square; the customer's payments still waiting as the person's are nobody's again
 *  (Square's details of the customer, read just before, kept with them so staff can tell who it is), a sale of shop items among
 *  them a shop sale, as for a customer linked to nobody; it is remembered that staff unlinked them; and where Members in Square
 *  adds members by itself, the person is looked at again on its next minute. `card`: the card the box said is stopped. */
export async function unlinkInStep(
  tx: TransactionSql,
  a: {
    gymId: string;
    entryId: string;
    environment: SquareEnvironment;
    customerId: string;
    card: { brand: string; last4: string } | null;
    seen: { name: string | null; email: string | null; phone: string | null } | null;
    userId: string;
    requestKey: string;
    now: Date;
  },
): Promise<UnlinkStep> {
  const [main] = await tx<{ account_id: string }[]>`
    SELECT account_id FROM gym_square_customers
    WHERE gym_id = ${a.gymId} AND entry_id = ${a.entryId} AND environment = ${a.environment} AND customer_id = ${a.customerId} AND matched_at IS NOT NULL
    FOR UPDATE`;
  const [also] =
    main === undefined
      ? await tx<{ account_id: string }[]>`
          SELECT account_id FROM gym_square_old_customers
          WHERE gym_id = ${a.gymId} AND entry_id = ${a.entryId} AND environment = ${a.environment} AND customer_id = ${a.customerId} AND matched_at IS NOT NULL
          FOR UPDATE`
      : [];
  const accountId = main?.account_id ?? also?.account_id;
  if (accountId === undefined) return { kind: "gone" };
  const at = { gymId: a.gymId, entryId: a.entryId, environment: a.environment, accountId };
  const ids = await idsOf(tx, { ...at, customerId: a.customerId });
  const [card] = await cardOn(tx, at, ids, true);
  // A card saved since the box was read would be stopped unseen: the box is read again.
  if (card !== undefined && (a.card === null || a.card.brand !== card.brand || a.card.last4 !== card.last4)) return { kind: "changed" };
  // Money on its way through Square from that card: it goes once Square has answered.
  if (card !== undefined) {
    const [charging] = await tx<{ id: string }[]>`
      SELECT id FROM gym_card_charges WHERE gym_id = ${a.gymId} AND card_id = ${card.card_id} AND state = 'charging' LIMIT 1`;
    if (charging !== undefined) return { kind: "busy" };
  }

  if (main !== undefined) {
    await tx`
      DELETE FROM gym_square_customers
      WHERE gym_id = ${a.gymId} AND entry_id = ${a.entryId} AND environment = ${a.environment} AND account_id = ${accountId} AND customer_id = ${a.customerId}`;
    // The old ids it was at a merge in Square stood for this customer too.
    await tx`
      DELETE FROM gym_square_old_customers
      WHERE gym_id = ${a.gymId} AND entry_id = ${a.entryId} AND environment = ${a.environment} AND account_id = ${accountId}
        AND customer_id = ANY(${ids}::text[]) AND merged_at IS NOT NULL`;
  } else {
    await tx`
      DELETE FROM gym_square_old_customers
      WHERE gym_id = ${a.gymId} AND entry_id = ${a.entryId} AND environment = ${a.environment} AND account_id = ${accountId}
        AND customer_id = ${a.customerId} AND matched_at IS NOT NULL`;
  }
  let disableId: string | null = null;
  if (card !== undefined) {
    await tx`DELETE FROM gym_member_cards WHERE gym_id = ${a.gymId} AND entry_id = ${a.entryId} AND card_id = ${card.card_id}`;
    const [owed] = await tx<{ id: string }[]>`
      INSERT INTO gym_card_disables (gym_id, environment, account_id, card_id, not_before)
      VALUES (${a.gymId}, ${a.environment}, ${accountId}, ${card.card_id}, ${a.now})
      RETURNING id`;
    disableId = owed?.id ?? null;
  }

  const seen = a.seen;
  const moved = await tx<{ state: string }[]>`
    UPDATE gym_square_app_payments
    SET entry_id = NULL,
        state = CASE WHEN reason = 'shop_items' THEN 'shop_sale' ELSE state END,
        not_bill = CASE WHEN reason = 'shop_items' THEN NULL ELSE not_bill END,
        sale_reason = COALESCE(sale_reason, CASE WHEN reason IN ('mixed_sale', 'sale_unread', 'paid_in_parts', 'square_tax') THEN reason END),
        reason = CASE WHEN reason = 'shop_items' THEN NULL WHEN reason = ANY(${[...ANYBODY_REASONS]}::text[]) THEN reason ELSE 'not_linked' END,
        customer_name = CASE WHEN reason = 'shop_items' THEN NULL ELSE ${seen?.name ?? null}::text END,
        customer_email = CASE WHEN reason = 'shop_items' THEN NULL ELSE ${seen?.email ?? null}::text END,
        customer_phone = CASE WHEN reason = 'shop_items' THEN NULL ELSE ${seen?.phone ?? null}::text END,
        updated_at = ${a.now}
    WHERE gym_id = ${a.gymId} AND environment = ${a.environment} AND account_id = ${accountId} AND customer_id = ANY(${ids}::text[])
      AND entry_id = ${a.entryId} AND state IN ('waiting', 'not_bill')
    RETURNING state`;
  const back = moved.filter((r) => r.state === "waiting").length;

  // No customer here any more: Members in Square, where it adds members by itself, looks at them again on its next minute.
  const added = main !== undefined && (await addsByItself(tx, at));
  await tx`
    INSERT INTO gym_square_unlinked_customers (gym_id, entry_id, environment, account_id, customer_id, unlinked_at, unlinked_by, request_key, moved, added, card_brand, card_last4)
    VALUES (${a.gymId}, ${a.entryId}, ${a.environment}, ${accountId}, ${a.customerId}, ${a.now}, ${a.userId}, ${a.requestKey}, ${back}, ${added},
            ${card?.brand ?? null}, ${card?.last4 ?? null})
    ON CONFLICT (gym_id, environment, account_id, customer_id, entry_id) DO UPDATE SET
      unlinked_at = EXCLUDED.unlinked_at, unlinked_by = EXCLUDED.unlinked_by, request_key = EXCLUDED.request_key,
      moved = EXCLUDED.moved, added = EXCLUDED.added, card_brand = EXCLUDED.card_brand, card_last4 = EXCLUDED.card_last4`;

  if (added) {
    await tx`DELETE FROM gym_square_member_plan WHERE gym_id = ${a.gymId} AND environment = ${a.environment} AND entry_id = ${a.entryId}`;
    await tx`
      UPDATE gym_square_member_runs SET look_due_at = ${a.now}
      WHERE gym_id = ${a.gymId} AND environment = ${a.environment} AND account_id = ${accountId} AND automatic`;
  }
  return { kind: "unlinked", also: main === undefined, moved: back, card: card === undefined ? null : { brand: card.brand, last4: card.last4 }, disableId, added };
}

/** The customers staff unlinked from each of these records (`entryIds` null: every record of the gym), each with the customers
 *  Square has merged it into since: for Members in Square's rule. */
export async function unlinkedAmong(
  sql: SqlOrTx,
  a: { gymId: string; environment: SquareEnvironment; accountId: string; entryIds: readonly string[] | null },
): Promise<Map<string, Set<string>>> {
  const rows = await sql<{ entry_id: string; customer_id: string }[]>`
    SELECT u.entry_id, u.customer_id FROM gym_square_unlinked_customers u
    WHERE u.gym_id = ${a.gymId} AND u.environment = ${a.environment} AND u.account_id = ${a.accountId}
      AND (${a.entryIds === null}::boolean OR u.entry_id = ANY(${[...(a.entryIds ?? [])]}::uuid[]))
    UNION
    SELECT u.entry_id, m.to_customer_id FROM gym_square_unlinked_customers u
    JOIN gym_square_customer_merges m ON m.environment = u.environment AND m.account_id = u.account_id AND m.from_customer_id = u.customer_id
    WHERE u.gym_id = ${a.gymId} AND u.environment = ${a.environment} AND u.account_id = ${a.accountId}
      AND (${a.entryIds === null}::boolean OR u.entry_id = ANY(${[...(a.entryIds ?? [])]}::uuid[]))`;
  const out = new Map<string, Set<string>>();
  for (const r of rows) out.set(r.entry_id, (out.get(r.entry_id) ?? new Set()).add(r.customer_id));
  return out;
}

/** When staff unlinked this customer from this record, or null: Match's tick for them is off whatever the rule says. */
export async function unlinkedAt(sql: SqlOrTx, a: { gymId: string; entryId: string; environment: SquareEnvironment; accountId: string; customerId: string }): Promise<Date | null> {
  const [row] = await sql<{ unlinked_at: Date }[]>`
    SELECT u.unlinked_at FROM gym_square_unlinked_customers u
    WHERE u.gym_id = ${a.gymId} AND u.entry_id = ${a.entryId} AND u.environment = ${a.environment} AND u.account_id = ${a.accountId}
      AND (u.customer_id = ${a.customerId} OR EXISTS (
        SELECT 1 FROM gym_square_customer_merges m
        WHERE m.environment = u.environment AND m.account_id = u.account_id AND m.from_customer_id = u.customer_id AND m.to_customer_id = ${a.customerId}))
    ORDER BY u.unlinked_at DESC
    LIMIT 1`;
  return row?.unlinked_at ?? null;
}

/** Staff ticked Match's link for this person and this customer again: what staff said before no longer stands. */
export async function forgetUnlinked(tx: TransactionSql, a: { gymId: string; entryId: string; environment: SquareEnvironment; accountId: string; customerId: string }): Promise<void> {
  await tx`
    DELETE FROM gym_square_unlinked_customers u
    WHERE u.gym_id = ${a.gymId} AND u.entry_id = ${a.entryId} AND u.environment = ${a.environment} AND u.account_id = ${a.accountId}
      AND (u.customer_id = ${a.customerId} OR EXISTS (
        SELECT 1 FROM gym_square_customer_merges m
        WHERE m.environment = u.environment AND m.account_id = u.account_id AND m.from_customer_id = u.customer_id AND m.to_customer_id = ${a.customerId}))`;
}
