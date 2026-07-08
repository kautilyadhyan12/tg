// Part 2 §2.3 — session inputs.
import { z } from "zod";
import { exerciseDefinitionSchema } from "./definition.js";

// The resolved ExerciseDefinition arrives already parsed and lint-validated
// (§4 schema, P1.7).
export const sessionInputSchema = z
  .object({
    definition: exerciseDefinitionSchema,
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
