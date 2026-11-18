// SEARCH, drawn in the console's shell (V1-e-i). The worst thing on the screen: a line for a
// place this person cannot open. Then: the bar, Ctrl K and the phone's button open it, the
// arrows and Enter open a line, Esc and Back close it, and Recent remembers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ROLE_PRIVILEGES } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: { getMine: vi.fn() } };
});
vi.mock('../../api/attentionApi', () => ({
  attentionService: { get: vi.fn() },
  onConsoleChange: () => () => {},
}));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', displayName: 'Jordan Hayes', email: 'jordan@example.com' }, logout: vi.fn() }),
}));

const { orgService } = await import('../../api/orgsApi');
const { attentionService } = await import('../../api/attentionApi');
const { resetConsoleOrgs } = await import('./consoleOrgs');
const { RECENT_KEY } = await import('./searchPlaces');
const ConsoleLayout = (await import('../../components/console/ConsoleLayout')).default;

const gym = (staffRole, privileges, orgType = 'gym') => ({
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'iron-house',
  name: 'Iron House',
  city: 'Austin',
  orgType,
  timezone: 'America/Chicago',
  country: 'US',
  status: 'active',
  staffRole,
  isMember: false,
  privileges,
  subscription: { status: 'trialing', trialEndsAt: '2099-01-01T00:00:00.000Z', seatCap: 200 },
});
const NONE = { chargebacks: null, failedPayments: null, paymentDue: null, refunds: null, appPayments: null, appCancels: null, newLeads: null, atRisk: null, reported: null };

function Where() {
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <p data-testid="where">{`${pathname}${search}${hash}`}</p>
      <button type="button" onClick={() => navigate(-1)}>
        Go back
      </button>
    </>
  );
}

async function open(privileges = ROLE_PRIVILEGES.owner, staffRole = 'owner', orgType = 'gym') {
  orgService.getMine.mockResolvedValue({ data: { orgs: [gym(staffRole, privileges, orgType)] } });
  render(
    <MemoryRouter initialEntries={['/console/iron-house']}>
      <Routes>
        <Route path="/console/:orgSlug/*" element={<ConsoleLayout><Where /></ConsoleLayout>} />
      </Routes>
    </MemoryRouter>,
  );
  await within(screen.getByTestId('console-rail')).findByText('Iron House');
}
const box = () => within(screen.getByTestId('search-box'));
const typeIn = (text) => fireEvent.change(box().getByRole('combobox'), { target: { value: text } });
const lineTitles = () => screen.queryAllByTestId('search-line').map((el) => el.firstChild.textContent);
const where = () => screen.getByTestId('where').textContent;

beforeEach(() => {
  resetConsoleOrgs();
  attentionService.get.mockReset();
  attentionService.get.mockResolvedValue(NONE);
  window.localStorage.clear();
});
afterEach(() => cleanup());

describe('the worst thing: only what this person may open', () => {
  it('a trainer searching "payments" is offered no Payments setting, no Sell and no Settings', async () => {
    await open(ROLE_PRIVILEGES.trainer, 'trainer');
    fireEvent.click(screen.getByTestId('console-search'));
    typeIn('payments');
    expect(lineTitles()).not.toContain('Payments');
    expect(lineTitles()).not.toContain('Sell');
    typeIn('settings');
    expect(lineTitles()).not.toContain('Settings');
  });

  it('an owner searching "payments" is offered the page and the setting', async () => {
    await open();
    fireEvent.click(screen.getByTestId('console-search'));
    typeIn('payments');
    expect(lineTitles()).toEqual(expect.arrayContaining(['Sell', 'Failed payments', 'Payments']));
  });
});

describe('opening and using it', () => {
  it('the bar reads what it finds, with its keys', async () => {
    await open();
    const button = screen.getByTestId('console-search');
    expect(button.textContent).toContain('Search pages or actions');
    expect(button.textContent).toContain('Ctrl K');
  });

  it('Ctrl K opens it on any page, with the box ready to type in', async () => {
    await open();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = await screen.findByRole('combobox');
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(lineTitles()).toEqual(['Check in', 'Add member', 'New sale']);
    expect(screen.getByText('Quick actions')).toBeTruthy();
  });

  it('↓ and Enter open the line they are on; the place opens with its box', async () => {
    await open();
    fireEvent.click(screen.getByTestId('console-search'));
    typeIn('import');
    expect(lineTitles()[0]).toBe('Import members');
    fireEvent.keyDown(box().getByRole('combobox'), { key: 'Enter' });
    await waitFor(() => expect(where()).toBe('/console/iron-house/members?open=import'));
    expect(screen.queryByTestId('search-box')).toBeNull();
  });

  it('the arrows move the lit line and wrap round', async () => {
    await open();
    fireEvent.click(screen.getByTestId('console-search'));
    const input = box().getByRole('combobox');
    const lit = () => document.getElementById(input.getAttribute('aria-activedescendant')).firstChild.textContent;
    expect(lit()).toBe('Check in');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(lit()).toBe('Add member');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(lit()).toBe('New sale');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(where()).toBe('/console/iron-house/sell'));
  });

  it('a setting opens its section on its page, and is in Recent next time', async () => {
    await open();
    fireEvent.click(screen.getByTestId('console-search'));
    typeIn('opening hours');
    fireEvent.click(screen.getAllByTestId('search-line')[0]);
    await waitFor(() => expect(where()).toBe('/console/iron-house/settings#opening-hours'));
    expect(JSON.parse(window.localStorage.getItem(RECENT_KEY))).toEqual({ 'iron-house': ['setting:openingHours'] });
    fireEvent.click(screen.getByTestId('console-search'));
    expect(screen.getByText('Recent')).toBeTruthy();
    expect(lineTitles()[0]).toBe("When we're open");
  });

  it('Esc closes it, and Back closes it', async () => {
    await open();
    fireEvent.click(screen.getByTestId('console-search'));
    fireEvent.keyDown(box().getByRole('combobox'), { key: 'Escape' });
    expect(screen.queryByTestId('search-box')).toBeNull();
    fireEvent.click(screen.getByTestId('console-search'));
    typeIn('classes');
    fireEvent.click(screen.getAllByTestId('search-line')[0]);
    await waitFor(() => expect(where()).toBe('/console/iron-house/classes'));
    fireEvent.click(screen.getByTestId('console-search'));
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    await waitFor(() => expect(where()).toBe('/console/iron-house'));
    expect(screen.queryByTestId('search-box')).toBeNull();
  });

  it('a word nothing has says so, in a sentence', async () => {
    await open();
    fireEvent.click(screen.getByTestId('console-search'));
    typeIn('calories');
    expect(lineTitles()).toEqual([]);
    expect(box().getByRole('status').textContent).toBe('Nothing matches “calories”. Try another word, such as payments or classes.');
  });

  it("the phone's search button opens it too", async () => {
    await open();
    fireEvent.click(screen.getByTestId('console-search-phone'));
    expect(screen.getByTestId('search-box')).toBeTruthy();
  });

  it("a studio's lines use its own words", async () => {
    await open(ROLE_PRIVILEGES.owner, 'owner', 'studio');
    fireEvent.click(screen.getByTestId('console-search'));
    expect(lineTitles()).toContain('Add client');
  });
});
