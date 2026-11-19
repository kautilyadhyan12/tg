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
import { countedTimes, readMovement } from "../scripts/movementCheck.js";
import { MOVEMENT_VIDEOS, type MovementVideo } from "../scripts/movementVideos.js";
import { CHOSEN_RUN, allSame, differences, judgePhone, phoneFileOf, phoneTable, refusal, type PhoneRow } from "../scripts/phoneCounts.js";
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

const rep = (start: number, end: number, verdict: RepResult["verdict"], rule: string | null = null): RepResult => ({ start, end, verdict, rule, readings: {}, standing: {} });

describe("the worst thing: a phone that counts or speaks differently is never the same", () => {
  const entry = entryOf("squat_reference");
  const kept = keptOf(entry);

  it("the laptop's own frames, as if read by the phone, are the same (3 of 3)", () => {
    const row = judgePhone(squat, entry, kept, asPhone(kept));
    expect(row.laptop.count).toBe(3);
    expect(row.verdict).toBe("same");
    expect(row.why).toEqual([]);
  });

  it("a phone that drops one real rep differs, and says the counts", () => {
    const first = countedTimes(squat, { label: kept.header.label, frames: kept.frames, sets: false, why: "" })[0];
    if (first === undefined) throw new Error("no counted rep");
    const row = judgePhone(squat, entry, kept, asPhone(kept, withoutRep(kept.frames, first)));
    expect(row.phone?.count).toBe(2);
    expect(row.verdict).toBe("differs");
    expect(row.why[0]).toBe("the laptop counts 3, the phone 2");
  });

  it("a rep counted on one and not the other, or one more, differs even where the counts agree", () => {
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

  it("a dip read as another movement says nothing, so it alone never makes a difference", () => {
    expect(differences({ count: 0, reps: [] }, { count: 0, reps: [rep(0, 1000, "other", "chest up")] })).toEqual([]);
  });

  it("no phone run is never the same, and the table does not hold while one video has none", () => {
    const none = judgePhone(squat, entry, kept, null);
    expect(none.verdict).toBe("no run");
    const same = judgePhone(squat, entry, kept, asPhone(kept));
    expect(allSame([same])).toBe(true);
    expect(allSame([same, none])).toBe(false);
    expect(allSame([])).toBe(false);
  });
});

describe("only the phone's own reading of the kept file's very frames, from the chosen set-up, is judged", () => {
  const entry = entryOf("squat_reference");
  const kept = keptOf(entry);
  const refusedAs = (phone: KeptFile): PhoneRow => judgePhone(squat, entry, kept, phone);

  it("the phone's real run on the graphics chip (51b-i) is another set-up: refused, never judged", () => {
    const gpu = read(phoneFileOf(entry, "pose_landmarker_full.gpu"));
    expect(refusal(kept, gpu)).toMatch(/another video or another set-up/);
    const row = refusedAs(gpu);
    expect(row.verdict).toBe("refused");
    expect(row.phone).toBeNull();
  });

  it("the laptop's own file, another video's run, a frame late, a frame missing: each refused", () => {
    expect(refusal(kept, kept)).toBe("it is not the phone's reading");
    const chair = keptOf(entryOf("chair_squat_reference"));
    expect(refusedAs(asPhone(chair)).verdict).toBe("refused");
    const late = kept.frames.map((f, k) => (k === 40 ? { ...f, t: f.t + 33 } : f));
    expect(refusal(kept, asPhone(kept, late))).toMatch(/frame 41/);
    expect(refusedAs(asPhone(kept, kept.frames.slice(1))).verdict).toBe("refused");
    expect(refusal(kept, { ...asPhone(kept), header: { ...asPhone(kept).header, model: { ...kept.header.model, people: 6 } } })).toMatch(/one person/);
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

  it("the phone counts and says on the screen what the laptop does, on every one but those written as open", () => {
    const differ = rows.filter((r) => r.verdict !== "same" && r.entry.phoneOpen === undefined).map((r) => `${r.label}: ${r.why.join("; ")}`);
    expect(differ).toEqual([]);
    // An open case that is now the same must lose its note: it is never left open by mistake.
    const closed = rows.filter((r) => r.verdict === "same" && r.entry.phoneOpen !== undefined).map((r) => r.label);
    expect(closed).toEqual([]);
  });

  it("the open cases are four, written down, and none counts another movement", () => {
    const open = rows.filter((r) => r.entry.phoneOpen !== undefined);
    expect(open.map((r) => r.label).sort()).toEqual(["fresh_deadlift_kettlebell_1", "romanian_deadlift_barbell", "step_up_dumbbell", "sumo_squat_1"]);
    for (const r of rows.filter((x) => x.entry.movement === null && x.entry.open === undefined)) expect([r.label, r.phone?.count]).toEqual([r.label, 0]);
  });

  it("the sumo squat nobody could count by eye differs by its first rep alone, at the edge of standing still", () => {
    const sumo = rows.find((r) => r.label === "sumo_squat_1");
    expect(sumo?.entry.reps).toBeNull();
    expect([sumo?.laptop.count, sumo?.phone?.count]).toEqual([0, 1]);
    expect(sumo?.why).toEqual(["the laptop counts 0, the phone 1", "the phone also says 3.1 s counted"]);
  });

  it("each other open case is only a dip of another movement marked unseen on one side: the same count, nothing called short", () => {
    const open = rows.filter((r) => r.entry.phoneOpen !== undefined && r.entry.movement === null);
    expect(open).toHaveLength(3);
    for (const r of open) {
      expect([r.label, r.entry.movement, r.laptop.count, r.phone?.count]).toEqual([r.label, null, 0, 0]);
      expect(r.why.length).toBeGreaterThan(0);
      for (const why of r.why) expect(why).toMatch(/^the phone (also says|does not say) [\d.]+ s unseen \(feet stay down\)$/);
      expect([...r.laptop.reps, ...(r.phone?.reps ?? [])].filter((x) => x.verdict === "short")).toEqual([]);
    }
    expect(allSame(rows)).toBe(false);
  });
});