// What a phone run must pass before it is kept (scripts/phoneKeep.ts; ROADMAP 52a-iii), on a real run cut to its first
// five frames (test/fixtures/calf_raise.phone-run.5.jsonl: the phone's chosen set-up reading the laptop's pictures of the
// calf raise, 2026-11-20) against the kept file's first five frames. Each edit is one way a run is not the phone's reading
// of the kept file's very pictures; each is refused.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeBodyPoints, type BodyPoints } from "../scripts/bodyPoints.js";
import { phoneBodyPoints, type KeptPlan } from "../scripts/phoneKeep.js";
import { readPhoneRun, type PhoneRun } from "../scripts/phoneRun.js";

const RUN = "pose_landmarker_full.cpu.t4";
const whole = decodeBodyPoints(new Uint8Array(readFileSync(join(import.meta.dirname, "movement-points/calf_raise.bodypoints"))));
const kept: BodyPoints = { ...whole, frames: whole.frames.slice(0, 5) };
const phone = readPhoneRun(readFileSync(join(import.meta.dirname, "fixtures/calf_raise.phone-run.5.jsonl"), "utf8"));
const plan: KeptPlan = { sum: phone.header.plan ?? "", videos: [{ label: "calf_raise", sha256: phone.header.video.sha256, pictures: "laptop" }] };

const keepIt = (p: PhoneRun = phone, k: BodyPoints = kept, pl: KeptPlan = plan, run: string = RUN) => phoneBodyPoints(k, p, "calf_raise", run, pl);
const header = (edit: Partial<PhoneRun["header"]>): PhoneRun => ({ ...phone, header: { ...phone.header, ...edit } });
const model = (edit: Partial<PhoneRun["header"]["model"]>): PhoneRun => header({ model: { ...phone.header.model, ...edit } });

describe("a phone run is kept only as the phone's reading of the kept file's very pictures", () => {
  it("the real run is kept, under a phone label of its own, with its own picture size and the laptop's settings", () => {
    const { header: h, frames } = keepIt();
    expect(frames).toHaveLength(5);
    expect(h.label).toBe("calf_raise_phone_pose_landmarker_full_cpu_t4");
    expect(h.source).toBe("phone");
    expect(h.picture).toEqual(phone.header.picture);
    expect([h.model.file, h.model.people, h.model.minDetection]).toEqual(["pose_landmarker_full", 1, 0.5]);
  });

  const refused: readonly (readonly [string, () => unknown, RegExp])[] = [
    ["pictures of another size", () => keepIt(header({ picture: { width: 2 * phone.header.picture.width, height: 2 * phone.header.picture.height } })), /pictures of/],
    ["other detection settings", () => keepIt(model({ minDetection: 0.9, minPresence: 0.9, minTracking: 0.9 })), /other settings/],
    ["other pictures than its plan gave", () => keepIt(header({ video: { ...phone.header.video, sha256: "f".repeat(64) } })), /other pictures/],
    ["made for another plan", () => keepIt(header({ plan: "e".repeat(64) })), /another plan/],
    ["a plan that names no such video", () => keepIt(phone, kept, { ...plan, videos: [] }), /names no such video/],
    ["a plan that gave the phone the video", () => keepIt(phone, kept, { ...plan, videos: [{ label: "calf_raise", sha256: phone.header.video.sha256, pictures: "video" }] }), /other pictures/],
    ["the phone decoding the video itself", () => keepIt(header({ pictures: "video" })), /decoded the video itself/],
    ["another label", () => keepIt(header({ label: "calf_raise_dumbbell" })), /labelled/],
    ["six people asked", () => keepIt(model({ people: 6 })), /6 people/],
    ["a model not pinned", () => keepIt(model({ sha256: "a".repeat(64) })), /pinned/],
    ["the graphics chip under the main chip's name", () => keepIt(header({ delegate: "gpu", threads: null })), /another set-up/],
    ["two cores under four's name", () => keepIt(header({ threads: 2 })), /another set-up/],
    ["a name that says no set-up", () => keepIt(phone, kept, plan, "full"), /no set-up/],
    ["a frame missing", () => keepIt({ ...phone, frames: phone.frames.slice(1) }), /frames are not/],
    ["a frame 33 ms late", () => keepIt({ ...phone, frames: phone.frames.map((f, k) => (k === 2 ? { ...f, t: f.t + 33 } : f)) }), /frames are not/],
  ];
  it.each(refused)("refused: %s", (_what, attempt, why) => {
    expect(attempt).toThrow(why);
  });
});
