// The "have a look" warnings (ROADMAP Stage 3 item 2e-ii; RULINGS 2026-09-08, layer 3): the
// gyms on a free trial now with a weaker clue that they are an older gym opening again. Kd's
// list until his admin page shows it (Stage 2 item 14). It changes nothing and tells no gym;
// a gym leaves the list when its free trial ends or it pays.
//
//   corepack pnpm --filter api exec tsx tools/trial-look.ts
import postgres from "postgres";
import { z } from "zod";
import type { ClueKind } from "../src/modules/orgs/trialLook/clues.js";
import { trialLookWarnings, type OtherGymPlan } from "../src/modules/orgs/trialLook/repo.js";

const env = z.object({ DATABASE_URL: z.string().url() }).safeParse(process.env);
if (!env.success) {
  console.error("Missing env: DATABASE_URL. (secrets never printed)");
  process.exit(1);
}
if (process.argv.length > 2) {
  console.error("Usage: trial-look.ts");
  process.exit(2);
}

const CLUE: Record<ClueKind, string> = {
  first_people: "Most of its first members came from",
  address: "Same address as",
  name_city: "Same city and a similar name as",
};
const PLAN: Record<OtherGymPlan, string> = {
  paid: "has paid",
  trial: "on a free trial",
  trial_ended: "its free trial ended, never paid",
  none: "never started a plan",
};

const sql = postgres(env.data.DATABASE_URL, { prepare: false, max: 1 });
try {
  const gyms = await trialLookWarnings(sql);
  if (gyms.length === 0) console.log("No gym to look at.");
  for (const gym of gyms) {
    const day = gym.trialStartedAt.toISOString().slice(0, 10);
    const where = gym.city === null ? "" : ` · ${gym.city}`;
    console.log(`${day}  ${gym.name}${where} · ${gym.ownerEmail ?? "no email"} · ${gym.gymId}`);
    for (const clue of gym.clues) {
      const owner = clue.kind === "first_people" ? ", where its owner had been staff or a member" : "";
      const other = clue.name === null ? "a gym no longer here" : `${clue.name} (${PLAN[clue.plan]})`;
      console.log(`            ${CLUE[clue.kind]} ${other}${owner} · ${clue.gymId}`);
    }
  }
  if (gyms.length > 0) console.log("\nA clue, not proof. Nothing has been changed or sent.");
} finally {
  await sql.end();
}
