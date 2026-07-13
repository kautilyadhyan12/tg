// P2.7b — legacy weight {value,unit} → kg. Ports calories.py's unit conversion
// (KG_PER_LB, :98) but NOT its 70 kg estimation fallback: users.weight_kg is
// nullable, so a missing/invalid legacy weight migrates as NULL rather than a
// fabricated 70 (DECISIONS 2026-07-13 — don't invent measurements).
import { z } from "zod";

export const KG_PER_LB = 0.453592; // backend-ml/app/ai/fitness/calories.py:98

const legacyWeightSchema = z.object({ value: z.coerce.number(), unit: z.string().optional() });
const LB_UNITS = new Set(["lb", "lbs", "pound", "pounds"]);

export function weightToKg(weight: unknown): number | null {
  const parsed = legacyWeightSchema.safeParse(weight);
  if (!parsed.success || !Number.isFinite(parsed.data.value) || parsed.data.value <= 0) return null;
  const unit = (parsed.data.unit ?? "kg").toLowerCase();
  const kg = LB_UNITS.has(unit) ? parsed.data.value * KG_PER_LB : parsed.data.value;
  const rounded = Math.round(kg * 100) / 100;
  // numeric(5,2) tops out at 999.99; a larger value is junk data → null, not an
  // insert-aborting overflow (T3 finding 6).
  return rounded > 999.99 ? null : rounded;
}
