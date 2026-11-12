import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";
import { APP_PURCHASE_WORDS, AGREEMENT_AGREE_LABEL, myMembershipResponseSchema, type ForSaleLine } from "@app/shared";
import { App } from "../../src/App";
import { BUY_A_MEMBERSHIP, CANCELLED_TITLE, MY_PURCHASES, NOT_READY, NOT_READY_WHO, PAID_TITLE, SHOW_PASS, TO_MEMBERSHIP, VIEW_MEMBERSHIP, WHAT_YOU_GET, nothingForSale } from "../../src/screens/gym/buyView";
import { PAY_CHECK, PAY_NO_ANSWER, PAY_WAITING } from "../../src/screens/gym/payView";

const NOT_CHARGED = "You weren’t charged.";
import { PAY_AWAY } from "../../src/screens/gym/usePayInApp";
import type { Ask } from "../../src/session/calls";
import { fakeServer, kept, lost, memoryStore, refusal, tokens, type Reply } from "../kit";
import { AGREEMENT_ID, ANY_CLASS, DAY_TYPE, PACK_ID, PACK_TYPE, SUMMER_ID, SUMMER_TYPE, lineOf } from "../forSaleLines";

// Buy in the app, on the phone (ROADMAP Stage 5 item 20g). The server works out each line and refuses anything but what it
// showed (`appPurchases.routes.test.ts`); the phone shows Buy only where the place sells something, sends exactly the line
// its page showed, signed as typed, to that place alone, opens Square's page in a tab, and once they are back ends the
// page and says how it ended, reading bought only from the server's own `paid`.

const { tab } = jest.requireMock<{ tab: { opened: { url: string; options: unknown }[]; answer: string; missing: boolean; hold: boolean; close: () => void } }>(
  "../../src/look/browserTabNative",
);

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
const backFromTab = async () => {
  await appIs("background");
  await appIs("active");
};

// A purchase a test left open is kept on the phone, and would be ended as the next test's app starts.
const secureStore = jest.requireMock<{ kept: Map<string, string> }>("expo-secure-store").kept;

beforeEach(() => {
  secureStore.delete("pay-away");
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

const PAGE = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const SQUARE_URL = "https://sandbox.square.link/u/AbCd1234";
const RAVI_ID = "7b0c8a52-6f0e-4d59-9a3c-1f2e3d4c5b6a";

type Row = Record<string, unknown>;
const forSale = (items: ForSaleLine[], over: Row = {}) => ok({ gym: { name: "Iron House" }, record: "own", signer: "person", items, ...over });
const purchase = (over: Row = {}): Row => ({
  id: PAGE,
  typeId: PACK_ID,
  name: "10-class pack",
  amountMinor: 9000,
  currency: "USD",
  state: "open",
  url: SQUARE_URL,
  closesAt: "2026-11-12T10:42:00.000Z",
  membershipId: null,
  receiptNumber: null,
  ...over,
});
const ended = (state: string, over: Row = {}) => ok({ purchase: purchase({ state, url: null, closesAt: null, ...over }) });
const paidAnswer = ended("paid", { membershipId: "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", receiptNumber: 31 });
const forSalePath = (p: Place) => `/v1/orgs/${p.id}/for-sale`;
const buyPath = (p: Place) => `/v1/orgs/${p.id}/for-sale/purchases`;
const closePath = (p: Place, id = PAGE) => `/v1/orgs/${p.id}/for-sale/purchases/${id}/close`;
const membershipPath = (p: Place) => `/v1/orgs/${p.id}/my-membership`;
const noMembership = ok(
  myMembershipResponseSchema.parse({ gym: { name: "Iron House" }, today: "2026-11-12", record: "own", paidBy: null, memberships: [], paysFor: [], earlierNotShown: 0, purchases: [], purchasesNotShown: 0 }),
);
const posts = (asked: { method: string; path: string; body: unknown }[], path: string) => asked.filter((a) => a.method === "POST" && a.path === path);

async function openGym(ask: Ask) {
  await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
  const tabs = (await screen.findAllByRole("tab"))[3];
  if (tabs === undefined) throw new Error("no fourth tab");
  await fireEvent.press(tabs);
}
async function openBuy(ask: Ask, place: Place = IRON) {
  await openGym(ask);
  await fireEvent.press(await screen.findByLabelText(`Buy a membership or pack at ${place.name}`));
}
const onBuy = () => within(screen.getByTestId("buy-page"));
/** Opens a line's page, types the name and ticks. */
async function readAndSign(item: ForSaleLine, name = "Asha Walk") {
  await fireEvent.press(await onBuy().findByLabelText(`Buy ${item.name}, $${(item.priceMinor / 100).toFixed(2)}`));
  await fireEvent.changeText(await screen.findByLabelText("Full name"), name);
  await fireEvent.press(screen.getByLabelText(AGREEMENT_AGREE_LABEL));
}
const payButton = (amount: string, name: string) => screen.getByLabelText(`Pay ${amount} for ${name}`);

describe("the worst thing: never bought unless the server says so, and Pay buys exactly what it showed, at that place", () => {
  it("Pay sends that line, today's amount, its details' key and the signature typed, to that place alone; left unpaid it reads cancelled; bought only once the server says paid", async () => {
    let closeAnswer = ended("closed");
    const pack = lineOf(PACK_TYPE, { factsKey: "c".repeat(64) });
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON, LOTUS),
      [forSalePath(IRON)]: forSale([pack, lineOf(SUMMER_TYPE)]),
      [forSalePath(LOTUS)]: forSale([lineOf(DAY_TYPE)], { gym: { name: "Lotus Yoga" } }),
      [buyPath(IRON)]: ok({ purchase: purchase() }),
      [closePath(IRON)]: () => closeAnswer(),
    });
    await openBuy(server.ask);
    await readAndSign(pack);
    await fireEvent.press(payButton("$90.00", "10-class pack"));
    await waitFor(() => {
      expect(tab.opened).toHaveLength(1);
    });
    expect(tab.opened[0]?.url).toBe(SQUARE_URL);
    const [press] = posts(server.asked, buyPath(IRON));
    expect(press?.body).toEqual({
      requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      typeId: PACK_ID,
      amountMinor: 9000,
      factsKey: "c".repeat(64),
      agreement: { agreementId: AGREEMENT_ID, signer: "person", name: "Asha Walk" },
    });
    expect(server.asked.filter((a) => a.method === "POST" && a.path.includes(LOTUS.id))).toEqual([]);
    expect(screen.getByText(PAY_AWAY)).toBeTruthy();

    await backFromTab();
    // How it ended is the box in the middle of the screen, never bought.
    const endedBox = within(await screen.findByTestId("buy-ended"));
    expect(endedBox.getByText(NOT_CHARGED)).toBeTruthy();
    expect(screen.getByText(CANCELLED_TITLE)).toBeTruthy();
    expect(posts(server.asked, closePath(IRON))).toHaveLength(1);
    expect(screen.queryByText(PAID_TITLE)).toBeNull();
    expect(screen.queryByTestId("buy-paid")).toBeNull();
    await fireEvent.press(screen.getByText("OK"));

    // Paid this time: only then does the page say so.
    closeAnswer = paidAnswer;
    await fireEvent.press(payButton("$90.00", "10-class pack"));
    await waitFor(() => {
      expect(tab.opened).toHaveLength(2);
    });
    expect(screen.queryByText(PAID_TITLE)).toBeNull();
    await backFromTab();
    const done = within(await screen.findByTestId("buy-paid"));
    expect(screen.getByText(PAID_TITLE)).toBeTruthy();
    expect(done.getByText("$90.00 paid. 10-class pack is yours. Show your pass at the front desk when you arrive.")).toBeTruthy();
  });

  it("a page Square may have taken money on reads the front desk's check, never bought", async () => {
    const pack = lineOf(PACK_TYPE);
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [forSalePath(IRON)]: forSale([pack]),
      [buyPath(IRON)]: ok({ purchase: purchase() }),
      [closePath(IRON)]: ended("check"),
    });
    await openBuy(server.ask);
    await readAndSign(pack);
    await fireEvent.press(payButton("$90.00", "10-class pack"));
    await waitFor(() => {
      expect(tab.opened).toHaveLength(1);
    });
    await backFromTab();
    expect(await screen.findByText(PAY_CHECK)).toBeTruthy();
    expect(screen.queryByTestId("buy-paid")).toBeNull();
  });

  it("an answer naming another line, or another page, is never opened or read as this one's", async () => {
    const pack = lineOf(PACK_TYPE);
    let buyAnswer = ok({ purchase: purchase({ typeId: SUMMER_ID }) });
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [forSalePath(IRON)]: forSale([pack]),
      [buyPath(IRON)]: () => buyAnswer(),
      [closePath(IRON)]: ok({ purchase: purchase({ id: "0f1e2d3c-4b5a-4968-8776-655443322110", state: "paid", url: null }) }),
    });
    await openBuy(server.ask);
    await readAndSign(pack);
    await fireEvent.press(payButton("$90.00", "10-class pack"));
    expect(await screen.findByText("Checkout couldn’t open. Try again.")).toBeTruthy();
    expect(tab.opened).toEqual([]);

    buyAnswer = ok({ purchase: purchase() });
    await fireEvent.press(payButton("$90.00", "10-class pack"));
    await waitFor(() => {
      expect(tab.opened).toHaveLength(1);
    });
    await backFromTab();
    expect(await screen.findByText(PAY_NO_ANSWER)).toBeTruthy();
    expect(screen.queryByTestId("buy-paid")).toBeNull();
  });
});

describe("where Buy is, and what a line's page asks", () => {
  it("Buy shows only where the place sells something; My membership with nothing held offers it there too", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON, LOTUS),
      [forSalePath(IRON)]: forSale([lineOf(PACK_TYPE)]),
      [forSalePath(LOTUS)]: forSale([], { gym: { name: "Lotus Yoga" } }),
      [membershipPath(IRON)]: noMembership,
      [membershipPath(LOTUS)]: noMembership,
    });
    await openGym(server.ask);
    expect(await screen.findByLabelText("Buy a membership or pack at Iron House")).toBeTruthy();
    expect(screen.queryByLabelText("Buy a membership or pack at Lotus Yoga")).toBeNull();

    await fireEvent.press(screen.getByLabelText(`My membership at ${LOTUS.name}`));
    expect(await within(screen.getByTestId("membership-page")).findByText("Iron House hasn’t added a membership for you here.")).toBeTruthy();
    expect(within(screen.getByTestId("membership-page")).queryByText(BUY_A_MEMBERSHIP)).toBeNull();
    await fireEvent.press(within(screen.getByTestId("membership-page")).getByLabelText("Back"));

    await fireEvent.press(await screen.findByLabelText(`My membership at ${IRON.name}`));
    await fireEvent.press(await within(screen.getByTestId("membership-page")).findByText(BUY_A_MEMBERSHIP));
    expect(await onBuy().findByText("10-class pack")).toBeTruthy();
    expect(onBuy().getByText("$90.00 for 10 classes")).toBeTruthy();
    expect(onBuy().getByText("Use by 10 Jan 2027")).toBeTruthy();
  });

  it("Pay waits for the name and the tick; under 18 a parent or guardian signs; with no date of birth they choose who", async () => {
    const pack = lineOf(PACK_TYPE);
    let signer = "guardian";
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [forSalePath(IRON)]: () => forSale([pack], { signer })(),
      [buyPath(IRON)]: ok({ purchase: purchase() }),
      [closePath(IRON)]: ended("closed"),
    });
    await openBuy(server.ask);
    await fireEvent.press(await onBuy().findByLabelText("Buy 10-class pack, $90.00"));
    expect(await screen.findByText(APP_PURCHASE_WORDS.guardian_needed)).toBeTruthy();
    expect(screen.getByText(NOT_READY)).toBeTruthy();
    await fireEvent.press(payButton("$90.00", "10-class pack"));
    expect(posts(server.asked, buyPath(IRON))).toEqual([]);
    await fireEvent.changeText(screen.getByLabelText("Parent or guardian’s full name"), "Priya Walk");
    await fireEvent.press(screen.getByLabelText(AGREEMENT_AGREE_LABEL));
    await fireEvent.press(payButton("$90.00", "10-class pack"));
    await waitFor(() => {
      expect(posts(server.asked, buyPath(IRON))).toHaveLength(1);
    });
    expect(posts(server.asked, buyPath(IRON))[0]?.body).toMatchObject({ agreement: { signer: "guardian", name: "Priya Walk" } });
    await backFromTab();
    await fireEvent.press(await screen.findByText("OK"));
    await fireEvent.press(await screen.findByLabelText("Close"));

    signer = "either";
    await appIs("active");
    await fireEvent.press(await onBuy().findByLabelText("Buy 10-class pack, $90.00"));
    expect(await screen.findByText(NOT_READY_WHO)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Full name"), "Asha Walk");
    await fireEvent.press(screen.getByLabelText(AGREEMENT_AGREE_LABEL));
    expect(screen.getByText(NOT_READY_WHO)).toBeTruthy();
    await fireEvent.press(within(screen.getByTestId("buy-line")).getByLabelText("Me"));
    // Choosing who signs asks for the tick again.
    await fireEvent.press(screen.getByLabelText(AGREEMENT_AGREE_LABEL));
    await fireEvent.press(payButton("$90.00", "10-class pack"));
    await waitFor(() => {
      expect(posts(server.asked, buyPath(IRON))).toHaveLength(2);
    });
    expect(posts(server.asked, buyPath(IRON))[1]?.body).toMatchObject({ agreement: { signer: "person", name: "Asha Walk" } });
  });

  it("a gym asking for no agreement: Pay at once, and nothing signed", async () => {
    const day = lineOf(DAY_TYPE, { agreement: false });
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [forSalePath(IRON)]: forSale([day]),
      [buyPath(IRON)]: ok({ purchase: purchase({ typeId: day.typeId, name: "Day pass", amountMinor: 1500 }) }),
      [closePath(IRON)]: ended("paid", { typeId: day.typeId, name: "Day pass", amountMinor: 1500 }),
    });
    await openBuy(server.ask);
    await fireEvent.press(await onBuy().findByLabelText("Buy Day pass, $15.00"));
    expect(screen.queryByLabelText("Full name")).toBeNull();
    await fireEvent.press(payButton("$15.00", "Day pass"));
    await waitFor(() => {
      expect(tab.opened).toHaveLength(1);
    });
    expect(posts(server.asked, buyPath(IRON))[0]?.body).toMatchObject({ agreement: null, amountMinor: 1500 });
    await backFromTab();
    expect(await screen.findByText("$15.00 paid. Day pass is yours. Show your pass at the front desk when you arrive.")).toBeTruthy();
    await fireEvent.press(screen.getByText(VIEW_MEMBERSHIP));
    expect(await screen.findByTestId("membership-page")).toBeTruthy();
  });
});

describe("Kd's click-through: details, the pass, the purchases, and a result nobody misses", () => {
  it("tapping an item opens its details: what it includes, how many classes and until when, and the gym's words", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [forSalePath(IRON)]: forSale([lineOf(PACK_TYPE), lineOf(DAY_TYPE, { included: { ...ANY_CLASS, access: "limited", bookingsLimit: 1, bookingsPeriod: "week", classNames: ["Yoga", "Spin"], includesPt: true } })]),
    });
    await openBuy(server.ask);
    // The list says what each gives.
    expect(await onBuy().findByText("Any class")).toBeTruthy();
    expect(onBuy().getByText("1 class a week")).toBeTruthy();
    expect(onBuy().getByText("Only Yoga, Spin")).toBeTruthy();
    expect(onBuy().getByText("Personal training")).toBeTruthy();
    await fireEvent.press(onBuy().getByLabelText("10-class pack, $90.00. See details"));
    const what = within(await screen.findByTestId("buy-what"));
    expect(what.getByText(WHAT_YOU_GET)).toBeTruthy();
    expect(what.getByText("Any class")).toBeTruthy();
    expect(what.getByText("$90.00 for 10 classes")).toBeTruthy();
    expect(what.getByText("Use by 10 Jan 2027")).toBeTruthy();
    expect(what.getByText("Any class on the timetable.")).toBeTruthy();
  });

  it("bought: Show my pass opens the pass; My purchases and receipts opens My membership", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [forSalePath(IRON)]: forSale([lineOf(DAY_TYPE, { agreement: false })]),
      [buyPath(IRON)]: ok({ purchase: purchase({ typeId: lineOf(DAY_TYPE).typeId, name: "Day pass", amountMinor: 1500 }) }),
      [closePath(IRON)]: ended("paid", { typeId: lineOf(DAY_TYPE).typeId, name: "Day pass", amountMinor: 1500 }),
      [membershipPath(IRON)]: noMembership,
    });
    await openBuy(server.ask);
    await fireEvent.press(await onBuy().findByLabelText(MY_PURCHASES + " at Iron House"));
    expect(await screen.findByTestId("membership-page")).toBeTruthy();
    await fireEvent.press(within(screen.getByTestId("membership-page")).getByLabelText("Back"));
    await fireEvent.press(await screen.findByLabelText("Buy a membership or pack at Iron House"));
    await fireEvent.press(await onBuy().findByLabelText("Buy Day pass, $15.00"));
    await fireEvent.press(payButton("$15.00", "Day pass"));
    await waitFor(() => {
      expect(tab.opened).toHaveLength(1);
    });
    await backFromTab();
    expect(await screen.findByTestId("buy-paid")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(`${SHOW_PASS} at Iron House`));
    await waitFor(() => {
      expect(screen.queryByTestId("buy-page")).toBeNull();
    });
    expect(await screen.findByText("Your pass")).toBeTruthy();
  });
});

describe("what stands in the way, and every way it ends", () => {
  const routes = (over: Record<string, (body?: unknown) => Reply | Promise<Reply>> = {}) => ({
    "/v1/auth/refresh": ok({ tokens: tokens(2) }),
    "/v1/orgs/mine": mine(IRON),
    [forSalePath(IRON)]: forSale([lineOf(PACK_TYPE)]),
    [buyPath(IRON)]: ok({ purchase: purchase() }),
    [closePath(IRON)]: ended("closed"),
    [membershipPath(IRON)]: noMembership,
    ...over,
  });

  it("money owed here: the server's words, and Go to My membership in place of Pay", async () => {
    const owed = APP_PURCHASE_WORDS.owed("$49.00", "Iron House");
    const server = fakeServer(routes({ [buyPath(IRON)]: () => refusal(409, "app_purchase_owed", owed) }));
    await openBuy(server.ask);
    await readAndSign(lineOf(PACK_TYPE));
    await fireEvent.press(payButton("$90.00", "10-class pack"));
    expect(await screen.findByText(owed)).toBeTruthy();
    expect(tab.opened).toEqual([]);
    // Nothing is paid from here, so no line about Square's checkout under the button.
    expect(screen.queryByText("Secure checkout by Square")).toBeNull();
    await fireEvent.press(screen.getByText(TO_MEMBERSHIP));
    expect(await screen.findByTestId("membership-page")).toBeTruthy();
  });

  it("what they read changed: the list is read again and the tick is asked for again on what is shown now", async () => {
    let key = "c";
    const server = fakeServer(
      routes({
        [forSalePath(IRON)]: () => forSale([lineOf(PACK_TYPE, { factsKey: key.repeat(64) })])(),
        [buyPath(IRON)]: () => {
          key = "d";
          return refusal(409, "app_payment_changed", APP_PURCHASE_WORDS.changed);
        },
      }),
    );
    await openBuy(server.ask);
    await readAndSign(lineOf(PACK_TYPE));
    await fireEvent.press(payButton("$90.00", "10-class pack"));
    expect(await screen.findByText(APP_PURCHASE_WORDS.changed)).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText(NOT_READY)).toBeTruthy();
    });
    await fireEvent.press(screen.getByLabelText(AGREEMENT_AGREE_LABEL));
    await fireEvent.press(payButton("$90.00", "10-class pack"));
    await waitFor(() => {
      expect(posts(server.asked, buyPath(IRON))).toHaveLength(2);
    });
    expect(posts(server.asked, buyPath(IRON))[1]?.body).toMatchObject({ factsKey: "d".repeat(64) });
  });

  it("a lost answer sends the same press again, so a page made meanwhile is given back; another name typed is a press of its own", async () => {
    let reply: () => Reply = lost;
    const server = fakeServer(routes({ [buyPath(IRON)]: () => reply() }));
    await openBuy(server.ask);
    await readAndSign(lineOf(PACK_TYPE));
    await fireEvent.press(payButton("$90.00", "10-class pack"));
    expect(await screen.findByText(PAY_NO_ANSWER)).toBeTruthy();
    await fireEvent.press(payButton("$90.00", "10-class pack"));
    expect(await screen.findByText(PAY_NO_ANSWER)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Full name"), "Asha K Walk");
    reply = ok({ purchase: purchase() });
    await fireEvent.press(payButton("$90.00", "10-class pack"));
    await waitFor(() => {
      expect(tab.opened).toHaveLength(1);
    });
    const keys = posts(server.asked, buyPath(IRON)).map((a) => (a.body as { requestKey: string }).requestKey);
    expect(keys).toHaveLength(3);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it("Square not answering yet keeps the page held with Check status, which then reads how it ended", async () => {
    let closeAnswer = ok({ purchase: purchase() });
    const server = fakeServer(routes({ [closePath(IRON)]: () => closeAnswer() }));
    await openBuy(server.ask);
    await readAndSign(lineOf(PACK_TYPE));
    await fireEvent.press(payButton("$90.00", "10-class pack"));
    await waitFor(() => {
      expect(tab.opened).toHaveLength(1);
    });
    await backFromTab();
    expect(await screen.findByText(PAY_WAITING)).toBeTruthy();
    closeAnswer = paidAnswer;
    await fireEvent.press(screen.getByText("Check status"));
    expect(await screen.findByTestId("buy-paid")).toBeTruthy();
    expect(posts(server.asked, closePath(IRON))).toHaveLength(2);
  });

  it("on an iPhone the page stays open while the app goes behind for Apple Pay, and is ended once the tab closes", async () => {
    tab.answer = "cancel";
    tab.hold = true;
    const server = fakeServer(routes({ [closePath(IRON)]: paidAnswer }));
    await openBuy(server.ask);
    await readAndSign(lineOf(PACK_TYPE));
    await fireEvent.press(payButton("$90.00", "10-class pack"));
    await waitFor(() => {
      expect(tab.opened).toHaveLength(1);
    });
    await backFromTab();
    expect(posts(server.asked, closePath(IRON))).toEqual([]);
    expect(screen.getByText(PAY_AWAY)).toBeTruthy();
    await act(() => {
      tab.close();
    });
    expect(await screen.findByTestId("buy-paid")).toBeTruthy();
  });

  it("a place that stopped selling says so with nothing to press", async () => {
    let items = [lineOf(PACK_TYPE)];
    const server = fakeServer(routes({ [forSalePath(IRON)]: () => forSale(items)() }));
    await openBuy(server.ask);
    expect(await onBuy().findByText("10-class pack")).toBeTruthy();
    items = [];
    await appIs("active");
    expect(await onBuy().findByText(nothingForSale("Iron House"))).toBeTruthy();
    expect(onBuy().queryByLabelText(/^Buy /)).toBeNull();
  });
});

describe("Android closes the app behind Square's page", () => {
  const store = secureStore;
  const routes = (close: () => Reply) => ({
    "/v1/auth/refresh": ok({ tokens: tokens(2) }),
    "/v1/orgs/mine": mine(IRON),
    [forSalePath(IRON)]: forSale([lineOf(PACK_TYPE)]),
    [buyPath(IRON)]: ok({ purchase: purchase() }),
    [closePath(IRON)]: close,
    [membershipPath(IRON)]: noMembership,
  });
  it("the purchase is kept while the tab is up and let go once it ends", async () => {
    const server = fakeServer(routes(ended("closed")));
    await openBuy(server.ask);
    await readAndSign(lineOf(PACK_TYPE));
    await fireEvent.press(payButton("$90.00", "10-class pack"));
    await waitFor(() => {
      expect(tab.opened).toHaveLength(1);
    });
    expect(JSON.parse(store.get("pay-away") ?? "{}")).toMatchObject({ userId: RAVI_ID, gymId: IRON.id, purchaseId: PAGE });
    await backFromTab();
    expect(await screen.findByText(NOT_CHARGED)).toBeTruthy();
    expect(store.has("pay-away")).toBe(false);
  });

  it("started again, the app opens that place's Buy, ends that purchase and says how it went", async () => {
    store.set("pay-away", JSON.stringify({ userId: RAVI_ID, gymId: IRON.id, at: Date.now() - 60_000, purchaseId: PAGE }));
    const server = fakeServer(routes(paidAnswer));
    await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} />);
    expect(await screen.findByTestId("buy-page")).toBeTruthy();
    expect(within(await screen.findByTestId("buy-paid")).getByText("$90.00 paid. 10-class pack is yours. Show your pass at the front desk when you arrive.")).toBeTruthy();
    expect(screen.getByText(PAID_TITLE)).toBeTruthy();
    expect(posts(server.asked, closePath(IRON))).toHaveLength(1);
    expect(store.has("pay-away")).toBe(false);
    await fireEvent.press(screen.getByText(VIEW_MEMBERSHIP));
    expect(await screen.findByTestId("membership-page")).toBeTruthy();
  });

  it("started again with the page unpaid, it reads cancelled, never bought", async () => {
    store.set("pay-away", JSON.stringify({ userId: RAVI_ID, gymId: IRON.id, at: Date.now() - 60_000, purchaseId: PAGE }));
    const server = fakeServer(routes(ended("closed")));
    await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} />);
    expect(await within(await screen.findByTestId("buy-ended")).findByText(NOT_CHARGED)).toBeTruthy();
    expect(screen.queryByText(/is yours/)).toBeNull();
  });
});
