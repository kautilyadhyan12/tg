// The worker thread one member file is opened in (spec Part 3 §9.4), started
// fresh for every file by `parseMemberFile.ts` through `parseWorker.boot.mjs`.
// It reads its job, answers once (`workerAnswer.ts`) and exits.
import { parentPort, workerData } from "node:worker_threads";
import { workerAnswer } from "./workerAnswer.js";

parentPort?.postMessage(await workerAnswer(workerData));
