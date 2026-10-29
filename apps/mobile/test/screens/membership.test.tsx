import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { AppState } from "react-native";
import { myMembershipResponseSchema, receiptSchema } from "@app/shared";
import { App } from "../../src/App";
import type { Ask } from "../../src/session/calls";
import { fakeServer, kept, lost, memoryStore, refusal, tokens, type Reply } from "../kit";

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000" };
const noWait = () => Promise.resolve();
const ok = (body: unknown) => (): Reply => ({ status: 200, body });

type Place = { id: string; name: string; city: string | null; orgType: string; clockFormat: "12h" | "24h" };
const IRON: Place = { id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", name: "Iron House", city: "Pune", orgType: "gym", clockFormat: "12h" };
const LOTUS: Place = { id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d", name: "Lotus Yoga", city: null, orgType: "studio", clockFormat: "24h" };
const org = (gym: Place) => ({
  ...gym,
  slug: gym.name.toLowerCase().replace(" ", "-"),
  timezone: "UTC",
  locale: "en",
  currencyDisplay: "INR",
  status: "active",
  staffRole: null,
  isMember: true,
  joinedAt: "2026-10-01T00:00:00.000Z",
});
const mine = (...gyms: Place[]) => ok({ orgs: gyms.map(org), formerOrgs: [] });

const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, unknown>;
const payment = (receiptNumber: number, over: Row = {}): Row => ({
  amountMinor: 150_000,
  method: "cash",
  paidOn: "2026-10-04",
  covers: { from: "2026-10-04", to: "2026-11-03" },
  receiptNumber,
  refunds: [],
  ...over,
});
const fee = (over: Row = {}): Row => ({ fee: "late_cancel", forName: "Yoga Flow", on: "2026-10-12", amountMinor: 20_000, dueOn: "2026-10-13", state: "due", receiptNumber: null, ...over });
const membership = (id: string, name: string, over: Row = {}): Row => ({
  id,
  name,
  kind: "recurring",
  priceMinor: 150_000,
  currency: "INR",
  status: "active",
  startsOn: "2026-10-04",
  fromList: false,
  endsOn: null,
  renewsOn: "2026-11-04",
  frozenOn: null,
  classesLeft: null,
  packClasses: null,
  owed: null,
  payments: [payment(12)],
  olderPeriodsNotShown: 0,
  fees: [],
  ...over,
});
// Every answer is read through the server's own shape, so a case the server cannot send is not tested here.
const answer = (gym: string, over: Row = {}) =>
  myMembershipResponseSchema.parse({
    gym: { name: gym },
    today: "2026-10-29",
    record: "own",
    paidBy: null,
    memberships: [membership(M1, "Gold Monthly")],
    paysFor: [],
    earlierNotShown: 0,
    purchases: [],
    purchasesNotShown: 0,
    ...over,
  });
const paymentReceipt = (number: number, gym: string, over: Row = {}) =>
  receiptSchema.parse({
    kind: "payment",
    number,
    gym: { name: gym, address: "12 MG Road, Pune" },
    on: "2026-10-04",
    person: "Ravi Kumar",
    personDeleted: false,
    paidBy: null,
    paidByDeleted: false,
    by: null,
    currency: "INR",
    cancelled: false,
    item: { name: "Gold Monthly", covers: { from: "2026-10-04", to: "2026-11-03" }, part: false },
    amounts: { listedMinor: 150_000, discount: null, tax: null, totalMinor: 150_000 },
    joiningFeeMinor: 0,
    changeCredit: null,
    paidMinor: 150_000,
    method: "cash",
    balance: null,
    refunds: [],
    ...over,
  });

const pathOf = (place: Place) => `/v1/orgs/${place.id}/my-membership`;
const receiptOf = (place: Place, number: number) => `${pathOf(place)}/receipts/${String(number)}`;

async function openMembership(ask: Ask, place: Place) {
  await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
  const tab = (await screen.findAllByRole("tab"))[3];
  if (tab === undefined) throw new Error("no fourth tab");
  await fireEvent.press(tab);
  await fireEvent.press(await screen.findByLabelText(`My membership at ${place.name}`));
}
const page = () => within(screen.getByTestId("membership-page"));

describe("the worst thing: nobody else's money on this phone, and no fee reads Paid while it is owed", () => {
  it("each place's page reads and shows only that place's membership, and its receipts open under that place", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON, LOTUS),
      [pathOf(IRON)]: ok(answer("Iron House", { memberships: [membership(M1, "Iron Gold", { payments: [payment(12)] })] })),
      [pathOf(LOTUS)]: ok(answer("Lotus Yoga", { memberships: [membership(M2, "Lotus Ten Classes", { payments: [payment(40)] })] })),
      [receiptOf(LOTUS, 40)]: ok(paymentReceipt(40, "Lotus Yoga", { item: { name: "Lotus Ten Classes", covers: null } })),
    });
    await openMembership(server.ask, LOTUS);
    expect(await page().findByText("Lotus Ten Classes")).toBeTruthy();
    expect(page().queryByText("Iron Gold")).toBeNull();
    expect(server.paths().filter((path) => path.includes("/my-membership"))).toEqual([pathOf(LOTUS)]);

    await fireEvent.press(page().getByLabelText("View receipt #40 for Lotus Ten Classes"));
    expect(await screen.findByText("Receipt #40")).toBeTruthy();
    expect(within(screen.getByTestId("receipt")).getByText("Lotus Yoga")).toBeTruthy();
    expect(server.paths().filter((path) => path.includes("/receipts/"))).toEqual([receiptOf(LOTUS, 40)]);
    await fireEvent.press(screen.getByLabelText("Done"));

    await fireEvent.press(page().getByLabelText("Back"));
    await fireEvent.press(await screen.findByLabelText(`My membership at ${IRON.name}`));
    expect(await page().findByText("Iron Gold")).toBeTruthy();
    expect(page().queryByText("Lotus Ten Classes")).toBeNull();
  });

  it("a page closed before its answer came never shows that answer under the next place", async () => {
    let release: (reply: Reply) => void = () => undefined;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON, LOTUS),
      [pathOf(IRON)]: () =>
        new Promise<Reply>((resolve) => {
          release = resolve;
        }),
      [pathOf(LOTUS)]: ok(answer("Lotus Yoga", { memberships: [membership(M2, "Lotus Ten Classes")] })),
    });
    await openMembership(server.ask, IRON);
    await waitFor(() => {
      expect(server.paths()).toContain(pathOf(IRON));
    });
    await fireEvent.press(page().getByLabelText("Back"));
    await fireEvent.press(await screen.findByLabelText(`My membership at ${LOTUS.name}`));
    expect(await page().findByText("Lotus Ten Classes")).toBeTruthy();
    release({ status: 200, body: answer("Iron House", { memberships: [membership(M1, "Iron Gold")] }) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(page().queryByText("Iron Gold")).toBeNull();
    expect(page().getByText("Lotus Ten Classes")).toBeTruthy();
  });

  it("an owed fee reads Payment due or Overdue with no receipt; only a paid fee reads Paid, with its receipt; a waived one says so", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [pathOf(IRON)]: ok(
        answer("Iron House", {
          memberships: [
            membership(M1, "Gold Monthly", {
              fees: [
                fee({ forName: "Spin at 6", on: "2026-10-20", dueOn: "2026-10-21", state: "due" }),
                fee({ fee: "no_show", forName: "Personal training with Sam Trainer", on: "2026-10-18", amountMinor: 30_000, dueOn: "2026-10-19", state: "overdue" }),
                fee({ forName: "Boxing", on: "2026-10-15", state: "paid", receiptNumber: 31 }),
                fee({ forName: "Yoga Flow", on: "2026-10-10", state: "waived" }),
              ],
            }),
          ],
        }),
      ),
    });
    await openMembership(server.ask, IRON);
    expect(await page().findByText("Fees")).toBeTruthy();
    const due = page().getByText("Late cancel fee · Spin at 6");
    expect(due).toBeTruthy();
    expect(page().getAllByText("Payment due")).toHaveLength(1);
    expect(page().getByText("Due on 21 Oct 2026.")).toBeTruthy();
    expect(page().getByText("No-show fee · Personal training with Sam Trainer")).toBeTruthy();
    expect(page().getByText("₹300.00 · 18 Oct 2026 · Gold Monthly")).toBeTruthy();
    expect(page().getByText("Overdue since 19 Oct 2026.")).toBeTruthy();
    expect(page().getAllByText("Paid")).toHaveLength(1);
    expect(page().getByText("Iron House waived this fee.")).toBeTruthy();
    // One receipt for the membership's payment, one for the paid fee: none for the owed or waived ones.
    expect(page().getAllByText("Receipt")).toHaveLength(2);
    expect(page().getByLabelText("View receipt #31 for Late cancel fee · Boxing")).toBeTruthy();
    expect(page().queryByLabelText(/for Late cancel fee · Spin at 6$/)).toBeNull();
    expect(page().queryByLabelText(/for No-show fee · /)).toBeNull();
    expect(page().queryByLabelText(/for Late cancel fee · Yoga Flow$/)).toBeNull();
  });

  it("somebody paid for reads the dates and who pays, never an amount; the payer reads each person under their own name", async () => {
    const paidFor = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [pathOf(IRON)]: ok(answer("Iron House", { paidBy: "Priya Sharma", memberships: [membership(M1, "Gold Monthly", { priceMinor: null, payments: [] })] })),
    });
    await openMembership(paidFor.ask, IRON);
    expect(await page().findByText("Paid by Priya Sharma. Ask Iron House for the payments and receipts.")).toBeTruthy();
    expect(page().getByText("Started 4 Oct 2026 · Renews 4 Nov 2026")).toBeTruthy();
    expect(page().queryByText(/₹/)).toBeNull();
    expect(page().queryByText("No payments yet.")).toBeNull();
    expect(page().queryByText("Receipt")).toBeNull();
  });

  it("a payer's own membership and the one they pay for are never mixed: each person's payments are under their name", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [pathOf(IRON)]: ok(
        answer("Iron House", {
          memberships: [membership(M1, "Gold Monthly", { payments: [payment(12)] })],
          paysFor: [
            {
              name: "Aarav Sharma",
              memberships: [membership(M2, "Junior Monthly", { payments: [payment(15, { amountMinor: 80_000 })], fees: [fee({ forName: "Junior Judo", state: "overdue" })] })],
              earlierNotShown: 0,
            },
          ],
        }),
      ),
    });
    await openMembership(server.ask, IRON);
    const theirs = within(await page().findByTestId("pays-for-0"));
    expect(theirs.getByText("Aarav Sharma")).toBeTruthy();
    expect(theirs.getByText("You pay for Aarav Sharma’s membership.")).toBeTruthy();
    expect(theirs.getByText("Junior Monthly")).toBeTruthy();
    expect(theirs.getByText("₹800.00 · Cash")).toBeTruthy();
    expect(theirs.queryByText("Gold Monthly")).toBeNull();
    expect(theirs.getByText("Late cancel fee · Junior Judo")).toBeTruthy();
    // The reader's own Fees part is theirs alone: with no fee of their own it is not drawn at all.
    expect(page().queryByText("Fees")).toBeNull();
    expect(page().getAllByText("Late cancel fee · Junior Judo")).toHaveLength(1);
    const own = within(page().getByTestId(`membership-${M1}`));
    expect(own.getByText("₹1,500.00 · Cash")).toBeTruthy();
    expect(own.queryByText("₹800.00 · Cash")).toBeNull();
  });

  it.each([
    ["none", "Iron House hasn’t linked a membership to your account yet. Ask them to, and it shows here."],
    ["shared", "Your membership at Iron House is linked to more than one account, so it isn’t shown here. Ask Iron House to give each person their own."],
  ] as const)("a record %s shows no money and says why", async (record, words) => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      // A record that is not theirs alone carries no money (the server's rule); the page adds none of its own.
      [pathOf(IRON)]: ok(answer("Iron House", { record, memberships: [] })),
    });
    await openMembership(server.ask, IRON);
    expect(await page().findByText(words)).toBeTruthy();
    expect(page().queryByText("Memberships")).toBeNull();
    expect(page().queryByText("Iron House hasn’t added a membership for you here.")).toBeNull();
  });

  it("only the receipt pressed is shown: a second press's answer wins, and an answer under another number is no answer", async () => {
    let releaseFirst: (reply: Reply) => void = () => undefined;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [pathOf(IRON)]: ok(answer("Iron House", { memberships: [membership(M1, "Gold Monthly", { payments: [payment(13, { paidOn: "2026-11-04" }), payment(12)] })] })),
      [receiptOf(IRON, 13)]: () =>
        new Promise<Reply>((resolve) => {
          releaseFirst = resolve;
        }),
      [receiptOf(IRON, 12)]: ok(paymentReceipt(99, "Iron House")),
    });
    await openMembership(server.ask, IRON);
    await fireEvent.press(await page().findByLabelText("View receipt #13 for Gold Monthly"));
    expect(await screen.findByText("Opening the receipt…")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Done"));
    await fireEvent.press(page().getByLabelText("View receipt #12 for Gold Monthly"));
    // #12's answer names another number: never shown as #12.
    expect(await screen.findByText("Couldn’t open this receipt. Try again.")).toBeTruthy();
    expect(screen.queryByTestId("receipt")).toBeNull();
    // #13's late answer is not shown in #12's box.
    releaseFirst({ status: 200, body: paymentReceipt(13, "Iron House") });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText("Receipt #13")).toBeNull();
    expect(screen.getByText("Receipt #12")).toBeTruthy();
  });
});

describe("the My membership page", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("a membership with what is owed, a payment and the refund under it, each opening its receipt", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [pathOf(IRON)]: ok(
        answer("Iron House", {
          memberships: [
            membership(M1, "Gold Monthly", {
              owed: { amountMinor: 150_000, dueOn: "2026-11-04", state: "due" },
              payments: [payment(12, { method: "card_at_desk", refunds: [{ amountMinor: 50_000, method: "cash", refundedOn: "2026-10-10", receiptNumber: 14 }] })],
            }),
          ],
        }),
      ),
      [receiptOf(IRON, 12)]: ok(
        paymentReceipt(12, "Iron House", {
          method: "card_at_desk",
          amounts: { listedMinor: 150_000, discount: null, tax: { name: "GST", bp: 1800, included: true, minor: 22_881 }, totalMinor: 150_000 },
          refunds: [{ number: 14, on: "2026-10-10", amountMinor: 50_000 }],
        }),
      ),
      [receiptOf(IRON, 14)]: ok(
        receiptSchema.parse({
          kind: "refund",
          number: 14,
          gym: { name: "Iron House", address: "12 MG Road, Pune" },
          on: "2026-10-10",
          person: "Ravi Kumar",
          personDeleted: false,
          paidBy: null,
          paidByDeleted: false,
          by: null,
          currency: "INR",
          cancelled: false,
          forReceipt: 12,
          item: { name: "Gold Monthly", covers: { from: "2026-10-04", to: "2026-11-03" } },
          refundedMinor: 50_000,
          method: "cash",
        }),
      ),
    });
    await openMembership(server.ask, IRON);
    const card = within(await page().findByTestId(`membership-${M1}`));
    expect(card.getByText("Active")).toBeTruthy();
    expect(card.getByText("₹1,500.00 due on 4 Nov 2026.")).toBeTruthy();
    expect(card.getByText("₹1,500.00 · Card at the desk")).toBeTruthy();
    expect(card.getByText("Paid 4 Oct 2026 · for 4 Oct – 3 Nov 2026")).toBeTruthy();
    expect(card.getByText("₹500.00 given back · Cash")).toBeTruthy();

    await fireEvent.press(card.getByLabelText("View receipt #12 for Gold Monthly"));
    const receipt = within(await screen.findByTestId("receipt"));
    expect(receipt.getByText("12 MG Road, Pune")).toBeTruthy();
    expect(receipt.getByText("Ravi Kumar")).toBeTruthy();
    expect(receipt.getByText("Gold Monthly, 4 Oct – 3 Nov 2026")).toBeTruthy();
    expect(receipt.getByText("Includes GST 18%")).toBeTruthy();
    expect(receipt.getByText("Paid by card at the desk")).toBeTruthy();
    expect(receipt.getByText("₹500.00 given back on 10 Oct 2026 (refund receipt #14).")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Done"));

    await fireEvent.press(card.getByLabelText("View refund receipt #14 for Gold Monthly"));
    expect(await screen.findByText("Refund receipt #14")).toBeTruthy();
    expect(within(screen.getByTestId("receipt")).getByText("Refund for receipt #12")).toBeTruthy();
    expect(within(screen.getByTestId("receipt")).getByText("Given back by cash")).toBeTruthy();
  });

  it("purchases at the desk, each with its lines, total, receipt and refund; the older ones are said to be kept", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [pathOf(IRON)]: ok(
        answer("Iron House", {
          memberships: [],
          purchases: [
            {
              receiptNumber: 20,
              soldOn: "2026-10-22",
              method: "upi",
              currency: "INR",
              totalMinor: 13_000,
              lines: [
                { name: "Water bottle", quantity: 2, totalMinor: 5_000 },
                { name: "Protein bar", quantity: 1, totalMinor: 8_000 },
              ],
              refunds: [{ amountMinor: 8_000, method: "cash", refundedOn: "2026-10-23", receiptNumber: 21 }],
            },
          ],
          purchasesNotShown: 3,
        }),
      ),
    });
    await openMembership(server.ask, IRON);
    expect(await page().findByText("Iron House hasn’t added a membership for you here.")).toBeTruthy();
    const sale = within(page().getByTestId("purchase-20"));
    expect(sale.getByText("2 × Water bottle")).toBeTruthy();
    expect(sale.getByText("₹130.00")).toBeTruthy();
    expect(sale.getByText("Paid by UPI · 22 Oct 2026")).toBeTruthy();
    expect(sale.getByText("₹80.00 given back · Cash")).toBeTruthy();
    expect(sale.getByLabelText("View receipt #20 for your purchase of Water bottle, Protein bar")).toBeTruthy();
    expect(sale.getByLabelText("View refund receipt #21 for your purchase of Water bottle, Protein bar")).toBeTruthy();
    expect(page().getByText("Older purchases aren’t shown here. Iron House has them.")).toBeTruthy();
  });

  it("a receipt the place does not have says so; a lost connection offers Try again, which opens it", async () => {
    let first = true;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [pathOf(IRON)]: ok(answer("Iron House", { memberships: [membership(M1, "Gold Monthly", { payments: [payment(13, { paidOn: "2026-11-04" }), payment(12)] })] })),
      [receiptOf(IRON, 13)]: () => refusal(404, "receipt_not_found", "That receipt was not found."),
      [receiptOf(IRON, 12)]: () => {
        if (first) {
          first = false;
          return lost();
        }
        return { status: 200, body: paymentReceipt(12, "Iron House") };
      },
    });
    await openMembership(server.ask, IRON);
    await fireEvent.press(await page().findByLabelText("View receipt #13 for Gold Monthly"));
    expect(await screen.findByText("That receipt was not found.")).toBeTruthy();
    expect(within(screen.getByTestId("receipt-failed")).queryByLabelText("Try again")).toBeNull();
    await fireEvent.press(screen.getByLabelText("Done"));

    await fireEvent.press(page().getByLabelText("View receipt #12 for Gold Monthly"));
    expect(await screen.findByText("Couldn’t open this receipt. Try again.")).toBeTruthy();
    await fireEvent.press(within(screen.getByTestId("receipt-failed")).getByLabelText("Try again"));
    expect(await screen.findByTestId("receipt")).toBeTruthy();
  });

  it("a page that cannot be read says so with Try again; a place not showing it says that", async () => {
    let first = true;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON, LOTUS),
      [pathOf(IRON)]: () => {
        if (first) {
          first = false;
          return lost();
        }
        return { status: 200, body: answer("Iron House") };
      },
      [pathOf(LOTUS)]: () => refusal(404, "org_not_found", "Organisation not found."),
    });
    await openMembership(server.ask, IRON);
    expect(await page().findByText("Couldn’t load your membership.")).toBeTruthy();
    await fireEvent.press(page().getByLabelText("Try again"));
    expect(await page().findByText("Gold Monthly")).toBeTruthy();
    await fireEvent.press(page().getByLabelText("Back"));
    await fireEvent.press(await screen.findByLabelText(`My membership at ${LOTUS.name}`));
    expect(await page().findByText("Lotus Yoga isn’t showing your membership right now.")).toBeTruthy();
  });
  it("a membership from the place's own list with nothing paid here says nothing about payments: it is paid in the place's other software", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [pathOf(IRON)]: ok(
        answer("Iron House", {
          memberships: [membership(M1, "Gold Monthly", { fromList: true, payments: [] }), membership(M2, "Silver Monthly", { payments: [] })],
        }),
      ),
    });
    await openMembership(server.ask, IRON);
    const listed = within(await page().findByTestId(`membership-${M1}`));
    expect(listed.getByText("Renews 4 Nov 2026")).toBeTruthy();
    expect(listed.queryByText("No payments yet.")).toBeNull();
    // One staff gave in the app, with nothing paid on it, still says so.
    expect(within(page().getByTestId(`membership-${M2}`)).getByText("No payments yet.")).toBeTruthy();
  });

  it("a page whose place no longer shows it, found when the app comes back, takes the old money off the screen", async () => {
    let gone = false;
    const listeners: ((state: string) => void)[] = [];
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
      listeners.push(handler as (state: string) => void);
      return { remove: () => undefined };
    });
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [pathOf(IRON)]: () => (gone ? refusal(404, "org_not_found", "Organisation not found.") : { status: 200, body: answer("Iron House") }),
    });
    await openMembership(server.ask, IRON);
    expect(await page().findByText("Gold Monthly")).toBeTruthy();
    gone = true;
    await act(() => {
      for (const listener of listeners) listener("active");
    });
    expect(await page().findByText("Iron House isn’t showing your membership right now.")).toBeTruthy();
    expect(page().queryByText("Gold Monthly")).toBeNull();
  });
});
