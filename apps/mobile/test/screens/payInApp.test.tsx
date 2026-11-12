import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { AppState, Linking, type AppStateStatus } from "react-native";
import { APP_PAYMENT_WORDS, myMembershipResponseSchema } from "@app/shared";
import { App } from "../../src/App";
import { NOT_PAID, PAY_CHECK, PAY_NO_ANSWER, PAY_NOT_OPENED, PAY_WAITING } from "../../src/screens/gym/payView";
import { PAY_AWAY } from "../../src/screens/gym/usePayInApp";
import type { Ask } from "../../src/session/calls";
import { fakeServer, kept, lost, memoryStore, refusal, tokens, type Reply } from "../kit";

// Pay what I owe, on the phone (ROADMAP Stage 5 item 20f). The server decides what can be paid and how a page ended
// (`appPayments.routes.test.ts`); the phone offers Pay beside what is due, sends exactly what it showed to that place,
// opens Square's page in a tab, and once they are back closes the page and says how it ended, reading Paid only from
// the server's own answer.

// The tab's test stand-in (test/screens/setup.js).
const { tab } = jest.requireMock<{ tab: { opened: { url: string; options: unknown }[]; answer: string; missing: boolean; hold: boolean; close: () => void } }>(
  "../../src/look/browserTabNative",
);

// The app coming to the front and going behind the tab, said by the test. Kept for the whole file: put back mid-file,
// a spy breaks every later render.
let listeners: ((state: AppStateStatus) => void)[] = [];
jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
  const one = handler;
  listeners.push(one);
  return {
    remove: () => {
      listeners = listeners.filter((l) => l !== one);
    },
  };
});
const appIs = async (state: AppStateStatus) => {
  await act(() => {
    for (const listener of [...listeners]) listener(state);
  });
};
/** They close Square's tab on Android: the app goes behind it, then comes to the front. */
const backFromTab = async () => {
  await appIs("background");
  await appIs("active");
};

beforeEach(() => {
  tab.opened = [];
  tab.answer = "opened";
  tab.missing = false;
  tab.hold = false;
});

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000" };
const noWait = () => Promise.resolve();
const ok = (body: unknown) => (): Reply => ({ status: 200, body });

type Place = { id: string; name: string; city: string | null; orgType: string; clockFormat: "12h" | "24h" };
const IRON: Place = { id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", name: "Iron House", city: "Austin", orgType: "gym", clockFormat: "12h" };
const LOTUS: Place = { id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d", name: "Lotus Yoga", city: null, orgType: "studio", clockFormat: "24h" };
const org = (gym: Place) => ({
  ...gym,
  slug: gym.name.toLowerCase().replace(" ", "-"),
  timezone: "UTC",
  locale: "en",
  currencyDisplay: "USD",
  status: "active",
  staffRole: null,
  isMember: true,
  joinedAt: "2026-10-01T00:00:00.000Z",
});
const mine = (...gyms: Place[]) => ok({ orgs: gyms.map(org), formerOrgs: [] });

const GOLD = "11111111-1111-4111-8111-111111111111";
const TEEN = "22222222-2222-4222-8222-222222222222";
const LOTUS_M = "33333333-3333-4333-8333-333333333333";
const FEE = "5d0f2f8e-6b0a-4c1e-9a43-2f6c1d9e7a02";
const PAGE = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const SQUARE_URL = "https://sandbox.square.link/u/AbCd1234";

type Row = Record<string, unknown>;
const membership = (id: string, name: string, over: Row = {}): Row => ({
  id,
  name,
  kind: "recurring",
  priceMinor: 4900,
  currency: "USD",
  status: "active",
  startsOn: "2026-10-04",
  fromList: false,
  endsOn: null,
  renewsOn: "2026-12-04",
  frozenOn: null,
  classesLeft: null,
  packClasses: null,
  owed: null,
  payments: [],
  olderPeriodsNotShown: 0,
  fees: [],
  ...over,
});
const overdue = { amountMinor: 4900, dueOn: "2026-11-04", state: "overdue", periodIndex: 1 };
const noShow = (over: Row = {}): Row => ({ id: FEE, fee: "no_show", forName: "Spin", on: "2026-11-10", amountMinor: 1000, dueOn: "2026-11-11", state: "overdue", receiptNumber: null, ...over });
const view = (gym: string, over: Row = {}) =>
  myMembershipResponseSchema.parse({
    gym: { name: gym },
    today: "2026-11-12",
    record: "own",
    paidBy: null,
    memberships: [membership(GOLD, "Gold Monthly", { owed: overdue })],
    paysFor: [],
    earlierNotShown: 0,
    purchases: [],
    purchasesNotShown: 0,
    ...over,
  });
const page = (over: Row = {}): Row => ({
  id: PAGE,
  membershipId: GOLD,
  periodIndex: 1,
  feeId: null,
  amountMinor: 4900,
  currency: "USD",
  state: "open",
  url: SQUARE_URL,
  closesAt: "2026-11-12T10:42:00.000Z",
  receiptNumber: null,
  ...over,
});
const membershipPath = (p: Place) => `/v1/orgs/${p.id}/my-membership`;
const paymentsPath = (p: Place) => `/v1/orgs/${p.id}/my-membership/payments`;
const closePath = (p: Place, id = PAGE) => `/v1/orgs/${p.id}/my-membership/payments/${id}/close`;
const payments = (inApp = true, open: Row[] = []) => ok({ inApp, open });

async function openMembership(ask: Ask, place: Place) {
  await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
  const tabs = (await screen.findAllByRole("tab"))[3];
  if (tabs === undefined) throw new Error("no fourth tab");
  await fireEvent.press(tabs);
  await fireEvent.press(await screen.findByLabelText(`My membership at ${place.name}`));
}
const onPage = () => within(screen.getByTestId("membership-page"));
const posts = (asked: { method: string; path: string; body: unknown }[], path: string) => asked.filter((a) => a.method === "POST" && a.path === path);

describe("the worst thing: never Paid unless the server says so, and Pay pays exactly what it showed, at that place", () => {
  it("a payer's Pay on the person they pay for sends that bill alone; left unpaid it reads not paid, and Pay on their own reads Paid only once the server does", async () => {
    let closeAnswer: Row = page({ membershipId: TEEN, amountMinor: 2900, state: "closed", url: null, closesAt: null });
    let memberships = 0;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON, LOTUS),
      [membershipPath(IRON)]: () => {
        memberships += 1;
        return ok(
          view("Iron House", {
            paysFor: [{ name: "Aarav Sharma", memberships: [membership(TEEN, "Teen Monthly", { priceMinor: 2900, owed: { amountMinor: 2900, dueOn: "2026-11-12", state: "due", periodIndex: 1 } })], earlierNotShown: 0 }],
          }),
        )();
      },
      [membershipPath(LOTUS)]: ok(view("Lotus Yoga", { memberships: [membership(LOTUS_M, "Lotus Monthly", { owed: overdue })] })),
      [paymentsPath(IRON)]: (body) => (body === undefined ? payments()() : ok({ payment: page((body as { membershipId: string }).membershipId === TEEN ? { membershipId: TEEN, amountMinor: 2900 } : {}) })()),
      [paymentsPath(LOTUS)]: payments(),
      [closePath(IRON)]: () => ok({ payment: closeAnswer })(),
    });
    await openMembership(server.ask, IRON);
    await fireEvent.press(await onPage().findByLabelText("Pay $29.00 for Teen Monthly"));
    await waitFor(() => { expect(tab.opened).toHaveLength(1); });
    expect(tab.opened[0]?.url).toBe(SQUARE_URL);
    const [press] = posts(server.asked, paymentsPath(IRON));
    expect(press?.body).toEqual({ requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown, membershipId: TEEN, amountMinor: 2900, periodIndex: 1 });
    expect(server.paths().filter((p) => p.includes(LOTUS.id) && p.includes("/my-membership"))).toEqual([]);
    expect(onPage().getByText(PAY_AWAY)).toBeTruthy();

    await backFromTab();
    expect(await onPage().findByText(NOT_PAID)).toBeTruthy();
    expect(posts(server.asked, closePath(IRON))).toHaveLength(1);
    expect(onPage().queryByText(/^Payment successful/)).toBeNull();
    expect(onPage().getByLabelText("Pay $29.00 for Teen Monthly")).toBeTruthy();

    // Her own bill: Square says paid, and only then does it read Paid, and the place is read again for its receipt.
    closeAnswer = page({ state: "paid", url: null, closesAt: null, receiptNumber: 12 });
    const before = memberships;
    await fireEvent.press(onPage().getByLabelText("Pay $49.00 for Gold Monthly"));
    await waitFor(() => { expect(tab.opened).toHaveLength(2); });
    expect(posts(server.asked, paymentsPath(IRON))[1]?.body).toMatchObject({ membershipId: GOLD, amountMinor: 4900, periodIndex: 1 });
    await backFromTab();
    expect(await within(screen.getByTestId(`pay-${GOLD}-said`)).findByText("Payment successful. $49.00 paid.")).toBeTruthy();
    await waitFor(() => { expect(memberships).toBeGreaterThan(before); });
  });

  it("a page Square may have taken money on reads the front desk's check, never Paid, and Pay is not offered again", async () => {
    let checked = false;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [membershipPath(IRON)]: () => ok(view("Iron House", { memberships: [membership(GOLD, "Gold Monthly", { owed: { ...overdue, check: checked } })] }))(),
      [paymentsPath(IRON)]: (body) => (body === undefined ? payments()() : ok({ payment: page() })()),
      [closePath(IRON)]: () => {
        checked = true;
        return ok({ payment: page({ state: "check", url: null, closesAt: null }) })();
      },
    });
    await openMembership(server.ask, IRON);
    await fireEvent.press(await onPage().findByLabelText("Pay $49.00 for Gold Monthly"));
    await waitFor(() => { expect(tab.opened).toHaveLength(1); });
    await backFromTab();
    expect(await onPage().findByText(PAY_CHECK)).toBeTruthy();
    expect(onPage().queryByText(/^Payment successful/)).toBeNull();
    await waitFor(() => { expect(onPage().queryByLabelText("Pay $49.00 for Gold Monthly")).toBeNull(); });
    // Read again later, the line stays, once.
    expect(onPage().getAllByText(PAY_CHECK)).toHaveLength(1);
  });
});

describe("what has Pay", () => {
  it("a bill and a fee due have it; one being checked by the front desk shows why instead; a bill not due yet, or a place not taking payments, has none", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON, LOTUS),
      [membershipPath(IRON)]: ok(
        view("Iron House", {
          memberships: [
            membership(GOLD, "Gold Monthly", { owed: overdue, fees: [noShow(), noShow({ id: "6e1f3a9f-7c1b-4d2f-8b54-3a7d2e0f8b12", forName: "Yoga", check: true })] }),
            membership(TEEN, "Off-peak Monthly", { owed: { amountMinor: 2900, dueOn: "2026-11-20", state: "due", periodIndex: 2 } }),
          ],
        }),
      ),
      [paymentsPath(IRON)]: payments(),
      [membershipPath(LOTUS)]: ok(view("Lotus Yoga", { memberships: [membership(LOTUS_M, "Lotus Monthly", { owed: overdue })] })),
      [paymentsPath(LOTUS)]: payments(false),
    });
    await openMembership(server.ask, IRON);
    expect(await onPage().findByLabelText("Pay $49.00 for Gold Monthly")).toBeTruthy();
    expect(onPage().getByLabelText("Pay $10.00 for No-show fee, Spin")).toBeTruthy();
    expect(onPage().queryByLabelText("Pay $10.00 for No-show fee, Yoga")).toBeNull();
    expect(within(onPage().getByTestId("pay-6e1f3a9f-7c1b-4d2f-8b54-3a7d2e0f8b12-check")).getByText(PAY_CHECK)).toBeTruthy();
    expect(onPage().getByText("Next payment: $29.00 on 20 Nov 2026")).toBeTruthy();
    expect(onPage().queryByLabelText("Pay $29.00 for Off-peak Monthly")).toBeNull();

    await fireEvent.press(onPage().getByLabelText("Back"));
    await fireEvent.press(await screen.findByLabelText(`My membership at ${LOTUS.name}`));
    expect(await onPage().findByText("Overdue: $49.00 · due 4 Nov 2026")).toBeTruthy();
    expect(onPage().queryByLabelText(/^Pay /)).toBeNull();
  });
});

describe("coming back, and every way it ends", () => {
  const routes = (over: Record<string, (body?: unknown) => Reply | Promise<Reply>> = {}) => ({
    "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
    [membershipPath(IRON)]: ok(view("Iron House")),
    [paymentsPath(IRON)]: (body?: unknown) => (body === undefined ? payments()() : ok({ payment: page() })()),
    [closePath(IRON)]: ok({ payment: page({ state: "closed", url: null, closesAt: null }) }),
    ...over,
  });

  it("a page found still open when the place is read (the app was closed on it) is closed, and how it ended is said", async () => {
    const server = fakeServer(routes({ [paymentsPath(IRON)]: payments(true, [page()]) }));
    await openMembership(server.ask, IRON);
    expect(await within(await onPage().findByTestId(`pay-${GOLD}-said`)).findByText(NOT_PAID)).toBeTruthy();
    expect(posts(server.asked, closePath(IRON))).toHaveLength(1);
    expect(tab.opened).toEqual([]);
  });

  it("on an iPhone the page stays open through the Apple Pay sheet, Face ID or the bank's app, and is ended once the tab closes", async () => {
    tab.answer = "cancel";
    tab.hold = true;
    const server = fakeServer(routes());
    await openMembership(server.ask, IRON);
    await fireEvent.press(await onPage().findByLabelText("Pay $49.00 for Gold Monthly"));
    await waitFor(() => {
      expect(tab.opened).toHaveLength(1);
    });
    // The app goes behind and comes back while Square's sheet is still up: they are still paying.
    await appIs("inactive");
    await appIs("active");
    await appIs("background");
    await appIs("active");
    expect(posts(server.asked, closePath(IRON))).toHaveLength(0);
    expect(onPage().getByText(PAY_AWAY)).toBeTruthy();
    await act(() => {
      tab.close();
    });
    expect(await onPage().findByText(NOT_PAID)).toBeTruthy();
    expect(posts(server.asked, closePath(IRON))).toHaveLength(1);
  });

  it("on an iPhone the tab says it closed, and the page is ended then", async () => {
    tab.answer = "cancel";
    const server = fakeServer(routes());
    await openMembership(server.ask, IRON);
    await fireEvent.press(await onPage().findByLabelText("Pay $49.00 for Gold Monthly"));
    expect(await onPage().findByText(NOT_PAID)).toBeTruthy();
    expect(posts(server.asked, closePath(IRON))).toHaveLength(1);
  });

  it("a tab that will not open closes the page and says so; a copy without the tab opens the phone's own browser", async () => {
    tab.answer = "throw";
    const server = fakeServer(routes());
    await openMembership(server.ask, IRON);
    await fireEvent.press(await onPage().findByLabelText("Pay $49.00 for Gold Monthly"));
    expect(await onPage().findByText(PAY_NOT_OPENED)).toBeTruthy();
    expect(posts(server.asked, closePath(IRON))).toHaveLength(1);

    tab.answer = "opened";
    tab.missing = true;
    const opened = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    await fireEvent.press(onPage().getByLabelText("Pay $49.00 for Gold Monthly"));
    await waitFor(() => { expect(opened).toHaveBeenCalledWith(SQUARE_URL); });
    await backFromTab();
    expect(await onPage().findByText(NOT_PAID)).toBeTruthy();
    opened.mockRestore();
  });

  it("Square not answering yet keeps the page held and offers Check again, which then reads how it ended", async () => {
    let answer: Row = page();
    const server = fakeServer(routes({ [closePath(IRON)]: () => ok({ payment: answer })() }));
    await openMembership(server.ask, IRON);
    await fireEvent.press(await onPage().findByLabelText("Pay $49.00 for Gold Monthly"));
    await waitFor(() => { expect(tab.opened).toHaveLength(1); });
    await backFromTab();
    expect(await onPage().findByText(PAY_WAITING)).toBeTruthy();
    answer = page({ state: "paid", url: null, closesAt: null, receiptNumber: 12 });
    await fireEvent.press(onPage().getByLabelText("Check status"));
    expect(await onPage().findByText("Payment successful. $49.00 paid.")).toBeTruthy();
    expect(posts(server.asked, closePath(IRON))).toHaveLength(2);
  });

  /** Waiting on Square, then Square confirms it while the member is away: the server reads it paid from now on. */
  const waitingThenPaid = async () => {
    let answer: Row = page();
    let held = view("Iron House");
    const server = fakeServer(
      routes({ [closePath(IRON)]: () => ok({ payment: answer })(), [membershipPath(IRON)]: () => ok(held)() }),
    );
    await openMembership(server.ask, IRON);
    await fireEvent.press(await onPage().findByLabelText("Pay $49.00 for Gold Monthly"));
    await waitFor(() => { expect(tab.opened).toHaveLength(1); });
    await backFromTab();
    expect(await onPage().findByText(PAY_WAITING)).toBeTruthy();
    // The worker records it and Payment received goes out (20h).
    answer = page({ state: "paid", url: null, closesAt: null, receiptNumber: 12 });
    held = view("Iron House", { memberships: [membership(GOLD, "Gold Monthly", { owed: null })] });
    return server;
  };

  it("still being confirmed, then confirmed while they were away: coming back reads Paid, never 'still being confirmed' (20h)", async () => {
    const server = await waitingThenPaid();
    await appIs("background");
    await appIs("active");
    expect(await onPage().findByText("Payment successful. $49.00 paid.")).toBeTruthy();
    expect(onPage().queryByText(PAY_WAITING)).toBeNull();
    expect(onPage().queryByLabelText("Pay $49.00 for Gold Monthly")).toBeNull();
    expect(posts(server.asked, closePath(IRON))).toHaveLength(2);
  });

  it("still being confirmed, and Payment received arrives with My membership open, or is tapped: it reads Paid (20h)", async () => {
    const { notifications } = jest.requireMock<{ notifications: { received: ((n: unknown) => void)[]; taps: ((r: unknown) => void)[] } }>("expo-notifications");
    const data = { kind: "gym_payment", gymId: IRON.id, paymentId: PAGE, what: "bill" };
    const server = await waitingThenPaid();
    // Another place's says nothing about this one.
    await act(() => {
      for (const one of [...notifications.received]) one({ request: { content: { data: { ...data, gymId: LOTUS.id } } } });
    });
    expect(posts(server.asked, closePath(IRON))).toHaveLength(1);
    await act(() => {
      for (const one of [...notifications.received]) one({ request: { content: { data } } });
    });
    expect(await onPage().findByText("Payment successful. $49.00 paid.")).toBeTruthy();
    expect(onPage().queryByLabelText("Pay $49.00 for Gold Monthly")).toBeNull();
    expect(posts(server.asked, closePath(IRON))).toHaveLength(2);
    // Tapped as well: the place is read again, and nothing is asked twice of a page already ended.
    const reads = server.asked.filter((a) => a.path === membershipPath(IRON)).length;
    await act(() => {
      for (const one of [...notifications.taps]) one({ notification: { request: { identifier: `payment:${PAGE}`, content: { data } } } });
    });
    await waitFor(() => { expect(server.asked.filter((a) => a.path === membershipPath(IRON)).length).toBeGreaterThan(reads); });
    expect(posts(server.asked, closePath(IRON))).toHaveLength(2);
  });

  it("a lost answer whose page has since been closed opens a page of its own on the next press, never 'cancelled'", async () => {
    let lostOnce = true;
    const made: string[] = [];
    const server = fakeServer({
      ...routes(),
      [paymentsPath(IRON)]: (body?: unknown) => {
        if (body === undefined) return payments(true, made.length === 1 ? [page()] : [])();
        const key = (body as { requestKey: string }).requestKey;
        if (lostOnce) {
          lostOnce = false;
          made.push(key);
          return lost();
        }
        // The lost press's page was closed when the app came back; a new key makes a new page.
        return ok({ payment: key === made[0] ? page({ state: "closed", url: null, closesAt: null }) : page({ id: "8b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e" }) })();
      },
    });
    await openMembership(server.ask, IRON);
    await fireEvent.press(await onPage().findByLabelText("Pay $49.00 for Gold Monthly"));
    expect(await onPage().findByText(PAY_NO_ANSWER)).toBeTruthy();
    await appIs("background");
    await appIs("active");
    await waitFor(() => {
      expect(posts(server.asked, closePath(IRON))).toHaveLength(1);
    });
    await fireEvent.press(onPage().getByLabelText("Pay $49.00 for Gold Monthly"));
    await waitFor(() => {
      expect(tab.opened).toHaveLength(1);
    });
    expect(onPage().queryByText(NOT_PAID)).toBeNull();
    const keys = posts(server.asked, paymentsPath(IRON)).map((a) => (a.body as { requestKey: string }).requestKey);
    expect(keys).toEqual([made[0], made[0], expect.not.stringMatching(made[0] ?? "") as unknown]);
  });

  it("a read of the place answered after Pay opened a page never ends that page", async () => {
    let answerRead: (reply: Reply) => void = () => undefined;
    let reads = 0;
    const server = fakeServer({
      ...routes(),
      [paymentsPath(IRON)]: (body?: unknown) => {
        if (body !== undefined) return ok({ payment: page() })();
        reads += 1;
        // The second read (the app coming to the front) is slow, and answers with the page Pay opened.
        return reads === 1 ? payments()() : new Promise<Reply>((resolve) => (answerRead = resolve));
      },
    });
    await openMembership(server.ask, IRON);
    await appIs("active");
    await fireEvent.press(await onPage().findByLabelText("Pay $49.00 for Gold Monthly"));
    await waitFor(() => {
      expect(tab.opened).toHaveLength(1);
    });
    await act(() => {
      answerRead(payments(true, [page()])());
    });
    expect(posts(server.asked, closePath(IRON))).toHaveLength(0);
    expect(onPage().getByText(PAY_AWAY)).toBeTruthy();
  });

  it("a refusal is said where Pay was; a lost answer sends the same press again, so a page made meanwhile is given back", async () => {
    let reply: () => Reply = () => refusal(409, "app_payment_at_desk", APP_PAYMENT_WORDS.at_desk);
    const server = fakeServer(routes({ [paymentsPath(IRON)]: (body?: unknown) => (body === undefined ? payments()() : reply()) }));
    await openMembership(server.ask, IRON);
    await fireEvent.press(await onPage().findByLabelText("Pay $49.00 for Gold Monthly"));
    expect(await onPage().findByText(APP_PAYMENT_WORDS.at_desk)).toBeTruthy();
    expect(tab.opened).toEqual([]);

    reply = lost;
    await fireEvent.press(onPage().getByLabelText("Pay $49.00 for Gold Monthly"));
    expect(await onPage().findByText("Couldn’t connect. Check your internet and try again.")).toBeTruthy();
    reply = ok({ payment: page() });
    await fireEvent.press(onPage().getByLabelText("Pay $49.00 for Gold Monthly"));
    await waitFor(() => { expect(tab.opened).toHaveLength(1); });
    const keys = posts(server.asked, paymentsPath(IRON)).map((a) => (a.body as { requestKey: string }).requestKey);
    expect(keys).toHaveLength(3);
    expect(keys[2]).toBe(keys[1]);
    expect(keys[1]).not.toBe(keys[0]);
  });
});

describe("Android closes the app behind Square's page", () => {
  const store = jest.requireMock<{ kept: Map<string, string> }>("expo-secure-store").kept;
  const RAVI_ID = "7b0c8a52-6f0e-4d59-9a3c-1f2e3d4c5b6a";
  const routes = () => ({
    "/v1/auth/refresh": ok({ tokens: tokens(2) }),
    "/v1/orgs/mine": mine(IRON),
    [membershipPath(IRON)]: ok(view("Iron House")),
    [paymentsPath(IRON)]: (body?: unknown) => (body === undefined ? payments(true, [page()])() : ok({ payment: page() })()),
    [closePath(IRON)]: ok({ payment: page({ state: "closed", url: null, closesAt: null }) }),
  });
  beforeEach(() => {
    store.delete("pay-away");
  });

  it("the place is kept while the tab is up and let go once the page ends", async () => {
    const server = fakeServer({ ...routes(), [paymentsPath(IRON)]: (body?: unknown) => (body === undefined ? payments()() : ok({ payment: page() })()) });
    await openMembership(server.ask, IRON);
    await fireEvent.press(await onPage().findByLabelText("Pay $49.00 for Gold Monthly"));
    await waitFor(() => {
      expect(tab.opened).toHaveLength(1);
    });
    expect(JSON.parse(store.get("pay-away") ?? "{}")).toMatchObject({ userId: RAVI_ID, gymId: IRON.id });
    await backFromTab();
    expect(await onPage().findByText(NOT_PAID)).toBeTruthy();
    expect(store.has("pay-away")).toBe(false);
  });

  it("started again, the app opens that place's My membership, ends the page and says how it went", async () => {
    store.set("pay-away", JSON.stringify({ userId: RAVI_ID, gymId: IRON.id, at: Date.now() - 60_000 }));
    const server = fakeServer(routes());
    await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} />);
    expect(await within(await screen.findByTestId("membership-page")).findByText(NOT_PAID)).toBeTruthy();
    expect(posts(server.asked, closePath(IRON))).toHaveLength(1);
    expect(store.has("pay-away")).toBe(false);
  });

  it("somebody else's, or one older than a page can be open, opens nothing", async () => {
    for (const kept1 of [{ userId: "someone-else", gymId: IRON.id, at: Date.now() }, { userId: RAVI_ID, gymId: IRON.id, at: Date.now() - 16 * 60_000 }]) {
      store.set("pay-away", JSON.stringify(kept1));
      const server = fakeServer({ ...routes(), [paymentsPath(IRON)]: payments() });
      const { unmount } = await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} />);
      expect((await screen.findAllByText("Start Training")).length).toBeGreaterThan(0);
      expect(screen.queryByTestId("membership-page")).toBeNull();
      expect(server.paths().filter((p) => p.includes("/my-membership"))).toEqual([]);
      expect(store.has("pay-away")).toBe(false);
      await unmount();
    }
  });
});
