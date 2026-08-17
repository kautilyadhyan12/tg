#!/usr/bin/env node
/**
 * fetch-pose-assets.mjs — put the camera's two downloads INSIDE the app.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * A camera workout used to fetch TWO things off the public internet on every
 * single run, and neither was ever meant to be a runtime dependency:
 *
 *   1. THE POSE MODEL. `usePoseDetection` asked for `/models/*.task` first and
 *      fell back to Google's CDN. The fallback fired every time, because
 *      `apps/web/public/models/` HAS NEVER CONTAINED A `.task` FILE — measured
 *      2026-08-16, the directory holds one unrelated `.onnx`. MediaPipe was
 *      handed a 404 body where it expected a zip, which is exactly the
 *      `Unable to open zip archive` / `MediaPipeTasksStatus=104` in Kd's
 *      console (OWED, "the LOCAL pose model is broken"). **Nothing was broken.
 *      The file was never there**, and the owed line's "likely corrupt or an
 *      LFS pointer — check the file's real size first" is corrected by that
 *      measurement: there was no file to have a size.
 *
 *   2. THE MEDIAPIPE RUNTIME — ~9.6 MB of WebAssembly, from jsdelivr, named
 *      nowhere in OWED and the reason bundling the model ALONE would not have
 *      worked. Fixing one and not the other leaves camera workouts online-only
 *      and would have read as a fix.
 *
 * ── WHY IT DOWNLOADS RATHER THAN COMMITTING THE BYTES ───────────────────────
 * ~25 MB of binaries in a repo with no LFS, which would grow again the moment
 * the §3.6 ladder ships a second model. The assets are gitignored and built
 * here instead. A BUILD has internet; a WORKOUT does not — that is the line
 * this file draws.
 *
 * ── WHY IT PINS SHA-256 AND NOT JUST A LENGTH ───────────────────────────────
 * The defect being fixed is a file that was not what the app thought it was.
 * A half-written download would reproduce it exactly, and a length check
 * passes on any 5,777,746 bytes. Every digest below was measured by
 * downloading the asset in the session that wrote this file.
 *
 * ── WHY IT IS NOT A `predev` / `prebuild` HOOK ──────────────────────────────
 * pnpm does not run npm's implicit pre/post scripts unless
 * `enable-pre-post-scripts` is turned on, so the hook would have looked wired
 * and silently never run — the same shape as the defect above, and as :6856's
 * "asking someone to spot a MISSING thing is not a check". `dev` and `build`
 * call it by name instead.
 *
 * Run directly:  node tools/fetch-pose-assets.mjs
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(HERE, '..', 'public');

/** The MediaPipe build whose WASM is fetched.
 *
 *  DELIBERATELY NOT the version in `package.json` (0.10.35), and this is the
 *  one decision in this file that is not obvious. The app has been running
 *  0.10.35's JavaScript against **0.10.21's WebAssembly** — the URL at
 *  `usePoseDetection.js` pins 21 while npm installed 35 — and the WASM is where
 *  the inference actually happens. So 0.10.21 is what produced every landmark
 *  this project has ever measured, including the thirteen clips Kd's
 *  `bone_stretch > 0.923` ruling was derived from.
 *
 *  Copying node_modules' 0.10.35 WASM instead would have been tidier and would
 *  have quietly changed what the camera sees, on a card whose whole promise to
 *  Kd was that it does not. The mismatch is real and is owed its own card,
 *  together with the model swap that has the same hazard. */
export const MEDIAPIPE_VERSION = '0.10.21';

/** Served by Vite from `public/`, so this is the app-relative URL too. */
export const WASM_DIR = 'mediapipe/wasm';

/** All four, not just the SIMD pair. `FilesetResolver` probes the browser and
 *  picks one at runtime; shipping only the variant this machine happens to use
 *  would strand whichever browser picks the other, offline, with no way back. */
const WASM_ASSETS = [
  {
    file: 'vision_wasm_internal.js',
    bytes: 204284,
    sha256: '4a97e2520ba506c680ecd6ba6acfb146888afa0e2746d57f205352bc6ebb82eb',
  },
  {
    file: 'vision_wasm_internal.wasm',
    bytes: 9574032,
    sha256: 'f00ec4731faa23b3e714d00e88d4d10e2df5c0a427d3a2b4ae6e3526fdd14ef7',
  },
  {
    file: 'vision_wasm_nosimd_internal.js',
    bytes: 204137,
    sha256: '927def7b465c51b86e4b3060f93646aca4e27121f4b8fc0483786e407ea9cf1f',
  },
  {
    file: 'vision_wasm_nosimd_internal.wasm',
    bytes: 9448638,
    sha256: '3821ea9b1f7fb8c549ef2a064ef5c85750bf375c545a49fd6eea0df44a95f1f4',
  },
];

/**
 * Everything the camera needs on disk, with where it comes from and what it
 * must hash to.
 *
 * `dest` is relative to `apps/web/public`, which makes it the app-relative URL
 * as well — that equality is what a test pins against the runtime's own
 * constants, so this table and the code that fetches these files at runtime
 * cannot drift apart (:4556 F1: a value declared twice is where a correction
 * gets lost).
 */
export const POSE_ASSETS = [
  ...WASM_ASSETS.map((a) => ({
    dest: `${WASM_DIR}/${a.file}`,
    url: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm/${a.file}`,
    bytes: a.bytes,
    sha256: a.sha256,
  })),
  {
    // The `lite` model, which is what ships today and what this card leaves
    // alone. Verified byte-identical (sha256 59929e1d…) to the copy the old
    // Python backend has been analysing with since July, so bundling it changes
    // no landmark anywhere.
    dest: 'models/pose_landmarker_lite.task',
    url:
      'https://storage.googleapis.com/mediapipe-models/' +
      'pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    bytes: 5777746,
    sha256: '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a',
  },
];

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * Are these bytes the asset we meant? Throws with a usable message if not.
 *
 * SEPARATED OUT SO IT CAN BE TESTED, and that is not tidiness. This function is
 * the only thing standing between a half-written download and the exact defect
 * this card fixed: MediaPipe handed a file that is not the file it expects,
 * failing in a way that reads as routine and silently sends the camera back to
 * the internet. Everything around it is I/O; this is the guarantee.
 *
 * LENGTH *AND* DIGEST, because the length alone is satisfied by any 5,777,746
 * bytes — including 5,777,746 bytes of somebody's error page. The length is
 * still checked first purely so the failure message can say "truncated" rather
 * than printing two hashes at someone.
 */
export function verifyBuffer(buf, asset) {
  if (buf.byteLength !== asset.bytes) {
    throw new Error(
      `${asset.dest}: expected ${asset.bytes} bytes, got ${buf.byteLength}. ` +
        'Refusing to write a file the app would fail to open.',
    );
  }
  const got = sha256(buf);
  if (got !== asset.sha256) {
    throw new Error(
      `${asset.dest}: sha256 mismatch.\n  expected ${asset.sha256}\n  got      ${got}\n` +
        'Either the upstream asset changed or the download was corrupted; do not ship this.',
    );
  }
  return true;
}

/** Already present AND correct. A wrong-length or wrong-hash file is treated as
 *  absent and re-fetched rather than trusted — the same check as on the way in,
 *  because a file can rot on disk after a good download just as easily. */
async function isSatisfied(path, asset) {
  try {
    verifyBuffer(await readFile(path), asset);
    return true;
  } catch {
    return false;
  }
}

async function fetchAsset(asset, path) {
  const res = await fetch(asset.url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${asset.url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  verifyBuffer(buf, asset);

  // Written under a temporary name and renamed, so an interrupted run can never
  // leave a half-file that the next run's hash check would have to catch.
  const tmp = `${path}.partial`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(tmp, buf);
  await rename(tmp, path);
}

export async function ensurePoseAssets({ log = console.log } = {}) {
  let fetched = 0;
  for (const asset of POSE_ASSETS) {
    const path = join(PUBLIC_DIR, ...asset.dest.split('/'));
    if (await isSatisfied(path, asset)) continue;
    log(`[pose-assets] fetching ${asset.dest} (${(asset.bytes / 1e6).toFixed(1)} MB)`);
    try {
      await fetchAsset(asset, path);
    } catch (err) {
      await rm(`${path}.partial`, { force: true });
      throw err;
    }
    fetched += 1;
  }
  return { total: POSE_ASSETS.length, fetched };
}

// Only when invoked as a command — importing this module (a test does) must not
// hit the network.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { total, fetched } = await ensurePoseAssets();
    console.log(
      fetched === 0
        ? `[pose-assets] all ${total} camera assets already present and verified`
        : `[pose-assets] ${fetched} of ${total} fetched; all verified`,
    );
  } catch (err) {
    console.error(`\n[pose-assets] FAILED: ${err.message}\n`);
    console.error(
      'The camera needs these files bundled to work offline. Fix the network or\n' +
        'the digests above and re-run; do NOT ship a build without them — it would\n' +
        'silently fall back to downloading them from the internet mid-workout.\n',
    );
    process.exit(1);
  }
}
