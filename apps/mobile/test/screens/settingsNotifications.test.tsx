import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";
import { App } from "../../src/App";
import { NO_ANSWER } from "../../src/screens/SignIn";
import { PUSH_SWITCHES } from "../../src/screens/Settings";
import type { Ask } from "../../src/session/calls";
import { fakeServer, kept, lost, memoryStore, profile, refusal, tokens, type Reply, type Route } from "../kit";

// Settings' notification switches (ROADMAP Stage 5 item 19d). The worst thing: a switch reads Off while
// the server still holds On, so the phone keeps sounding. Every switch shown is the server's answer.

const { notifications, reset } = jest.requireMock<{ notifications: { permission: unknown; afterAsk: unknown; asked: number }; reset: () => void }>("expo-notifications");
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

const routes = (over: Record<string, Route> = {}): Record<string, Route> => ({
  "/v1/auth/refresh": ok({ tokens: tokens(2) }),
  "/v1/orgs/mine": ok({ orgs: [], formerOrgs: [] }),
  ...over,
});

async function openSettings(ask: Ask) {
  await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
  const tab = (await screen.findAllByRole("tab"))[4];
  if (tab === undefined) throw new Error("no fifth tab");
  await fireEvent.press(tab);
  await fireEvent.press(await screen.findByLabelText("Settings"));
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
    expect((await switchOf("Gym messages")).props.value).toBe(true);
    expect((await switchOf("Classes and events")).props.value).toBe(false);
    expect((await switchOf("Comments")).props.value).toBe(true);
    expect(screen.getByText(words("pushPlaces").off)).toBeTruthy();
    expect(screen.getByText(words("pushGymMessages").on)).toBeTruthy();
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
    await switchOf("Gym messages");
    refuse = true;
    await act(() => fireEvent(screen.getByLabelText("Gym messages notifications"), "valueChange", false));
    expect(await screen.findByText("Too many changes. Please try again later.")).toBeTruthy();
    expect(screen.getByLabelText("Gym messages notifications").props.value).toBe(true);
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
    expect(screen.queryByLabelText("Gym messages notifications")).toBeNull();
    fail = false;
    await fireEvent.press(screen.getByLabelText("Try notifications again"));
    expect((await switchOf("Gym messages")).props.value).toBe(false);
  });
});

describe("Android's own switch for the app", () => {
  it("allowed: no line about the phone", async () => {
    await openSettings(fakeServer(routes({ [ME]: account().me })).ask);
    await switchOf("Gym messages");
    expect(screen.queryByText("Notifications are off on this phone.")).toBeNull();
  });

  it("turned off in the phone's settings: says so, and opens the phone's settings", async () => {
    notifications.permission = NO;
    const opened = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
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
