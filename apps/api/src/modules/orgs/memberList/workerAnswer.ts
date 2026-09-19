// What the member file worker answers (spec Part 3 §9.4), kept apart from the
// thread it runs in so the tests can call it: `parseWorker.ts` only reads its
// job and posts this.
//
// Everything that can throw is caught here and answered as `{ crashed }` with
// the error's NAME only, and only a name shaped like one: a message could quote
// a cell, and a cell never reaches a log or Sentry (§9.9). The package's own
// errors never get this far — the adapter turns them into `unreadable_excel`.
import { z } from "zod";
import type { MemberFileResult } from "@app/shared";
import { openMemberFileContents, type OpenableKind } from "./openFile.js";

const jobSchema = z.object({ kind: z.enum(["zip", "text"]), bytes: z.instanceof(Uint8Array) });

/** An error's class name as the worker may report it: letters and digits, never
 *  anything a file could have written. */
export const CRASH_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export type WorkerAnswer = { done: MemberFileResult } | { crashed: string };

export async function workerAnswer(
  job: unknown,
  open: (kind: OpenableKind, bytes: Uint8Array) => Promise<MemberFileResult> = openMemberFileContents,
): Promise<WorkerAnswer> {
  try {
    const { kind, bytes } = jobSchema.parse(job);
    return { done: await open(kind, bytes) };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return { crashed: CRASH_NAME.test(name) ? name : "unknown" };
  }
}
