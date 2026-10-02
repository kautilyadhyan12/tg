// DELETE MANY LEADS AT ONCE (ROADMAP 20c-vii). The worst thing this could do to a real person
// is delete a lead nobody ticked: so the first tests read exactly what the page sends — the
// leads ticked, or the filter "Select all" was pressed under — and that Delete sends back the
// box's own digest. The server refuses anything else (`leads.deleteSelected.routes.test.ts`).
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { leadSchema } from '@app/shared';

const api = {
  getMine: vi.fn(),
  getLeads: vi.fn(),
  getLead: vi.fn(),
  selectAllLeads: vi.fn(),
  previewDeleteLeads: vi.fn(),
  deleteSelectedLeads: vi.fn(),
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

const ARJUN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TOM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const lead = (id, fullName, over = {}) =>
  leadSchema.parse({
    id,
    fullName,
    email: `${fullName.split(' ')[0].toLowerCase()}@example.com`,
    phone: null,
    source: 'website',
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
const arjun = lead(ARJUN, 'Arjun Shah');
const tom = lead(TOM, 'Tom Reid');

const COUNTS = { all: 120, new: 120, contacted: 0, on_trial: 0, joined: 0, lost: 0, followUpsDue: 0, emailProblems: 0 };
const PAGE = { data: { leads: [arjun, tom], total: 120, cursor: 'next', counts: COUNTS } };
const DIGEST_1 = '1'.repeat(64);
const DIGEST_2 = '2'.repeat(64);
const DIGEST_ALL = 'a'.repeat(64);
const box = (leads, over = {}) => ({ data: { preview: { selected: leads.length, leads, gone: 0, digest: DIGEST_1, ...over } } });

const useOrg = (org) => api.getMine.mockResolvedValue({ data: { orgs: [org], formerOrgs: [] } });

beforeEach(() => {
  resetConsoleOrgs();
  for (const fn of Object.values(api)) fn.mockReset();
  useOrg(ORG);
  api.getLeads.mockResolvedValue(PAGE);
});
afterEach(() => {
  cleanup();
  resetConsoleOrgs();
});

const draw = () =>
  render(
    <MemoryRouter initialEntries={['/console/iron-house/leads']}>
      <Routes>
        <Route path="/console/:orgSlug/leads" element={<Leads />} />
      </Routes>
    </MemoryRouter>,
  );

const tickBox = (label) => screen.getByRole('checkbox', { name: label });
const bar = () => screen.getByTestId('sel-bar');
const dialog = () => screen.getByTestId('delete-box');

describe('the worst thing: a lead nobody ticked', () => {
  it('ticking one lead asks for, names and deletes that lead alone, with the box’s own digest', async () => {
    api.previewDeleteLeads.mockResolvedValue(box([{ id: TOM, name: 'Tom Reid' }]));
    api.deleteSelectedLeads.mockResolvedValue({ data: { deleted: { deleted: 1, alreadyDeleted: false } } });
    draw();
    await screen.findAllByTestId('lead-row');
    fireEvent.click(tickBox('Select Tom Reid'));
    expect(within(bar()).getByText('1 selected')).toBeTruthy();
    fireEvent.click(within(bar()).getByRole('button', { name: 'Delete' }));

    await within(dialog()).findByText('Tom Reid');
    expect(api.previewDeleteLeads).toHaveBeenCalledWith('g1', { kind: 'ticked', leadIds: [TOM] });
    expect(within(dialog()).queryByText('Arjun Shah')).toBeNull();
    expect(within(dialog()).getByRole('heading', { name: 'Delete 1 lead?' })).toBeTruthy();
    expect(within(dialog()).getByText(/This can't be undone\. Your list of members doesn't change\./)).toBeTruthy();

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Delete 1 lead' }));
    await within(dialog()).findByText('1 lead deleted.');
    expect(api.deleteSelectedLeads).toHaveBeenCalledWith('g1', { kind: 'ticked', leadIds: [TOM] }, DIGEST_1);
  });

  it('Select all sends the filter it was pressed under, with the server’s count and digest', async () => {
    api.selectAllLeads.mockResolvedValue({ data: { selection: { count: 120, digest: DIGEST_ALL } } });
    api.previewDeleteLeads.mockResolvedValue(box([{ id: TOM, name: 'Tom Reid' }]));
    draw();
    await screen.findAllByTestId('lead-row');
    fireEvent.click(screen.getByRole('button', { name: /^New/ }));
    await waitFor(() => expect(api.getLeads).toHaveBeenLastCalledWith('g1', 'status=new'));
    await screen.findAllByTestId('lead-row');
    fireEvent.click(tickBox('Select every lead shown'));
    expect(screen.getByTestId('select-line').textContent).toContain('All 2 leads shown are selected.');
    fireEvent.click(screen.getByTestId('select-everyone'));
    await waitFor(() => expect(within(bar()).getByText('120 selected')).toBeTruthy());
    expect(api.selectAllLeads).toHaveBeenCalledWith('g1', { status: 'new' });
    expect(screen.getByTestId('select-line').textContent).toContain('All 120 leads that match are selected.');

    fireEvent.click(within(bar()).getByRole('button', { name: 'Delete' }));
    await within(dialog()).findByText('Tom Reid');
    expect(api.previewDeleteLeads).toHaveBeenCalledWith('g1', { kind: 'all', filter: { status: 'new' }, count: 120, digest: DIGEST_ALL });
  });

  it('a new search clears the selection, so nothing ticked under the old one can be deleted', async () => {
    draw();
    await screen.findAllByTestId('lead-row');
    fireEvent.click(tickBox('Select Arjun Shah'));
    expect(screen.getByTestId('sel-bar')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search your leads' }), { target: { value: 'tom' } });
    await waitFor(() => expect(api.getLeads).toHaveBeenLastCalledWith('g1', 'q=tom'));
    await screen.findAllByTestId('lead-row');
    expect(screen.queryByTestId('sel-bar')).toBeNull();
    expect(tickBox('Select Arjun Shah').getAttribute('aria-checked')).toBe('false');
  });

  it('when the leads changed after the box opened, nothing is said to be deleted and the new box is shown', async () => {
    api.previewDeleteLeads.mockResolvedValue(box([{ id: ARJUN, name: 'Arjun Shah' }, { id: TOM, name: 'Tom Reid' }]));
    api.deleteSelectedLeads
      .mockRejectedValueOnce(
        Object.assign(new Error('409'), {
          response: {
            status: 409,
            data: {
              error: 'leads_changed',
              message: 'Some of these leads changed since you opened this, so nothing was deleted. Check who will be deleted now.',
              preview: { selected: 2, leads: [{ id: TOM, name: 'Tom Reid' }], gone: 1, digest: DIGEST_2 },
            },
          },
        }),
      )
      .mockResolvedValueOnce({ data: { deleted: { deleted: 1, alreadyDeleted: false } } });
    draw();
    await screen.findAllByTestId('lead-row');
    fireEvent.click(tickBox('Select Arjun Shah'));
    fireEvent.click(tickBox('Select Tom Reid'));
    fireEvent.click(within(bar()).getByRole('button', { name: 'Delete' }));
    fireEvent.click(await within(dialog()).findByRole('button', { name: 'Delete 2 leads' }));

    await within(dialog()).findByTestId('delete-note');
    expect(within(dialog()).queryByTestId('delete-done')).toBeNull();
    expect(within(dialog()).queryByText('Arjun Shah')).toBeNull();
    expect(within(dialog()).getByTestId('delete-gone').textContent).toBe('1 lead you selected was already deleted.');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Delete 1 lead' }));
    await within(dialog()).findByText('1 lead deleted.');
    expect(api.deleteSelectedLeads).toHaveBeenLastCalledWith('g1', { kind: 'ticked', leadIds: [ARJUN, TOM] }, DIGEST_2);
  });
});

describe('the box and the bar', () => {
  it('names a few, then "and N more", and See all shows the rest', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `cccccccc-cccc-4ccc-8ccc-${String(i).padStart(12, '0')}`, name: `Spam ${String(i + 1)}` }));
    api.previewDeleteLeads.mockResolvedValue(box(many));
    draw();
    await screen.findAllByTestId('lead-row');
    fireEvent.click(tickBox('Select Tom Reid'));
    fireEvent.click(within(bar()).getByRole('button', { name: 'Delete' }));
    await within(dialog()).findByText('Spam 1');
    expect(within(dialog()).getByRole('heading', { name: 'Delete 12 leads?' })).toBeTruthy();
    expect(within(dialog()).queryByText('Spam 6')).toBeNull();
    expect(within(dialog()).getByText(/and 7 more/)).toBeTruthy();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'See all' }));
    expect(within(dialog()).getByText('Spam 12')).toBeTruthy();
  });

  it('after Delete the list is read again, the selection is gone and the page says how many went', async () => {
    api.previewDeleteLeads.mockResolvedValue(box([{ id: ARJUN, name: 'Arjun Shah' }]));
    api.deleteSelectedLeads.mockResolvedValue({ data: { deleted: { deleted: 1, alreadyDeleted: false } } });
    draw();
    await screen.findAllByTestId('lead-row');
    const reads = api.getLeads.mock.calls.length;
    fireEvent.click(tickBox('Select Arjun Shah'));
    fireEvent.click(within(bar()).getByRole('button', { name: 'Delete' }));
    fireEvent.click(await within(dialog()).findByRole('button', { name: 'Delete 1 lead' }));
    await within(dialog()).findByTestId('delete-done');
    await waitFor(() => expect(api.getLeads.mock.calls.length).toBeGreaterThan(reads));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Done' }));
    expect(screen.queryByTestId('delete-box')).toBeNull();
    expect(screen.queryByTestId('sel-bar')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('1 lead deleted.');
  });

  it('a lapsed gym has no tick boxes, so nothing to delete', async () => {
    useOrg(LAPSED);
    draw();
    await screen.findAllByTestId('lead-row');
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
});
