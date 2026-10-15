// Refer a friend in the database (ROADMAP 20e-ii-a). Every statement names its gym; the
// public reader finds an invite by its code alone, and answers the gym the code is of.
import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";
import { DISCOUNT_KINDS, type DiscountKind } from "@app/shared";

type SqlOrTx = Sql | TransactionSql;

/** The member's gift, off their next payment: a percentage, or an amount in `currency`. */
export interface MemberGift {
  kind: DiscountKind;
  percentBp: number | null;
  amountMinor: number | null;
  currency: string | null;
}

export interface SettingsRow {
  on: boolean;
  member: MemberGift | null;
  friendDiscountId: string | null;
}

export const SETTINGS_OFF: SettingsRow = { on: false, member: null, friendDiscountId: null };

const kindSchema = z.enum(DISCOUNT_KINDS).nullable();

type DbSettings = {
  switched_on: boolean;
  member_gift_kind: string | null;
  member_percent_bp: number | null;
  member_amount_minor: number | null;
  member_currency: string | null;
  friend_discount_id: string | null;
};
const settingsRow = (r: DbSettings): SettingsRow => {
  // Text under a CHECK: parsed, so a kind this build does not know fails here.
  const kind = kindSchema.parse(r.member_gift_kind);
  return {
    on: r.switched_on,
    member: kind === null ? null : { kind, percentBp: r.member_percent_bp, amountMinor: r.member_amount_minor, currency: r.member_currency },
    friendDiscountId: r.friend_discount_id,
  };
};

/** The gym's offer, or off when it has never saved one. */
export async function settingsFor(sql: SqlOrTx, gymId: string): Promise<SettingsRow> {
  const rows = await sql<DbSettings[]>`
    SELECT switched_on, member_gift_kind, member_percent_bp, member_amount_minor, member_currency, friend_discount_id
    FROM gym_referral_settings WHERE gym_id = ${gymId}`;
  const row = rows[0];
  return row === undefined ? SETTINGS_OFF : settingsRow(row);
}

export async function writeSettings(tx: TransactionSql, gymId: string, values: SettingsRow, userId: string, at: Date): Promise<void> {
  const m = values.member;
  await tx`
    INSERT INTO gym_referral_settings (gym_id, switched_on, member_gift_kind, member_percent_bp, member_amount_minor, member_currency,
                                       friend_discount_id, updated_by, updated_at)
    VALUES (${gymId}, ${values.on}, ${m?.kind ?? null}, ${m?.percentBp ?? null}, ${m?.amountMinor ?? null}, ${m?.currency ?? null},
            ${values.friendDiscountId}, ${userId}, ${at})
    ON CONFLICT (gym_id) DO UPDATE
    SET switched_on = EXCLUDED.switched_on, member_gift_kind = EXCLUDED.member_gift_kind,
        member_percent_bp = EXCLUDED.member_percent_bp, member_amount_minor = EXCLUDED.member_amount_minor,
        member_currency = EXCLUDED.member_currency, friend_discount_id = EXCLUDED.friend_discount_id,
        updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`;
}

/** The member's code at this gym, made with `fresh` the first time. Asked twice at once,
 *  both get the one that was kept. */
export async function linkCode(sql: Sql, gymId: string, userId: string, fresh: () => string): Promise<string> {
  const kept = await sql<{ code: string }[]>`SELECT code FROM gym_referral_links WHERE gym_id = ${gymId} AND user_id = ${userId}`;
  if (kept[0] !== undefined) return kept[0].code;
  await sql`
    INSERT INTO gym_referral_links (gym_id, user_id, code) VALUES (${gymId}, ${userId}, ${fresh()})
    ON CONFLICT (gym_id, user_id) DO NOTHING`;
  const rows = await sql<{ code: string }[]>`SELECT code FROM gym_referral_links WHERE gym_id = ${gymId} AND user_id = ${userId}`;
  const row = rows[0];
  if (row === undefined) throw new Error("a referral link was neither kept nor written");
  return row.code;
}

export interface InviteRow {
  gymId: string;
  referrerId: string;
  name: string;
  slug: string;
  city: string | null;
  orgType: string;
  country: string | null;
  timezone: string;
  /** The business has its own page switched on. */
  pageShown: boolean;
  /** The name the member uses in the app: their own, never a list record two accounts may
   *  share. The caller says only its first word. */
  referrerName: string | null;
}

/** The invite a code is, for an open business whose offer is switched on and whose member
 *  it is while they are one; null for anything else. Whether the business is on a plan is
 *  the caller's to ask. */
export async function liveInvite(sql: SqlOrTx, code: string): Promise<InviteRow | null> {
  const rows = await sql<
    {
      gym_id: string;
      user_id: string;
      name: string;
      slug: string;
      city: string | null;
      org_type: string;
      country: string | null;
      timezone: string;
      page_shown: boolean;
      referrer_name: string | null;
    }[]
  >`
    SELECT g.id AS gym_id, l.user_id, g.name, g.slug, g.city, g.org_type, g.country, g.timezone,
           COALESCE((SELECT p.shown FROM gym_pages p WHERE p.gym_id = g.id), false) AS page_shown,
           (SELECT u.display_name FROM users u WHERE u.id = l.user_id AND u.status = 'active') AS referrer_name
    FROM gym_referral_links l
    JOIN gyms g ON g.id = l.gym_id AND g.status = 'active'
    JOIN gym_referral_settings s ON s.gym_id = l.gym_id AND s.switched_on
    WHERE l.code = ${code}
      AND EXISTS (
        SELECT 1 FROM gym_members m JOIN users u ON u.id = m.user_id AND u.status = 'active'
        WHERE m.gym_id = l.gym_id AND m.user_id = l.user_id AND m.removed_at IS NULL
      )`;
  const r = rows[0];
  if (r === undefined) return null;
  return {
    gymId: r.gym_id,
    referrerId: r.user_id,
    name: r.name,
    slug: r.slug,
    city: r.city,
    orgType: r.org_type,
    country: r.country,
    timezone: r.timezone,
    pageShown: r.page_shown,
    referrerName: r.referrer_name,
  };
}

/** The name a member uses in the app, for the line saying what their link shows: their own,
 *  as the invite page shows it. */
export async function memberNameAt(sql: SqlOrTx, userId: string): Promise<string | null> {
  const rows = await sql<{ name: string }[]>`SELECT display_name AS name FROM users WHERE id = ${userId} AND status = 'active'`;
  return rows[0]?.name ?? null;
}

/** The member who sent an invite, as the enquiry's own transaction sees them: still a member
 *  of this gym with the offer still switched on, and how the gym reaches them, so a person
 *  using their own link is not counted as their own friend. Null when either has changed. */
export async function referrerNow(
  tx: TransactionSql,
  gymId: string,
  userId: string,
): Promise<{ email: string | null; statedPhone: string | null } | null> {
  const rows = await tx<{ email: string | null; stated_phone_e164: string | null }[]>`
    SELECT u.email::text AS email, m.stated_phone_e164
    FROM gym_members m
    JOIN users u ON u.id = m.user_id AND u.status = 'active'
    JOIN gym_referral_settings s ON s.gym_id = m.gym_id AND s.switched_on
    WHERE m.gym_id = ${gymId} AND m.user_id = ${userId} AND m.removed_at IS NULL`;
  const r = rows[0];
  return r === undefined ? null : { email: r.email, statedPhone: r.stated_phone_e164 };
}

export interface Inviter {
  /** Null where the account has since been deleted. */
  name: string | null;
  member: boolean;
}

/** The members who sent this gym's leads, by id: the name the gym's own list has for them
 *  where that record is theirs alone (no other live account holds it, and it is not a former
 *  member's; `pt/repo.memberRecord`'s rule), else the name they use in the app. Only people
 *  who sent this gym's leads are asked. */
export async function invitersFor(sql: SqlOrTx, gymId: string, userIds: readonly string[]): Promise<Map<string, Inviter>> {
  if (userIds.length === 0) return new Map();
  const rows = await sql<{ id: string; name: string | null; member: boolean }[]>`
    SELECT u.id,
           CASE WHEN u.status = 'active' THEN COALESCE(NULLIF(btrim(listed.full_name), ''), u.display_name) END AS name,
           EXISTS (SELECT 1 FROM gym_members m WHERE m.gym_id = ${gymId} AND m.user_id = u.id AND m.removed_at IS NULL) AS member
    FROM users u
    LEFT JOIN LATERAL (
      SELECT e.full_name
      FROM gym_members m
      JOIN gym_member_list_entries e ON e.gym_id = m.gym_id AND e.id = m.entry_id AND e.former_at IS NULL
      WHERE m.gym_id = ${gymId} AND m.user_id = u.id AND m.removed_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM gym_members o
          JOIN users ou ON ou.id = o.user_id AND ou.status = 'active'
          WHERE o.gym_id = m.gym_id AND o.entry_id = m.entry_id AND o.user_id <> m.user_id AND o.removed_at IS NULL
        )
      LIMIT 1
    ) listed ON true
    WHERE u.id = ANY(${[...new Set(userIds)]}::uuid[])
      AND EXISTS (SELECT 1 FROM gym_leads l WHERE l.gym_id = ${gymId} AND l.referred_by = u.id)`;
  return new Map(rows.map((r) => [r.id, { name: r.name, member: r.member && r.name !== null }]));
}
