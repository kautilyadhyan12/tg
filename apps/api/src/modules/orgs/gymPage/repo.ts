// A gym's own page in the database (ROADMAP 20c-iv-a). Every statement names its gym;
// the public reader finds it by the slug in the page's address.
import type { Sql, TransactionSql } from "postgres";

type SqlOrTx = Sql | TransactionSql;

export interface PageRow {
  shown: boolean;
  about: string;
  /** As stored; the service keeps only the facilities it knows. */
  facilities: string[];
  otherFacilities: string;
}

export const EMPTY_PAGE: PageRow = { shown: false, about: "", facilities: [], otherFacilities: "" };

/** The gym's page, or null when it has never been saved. */
export async function pageFor(sql: SqlOrTx, gymId: string): Promise<PageRow | null> {
  const rows = await sql<{ shown: boolean; about: string; facilities: string[]; other_facilities: string }[]>`
    SELECT shown, about, facilities, other_facilities FROM gym_pages WHERE gym_id = ${gymId}`;
  const row = rows[0];
  return row === undefined ? null : { shown: row.shown, about: row.about, facilities: row.facilities, otherFacilities: row.other_facilities };
}

export async function writePage(tx: TransactionSql, gymId: string, page: PageRow, at: Date): Promise<void> {
  await tx`
    INSERT INTO gym_pages (gym_id, shown, about, facilities, other_facilities, updated_at)
    VALUES (${gymId}, ${page.shown}, ${page.about}, ${page.facilities}::text[], ${page.otherFacilities}, ${at})
    ON CONFLICT (gym_id) DO UPDATE
    SET shown = EXCLUDED.shown, about = EXCLUDED.about, facilities = EXCLUDED.facilities,
        other_facilities = EXCLUDED.other_facilities, updated_at = EXCLUDED.updated_at`;
}

export interface ShownPageRow extends PageRow {
  gymId: string;
  name: string;
  city: string | null;
  orgType: string;
  country: string | null;
  timezone: string;
}

/** A page that is switched on, of a gym that is open, by the slug in its address. */
export async function shownPageBySlug(sql: SqlOrTx, slug: string): Promise<ShownPageRow | null> {
  const rows = await sql<
    {
      gym_id: string;
      name: string;
      city: string | null;
      org_type: string;
      country: string | null;
      timezone: string;
      about: string;
      facilities: string[];
      other_facilities: string;
    }[]
  >`
    SELECT g.id AS gym_id, g.name, g.city, g.org_type, g.country, g.timezone,
           p.about, p.facilities, p.other_facilities
    FROM gyms g
    JOIN gym_pages p ON p.gym_id = g.id
    WHERE g.slug = ${slug} AND p.shown AND g.status = 'active'`;
  const row = rows[0];
  if (row === undefined) return null;
  return {
    gymId: row.gym_id,
    name: row.name,
    city: row.city,
    orgType: row.org_type,
    country: row.country,
    timezone: row.timezone,
    shown: true,
    about: row.about,
    facilities: row.facilities,
    otherFacilities: row.other_facilities,
  };
}
