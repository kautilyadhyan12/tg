// The Memberships page (ROADMAP 23c-i): what a gym sells, on a line of its own in the menu.
//
// THE WORST THING IT COULD DO: staff who may not change prices get the page, and inside it
// the names of the people on the gym's list. So the first tests are that somebody without
// the tick has no line in the menu, and that the address typed by hand tells them so and
// asks the server for nothing.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { ROLE_PRIVILEGES } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getMine: vi.fn(),
      getMembershipTypes: vi.fn(),
      getMembershipWords: vi.fn(),
      previewMembershipLink: vi.fn(),
      createMembershipType: vi.fn(),
      updateMembershipType: vi.fn(),
      archiveMembershipType: vi.fn(),
      restoreMembershipType: vi.fn(),
    },
  };
});

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', displayName: 'Jordan Hayes', email: 'jordan@example.com' }, logout: vi.fn() }),
}));

const { orgService } = await import('../../api/orgsApi');
const { resetConsoleOrgs } = await import('./consoleOrgs');
const ConsoleLayout = (await import('../../components/console/ConsoleLayout')).default;
const Memberships = (await import('./Memberships')).default;
const { readOnlyNote } = await import('./billingView');

const IRON = '11111111-1111-4111-8111-111111111111';
const HARBOUR = '22222222-2222-4222-8222-222222222222';

const gym = (over = {}) => ({
  id: IRON,
  slug: 'iron-house',
  name: 'Iron House',
  city: 'Austin',
  orgType: 'gym',
  timezone: 'America/Chicago',
  country: 'US',
  status: 'active',
  staffRole: 'manager',
  isMember: false,
  privileges: [...ROLE_PRIVILEGES.manager],
  subscription: { status: 'trialing', trialEndsAt: '2099-01-01T00:00:00.000Z', seatCap: 200 },
  ...over,
});

const type = (over = {}) => ({
  id: '33333333-3333-4333-8333-000000000001',
  name: 'Gold Monthly',
  description: null,
  kind: 'recurring',
  priceMinor: 4999,
  currency: 'USD',
  termCount: 1,
  termUnit: 'month',
  packClasses: null,
  packDays: null,
  access: 'all_classes',
  bookingsLimit: null,
  bookingsPeriod: null,
  classTypes: null,
  archivedAt: null,
  updatedAt: '2026-10-04T09:00:00.000Z',
  ...over,
});
const listOf = (over = {}) => ({ currency: 'USD', types: [], archived: [], archivedTotal: 0, classChoices: [], ...over });

/** The page inside the shell, at the address a person opened or typed. */
function draw(orgs, at = '/console/iron-house/memberships') {
  orgService.getMine.mockResolvedValue({ data: { orgs } });
  render(
    <MemoryRouter initialEntries={[at]}>
      <Link to="/console/harbour/memberships">to harbour</Link>
      <Routes>
        <Route path="/console/:orgSlug/memberships" element={<ConsoleLayout><Memberships /></ConsoleLayout>} />
      </Routes>
    </MemoryRouter>,
  );
}

const railLinks = () =>
  [...within(screen.getByTestId('console-rail')).getByRole('navigation', { name: 'Console' }).querySelectorAll('a[href]')].map((a) => a.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  resetConsoleOrgs();
  orgService.getMembershipTypes.mockResolvedValue({ data: listOf({ types: [type()] }) });
  orgService.getMembershipWords.mockResolvedValue({ data: { words: [], types: [] } });
});
afterEach(() => cleanup());

describe('staff who may not change prices', () => {
  const NOT_ALLOWED = "Your role doesn't allow you to see or change memberships and prices. Ask the owner if you need to.";

  it.each([
    ['a trainer', 'trainer', [...ROLE_PRIVILEGES.trainer]],
    ['a manager the owner took the tick from', 'manager', ROLE_PRIVILEGES.manager.filter((p) => p !== 'memberships.manage')],
    ['a manager left with every other tick the owner can give', 'manager', [...new Set([...ROLE_PRIVILEGES.owner, ...ROLE_PRIVILEGES.manager])].filter((p) => p !== 'memberships.manage')],
  ])('%s: no Memberships line in the menu, the typed address says so, and nothing is read', async (_who, staffRole, privileges) => {
    draw([gym({ staffRole, privileges })]);
    expect(await screen.findByText(NOT_ALLOWED)).toBeTruthy();
    expect(railLinks()).not.toContain('Memberships');
    expect(within(screen.getByTestId('console-tabbar')).queryByText('Memberships')).toBeNull();
    // Neither the price list nor the names from the member list.
    await new Promise((r) => setTimeout(r, 20));
    expect(orgService.getMembershipTypes).not.toHaveBeenCalled();
    expect(orgService.getMembershipWords).not.toHaveBeenCalled();
    expect(orgService.previewMembershipLink).not.toHaveBeenCalled();
    expect(screen.queryByText('Gold Monthly')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a membership type' })).toBeNull();
  });

  it('an address that is not one of their gyms is said, and nothing is read', async () => {
    draw([gym()], '/console/somebody-elses/memberships');
    expect(await screen.findByText("We couldn't find an organisation you run at this address.")).toBeTruthy();
    expect(orgService.getMembershipTypes).not.toHaveBeenCalled();
    expect(orgService.getMembershipWords).not.toHaveBeenCalled();
  });
});

describe('staff who may', () => {
  it.each([
    ['the owner', 'owner', [...ROLE_PRIVILEGES.owner]],
    ['a manager on the usual ticks', 'manager', [...ROLE_PRIVILEGES.manager]],
    ['a trainer the owner gave the tick', 'trainer', [...ROLE_PRIVILEGES.trainer, 'memberships.manage']],
  ])('%s: Memberships is in the menu straight after Members, and the page opens with the price list already open', async (_who, staffRole, privileges) => {
    draw([gym({ staffRole, privileges })]);
    expect(await screen.findByRole('heading', { level: 1, name: 'Memberships' })).toBeTruthy();
    const rail = railLinks();
    expect(rail.indexOf('Memberships')).toBe(rail.indexOf('Members') + 1);
    // Nothing to press first: the list, its price and the main button are there.
    expect(await screen.findByText('Gold Monthly')).toBeTruthy();
    expect(screen.getByText('$49.99 every month')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a membership type' }).disabled).toBe(false);
    expect(orgService.getMembershipTypes).toHaveBeenCalledWith(IRON);
  });

  it('on a phone the page is under More, never a fifth tab', async () => {
    draw([gym()]);
    await screen.findByText('Gold Monthly');
    expect(within(screen.getByTestId('console-tabbar')).queryByText('Memberships')).toBeNull();
    // More is lit while the page is open, as for every page reached from it.
    const more = within(screen.getByTestId('console-tabbar')).getByText('More').closest('a');
    expect(more.className).toContain('c-tab-on');
    // Members is not, though its address is the start of this one: on the phone or the computer.
    expect(within(screen.getByTestId('console-tabbar')).getByText('Members').closest('a').className).not.toContain('c-tab-on');
    const rail = within(screen.getByTestId('console-rail'));
    expect(rail.getByText('Members').closest('a').className).not.toContain('c-nav-on');
    expect(rail.getByText('Memberships').closest('a').className).toContain('c-nav-on');
  });

  it('a gym with no live plan still sees its list, is told why nothing can be changed, and its buttons are off', async () => {
    draw([gym({ consoleReadOnly: true })]);
    expect(await screen.findByText('Gold Monthly')).toBeTruthy();
    expect(screen.getByText(readOnlyNote('gym'))).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a membership type' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Change Gold Monthly' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Archive Gold Monthly' }).disabled).toBe(true);
  });

  it('a gym with no country: the owner gets a button to Settings, and somebody who cannot change the details is told to ask', async () => {
    orgService.getMembershipTypes.mockResolvedValue({ data: listOf({ currency: null }) });
    draw([gym({ staffRole: 'owner', privileges: [...ROLE_PRIVILEGES.owner] })]);
    expect(await screen.findByText("Set your country in Gym details before adding a membership type. Prices are in your country's own money.")).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Settings' }).getAttribute('href')).toBe('/console/iron-house/settings');
    cleanup();
    resetConsoleOrgs();
    draw([gym()]);
    expect(await screen.findByText(/Ask the owner to set it in Gym details./)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open Settings' })).toBeNull();
    // A studio's section has the studio's name, as Settings writes it.
    cleanup();
    resetConsoleOrgs();
    draw([gym({ orgType: 'studio' })]);
    expect(await screen.findByText(/Ask the owner to set it in Studio details./)).toBeTruthy();
  });

  it("moving to another gym throws away what was typed for the first, and reads the second gym's own list", async () => {
    orgService.getMembershipTypes.mockImplementation((gymId) =>
      Promise.resolve({ data: listOf({ types: [type({ name: gymId === IRON ? 'Gold Monthly' : 'Harbour Pass' })] }) }),
    );
    draw([gym(), gym({ id: HARBOUR, slug: 'harbour', name: 'Harbour Gym' })]);
    await screen.findByText('Gold Monthly');
    fireEvent.click(screen.getByRole('button', { name: 'Add a membership type' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Typed for Iron House' } });

    fireEvent.click(screen.getByText('to harbour'));
    expect(await screen.findByText('Harbour Pass')).toBeTruthy();
    expect(screen.queryByText('Gold Monthly')).toBeNull();
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.queryByDisplayValue('Typed for Iron House')).toBeNull();
    await waitFor(() => expect(orgService.getMembershipTypes).toHaveBeenCalledWith(HARBOUR));
    expect(orgService.createMembershipType).not.toHaveBeenCalled();
  });
});
