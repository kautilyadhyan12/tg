import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { App } from "../../src/App";
import type { Ask, AskInit } from "../../src/session/calls";
import { RAVI, fakeServer, kept, memoryStore, profile, tokens, type Reply } from "../kit";

// Progress → Body → Log measurements (ROADMAP Stage 5 35c-ii), through the whole app. The worst thing
// on the phone's side: what a person typed kept as another number (pounds as kilograms), or an entry
// logged with no signal lost or saved twice.

const extra = { copyName: "Feature 2", apiUrl: "http://localhost:3000" };
const PATH = "/v1/nutrition/body-measurements";
const OLD = "76f3008b-7b75-4846-af4e-9e8278028445";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface Row { id: string; measuredAt: string; weightKg: number | null; metrics: Record<string, number>; source: "manual" | "self_reported"; createdAt: string }

/** The server: the person's list, a POST kept once for its id, a DELETE that removes. `online` false
 *  is no signal at all. */
function bodyServer(units: "metric" | "imperial" = "metric") {
  const user = { ...RAVI, units };
  const yesterday = new Date(Date.now() - 26 * 3_600_000).toISOString();
  const rows: Row[] = [{ id: OLD, measuredAt: yesterday, weightKg: 70.5, metrics: { waist_cm: 84 }, source: "manual", createdAt: yesterday }];
  const posts: unknown[] = [];
  const deletes: string[] = [];
  const state = { online: true, listDown: false, more: false };
  const server = fakeServer({
    "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }),
    "/v1/users/me": () => ({ status: 200, body: profile(true, user) }),
    [PATH]: (body): Reply => {
      if (body === undefined) return { status: 200, body: { items: [...rows].sort((a, b) => b.measuredAt.localeCompare(a.measuredAt)), nextCursor: state.more ? "older" : null } };
      posts.push(body);
      const b = body as { id: string; measuredAt: string; weightKg?: number; metrics: Record<string, number> };
      let row = rows.find((r) => r.id === b.id);
      if (row === undefined) {
        row = { id: b.id, measuredAt: b.measuredAt, weightKg: b.weightKg ?? null, metrics: b.metrics, source: "manual", createdAt: new Date().toISOString() };
        rows.push(row);
      }
      return { status: 201, body: { measurement: row } };
    },
  });
  const ask: Ask = async (url: string, init: AskInit) => {
    const path = new URL(url).pathname;
    if (path.startsWith(`${PATH}/`)) {
      if (!state.online) throw new Error("no signal");
      const id = path.slice(PATH.length + 1);
      deletes.push(id);
      const at = rows.findIndex((r) => r.id === id);
      if (at >= 0) rows.splice(at, 1);
      return { ok: true, status: 204, json: () => Promise.resolve(null) };
    }
    if (path === PATH && init.method === "POST" && !state.online) throw new Error("no signal");
    if (path === PATH && init.method !== "POST" && state.listDown) throw new Error("no signal");
    return server.ask(url, init);
  };
  // The phone's own file of waiting entries, this test's alone.
  let file: string | null = null;
  const bodyStore = () => ({
    read: () => Promise.resolve(file),
    write: (t: string) => {
      file = t;
      return Promise.resolve();
    },
  });
  return { ask, rows, posts, deletes, state, user, bodyStore };
}

async function openBody(s: ReturnType<typeof bodyServer>) {
  await render(<App extra={extra} store={memoryStore(kept(1, s.user))} ask={s.ask} bodyStore={s.bodyStore} />);
  await fireEvent.press(await screen.findByRole("tab", { name: "Me" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Progress" }));
  await fireEvent.press(await screen.findByRole("tab", { name: "Body" }));
  expect(await screen.findByText("Recent entries")).toBeTruthy();
}

const log = async (typed: Record<string, string>) => {
  await fireEvent.press(screen.getByRole("button", { name: "Log measurements" }));
  const box = await screen.findByTestId("sheet");
  for (const [label, value] of Object.entries(typed)) await fireEvent.changeText(within(box).getByLabelText(label), value);
  await fireEvent.press(within(box).getByRole("button", { name: "Save" }));
};

describe("Progress → Body → Log measurements", () => {
  it("the worst thing: 154 lb and a 32 in waist typed by a member in pounds are sent as 69.85 kg and 81.28 cm, once, under the phone's own id", async () => {
    const s = bodyServer("imperial");
    await openBody(s);
    await log({ "Weight · lb": "154", "Waist · in": "32" });
    expect(await screen.findByText("Measurements saved.")).toBeTruthy();
    await waitFor(() => {
      expect(s.posts).toHaveLength(1);
    });
    const sent = s.posts[0] as { id: string; weightKg: number; metrics: Record<string, number>; measuredAt: string };
    expect(sent.id).toMatch(UUID);
    expect(sent.weightKg).toBe(69.85);
    expect(sent.metrics).toEqual({ waist_cm: 81.28 });
    expect(Math.abs(Date.parse(sent.measuredAt) - Date.now())).toBeLessThan(60_000);
    // The new weight is the big one, in pounds, and the list holds it once.
    expect(await screen.findByLabelText(/^Weight 154 lb, /)).toBeTruthy();
    await waitFor(() => {
      expect(screen.getAllByLabelText(/, Logged, 154 lb, 1 measurement$/)).toHaveLength(1);
    });
  });

  it("logged with no signal it shows at once as Waiting to send, and is sent once when the signal is back", async () => {
    const s = bodyServer();
    s.state.online = false;
    await openBody(s);
    await log({ "Weight · kg": "69.4" });
    expect(await screen.findByText("Measurements saved.")).toBeTruthy();
    expect(await screen.findByLabelText(/, Waiting to send, 69\.4 kg$/)).toBeTruthy();
    expect(s.rows).toHaveLength(1);

    s.state.online = true;
    // The next thing logged sends what waited first, in the order made.
    await log({ "Weight · kg": "69.2" });
    await waitFor(() => {
      expect(s.rows).toHaveLength(3);
    });
    expect(s.rows.map((r) => r.weightKg)).toEqual([70.5, 69.4, 69.2]);
    await waitFor(() => {
      expect(screen.queryByLabelText(/Waiting to send/)).toBeNull();
    });
  });

  it("with the list not loaded, an entry waiting is shown and nothing is said of the history it cannot see", async () => {
    const s = bodyServer();
    s.state.online = false;
    s.state.listDown = true;
    await render(<App extra={extra} store={memoryStore(kept(1, s.user))} ask={s.ask} bodyStore={s.bodyStore} />);
    await fireEvent.press(await screen.findByRole("tab", { name: "Me" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Progress" }));
    await fireEvent.press(await screen.findByRole("tab", { name: "Body" }));
    expect(await screen.findByText("Your measurements couldn’t load.")).toBeTruthy();
    await log({ "Weight · kg": "69.4" });
    expect(await screen.findByLabelText(/, Waiting to send, 69.4 kg$/)).toBeTruthy();
    expect(screen.getByText("Your earlier measurements couldn’t load.")).toBeTruthy();
    // The person has an older entry the phone cannot see: no line, no change, no "first entry".
    expect(screen.queryByText(/your first entry|your last/)).toBeNull();
    expect(screen.queryByText(/ since /)).toBeNull();
  });

  it("offline with only a waist logged, it never says the member has no weight", async () => {
    const s = bodyServer();
    s.state.online = false;
    s.state.listDown = true;
    await render(<App extra={extra} store={memoryStore(kept(1, s.user))} ask={s.ask} bodyStore={s.bodyStore} />);
    await fireEvent.press(await screen.findByRole("tab", { name: "Me" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Progress" }));
    await fireEvent.press(await screen.findByRole("tab", { name: "Body" }));
    expect(await screen.findByText("Your measurements couldn’t load.")).toBeTruthy();
    await log({ "Waist · cm": "82" });
    expect(await screen.findByLabelText(/, Waiting to send, No weight, 1 measurement$/)).toBeTruthy();
    expect(screen.queryByText("No weight yet")).toBeNull();
  });

  it("a list longer than one read never calls an entry the first, nor says there is no weight", async () => {
    const s = bodyServer();
    s.state.more = true;
    s.rows.splice(0, 1, { ...(s.rows[0] ?? { id: OLD, measuredAt: new Date().toISOString(), source: "manual", createdAt: new Date().toISOString() }), weightKg: null, metrics: { waist_cm: 84 } });
    await openBody(s);
    expect(await screen.findByText("Waist · your newest entry")).toBeTruthy();
    expect(screen.queryByText(/your first entry/)).toBeNull();
    expect(screen.queryByText("No weight yet")).toBeNull();
  });

  it("a number that cannot be right is said under its box, and nothing typed says what to do; neither sends", async () => {
    const s = bodyServer();
    await openBody(s);
    await log({ "Weight · kg": "7" });
    expect(await screen.findByText("Enter a weight between 20 and 400 kg.")).toBeTruthy();
    const box = screen.getByTestId("sheet");
    await fireEvent.changeText(within(box).getByLabelText("Weight · kg"), "");
    await fireEvent.press(within(box).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter at least one measurement.")).toBeTruthy();
    expect(s.posts).toHaveLength(0);
    // Each box shows the person's last number.
    expect(within(box).getByLabelText("Waist · cm").props.placeholder).toBe("Last 84");
  });

  it("the chips pick a measurement, and its line says how it moved", async () => {
    const s = bodyServer();
    await openBody(s);
    await log({ "Weight · kg": "70", "Waist · cm": "82.5" });
    expect(await screen.findByText(/^▼ 0.5 kg since /)).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "Waist" }));
    expect(await screen.findByText(/^▼ 1\.5 cm since /)).toBeTruthy();
    expect(screen.getByText("Waist · your last 2 entries")).toBeTruthy();
  });

  it("Remove asks first, names the entry, and takes it off the list and the server", async () => {
    const s = bodyServer();
    await openBody(s);
    const [bin, ...others] = screen.getAllByRole("button", { name: /^Remove the entry of / });
    expect(others).toHaveLength(0);
    if (bin === undefined) throw new Error("no bin");
    await fireEvent.press(bin);
    const box = await screen.findByTestId("sheet");
    expect(within(box).getByText("Remove this entry?")).toBeTruthy();
    expect(within(box).getByText("Weight and 1 measurement")).toBeTruthy();
    await fireEvent.press(within(box).getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("Entry removed.")).toBeTruthy();
    await waitFor(() => {
      expect(s.deletes).toEqual([OLD]);
    });
    expect(await screen.findByText("No measurements yet")).toBeTruthy();
  });
});
