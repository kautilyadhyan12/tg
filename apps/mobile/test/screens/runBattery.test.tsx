import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AppState, Linking } from "react-native";
import { App } from "../../src/App";
import { BATTERY_LIMIT_TITLE, BATTERY_LIMIT_WORDS } from "../../src/screens/running/BatteryLimit";
import { phoneRunFiles, resetRecorder } from "../../src/screens/running/recorder";
import { RAVI, fakeServer, kept, memoryStore, profile, tokens } from "../kit";

// A run keeps recording with the screen off (ROADMAP Stage 5 item 37l). Measured on Kd's phone, 2026-11-24: with this
// app set to Restricted in the phone's battery settings, Android takes the run's service off foreground seconds after
// Start and the run stops recording when the screen turns off; set free, the same build recorded every second of
// 8 minutes with the screen off. The app cannot lift the limit. Its Running page says so, before Start, with the
// button to the phone's page for it.

const extra = { copyName: "Feature 2", apiUrl: "http://localhost:3000" };

interface Battery {
  restricted: boolean;
  opened: boolean;
  missing: boolean;
  fails: boolean;
  opens: number;
  reset: () => void;
}
const battery = jest.requireMock<{ battery: Battery }>("../../src/screens/running/runBatteryNative").battery;
const location = jest.requireMock<{ state: Record<string, unknown> }>("expo-location").state;

let handlers: ((state: "active") => void)[] = [];
const comeBack = () => {
  for (const handler of handlers) handler("active");
};

beforeEach(async () => {
  handlers = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
    handlers.push(handler);
    return { remove: () => undefined };
  });
  Object.assign(location, { services: true, granted: true, canAskAgain: true, accuracy: "fine", asked: 0, started: [], running: false, acceptsTurnOn: true });
  for (const name of ["run-now.json", "run-now-0.json", "run-settings.json", "run-map.json"]) phoneRunFiles.remove(name);
  battery.reset();
  resetRecorder();
  await Promise.resolve();
});

afterEach(() => {
  jest.restoreAllMocks();
});

function runServer() {
  return fakeServer({
    "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }),
    "/v1/geo/map": () => ({ status: 503, body: { error: "unavailable" } }),
    "/v1/geo/runs/records": () => ({ status: 503, body: { error: "unavailable" } }),
    "/v1/geo/runs/climb": () => ({ status: 200, body: { climb: { state: "none" } } }),
    "/v1/users/me": () => ({ status: 200, body: profile(true, RAVI) }),
    "/v1/geo/heart-max": () => ({ status: 200, body: { own: null, fromAge: null, max: null } }),
    "/v1/geo/runs": () => ({ status: 200, body: { items: [], nextCursor: null, months: [], total: { runs: 0, distanceM: 0 } } }),
  });
}

async function openRunning(s: ReturnType<typeof runServer>) {
  await render(<App extra={extra} store={memoryStore(kept(1, RAVI))} ask={s.ask} />);
  await fireEvent.press(await screen.findByRole("tab", { name: "Workout" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Running" }));
  expect(await screen.findByRole("button", { name: "Start run" })).toBeTruthy();
}

describe("the worst thing: a runner starts a run that stops with the screen and is never told why", () => {
  it("a phone that limits the app says so on the page with START, with the button to its battery page", async () => {
    battery.restricted = true;
    await openRunning(runServer());
    expect(await screen.findByText(BATTERY_LIMIT_TITLE)).toBeTruthy();
    expect(screen.getByText(BATTERY_LIMIT_WORDS)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Open this app's battery settings" }));
    expect(battery.opens).toBe(1);
  });

  // What Android can answer, and what the page must do with each: a phone that does not limit the app is never
  // told it does (a warning that is false is worse than none), and one that cannot answer says nothing.
  it.each([
    { name: "limited", set: { restricted: true }, shown: true },
    { name: "not limited", set: { restricted: false }, shown: false },
    { name: "no such code on the phone (an iPhone, a copy built before it)", set: { missing: true, restricted: true }, shown: false },
    { name: "the phone's answer fails", set: { fails: true, restricted: true }, shown: false },
  ])("$name: warning shown is $shown", async ({ set, shown }) => {
    Object.assign(battery, set);
    await openRunning(runServer());
    await waitFor(() => {
      expect(screen.queryByText(BATTERY_LIMIT_TITLE) !== null).toBe(shown);
    });
    expect(screen.queryByText(BATTERY_LIMIT_WORDS) !== null).toBe(shown);
  });
});

describe("what the person does about it", () => {
  it("Start is still there and works while the limit is on: nothing is taken away", async () => {
    battery.restricted = true;
    await openRunning(runServer());
    await screen.findByText(BATTERY_LIMIT_TITLE);
    await fireEvent.press(screen.getByRole("button", { name: "Start run" }));
    expect(await screen.findByRole("button", { name: "Start now" })).toBeTruthy();
  });

  it("the button opens the app's own settings where the battery page cannot be opened", async () => {
    battery.restricted = true;
    battery.opened = false;
    const settings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
    settings.mockClear();
    await openRunning(runServer());
    await fireEvent.press(await screen.findByRole("button", { name: "Open this app's battery settings" }));
    expect(battery.opens).toBe(1);
    expect(settings).toHaveBeenCalledTimes(1);
  });

  it("the button opens the app's own settings when the phone's code throws", async () => {
    battery.restricted = true;
    await openRunning(runServer());
    await screen.findByText(BATTERY_LIMIT_TITLE);
    battery.fails = true;
    const settings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
    settings.mockClear();
    await fireEvent.press(screen.getByRole("button", { name: "Open this app's battery settings" }));
    expect(settings).toHaveBeenCalledTimes(1);
  });

  it("the line goes when the person comes back from the phone's settings with the limit off, and comes back if it is put on again", async () => {
    battery.restricted = true;
    await openRunning(runServer());
    await screen.findByText(BATTERY_LIMIT_TITLE);
    battery.restricted = false;
    await act(() => {
      comeBack();
    });
    await waitFor(() => {
      expect(screen.queryByText(BATTERY_LIMIT_TITLE)).toBeNull();
    });
    // This phone puts the limit back when the app starts afresh: the next look says so again.
    battery.restricted = true;
    await act(() => {
      comeBack();
    });
    expect(await screen.findByText(BATTERY_LIMIT_TITLE)).toBeTruthy();
  });
});
