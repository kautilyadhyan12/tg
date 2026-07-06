/**
 * FormClassifier.js
 *
 * Browser-side squat form classifier backed by an ONNX model.
 * Runs via ONNX Runtime Web (WebGL → WASM fallback).
 *
 * To swap the model, change MODEL_PATH below — nothing else needs to change.
 *
 * Input:  33 MediaPipe keypoints per frame, [[x,y,z,visibility], ...]
 * Output: { label: "good"|"bad"|null, confidence: 0-1|null, ready: bool }
 *
 * Preprocessing matches the Colab training build_sample exactly:
 *   - 4 channels: x, y, z, visibility
 *   - Hip-centered (joints 23 + 24)
 *   - Torso-scaled (joints 11 + 12)
 *   - Transposed to (C, T, V) = (4, 32, 33) before inference
 *
 * Classification runs every 8 frames once the 32-frame buffer is full.
 */

// ── Configuration ─────────────────────────────────────────────────────────────

const MODEL_PATH = "/models/ctr_gcn_clean_ensemble_quant.onnx";

// Must match training values exactly
const SEQ_LEN       = 32;    // frames per sequence
const NUM_JOINTS    = 33;    // MediaPipe BlazePose
const IN_CHANNELS   = 4;     // x, y, z, visibility
const THRESHOLD     = 0.50;  // good_prob >= this → "good" (best test operating point)
const CLASSIFY_EVERY = 16;   // run inference every N frames once buffer is full
                             // (16 ≈ 2 inferences/sec — halves ensemble compute
                             // vs 8 with no perceptible feedback delay)
const SMOOTH_WINDOW  = 5;    // majority vote over the last N inference results.
                             // One squat rep (~2-3s) produces 5-8 inferences, so
                             // a 5-vote window ≈ one rep. Independent errors
                             // cancel out: ~84% per-window accuracy becomes
                             // ~90%+ per-rep accuracy as experienced by the user.

// ── FormClassifier class ──────────────────────────────────────────────────────

export class FormClassifier {
  constructor() {
    this._session    = null;   // ONNX InferenceSession
    this._buffer     = [];     // rolling window of keypoint frames
    this._frameCount = 0;
    this._lastResult = { label: null, confidence: null, ready: false };
    this._votes      = [];     // recent raw inference labels for majority vote
    this._loading    = false;
    this._loaded     = false;
  }

  /**
   * Load the ONNX model. Safe to call multiple times — only loads once.
   * Returns true on success, false on failure (classifier degrades gracefully).
   */
  async load(modelPath = MODEL_PATH) {
    if (this._loaded || this._loading) return this._loaded;
    this._loading = true;

    try {
      const ort = await import("onnxruntime-web");

      // CRITICAL for smoothness: run WASM inference in a Web Worker so the
      // 3-model ensemble (potentially 100-300ms per run) never blocks the
      // main thread / camera loop.
      ort.env.wasm.proxy = true;

      // Prefer WebGL for GPU acceleration; fall back to WASM.
      // Note: quantized (INT8) models usually aren't supported by the WebGL
      // provider, so WASM-in-worker is the realistic path — that's fine.
      this._session = await ort.InferenceSession.create(modelPath, {
        executionProviders: ["webgl", "wasm"],
      });

      this._loaded  = true;
      this._loading = false;
      console.log("[FormClassifier] Model loaded:", modelPath);
      return true;
    } catch (err) {
      this._loading = false;
      console.warn("[FormClassifier] Failed to load model:", err.message);
      console.warn("[FormClassifier] Form classification disabled — rule-based fallback only.");
      return false;
    }
  }

  /**
   * Feed one frame of keypoints into the rolling buffer.
   * Call this every frame regardless of inference cadence.
   *
   * keypoints: array of 33 [x, y, z, visibility] from MediaPipe,
   *            or [] / null if no person detected this frame.
   *
   * Returns the most recent result (or { ready: false } until buffer fills).
   * Inference itself is async — call runInference() separately after update().
   */
  update(keypoints) {
    if (keypoints && keypoints.length === NUM_JOINTS) {
      this._buffer.push(keypoints);
      // Keep only the most recent SEQ_LEN frames
      if (this._buffer.length > SEQ_LEN) {
        this._buffer.shift();
      }
    }

    this._frameCount++;

    if (this._buffer.length < SEQ_LEN) {
      return { label: null, confidence: null, ready: false };
    }

    return this._lastResult;
  }

  /**
   * Run ONNX inference on the current buffer contents.
   * Call this after update() on frames where you want a fresh result
   * (i.e., when frameCount % CLASSIFY_EVERY === 0 and buffer is full).
   *
   * Returns the new result, or the cached last result if conditions aren't met.
   */
  async runInference() {
    // Not ready: buffer not full, model not loaded, or not on a classify frame
    if (this._buffer.length < SEQ_LEN) {
      return { label: null, confidence: null, ready: false };
    }
    if (!this._loaded || !this._session) {
      return this._lastResult;
    }
    if (this._frameCount % CLASSIFY_EVERY !== 0) {
      return this._lastResult;
    }

    try {
      const ort   = await import("onnxruntime-web");
      const data  = this._preprocess(this._buffer);           // Float32Array (4*32*33)
      const input = new ort.Tensor("float32", data, [1, IN_CHANNELS, SEQ_LEN, NUM_JOINTS]);

      const output   = await this._session.run({ input });
      // This model is a 3-seed label-cleaned ensemble that already applies
      // softmax internally and averages across seeds — output is
      // [P(bad), P(good)] probabilities summing to ~1, NOT raw logits.
      const probs    = output.output.data;
      const goodProb = probs[1];

      // Raw per-window decision
      const rawLabel = goodProb >= THRESHOLD ? "good" : "bad";

      // Majority vote over the last SMOOTH_WINDOW inferences (~one rep).
      // Smooths out one-off misclassifications so the user sees stable,
      // rep-level feedback instead of flickering good/bad.
      this._votes.push(rawLabel);
      if (this._votes.length > SMOOTH_WINDOW) this._votes.shift();
      const goodVotes = this._votes.filter((v) => v === "good").length;
      const smoothed  = goodVotes * 2 > this._votes.length ? "good" : "bad";

      this._lastResult = {
        label:      smoothed,
        rawLabel:   rawLabel,                          // unsmoothed, if the UI wants it
        confidence: Math.round(goodProb * 1000) / 1000,
        ready:      true,
      };
    } catch (err) {
      console.warn("[FormClassifier] Inference error:", err.message);
      // Return last known result rather than crashing
    }

    return this._lastResult;
  }

  /**
   * Check whether this frame should trigger inference.
   * Use this to decide whether to call runInference() after update().
   */
  shouldRunInference() {
    return (
      this._loaded &&
      this._buffer.length >= SEQ_LEN &&
      this._frameCount % CLASSIFY_EVERY === 0
    );
  }

  /** Reset buffer and results (call between exercises or on session restart). */
  reset() {
    this._buffer     = [];
    this._frameCount = 0;
    this._votes      = [];
    this._lastResult = { label: null, confidence: null, ready: false };
  }

  // ── Private: preprocessing ──────────────────────────────────────────────────

  /**
   * Convert a SEQ_LEN-frame buffer of MediaPipe keypoints into a
   * flat Float32Array of shape (C, T, V) = (4, 32, 33).
   *
   * Mirrors the Colab training build_sample(augment=False) exactly:
   *   1. Copy x, y, z, visibility
   *   2. Hip-center: subtract mid-hip from x and y (and z, same scale)
   *   3. Torso-scale: divide x, y, z by median torso length
   *   4. Transpose from (T, V, C) to (C, T, V)
   *
   * buf: array of SEQ_LEN frames, each [[x,y,z,vis] × 33]
   */
  _preprocess(buf) {
    const T = SEQ_LEN;
    const V = NUM_JOINTS;
    const C = IN_CHANNELS;

    // Layout: seq[t][v][c]  →  flat index: (t*V + v)*C + c
    const seq = new Float32Array(T * V * C);

    // Step 1: copy raw values
    for (let t = 0; t < T; t++) {
      const frame = buf[t];
      for (let v = 0; v < V; v++) {
        const kp  = frame[v];
        const idx = (t * V + v) * C;
        seq[idx + 0] = kp[0];  // x
        seq[idx + 1] = kp[1];  // y
        seq[idx + 2] = kp[2];  // z
        seq[idx + 3] = kp[3];  // visibility
      }
    }

    // Step 2: hip-center — subtract mid-hip from x and y each frame
    // left_hip = joint 23, right_hip = joint 24
    for (let t = 0; t < T; t++) {
      const lhIdx = (t * V + 23) * C;
      const rhIdx = (t * V + 24) * C;
      const hipX  = (seq[lhIdx + 0] + seq[rhIdx + 0]) / 2;
      const hipY  = (seq[lhIdx + 1] + seq[rhIdx + 1]) / 2;

      for (let v = 0; v < V; v++) {
        const idx = (t * V + v) * C;
        seq[idx + 0] -= hipX;
        seq[idx + 1] -= hipY;
        // z and visibility are not hip-centered
      }
    }

    // Step 3: torso-scale — divide x, y, z by median torso length
    // left_shoulder = joint 11, right_shoulder = joint 12
    // torso = distance from hip-center to mid-shoulder (in hip-centered coords)
    const torsoLengths = [];
    for (let t = 0; t < T; t++) {
      const lsIdx  = (t * V + 11) * C;
      const rsIdx  = (t * V + 12) * C;
      const midShX = (seq[lsIdx + 0] + seq[rsIdx + 0]) / 2;
      const midShY = (seq[lsIdx + 1] + seq[rsIdx + 1]) / 2;
      torsoLengths.push(Math.sqrt(midShX * midShX + midShY * midShY));
    }

    // Median of valid (non-zero) torso lengths
    const valid = torsoLengths.filter((v) => v > 0.001).sort((a, b) => a - b);
    const scale = valid.length > 0
      ? valid[Math.floor(valid.length / 2)]
      : 1.0;
    const s = Math.max(scale, 0.001);

    for (let t = 0; t < T; t++) {
      for (let v = 0; v < V; v++) {
        const idx = (t * V + v) * C;
        seq[idx + 0] /= s;  // x
        seq[idx + 1] /= s;  // y
        seq[idx + 2] /= s;  // z (same spatial scale as x/y)
        // visibility channel is NOT scaled
      }
    }

    // Step 4: transpose (T, V, C) → (C, T, V) for model input
    const out = new Float32Array(C * T * V);
    for (let c = 0; c < C; c++) {
      for (let t = 0; t < T; t++) {
        for (let v = 0; v < V; v++) {
          out[c * T * V + t * V + v] = seq[(t * V + v) * C + c];
        }
      }
    }

    return out;
  }
}
