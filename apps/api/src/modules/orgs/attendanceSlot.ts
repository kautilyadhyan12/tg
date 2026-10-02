// WHICH PERIOD OF THE GYM'S DAY A VISIT FALLS IN, as the key two visits are compared
// by. Pure; read by the member's tap (`repo.markGymAttendance`) and the desk's scan
// (`checkin/scanRule.ts`), so the two cannot count a visit differently.
import type { GymAttendanceHoursStatus } from "@app/shared";

/** THE KEY THAT DECIDES WHETHER TWO TAPS ARE ONE VISIT OR TWO — Kd's rulings of
 *  2026-09-01 (:27992, :28055), and the ONLY place it is derived.
 *
 *  The session window when there is one, so a morning and an evening visit are
 *  different keys and BOTH count; the status name otherwise, so a gym with no
 *  sessions gets ONE attendance per day. **The database's
 *  `gym_attendance_slot_key_agrees_check` re-derives exactly this expression and
 *  refuses a row that disagrees** — so a second writer that "simplifies" this to
 *  a constant gets a 23514 instead of silently collapsing every gym to one visit
 *  a day, which is the direction that otherwise fails with no error anywhere. */
export function slotKeyFor(
  hoursStatus: GymAttendanceHoursStatus,
  opensMinute: number | null,
  closesMinute: number | null,
): string {
  return hoursStatus === "in_session" && opensMinute !== null && closesMinute !== null
    ? `${String(opensMinute)}-${String(closesMinute)}`
    : hoursStatus;
}
