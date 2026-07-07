// Stage 1 tests (Part 2 §3.1).
import { describe, expect, it } from "vitest";
import { IngestStage, validKeypoints } from "../../src/index.js";
import { makeFrames, must } from "../fixtures.js";

const good = () => must(makeFrames(1)[0]);

describe("validKeypoints (legacy port)", () => {
  it("accepts 33 × [x,y,z,vis] finite", () => {
    expect(validKeypoints(good().kp)).toBe(true);
  });
  it("rejects 32 entries, short entries, NaN, Infinity, non-numbers", () => {
    expect(validKeypoints(good().kp.slice(0, 32))).toBe(false);
    const short: unknown[] = [...good().kp];
    short[5] = [0.5, 0.5, 0];
    expect(validKeypoints(short)).toBe(false);
    const nan: unknown[] = [...good().kp];
    nan[10] = [0.5, Number.NaN, 0, 0.9];
    expect(validKeypoints(nan)).toBe(false);
    const inf: unknown[] = [...good().kp];
    inf[10] = [Number.POSITIVE_INFINITY, 0.5, 0, 0.9];
    expect(validKeypoints(inf)).toBe(false);
    const str: unknown[] = [...good().kp];
    str[0] = ["x", 0.5, 0, 0.9];
    expect(validKeypoints(str)).toBe(false);
  });
});

describe("IngestStage (§3.1)", () => {
  it("accepts ordered valid frames; drops out-of-order t and counts it", () => {
    const stage = new IngestStage();
    const frames = makeFrames(3);
    const f0 = must(frames[0]);
    const f1 = must(frames[1]);
    const f2 = must(frames[2]);
    expect(stage.accept(f0).ok).toBe(true);
    expect(stage.accept(f1).ok).toBe(true);
    const replay = stage.accept({ ...f1, t: f0.t }); // t went backwards
    expect(replay.ok).toBe(false);
    expect(replay.dropReason).toBe("out_of_order");
    expect(replay.visibilityOk).toBe(true); // person is still visible
    expect(stage.accept(f2).ok).toBe(true);
    expect(stage.diagnostics.droppedOutOfOrder).toBe(1);
    expect(stage.diagnostics.framesSeen).toBe(4);
  });

  it("equal t is out-of-order (strictly greater required)", () => {
    const stage = new IngestStage();
    const f = good();
    stage.accept(f);
    expect(stage.accept({ ...f }).dropReason).toBe("out_of_order");
  });

  it("3 consecutive invalid frames flip visibilityOk; one valid frame restores it", () => {
    const stage = new IngestStage();
    const frames = makeFrames(6);
    stage.accept(must(frames[0]));
    const bad = { t: 1, kp: must(frames[1]).kp.slice(0, 32) };
    expect(stage.accept(bad).visibilityOk).toBe(true); // 1st invalid
    expect(stage.accept(bad).visibilityOk).toBe(true); // 2nd
    expect(stage.accept(bad).visibilityOk).toBe(false); // 3rd → flip
    expect(stage.diagnostics.droppedInvalid).toBe(3);
    const back = stage.accept(must(frames[2]));
    expect(back.ok).toBe(true);
    expect(back.visibilityOk).toBe(true); // recovery
  });

  it("state holds across dropped frames (t cursor unchanged by drops)", () => {
    const stage = new IngestStage();
    const frames = makeFrames(3);
    stage.accept(must(frames[0]));
    stage.accept({ t: Number.NaN, kp: must(frames[1]).kp });
    // next valid frame with normal t still accepted — drop didn't advance/corrupt lastT
    expect(stage.accept(must(frames[1])).ok).toBe(true);
  });
});
