import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AppState, Linking } from "react-native";
import { App } from "../../src/App";
import { NO_ANSWER } from "../../src/screens/SignIn";
import { PUSH_SWITCHES } from "../../src/screens/Settings";
import type { Ask } from "../../src/session/calls";
import { fakeServer, kept, lost, memoryStore, profile, refusal, tokens, type Reply, type Route } from "../kit";

// Settings' notification switches (ROADMAP Stage 5 item 19d). The worst thing: a switch reads Off while
// the server still holds On, so the phone keeps sounding. Every switch shown is the server's answer.

const { notifications, reset } = jest.requireMock<{ notifications: { permission: unknown; afterAsk: unknown; asked: number; channelsOff: string[] }; reset: () => void }>("expo-notifications");
const YES = { granted: true, canAskAgain: true, status: "granted" };
const ASK = { granted: false, canAskAgain: true, status: "undetermined" };
const NO = { granted: false, canAskAgain: false, status: "denied" };

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000" };
const noWait = () => Promise.resolve();
const ok = (body: unknown) => (): Reply => ({ status: 200, body });
const ME = "/v1/users/me";

type Held = { pushGymMessages: boolean; pushPlaces: boolean; pushComments: boolean };
/** The server's own switches: only its answers change them. */
function account(start: Partial<Held> = {}) {
  const held: Held = { pushGymMessages: true, pushPlaces: true, pushComments: true, ...start };
  const me: Route = (body) => {
    if (body !== undefined) Object.assign(held, body);
    return { status: 200, body: { user: { ...profile(true).user, ...held } } };
  };
  return { held, me };
}

/** A place the person belongs to, of one kind. */
const place = (name: string, orgType: string, id: string) => ({
  id, name, orgType, city: null, clockFormat: "12h", slug: name.toLowerCase().replace(" ", "-"), timezone: "Asia/Kolkata",
  locale: "en", currencyDisplay: "INR", status: "active", staffRole: null, isMember: true, joinedAt: "2026-10-01T00:00:00.000Z",
});
const IRON = place("Iron House", "gym", "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f");
const LOTUS = place("Lotus Yoga", "yoga_studio", "2c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f");
const mine = (...orgs: object[]) => ok({ orgs, formerOrgs: [] });

const routes = (over: Record<string, Route> = {}): Record<string, Route> => ({
  "/v1/auth/refresh": ok({ tokens: tokens(2) }),
  "/v1/orgs/mine": mine(IRON),
  ...over,
});

async function openSettings(ask: Ask) {
  await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
  const tab = (await screen.findAllByRole("tab"))[4];
  if (tab === undefined) throw new Error("no fifth tab");
  await fireEvent.press(tab);
  await fireEvent.press(await screen.findByLabelText("Settings"));
}
/** The app coming back to the front, as Android says it. */
function listenForComeBack(): () => Promise<void> {
  const listeners: ((state: string) => void)[] = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
    listeners.push(handler as (state: string) => void);
    return { remove: () => undefined };
  });
  return async () => {
    await act(() => {
      for (const one of listeners) one("active");
    });
  };
}

const switchOf = (label: string) => screen.findByLabelText(`${label} notifications`);
const words = (key: keyof Held) => {
  const row = PUSH_SWITCHES.find((one) => one.key === key);
  if (row === undefined) throw new Error(`no switch ${key}`);
  return row;
};

beforeEach(() => {
  reset();
  notifications.permission = YES;
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("the notification switches show and save only the server's answer", () => {
  it("each switch reads what the server holds, and Off is said with what still comes", async () => {
    const acct = account({ pushPlaces: false });
    await openSettings(fakeServer(routes({ [ME]: acct.me })).ask);
    expect((await switchOf("Messages")).props.value).toBe(true);
    expect((await switchOf("Classes and events")).props.value).toBe(false);
    expect((await switchOf("Comments")).props.value).toBe(true);
    expect(screen.getByText(words("pushPlaces").off)).toBeTruthy();
    // One place: Messages names it.
    expect(screen.getByText("From Iron House.")).toBeTruthy();
  });

  it("switched off: the server is sent that switch alone, holds it, and the switch reads it", async () => {
    const acct = account();
    const server = fakeServer(routes({ [ME]: acct.me }));
    await openSettings(server.ask);
    await act(() => fireEvent(screen.getByLabelText("Comments notifications"), "valueChange", false));
    await waitFor(() => {
      expect(screen.getByLabelText("Comments notifications").props.value).toBe(false);
    });
    expect(server.asked.filter((a) => a.path === ME && a.method === "PATCH").map((a) => a.body)).toEqual([{ pushComments: false }]);
    expect(acct.held).toEqual({ pushGymMessages: true, pushPlaces: true, pushComments: false });
    expect(screen.getByText(words("pushComments").off)).toBeTruthy();
    // And on again.
    await act(() => fireEvent(screen.getByLabelText("Comments notifications"), "valueChange", true));
    await waitFor(() => {
      expect(screen.getByLabelText("Comments notifications").props.value).toBe(true);
    });
    expect(acct.held.pushComments).toBe(true);
  });

  it("a refused save keeps the switch on, as the server holds it, and says the server's words", async () => {
    const acct = account();
    let refuse = false;
    const me: Route = (body) => (refuse && body !== undefined ? refusal(429, "rate_limited", "Too many changes. Please try again later.") : acct.me(body));
    await openSettings(fakeServer(routes({ [ME]: me })).ask);
    await switchOf("Messages");
    refuse = true;
    await act(() => fireEvent(screen.getByLabelText("Messages notifications"), "valueChange", false));
    expect(await screen.findByText("Too many changes. Please try again later.")).toBeTruthy();
    expect(screen.getByLabelText("Messages notifications").props.value).toBe(true);
    expect(acct.held.pushGymMessages).toBe(true);
  });

  it("a lost save keeps the switch as it was and says so", async () => {
    const acct = account({ pushComments: false });
    let drop = false;
    const me: Route = (body) => (drop && body !== undefined ? lost() : acct.me(body));
    await openSettings(fakeServer(routes({ [ME]: me })).ask);
    await switchOf("Comments");
    drop = true;
    await act(() => fireEvent(screen.getByLabelText("Comments notifications"), "valueChange", true));
    expect(await screen.findByText(NO_ANSWER)).toBeTruthy();
    expect(screen.getByLabelText("Comments notifications").props.value).toBe(false);
  });

  it("not loaded: no switch to read wrongly, and Try again reads them", async () => {
    const acct = account({ pushGymMessages: false });
    let fail = true;
    const me: Route = (body) => (fail ? refusal(500, "internal", "Something went wrong.") : acct.me(body));
    await openSettings(fakeServer(routes({ [ME]: me })).ask);
    expect(await screen.findByText("Couldn’t load your notifications.")).toBeTruthy();
    expect(screen.queryByLabelText("Messages notifications")).toBeNull();
    fail = false;
    await fireEvent.press(screen.getByLabelText("Try notifications again"));
    expect((await switchOf("Messages")).props.value).toBe(false);
  });
});

describe("the words fit every kind of place", () => {
  it("a yoga studio's member reads Studio and the studio's name, never gym", async () => {
    await openSettings(fakeServer(routes({ [ME]: account().me, "/v1/orgs/mine": mine(LOTUS) })).ask);
    await switchOf("Messages");
    // The tab and the heading over the switches: one word for one thing.
    expect(screen.getAllByText("Studio")).toHaveLength(2);
    expect(screen.getByText("From Lotus Yoga.")).toBeTruthy();
    expect(screen.queryByText(/gym/i)).toBeNull();
  });

  it("places of two kinds read Places, and Messages comes from all of them", async () => {
    await openSettings(fakeServer(routes({ [ME]: account().me, "/v1/orgs/mine": mine(IRON, LOTUS) })).ask);
    await switchOf("Messages");
    expect(screen.getAllByText("Places").length).toBeGreaterThan(0);
    expect(screen.getByText(words("pushGymMessages").on)).toBeTruthy();
  });

  it("somebody who belongs to no place gets no place switches, and has Your training's reminders (19e-i)", async () => {
    await openSettings(fakeServer(routes({ [ME]: account().me, "/v1/orgs/mine": mine() })).ask);
    expect(await screen.findByText("Your training")).toBeTruthy();
    expect(screen.getByText("Notifications")).toBeTruthy();
    expect(screen.queryByLabelText("Messages notifications")).toBeNull();
    expect(screen.getByLabelText("Workout reminder")).toBeTruthy();
  });
});

describe("Android's own switch for the app", () => {
  it("allowed: no line about the phone", async () => {
    await openSettings(fakeServer(routes({ [ME]: account().me })).ask);
    await switchOf("Messages");
    expect(screen.queryByText("Notifications are off on this phone.")).toBeNull();
  });

  it("turned off in the phone's settings: says so, and opens the phone's settings", async () => {
    notifications.permission = NO;
    const opened = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
    // React Native's own stand-in keeps every earlier test's calls.
    opened.mockClear();
    await openSettings(fakeServer(routes({ [ME]: account().me })).ask);
    expect(await screen.findByText("Notifications are off on this phone.")).toBeTruthy();
    await fireEvent.press(screen.getByText("Open phone settings"));
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("never asked: Turn on asks Android, and once allowed the server is given this phone's address", async () => {
    notifications.permission = ASK;
    notifications.afterAsk = YES;
    const server = fakeServer(routes({ [ME]: account().me, "/v1/push-tokens": ok({ saved: true }) }));
    await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} />);
    // The tabs' own reason first; "Not now" leaves it for Settings.
    await fireEvent.press(await screen.findByText("Not now"));
    const tab = (await screen.findAllByRole("tab"))[4];
    if (tab === undefined) throw new Error("no fifth tab");
    await fireEvent.press(tab);
    await fireEvent.press(await screen.findByLabelText("Settings"));
    expect(await screen.findByText("Notifications are off on this phone.")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Turn on notifications"));
    await waitFor(() => {
      expect(screen.queryByText("Notifications are off on this phone.")).toBeNull();
    });
    expect(notifications.asked).toBe(1);
    expect(server.asked.filter((a) => a.path === "/v1/push-tokens").map((a) => a.method)).toEqual(["PUT"]);
  });
});

describe("round one's findings", () => {
  it("another phone changed it meanwhile: the switch reads the server's answer, not the press (T3)", async () => {
    const acct = account();
    const me: Route = (body) => {
      if (body === undefined) return acct.me(undefined);
      // Another phone switched Comments on again just after this press: the server holds On.
      acct.held.pushComments = true;
      return { status: 200, body: { user: { ...profile(true).user, ...acct.held } } };
    };
    await openSettings(fakeServer(routes({ [ME]: me })).ask);
    await switchOf("Comments");
    await act(() => fireEvent(screen.getByLabelText("Comments notifications"), "valueChange", false));
    await waitFor(() => {
      expect(screen.getByLabelText("Comments notifications").props.value).toBe(true);
    });
  });

  it("a read begun during a save and answered after it never puts the old value back (L2)", async () => {
    const comeBack = listenForComeBack();
    const acct = account();
    const server = fakeServer(routes({ [ME]: acct.me }));
    const held: { patch: (() => void) | null; read: (() => void) | null } = { patch: null, read: null };
    let hold = false;
    const ask: Ask = (url, init) => {
      if (!hold || new URL(url).pathname !== ME) return server.ask(url, init);
      if (init.method === "PATCH") {
        // Reaches the server only when let go.
        return new Promise((done) => {
          held.patch = () => void server.ask(url, init).then(done);
        });
      }
      // The server answers now (still On); the answer reaches the phone only when let go.
      const answer = server.ask(url, init);
      return new Promise((done) => {
        held.read = () => void answer.then(done);
      });
    };
    await openSettings(ask);
    await switchOf("Comments");
    hold = true;
    await act(() => fireEvent(screen.getByLabelText("Comments notifications"), "valueChange", false));
    await comeBack();
    await act(async () => {
      held.patch?.();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByLabelText("Comments notifications").props.value).toBe(false);
    });
    await act(async () => {
      held.read?.();
      await Promise.resolve();
    });
    // Let anything the late read would do happen.
    await act(() => new Promise((done) => setTimeout(done, 50)));
    expect(screen.getByLabelText("Comments notifications").props.value).toBe(false);
    expect(acct.held.pushComments).toBe(false);
  });

  it("one kind turned off in the phone's own settings: that row says so and opens them (L1)", async () => {
    notifications.channelsOff = ["gym-comments"];
    const opened = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
    // React Native's own stand-in keeps every earlier test's calls.
    opened.mockClear();
    await openSettings(fakeServer(routes({ [ME]: account().me })).ask);
    expect(await screen.findByText("Off on this phone.")).toBeTruthy();
    expect(screen.getAllByText("Off on this phone.")).toHaveLength(1);
    await fireEvent.press(screen.getByLabelText("Open phone settings for Comments"));
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("back from the phone's settings with notifications turned on: the line goes and the phone's address is given (T2)", async () => {
    const comeBack = listenForComeBack();
    notifications.permission = NO;
    const server = fakeServer(routes({ [ME]: account().me, "/v1/push-tokens": ok({ saved: true }) }));
    await openSettings(server.ask);
    expect(await screen.findByText("Notifications are off on this phone.")).toBeTruthy();
    notifications.permission = YES;
    await comeBack();
    await waitFor(() => {
      expect(screen.queryByText("Notifications are off on this phone.")).toBeNull();
    });
    expect(server.asked.filter((a) => a.path === "/v1/push-tokens").map((a) => a.method)).toEqual(["PUT"]);
  });
});
