import { describe, expect, it } from "vitest";
import { BODY_OUTBOX_MOST, type BodyMeasurement, type WaitingBodyEntry } from "@app/shared";
import type { TextStore } from "../src/screens/food/outbox";
import { createBodyOutbox, readBodyFile, type BodySendResult } from "../src/screens/progress/bodyQueue";

// A body measurement logged with no signal (ROADMAP Stage 5 35c-ii): kept on the phone until the
// server has it, sent once though the answer is lost, and one removed never comes back.

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const entry = (id: string, weightKg = 70): Omit<WaitingBodyEntry, "tried"> => ({ id, measuredAt: "2026-11-04T08:00:00.000Z", weightKg, metrics: { waist_cm: 82 } });

function file(text: string | null = null): TextStore & { text: string | null; fail: boolean } {
  const store = {
    text,
    fail: false,
    read: () => Promise.resolve(store.text),
    write: (next: string) => {
      if (store.fail) return Promise.reject(new Error("disk full"));
      store.text = next;
      return Promise.resolve();
    },
  };
  return store;
}

/** The server as this job built it: one entry for an id, however often sent; a removed id keeps nothing. */
function server() {
  const kept = new Map<string, number | null>();
  const removed = new Set<string>();
  const calls: string[] = [];
  const s = {
    kept,
    calls,
    online: true,
    loseAnswers: false,
    refuse: false,
    sender: {
      save: (e: WaitingBodyEntry): Promise<BodySendResult> => {
        calls.push(`save ${e.id}`);
        if (!s.online) return Promise.resolve({ kind: "later" });
        if (s.refuse) return Promise.resolve({ kind: "refused", message: "No." });
        if (removed.has(e.id)) return Promise.resolve({ kind: "done" });
        if (!kept.has(e.id)) kept.set(e.id, e.weightKg);
        const row: BodyMeasurement = { id: e.id, measuredAt: e.measuredAt, weightKg: kept.get(e.id) ?? null, metrics: e.metrics, source: "manual", createdAt: e.measuredAt };
        return Promise.resolve(s.loseAnswers ? { kind: "later" } : { kind: "done", entry: row });
      },
      remove: (id: string): Promise<BodySendResult> => {
        calls.push(`remove ${id}`);
        if (!s.online) return Promise.resolve({ kind: "later" });
        kept.delete(id);
        removed.add(id);
        return Promise.resolve({ kind: "done" });
      },
    },
  };
  return s;
}

describe("a body measurement waiting on the phone", () => {
  it("the worst thing: logged with no signal it is kept in the file, survives the app closing, and is sent once when back", async () => {
    const disk = file();
    const net = server();
    net.online = false;
    const first = createBodyOutbox(disk, net.sender);
    await first.start();
    expect(await first.add(entry(A))).toBe(true);
    await first.send();
    expect(first.view().waiting.map((w) => w.id)).toEqual([A]);
    expect(readBodyFile(disk.text ?? "").entries).toHaveLength(1);
    first.stop();

    // The app opened again later, with signal.
    net.online = true;
    const again = createBodyOutbox(disk, net.sender);
    await again.start();
    await again.send();
    expect([...net.kept.keys()]).toEqual([A]);
    expect(again.view().waiting).toEqual([]);
    expect(again.view().landed.map((l) => l.id)).toEqual([A]);
    expect(readBodyFile(disk.text ?? "").entries).toEqual([]);
  });

  it("an answer lost on the way back is sent again and kept once", async () => {
    const net = server();
    net.loseAnswers = true;
    const box = createBodyOutbox(file(), net.sender);
    await box.start();
    await box.add(entry(A));
    await box.send();
    net.loseAnswers = false;
    await box.send();
    // Sent until an answer came back, each time under the same id.
    expect(new Set(net.calls)).toEqual(new Set([`save ${A}`]));
    expect(net.calls.length).toBeGreaterThan(1);
    expect(net.kept.size).toBe(1);
    expect(box.view().waiting).toEqual([]);
  });

  it("removed after a send that got no answer, the removal follows the save and the server keeps nothing", async () => {
    const net = server();
    net.online = false;
    const box = createBodyOutbox(file(), net.sender);
    await box.start();
    await box.add(entry(A));
    await box.send();
    net.online = true;
    await box.remove(A);
    await box.send();
    // It was tried while offline, so the server may hold it: the removal is sent after the save.
    expect(net.calls.at(-1)).toBe(`remove ${A}`);
    expect(new Set(net.calls.slice(0, -1))).toEqual(new Set([`save ${A}`]));
    expect(net.kept.size).toBe(0);
    expect(box.view().removing.has(A)).toBe(true);
    box.settle(new Set());
    expect(box.view().removing.has(A)).toBe(false);
  });

  it("removed before it was ever sent, it never reaches the server", async () => {
    const net = server();
    const disk = file();
    let release: () => void = () => undefined;
    const box = createBodyOutbox(disk, {
      save: async (e) => {
        await new Promise<void>((r) => {
          release = r;
        });
        return await net.sender.save(e);
      },
      remove: net.sender.remove,
    });
    await box.start();
    await box.add(entry(A));
    await box.add(entry(B));
    await box.remove(B);
    release();
    await box.send();
    expect(net.calls).toEqual([`save ${A}`]);
    expect([...net.kept.keys()]).toEqual([A]);
  });

  it("a removal waits for its entry's save, in the order made", async () => {
    const net = server();
    net.online = false;
    const box = createBodyOutbox(file(), net.sender);
    await box.start();
    await box.add(entry(A));
    await box.send();
    await box.remove(A);
    expect(box.view().waiting).toEqual([]);
    net.online = true;
    await box.send();
    expect(net.calls.slice(-2)).toEqual([`save ${A}`, `remove ${A}`]);
    expect(net.kept.size).toBe(0);
  });

  it("refused, it says so until the person presses OK", async () => {
    const net = server();
    net.refuse = true;
    const box = createBodyOutbox(file(), net.sender);
    await box.start();
    await box.add(entry(A));
    await box.send();
    expect(box.view().refused).toEqual([{ id: A, message: "No." }]);
    expect(box.view().waiting).toEqual([]);
    box.forget(A);
    expect(box.view().refused).toEqual([]);
  });

  it("a landed entry is held until a read of the list has it", async () => {
    const net = server();
    const box = createBodyOutbox(file(), net.sender);
    await box.start();
    await box.add(entry(A));
    await box.send();
    expect(box.view().landed.map((l) => l.id)).toEqual([A]);
    box.settle(new Set([B]));
    expect(box.view().landed.map((l) => l.id)).toEqual([A]);
    box.settle(new Set([A]));
    expect(box.view().landed).toEqual([]);
  });

  it("a file that cannot all be read is kept aside, and what can be read is kept", async () => {
    const good = { kind: "save", entry: { ...entry(A), tried: false } };
    const disk = file(JSON.stringify({ version: 1, entries: [good, { kind: "save", entry: { id: "nope" } }], refused: [] }));
    const aside: string[] = [];
    const box = createBodyOutbox({ ...disk, aside: (t) => { aside.push(t); return Promise.resolve(); } }, server().sender);
    await box.start();
    expect(aside).toHaveLength(1);
    expect(box.view().waiting.map((w) => w.id)).toEqual([A]);
    expect(readBodyFile("not json")).toEqual({ entries: [], refused: [], whole: false });
  });

  it("a write that fails is said, and written again by the next", async () => {
    const disk = file();
    const net = server();
    net.online = false;
    const box = createBodyOutbox(disk, net.sender);
    await box.start();
    disk.fail = true;
    await box.add(entry(A));
    expect(box.view().unsaved).toBe(true);
    disk.fail = false;
    await box.send();
    expect(box.view().unsaved).toBe(false);
    expect(readBodyFile(disk.text ?? "").entries).toHaveLength(1);
  });

  it("a full file takes no more, and says so", async () => {
    const net = server();
    net.online = false;
    const box = createBodyOutbox(file(), net.sender);
    await box.start();
    for (let i = 0; i < BODY_OUTBOX_MOST; i += 1) await box.add(entry(`${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`));
    expect(await box.add(entry(A))).toBe(false);
  });
});
