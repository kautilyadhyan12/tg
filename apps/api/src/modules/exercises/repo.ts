// P2.2 — exercises repo: the ONLY file that touches exercises /
// exercise_definitions / definition_bundles for serving (v1 §6.2, R4.6), plus
// the feature_flags read for the §9.3 beta gate (flags are a platform table
// with no owning module yet — flagged in the task report). Catalog and
// bundles are GLOBAL resources (Part 4 §3.4) — no tenant column exists, so
// no tenancy WHERE applies (R3.2 n/a by design, stated not skipped).
// Definition rows are read-only here: published definitions are immutable
// (R5.7) and this module ships no write path (publishing = P4).
import type { Sql } from "postgres";

export interface CatalogRow {
  slug: string;
  nameKey: string;
  family: string;
  tier: string;
  tracking: string;
  met: number;
  difficulty: number | null;
  equipment: string[] | null;
  muscles: string[] | null;
}

/** Keyset pagination by unique slug (R7.3): fetches limit+1 so the service
 *  can tell whether a next page exists without a COUNT. */
export async function listLiveExercises(
  sql: Sql,
  input: { limit: number; cursor: string | null },
): Promise<CatalogRow[]> {
  const rows = await sql<
    {
      slug: string;
      name_key: string;
      family: string;
      tier: string;
      tracking: string;
      met: string;
      difficulty: number | null;
      equipment: string[] | null;
      muscles: string[] | null;
    }[]
  >`
    SELECT slug, name_key, family, tier, tracking, met, difficulty, equipment, muscles
    FROM exercises
    WHERE status = 'live'
      AND (${input.cursor}::text IS NULL OR slug > ${input.cursor})
    ORDER BY slug ASC
    LIMIT ${input.limit + 1}`;
  return rows.map((r) => ({
    slug: r.slug,
    nameKey: r.name_key,
    family: r.family,
    tier: r.tier,
    tracking: r.tracking,
    met: Number(r.met),
    difficulty: r.difficulty,
    equipment: r.equipment,
    muscles: r.muscles,
  }));
}

export interface BundleRow {
  bundleVersion: number;
  channel: string;
  sha256: string;
  manifest: unknown; // jsonb — Zod-parsed at the service boundary (R2.3)
}

/** The newest bundle for a channel is what clients download (Part 2 §9.3);
 *  rollback = a NEW row built from previous versions, so max(bundle_version)
 *  is always the intended pointer. */
export async function latestBundle(sql: Sql, channel: "live" | "beta"): Promise<BundleRow | null> {
  const rows = await sql<
    { bundle_version: number; channel: string; sha256: string; manifest: unknown }[]
  >`
    SELECT bundle_version, channel, sha256, manifest
    FROM definition_bundles
    WHERE channel = ${channel}
    ORDER BY bundle_version DESC
    LIMIT 1`;
  const r = rows[0];
  if (r === undefined) return null;
  return {
    bundleVersion: r.bundle_version,
    channel: r.channel,
    sha256: r.sha256,
    manifest: r.manifest,
  };
}

export interface DefinitionDocRow {
  slug: string;
  version: number;
  definition: unknown; // jsonb — Zod-parsed at the service boundary (R2.3)
}

/** All stored versions for the given slugs; the service picks the manifest's
 *  exact (slug, version) pairs. */
export async function findDefinitions(sql: Sql, slugs: string[]): Promise<DefinitionDocRow[]> {
  if (slugs.length === 0) return [];
  const rows = await sql<{ slug: string; version: number; definition: unknown }[]>`
    SELECT e.slug, d.version, d.definition
    FROM exercise_definitions d
    JOIN exercises e ON e.id = d.exercise_id
    WHERE e.slug = ANY(${slugs})`;
  return rows.map((r) => ({ slug: r.slug, version: r.version, definition: r.definition }));
}

/** feature_flags.rules for one key; null = flag row absent. */
export async function getFlagRules(sql: Sql, key: string): Promise<unknown> {
  const rows = await sql<{ rules: unknown }[]>`
    SELECT rules FROM feature_flags WHERE key = ${key}`;
  return rows[0]?.rules ?? null;
}
