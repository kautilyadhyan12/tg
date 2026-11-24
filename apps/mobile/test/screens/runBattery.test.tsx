import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AppState, Linking } from "react-native";
import { App } from "../../src/App";
import { BATTERY_ON_WORDS } from "../../src/screens/running/BatteryLimit";
import { phoneRunFiles, resetRecorder, runNow } from "../../src/screens/running/recorder";
import { START_PROBLEM_WORDS } from "../../src/screens/running/RunLayer";
import { RAVI, fakeServer, kept, memoryStore, profile, tokens } from "../kit";

// A run keeps recording with the screen off (ROADMAP Stage 5 item 37l). Measured on Kd's phone, 2026-11-24: with this
// app set to Restricted in the phone's battery settings, Android takes the run's service off foreground seconds after
// Start and the run stops recording when the screen turns off; set free, the same build recorded every second of
// 8 minutes with the screen off. The app cannot lift the limit. Start says so, only on a phone that limits the app
// (Kd: "only when it does not allow ... only there it should appear"), after the location, with the button to the
// phone's page for it and Start anyway.

const extra = { copyName: "Feature 2", apiUrl: "http://localhost:3000" };
const WORDS = START_PROBLEM_WORDS.battery;

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
  // A listener the page lets go of is never heard again, as on the phone.
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
    handlers.push(handler);
    return {
      remove: () => {
        handlers = handlers.filter((h) => h !== handler);
      },
    };
  });
  Object.assign(location, { services: true, granted: true, canAskAgain: true, accuracy: "fine", asked: 0, started: [], running: false, acceptsTurnOn: true, refusesStart: false });
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

async function pressStart() {
  await fireEvent.press(screen.getByRole("button", { name: "Start run" }));
}

describe("the worst thing: a runner starts a run that stops with the screen and is never told why", () => {
  it("on a phone that limits the app, Start says so before 3, 2, 1, with the button to its battery page", async () => {
    battery.restricted = true;
    const settings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
    await openRunning(runServer());
    await pressStart();
    expect(await screen.findByText(WORDS)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start now" })).toBeNull();
    settings.mockClear();
    await fireEvent.press(screen.getByRole("button", { name: "Open this app's battery settings" }));
    expect(battery.opens).toBe(1);
    // The battery page alone: App info is not opened on top of it.
    expect(settings).not.toHaveBeenCalled();
  });

  // What Android can answer, and what Start must do with each: a phone that does not limit the app is never asked
  // (most phones; a warning that is false is worse than none), and one that cannot answer goes straight to 3, 2, 1.
  it.each([
    { name: "limited", set: { restricted: true }, asked: true },
    { name: "not limited", set: { restricted: false }, asked: false },
    { name: "no such code on the phone (an iPhone, a copy built before it)", set: { missing: true, restricted: true }, asked: false },
    { name: "the phone's answer fails", set: { fails: true, restricted: true }, asked: false },
  ])("$name: the box is shown is $asked", async ({ set, asked }) => {
    Object.assign(battery, set);
    await openRunning(runServer());
    await pressStart();
    if (asked) {
      expect(await screen.findByText(WORDS)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Start now" })).toBeNull();
    } else {
      expect(await screen.findByRole("button", { name: "Start now" })).toBeTruthy();
      expect(screen.queryByText(WORDS)).toBeNull();
    }
  });

  it("the location is asked first: with the phone's location off, that is said, not the battery", async () => {
    battery.restricted = true;
    location.services = false;
    await openRunning(runServer());
    await pressStart();
    expect(await screen.findByText(START_PROBLEM_WORDS.off)).toBeTruthy();
    expect(screen.queryByText(WORDS)).toBeNull();
  });
});

describe("what the runner does about it", () => {
  it("Start anyway counts down and the run records, as it is: nothing is held back", async () => {
    battery.restricted = true;
    await openRunning(runServer());
    await pressStart();
    await fireEvent.press(await screen.findByRole("button", { name: "Start anyway" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Start now" }));
    await waitFor(() => {
      expect(runNow()?.phase).toBe("running");
    });
  });

  it("back from the phone's settings with the battery setting changed, the box says so and Start goes straight on", async () => {
    battery.restricted = true;
    await openRunning(runServer());
    await pressStart();
    await screen.findByText(WORDS);
    battery.restricted = false;
    await act(() => {
      comeBack();
    });
    expect(await screen.findByText(BATTERY_ON_WORDS)).toBeTruthy();
    expect(screen.queryByText(WORDS)).toBeNull();
    await pressStart();
    expect(await screen.findByRole("button", { name: "Start now" })).toBeTruthy();
    expect(screen.queryByText(BATTERY_ON_WORDS)).toBeNull();
  });

  it("back from the phone's settings still limited, the box stays", async () => {
    battery.restricted = true;
    await openRunning(runServer());
    await pressStart();
    await screen.findByText(WORDS);
    await act(() => {
      comeBack();
    });
    expect(screen.getByText(WORDS)).toBeTruthy();
    expect(screen.queryByText(BATTERY_ON_WORDS)).toBeNull();
  });

  it("the phone puts the limit back (Kd's does at each fresh start): the next Start asks again, never trusting the last answer", async () => {
    battery.restricted = true;
    await openRunning(runServer());
    await pressStart();
    await screen.findByText(WORDS);
    battery.restricted = false;
    await act(() => {
      comeBack();
    });
    await screen.findByText(BATTERY_ON_WORDS);
    battery.restricted = true;
    await pressStart();
    expect(await screen.findByText(WORDS)).toBeTruthy();
    expect(screen.queryByText(BATTERY_ON_WORDS)).toBeNull();
    expect(screen.queryByRole("button", { name: "Start now" })).toBeNull();
  });

  // Coming back to the app is heard only while the battery box is shown: anything else said under Start stays, and
  // nobody is told a setting changed that they never touched.
  it.each([
    { name: "nothing under Start", set: { restricted: false }, services: true, words: null },
    { name: "the location box", set: { restricted: true }, services: false, words: START_PROBLEM_WORDS.off },
  ])("back in the app with $name, nothing is said of the battery", async ({ set, services, words }) => {
    Object.assign(battery, set);
    location.services = services;
    await openRunning(runServer());
    if (words !== null) {
      await pressStart();
      await screen.findByText(words);
    }
    battery.restricted = false;
    await act(() => {
      comeBack();
    });
    expect(screen.queryByText(BATTERY_ON_WORDS)).toBeNull();
    if (words !== null) expect(screen.getByText(words)).toBeTruthy();
  });

  it("once Start anyway is pressed, coming back to the app says nothing of the battery", async () => {
    battery.restricted = true;
    await openRunning(runServer());
    await pressStart();
    await fireEvent.press(await screen.findByRole("button", { name: "Start anyway" }));
    await screen.findByRole("button", { name: "Start now" });
    battery.restricted = false;
    await act(() => {
      comeBack();
    });
    expect(screen.queryByText(BATTERY_ON_WORDS)).toBeNull();
  });

  it("the line that the setting changed is gone once the Running page is left", async () => {
    battery.restricted = true;
    await openRunning(runServer());
    await pressStart();
    await screen.findByText(WORDS);
    battery.restricted = false;
    await act(() => {
      comeBack();
    });
    await screen.findByText(BATTERY_ON_WORDS);
    await fireEvent.press(screen.getByRole("tab", { name: "Dashboard" }));
    await fireEvent.press(await screen.findByRole("tab", { name: "Workout" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Running" }));
    expect(await screen.findByRole("button", { name: "Start run" })).toBeTruthy();
    expect(screen.queryByText(BATTERY_ON_WORDS)).toBeNull();
  });

  it("the button opens the app's own settings where the battery page cannot be opened", async () => {
    battery.restricted = true;
    battery.opened = false;
    const settings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
    settings.mockClear();
    await openRunning(runServer());
    await pressStart();
    await fireEvent.press(await screen.findByRole("button", { name: "Open this app's battery settings" }));
    expect(battery.opens).toBe(1);
    expect(settings).toHaveBeenCalledTimes(1);
  });

  it("the button opens the app's own settings when the phone's code throws", async () => {
    battery.restricted = true;
    await openRunning(runServer());
    await pressStart();
    await screen.findByText(WORDS);
    battery.fails = true;
    const settings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
    settings.mockClear();
    await fireEvent.press(screen.getByRole("button", { name: "Open this app's battery settings" }));
    expect(settings).toHaveBeenCalledTimes(1);
  });
});
