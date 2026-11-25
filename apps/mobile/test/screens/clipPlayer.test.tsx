// The clip player itself (ROADMAP Stage 5 62b, round one T2 and T3). The screen tests stand in for the whole player; these
// run its own code with expo-video stood in for: how it is set up (muted and mixing, so the person's music plays on; never
// keeping the screen on), playing and pausing as it is told, starting again when the app comes back, and the guard that
// a copy of the app built before expo-video shows the picture instead of failing.
import { act, render } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";

type Recorded = {
  loop?: boolean;
  muted?: boolean;
  audioMixingMode?: string;
  keepScreenOnWhilePlaying?: boolean;
  staysActiveInBackground?: boolean;
  showNowPlayingNotification?: boolean;
  calls: string[];
  play: () => void;
  pause: () => void;
};
const made: { player: Recorded | null; source: unknown; loaded: number } = { player: null, source: null, loaded: 0 };

jest.mock("expo-video", () => {
  made.loaded += 1;
  const React = jest.requireActual<typeof import("react")>("react");
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    useVideoPlayer: (source: unknown, setup: (p: Recorded) => void) => {
      const [player] = React.useState(() => {
        const p: Recorded = {
          calls: [],
          play: () => p.calls.push("play"),
          pause: () => p.calls.push("pause"),
        };
        setup(p);
        made.player = p;
        made.source = source;
        return p;
      });
      return player;
    },
    VideoView: (props: Record<string, unknown>) => React.createElement(View, { ...props, testID: "video-view" }),
  };
});

describe("the clip player (62b)", () => {
  const heard: ((state: AppStateStatus) => void)[] = [];
  let spy: jest.SpyInstance;
  let setup: ((...args: never[]) => unknown) | undefined;

  beforeEach(() => {
    heard.length = 0;
    made.player = null;
    // The test setup's own stand-in, its answer put back after.
    spy = jest.spyOn(AppState, "addEventListener");
    setup = spy.getMockImplementation();
    spy.mockImplementation((_type: string, fn: (state: AppStateStatus) => void) => {
      heard.push(fn);
      return { remove: () => heard.splice(heard.indexOf(fn), 1) } as ReturnType<typeof AppState.addEventListener>;
    });
  });
  afterEach(() => {
    if (setup !== undefined) spy.mockImplementation(setup);
  });

  const Player = () => (jest.requireActual<typeof import("../../src/library/clipPlayer")>("../../src/library/clipPlayer")).default;

  it("is muted and mixes with other sound, never keeps the screen on, and stops when the app is left", async () => {
    const ClipPlayer = Player();
    await render(<ClipPlayer uri="file:///documents/library-media/a.mp4" playing onFirstFrame={() => undefined} style={{}} />);
    expect(made.source).toEqual({ uri: "file:///documents/library-media/a.mp4" });
    expect(made.player).toMatchObject({
      loop: true,
      muted: true,
      audioMixingMode: "mixWithOthers",
      keepScreenOnWhilePlaying: false,
      staysActiveInBackground: false,
      showNowPlayingNotification: false,
    });
  });

  it("plays and pauses as it is told, and starts again on coming back to the app only while it plays", async () => {
    const ClipPlayer = Player();
    const view = await render(<ClipPlayer uri="file:///a.mp4" playing onFirstFrame={() => undefined} style={{}} />);
    expect(made.player?.calls).toEqual(["play"]);
    await act(() => {
      for (const fn of [...heard]) fn("active");
    });
    expect(made.player?.calls).toEqual(["play", "play"]);
    await view.rerender(<ClipPlayer uri="file:///a.mp4" playing={false} onFirstFrame={() => undefined} style={{}} />);
    expect(made.player?.calls).toEqual(["play", "play", "pause"]);
    // Paused, coming back to the app does not start it.
    await act(() => {
      for (const fn of [...heard]) fn("active");
    });
    expect(made.player?.calls).toEqual(["play", "play", "pause"]);
  });

  it("draws the clip whole, with no controls of the player's own, as part of the page, and says its first frame", async () => {
    const ClipPlayer = Player();
    const first = jest.fn();
    const view = await render(<ClipPlayer uri="file:///a.mp4" playing onFirstFrame={first} style={{}} />);
    const video = view.getByTestId("video-view");
    expect(video.props).toMatchObject({ contentFit: "contain", nativeControls: false, allowsPictureInPicture: false, surfaceType: "textureView" });
    (video.props.onFirstFrameRender as () => void)();
    expect(first).toHaveBeenCalledTimes(1);
  });
});

describe("a copy of the app built before the clip player (62b, round one T3)", () => {
  const load = (native: object | null) => {
    let got: unknown;
    jest.isolateModules(() => {
      jest.doMock("expo", () => ({ requireOptionalNativeModule: (name: string) => (name === "ExpoVideo" ? native : null) }));
      got = jest.requireActual<typeof import("../../src/library/clipNative")>("../../src/library/clipNative").ClipNative;
    });
    return got;
  };

  it("has no player, and never loads expo-video, where the phone lacks it", () => {
    const before = made.loaded;
    expect(load(null)).toBeNull();
    expect(made.loaded).toBe(before);
  });

  it("has a player where the phone has it, and loads expo-video only when a clip is first shown", () => {
    const before = made.loaded;
    const player = load({});
    expect(player).not.toBeNull();
    expect(typeof player).toBe("object");
    expect(made.loaded).toBe(before);
  });
});
