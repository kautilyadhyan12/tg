// STOPPING A GYM'S SQUARE CONNECTION FROM OUR SIDE (ROADMAP 18d-ii; RUNBOOK/stop-square.md),
// for `tools/square-stop.ts`, run from a terminal and on no screen. It takes back only our
// app's permission at the gym's Square account and leaves the account and its money alone. It
// is for our being hacked (the gyms would not know to press Disconnect) and for a gym cheating
// its members (it will not); Disconnect stays the gym's own button.
//
// Square's revoke takes the account's id with our app's secret, so it works when a gym's own
// token cannot be opened. It ends every token of that account, so every gym here holding it is
// marked disconnected (Settings then reads "Square was disconnected"), each with a note kept.
import { insertAudit } from "../repo.js";
import * as repo from "./repo.js";
import type { PaymentsDeps } from "./service.js";
import type { SquareSettings } from "./settings.js";
import { forgetListing } from "./squareMembersRepo.js";

export interface StoppedAccount {
  accountId: string;
  gyms: { gymId: string; name: string }[];
  /** `would_stop`: a dry run. `stopped`: Square ended the tokens and the gyms are marked. */
  outcome: "would_stop" | "stopped" | "refused" | "unavailable";
}

/** One gym's Square account (`gymId`), or every connected one (null). Nothing changes unless
 *  `apply`. */
export async function stopSquare(deps: PaymentsDeps, square: SquareSettings, gymId: string | null, apply: boolean): Promise<StoppedAccount[]> {
  const accounts =
    gymId === null
      ? (
          await deps.sql<{ account_id: string }[]>`
            SELECT DISTINCT account_id FROM gym_payment_connections
            WHERE provider = 'square' AND environment = ${square.environment} AND state = 'connected'
            ORDER BY account_id`
        ).map((r) => r.account_id)
      : await (async () => {
          const row = await repo.readConnection(deps.sql, gymId, square.environment);
          return row?.state === "connected" ? [row.accountId] : [];
        })();
  const report: StoppedAccount[] = [];
  for (const accountId of accounts) {
    const holders = await repo.connectionsOfAccount(deps.sql, square.environment, accountId);
    const names = await Promise.all(holders.map(async (h) => ({ gymId: h.gymId, name: (await repo.readGym(deps.sql, h.gymId))?.name ?? "" })));
    if (!apply) {
      report.push({ accountId, gyms: names, outcome: "would_stop" });
      continue;
    }
    const result = await square.api.revokeAccount(accountId);
    if (result.kind !== "ok") {
      deps.log.error({ event: "square.stop_failed", accountId, ...(result.kind === "refused" ? { status: result.status, code: result.code } : {}) }, "Square did not stop an account");
      report.push({ accountId, gyms: names, outcome: result.kind });
      continue;
    }
    for (const holder of holders) {
      await deps.sql.begin(async (tx) => {
        if (!(await repo.markRemoved(tx, holder.gymId, square.environment, holder.connectedAt, deps.now()))) return;
        await forgetListing(tx, holder.gymId, square.environment);
        await insertAudit(tx, {
          actorUserId: null,
          gymId: holder.gymId,
          action: "org.payments_square_stopped",
          targetType: "gym",
          targetId: holder.gymId,
          meta: { business: holder.businessName },
        });
      });
    }
    deps.log.warn({ event: "square.stopped", accountId, gyms: holders.length }, "a Square account was stopped from our side");
    report.push({ accountId, gyms: names, outcome: "stopped" });
  }
  return report;
}
