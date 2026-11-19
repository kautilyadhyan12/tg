// The check of the whole Exercise Library (spec Part 2 §13.4, job 60a). It reads every
// exercise's file and the Compendium table and returns every fault, each naming the file, the
// fact and what is wrong; publishing and GitHub refuse the Library while any is left. Pure: the
// caller reads the folder and hands over each file's name and text.
import type { z } from "zod";
import { compendiumTableSchema, exerciseFileSchema, type CompendiumTable, type ExerciseFile } from "./exerciseFile.js";

export interface LibraryFault {
  /** The file the fault is in: "squat.json", or the Compendium table's own name. */
  file: string;
  /** The fact, as a path into the file: "equipment.0", "text.en.name". Empty for the whole file. */
  at: string;
  problem: string;
}

export interface LibraryInput {
  /** Every file in the exercises folder: its name and its text. */
  exerciseFiles: readonly { name: string; text: string }[];
  /** The Compendium table's file. */
  compendium: { name: string; text: string };
}

export interface CheckedLibrary {
  faults: LibraryFault[];
  /** The exercises whose files have no fault, by id, in id order. */
  exercises: ExerciseFile[];
  /** The Compendium table, or null when it has a fault. */
  compendium: CompendiumTable | null;
}

/** One line for a fault, as a terminal or GitHub prints it. */
export function faultLine(f: LibraryFault): string {
  return f.at === "" ? `${f.file}: ${f.problem}` : `${f.file} · ${f.at}: ${f.problem}`;
}

/** A name as search and the duplicate check compare it: "Push-up", "push up" and "Pushup" are one. */
export function nameKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function checkLibrary(input: LibraryInput): CheckedLibrary {
  const faults: LibraryFault[] = [];
  const table = readTable(input.compendium, faults);
  const codes = new Map((table?.rows ?? []).map((r) => [r.code, r]));

  const good: ExerciseFile[] = [];
  /** Every name and other name already seen, to the file and fact that holds it. */
  const names = new Map<string, { file: string; at: string; name: string }>();

  for (const file of [...input.exerciseFiles].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const before = faults.length;
    if (!file.name.endsWith(".json")) {
      faults.push({ file: file.name, at: "", problem: "only exercise files (<id>.json) belong in the exercises folder" });
      continue;
    }
    const data = readJson(file, faults);
    if (data === undefined) continue;
    const parsed = exerciseFileSchema.safeParse(data);
    if (!parsed.success) {
      faults.push(...issuesToFaults(file.name, data, parsed.error.issues));
      continue;
    }
    const ex = parsed.data;
    const fault = (at: string, problem: string): void => {
      faults.push({ file: file.name, at, problem });
    };

    if (file.name !== `${ex.id}.json`) fault("id", `the id is "${ex.id}", so the file is named ${ex.id}.json`);

    const main = new Set<string>();
    ex.muscles.main.forEach((m, i) => {
      if (main.has(m)) fault(`muscles.main.${String(i)}`, `"${m}" is named twice`);
      main.add(m);
    });
    const also = new Set<string>();
    ex.muscles.also.forEach((m, i) => {
      if (main.has(m)) fault(`muscles.also.${String(i)}`, `"${m}" is a main muscle already`);
      else if (also.has(m)) fault(`muscles.also.${String(i)}`, `"${m}" is named twice`);
      also.add(m);
    });
    const kit = new Set<string>();
    ex.equipment.forEach((e, i) => {
      if (kit.has(e)) fault(`equipment.${String(i)}`, `"${e}" is named twice`);
      kit.add(e);
    });

    if (table !== null && !codes.has(ex.energy.compendium)) {
      fault("energy.compendium", `${ex.energy.compendium} is not in the Compendium table (${input.compendium.name}); add its row from the Compendium's own page first`);
    }

    for (const [lang, text] of Object.entries(ex.text)) {
      const ids = new Set<string>();
      text.mistakes.forEach((m, i) => {
        if (ids.has(m.id)) fault(`text.${lang}.mistakes.${String(i)}.id`, `the mistake "${m.id}" is named twice`);
        ids.add(m.id);
      });
      const own = [{ at: `text.${lang}.name`, name: text.name }, ...text.otherNames.map((n, i) => ({ at: `text.${lang}.otherNames.${String(i)}`, name: n }))];
      for (const n of own) {
        const key = `${lang}:${nameKey(n.name)}`;
        const held = names.get(key);
        if (held !== undefined) {
          fault(n.at, held.file === file.name ? `"${n.name}" is the same name as "${held.name}" at ${held.at}` : `"${n.name}" is already the name "${held.name}" in ${held.file} (${held.at})`);
        } else {
          names.set(key, { file: file.name, at: n.at, name: n.name });
        }
      }
    }

    if (faults.length === before) good.push(ex);
  }

  good.sort((a, b) => (a.id < b.id ? -1 : 1));
  // A broken Compendium table holds every exercise back: none has a known energy.
  return { faults, exercises: table === null ? [] : good, compendium: table };
}

function readTable(file: { name: string; text: string }, faults: LibraryFault[]): CompendiumTable | null {
  const data = readJson(file, faults);
  if (data === undefined) return null;
  const parsed = compendiumTableSchema.safeParse(data);
  if (!parsed.success) {
    faults.push(...issuesToFaults(file.name, data, parsed.error.issues));
    return null;
  }
  const seen = new Set<string>();
  const twice: LibraryFault[] = [];
  for (const [i, r] of parsed.data.rows.entries()) {
    if (seen.has(r.code)) twice.push({ file: file.name, at: `rows.${String(i)}.code`, problem: `${r.code} is in the table twice` });
    seen.add(r.code);
  }
  faults.push(...twice);
  return twice.length === 0 ? parsed.data : null;
}

function readJson(file: { name: string; text: string }, faults: LibraryFault[]): unknown {
  try {
    const value: unknown = JSON.parse(file.text);
    return value;
  } catch (err) {
    faults.push({ file: file.name, at: "", problem: `not valid JSON (${err instanceof Error ? err.message : "unreadable"})` });
    return undefined;
  }
}

/** The value at a fact's path, for saying what was written there. */
function valueAt(data: unknown, path: readonly PropertyKey[]): unknown {
  let at: unknown = data;
  for (const key of path) {
    if (typeof at !== "object" || at === null || typeof key === "symbol") return undefined;
    const next: unknown = Reflect.get(at, key);
    at = next;
  }
  return at;
}

function shown(value: unknown): string {
  if (value === undefined) return "nothing";
  return typeof value === "string" ? `"${value}"` : JSON.stringify(value);
}

function issuesToFaults(file: string, data: unknown, issues: readonly z.core.$ZodIssue[]): LibraryFault[] {
  return issues.map((issue) => {
    const at = issue.path.map(String).join(".");
    const value = valueAt(data, issue.path);
    let problem: string;
    switch (issue.code) {
      case "invalid_value":
        problem = `${shown(value)} is not one of: ${issue.values.map(String).join(", ")}`;
        break;
      case "invalid_type":
        problem = value === undefined ? `missing (a ${issue.expected} is needed here)` : `${shown(value)} is not a ${issue.expected}`;
        break;
      case "unrecognized_keys":
        problem = `unknown fact${issue.keys.length > 1 ? "s" : ""} ${issue.keys.map((k) => `"${k}"`).join(", ")} (a misspelling?)`;
        break;
      case "too_small":
        problem = issue.origin === "array" ? `needs at least ${String(issue.minimum)}` : issue.origin === "string" ? `too short: at least ${String(issue.minimum)} characters` : `${shown(value)} is below its limit of ${String(issue.minimum)}`;
        break;
      case "too_big":
        problem = issue.origin === "array" ? `at most ${String(issue.maximum)}` : issue.origin === "string" ? `too long: at most ${String(issue.maximum)} characters` : `${shown(value)} is above its limit of ${String(issue.maximum)}`;
        break;
      case "invalid_union":
        problem = `${shown(value)} is not "reps" or "time"`;
        break;
      default:
        problem = issue.message;
    }
    return { file, at, problem };
  });
}
