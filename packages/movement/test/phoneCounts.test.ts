// The phone's own runs judged by the laptop's count and reasons (ROADMAP 52a-iii; scripts/phoneCounts.ts).
// The worst thing: the proof says the phone counts as the laptop does while a member's phone counts a rep that is not one,
// or drops real ones, or tells them another reason. So a phone run that counts differently, or says another reason, is
// never "the same", and a video with no phone run, or a file that is not the phone's reading of its very frames, is never
// judged and never lets the table pass.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { MovementFrame } from "@app/shared";
import type { RepResult } from "../src/index.js";
import { readKept, type KeptFile } from "../scripts/bodyCheck.js";
import { LEAD_IN, countedTimes, readMovement } from "../scripts/movementCheck.js";
import { MOVEMENT_VIDEOS, type MovementVideo } from "../scripts/movementVideos.js";
import { CHOSEN_RUN, allSame, asWritten, differences, judgePhone, phoneFileOf, phoneTable, readManifest, refusal, type PhoneRow } from "../scripts/phoneCounts.js";
import { phoneLabel } from "../scripts/replays.js";

const squat = readMovement("squat");
const read = (path: string): KeptFile => readKept(new Uint8Array(readFileSync(path)));
const entryOf = (base: string): MovementVideo => {
  const e = MOVEMENT_VIDEOS.find((v) => v.file.endsWith(`/${base}`));
  if (e === undefined) throw new Error(`no proof video ${base}`);
  return e;
};
const keptOf = (e: MovementVideo): KeptFile => read(join(import.meta.dirname, `${e.file}.bodypoints`));

/** The laptop's own frames given as if the phone had read them: the same body points, the phone's header. */
function asPhone(kept: KeptFile, frames: readonly MovementFrame[] = kept.frames, run: string = CHOSEN_RUN): KeptFile {
  return {
    header: { ...kept.header, label: phoneLabel(kept.header.label, run), source: "phone", madeWith: { tool: "keep-phone-points", version: 1 } },
    frames,
    sha256: "made in the test",
  };
}

/** The frames with one rep taken out: from its start to its end the body stays as it was just before. */
function withoutRep(frames: readonly MovementFrame[], rep: { start: number; end: number }): MovementFrame[] {
  const before = [...frames].reverse().find((f) => f.t < rep.start);
  if (before === undefined) throw new Error("no frame before the rep");
  return frames.map((f) => (f.t >= rep.start && f.t <= rep.end ? { ...before, t: f.t } : f));
}

/** A rep at a time in the video (`start`, `end` in ms of the video), as a run holds it after its lead-in. */
const rep = (start: number, end: number, verdict: RepResult["verdict"], rule: string | null = null): RepResult => ({ start: start + LEAD_IN, end: end + LEAD_IN, verdict, rule, reason: null, readings: {}, standing: {}, form: [], turn: null, side: null });

describe("the worst thing: a phone that counts or speaks differently is never the same", () => {
  const entry = entryOf("squat_reference");
  const kept = keptOf(entry);

  it("the laptop's own frames, as if read by the phone, are the same (3 of 3)", () => {
    const row = judgePhone(squat, entry, kept, asPhone(kept), kept.sha256);
    expect(row.laptop.count).toBe(3);
    expect(row.verdict).toBe("same");
    expect(row.why).toEqual([]);
  });

  it("a phone that drops one real rep differs, and says the counts", () => {
    const first = countedTimes(squat, { label: kept.header.label, frames: kept.frames, sets: false, why: "" })[0];
    if (first === undefined) throw new Error("no counted rep");
    const row = judgePhone(squat, entry, kept, asPhone(kept, withoutRep(kept.frames, first)), kept.sha256);
    expect(row.phone?.count).toBe(2);
    expect(row.verdict).toBe("differs");
    expect(row.why[0]).toBe("the laptop counts 3, the phone 2");
  });

  it("a rep counted on one and not the other, or one more, differs even where the counts agree; times are the video's own", () => {
    const counted = { count: 1, reps: [rep(0, 1000, "counted")] };
    expect(differences(counted, { count: 1, reps: [rep(0, 1000, "counted"), rep(2000, 3000, "short", "depth")] })).toEqual(["the phone also says 2.0 s short (depth)"]);
    expect(differences({ count: 1, reps: [rep(0, 1000, "counted"), rep(2000, 3000, "unseen", "feet stay down")] }, counted)).toEqual(["the phone does not say 2.0 s unseen (feet stay down)"]);
    expect(differences(counted, { count: 2, reps: [rep(0, 1000, "counted"), rep(2000, 3000, "counted")] })).toHaveLength(2);
  });

  it("another reason, another verdict or another place in the video differs", () => {
    const short = { count: 0, reps: [rep(0, 1000, "short", "depth")] };
    expect(differences(short, { count: 0, reps: [rep(0, 1000, "short", "knees bent")] })).toEqual(["the laptop says 0.0 s short (depth), the phone 0.0 s short (knees bent)"]);
    expect(differences(short, { count: 0, reps: [rep(0, 1000, "unseen", "depth")] })).toHaveLength(1);
    expect(differences(short, { count: 0, reps: [rep(1000, 2000, "short", "depth")] })).toHaveLength(1);
  });

  it("a lunge given another leg on the phone differs, though the count and the reps agree (52c-i)", () => {
    const onLeg = (side: RepResult["side"]): RepResult => ({ ...rep(0, 1000, "counted"), side });
    const left = { count: 1, reps: [onLeg("left")] };
    expect(differences(left, { count: 1, reps: [onLeg("right")] })).toEqual(["the laptop says 0.0 s counted on the left leg, the phone on the right leg"]);
    expect(differences(left, { count: 1, reps: [onLeg(null)] })).toHaveLength(1);
    expect(differences(left, left)).toEqual([]);
  });

  it("a dip read as another movement says nothing, so it alone never makes a difference", () => {
    expect(differences({ count: 0, reps: [] }, { count: 0, reps: [rep(0, 1000, "other", "chest up")] })).toEqual([]);
  });

  it("an open case passes only while it differs exactly as written: one rep more, or the same again, is not as written", () => {
    const written = { why: "a known case", differences: ["the laptop counts 3, the phone 2"] };
    const first = countedTimes(squat, { label: kept.header.label, frames: kept.frames, sets: false, why: "" })[0];
    if (first === undefined) throw new Error("no counted rep");
    const dropped = judgePhone(squat, { ...entry, phoneOpen: written }, kept, asPhone(kept, withoutRep(kept.frames, first)), kept.sha256);
    expect(dropped.why[0]).toBe("the laptop counts 3, the phone 2");
    expect(asWritten({ ...dropped, why: ["the laptop counts 3, the phone 2"] })).toBe(true);
    expect(asWritten({ ...dropped, why: ["the laptop counts 3, the phone 1"] })).toBe(false);
    expect(asWritten({ ...dropped, why: [...written.differences, "the phone also says 9.0 s counted"] })).toBe(false);
    expect(asWritten(judgePhone(squat, { ...entry, phoneOpen: written }, kept, asPhone(kept), kept.sha256))).toBe(false);
  });

  it("no phone run is never the same, and the table does not hold while one video has none", () => {
    const none = judgePhone(squat, entry, kept, null, null);
    expect(none.verdict).toBe("no run");
    const same = judgePhone(squat, entry, kept, asPhone(kept), kept.sha256);
    expect(allSame([same])).toBe(true);
    expect(allSame([same, none])).toBe(false);
    expect(allSame([])).toBe(false);
  });
});

describe("only the phone's own reading of the kept file's very frames, from the chosen set-up, is judged", () => {
  const entry = entryOf("squat_reference");
  const kept = keptOf(entry);
  const refusedAs = (phone: KeptFile): PhoneRow => judgePhone(squat, entry, kept, phone, kept.sha256);

  it("the phone's real run on the graphics chip (51b-i) is another set-up: refused, never judged", () => {
    const gpu = read(phoneFileOf(entry, "pose_landmarker_full.gpu"));
    expect(refusal(kept, gpu, kept.sha256)).toMatch(/another video or another set-up/);
    const row = refusedAs(gpu);
    expect(row.verdict).toBe("refused");
    expect(row.phone).toBeNull();
  });

  it("the laptop's own file, another video's run, a frame late, a frame missing, six people, other pictures: each refused", () => {
    expect(refusal(kept, kept, kept.sha256)).toBe("it is not the phone's reading");
    const chair = keptOf(entryOf("chair_squat_reference"));
    expect(refusedAs(asPhone(chair)).verdict).toBe("refused");
    const late = kept.frames.map((f, k) => (k === 40 ? { ...f, t: f.t + 33 } : f));
    expect(refusal(kept, asPhone(kept, late), kept.sha256)).toMatch(/frame 41/);
    expect(refusedAs(asPhone(kept, kept.frames.slice(1))).verdict).toBe("refused");
    const phone = asPhone(kept);
    expect(refusal(kept, { ...phone, header: { ...phone.header, model: { ...kept.header.model, people: 6 } } }, kept.sha256)).toMatch(/one person/);
    expect(refusal(kept, { ...phone, header: { ...phone.header, picture: { width: 2 * kept.header.picture.width, height: 2 * kept.header.picture.height } } }, kept.sha256)).toMatch(/pictures of another size/);
  });

  it("a phone file read against another kept file, or with no record of one, is refused: a video measured again is never judged against its old pictures", () => {
    expect(refusal(kept, asPhone(kept), null)).toMatch(/manifest names no kept file/);
    expect(refusal(kept, asPhone(kept), "0".repeat(64))).toMatch(/measured again/);
    expect(judgePhone(squat, entry, kept, asPhone(kept), "0".repeat(64)).verdict).toBe("refused");
  });

  it("the manifest names, for each kept phone file, the very kept file in git it was read against", () => {
    const files = readManifest().files;
    const run = files[`squat_reference.${CHOSEN_RUN}.bodypoints`];
    expect(run?.kept).toBe(kept.sha256);
  });
});

describe("every proof video, as the phone's chosen set-up read it (51b-ii; kept in test/phone-points)", () => {
  let rows: PhoneRow[] = [];
  beforeAll(() => {
    rows = phoneTable(squat);
  }, 300_000);

  it("every proof video has the phone's run, and none is refused", () => {
    const missing = rows.filter((r) => r.verdict === "no run" || r.verdict === "refused").map((r) => `${r.label}: ${r.why.join("; ")}`);
    expect(missing).toEqual([]);
    expect(rows).toHaveLength(MOVEMENT_VIDEOS.length);
  });

  it("the phone counts and says on the screen what the laptop does, on every one but the open cases, each exactly as written", () => {
    const differ = rows.filter((r) => r.verdict !== "same" && r.entry.phoneOpen === undefined).map((r) => `${r.label}: ${r.why.join("; ")}`);
    expect(differ).toEqual([]);
    // An open case that is now the same, or differs otherwise than written, is a fault: it must lose or change its note.
    const notAsWritten = rows.filter((r) => r.entry.phoneOpen !== undefined && !asWritten(r)).map((r) => `${r.label}: ${r.why.join("; ")}`);
    expect(notAsWritten).toEqual([]);
    expect(allSame(rows)).toBe(false);
  });

  it("the open cases are three, a man's own floor squats, and on the phone no other movement is counted", () => {
    const open = rows.filter((r) => r.entry.phoneOpen !== undefined);
    expect(open.map((r) => r.label).sort()).toEqual(["floor_phone_test 0-12 s", "floor_phone_test 13.9-21.1 s", "usual_v04 9.8-17.5 s"]);
    for (const r of rows.filter((x) => x.entry.movement !== "squat")) expect([r.label, r.phone?.count]).toEqual([r.label, 0]);
    // 98 of 101 since 52c-i: a man's rooftop lunges are two takes joined by a fade, each a set of its own (97 of 100 before).
    expect(rows.filter((r) => r.verdict === "same").length).toBe(98);
  });

  it("the sumo squat nobody could count by eye now counts the same on both", () => {
    const sumo = rows.find((r) => r.label === "sumo_squat_1");
    expect(sumo?.entry.reps).toBeNull();
    expect(sumo?.verdict).toBe("same");
  });

  it("a man's own squats from a phone on the floor: the phone counts 19 of his 22, each one missed written with its job", () => {
    const own = rows.filter((r) => r.entry.person === "man, his own phone, on the floor and raised" && r.entry.movement === "squat" && r.entry.reps !== null);
    expect(own.reduce((n, r) => n + r.laptop.count, 0)).toBe(22);
    expect(own.reduce((n, r) => n + (r.phone?.count ?? 0), 0)).toBe(19);
    for (const r of own.filter((x) => x.verdict !== "same")) {
      expect([r.label, r.laptop.count - (r.phone?.count ?? 0), /^5(2a-ii-b-ii-b-ii|3), /.test(r.entry.phoneOpen?.why ?? "")]).toEqual([r.label, 1, true]);
    }
  });

  it("the five other movements whose dips one side called unseen until 52b-i are silent on both: what was seen made them another movement", () => {
    // 52a-iii and 52a-ii-b-i: a Romanian deadlift's and a kettlebell deadlift's hips and knees 54 to 79 degrees apart, a
    // step-up's knees straight, a lunge's feet far from where they stood, a man turning round; the feet's rule read
    // nothing on one side, and it said "the camera could not see".
    // The rooftop lunges are two sets since 52c-i, a take each side of the video's fade: six sets of the five videos.
    const five = rows.filter((r) =>
      ["romanian_deadlift_barbell", "fresh_lunge_forward_barbell_2 0-3.45 s", "fresh_lunge_forward_barbell_2 4.33-11.3 s", "usual_v03", "usual_v12", "usual_v14"].includes(r.label),
    );
    expect(five).toHaveLength(6);
    for (const r of five) {
      expect([r.label, r.verdict, r.laptop.count, r.phone?.count]).toEqual([r.label, "same", 0, 0]);
      expect([r.label, [...r.laptop.reps, ...(r.phone?.reps ?? [])].filter((x) => x.verdict !== "other").map((x) => x.verdict)]).toEqual([r.label, []]);
    }
  });
});
