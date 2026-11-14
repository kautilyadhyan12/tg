import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { AGREEMENT_AGREE_LABEL, type ForSaleLine } from "@app/shared";
import { App } from "../../src/App";
import { BANK_CLOSED, BANK_NO, BANK_NOT_REACHED, BANK_TITLE, CHARGING, CHECKING_BANK, PAID_TITLE } from "../../src/screens/gym/buyView";
import { UPDATE_CARD } from "../../src/screens/gym/cardView";
import type { Ask } from "../../src/session/calls";
import { fakeServer, kept, memoryStore, tokens, type Reply } from "../kit";
import { GOLD_ID, GOLD_TYPE, lineOf } from "../forSaleLines";
import { CARD_ID, PASS, bankPage, bankPages, bankSays, everyBankPage, forgetBankPages, listCard, passTheBank } from "../bankCheck";

// The bank's check before a repeating membership is charged (ROADMAP Stage 5 item 20i-ii; the server refuses a pass for
// another card, none, or one used before: `appCardPurchases.routes.test.ts`). THE WORST THING here is a card charged that
// the tick does not name, for an amount the bank never saw, or Pay sent when the bank said no: so the check is asked for the
// card and the amount Pay charges, Pay sends nothing until Square hands back its pass for that very card, and a check that
// ends any other way sends nothing.

beforeEach(() => {
  forgetBankPages();
});

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000" };
const noWait = () => Promise.resolve();
const ok = (body: unknown) => (): Reply => ({ status: 200, body });
const IRON = { id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", name: "Iron House", city: "Austin", orgType: "gym", clockFormat: "12h" as const };
const mine = ok({
  orgs: [
    { ...IRON, slug: "iron-house", timezone: "UTC", locale: "en", currencyDisplay: "USD", status: "active", staffRole: null, isMember: true, joinedAt: "2026-10-01T00:00:00.000Z" },
  ],
  formerOrgs: [],
});
const VISA = { brand: "VISA", last4: "1111" };
const PURCHASE = "8b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e";
const paid = {
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
};
const forSalePath = `/v1/orgs/${IRON.id}/for-sale`;
const buyPath = `/v1/orgs/${IRON.id}/for-sale/purchases`;
const presses = (asked: { method: string; path: string; body: unknown }[]) => asked.filter((a) => a.method === "POST" && a.path === buyPath);

function serverFor(gold: ForSaleLine, buy: () => Reply | Promise<Reply> = ok({ purchase: paid })) {
  return fakeServer({
    "/v1/auth/refresh": ok({ tokens: tokens(2) }),
    "/v1/orgs/mine": mine,
    [forSalePath]: ok({ gym: { name: "Iron House" }, record: "own", signer: "person", items: [gold], card: listCard(VISA) }),
    [buyPath]: () => buy(),
  });
}
async function openGoldPage(ask: Ask, gold: ForSaleLine) {
  await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
  const tab = (await screen.findAllByRole("tab"))[3];
  if (tab === undefined) throw new Error("no fourth tab");
  await fireEvent.press(tab);
  await fireEvent.press(await screen.findByLabelText("Buy a membership or pack at Iron House"));
  await fireEvent.press(await within(screen.getByTestId("buy-page")).findByLabelText("Buy Gold Monthly, $49.99"));
  await fireEvent.changeText(await screen.findByLabelText("Full name"), "Asha Walk");
  await fireEvent.press(screen.getByLabelText(AGREEMENT_AGREE_LABEL));
  await fireEvent.press(screen.getByLabelText(gold.charge ?? ""));
}
const pay = async () => {
  await fireEvent.press(screen.getByLabelText("Pay $49.99 for Gold Monthly"));
};
/** What the page asks Square to check, read from the page's own block of data. */
function checked(html: string): unknown {
  const data = /<script type="application\/json" id="form">([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (data === undefined) throw new Error("no data in the page");
  return (JSON.parse(data) as { check: unknown }).check;
}

describe("the worst thing: only the card the tick names, for the amount Pay charges, and only with the bank's yes", () => {
  it("Pay asks the bank about the saved card for today's amount, sends nothing until Square's pass, then sends that pass word for word", async () => {
    const gold = lineOf(GOLD_TYPE, { card: VISA });
    const server = serverFor(gold);
    await openGoldPage(server.ask, gold);
    await pay();
    const page = await bankPage();
    expect(checked(page.props.source.html)).toEqual({ cardId: CARD_ID, amount: "49.99", currencyCode: "USD" });
    expect(page.props.source.baseUrl).toBe("http://localhost:3000/");
    expect(screen.getByText(CHECKING_BANK)).toBeTruthy();
    // Square's page ready: the check starts. Nothing reaches the server while the bank is asked.
    await bankSays({ kind: "ready" });
    expect(presses(server.asked)).toEqual([]);
    await bankSays({ kind: "tall", on: false });
    expect(presses(server.asked)).toEqual([]);
    await bankSays({ kind: "pass", token: PASS });
    await screen.findByTestId("buy-paid");
    expect(screen.getByText(PAID_TITLE)).toBeTruthy();
    expect(presses(server.asked).map((p) => (p.body as { charge: unknown }).charge)).toEqual([{ words: gold.charge, verificationToken: PASS }]);
    expect(bankPages()).toEqual([]);
  });

  it("the bank saying no, the member closing it, Square not answering, or a pass for another card: nothing is sent, and the next press asks the bank again", async () => {
    const gold = lineOf(GOLD_TYPE, { card: VISA });
    const server = serverFor(gold);
    await openGoldPage(server.ask, gold);
    for (const [ends, line] of [
      [[{ kind: "ready" }, { kind: "bank_no" }], BANK_NO],
      [[{ kind: "ready" }, { kind: "not_taken" }], BANK_NOT_REACHED],
      [[{ kind: "blocked" }], BANK_NOT_REACHED],
      // Square's pass names its card: one for another card is never sent.
      [[{ kind: "ready" }, { kind: "pass", token: "ccof:CA4SEsomebodyElse#verf:CA4SEabc" }], BANK_NOT_REACHED],
      [[{ kind: "ready" }, { kind: "pass", token: `${CARD_ID}x#verf:CA4SEabc` }], BANK_NOT_REACHED],
    ] as const) {
      await pay();
      await bankSays(...ends);
      expect(await within(await screen.findByTestId("buy-said")).findByText(line)).toBeTruthy();
      expect(presses(server.asked)).toEqual([]);
      expect(bankPages()).toEqual([]);
    }
    // The bank said no: Update card beside the words.
    expect(everyBankPage()).toHaveLength(5);
    expect(screen.queryByTestId("buy-paid")).toBeNull();

    // A pass Square never hands back for a page that did not start the check is not taken either.
    await pay();
    await bankSays({ kind: "pass", token: PASS });
    expect(presses(server.asked)).toEqual([]);
    await bankSays({ kind: "ready" }, { kind: "pass", token: PASS });
    await screen.findByTestId("buy-paid");
    expect(presses(server.asked)).toHaveLength(1);
  });

  it("where the bank asks, its box rises with the bank's page; closing it sends nothing", async () => {
    const gold = lineOf(GOLD_TYPE, { card: VISA });
    const server = serverFor(gold);
    await openGoldPage(server.ask, gold);
    await pay();
    await bankSays({ kind: "ready" });
    expect(screen.queryByTestId("bank-check-box")).toBeNull();
    await bankSays({ kind: "tall", on: true });
    expect(within(screen.getByTestId("bank-check-box")).getByText(BANK_TITLE)).toBeTruthy();
    const close = screen.getAllByLabelText("Close").at(-1);
    if (close === undefined) throw new Error("no Close");
    await fireEvent.press(close);
    expect(await within(await screen.findByTestId("buy-said")).findByText(BANK_CLOSED)).toBeTruthy();
    expect(bankPages()).toEqual([]);
    expect(presses(server.asked)).toEqual([]);
    // Pay again: a new check, and the bank's yes this time.
    await pay();
    await passTheBank();
    await screen.findByTestId("buy-paid");
    expect(presses(server.asked)).toHaveLength(1);
  });

  it("the bank said no: Update card beside the words; once checked, Pay reads Charging your card", async () => {
    const gold = lineOf(GOLD_TYPE, { card: VISA });
    let release: (reply: Reply) => void = () => undefined;
    const server = serverFor(gold, () => new Promise<Reply>((done) => (release = done)));
    await openGoldPage(server.ask, gold);
    await pay();
    await bankSays({ kind: "ready" }, { kind: "bank_no" });
    await screen.findByText(BANK_NO);
    expect(screen.getAllByText(UPDATE_CARD).length).toBeGreaterThan(1);
    await pay();
    await passTheBank();
    await waitFor(() => {
      expect(screen.getByText(CHARGING)).toBeTruthy();
    });
    release({ status: 200, body: { purchase: paid } });
    await screen.findByTestId("buy-paid");
  });
});
