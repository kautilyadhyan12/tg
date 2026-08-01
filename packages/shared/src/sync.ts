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
    /** THE ENGINE BUILD THE CLIENT WAS RUNNING — not "the engine that scored
     *  this workout" (T3 round 1 F3, Kd ruled option A on 2026-08-01).
     *
     *  The distinction is the whole fix. Read the old way, an all-log-only
     *  workout had to name an engine that never ran, and the API card's own test
     *  papered over it by hardcoding "1.0.0" — the fabrication deleted at set
     *  level, performed at workout level by the fixture. Read this way the field
     *  is a true statement about the CLIENT, which is knowable whether or not
     *  anything was scored, so nothing has to be invented. Per-set provenance is
     *  where "what scored this set" lives, and it is nullable there.
     *
     *  `.min(1)` for the same reason as the per-set field: an empty string is
     *  not a version, and accepting one would restore the hollow claim F6 closed. */
    engineVersion: z.string().min(1),
    /** bundle_version (Part 4 §3.4/§3.5) — NULLABLE, matching the spec DDL,
     *  which declares `bundle_version int` with no NOT NULL while this schema
     *  had been demanding a positive int. A client with no definition bundle
     *  loaded (every all-log-only workout) has no bundle version to report, and
     *  `1` would be a lie about which bundle produced it. No migration: the
     *  column already allows null. */
    defsVersion: z.number().int().positive().max(INT4_MAX).nullable(),
    sets: z
      .array(setSummarySchema)
      // min: a workout with NO sets at all is still not creatable — the reps
      // have to come from somewhere. This is no longer the all-log-only bar it
      // was in DECISIONS 2026-07-10: log-only sets are expressible now, so an
      // all-log-only workout satisfies this with real sets.
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
