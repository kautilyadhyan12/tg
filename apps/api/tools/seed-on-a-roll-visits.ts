/* THE "ON A ROLL" SMOKE FIXTURE — attendance history written straight into the
 * database, because there is no other route to it.
 *
 * **KD RULED THIS ON 2026-09-05**, answering the question `OWED.md`'s cheer line
 * left open in as many words: *"Building the rows directly in the database is
 * the only route and is nobody's call but Kd's."*
 *
 * WHY NO SCREEN CAN DO IT: `markAttendance` decides the day server-side, on
 * purpose (:27900) — a client that could name its own day could mark itself
 * present for last Tuesday. So a member with visits in two consecutive weeks
 * cannot be created through the app at all, and `RUNBOOK/smoke-on-a-roll-cheer.md`
 * Parts B and C shipped BLOCKED until this existed.
 *
 * WHAT IT WRITES: ten `gym_attendance` rows for two members of the `owner` gym.
 * **INSERT ONLY** — no UPDATE, no DELETE, `ON CONFLICT DO NOTHING` on the same
 * unique key the real writer uses, so a second run writes nothing and reports so.
 *
 * THE SHAPE IS CHOSEN SO THE SMOKE CAN FAIL (:24893, :27810 §2) — two rows, not
 * one, with DIFFERENT numbers:
 *
 *   user@example.com  3 weeks running · 2 days in a row · 7 visits
 *   tm@example.com    2 weeks running ·      (no days) · 3 visits
 *
 * A single-row fixture cannot tell "the row I pressed" from "the first row",
 * which is the defect :34809 §1 found ALIVE on this very screen; and a row with
 * no day-streak is what proves the panel omits the days figure rather than
 * printing "1 day in a row" (`ON_A_ROLL_MIN_WEEKS`, step 5's ❌).
 *
 * EVERY INSTANT IS IN THE PAST in the gym's own zone. A first run wrote today's
 * visit at 08:00 gym-local while it was still 05:26 there; that row was removed
 * and 2026-09-03 used instead.
 *
 * Run it against the database the BROWSER reads (:15927 — the dev branch is
 * applied to by hand and by nothing else):
 *
 *   cd apps/api
 *   DATABASE_URL=$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2-) \
 *     node --import tsx tools/seed-on-a-roll-visits.ts
 */
import postgres from "postgres";
import { getGymRegulars } from "../src/modules/orgs/repo.js";

/** The `owner` gym — `/console/owner`, the one the smoke sheet links to. It has
 *  five non-complimentary live members; the owner's own seat is complimentary
 *  and is therefore correctly absent from this panel. */
const GYM = "74584364-96b9-4cdd-9a7b-d6a35b0e69ad";
const USER = "2df4f150-104c-414f-8e73-385986f32e25"; // user@example.com
const TM = "978c489d-a571-4b9d-bbbe-90444a4db1f6"; // tm@example.com

/** Weeks beginning Monday 2026-08-17, 08-24 and 08-31 for `user`; the last two
 *  for `tm`. `o`/`c` are the gym's REAL session for that weekday, so `slot_key`
 *  agrees with `gym_attendance_slot_key_agrees_check` and the row is one the
 *  app could itself have written. */
const ROWS = [
  { u: USER, day: "2026-08-18", o: 460, c: 580 },
  { u: USER, day: "2026-08-21", o: 460, c: 580 },
  { u: USER, day: "2026-08-25", o: 460, c: 580 },
  { u: USER, day: "2026-08-28", o: 460, c: 580 },
  { u: USER, day: "2026-09-01", o: 460, c: 580 },
  { u: USER, day: "2026-09-03", o: 460, c: 580 },
  { u: USER, day: "2026-09-04", o: 460, c: 580 },
  { u: TM, day: "2026-08-25", o: 460, c: 580 },
  { u: TM, day: "2026-08-28", o: 460, c: 580 },
  { u: TM, day: "2026-09-02", o: 300, c: 580 },
] as const;

const url = process.env["DATABASE_URL"];
if (url === undefined || url === "") {
  console.error("DATABASE_URL is not set. See the header of this file.");
  process.exit(2);
}
const sql = postgres(url, { ssl: "require", max: 1 });

let written = 0;
for (const r of ROWS) {
  const slot = `${String(r.o)}-${String(r.c)}`;
  const at = `${r.day}T11:00:00Z`; // 08:00 in the gym's zone, inside the session
  const res = await sql`
    INSERT INTO gym_attendance
      (gym_id, user_id, marked_by_user_id, day, marked_at, method,
       hours_status, session_opens_minute, session_closes_minute, slot_key)
    VALUES (${GYM}, ${r.u}, ${r.u}, ${r.day}::date, ${at}::timestamptz, 'manual',
            'in_session', ${r.o}, ${r.c}, ${slot})
    ON CONFLICT (gym_id, user_id, day, slot_key) DO NOTHING
    RETURNING id`;
  if (res.length === 1) written += 1;
  console.log(`${res.length === 1 ? "wrote  " : "existed"} ${r.day} ${slot} ${r.u.slice(0, 8)}`);
}
console.log(`\n${String(written)} written, ${String(ROWS.length - written)} already there.`);

/** READ BACK THROUGH THE REAL QUERY, never a second one written here — a
 *  hand-rolled check of "is this two weeks?" would be a second answer to the
 *  question the screen asks, and could agree with itself while the screen
 *  disagreed. */
console.log("\nwhat the panel will draw:");
for (const g of (await getGymRegulars(sql, { gymId: GYM })) ?? []) {
  console.log(
    `  ${g.displayName}: ${String(g.weeksRunning)} weeks · ${String(g.daysRunning)} days · ${String(g.visits)} visits`,
  );
}
await sql.end();
