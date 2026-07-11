// v1 §5.3 — POST /v1/workouts/sync payload: the ENTIRE workout data contract.
// sets[] carries the full Part 2 §2.4 SetSummary: §2.4 declares SetSummary
// "the only thing that leaves the device", Part 2 §10's done-gate requires the
// sync payload to byte-match §2.4, and Part 4 §3.5 persists engine_version/
// definition_version per set — so the abbreviated example in v1 §5.3 is
// superseded (later, more specific part wins; recorded in DECISIONS.md).
import { z } from "zod";
import { INT4_MAX, SMALLINT_MAX, setSummarySchema } from "./events.js";

export const workoutSyncPayloadSchema = z
  .object({
    workoutId: z.string().uuid(), // client-generated: THE idempotency key (Part 4 §3.5)
    startedAt: z.string().datetime({ offset: true }),
    platform: z.enum(["web", "android", "ios"]),
    engineVersion: z.string(),
    defsVersion: z.number().int().positive().max(INT4_MAX), // bundle_version (Part 4 §3.4, int)
    sets: z
      .array(setSummarySchema)
      // min: an all-log-only workout is never synced (DECISIONS 2026-07-10) —
      // an empty engine workout must not be creatable server-side either.
      .min(1)
      // max: sets_count lands in smallint (Part 4 §3.5); the practical cap is
      // the HTTP body limit, this is the type-safety ceiling.
      .max(SMALLINT_MAX)
      // (workout_id, set_index) is the upsert key (Part 4 §3.5): duplicate
      // setIndex would silently drop rows under ON CONFLICT DO NOTHING and
      // desync the server-derived aggregates (P1.10d T3) — reject instead.
      .superRefine((sets, ctx) => {
        const seen = new Set<number>();
        for (const s of sets) {
          if (seen.has(s.setIndex)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `duplicate setIndex ${String(s.setIndex)}`,
            });
          }
          seen.add(s.setIndex);
        }
      }),
    traceSample: z.string().nullable(), // occasionally a compressed keypoint clip (v1 §14)
  })
  .strict();
export type WorkoutSyncPayload = z.infer<typeof workoutSyncPayloadSchema>;
