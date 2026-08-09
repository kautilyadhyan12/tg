/**
 * poseTuning — DEV-ONLY MediaPipe settings from the URL.
 *
 * WHY THESE MATTER MORE THAN THEY LOOK. This module decides what the pose model
 * is actually configured with. Two failure directions, and both are silent:
 *   - a bad URL value quietly REPLACING a shipped default would change what the
 *     camera does with nobody noticing, and card 3's whole point is comparing
 *     runs whose settings are known;
 *   - the gate leaking into a PRODUCTION build would let a query string
 *     reconfigure a real user's camera.
 * Neither shows up on screen, so neither would be caught by a smoke test.
 */
import { describe, it, expect } from 'vitest';
import {
  MODEL_NAMES,
  POSE_DEFAULTS,
  describeTuning,
  isTuned,
  modelUrls,
  readPoseTuning,
} from './poseTuning';

describe('readPoseTuning', () => {
  it('returns exactly the shipped defaults when the URL says nothing', () => {
    // These four numbers ARE what usePoseDetection hard-wired before this
    // module existed. If this test ever has to change, shipped behaviour
    // changed with it — which is a decision, not a refactor.
    expect(readPoseTuning('')).toEqual({
      model: 'lite',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  });

  it('reads every dial the recording session needs', () => {
    const t = readPoseTuning(
      '?model=full&numPoses=2&detectConf=0.9&presenceConf=0.7&trackConf=0.95',
    );
    expect(t).toEqual({
      model: 'full',
      numPoses: 2,
      minPoseDetectionConfidence: 0.9,
      minPosePresenceConfidence: 0.7,
      minTrackingConfidence: 0.95,
    });
  });

  it('falls back to the default for a value out of range, never clamps silently to an edge', () => {
    // A clamp would turn `detectConf=5` into 1.0 — a REAL setting nobody asked
    // for, recorded in the header as deliberate. Falling back to the default is
    // the honest reading of a typo.
    expect(readPoseTuning('?detectConf=5').minPoseDetectionConfidence).toBe(0.5);
    expect(readPoseTuning('?detectConf=-1').minPoseDetectionConfidence).toBe(0.5);
    expect(readPoseTuning('?detectConf=banana').minPoseDetectionConfidence).toBe(0.5);
    expect(readPoseTuning('?trackConf=').minTrackingConfidence).toBe(0.5);
  });

  it('refuses a non-integer or absurd numPoses', () => {
    expect(readPoseTuning('?numPoses=1.5').numPoses).toBe(1);
    expect(readPoseTuning('?numPoses=0').numPoses).toBe(1);
    expect(readPoseTuning('?numPoses=99').numPoses).toBe(1);
  });

  it('accepts ONLY the three published model names', () => {
    for (const name of MODEL_NAMES) {
      expect(readPoseTuning(`?model=${name}`).model).toBe(name);
    }
    expect(readPoseTuning('?model=turbo').model).toBe('lite');
    expect(readPoseTuning('?model=../../etc/passwd').model).toBe('lite');
  });

  it('accepts 0 and 1, which are real settings and not "missing"', () => {
    // `Number('0')` is falsy — a `||` fallback would silently turn "trust
    // nothing" into the default, and 0/1 are exactly the extremes card 3 wants
    // to sweep.
    expect(readPoseTuning('?detectConf=0').minPoseDetectionConfidence).toBe(0);
    expect(readPoseTuning('?detectConf=1').minPoseDetectionConfidence).toBe(1);
  });
});

describe('modelUrls', () => {
  it('builds both URLs from the variant, never from the raw query value', () => {
    const full = modelUrls('full');
    expect(full.local).toBe('/models/pose_landmarker_full.task');
    expect(full.remote).toContain('pose_landmarker_full/float16/1/pose_landmarker_full.task');
  });

  it('falls back to lite for an unknown variant rather than fetching a bad path', () => {
    expect(modelUrls('turbo').local).toBe(modelUrls('lite').local);
  });

  it('keeps the lite URLs byte-identical to what the app shipped', () => {
    // The exact two strings usePoseDetection carried before this module. A
    // change here changes which model every user downloads.
    expect(modelUrls('lite')).toEqual({
      local: '/models/pose_landmarker_lite.task',
      remote:
        'https://storage.googleapis.com/mediapipe-models/' +
        'pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    });
  });
});

describe('isTuned / describeTuning', () => {
  it('is false for the defaults, so the widget stays quiet on a normal run', () => {
    expect(isTuned(readPoseTuning(''))).toBe(false);
  });

  it('is true when ANY single dial has moved', () => {
    for (const q of ['?model=full', '?numPoses=2', '?detectConf=0.9', '?presenceConf=0.9', '?trackConf=0.9']) {
      expect(isTuned(readPoseTuning(q)), q).toBe(true);
    }
  });

  it('names every dial, so a screenshot of the widget is a complete record', () => {
    const text = describeTuning(readPoseTuning('?model=full&numPoses=2&detectConf=0.9'));
    expect(text).toContain('full');
    expect(text).toContain('n=2');
    expect(text).toContain('det=0.9');
    expect(text).toContain('pres=0.5');
    expect(text).toContain('track=0.5');
  });
});
