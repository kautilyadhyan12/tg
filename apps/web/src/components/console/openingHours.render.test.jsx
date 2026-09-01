// THE CONSOLE'S "WHEN WE'RE OPEN" PANEL — Kd's :26624, :26684, :26736.
//
// The helpers next door prove the rules; these prove the screen obeys them, and
// four things beyond that:
//   · the THREE MODES are distinguishable, and `unset` never says "Closed" —
//     :26736's whole subject, and the one defect that would have shipped to
//     every existing gym at once;
//   · a FAILED READ is drawn as a failure and never as a gym with no hours,
//     which is this project's most-repeated defect (:8267);
//   · a lapsed gym's controls go quiet and say why, without hiding anything
//     (:23711 — read-only seals nobody out);
//   · a closure that saves and does NOT come back says so, which is the
//     carry-forward T3 round 1 left for this half.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { ROLE_PRIVILEGES } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getHours: vi.fn(),
      setHours: vi.fn(),
      closeDay: vi.fn(),
      removeClosure: vi.fn(),
      updateOrg: vi.fn(),
    },
  };
});

const { orgService } = await import('../../api/orgsApi');
const OpeningHoursPanel = (await import('./OpeningHoursPanel')).default;

const ORG = {
  id: '11111111-1111-1111-1111-111111111111',
  slug: 'iron-house',
  name: 'Iron House',
  timezone: 'Pacific/Kiritimati',
};
const OWNER = ROLE_PRIVILEGES.owner;

// 2026-09-01 23:30 UTC — the gym (UTC+14) is already on 2026-09-02, a
// Wednesday, while the browser is on Tuesday the 1st. Trap #8, held on purpose.
const AT = new Date('2026-09-01T23:30:00Z');

const hours = (over = {}) => ({
  mode: 'scheduled',
  timezone: ORG.timezone,
  week: [],
  closures: [],
  ...over,
});

const answer = (over = {}) => ({ data: { hours: hours(over) } });

/** Open the section — everything below the heading is UNMOUNTED while it is
 *  shut (`ConsoleSection`'s own design), so a test that skipped this would be
 *  asserting against a closed accordion and would pass for the wrong reason. */
const openSection = async () => {
  const heading = await screen.findByRole('button', { name: /When we're open/i });
  fireEvent.click(heading);
};

/** UNFOLD ONE DAY. Since Kd's 2026-09-01 ruling every weekday starts folded
 *  — a gym with three sessions a day made the box enormous — so its time
 *  controls are UNMOUNTED until the day's own row is clicked. A test that
 *  skipped this would be asserting against a folded row. */
const openDay = (label) => {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }));
};

/** SET ONE TIME THROUGH THE THREE BOXES Kd asked for — hour, minute, and
 *  AM/PM when the gym is on a 12-hour clock. `hour` is what the HOUR BOX
 *  shows, so on a 12-hour gym it is 1-12 and never 0-23. */
const pickTime = (label, { hour, minute, meridiem } = {}) => {
  if (hour !== undefined) {
    fireEvent.change(screen.getByLabelText(`${label} hour`), { target: { value: String(hour) } });
  }
  if (minute !== undefined) {
    fireEvent.change(screen.getByLabelText(`${label} minute`), { target: { value: String(minute) } });
  }
  if (meridiem !== undefined) {
    fireEvent.change(screen.getByLabelText(`${label} AM or PM`), { target: { value: meridiem } });
  }
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(AT);
  orgService.getHours.mockReset();
  orgService.setHours.mockReset();
  orgService.closeDay.mockReset();
  orgService.removeClosure.mockReset();
  orgService.updateOrg.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('the three modes are three different screens', () => {
  it('tells an owner who has not answered that they have not, and never says Closed', async () => {
    orgService.getHours.mockResolvedValue(answer({ mode: 'unset' }));
    render(<OpeningHoursPanel org={ORG} privileges={OWNER} />);

    // The SUMMARY is on the closed heading, which is where an owner reads it
    // first — so this assertion is made before opening anything.
    expect(await screen.findByText(/haven't said when your gym is open/i)).toBeTruthy();
    expect(screen.queryByText(/closed/i)).toBeNull();

    await openSection();
    // And inside, the week is not drawn at all: seven "Closed" rows for a gym
    // that has said nothing is exactly the sentence :26736 forbids.
    expect(screen.queryByText('Monday')).toBeNull();
  });

  it('says a 24-hour gym is open 24 hours, and draws no week', async () => {
    orgService.getHours.mockResolvedValue(answer({ mode: 'open_24h' }));
    render(<OpeningHoursPanel org={ORG} privileges={OWNER} />);

    expect(await screen.findByText('Your gym is open 24 hours.')).toBeTruthy();
    await openSection();
    expect(screen.queryByText('Monday')).toBeNull();
  });

  it('draws the week for a scheduled gym, and Closed is TRUE for its empty days', async () => {
    orgService.getHours.mockResolvedValue(
      answer({ week: [{ weekday: 3, sessions: [{ opensMinute: 360, closesMinute: 420 }] }] }),
    );
    render(<OpeningHoursPanel org={ORG} privileges={OWNER} />);

    expect(await screen.findByText(/opening times are set for 1 day a week/i)).toBeTruthy();
    await openSection();
    for (const day of ['Monday', 'Wednesday', 'Sunday']) {
      expect(screen.getByText(day)).toBeTruthy();
    }
    // **THE EMPTY ROWS DO NOT SAY Closed — Kd, 2026-09-01.** On the FORM a day
    // nobody has filled in is not a day the gym has declared shut, and the rule
    // is stated ONCE above the list instead of asserted on six separate rows.
    expect(screen.getAllByText('No times set').length).toBe(6);
    expect(screen.queryByText('Closed')).toBeNull();
    expect(screen.getByText('A day with no times is a day you are closed.')).toBeTruthy();
    // The seventh reads its times without being opened, which is what makes
    // folding an honest default rather than a hiding place.
    expect(screen.getByText('06:00 – 07:00')).toBeTruthy();

    openDay('Wednesday');
    expect(screen.getByLabelText('Wednesday session 1 opens hour').value).toBe('6');
  });
});

describe('a read that fails', () => {
  it('is drawn as a failure, forced open, and never as a gym with no hours', async () => {
    orgService.getHours.mockRejectedValue(new Error('network'));
    render(<OpeningHoursPanel org={ORG} privileges={OWNER} />);

    // FORCED OPEN — nobody clicked. A failure behind a shut heading is a failure
    // nobody sees, which is why this panel passes the flag and `GymDetailsPanel`
    // does not. **The RETRY BUTTON is the assertion rather than the sentence**:
    // `errorText` maps a dropped connection to its own wording, and pinning that
    // string here would make this test about `errorText` instead of about this
    // panel drawing a failure at all.
    expect(await screen.findByRole('button', { name: /try again/i })).toBeTruthy();
    expect(screen.getByText(/couldn't reach the server/i)).toBeTruthy();
    // The empty-state words must NOT be here. This is :8267's class, and on this
    // screen it would also be :26736's falsehood.
    expect(screen.queryByText(/haven't said when your gym is open/i)).toBeNull();
    expect(screen.queryByText('Monday')).toBeNull();
  });

  it('retries on the button and recovers', async () => {
    orgService.getHours
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(answer({ mode: 'open_24h' }));
    render(<OpeningHoursPanel org={ORG} privileges={OWNER} />);

    fireEvent.click(await screen.findByRole('button', { name: /try again/i }));
    await waitFor(() => {
      expect(screen.queryByText(/couldn't load/i)).toBeNull();
    });
    expect(screen.getByText('Open 24 hours')).toBeTruthy();
  });
});

describe('saving the week', () => {
  it('sends the whole week with ISO weekdays and minutes, sorted', async () => {
    orgService.getHours.mockResolvedValue(answer({ mode: 'unset' }));
    orgService.setHours.mockResolvedValue(
      answer({ week: [{ weekday: 1, sessions: [{ opensMinute: 360, closesMinute: 420 }] }] }),
    );
    render(<OpeningHoursPanel org={ORG} privileges={OWNER} />);
    await openSection();

    fireEvent.click(screen.getByLabelText('Set opening times'));
    openDay('Monday');
    fireEvent.click(screen.getByRole('button', { name: /add a time/i }));
    pickTime('Monday session 1 opens', { hour: 6, minute: 0 });
    pickTime('Monday session 1 closes', { hour: 7, minute: 0 });
    fireEvent.click(screen.getByRole('button', { name: /save opening times/i }));

    await waitFor(() => {
      expect(orgService.setHours).toHaveBeenCalledWith(ORG.id, {
        mode: 'scheduled',
        // Monday is 1, not 0 — the ISO convention the whole card turns on.
        week: [{ weekday: 1, sessions: [{ opensMinute: 360, closesMinute: 420 }] }],
      });
    });
    expect(await screen.findByText('Saved.')).toBeTruthy();
  });

  it('HOLDS a half-finished time, so picking the hour first is not thrown away', async () => {
    // **THE FIRST VERSION OF THE PICKER FAILED THIS AND THE CONTROL WAS
    // UNUSABLE.** The draft stores one string per end, which cannot express
    // "the hour is 6 and the minute is not chosen yet" — so deriving the boxes
    // from it meant picking the hour produced an empty string and the box
    // snapped straight back to `--`. Neither box would hold what you picked.
    //
    // The two picks are made SEPARATELY here on purpose: that is how a person
    // uses three boxes, and a test that set both at once would never see it.
    orgService.getHours.mockResolvedValue(answer({ mode: 'unset' }));
    render(<OpeningHoursPanel org={ORG} privileges={OWNER} />);
    await openSection();
    fireEvent.click(screen.getByLabelText('Set opening times'));
    openDay('Monday');
    fireEvent.click(screen.getByRole('button', { name: /add a time/i }));

    pickTime('Monday session 1 opens', { hour: 6 });
    // The hour survives on its own, with the minute still unchosen.
    expect(screen.getByLabelText('Monday session 1 opens hour').value).toBe('6');
    expect(screen.getByLabelText('Monday session 1 opens minute').value).toBe('');

    pickTime('Monday session 1 opens', { minute: 30 });
    expect(screen.getByLabelText('Monday session 1 opens hour').value).toBe('6');
    expect(screen.getByLabelText('Monday session 1 opens minute').value).toBe('30');

    // And a row that is still half-finished cannot be saved — the missing half
    // is refused rather than invented.
    expect(screen.getByRole('button', { name: /save opening times/i }).disabled).toBe(true);
    expect(screen.getByText(/isn't finished/i)).toBeTruthy();
  });

  it('picks a 12-hour time through all three boxes, and 4 PM is 16:00 on the wire', async () => {
    // The AM/PM box is the third thing that can be unset, and the conversion
    // (4 PM to 960 minutes) is the arithmetic a naive `h % 12` gets wrong.
    orgService.getHours.mockResolvedValue(answer({ mode: 'unset', clockFormat: '12h' }));
    orgService.setHours.mockResolvedValue(answer({ clockFormat: '12h' }));
    render(<OpeningHoursPanel org={ORG} privileges={OWNER} />);
    await openSection();
    fireEvent.click(screen.getByLabelText('Set opening times'));
    openDay('Monday');
    fireEvent.click(screen.getByRole('button', { name: /add a time/i }));

    pickTime('Monday session 1 opens', { hour: 6, minute: 0, meridiem: 'AM' });
    pickTime('Monday session 1 closes', { hour: 4, minute: 30, meridiem: 'PM' });
    fireEvent.click(screen.getByRole('button', { name: /save opening times/i }));

    await waitFor(() => {
      expect(orgService.setHours).toHaveBeenCalledWith(ORG.id, {
        mode: 'scheduled',
        week: [{ weekday: 1, sessions: [{ opensMinute: 360, closesMinute: 990 }] }],
      });
    });
  });
  it('refuses to send an overlap and says which two clash', async () => {
    orgService.getHours.mockResolvedValue(
      answer({
        week: [
          {
            weekday: 1,
            sessions: [
              { opensMinute: 600, closesMinute: 720 },
              { opensMinute: 780, closesMinute: 840 },
            ],
          },
        ],
      }),
    );
    render(<OpeningHoursPanel org={ORG} privileges={OWNER} />);
    await openSection();

    // Drag the FIRST session's close past the second session's start. The
    // label carries the session number, which is why this can name one of two
    // boxes that would otherwise be indistinguishable.
    openDay('Monday');
    pickTime('Monday session 1 closes', { hour: 14 });

    expect(await screen.findByText(/two sessions that overlap/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /save opening times/i }));
    // Nothing left the screen. The server would refuse it too — this is the
    // courtesy, that is the enforcement (R3.3).
    expect(orgService.setHours).not.toHaveBeenCalled();
  });

  it('leaves Save off until something actually moves', async () => {
    orgService.getHours.mockResolvedValue(
      answer({ week: [{ weekday: 1, sessions: [{ opensMinute: 360, closesMinute: 420 }] }] }),
    );
    render(<OpeningHoursPanel org={ORG} privileges={OWNER} />);
    await openSection();

    expect(screen.getByRole('button', { name: /save opening times/i }).disabled).toBe(true);
    openDay('Monday');
    pickTime('Monday session 1 closes', { hour: 8 });
    expect(screen.getByRole('button', { name: /save opening times/i }).disabled).toBe(false);
  });
});

describe("Kd's five changes at the screen (2026-09-01)", () => {
  it('picks times from a LIST, not by typing, and the list steps in quarter hours', async () => {
    // *"i have to type by hand what is this drop down should there to use not
    // hand type"*. A `<select>` and not `<input type="time">` — the role is the
    // assertion, because a time input would still satisfy a value check.
    orgService.getHours.mockResolvedValue(
      answer({ week: [{ weekday: 1, sessions: [{ opensMinute: 360, closesMinute: 420 }] }] }),
    );
    render(<OpeningHoursPanel org={ORG} privileges={OWNER} />);
    await openSection();
    openDay('Monday');

    // `_ _ : _ _` — an hour box and a minute box, both `<select>`, never one
    // list of ready-made times and never anything you type into.
    const hourBox = screen.getByLabelText('Monday session 1 opens hour');
    const minuteBox = screen.getByLabelText('Monday session 1 opens minute');
    expect(hourBox.tagName).toBe('SELECT');
    expect(minuteBox.tagName).toBe('SELECT');
    expect([...hourBox.options].map((o) => o.value)).toContain('5');
    expect([...minuteBox.options].map((o) => o.value)).toContain('30');
    // Both start EMPTY on an unfinished row rather than sitting on midnight.
    expect([...hourBox.options][0].value).toBe('');
  });

  it("labels every time on the GYM's clock, and BOTH clocks are driven", async () => {
    // *"for time both format shpuld be ther gym can choose format like it will
    // be 4 or 16"*. The pair is the assertion: either alone would pass with the
    // gym's choice ignored.
    orgService.getHours.mockResolvedValue(
      answer({
        clockFormat: '12h',
        week: [{ weekday: 1, sessions: [{ opensMinute: 960, closesMinute: 1260 }] }],
      }),
    );
    const { unmount } = render(<OpeningHoursPanel org={ORG} privileges={OWNER} />);
    await openSection();
    // The FOLDED row already reads on the gym's clock — that is where an owner
    // sees their week without opening anything.
    expect(screen.getByText('4:00 PM – 9:00 PM')).toBeTruthy();
    expect(screen.queryByText('16:00 – 21:00')).toBeNull();
    unmount();

    orgService.getHours.mockResolvedValue(
      answer({
        clockFormat: '24h',
        week: [{ weekday: 1, sessions: [{ opensMinute: 960, closesMinute: 1260 }] }],
      }),
    );
    render(<OpeningHoursPanel org={ORG} privileges={OWNER} />);
    await openSection();
    expect(screen.getByText('16:00 – 21:00')).toBeTruthy();
    expect(screen.queryByText('4:00 PM – 9:00 PM')).toBeNull();
  });

  it('saves the clock on its own, through the GYM and not through the hours', async () => {
    // It rides on `PATCH /v1/orgs/:gymId` because a gym that has never set hours
    // cannot send a `PUT /hours` at all — and that gym is exactly the one about
    // to type its first timetable, so it must be able to pick a clock first.
    orgService.getHours.mockResolvedValue(answer({ mode: 'unset', clockFormat: '24h' }));
    orgService.updateOrg.mockResolvedValue({ data: { org: { ...ORG, clockFormat: '12h' } } });
    render(<OpeningHoursPanel org={ORG} privileges={OWNER} />);
    await openSection();

    fireEvent.click(screen.getByLabelText(/12-hour/));

    await waitFor(() => {
      expect(orgService.updateOrg).toHaveBeenCalledWith(ORG.id, { clockFormat: '12h' });
    });
    // And NOT through the hours route, which an unanswered gym cannot use.
    expect(orgService.setHours).not.toHaveBeenCalled();
  });

  it('copies one day onto the whole week in a click, and only offers it on a day with times', async () => {
    // *"if gyms times are same for all day they should not manully set the
    // timings for eacg day they just click a button"*.
    orgService.getHours.mockResolvedValue(
      answer({ week: [{ weekday: 1, sessions: [{ opensMinute: 360, closesMinute: 420 }] }] }),
    );
    orgService.setHours.mockResolvedValue(answer({}));
    render(<OpeningHoursPanel org={ORG} privileges={OWNER} />);
    await openSection();

    // The control is absent on an EMPTY day — there it would clear the week in
    // one click, which is a destructive act wearing a convenience's label.
    openDay('Tuesday');
    expect(screen.queryByRole('button', { name: /use these times every day/i })).toBeNull();
    openDay('Tuesday');

    openDay('Monday');
    fireEvent.click(screen.getByRole('button', { name: /use these times every day/i }));

    // Every folded row now reads Monday's times, and nothing says Closed.
    expect(screen.getAllByText('06:00 – 07:00').length).toBe(7);
    expect(screen.queryByText('No times set')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /save opening times/i }));
    await waitFor(() => {
      expect(orgService.setHours).toHaveBeenCalled();
    });
    const sent = orgService.setHours.mock.calls[0][1];
    expect(sent.week.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('folds each day on its own — opening Tuesday does NOT close Monday', async () => {
    // *"clicking other day should not undo the drop"*. A single `openDay` value
    // would make this an accordion, which is the shape he ruled against, and it
    // is why the state is a Set.
    orgService.getHours.mockResolvedValue(
      answer({
        week: [
          { weekday: 1, sessions: [{ opensMinute: 360, closesMinute: 420 }] },
          { weekday: 2, sessions: [{ opensMinute: 540, closesMinute: 600 }] },
        ],
      }),
    );
    render(<OpeningHoursPanel org={ORG} privileges={OWNER} />);
    await openSection();

    // Everything starts folded: the rows read their times, the controls are not
    // mounted. That is what makes folding a shorter screen and not a hidden one.
    expect(screen.queryByLabelText('Monday session 1 opens hour')).toBeNull();

    openDay('Monday');
    expect(screen.getByLabelText('Monday session 1 opens hour')).toBeTruthy();

    openDay('Tuesday');
    // BOTH are open. This is the assertion the ruling is about.
    expect(screen.getByLabelText('Monday session 1 opens hour')).toBeTruthy();
    expect(screen.getByLabelText('Tuesday session 1 opens hour')).toBeTruthy();

    // And a day closes only when its OWN row is clicked again.
    openDay('Monday');
    expect(screen.queryByLabelText('Monday session 1 opens hour')).toBeNull();
    expect(screen.getByLabelText('Tuesday session 1 opens hour')).toBeTruthy();
  });
});

describe('a lapsed gym', () => {
  it('still SEES everything, and every control is quiet with the reason above it', async () => {
    // Kd's ruling: read-only seals nobody out (:23711). The panel is drawn
    // exactly as before; it is the controls that go dead.
    orgService.getHours.mockResolvedValue(
      answer({ week: [{ weekday: 1, sessions: [{ opensMinute: 360, closesMinute: 420 }] }] }),
    );
    render(<OpeningHoursPanel org={ORG} privileges={OWNER} readOnly />);
    await openSection();

    expect(screen.getByText(/needs a plan before anything here can be changed/i)).toBeTruthy();
    expect(screen.getByText('Monday')).toBeTruthy();
    openDay('Monday');
    expect(screen.getByLabelText('Monday session 1 opens hour').disabled).toBe(true);
    expect(screen.getByRole('button', { name: /save opening times/i }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /mark closed/i }).disabled).toBe(true);
  });

  /** **THE PLAN LAPSING MID-EDIT, and it is the only state in which the
   *  `readOnly` term in the save gate can be observed at all.**
   *
   *  The test above passes with that term DELETED — the mutation sweep proved
   *  it — because a gym rendered read-only from the start has every box
   *  disabled, so nothing is ever touched and Save is already off for that
   *  reason. A guard whose only test is satisfied by a different guard is not
   *  guarded (:7104's PG1).
   *
   *  This is a real journey, not a contrivance: the console re-reads its kept
   *  org answer on window focus, so an owner can be halfway through a timetable
   *  when the trial expires and `readOnly` flips under them. Their typing stays
   *  on screen — nothing is snatched away — and Save goes quiet with the reason
   *  above it. */
  it('stops a save that was already typed when the plan lapsed under it', async () => {
    orgService.getHours.mockResolvedValue(
      answer({ week: [{ weekday: 1, sessions: [{ opensMinute: 360, closesMinute: 420 }] }] }),
    );
    const { rerender } = render(<OpeningHoursPanel org={ORG} privileges={OWNER} />);
    await openSection();

    openDay('Monday');
    pickTime('Monday session 1 closes', { hour: 8 });
    // The positive control: with a plan, this edit is saveable. Without it the
    // assertion below would be satisfied by a Save that was never live.
    expect(screen.getByRole('button', { name: /save opening times/i }).disabled).toBe(false);

    rerender(<OpeningHoursPanel org={ORG} privileges={OWNER} readOnly />);

    expect(screen.getByRole('button', { name: /save opening times/i }).disabled).toBe(true);
    expect(screen.getByText(/needs a plan before anything here can be changed/i)).toBeTruthy();
    // AND THE TYPING SURVIVES. A lapsed gym is read-only, not wiped — taking an
    // owner's half-finished timetable away would be a second, worse surprise.
    expect(screen.getByLabelText('Monday session 1 closes hour').value).toBe('8');
  });
});

describe('closing a date', () => {
  it('sends the date and the reason, and lists it back', async () => {
    orgService.getHours.mockResolvedValue(answer({ mode: 'open_24h' }));
    orgService.closeDay.mockResolvedValue(
      answer({ mode: 'open_24h', closures: [{ day: '2026-09-20', note: 'Holi' }] }),
    );
    render(<OpeningHoursPanel org={ORG} privileges={OWNER} />);
    await openSection();

    fireEvent.change(screen.getByLabelText('Date to close'), { target: { value: '2026-09-20' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Holi' } });
    fireEvent.click(screen.getByRole('button', { name: /mark closed/i }));

    await waitFor(() => {
      expect(orgService.closeDay).toHaveBeenCalledWith(ORG.id, { day: '2026-09-20', note: 'Holi' });
    });
    expect(await screen.findByText(/2026-09-20/)).toBeTruthy();
  });

  it('does NOT bound the date box, so a past closure can still be recorded', async () => {
    // **THIS ASSERTS AN ABSENCE AND IT IS A REGRESSION GUARD.** `min` and `max`
    // were both here first — the gym's own today and the server's one-year read
    // horizon — and the "saves and does not come back" test below found that an
    // HTML `min` is a CONSTRAINT, not a hint: the form silently refuses to
    // submit, with no event and no sentence, making a past closure IMPOSSIBLE to
    // record from this screen. The server accepts one deliberately, so bounding
    // the box removed a capability and explained nothing. Put either attribute
    // back and the test below goes red — which is the point of writing this one.
    orgService.getHours.mockResolvedValue(answer({ mode: 'open_24h' }));
    render(<OpeningHoursPanel org={ORG} privileges={OWNER} />);
    await openSection();

    const box = screen.getByLabelText('Date to close');
    expect(box.getAttribute('min')).toBeNull();
    expect(box.getAttribute('max')).toBeNull();
  });

  it('SAYS SO when a save succeeds and the date does not come back', async () => {
    // The carry-forward from T3 round 1. The write has no date window on purpose
    // and the read is today-forward, so a closure typed for yesterday is saved
    // and absent — and a screen that just re-rendered the reply would look as
    // though the save silently failed (:5807 through a correct server).
    orgService.getHours.mockResolvedValue(answer({ mode: 'open_24h' }));
    orgService.closeDay.mockResolvedValue(answer({ mode: 'open_24h', closures: [] }));
    render(<OpeningHoursPanel org={ORG} privileges={OWNER} />);
    await openSection();

    fireEvent.change(screen.getByLabelText('Date to close'), { target: { value: '2026-08-30' } });
    fireEvent.click(screen.getByRole('button', { name: /mark closed/i }));

    expect(await screen.findByText(/already passed at your gym, so it's saved but not shown/i)).toBeTruthy();
    // And it is NOT reported as a failure — it worked.
    expect(screen.queryByText(/couldn't save/i)).toBeNull();
  });

  it('undoes a closure and drops it from the list', async () => {
    orgService.getHours.mockResolvedValue(
      answer({ mode: 'open_24h', closures: [{ day: '2026-09-20', note: null }] }),
    );
    orgService.removeClosure.mockResolvedValue(answer({ mode: 'open_24h', closures: [] }));
    render(<OpeningHoursPanel org={ORG} privileges={OWNER} />);
    await openSection();

    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    await waitFor(() => {
      expect(orgService.removeClosure).toHaveBeenCalledWith(ORG.id, '2026-09-20');
    });
    expect(await screen.findByText('No dates coming up.')).toBeTruthy();
  });
});
