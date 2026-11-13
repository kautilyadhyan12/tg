import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { myCancelAskSchema, myKeepAskSchema, myMembershipResponseSchema } from "@app/shared";
import { App } from "../../src/App";
import type { Ask } from "../../src/session/calls";
import { fakeServer, kept, lost, memoryStore, refusal, tokens, type Asked, type Reply } from "../kit";

// Cancel and Keep a membership on the phone (ROADMAP Stage 5 item 20j; the server is 18l's and 18l-ii-a's,
// `myCancel.routes.test.ts`, `myKeep.routes.test.ts`). The server works out every sentence; the phone shows the box it
// sent, sends back that box's key for the membership pressed, says "Cancelled" only on the server's yes, and a press
// whose answer was lost is the same press when pressed again.

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000" };
const noWait = () => Promise.resolve();
const ok = (body: unknown) => (): Reply => ({ status: 200, body });

const IRON = { id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", name: "Iron House", city: "Austin", orgType: "gym", clockFormat: "12h" as const };
const mine = ok({
  orgs: [{ ...IRON, slug: "iron-house", timezone: "UTC", locale: "en", currencyDisplay: "USD", status: "active", staffRole: null, isMember: true, joinedAt: "2026-10-01T00:00:00.000Z" }],
  formerOrgs: [],
});

const GOLD = "11111111-1111-4111-8111-111111111111";
const OFFPEAK = "22222222-2222-4222-8222-222222222222";
const DEV = "33333333-3333-4333-8333-333333333333";
const CANCEL_ID = "44444444-4444-4444-8444-444444444444";
const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);
const KEY_C = "c".repeat(64);

type Row = Record<string, unknown>;
const CAN = { state: "can", button: "Cancel membership" };
const membership = (id: string, name: string, over: Row = {}): Row => ({
  id,
  name,
  kind: "recurring",
  priceMinor: 2500,
  currency: "USD",
  status: "active",
  startsOn: "2026-11-12",
  fromList: false,
  endsOn: null,
  renewsOn: "2026-12-12",
  frozenOn: null,
  classesLeft: null,
  packClasses: null,
  owed: null,
  payments: [],
  olderPeriodsNotShown: 0,
  fees: [],
  cancel: CAN,
  ...over,
});
const myMembership = (over: Row = {}) =>
  myMembershipResponseSchema.parse({
    gym: { name: "Iron House" },
    today: "2026-11-13",
    record: "own",
    paidBy: null,
    memberships: [membership(GOLD, "Gold Monthly"), membership(OFFPEAK, "Off-peak Monthly")],
    paysFor: [],
    earlierNotShown: 0,
    purchases: [],
    purchasesNotShown: 0,
    ...over,
  });
const NO_ENDING = { classes: 0, classesMark: null, sessions: 0, sessionsMark: null };
const choice = (over: Row = {}): Row => ({
  when: "period_end",
  endsOn: "2026-12-11",
  button: "Cancel membership",
  lines: ["Off-peak Monthly ends on 11 Dec 2026, the last day you've paid for.", "Visa ending 1111 won't be charged again."],
  payments: [],
  ending: NO_ENDING,
  feeMinor: null,
  refundMinor: null,
  key: KEY_A,
  ...over,
});
const askOf = (id: string, name: string, choices: Row[], notes: string[] = []) => myCancelAskSchema.parse({ membership: { id, name }, currency: "USD", choices, notes });
const done = (line: string, over: Row = {}) => ({ cancelId: CANCEL_ID, line, endsOn: "2026-12-11", emailed: true, reason: null, ...over });

const membershipPath = `/v1/orgs/${IRON.id}/my-membership`;
const cancelPath = (id: string) => `/v1/orgs/${IRON.id}/my-membership/memberships/${id}/cancel`;
const keepPath = (id: string) => `/v1/orgs/${IRON.id}/my-membership/memberships/${id}/keep`;
const reasonPath = `/v1/orgs/${IRON.id}/my-membership/cancels/${CANCEL_ID}/reason`;
const posts = (asked: Asked[], tail: string) => asked.filter((a) => a.method === "POST" && a.path.endsWith(tail));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function openMembership(ask: Ask) {
  await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
  const tab = (await screen.findAllByRole("tab"))[3];
  if (tab === undefined) throw new Error("no fourth tab");
  await fireEvent.press(tab);
  await fireEvent.press(await screen.findByLabelText(`My membership at ${IRON.name}`));
}
const card = (id: string) => within(screen.getByTestId(`membership-${id}`));
const box = () => within(screen.getByTestId("cancel-box"));
const keepBox = () => within(screen.getByTestId("keep-box"));
/** Opens the Cancel box of one membership. */
const openCancel = async (id: string) => {
  await waitFor(() => {
    expect(screen.getByTestId(`membership-${id}`)).toBeTruthy();
  });
  await fireEvent.press(card(id).getByText("Cancel membership"));
};

/** A server with Gold and Off-peak, both cancellable, and the cancel route handed in. My membership reads cancelled once
 *  `state.cancelled` says so. */
function server(cancel: (body: unknown) => Reply, ask: () => Reply = ok(askOf(OFFPEAK, "Off-peak Monthly", [choice()])), routes: Record<string, (body: unknown) => Reply> = {}) {
  const state = { cancelled: false };
  const s = fakeServer({
    "/v1/auth/refresh": ok({ tokens: tokens(2) }),
    "/v1/orgs/mine": mine,
    [membershipPath]: () => ({
      status: 200,
      body: myMembership(
        state.cancelled
          ? { memberships: [membership(GOLD, "Gold Monthly"), membership(OFFPEAK, "Off-peak Monthly", { cancel: { state: "cancelled", line: "You cancelled it in the app on 13 Nov 2026.", keep: "Keep my membership" } })] }
          : {},
      ),
    }),
    [cancelPath(OFFPEAK)]: (body) => {
      if (body === undefined) return ask();
      const reply = cancel(body);
      if (reply.status === 200) state.cancelled = true;
      return reply;
    },
    [cancelPath(GOLD)]: () => {
      throw new Error("Gold Monthly was never pressed");
    },
    ...routes,
  });
  return { ...s, state };
}

describe("the worst thing: Cancelled is said only for the membership pressed, and only when the server cancelled it", () => {
  it("Off-peak's box is read, nothing changes until its button is pressed, then only Off-peak is cancelled, with the box's own key", async () => {
    const s = server(() => ({ status: 200, body: done("Cancelled. Off-peak Monthly ends on 11 Dec 2026.") }));
    await openMembership(s.ask);
    await openCancel(OFFPEAK);
    expect(await screen.findByText("Cancel Off-peak Monthly?")).toBeTruthy();
    expect(await box().findByText("Off-peak Monthly ends on 11 Dec 2026, the last day you've paid for.")).toBeTruthy();
    expect(box().getByText("Visa ending 1111 won't be charged again.")).toBeTruthy();
    expect(posts(s.asked, "/cancel")).toHaveLength(0);
    expect(screen.queryByText(/^Cancelled\./)).toBeNull();

    await fireEvent.press(box().getByText("Cancel membership"));
    await waitFor(() => {
      expect(screen.getByTestId("cancel-done")).toBeTruthy();
    });
    const sent = posts(s.asked, "/cancel");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.path).toBe(cancelPath(OFFPEAK));
    expect(sent[0]?.body).toEqual({ requestKey: expect.stringMatching(UUID) as unknown, when: "period_end", key: KEY_A });
    expect(within(screen.getByTestId("cancel-done")).getByText("Cancelled. Off-peak Monthly ends on 11 Dec 2026.")).toBeTruthy();
    expect(screen.getByText("A confirmation was emailed to you.")).toBeTruthy();
    expect(screen.getByText("Why are you leaving?")).toBeTruthy();

    // Skip: no reason is sent, and the place says it under Off-peak alone.
    await fireEvent.press(box().getByText("Skip"));
    await waitFor(() => {
      expect(screen.queryByTestId("cancel-box")).toBeNull();
    });
    await waitFor(() => {
      expect(card(OFFPEAK).getByText("Cancelled. Off-peak Monthly ends on 11 Dec 2026.")).toBeTruthy();
    });
    expect(card(OFFPEAK).getByText("Keep my membership")).toBeTruthy();
    expect(card(GOLD).queryByText(/Cancelled/)).toBeNull();
    expect(card(GOLD).getByText("Cancel membership")).toBeTruthy();
    expect(posts(s.asked, "/reason")).toHaveLength(0);
  });

  it.each<[string, () => Reply, string]>([
    ["a card payment going through", () => refusal(409, "card_charge_waiting", "A payment for it is going through right now. Try again in a minute."), "A payment for it is going through right now. Try again in a minute."],
    ["somebody else pays", () => refusal(409, "paid_by_someone", "Dev Rao pays for this membership, so Dev Rao can cancel it in the app. Or ask the front desk."), "Dev Rao pays for this membership, so Dev Rao can cancel it in the app. Or ask the front desk."],
    ["no longer theirs", () => refusal(404, "held_membership_not_found", "Not found"), "This membership isn’t on your list any more."],
    ["too many presses", () => refusal(429, "rate_limited", "Too many requests"), "Too many tries. Please wait a few minutes and try again."],
    ["a server fault", () => refusal(500, "internal", "Internal error"), "Something went wrong. Try again."],
  ])("refused for %s: the box says why, and nothing reads Cancelled", async (_name, reply, line) => {
    const s = server(reply);
    await openMembership(s.ask);
    await openCancel(OFFPEAK);
    await fireEvent.press(await box().findByText("Cancel membership"));
    expect(await within(screen.getByTestId("cancel-problem")).findByText(line)).toBeTruthy();
    expect(screen.queryByTestId("cancel-done")).toBeNull();
    expect(screen.queryByText(/^Cancelled\./)).toBeNull();
    expect(s.state.cancelled).toBe(false);
  });

  it("a lost answer is never said as cancelled; pressed again it is the same press, and then it reads as the server says", async () => {
    let calls = 0;
    const s = server(() => {
      calls += 1;
      return calls === 1 ? lost() : { status: 200, body: done("Cancelled. Off-peak Monthly ends on 11 Dec 2026.") };
    });
    await openMembership(s.ask);
    await openCancel(OFFPEAK);
    await fireEvent.press(await box().findByText("Cancel membership"));
    expect(await box().findByText("Couldn’t connect, so we don’t know if it went through. Check your internet and press it again.")).toBeTruthy();
    expect(screen.queryByTestId("cancel-done")).toBeNull();
    expect(screen.queryByText(/Cancelled\./)).toBeNull();

    await fireEvent.press(box().getByText("Cancel membership"));
    await waitFor(() => {
      expect(screen.getByTestId("cancel-done")).toBeTruthy();
    });
    const sent = posts(s.asked, "/cancel");
    expect(sent).toHaveLength(2);
    expect(sent[1]?.body).toEqual(sent[0]?.body);
  });

  it("a press after a refusal is a new press with a new request key", async () => {
    let calls = 0;
    const s = server(() => {
      calls += 1;
      return calls === 1 ? refusal(409, "card_charge_waiting", "A payment for it is going through right now. Try again in a minute.") : { status: 200, body: done("Cancelled. Off-peak Monthly ends on 11 Dec 2026.") };
    });
    await openMembership(s.ask);
    await openCancel(OFFPEAK);
    await fireEvent.press(await box().findByText("Cancel membership"));
    await box().findByText("A payment for it is going through right now. Try again in a minute.");
    await fireEvent.press(box().getByText("Cancel membership"));
    await waitFor(() => {
      expect(screen.getByTestId("cancel-done")).toBeTruthy();
    });
    const [first, second] = posts(s.asked, "/cancel").map((a) => a.body as { requestKey: string });
    expect(first?.requestKey).not.toBe(second?.requestKey);
  });
});

describe("the box says what the server says", () => {
  it("what it would cancel changed: the box says so, reads again, and the next press sends the new key", async () => {
    let reads = 0;
    const s = server(
      (body) => ((body as { key: string }).key === KEY_A ? refusal(409, "cancel_changed", "What you're cancelling has changed. Go back and look again.") : { status: 200, body: done("Cancelled. Off-peak Monthly ends on 11 Jan 2027.") }),
      () => {
        reads += 1;
        return { status: 200, body: askOf(OFFPEAK, "Off-peak Monthly", [reads === 1 ? choice() : choice({ endsOn: "2027-01-11", lines: ["Off-peak Monthly ends on 11 Jan 2027, the last day you've paid for."], key: KEY_B })]) };
      },
    );
    await openMembership(s.ask);
    await openCancel(OFFPEAK);
    await fireEvent.press(await box().findByText("Cancel membership"));
    expect(await box().findByText("What you're cancelling has changed. Go back and look again.")).toBeTruthy();
    expect(await box().findByText("Off-peak Monthly ends on 11 Jan 2027, the last day you've paid for.")).toBeTruthy();
    await fireEvent.press(box().getByText("Cancel membership"));
    await waitFor(() => {
      expect(screen.getByTestId("cancel-done")).toBeTruthy();
    });
    const sent = posts(s.asked, "/cancel").map((a) => a.body as { key: string; requestKey: string });
    expect(sent.map((b) => b.key)).toEqual([KEY_A, KEY_B]);
    expect(sent[0]?.requestKey).not.toBe(sent[1]?.requestKey);
  });

  it("inside a minimum term: two ways, each button sends its own, and the front desk's note is under them", async () => {
    const s = server(
      () => ({ status: 200, body: done("Cancelled. Off-peak Monthly ends today.") }),
      ok(
        askOf(
          OFFPEAK,
          "Off-peak Monthly",
          [
            choice({ when: "contract_end", endsOn: "2027-05-11", lines: ["Your minimum term runs until 11 May 2027, so Off-peak Monthly ends on 11 May 2027."], key: KEY_A }),
            choice({ when: "leave_early", endsOn: "2026-11-13", button: "Cancel early, $50.00 fee", lines: ["Cancel early: you pay the early cancellation fee of $50.00, and Off-peak Monthly ends today."], feeMinor: 5000, key: KEY_B }),
          ],
          ["Moving away, or a medical reason? The front desk can end it sooner."],
        ),
      ),
    );
    await openMembership(s.ask);
    await openCancel(OFFPEAK);
    expect(await box().findByText("Moving away, or a medical reason? The front desk can end it sooner.")).toBeTruthy();
    expect(within(screen.getByTestId("cancel-way-contract_end")).getByText("Cancel membership")).toBeTruthy();
    await fireEvent.press(within(screen.getByTestId("cancel-way-leave_early")).getByText("Cancel early, $50.00 fee"));
    await waitFor(() => {
      expect(screen.getByTestId("cancel-done")).toBeTruthy();
    });
    expect(posts(s.asked, "/cancel")[0]?.body).toMatchObject({ when: "leave_early", key: KEY_B });
  });

  it("nothing to press: the note says why, and only Close is left", async () => {
    const s = server(() => ({ status: 200, body: done("x") }), ok(askOf(OFFPEAK, "Off-peak Monthly", [], ["You've paid for days after it would end, so the front desk cancels it. Ask them."])));
    await openMembership(s.ask);
    await openCancel(OFFPEAK);
    expect(await box().findByText("You've paid for days after it would end, so the front desk cancels it. Ask them.")).toBeTruthy();
    expect(box().queryByText("Cancel membership")).toBeNull();
    expect(box().getByText("Close")).toBeTruthy();
  });

  it("the box could not be read: Try again reads it again", async () => {
    let reads = 0;
    const s = server(
      () => ({ status: 200, body: done("x") }),
      () => {
        reads += 1;
        return reads === 1 ? lost() : { status: 200, body: askOf(OFFPEAK, "Off-peak Monthly", [choice()]) };
      },
    );
    await openMembership(s.ask);
    await openCancel(OFFPEAK);
    expect(await box().findByText("Couldn’t load this. Check your internet and try again.")).toBeTruthy();
    await fireEvent.press(box().getByText("Try again"));
    expect(await box().findByText("Off-peak Monthly ends on 11 Dec 2026, the last day you've paid for.")).toBeTruthy();
  });

  it("a box for another membership is never shown as this one's", async () => {
    const s = server(() => ({ status: 200, body: done("x") }), ok(askOf(GOLD, "Gold Monthly", [choice()])));
    await openMembership(s.ask);
    await openCancel(OFFPEAK);
    expect(await box().findByText("Couldn’t load this. Check your internet and try again.")).toBeTruthy();
    expect(box().queryByText("Cancel membership")).toBeNull();
  });
});

describe("why are you leaving", () => {
  it("a reason picked is sent for that cancel, and the box closes", async () => {
    const s = server(() => ({ status: 200, body: done("Cancelled. Off-peak Monthly ends on 11 Dec 2026.", { emailed: false }) }), undefined, { [reasonPath]: () => ({ status: 200, body: { reason: "cost" } }) });
    await openMembership(s.ask);
    await openCancel(OFFPEAK);
    await fireEvent.press(await box().findByText("Cancel membership"));
    await fireEvent.press(await box().findByText("Cost"));
    await waitFor(() => {
      expect(screen.queryByTestId("cancel-box")).toBeNull();
    });
    expect(posts(s.asked, "/reason").map((a) => a.body)).toEqual([{ reason: "cost" }]);
    expect(screen.queryByText("A confirmation was emailed to you.")).toBeNull();
  });

  it("a reason that could not be sent says so and can be picked again", async () => {
    let calls = 0;
    const s = server(() => ({ status: 200, body: done("Cancelled. Off-peak Monthly ends on 11 Dec 2026.") }), undefined, {
      [reasonPath]: () => {
        calls += 1;
        return calls === 1 ? lost() : { status: 200, body: { reason: "moving" } };
      },
    });
    await openMembership(s.ask);
    await openCancel(OFFPEAK);
    await fireEvent.press(await box().findByText("Cancel membership"));
    await fireEvent.press(await box().findByText("Moving away"));
    expect(await box().findByText("Couldn’t send your answer. Check your internet and try again.")).toBeTruthy();
    await fireEvent.press(box().getByText("Moving away"));
    await waitFor(() => {
      expect(screen.queryByTestId("cancel-box")).toBeNull();
    });
  });
});

describe("who can cancel", () => {
  it("somebody who pays for Dev cancels Dev's membership, sent for Dev's membership alone", async () => {
    const s = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine,
      [membershipPath]: ok(myMembership({ memberships: [membership(GOLD, "Gold Monthly", { cancel: null })], paysFor: [{ name: "Dev Rao", memberships: [membership(DEV, "Teen Monthly")], earlierNotShown: 0 }] })),
      [cancelPath(DEV)]: (body) =>
        body === undefined
          ? { status: 200, body: askOf(DEV, "Teen Monthly", [choice({ lines: ["Dev Rao's Teen Monthly ends on 11 Dec 2026, the last day you've paid for."] })]) }
          : { status: 200, body: done("Cancelled. Dev Rao's Teen Monthly ends on 11 Dec 2026.") },
    });
    await openMembership(s.ask);
    await waitFor(() => {
      expect(screen.getByTestId(`membership-${DEV}`)).toBeTruthy();
    });
    expect(card(GOLD).queryByText("Cancel membership")).toBeNull();
    await fireEvent.press(card(DEV).getByText("Cancel membership"));
    await fireEvent.press(await box().findByText("Cancel membership"));
    await waitFor(() => {
      expect(screen.getByTestId("cancel-done")).toBeTruthy();
    });
    expect(posts(s.asked, "/cancel").map((a) => a.path)).toEqual([cancelPath(DEV)]);
  });

  it("a member somebody else pays for reads who can cancel it, with no button", async () => {
    const line = "Dev's mum pays for this membership, so Dev's mum can cancel it in the app. Or ask the front desk.";
    const s = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine,
      [membershipPath]: ok(myMembership({ memberships: [membership(GOLD, "Gold Monthly", { cancel: { state: "elsewhere", line } })] })),
    });
    await openMembership(s.ask);
    expect(await screen.findByText(line)).toBeTruthy();
    expect(card(GOLD).queryByText("Cancel membership")).toBeNull();
  });
});

describe("keep my membership", () => {
  const keepAsk = (key: string, lines: string[] = ["Your cancellation will be removed, and Off-peak Monthly will keep renewing until you cancel.", "Your next payment of $25.00 will be charged to Visa ending 1111 on 12 Dec 2026."]) =>
    myKeepAskSchema.parse({ membership: { id: OFFPEAK, name: "Off-peak Monthly" }, currency: "USD", choice: { button: "Keep my membership", lines, next: { dueOn: "2026-12-12", amountMinor: 2500 }, feeOffMinor: null, key }, notes: [] });
  const cancelled = (keep: string | null = "Keep my membership") => ({ state: "cancelled", line: "You cancelled it in the app on 13 Nov 2026.", keep });
  const keepServer = (keep: (body: unknown) => Reply, ask: () => Reply = ok(keepAsk(KEY_C))) => {
    const state = { kept: false };
    const s = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine,
      [membershipPath]: () => ({ status: 200, body: myMembership({ memberships: [membership(GOLD, "Gold Monthly"), membership(OFFPEAK, "Off-peak Monthly", { cancel: state.kept ? CAN : cancelled() })] }) }),
      [keepPath(OFFPEAK)]: (body) => {
        if (body === undefined) return ask();
        const reply = keep(body);
        if (reply.status === 200) state.kept = true;
        return reply;
      },
    });
    return { ...s, state };
  };

  it("the cancelled line with Keep my membership; its box names the next payment, and pressing it keeps Off-peak alone with the box's key", async () => {
    const s = keepServer(() => ({ status: 200, body: { line: "Cancellation removed. Off-peak Monthly will keep renewing until you cancel.", emailed: true } }));
    await openMembership(s.ask);
    expect(await screen.findByText("You cancelled it in the app on 13 Nov 2026.")).toBeTruthy();
    await fireEvent.press(card(OFFPEAK).getByText("Keep my membership"));
    expect(await screen.findByText("Keep Off-peak Monthly?")).toBeTruthy();
    expect(await keepBox().findByText("Your next payment of $25.00 will be charged to Visa ending 1111 on 12 Dec 2026.")).toBeTruthy();
    expect(posts(s.asked, "/keep")).toHaveLength(0);

    await fireEvent.press(keepBox().getByText("Keep my membership"));
    await waitFor(() => {
      expect(screen.getByTestId("keep-done")).toBeTruthy();
    });
    const sent = posts(s.asked, "/keep");
    expect(sent.map((a) => a.path)).toEqual([keepPath(OFFPEAK)]);
    expect(sent[0]?.body).toEqual({ requestKey: expect.stringMatching(UUID) as unknown, key: KEY_C });
    await fireEvent.press(keepBox().getByText("Done"));
    await waitFor(() => {
      expect(card(OFFPEAK).getByText("Cancellation removed. Off-peak Monthly will keep renewing until you cancel.")).toBeTruthy();
    });
    await waitFor(() => {
      expect(card(OFFPEAK).getByText("Cancel membership")).toBeTruthy();
    });
  });

  it("a lost answer is never said as kept; pressed again it is the same press", async () => {
    let calls = 0;
    const s = keepServer(() => {
      calls += 1;
      return calls === 1 ? lost() : { status: 200, body: { line: "Cancellation removed. Off-peak Monthly will keep renewing until you cancel.", emailed: false } };
    });
    await openMembership(s.ask);
    await fireEvent.press(await card(OFFPEAK).findByText("Keep my membership"));
    await fireEvent.press(await keepBox().findByText("Keep my membership"));
    expect(await keepBox().findByText("Couldn’t connect, so we don’t know if it went through. Check your internet and press it again.")).toBeTruthy();
    expect(screen.queryByTestId("keep-done")).toBeNull();
    expect(screen.queryByText(/Cancellation removed/)).toBeNull();
    await fireEvent.press(keepBox().getByText("Keep my membership"));
    await waitFor(() => {
      expect(screen.getByTestId("keep-done")).toBeTruthy();
    });
    const sent = posts(s.asked, "/keep");
    expect(sent).toHaveLength(2);
    expect(sent[1]?.body).toEqual(sent[0]?.body);
  });

  it("nothing to keep: the note says why, and only Close is left", async () => {
    const s = keepServer(
      () => ({ status: 200, body: { line: "x", emailed: false } }),
      ok(myKeepAskSchema.parse({ membership: { id: OFFPEAK, name: "Off-peak Monthly" }, currency: "USD", choice: null, notes: ["You've paid the early cancellation fee. Ask the front desk to refund it, then you can keep your membership here."] })),
    );
    await openMembership(s.ask);
    await fireEvent.press(await card(OFFPEAK).findByText("Keep my membership"));
    expect(await keepBox().findByText("You've paid the early cancellation fee. Ask the front desk to refund it, then you can keep your membership here.")).toBeTruthy();
    expect(keepBox().queryByText("Keep my membership")).toBeNull();
    expect(keepBox().getByText("Close")).toBeTruthy();
  });

  it("changed since the box was read: it says so and reads again", async () => {
    let reads = 0;
    const s = keepServer(
      (body) => ((body as { key: string }).key === KEY_C ? refusal(409, "keep_changed", "Something about this membership has changed. Close this and try again.") : { status: 200, body: { line: "Cancellation removed. Off-peak Monthly will keep renewing until you cancel.", emailed: false } }),
      () => {
        reads += 1;
        return { status: 200, body: keepAsk(reads === 1 ? KEY_C : KEY_B, reads === 1 ? undefined : ["Your cancellation will be removed, and Off-peak Monthly will keep renewing until you cancel.", "Your next payment is $30.00 on 12 Dec 2026."]) };
      },
    );
    await openMembership(s.ask);
    await fireEvent.press(await card(OFFPEAK).findByText("Keep my membership"));
    await fireEvent.press(await keepBox().findByText("Keep my membership"));
    expect(await keepBox().findByText("Something about this membership has changed. Close this and try again.")).toBeTruthy();
    expect(await keepBox().findByText("Your next payment is $30.00 on 12 Dec 2026.")).toBeTruthy();
    await fireEvent.press(keepBox().getByText("Keep my membership"));
    await waitFor(() => {
      expect(screen.getByTestId("keep-done")).toBeTruthy();
    });
    expect(posts(s.asked, "/keep").map((a) => (a.body as { key: string }).key)).toEqual([KEY_C, KEY_B]);
  });

  it("a cancel that cannot be kept reads its line with no button", async () => {
    const s = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine,
      [membershipPath]: ok(myMembership({ memberships: [membership(OFFPEAK, "Off-peak Monthly", { cancel: cancelled(null) })] })),
    });
    await openMembership(s.ask);
    expect(await screen.findByText("You cancelled it in the app on 13 Nov 2026.")).toBeTruthy();
    expect(card(OFFPEAK).queryByText("Keep my membership")).toBeNull();
  });
});
