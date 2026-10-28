import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { App } from "../../src/App";
import { NOTE_CHECK_WAIT_MS, NOTE_VERSION, NOTE_WORDS } from "../../src/screens/BeforeYouStart";
import { RAVI, fakeServer, kept, lost, memoryStore, never, profile, refusal, tokens, type Route } from "../kit";

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000" };
const noWait = () => Promise.resolve();

const refreshed: Route = () => ({ status: 200, body: { tokens: tokens(2) } });
const notTicked: Route = () => ({ status: 200, body: profile(false) });
const ticked: Route = () => ({ status: 200, body: profile(true) });
const keptTick: Route = (body) => ({
  status: 201,
  body: {
    consent: {
      id: "5d1f0c3e-9a2b-4c7d-8e6f-0a1b2c3d4e5f",
      purpose: "sign_up",
      wordingVersion: NOTE_VERSION,
      wording: NOTE_WORDS,
      appVersion: typeof body === "object" && body !== null && "appVersion" in body ? String(body.appVersion) : "",
      recordedAt: "2026-10-14T09:00:00.000Z",
    },
  },
});

/** The app as a phone opens it, signed in as Ravi; `note`: the tick the phone kept, if any. */
async function openApp(routes: Record<string, Route>, note: string | null = null) {
  const server = fakeServer({ "/v1/auth/refresh": refreshed, ...routes });
  const store = memoryStore(kept(1, RAVI, note));
  await render(<App extra={extra} ask={server.ask} store={store} wait={noWait} />);
  return { server, store };
}

const tick = () => fireEvent.press(screen.getByRole("checkbox", { name: "I have read and understood this" }));
const press = (button: string) => fireEvent.press(screen.getByRole("button", { name: button }));
const noTabs = () => {
  expect(screen.queryAllByRole("tab")).toHaveLength(0);
};

describe("the worst thing: nobody reaches the app without the note, and nobody who ticked it is stopped", () => {
  it("a person who has not ticked it sees the note and no tab, and Continue does nothing", async () => {
    await openApp({ "/v1/users/me": notTicked });
    expect(await screen.findByRole("header", { name: "Before you start" })).toBeTruthy();
    expect(screen.getByText(NOTE_WORDS)).toBeTruthy();
    noTabs();
    expect(screen.getByRole("button", { name: "Continue" }).props.accessibilityState).toMatchObject({ disabled: true });
    await press("Continue");
    noTabs();
    expect(screen.getByRole("header", { name: "Before you start" })).toBeTruthy();
  });

  it("with no internet, a person whose tick the phone never kept sees the note, never the tabs", async () => {
    await openApp({ "/health": lost, "/v1/auth/refresh": lost, "/v1/users/me": lost });
    expect(await screen.findByText("Can’t connect. Check your internet and try again.")).toBeTruthy();
    noTabs();
    // The tick needs the server too: with no answer the person is still on the note.
    await tick();
    await waitFor(() => {
      expect(screen.getByRole("checkbox").props.accessibilityState).toMatchObject({ checked: false, busy: false });
    });
    expect(screen.getByText("Can’t connect. Check your internet and try again.")).toBeTruthy();
    await press("Continue");
    noTabs();
  });

  it.each([
    ["a server error", (): ReturnType<Route> => refusal(500, "internal", "Something went wrong.")],
    ["a reply that is not a profile", (): ReturnType<Route> => ({ status: 200, body: { user: { id: RAVI.id } } })],
    ["no reply at all", never],
  ])("%s on the check is never read as a tick", async (_, route) => {
    await openApp({ "/v1/users/me": route });
    expect(await screen.findByRole("header", { name: "Before you start" }, { timeout: 6_000 })).toBeTruthy();
    noTabs();
  });

  it("with no internet, a person whose tick the phone kept opens on their tabs and asks nothing", async () => {
    const { server } = await openApp(
      { "/health": lost, "/v1/auth/refresh": lost, "/v1/users/me": notTicked },
      NOTE_VERSION,
    );
    expect(await screen.findByRole("tab", { name: "Dashboard" })).toBeTruthy();
    expect(screen.queryByText("Before you start")).toBeNull();
    expect(server.paths()).not.toContain("/v1/users/me");
  });

  it("a tick the phone kept on older words is not enough: the server is asked, and the note shown", async () => {
    const { server } = await openApp({ "/v1/users/me": notTicked }, "v3");
    expect(await screen.findByRole("header", { name: "Before you start" })).toBeTruthy();
    expect(server.paths()).toContain("/v1/users/me");
    noTabs();
  });
});

describe("ticking it", () => {
  it("keeps the tick on the server, then Continue opens the tabs and the phone remembers it", async () => {
    const { server, store } = await openApp({ "/v1/users/me": notTicked, "/v1/users/me/consents": keptTick });
    await screen.findByRole("header", { name: "Before you start" });
    expect(screen.getByText("Tick this to continue.")).toBeTruthy();
    await tick();
    await waitFor(() => {
      expect(screen.getByRole("checkbox").props.accessibilityState).toMatchObject({ checked: true });
    });
    expect(screen.queryByText("Tick this to continue.")).toBeNull();
    const sent = server.asked.find((one) => one.path === "/v1/users/me/consents");
    expect(JSON.stringify(sent?.body)).toMatch(
      new RegExp(`^\{"purpose":"sign_up","wordingVersion":"${NOTE_VERSION}","appVersion":"phone [^"]+"\}$`),
    );
    expect(sent?.headers.authorization).toBe("Bearer access-2");
    // Not kept on the phone until the person goes on.
    expect(store.value).toBe(kept(2, RAVI, null));
    await press("Continue");
    expect(await screen.findByRole("tab", { name: "Dashboard" })).toBeTruthy();
    // Setup's finish, the server's word, is kept beside it (test/screens/setupGate.test.tsx).
    expect(JSON.parse(store.value ?? "")).toEqual(JSON.parse(kept(2, RAVI, NOTE_VERSION)));
  });

  it("a tick the server refuses says why, and the person stays on the note", async () => {
    await openApp({
      "/v1/users/me": notTicked,
      "/v1/users/me/consents": () => refusal(429, "rate_limited", "Too many requests. Please wait a moment."),
    });
    await screen.findByRole("header", { name: "Before you start" });
    await tick();
    expect(await screen.findByText("Too many requests. Please wait a moment.")).toBeTruthy();
    expect(screen.getByRole("checkbox").props.accessibilityState).toMatchObject({ checked: false });
    noTabs();
  });

  it("a person who ticked it in the browser goes straight to the tabs, and the phone remembers it", async () => {
    const { store } = await openApp({ "/v1/users/me": ticked });
    expect(await screen.findByRole("tab", { name: "Dashboard" })).toBeTruthy();
    expect(screen.queryByText("Before you start")).toBeNull();
    await waitFor(() => {
      expect(JSON.parse(store.value ?? "")).toEqual(JSON.parse(kept(2, RAVI, NOTE_VERSION)));
    });
  });

  it("an answer that comes after the note is shown still counts", async () => {
    const late: Route = () =>
      new Promise((resolve) => {
        setTimeout(() => {
          resolve({ status: 200, body: profile(true) });
        }, NOTE_CHECK_WAIT_MS + 1_000);
      });
    await openApp({ "/v1/users/me": late });
    expect(await screen.findByRole("header", { name: "Before you start" }, { timeout: 6_000 })).toBeTruthy();
    expect(await screen.findByRole("tab", { name: "Dashboard" }, { timeout: 6_000 })).toBeTruthy();
  });

  it("a token that ran out is refreshed once and the check sent again", async () => {
    let checks = 0;
    let refreshes = 0;
    const { server } = await openApp({
      "/v1/auth/refresh": () => {
        refreshes += 1;
        return { status: 200, body: { tokens: tokens(refreshes + 1) } };
      },
      "/v1/users/me": () => {
        checks += 1;
        return checks === 1 ? refusal(401, "unauthorized", "Sign in again.") : { status: 200, body: profile(true) };
      },
    });
    expect(await screen.findByRole("tab", { name: "Dashboard" })).toBeTruthy();
    const asks = server.asked.filter((one) => one.path === "/v1/users/me").map((one) => one.headers.authorization);
    // Sent again with the new token, never the one the server refused; the time zone's own read of
    // the profile comes after, with the new one too.
    expect(asks.slice(0, 2)).toEqual(["Bearer access-2", "Bearer access-3"]);
    expect(asks.slice(2).filter((token) => token !== "Bearer access-3")).toEqual([]);
    expect(server.paths().filter((path) => path === "/v1/auth/refresh")).toHaveLength(2);
  });
});

describe("Sign out on the note", () => {
  it("waits while Continue is keeping the tick on the phone", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": refreshed,
      "/v1/users/me": notTicked,
      "/v1/users/me/consents": keptTick,
    });
    const store = memoryStore(kept(1, RAVI, null));
    const write = store.write;
    let finishWrite: () => void = () => undefined;
    store.write = (next: string) =>
      next.includes('"signUpNote"')
        ? new Promise<void>((resolve) => {
            finishWrite = () => {
              void write(next).then(resolve);
            };
          })
        : write(next);
    await render(<App extra={extra} ask={server.ask} store={store} wait={noWait} />);
    await screen.findByRole("header", { name: "Before you start" });
    await tick();
    await waitFor(() => {
      expect(screen.getByRole("checkbox").props.accessibilityState).toMatchObject({ checked: true });
    });
    await press("Continue");
    expect(screen.getByRole("button", { name: "Sign out" }).props.accessibilityState).toMatchObject({ disabled: true });
    finishWrite();
    expect(await screen.findByRole("tab", { name: "Dashboard" })).toBeTruthy();
  });

  it("goes back to Get started and the phone keeps nobody", async () => {
    const { store } = await openApp({ "/v1/users/me": notTicked, "/v1/auth/logout": lost });
    await screen.findByRole("header", { name: "Before you start" });
    await press("Sign out");
    expect(await screen.findByText("Get started.")).toBeTruthy();
    expect(store.value).toBeNull();
    noTabs();
  });
});
