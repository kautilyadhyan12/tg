import { act, render, screen } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";
import { App } from "../../src/App";
import type { TextStore } from "../../src/screens/food/outbox";
import { fakeServer, kept, memoryStore, RAVI, tokens, type Reply } from "../kit";

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
