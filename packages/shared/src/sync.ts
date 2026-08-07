// v1 §5.3 — POST /v1/workouts/sync payload: the ENTIRE workout data contract.
// sets[] carries the full Part 2 §2.4 SetSummary: §2.4 declares SetSummary
// "the only thing that leaves the device", Part 2 §10's done-gate requires the
// sync payload to byte-match §2.4, and Part 4 §3.5 persists engine_version/
// definition_version per set — so the abbreviated example in v1 §5.3 is
// superseded (later, more specific part wins; recorded in DECISIONS.md).
import { z } from "zod";
import { INT4_MAX, SMALLINT_MAX, setSummarySchema } from "./events.js";
import { instantSchema } from "./time.js";

/** Ceiling for second-denominated payload fields whose ms form lands in an
 *  int4 column: floor(2_147_483_647 / 1000). A value Zod passed but PG
 *  overflowed would 500, which the client's R10.3 retry policy reads as
 *  transient — a poison payload halting the queue forever (the P1.10d T3
 *  lesson, applied to the fields added 2026-08-07). */
const INT4_SECONDS_MAX = Math.floor(INT4_MAX / 1000);

export const workoutSyncPayloadSchema = z
  .object({
    workoutId: z.string().uuid(), // client-generated: THE idempotency key (Part 4 §3.5)
    // THE CLASS, not just the case (the lesson this repo has recorded four
    // times). The T3 on `b80bd3c` found `datetime({ offset: true })` admitting
    // an offset JS cannot parse; a grep for that option found exactly two sites
    // and this is the other one. Here the unparseable value is passed on as a
    // timestamptz rather than to `new Date` — but it never reaches Postgres:
    // the DRIVER converts it in its own bind step and throws the same
    // `RangeError: Invalid time value`, at the same layer as the list path,
    // from a different call site. (Corrected in place 2026-08-04, T3 round 2
    // F3 — this comment first said "one layer further out", which was reasoned
    // rather than measured. Postgres itself accepts offsets to +15:59; the
    // string never gets that far.) Not fixed because a route was seen to break,
    // fixed because the parser's guarantee was the thing that was false.
    startedAt: instantSchema,
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
    /** The on-screen workout timer, in WHOLE SECONDS — Kd-ruled payload
     *  addition (2026-08-07; the "ruled payload change" DECISIONS P2.3 GAP-2
     *  said rest calories were waiting for). Two properties define it and both
     *  are load-bearing:
     *  - it counts only workout-phase time: PAUSE STOPS IT, rest breaks are
     *    NOT in it (they travel separately below);
     *  - it is a CLIENT MEASUREMENT the server cannot observe or re-derive —
     *    same class as rep counts (v1 §14 nuance to R3.1), bounded here and
     *    plausibility-checked at P4.y like everything else the client reports.
     *  OPTIONAL: payloads queued before this card exist and must keep syncing;
     *  absent → the server keeps deriving duration as Σ set spans, byte-for-
     *  byte today's behaviour. Bound: lands in `duration_ms` int4, so
     *  ≤ floor(INT4_MAX / 1000). */
    durationSeconds: z.number().int().positive().max(INT4_SECONDS_MAX).optional(),
    /** Accumulated rest-break seconds (the client's rest-phase counter).
     *  Feeds the kcal v2 rest term at REST_MET 1.8 (calories.py:85, the
     *  constant DECISIONS P2.3 GAP-2 deferred). Its PRESENCE is what selects
     *  the v2 formula server-side — the client that understands this
     *  accounting always sends it, 0 included; older queued payloads lack it
     *  and get the v1 formula + stamp unchanged. */
    restSeconds: z.number().int().nonnegative().max(INT4_SECONDS_MAX).optional(),
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
