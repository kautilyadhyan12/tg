// What one publish does to the Library's rows (spec Part 2 §13.4, job 60b): a table over every case
// of a file and a row. The first test is the plan's worst thing: a member's saved workout shows a
// set with no exercise, because the exercise's file was deleted.
import { readFileSync } from "node:fs";
import { compendiumTableSchema, exerciseFileSchema, libraryEntrySchema, type ExerciseFile } from "@app/shared";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../src/modules/library/canonical.js";
import { entryOf, planPublish, type PublishedRow } from "../src/modules/library/plan.js";

const LIBRARY = new URL("../../../packages/shared/library/", import.meta.url);
const compendium = compendiumTableSchema.parse(JSON.parse(readFileSync(new URL("compendium.json", LIBRARY), "utf8")));
const real = (id: string): ExerciseFile =>
  exerciseFileSchema.parse(JSON.parse(readFileSync(new URL(`exercises/${id}.json`, LIBRARY), "utf8")));

const squat = real("squat");
const plank = real("plank");
const curl = real("barbell_curl");

/** A row as the database holds it once a file was published: its entry read back. */
const published = (file: ExerciseFile, exerciseId: string, status?: string): PublishedRow => {
  const entry: unknown = JSON.parse(JSON.stringify(entryOf(file, compendium)));
  return { exerciseId, slug: file.id, status: status ?? file.status, entry };
};

const plan = (files: ExerciseFile[], rows: PublishedRow[], named: string[] = []) =>
  planPublish({ files, compendium, rows, named: new Set(named) });

const nameIn = (entry: unknown): string | undefined => libraryEntrySchema.safeParse(entry).data?.text.en.name;
const statusIn = (entry: unknown): string | undefined => libraryEntrySchema.safeParse(entry).data?.status;

describe("the worst thing: a saved set never loses its exercise's name", () => {
  it("a deleted file that a saved set names stays in the list, hidden, with its name and every fact", () => {
    const rows = [published(squat, "id-squat"), published(curl, "id-curl")];
    const p = plan([squat], rows, ["id-curl"]);
    const kept = p.list.find((l) => l.id === "barbell_curl");
    expect(kept).toBeDefined();
    expect(nameIn(kept?.entry)).toBe("Barbell Curl");
    expect(kept?.entry).toEqual({ ...entryOf(curl, compendium), status: "hidden" });
    expect(p.remove).toEqual([]);
  });

  it("stays hidden, publish after publish, while the set still names it", () => {
    const rows = [published(squat, "id-squat"), { ...published(curl, "id-curl"), status: "hidden", entry: { ...entryOf(curl, compendium), status: "hidden" } }];
    const p = plan([squat], rows, ["id-curl"]);
    expect(p.list.map((l) => l.id)).toEqual(["barbell_curl", "squat"]);
    expect(nameIn(p.list[0]?.entry)).toBe("Barbell Curl");
    expect(p.write).toEqual([]);
  });
});

describe("every case of a file and a row", () => {
  const cases: {
    name: string;
    files: ExerciseFile[];
    rows: PublishedRow[];
    named?: string[];
    list: [string, string][];
    write: string[];
    remove: string[];
  }[] = [
    { name: "nothing published yet: every file is written", files: [squat, plank], rows: [], list: [["plank", "live"], ["squat", "live"]], write: ["squat", "plank"], remove: [] },
    { name: "nothing changed: nothing is written", files: [squat, plank], rows: [published(squat, "s"), published(plank, "p")], list: [["plank", "live"], ["squat", "live"]], write: [], remove: [] },
    { name: "a file changed: only it is written", files: [{ ...squat, level: "intermediate" }, plank], rows: [published(squat, "s"), published(plank, "p")], list: [["plank", "live"], ["squat", "live"]], write: ["squat"], remove: [] },
    { name: "a new file beside published ones: only it is written", files: [squat, curl], rows: [published(squat, "s")], list: [["barbell_curl", "live"], ["squat", "live"]], write: ["barbell_curl"], remove: [] },
    { name: "a file retired: written, and still in the list for history", files: [{ ...squat, status: "retired" }], rows: [published(squat, "s")], list: [["squat", "retired"]], write: ["squat"], remove: [] },
    { name: "a file deleted that nothing names: its row goes", files: [squat], rows: [published(squat, "s"), published(plank, "p")], list: [["squat", "live"]], write: [], remove: ["p"] },
    { name: "a file deleted that a set names: hidden", files: [squat], rows: [published(squat, "s"), published(plank, "p")], named: ["p"], list: [["plank", "hidden"], ["squat", "live"]], write: ["plank"], remove: [] },
    { name: "a hidden one that nothing names any more: its row goes", files: [squat], rows: [published(squat, "s"), { ...published(plank, "p"), status: "hidden", entry: { ...entryOf(plank, compendium), status: "hidden" } }], list: [["squat", "live"]], write: [], remove: ["p"] },
    { name: "a hidden one whose file comes back: live again, from the file", files: [squat, plank], rows: [published(squat, "s"), { ...published(plank, "p"), status: "hidden", entry: { ...entryOf(plank, compendium), status: "hidden" } }], list: [["plank", "live"], ["squat", "live"]], write: ["plank"], remove: [] },
    { name: "every file deleted, one named: only it is left, hidden", files: [], rows: [published(squat, "s"), published(plank, "p")], named: ["s"], list: [["squat", "hidden"]], write: ["squat"], remove: ["p"] },
    { name: "a name asked about that is not a gone row changes nothing", files: [squat], rows: [published(squat, "s")], named: ["s"], list: [["squat", "live"]], write: [], remove: [] },
  ];

  it.each(cases)("$name", (c) => {
    const p = plan(c.files, c.rows, c.named ?? []);
    expect(p.list.map((l) => [l.id, statusIn(l.entry)])).toEqual(c.list);
    expect(p.write.map((w) => w.slug)).toEqual(c.write);
    expect(p.remove).toEqual(c.remove);
  });

  it("a written row keeps its exercise id; a new one has none yet", () => {
    const p = plan([squat, curl], [published(squat, "s", "retired")]);
    expect(p.write).toEqual([
      { slug: "squat", exerciseId: "s" },
      { slug: "barbell_curl", exerciseId: null },
    ]);
  });
});

describe("an entry", () => {
  it("reads its MET from the Compendium table by its code, never from the old list", () => {
    expect(entryOf(squat, compendium).met).toBe(3);
    expect(entryOf(plank, compendium).met).toBe(2.8);
  });

  it("a stored entry read back with its keys in another order is not called changed", () => {
    const entry = entryOf(squat, compendium);
    const reordered: unknown = Object.fromEntries(Object.entries(entry).reverse());
    expect(canonicalJson(reordered)).toBe(canonicalJson(entry));
    expect(plan([squat], [{ exerciseId: "s", slug: "squat", status: "live", entry: reordered }]).write).toEqual([]);
  });
});
