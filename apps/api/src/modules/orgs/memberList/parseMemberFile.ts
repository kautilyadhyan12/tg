// Opening an uploaded member file (spec Part 3 §9.4): the sniff on the request's
// own thread, then everything else in a fresh worker thread per file.
//
// The worker is what keeps a slow file off the event loop and makes a hard
// timeout possible at all: after MEMBER_FILE_PARSE_TIMEOUT_MS it is terminated
// mid-parse. Its heap is capped at MEMBER_FILE_WORKER_HEAP_MB, and a file that
// needs more kills the worker, not the API. The cap does NOT cover Buffers —
// the byte limits in `zipSafe.ts` and the upload size are what bound those.
// At most MEMBER_FILE_PARSES_AT_ONCE files are open at once per process; one
// more is refused as `busy` rather than queued behind them. The route (3a-iii)
// adds one file at a time per gym, so one account cannot hold both slots.
//
// The worker starts on `parseWorker.boot.mjs`, which loads the TypeScript worker
// through tsx on every Node version (that file says why). Inside vitest too its
// modules load through tsx, not vite, so nothing in it can be mocked: the pure
// functions are tested directly, and this file for its wiring (measured
// 2026-09-19: about 750 ms for a worker's first start).
import { Worker } from "node:worker_threads";
import { z } from "zod";
import {
  MEMBER_FILE_PARSES_AT_ONCE,
  MEMBER_FILE_PARSE_TIMEOUT_MS,
  MEMBER_FILE_WORKER_HEAP_MB,
  memberFileResultSchema,
  type MemberFileRefusal,
  type MemberFileResult,
} from "@app/shared";
import type { OpenableKind } from "./openFile.js";
import { sniffMemberFile } from "./sniff.js";
import { CRASH_NAME } from "./workerAnswer.js";

const WORKER_FILE = new URL("./parseWorker.boot.mjs", import.meta.url);

/** What the worker answers, checked before anything reads it. */
const workerReplySchema = z.union([
  z.object({ done: memberFileResultSchema }),
  z.object({ crashed: z.string().regex(CRASH_NAME) }),
]);

/** The worker's answer as a result, or an error that names nothing from the
 *  file: a crash by its error's class name only, any other shape by none. */
export function readWorkerReply(message: unknown): MemberFileResult {
  const reply = workerReplySchema.safeParse(message);
  if (!reply.success) throw new Error("member file worker answered in a shape it never sends");
  if ("done" in reply.data) return reply.data.done;
  throw new Error(`member file worker failed inside: ${reply.data.crashed}`);
}

/** Test seams: production passes nothing. */
export interface ParseMemberFileSeams {
  timeoutMs?: number;
  heapMb?: number;
  /** Told when each worker's thread has ended, with its exit code (a terminated
   *  worker exits 1 on Windows and 0 on CI's Linux, so the code is not a signal). */
  onWorkerExit?: (exitCode: number) => void;
}

let open = 0;

/** How many files are being read right now (for tests). */
export const memberFilesOpen = (): number => open;

const refused = (refusal: MemberFileRefusal): MemberFileResult => ({ ok: false, refusal });

const codeOf = (error: unknown): string =>
  error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "no code";

function readInWorker(kind: OpenableKind, bytes: Uint8Array, seams: ParseMemberFileSeams): Promise<MemberFileResult> {
  // The worker is handed its own copy, transferred rather than cloned: the
  // caller's bytes may share an ArrayBuffer with other data (Node pools small
  // Buffers), and a transfer would detach it under them.
  const own = new Uint8Array(bytes);
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_FILE, {
      // Nothing inherited from the parent's command line: the entry loads tsx itself.
      execArgv: [],
      workerData: { kind, bytes: own },
      transferList: [own.buffer],
      resourceLimits: { maxOldGenerationSizeMb: seams.heapMb ?? MEMBER_FILE_WORKER_HEAP_MB },
    });
    worker.once("exit", (exitCode: number) => seams.onWorkerExit?.(exitCode));
    let settled = false;
    const settle = (finish: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      finish();
    };
    const timer = setTimeout(() => {
      settle(() => {
        resolve(refused({ code: "parse_timeout" }));
      });
    }, seams.timeoutMs ?? MEMBER_FILE_PARSE_TIMEOUT_MS);
    worker.once("message", (message: unknown) => {
      settle(() => {
        try {
          resolve(readWorkerReply(message));
        } catch (error) {
          reject(error instanceof Error ? error : new Error("member file worker reply unreadable"));
        }
      });
    });
    worker.once("error", (error: unknown) => {
      settle(() => {
        const code = codeOf(error);
        // The file needed more memory than the worker may have.
        if (code === "ERR_WORKER_OUT_OF_MEMORY") resolve(refused({ code: "too_complex" }));
        else reject(new Error(`member file worker could not run (${code})`));
      });
    });
    worker.once("exit", (exitCode: number) => {
      settle(() => {
        reject(new Error(`member file worker stopped (exit ${String(exitCode)}) without an answer`));
      });
    });
  });
}

/** An uploaded file as a grid of text cells, or the refusal that says what to
 *  do instead. Throws only for a fault of the server's own (the worker could not
 *  start, or crashed in our code) — never with a cell in the message. */
export async function parseMemberFile(bytes: Uint8Array, seams: ParseMemberFileSeams = {}): Promise<MemberFileResult> {
  const sniffed = sniffMemberFile(bytes);
  if (sniffed.kind === "refused") return refused(sniffed.refusal);
  if (open >= MEMBER_FILE_PARSES_AT_ONCE) return refused({ code: "busy" });
  open++;
  try {
    return await readInWorker(sniffed.kind, bytes, seams);
  } finally {
    open--;
  }
}
