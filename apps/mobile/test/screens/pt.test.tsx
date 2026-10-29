import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
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

const SAM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRIYA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const S1 = "11111111-1111-4111-8111-111111111111";
const INR = { lateCancelMinor: 50_000, noShowMinor: 80_000, currency: "INR" };
const FREE_MINUTES = 120;

// The gym's clock is UTC here, so a day and a minute are read straight off an instant. A day far ahead is free to
// cancel; one an hour from now is inside the free-cancel time, whatever the hour the test runs.
const DAY = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
const soon = new Date(Math.ceil((Date.now() + 60 * 60_000) / 300_000) * 300_000);
const SOON_DAY = soon.toISOString().slice(0, 10);
const SOON_MINUTE = soon.getUTCHours() * 60 + soon.getUTCMinutes();

type Row = Record<string, unknown>;
const day = (localDate: string, over: Row = {}) => ({ localDate, pays: { membership: "10 sessions", sessionsLeft: 3 }, why: null, limit: null, fees: null, ...over });
const trainer = (trainerId: string, name: string, localDate: string, free: number[]) => ({
  trainerId,
  name,
  sessionMinutes: 60,
  days: [{ localDate, free, opensLater: false }],
});
const ptWeek = (localDate: string, over: Row = {}) => ({
  timezone: "UTC",
  today: localDate,
  from: localDate,
  to: localDate,
  lastDay: localDate,
  opensDays: 30,
  freeCancelMinutes: FREE_MINUTES,
  record: "own",
  days: [day(localDate)],
  trainers: [trainer(SAM, "Sam Trainer", localDate, [600, 720]), trainer(PRIYA, "Priya Coach", localDate, [600])],
  sessions: [],
  history: [],
  ...over,
});
const pt = (startMinute: number, localDate: string, over: Row = {}): Row => {
  const startsAt = new Date(Date.parse(`${localDate}T00:00:00Z`) + startMinute * 60_000);
  return {
    id: S1,
    trainerName: "Sam Trainer",
    localDate,
    localStartMinute: startMinute,
    minutes: 60,
    startsAt: startsAt.toISOString(),
    freeCancelUntil: new Date(startsAt.getTime() - FREE_MINUTES * 60_000).toISOString(),
    status: "booked",
    packCharged: true,
    usesLimit: false,
    cancel: "free",
    fees: null,
    fee: null,
    ...over,
  };
};
const ptOf = (place: Place) => `/v1/orgs/${place.id}/member-pt`;

async function openPt(ask: Ask, place: Place) {
  await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
  const tab = (await screen.findAllByRole("tab"))[3];
  if (tab === undefined) throw new Error("no fourth tab");
  await fireEvent.press(tab);
  await fireEvent.press(await screen.findByLabelText(`Personal training at ${place.name}`));
}
const page = () => within(screen.getByTestId("pt-page"));
const books = (asked: { method: string; path: string; body: unknown }[], place: Place) =>
  asked.filter((one) => one.method === "POST" && one.path === `${ptOf(place)}/sessions`);
const keyOf = (one: { body: unknown } | undefined) => (one?.body as { requestKey?: string } | undefined)?.requestKey;

describe("the worst thing: nothing is booked twice, no fee is taken that was not shown, one place's sessions are its own", () => {
  it("a Book with no answer is sent again under the same key, so the server books once; another time gets its own key", async () => {
    let first = true;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [ptOf(IRON)]: ok(ptWeek(DAY)),
      [`${ptOf(IRON)}/sessions`]: (body) => {
        if (first) {
          first = false;
          return lost();
        }
        const asked = body as { startMinute: number };
        return { status: 200, body: { session: pt(asked.startMinute, DAY) } };
      },
    });
    await openPt(server.ask, IRON);
    const label = (time: string, who: string) => new RegExp(`^Book ${time} with ${who}, `);
    await fireEvent.press(await screen.findByLabelText(label("10:00 AM – 11:00 AM", "Sam Trainer")));
    // Pressing a time sends nothing until the box's own yes.
    expect(books(server.asked, IRON)).toHaveLength(0);
    await fireEvent.press(await screen.findByLabelText("Book session"));
    expect(await page().findByText("Can’t connect. Check your internet and try again.")).toBeTruthy();

    await fireEvent.press(screen.getByLabelText(label("10:00 AM – 11:00 AM", "Sam Trainer")));
    await fireEvent.press(await screen.findByLabelText("Book session"));
    expect(await page().findByText(/^Booked: .* · 10:00 AM – 11:00 AM · with Sam Trainer\.$/)).toBeTruthy();

    await fireEvent.press(screen.getByLabelText(label("10:00 AM – 11:00 AM", "Priya Coach")));
    await fireEvent.press(await screen.findByLabelText("Book session"));
    await waitFor(() => {
      expect(books(server.asked, IRON)).toHaveLength(3);
    });
    const sent = books(server.asked, IRON);
    expect(sent.map((one) => (one.body as { trainerId: string }).trainerId)).toEqual([SAM, SAM, PRIYA]);
    expect(keyOf(sent[0])).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(keyOf(sent[1])).toBe(keyOf(sent[0]));
    expect(keyOf(sent[2])).not.toBe(keyOf(sent[0]));
  });

  it("an answered Book's key is never sent again: the same time pressed later is a new booking", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [ptOf(IRON)]: ok(ptWeek(DAY)),
      [`${ptOf(IRON)}/sessions`]: () => refusal(409, "taken", "That time was just booked by somebody else. Pick another."),
    });
    await openPt(server.ask, IRON);
    for (let i = 0; i < 2; i += 1) {
      await fireEvent.press(await screen.findByLabelText(/^Book 12:00 PM – 1:00 PM with Sam Trainer, /));
      await fireEvent.press(await screen.findByLabelText("Book session"));
      expect(await page().findByText("That time was just booked by somebody else. Pick another.")).toBeTruthy();
    }
    const sent = books(server.asked, IRON);
    expect(sent).toHaveLength(2);
    expect(keyOf(sent[1])).not.toBe(keyOf(sent[0]));
  });

  it("a kept key ends when the page is read again: a session cancelled since is never answered to the next press", async () => {
    let first = true;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [ptOf(IRON)]: ok(ptWeek(DAY, { lastDay: "2099-12-31" })),
      [`${ptOf(IRON)}/sessions`]: () => {
        if (first) {
          first = false;
          return lost();
        }
        return { status: 200, body: { session: pt(600, DAY) } };
      },
    });
    await openPt(server.ask, IRON);
    await fireEvent.press(await screen.findByLabelText(/^Book 10:00 AM – 11:00 AM with Sam Trainer, /));
    await fireEvent.press(await screen.findByLabelText("Book session"));
    expect(await page().findByText("Can’t connect. Check your internet and try again.")).toBeTruthy();
    // The page is read again (a week on and back).
    await fireEvent.press(page().getByLabelText("Later"));
    await fireEvent.press(await page().findByLabelText("Earlier"));
    await fireEvent.press(await screen.findByLabelText(/^Book 10:00 AM – 11:00 AM with Sam Trainer, /));
    await fireEvent.press(await screen.findByLabelText("Book session"));
    expect(await page().findByText(/^Booked: /)).toBeTruthy();
    const sent = books(server.asked, IRON);
    expect(sent).toHaveLength(2);
    expect(keyOf(sent[1])).not.toBe(keyOf(sent[0]));
  });

  it("the box before Book names the pack, the late cancel fee and the no-show fee; inside the free-cancel time it says it can't be cancelled for free", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [ptOf(IRON)]: ok(ptWeek(SOON_DAY, { days: [day(SOON_DAY, { fees: INR })], trainers: [trainer(SAM, "Sam Trainer", SOON_DAY, [SOON_MINUTE])] })),
    });
    await openPt(server.ask, IRON);
    await fireEvent.press(await screen.findByLabelText(/^Book .* with Sam Trainer, /));
    expect(await screen.findByText("Book this session?")).toBeTruthy();
    // On the day, and again in the box.
    expect(screen.getAllByText("You have 10 sessions: 3 sessions left. Each booking uses 1 session.")).toHaveLength(2);
    expect(
      screen.getByText(
        "This session starts soon, so it can’t be cancelled for free. If you book and then cancel, Iron House adds a one-time late cancel fee of ₹500.00 to your bill.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("If you don’t come, Iron House adds a one-time no-show fee of ₹800.00 to your bill.")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Not now"));
    expect(books(server.asked, IRON)).toHaveLength(0);
  });

  it("a late cancel sends the very fee the box showed; a changed fee is shown and asked again before anything else is sent", async () => {
    const late = pt(600, DAY, { cancel: "late", packCharged: false, fees: INR });
    let tries = 0;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [ptOf(IRON)]: ok(ptWeek(DAY, { sessions: [late] })),
      [`${ptOf(IRON)}/sessions/${S1}/cancel`]: () => {
        tries += 1;
        if (tries === 1) return refusal(409, "late_cancel", "It's too late to cancel for free.", { packCharged: false, feeMinor: 70_000, currency: "INR" });
        return { status: 200, body: { session: { ...late, status: "late_cancelled", cancel: null, fee: { kind: "late_cancel", amountMinor: 70_000, state: "owed", currency: "INR" } } } };
      },
    });
    await openPt(server.ask, IRON);
    await fireEvent.press(await screen.findByLabelText(/^Cancel session: /));
    expect(await screen.findByText("Cancel late?")).toBeTruthy();
    expect(screen.getByText(/and Iron House adds a one-time late cancel fee of ₹500\.00 to your bill\.$/)).toBeTruthy();
    const cancels = () => server.asked.filter((one) => one.path.endsWith("/cancel"));
    expect(cancels()).toHaveLength(0);

    await fireEvent.press(screen.getByLabelText("Cancel session"));
    expect(await screen.findByText(/and Iron House adds a one-time late cancel fee of ₹700\.00 to your bill\.$/)).toBeTruthy();
    expect(cancels()).toHaveLength(1);
    await fireEvent.press(screen.getByLabelText("Cancel session"));
    expect(await page().findByText("Cancelled late. A one-time late cancel fee of ₹700.00 was added to your bill.")).toBeTruthy();
    expect(cancels().map((one) => one.body)).toEqual([
      { lateOk: true, feeMinor: 50_000 },
      { lateOk: true, feeMinor: 70_000 },
    ]);
  });

  it("a free cancel sends no fee and says no late cancel", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [ptOf(IRON)]: ok(ptWeek(DAY, { sessions: [pt(600, DAY)] })),
      [`${ptOf(IRON)}/sessions/${S1}/cancel`]: () => ({ status: 200, body: { session: pt(600, DAY, { status: "cancelled", cancel: null }) } }),
    });
    await openPt(server.ask, IRON);
    await fireEvent.press(await screen.findByLabelText(/^Cancel session: /));
    expect(await screen.findByText("Cancel your session?")).toBeTruthy();
    expect(screen.getByText(/Cancel now and your pack gets the session back\.$/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Cancel session"));
    expect(await page().findByText("Cancelled.")).toBeTruthy();
    expect(server.asked.filter((one) => one.path.endsWith("/cancel")).map((one) => one.body)).toEqual([{ lateOk: false }]);
  });

  it("each place's page reads and books at that place alone", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON, LOTUS),
      [ptOf(IRON)]: ok(ptWeek(DAY, { trainers: [trainer(SAM, "Sam Trainer", DAY, [600])] })),
      [ptOf(LOTUS)]: ok(ptWeek(DAY, { trainers: [trainer(PRIYA, "Priya Coach", DAY, [600])] })),
      [`${ptOf(LOTUS)}/sessions`]: () => ({ status: 200, body: { session: pt(600, DAY, { trainerName: "Priya Coach" }) } }),
    });
    await openPt(server.ask, LOTUS);
    expect(await page().findByText("Priya Coach")).toBeTruthy();
    expect(page().queryByText("Sam Trainer")).toBeNull();
    // Lotus Yoga keeps a 24-hour clock.
    await fireEvent.press(page().getByLabelText(/^Book 10:00 – 11:00 with Priya Coach, /));
    await fireEvent.press(await screen.findByLabelText("Book session"));
    expect(await page().findByText(/^Booked: .* · 10:00 – 11:00 · with Priya Coach\.$/)).toBeTruthy();
    const pts = server.asked.filter((one) => one.path.includes("/member-pt"));
    expect(pts.every((one) => one.path.startsWith(ptOf(LOTUS)))).toBe(true);
  });
});

describe("the page", () => {
  it("their sessions, the ones over with what happened and the fee owed, and the free time's fees under a coming one", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [ptOf(IRON)]: ok(
        ptWeek(DAY, {
          sessions: [pt(600, DAY, { packCharged: false, fees: INR })],
          history: [
            pt(540, DAY, {
              id: "22222222-2222-4222-8222-222222222222",
              status: "no_show",
              packCharged: false,
              cancel: null,
              fee: { kind: "no_show", amountMinor: 80_000, state: "owed", currency: "INR" },
            }),
          ],
        }),
      ),
    });
    await openPt(server.ask, IRON);
    expect(await page().findByText("Your sessions")).toBeTruthy();
    expect(page().getByText(/^Free to cancel until .*, 8:00 AM\. After that, Iron House charges a one-time late cancel fee of ₹500\.00\.$/)).toBeTruthy();
    expect(page().getByText("If you don’t come, Iron House adds a one-time no-show fee of ₹800.00 to your bill.")).toBeTruthy();
    expect(page().getByText("You missed this session")).toBeTruthy();
    expect(page().getByText("One-time no-show fee ₹800.00 · Payment due")).toBeTruthy();
  });

  it("a day nothing pays for shows its times, none of them a button", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [ptOf(IRON)]: ok(ptWeek(DAY, { days: [day(DAY, { pays: null, why: "no_membership" })] })),
    });
    await openPt(server.ask, IRON);
    expect(await page().findByText("Available times.")).toBeTruthy();
    expect(page().getAllByText("10:00 AM – 11:00 AM")).toHaveLength(2);
    expect(page().queryByLabelText(/^Book /)).toBeNull();
  });

  it("a place with no trainers says so; one that can't be read says so with Try again", async () => {
    let fail = true;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [ptOf(IRON)]: () => {
        if (fail) {
          fail = false;
          return refusal(404, "not_found", "Not found");
        }
        return { status: 200, body: ptWeek(DAY, { trainers: [] }) };
      },
    });
    await openPt(server.ask, IRON);
    expect(await page().findByText("Iron House’s personal training isn’t available right now.")).toBeTruthy();
    await fireEvent.press(page().getByLabelText("Try again"));
    expect(await page().findByText("Iron House has no trainers taking personal training sessions yet.")).toBeTruthy();
  });

  it("Back closes the page", async () => {
    const server = fakeServer({ "/v1/auth/refresh": ok({ tokens: tokens(2) }), "/v1/orgs/mine": mine(IRON), [ptOf(IRON)]: ok(ptWeek(DAY)) });
    await openPt(server.ask, IRON);
    await fireEvent.press(await page().findByLabelText("Back"));
    await waitFor(() => {
      expect(screen.queryByTestId("pt-page")).toBeNull();
    });
  });
});
