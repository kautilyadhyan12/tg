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
  return {
    items: items.map((r) => ({
      slug: r.slug,
      nameKey: r.nameKey,
      family: r.family,
      // CHECK constraints guarantee these; the response schema re-proves them.
      tier: r.tier as "T1" | "T2" | "T3",
      tracking: r.tracking as "pose" | "timer",
      met: r.met,
      difficulty: r.difficulty,
      equipment: r.equipment,
      muscles: r.muscles,
    })),
    nextCursor: hasMore && last !== undefined ? last.slug : null,
  };
}

const betaRulesSchema = z.object({ userIds: z.array(z.string().uuid()) });
const manifestSchema = z.record(z.string(), z.number().int().positive());

/** §9.3: beta channel only for allowlisted users; anything else — flag
 *  missing, rules malformed, empty — resolves to live. */
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
  if (since !== undefined && since >= row.bundleVersion) {
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
