// A free trial needs the owner's email confirmed (Stage 3 item 2b). The tests make their
// accounts through the old password door, which leaves it unconfirmed, so a test that
// starts a trial confirms the gym's owner first, as the email code or Google would.
import type { Sql } from "postgres";

export async function confirmOwnerOf(sql: Sql, gymId: string): Promise<void> {
  await sql`
    INSERT INTO one_time_tokens (user_id, purpose, token_hash, expires_at, used_at)
    SELECT owner_user_id, 'verify_email', md5(random()::text) || md5(random()::text), now(), now()
    FROM gyms WHERE id = ${gymId}`;
}
