// A saved run kept on the phone until the server has it (ROADMAP Stage 5 37a): never written over
// before the file is read, sent once even when asked twice at once, kept when there is no answer,
// told once when the server will never take it. And the app asks for the location only while in use.
import { describe, expect, it } from "vitest";
import type { SaveRunRequest, SavedRun } from "@app/shared";
import { configFor, copyFor } from "../app.config";
import { createRunOutbox, readRunFile, type RunSendResult } from "../src/screens/running/runQueue";

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
  leftOutM: 0, leftOutS: 0, kcal: 1, splitsKm: [], splitsMi: [], polyline: "",
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

  it("keeps a run with no answer, in order, and tells once of one the server refused", async () => {
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
    expect(outbox.view().refused).toEqual([
      { runId: run(1).runId, name: "Morning Run", message: "This run couldn't be saved." },
      { runId: run(2).runId, name: "Morning Run", message: "This run couldn't be saved." },
    ]);
    outbox.forgetRefused(run(1).runId);
    expect(outbox.view().refused.map((r) => r.runId)).toEqual([run(2).runId]);
  });

  it("reads a file it cannot read as holding nothing to send, and a bad run in it is left out", () => {
    expect(readRunFile("not json")).toEqual({ waiting: [], refused: [] });
    const text = JSON.stringify({ version: 1, waiting: [run(1), { runId: "nope" }], refused: [] });
    expect(readRunFile(text).waiting.map((r) => r.runId)).toEqual([run(1).runId]);
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
