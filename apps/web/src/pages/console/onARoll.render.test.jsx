// "On a roll" and its one tap, on the SCREEN. The pure suite next door proves
// the sentences; this proves an owner can see and press them.
//
// **THE CASES HERE ARE THE ONES A PURE TEST STRUCTURALLY CANNOT SEE**: which
// preset a given emoji actually sends, that a second tap cannot go out, that the
// server's `cheerableAt` is re-read afterwards, and that a control the server
// would refuse is never drawn live. :29250 §5, :29117 §2 and :30399 §6 are three
// consecutive rounds in which a test written to hold a guarantee passed under
// its removal — every assertion below is written to fail under the revert.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { attendanceDay, overview, regular } from './__fixtures__/overview';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getMine: vi.fn(),
      getMembers: vi.fn(),
      getCodes: vi.fn(),
      getApplications: vi.fn(),
      getOverview: vi.fn(),
      getAttendanceDay: vi.fn(),
      sendCheer: vi.fn(),
    },
  };
});

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, logout: vi.fn() }),
}));

const { orgService } = await import('../../api/orgsApi');
const { resetConsoleOrgs } = await import('./consoleOrgs');
const Overview = (await import('./Overview')).default;

const GYM_ID = '11111111-1111-1111-1111-111111111111';

/** An owner of a gym on a live plan. `privileges` is stated rather than left to
 *  the role template, because `members.read` is exactly what this card's control
 *  turns on and a test that inherited it could not tell the two apart. */
const ORG = {
  id: GYM_ID,
  slug: 'iron-house',
  name: 'Iron House',
  city: 'Austin',
  orgType: 'gym',
  timezone: 'America/Chicago',
  locale: 'en',
  currencyDisplay: 'USD',
  status: 'active',
  staffRole: 'owner',
  isMember: true,
  joinedAt: '2026-08-18T09:00:00.000Z',
  privileges: ['members.read', 'attendance.read'],
  consoleReadOnly: false,
};

/** ACTIVITY, so the numbers zone reaches its `ready` arm at all. A gym with no
 *  members and no visits draws NOTHING on this pane (§4.1's own edge), so a
 *  fixture without this would test the panel by never rendering it — which is
 *  :28976's vacuity class arriving through the screen above. */
const BUSY = { today: { visits: 3, visitors: 2 }, month: { visitors: 2, members: 4, adoptionPct: 50 } };

const withRoll = (rows) => overview({ ...BUSY, onARoll: rows });

/** TWO ROWS, AND EVERY TAP IN THIS FILE LANDS ON THE SECOND ONE.
 *
 *  **MEASURED, NOT THEORISED: the single-row version of this fixture left C220
 *  ALIVE.** That mutant sends the cheer to `onARoll[0]` instead of the member
 *  whose button was pressed — an owner encouraging Priya cheers somebody else,
 *  and the seven-day cap then locks the wrong person out for a week, with no
 *  error anywhere. With one name on the list those two are the SAME person and
 *  the assertion cannot tell them apart.
 *
 *  It is `CARD-gym-overview-people.md` §5 risk 4 and `:28221` §3b in the shape
 *  a screen takes: a fixture with one of something cannot see code that reaches
 *  for the wrong one. Asha is first so that Priya — who every assertion below
 *  names — is never row zero. */
const ROLL = [
  regular({ userId: 'r0', displayName: 'Asha Roy', weeksRunning: 2, daysRunning: 0, visits: 2 }),
  regular({ userId: 'r1', displayName: 'Priya Nair' }),
];

const drawOverview = () =>
  render(
    <MemoryRouter initialEntries={['/console/iron-house']}>
      <Routes>
        <Route path="/console/:orgSlug" element={<Overview />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  resetConsoleOrgs();
  orgService.getMine.mockResolvedValue({ data: { orgs: [ORG] } });
  orgService.getCodes.mockResolvedValue({ data: { codes: [] } });
  orgService.getMembers.mockResolvedValue({
    data: { items: [], nextCursor: null, seatsUsed: 0, seatCap: null },
  });
  orgService.getApplications.mockResolvedValue({ data: { items: [], nextCursor: null, pendingCount: 0 } });
  orgService.getAttendanceDay.mockResolvedValue(attendanceDay());
  orgService.getOverview.mockResolvedValue(withRoll(ROLL));
  orgService.sendCheer.mockResolvedValue({ data: { cheer: { preset: 'keep_going', sentAt: '2026-09-05T10:00:00.000Z' } } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the list of members who keep turning up', () => {
  it('draws the name and both figures Kd ruled', async () => {
    drawOverview();
    expect(await screen.findByText('Priya Nair')).toBeTruthy();
    expect(screen.getByText('5 weeks in a row · 3 days in a row · 11 visits')).toBeTruthy();
  });

  // :30624's class ON THE SCREEN, not only in the helper: two true figures
  // arranged into a sentence that reads as a contradiction. The pure test proves
  // `streakParts` hides it; this proves the row is built through that rule
  // rather than from the fields directly.
  it('does not print a one-day streak beside a long week streak', async () => {
    orgService.getOverview.mockResolvedValue(
      withRoll([regular({ weeksRunning: 6, daysRunning: 1, visits: 9 })]),
    );
    drawOverview();
    expect(await screen.findByText('6 weeks in a row · 9 visits')).toBeTruthy();
    expect(screen.queryByText(/1 day in a row/)).toBeNull();
  });

  // :8267/:8343 — "nobody is on a run" is a real answer and must be told apart
  // from a gym with nothing recorded (which the pane above answers) and from a
  // failed read (which the screen's own error arm answers).
  it('says why the list is empty rather than drawing nothing', async () => {
    orgService.getOverview.mockResolvedValue(withRoll([]));
    drawOverview();
    expect(await screen.findByText(/Nobody is on a run of 2 weeks or more right now/)).toBeTruthy();
  });

  // **THERE IS NO TOTAL ON THIS PAYLOAD AND THERE MUST NOT BE ONE ON THE
  // SCREEN** (:27992 §3, Kd's ruling 14). The server sends at most ten and the
  // screen shows five; any "and N more" here would be the list's own length
  // wearing a total's clothes.
  it('previews five and claims no total', async () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      regular({ userId: `r${i}`, displayName: `Member ${i}` }),
    );
    orgService.getOverview.mockResolvedValue(withRoll(rows));
    drawOverview();
    expect(await screen.findByText('Member 0')).toBeTruthy();
    expect(screen.queryByText('Member 5')).toBeNull();
    expect(screen.queryByText(/more/i)).toBeNull();
  });
});

describe('the one tap', () => {
  /** WAITS, and it has to: the screen resolves the gym and then the five reads
   *  before a single row exists. A synchronous `getBy` here would race the
   *  loading spinner rather than the code under test. */
  const cheerButton = (label) =>
    screen.findByLabelText(new RegExp(`^Cheer Priya Nair: ${label}`));

  // **PRIYA IS THE SECOND ROW, AND THAT IS THE WHOLE ASSERTION.** `ROLL` puts
  // Asha first precisely so `onARoll[0]` is not the member being pressed — see
  // the fixture's own note, and C220, which was ALIVE until it was.
  it('sends the gym, the member and the line the owner actually pressed', async () => {
    drawOverview();
    fireEvent.click(await screen.findByLabelText('Cheer Priya Nair: Great week — keep it going.'));
    await waitFor(() => expect(orgService.sendCheer).toHaveBeenCalledTimes(1));
    expect(orgService.sendCheer).toHaveBeenCalledWith(GYM_ID, 'r1', 'keep_going');
    // AND NOT ASHA, said out loud rather than left to the argument list: the
    // defect this catches sends to the wrong person and reports nothing.
    expect(orgService.sendCheer).not.toHaveBeenCalledWith(GYM_ID, 'r0', 'keep_going');
  });

  // **A SECOND BUTTON, SENDING A DIFFERENT PRESET.** With one case a panel that
  // hard-coded `keep_going` — or that read the first choice for every button —
  // would pass perfectly. The two cases together are what pin the mapping.
  it('sends a different line from a different button', async () => {
    drawOverview();
    fireEvent.click(await screen.findByLabelText('Cheer Priya Nair: Strong streak.'));
    await waitFor(() => expect(orgService.sendCheer).toHaveBeenCalledTimes(1));
    expect(orgService.sendCheer).toHaveBeenCalledWith(GYM_ID, 'r1', 'strong_streak');
  });

  // **THE ASSERTION IS THE STATE THE CONTROL IS NOT IN WHEN YOU FIND IT** —
  // :31295's standing rule for a two-state control, written after a dropdown
  // shipped twice that could not be closed and whose test asserted only that it
  // ARRIVED open. A case checking the buttons are present at the start would
  // pass under a panel that never disables anything.
  it('puts the buttons away once the cheer has gone, and says so', async () => {
    drawOverview();
    fireEvent.click(await cheerButton('Great week'));
    expect(await screen.findByText('Cheered just now.')).toBeTruthy();
    expect(screen.queryByLabelText(/^Cheer Priya Nair/)).toBeNull();
  });

  // THE SERVER OWNS `cheerableAt`, so the screen has to go and get it. Without
  // this read the button's sentence would be right until the page was reloaded
  // and wrong in a second browser looking at the same gym.
  //
  // **ITS NAME USED TO SAY "so the reopening date comes from the server", AND
  // THIS CASE CANNOT SEE THAT** — its mock returns the same payload both times,
  // so it observes the REQUEST and never the answer. T3 round 2 listed it under
  // `:5348` rule 4. The guarantee the old name claimed is held by the case
  // below, written for it in round 1; renamed rather than deleted, because
  // "the request goes at all" is still worth pinning on its own.
  it('goes back to the server after a cheer', async () => {
    drawOverview();
    await screen.findByText('Priya Nair');
    expect(orgService.getOverview).toHaveBeenCalledTimes(1);
    fireEvent.click(await cheerButton('Great week'));
    await waitFor(() => expect(orgService.getOverview).toHaveBeenCalledTimes(2));
  });

  // **T3 ROUND 1 C/H-1, AND THE CASE ABOVE IS EXACTLY WHY IT WAS NEEDED.** That
  // one proves the request GOES; it says nothing about the answer reaching the
  // screen, because its mock returns the same payload both times. Measured on
  // the shipping bytes: the row still read "Cheered just now." an hour after
  // the tap, for the whole life of the mount, and only a reload corrected it —
  // :7298 (a sentence outliving its condition) and :5807 (on screen and false).
  //
  // The second read carries the real `cheerableAt`, which is the ONLY channel
  // that instant travels on (the 409 omits it — `:34240` §6).
  it('draws the reopening date the re-read brought back, in place of "just now"', async () => {
    const reopensAt = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
    orgService.getOverview
      .mockResolvedValueOnce(withRoll(ROLL))
      .mockResolvedValue(
        withRoll([ROLL[0], regular({ userId: 'r1', displayName: 'Priya Nair', cheerableAt: reopensAt })]),
      );
    drawOverview();
    await screen.findByText('Priya Nair');
    fireEvent.click(await cheerButton('Great week'));
    expect(await screen.findByText('Cheered — you can again in 7 days.')).toBeTruthy();
    expect(screen.queryByText('Cheered just now.')).toBeNull();
  });

  // THE OTHER DIRECTION, so the fix cannot be satisfied by deleting the local
  // flag: while the re-read is still in flight the payload has no instant on
  // it, and the row must STILL put its buttons away or a second cheer goes out
  // behind the first.
  it('still puts the buttons away while the re-read is in flight', async () => {
    let release = () => {};
    orgService.getOverview
      .mockResolvedValueOnce(withRoll(ROLL))
      .mockImplementation(() => new Promise((resolve) => {
        release = () => resolve(withRoll(ROLL));
      }));
    drawOverview();
    await screen.findByText('Priya Nair');
    fireEvent.click(await cheerButton('Great week'));
    expect(await screen.findByText('Cheered just now.')).toBeTruthy();
    expect(screen.queryByLabelText(/^Cheer Priya Nair/)).toBeNull();
    release();
  });

  // A FAILED RE-READ MUST NOT BE REPORTED AS A FAILED CHEER. The cheer landed;
  // saying otherwise is :5807 on a screen — a false statement about something
  // that already happened.
  it('does not turn a failed refresh into a failed cheer', async () => {
    drawOverview();
    await screen.findByText('Priya Nair');
    orgService.getOverview.mockRejectedValue(new Error('network'));
    fireEvent.click(await cheerButton('Great week'));
    expect(await screen.findByText('Cheered just now.')).toBeTruthy();
    expect(screen.queryByText(/couldn't send/i)).toBeNull();
  });

  it("prints the server's own sentence when a send fails", async () => {
    orgService.sendCheer.mockRejectedValue({
      response: { status: 500, data: { error: 'server_error', message: 'Something went wrong.' } },
    });
    drawOverview();
    fireEvent.click(await cheerButton('Great week'));
    expect(await screen.findByText('Something went wrong.')).toBeTruthy();
    // A GENUINE FAILURE LEAVES THE BUTTONS, because pressing again is the
    // retry and the cheer did not happen.
    expect(screen.getByLabelText('Cheer Priya Nair: Great week — keep it going.')).toBeTruthy();
  });

  // **A 409 IS A FACT AND NOT A FAILED ATTEMPT**, and the sentence must not
  // claim the reader did it: the cap is per GYM, so it may have been a
  // colleague, days ago (`:34443` §4).
  it('takes the server\'s word that the member was already cheered, without saying who by', async () => {
    orgService.sendCheer.mockRejectedValue({
      response: {
        status: 409,
        data: {
          error: 'cheer_already_sent',
          message: 'This member has already been cheered in the last 7 days.',
        },
      },
    });
    drawOverview();
    fireEvent.click(await cheerButton('Great week'));
    expect(await screen.findByText('Cheered in the last 7 days.')).toBeTruthy();
    expect(screen.queryByLabelText(/^Cheer Priya Nair/)).toBeNull();
    expect(screen.queryByText(/just now/)).toBeNull();
    // **AND ONCE, NOT TWICE** (T3 round 1 L-3). This used to draw the server's
    // sentence in red as well, so the row said the same true thing through the
    // FAILURE channel — under a comment saying a 409 is not a failure. The
    // assertion above is this one's positive control (:28976): the fact is
    // still on screen, in the grey the other three refusals use.
    expect(
      screen.queryByText('This member has already been cheered in the last 7 days.'),
    ).toBeNull();
  });
});

describe('the button an owner may not press', () => {
  // :12518 C/H-2 — the trainer drawn a Remove button the server would refuse.
  // The overview read is gated on `attendance.read` and the cheer on
  // `members.read`, so this person legitimately SEES the list.
  it('is not drawn live for a role without the roster tick', async () => {
    orgService.getMine.mockResolvedValue({
      data: { orgs: [{ ...ORG, staffRole: 'trainer', privileges: ['attendance.read'] }] },
    });
    drawOverview();
    expect(await screen.findByText('Priya Nair')).toBeTruthy();
    expect(screen.queryByLabelText(/^Cheer Priya Nair/)).toBeNull();
    // **EVERY ROW, NOT SOME ROW** (:25567, :29500). The list draws two people,
    // so a `getByText` here would throw on the second and a `queryByText` would
    // be satisfied by a refusal on one row and a live button on the other — the
    // half-applied guard being the defect worth catching.
    expect(screen.getAllByText('Your role cannot send this.')).toHaveLength(ROLL.length);
  });

  // :24141 — every dead control on this console is greyed WITH the sentence for
  // why, never silently inert. And :23711: a cheer is a write, so a gym with no
  // live plan stops acting on its members.
  it('is greyed with the reason on a gym that has no plan', async () => {
    orgService.getMine.mockResolvedValue({
      data: { orgs: [{ ...ORG, consoleReadOnly: true }] },
    });
    drawOverview();
    expect(await screen.findByText('Priya Nair')).toBeTruthy();
    expect(screen.queryByLabelText(/^Cheer Priya Nair/)).toBeNull();
    // Every row, for the reason above.
    expect(
      screen.getAllByText('This gym needs a plan before anything here can be changed.'),
    ).toHaveLength(ROLL.length);
  });

  // THE POSITIVE CONTROL FOR BOTH OF THE ABOVE. Two tests asserting a button is
  // ABSENT are satisfied by a panel that never draws one — :28976's vacuity
  // class, and the reason every absence assertion in this repo now carries its
  // opposite.
  it('IS drawn for an owner of a gym on a plan', async () => {
    drawOverview();
    expect(await screen.findByLabelText('Cheer Priya Nair: Great week — keep it going.')).toBeTruthy();
    expect(screen.queryByText('Your role cannot send this.')).toBeNull();
  });

  // **THE DEAD BUTTON SAYS WHEN IT COMES BACK**, off the server's own instant —
  // the 409 deliberately omits it, so `cheerableAt` is the only channel there
  // is (`:34240` §6).
  it('names the day it reopens when the server says the window is shut', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T12:00:00.000Z'));
    orgService.getOverview.mockResolvedValue(
      withRoll([regular({ cheerableAt: '2026-09-09T12:00:00.000Z' })]),
    );
    drawOverview();
    await vi.waitFor(() => expect(screen.getByText('Cheered — you can again in 4 days.')).toBeTruthy());
    expect(screen.queryByLabelText(/^Cheer Priya Nair/)).toBeNull();
  });
});
