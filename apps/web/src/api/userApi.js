// P2.8 web repoint (Card 6) — user profile + onboarding on the NEW /v1 API via
// the Card-1 cookie client (httpOnly session; no tokens in JS). The old wizard
// wrote onboarding to the legacy backend-ml PATCH /users/onboarding endpoint;
// that storage now lives on user_fitness_profiles (onboarding-storage, PR #30):
//   PUT   /v1/users/me/fitness-profile   full-document replace (idempotent)
//   PATCH /v1/users/me                   weight (users.weight_kg, Part 4 §3.1)
//   GET   /v1/users/me                   carries onboardingCompleted (the gate)
// Shapes are @app/shared users.ts (putFitnessProfileRequestSchema,
// updateProfileRequestSchema, userProfileSchema).
import authApi from './authApi';

// Height/target-weight go onto the fitness profile in CM/KG; the API's
// heightCm/targetWeightKg are `multipleOf(0.01)`, so every converted value MUST
// round to 2dp or the .strict() body 400s (the Card-3 f.1 class of bug).
const KG_PER_LB = 0.453592; // ported constant (DECISIONS 2026-07-13 P2.7b weight.ts)
const CM_PER_FT = 30.48;
const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

/** Wizard height ({value, unit: 'cm'|'ft'}) → heightCm, rounded 2dp. Pure. */
export function heightToCm(value, unit) {
  const n = num(value);
  return n === null ? null : round2(unit === 'ft' ? n * CM_PER_FT : n);
}

/** Wizard weight ({value, unit: 'kg'|'lbs'}) → kg, rounded 2dp. Pure. */
export function weightToKg(value, unit) {
  const n = num(value);
  return n === null ? null : round2(unit === 'lbs' ? n * KG_PER_LB : n);
}

/** Convert a height field value to `toUnit` ('cm'|'ft'), rounded 2dp, so
 *  switching the unit dropdown re-expresses the SAME height instead of leaving
 *  a stale number (175 cm silently read as 175 ft = 5334 cm, which the API's
 *  300 cm cap rejects). Blank/non-numeric passes through unchanged. Pure. */
export function convertHeight(value, toUnit) {
  const v = num(value);
  if (v === null) return value;
  return String(round2(toUnit === 'ft' ? v / CM_PER_FT : v * CM_PER_FT));
}

/** Convert a weight field value to `toUnit` ('kg'|'lbs'), rounded 2dp. Pure. */
export function convertWeight(value, toUnit) {
  const v = num(value);
  if (v === null) return value;
  return String(round2(toUnit === 'lbs' ? v / KG_PER_LB : v * KG_PER_LB));
}

/** The wizard's flat formData → the PUT /v1/users/me/fitness-profile body
 *  (putFitnessProfileRequestSchema). Renames sessionDuration→sessionDurationMin,
 *  converts height/target-weight units to metric + 2dp, and maps a blank
 *  medical note to null ("" is not "no conditions stated"). Weight is NOT here —
 *  it lives on users.weight_kg via PATCH /v1/users/me. `onboardingCompleted` is
 *  added by the caller (kept out so a future Settings edit can reuse this mapper
 *  without flipping the gate). Pure + unit-tested. */
export function toFitnessProfilePayload(formData) {
  const age = parseInt(formData.age, 10);
  const med = (formData.medicalConditions || '').trim();
  return {
    age: Number.isFinite(age) ? age : null,
    gender: formData.gender || null,
    heightCm: heightToCm(formData.heightValue, formData.heightUnit),
    targetWeightKg: weightToKg(formData.targetWeightValue, formData.weightUnit),
    fitnessLevel: formData.fitnessLevel || null,
    fitnessGoals: formData.fitnessGoals || [],
    exerciseFrequency: Number.isFinite(formData.exerciseFrequency) ? formData.exerciseFrequency : null,
    availableEquipment: formData.availableEquipment || [],
    sessionDurationMin: Number.isFinite(formData.sessionDuration) ? formData.sessionDuration : null,
    preferredWorkoutTime: formData.preferredWorkoutTime || null,
    medicalConditions: med === '' ? null : med,
  };
}

/** Card 7 (Settings): the fitness-profile PUT is a FULL replace, and the two
 *  Settings forms each edit only PART of it — so a form must send the CURRENT
 *  profile with only its own fields overridden, or it wipes the other form's.
 *  It must ALSO always CARRY onboardingCompleted explicitly, because the server
 *  sets it to false when the flag is omitted (service.ts:142) — otherwise
 *  saving Settings would bounce the user back to the wizard. It carries the
 *  CURRENT value rather than a hard `true`, so a save that lands right after a
 *  reset-onboarding (profile wiped, flag false) cannot silently re-onboard the
 *  user; `true` is only the fallback when the flag is unknown (T3 F1 residual).
 *
 *  `current` = the fitnessProfileSchema shape from GET (or null before load);
 *  `edits` = a partial of the same. undefined edits are ignored (they keep the
 *  current value); an explicit null clears that field. Pure + unit-tested. */
export function mergeFitnessProfile(current, edits) {
  const base = {
    age: current?.age ?? null,
    gender: current?.gender ?? null,
    heightCm: current?.heightCm ?? null,
    targetWeightKg: current?.targetWeightKg ?? null,
    fitnessLevel: current?.fitnessLevel ?? null,
    fitnessGoals: current?.fitnessGoals ?? [],
    exerciseFrequency: current?.exerciseFrequency ?? null,
    availableEquipment: current?.availableEquipment ?? [],
    sessionDurationMin: current?.sessionDurationMin ?? null,
    preferredWorkoutTime: current?.preferredWorkoutTime ?? null,
    medicalConditions: current?.medicalConditions ?? null,
  };
  const defined = Object.fromEntries(
    Object.entries(edits || {}).filter(([, v]) => v !== undefined),
  );
  return { ...base, ...defined, onboardingCompleted: current?.onboardingCompleted ?? true };
}

export const userService = {
  /** {user: userProfileSchema} — carries onboardingCompleted + weightKg etc. */
  getProfile: () => authApi.get('/v1/users/me'),
  /** updateProfileRequestSchema (.strict(), ≥1 field). Weight lives here. */
  updateProfile: (patch) => authApi.patch('/v1/users/me', patch),
  /** {fitnessProfile: fitnessProfileSchema} — all-nulls when never onboarded. */
  getFitnessProfile: () => authApi.get('/v1/users/me/fitness-profile'),
  /** putFitnessProfileRequestSchema — FULL replace; caller adds onboardingCompleted. */
  putFitnessProfile: (body) => authApi.put('/v1/users/me/fitness-profile', body),
};
