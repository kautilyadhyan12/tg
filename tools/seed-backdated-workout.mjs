// Seed ONE workout, backdated past the free plan's 90-day read-gate, for a
// named account — the fixture smoke step 10 needs and that cannot be produced
// through the UI (the client stamps `startedAt` from the device clock).
//
// WHY THIS EXISTS. The Recent Workouts pane has three arms and only two are
// reachable by clicking: a fresh account (nothing) and a normal account (rows).
// The third — "you have history, your plan is not showing it" — needs a workout
// older than 90 days, which is exactly the state two Criticals shipped on.
//
// Usage:  node tools/seed-backdated-workout.mjs <email> [daysAgo=120]
// Reads DATABASE_URL from apps/api/.env. Prints what it did and what to expect.
//
// `postgres` is resolved out of apps/api rather than imported bare: pnpm does
// not hoist it to the repo root, so a bare import fails from tools/ no matter
// what the cwd is.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const postgres = createRequire(new URL('../apps/api/package.json', import.meta.url))('postgres');

const [email, daysArg] = process.argv.slice(2);
if (!email) {
  console.error('usage: node tools/seed-backdated-workout.mjs <email> [daysAgo=120]');
  process.exit(1);
}
const daysAgo = Number(daysArg ?? 120);
if (!Number.isFinite(daysAgo) || daysAgo <= 90) {
  console.error(`daysAgo must be a number > 90 (the gate); got ${daysArg}`);
  process.exit(1);
}

const env = readFileSync(new URL('../apps/api/.env', import.meta.url), 'utf8');
const url = env.split('\n').find((l) => l.startsWith('DATABASE_URL='))?.slice('DATABASE_URL='.length).trim();
if (!url) { console.error('DATABASE_URL not found in apps/api/.env'); process.exit(1); }

const sql = postgres(url, { ssl: 'require' });
try {
  const [user] = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (!user) {
    console.error(`no user with email ${email} — register in the browser first`);
    process.exit(1);
  }
  const [ex] = await sql`SELECT id FROM exercises ORDER BY slug LIMIT 1`;
  if (!ex) { console.error('no exercises seeded'); process.exit(1); }

  const startedAt = new Date(Date.now() - daysAgo * 86_400_000);
  const workoutId = crypto.randomUUID();

  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO workouts (id, user_id, started_at, platform, engine_version,
                            bundle_version, sets_count, total_reps, avg_form_score,
                            duration_ms, quality_flags, kcal_point, kcal_calc_version)
      VALUES (${workoutId}, ${user.id}, ${startedAt}, 'web', '1.0.0', 1,
              1, 10, 88, 120000, ${[]}, 14, 3)`;
    await tx`
      INSERT INTO workout_sets (workout_id, user_id, exercise_id, started_at, set_index,
                                view, mode, reps, hold_ms, duration_ms, watched_ms,
                                avg_form_score, rep_scores, fault_counts, tempo_ms_avg,
                                rom_stats, calibration, engine_version, definition_version)
      VALUES (${workoutId}, ${user.id}, ${ex.id}, ${startedAt}, 0, 'front', 'engine',
              10, null, 120000, 120000, 88, ${[88]}, ${tx.json({})}, null,
              null, null, '1.0.0', 1)`;
  });

  console.log(`seeded workout ${workoutId}`);
  console.log(`  user      ${email}`);
  console.log(`  startedAt ${startedAt.toISOString()}  (${daysAgo} days ago)`);
  console.log('');
  console.log('Now refresh the Dashboard. Expect:');
  console.log('  Recent Workouts → "No workouts in the last 90 days."');
  console.log('                    "Your plan shows that far back. Older workouts are still saved."');
  console.log('  Total Workouts  → 0  (correct: the same 90-day window applies to the tile)');
} finally {
  await sql.end();
}
