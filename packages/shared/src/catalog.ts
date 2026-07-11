// P2.2 — exercise catalog read contracts (v1 §6.1 exercises module; Part 4
// §3.4 columns). The definition-bundle transport shape itself lives in
// definition.ts (definitionBundleSchema) — reused here, not duplicated (R7.2).
import { z } from "zod";
import { definitionBundleSchema } from "./definition.js";

/** One catalog row as clients see it. `met` is numeric(5.2→3,1) in PG,
 *  transported as a number; status is omitted — list endpoints serve only
 *  'live' rows (Part 4 §3.4), so it would always be the same value. */
export const exerciseCatalogItemSchema = z.object({
  slug: z.string(),
  nameKey: z.string(),
  family: z.string(),
  tier: z.enum(["T1", "T2", "T3"]),
  tracking: z.enum(["pose", "timer"]),
  met: z.number(),
  difficulty: z.number().int().nullable(),
  equipment: z.array(z.string()).nullable(),
  muscles: z.array(z.string()).nullable(),
});
export type ExerciseCatalogItem = z.infer<typeof exerciseCatalogItemSchema>;

/** Cursor pagination (R7.3): cursor = last slug of the previous page
 *  (exercises are keyset-ordered by unique slug). z.coerce per Part IV #5. */
export const catalogListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(200).optional(),
  })
  .strict();
export type CatalogListQuery = z.infer<typeof catalogListQuerySchema>;

export const catalogPageSchema = z.object({
  items: z.array(exerciseCatalogItemSchema),
  nextCursor: z.string().nullable(),
});
export type CatalogPage = z.infer<typeof catalogPageSchema>;

/** GET /v1/exercise-definitions?since=<version> (v1 §5.2, Part 2 §9.3).
 *  since = the bundle_version the client already holds; current → 304. */
export const bundleQuerySchema = z
  .object({ since: z.coerce.number().int().positive().optional() })
  .strict();
export type BundleQuery = z.infer<typeof bundleQuerySchema>;

export const bundleResponseSchema = definitionBundleSchema;
