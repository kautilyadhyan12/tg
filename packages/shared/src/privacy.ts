// Part 4 §5.2 — the DPDP data-export contract (R7.2: every shape lives once).
//
// §5.2 names two rights: the Day-14 hard delete (shipped, apps/api
// modules/privacy) and this, the export. DEVIATION ON DELIVERY, Kd-ruled
// 2026-07-23: §5.2 describes "a JSON zip … delivered via signed URL, 7-day
// expiry", and this returns JSON directly from an authenticated endpoint
// instead. v1 §18 independently calls it a "data-export endpoint"; the zip
// form needs R2 credentials plus two dependencies that this repo does not
// have (command-verified). The CONTENT is identical either way, which is the
// point — adding signed-URL delivery later changes how it is sent, never
// what is in it.
import { z } from "zod";

/** Bump when the envelope's SHAPE changes (not when a table's columns do) —
 *  a downstream re-importer needs to know which layout it is reading.
 *  2 (2026-09-09): `truncated` joined the envelope, always present. Version 1
 *  files stay readable — every key they had is still where it was — but a
 *  reader that wants to know whether a list was cut needs to know which
 *  layout it holds, which is exactly what this number is for. */
export const DPDP_EXPORT_SCHEMA_VERSION = 2;

/** The export envelope.
 *
 *  `data` is keyed by REAL TABLE NAME, deliberately. §5.2 defines the export
 *  as "every user-owned table above + profile" — the same list the Day-14
 *  delete walks — so keeping the table names verbatim is what lets a reviewer
 *  hold the two lists side by side and see that they agree. That auditability
 *  is worth more here than camelCase prettiness, and it is why the build note
 *  (DECISIONS 2026-07-21) asked for "a table LIST, not a bespoke format".
 *
 *  Rows are `z.unknown()` records ON PURPOSE and this is NOT laxity: they are
 *  database rows, not an API contract any client is typed against. Restating
 *  17 tables' columns here would duplicate the DDL, drift from it silently,
 *  and add a second place to forget a column. The API is the only producer
 *  and the user is the consumer. (The z.record precedent is established in
 *  definition.ts and events.ts.) */
export const dpdpExportSchema = z.object({
  exportedAt: z.string(),
  schemaVersion: z.literal(DPDP_EXPORT_SCHEMA_VERSION),
  /** The users-row view. Explicitly enumerated server-side — never SELECT * —
   *  so a future column cannot leak credentials into a downloadable file. */
  user: z.record(z.string(), z.unknown()),
  /** tableName -> its rows for this user. Every exported table is present,
   *  with an EMPTY ARRAY when the user has no rows: a missing key would be
   *  indistinguishable from "we forgot to export that table". */
  data: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  /** tableName -> what the file carries and what exists, for any read that hit
   *  a server cap. ALWAYS PRESENT and usually `{}`, for the same reason `data`
   *  keeps empty arrays: a missing key cannot be told apart from "nothing was
   *  cut". A capped list must never pass for the whole record — the rule the
   *  consent list route follows with its `total`, applied to the file a person
   *  downloads and keeps. */
  truncated: z.record(
    z.string(),
    z
      .object({
        returned: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
      })
      .strict()
      .refine((t) => t.returned < t.total, {
        message: "an entry here means rows were cut; equal counts are not a truncation",
      }),
  ),
});

export type DpdpExport = z.infer<typeof dpdpExportSchema>;
