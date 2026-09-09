// Part 4 §5.2 — assembling the user's data export.
//
// The delivery deviation is recorded in packages/shared/src/privacy.ts and in
// DECISIONS: §5.2 describes a zip in object storage behind a signed URL; this
// returns the same CONTENT as JSON from an authenticated endpoint, because
// none of that infrastructure exists and v1 §18 calls it a "data-export
// endpoint". Nothing here would change if the zip arrives later — this
// function produces the payload either way.
import type { Sql } from "postgres";
import { DPDP_EXPORT_SCHEMA_VERSION, type DpdpExport } from "@app/shared";
import { EXPORTED_TABLES, type ExportedTable } from "./tables.js";
import { EXPORT_READERS, selectExportConsents, selectExportUser } from "./exportRepo.js";

/** Columns stripped from EVERY exported row, whatever table it came from.
 *
 *  T3 F5: the users read omits `legacy_mongo_id` as "an internal migration id
 *  that means nothing to the user" — and then `SELECT *` shipped that same
 *  column from seven other tables (coach_threads, meal_logs, runs,
 *  saved_routes, run_schedules, body_measurements, workout_templates). The
 *  code contradicted its own recorded ruling. Applying the principle
 *  everywhere is the fix; dropping the principle was the alternative. */
export const INTERNAL_COLUMNS_EVERYWHERE = ["legacy_mongo_id"] as const;

/** Per-table columns that are OURS, not the user's. Each needs its reason
 *  stated, exactly as `push_tokens` got one — silent inclusion is what the
 *  review caught. */
// KEYED BY ExportedTable, NOT `string` (T3 round 2, F1). The first version of
// this map used a string key — the EXACT defect round 1's F3 raised against
// EXPORT_READERS, re-created inside the fix for F5/F6/F7. Probed: renaming
// the key to `coach_message` left `tsc` at exit 0 and shipped model,
// tokens_in, tokens_out, cost_micro and currency in every user's downloadable
// file, seen only by a suite CI does not run. Typing the key means a rename
// or typo is a BUILD failure (TS2561, "did you mean 'coach_messages'?").
// THE VALUES ARE THE OTHER HALF, and round 3 found the same defect there:
// the column names are bare strings, so `cost_micros` for `cost_micro`
// compiled clean, passed everything CI runs, and shipped our per-request
// cost in every user's file. TypeScript cannot type a column name, so the
// guard is a test that checks these names against the real drizzle schema —
// DB-free, and in the UNGATED describe so CI actually runs it.
export const INTERNAL_COLUMNS_BY_TABLE: Partial<Record<ExportedTable, readonly string[]>> = {
  // T3 F6. `api_cost_events` is excluded from the export on the recorded
  // ground that metering is not user content — and the identical metering
  // rode along on every coach message: our provider, our model choice, and
  // our per-request cost. The message itself (role, content, thread, time) IS
  // the user's and stays. Kd may reverse this; it is flagged in DECISIONS.
  coach_messages: ["model", "tokens_in", "tokens_out", "cost_micro", "currency"],
  // T3 F7. v1 §14.1 / CLAUDE.md P4.y put server-side plausibility results on
  // this column as SILENT metadata ("flag unverified, never a user-facing
  // rejection"; "anti-cheat flags are silent metadata"). Today it only holds
  // 'unknown_exercise', but the day P4.y lands, exporting it publishes each
  // user's anti-cheat verdict TO that user, which is precisely what the spec
  // says must not happen. Cheap to rule now, awkward afterwards.
  workouts: ["quality_flags"],
};

function stripInternal(
  table: ExportedTable,
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const drop = [...INTERNAL_COLUMNS_EVERYWHERE, ...(INTERNAL_COLUMNS_BY_TABLE[table] ?? [])];
  return rows.map((row) => {
    const kept: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) if (!drop.includes(k)) kept[k] = v;
    return kept;
  });
}

export class ExportError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "ExportError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface ExportDeps {
  sql: Sql;
  /** Injected clock, so `exportedAt` is assertable (the R6.4 habit). */
  now?: () => Date;
}

/** Build the export for ONE user.
 *
 *  Drives `EXPORTED_TABLES` — the list derived from §5.2's delete list — so
 *  the export cannot quietly cover fewer tables than the delete does. A table
 *  on the list with no reader is a THROWN error, not a silently missing key:
 *  an export that omits a table is a compliance failure, and the loud version
 *  is the only one anybody notices. Every table appears in the output, with an
 *  empty array when the user has no rows, so "no data" is distinguishable from
 *  "not exported".
 *
 *  Reads run sequentially: an export is a rare, rate-limited request, and
 *  serial reads keep it from being a way to open 17 concurrent connections.
 *
 *  THE ACCEPTED CEILING, amended (T3 round 2, F3 — round 1's F8 priced this
 *  without the pool). app.ts builds `postgres(url, { max: 1 })`: ONE
 *  connection per API process. So an export does not merely cost memory and
 *  event-loop time — it SERIALISES the process's only connection for all 18
 *  round trips, and every other in-flight request queues behind it. Bounded
 *  today by the 3/hour per-user cap and by §6's sizing (~120 KB/user·month
 *  heavy, so a two-year user is ~3 MB), and prod serves nobody yet. The
 *  trigger that moves this to §5.2's worker form is now explicit: a real
 *  user's export approaching tens of MB, OR the pool staying at max:1 once
 *  the API serves concurrent traffic. Kd's call, recorded not silently
 *  changed. */
export async function buildUserExport(deps: ExportDeps, userId: string): Promise<DpdpExport> {
  const user = await selectExportUser(deps.sql, userId);
  // The route authenticates first, so this is a deleted/vanished account
  // racing the request rather than an unauthenticated caller.
  if (user === null) throw new ExportError(404, "not_found", "Account not found");

  const data: Record<string, Record<string, unknown>[]> = {};
  for (const table of EXPORTED_TABLES) {
    // No runtime "missing reader" guard any more, and that is the FIX not an
    // omission (T3 F3): EXPORT_READERS is keyed by ExportedTable, so a table
    // added to the list without a reader now fails `tsc` — which CI runs —
    // instead of throwing a 500 on every user's export, which only a
    // DATABASE_URL-gated test would have caught and CI does not run it.
    data[table] = stripInternal(table, await EXPORT_READERS[table](deps.sql, userId));
  }
  // The consent log is the person's own record of what they agreed to, exported
  // although it is kept after a purge (tables.ts, 2026-09-09). Keyed by its real
  // table name like the rest, so the two lists still read side by side.
  data["consent_log"] = await selectExportConsents(deps.sql, userId);

  return {
    exportedAt: (deps.now?.() ?? new Date()).toISOString(),
    schemaVersion: DPDP_EXPORT_SCHEMA_VERSION,
    user,
    data,
  };
}
