// The gyms whose invitations were stopped for bounces or a complaint (Part 3 §9.12):
// Kd's "have a look" list until the admin panel, and the way to start one again.
//
//   corepack pnpm --filter api exec tsx tools/invites-stopped.ts                 # the list
//   corepack pnpm --filter api exec tsx tools/invites-stopped.ts resume <gymId>  # start again
//
// A gym started again sends a first 50 and waits for their results, as a new gym does;
// its bounces and complaints are counted from that moment.
import postgres from "postgres";
import { z } from "zod";
import { resumeGym, stoppedGyms } from "../src/modules/orgs/invites/repo.js";

const env = z.object({ DATABASE_URL: z.string().url() }).safeParse(process.env);
if (!env.success) {
  console.error("Missing env: DATABASE_URL. (secrets never printed)");
  process.exit(1);
}
const args = z
  .union([z.tuple([]), z.tuple([z.literal("resume"), z.string().uuid()])])
  .safeParse(process.argv.slice(2));
if (!args.success) {
  console.error("Usage: invites-stopped.ts [resume <gymId>]");
  process.exit(2);
}

const sql = postgres(env.data.DATABASE_URL, { prepare: false, max: 1 });
try {
  if (args.data.length === 0) {
    const gyms = await stoppedGyms(sql);
    if (gyms.length === 0) console.log("No gym's invitations are stopped.");
    for (const gym of gyms) {
      console.log(`${gym.gymId}  ${gym.stoppedAt.toISOString()}  ${gym.reason === "bounces" ? "too many bounces" : "a complaint"}  ${gym.name}`);
    }
  } else {
    const gymId = args.data[1];
    const resumed = await resumeGym(sql, gymId, new Date());
    console.log(resumed ? `Started again: ${gymId}` : `Not stopped (or no such gym): ${gymId}`);
    if (!resumed) process.exitCode = 1;
  }
} finally {
  await sql.end();
}
