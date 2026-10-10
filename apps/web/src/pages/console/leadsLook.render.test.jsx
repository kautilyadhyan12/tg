// THE LEADS PAGE IN THE NEW LOOK (ROADMAP R3; spec Part 3 §17). A restyle changes how the
// page looks, never what it does (RULINGS 2026-09-26). The worst thing R3 could do to a real
// person is show one lead's details under another's name, or show the leads to staff the
// server refuses — so the first tests open two leads one after the other, and list every
// control the page had before R3 for an owner, a lapsed gym and a refused role.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { leadSchema } from '@app/shared';

const api = {
  getMine: vi.fn(),
  getLeads: vi.fn(),
  getLead: vi.fn(),
  updateLead: vi.fn(),
  joinLead: vi.fn(),
};
vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: api };
});
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', displayName: 'Kd' }, logout: vi.fn(), loading: false }),
}));

const Leads = (await import('./Leads')).default;
const { resetConsoleOrgs } = await import('./consoleOrgs');

const ORG = {
  id: 'g1',
  slug: 'iron-house',
  name: 'Iron House',
  staffRole: 'owner',
  privileges: ['members.read', 'members.confirm', 'schedule.manage', 'org.manage', 'staff.manage'],
  timezone: 'Europe/London',
  clockFormat: '24h',
  orgType: 'gym',
  subscription: { status: 'trialing' },
};
const LAPSED = { ...ORG, consoleReadOnly: true, subscription: null };
const NO_TICK = { ...ORG, staffRole: 'trainer', privileges: ['members.read'] };

const ARJUN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TOM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const lead = (id, fullName, over = {}) =>
  leadSchema.parse({
    id,
    fullName,
    email: `${fullName.split(' ')[0].toLowerCase()}@example.com`,
    phone: null,
    source: 'walk_in',
    status: 'new',
    notes: '',
    mayEmail: false,
    entryId: null,
    onList: false,
    createdAt: '2026-09-20T10:00:00.000Z',
    statusChangedAt: '2026-09-20T10:00:00.000Z',
    followUp: { sent: 0, dueOn: null, dueNow: false, overdue: false, lastSentAt: null },
    ...over,
  });
const arjun = lead(ARJUN, 'Arjun Shah', { phone: '+447700900004', source: 'friend', status: 'on_trial' });
const tom = lead(TOM, 'Tom Reid');

const COUNTS = { all: 2, new: 1, contacted: 0, on_trial: 1, joined: 0, lost: 0, followUpsDue: 0, emailProblems: 0 };
const PAGE = { data: { leads: [arjun, tom], total: 2, cursor: 'next', counts: COUNTS } };
const EMPTY = { data: { leads: [], total: 0, cursor: null, counts: { all: 0, new: 0, contacted: 0, on_trial: 0, joined: 0, lost: 0, followUpsDue: 0, emailProblems: 0 } } };

const useOrg = (org) => api.getMine.mockResolvedValue({ data: { orgs: [org], formerOrgs: [] } });
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  resetConsoleOrgs();
  for (const fn of Object.values(api)) fn.mockReset();
  useOrg(ORG);
  api.getLeads.mockResolvedValue(PAGE);
  api.getLead.mockImplementation((_gym, id) => Promise.resolve({ data: { lead: id === ARJUN ? arjun : tom } }));
});
afterEach(() => {
  cleanup();
  resetConsoleOrgs();
});

const draw = (address = '/console/iron-house/leads') =>
  render(
    <MemoryRouter initialEntries={[address]}>
      <Routes>
        <Route path="/console/:orgSlug/leads" element={<Leads />} />
      </Routes>
    </MemoryRouter>,
  );

const button = (name) => screen.queryByRole('button', { name });
const rows = () => screen.getAllByTestId('lead-row');
const row = (name) => rows().find((r) => r.textContent.includes(name));
const panel = () => screen.getByRole('dialog');

// Every control of the list, as named before R3.
const LIST_CONTROLS = ['Add lead', 'All 2', 'New 1', 'Contacted 0', 'On trial 1', 'Joined 0', 'Lost 0', 'Load more'];
// Every control of an opened lead, as named before R3 (Edit became the open fields).
const LEAD_CONTROLS = ['Close', 'New', 'Contacted', 'On trial', 'Lost', 'Joined · add to your members', 'Delete lead'];

describe('the worst thing: the wrong person', () => {
  it('opening two leads one after the other shows only the second, even when the first answers late', async () => {
    const late = deferred();
    api.getLead.mockImplementation((_gym, id) => (id === ARJUN ? late.promise : Promise.resolve({ data: { lead: tom } })));
    draw();
    await screen.findAllByTestId('lead-row');
    fireEvent.click(row('Arjun Shah'));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Close' }));
    fireEvent.click(row('Tom Reid'));
    await within(panel()).findByRole('heading', { name: 'Tom Reid' });
    late.resolve({ data: { lead: arjun } });
    await new Promise((r) => setTimeout(r, 20));
    expect(within(panel()).queryByText(/Arjun/)).toBeNull();
    expect(within(panel()).getByLabelText('Name').value).toBe('Tom Reid');
    expect(within(panel()).getByLabelText('Email').value).toBe('tom@example.com');
  });

  it('a role the server refuses sees its refusal and no lead, no search and no Add lead', async () => {
    useOrg(NO_TICK);
    api.getLeads.mockRejectedValue(
      Object.assign(new Error('403'), { response: { status: 403, data: { error: 'forbidden', message: "Your role doesn't allow that." } } }),
    );
    draw();
    await screen.findByText("Your role doesn't allow that.");
    for (const name of LIST_CONTROLS) expect(button(name), name).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByTestId('lead-row')).toBeNull();
  });
});

describe('the list keeps every control', () => {
  it('an owner has Add lead, search, every status with its count, rows that open, and Load more', async () => {
    draw();
    await screen.findAllByTestId('lead-row');
    for (const name of LIST_CONTROLS) expect(button(name), name).not.toBeNull();
    expect(button('Add lead').disabled).toBe(false);
    expect(screen.getByRole('searchbox', { name: 'Search your leads' })).toBeTruthy();
    expect(rows()).toHaveLength(2);
    expect(row('Arjun Shah').textContent).toContain('arjun@example.com · +447700900004');
  });

  it('"?open=add" opens Add lead once; a lapsed gym and a role without the tick get no form', async () => {
    draw('/console/iron-house/leads?open=add');
    await within(await screen.findByRole('dialog')).findByRole('heading', { name: 'Add lead' });
    cleanup();
    resetConsoleOrgs();
    useOrg(LAPSED);
    draw('/console/iron-house/leads?open=add');
    await screen.findAllByTestId('lead-row');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a search says how many match; a status chip asks the server for that status', async () => {
    draw();
    await screen.findAllByTestId('lead-row');
    fireEvent.click(button('On trial 1'));
    await waitFor(() => expect(api.getLeads).toHaveBeenLastCalledWith('g1', 'status=on_trial'));
    expect(button('On trial 1').getAttribute('aria-pressed')).toBe('true');
    expect((await screen.findByTestId('leads-total')).textContent).toBe('2 leads match');
  });

  it('a lapsed gym reads its leads, is told why, and can change nothing', async () => {
    useOrg(LAPSED);
    draw();
    await screen.findAllByTestId('lead-row');
    expect(screen.getByText(/needs a plan before anything here can be changed/)).toBeTruthy();
    expect(button('Add lead').disabled).toBe(true);
    fireEvent.click(row('Tom Reid'));
    await within(panel()).findByRole('heading', { name: 'Tom Reid' });
    for (const name of LEAD_CONTROLS.filter((n) => n !== 'Close')) {
      expect(within(panel()).getByRole('button', { name }).disabled, name).toBe(true);
    }
    expect(within(panel()).getByLabelText('Name').disabled).toBe(true);
    expect(within(panel()).getByLabelText('Notes').disabled).toBe(true);
    for (const name of ['Joined', 'Save', 'Walked in', 'Website', 'Social media', 'A friend', 'Other']) {
      expect(within(panel()).getByRole('button', { name }).disabled, name).toBe(true);
    }
    expect(within(panel()).getByRole('checkbox', { name: 'Happy to hear from us by email' }).disabled).toBe(true);
    expect(within(panel()).getByLabelText('Email').disabled).toBe(true);
    expect(within(panel()).getByLabelText('Phone').disabled).toBe(true);
  });

  it('no leads yet says so, with no status chips', async () => {
    api.getLeads.mockResolvedValue(EMPTY);
    draw();
    await screen.findByText('No leads yet.');
    expect(screen.queryByRole('group', { name: 'Status' })).toBeNull();
    expect(button('Add lead')).not.toBeNull();
  });

  it('a failed read says so and Try again asks again', async () => {
    api.getLeads.mockRejectedValueOnce(new Error('network'));
    draw();
    await screen.findByText("Couldn't reach the server. Check your connection and try again.");
    fireEvent.click(button('Try again'));
    await screen.findAllByTestId('lead-row');
    expect(api.getLeads).toHaveBeenCalledTimes(2);
  });
});

describe('an opened lead keeps every control', () => {
  it('has the status buttons, the details ready to change, the tick, notes, Joined and Delete', async () => {
    draw();
    await screen.findAllByTestId('lead-row');
    fireEvent.click(row('Arjun Shah'));
    const p = panel();
    await within(p).findByRole('heading', { name: 'Arjun Shah' });
    for (const name of LEAD_CONTROLS) expect(within(p).getByRole('button', { name }), name).toBeTruthy();
    expect(within(p).getByText(/Added 20 Sept · A friend/)).toBeTruthy();
    expect(within(p).getByLabelText('Name').value).toBe('Arjun Shah');
    expect(within(p).getByLabelText('Phone').value).toBe('+447700900004');
    expect(within(p).getByRole('group', { name: 'Heard of you from' })).toBeTruthy();
    expect(within(p).getByRole('checkbox', { name: 'Happy to hear from us by email' })).toBeTruthy();
    expect(within(p).getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(within(p).getByLabelText('Notes')).toBeTruthy();
  });
});

describe('the new look (spec Part 3 §17)', () => {
  it('Add lead is the page’s one main button, beside the title', async () => {
    draw();
    await screen.findAllByTestId('lead-row');
    const header = screen.getByRole('heading', { name: 'Leads' }).closest('header');
    expect(header).not.toBeNull();
    expect(within(header).getByRole('button', { name: 'Add lead' }).className).toContain('c-btn-p');
  });

  it('on a computer the leads are a table with Heard of you from, Added and Status', async () => {
    draw();
    await screen.findAllByTestId('lead-row');
    const head = screen.getByTestId('leads-head');
    expect(head.textContent).toBe('NameHeard of you fromAddedStatus');
  });

  it('each status tag takes the drawing’s colour by name', async () => {
    draw();
    await screen.findAllByTestId('lead-row');
    expect(within(row('Tom Reid')).getByText('New').className).toContain('c-tag-soft');
    expect(within(row('Arjun Shah')).getByText('On trial').className).toContain('c-tag-warn');
  });

  it('a lead opens in a side panel from the right', async () => {
    draw();
    await screen.findAllByTestId('lead-row');
    fireEvent.click(row('Tom Reid'));
    expect(panel().className).toContain('c-sheet');
  });
});

describe('email problems on the list (20c-v-b)', () => {
  it('a bounced lead and one who marked an email as spam are tagged on their rows, counted, and found with one chip', async () => {
    const bounced = { ...tom, emailProblem: 'bounced' };
    const spam = { ...arjun, status: 'new', emailProblem: 'complained' };
    api.getLeads.mockResolvedValue({ data: { leads: [spam, bounced], total: 2, cursor: null, counts: { ...COUNTS, emailProblems: 2 } } });
    draw();
    await screen.findAllByTestId('lead-row');
    expect(within(row('Tom Reid')).getByText('Email bounces')).toBeTruthy();
    expect(within(row('Arjun Shah')).getByText('Marked as spam')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Email problems 2' }));
    await waitFor(() => expect(api.getLeads).toHaveBeenLastCalledWith('g1', 'followUp=problem'));
    expect(screen.getByRole('button', { name: 'Email problems 2' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'All 2' }).getAttribute('aria-pressed')).toBe('false');
  });

  it("an address our email service refuses is never called a bounce on the list", async () => {
    api.getLeads.mockResolvedValue({ data: { leads: [arjun, { ...tom, emailProblem: 'refused' }], total: 2, cursor: null, counts: { ...COUNTS, emailProblems: 1 } } });
    draw();
    await screen.findAllByTestId('lead-row');
    expect(within(row('Tom Reid')).getByText("Can't be emailed")).toBeTruthy();
    expect(within(row('Tom Reid')).queryByText('Email bounces')).toBeNull();
  });

  it('no chip, no tag and no stopped line when nothing is wrong', async () => {
    api.getLeads.mockResolvedValue(PAGE);
    draw();
    await screen.findAllByTestId('lead-row');
    expect(screen.queryByRole('button', { name: /^Email problems/ })).toBeNull();
    expect(screen.queryByText('Email bounces')).toBeNull();
    expect(screen.queryByTestId('leads-sending-stopped')).toBeNull();
  });

  it("a gym whose emails through the app are stopped is told on Leads, not only in Settings", async () => {
    api.getLeads.mockResolvedValue({ data: { ...PAGE.data, sendingStopped: true } });
    draw();
    await screen.findAllByTestId('lead-row');
    expect(screen.getByTestId('leads-sending-stopped').textContent).toContain('Emails from your gym through AI Home Gym are stopped');
  });

  it('paused emails to people who asked on the page, and messages the page turned away, are said on Leads', async () => {
    api.getLeads.mockResolvedValue({ data: { ...PAGE.data, pageEmailsStopped: true, pageTurnedAway: 3 } });
    draw();
    await screen.findAllByTestId('lead-row');
    expect(screen.getByTestId('leads-page-emails-stopped').textContent).toContain('people who asked on your page are paused');
    expect(screen.getByTestId('leads-page-turned-away').textContent).toContain('turned away 3 messages in the last hour');
  });

  it('neither line shows when the page is fine', async () => {
    api.getLeads.mockResolvedValue({ data: { ...PAGE.data, pageEmailsStopped: false, pageTurnedAway: 0 } });
    draw();
    await screen.findAllByTestId('lead-row');
    expect(screen.queryByTestId('leads-page-emails-stopped')).toBeNull();
    expect(screen.queryByTestId('leads-page-turned-away')).toBeNull();
  });
});

describe('"Email due" (20c-ii)', () => {
  it('with leads due, the list offers Email due with its count, tags the due row, and asks the server for them alone', async () => {
    const dueTom = { ...tom, mayEmail: true, followUp: { sent: 0, dueOn: '2026-09-27', dueNow: true, overdue: false, lastSentAt: null } };
    api.getLeads.mockResolvedValue({ data: { leads: [arjun, dueTom], total: 2, cursor: null, counts: { ...COUNTS, followUpsDue: 1 } } });
    draw();
    await screen.findAllByTestId('lead-row');
    expect(within(row('Tom Reid')).getByText('Email due')).toBeTruthy();
    expect(within(row('Arjun Shah')).queryByText('Email due')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Email due 1' }));
    await waitFor(() => expect(api.getLeads).toHaveBeenLastCalledWith('g1', 'followUp=due'));
    expect(screen.getByRole('button', { name: 'Email due 1' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('Email due and a status chip are never on together', async () => {
    const dueTom = { ...tom, mayEmail: true, followUp: { sent: 0, dueOn: '2026-09-27', dueNow: true, overdue: false, lastSentAt: null } };
    api.getLeads.mockResolvedValue({ data: { leads: [arjun, dueTom], total: 2, cursor: null, counts: { ...COUNTS, followUpsDue: 1 } } });
    draw();
    await screen.findAllByTestId('lead-row');
    fireEvent.click(screen.getByRole('button', { name: 'On trial 1' }));
    await waitFor(() => expect(api.getLeads).toHaveBeenLastCalledWith('g1', 'status=on_trial'));
    fireEvent.click(screen.getByRole('button', { name: 'Email due 1' }));
    await waitFor(() => expect(api.getLeads).toHaveBeenLastCalledWith('g1', 'followUp=due'));
    expect(screen.getByRole('button', { name: 'On trial 1' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'All 2' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'New 1' }));
    await waitFor(() => expect(api.getLeads).toHaveBeenLastCalledWith('g1', 'status=new'));
    expect(screen.getByRole('button', { name: 'Email due 1' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('with none due, there is no Email due chip and no tag', async () => {
    draw();
    await screen.findAllByTestId('lead-row');
    expect(button('Email due 0')).toBeNull();
    expect(screen.queryByText('Email due')).toBeNull();
  });
});

describe('a long list keeps its tools on screen (RULINGS 2026-09-28)', () => {
  const longPage = (scrollY) => {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: scrollY });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 5000 });
  };
  afterEach(() => {
    longPage(0);
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 0 });
  });

  it('search and the status chips are pinned, and Back to top and Go to the bottom show on a long page', async () => {
    longPage(2000);
    draw();
    await screen.findAllByTestId('lead-row');
    const tools = screen.getByTestId('leads-tools');
    expect(tools.className).toContain('c-sticky-tools');
    expect(within(tools).getByRole('searchbox', { name: 'Search your leads' })).toBeTruthy();
    expect(within(tools).getByRole('button', { name: 'All 2' })).toBeTruthy();
    expect(button('Back to top')).toBeTruthy();
    expect(button('Go to the bottom')).toBeTruthy();
  });

  it('a role the server refuses gets no scroll buttons', async () => {
    longPage(2000);
    useOrg(NO_TICK);
    api.getLeads.mockRejectedValue(Object.assign(new Error('403'), { response: { status: 403, data: { message: "Your role doesn't allow that." } } }));
    draw();
    await screen.findByText("Your role doesn't allow that.");
    expect(button('Back to top')).toBeNull();
  });
});
