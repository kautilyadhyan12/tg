import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { App } from "../../src/App";
import { RAVI, fakeServer, lost, memoryStore, refusal, tokens, type Reply } from "../kit";

// The robot check on the phone (ROADMAP Stage 5 item 12b-ii). Past 20 codes an hour from one
// internet address, a gym's wi-fi say, the server asks for Cloudflare's check before it sends.

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000" };
const KEY = "1x00000000000000000000AA";
const ASKS = "One quick check that you're not a robot, then we'll send your code.";
const FAILED = "We couldn't check that you're not a robot. Please try again.";

const sentReply: Reply = {
  status: 200,
  body: { message: "We emailed you a 6-digit code.", resendAfterSeconds: 1, expiresInSeconds: 600 },
};
const asksForCheck = () => refusal(403, "robot_check", ASKS, { robotCheckKey: KEY });
/** The server's gate: no answer is asked for one, a spent or bad one is refused, a good one passes. */
function busyNetwork(good: string[]) {
  const spent = new Set<string>();
  return (body: unknown): Reply => {
    const token = (body as { robotToken?: string }).robotToken;
    if (token === undefined) return asksForCheck();
    if (!good.includes(token) || spent.has(token)) return refusal(403, "robot_failed", FAILED, { robotCheckKey: KEY });
    spent.add(token);
    return sentReply;
  };
}

interface Box {
  props: {
    source: { html: string; baseUrl: string };
    onMessage: (event: { nativeEvent: { data: string } }) => void;
    onError: () => void;
  };
  gone: boolean;
}
const { boxes } = jest.requireMock<{ boxes: Box[] }>("react-native-webview");
function box(): Box {
  const open = boxes.filter((one) => !one.gone);
  const last = open.at(-1);
  if (last === undefined || open.length !== 1) throw new Error(`one box open was expected, found ${String(open.length)}`);
  return last;
}
/** What Cloudflare's box says back to the app. */
const say = async (message: unknown) => {
  await act(() => {
    box().props.onMessage({ nativeEvent: { data: typeof message === "string" ? message : JSON.stringify(message) } });
  });
};

const press = (button: string) => fireEvent.press(screen.getByRole("button", { name: button }));
const sends = (server: ReturnType<typeof fakeServer>) => server.asked.filter((one) => one.path === "/v1/auth/code/send").map((one) => one.body);

async function openAndAsk(route: (body: unknown) => Reply) {
  const server = fakeServer({
    "/v1/auth/code/send": route,
    "/v1/auth/code/verify": () => ({ status: 200, body: { user: RAVI, isNewAccount: false, tokens: tokens(1) } }),
  });
  await render(<App extra={extra} ask={server.ask} store={memoryStore()} wait={() => Promise.resolve()} />);
  await screen.findByText("Get started.");
  await fireEvent.changeText(screen.getByLabelText("Email"), "ravi@example.com");
  await press("Continue");
  return server;
}

beforeEach(() => {
  boxes.length = 0;
});

describe("the worst thing: the 21st person on a gym's wi-fi still signs in", () => {
  it("the check opens, its answer sends the code with no second press, and the person signs in", async () => {
    const server = await openAndAsk(busyNetwork(["answer-1"]));
    expect(await screen.findByText("Security check")).toBeTruthy();
    expect(screen.getByText(ASKS)).toBeTruthy();
    // Cloudflare's own box, drawn with the server's key, on the api's own address.
    expect(box().props.source.html).toContain(JSON.stringify(KEY));
    expect(box().props.source.baseUrl).toBe("http://localhost:3000/");

    await say({ kind: "token", token: "answer-1" });
    expect(await screen.findByText("Check your email.")).toBeTruthy();
    expect(screen.queryByText("Security check")).toBeNull();
    expect(sends(server)).toEqual([{ email: "ravi@example.com" }, { email: "ravi@example.com", robotToken: "answer-1" }]);

    await fireEvent.changeText(screen.getByLabelText("6-digit code"), "123456");
    await press("Continue");
    expect(await screen.findByRole("tab", { name: "Dashboard" })).toBeTruthy();
  });

  it("an answer the server refuses opens a new box with its sentence, and the next answer sends the code", async () => {
    const server = await openAndAsk(busyNetwork(["answer-2"]));
    await screen.findByText("Security check");
    await say({ kind: "token", token: "not-good" });
    expect(await screen.findByText(FAILED)).toBeTruthy();
    expect(boxes).toHaveLength(2);
    await say({ kind: "token", token: "answer-2" });
    expect(await screen.findByText("Check your email.")).toBeTruthy();
    expect(sends(server).at(-1)).toEqual({ email: "ravi@example.com", robotToken: "answer-2" });
  });

  it.each([
    ["Cloudflare's box fails", "failed", "We couldn’t check that you’re not a robot. Try again."],
    ["its script never loads", "blocked", "The check didn’t load. Check your internet and try again."],
  ])("%s: the box says so, Try again draws a new one, and its answer sends the code", async (_name, kind, line) => {
    await openAndAsk(busyNetwork(["answer-3"]));
    await screen.findByText("Security check");
    await say({ kind });
    expect(await screen.findByText(line)).toBeTruthy();
    expect(screen.queryByTestId("robot-check-box")).toBeNull();
    await press("Try again");
    expect(screen.queryByText(line)).toBeNull();
    expect(boxes).toHaveLength(2);
    await say({ kind: "token", token: "answer-3" });
    expect(await screen.findByText("Check your email.")).toBeTruthy();
  });

  it("a page that cannot be opened (no internet in the box) says so, with Try again", async () => {
    await openAndAsk(busyNetwork(["answer-4"]));
    await screen.findByText("Security check");
    await act(() => {
      box().props.onError();
    });
    expect(screen.getByText("The check didn’t load. Check your internet and try again.")).toBeTruthy();
    await press("Try again");
    await say({ kind: "token", token: "answer-4" });
    expect(await screen.findByText("Check your email.")).toBeTruthy();
  });

  it("an answer that runs out draws a new box by itself, with nothing said", async () => {
    await openAndAsk(busyNetwork(["answer-5"]));
    await screen.findByText("Security check");
    await say({ kind: "expired" });
    expect(boxes).toHaveLength(2);
    expect(screen.queryByText(/Try again/)).toBeNull();
    await say({ kind: "token", token: "answer-5" });
    expect(await screen.findByText("Check your email.")).toBeTruthy();
  });

  it("closed before it passed: the page says what is left, and Continue opens the check again", async () => {
    const server = await openAndAsk(busyNetwork(["answer-6"]));
    await screen.findByText("Security check");
    await press("Close");
    expect(screen.queryByText("Security check")).toBeNull();
    expect(screen.getByText(ASKS)).toBeTruthy();
    expect(screen.queryByLabelText("6-digit code")).toBeNull();
    await press("Continue");
    expect(await screen.findByText("Security check")).toBeTruthy();
    await say({ kind: "token", token: "answer-6" });
    expect(await screen.findByText("Check your email.")).toBeTruthy();
    expect(sends(server)).toHaveLength(3);
  });

  it("Resend code asks for the check too, and its answer sends the new code", async () => {
    let busy = false;
    const gate = busyNetwork(["answer-7"]);
    const server = await openAndAsk((body) => (busy ? gate(body) : sentReply));
    await screen.findByText("Check your email.");
    busy = true;
    await fireEvent.press(await screen.findByRole("button", { name: "Resend code" }, { timeout: 4000 }));
    expect(await screen.findByText("Security check")).toBeTruthy();
    await say({ kind: "token", token: "answer-7" });
    expect(await screen.findByText("New code sent.")).toBeTruthy();
    expect(sends(server).at(-1)).toEqual({ email: "ravi@example.com", robotToken: "answer-7" });
  });
});

describe("what the box says back is read, never trusted", () => {
  it.each([
    ["not JSON", "<script>"],
    ["an unknown kind", { kind: "passed" }],
    ["an empty answer", { kind: "token", token: "" }],
    ["an answer longer than Cloudflare's", { kind: "token", token: "a".repeat(2049) }],
  ])("%s: nothing is sent and the box stays", async (_name, message) => {
    const server = await openAndAsk(busyNetwork(["answer-8"]));
    await screen.findByText("Security check");
    await say(message);
    expect(sends(server)).toHaveLength(1);
    expect(screen.getByText("Security check")).toBeTruthy();
    expect(screen.getByTestId("robot-check-box")).toBeTruthy();
  });

  it("a key the server never would send draws no page, and says the check did not load", async () => {
    await openAndAsk(() => refusal(403, "robot_check", ASKS, { robotCheckKey: "</script><script>alert(1)" }));
    expect(await screen.findByText("Security check")).toBeTruthy();
    expect(screen.queryByTestId("robot-check-box")).toBeNull();
    expect(screen.getByText("The check didn’t load. Check your internet and try again.")).toBeTruthy();
  });
});

describe("after the check", () => {
  it.each([
    ["Cloudflare cannot be reached by the server", () => refusal(503, "robot_unavailable", "We couldn't send your code just now. Please try again in a minute."), "We couldn't send your code just now. Please try again in a minute."],
    ["no internet", lost, "Can’t connect. Check your internet and try again."],
  ])("%s: said under the email box, and Continue can be pressed again", async (_name, after, line) => {
    let checked = false;
    await openAndAsk((body) => {
      if ((body as { robotToken?: string }).robotToken === undefined && !checked) return asksForCheck();
      checked = true;
      return after();
    });
    await screen.findByText("Security check");
    await say({ kind: "token", token: "answer-9" });
    expect(await screen.findByText(line)).toBeTruthy();
    expect(screen.queryByText("Security check")).toBeNull();
    expect(screen.getByRole("button", { name: "Continue" }).props.accessibilityState).toEqual({ disabled: false, busy: false });
  });
});
