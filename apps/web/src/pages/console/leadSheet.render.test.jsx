// One lead's sheet (ROADMAP 20c-i).
//
// THE WORST THING THIS SCREEN COULD DO: show or change the wrong person — an answer for
// a lead opened a moment earlier landing under another's name, or Joined putting a lead
// on the list as a record staff did not choose. So the first tests: a late answer for
// another lead is never shown; a status tap goes to the lead on screen; and "This is
// them" sends exactly the record it sits beside.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { leadSchema } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getLead: vi.fn(),
      createLead: vi.fn(),
      updateLead: vi.fn(),
      deleteLead: vi.fn(),
      joinLead: vi.fn(),
    },
  };
});

const { orgService } = await import('../../api/orgsApi');
const LeadSheet = (await import('./LeadSheet')).default;

const GYM = '11111111-1111-4111-8111-111111111111';
const ARJUN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TOM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MOTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OWN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const WORDS = { people: 'members', person: 'member', peopleCap: 'Members' };

const lead = (id, fullName, over = {}) =>
  leadSchema.parse({
    id,
    fullName,
    email: `${fullName.split(' ')[0].toLowerCase()}@example.com`,
    phone: null,
    source: 'walk_in',
    status: 'new',
    notes: '',
    entryId: null,
    createdAt: '2026-09-20T10:00:00.000Z',
    statusChangedAt: '2026-09-20T10:00:00.000Z',
    ...over,
  });
const arjun = lead(ARJUN, 'Arjun Shah', { email: 'shah.family@example.com' });
const tom = lead(TOM, 'Tom Reid');

const answer = (data) => Promise.resolve({ data });
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const conflict = (data) => Object.assign(new Error('409'), { response: { status: 409, data } });

const sheet = (leadId, props = {}) => (
  <MemoryRouter>
    <LeadSheet gymId={GYM} leadId={leadId} orgSlug="gym" words={WORDS} readOnly={false} onClose={() => undefined} onChanged={() => undefined} {...props} />
  </MemoryRouter>
);

beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(() => cleanup());

describe('the worst thing: the wrong person', () => {
  it('a late answer for a lead opened earlier is never shown under another', async () => {
    const late = deferred();
    orgService.getLead.mockImplementation((_gym, id) => (id === ARJUN ? late.promise : answer({ lead: tom })));
    const { rerender } = render(sheet(ARJUN));
    rerender(sheet(TOM));
    await screen.findByRole('heading', { name: 'Tom Reid' });
    late.resolve({ data: { lead: arjun } });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Arjun Shah')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Tom Reid' })).toBeTruthy();
  });

  it('an answer about a different lead than the one asked for is refused', async () => {
    orgService.getLead.mockResolvedValue({ data: { lead: tom } });
    render(sheet(ARJUN));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Tom Reid')).toBeNull();
  });

  it('a status tap changes the lead on screen, and only that lead', async () => {
    orgService.getLead.mockResolvedValue({ data: { lead: tom } });
    orgService.updateLead.mockResolvedValue({ data: { lead: { ...tom, status: 'contacted' } } });
    render(sheet(TOM));
    await screen.findByRole('heading', { name: 'Tom Reid' });
    fireEvent.click(within(screen.getByRole('group', { name: 'Status' })).getByRole('button', { name: 'Contacted' }));
    await waitFor(() => expect(orgService.updateLead).toHaveBeenCalledWith(GYM, TOM, { status: 'contacted' }));
    await waitFor(() =>
      expect(within(screen.getByRole('group', { name: 'Status' })).getByRole('button', { name: 'Contacted' }).getAttribute('aria-pressed')).toBe('true'),
    );
  });

  it('Joined asks which record is this person, and "This is them" sends the record it sits beside', async () => {
    orgService.getLead.mockResolvedValue({ data: { lead: arjun } });
    orgService.joinLead
      .mockRejectedValueOnce(
        conflict({
          error: 'lead_join_choose',
          message: 'Somebody on your list has the same email or phone. Choose the record that is this person, or add them as someone new.',
          candidates: [
            { entryId: MOTHER, fullName: 'Priya Shah', email: 'shah.family@example.com', phone: null, former: false },
            { entryId: OWN, fullName: 'Arjun Shah', email: 'shah.family@example.com', phone: '+447700900004', former: true },
          ],
          requestId: 'r1',
        }),
      )
      .mockResolvedValueOnce({ data: { lead: { ...arjun, status: 'joined', entryId: OWN }, outcome: 'restored' } });
    render(sheet(ARJUN));
    await screen.findByRole('heading', { name: 'Arjun Shah' });
    fireEvent.click(screen.getByRole('button', { name: 'Joined · add to your members' }));
    const choose = await screen.findByTestId('join-choose');
    expect(orgService.joinLead).toHaveBeenLastCalledWith(GYM, ARJUN, {});
    // Nothing was joined by asking.
    expect(screen.queryByRole('status')).toBeNull();
    const own = within(choose).getByText('Arjun Shah').closest('li');
    expect(within(own).getByText(/Past member/)).toBeTruthy();
    fireEvent.click(within(own).getByRole('button', { name: 'This is them · put back' }));
    await waitFor(() => expect(orgService.joinLead).toHaveBeenLastCalledWith(GYM, ARJUN, { entryId: OWN }));
    await screen.findByText("Arjun Shah's record is back on your list of members.");
    expect(screen.queryByTestId('join-choose')).toBeNull();
  });

  it('"Add as someone new" sends asNew and nothing else', async () => {
    orgService.getLead.mockResolvedValue({ data: { lead: arjun } });
    orgService.joinLead
      .mockRejectedValueOnce(
        conflict({
          error: 'lead_join_choose',
          message: 'Choose.',
          candidates: [{ entryId: MOTHER, fullName: 'Priya Shah', email: 'shah.family@example.com', phone: null, former: false }],
          requestId: 'r1',
        }),
      )
      .mockResolvedValueOnce({ data: { lead: { ...arjun, status: 'joined', entryId: OWN }, outcome: 'added' } });
    render(sheet(ARJUN));
    await screen.findByRole('heading', { name: 'Arjun Shah' });
    fireEvent.click(screen.getByRole('button', { name: 'Joined · add to your members' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add Arjun Shah as someone new' }));
    await waitFor(() => expect(orgService.joinLead).toHaveBeenLastCalledWith(GYM, ARJUN, { asNew: true }));
    await screen.findByText('Arjun Shah is on your list of members now.');
  });
});

describe('adding and keeping a lead', () => {
  it('Add lead says what is missing before sending, then sends only what was typed', async () => {
    const made = lead(TOM, 'Tom Reid', { email: null, phone: '+447700900456', source: 'friend' });
    orgService.createLead.mockResolvedValue({ data: { lead: made } });
    const changed = vi.fn();
    render(sheet(null, { onChanged: changed }));
    fireEvent.click(screen.getByRole('button', { name: 'Add lead' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', "Add the person's name.");
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' Tom Reid ' } });
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '07700 900456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add lead' }));
    expect(screen.getByRole('alert').textContent).toBe('Choose where they heard of you.');
    fireEvent.click(within(screen.getByRole('group', { name: 'Heard of you from' })).getByRole('button', { name: 'A friend' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add lead' }));
    await waitFor(() => expect(orgService.createLead).toHaveBeenCalledWith(GYM, { fullName: 'Tom Reid', phone: '07700 900456', source: 'friend' }));
    await screen.findByText('Tom Reid is on your leads.');
    expect(changed).toHaveBeenCalled();
    // The sheet now acts on the lead it made.
    orgService.updateLead.mockResolvedValue({ data: { lead: { ...made, status: 'on_trial' } } });
    fireEvent.click(within(screen.getByRole('group', { name: 'Status' })).getByRole('button', { name: 'On trial' }));
    await waitFor(() => expect(orgService.updateLead).toHaveBeenCalledWith(GYM, TOM, { status: 'on_trial' }));
  });

  it("the server's refusal is shown in its own words", async () => {
    orgService.createLead.mockRejectedValue(
      Object.assign(new Error('409'), { response: { status: 409, data: { error: 'lead_exists', message: 'This person is already one of your leads.' } } }),
    );
    render(sheet(null));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Priya Shah' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'priya@example.com' } });
    fireEvent.click(within(screen.getByRole('group', { name: 'Heard of you from' })).getByRole('button', { name: 'Walked in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add lead' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This person is already one of your leads.');
  });

  it('a joined lead says so and offers no second Joined', async () => {
    orgService.getLead.mockResolvedValue({ data: { lead: { ...tom, status: 'joined', entryId: OWN } } });
    render(sheet(TOM));
    await screen.findByRole('heading', { name: 'Tom Reid' });
    expect(screen.getByText(/On your list of members/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Joined · add to your members' })).toBeNull();
  });

  it('Delete asks first, and says the member list is not changed', async () => {
    orgService.getLead.mockResolvedValue({ data: { lead: tom } });
    orgService.deleteLead.mockResolvedValue({ status: 204 });
    const closed = vi.fn();
    render(sheet(TOM, { onClose: closed }));
    await screen.findByRole('heading', { name: 'Tom Reid' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete lead' }));
    expect(screen.getByText(/Your list of members is not changed/)).toBeTruthy();
    expect(orgService.deleteLead).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete lead' }));
    await waitFor(() => expect(orgService.deleteLead).toHaveBeenCalledWith(GYM, TOM));
    await waitFor(() => expect(closed).toHaveBeenCalled());
  });
});
