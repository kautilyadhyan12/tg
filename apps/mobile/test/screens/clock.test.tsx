import { act, render, screen } from "@testing-library/react-native";
import { Clock } from "../../src/screens/dashboard/Clock";

describe("the Daily Motivation clock", () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date(2026, 9, 27, 10, 20, 11, 400) });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("shows the time with its seconds and the date, and turns over on each whole second", async () => {
    await render(<Clock />);
    expect(screen.getByText("10:20:11")).toBeTruthy();
    expect(screen.getByText("am")).toBeTruthy();
    expect(screen.getByText("Tue, 27 Oct 2026")).toBeTruthy();
    expect(screen.getByLabelText("10:20:11 am, Tue, 27 Oct 2026")).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(599);
      await Promise.resolve();
    });
    expect(screen.getByText("10:20:11")).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(screen.getByText("10:20:12")).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(48 * 1000);
      await Promise.resolve();
    });
    expect(screen.getByText("10:21:00")).toBeTruthy();
  });

  it("does not tick while the Dashboard is hidden, and shows the right time when it is back", async () => {
    const set = jest.spyOn(globalThis, "setTimeout");
    const ticks = () => set.mock.calls.filter(([run]) => run.name === "tick").length;
    const view = await render(<Clock running={false} />);
    await act(async () => {
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(ticks()).toBe(0);
    await view.rerender(<Clock running />);
    expect(screen.getByText("10:20:16")).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(ticks()).toBeGreaterThan(0);
  });

  it("stops when it leaves the screen", async () => {
    const set = jest.spyOn(globalThis, "setTimeout");
    const ticks = () => set.mock.calls.filter(([run]) => run.name === "tick").length;
    const { unmount } = await render(<Clock />);
    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(ticks()).toBeGreaterThan(1);
    await unmount();
    set.mockClear();
    await act(async () => {
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(ticks()).toBe(0);
  });
});
