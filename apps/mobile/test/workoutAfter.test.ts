import { describe, expect, it } from "vitest";
import type { AfterRecord, RunExercise, SavedSet, WaitingEffort } from "@app/shared";
import type { TextStore } from "../src/screens/food/outbox";
import type { Answer } from "../src/session/calls";
import { effortPath, effortSender, effortWaiting, readEffortAnswer } from "../src/library/effortSaving";
import {
  blocksOf,
  exerciseBlocks,
  ideaTotals,
  kcalLine,
  recordRow,
  recordRowOf,
  setsHeading,
  starWords,
  streakNext,
  streakWords,
  waterWords,
  xpNext,
  xpShare,
  xpWhy,
} from "../src/screens/workout/afterWords";

// A workout's last screen (64a-iii): its words, worked out from the sets the phone holds and the server's numbers, and
// the stars, which wait on the phone until their workout is on the server and are sent in the order pressed.

const ID = "11111111-1111-4111-8111-111111111111";
const set = (over: Partial<SavedSet>): SavedSet => ({
  exercise: "barbell_curl",
  position: 0,
  measuredIn: "reps",
  target: 10,
  done: 10,
  weightGrams: 50_000,
  restSeconds: 60,
  durationMs: 30_000,
  counted: "hand",
  ...over,
});
const curl: RunExercise = { exercise: "barbell_curl", name: "Barbell Curl", kind: "strength", measuredIn: "reps", barbell: true, sets: [{ target: 10, weightGrams: 50_000, restSeconds: 60 }] };
const plank: RunExercise = { exercise: "plank", name: "Plank", kind: "strength", measuredIn: "time", barbell: false, sets: [{ target: 75, weightGrams: null, restSeconds: 45 }] };
/** Arms day as the drawing has it: curl 10 × 50, 10 × 52.5, 8 of 10 × 52.5; plank 1:15, 1:02 of 1:15. */
const DONE: SavedSet[] = [
  set({ position: 0 }),
  set({ position: 1, weightGrams: 52_500 }),
  set({ position: 2, done: 8, weightGrams: 52_500 }),
  set({ position: 3, exercise: "plank", measuredIn: "time", target: 75, done: 75, weightGrams: null }),
  set({ position: 4, exercise: "plank", measuredIn: "time", target: 75, done: 62, weightGrams: null }),
];
const record = (over: Partial<AfterRecord>): AfterRecord => ({ exercise: "barbell_curl", exerciseName: "Barbell Curl", measuredIn: "reps", kind: "heaviest", position: 1, value: 52_500, ...over });

describe("the sets, exercise by exercise", () => {
  it("groups the sets, says what stopped short, what each lifted, and marks the set that made a record", () => {
    const blocks = exerciseBlocks(DONE, [curl, plank], [record({}), record({ kind: "most_lifted", position: null, value: 1_445_000 })], "metric");
    expect(blocks.map((b) => [b.name, b.line])).toEqual([
      ["Barbell Curl", "3 sets · 1,445 kg lifted"],
      ["Plank", "2 sets"],
    ]);
    expect(blocks[0]?.sets.map((s) => [s.n, s.done, s.of, s.weight, s.pr])).toEqual([
      ["1", "10 reps", "", "50 kg", false],
      ["2", "10 reps", "", "52.5 kg", true],
      ["3", "8 reps", "of 10", "52.5 kg", false],
    ]);
    expect(blocks[1]?.sets.map((s) => [s.n, s.done, s.of, s.weight])).toEqual([
      ["1", "1:15", "", ""],
      ["2", "1:02", "of 1:15", ""],
    ]);
    expect(setsHeading(blocks)).toBe("2 exercises · 5 sets");
  });

  it.each([
    ["one set, one exercise", [set({})], "1 exercise · 1 set"],
    ["an exercise done again later in the workout is one block", [set({}), set({ position: 1, exercise: "plank", measuredIn: "time", target: 30, done: 30, weightGrams: null }), set({ position: 2 })], "2 exercises · 3 sets"],
  ])("%s", (_case, done, heading) => {
    expect(setsHeading(exerciseBlocks(done, [curl, plank], [], "metric"))).toBe(heading);
  });

  it("an exercise the phone has no name for shows its id word; a short timed set reads in seconds; pounds for imperial", () => {
    const blocks = exerciseBlocks([set({ exercise: "lunge", weightGrams: 20_000 }), set({ position: 1, exercise: "plank", measuredIn: "time", target: 45, done: 40, weightGrams: null })], [plank], [], "imperial");
    expect(blocks[0]?.name).toBe("lunge");
    expect(blocks[0]?.sets[0]?.weight).toBe("44.1 lb");
    expect(blocks[1]?.sets[0]).toMatchObject({ done: "40 s", of: "of 45 s" });
  });
});

describe("a new record as a row", () => {
  it.each([
    ["heaviest, with its set within the exercise", record({}), "Heaviest", "Barbell Curl · set 2", "52.5 kg"],
    ["the estimate named as one", record({ kind: "best_estimated_1rm", value: 70_000 }), "Best one-rep max (estimate)", "Barbell Curl · set 2", "70 kg"],
    ["most reps", record({ kind: "most_reps", position: 0, value: 10 }), "Most reps", "Barbell Curl · set 1", "10 reps"],
    ["one rep", record({ kind: "most_reps", position: 0, value: 1 }), "Most reps", "Barbell Curl · set 1", "1 rep"],
    ["most lifted is the whole workout's", record({ kind: "most_lifted", position: null, value: 1_445_000 }), "Most lifted in one workout", "Barbell Curl", "1,445 kg"],
    ["the plank's longest hold is its own set 1", record({ exercise: "plank", exerciseName: "Plank", measuredIn: "time", kind: "longest_hold", position: 3, value: 75 }), "Longest hold", "Plank · set 1", "1:15"],
    ["an exercise the Library never had shows its id word", record({ exerciseName: null }), "Heaviest", "barbell_curl · set 2", "52.5 kg"],
  ])("%s", (_case, r, kind, where, value) => {
    expect(recordRow(r, DONE, "metric")).toMatchObject({ kind, where, value });
  });
});

// A workout looked back on in History (64a-v) is drawn by the same rules from the server's sets, each at its own place
// in the workout: places that are not 0, 1, 2… (an old workout's), a set saved before targets were kept, and records
// that name a place, never a row of the list.
describe("a workout's sets read back from the server", () => {
  const shown = [
    { exercise: "plank", measuredIn: "time" as const, target: null, done: 95, weightGrams: null, place: 7 },
    { exercise: "barbell_curl", measuredIn: "reps" as const, target: 10, done: 8, weightGrams: 52_500, place: 4 },
    { exercise: "barbell_curl", measuredIn: "reps" as const, target: 10, done: 10, weightGrams: 50_000, place: 2 },
  ];
  const named = (exercise: string) => ({ name: exercise === "plank" ? "Plank" : "Barbell Curl", kind: "strength" });

  it("orders the sets by their place, marks the record's place, and says nothing of a target never kept", () => {
    const blocks = blocksOf(shown, named, [record({ position: 4 })], "metric");
    expect(blocks.map((b) => [b.name, b.line])).toEqual([
      ["Barbell Curl", "2 sets · 920 kg lifted"],
      ["Plank", "1 set"],
    ]);
    expect(blocks[0]?.sets.map((s) => [s.key, s.n, s.done, s.of, s.pr])).toEqual([
      ["2", "1", "10 reps", "", false],
      ["4", "2", "8 reps", "of 10", true],
    ]);
    expect(blocks[1]?.sets.map((s) => [s.done, s.of])).toEqual([["1:35", ""]]);
  });

  it("names a record's set by its place within its exercise", () => {
    expect(recordRowOf(record({ position: 4 }), shown, "metric")).toMatchObject({ where: "Barbell Curl · set 2", value: "52.5 kg" });
    expect(recordRowOf(record({ exercise: "plank", exerciseName: "Plank", measuredIn: "time", kind: "longest_hold", position: 7, value: 95 }), shown, "metric")).toMatchObject({ where: "Plank · set 1", value: "1:35" });
    // A place no set holds names the exercise alone, never a wrong set.
    expect(recordRowOf(record({ position: 3 }), shown, "metric").where).toBe("Barbell Curl");
  });
});

describe("the numbers' words", () => {
  it.each([
    [118, 82, "metric", "About 118 kcal for you, at 82 kg"],
    [118, null, "metric", "About 118 kcal, at 70 kg"],
    [1_204, 90.5, "metric", "About 1,204 kcal for you, at 90.5 kg"],
    [118, 82, "imperial", "About 118 kcal for you, at 180.8 lb"],
  ] as const)("%d kcal at %s kg (%s)", (kcal, kg, units, words) => {
    expect(kcalLine(kcal, kg, units)).toBe(words);
  });

  it("XP, the level and the streak", () => {
    expect(xpWhy(50, 10, 0)).toBe("50 for the workout · 10 for your streak");
    expect(xpWhy(70, 0, 0)).toBe("70 for the workout");
    expect(xpWhy(50, 0, 50)).toBe("50 for the workout · 50 for a new badge");
    expect(xpWhy(50, 10, 1_150)).toBe("50 for the workout · 10 for your streak · 1,150 for a new badge");
    expect(xpNext({ level: 3, xpInLevel: 184, xpForNext: 374 })).toBe("184/374 XP → Level 4");
    expect(xpNext({ level: 11, xpInLevel: 1_240, xpForNext: 1_500 })).toBe("1,240/1,500 XP → Level 12");
    expect(xpShare({ progressPct: 49.2 })).toBeCloseTo(0.492);
    expect([xpShare({ progressPct: -3 }), xpShare({ progressPct: 140 })]).toEqual([0, 1]);
    expect([streakWords(5), streakNext(5, true)]).toEqual(["5-day streak", "Train tomorrow to make it 6"]);
    // Round one L4: the streak's last day is yesterday (read after midnight, or saved later): today keeps it.
    expect(streakNext(5, false)).toBe("Train today to keep it");
  });

  it("an idea's totals, and the water in the person's units", () => {
    expect(ideaTotals({ kind: "light", items: [], totals: { kcal: 162, proteinG: 19.2, carbsG: 20.6, fatG: 1.1 } })).toBe("162 kcal · 19 g protein");
    expect(waterWords("metric")).toBe("Drink about 500 ml of water in the next 30 minutes.");
    expect(waterWords("imperial")).toBe("Drink about 500 ml (17 fl oz) of water in the next 30 minutes.");
  });

  it.each([
    [null, false, false, "Tap a star"],
    [3, true, false, "Just right"],
    [3, false, false, "Just right · Saved"],
    [5, true, true, "Very hard · Saved on this phone"],
    [1, false, false, "Too easy · Saved"],
  ] as const)("the stars %s (waits %s, on the phone %s)", (stars, waits, onPhone, words) => {
    expect(starWords(stars, waits, onPhone)).toBe(words);
  });
});

/** A phone file, which outlives the app. */
function file(text: string | null = null): TextStore & { text: string | null } {
  const store = {
    text,
    read: () => Promise.resolve(store.text),
    write: (next: string) => {
      store.text = next;
      return Promise.resolve();
    },
  };
  return store;
}
const ok: Answer<unknown> = { kind: "ok", data: {} };
const noAnswer: Answer<unknown> = { kind: "no_answer" };
const refused = (status: number): Answer<unknown> => ({ kind: "refused", status, error: "x", message: "x", retryAfterSeconds: null, robotCheckKey: null, body: null });

describe("the stars, kept until the server has them", () => {
  it("the worst thing: the stars of a workout still on its way wait, and go once it is on the server, the last pressed last", async () => {
    const sent: { path: string; body: unknown }[] = [];
    let workoutWaits = true;
    const store = file();
    const list = effortWaiting(
      store,
      effortSender((request, shape) => {
        sent.push({ path: request.path, body: request.body });
        const read = shape.safeParse({ workoutId: ID, effort: 1 });
        return Promise.resolve(read.success ? { kind: "ok", data: read.data } : { kind: "no_answer" });
      }),
      () => workoutWaits,
      () => 0,
    );
    await list.start();
    const press = (n: number, at: number): WaitingEffort => ({ id: `${ID}.${String(at)}`, workoutId: ID, effort: n });
    await list.add(press(4, 1));
    await list.add(press(2, 2));
    await list.send(true);
    expect(sent).toEqual([]);
    expect((JSON.parse(store.text ?? "{}") as { waiting: unknown[] }).waiting).toHaveLength(2);
    workoutWaits = false;
    await list.send(true);
    expect(sent).toEqual([
      { path: effortPath(ID), body: { effort: 4 } },
      { path: effortPath(ID), body: { effort: 2 } },
    ]);
    expect(list.view().waiting).toHaveLength(0);
  });

  it("round one L6: the stars of a workout still on its way never hold up another workout's, and keep their place", async () => {
    const OTHER = "22222222-2222-4222-8222-222222222222";
    const sent: unknown[] = [];
    const onPhone = new Set([ID]);
    const list = effortWaiting(
      file(),
      (e) => {
        sent.push([e.workoutId, e.effort]);
        return Promise.resolve({ kind: "done" });
      },
      (workoutId) => onPhone.has(workoutId),
      () => 0,
    );
    await list.start();
    await list.add({ id: `${ID}.1`, workoutId: ID, effort: 4 });
    await list.add({ id: `${OTHER}.2`, workoutId: OTHER, effort: 2 });
    await list.add({ id: `${ID}.3`, workoutId: ID, effort: 5 });
    await list.send(true);
    expect(sent).toEqual([[OTHER, 2]]);
    expect(list.view().held).toBe(false);
    expect(list.view().waiting.map((e) => e.effort)).toEqual([4, 5]);
    onPhone.delete(ID);
    await list.send(true);
    expect(sent).toEqual([[OTHER, 2], [ID, 4], [ID, 5]]);
  });

  it("the same press kept twice is sent once; a closed app sends what waited", async () => {
    const store = file();
    const first = effortWaiting(store, () => Promise.resolve({ kind: "later" }), () => false, () => 0);
    await first.start();
    const p: WaitingEffort = { id: `${ID}.9`, workoutId: ID, effort: 3 };
    await first.add(p);
    await first.add(p);
    first.stop();
    const sent: unknown[] = [];
    const again = effortWaiting(
      store,
      (e) => {
        sent.push(e.effort);
        return Promise.resolve({ kind: "done" });
      },
      () => false,
      () => 0,
    );
    await again.start();
    await again.send(true);
    expect(sent).toEqual([3]);
  });

  it.each([
    [ok, "done"],
    [noAnswer, "later"],
    [refused(401), "later"],
    [refused(429), "later"],
    [refused(503), "later"],
    [refused(404), "done"],
    [refused(400), "done"],
  ])("answer %j is %s", (answer, kind) => {
    expect(readEffortAnswer(answer).kind).toBe(kind);
  });
});
