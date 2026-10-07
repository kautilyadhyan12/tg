// Overview's "Start here" list (ROADMAP 23b): what a gym's owner and staff SEE.
//
// The server's own rules (whose ticks, who is sent which step) are tested on real Postgres
// in `apps/api/test/startHere.routes.test.ts`; here the page draws the answer it is given.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { startHereResponseSchema } from '@app/shared';
import { attendanceDay, overview } from './__fixtures__/overview';

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
      getStartHere: vi.fn(),
      setStartHereHidden: vi.fn(),
    },
  };
});

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, logout: vi.fn() }),
}));

const { orgService } = await import('../../api/orgsApi');
const { resetConsoleOrgs } = await import('./consoleOrgs');
const Overview = (await import('./Overview')).default;

const ORG = {
  id: '11111111-1111-1111-1111-111111111111',
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
};
const ownerSeat = {
  userId: 'u1',
  displayName: 'Kd Owner',
  joinedAt: '2026-08-18T09:00:00.000Z',
  groupLabel: null,
  complimentary: false,
  takesSeat: true,
  staff: { role: 'owner', roleName: null },
};

const ALL = ['memberships', 'members', 'staff', 'classes', 'hours', 'frontDesk'];
/** The server's answer, held to its contract so a fixture cannot drift from it. */
const answer = ({ done = [], steps = ALL, hidden = false, canHide = true } = {}) => ({
  data: startHereResponseSchema.parse({
    startHere: { hidden, canHide, steps: steps.map((step) => ({ step, done: done.includes(step) })) },
  }),
});
const apiError = (status, error, message) => ({ response: { status, data: { error, message, requestId: 'r' } } });
const retired = () => apiError(410, 'join_codes_retired', 'Join codes have been switched off. A gym now invites people by email.');

const draw = () =>
  render(
    <MemoryRouter initialEntries={['/console/iron-house']}>
      <Routes>
        <Route path="/console/:orgSlug" element={<Overview />} />
      </Routes>
    </MemoryRouter>,
  );
const box = () => screen.findByTestId('start-here');
const rowOf = (card, step) => card.querySelector(`[data-step="${step}"]`);

beforeEach(() => {
  vi.clearAllMocks();
  resetConsoleOrgs();
  orgService.getMine.mockResolvedValue({ data: { orgs: [ORG] } });
  // Join codes are off, as they are since 3c: "Bring your members in" stands where the code was.
  orgService.getCodes.mockRejectedValue(retired());
  orgService.getApplications.mockRejectedValue(retired());
  orgService.getMembers.mockResolvedValue({ data: { items: [ownerSeat], nextCursor: null } });
  orgService.getOverview.mockResolvedValue(overview());
  orgService.getAttendanceDay.mockResolvedValue(attendanceDay());
  orgService.getStartHere.mockResolvedValue(answer());
});

afterEach(() => {
  cleanup();
});

describe('a gym made today', () => {
  it('opens on Start here: six steps, none done, each with a button to its own place', async () => {
    draw();
    const card = await box();
    expect(orgService.getStartHere).toHaveBeenCalledWith(ORG.id);
    expect(within(card).getByRole('heading', { name: 'Set up your gym' })).toBeTruthy();
    expect(within(card).getByTestId('start-here-count').textContent).toBe('0 of 6 done');
    const rows = [...card.querySelectorAll('[data-step]')];
    expect(rows.map((r) => r.getAttribute('data-step'))).toEqual(ALL);
    expect(rows.every((r) => r.getAttribute('data-done') === 'false')).toBe(true);
    expect(rows.every((r) => /Not done yet/.test(r.textContent))).toBe(true);

    const links = within(card)
      .getAllByRole('link')
      .map((a) => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([
      ['Set up memberships', '/console/iron-house/settings#memberships'],
      ['Import members', '/console/iron-house/members?open=import'],
      ['Add member', '/console/iron-house/members?open=add'],
      ['Invite staff', '/console/iron-house/settings#staff'],
      ['Set up classes', '/console/iron-house/classes'],
      ['Set opening hours', '/console/iron-house/settings#opening-hours'],
      ['Set up check-in', '/console/iron-house/settings#check-in-devices'],
    ]);
  });

  it('is the first thing on the page, above the plan and everything else', async () => {
    draw();
    const card = await box();
    const after = screen.getByText(/Nobody has joined yet/);
    expect(card.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const title = screen.getByRole('heading', { name: 'Iron House' });
    expect(title.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('"Bring your members in" is in the list, and not drawn a second time under it', async () => {
    draw();
    const card = await box();
    expect(within(rowOf(card, 'members')).getByText('Bring your members in')).toBeTruthy();
    expect(screen.getAllByText('Bring your members in')).toHaveLength(1);
    expect(screen.queryByTestId('bring-members-in')).toBeNull();
    expect(screen.getAllByRole('link', { name: 'Import members' })).toHaveLength(1);
  });
});

describe('ticks', () => {
  it('a step the gym has done is ticked and counted, and its button still opens its page', async () => {
    orgService.getStartHere.mockResolvedValue(answer({ done: ['memberships', 'hours'] }));
    draw();
    const card = await box();
    expect(within(card).getByTestId('start-here-count').textContent).toBe('2 of 6 done');
    expect(ALL.map((step) => rowOf(card, step).getAttribute('data-done'))).toEqual(['true', 'false', 'false', 'false', 'true', 'false']);
    expect(rowOf(card, 'memberships').textContent).toMatch(/What you sell · Done/);
    expect(rowOf(card, 'members').textContent).toMatch(/Not done yet/);
    expect(within(rowOf(card, 'memberships')).getByRole('link', { name: 'Set up memberships' }).getAttribute('href')).toBe(
      '/console/iron-house/settings#memberships',
    );
  });

  it('every step done: the box says so and can be hidden', async () => {
    orgService.getStartHere.mockResolvedValue(answer({ done: ALL }));
    draw();
    const card = await box();
    expect(within(card).getByRole('heading', { name: 'Your gym is set up' })).toBeTruthy();
    expect(within(card).getByTestId('start-here-count').textContent).toBe('6 of 6 done');
    expect(within(card).queryByText(/Not done yet/)).toBeNull();
    expect(within(card).getByRole('button', { name: 'Hide this list' })).toBeTruthy();
  });
});

describe('who sees what', () => {
  it("a manager is shown only the steps they can do, counted out of their own, and no Hide", async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, staffRole: 'manager' }] } });
    orgService.getStartHere.mockResolvedValue(answer({ steps: ['memberships', 'members', 'classes'], done: ['members'], canHide: false }));
    draw();
    const card = await box();
    expect([...card.querySelectorAll('[data-step]')].map((r) => r.getAttribute('data-step'))).toEqual(['memberships', 'members', 'classes']);
    expect(within(card).getByTestId('start-here-count').textContent).toBe('1 of 3 done');
    expect(within(card).queryByRole('button', { name: 'Hide this list' })).toBeNull();
    expect(within(card).queryByText('Invite your staff')).toBeNull();
  });

  it('somebody with no step of their own sees no list, and the page as it was', async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, staffRole: 'trainer' }] } });
    orgService.getStartHere.mockResolvedValue(answer({ steps: [], canHide: false }));
    draw();
    expect(await screen.findByText('1 member (you)')).toBeTruthy();
    expect(screen.queryByTestId('start-here')).toBeNull();
    expect(screen.queryByTestId('start-here-hidden')).toBeNull();
    expect(screen.queryByTestId('bring-members-in')).toBeNull();
  });

  it('staff whose steps are all done, and who cannot hide the list, see none', async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, staffRole: 'manager' }] } });
    orgService.getStartHere.mockResolvedValue(answer({ steps: ['memberships', 'members'], done: ['memberships', 'members'], canHide: false }));
    draw();
    // The card is back, as before the list: nothing else on the page offers Import and Add.
    expect(await screen.findByTestId('bring-members-in')).toBeTruthy();
    expect(screen.queryByTestId('start-here')).toBeNull();
  });
});

describe('Hide this list, and showing it again', () => {
  it('Hide asks the server, then the list goes, "Bring your members in" is back, and one line offers to show it', async () => {
    orgService.setStartHereHidden.mockResolvedValue(answer({ hidden: true }));
    draw();
    const card = await box();
    expect(within(card).getByText(/It is hidden for everyone at your gym\. You can show it again from the bottom of this page\./)).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Hide this list' }));
    await waitFor(() => expect(screen.queryByTestId('start-here')).toBeNull());
    expect(orgService.setStartHereHidden).toHaveBeenCalledTimes(1);
    expect(orgService.setStartHereHidden).toHaveBeenCalledWith(ORG.id, true);
    expect(screen.getByTestId('bring-members-in')).toBeTruthy();
    const line = screen.getByTestId('start-here-hidden');
    expect(line.textContent).toMatch(/The Start here list is hidden\./);

    orgService.setStartHereHidden.mockResolvedValue(answer({ done: ['members'] }));
    fireEvent.click(within(line).getByRole('button', { name: 'Show the Start here list' }));
    const again = await box();
    expect(orgService.setStartHereHidden).toHaveBeenLastCalledWith(ORG.id, false);
    expect(within(again).getByTestId('start-here-count').textContent).toBe('1 of 6 done');
    expect(screen.queryByTestId('start-here-hidden')).toBeNull();
    expect(screen.queryByTestId('bring-members-in')).toBeNull();
  });

  it('a list the gym hid opens hidden: the page as it was, and the line at its foot', async () => {
    orgService.getStartHere.mockResolvedValue(answer({ hidden: true }));
    draw();
    const line = await screen.findByTestId('start-here-hidden');
    expect(screen.queryByTestId('start-here')).toBeNull();
    expect(screen.getByTestId('bring-members-in')).toBeTruthy();
    // After everything else on the page.
    const details = screen.getByText('Details');
    expect(details.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('hidden, for staff who cannot show it: no list and no line', async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, staffRole: 'manager' }] } });
    orgService.getStartHere.mockResolvedValue(answer({ steps: ['members'], hidden: true, canHide: false }));
    draw();
    expect(await screen.findByTestId('bring-members-in')).toBeTruthy();
    expect(screen.queryByTestId('start-here')).toBeNull();
    expect(screen.queryByTestId('start-here-hidden')).toBeNull();
  });

  it("a Hide the server refuses leaves the list where it was, with the server's own words", async () => {
    orgService.setStartHereHidden.mockRejectedValue(apiError(403, 'forbidden', "Your role doesn't allow that."));
    draw();
    const card = await box();
    fireEvent.click(within(card).getByRole('button', { name: 'Hide this list' }));
    expect(await within(card).findByRole('alert')).toBeTruthy();
    expect(within(card).getByRole('alert').textContent).toBe("Your role doesn't allow that.");
    expect(screen.getByTestId('start-here')).toBeTruthy();
    expect(screen.queryByTestId('start-here-hidden')).toBeNull();
    expect(within(card).getByRole('button', { name: 'Hide this list' }).disabled).toBe(false);
  });

  it('a Hide that never reached the server says so and can be pressed again', async () => {
    orgService.setStartHereHidden.mockRejectedValue(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));
    draw();
    const card = await box();
    fireEvent.click(within(card).getByRole('button', { name: 'Hide this list' }));
    expect(await within(card).findByRole('alert')).toBeTruthy();
    expect(screen.getByTestId('start-here')).toBeTruthy();
    orgService.setStartHereHidden.mockResolvedValue(answer({ hidden: true }));
    fireEvent.click(within(card).getByRole('button', { name: 'Hide this list' }));
    await waitFor(() => expect(screen.queryByTestId('start-here')).toBeNull());
    expect(orgService.setStartHereHidden).toHaveBeenCalledTimes(2);
  });
});

describe('when the list cannot be read, or the gym has no plan', () => {
  it('a failed read draws no list and no error: the page is the one a gym had before', async () => {
    orgService.getStartHere.mockRejectedValue(apiError(500, 'internal', 'Something went wrong.'));
    draw();
    expect(await screen.findByTestId('bring-members-in')).toBeTruthy();
    expect(screen.queryByTestId('start-here')).toBeNull();
    expect(screen.queryByTestId('start-here-hidden')).toBeNull();
    expect(screen.queryByText(/Try again/)).toBeNull();
    expect(screen.queryByText('Something went wrong.')).toBeNull();
  });

  it('an answer this screen cannot read draws no list either', async () => {
    orgService.getStartHere.mockResolvedValue({ data: {} });
    draw();
    expect(await screen.findByTestId('bring-members-in')).toBeTruthy();
    expect(screen.queryByTestId('start-here')).toBeNull();
  });

  it('a gym with no live plan: the list still shows, Import, Add and Hide are greyed, and the other pages still open', async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, consoleReadOnly: true }] } });
    draw();
    const card = await box();
    const members = rowOf(card, 'members');
    expect(within(members).queryAllByRole('link')).toHaveLength(0);
    expect(within(members).getByRole('button', { name: 'Import members' }).disabled).toBe(true);
    expect(within(members).getByRole('button', { name: 'Add member' }).disabled).toBe(true);
    expect(within(card).getByRole('button', { name: 'Hide this list' }).disabled).toBe(true);
    expect(within(card).getByRole('link', { name: 'Set up memberships' })).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'Set opening hours' })).toBeTruthy();
  });
});

describe("another kind of organisation's own words", () => {
  it('a studio reads studio and clients', async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, orgType: 'studio' }] } });
    draw();
    const card = await box();
    expect(within(card).getByRole('heading', { name: 'Set up your studio' })).toBeTruthy();
    expect(within(rowOf(card, 'members')).getByText('Bring your clients in')).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'Add client' }).getAttribute('href')).toBe('/console/iron-house/members?open=add');
    expect(within(card).getByText(/Leave out anything your studio doesn't use\./)).toBeTruthy();
  });
});
