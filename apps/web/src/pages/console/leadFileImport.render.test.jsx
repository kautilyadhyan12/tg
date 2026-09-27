// IMPORT LEADS (ROADMAP 20c-iii). The worst thing this panel could do to a real person
// is send the server something other than what staff were shown — another list of
// people, or no tick that they may store them — or leave staff believing imported
// leads will be emailed. So the first test adds, and checks exactly what was sent and
// what was said.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { LEAD_FILE_CHANGED_ERROR, LEAD_FILE_WORDS, leadFilePreviewSchema } from '@app/shared';

const api = { checkLeadFile: vi.fn(), addLeadFile: vi.fn() };
vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: api };
});

const LeadFileImport = (await import('./LeadFileImport')).default;

const KEY = 'a'.repeat(64);
const MAPPING = { sheet: 0, headerRow: 0, fullName: 0, firstName: null, lastName: null, email: [1], phone: [], source: 2, notes: null };
const person = (row, fullName, email) => ({ row, fullName, email, phone: null, source: 'social' });
const PREVIEW = leadFilePreviewSchema.parse({
  sheet: { index: 0, name: null },
  headerRow: 0,
  columns: [
    { index: 0, header: 'Name', samples: ['Ann Bell'], guess: 'fullName', neverKept: null },
    { index: 1, header: 'Email', samples: ['ann@example.com'], guess: 'email', neverKept: null },
    { index: 2, header: 'Lead Source', samples: ['Instagram'], guess: 'source', neverKept: null },
    { index: 3, header: 'Card Number', samples: [], guess: null, neverKept: 'payment_card' },
  ],
  mapping: MAPPING,
  needsMapping: false,
  counts: { dataRows: 4, noContact: 1, noName: 0, twiceInFile: 0, add: 2, alreadyLead: 1, alreadyMember: 0 },
  add: [person(2, 'Ann Bell', 'ann@example.com'), person(3, 'Bo Cox', 'bo@example.com')],
  alreadyLead: [person(4, 'Jo Lane', 'jo@example.com')],
  alreadyMember: [],
  twiceInFile: [],
  sources: [{ word: 'Instagram', source: 'social', count: 3 }],
  warnings: [],
  leadsNow: 1,
  room: 9999,
  expected: KEY,
});

const GYM = { id: 'g1', name: 'Iron House' };
const onAdded = vi.fn();
const onClose = vi.fn();

function open(readOnly = false) {
  render(<LeadFileImport gymId="g1" gym={GYM} readOnly={readOnly} onClose={onClose} onAdded={onAdded} />);
}

async function pick() {
  const file = new File(['Name,Email,Lead Source\nAnn Bell,ann@example.com,Instagram\n'], 'leads.csv', { type: 'text/csv' });
  fireEvent.change(screen.getByTestId('lead-file-input'), { target: { files: [file] } });
  await screen.findByTestId('group-add');
  return file;
}

const addButton = () => screen.getByRole('button', { name: /^Add \d+ leads?$/ });
const tick = () => screen.getByRole('checkbox', { name: /I have permission to store their details/ });

beforeEach(() => {
  api.checkLeadFile.mockReset();
  api.addLeadFile.mockReset();
  onAdded.mockReset();
  onClose.mockReset();
  api.checkLeadFile.mockResolvedValue({ data: { preview: PREVIEW } });
});
afterEach(cleanup);

describe('Import leads', () => {
  it('adds exactly what was shown, with the tick, and says nobody is emailed or ticked', async () => {
    open();
    await pick();
    // Nobody arrives ticked "Happy to hear from us", said before Add.
    expect(screen.getByTestId('lead-file-tick-note').textContent).toContain(LEAD_FILE_WORDS.tick);
    expect(screen.getByText('Nobody is emailed.', { exact: false })).toBeTruthy();
    expect(addButton().disabled).toBe(true);
    expect(screen.getByTestId('lead-file-why').textContent).toContain('Tick the box above first.');
    fireEvent.click(tick());
    expect(tick().getAttribute("aria-checked")).toBe("true");
    api.addLeadFile.mockResolvedValue({ data: { added: 2 } });
    fireEvent.click(addButton());
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(2));
    const [gymId, body] = api.addLeadFile.mock.calls[0];
    expect(gymId).toBe('g1');
    expect(body.mapping).toEqual(PREVIEW.mapping);
    expect(body.expected).toBe(KEY);
    expect(body.permissionConfirmed).toBe(true);
    expect(body.contentBase64).toBe(api.checkLeadFile.mock.calls[0][1].contentBase64);
    expect(Object.keys(body).sort()).toEqual(['contentBase64', 'expected', 'mapping', 'permissionConfirmed']);
  });

  it('names who will be added and who will not, with the reason, and every name on See all', async () => {
    open();
    await pick();
    const add = screen.getByTestId('group-add');
    expect(add.textContent).toContain('New leads');
    expect(add.textContent).toContain('Ann Bell and Bo Cox');
    const kept = screen.getByTestId('group-alreadyLead');
    expect(kept.textContent).toContain(LEAD_FILE_WORDS.already_lead_reason);
    expect(kept.textContent).toContain('Jo Lane');
    expect(screen.getByTestId('lead-file-notes').textContent).toContain(LEAD_FILE_WORDS.no_contact(1));
    expect(screen.getByTestId('lead-file-sources').textContent).toContain('Instagram → Social media');
    fireEvent.click(within(add).getByRole('button', { name: 'See all' }));
    expect(within(add).getByText('ann@example.com')).toBeTruthy();
    expect(within(add).getByText('bo@example.com')).toBeTruthy();
  });

  it('a column changed must be checked again before Add, and the new check sends that mapping', async () => {
    open();
    await pick();
    fireEvent.click(tick());
    fireEvent.click(screen.getByRole('button', { name: 'Check columns' }));
    // A column never kept has no picker.
    const columns = screen.getByTestId('lead-file-columns');
    expect(within(columns).getByText('Not kept: card numbers')).toBeTruthy();
    expect(within(columns).queryByLabelText('What Card Number holds')).toBeNull();
    fireEvent.change(screen.getByLabelText('What Lead Source holds'), { target: { value: 'notes' } });
    expect(addButton().disabled).toBe(true);
    expect(screen.getByTestId('lead-file-why').textContent).toContain('Check the file again first.');
    fireEvent.click(screen.getByRole('button', { name: 'Check the file again' }));
    await waitFor(() => expect(api.checkLeadFile).toHaveBeenCalledTimes(2));
    expect(api.checkLeadFile.mock.calls[1][1].mapping).toEqual({ ...MAPPING, source: null, notes: 2 });
  });

  it('a list that changed since the check adds nothing and offers Check again', async () => {
    open();
    await pick();
    fireEvent.click(tick());
    api.addLeadFile.mockRejectedValue({ response: { status: 409, data: { error: LEAD_FILE_CHANGED_ERROR, message: LEAD_FILE_WORDS.changed } } });
    fireEvent.click(addButton());
    expect(await screen.findByText(LEAD_FILE_WORDS.changed)).toBeTruthy();
    expect(onAdded).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(api.checkLeadFile).toHaveBeenCalledTimes(2));
    expect(api.checkLeadFile.mock.calls[1][1].mapping).toEqual(MAPPING);
  });

  it('a gym with no live plan can open the panel and choose nothing', () => {
    open(true);
    expect(screen.getByRole('button', { name: 'Choose a file' }).disabled).toBe(true);
  });
});
