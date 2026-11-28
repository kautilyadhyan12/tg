// The phone moved in a set (ROADMAP 53c; spec Part 2 §12.5, "As built, the phone moved in a set"): the worst thing the other
// way, over every proof set. A phone that never moved is never called moving, and no proper rep is lost: Kd's phone's own
// readings lying still on a desk (its unexplained blip included) and with the desk tapped hard beside it (test/phone-motion),
// laid under each proof video, change no count, no word and no hold. A minute and a half on the laptop: part of the proof.
import { describe, expect, it } from "vitest";
import { cameraHolds, readHold } from "../scripts/holdCheck.js";
import { proofVideos, readMovement, withLeadIn, type ProofVideo } from "../scripts/movementCheck.js";
import type { Video } from "../scripts/bodyCheck.js";
import { said } from "./helpers/people.js";
import { LAID_DOWN, live, played, readingsOf } from "./helpers/phoneMotion.js";

const VIDEOS: ProofVideo[] = proofVideos();
const videoOf = (label: string): Video => {
  const v = VIDEOS.find((x) => x.video.label === label);
  if (v === undefined) throw new Error(`no proof video ${label}`);
  return v.video;
};
const STILL = readingsOf("still");
const TAPPED = readingsOf("down", LAID_DOWN);

/** Each proof video under its own movement (the squat's for a video of a movement the engine does not have). */
const OWN = VIDEOS.flatMap((v) => {
  const name = v.entry.movement ?? "squat";
  return name === "l-sit" || name === "support-hold" ? [] : [[v.video.label, name] as const];
});

describe("the worst thing, the other way: a phone that never moved is never called moving, and counts every proof set as before", () => {
  it.each(OWN)("%s under the %s: the phone lying still, its blip included, then with the desk tapped beside it", (label, name) => {
    const movement = readMovement(name);
    const frames = withLeadIn(videoOf(label)).frames;
    const plain = played(movement, frames).run;
    for (const readings of [STILL, TAPPED]) {
      const { run, seen } = played(movement, live(frames, readings));
      expect(seen.some((s) => s.phone.moving || s.phone.again)).toBe(false);
      expect([run.count, said(run.reps)]).toEqual([plain.count, said(plain.reps)]);
    }
  });

  it("the L-sit's holds, the phone lying still, are timed as before", () => {
    const hold = readHold("l-sit");
    for (const v of VIDEOS.filter((x) => x.entry.held !== undefined)) {
      const frames = withLeadIn(v.video).frames;
      expect(cameraHolds(hold, { ...v.video, frames: live(frames, STILL) })).toEqual(cameraHolds(hold, { ...v.video, frames }));
    }
  });
});
