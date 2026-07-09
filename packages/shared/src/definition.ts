// Part 2 §4 — the Exercise Definition schema, field by field. One definition
// = one exercise = one JSON document, lint-validated (§9.2) before publish.
// The engine consumes the compiled form; this is the authoring/transport shape.
import { z } from "zod";

// §3.4 signal library v1 names (22 signals; cadence is FSM-derived).
export const SIGNAL_NAMES = [
  "knee_L", "knee_R", "hip_L", "hip_R", "elbow_L", "elbow_R",
  "shoulder_L", "shoulder_R", "knee_avg",
  "trunk_incline", "shin_incline",
  "valgus_L", "valgus_R", "valgus_delta_L", "valgus_delta_R",
  "hip_elevation", "ankle_elevation",
  "body_line", "elbow_under_shoulder",
  "cadence", "stillness",
  "symmetry_knee", "symmetry_elbow",
] as const;
export const signalNameSchema = z.enum(SIGNAL_NAMES);
export type DefinitionSignalName = z.infer<typeof signalNameSchema>;

const viewSchema = z.enum(["front", "side"]);

// §3.5 calibration module refs + params (§4 calibration row).
const calibrationRefSchema = z.discriminatedUnion("module", [
  z.object({ module: z.literal("standing_baseline") }).strict(),
  z
    .object({
      module: z.literal("adaptive_target"),
      clamp: z.tuple([z.number(), z.number()]),
      fallback: z.number(),
      observeReps: z.number().int().positive().default(2),
    })
    .strict(),
  z
    .object({
      module: z.literal("floor_reference"),
      stillnessThreshold: z.number().positive(), // ⚙ definition-declared (no engine default)
    })
    .strict(),
]);

// §3.7 fault rule — data, verbatim shape.
export const faultRuleSchema = z
  .object({
    id: z.string().min(1),
    view: viewSchema.optional(),
    phase: z.array(z.string().min(1)).min(1).optional(),
    when: z.string().min(1),
    sustainMs: z.number().int().nonnegative().default(0),
    perRep: z.boolean().optional(),
    severity: z.number().int().min(1).max(100),
    severe: z.string().min(1).optional(),
    msg: z.string().min(1),
    cueCooldownMs: z.number().int().nonnegative().optional(),
  })
  .strict();

// §3.8 scoring component. `input` may be a signal, a rep-aggregate
// (`<signal>_min|_max|_avg`), or the worked example's `abs(<aggregate>)` form.
const scoringComponentSchema = z
  .object({
    component: z.string().min(1),
    input: z.string().min(1),
    curve: z.array(z.tuple([z.number(), z.number()])).min(2),
    inactiveAbove: z.number().optional(),
    inactiveWhenPositiveDrift: z.boolean().optional(), // valgus: outward drift = no opinion
    view: viewSchema.optional(),
  })
  .strict();

// §3.6 rep block (mode + all §4-listed params). Mode-specific requirements
// are enforced by the linter with field-level messages, not the schema.
const repSchema = z
  .object({
    mode: z.enum(["alternating_threshold", "hold", "alternating_sides", "cadence"]),
    metric: signalNameSchema.optional(),
    upAt: z.number().optional(),
    downAt: z.number().optional(),
    countOn: z.enum(["up", "down"]).optional(),
    minRepMs: z.number().int().positive().optional(),
    maxRepMs: z.number().int().positive().optional(),
    /** §4 worked example: a NUMBER (the other-knee engage angle), not a bool. */
    bilateralGate: z.number().positive().optional(),
    holdBand: z.tuple([z.number(), z.number()]).optional(),
    enterMs: z.number().int().positive().optional(),
    exitMs: z.number().int().positive().optional(),
    cadenceSignal: signalNameSchema.optional(),
    minAmplitude: z.number().positive().optional(),
    minCadence: z.number().positive().optional(),
    maxCadence: z.number().positive().optional(),
    perSide: z.boolean().optional(),
  })
  .strict();

const scoringSchema = z
  .object({
    components: z.array(scoringComponentSchema).min(1),
    floor: z.number().int().min(0).max(100).default(0),
    neutral: z.number().int().min(0).max(100).default(80), // §3.8
    correctAt: z.number().int().min(0).max(100).default(70), // §3.8
    isometricBand: z.tuple([z.number(), z.number()]).optional(), // Mode B (P1.6b)
  })
  .strict();

export const exerciseDefinitionSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]*$/, "slug"),
    aliases: z.array(z.string()).optional(), // absorbs legacy plural keys
    version: z.number().int().positive(),
    minEngineVersion: z.string().regex(/^\d+\.\d+\.\d+$/, "semver"),
    family: z.string().min(1), // §5 template enum finalized with the templates task
    tracking: z.enum(["pose", "timer"]).default("pose"), // "gps" reserved, NOT accepted (§4 v1.1)
    name: z.string().optional(),
    muscles: z.array(z.string()).optional(),
    equipment: z.array(z.string()).optional(),
    difficulty: z.number().int().min(1).max(5).optional(),
    mediaRef: z.string().optional(),
    views: z.array(viewSchema).min(1).optional(),
    preferredView: viewSchema.optional(),
    requireView: z.boolean().optional(),
    calibration: z.array(calibrationRefSchema).optional(),
    signals: z.array(signalNameSchema).optional(),
    rep: repSchema.optional(),
    phases: z.array(z.string().min(1)).optional(),
    faults: z.array(faultRuleSchema).optional(),
    scoring: scoringSchema.optional(),
    setup: z
      .object({
        cameraHint: z.string().min(1),
        positionCheck: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    safety: z
      .object({
        contraindicationNote: z.string().min(1).optional(),
        maxRecommendedReps: z.number().int().positive().optional(), // UI nudge, never a block
      })
      .strict()
      .optional(),
    status: z.enum(["draft", "beta", "live"]),
  })
  .strict();

export type ExerciseDefinition = z.infer<typeof exerciseDefinitionSchema>;

// §9.3 — what clients download: a bundle manifest mapping slug → version,
// plus the definition documents themselves.
export const definitionBundleSchema = z
  .object({
    bundleVersion: z.number().int().positive(),
    channel: z.enum(["live", "beta"]),
    sha256: z.string().length(64),
    manifest: z.record(z.string(), z.number().int().positive()),
    definitions: z.array(exerciseDefinitionSchema),
  })
  .strict()
  .superRefine((bundle, ctx) => {
    const byKey = new Map(bundle.definitions.map((d) => [d.key, d.version]));
    for (const [slug, version] of Object.entries(bundle.manifest)) {
      if (byKey.get(slug) !== version) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["manifest", slug],
          message: `manifest points at ${slug}@${String(version)} but the bundle carries ${String(byKey.get(slug) ?? "nothing")}`,
        });
      }
    }
  });

export type DefinitionBundle = z.infer<typeof definitionBundleSchema>;
