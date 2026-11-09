import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";
import { App } from "../../src/App";
import type { TextStore } from "../../src/screens/food/outbox";
import { fakeServer, kept, memoryStore, profile, RAVI, tokens, type Reply } from "../kit";

// Minutes in the app (ROADMAP Stage 5 21f), wired into the app: the counter reads and sends only the
// file of the person signed in, and leaving the app sends what it counted.

const extra = { copyName: "Feature 2", apiUrl: "http://localhost:3000" };
const noWait = () => Promise.resolve();
const ok = (body: unknown) => (): Reply => ({ status: 200, body });
const ASHA_ID = "2c9e4f1a-8b7d-4e6f-9a5b-3d2c1e0f9a8b";
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const fileWith = (day: string, seconds: number) => JSON.stringify({ version: 1, days: [{ day, zone: "Asia/Kolkata", seconds }] });

/** Each person's file, in memory, and whose files the app asked for. */
function files(start: Record<string, string>) {
  const texts = new Map(Object.entries(start));
  const askedFor: string[] = [];
  const store = (userId: string): TextStore => {
    askedFor.push(userId);
    return {
      read: () => Promise.resolve(texts.get(userId) ?? null),
      write: (text) => {
        texts.set(userId, text);
        return Promise.resolve();
      },
    };
  };
  return { store, askedFor, texts };
}

let handlers: ((state: AppStateStatus) => void)[] = [];
beforeEach(() => {
  handlers = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
    handlers.push(handler);
    return { remove: () => undefined };
  });
});
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 30)));
const sends = (server: ReturnType<typeof fakeServer>) => server.asked.filter((a) => a.path === "/v1/me/app-minutes");

function serve() {
  return fakeServer({ "/v1/auth/refresh": ok({ tokens: tokens(2) }), "/v1/me/app-minutes": ok({ kept: 1, ignored: 0 }) });
}

it("the worst thing: another person's saved minutes are never read or sent while Ravi is signed in", async () => {
  const server = serve();
  const phone = files({ [ASHA_ID]: fileWith(yesterday, 1500), [RAVI.id]: fileWith(yesterday, 720) });
  await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} minutesStore={phone.store} />);
  await screen.findAllByRole("tab");
  await settle();
  expect(new Set(phone.askedFor)).toEqual(new Set([RAVI.id]));
  const sent = sends(server);
  expect(sent).toHaveLength(1);
  expect(sent[0]?.body).toEqual({ days: [{ day: yesterday, minutes: 12, zone: "Asia/Kolkata" }] });
  expect(sent[0]?.headers.authorization ?? sent[0]?.headers.Authorization).toBe("Bearer access-2");
  // Asha's file is as she left it, for her own next sign-in.
  expect(phone.texts.get(ASHA_ID)).toBe(fileWith(yesterday, 1500));
});

it("a day the server has taken leaves Ravi's file", async () => {
  const server = serve();
  const phone = files({ [RAVI.id]: fileWith(yesterday, 720) });
  await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} minutesStore={phone.store} />);
  await screen.findAllByRole("tab");
  await settle();
  expect(sends(server)).toHaveLength(1);
  expect(JSON.parse(phone.texts.get(RAVI.id) ?? "{}")).toEqual({ version: 1, days: [] });
});

it("leaving the app sends what it counted; nothing is sent before there is anything", async () => {
  const server = serve();
  const phone = files({});
  await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} minutesStore={phone.store} />);
  await screen.findAllByRole("tab");
  await settle();
  expect(sends(server)).toHaveLength(0);
  await act(() => {
    for (const handler of handlers) handler("active");
  });
  await settle();
  await act(() => {
    for (const handler of handlers) handler("background");
  });
  await settle();
  const sent = sends(server);
  expect(sent).toHaveLength(1);
  const body = sent[0]?.body as { days: { minutes: number }[] };
  expect(body.days).toHaveLength(1);
  expect(body.days[0]?.minutes).toBe(0);
});

it("counts from the sign-in on: time on Before you start is the person's too", async () => {
  const server = fakeServer({
    "/v1/auth/refresh": ok({ tokens: tokens(2) }),
    "/v1/me/app-minutes": ok({ kept: 1, ignored: 0 }),
    "/v1/users/me": ok(profile(false)),
  });
  const phone = files({});
  await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1, RAVI, null))} wait={noWait} minutesStore={phone.store} />);
  expect(await screen.findByText("Before you start")).toBeTruthy();
  await settle();
  expect(phone.askedFor).toContain(RAVI.id);
  await act(() => {
    for (const handler of handlers) handler("active");
  });
  await settle();
  await act(() => {
    for (const handler of handlers) handler("background");
  });
  await settle();
  expect(sends(server)).toHaveLength(1);
});

it("Ravi signs out and Asha signs in on the same phone: every send after carries Asha's sign-in and Asha's days only", async () => {
  const ASHA = { ...RAVI, id: ASHA_ID, email: "asha@example.com", displayName: "Asha" };
  let who = RAVI;
  // While Ravi is signed in the server cannot take his minutes, so they are still in his file when he leaves.
  let takes = false;
  const server = fakeServer({
    "/v1/auth/refresh": ok({ tokens: tokens(2) }),
    "/v1/auth/logout": ok({ ok: true }),
    "/v1/auth/code/send": ok({ message: "We emailed you a 6-digit code.", resendAfterSeconds: 60, expiresInSeconds: 600 }),
    "/v1/auth/code/verify": () => ({ status: 200, body: { user: ASHA, isNewAccount: false, tokens: tokens(7) } }),
    "/v1/users/me": () => ({ status: 200, body: profile(true, who) }),
    "/v1/me/app-minutes": () => (takes ? { status: 200, body: { kept: 1, ignored: 0 } } : { status: 503, body: { error: "unavailable", message: "Try again." } }),
  });
  const ravis = fileWith(yesterday, 720);
  const ashas = fileWith(yesterday, 300);
  const phone = files({ [RAVI.id]: ravis, [ASHA_ID]: ashas });
  await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} minutesStore={phone.store} />);
  await fireEvent.press(await screen.findByRole("tab", { name: "Me" }));
  await fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
  const [, inTheBox] = screen.getAllByRole("button", { name: "Sign out" });
  if (inTheBox === undefined) throw new Error("no Sign out in the box");
  await fireEvent.press(inTheBox);
  await screen.findByText("Get started.");
  const beforeAsha = sends(server).length;

  who = ASHA;
  takes = true;
  await fireEvent.changeText(screen.getByLabelText("Email"), "asha@example.com");
  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  await fireEvent.changeText(await screen.findByLabelText("6-digit code"), "123456");
  await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  await screen.findAllByRole("tab");
  await settle();

  const after = sends(server).slice(beforeAsha);
  expect(after.length).toBeGreaterThan(0);
  for (const one of after) {
    expect(one.headers.authorization ?? one.headers.Authorization).toBe("Bearer access-7");
    expect(one.body).toEqual({ days: [{ day: yesterday, minutes: 5, zone: "Asia/Kolkata" }] });
  }
  // Ravi's minutes wait in his own file for his own next sign-in.
  expect(readDays(phone.texts.get(RAVI.id))).toContainEqual({ day: yesterday, zone: "Asia/Kolkata", seconds: 720 });
});

const readDays = (text: string | undefined): unknown[] => {
  const parsed: unknown = JSON.parse(text ?? "{}");
  const days: unknown = typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "days") : null;
  return Array.isArray(days) ? days : [];
};
