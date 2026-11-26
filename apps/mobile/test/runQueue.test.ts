// A saved run kept on the phone until the server has it (ROADMAP Stage 5 37a): never written over
// before the file is read, sent once even when asked twice at once, kept when there is no answer,
// told once when the server will never take it. And the app asks for the location only while in use.
import { describe, expect, it } from "vitest";
import { RUN_MAX_POINTS, type SaveRunRequest, type SavedRun } from "@app/shared";
import { configFor, copyFor } from "../app.config";
import { createRunOutbox, readRunFile, runSender, type RunSendResult } from "../src/screens/running/runQueue";
type Session = Parameters<typeof runSender>[0];

const run = (n: number): SaveRunRequest => ({
  runId: `0000000${String(n)}-0000-4000-8000-000000000000`,
  startedAt: "2026-11-05T06:00:00.000Z",
  elapsedMs: 60_000,
  name: "Morning Run",
  effort: null,
  note: null,
  points: [[0, 26.1, 91.7, 5], [1000, 26.10003, 91.7, 5]],
  pauses: [],
});

const saved = (r: SaveRunRequest): SavedRun => ({
  id: r.runId, startedAt: r.startedAt, name: r.name, effort: r.effort, note: r.note, distanceM: 3, movingS: 60, elapsedS: 60,
  leftOutM: 0, leftOutS: 0, kcal: 1, splitsKm: [], splitsMi: [], polyline: "", trackStarts: [0], climbM: null, heartAvg: null, heartMax: null, heartZones: null,
});

function memory(text: string | null = null) {
  const file = { text, writes: 0 };
  return {
    file,
    store: {
      read: () => Promise.resolve(file.text),
      write: (t: string) => {
        file.text = t;
        file.writes += 1;
        return Promise.resolve();
      },
    },
  };
}

describe("one run the server cannot take (37m; the hunt's B1, B2, B7)", () => {
  // The worst thing: a run a person finished is thrown away, or never sent, without a word.
  it("never holds back the runs saved after it; after 5 failures over 10 minutes it is a run that couldn't be saved, kept whole", async () => {
    const m = memory();
    let clock = 0;
    const sent: string[] = [];
    const outbox = createRunOutbox(
      m.store,
      (r): Promise<RunSendResult> => {
        sent.push(r.runId);
        return Promise.resolve(r.runId === run(1).runId ? { kind: "failed" } : { kind: "done", run: saved(r) });
      },
      () => clock,
    );
    await outbox.start();
    await outbox.add(run(1));
    await outbox.add(run(2));
    await outbox.send();
    // The run after it is on the server; the failing one waits, and says it is tried again.
    expect(sent).toEqual([run(1).runId, run(2).runId]);
    expect(outbox.view().saved.map((r) => r.id)).toEqual([run(2).runId]);
    expect(outbox.view().waiting.map((r) => r.runId)).toEqual([run(1).runId]);
    expect(outbox.view().failing).toEqual([run(1).runId]);
    // Five failures within ten minutes: still waiting, never refused for a server down a few minutes.
    for (let i = 0; i < 4; i++) {
      clock += 60_000;
      await outbox.send();
    }
    expect(outbox.view().waiting.map((r) => r.runId)).toEqual([run(1).runId]);
    expect(outbox.view().refused).toEqual([]);
    // Ten minutes on: moved to the runs that couldn't be saved, whole, with its file, for Try again or Remove.
    clock = 10 * 60_000;
    await outbox.send();
    expect(outbox.view().waiting).toEqual([]);
    expect(outbox.view().failing).toEqual([]);
    expect(outbox.view().refused).toEqual([{ runId: run(1).runId, name: "Morning Run", message: "This run couldn't be saved.", run: run(1) }]);
    expect(readRunFile(m.file.text ?? "").refused.map((r) => r.run)).toEqual([run(1)]);
    // Try again: back in the queue, counted afresh.
    await outbox.retryRefused(run(1).runId);
    expect(outbox.view().waiting).toEqual([run(1)]);
    await outbox.send();
    expect(outbox.view()).toMatchObject({ failing: [run(1).runId], refused: [] });
  });

  it("with no answer at all, sends nothing past it and counts nothing: a phone offline never loses a run", async () => {
    const m = memory();
    let clock = 0;
    const sent: string[] = [];
    const outbox = createRunOutbox(m.store, (r) => {
      sent.push(r.runId);
      return Promise.resolve({ kind: "later" });
    }, () => clock);
    await outbox.start();
    await outbox.add(run(1));
    await outbox.add(run(2));
    for (let i = 0; i < 20; i++) {
      clock += 60_000;
      await outbox.send();
    }
    expect(new Set(sent)).toEqual(new Set([run(1).runId]));
    expect(outbox.view()).toMatchObject({ failing: [], refused: [] });
    expect(outbox.view().waiting.map((r) => r.runId)).toEqual([run(1).runId, run(2).runId]);
  });

  it("keeps a file it cannot all read aside before writing over it, and a run in it it cannot read is shown as couldn't be saved", async () => {
    const broken = { runId: run(3).runId, name: "Evening Run", points: "cut short" };
    const text = JSON.stringify({ version: 1, waiting: [run(1), broken, { name: "no id" }], refused: [] });
    const m = memory(text);
    const asides: string[] = [];
    const outbox = createRunOutbox({ ...m.store, aside: (t: string) => { asides.push(t); return Promise.resolve(); } }, () => Promise.resolve({ kind: "later" }));
    await outbox.start();
    expect(asides).toEqual([text]);
    expect(outbox.view().waiting).toEqual([run(1)]);
    expect(outbox.view().refused).toEqual([{ runId: run(3).runId, name: "Evening Run", message: "This run couldn't be saved.", run: broken }]);
    // Written back with the unreadable run among those that couldn't be saved, for Remove.
    expect(readRunFile(m.file.text ?? "").refused.map((r) => r.runId)).toEqual([run(3).runId]);
    // A file cut short as the battery died: aside, whole, before the first run is written over it.
    const cut = memory('{"version":1,"waiting":[{"runId":"0000');
    const cutAside: string[] = [];
    const second = createRunOutbox({ ...cut.store, aside: (t: string) => { cutAside.push(t); return Promise.resolve(); } }, () => Promise.resolve({ kind: "later" }));
    await second.start();
    expect(cutAside).toEqual(['{"version":1,"waiting":[{"runId":"0000']);
    await second.add(run(2));
    expect(readRunFile(cut.file.text ?? "").waiting).toEqual([run(2)]);
  });

  it("writes over nothing when the copy aside fails: the file stays as it was until it can be kept", async () => {
    const text = "not json";
    const m = memory(text);
    const outbox = createRunOutbox({ ...m.store, aside: () => Promise.reject(new Error("disk full")) }, () => Promise.resolve({ kind: "later" }));
    await expect(outbox.start()).rejects.toThrow("disk full");
    await outbox.add(run(1));
    expect(m.file.text).toBe(text);
    expect(outbox.view().unsaved).toBe(true);
  });
});

describe("what each answer of the server becomes (37m)", () => {
  const refusal = (status: number) => ({ kind: "refused", status, error: "x", message: "No.", retryAfterSeconds: null, robotCheckKey: null, body: null });
  it.each([
    ["the run kept", { kind: "ok", data: { status: "created", run: saved(run(1)) } }, "done"],
    ["a reply that is not a saved run", { kind: "ok", data: { status: "created" } }, "failed"],
    ["no answer", { kind: "no_answer" }, "later"],
    ["a sign-in being renewed", refusal(401), "later"],
    ["too many at once", refusal(429), "later"],
    ["the server's own timeout", refusal(408), "failed"],
    ["too early", refusal(425), "failed"],
    ["a fault of the server's", refusal(503), "failed"],
    ["deleted while it waited", refusal(410), "deleted"],
    ["a shape it will never take", refusal(400), "refused"],
  ] as const)("a run answered %s is %s", async (_name, answer, kind) => {
    // Only `signedIn` is used by the sender.
    const session = { signedIn: () => Promise.resolve(answer) } as unknown as Session;
    expect((await runSender(session)(run(1))).kind).toBe(kind);
  });
});

describe("the run outbox", () => {
  it("never writes over the file before reading it: a run added first joins those already there", async () => {
    const m = memory(JSON.stringify({ version: 1, waiting: [run(1)], refused: [] }));
    const outbox = createRunOutbox(m.store, () => Promise.resolve({ kind: "later" }));
    await outbox.add(run(2));
    expect(m.file.writes).toBe(0);
    await outbox.start();
    expect(outbox.view().waiting.map((r) => r.runId)).toEqual([run(1).runId, run(2).runId]);
    expect(readRunFile(m.file.text ?? "").waiting.map((r) => r.runId)).toEqual([run(1).runId, run(2).runId]);
  });

  it("sends each run once, even when asked to send twice at the same moment", async () => {
    const m = memory();
    const sent: string[] = [];
    const hold: { release: () => void } = { release: () => undefined };
    const gate = new Promise<void>((resolve) => {
      hold.release = resolve;
    });
    const outbox = createRunOutbox(m.store, async (r): Promise<RunSendResult> => {
      sent.push(r.runId);
      await gate;
      return { kind: "done", run: saved(r) };
    });
    await outbox.start();
    await outbox.add(run(1));
    const one = outbox.send();
    const two = outbox.send();
    hold.release();
    await Promise.all([one, two]);
    expect(sent).toEqual([run(1).runId]);
    expect(outbox.view()).toMatchObject({ waiting: [], sent: 1 });
    expect(outbox.view().saved.map((r) => r.id)).toEqual([run(1).runId]);
  });

  it("keeps a run with no answer, in order; one the server refused stays on the phone whole, to send again or remove", async () => {
    const m = memory();
    const answers: RunSendResult[] = [{ kind: "later" }];
    const outbox = createRunOutbox(m.store, () => Promise.resolve(answers.shift() ?? { kind: "refused", message: "This run couldn't be saved." }));
    await outbox.start();
    await outbox.add(run(1));
    await outbox.add(run(2));
    await outbox.send();
    expect(outbox.view().waiting.map((r) => r.runId)).toEqual([run(1).runId, run(2).runId]);
    await outbox.send();
    expect(outbox.view().waiting).toEqual([]);
    // Every point is still on the phone, and in its file (round one of 37a, H1): nothing is lost.
    expect(outbox.view().refused).toEqual([
      { runId: run(1).runId, name: "Morning Run", message: "This run couldn't be saved.", run: run(1) },
      { runId: run(2).runId, name: "Morning Run", message: "This run couldn't be saved.", run: run(2) },
    ]);
    expect(readRunFile(m.file.text ?? "").refused.map((r) => r.run)).toEqual([run(1), run(2)]);
    // Try again: back in the queue, whole.
    await outbox.retryRefused(run(1).runId);
    expect(outbox.view().waiting).toEqual([run(1)]);
    // Remove, which the person asked for: gone from the phone.
    outbox.removeRefused(run(2).runId);
    expect(outbox.view().refused).toEqual([]);
    expect(readRunFile(m.file.text ?? "").refused).toEqual([]);
  });

  it("lets go of a run the person deleted while it waited (37c-i): never kept, never told as refused, lists read again", async () => {
    const m = memory();
    const answers: RunSendResult[] = [{ kind: "deleted" }, { kind: "done", run: saved(run(2)) }];
    const outbox = createRunOutbox(m.store, () => Promise.resolve(answers.shift() ?? { kind: "later" }));
    await outbox.start();
    await outbox.add(run(1));
    await outbox.add(run(2));
    await outbox.send();
    expect(outbox.view()).toMatchObject({ waiting: [], refused: [], sent: 2 });
    expect(outbox.view().saved.map((r) => r.id)).toEqual([run(2).runId]);
    expect(readRunFile(m.file.text ?? "")).toEqual({ waiting: [], refused: [], whole: true });
  });

  it("reads a file it cannot read as holding nothing to send, and not whole; a bad run in it is not sent", () => {
    expect(readRunFile("not json")).toEqual({ waiting: [], refused: [], whole: false });
    const text = JSON.stringify({ version: 1, waiting: [run(1), { runId: "nope" }], refused: [] });
    expect(readRunFile(text).waiting.map((r) => r.runId)).toEqual([run(1).runId]);
    expect(readRunFile(text).whole).toBe(false);
    expect(readRunFile(JSON.stringify({ version: 1, waiting: [run(1)], refused: [] })).whole).toBe(true);
  });
});

describe("a refused run over the server's limits (re-check of 37a, L-a)", () => {
  it("reads back from the phone's file whole, and Try again leaves it there for Remove", async () => {
    const long = { ...run(9), points: Array.from({ length: RUN_MAX_POINTS + 4 }, (_, i) => [i * 1000, 26.1, 91.7, 5]) };
    const m = memory(JSON.stringify({ version: 1, waiting: [], refused: [{ runId: long.runId, name: long.name, message: "This run couldn't be saved.", run: long }] }));
    const outbox = createRunOutbox(m.store, () => Promise.resolve({ kind: "later" }));
    await outbox.start();
    expect(outbox.view().refused).toHaveLength(1);
    expect(outbox.view().refused[0]?.run).toEqual(long);
    await outbox.retryRefused(long.runId);
    expect(outbox.view().waiting).toEqual([]);
    expect(outbox.view().refused).toHaveLength(1);
  });
});

describe("the location the app asks for", () => {
  it("is only while the app is in use, kept through a locked screen by its service: never all the time", () => {
    const plugins = configFor(copyFor("feature2")).plugins ?? [];
    const location = plugins.find((p) => Array.isArray(p) && p[0] === "expo-location");
    expect(location).toEqual([
      "expo-location",
      {
        locationWhenInUsePermission: "Allow $(PRODUCT_NAME) to measure your runs.",
        isAndroidBackgroundLocationEnabled: false,
        isAndroidForegroundServiceEnabled: true,
        isIosBackgroundLocationEnabled: false,
      },
    ]);
  });
});
