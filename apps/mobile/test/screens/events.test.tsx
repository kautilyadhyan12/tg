import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { AppState } from "react-native";
import { File } from "expo-file-system";
import { eventBookingSettings, eventGoing } from "@app/shared";
import { memberGymEventSchema } from "@app/shared";
import { App } from "../../src/App";
import { POSTER_TALLEST, posterHeight } from "../../src/look/sizing";
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

const E1 = "11111111-1111-4111-8111-111111111111";
const E2 = "22222222-2222-4222-8222-222222222222";
const POSTER = "33333333-3333-4333-8333-333333333333";

type Over = Record<string, unknown>;
const can = (over: Over = {}) => ({ come: false, joinWaitlist: false, claim: false, cancel: false, why: null, ...over });
const going = (over: Over = {}) => ({ coming: 0, waiting: 0, mine: null, can: can({ come: true }), ...over });
/** One event as the server sends it: 10 am to 1 pm in India on 2 Nov 2099, 30 places. */
const event = (id: string, name: string, over: Over = {}): Over => ({
  id,
  name,
  details: "",
  place: "",
  startsOn: "2099-11-02",
  startMinute: 600,
  endsOn: "2099-11-02",
  endMinute: 780,
  startsAt: "2099-11-02T04:30:00.000Z",
  endsAt: "2099-11-02T07:30:00.000Z",
  places: 30,
  cancelled: false,
  poster: null,
  going: going(),
  ...over,
});
const listOf = (place: Place, events: Over[], over: Over = {}) => ({
  gymId: place.id,
  gymName: place.name,
  timezone: "Asia/Kolkata",
  today: "2099-10-31",
  status: "shown",
  events,
  ...over,
});
const eventsOf = (place: Place) => `/v1/orgs/${place.id}/events`;
const comingOf = (place: Place, id: string) => `/v1/orgs/${place.id}/events/${id}/coming`;
/** `going` as the server's own rule works it out, so no state appears here that it never sends. */
const realGoing = (o: { mine?: "coming" | "waitlisted" | null; coming?: number; waiting?: number; places?: number | null; cancelled?: boolean; waitlistPlace?: number | null; startsInMs?: number }) =>
  eventGoing({
    nowMs: 0,
    startsAtMs: o.startsInMs ?? 30 * 86_400_000,
    cancelled: o.cancelled ?? false,
    places: o.places === undefined ? 30 : o.places,
    coming: o.coming ?? 0,
    waitlisted: o.waiting ?? 0,
    settings: eventBookingSettings({ handoverMinutes: 1440, waitlistMax: 20 }),
    mine: o.mine ?? null,
    waitlistPlace: o.waitlistPlace ?? null,
  });
const youreComing = (id: string, name: string, over: Over = {}) =>
  event(id, name, { going: going({ coming: 1, mine: { status: "coming", waitlistPlace: null }, can: can({ cancel: true }) }), ...over });

/** The gym's events as the server holds them: an answer is kept, so the next read shows it. */
function held(place: Place, events: Over[]) {
  const list = [...events];
  return {
    read: (): Reply => ({ status: 200, body: listOf(place, list) }),
    keep: (changed: Over): Reply => {
      const at = list.findIndex((one) => one.id === changed.id);
      if (at >= 0) list[at] = changed;
      return { status: 200, body: { event: changed } };
    },
  };
}

async function openEvents(ask: Ask, place: Place) {
  await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
  const tab = (await screen.findAllByRole("tab"))[3];
  if (tab === undefined) throw new Error("no fourth tab");
  await fireEvent.press(tab);
  await fireEvent.press(await screen.findByLabelText(`Events at ${place.name}`));
}
const box = (id: string) => within(screen.getByTestId(`event-${id}`));
const page = () => within(screen.getByTestId("events-page"));
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 30)));
const download = jest.mocked(File.downloadFileAsync);
const lands = download.getMockImplementation();
afterEach(() => {
  download.mockClear();
  download.mockImplementation(lands);
  jest.restoreAllMocks();
});
function listenForComeBack(): () => Promise<void> {
  const listeners: ((state: string) => void)[] = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
    listeners.push(handler as (state: string) => void);
    return { remove: () => undefined };
  });
  return async () => {
    await act(() => {
      for (const one of listeners) one("active");
    });
  };
}
type Asked = { method?: string; path: string; body?: unknown };
const presses = (server: { asked: Asked[] }) => server.asked.filter((one) => one.method === "POST" && one.path.endsWith("/coming"));
const keyOf = (one: Asked) => (one.body as { requestKey: string }).requestKey;

describe("the worst thing: You're booked only when the server holds a place, and one gym's events are its own", () => {
  it("Book with no answer never says You're booked; the same key goes again, and only the server's answer says it", async () => {
    let first = true;
    const gym = held(IRON, [event(E1, "Open day")]);
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [eventsOf(IRON)]: gym.read,
      [comingOf(IRON, E1)]: () => {
        if (first) {
          first = false;
          return lost();
        }
        return gym.keep(youreComing(E1, "Open day"));
      },
    });
    await openEvents(server.ask, IRON);
    await fireEvent.press(await screen.findByLabelText("Book: Open day"));
    expect(await box(E1).findByText("Can’t connect. Check your internet and try again.")).toBeTruthy();
    expect(box(E1).queryByText("You’re booked")).toBeNull();
    await fireEvent.press(screen.getByLabelText("Book: Open day"));
    expect(await box(E1).findByText("You’re booked")).toBeTruthy();
    const sent = presses(server);
    expect(sent.length).toBe(2);
    const [one, two] = sent;
    if (one === undefined || two === undefined) throw new Error("two presses");
    expect(keyOf(two)).toBe(keyOf(one));
  });

  it("a press answered with a refusal says the server's words, reads again, and never says You're booked", async () => {
    let reads = 0;
    const full = event(E1, "Open day", { places: 30, going: going({ coming: 30, can: can({ joinWaitlist: true }) }) });
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [eventsOf(IRON)]: () => {
        reads += 1;
        return { status: 200, body: listOf(IRON, reads === 1 ? [event(E1, "Open day")] : [full]) };
      },
      [comingOf(IRON, E1)]: () => refusal(409, "event_full", "This event is full."),
    });
    await openEvents(server.ask, IRON);
    await fireEvent.press(await screen.findByLabelText("Book: Open day"));
    expect(await box(E1).findByLabelText("Join waitlist: Open day")).toBeTruthy();
    expect(box(E1).getByText("This event is full.")).toBeTruthy();
    expect(box(E1).queryByText("You’re booked")).toBeNull();
  });

  it("a kept key answered with no place says so, never You're booked, and the next press has a new key", async () => {
    let round = 0;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [eventsOf(IRON)]: ok(listOf(IRON, [event(E1, "Open day")])),
      [comingOf(IRON, E1)]: () => {
        round += 1;
        if (round === 1) return lost();
        if (round === 2) return { status: 200, body: { event: event(E1, "Open day") } };
        return { status: 200, body: { event: youreComing(E1, "Open day") } };
      },
    });
    await openEvents(server.ask, IRON);
    await fireEvent.press(await screen.findByLabelText("Book: Open day"));
    await box(E1).findByText("Can’t connect. Check your internet and try again.");
    await fireEvent.press(screen.getByLabelText("Book: Open day"));
    expect(await box(E1).findByText("Your earlier booking was cancelled.")).toBeTruthy();
    expect(box(E1).queryByText("You’re booked")).toBeNull();
    await fireEvent.press(screen.getByLabelText("Book: Open day"));
    expect(await box(E1).findByText("You’re booked")).toBeTruthy();
    const [one, two, three] = presses(server);
    if (one === undefined || two === undefined || three === undefined) throw new Error("three presses");
    expect(keyOf(two)).toBe(keyOf(one));
    expect(keyOf(three)).not.toBe(keyOf(one));
  });

  it("a read of the page that started before a press never takes the answer's place away", async () => {
    const answers: ((reply: Reply) => void)[] = [];
    const comeBack = listenForComeBack();
    let reads = 0;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [eventsOf(IRON)]: () => {
        reads += 1;
        if (reads === 1) return { status: 200, body: listOf(IRON, [event(E1, "Open day")]) };
        return new Promise<Reply>((resolve) => answers.push(resolve));
      },
      [comingOf(IRON, E1)]: ok({ event: youreComing(E1, "Open day") }),
    });
    await openEvents(server.ask, IRON);
    await screen.findByLabelText("Book: Open day");
    await comeBack();
    await waitFor(() => {
      expect(answers.length).toBeGreaterThan(0);
    });
    await fireEvent.press(screen.getByLabelText("Book: Open day"));
    expect(await box(E1).findByText("You’re booked")).toBeTruthy();
    await act(() => {
      for (const answer of answers) answer({ status: 200, body: listOf(IRON, [event(E1, "Open day")]) });
    });
    await settle();
    expect(box(E1).getByText("You’re booked")).toBeTruthy();
  });

  it("an answer naming another gym is never shown under this one", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON, LOTUS),
      [eventsOf(IRON)]: ok(listOf(LOTUS, [event(E2, "Lotus retreat")])),
    });
    await openEvents(server.ask, IRON);
    expect(await page().findByText("Couldn’t load events.")).toBeTruthy();
    expect(page().queryByText("Lotus retreat")).toBeNull();
  });

  it("each gym's link opens that gym's own events", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON, LOTUS),
      [eventsOf(IRON)]: ok(listOf(IRON, [event(E1, "Open day")])),
      [eventsOf(LOTUS)]: ok(listOf(LOTUS, [event(E2, "Lotus retreat")])),
    });
    await openEvents(server.ask, LOTUS);
    expect(await page().findByText("Lotus retreat")).toBeTruthy();
    expect(page().queryByText("Open day")).toBeNull();
    expect(server.asked.some((one) => one.path === eventsOf(IRON))).toBe(false);
  });
});

describe("what an event says", () => {
  const show = async (events: Over[], place: Place = IRON) => {
    const server = fakeServer({ "/v1/auth/refresh": ok({ tokens: tokens(2) }), "/v1/orgs/mine": mine(place), [eventsOf(place)]: ok(listOf(place, events)) });
    await openEvents(server.ask, place);
    await screen.findByTestId("events-page");
    return server;
  };

  it("the fixture is the server's own shape", () => {
    expect(memberGymEventSchema.safeParse(event(E1, "Open day")).success).toBe(true);
  });

  it("the day and time on the gym's clock, its place, places left and details", async () => {
    await show([event(E1, "Open day", { place: "Main hall", details: "Bring a towel.", going: going({ coming: 18, can: can({ come: true }) }) })]);
    await screen.findByText("Open day");
    const card = box(E1);
    expect(card.getByText("Mon 2 Nov · 10:00 AM – 1:00 PM")).toBeTruthy();
    expect(card.getByText("Main hall")).toBeTruthy();
    expect(card.getByText("12 of 30 places left")).toBeTruthy();
    expect(card.getByText("Bring a towel.")).toBeTruthy();
  });

  it("a 24-hour gym reads 24 hours", async () => {
    await show([event(E2, "Retreat")], LOTUS);
    await screen.findByText("Retreat");
    expect(box(E2).getByText("Mon 2 Nov · 10:00 – 13:00")).toBeTruthy();
  });

  it.each([
    ["nobody", null],
    ["somebody booked", "coming"],
    ["somebody waiting", "waitlisted"],
  ] as const)("a cancelled event stays, marked, with no button, for %s: their place is kept in case it comes back", async (_, held2) => {
    const server = await show([event(E1, "Open day", { cancelled: true, going: realGoing({ cancelled: true, mine: held2, coming: 30, waiting: 1, waitlistPlace: 1 }) })]);
    await screen.findByText("Open day");
    expect(box(E1).getByText("Cancelled")).toBeTruthy();
    expect(box(E1).queryByRole("button")).toBeNull();
    expect(server.asked.some((one) => one.method === "DELETE")).toBe(false);
  });

  it("On now while it runs", async () => {
    await show([event(E1, "Open day", { startsAt: "2020-01-01T00:00:00.000Z", endsAt: "2099-01-01T00:00:00.000Z", going: going({ can: can({ why: "event_started" }) }) })]);
    await screen.findByText("Open day");
    expect(box(E1).getByText("On now")).toBeTruthy();
    expect(box(E1).getByText("Booking has closed.")).toBeTruthy();
  });

  it("a waitlist place says the line and tells them to check back", async () => {
    await show([event(E1, "Open day", { places: 1, going: going({ coming: 1, waiting: 3, mine: { status: "waitlisted", waitlistPlace: 2 }, can: can({ cancel: true }) }) })]);
    await screen.findByText("Open day");
    expect(box(E1).getByText("On the waitlist")).toBeTruthy();
    expect(box(E1).getByText("Not booked yet · 2nd in line")).toBeTruthy();
    expect(box(E1).getByText("Check back here if a place opens.")).toBeTruthy();
    expect(box(E1).getByText("Full · 3 on the waitlist")).toBeTruthy();
    expect(box(E1).getByLabelText("Leave waitlist: Open day")).toBeTruthy();
  });

  it("a free place for them offers Claim place, and Leave waitlist beside it", async () => {
    await show([event(E1, "Open day", { going: going({ coming: 29, waiting: 1, mine: { status: "waitlisted", waitlistPlace: 1 }, can: can({ claim: true, cancel: true }) }) })]);
    await screen.findByText("Open day");
    expect(box(E1).getByText("A place is free. Claim it before someone else does.")).toBeTruthy();
    expect(box(E1).getByLabelText("Claim place: Open day")).toBeTruthy();
    expect(box(E1).getByLabelText("Leave waitlist: Open day")).toBeTruthy();
  });

  it("an event and waitlist that are full say so, with no button", async () => {
    await show([event(E1, "Open day", { going: going({ coming: 30, waiting: 5, can: can({ why: "waitlist_full" }) }) })]);
    await screen.findByText("Open day");
    expect(box(E1).getByText("The waitlist is full.")).toBeTruthy();
    expect(box(E1).queryByRole("button")).toBeNull();
  });

  it("a gym on pause says so", async () => {
    const server = fakeServer({ "/v1/auth/refresh": ok({ tokens: tokens(2) }), "/v1/orgs/mine": mine(IRON), [eventsOf(IRON)]: ok(listOf(IRON, [], { status: "paused" })) });
    await openEvents(server.ask, IRON);
    expect(await page().findByText("Events aren’t available right now.")).toBeTruthy();
  });

  it("a gym with nothing coming says so", async () => {
    await show([]);
    expect(await page().findByText("No upcoming events.")).toBeTruthy();
  });

  it("a lost read offers Try again and reads again", async () => {
    let reads = 0;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [eventsOf(IRON)]: () => {
        reads += 1;
        if (reads === 1) return lost();
        return { status: 200, body: listOf(IRON, [event(E1, "Open day")]) };
      },
    });
    await openEvents(server.ask, IRON);
    expect(await page().findByText("Couldn’t load events.")).toBeTruthy();
    await fireEvent.press(page().getByText("Try again"));
    expect(await page().findByText("Open day")).toBeTruthy();
  });

  it("a read made by itself keeps the events over a lost connection, and a 404 takes them away", async () => {
    const comeBack = listenForComeBack();
    let reply = (): Reply => ({ status: 200, body: listOf(IRON, [event(E1, "Open day")]) });
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [eventsOf(IRON)]: () => reply(),
    });
    await openEvents(server.ask, IRON);
    await page().findByText("Open day");
    reply = lost;
    await comeBack();
    await settle();
    expect(page().getByText("Open day")).toBeTruthy();
    reply = () => refusal(404, "not_found", "Not found.");
    await comeBack();
    expect(await page().findByText("Events aren’t available right now.")).toBeTruthy();
    expect(page().queryByText("Open day")).toBeNull();
  });
});

describe("giving up a place", () => {
  it("with room left, Cancel booking goes at once, and the card says the server's answer", async () => {
    const gym = held(IRON, [youreComing(E1, "Open day")]);
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [eventsOf(IRON)]: gym.read,
      [comingOf(IRON, E1)]: () => gym.keep(event(E1, "Open day")),
    });
    await openEvents(server.ask, IRON);
    await fireEvent.press(await screen.findByLabelText("Cancel booking: Open day"));
    expect(await screen.findByLabelText("Book: Open day")).toBeTruthy();
    expect(box(E1).queryByText("You’re booked")).toBeNull();
    expect(server.asked.filter((one) => one.method === "DELETE").length).toBe(1);
  });

  it("when somebody would take it at once, the box asks; Keep it sends nothing", async () => {
    const taken = event(E1, "Open day", { places: 1, going: going({ coming: 1, waiting: 1, mine: { status: "coming", waitlistPlace: null }, can: can({ cancel: true }) }) });
    const gym = held(IRON, [taken]);
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [eventsOf(IRON)]: gym.read,
      [comingOf(IRON, E1)]: () => gym.keep(event(E1, "Open day", { places: 1, going: going({ coming: 1, can: can({ why: "event_full" }) }) })),
    });
    await openEvents(server.ask, IRON);
    await fireEvent.press(await screen.findByLabelText("Cancel booking: Open day"));
    expect(await screen.findByText("Cancel your booking?")).toBeTruthy();
    expect(screen.getByText("This event is full, so your place may go to someone else.")).toBeTruthy();
    await fireEvent.press(screen.getByText("Keep it"));
    expect(server.asked.filter((one) => one.method === "DELETE").length).toBe(0);
    await fireEvent.press(screen.getByLabelText("Cancel booking: Open day"));
    await fireEvent.press((await screen.findAllByText("Cancel booking")).at(-1) as never);
    expect(await screen.findByText("Full")).toBeTruthy();
    expect(screen.queryByText("You’re booked")).toBeNull();
    expect(server.asked.filter((one) => one.method === "DELETE").length).toBe(1);
  });

  it("Cancel booking with no answer keeps You're booked and says it couldn't connect", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [eventsOf(IRON)]: ok(listOf(IRON, [youreComing(E1, "Open day")])),
      [comingOf(IRON, E1)]: () => lost(),
    });
    await openEvents(server.ask, IRON);
    await fireEvent.press(await screen.findByLabelText("Cancel booking: Open day"));
    expect(await box(E1).findByText("Can’t connect. Check your internet and try again.")).toBeTruthy();
    expect(box(E1).getByText("You’re booked")).toBeTruthy();
  });
});

describe("the box before giving up a place, and the card, say the same", () => {
  it.each([
    ["full", { coming: 2, waiting: 0, places: 2 }, "Full", "This event is full, so your place may go to someone else."],
    ["full with people waiting", { coming: 2, waiting: 1, places: 2 }, "Full · 1 on the waitlist", "This event is full, so your place may go to someone else."],
    ["a place free and people waiting", { coming: 1, waiting: 1, places: 2 }, "1 place left", "People are waiting for a place, so yours may go to someone else."],
  ])("%s", async (_, numbers, card, line) => {
    const going2 = realGoing({ ...numbers, mine: "coming" });
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [eventsOf(IRON)]: ok(listOf(IRON, [event(E1, "Open day", { places: numbers.places, going: going2 })])),
    });
    await openEvents(server.ask, IRON);
    await fireEvent.press(await screen.findByLabelText("Cancel booking: Open day"));
    expect(await screen.findByText(line)).toBeTruthy();
    expect(box(E1).getByText(card)).toBeTruthy();
  });
});

describe("every press sends what it says", () => {
  const pressed = async (over: Over, label: string, answer: Over) => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [eventsOf(IRON)]: ok(listOf(IRON, [event(E1, "Open day", over)])),
      [comingOf(IRON, E1)]: ok({ event: answer }),
    });
    await openEvents(server.ask, IRON);
    await fireEvent.press(await screen.findByLabelText(`${label}: Open day`));
    return server;
  };

  it("Join waitlist asks for the waitlist, and the card then says On the waitlist, not booked", async () => {
    const answer = event(E1, "Open day", { going: realGoing({ coming: 30, waiting: 1, mine: "waitlisted", waitlistPlace: 1 }) });
    const server = await pressed({ going: realGoing({ coming: 30 }) }, "Join waitlist", answer);
    expect(await box(E1).findByText("On the waitlist")).toBeTruthy();
    expect(box(E1).queryByText("You’re booked")).toBeNull();
    expect((presses(server)[0]?.body as { joinWaitlist: boolean }).joinWaitlist).toBe(true);
  });

  it("Claim place asks for a place, not the waitlist, and the card then says You're booked", async () => {
    const over = { going: going({ coming: 29, waiting: 1, mine: { status: "waitlisted", waitlistPlace: 1 }, can: can({ claim: true, cancel: true }) }) };
    const server = await pressed(over, "Claim place", youreComing(E1, "Open day"));
    expect(await box(E1).findByText("You’re booked")).toBeTruthy();
    expect((presses(server)[0]?.body as { joinWaitlist: boolean }).joinWaitlist).toBe(false);
  });

  it("Leave waitlist sends the leaving, and the card then holds nothing of theirs", async () => {
    const over = { going: going({ coming: 30, waiting: 1, mine: { status: "waitlisted", waitlistPlace: 1 }, can: can({ cancel: true }) }) };
    const server = await pressed(over, "Leave waitlist", event(E1, "Open day", { going: realGoing({ coming: 30 }) }));
    expect(await box(E1).findByLabelText("Join waitlist: Open day")).toBeTruthy();
    expect(box(E1).queryByText("On the waitlist")).toBeNull();
    expect(server.asked.filter((one) => one.method === "DELETE").length).toBe(1);
    expect(presses(server).length).toBe(0);
  });
});

describe("whose clock", () => {
  const zoneOf = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
  it("a gym in another zone from the phone says whose time it is", async () => {
    const other = zoneOf() === "America/New_York" ? "Asia/Kolkata" : "America/New_York";
    const server = fakeServer({ "/v1/auth/refresh": ok({ tokens: tokens(2) }), "/v1/orgs/mine": mine(IRON), [eventsOf(IRON)]: ok(listOf(IRON, [event(E1, "Open day")], { timezone: other })) });
    await openEvents(server.ask, IRON);
    expect(await page().findByText(`Times are Iron House time (${other.replaceAll("_", " ")}), not this phone’s.`)).toBeTruthy();
  });
  it("a gym on the phone's own zone says nothing about it", async () => {
    const server = fakeServer({ "/v1/auth/refresh": ok({ tokens: tokens(2) }), "/v1/orgs/mine": mine(IRON), [eventsOf(IRON)]: ok(listOf(IRON, [event(E1, "Open day")], { timezone: zoneOf() })) });
    await openEvents(server.ask, IRON);
    await page().findByText("Open day");
    expect(page().queryByText(/Times are/)).toBeNull();
  });
});

describe("the page stays current", () => {
  afterEach(() => {
    jest.useRealTimers();
  });
  const reads = (server: { asked: Asked[] }) => server.asked.filter((one) => one.path === eventsOf(IRON)).length;
  const onWait = () => event(E1, "Open day", { going: realGoing({ coming: 30, waiting: 1, mine: "waitlisted", waitlistPlace: 1 }) });

  it("on a waitlist it reads every 30 seconds, and stops after 15 minutes", async () => {
    jest.useFakeTimers({ advanceTimers: true });
    const server = fakeServer({ "/v1/auth/refresh": ok({ tokens: tokens(2) }), "/v1/orgs/mine": mine(IRON), [eventsOf(IRON)]: ok(listOf(IRON, [onWait()])) });
    await openEvents(server.ask, IRON);
    await page().findByText("On the waitlist");
    const before = reads(server);
    await act(async () => { await jest.advanceTimersByTimeAsync(31_000); });
    expect(reads(server)).toBe(before + 1);
    await act(async () => { await jest.advanceTimersByTimeAsync(16 * 60_000); });
    const atTheEnd = reads(server);
    expect(atTheEnd).toBeLessThanOrEqual(before + 31);
    await act(async () => { await jest.advanceTimersByTimeAsync(5 * 60_000); });
    expect(reads(server)).toBe(atTheEnd);
  });

  it("with no waitlist place and nothing starting soon, it does not read by itself", async () => {
    jest.useFakeTimers({ advanceTimers: true });
    const server = fakeServer({ "/v1/auth/refresh": ok({ tokens: tokens(2) }), "/v1/orgs/mine": mine(IRON), [eventsOf(IRON)]: ok(listOf(IRON, [event(E1, "Open day")])) });
    await openEvents(server.ask, IRON);
    await page().findByText("Open day");
    const before = reads(server);
    await act(async () => { await jest.advanceTimersByTimeAsync(5 * 60_000); });
    expect(reads(server)).toBe(before);
  });

  it("it reads again when an event starts", async () => {
    jest.useFakeTimers({ advanceTimers: true });
    const soon = new Date(Date.now() + 60_000).toISOString();
    const later = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const server = fakeServer({ "/v1/auth/refresh": ok({ tokens: tokens(2) }), "/v1/orgs/mine": mine(IRON), [eventsOf(IRON)]: ok(listOf(IRON, [event(E1, "Open day", { startsAt: soon, endsAt: later })])) });
    await openEvents(server.ask, IRON);
    await page().findByText("Open day");
    const before = reads(server);
    await act(async () => { await jest.advanceTimersByTimeAsync(70_000); });
    expect(reads(server)).toBeGreaterThan(before);
  });
});

describe("posters", () => {
  const withPoster = event(E1, "Open day", { poster: { id: POSTER, width: 800, height: 1200 } });

  it("a poster's box keeps the card's width: its own shape, stopped at the tallest and at its share of the screen", () => {
    expect(posterHeight(360, { width: 1200, height: 600 }, 800)).toBe(180);
    expect(posterHeight(360, { width: 800, height: 1200 }, 1000)).toBe(POSTER_TALLEST);
    expect(posterHeight(1000, { width: 1200, height: 600 }, 2000)).toBe(POSTER_TALLEST);
    expect(posterHeight(360, { width: 800, height: 1200 }, 400)).toBe(220);
    expect(posterHeight(null, { width: 800, height: 1200 }, 400)).toBe(220);
  });

  it("a poster is read signed in, from this gym's own address", async () => {
    const server = fakeServer({ "/v1/auth/refresh": ok({ tokens: tokens(2) }), "/v1/orgs/mine": mine(IRON), [eventsOf(IRON)]: ok(listOf(IRON, [withPoster])) });
    await openEvents(server.ask, IRON);
    expect(await screen.findByTestId(`poster-${POSTER}`)).toBeTruthy();
    const [url, , options] = download.mock.calls[0] ?? [];
    expect(url).toBe(`http://localhost:3000/v1/orgs/${IRON.id}/events/${E1}/poster/${POSTER}`);
    expect((options as { headers: Record<string, string> }).headers.authorization).toMatch(/^Bearer /);
    expect(box(E1).getByLabelText("Poster for Open day")).toBeTruthy();
  });

  it("a poster refused says so in its place, keeps the event, and is asked for again at the next read", async () => {
    const comeBack = listenForComeBack();
    download.mockImplementationOnce(() => Promise.reject(new Error("response has status: 404")));
    const server = fakeServer({ "/v1/auth/refresh": ok({ tokens: tokens(2) }), "/v1/orgs/mine": mine(IRON), [eventsOf(IRON)]: ok(listOf(IRON, [withPoster])) });
    await openEvents(server.ask, IRON);
    expect(await screen.findByText("Couldn't load this photo.")).toBeTruthy();
    expect(box(E1).getByText("Open day")).toBeTruthy();
    expect(box(E1).getByLabelText("Book: Open day")).toBeTruthy();
    await comeBack();
    expect(await screen.findByTestId(`poster-${POSTER}`)).toBeTruthy();
  });

  it("only the events near the screen ask for their posters", async () => {
    const many = Array.from({ length: 40 }, (_, i) => {
      const n = String(i + 10);
      return event(`aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa${n}`, `Event ${n}`, { poster: { id: `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb${n}`, width: 800, height: 1200 } });
    });
    const server = fakeServer({ "/v1/auth/refresh": ok({ tokens: tokens(2) }), "/v1/orgs/mine": mine(IRON), [eventsOf(IRON)]: ok(listOf(IRON, many)) });
    await openEvents(server.ask, IRON);
    await page().findByText("Event 10");
    await settle();
    expect(download.mock.calls.length).toBeLessThanOrEqual(10);
  });
});
