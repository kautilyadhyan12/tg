// Settings → Signed forms of deleted members (ROADMAP 18u-iii).
//
// The worst thing this box could do: show a deleted person's signed forms to somebody who is not
// the gym's own owner. So for anybody else it reads who can see them and asks the server nothing.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: { getDeletedForms: vi.fn(), getDeletedForm: vi.fn() } };
});

const { orgService } = await import('../../api/orgsApi');
const DeletedFormsPanel = (await import('./DeletedFormsPanel')).default;

const ORG = { id: '11111111-1111-4111-8111-111111111111', name: 'Iron House', orgType: 'gym', timezone: 'America/Chicago' };
const SIGNED = '2026-03-02T17:00:00.000Z';
const DELETED = '2026-10-15T17:00:00.000Z';
const KEPT = '2032-10-15T17:00:00.000Z';
const id = (n) => `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`;
const form = (n, over) => ({ id: id(n), kind: 'waiver', signedName: 'Maya Patel', signer: 'person', member: null, agreementName: null, signedAt: SIGNED, deletedAt: DELETED, keptUntil: KEPT, ...over });
const FORMS = [
  form(1, {}),
  form(2, { kind: 'agreement', member: 'Maya Patel' }),
  form(3, { kind: 'agreement', signedName: 'Asha Patel', signer: 'guardian', member: 'Mia Patel', agreementName: 'Kids classes' }),
  form(4, { signedName: 'Asha Patel', signer: 'guardian', member: 'Mia Patel' }),
  // Deleted before a waiver kept its member's name.
  form(5, { signedName: 'Asha Patel', signer: 'guardian' }),
];
const page = (forms, total = forms.length, next = null) => ({ data: { forms, total, next, timezone: 'America/Chicago' } });

function open(isOwner = true) {
  render(<DeletedFormsPanel org={ORG} isOwner={isOwner} />);
  fireEvent.click(screen.getByRole('button', { name: /^signed forms of deleted members/i }));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('anybody but the gym’s own owner', () => {
  it('reads who can see them, and the server is never asked', async () => {
    open(false);
    expect(screen.getByText('Owner only')).toBeTruthy();
    expect(screen.getByText('Only the owner of Iron House can see the signed forms of deleted members.')).toBeTruthy();
    await Promise.resolve();
    expect(orgService.getDeletedForms).not.toHaveBeenCalled();
    expect(orgService.getDeletedForm).not.toHaveBeenCalled();
    expect(screen.queryByText(/Patel/)).toBeNull();
  });
});

describe('the owner', () => {
  it('with none kept: says so, and offers no search', async () => {
    orgService.getDeletedForms.mockResolvedValue(page([]));
    open();
    expect(await screen.findByText('None kept')).toBeTruthy();
    expect(screen.getByText(/^When you delete a member for good, the waivers and membership agreements they signed at Iron House are kept here for six years/)).toBeTruthy();
    expect(screen.getByText('No signed forms are kept. When you delete a member for good, the waiver and membership agreements they signed appear here.')).toBeTruthy();
    expect(screen.queryByRole('search')).toBeNull();
  });

  it('reads each form: whom it is about, what it is, who signed, and until when it is kept', async () => {
    orgService.getDeletedForms.mockResolvedValue(page(FORMS));
    open();
    expect(await screen.findByText('5 kept')).toBeTruthy();
    const rows = within(screen.getByRole('list', { name: 'Signed forms' })).getAllByRole('listitem');
    expect(rows.map((row) => [...row.querySelectorAll('p')].map((p) => p.textContent))).toEqual([
      ['Maya Patel', 'Waiver. Signed on 2 March 2026.', 'Deleted on 15 October 2026. Kept until 15 October 2032.'],
      ['Maya Patel', 'Membership agreement. Signed on 2 March 2026.', 'Deleted on 15 October 2026. Kept until 15 October 2032.'],
      ['Mia Patel', 'Membership agreement: Kids classes. Signed by Asha Patel, parent or guardian, on 2 March 2026.', 'Deleted on 15 October 2026. Kept until 15 October 2032.'],
      ['Mia Patel', 'Waiver. Signed by Asha Patel, parent or guardian, on 2 March 2026.', 'Deleted on 15 October 2026. Kept until 15 October 2032.'],
      ['A child (name not kept)', 'Waiver. Signed by Asha Patel, parent or guardian, on 2 March 2026.', 'Deleted on 15 October 2026. Kept until 15 October 2032.'],
    ]);
    expect(orgService.getDeletedForms).toHaveBeenCalledWith(ORG.id, { q: '', after: null });
  });

  it('View opens the form under its row, as it was signed, and Close shuts it', async () => {
    orgService.getDeletedForms.mockResolvedValue(page(FORMS));
    orgService.getDeletedForm.mockResolvedValue({
      data: {
        kind: 'agreement',
        gymName: 'Iron House',
        timezone: 'America/Chicago',
        deletedAt: DELETED,
        keptUntil: KEPT,
        signed: {
          name: 'Asha Patel',
          signer: 'guardian',
          at: SIGNED,
          by: 'Sam Lee',
          version: 1,
          text: 'Cancel with 30 days notice.',
          facts: [
            { label: 'Member', value: 'Mia Patel' },
            { label: 'Price', value: '$30.00 every month' },
          ],
          emailedAt: null,
          agreementName: 'Kids classes',
          via: 'desk',
        },
      },
    });
    open();
    const rows = within(await screen.findByRole('list', { name: 'Signed forms' })).getAllByRole('listitem');
    fireEvent.click(within(rows[2]).getByRole('button', { name: 'View' }));
    const box = await within(rows[2]).findByRole('group', { name: 'Membership agreement: Kids classes signed for Mia Patel' });
    expect(await within(box).findByText('Signed by Asha Patel, parent or guardian, on 2 March 2026.')).toBeTruthy();
    expect(within(box).getByText('Signed at the front desk with Sam Lee.')).toBeTruthy();
    expect(within(box).getByText('$30.00 every month')).toBeTruthy();
    expect(within(box).getByRole('region', { name: "Iron House's terms, as signed" }).textContent).toBe('Cancel with 30 days notice.');
    expect(orgService.getDeletedForm).toHaveBeenCalledWith(ORG.id, 'agreement', id(3));
    // Nothing on it changes or removes the form.
    expect(within(box).getAllByRole('button').map((b) => b.textContent)).toEqual(['Close']);
    fireEvent.click(within(box).getByRole('button', { name: 'Close' }));
    expect(within(rows[2]).queryByRole('group')).toBeNull();
    expect(within(rows[2]).getByRole('button', { name: 'View' })).toBeTruthy();
  });

  it('searches by name, says when nothing matches, and Clear shows them all again', async () => {
    orgService.getDeletedForms.mockResolvedValue(page(FORMS));
    open();
    const field = await screen.findByLabelText('Search by name');
    orgService.getDeletedForms.mockResolvedValue(page([]));
    fireEvent.change(field, { target: { value: '  Ravi ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('No signed forms match “Ravi”.')).toBeTruthy();
    expect(orgService.getDeletedForms).toHaveBeenLastCalledWith(ORG.id, { q: 'Ravi', after: null });
    // The closed section still counts what is kept, not what the search found.
    expect(screen.getByText('5 kept')).toBeTruthy();
    orgService.getDeletedForms.mockResolvedValue(page(FORMS));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(await screen.findAllByText('Maya Patel')).toHaveLength(2);
    expect(orgService.getDeletedForms).toHaveBeenLastCalledWith(ORG.id, { q: '', after: null });
  });

  it('Show more adds the next page under the first, until all are shown', async () => {
    const first = Array.from({ length: 50 }, (_, n) => form(n + 10, { signedName: `Old Member ${String(n + 1)}` }));
    const second = Array.from({ length: 7 }, (_, n) => form(n + 60, { signedName: `Old Member ${String(n + 51)}` }));
    const CURSOR = '2026-10-01 12:00:00+00|2026-03-02 17:00:00+00|22222222-2222-4222-8222-000000000059';
    orgService.getDeletedForms.mockResolvedValueOnce(page(first, 57, CURSOR)).mockResolvedValueOnce(page(second, 57));
    open();
    expect(await screen.findByText('Showing 50 of 57.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await screen.findByText('Old Member 57')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Signed forms' })).getAllByRole('listitem')).toHaveLength(57);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
    expect(orgService.getDeletedForms).toHaveBeenLastCalledWith(ORG.id, { q: '', after: CURSOR });
  });

  it('reads again when staff come back to the window, so a member deleted in another tab shows', async () => {
    orgService.getDeletedForms.mockResolvedValueOnce(page(FORMS.slice(0, 1))).mockResolvedValueOnce(page(FORMS));
    open();
    expect(await screen.findByText('1 kept')).toBeTruthy();
    window.dispatchEvent(new Event('focus'));
    expect(await screen.findByText('5 kept')).toBeTruthy();
    expect(orgService.getDeletedForms).toHaveBeenCalledTimes(2);
  });
});
