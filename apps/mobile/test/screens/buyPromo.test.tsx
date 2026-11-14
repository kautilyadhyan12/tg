import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";
import { PROMO_CODE_WORDS, type ForSaleLine } from "@app/shared";
import { App } from "../../src/App";
import { PROMO_CHECKING, PROMO_INSTEAD, PROMO_NOT_CHECKED, PROMO_PRESS_APPLY } from "../../src/screens/gym/buyView";
import type { Ask } from "../../src/session/calls";
import { fakeServer, kept, lost, memoryStore, never, refusal, tokens, type Reply } from "../kit";
import { DAY_ID, DAY_TYPE, GOLD_ID, GOLD_TYPE, PACK_ID, PACK_TYPE, SPRING20, lineOf } from "../forSaleLines";
import { PASS, listCard, passTheBank } from "../bankCheck";

// A promo code on Buy (ROADMAP Stage 5 item 20j; the server's 18k-v, whose own tests prove a code works only where its gym
// meant it and that Square is asked for what the list showed: `appPurchases.promo.routes.test.ts`). The phone sends the
// code typed with the list, shows each line as the server worked it out, and Pay sends the code of the line shown, with
// that line's amount: never the box's words, never a code the line was not worked out with.

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
const mine = ok({ orgs: [org(IRON)], formerOrgs: [] });

const PURCHASE = "8b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e";
const VISA = { brand: "VISA", last4: "1111" };
type Row = Record<string, unknown>;
const view = (items: ForSaleLine[], promo: Row | null = null): Row => ({ gym: { name: "Iron House" }, record: "own", signer: "person", items, card: listCard(VISA), promo });
const forSalePath = `/v1/orgs/${IRON.id}/for-sale`;
const buyPath = `/v1/orgs/${IRON.id}/for-sale/purchases`;
type Asked = { method: string; path: string; search?: string; body: unknown };
const lists = (asked: Asked[]) => asked.filter((a) => a.method === "GET" && a.path === forSalePath);
const presses = (asked: Asked[]) => asked.filter((a) => a.method === "POST" && a.path === buyPath).map((a) => a.body as Row);
const disabled = (el: ReturnType<typeof screen.getByLabelText>) => (el.props as { accessibilityState?: { disabled?: boolean } }).accessibilityState?.disabled === true;

// The pack with the code: 20% off $90.00 is $18.00, so $72.00 today. Day pass, which the code doesn't fit, says so.
const PACK = lineOf(PACK_TYPE, { agreement: false });
const PACK_CODED = lineOf(PACK_TYPE, { agreement: false, promo: SPRING20 });
const DAY = lineOf(DAY_TYPE, { agreement: false });
const DAY_NOT_FOR = lineOf(DAY_TYPE, { agreement: false, promoWords: PROMO_CODE_WORDS.not_for("Day pass") });
const APPLIED = { code: "SPRING20", applied: true, words: null };
/** The server's list, by whether it was asked with SPRING20. */
const byCode =
  (coded: () => Row, plain: () => Row = () => view([PACK, DAY])) =>
  (_body: unknown, search = ""): Reply => ({ status: 200, body: search.includes("code=SPRING20") ? coded() : plain() });
const codedList = () => view([PACK_CODED, DAY_NOT_FOR], APPLIED);
/** Pay's answer: a page left open, so the body is what is checked. */
const notOpened = (): Reply => refusal(409, "app_purchase_too_late", "This can't be bought in the app right now.");

async function openBuy(ask: Ask) {
  await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
  const tabs = (await screen.findAllByRole("tab"))[3];
  if (tabs === undefined) throw new Error("no fourth tab");
  await fireEvent.press(tabs);
  await fireEvent.press(await screen.findByLabelText("Buy a membership or pack at Iron House"));
}
const onBuy = () => within(screen.getByTestId("buy-page"));
const onLine = () => within(screen.getByTestId("buy-line"));
async function typeCode(text: string) {
  await fireEvent.changeText(await screen.findByLabelText("Promo code"), text);
}
async function applyCode(text: string) {
  await typeCode(text);
  await fireEvent.press(screen.getByLabelText("Apply the promo code"));
}
const openPack = async () => {
  await fireEvent.press(await onBuy().findByLabelText("Buy 10-class pack, $90.00"));
};
const closeLine = async () => {
  const close = screen.getAllByLabelText("Close").at(-1);
  if (close === undefined) throw new Error("no Close");
  await fireEvent.press(close);
};

describe("the worst thing: what Pay charges is what the screen showed, with the code it was worked out with", () => {
  it("SPRING20 applied on the pack's page: it reads $72.00 and Pay sends SPRING20 with $72.00; removed, $90.00 and no code", async () => {
    expect(PACK_CODED.firstPayment.amountMinor).toBe(7200);
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine,
      [forSalePath]: byCode(codedList),
      [buyPath]: notOpened,
    });
    await openBuy(server.ask);
    // The list itself has no box: a code is asked for where the member pays.
    expect(onBuy().queryByLabelText("Promo code")).toBeNull();
    await openPack();
    // The code is sent as the gym writes it, whatever the case or spaces it was typed with.
    await applyCode(" spring20 ");
    expect(await screen.findByText("SPRING20 applied")).toBeTruthy();
    expect(lists(server.asked).at(-1)?.search).toBe("?repeating=true&code=SPRING20");
    expect(within(screen.getByTestId("buy-today")).getByText("$72.00")).toBeTruthy();
    expect(within(screen.getByTestId("buy-today")).getByText("SPRING20 · Spring offer: −\u2060$18.00")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Pay $72.00 for 10-class pack"));
    await waitFor(() => {
      expect(presses(server.asked)).toHaveLength(1);
    });
    expect(presses(server.asked)[0]).toEqual({
      requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      typeId: PACK_ID,
      amountMinor: 7200,
      factsKey: PACK_CODED.factsKey,
      agreement: null,
      code: "SPRING20",
    });

    // Removed: the list is read without it, and nothing Pay sends names it.
    await fireEvent.press(screen.getByLabelText("Remove the code SPRING20"));
    expect(await screen.findByLabelText("Pay $90.00 for 10-class pack")).toBeTruthy();
    expect(lists(server.asked).at(-1)?.search).toBe("?repeating=true");
    await fireEvent.press(screen.getByLabelText("Pay $90.00 for 10-class pack"));
    await waitFor(() => {
      expect(presses(server.asked)).toHaveLength(2);
    });
    expect(presses(server.asked)[1]).not.toHaveProperty("code");
    expect(presses(server.asked)[1]?.amountMinor).toBe(9000);
  });

  it("Pay waits while the code is checked, and while a code is typed and not applied", async () => {
    let release: (reply: Reply) => void = () => undefined;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine,
      [forSalePath]: (_body, search = "") =>
        search.includes("code=") ? new Promise<Reply>((done) => (release = done)) : { status: 200, body: view([PACK, DAY]) },
      [buyPath]: notOpened,
    });
    await openBuy(server.ask);
    await openPack();
    // Typed and not applied: Pay can't be pressed on the $90.00 shown, and says what to do.
    await typeCode("SPRING20");
    const pay = screen.getByLabelText("Pay $90.00 for 10-class pack");
    expect(disabled(pay)).toBe(true);
    expect(screen.getByText(PROMO_PRESS_APPLY)).toBeTruthy();
    await fireEvent.press(pay);
    expect(presses(server.asked)).toEqual([]);

    // Applied and on its way: still waiting.
    await fireEvent.press(screen.getByLabelText("Apply the promo code"));
    expect(disabled(screen.getByLabelText("Pay $90.00 for 10-class pack"))).toBe(true);
    expect(screen.getByText(PROMO_CHECKING)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Pay $90.00 for 10-class pack"));
    expect(presses(server.asked)).toEqual([]);

    await act(() => {
      release({ status: 200, body: codedList() });
    });
    const coded = await screen.findByLabelText("Pay $72.00 for 10-class pack");
    expect(disabled(coded)).toBe(false);
    await fireEvent.press(coded);
    await waitFor(() => {
      expect(presses(server.asked)).toHaveLength(1);
    });
    expect(presses(server.asked)[0]).toMatchObject({ amountMinor: 7200, code: "SPRING20" });
  });

  it("a code that fits another line, not this one, says so here and is not sent", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine,
      [forSalePath]: byCode(codedList),
      [buyPath]: notOpened,
    });
    await openBuy(server.ask);
    await fireEvent.press(await onBuy().findByLabelText("Buy Day pass, $15.00"));
    await applyCode("SPRING20");
    expect(await onLine().findByText("This code doesn't apply to Day pass.")).toBeTruthy();
    expect(screen.queryByText("SPRING20 applied")).toBeNull();
    await fireEvent.press(screen.getByLabelText("Pay $15.00 for Day pass"));
    await waitFor(() => {
      expect(presses(server.asked)).toHaveLength(1);
    });
    expect(presses(server.asked)[0]).toMatchObject({ typeId: DAY_ID, amountMinor: 1500 });
    expect(presses(server.asked)[0]).not.toHaveProperty("code");
  });

  it("a monthly membership's card tick is the one worked out with the code, sent word for word with the code; bought, the code is dropped", async () => {
    const gold = lineOf(GOLD_TYPE, { agreement: false, card: VISA, promo: SPRING20 });
    expect(gold.charge).toBe("I agree that Iron House may charge my Visa ending 1111 $39.99 today, then $49.99 every month from 12 Dec 2026, until my membership ends or I cancel it.");
    const plainGold = lineOf(GOLD_TYPE, { agreement: false, card: VISA });
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine,
      [forSalePath]: byCode(() => view([gold], APPLIED), () => view([plainGold])),
      [buyPath]: ok({ purchase: { id: PURCHASE, typeId: GOLD_ID, name: "Gold Monthly", amountMinor: 3999, currency: "USD", state: "paid", url: null, closesAt: null, membershipId: "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", receiptNumber: 41 } }),
    });
    await openBuy(server.ask);
    await fireEvent.press(await onBuy().findByLabelText("Buy Gold Monthly, $49.99"));
    // The tick read before the code is taken away when the amounts change.
    await fireEvent.press(await screen.findByLabelText(plainGold.charge ?? ""));
    await applyCode("SPRING20");
    await screen.findByText("SPRING20 applied");
    expect(disabled(screen.getByLabelText("Pay $39.99 for Gold Monthly"))).toBe(true);
    await fireEvent.press(screen.getByLabelText(gold.charge ?? ""));
    await fireEvent.press(screen.getByLabelText("Pay $39.99 for Gold Monthly"));
    // The card's bank checks the amount worked out with the code (20i-ii).
    const page = await passTheBank();
    expect(page.props.source.html).toContain('"amount":"39.99","currencyCode":"USD"');
    await screen.findByTestId("buy-paid");
    expect(presses(server.asked)[0]).toMatchObject({ amountMinor: 3999, code: "SPRING20", charge: { words: gold.charge, verificationToken: PASS } });
    await waitFor(() => {
      expect(lists(server.asked).at(-1)?.search).toBe("?repeating=true");
    });
  });

  it("closing the page drops the code: the list is read without it, and another line's page starts empty", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine,
      [forSalePath]: byCode(codedList),
      [buyPath]: notOpened,
    });
    await openBuy(server.ask);
    await openPack();
    await applyCode("SPRING20");
    await screen.findByText("SPRING20 applied");
    await closeLine();
    await waitFor(() => {
      expect(lists(server.asked).at(-1)?.search).toBe("?repeating=true");
    });
    expect(await onBuy().findByLabelText("Buy 10-class pack, $90.00")).toBeTruthy();
    expect(onBuy().queryByText("$72.00 today, with the code SPRING20")).toBeNull();
    await openPack();
    expect(await screen.findByLabelText("Promo code")).toBeTruthy();
    expect(screen.queryByText("SPRING20 applied")).toBeNull();
    await fireEvent.press(await screen.findByLabelText("Pay $90.00 for 10-class pack"));
    await waitFor(() => {
      expect(presses(server.asked)).toHaveLength(1);
    });
    expect(presses(server.asked)[0]).not.toHaveProperty("code");
  });
});

describe("a code that takes nothing off says why, in the server's words, and is not sent again", () => {
  // The server's own sentences (18k-v), as a member reads them in checkout software.
  const refusals = [
    PROMO_CODE_WORDS.not_found,
    PROMO_CODE_WORDS.expired,
    PROMO_CODE_WORDS.not_started("1 Dec 2026"),
    PROMO_CODE_WORDS.used_up,
    PROMO_CODE_WORDS.used_by_member,
    PROMO_CODE_WORDS.fits_nothing,
    PROMO_CODE_WORDS.too_many,
  ];
  it.each(refusals)("%s", async (words) => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine,
      [forSalePath]: (_body, search = "") => ({ status: 200, body: view([PACK, DAY], search.includes("code=") ? { code: "SUMMER-20", applied: false, words } : null) }),
      [buyPath]: notOpened,
    });
    await openBuy(server.ask);
    await openPack();
    await applyCode("summer-20");
    expect(await screen.findByText(words)).toBeTruthy();
    expect(lists(server.asked).at(-1)?.search).toBe("?repeating=true&code=SUMMER-20");
    expect(screen.queryByText("SUMMER-20 applied")).toBeNull();
    expect(screen.getByLabelText("Promo code").props).toMatchObject({ value: "SUMMER-20" });
    // Back in the app later, the list is read without it: a refused code is not tried again by itself.
    await appIs("active");
    await waitFor(() => {
      expect(lists(server.asked).at(-1)?.search).toBe("?repeating=true");
    });
    // The refusal is on screen, so Pay is not held back: it charges the full price, with no code.
    await fireEvent.press(screen.getByLabelText("Pay $90.00 for 10-class pack"));
    await waitFor(() => {
      expect(presses(server.asked)).toHaveLength(1);
    });
    expect(presses(server.asked)[0]).not.toHaveProperty("code");
  });

  it("no answer: the code isn't applied and the box says it couldn't be checked", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine,
      [forSalePath]: (_body, search = "") => (search.includes("code=") ? lost() : { status: 200, body: view([PACK, DAY]) }),
    });
    await openBuy(server.ask);
    await openPack();
    await applyCode("SPRING20");
    expect(await screen.findByText(PROMO_NOT_CHECKED)).toBeTruthy();
    expect(screen.queryByText("SPRING20 applied")).toBeNull();
    expect(disabled(screen.getByLabelText("Pay $90.00 for 10-class pack"))).toBe(false);
  });

  it("the code's last use taken while on the page: Pay's refusal reads the list again, which says why, at the full price", async () => {
    let usedUp = false;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine,
      [forSalePath]: byCode(() => (usedUp ? view([PACK, DAY], { code: "SPRING20", applied: false, words: PROMO_CODE_WORDS.used_up }) : codedList())),
      [buyPath]: () => {
        usedUp = true;
        return refusal(409, "app_purchase_promo", PROMO_CODE_WORDS.used_up);
      },
    });
    await openBuy(server.ask);
    await openPack();
    await applyCode("SPRING20");
    await screen.findByText("SPRING20 applied");
    await fireEvent.press(screen.getByLabelText("Pay $72.00 for 10-class pack"));
    expect(await screen.findByLabelText("Pay $90.00 for 10-class pack")).toBeTruthy();
    // The list's own reason, under the box, not only Pay's refusal.
    expect(await within(screen.getByTestId("promo-box")).findByText(PROMO_CODE_WORDS.used_up)).toBeTruthy();
    expect(screen.queryByText("SPRING20 · Spring offer: −\u2060$18.00")).toBeNull();
    expect(screen.queryByText("SPRING20 applied")).toBeNull();
  });

  it("a read with the code that overtakes Apply's and gets no answer: the box says so and Pay is not held back", async () => {
    let tries = 0;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine,
      // Apply's read never answers; the one made on coming back to the app gets nothing.
      [forSalePath]: (_body, search = "") => {
        if (!search.includes("code=")) return { status: 200, body: view([PACK, DAY]) };
        tries += 1;
        return tries === 1 ? never() : lost();
      },
      [buyPath]: notOpened,
    });
    await openBuy(server.ask);
    await openPack();
    await applyCode("SPRING20");
    expect(screen.getByText(PROMO_CHECKING)).toBeTruthy();
    await appIs("active");
    expect(await within(screen.getByTestId("promo-box")).findByText(PROMO_NOT_CHECKED)).toBeTruthy();
    expect(screen.queryByText(PROMO_CHECKING)).toBeNull();
    expect(disabled(screen.getByLabelText("Pay $90.00 for 10-class pack"))).toBe(false);
  });

  it("the page closed while the code is checked: the code is dropped even when the next read gets no answer", async () => {
    // The read made as the page closes gets nothing; the ones before and after answer.
    let failNext = false;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine,
      [forSalePath]: (_body, search = "") => {
        if (search.includes("code=")) return never();
        if (failNext) {
          failNext = false;
          return lost();
        }
        return { status: 200, body: view([PACK, DAY]) };
      },
      [buyPath]: notOpened,
    });
    await openBuy(server.ask);
    await openPack();
    await applyCode("SPRING20");
    failNext = true;
    await closeLine();
    await fireEvent.press(await onBuy().findByLabelText("Buy Day pass, $15.00"));
    expect(screen.queryByText(PROMO_CHECKING)).toBeNull();
    expect(screen.getByLabelText("Promo code").props).toMatchObject({ value: "" });
    expect(disabled(screen.getByLabelText("Pay $15.00 for Day pass"))).toBe(false);
    // Back in the app, the list is asked for without the code dropped.
    await appIs("active");
    await waitFor(() => {
      expect(lists(server.asked).at(-1)?.search).toBe("?repeating=true");
    });
    expect(lists(server.asked).filter((a) => a.search?.includes("code=")).length).toBe(1);
  });

  it("the page closed with the code applied and no answer: the list is not shown with the dropped code, and reads again without it", async () => {
    let failNext = false;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine,
      [forSalePath]: (_body, search = "") => {
        if (search.includes("code=SPRING20")) return { status: 200, body: codedList() };
        if (failNext) {
          failNext = false;
          return lost();
        }
        return { status: 200, body: view([PACK, DAY]) };
      },
      [buyPath]: notOpened,
    });
    await openBuy(server.ask);
    await openPack();
    await applyCode("SPRING20");
    await screen.findByText("SPRING20 applied");
    failNext = true;
    await closeLine();
    expect(await onBuy().findByText("Try again")).toBeTruthy();
    expect(onBuy().queryByText("$72.00 today, with the code SPRING20")).toBeNull();
    await fireEvent.press(onBuy().getByText("Try again"));
    expect(lists(server.asked).at(-1)?.search).toBe("?repeating=true");
    await openPack();
    expect(await screen.findByLabelText("Promo code")).toBeTruthy();
    expect(screen.queryByText("SPRING20 applied")).toBeNull();
    expect(disabled(screen.getByLabelText("Pay $90.00 for 10-class pack"))).toBe(false);
  });

  it("Remove that gets no answer says so beside the code, which stays applied", async () => {
    let removeFails = false;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine,
      [forSalePath]: (_body, search = "") => {
        if (search.includes("code=SPRING20")) return { status: 200, body: codedList() };
        return removeFails ? lost() : { status: 200, body: view([PACK, DAY]) };
      },
      [buyPath]: notOpened,
    });
    await openBuy(server.ask);
    await openPack();
    await applyCode("SPRING20");
    await screen.findByText("SPRING20 applied");
    removeFails = true;
    await fireEvent.press(screen.getByLabelText("Remove the code SPRING20"));
    expect(await within(screen.getByTestId("promo-applied")).findByText(PROMO_NOT_CHECKED)).toBeTruthy();
    expect(screen.getByText("SPRING20 applied")).toBeTruthy();
    expect(disabled(screen.getByLabelText("Pay $72.00 for 10-class pack"))).toBe(false);
  });

  it("used in place of the member's Refer a friend discount, the page says so", async () => {
    const gifted = lineOf(PACK_TYPE, { agreement: false, friendGift: true, promo: SPRING20 });
    expect(gifted.firstPayment.promo?.instead).toBe("Refer a friend");
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine,
      [forSalePath]: byCode(() => view([gifted], APPLIED), () => view([lineOf(PACK_TYPE, { agreement: false, friendGift: true })])),
    });
    await openBuy(server.ask);
    await fireEvent.press(await onBuy().findByLabelText("Buy 10-class pack, $90.00"));
    await applyCode("SPRING20");
    await screen.findByText("SPRING20 applied");
    expect(within(screen.getByTestId("buy-today")).getByText(PROMO_INSTEAD)).toBeTruthy();
    expect(onLine().getByText("SPRING20 applied")).toBeTruthy();
  });
});
