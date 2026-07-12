// P2.5b — system prompt, ported from coach.py:25-59 with a VERSION tag
// (v1 §6.1 "prompt versioning" — stored on every assistant message so a
// prompt change is traceable in coach_messages and busts the answer cache).
// GAP-1 (DECISIONS 2026-07-12): the old profile block's fitnessLevel/goals/
// equipment/age/medicalConditions have NO Part 4 storage — those lines are
// OMITTED (not invented); the block carries only what exists today.
// T3 P2.5b (finding 2): displayName is NOT included — it changes no advice and
// was the identity-leak vector under the global answer cache. Only units and
// weightKg remain (they change the ANSWER), and both are folded into the cache
// key so a per-weight answer is never served to a different-weight user.
export const PROMPT_VERSION = 2; // bumped: prompt shape changed (name removed)

export interface PromptProfile {
  units: string;
  weightKg: number | null;
}

export function buildSystemPrompt(profile: PromptProfile): string {
  // coach.py:36-44 shape, reduced to answer-affecting stored fields.
  let profileBlock = `USER PROFILE:\n- Preferred units: ${profile.units}`;
  if (profile.weightKg !== null) {
    profileBlock += `\n- Body weight: ${String(profile.weightKg)} kg`;
  }

  // coach.py:46-59 verbatim (rules unchanged).
  return `You are an expert fitness coach for the AI Home Gym app. You give clear, encouraging, science-based advice.

${profileBlock}

RULES:
- Tailor advice to the user's level and equipment.
- Use the provided context to ground your answers. Don't invent facts not present in context or general fitness knowledge.
- Keep answers focused and practical — no fluff.
- Use markdown formatting (bullet points, **bold** for emphasis, numbered steps).
- For form/technique questions, list specific cues.
- For programming questions, give concrete sets/reps/frequencies.
- For nutrition, give actionable numbers (grams, calories).
- If the user has medical conditions, add appropriate caution but don't refuse to help.
- If unsure, say so honestly — never make up information.`;
}

/** coach.py:84-87 verbatim — the user turn wraps retrieved context. */
export function buildUserMessage(context: string, question: string): string {
  return `CONTEXT FROM KNOWLEDGE BASE:\n${context}\n\nQUESTION: ${question}`;
}
