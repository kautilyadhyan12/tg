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
  timezone: "Asia/Kolkata",
  locale: "en",
  currencyDisplay: "INR",
  status: "active",
  staffRole: null,
  isMember: true,
  joinedAt: "2026-10-01T00:00:00.000Z",
});
const mine = (...gyms: Place[]) => ok({ orgs: gyms.map(org), formerOrgs: [] });

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";

type Klass = Record<string, unknown>;
const can = (over: Klass = {}) => ({ book: false, joinWaitlist: false, claim: false, cancel: null, why: null, ...over });
/** One class as the server sends it: 6:30 pm in India on 2 Nov 2026, 12 places. */
const klass = (sessionId: string, className: string, over: Klass = {}): Klass => ({
  sessionId,
  className,
  localDate: "2026-11-02",
  localStartMinute: 18 * 60 + 30,
  timezone: "Asia/Kolkata",
  startsAt: "2026-11-02T13:00:00.000Z",
  minutes: 45,
  cancelled: false,
  places: 12,
  booked: 8,
  waitlisted: 0,
  opensAt: "2026-10-26T13:00:00.000Z",
  freeCancelUntil: "2026-11-02T11:00:00.000Z",
  mine: null,
  can: can({ book: true }),
  online: null,
  fees: null,
  ...over,
});
const week = (classes: Klass[], over: Klass = {}) => ({ week: 0, from: "2026-11-01", to: "2026-11-07", timezone: "Asia/Kolkata", classes, more: false, ...over });
const classesOf = (place: Place) => `/v1/orgs/${place.id}/member-classes`;
const bookingOf = (place: Place, sessionId: string) => `/v1/orgs/${place.id}/class-sessions/${sessionId}/booking`;

async function openClasses(ask: Ask, place: Place) {
  await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
  const tab = (await screen.findAllByRole("tab"))[3];
  if (tab === undefined) throw new Error("no fourth tab");
  await fireEvent.press(tab);
  await fireEvent.press(await screen.findByLabelText(`Classes at ${place.name}`));
}
const classBox = (sessionId: string) => within(screen.getByTestId(`class-${sessionId}`));
const page = () => within(screen.getByTestId("classes-page"));

/** The place's week as the server holds it: a booking's answer is kept, so the page's next read shows it. */
function held(classes: Klass[]) {
  const list = [...classes];
  return {
    read: (): Reply => ({ status: 200, body: week(list) }),
    keep: (booking: Klass): Reply => {
      const at = list.findIndex((one) => one.sessionId === booking.sessionId);
      if (at >= 0) list[at] = booking;
      return { status: 200, body: { booking } };
    },
  };
}

describe("the worst thing: nothing is booked twice, no fee is taken that was not shown, one place's classes are its own", () => {
  it("a Book with no answer is sent again under the same key, so the server books once; an answered one is never reused", async () => {
    let first = true;
    const gym = held([klass(S1, "Spin"), klass(S2, "Yoga")]);
    const bookedAs = (sessionId: string, name: string) =>
      klass(sessionId, name, { booked: 9, mine: { status: "booked", waitlistPlace: null, packCharged: false }, can: can({ cancel: "free" }) });
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [classesOf(IRON)]: gym.read,
      [bookingOf(IRON, S1)]: () => {
        if (first) {
          first = false;
          return lost();
        }
        return gym.keep(bookedAs(S1, "Spin"));
      },
      [bookingOf(IRON, S2)]: () => gym.keep(bookedAs(S2, "Yoga")),
    });
    await openClasses(server.ask, IRON);
    await fireEvent.press(await screen.findByLabelText("Book: Spin, 6:30 PM · 45 min"));
    expect(await classBox(S1).findByText("Can’t connect. Check your internet and try again.")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Book: Spin, 6:30 PM · 45 min"));
    expect(await classBox(S1).findByText("You’re booked")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Book: Yoga, 6:30 PM · 45 min"));
    await waitFor(() => {
      expect(classBox(S2).getByText("You’re booked")).toBeTruthy();
    });

    const books = server.asked.filter((one) => one.method === "POST" && one.path.endsWith("/booking"));
    const keyOf = (i: number) => (books[i]?.body as { requestKey: string } | undefined)?.requestKey;
    expect(books.map((one) => one.path)).toEqual([bookingOf(IRON, S1), bookingOf(IRON, S1), bookingOf(IRON, S2)]);
    expect(keyOf(0)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(keyOf(1)).toBe(keyOf(0));
    expect(keyOf(2)).not.toBe(keyOf(0));
  });

  it("a late cancel sends the very fee the box showed; a changed fee is shown and asked again before anything is sent", async () => {
    const fees = { lateCancelMinor: 50_000, noShowMinor: 80_000, currency: "INR" };
    const late = klass(S1, "Spin", { mine: { status: "booked", waitlistPlace: null, packCharged: false }, can: can({ cancel: "late" }), fees });
    let tries = 0;
    const gym = held([late]);
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [classesOf(IRON)]: gym.read,
      [`${bookingOf(IRON, S1)}/cancel`]: () => {
        tries += 1;
        if (tries === 1) return refusal(409, "late_cancel", "It's too late to cancel for free.", { packCharged: false, feeMinor: 70_000, currency: "INR" });
        return gym.keep({ ...late, mine: { status: "late_cancelled", waitlistPlace: null, packCharged: false }, can: can() });
      },
    });
    await openClasses(server.ask, IRON);
    await fireEvent.press(await screen.findByLabelText("Cancel booking: Spin, 6:30 PM · 45 min"));
    expect(await screen.findByText("Cancel late?")).toBeTruthy();
    expect(screen.getByText(/one-time late cancel fee of ₹500\.00 will be added to your bill/)).toBeTruthy();
    // Nothing is sent until the box's own Yes.
    expect(server.asked.filter((one) => one.path.endsWith("/cancel"))).toHaveLength(0);

    await fireEvent.press(screen.getByLabelText("Cancel booking"));
    expect(await screen.findByText(/one-time late cancel fee of ₹700\.00 will be added to your bill/)).toBeTruthy();
    expect(screen.queryByText(/₹500\.00 will be added/)).toBeNull();
    expect(server.asked.filter((one) => one.path.endsWith("/cancel"))).toHaveLength(1);

    await fireEvent.press(screen.getByLabelText("Cancel booking"));
    expect(await classBox(S1).findByText("Cancelled late.")).toBeTruthy();
    const sent = server.asked.filter((one) => one.path.endsWith("/cancel")).map((one) => one.body);
    expect(sent).toEqual([
      { lateOk: true, feeMinor: 50_000 },
      { lateOk: true, feeMinor: 70_000 },
    ]);
  });

  it("each place's page reads and shows only that place's classes", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON, LOTUS),
      [classesOf(IRON)]: ok(week([klass(S1, "Iron Spin")])),
      [classesOf(LOTUS)]: ok(week([klass(S2, "Lotus Flow")])),
    });
    await openClasses(server.ask, LOTUS);
    expect(await screen.findByText("Lotus Flow")).toBeTruthy();
    expect(screen.queryByText("Iron Spin")).toBeNull();
    expect(server.paths().filter((path) => path.endsWith("/member-classes"))).toEqual([classesOf(LOTUS)]);
    // The gym's own 24-hour clock.
    expect(classBox(S2).getByText("18:30 · 45 min · 4 of 12 places left")).toBeTruthy();

    await fireEvent.press(screen.getByLabelText("Back"));
    await fireEvent.press(await screen.findByLabelText(`Classes at ${IRON.name}`));
    expect(await screen.findByText("Iron Spin")).toBeTruthy();
    expect(screen.queryByText("Lotus Flow")).toBeNull();
  });
});

describe("the Classes page", () => {
  it("a free cancel asks first; Keep it sends nothing; a pack holder is told the class comes back", async () => {
    const booked = klass(S1, "Boxing", { mine: { status: "booked", waitlistPlace: null, packCharged: true }, can: can({ cancel: "free" }) });
    const gym = held([booked]);
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [classesOf(IRON)]: gym.read,
      [`${bookingOf(IRON, S1)}/cancel`]: () => gym.keep({ ...booked, mine: { status: "cancelled", waitlistPlace: null, packCharged: false }, can: can({ book: true }) }),
    });
    await openClasses(server.ask, IRON);
    expect(await classBox(S1).findByText("1 class used from your pack")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Cancel booking: Boxing, 6:30 PM · 45 min"));
    expect(await screen.findByText("Cancel your booking?")).toBeTruthy();
    expect(screen.getByText("Free to cancel until Mon 2 Nov, 4:30 PM. Your pack gets the class back.")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Keep it"));
    expect(server.asked.filter((one) => one.path.endsWith("/cancel"))).toHaveLength(0);

    await fireEvent.press(screen.getByLabelText("Cancel booking: Boxing, 6:30 PM · 45 min"));
    await fireEvent.press(await screen.findByLabelText("Cancel booking"));
    expect(await classBox(S1).findByText("Cancelled.")).toBeTruthy();
    expect(server.asked.find((one) => one.path.endsWith("/cancel"))?.body).toEqual({ lateOk: false });
  });

  it("waiting reads as the waitlist, never as booked, and Claim place takes a free place", async () => {
    const waiting = klass(S1, "HIIT", { booked: 12, waitlisted: 2, mine: { status: "waitlisted", waitlistPlace: 2, packCharged: false }, can: can({ cancel: "free" }) });
    const claimable = klass(S2, "Spin", { booked: 11, waitlisted: 1, mine: { status: "waitlisted", waitlistPlace: 1, packCharged: false }, can: can({ claim: true, cancel: "free" }) });
    const gym = held([waiting, claimable]);
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [classesOf(IRON)]: gym.read,
      [bookingOf(IRON, S2)]: () =>
        gym.keep({ ...claimable, booked: 12, waitlisted: 0, mine: { status: "booked", waitlistPlace: null, packCharged: false }, can: can({ cancel: "free" }) }),
    });
    await openClasses(server.ask, IRON);
    expect(await classBox(S1).findByText("On the waitlist")).toBeTruthy();
    expect(classBox(S1).getByText("Not booked yet · 2nd in line")).toBeTruthy();
    expect(classBox(S1).queryByText("You’re booked")).toBeNull();
    expect(classBox(S1).getByText("6:30 PM · 45 min · Full · 2 on the waitlist")).toBeTruthy();
    expect(classBox(S1).getByLabelText("Leave waitlist: HIIT, 6:30 PM · 45 min")).toBeTruthy();

    expect(classBox(S2).getByText("A place is free. The first person on the waitlist to claim it gets it.")).toBeTruthy();
    await fireEvent.press(classBox(S2).getByLabelText("Claim place: Spin, 6:30 PM · 45 min"));
    expect(await classBox(S2).findByText("You’re booked")).toBeTruthy();
    expect(server.asked.find((one) => one.path === bookingOf(IRON, S2))?.body).toMatchObject({ joinWaitlist: false });
  });

  it("a refusal says the server's own words, and the class is read again", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [classesOf(IRON)]: ok(week([klass(S1, "Spin")])),
      [bookingOf(IRON, S1)]: () => refusal(403, "payment_overdue", "Your payment is overdue. Please pay at the front desk to book."),
    });
    await openClasses(server.ask, IRON);
    await fireEvent.press(await screen.findByLabelText("Book: Spin, 6:30 PM · 45 min"));
    expect(await classBox(S1).findByText("Your payment is overdue. Please pay at the front desk to book.")).toBeTruthy();
    await waitFor(() => {
      expect(server.paths().filter((path) => path === classesOf(IRON))).toHaveLength(2);
    });
  });

  it("a page that cannot be read says so with Try again; a place whose classes are closed to them says that", async () => {
    let answer: () => Reply = lost;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [classesOf(IRON)]: () => answer(),
    });
    await openClasses(server.ask, IRON);
    expect(await screen.findByText("Couldn’t load the classes.")).toBeTruthy();
    answer = () => refusal(404, "org_not_found", "Organisation not found.");
    await fireEvent.press(page().getByLabelText("Try again"));
    expect(await screen.findByText("Iron House’s classes aren’t available right now.")).toBeTruthy();
    answer = ok(week([klass(S1, "Spin")]));
    await fireEvent.press(page().getByLabelText("Try again"));
    expect(await screen.findByText("Spin")).toBeTruthy();
  });

  it("Later and Earlier move a week at a time; an empty week says so", async () => {
    const weeks: string[] = [];
    const server = fakeServer({ "/v1/auth/refresh": ok({ tokens: tokens(2) }), "/v1/orgs/mine": mine(IRON) });
    const ask: Ask = async (url, init) => {
      const where = new URL(url);
      if (where.pathname !== classesOf(IRON)) return server.ask(url, init);
      const n = where.searchParams.get("week") ?? "";
      weeks.push(n);
      const body = n === "0" ? week([klass(S1, "Spin")]) : week([], { week: 1, from: "2026-11-08", to: "2026-11-14" });
      return { ok: true, status: 200, json: () => Promise.resolve(body) };
    };
    await openClasses(ask, IRON);
    expect(await screen.findByText("Next 7 days · 1 Nov – 7 Nov")).toBeTruthy();
    expect(screen.getByLabelText("Earlier").props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByLabelText("Later"));
    expect(await screen.findByText("Iron House has no classes in these 7 days.")).toBeTruthy();
    expect(screen.getByText("8 Nov – 14 Nov")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Earlier"));
    expect(await screen.findByText("Spin")).toBeTruthy();
    expect(weeks).toEqual(["0", "1", "0"]);
  });
});
