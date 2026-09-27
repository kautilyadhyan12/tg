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
const person = (row, fullName, email, sourceWord = null) => ({ row, fullName, email, phone: null, source: 'social', sourceWord });
const PREVIEW = leadFilePreviewSchema.parse({
  sheet: { index: 0, name: null },
  headerRow: 0,
  columns: [
    { index: 0, header: 'Name', samples: ['Ann Bell'], guess: 'fullName', neverKept: null },
    { index: 1, header: 'Email', samples: ['ann@example.com'], guess: 'email', neverKept: null },
    { index: 2, header: 'Lead Source', samples: ['Instagram'], guess: 'source', neverKept: null },
    { index: 3, header: 'Card Number', samples: [], guess: null, neverKept: 'payment_card' },
    { index: 4, header: 'Opted to Receive Marketing', samples: ['Yes'], guess: null, neverKept: null },
  ],
  mapping: MAPPING,
  needsMapping: false,
  counts: { dataRows: 4, noContact: 1, noName: 0, twiceInFile: 0, add: 2, alreadyLead: 1, alreadyMember: 0, notAdded: 2 },
  add: [person(2, 'Ann Bell', 'ann@example.com', 'Instagram'), person(3, 'Bo Cox', 'bo@example.com')],
  notAdded: [
    { row: 4, fullName: 'Jo Lane', reason: 'already_lead', sameAs: null },
    { row: 5, fullName: 'Ella Fox', reason: 'no_contact', sameAs: null },
  ],
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
  await screen.findByTestId('lead-file-added');
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
    expect(addButton().disabled).toBe(true);
    expect(screen.getByTestId('lead-file-why').textContent).toContain('Tick the box above to add them.');
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

  it('names who will be added and everyone who will not, each with the reason beside the name', async () => {
    open();
    await pick();
    const added = screen.getByTestId('lead-file-added');
    expect(added.textContent).toContain('2 people will be added to your leads');
    expect(added.textContent).toContain('Ann Bell');
    expect(added.textContent).toContain('ann@example.com');
    expect(added.textContent).toContain('Social media · Instagram');
    expect(added.textContent).toContain('Bo Cox');
    const notAdded = screen.getByTestId('lead-file-not-added');
    expect(notAdded.textContent).toContain('Not added (2)');
    expect(notAdded.textContent).toContain('Jo Lane');
    expect(notAdded.textContent).toContain('Already one of your leads — left as they are');
    expect(notAdded.textContent).toContain('Ella Fox');
    expect(notAdded.textContent).toContain('No email or phone number');
    const columns = screen.getByTestId('lead-file-column-lines').textContent;
    expect(columns).toContain('Read: Name, Email, Lead Source');
    expect(columns).toContain('Not used: Opted to Receive Marketing');
    expect(columns).toContain('Left out: Card Number (we never keep card numbers)');
  });

  it('a column changed must be checked again before Add, and the new check sends that mapping', async () => {
    open();
    await pick();
    fireEvent.click(tick());
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    // A column never kept has no picker.
    const columns = screen.getByTestId('lead-file-columns');
    expect(within(columns).queryByLabelText('What Card Number holds')).toBeNull();
    // Headed as import tools head it, and the cells said as examples.
    expect(columns.textContent).toContain('Column in your file');
    expect(columns.textContent).toContain('Save as');
    expect(columns.textContent).toContain('e.g. Ann Bell');
    fireEvent.change(screen.getByLabelText('What Lead Source holds'), { target: { value: 'notes' } });
    expect(addButton().disabled).toBe(true);
    expect(screen.getByTestId('lead-file-why').textContent).toContain('Check the file again to see who will be added.');
    // The new check shows other people, so the tick given for the first ones is gone.
    const REMAPPED = { ...MAPPING, source: null, notes: 2 };
    api.checkLeadFile.mockResolvedValueOnce({ data: { preview: { ...PREVIEW, mapping: REMAPPED, expected: 'b'.repeat(64) } } });
    fireEvent.click(screen.getByRole('button', { name: 'Check the file again' }));
    await waitFor(() => expect(api.checkLeadFile).toHaveBeenCalledTimes(2));
    expect(api.checkLeadFile.mock.calls[1][1].mapping).toEqual(REMAPPED);
    await waitFor(() => expect(tick().getAttribute('aria-checked')).toBe('false'));
    expect(addButton().disabled).toBe(true);
  });

  it('a check that shows the same people keeps the tick', async () => {
    open();
    await pick();
    fireEvent.click(tick());
    api.addLeadFile.mockRejectedValue({ response: { status: 409, data: { error: LEAD_FILE_CHANGED_ERROR, message: LEAD_FILE_WORDS.changed } } });
    fireEvent.click(addButton());
    await screen.findByText(LEAD_FILE_WORDS.changed);
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(api.checkLeadFile).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(addButton().disabled).toBe(false));
    expect(tick().getAttribute('aria-checked')).toBe('true');
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
