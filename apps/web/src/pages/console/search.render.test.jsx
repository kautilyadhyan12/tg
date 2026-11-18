// SEARCH, drawn in the console's shell (V1-e-i). The worst thing on the screen: a line for a
// place this person cannot open. Then: the box in the bar is typed in where it is (Kd's
// click-through: never a button that opens a second box), Ctrl K reaches it, the arrows and Enter
// open a line, Esc, a press outside and Back close it, and Recent remembers.
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
const barInput = () => within(screen.getByTestId('console-bar')).getByTestId('search-input');
const box = () => within(screen.getByTestId('search-box'));
const startSearch = () => fireEvent.focus(barInput());
const typeIn = (text) => fireEvent.change(barInput(), { target: { value: text } });
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
    startSearch();
    typeIn('payments');
    expect(lineTitles()).not.toContain('Payments');
    expect(lineTitles()).not.toContain('Sell');
    typeIn('settings');
    expect(lineTitles()).not.toContain('Settings');
  });

  it('an owner searching "payments" is offered the page and the setting', async () => {
    await open();
    startSearch();
    typeIn('payments');
    expect(lineTitles()).toEqual(expect.arrayContaining(['Sell', 'Failed payments', 'Payments']));
  });
});

describe('opening and using it', () => {
  it('the box in the bar is a box to type in, never a button that opens another box', async () => {
    await open();
    const field = screen.getByTestId('console-search');
    expect(field.tagName).toBe('DIV');
    expect(within(screen.getByTestId('console-bar')).queryByRole('button', { name: /search/i })).toBeNull();
    const input = barInput();
    expect(input.tagName).toBe('INPUT');
    expect(input.getAttribute('placeholder')).toBe('Search pages or actions');
    expect(field.textContent).toContain('Ctrl K');
    // Typing straight into it, with nothing pressed first, shows results under it, in the bar.
    typeIn('money');
    expect(within(screen.getByTestId('console-bar')).getByTestId('search-box')).toBeTruthy();
    expect(screen.getAllByTestId('search-box')).toHaveLength(1);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);
  });

  it('Ctrl K puts the cursor in a search box, with Quick actions under it', async () => {
    await open();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    // jsdom draws no layout, so the phone's box is the one on screen here; Edge's walk checks
    // the bar's box on a computer.
    await waitFor(() => expect(document.activeElement?.getAttribute('data-testid')).toBe('search-input'));
    expect(lineTitles()).toEqual(['Check in', 'Add member', 'New sale']);
    expect(screen.getByText('Quick actions')).toBeTruthy();
  });

  it('a press outside closes it', async () => {
    await open();
    startSearch();
    expect(screen.getByTestId('search-box')).toBeTruthy();
    fireEvent.pointerDown(screen.getByTestId('where'));
    expect(screen.queryByTestId('search-box')).toBeNull();
  });

  it('↓ and Enter open the line they are on; the place opens with its box', async () => {
    await open();
    startSearch();
    typeIn('import');
    expect(lineTitles()[0]).toBe('Import members');
    fireEvent.keyDown(barInput(), { key: 'Enter' });
    await waitFor(() => expect(where()).toBe('/console/iron-house/members?open=import'));
    expect(screen.queryByTestId('search-box')).toBeNull();
  });

  it('the arrows move the lit line and wrap round', async () => {
    await open();
    startSearch();
    const input = barInput();
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
    startSearch();
    typeIn('opening hours');
    fireEvent.click(screen.getAllByTestId('search-line')[0]);
    await waitFor(() => expect(where()).toBe('/console/iron-house/settings#opening-hours'));
    expect(JSON.parse(window.localStorage.getItem(RECENT_KEY))).toEqual({ 'iron-house': ['setting:openingHours'] });
    startSearch();
    expect(screen.getByText('Recent')).toBeTruthy();
    expect(lineTitles()[0]).toBe("When we're open");
  });

  it('Esc closes it, and Back closes it', async () => {
    await open();
    startSearch();
    fireEvent.keyDown(barInput(), { key: 'Escape' });
    expect(screen.queryByTestId('search-box')).toBeNull();
    startSearch();
    typeIn('classes');
    fireEvent.click(screen.getAllByTestId('search-line')[0]);
    await waitFor(() => expect(where()).toBe('/console/iron-house/classes'));
    startSearch();
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    await waitFor(() => expect(where()).toBe('/console/iron-house'));
    expect(screen.queryByTestId('search-box')).toBeNull();
  });

  it('a word nothing has says so, in a sentence', async () => {
    await open();
    startSearch();
    typeIn('calories');
    expect(lineTitles()).toEqual([]);
    expect(box().getByRole('status').textContent).toBe('Nothing matches “calories”. Try another word, such as payments or classes.');
  });

  it("the phone's search button turns the top bar into the box, and its close button puts the bar back", async () => {
    await open();
    fireEvent.click(screen.getByTestId('console-search-phone'));
    const top = within(screen.getByTestId('console-topbar'));
    const input = top.getByTestId('search-input');
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(top.getByTestId('search-box')).toBeTruthy();
    fireEvent.click(top.getByRole('button', { name: 'Close search' }));
    expect(top.queryByTestId('search-input')).toBeNull();
    expect(top.getByTestId('console-search-phone')).toBeTruthy();
  });

  // V1-e-i's review: the lit line could go out of view in a short window.
  it('the arrows bring the lit line into view', async () => {
    const seen = [];
    const was = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView() {
      seen.push(this.firstChild?.textContent);
    };
    try {
      await open();
      startSearch();
      typeIn('money');
      fireEvent.keyDown(barInput(), { key: 'ArrowDown' });
      fireEvent.keyDown(barInput(), { key: 'ArrowDown' });
      const lit = document.getElementById(barInput().getAttribute('aria-activedescendant')).firstChild.textContent;
      expect(seen.at(-1)).toBe(lit);
    } finally {
      Element.prototype.scrollIntoView = was;
    }
  });

  it('Tab out of the box closes the results; a press on a result does not', async () => {
    await open();
    startSearch();
    typeIn('money');
    fireEvent.blur(barInput(), { relatedTarget: screen.getAllByTestId('search-line')[0] });
    expect(screen.getByTestId('search-box')).toBeTruthy();
    fireEvent.blur(barInput(), { relatedTarget: screen.getByRole('button', { name: 'Go back' }) });
    expect(screen.queryByTestId('search-box')).toBeNull();
  });

  it('Ctrl K does not reach past a box open on the page', async () => {
    await open();
    const box = document.createElement('div');
    box.setAttribute('role', 'dialog');
    document.body.appendChild(box);
    try {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
      expect(screen.queryByTestId('search-box')).toBeNull();
      expect(document.activeElement?.getAttribute('data-testid')).not.toBe('search-input');
    } finally {
      box.remove();
    }
  });

  it("the phone's search closes when only the #section changes", async () => {
    await open();
    const top = within(screen.getByTestId('console-topbar'));
    const go = async (word, to) => {
      fireEvent.click(screen.getByTestId('console-search-phone'));
      fireEvent.change(top.getByTestId('search-input'), { target: { value: word } });
      fireEvent.click(top.getAllByTestId('search-line')[0]);
      await waitFor(() => expect(where()).toBe(to));
    };
    await go('settings', '/console/iron-house/settings');
    await go('opening hours', '/console/iron-house/settings#opening-hours');
    fireEvent.click(screen.getByTestId('console-search-phone'));
    expect(top.getByTestId('search-input')).toBeTruthy();
    // Back moves only the #section: the page is the same, and the search still closes.
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    await waitFor(() => expect(where()).toBe('/console/iron-house/settings'));
    expect(top.queryByTestId('search-input')).toBeNull();
  });

  it("a studio's lines use its own words", async () => {
    await open(ROLE_PRIVILEGES.owner, 'owner', 'studio');
    startSearch();
    expect(lineTitles()).toContain('Add client');
  });
});
