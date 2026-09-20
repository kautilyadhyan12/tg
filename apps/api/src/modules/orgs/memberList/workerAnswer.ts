// What the member file worker answers (spec Part 3 §9.4), kept apart from the
// thread it runs in so the tests can call it: `parseWorker.ts` only reads its
// job and posts this.
//
// Everything that can throw is caught here and answered as `{ crashed }` with
// the error's NAME only, and only a name shaped like one: a message could quote
// a cell, and a cell never reaches a log or Sentry (§9.9). The package's own
// errors never get this far — the adapter turns them into `unreadable_excel`.
import { z } from "zod";
import { type MemberFileResult, type MemberListUnderstandResult, memberListMappingSchema } from "@app/shared";
import { openMemberFileContents, type OpenableKind } from "./openFile.js";
import { understandMemberGrid } from "./understand.js";

/** Understanding the grid runs HERE, in the worker, not in the request's own
 *  thread (§9.5): measured 2026-09-20 on Node 22.23.2, the biggest list allowed
 *  costs 559-634 ms to understand, which the API would otherwise answer nothing
 *  else during. It also makes what crosses back to that thread the rows the
 *  list keeps instead of every cell of the file. */
const understandJobSchema = z.object({
  country: z.string().nullable(),
  mapping: memberListMappingSchema.nullable(),
  remembered: z.object({ fingerprint: z.string(), mapping: memberListMappingSchema }).nullable(),
});
export type UnderstandJob = z.infer<typeof understandJobSchema>;

const jobSchema = z.object({
  kind: z.enum(["zip", "text"]),
  bytes: z.instanceof(Uint8Array),
  understand: understandJobSchema.nullable().default(null),
});

/** An error's class name as the worker may report it: letters and digits, never
 *  anything a file could have written. */
export const CRASH_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export type WorkerAnswer = { done: MemberFileResult | MemberListUnderstandResult } | { crashed: string };

export async function workerAnswer(
  job: unknown,
  open: (kind: OpenableKind, bytes: Uint8Array) => Promise<MemberFileResult> = openMemberFileContents,
): Promise<WorkerAnswer> {
  try {
    const { kind, bytes, understand } = jobSchema.parse(job);
    const opened = await open(kind, bytes);
    if (understand === null || !opened.ok) return { done: opened };
    return { done: understandMemberGrid(opened, understand) };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return { crashed: CRASH_NAME.test(name) ? name : "unknown" };
  }
}
