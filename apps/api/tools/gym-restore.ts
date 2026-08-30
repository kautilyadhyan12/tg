// RE-OPEN A CLOSED GYM — the other half of the archive sweep, and today the only
// way back from `archived`.
//
//   corepack pnpm --filter api exec tsx tools/gym-restore.ts --gym=<name-or-uuid>
//
// **THE ARGUMENT IS THE NAME IN THE CONSOLE'S ADDRESS BAR** — `/console/<name>`
// — because that is the only handle on a gym that appears on any screen. This
// header said "uuid" for one draft, and the console's routes are
// `/console/:orgSlug`: an operator instruction naming a value nobody can obtain
// is :5807's class arriving in a runbook. A uuid still works, for a log line or
// a support thread that carries one.
//
// **WHY A COMMAND AND NOT A BUTTON.** Part 3 §4.2 says an archived gym is
// *"restorable by reactivating"* — by paying — and nothing in this product can
// put a gym back on a plan: `subscriptions` has exactly two writers in
// `apps/api/src`, the INSERT in `startGymTrial` and the UPDATE in
// `trialSweep.ts`. Kd was told this before ruling the four months and answered
// it directly: re-opening is a hand operation until the payment card exists, and
// that card owes the automatic half. The eventual home is :19016's admin panel,
// whose first slice is suspend/remove a gym — the same column, the other
// direction.
//
// **IT DOES NOT PUT THE GYM BACK ON A PLAN, and that is not a shortcut.** A
// re-opened gym has no subscription, so its console stays read-only (:23711) and
// its members stay on the free app. What it undoes is the closure: people can
// type its join code again, its waiting queue can be cleared again once it is
// paying, and it can start a trial if it never spent one. Writing a subscription
// row nobody paid for would be R3.1.
//
// **NOT REFUSED IN PRODUCTION, unlike its sibling, and the asymmetry is the
// point.** `archive-sweep.ts --now` can close every lapsed gym in a database in
// one run; this opens exactly one named gym, and opening is the direction
// nothing is lost in. Refusing it in production would refuse the one operation
// an operator actually needs at 2 a.m.
//
// It prints what it did and exits non-zero when it did nothing, so a mistyped
// name is not a silent success.
import pino from "pino";
import postgres from "postgres";
import { z } from "zod";
import { getOrgIdBySlug, restoreGym } from "../src/modules/orgs/repo.js";

// Standalone tool: it parses ONLY the env it needs (R2.3), following
// tools/trial-sweep.ts.
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: z.string().optional(),
});
const env = envSchema.safeParse(process.env);
if (!env.success) {
  console.error("Missing env: DATABASE_URL. (secrets never printed)");
  process.exit(1);
}

const gymArg = process.argv.find((a) => a.startsWith("--gym="))?.slice("--gym=".length);
if (gymArg === undefined || gymArg.trim() === "") {
  console.error(
    "Usage: tsx tools/gym-restore.ts --gym=<name-in-the-console-url>\n" +
      "  e.g. --gym=iron-house-jorhat, the last part of /console/iron-house-jorhat.\n" +
      "  A gym's uuid works too, if you have one.",
  );
  process.exit(1);
}

const log = pino({ level: env.data.LOG_LEVEL ?? "info" });
const sql = postgres(env.data.DATABASE_URL, { prepare: false, max: 2 });

try {
  // **EITHER THE SLUG OR THE UUID, and the slug is the one an operator can
  // actually get** — the console's routes are `/console/:orgSlug`, so the
  // address bar carries a name and the uuid appears on no screen. A uuid is
  // still accepted because a support conversation or a log line may carry one.
  const asUuid = z.string().uuid().safeParse(gymArg);
  const gymId = asUuid.success ? asUuid.data : await getOrgIdBySlug(sql, gymArg);
  if (gymId === null) {
    log.error({ gym: gymArg, event: "orgs.gym_not_found" }, "no gym with that name or id");
    await sql.end();
    process.exit(1);
  }
  // The actor is NULL for the same reason both sweeps pass null: nobody is
  // signed in at a command line, and recording an operator action under some
  // stand-in user id would be the more convenient lie. `via` names the surface,
  // so the admin panel's row will be distinguishable from this one.
  const outcome = await restoreGym(sql, {
    gymId,
    actorUserId: null,
    via: "gym_restore_tool",
  });

  // One exit at the bottom rather than three inside the switch, so the
  // connection is closed on every path and a new outcome arm cannot skip it.
  let code: number;
  switch (outcome.kind) {
    case "restored": {
      log.info(
        { gymId, name: outcome.org.name, event: "orgs.gym_restored" },
        "gym re-opened — its console stays read-only until it is on a plan",
      );
      code = 0;
      break;
    }
    case "not_archived": {
      log.warn(
        { gymId, name: outcome.org.name, event: "orgs.gym_not_archived" },
        "that gym is not closed — nothing to re-open",
      );
      code = 1;
      break;
    }
    case "not_found": {
      log.error({ gymId, event: "orgs.gym_not_found" }, "no gym with that id");
      code = 1;
      break;
    }
    default: {
      // R2.4 inline: `assertNever` lives private inside the orgs service, so the
      // exhaustiveness check is written out rather than a function exported for
      // one tool.
      const unreachable: never = outcome;
      throw new Error(`unhandled restore outcome: ${JSON.stringify(unreachable)}`);
    }
  }
  await sql.end();
  process.exit(code);
} catch (err) {
  log.fatal({ errName: err instanceof Error ? err.name : typeof err }, "gym restore failed");
  await sql.end();
  process.exit(1);
}
