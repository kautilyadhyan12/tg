import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";
import { APP_PURCHASE_WORDS, AGREEMENT_AGREE_LABEL, type ForSaleLine } from "@app/shared";
import { App } from "../../src/App";
import { BANK_CHECK_DESK, CARD_NOT_TAKEN, CONFIRMING_TITLE, NOT_COMPLETED_TITLE, NOT_READY_BOTH, NOT_READY_CARD, PAID_TITLE } from "../../src/screens/gym/buyView";
import { ADD_CARD, UPDATE_CARD } from "../../src/screens/gym/cardView";
import { PAY_NO_ANSWER, PAY_WAITING } from "../../src/screens/gym/payView";
import type { Ask } from "../../src/session/calls";
import { fakeServer, kept, lost, memoryStore, refusal, tokens, type Reply } from "../kit";
import { GOLD_ID, GOLD_TYPE, PACK_TYPE, lineOf } from "../forSaleLines";

// A repeating membership bought on the phone (ROADMAP Stage 5 item 20i-i; the server's 18k-iv, whose own tests prove it
// charges only the buyer's own card once a press: `appCardPurchases.routes.test.ts`). The phone asks for the repeating
// lines, names the card the server named, asks for the card's own tick in the server's words, and Pay charges that card:
// no Square page opens. Bought is read only from the server's `paid`.

const { tab } = jest.requireMock<{ tab: { opened: { url: string; options: unknown }[]; answer: string; missing: boolean; hold: boolean } }>("../../src/look/browserTabNative");

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

const PURCHASE = "8b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e";
const VISA = { brand: "VISA", last4: "1111" };
const MASTERCARD = { brand: "MASTERCARD", last4: "4444" };

type Row = Record<string, unknown>;
const forSale = (items: ForSaleLine[], over: Row = {}) =>
  ok({ gym: { name: "Iron House" }, record: "own", signer: "person", items, card: { ...VISA, expired: false }, ...over });
const purchase = (over: Row = {}): Row => ({
  id: PURCHASE,
  typeId: GOLD_ID,
  name: "Gold Monthly",
  amountMinor: 4999,
  currency: "USD",
  state: "paid",
  url: null,
  closesAt: null,
  membershipId: "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  receiptNumber: 41,
  ...over,
});
const waiting = purchase({ state: "open", membershipId: null, receiptNumber: null, closesAt: "2026-11-13T10:42:00.000Z" });
const forSalePath = (p: Place) => `/v1/orgs/${p.id}/for-sale`;
const buyPath = (p: Place) => `/v1/orgs/${p.id}/for-sale/purchases`;
const closePath = (p: Place, id = PURCHASE) => `/v1/orgs/${p.id}/for-sale/purchases/${id}/close`;
const myCardPath = (p: Place) => `/v1/orgs/${p.id}/my-card`;
const posts = (asked: { method: string; path: string; body: unknown }[], path: string) => asked.filter((a) => a.method === "POST" && a.path === path);

async function openBuy(ask: Ask) {
  await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
  const tabs = (await screen.findAllByRole("tab"))[3];
  if (tabs === undefined) throw new Error("no fourth tab");
  await fireEvent.press(tabs);
  await fireEvent.press(await screen.findByLabelText("Buy a membership or pack at Iron House"));
}
const onBuy = () => within(screen.getByTestId("buy-page"));
const openGold = async () => {
  await fireEvent.press(await onBuy().findByLabelText("Buy Gold Monthly, $49.99"));
};
const payGold = () => screen.getByLabelText("Pay $49.99 for Gold Monthly");
const disabled = (el: ReturnType<typeof screen.getByLabelText>) => (el.props as { accessibilityState?: { disabled?: boolean } }).accessibilityState?.disabled === true;
/** Signs the gym's agreement and ticks the card's own box. */
async function signAndTick(gold: ForSaleLine) {
  await fireEvent.changeText(await screen.findByLabelText("Full name"), "Asha Walk");
  await fireEvent.press(screen.getByLabelText(AGREEMENT_AGREE_LABEL));
  await fireEvent.press(screen.getByLabelText(gold.charge ?? ""));
}

describe("the worst thing: the card is charged only for what was shown and ticked, once a press", () => {
  it("Pay waits for both ticks, sends the card's tick word for word with today's amount to that place alone, opens no page, and reads bought only on the server's paid", async () => {
    const gold = lineOf(GOLD_TYPE, { card: VISA, factsKey: "d".repeat(64) });
    expect(gold.charge).toBe("I agree that Iron House may charge my Visa ending 1111 $49.99 today, then $49.99 every month from 12 Dec 2026, until my membership ends or I cancel it.");
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON, LOTUS),
      [forSalePath(IRON)]: forSale([gold, lineOf(PACK_TYPE)]),
      [forSalePath(LOTUS)]: forSale([lineOf(GOLD_TYPE, { card: VISA })], { gym: { name: "Lotus Yoga" } }),
      [buyPath(IRON)]: ok({ purchase: purchase() }),
    });
    await openBuy(server.ask);
    // The list is asked with its repeating lines, everywhere it is read.
    const lists = server.asked.filter((a) => a.method === "GET" && a.path === forSalePath(IRON));
    expect(lists.length).toBeGreaterThan(0);
    expect(lists.every((a) => a.search === "?repeating=true")).toBe(true);

    await openGold();
    expect(within(screen.getByTestId("buy-card")).getByText("Visa ending 1111")).toBeTruthy();
    expect(disabled(payGold())).toBe(true);
    expect(screen.getByText(NOT_READY_BOTH)).toBeTruthy();
    // The agreement alone is not enough: the card's own tick is asked for too.
    await fireEvent.changeText(await screen.findByLabelText("Full name"), "Asha Walk");
    await fireEvent.press(screen.getByLabelText(AGREEMENT_AGREE_LABEL));
    expect(disabled(payGold())).toBe(true);
    await fireEvent.press(screen.getByLabelText(gold.charge ?? ""));
    expect(disabled(payGold())).toBe(false);
    expect(screen.getByText("Charged to Visa ending 1111 through Square.")).toBeTruthy();

    await fireEvent.press(payGold());
    const done = within(await screen.findByTestId("buy-paid"));
    expect(screen.getByText(PAID_TITLE)).toBeTruthy();
    expect(done.getByText("$49.99 paid. Gold Monthly is yours. Show your pass at the front desk when you arrive.")).toBeTruthy();
    const presses = posts(server.asked, buyPath(IRON));
    expect(presses).toHaveLength(1);
    expect(presses[0]?.body).toEqual({
      requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      typeId: GOLD_ID,
      amountMinor: 4999,
      factsKey: "d".repeat(64),
      agreement: { agreementId: gold.agreement?.id, signer: "person", name: "Asha Walk" },
      charge: { words: gold.charge, verificationToken: null },
    });
    expect(tab.opened).toEqual([]);
    expect(server.asked.filter((a) => a.method === "POST" && a.path.includes(LOTUS.id))).toEqual([]);
  });

  it("a press whose answer was lost, pressed again, is the same press: one key, so Square charges once", async () => {
    const gold = lineOf(GOLD_TYPE, { card: VISA });
    let answer: () => Reply = lost;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [forSalePath(IRON)]: forSale([gold]),
      [buyPath(IRON)]: () => answer(),
    });
    await openBuy(server.ask);
    await openGold();
    await signAndTick(gold);
    await fireEvent.press(payGold());
    expect(await screen.findByText(PAY_NO_ANSWER)).toBeTruthy();
    expect(screen.queryByTestId("buy-paid")).toBeNull();

    answer = ok({ purchase: purchase() });
    await fireEvent.press(payGold());
    await screen.findByTestId("buy-paid");
    const [first, second] = posts(server.asked, buyPath(IRON)).map((p) => (p.body as { requestKey: string }).requestKey);
    expect(first).toBeDefined();
    expect(second).toBe(first);
  });

  it("Square not answering yet reads Confirming with Check status, never bought, until the server says paid", async () => {
    const gold = lineOf(GOLD_TYPE, { card: VISA });
    let closeAnswer = ok({ purchase: waiting });
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [forSalePath(IRON)]: forSale([gold]),
      [buyPath(IRON)]: ok({ purchase: waiting }),
      [closePath(IRON)]: () => closeAnswer(),
    });
    await openBuy(server.ask);
    await openGold();
    await signAndTick(gold);
    await fireEvent.press(payGold());
    const box = within(await screen.findByTestId("buy-ended"));
    expect(screen.getByText(CONFIRMING_TITLE)).toBeTruthy();
    expect(box.getByText(PAY_WAITING)).toBeTruthy();
    expect(screen.queryByTestId("buy-paid")).toBeNull();
    // Asked straight after the press: only Check status asks Square again.
    expect(posts(server.asked, closePath(IRON))).toHaveLength(0);

    await fireEvent.press(screen.getByText("Check status"));
    await waitFor(() => {
      expect(posts(server.asked, closePath(IRON))).toHaveLength(1);
    });
    expect(screen.queryByTestId("buy-paid")).toBeNull();

    closeAnswer = ok({ purchase: purchase() });
    await fireEvent.press(screen.getByText("Check status"));
    expect(await screen.findByTestId("buy-paid")).toBeTruthy();
  });

  it("a charge Square ended with nothing taken reads not completed and not charged, never cancelled or bought", async () => {
    const gold = lineOf(GOLD_TYPE, { card: VISA });
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [forSalePath(IRON)]: forSale([gold]),
      [buyPath(IRON)]: ok({ purchase: waiting }),
      [closePath(IRON)]: ok({ purchase: purchase({ state: "closed", membershipId: null, receiptNumber: null }) }),
    });
    await openBuy(server.ask);
    await openGold();
    await signAndTick(gold);
    await fireEvent.press(payGold());
    await fireEvent.press(await screen.findByText("Check status"));
    expect(await screen.findByText(CARD_NOT_TAKEN)).toBeTruthy();
    expect(screen.getByText(NOT_COMPLETED_TITLE)).toBeTruthy();
    expect(screen.queryByTestId("buy-paid")).toBeNull();
  });

  it("another card named after the list is read again takes the card's tick away", async () => {
    let card = VISA;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [forSalePath(IRON)]: () => forSale([lineOf(GOLD_TYPE, { card, agreement: false })], { card: { ...card, expired: false } })(),
    });
    await openBuy(server.ask);
    await openGold();
    const visaWords = lineOf(GOLD_TYPE, { card: VISA }).charge ?? "";
    await fireEvent.press(screen.getByLabelText(visaWords));
    expect(disabled(payGold())).toBe(false);

    card = MASTERCARD;
    await appIs("background");
    await appIs("active");
    expect(await within(screen.getByTestId("buy-card")).findByText("Mastercard ending 4444")).toBeTruthy();
    expect(disabled(payGold())).toBe(true);
    expect(screen.getByText(NOT_READY_CARD)).toBeTruthy();
  });
});

describe("what stands in the way of paying with the card", () => {
  it("no card saved: Add card in place of Pay, opening Add card over the page; the list is read again when it closes", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [forSalePath(IRON)]: forSale([lineOf(GOLD_TYPE)], { card: null }),
    });
    await openBuy(server.ask);
    await openGold();
    const first = within(screen.getByTestId("buy-card-first"));
    expect(first.getByText(APP_PURCHASE_WORDS.card_needed)).toBeTruthy();
    expect(screen.queryByLabelText("Pay $49.99 for Gold Monthly")).toBeNull();
    const before = server.asked.filter((a) => a.method === "GET" && a.path === forSalePath(IRON)).length;
    await fireEvent.press(first.getByText(ADD_CARD));
    await waitFor(() => {
      expect(server.asked.some((a) => a.method === "GET" && a.path === myCardPath(IRON))).toBe(true);
    });
    expect(await screen.findByTestId("add-card")).toBeTruthy();
    const closes = screen.getAllByLabelText("Close");
    const close = closes[closes.length - 1];
    if (close === undefined) throw new Error("no Close");
    await fireEvent.press(close);
    await waitFor(() => {
      expect(server.asked.filter((a) => a.method === "GET" && a.path === forSalePath(IRON)).length).toBeGreaterThan(before);
    });
  });

  it("an expired card: Update card in place of Pay; not on the gym's list: no Pay and no card to add", async () => {
    let over: Row = { card: { ...VISA, expired: true } };
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [forSalePath(IRON)]: () => forSale([lineOf(GOLD_TYPE)], over)(),
    });
    await openBuy(server.ask);
    await openGold();
    expect(within(screen.getByTestId("buy-card-first")).getByText(APP_PURCHASE_WORDS.card_expired)).toBeTruthy();
    expect(within(screen.getByTestId("buy-card-first")).getByText(UPDATE_CARD)).toBeTruthy();
    expect(screen.queryByLabelText("Pay $49.99 for Gold Monthly")).toBeNull();

    over = { record: "none", card: null };
    await appIs("background");
    await appIs("active");
    expect(await screen.findByText(APP_PURCHASE_WORDS.card_no_record)).toBeTruthy();
    expect(screen.queryByTestId("buy-card-first")).toBeNull();
    expect(screen.queryByLabelText("Pay $49.99 for Gold Monthly")).toBeNull();
  });

  it("declined: the server's sentence with Update card beside it; the bank asking to confirm sends them to the front desk", async () => {
    const gold = lineOf(GOLD_TYPE, { card: VISA });
    let answer: () => Reply = () => refusal(409, "app_purchase_declined", APP_PURCHASE_WORDS.declined("Visa ending 1111"));
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [forSalePath(IRON)]: forSale([gold]),
      [buyPath(IRON)]: () => answer(),
    });
    await openBuy(server.ask);
    await openGold();
    await signAndTick(gold);
    await fireEvent.press(payGold());
    const said = within(await screen.findByTestId("buy-said"));
    expect(said.getByText("Visa ending 1111 was declined, so nothing was charged. Update your card or try again later.")).toBeTruthy();
    // Update card beside the words, and the card row's own.
    expect(screen.getAllByText(UPDATE_CARD)).toHaveLength(2);
    expect(screen.queryByTestId("buy-paid")).toBeNull();

    answer = () => refusal(409, "app_purchase_verification", APP_PURCHASE_WORDS.verification);
    await fireEvent.press(payGold());
    expect(await screen.findByText(BANK_CHECK_DESK)).toBeTruthy();
    expect(screen.queryByText(APP_PURCHASE_WORDS.verification)).toBeNull();
  });
});
