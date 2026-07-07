// Part 2 §2.3 — session inputs.
import { z } from "zod";

// The resolved ExerciseDefinition arrives already parsed and lint-validated.
// Its full schema is task P1.7 (Part 2 §4); until then it crosses as unknown
// and tightens there — engine code never trusts it unvalidated.
export const sessionInputSchema = z
  .object({
    definition: z.unknown(),
    // Optional carry-over calibration from a previous set of the same exercise
    // in the same workout (set 2 doesn't recalibrate — §2.3).
    carryOverCalibration: z.record(z.string(), z.unknown()).optional(),
    // Reserved profile-hint block (height, mobility limitations) — v2
    // territory, ignored by engine v1 (§2.3).
    profileHints: z
      .object({
        heightCm: z.number().positive().optional(),
        mobilityLimitations: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type SessionInput = z.infer<typeof sessionInputSchema>;
