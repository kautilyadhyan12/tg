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
import { render, screen, waitFor, cleanup } from '@testing-library/react';

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
    for (const short of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
      expect(screen.getByText(short)).toBeTruthy();
    }
    // Six of the seven are shut, and NOW that word is true: this gym has
    // answered. That is the distinction the first test in this file protects.
    expect(screen.getAllByText('Closed').length).toBe(6);
  });

  it("a dated closure WINS over the weekly pattern, and shows the gym's reason", async () => {
    // Kd's two mechanisms, in the order he ruled them (:26684 §3). Wednesday has
    // hours; today is Wednesday at the gym; today is closed. The closure wins.
    orgService.getHours.mockResolvedValue(
      hours({
        week: [{ weekday: 3, sessions: [{ opensMinute: 360, closesMinute: 420 }] }],
        closures: [{ day: GYM_TODAY, note: 'Holi' }],
      }),
    );
    render(<GymHoursNote gymId={GYM} />);

    expect(await screen.findByText(/Closed today/)).toBeTruthy();
    expect(screen.getByText(/Holi/)).toBeTruthy();
    // And the pattern's own line for today is NOT also drawn as the headline.
    expect(screen.queryByText('Today: 06:00 – 07:00')).toBeNull();
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
    expect(screen.getByText('Closed 2026-09-20')).toBeTruthy();
  });
});
