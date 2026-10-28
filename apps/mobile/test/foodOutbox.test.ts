import { describe, expect, it } from "vitest";
import { MEAL_OUTBOX_MOST, type Meal, type WaitingMeal } from "@app/shared";
import { createOutbox, type SendResult, type Sender, type TextStore } from "../src/screens/food/outbox";

// The worst thing this job could do to a person (32b-i's plan): a meal logged with no signal is lost
// or counted twice, so the day's numbers lie; or a meal they removed comes back.

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function meal(id: string, name = "Banana"): WaitingMeal {
  return {
    id,
    body: { id, mealName: name, takenAt: "2026-10-28T08:00:00.000Z", mealType: "breakfast", items: [{ canonical: "banana", measure: "serving", amount: 1 }] },
    items: null,
    totals: null,
    tried: false,
  };
}

/** The phone's file, which outlives the app. */
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

/** The server as 32a built it: one meal for an id, however often it is sent. `online` false is no
 *  signal; `loseAnswers` saves the meal and loses the reply on the way back. */
function server() {
  const meals = new Map<string, string>();
  const calls: string[] = [];
  const s = {
    meals,
    calls,
    online: true,
    loseAnswers: false,
    refuse: null as string | null,
    hold: null as Promise<void> | null,
    sender: {
      save: async (m: WaitingMeal): Promise<SendResult> => {
        calls.push(`save ${m.id}`);
        if (s.hold !== null) await s.hold;
        if (!s.online) return { kind: "later" };
        if (s.refuse !== null) return { kind: "refused", message: s.refuse };
        if (!meals.has(m.id)) meals.set(m.id, m.body.mealName);
        return s.loseAnswers ? { kind: "later" } : { kind: "done" };
      },
      remove: (id: string): Promise<SendResult> => {
        calls.push(`remove ${id}`);
        if (!s.online) return Promise.resolve({ kind: "later" });
        meals.delete(id);
        return Promise.resolve({ kind: "done" });
      },
    } satisfies Sender,
  };
  return s;
}

describe("a meal logged on the phone", () => {
  it("logged with no signal, is kept through a restart and saved once when the signal is back", async () => {
    const phone = file();
    const api = server();
    api.online = false;
    const first = createOutbox(phone, api.sender);
    await first.start();
    await first.add(meal(A));
    await first.send();
    expect(api.meals.size).toBe(0);
    expect(first.view().waiting.map((m) => m.id)).toEqual([A]);
    first.stop();

    // The app is closed and opened again; the signal is back.
    api.online = true;
    const second = createOutbox(phone, api.sender);
    await second.start();
    expect(second.view().waiting.map((m) => m.id)).toEqual([A]);
    await second.send();
    expect([...api.meals.keys()]).toEqual([A]);
    expect(second.view().waiting).toEqual([]);
    expect(JSON.parse(phone.text ?? "")).toEqual({ version: 1, entries: [], refused: [] });
  });

  it("whose reply was lost is sent again under the same id, and the server keeps one meal", async () => {
    const api = server();
    api.loseAnswers = true;
    const box = createOutbox(file(), api.sender);
    await box.start();
    await box.add(meal(A));
    await box.send();
    api.loseAnswers = false;
    await box.send();
    expect(api.calls.length).toBeGreaterThan(1);
    expect(new Set(api.calls)).toEqual(new Set([`save ${A}`]));
    expect(api.meals.size).toBe(1);
    expect(box.view().waiting).toEqual([]);
  });

  it("is written to the phone before anything is sent", async () => {
    const phone = file();
    const api = server();
    const seen: (string | null)[] = [];
    const watching: Sender = {
      save: (m) => {
        seen.push(phone.text);
        return api.sender.save(m);
      },
      remove: api.sender.remove,
    };
    const box = createOutbox(phone, watching);
    await box.start();
    await box.add(meal(A));
    await box.send();
    expect(seen[0]).toContain(A);
  });

  it("never writes over the file before it is read, so meals already waiting are kept", async () => {
    const api = server();
    api.online = false;
    const phone = file();
    const before = createOutbox(phone, api.sender);
    await before.start();
    await before.add(meal(A, "Oats"));
    before.stop();

    const after = createOutbox(phone, api.sender);
    await after.add(meal(B, "Rice"));
    await after.start();
    expect(after.view().waiting.map((m) => m.id)).toEqual([A, B]);
  });

  it("the server refuses is said once and not sent again", async () => {
    const api = server();
    api.refuse = "That food could not be logged.";
    const box = createOutbox(file(), api.sender);
    await box.start();
    await box.add(meal(A));
    await box.send();
    await box.send();
    expect(api.calls).toEqual([`save ${A}`]);
    expect(box.view().refused).toEqual([{ id: A, name: "Banana", message: "That food could not be logged." }]);
    box.forget(A);
    expect(box.view().refused).toEqual([]);
  });

  it("sent in the order logged", async () => {
    const api = server();
    api.online = false;
    const box = createOutbox(file(), api.sender);
    await box.start();
    await box.add(meal(A));
    await box.add(meal(B));
    api.online = true;
    api.calls.length = 0;
    await box.send();
    expect(api.calls).toEqual([`save ${A}`, `save ${B}`]);
  });
});

describe("a meal removed", () => {
  it("before it was ever sent never reaches the server", async () => {
    const api = server();
    const box = createOutbox(file(), api.sender);
    // Not started: the file is still being read, so nothing is sent yet.
    await box.add(meal(A));
    await box.remove(A);
    await box.start();
    await box.send();
    expect(api.calls).toEqual([]);
    expect(box.view().waiting).toEqual([]);
  });

  it("after a send that had no answer is removed there after its save, and never comes back", async () => {
    const api = server();
    api.loseAnswers = true;
    const box = createOutbox(file(), api.sender);
    await box.start();
    await box.add(meal(A));
    await box.send();
    // The server has it; the phone could not hear so. The person removes it.
    await box.remove(A);
    expect(box.view().removing.has(A)).toBe(true);
    expect(box.view().waiting).toEqual([]);
    api.loseAnswers = false;
    await box.send();
    // Every send of it is the same meal; its removal goes last.
    expect(new Set(api.calls.slice(0, -1))).toEqual(new Set([`save ${A}`]));
    expect(api.calls.at(-1)).toBe(`remove ${A}`);
    expect(api.meals.size).toBe(0);
    // Hidden until a read of the day begun after the removal comes back.
    expect(box.view().removing.has(A)).toBe(true);
    box.settle(box.view().sent);
    expect(box.view().removing.size).toBe(0);
  });

  it("while its save is on the way is removed after the save lands", async () => {
    const api = server();
    let land: () => void = () => undefined;
    api.hold = new Promise<void>((resolve) => {
      land = resolve;
    });
    const box = createOutbox(file(), api.sender);
    await box.start();
    await box.add(meal(A));
    await box.remove(A);
    land();
    api.hold = null;
    await box.send();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(api.calls).toEqual([`save ${A}`, `remove ${A}`]);
    expect(api.meals.size).toBe(0);
  });

  it("with no signal stays removed through a restart and is removed when the signal is back", async () => {
    const phone = file();
    const api = server();
    api.meals.set(A, "Banana");
    api.online = false;
    const first = createOutbox(phone, api.sender);
    await first.start();
    await first.remove(A);
    first.stop();

    api.online = true;
    const second = createOutbox(phone, api.sender);
    await second.start();
    expect(second.view().removing.has(A)).toBe(true);
    await second.send();
    expect(api.meals.size).toBe(0);
  });
});

describe("the phone's file", () => {
  it("that is not a list of meals is read as none, and kept aside as it was", async () => {
    const kept: string[] = [];
    const box = createOutbox({ ...file("{not json"), aside: (t) => { kept.push(t); return Promise.resolve(); } }, server().sender);
    await box.start();
    expect(box.view().waiting).toEqual([]);
    expect(kept).toEqual(["{not json"]);
  });

  it("whose meal carries another id than its own is refused whole", async () => {
    const bad = { ...meal(A), body: { ...meal(A).body, id: B } };
    const box = createOutbox(file(JSON.stringify({ version: 1, entries: [{ kind: "save", meal: bad }] })), server().sender);
    await box.start();
    expect(box.view().waiting).toEqual([]);
  });
});

describe("round one's findings", () => {
  it("one failed write never stops the writing: a meal logged after it is kept and sent", async () => {
    const phone = file();
    const api = server();
    api.online = false;
    let fail = true;
    const flaky: TextStore = {
      read: phone.read,
      write: (text) => (fail ? Promise.reject(new Error("disk full")) : phone.write(text)),
    };
    const box = createOutbox(flaky, api.sender);
    await box.start();
    await box.add(meal(A, "Oats"));
    expect(box.view().unsaved).toBe(true);
    fail = false;
    await box.add(meal(B, "Rice"));
    expect(box.view().unsaved).toBe(false);
    box.stop();

    api.online = true;
    const again = createOutbox(phone, api.sender);
    await again.start();
    await again.send();
    expect([...api.meals.keys()].sort()).toEqual([A, B].sort());
  });

  it("one entry it cannot read costs only that entry, and the file is kept aside before it is written over", async () => {
    const good = { kind: "save", meal: meal(A) };
    const bad = { kind: "save", meal: { ...meal(B), body: { ...meal(B).body, mealName: "x".repeat(201) } } };
    const text = JSON.stringify({ version: 1, entries: [good, bad] });
    const kept: string[] = [];
    const phone = { ...file(text), aside: (t: string) => { kept.push(t); return Promise.resolve(); } };
    const api = server();
    const box = createOutbox(phone, api.sender);
    await box.start();
    await box.send();
    expect([...api.meals.keys()]).toEqual([A]);
    expect(kept).toEqual([text]);
  });

  it("a meal whose time is more than a day ahead of the phone's clock is still read; the server judges it", async () => {
    const ahead = { ...meal(A), body: { ...meal(A).body, takenAt: "2099-01-01T08:00:00.000Z" } };
    const box = createOutbox(file(JSON.stringify({ version: 1, entries: [{ kind: "save", meal: ahead }] })), server().sender);
    await box.start();
    expect(box.view().waiting.map((m) => m.id)).toEqual([A]);
  });

  it("past the most the file holds, a meal is refused at once and the others are kept", async () => {
    const api = server();
    api.online = false;
    const entries = Array.from({ length: MEAL_OUTBOX_MOST }, (_, i) => ({
      kind: "save",
      meal: meal(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`),
    }));
    const box = createOutbox(file(JSON.stringify({ version: 1, entries })), api.sender);
    await box.start();
    expect(await box.add(meal(A))).toBe(false);
    expect(box.view().waiting).toHaveLength(MEAL_OUTBOX_MOST);
  });

  it("a meal just saved stays shown as the server answered it, and one just removed stays hidden, until a read begun after holds them", async () => {
    const api = server();
    const answered = { id: A } as Meal;
    const sender: Sender = {
      save: async (m) => ((await api.sender.save(m)).kind === "done" ? { kind: "done", meal: answered } : { kind: "later" }),
      remove: api.sender.remove,
    };
    const box = createOutbox(file(), sender);
    await box.start();
    await box.add(meal(A));
    await box.send();
    expect(box.view().landed).toEqual([answered]);
    box.settle(0);
    expect(box.view().landed).toEqual([answered]);
    box.settle(box.view().sent);
    expect(box.view().landed).toEqual([]);

    await box.remove(A);
    await box.send();
    expect(box.view().removing.has(A)).toBe(true);
    box.settle(box.view().sent);
    expect(box.view().removing.has(A)).toBe(false);
  });

  it("a meal the server refused is still said after a restart, until OK is pressed", async () => {
    const phone = file();
    const api = server();
    api.refuse = "This meal couldn't be saved. Add it again.";
    const first = createOutbox(phone, api.sender);
    await first.start();
    await first.add(meal(A));
    await first.send();
    first.stop();
    const second = createOutbox(phone, api.sender);
    await second.start();
    expect(second.view().refused.map((r) => r.id)).toEqual([A]);
    second.forget(A);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const third = createOutbox(phone, api.sender);
    await third.start();
    expect(third.view().refused).toEqual([]);
  });
});
