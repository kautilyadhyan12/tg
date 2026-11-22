// A person's saved workouts on the phone (64a-iv). The worst thing it could do to a real person: Maya saves Leg day in a
// basement with no signal and it never reaches her account. So the first test saves with no answer from the server,
// closes the app, opens it again with signal, and finds Leg day in her account. Then every answer the server gives a
// save or a delete, the order changes go in, a list asked for before an answer, and the rules as tables.
import { readdirSync, readFileSync } from "node:fs";
import {
  readPhoneLibrary,
  SAVED_EDITED_AHEAD,
  type KeptSavedEntry,
  type PhoneLibraryEntry,
  type PlannedExercise,
  type SavedChange,
} from "@app/shared";
import { describe, expect, it } from "vitest";
import { EMPTY, type MyWorkout } from "../src/library/myWorkout";
import {
  SAVED_PATH,
  SAVE_REFUSED_WORDS,
  createSavedStore,
  editedAtFor,
  entryOf,
  fullWords,
  mergeList,
  readSaveRefusal,
  sameWorkout,
  savedPath,
  shownList,
  toPlanned,
  type SavedStore,
} from "../src/library/savedWorkouts";
import type { Answer, Request, Shape } from "../src/session/calls";
import type { TextStore } from "../src/screens/food/outbox";

const LEG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PUSH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = Date.parse("2026-11-22T10:00:00.000Z");
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();
const SQUAT: PlannedExercise = { exercise: "squat", measuredIn: "reps", sets: [{ target: 10, weightGrams: 60_000, restSeconds: 90 }, { target: 10, weightGrams: 60_000, restSeconds: 90 }] };
const PLANK: PlannedExercise = { exercise: "plank", measuredIn: "time", sets: [{ target: 45, weightGrams: null, restSeconds: null }] };
const settle = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0));
};

/** The phone's documents folder: one text a name. */
function disk() {
  const files = new Map<string, string>();
  const file = (name: string): TextStore => ({
    read: () => Promise.resolve(files.get(name) ?? null),
    write: (text) => {
      files.set(name, text);
      return Promise.resolve();
    },
  });
  return { files, file };
}

type Reply = { status: number; body?: unknown } | "none";
type Asked = { method: string; path: string; body: unknown };

/** The server: each request answered by `answer`, its reply read through the request's shape, as `call` reads it. */
function server(answer: (r: Asked) => Reply) {
  const asked: Asked[] = [];
  const signedIn = <T,>(request: Omit<Request, "token">, shape: Shape<T>): Promise<Answer<T>> => {
    const r = { method: request.method, path: request.path, body: request.body };
    asked.push(r);
    const reply = answer(r);
    if (reply === "none") return Promise.resolve({ kind: "no_answer" });
    if (reply.status < 300) {
      const parsed = shape.safeParse(reply.status === 204 ? null : reply.body);
      return Promise.resolve(parsed.success ? { kind: "ok", data: parsed.data } : { kind: "no_answer" });
    }
    const body = (reply.body ?? {}) as { error?: string; message?: string };
    return Promise.resolve({ kind: "refused", status: reply.status, error: body.error ?? "error", message: body.message ?? "", retryAfterSeconds: null, robotCheckKey: null, body: reply.body });
  };
  return { asked, signedIn };
}

/** What the real server answers a save: created, or updated, with the change's own time. */
const kept = (r: Asked, status: "created" | "updated" = "created"): Reply => ({ status: status === "created" ? 201 : 200, body: { id: r.path.split("/").pop(), status, editedAt: (r.body as { editedAt: string }).editedAt } });
const emptyList: Reply = { status: 200, body: { savedWorkouts: [], most: 50 } };

let ids = 0;
function store(d: ReturnType<typeof disk>, s: ReturnType<typeof server>, clock = () => NOW): SavedStore {
  return createSavedStore({
    copy: d.file("saved-workouts-me.json"),
    waiting: d.file("saved-changes-me.json"),
    signedIn: s.signedIn,
    newId: () => {
      ids += 1;
      return `${String(ids).padStart(8, "0")}-0000-4000-8000-000000000000`;
    },
    clock,
  });
}

describe("the worst thing: a workout saved with no signal never reaches the account", () => {
  it("saved with no answer, the app closed and opened again with signal: Leg day is in her account", async () => {
    const d = disk();
    const offline = server(() => "none");
    const first = store(d, offline);
    await first.ready;
    const { kept: where, savedId } = await first.save({ savedId: null, name: "Leg day", exercises: [SQUAT, PLANK] });
    await settle();
    expect(where).toBe("kept");
    // On the phone, listed, and marked as waiting.
    expect(first.view().list.map((e) => [e.name, e.onPhone])).toEqual([["Leg day", true]]);
    expect(first.view().held).toBe(true);
    expect((JSON.parse(d.files.get("saved-changes-me.json") ?? "{}") as { waiting: unknown[] }).waiting).toHaveLength(1);
    first.stop();

    // The app opened again, with signal: the save goes, whole, under its own id.
    const account = new Map<string, unknown>();
    const online = server((r) => {
      if (r.method === "PUT") {
        account.set(r.path, r.body);
        return kept(r);
      }
      return { status: 200, body: { savedWorkouts: [], most: 50 } };
    });
    const again = store(d, online);
    await again.ready;
    expect(again.view().list.map((e) => e.name)).toEqual(["Leg day"]);
    await again.send(true);
    await settle();
    expect(account.get(savedPath(savedId))).toEqual({ name: "Leg day", editedAt: new Date(NOW).toISOString(), exercises: [SQUAT, PLANK] });
    expect(again.view().list.map((e) => [e.name, e.onPhone])).toEqual([["Leg day", false]]);
    expect((JSON.parse(d.files.get("saved-changes-me.json") ?? "{}") as { waiting: unknown[] }).waiting).toHaveLength(0);
    // The phone's copy holds it whole, so it loads with no internet.
    const copy = JSON.parse(d.files.get("saved-workouts-me.json") ?? "{}") as { entries: KeptSavedEntry[] };
    expect(copy.entries.map((e) => [e.id, e.whole?.length])).toEqual([[savedId, 2]]);
  });

  it("a phone whose clock runs fast is answered edited_ahead: the save is kept and sent again, never refused", async () => {
    const d = disk();
    let ahead = true;
    const s = server((r) => (r.method === "PUT" ? (ahead ? { status: 400, body: { error: SAVED_EDITED_AHEAD, message: "editedAt: later than the server's clock" } } : kept(r)) : emptyList));
    const st = store(d, s);
    await st.ready;
    await st.save({ savedId: null, name: "Leg day", exercises: [SQUAT] });
    await settle();
    expect(st.view().refused).toEqual([]);
    expect(st.view().list[0]?.onPhone).toBe(true);
    ahead = false;
    await st.send(true);
    await settle();
    expect(st.view().list[0]?.onPhone).toBe(false);
    expect(s.asked.filter((a) => a.method === "PUT")).toHaveLength(2);
  });
});

describe("what each answer to a save means", () => {
  const no: Exclude<Answer<unknown>, { kind: "ok" }> = { kind: "no_answer" };
  const refusal = (status: number, error = "x"): Exclude<Answer<unknown>, { kind: "ok" }> => ({ kind: "refused", status, error, message: "", retryAfterSeconds: null, robotCheckKey: null, body: {} });
  it.each<[string, Exclude<Answer<unknown>, { kind: "ok" }>, string]>([
    ["no answer", no, "later"],
    ["a sign-in being renewed (401)", refusal(401), "later"],
    ["an exercise the server does not know (422)", refusal(422), "later"],
    ["too many at once (429)", refusal(429), "later"],
    ["the server's own fault (503)", refusal(503), "later"],
    ["a phone clock ahead of the server's", refusal(400, SAVED_EDITED_AHEAD), "later"],
    ["past the limit (409)", refusal(409, "saved_workouts_full"), `refused:${fullWords(50)}`],
    ["a broken phone's save (400)", refusal(400, "validation_error"), `refused:${SAVE_REFUSED_WORDS}`],
    ["somebody else's id (404)", refusal(404, "not_found"), `refused:${SAVE_REFUSED_WORDS}`],
  ])("%s", (_, answer, want) => {
    const got = readSaveRefusal(answer, 50);
    expect(got.kind === "refused" ? `refused:${got.message}` : got.kind).toBe(want);
  });

  it("past the limit, the save is said on the phone until OK, and is out of the list", async () => {
    const s = server((r) => (r.method === "PUT" ? { status: 409, body: { error: "saved_workouts_full", most: 50 } } : emptyList));
    const st = store(disk(), s);
    await st.ready;
    await st.save({ savedId: null, name: "Leg day", exercises: [SQUAT] });
    await settle();
    expect(st.view().list).toEqual([]);
    expect(st.view().refused.map((r) => [r.name, r.message])).toEqual([["Leg day", fullWords(50)]]);
    st.dismiss(st.view().refused[0]?.id ?? "");
    expect(st.view().refused).toEqual([]);
  });

  it("removed (deleted on another phone): nothing is kept and the phone forgets it", async () => {
    const s = server((r) => (r.method === "PUT" ? { status: 200, body: { id: LEG, status: "removed", editedAt: null } } : emptyList));
    const st = store(disk(), s);
    await st.ready;
    await st.save({ savedId: LEG, name: "Leg day", exercises: [SQUAT] });
    await settle();
    expect(st.view().list).toEqual([]);
  });

  it("unchanged with another time (a newer change from another phone): the list is read again and the newer one shown", async () => {
    const s = server((r) =>
      r.method === "PUT"
        ? { status: 200, body: { id: LEG, status: "unchanged", editedAt: at(1) } }
        : { status: 200, body: { savedWorkouts: [{ id: LEG, name: "Leg day B", editedAt: at(1), exercises: ["plank"], setsCount: 1 }], most: 50 } },
    );
    const st = store(disk(), s);
    await st.ready;
    await st.save({ savedId: LEG, name: "Leg day", exercises: [SQUAT] });
    await settle();
    expect(st.view().list.map((e) => [e.name, e.whole])).toEqual([["Leg day B", null]]);
  });
});

describe("changes go in the order made, and a list asked for before an answer never undoes it", () => {
  it("a save, a change and a delete of one workout go in that order; a delete answered 404 is let go", async () => {
    let online = false;
    const s = server((r) => (!online ? "none" : r.method === "PUT" ? kept(r, "updated") : r.method === "DELETE" ? { status: 404, body: { error: "not_found" } } : emptyList));
    let t = NOW;
    const st = store(disk(), s, () => t);
    await st.ready;
    await st.save({ savedId: LEG, name: "Leg day", exercises: [SQUAT] });
    t += 1000;
    await st.save({ savedId: LEG, name: "Leg day", exercises: [SQUAT, PLANK] });
    await st.remove(LEG);
    await settle();
    expect(st.view().list).toEqual([]);
    online = true;
    await st.send(true);
    await settle();
    const sent = s.asked.filter((a) => a.method !== "GET").slice(-3);
    expect(sent.map((a) => a.method)).toEqual(["PUT", "PUT", "DELETE"]);
    expect((sent[1]?.body as { editedAt: string }).editedAt > (sent[0]?.body as { editedAt: string }).editedAt).toBe(true);
    expect(st.view().list).toEqual([]);
    expect(st.view().refused).toEqual([]);
  });

  it("a list the server sent before a save's answer is asked for again, so the saved workout never vanishes", async () => {
    // The account as the server holds it: a list read before the save lands is empty; one read after holds Leg day.
    const lists: string[][] = [];
    let release: () => void = () => undefined;
    let stored: { name: string; editedAt: string } | null = null;
    const s = server((r) => {
      if (r.method === "PUT") {
        stored = r.body as { name: string; editedAt: string };
        return kept(r);
      }
      return { status: 200, body: { savedWorkouts: stored === null ? [] : [{ id: LEG, name: stored.name, editedAt: stored.editedAt, exercises: ["squat"], setsCount: 2 }], most: 50 } };
    });
    const st = createSavedStore({
      copy: disk().file("c"),
      waiting: disk().file("w"),
      newId: () => PUSH,
      clock: () => NOW,
      signedIn: async <T,>(request: Omit<Request, "token">, shape: Shape<T>): Promise<Answer<T>> => {
        const answer = s.signedIn(request, shape);
        if (request.method === "GET") {
          const got = await answer;
          lists.push(got.kind === "ok" ? (got.data as { savedWorkouts: { name: string }[] }).savedWorkouts.map((w) => w.name) : []);
          // The first list leaves the server before the save lands, and arrives after the save's answer.
          if (lists.length === 1) await new Promise<void>((r) => (release = r));
          return got;
        }
        return answer;
      },
    });
    await st.ready;
    const listing = st.refresh();
    await settle();
    await st.save({ savedId: LEG, name: "Leg day", exercises: [SQUAT] });
    await settle();
    release();
    await listing;
    await settle();
    expect(lists).toEqual([[], ["Leg day"]]);
    expect(st.view().list.map((e) => e.name)).toEqual(["Leg day"]);
  });
});

describe("loading one", () => {
  it("from the phone where it holds that change; read from the server where not; gone (404) is taken out; no answer says so", async () => {
    const d = disk();
    d.files.set(
      "saved-workouts-me.json",
      JSON.stringify({
        v: 1,
        most: 50,
        entries: [
          { ...entryOf(LEG, "Leg day", at(-5), [SQUAT]) },
          { id: PUSH, name: "Push day", editedAt: at(-3), exercises: ["plank"], setsCount: 1, whole: null },
          { id: "not-an-id", name: "Broken", editedAt: at(-1), exercises: [], setsCount: 0, whole: null },
        ],
      }),
    );
    let reply: Reply = "none";
    const s = server(() => reply);
    const st = store(d, s);
    await st.ready;
    expect(st.view().list.map((e) => e.name)).toEqual(["Push day", "Leg day"]);
    expect(await st.whole(LEG)).toEqual({ kind: "ok", name: "Leg day", exercises: [SQUAT] });
    expect(s.asked).toEqual([]);
    expect(await st.whole(PUSH)).toEqual({ kind: "no_answer" });
    reply = { status: 200, body: { id: PUSH, name: "Push day", editedAt: at(-3), exercises: [PLANK] } };
    expect(await st.whole(PUSH)).toEqual({ kind: "ok", name: "Push day", exercises: [PLANK] });
    expect(s.asked.map((a) => a.path)).toEqual([savedPath(PUSH), savedPath(PUSH)]);
    expect(st.view().list.find((e) => e.id === PUSH)?.whole).toEqual([PLANK]);
    // Held whole now, it loads from the phone without asking.
    reply = { status: 404, body: { error: "not_found" } };
    expect(await st.whole(PUSH)).toEqual({ kind: "ok", name: "Push day", exercises: [PLANK] });
    const gone = store(disk(), server(() => ({ status: 404, body: { error: "not_found" } })));
    await gone.ready;
    expect(await gone.whole(PUSH)).toEqual({ kind: "gone" });
  });

  it("the list the server gives replaces the phone's copy; asked with no signal, the copy stays", async () => {
    const d = disk();
    d.files.set("saved-workouts-me.json", JSON.stringify({ v: 1, most: 50, entries: [entryOf(LEG, "Leg day", at(-5), [SQUAT])] }));
    let reply: Reply = "none";
    const st = store(d, server(() => reply));
    await st.ready;
    await st.refresh();
    expect(st.view().list.map((e) => e.name)).toEqual(["Leg day"]);
    reply = { status: 200, body: { savedWorkouts: [{ id: PUSH, name: "Push day", editedAt: at(-1), exercises: ["plank"], setsCount: 1 }], most: 50 } };
    await st.refresh();
    expect(st.view().list.map((e) => e.name)).toEqual(["Push day"]);
    expect(s(d)).toEqual(["Push day"]);
    function s(x: ReturnType<typeof disk>) {
      return (JSON.parse(x.files.get("saved-workouts-me.json") ?? "{}") as { entries: KeptSavedEntry[] }).entries.map((e) => e.name);
    }
  });
});

describe("the rules", () => {
  const FOLDER = new URL("../../../packages/shared/library/exercises/", import.meta.url);
  const library: PhoneLibraryEntry[] =
    readPhoneLibrary({
      fingerprint: "a".repeat(64),
      version: 1,
      list: { exercises: readdirSync(FOLDER).map((name) => ({ ...(JSON.parse(readFileSync(new URL(name, FOLDER), "utf8")) as object), status: "live", met: 3 })), camera: [] },
    })?.exercises ?? [];
  const liveOf = (id: string) => library.find((e) => e.id === id) ?? null;

  it("My Workout as a saved workout holds it: set-up sets as set, the Library's starting numbers where none changed, one no longer in the Library left out", () => {
    const w: MyWorkout = {
      ...EMPTY,
      items: [
        { id: "squat", plan: { measuredIn: "reps", sets: SQUAT.sets } },
        { id: "plank", plan: null },
        { id: "gone_exercise", plan: null },
      ],
    };
    const p = toPlanned(w, liveOf);
    expect(p.left).toEqual(["gone_exercise"]);
    expect(p.exercises.map((e) => [e.exercise, e.measuredIn, e.sets.length])).toEqual([["squat", "reps", 2], ["plank", "time", 3]]);
    expect(p.exercises[1]?.sets[0]).toEqual({ target: 30, weightGrams: null, restSeconds: 60 });
    expect(p.sets).toBe(5);
  });

  it.each<[string, string, PlannedExercise[], string, PlannedExercise[], boolean]>([
    ["the same", "Leg day", [SQUAT], "Leg day", [SQUAT], true],
    ["spaces round the name", " Leg day ", [SQUAT], "Leg day", [SQUAT], true],
    ["renamed", "Leg day B", [SQUAT], "Leg day", [SQUAT], false],
    ["one weight changed", "Leg day", [{ ...SQUAT, sets: [SQUAT.sets[0] ?? { target: 1, weightGrams: null, restSeconds: null }, { target: 10, weightGrams: 62_500, restSeconds: 90 }] }], "Leg day", [SQUAT], false],
    ["reordered", "Leg day", [PLANK, SQUAT], "Leg day", [SQUAT, PLANK], false],
    ["an exercise more", "Leg day", [SQUAT, PLANK], "Leg day", [SQUAT], false],
  ])("same workout: %s", (_, an, a, bn, b, want) => {
    expect(sameWorkout(an, a, bn, b)).toBe(want);
  });

  it.each<[string, KeptSavedEntry[], SavedChange[], string[]]>([
    ["the copy alone, newest first", [entryOf(LEG, "Leg day", at(-5), [SQUAT]), entryOf(PUSH, "Push day", at(-1), [PLANK])], [], ["Push day", "Leg day"]],
    ["a new save waiting goes first", [entryOf(LEG, "Leg day", at(-5), [SQUAT])], [{ id: "c1", kind: "save", savedId: PUSH, name: "Push day", editedAt: at(0), exercises: [PLANK] }], ["Push day*", "Leg day"]],
    ["a change waiting takes its workout's place", [entryOf(LEG, "Leg day", at(-5), [SQUAT])], [{ id: "c1", kind: "save", savedId: LEG, name: "Leg day B", editedAt: at(0), exercises: [PLANK] }], ["Leg day B*"]],
    ["a delete waiting takes it out", [entryOf(LEG, "Leg day", at(-5), [SQUAT]), entryOf(PUSH, "Push day", at(-1), [PLANK])], [{ id: "c1", kind: "delete", savedId: LEG }], ["Push day"]],
    ["saved then deleted, both waiting", [], [{ id: "c1", kind: "save", savedId: LEG, name: "Leg day", editedAt: at(0), exercises: [SQUAT] }, { id: "c2", kind: "delete", savedId: LEG }], []],
  ])("the list shown: %s", (_, entries, waiting, want) => {
    expect(shownList(entries, waiting).map((e) => `${e.name}${e.onPhone ? "*" : ""}`)).toEqual(want);
  });

  it.each<[string, number, string | null, string]>([
    ["the phone's clock", NOW, null, new Date(NOW).toISOString()],
    ["after a change the phone heard of from a clock ahead", NOW, at(2), new Date(NOW + 2 * 60_000 + 1).toISOString()],
    ["the phone's clock where it is later", NOW, at(-2), new Date(NOW).toISOString()],
    ["a time that is not one", NOW, "never", new Date(NOW).toISOString()],
  ])("a change's time: %s", (_, now, held, want) => {
    expect(editedAtFor(now, held)).toBe(want);
  });

  it("the server's list: its facts win; the whole kept only for the same change; one that cannot be read left out", () => {
    const kept = [entryOf(LEG, "Leg day", at(-5), [SQUAT]), entryOf(PUSH, "Push day", at(-3), [PLANK])];
    const merged = mergeList(kept, [
      { id: LEG, name: "Leg day", editedAt: new Date(Date.parse(at(-5))).toISOString().replace("Z", "+00:00"), exercises: ["squat"], setsCount: 2 },
      { id: PUSH, name: "Push day B", editedAt: at(-1), exercises: ["plank", "squat"], setsCount: 4 },
      { id: "broken", name: "x", editedAt: at(0), exercises: [], setsCount: 0 },
    ]);
    expect(merged.map((e) => [e.name, e.whole === null ? null : e.whole.length])).toEqual([["Leg day", 1], ["Push day B", null]]);
  });

  it("the paths", () => {
    expect([SAVED_PATH, savedPath(LEG)]).toEqual(["/v1/training/saved", `/v1/training/saved/${LEG}`]);
  });
});
