// LEADS IN THE THIRD LOOK (ROADMAP V6; spec Part 3 §17.11, the boards `Leads`, `LeadPanel`,
// `LeadImport`, `GymPage`, `PhoneLeads`). The worst thing this job could do to a real person is
// delete a lead nobody ticked, or a box naming other people than those it deletes; and, beside
// it, Joined adding to the members somebody other than the lead that is open. So the first tests
// read exactly what the page sends from the new boxes.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { leadFilePreviewSchema, leadSchema } from '@app/shared';

const api = {
  getMine: vi.fn(),
  getLeads: vi.fn(),
  getLead: vi.fn(),
  getLeadEnquiries: vi.fn(),
  joinLead: vi.fn(),
  updateLead: vi.fn(),
  deleteLead: vi.fn(),
  selectAllLeads: vi.fn(),
  previewDeleteLeads: vi.fn(),
  deleteSelectedLeads: vi.fn(),
  checkLeadFile: vi.fn(),
  addLeadFile: vi.fn(),
  getGymPage: vi.fn(),
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

const ARJUN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TOM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RIYA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ENTRY = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
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
const riya = lead(RIYA, 'Riya Patel');

const COUNTS = { all: 3, new: 3, contacted: 0, on_trial: 0, joined: 0, lost: 0, followUpsDue: 0, emailProblems: 0 };
const PAGE = { data: { leads: [arjun, tom, riya], total: 3, cursor: null, counts: COUNTS } };
const DIGEST = '1'.repeat(64);

beforeEach(() => {
  resetConsoleOrgs();
  for (const fn of Object.values(api)) fn.mockReset();
  api.getMine.mockResolvedValue({ data: { orgs: [ORG], formerOrgs: [] } });
  api.getLeads.mockResolvedValue(PAGE);
  api.getLead.mockImplementation((_gym, id) => Promise.resolve({ data: { lead: [arjun, tom, riya].find((l) => l.id === id) } }));
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
const row = (name) => screen.getAllByTestId('lead-row').find((r) => r.textContent.includes(name));
const box = () => screen.getByTestId('delete-box');

describe('the worst thing: a lead nobody ticked, or the wrong person joined', () => {
  it('Delete, in the middle, names exactly the leads ticked and sends only those, from the bar on a computer or a phone', async () => {
    api.previewDeleteLeads.mockResolvedValue({
      data: { preview: { selected: 2, leads: [{ id: ARJUN, name: 'Arjun Shah' }, { id: RIYA, name: 'Riya Patel' }], gone: 0, digest: DIGEST } },
    });
    api.deleteSelectedLeads.mockResolvedValue({ data: { deleted: { deleted: 2, alreadyDeleted: false } } });
    draw();
    await screen.findAllByTestId('lead-row');
    fireEvent.click(tickBox('Select Arjun Shah'));
    fireEvent.click(tickBox('Select Riya Patel'));

    // The phone's bar acts on the same selection as the computer's.
    fireEvent.click(within(screen.getByTestId('sel-bar-phone')).getByRole('button', { name: 'Delete' }));
    await within(box()).findByText('Arjun Shah');
    expect(api.previewDeleteLeads).toHaveBeenCalledWith('g1', { kind: 'ticked', leadIds: [ARJUN, RIYA] });
    expect(box().closest('.c-ask')).not.toBeNull();
    expect(within(box()).getByRole('heading', { name: 'Delete 2 leads?' })).toBeTruthy();
    expect(within(box()).getByText('Riya Patel')).toBeTruthy();
    expect(within(box()).queryByText('Tom Reid')).toBeNull();
    fireEvent.click(within(box()).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('delete-box')).toBeNull();
    expect(api.deleteSelectedLeads).not.toHaveBeenCalled();

    fireEvent.click(within(screen.getByTestId('sel-bar')).getByRole('button', { name: 'Delete' }));
    await within(box()).findByText('Arjun Shah');
    fireEvent.click(within(box()).getByRole('button', { name: 'Delete 2 leads' }));
    await within(box()).findByText('2 leads deleted.');
    expect(api.deleteSelectedLeads).toHaveBeenCalledTimes(1);
    expect(api.deleteSelectedLeads).toHaveBeenCalledWith('g1', { kind: 'ticked', leadIds: [ARJUN, RIYA] }, DIGEST);
  });

  it('Joined in the panel asks under the status, then adds the lead that is open and nobody else', async () => {
    api.joinLead.mockResolvedValue({ data: { lead: { ...tom, status: 'joined', entryId: ENTRY, onList: true }, outcome: 'added' } });
    draw();
    await screen.findAllByTestId('lead-row');
    // Arjun opened and closed first: his panel's answers are never Tom's.
    fireEvent.click(row('Arjun Shah'));
    const first = await screen.findByRole('dialog', { name: 'Arjun Shah' });
    fireEvent.click(within(first).getByRole('button', { name: 'Close' }));
    fireEvent.click(row('Tom Reid'));
    const panel = await screen.findByRole('dialog', { name: 'Tom Reid' });
    expect(panel.className).toContain('c-panel');

    fireEvent.click(within(within(panel).getByRole('group', { name: 'Status' })).getByRole('button', { name: 'Joined' }));
    const ask = within(panel).getByTestId('ask-join');
    expect(within(ask).getByText('Add Tom Reid to your members?')).toBeTruthy();
    expect(api.joinLead).not.toHaveBeenCalled();
    fireEvent.click(within(ask).getByRole('button', { name: 'Add to members' }));
    await waitFor(() => expect(api.joinLead).toHaveBeenCalledWith('g1', TOM, {}));
    expect(api.joinLead).toHaveBeenCalledTimes(1);
    await within(panel).findByText('Tom Reid is on your list of members now.');
  });
});

const PREVIEW = leadFilePreviewSchema.parse({
  sheet: { index: 0, name: null },
  headerRow: 0,
  columns: [
    { index: 0, header: 'Name', samples: ['Ann Bell'], guess: 'fullName', neverKept: null },
    { index: 1, header: 'Email', samples: ['ann@example.com'], guess: 'email', neverKept: null },
  ],
  mapping: { sheet: 0, headerRow: 0, fullName: 0, firstName: null, lastName: null, email: [1], phone: [], source: null, notes: null },
  needsMapping: false,
  counts: { dataRows: 2, noContact: 0, noName: 0, twiceInFile: 0, add: 2, alreadyLead: 0, alreadyMember: 0, notAdded: 0 },
  add: [
    { row: 2, fullName: 'Ann Bell', email: 'ann@example.com', phone: null, source: 'other', sourceWord: null },
    { row: 3, fullName: 'Bo Cox', email: 'bo@example.com', phone: null, source: 'other', sourceWord: null },
  ],
  notAdded: [],
  warnings: [],
  leadsNow: 3,
  room: 9997,
  expected: 'a'.repeat(64),
});

describe('the boxes open where the board draws them', () => {
  it('Import leads opens in the middle, and how many were added is said in that box until Done; the page says it too', async () => {
    api.checkLeadFile.mockResolvedValue({ data: { preview: PREVIEW } });
    api.addLeadFile.mockResolvedValue({ data: { added: 2 } });
    draw();
    await screen.findAllByTestId('lead-row');
    fireEvent.click(screen.getByRole('button', { name: 'Import leads' }));
    const box = screen.getByTestId('lead-file-box');
    expect(box.closest('.c-ask')).not.toBeNull();
    const file = new File(['Name,Email' + String.fromCharCode(10) + 'Ann Bell,ann@example.com'], 'leads.csv', { type: 'text/csv' });
    fireEvent.change(within(box).getByTestId('lead-file-input'), { target: { files: [file] } });
    await within(box).findByText('2 people will be added to your leads');
    fireEvent.click(within(box).getByRole('checkbox', { name: /I have permission to store their details/ }));
    fireEvent.click(within(box).getByRole('button', { name: 'Add 2 leads' }));
    expect((await within(box).findByTestId('lead-file-done')).textContent).toBe('2 leads added.');
    expect(api.getLeads).toHaveBeenCalledTimes(2);
    fireEvent.click(within(box).getByRole('button', { name: 'Done' }));
    expect(screen.queryByTestId('lead-file-box')).toBeNull();
    expect(screen.getByText('2 leads added.')).toBeTruthy();
  });

  it('Your gym page opens from the right, its Save pinned at the foot', async () => {
    api.getGymPage.mockResolvedValue({ data: { page: { shown: false, about: '', facilities: [], ownFacilities: [], photos: [], slug: 'iron-house', mayChange: true } } });
    draw();
    await screen.findAllByTestId('lead-row');
    fireEvent.click(screen.getByRole('button', { name: 'Your gym page' }));
    const panel = await screen.findByRole('dialog', { name: 'Your gym page' });
    expect(panel.className).toContain('c-panel');
    await within(panel).findByRole('checkbox', { name: 'Show my page' });
    expect(within(panel.querySelector('.c-panel-f')).getByRole('button', { name: 'Save' })).toBeTruthy();
  });
});
