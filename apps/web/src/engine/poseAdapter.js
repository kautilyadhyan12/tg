// P1.10b — the on-device engine bridge (v1 §13, D1). Turns the pose provider's
// output (MediaPipe landmarks) into @app/engine input and runs one session PER
// SET. This module is the ONLY place platform time (a wall clock) meets the
// engine: the caller passes each frame's timestamp in, so the engine itself
// stays wall-clock-free (R5.1) and this module stays deterministically testable.
//
// §2.2 mirroring policy, decided once and ONLY here: the engine always receives
// UN-MIRRORED provider coordinates. We never flip the landmark array — mirroring
// belongs to the drawn overlay alone (PoseOverlay renders mirrored, the engine
// does not). Flipping coords here would silently invert every left/right + valgus.
import { createSession, compileDefinition, ENGINE_VERSION } from "@app/engine";
import squat from "@app/engine/definitions/squat.json";
import jumpSquat from "@app/engine/definitions/jump_squat.json";
import chairSquat from "@app/engine/definitions/chair_squat.json";

// The definitions bundled with the engine today (P1.10b bridge). The eventual
// runtime source is the P2.2 catalog bundle API (Part 2 §9.3), cached offline.
// Keyed by definition `key`, plus each def's declared aliases (§4 `aliases`).
const DEFINITIONS = {};
for (const def of [squat, jumpSquat, chairSquat]) {
  DEFINITIONS[def.key] = def;
  for (const alias of def.aliases ?? []) DEFINITIONS[alias] = def;
}

/** Thrown when a definition needs a newer engine than this client ships (I4).
 *  The caller must not run the set — it offers no analysis for that exercise. */
export class EngineUnsupportedError extends Error {
  constructor(exerciseKey, required, have) {
    super(`engine ${have} < definition ${exerciseKey} requires ${required}`);
    this.name = "EngineUnsupportedError";
  }
}

/** Resolve an exercise key/alias to its bundled definition, or null if the
 *  engine has no pose definition for it yet (most of the 58 — those exercises
 *  have no on-device analysis in this slice). */
export function getDefinition(exerciseKey) {
  return DEFINITIONS[exerciseKey] ?? null;
}

// Semver "major.minor.patch" → [n,n,n]. §4 declares minEngineVersion as semver;
// the I4 gate only needs "engine >= required", so a numeric-tuple compare is
// sufficient and avoids a semver dependency.
function parseSemver(v) {
  const parts = String(v).split(".").map((n) => Number.parseInt(n, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/** I4 client gate: true iff this engine is new enough to run `def`
 *  (Part 2 §1.3 — "a client whose engine is older simply doesn't offer that
 *  exercise"). */
export function engineSupports(def) {
  const [reqMajor, reqMinor, reqPatch] = parseSemver(def.minEngineVersion);
  const [haveMajor, haveMinor, havePatch] = parseSemver(ENGINE_VERSION);
  if (haveMajor !== reqMajor) return haveMajor > reqMajor;
  if (haveMinor !== reqMinor) return haveMinor > reqMinor;
  return havePatch >= reqPatch;
}

/** Does THIS BUILD offer camera form-analysis for `slug`? The exercise library's
 *  "AI" badge, in one place.
 *
 *  BOTH HALVES MATTER, and the second had no test until T3 round 1 F1 measured
 *  it: `&& engineSupports(def)` could be deleted with every suite still green,
 *  because every badge test injects a STUB for this function and none of them
 *  ever reached the real I4 gate. A badge that ignored the gate would promise
 *  camera grading this build cannot start — `startSet` above throws
 *  EngineUnsupportedError on the very first frame of exactly that definition.
 *
 *  It lives HERE, next to the gate it depends on, rather than in the library
 *  page: the page file must keep exporting a component and nothing else
 *  (react-refresh/only-export-components, a lint error this card removed), and a
 *  function inside a page component file cannot be tested without a DOM.
 *
 *  `resolve` is injected for the same reason the library reader injects
 *  `hasDefinition`: the three bundled definitions all declare minEngineVersion
 *  "1.0.0" and ENGINE_VERSION is "1.0.0", so with the real map the gate's FALSE
 *  arm is unreachable — a test could not distinguish a live gate from a deleted
 *  one. The default is the real resolver; the page never passes a second
 *  argument. */
export function hasCameraAnalysis(slug, resolve = getDefinition) {
  const def = resolve(slug);
  return def !== null && engineSupports(def);
}

/** Map one pose-provider result to a PoseFrame (§2.4 input). UN-MIRRORED: x/y/z
 *  pass through untouched (§2.2). Missing/empty landmarks → an empty `kp`, which
 *  the engine's ingest treats as an invalid frame (§3.1 fail-soft: hold state,
 *  count nothing, raise the visibility hint) — we never fabricate points. */
export function landmarksToFrame(landmarks, tMs) {
  const kp = (landmarks ?? []).map((lm) => [lm.x, lm.y, lm.z, lm.visibility ?? 1.0]);
  return { t: tMs, kp };
}

/** Start one set. Throws EngineUnsupportedError if the engine can't run `def`
 *  (I4) — never silently runs an incompatible definition (R1.3). Returns a thin
 *  per-set handle; `feed` maps a provider result + its timestamp to a FrameResult,
 *  `end` produces the §2.4 SetSummary (idempotent), `snapshot` is the §3.9
 *  crash-resilience checkpoint. */
export function startSet(def, setIndex) {
  if (!engineSupports(def)) {
    throw new EngineUnsupportedError(def.key, def.minEngineVersion, ENGINE_VERSION);
  }
  const config = compileDefinition(def, setIndex);
  const session = createSession(config);
  return {
    /** The rep metric signal (+ compiled fallback): when none of these appear
     *  in FrameResult.signals, the joints the exercise is measured by are not
     *  usable this frame — the caller surfaces the §3.1 "step back" cue. */
    metricSignals: [config.metric, ...(config.metricFallback ? [config.metricFallback] : [])],
    feed(landmarks, tMs) {
      return session.processFrame(landmarksToFrame(landmarks, tMs));
    },
    onRep(listener) {
      session.onRep(listener);
    },
    end() {
      return session.end();
    },
    snapshot() {
      return session.snapshot();
    },
  };
}
