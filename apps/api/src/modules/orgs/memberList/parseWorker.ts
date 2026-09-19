// The worker thread one member file is opened in (spec Part 3 §9.4), started
// fresh for every file by `parseMemberFile.ts`. It answers once and exits.
//
// Everything it can throw is caught here and answered as `{ crashed }` with the
// error's NAME only: a message could quote a cell, and a cell never reaches a
// log or Sentry (§9.9). The package's own errors never get this far — the
// adapter turns them into the `unreadable_excel` refusal.
import { parentPort, workerData } from "node:worker_threads";
import { z } from "zod";
import { openMemberFileContents } from "./openFile.js";

const jobSchema = z.object({ kind: z.enum(["zip", "text"]), bytes: z.instanceof(Uint8Array) });

async function answer(): Promise<unknown> {
  try {
    const job = jobSchema.parse(workerData);
    return { done: await openMemberFileContents(job.kind, job.bytes) };
  } catch (error) {
    return { crashed: error instanceof Error ? error.name : "unknown" };
  }
}

parentPort?.postMessage(await answer());
