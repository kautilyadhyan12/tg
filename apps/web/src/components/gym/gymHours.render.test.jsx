// WHAT A MEMBER IS SHOWN ABOUT THEIR GYM'S OPENING TIMES — Kd ruled they see
// them (:26684 §2), and this is the screen half of :26736.
//
// THE FIRST TEST IS THE WHOLE CARD'S SUBJECT AND IT ASSERTS AN ABSENCE. A gym
// that never filled the section in has no session rows, which from the rows
// alone is byte-identical to a gym that is genuinely shut every day — so a
// member card printing "Closed" for the first is a person told something FALSE
// about their own gym (:5807), and on the day this ships it would be every gym
// in the database. The component must draw NOTHING at all.
//
// THE CLOCK IS FROZEN AND THE GYM IS NOT IN UTC, deliberately. Every date here
// is the GYM's (trap #8), and a UTC fixture cannot tell a reader that asks the
// gym's zone from one that asks the browser's — the same defect the server half
// shipped with and only a mutation sweep caught.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: { getHours: vi.fn() } };
});

const { orgService } = await import('../../api/orgsApi');
const GymHoursNote = (await import('./GymHoursNote')).default;

const GYM = '11111111-1111-1111-1111-111111111111';

// 2026-09-01 at 23:30 UTC. In Kiritimati (UTC+14) the gym's date is already the
// 2nd — a WEDNESDAY — while the browser and UTC still say Tuesday the 1st. Every
// assertion below turns on the screen using the gym's answer.
const AT = new Date('2026-09-01T23:30:00Z');
const GYM_TZ = 'Pacific/Kiritimati';
const GYM_TODAY = '2026-09-02';

const hours = (over = {}) => ({
  data: {
    hours: {
      mode: 'scheduled',
      timezone: GYM_TZ,
      week: [],
      closures: [],
      ...over,
    },
  },
});

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(AT);
  orgService.getHours.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

// ── THE WEEK IS BEHIND A TAP NOW, AND THAT MAKES EVERY ABSENCE ASSERTION IN
//    THIS FILE SUSPECT UNTIL IT IS OPENED ───────────────────────────────────
// Kd asked for the Mon–Sun list to fold (2026-09-03, `OWED.md`'s ⚪ line off
// `:31508`). Closed means UNMOUNTED, so a screen-wide `queryAllByText(...) → 0`
// — which is how the closure cases below prove the dated closure wins ANYWHERE
// on the card — is satisfied by the fold simply being shut. **That is :29740's
// finding on the console's Settings screen arriving here**: a query that reads
// the whole screen tells you nothing about a section nobody opened.
//
// Every case whose subject is inside the week therefore taps this row first.
// The name is the accessible name of the control a person actually presses, so
// a fold that stopped rendering fails the query rather than the assertion.
const openWeek = async () => {
  const row = await screen.findByRole('button', { name: /this week/i });
  fireEvent.click(row);
  return row;
};

// ── T3 ROUND 1, L-5: "NOTHING MEMBER-FACING MAY DRAW `savedWeek`" ─────────
// That promise was written in three files and enforced in none. `savedWeek`
// carries a 24-hour gym's kept timetable — rows that used to be deleted and
// since `:31508` survive on purpose — and it reaches every member of that gym
// on the same response object. **The stray row is no longer hypothetical**,
// which is exactly what makes an unenforced promise worth a test.
//
// **IT IS A BEHAVIOUR TEST AND NOT A GREP, deliberately.** A grep for the
// identifier is satisfied by spelling it differently, and :12731's lesson is
// that a source-regex test proves nothing about what a screen draws. This asks
// the only question that matters: with a kept week in hand, does the member's
// card put a weekday on screen?
describe('the timetable a 24-hour gym keeps', () => {
  it('never reaches a member, even though it travels on their own response', async () => {
    orgService.getHours.mockResolvedValue(
      hours({
        mode: 'open_24h',
        week: [],
        savedWeek: [
          { weekday: 3, sessions: [{ opensMinute: 360, closesMinute: 420 }] },
          { weekday: 4, sessions: [{ opensMinute: 460, closesMinute: 580 }] },
        ],
      }),
    );
    render(<GymHoursNote gymId={GYM} />);

    // The positive control FIRST, so the absences below cannot pass on a
    // component that rendered nothing at all (:21751 — a ✅ of "nothing
    // appears" is satisfied by a blank screen).
    expect(await screen.findByText('Open 24 hours')).toBeTruthy();

    // **AND THE SECOND CONTROL, ADDED WITH THE FOLD: there is no row to tap.**
    // Once the week folds, "no weekday is on screen" stops being evidence that
    // no weekday is DRAWN — a shut fold satisfies it just as well, which would
    // have left this whole guarantee (T3 round 1's L-5, mutant C190) passing
    // over a 24-hour gym's kept timetable sitting one tap away.
    expect(screen.queryByRole('button', { name: /this week/i })).toBeNull();

    for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
      expect(screen.queryByText(day)).toBeNull();
    }
    // And no time from it, spelled either way the gym's clock could spell one.
    expect(screen.queryByText(/06:00|6:00 AM|07:40|7:40 AM/)).toBeNull();
  });
});

describe('a gym that has not answered', () => {
  it('draws NOTHING — not "Closed", not an empty list, not a heading', async () => {
    orgService.getHours.mockResolvedValue(hours({ mode: 'unset' }));
    const { container } = render(<GymHoursNote gymId={GYM} />);

    await waitFor(() => {
      expect(orgService.getHours).toHaveBeenCalledWith(GYM);
    });
    // The absence is the assertion. `queryByText` over the whole document,
    // because the defect this guards against is a word appearing ANYWHERE.
    expect(screen.queryByText(/closed/i)).toBeNull();
    expect(screen.queryByText(/open/i)).toBeNull();
    expect(container.textContent).toBe('');
  });
});

describe('a read that fails', () => {
  it('draws nothing rather than an empty state, because this card is additive', async () => {
    // Everywhere else in this project an empty state over a failed read is the
    // defect. Here silence claims nothing at all, and a red strip on the screen
    // somebody opens to start a workout would be noise about a background read.
    orgService.getHours.mockRejectedValue(new Error('network'));
    const { container } = render(<GymHoursNote gymId={GYM} />);

    await waitFor(() => {
      expect(orgService.getHours).toHaveBeenCalled();
    });
    expect(container.textContent).toBe('');
  });
});

describe('a gym that has answered', () => {
  it('says "Open 24 hours" and lists no week', async () => {
    orgService.getHours.mockResolvedValue(hours({ mode: 'open_24h' }));
    render(<GymHoursNote gymId={GYM} />);

    expect(await screen.findByText('Open 24 hours')).toBeTruthy();
    // Seven identical rows for a gym that never shuts is noise, not information.
    expect(screen.queryByText('Mon')).toBeNull();
    // AND THE CONTROL ITSELF, for the same reason the `savedWeek` case above
    // needs it: once the week folds, `queryByText('Mon') === null` is satisfied
    // by a SHUT fold just as well as by a component that drew no week at all,
    // so on its own this case goes quiet under `C214` instead of red. The fold
    // is drawn on the MODE and not on the week's length, so a 24-hour gym under
    // that mutant is handed a control over nothing — which is what this asserts
    // never happens. (T3 round 1 on `:32929`/`:33091`, Low-1: the fifth case of
    // the shape that entry's §3 generalises about, and the one it missed.)
    expect(screen.queryByRole('button', { name: /this week/i })).toBeNull();
  });

  it("shows TODAY from the GYM's zone — proven on a PAIR, because one gym cannot prove it", async () => {
    // **A SINGLE NON-UTC FIXTURE DOES NOT WORK, AND THE MUTATION SWEEP IS WHAT
    // PROVED IT — twice, on both halves of this feature.** The first version of
    // this test used one UTC+14 gym and asserted its Wednesday hours; the mutant
    // that reads the BROWSER's zone instead of the gym's SURVIVED, because this
    // machine runs at UTC+5:30 and at 23:30 UTC that is already Wednesday too.
    // The test was measuring the runner's time zone, not the code.
    //
    // UTC+14 and UTC-12 are 26 hours apart, so their two calendar dates ALWAYS
    // differ — whatever zone the machine is in, it can match at most one of
    // them, so a reader using the machine's clock is wrong about the other. The
    // server half's O187 was fixed with exactly this instrument (:26947 §2a).
    const week = [
      { weekday: 1, sessions: [{ opensMinute: 60, closesMinute: 120 }] },
      { weekday: 2, sessions: [{ opensMinute: 360, closesMinute: 420 }] },
      { weekday: 3, sessions: [{ opensMinute: 900, closesMinute: 1260 }] },
    ];
    // At 2026-09-01T23:30Z: Kiritimati is Wed the 2nd, Etc/GMT+12 is Tue the 1st.
    orgService.getHours.mockImplementation((id) =>
      Promise.resolve(
        id === 'east'
          ? hours({ timezone: 'Pacific/Kiritimati', week })
          : hours({ timezone: 'Etc/GMT+12', week }),
      ),
    );

    render(
      <>
        <GymHoursNote gymId="east" />
        <GymHoursNote gymId="west" />
      </>,
    );

    // Wednesday for the eastern gym, Tuesday for the western one, at the same
    // instant. No single clock can produce both.
    expect(await screen.findByText('Today: 15:00 – 21:00')).toBeTruthy();
    expect(screen.getByText('Today: 06:00 – 07:00')).toBeTruthy();
    // And neither is Monday — the control that stops this passing on a reader
    // that simply picked a fixed row.
    expect(screen.queryByText('Today: 01:00 – 02:00')).toBeNull();
  });

  it("reads on the GYM's clock, and BOTH clocks are driven", async () => {
    // Kd, 2026-09-01: the gym chooses. The pair is the assertion — either line
    // alone would pass with the gym's choice ignored — and a MEMBER seeing a
    // different clock from their gym's own console is the thing the setting
    // living on the gym row exists to prevent.
    const week = [{ weekday: 3, sessions: [{ opensMinute: 960, closesMinute: 1260 }] }];

    orgService.getHours.mockResolvedValue(hours({ clockFormat: '12h', week }));
    const { unmount } = render(<GymHoursNote gymId={GYM} />);
    expect(await screen.findByText('Today: 4:00 PM – 9:00 PM')).toBeTruthy();
    unmount();

    orgService.getHours.mockResolvedValue(hours({ clockFormat: '24h', week }));
    render(<GymHoursNote gymId={GYM} />);
    expect(await screen.findByText('Today: 16:00 – 21:00')).toBeTruthy();
  });

  it('lists the whole week, and a weekday with no sessions reads Closed', async () => {
    orgService.getHours.mockResolvedValue(
      hours({ week: [{ weekday: 3, sessions: [{ opensMinute: 360, closesMinute: 420 }] }] }),
    );
    render(<GymHoursNote gymId={GYM} />);

    await screen.findByText('Today: 06:00 – 07:00');
    await openWeek();
    for (const short of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
      expect(screen.getByText(short)).toBeTruthy();
    }
    // Six of the seven are shut, and NOW that word is true: this gym has
    // answered. That is the distinction the first test in this file protects.
    expect(screen.getAllByText('Closed').length).toBe(6);
  });

  it("a dated closure WINS over the weekly pattern, ANYWHERE on the card", async () => {
    // Kd's two mechanisms, in the order he ruled them (:26684 §3). Wednesday has
    // hours; today is Wednesday at the gym; today is closed. The closure wins.
    //
    // **THIS TEST WAS A LIAR AND IT IS THE ONE THAT LET T3 ROUND 1's SECOND
    // CRITICAL/HIGH THROUGH.** Its whole negative assertion used to be
    // `queryByText('Today: 06:00 – 07:00')` — the HEADLINE and nothing else —
    // while the week list three lines below went on printing `06:00 – 07:00`
    // for today, in the brighter colour that marks today. It was green over a
    // member being told the gym is open on a day it had declared shut.
    // :26947 §2's shape exactly: a test whose NAME states a guarantee its query
    // does not observe — and the name here even said "WINS over the weekly
    // pattern", which is precisely the half it never looked at.
    //
    // So the assertion is now the whole document: those hours appear NOWHERE.
    // `queryAllByText` and not `queryByText`, because the card draws a row per
    // weekday and the singular query throws on a pair before it can return
    // anything — a failure that names the DOM instead of the claim (:25567).
    orgService.getHours.mockResolvedValue(
      hours({
        week: [{ weekday: 3, sessions: [{ opensMinute: 360, closesMinute: 420 }] }],
        closures: [{ day: GYM_TODAY, note: 'Holi' }],
      }),
    );
    render(<GymHoursNote gymId={GYM} />);

    // THE REASON IS QUERIED ON ITS OWN, and that is a fact about the tool rather
    // than a style choice: Testing Library matches an element's OWN text nodes,
    // so the headline reads as `Closed today` and its ` — Holi` span is a
    // separate match. A regex spanning both finds nothing.
    expect(await screen.findByText(/Holi/)).toBeTruthy();
    // **THE WEEK IS OPENED BEFORE THE ABSENCES ARE READ, AND WITHOUT THIS LINE
    // THE CASE IS A LIAR AGAIN** — for the second time, in the same test. Its
    // whole subject is the half of the card the fold now hides, so a shut fold
    // satisfies every `toHaveLength(0)` below exactly as the headline-only query
    // it was rewritten from used to (:29740).
    await openWeek();
    expect(screen.queryAllByText('Today: 06:00 – 07:00')).toHaveLength(0);
    expect(screen.queryAllByText('06:00 – 07:00')).toHaveLength(0);
    // TWO elements read "Closed today" — the headline and today's own row — and
    // six read a bare "Closed", which is the weekly pattern. **The split is T3
    // round 2's L-5**: this list IS the pattern, so a bare "Closed" on today's
    // row is read as *closed every Wednesday*, which is Kd's OTHER mechanism
    // (:26684 §3). The counts are also what stop a row that quietly vanished
    // from passing.
    expect(screen.getAllByText('Closed today')).toHaveLength(2);
    expect(screen.getAllByText('Closed')).toHaveLength(6);
  });

  it('leaves the pattern alone on the days the closure is not about', async () => {
    // THE POSITIVE CONTROL for the case above, and it is not decoration: an
    // override that fired on every row — or a card that simply stopped drawing
    // hours whenever any closure existed — would satisfy every assertion up
    // there. Today is closed; Monday still reads its real hours.
    orgService.getHours.mockResolvedValue(
      hours({
        week: [
          { weekday: 1, sessions: [{ opensMinute: 360, closesMinute: 1320 }] },
          { weekday: 3, sessions: [{ opensMinute: 360, closesMinute: 420 }] },
        ],
        closures: [{ day: GYM_TODAY, note: 'Holi' }],
      }),
    );
    render(<GymHoursNote gymId={GYM} />);

    await screen.findByText(/Holi/);
    await openWeek();
    expect(screen.getByText('06:00 – 22:00')).toBeTruthy();
    // Five weekdays shut by the pattern; today shut by the closure and saying
    // which, in the headline and in its own row.
    expect(screen.getAllByText('Closed today')).toHaveLength(2);
    expect(screen.getAllByText('Closed')).toHaveLength(5);
  });

  it('lists an upcoming closure without repeating today as the headline', async () => {
    orgService.getHours.mockResolvedValue(
      hours({
        week: [{ weekday: 3, sessions: [{ opensMinute: 360, closesMinute: 420 }] }],
        closures: [{ day: '2026-09-20', note: null }],
      }),
    );
    render(<GymHoursNote gymId={GYM} />);

    expect(await screen.findByText('Today: 06:00 – 07:00')).toBeTruthy();
    // WRITTEN THE WAY A PERSON WRITES A DATE, not the way the wire spells it —
    // T3 round 1's Low-3. `2026-09-20` is a Sunday, and the weekday is the part
    // a member actually wants ("is that this weekend?"). The raw form must be
    // gone, not merely joined by a friendlier one.
    expect(screen.getByText('Closed Sun 20 Sep 2026')).toBeTruthy();
    expect(screen.queryByText(/2026-09-20/)).toBeNull();
  });
});

// ── THE WEEK FOLDS (Kd, 2026-09-03, `OWED.md`'s ⚪ line off `:31508`) ────────
// *"should have a drop down type of effect whenver click or hover in them"* —
// **ON TAP, NOT ON HOVER**: hover does not exist on a phone, and :26586 is his
// own *"members are not going to use the web"*, so the phone is the screen this
// is read on.
//
// **THE ASSERTIONS BELOW ARE ABOUT THE CLOSING, NOT THE OPENING, AND :31295 IS
// WHY.** A case asserting a section ARRIVES in a state passes under that
// entry's defect perfectly — the dropdown Kd found dead arrived open either
// way. For a two-state control the assertion is the state it is NOT in when you
// find it, so the taps below go there and back.
//
// No `waitFor` sits on the far side of a click here: the tap changes state and
// resolves no promise, and `fireEvent` already wraps it in `act`. Where a
// promise DOES resolve off an interaction under this file's faked `Date`,
// :32197 §5(d) is the instrument note — `act`, never `waitFor`.
describe('the rest of the week', () => {
  // Wednesday is today at this gym (see AT / GYM_TZ above), so the headline
  // reads its hours and Monday's belong to a row inside the fold. The two are
  // deliberately DIFFERENT times: one fixture where the headline and the list
  // print the same string could not tell them apart.
  const scheduled = () =>
    hours({
      week: [
        { weekday: 1, sessions: [{ opensMinute: 360, closesMinute: 420 }] },
        { weekday: 3, sessions: [{ opensMinute: 460, closesMinute: 580 }] },
      ],
    });

  const SHORTS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  it('arrives FOLDED — seven rows are not what a member is handed', async () => {
    orgService.getHours.mockResolvedValue(scheduled());
    render(<GymHoursNote gymId={GYM} />);

    // Today is on screen without touching anything — the closed row still
    // answers the question the card was opened with (:20338).
    expect(await screen.findByText('Today: 07:40 – 09:40')).toBeTruthy();
    expect(screen.getByRole('button', { name: /this week/i }).getAttribute('aria-expanded')).toBe(
      'false',
    );

    // And the list Kd was looking at is not there: not the day names, not
    // Monday's times, and not the five shut days' word.
    for (const short of SHORTS) {
      expect(screen.queryByText(short)).toBeNull();
    }
    expect(screen.queryByText('06:00 – 07:00')).toBeNull();
    expect(screen.queryAllByText('Closed')).toHaveLength(0);
  });

  it('opens on a tap and CLOSES again on the next one', async () => {
    orgService.getHours.mockResolvedValue(scheduled());
    render(<GymHoursNote gymId={GYM} />);

    const row = await screen.findByRole('button', { name: /this week/i });
    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Mon')).toBeTruthy();
    expect(screen.getByText('06:00 – 07:00')).toBeTruthy();

    // THE SECOND TAP IS THIS CASE'S SUBJECT. Closed means UNMOUNTED here, so
    // the rows must be GONE rather than merely hidden — a `display:none` body
    // would leave this assertion passing over content no person can see.
    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Mon')).toBeNull();
    expect(screen.queryByText('06:00 – 07:00')).toBeNull();
  });

  it("keeps today's line on screen in BOTH states, which is the whole bargain", async () => {
    // The fold was asked for because the card was seven rows tall; what it may
    // never do is take away the one line somebody looks at this card FOR. So
    // the headline is asserted open, closed, and open again — a fold that
    // swallowed it would still pass every other case in this block.
    orgService.getHours.mockResolvedValue(scheduled());
    render(<GymHoursNote gymId={GYM} />);

    const row = await screen.findByRole('button', { name: /this week/i });
    expect(screen.getByText('Today: 07:40 – 09:40')).toBeTruthy();
    fireEvent.click(row);
    expect(screen.getByText('Today: 07:40 – 09:40')).toBeTruthy();
    fireEvent.click(row);
    expect(screen.getByText('Today: 07:40 – 09:40')).toBeTruthy();
  });

  it('is not offered at all by a gym that never closes', async () => {
    // A fold over nothing is a control that opens onto an empty list, and a
    // 24-hour gym HAS no week — listing seven identical rows for it was already
    // refused as noise. This is also the second half of the `savedWeek` guard
    // at the top of this file (C190): there the gym has kept rows, here it has
    // none, and both must be unreachable rather than merely unopened.
    orgService.getHours.mockResolvedValue(hours({ mode: 'open_24h' }));
    render(<GymHoursNote gymId={GYM} />);

    expect(await screen.findByText('Open 24 hours')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /this week/i })).toBeNull();
  });
});
