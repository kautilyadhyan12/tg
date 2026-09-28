// A gym's own page in the database (ROADMAP 20c-iv-a). Every statement names its gym;
// the public reader finds it by the slug in the page's address.
import type { Sql, TransactionSql } from "postgres";

type SqlOrTx = Sql | TransactionSql;

export interface PageRow {
  shown: boolean;
  about: string;
  /** As stored; the service keeps only the facilities it knows. */
  facilities: string[];
  /** The gym's own, in the order it added them. */
  ownFacilities: string[];
}

export const EMPTY_PAGE: PageRow = { shown: false, about: "", facilities: [], ownFacilities: [] };

/** The gym's page, or null when it has never been saved. */
export async function pageFor(sql: SqlOrTx, gymId: string): Promise<PageRow | null> {
  const rows = await sql<{ shown: boolean; about: string; facilities: string[]; own_facilities: string[] }[]>`
    SELECT shown, about, facilities, own_facilities FROM gym_pages WHERE gym_id = ${gymId}`;
  const row = rows[0];
  return row === undefined ? null : { shown: row.shown, about: row.about, facilities: row.facilities, ownFacilities: row.own_facilities };
}

export async function writePage(tx: TransactionSql, gymId: string, page: PageRow, at: Date): Promise<void> {
  await tx`
    INSERT INTO gym_pages (gym_id, shown, about, facilities, own_facilities, updated_at)
    VALUES (${gymId}, ${page.shown}, ${page.about}, ${page.facilities}::text[], ${page.ownFacilities}::text[], ${at})
    ON CONFLICT (gym_id) DO UPDATE
    SET shown = EXCLUDED.shown, about = EXCLUDED.about, facilities = EXCLUDED.facilities,
        own_facilities = EXCLUDED.own_facilities, updated_at = EXCLUDED.updated_at`;
}

// ── PHOTOS (20c-iv-b) ─────────────────────────────────────────────────────────

export interface PhotoRow {
  id: string;
  storageKey: string;
  contentType: string;
  width: number;
  height: number;
}

/** A gym's photos in the page's order. */
export async function photosFor(sql: SqlOrTx, gymId: string): Promise<PhotoRow[]> {
  const rows = await sql<{ id: string; storage_key: string; content_type: string; width: number; height: number }[]>`
    SELECT id, storage_key, content_type, width, height
    FROM gym_page_photos WHERE gym_id = ${gymId}
    ORDER BY position`;
  return rows.map((r) => ({ id: r.id, storageKey: r.storage_key, contentType: r.content_type, width: r.width, height: r.height }));
}

/** One of this gym's photos, or null — never another gym's. */
export async function photoOf(sql: SqlOrTx, gymId: string, photoId: string): Promise<PhotoRow | null> {
  const rows = await sql<{ id: string; storage_key: string; content_type: string; width: number; height: number }[]>`
    SELECT id, storage_key, content_type, width, height
    FROM gym_page_photos WHERE gym_id = ${gymId} AND id = ${photoId}`;
  const r = rows[0];
  return r === undefined ? null : { id: r.id, storageKey: r.storage_key, contentType: r.content_type, width: r.width, height: r.height };
}

export async function insertPhoto(
  tx: TransactionSql,
  gymId: string,
  photo: { id: string; storageKey: string; contentType: string; byteSize: number; width: number; height: number; position: number },
  addedBy: string,
  at: Date,
): Promise<void> {
  await tx`
    INSERT INTO gym_page_photos (id, gym_id, storage_key, content_type, byte_size, width, height, position, added_by, created_at)
    VALUES (${photo.id}, ${gymId}, ${photo.storageKey}, ${photo.contentType}, ${photo.byteSize},
            ${photo.width}, ${photo.height}, ${photo.position}, ${addedBy}, ${at})`;
}

/** Deletes one of this gym's photos; its store key, or null when it had none. */
export async function deletePhoto(tx: TransactionSql, gymId: string, photoId: string): Promise<string | null> {
  const rows = await tx<{ storage_key: string }[]>`
    DELETE FROM gym_page_photos WHERE gym_id = ${gymId} AND id = ${photoId} RETURNING storage_key`;
  return rows[0]?.storage_key ?? null;
}

/** Numbers this gym's photos 0, 1, 2… in the order given, which is every photo it has.
 *  The position rule is checked at commit, so two photos can swap places. */
export async function setPhotoOrder(tx: TransactionSql, gymId: string, photoIds: readonly string[]): Promise<void> {
  const positions = photoIds.map((_, i) => i);
  await tx`
    UPDATE gym_page_photos p SET position = o.position
    FROM unnest(${photoIds}::uuid[], ${positions}::int[]) AS o(id, position)
    WHERE p.gym_id = ${gymId} AND p.id = o.id`;
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
      own_facilities: string[];
    }[]
  >`
    SELECT g.id AS gym_id, g.name, g.city, g.org_type, g.country, g.timezone,
           p.about, p.facilities, p.own_facilities
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
    ownFacilities: row.own_facilities,
  };
}
