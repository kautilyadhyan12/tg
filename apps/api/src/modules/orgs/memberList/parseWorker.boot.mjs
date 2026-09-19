// The member file worker's entry (spec Part 3 §9.4): plain JavaScript that loads
// the TypeScript worker through tsx itself.
//
// A worker started on `parseWorker.ts` with `--import tsx` in its execArgv runs
// under tsx on Node 24 but NOT on Node 22, which CI and production run: measured
// 2026-09-19 on Node 22.23.2 (CI's), Node's own type stripping loaded
// `parseWorker.ts` and its `./openFile.js` import was not found. `tsImport` loads
// it through tsx on both, and resolves tsx from this file, not from the working
// directory the API was started in.
import { tsImport } from "tsx/esm/api";

await tsImport("./parseWorker.ts", import.meta.url);
