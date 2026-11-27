// A run going on when its person is signed out (the running faults of 2026-11-20, A7): by their own Sign out,
// by the server, or with the account deleted. Nothing of it may go on with nobody signed in to stop it.
import type { SaveRunRequest } from "@app/shared";
import { finishRun, forgetRun, loadRun, runNow } from "./recorder";
import { saveRequestOf, sentOf, trueStart } from "./runLive";
import { runName } from "./runWords";

/** Signed out: the person's run is finished (the location, the voice, the monitor and the motion stop) and put in
 *  their saved runs, sent when they sign in again; one the outbox cannot take stays on the phone, finished, for
 *  them. A deleted account's run is thrown away. Another person's run is left as it is. */
export async function endRunAtLeaving(userId: string, why: "out" | "deleted", add: ((run: SaveRunRequest) => Promise<boolean>) | null, now: number = Date.now()): Promise<void> {
  const run = runNow() ?? (await loadRun());
  if (run === null || run.userId !== userId) return;
  if (why === "deleted") {
    await forgetRun();
    return;
  }
  const done = await finishRun(now);
  if (done === null || add === null) return;
  const saved = saveRequestOf(done, sentOf(done), runName(trueStart(done)), null, null);
  if (await add(saved)) await forgetRun();
}
