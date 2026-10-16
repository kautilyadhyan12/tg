// The second-trial code (ROADMAP Stage 3 item 2e-i; RULINGS 2026-09-08, layer 4). Kd makes one
// for a real owner of two gyms who wrote to him; it lets that one person past "one free trial
// per person" and "one device, one trial" once (`startGymTrial`). Only its SHA-256 is kept.
import { randomInt } from "node:crypto";
import type { Sql } from "postgres";
import { SECOND_TRIAL_CODE_ALPHABET, SECOND_TRIAL_CODE_LENGTH } from "@app/shared";

/** How long a code works after Kd makes it. */
export const SECOND_TRIAL_CODE_DAYS = 14;

/** A new code, each letter picked evenly from the alphabet. `pick(n)` answers 0 to n - 1. */
export function makeSecondTrialCode(pick: (n: number) => number = randomInt): string {
  let code = "";
  for (let i = 0; i < SECOND_TRIAL_CODE_LENGTH; i++) {
    code += SECOND_TRIAL_CODE_ALPHABET[pick(SECOND_TRIAL_CODE_ALPHABET.length)] ?? "";
  }
  return code;
}

/** "ABCDEFGHJK" as Kd sends it: "ABCDE-FGHJK". */
export function showSecondTrialCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/** Keeps a code for the person whose address this is, however it is spelled, and says
 *  whether a confirmed account with that address exists yet. */
export async function saveSecondTrialCode(
  sql: Sql,
  input: { email: string; codeHash: string },
): Promise<{ expiresAt: Date; hasAccount: boolean }> {
  const rows = await sql<{ expires_at: Date; has_account: boolean }[]>`
    INSERT INTO second_trial_codes (code_hash, person_hash, expires_at)
    VALUES (${input.codeHash},
            encode(sha256(convert_to(trial_person_key(${input.email}), 'UTF8')), 'hex'),
            now() + ${SECOND_TRIAL_CODE_DAYS} * INTERVAL '1 day')
    RETURNING expires_at,
      EXISTS (
        SELECT 1 FROM users u
        WHERE u.trial_person_key = trial_person_key(${input.email})
          AND EXISTS (
            SELECT 1 FROM one_time_tokens t
            WHERE t.user_id = u.id AND t.purpose = 'verify_email' AND t.used_at IS NOT NULL
          )
      ) AS has_account`;
  const row = rows[0];
  if (row === undefined) throw new Error("second-trial code insert returned no row");
  return { expiresAt: row.expires_at, hasAccount: row.has_account };
}
