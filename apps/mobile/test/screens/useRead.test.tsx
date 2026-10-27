import { Text } from "react-native";
import { act, render, screen } from "@testing-library/react-native";
import { useRead } from "../../src/screens/dashboard/useRead";

// The reading step alone, with the page left open while the person changes: what the app's own
// unmount on sign-out covers elsewhere, these guards must cover by themselves.
type Person = { kind: "in"; user: { id: string } };
let mockNow: Person = { kind: "in", user: { id: "ravi" } };
let mockAway: ((answer: unknown) => void)[] = [];
const mockSession = {
  signedIn: jest.fn(
    () =>
      new Promise((resolve) => {
        mockAway.push(resolve);
      }),
  ),
  state: () => mockNow,
};

jest.mock("../../src/session/SessionProvider", () => ({
  useSession: () => ({ session: mockSession, state: mockNow }),
}));
jest.mock("@react-navigation/native", () => ({
  useFocusEffect: (run: () => void) => {
    const react = jest.requireActual<typeof import("react")>("react");
    react.useEffect(run, [run]);
  },
  useNavigation: () => ({ isFocused: () => true }),
}));

const shape = {
  safeParse: (raw: unknown): { success: true; data: { n: number } } | { success: false } =>
    typeof raw === "object" && raw !== null && "n" in raw && typeof raw.n === "number" ? { success: true, data: { n: raw.n } } : { success: false },
};
let againOf: () => void = () => undefined;

function Probe() {
  const { read, again } = useRead("/v1/numbers", shape);
  againOf = again;
  return <Text>{read.kind === "ok" ? `n ${String(read.data.n)}` : read.kind}</Text>;
}

beforeEach(() => {
  mockNow = { kind: "in", user: { id: "ravi" } };
  mockAway = [];
  mockSession.signedIn.mockClear();
});

it("the person's own reply is drawn", async () => {
  await render(<Probe />);
  await act(async () => {
    mockAway[0]?.({ kind: "ok", data: { n: 7 } });
    await Promise.resolve();
  });
  expect(screen.getByText("n 7")).toBeTruthy();
});

it("a reply that comes back after somebody else is signed in is dropped, with the page still open", async () => {
  await render(<Probe />);
  expect(mockAway).toHaveLength(1);
  mockNow = { kind: "in", user: { id: "asha" } };
  await act(async () => {
    mockAway[0]?.({ kind: "ok", data: { n: 999 } });
    await Promise.resolve();
  });
  expect(screen.queryByText("n 999")).toBeNull();
  expect(screen.getByText("loading")).toBeTruthy();
});

it("a read asked for while one is away goes once that one is back", async () => {
  await render(<Probe />);
  await act(async () => {
    againOf();
    againOf();
    await Promise.resolve();
  });
  expect(mockSession.signedIn).toHaveBeenCalledTimes(1);
  await act(async () => {
    mockAway[0]?.({ kind: "ok", data: { n: 1 } });
    await Promise.resolve();
  });
  expect(mockSession.signedIn).toHaveBeenCalledTimes(2);
  await act(async () => {
    mockAway[1]?.({ kind: "ok", data: { n: 2 } });
    await Promise.resolve();
  });
  expect(screen.getByText("n 2")).toBeTruthy();
  expect(mockSession.signedIn).toHaveBeenCalledTimes(2);
});
