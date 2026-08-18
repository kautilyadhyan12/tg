/** The build script and the running app must agree about where the camera's
 *  files are.
 *
 *  ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *  Two places now name the same paths: `tools/fetch-pose-assets.mjs` decides
 *  where to WRITE them, and `usePoseDetection` / `poseTuning` decide where to
 *  READ them. Nothing makes them agree, and if they ever stop agreeing the
 *  symptom is not a crash — it is the app silently going back to downloading
 *  everything from the internet, which is the exact defect this card fixed and
 *  which went unnoticed for months the first time.
 *
 *  This is the repo's own recorded lesson applied before it bites: *"a shared
 *  value with two declarations has two comments, and the second is where a
 *  correction gets lost"* (:4556 F1). The alternative — moving the paths into
 *  one module both sides import — would have meant a Node build script
 *  importing a file that reads `import.meta.env`, and a wider diff through
 *  `poseTuning.js`, whose mutation anchors this card would then have had to
 *  re-verify. An assertion is the smaller and more honest instrument.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  POSE_ASSETS,
  WASM_DIR,
  MEDIAPIPE_VERSION,
  sha256,
  verifyBuffer,
} from '../../tools/fetch-pose-assets.mjs';
import { LOCAL_WASM_BASE, REMOTE_WASM_BASE } from './usePoseDetection.js';
import { modelUrls, POSE_DEFAULTS } from '../dev/poseTuning.js';

/** `dest` is relative to `public/`, which Vite serves from the site root — so
 *  the URL the browser asks for is exactly `/` + dest. */
const urlFor = (asset) => `/${asset.dest}`;

const modelAssets = POSE_ASSETS.filter((a) => a.dest.endsWith('.task'));
const wasmAssets = POSE_ASSETS.filter((a) => a.dest.startsWith(`${WASM_DIR}/`));

/** The bundled asset for a variant, or undefined — `find` on ONE model was the
 *  original shape and it stopped being safe the moment a second was bundled:
 *  it would have answered with whichever happened to be listed first, so
 *  switching the default to a model nobody fetches would have passed. */
const bundledFor = (variant) =>
  modelAssets.find((a) => urlFor(a) === modelUrls(variant).local);

describe('the bundled model is the one the app actually asks for', () => {
  it('THE SHIPPED DEFAULT IS ONE OF THE MODELS THE BUILD WRITES', () => {
    // The assertion with the most teeth in this file, and the one the
    // 2026-08-17 model swap turned load-bearing. Point `POSE_DEFAULTS.model` at
    // a variant `fetch-pose-assets.mjs` does not fetch and NOTHING ELSE
    // COMPLAINS: the app asks for a `.task` that was never written, Vite answers
    // a missing `public/` file with index.html at 200, MediaPipe fails on a web
    // page where it expected a zip, and every camera workout silently downloads
    // 9.4 MB from Google instead — the exact defect, and the exact silence, that
    // hid for months the first time.
    expect(
      bundledFor(POSE_DEFAULTS.model),
      `the shipped default is '${POSE_DEFAULTS.model}' and the build fetches ` +
        `${modelAssets.map((a) => a.dest).join(', ')}`,
    ).toBeDefined();
  });

  it('fetches EVERY bundled model from the same URL the app would fall back to', () => {
    // So the bundled bytes and the fallback bytes cannot be different models.
    // Every model, not just the default: `lite` is bundled precisely so it can
    // be compared against `full`, and a comparison against different bytes than
    // the fallback would serve is not a comparison.
    for (const asset of modelAssets) {
      const variant = asset.dest.match(/pose_landmarker_(\w+)\.task$/)?.[1];
      expect(variant, asset.dest).toBeDefined();
      expect(asset.url).toBe(modelUrls(variant).remote);
      expect(urlFor(asset)).toBe(modelUrls(variant).local);
    }
  });

  it('keeps LITE bundled as well, so the old measurements stay reproducible offline', () => {
    // §3.3's own step-down, and more immediately: every number this project has
    // ever measured — the thirteen clips behind `bone_stretch > 0.923`, both
    // throughput sessions, the golden traces — was taken under `lite`. The day
    // the default moved is the day those become impossible to re-run if `lite`
    // has to come off a CDN.
    expect(bundledFor('lite'), 'lite must stay bundled').toBeDefined();
  });

  it('pins a digest and a length for every model, not just a length', () => {
    // A truncated download is the failure mode being fixed; any 5,777,746 bytes
    // would satisfy a length check.
    expect(modelAssets.length).toBeGreaterThan(0);
    for (const asset of modelAssets) {
      expect(asset.sha256, asset.dest).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.bytes, asset.dest).toBeGreaterThan(0);
    }
  });

  it('gives each model its OWN digest — two entries cannot describe one file', () => {
    // A copy-paste that left `full` carrying `lite`'s hash would fail the build
    // rather than ship the wrong model, but it would fail confusingly. This says
    // which mistake it was.
    const digests = new Set(modelAssets.map((a) => a.sha256));
    expect(digests.size).toBe(modelAssets.length);
  });
});

describe('the bundled runtime is the one the app actually asks for', () => {
  it('writes every file INTO the directory the app loads from, not merely under it', () => {
    // DIRECTORY EQUALITY, NOT A PREFIX. `startsWith` was the original assertion
    // and it could not fail: shortening the base from `/mediapipe/wasm` to
    // `/mediapipe` still satisfies it, while the app then asks for
    // `/mediapipe/vision_wasm_internal.js`, gets Vite's SPA fallback —
    // index.html at 200, the original defect's exact shape — and goes back to
    // the CDN on every workout. 36 tests stayed green against that app.
    // MediaPipe joins base + filename with no path walking, so the file's
    // parent directory must BE the base, not merely start with it.
    expect(wasmAssets.length).toBeGreaterThan(0);
    for (const asset of wasmAssets) {
      const url = urlFor(asset);
      expect(url.slice(0, url.lastIndexOf('/'))).toBe(LOCAL_WASM_BASE);
    }
  });

  it('fetches the SAME MediaPipe build the fallback URL names', () => {
    // The app has been running 0.10.35's JavaScript against 0.10.21's
    // WebAssembly. Bundling a THIRD version would change what the camera sees,
    // which is the one thing this card promised not to do.
    expect(REMOTE_WASM_BASE).toContain(`@${MEDIAPIPE_VERSION}/wasm`);
    for (const asset of wasmAssets) {
      expect(asset.url).toContain(`@${MEDIAPIPE_VERSION}/wasm/`);
    }
  });

  it('ships BOTH the SIMD and the non-SIMD variant', () => {
    // FilesetResolver probes the browser and picks one at runtime. Shipping only
    // the variant this machine happens to use strands whichever browser picks
    // the other — offline, with no way back.
    const names = wasmAssets.map((a) => a.dest);
    expect(names.some((n) => n.includes('nosimd'))).toBe(true);
    expect(names.some((n) => !n.includes('nosimd'))).toBe(true);
  });

  it('ships the loader script alongside every .wasm binary', () => {
    // `.wasm` without its `.js` loader is a 404 at the worst moment.
    const stems = wasmAssets
      .filter((a) => a.dest.endsWith('.wasm'))
      .map((a) => a.dest.replace(/\.wasm$/, ''));
    for (const stem of stems) {
      expect(wasmAssets.some((a) => a.dest === `${stem}.js`), stem).toBe(true);
    }
  });
});

describe('the integrity check — the only thing between a bad download and the defect', () => {
  // A file that is not what the app thinks it is IS the defect this card fixed:
  // MediaPipe was handed a 404 body where it expected a zip and failed in a way
  // that read as routine. A verification that cannot fail would let that back in
  // through the front door, and the build would still say it had succeeded.
  // `TextEncoder` rather than `Buffer`: this file is linted with the browser
  // globals the rest of `src/` gets, where `Buffer` is undefined. A Uint8Array
  // is what `verifyBuffer` and `createHash` both take anyway.
  const bytes = (s) => new TextEncoder().encode(s);
  const asset = { dest: 'x.task', bytes: 4, sha256: sha256(bytes('good')) };

  it('accepts the exact bytes', () => {
    expect(verifyBuffer(bytes('good'), asset)).toBe(true);
  });

  it('REJECTS the right length with the wrong content', () => {
    // The one a length check cannot see, and the realistic one: an error page
    // that happens to be the right size, or a byte flipped in transit.
    expect(() => verifyBuffer(bytes('bad!'), asset)).toThrow(/sha256 mismatch/);
  });

  it('REJECTS a truncated download, and says so in those words', () => {
    expect(() => verifyBuffer(bytes('go'), asset)).toThrow(/expected 4 bytes, got 2/);
  });

  it('REJECTS an empty file', () => {
    expect(() => verifyBuffer(new Uint8Array(0), asset)).toThrow();
  });

  it('names the asset in the failure, so a build log says WHICH file', () => {
    expect(() => verifyBuffer(bytes('bad!'), asset)).toThrow(/x\.task/);
  });
});

describe('the fallback still exists', () => {
  it('keeps a network source, so a build without assets degrades instead of dying', () => {
    // Removing the fallback would turn a missing build step into "no camera at
    // all". It stays — what changed is that taking it is now REPORTED.
    expect(REMOTE_WASM_BASE.startsWith('https://')).toBe(true);
    expect(modelUrls(POSE_DEFAULTS.model).remote.startsWith('https://')).toBe(true);
  });

  it('is a DIFFERENT source from the bundled one, or there is no fallback at all', () => {
    expect(LOCAL_WASM_BASE).not.toBe(REMOTE_WASM_BASE);
  });
});

describe('the download step is actually wired into the scripts that run', () => {
  /** THE WHOLE CARD RESTS ON TWO LITERAL STRINGS AND NOTHING READ THEM.
   *
   *  Deleting `node tools/fetch-pose-assets.mjs && ` from `build` left the web
   *  suite at 674/674, all 17 mutants RED, typecheck and lint clean — while a
   *  production build shipped without the assets and every camera workout went
   *  back to the CDN. That is the SAME failure the fetch script's own header
   *  warns about for `predev` hooks ("would have looked wired and silently
   *  never run"), one level up: the script was correct, its invocation was the
   *  unguarded part.
   *
   *  Read off disk rather than imported, so this asserts what the package
   *  manager will actually execute. */
  const pkg = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  );

  for (const script of ['dev', 'build']) {
    it(`\`${script}\` runs the fetch script before anything else can need the assets`, () => {
      expect(pkg.scripts[script]).toContain('fetch-pose-assets');
    });
  }

  it('keeps a standalone way to fetch them, for the smoke and for a repair', () => {
    expect(pkg.scripts['pose:assets']).toContain('fetch-pose-assets');
  });
});
