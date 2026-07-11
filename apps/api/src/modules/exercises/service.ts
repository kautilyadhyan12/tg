// P2.2 — exercises service: catalog reads + definition-bundle serving
// (v1 §5.2/§6.1; Part 2 §9.3). Beta gate per §9.3: "beta definitions are
// included only for flagged users … one feature flag" — the beta_definitions
// flag's rules are a {"userIds": [...]} allowlist (GAP-3 ruling, DECISIONS
// P2.2), safeParse'd with default-to-live: a malformed flag can never widen
// access or 500 a read path.
import type { Sql } from "postgres";
import { z } from "zod";
import * as repo from "./repo.js";
import {
  bundleResponseSchema,
  catalogPageSchema,
  type CatalogListQuery,
  type CatalogPage,
  type DefinitionBundle,
} from "./schemas.js";

export interface ExercisesDeps {
  sql: Sql;
}

export async function getCatalogPage(
  deps: ExercisesDeps,
  query: CatalogListQuery,
): Promise<CatalogPage> {
  const rows = await repo.listLiveExercises(deps.sql, {
    limit: query.limit,
    cursor: query.cursor ?? null,
  });
  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;
  const last = items[items.length - 1];
  // parse, don't cast (R2.3/R2.2; T3 2026-07-11 finding 2): DB rows are
  // outside the type system — the shared schema runtime-proves tier/tracking
  // (the CHECK constraints make failure impossible unless the DB drifted,
  // which is exactly when we WANT the 500).
  return catalogPageSchema.parse({
    items,
    nextCursor: hasMore && last !== undefined ? last.slug : null,
  });
}

const betaRulesSchema = z.object({ userIds: z.array(z.string().uuid()) });
const manifestSchema = z.record(z.string(), z.number().int().positive());

/** §9.3: beta channel only for allowlisted users; anything else — flag
 *  missing, rules malformed, empty — resolves to live. Beta is a WHOLE-bundle
 *  swap: beta bundles must be authored as supersets of live (DECISIONS
 *  2026-07-11, T3 finding 3; enforced by P4 publishing tooling). */
export async function resolveChannel(deps: ExercisesDeps, userId: string): Promise<"live" | "beta"> {
  const rules = await repo.getFlagRules(deps.sql, "beta_definitions");
  const parsed = betaRulesSchema.safeParse(rules);
  if (!parsed.success) return "live";
  return parsed.data.userIds.includes(userId) ? "beta" : "live";
}

export type BundleResult =
  | { kind: "none" } // no bundle published yet (fresh environment)
  | { kind: "not_modified"; bundleVersion: number; sha256: string }
  | { kind: "bundle"; bundle: DefinitionBundle };

/** Assembles the client bundle from the newest row of the user's channel.
 *  `since` = the bundle_version the client holds (v1 §5.2). The stored rows
 *  are jsonb → external input: the assembled bundle is parsed through the
 *  shared schema (R2.3); a failure is an integration error (5xx), never a
 *  silently-served corrupt bundle. Beta users fall back to live when no beta
 *  bundle exists. */
export async function getBundle(
  deps: ExercisesDeps,
  userId: string,
  since: number | undefined,
): Promise<BundleResult> {
  const channel = await resolveChannel(deps, userId);
  let row = await repo.latestBundle(deps.sql, channel);
  if (row === null && channel === "beta") row = await repo.latestBundle(deps.sql, "live");
  if (row === null) return { kind: "none" };
  // EXACT match only (T3 2026-07-11 finding 1): bundle_version is ONE global
  // identity sequence across BOTH channels, so >= would strand a client whose
  // channel flipped (e.g. unflagged from beta holding beta v6 vs live v5 —
  // permanent 304 on stale content). Same-channel monotonicity still holds:
  // a newer row of this channel always has a larger version, so equality is
  // exactly "you already hold this channel's newest".
  if (since !== undefined && since === row.bundleVersion) {
    return { kind: "not_modified", bundleVersion: row.bundleVersion, sha256: row.sha256 };
  }

  const manifest = manifestSchema.parse(row.manifest);
  const slugs = Object.keys(manifest);
  const docs = await repo.findDefinitions(deps.sql, slugs);
  const definitions = slugs.map((slug) => {
    const wanted = manifest[slug];
    const doc = docs.find((d) => d.slug === slug && d.version === wanted);
    if (doc === undefined) {
      throw new Error(`bundle ${String(row.bundleVersion)} manifest points at missing ${slug}@${String(wanted)}`);
    }
    return doc.definition;
  });

  const bundle = bundleResponseSchema.parse({
    bundleVersion: row.bundleVersion,
    channel: row.channel,
    sha256: row.sha256,
    manifest,
    definitions,
  });
  return { kind: "bundle", bundle };
}
