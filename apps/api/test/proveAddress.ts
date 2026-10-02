// The person proved their address (a sign-in code, Google or the verification link): the
// marker `recordVerifiedEmail` writes, without ending the session the test signed in with.
// Since join codes went (3c), everybody in a gym has done this, and staff are appointed at
// once from a proved address only (the security pass over "getting in", 2026-10-02).
import type { Sql } from "postgres";

export async function proveAddress(sql: Sql, email: string): Promise<void> {
  await sql`
    INSERT INTO one_time_tokens (user_id, purpose, token_hash, expires_at, used_at)
    SELECT u.id, 'verify_email', md5(random()::text || u.id::text), now(), now()
    FROM users u
    WHERE lower(u.email::text) = lower(${email})
      AND NOT EXISTS (
        SELECT 1 FROM one_time_tokens t WHERE t.user_id = u.id AND t.purpose = 'verify_email' AND t.used_at IS NOT NULL)`;
}
