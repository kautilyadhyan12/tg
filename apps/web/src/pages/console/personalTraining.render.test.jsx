// THE PERSONAL TRAINING PAGE (ROADMAP 17e-i), drawn with the server's answers mocked: what
// staff press is what is sent, and nothing is offered to somebody who may not do it.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const api = {
  getPtTrainers: vi.fn(),
  savePtTrainer: vi.fn(),
  getPtWeek: vi.fn(),
  bookPt: vi.fn(),
  cancelPt: vi.fn(),
  getMemberListEntries: vi.fn(),
};
vi.mock('../../api/orgsApi', async (importOriginal) => ({ ...(await importOriginal()), orgService: api }));
let ORG;
vi.mock('./useConsoleOrg', () => ({ useConsoleOrg: () => ({ loading: false, error: null, org: ORG, notFound: false, reload: () => {} }) }));

const PersonalTraining = (await import('./PersonalTraining')).default;

const SAM = '11111111-1111-4111-8111-000000000001';
const ANA = '11111111-1111-4111-8111-000000000002';
const MAYA = '22222222-2222-4222-8222-000000000001';
const SESSION = '33333333-3333-4333-8333-000000000001';

const sam = { userId: SAM, name: 'Sam Reed', initials: 'SR', offers: true, sessionMinutes: 60, hours: [{ weekday: 5, fromMinute: 540, toMinute: 720 }], mine: false };
const ana = { userId: ANA, name: 'Ana Diaz', initials: 'AD', offers: false, sessionMinutes: null, hours: [], mine: true };
const trainers = (over = {}) => ({ timezone: 'Europe/London', canManage: true, canBook: true, freeCancelMinutes: 120, trainers: [ana, sam], ...over });
const mayaSession = (over = {}) => ({
  id: SESSION, trainerId: SAM, localDate: '2026-10-09', localStartMinute: 600, minutes: 60, startsAt: '2026-10-09T09:00:00.000Z', status: 'booked',
  name: 'Maya Lopez', initials: 'ML', entryId: MAYA, membership: 'PT 10', packCharged: true, cancel: 'free', ...over,
});
const week = (appointments = [mayaSession()], over = {}) => ({
  trainerId: SAM, timezone: 'Europe/London', today: '2026-10-07', from: '2026-10-07', to: '2026-10-13', lastDay: '2026-12-01', sessionMinutes: 60, offers: true,
  days: ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'].map((localDate) => ({
    localDate,
    free: localDate === '2026-10-09' ? [540, 660] : [],
    appointments: localDate === '2026-10-09' ? appointments : [],
  })),
  ...over,
});

const open = (path = '/console/iron-house/personal-training') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/console/:orgSlug/personal-training" element={<PersonalTraining />} />
      </Routes>
    </MemoryRouter>,
  );
const friday = async () => {
  const days = await screen.findAllByTestId('pt-day');
  return within(days[2]);
};

beforeEach(() => {
  ORG = { id: 'g1', slug: 'iron-house', name: 'Iron House', orgType: 'gym', timezone: 'Europe/London', clockFormat: '24h', consoleReadOnly: false };
  for (const fn of Object.values(api)) fn.mockReset();
  api.getPtTrainers.mockResolvedValue({ data: trainers() });
  api.getPtWeek.mockResolvedValue({ data: week() });
});
afterEach(cleanup);

describe('the page', () => {
  it('opens on the first trainer who takes sessions, with their hours, free times and booked sessions', async () => {
    open();
    expect(await screen.findByRole('heading', { name: 'Sam Reed' })).toBeTruthy();
    expect(screen.getByText('Friday · 09:00 – 12:00')).toBeTruthy();
    const day = await friday();
    expect(api.getPtWeek).toHaveBeenCalledWith('g1', SAM, null);
    expect(day.getByText('Fri 9 Oct')).toBeTruthy();
    expect(day.getByText('2 free times')).toBeTruthy();
    expect(day.getByRole('button', { name: 'Book 09:00' })).toBeTruthy();
    expect(day.getByTestId('pt-session').textContent).toContain('10:00 – 11:00 · Maya Lopez');
    expect(day.getByTestId('pt-session').textContent).toContain('PT 10 · 1 session used');
    expect(screen.getByRole('heading', { name: 'Wed 7 Oct – Tue 13 Oct' })).toBeTruthy();
    // Earlier than today is not offered.
    expect(screen.getByRole('button', { name: /Earlier/ }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Later/ }));
    await waitFor(() => expect(api.getPtWeek).toHaveBeenLastCalledWith('g1', SAM, '2026-10-14'));
  });

  it('the trainer in the address is the one shown, and picking another reads their week', async () => {
    api.getPtWeek.mockResolvedValue({ data: week([], { trainerId: ANA, sessionMinutes: null, offers: false }) });
    open(`/console/iron-house/personal-training?trainer=${ANA}`);
    expect(await screen.findByRole('heading', { name: 'Ana Diaz (you)' })).toBeTruthy();
    expect(await screen.findByText('Ana Diaz (you) has no hours yet. Set their hours to book sessions.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set hours' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Trainer'), { target: { value: SAM } });
    await waitFor(() => expect(api.getPtWeek).toHaveBeenLastCalledWith('g1', SAM, null));
  });
});

describe('booking', () => {
  it('a free time opens the box, the person is found on the member list, and Book sends exactly that time and person once', async () => {
    api.getMemberListEntries.mockResolvedValue({ data: { page: { total: 1, entries: [{ entryId: MAYA, fullName: 'Maya Lopez', membershipType: 'PT 10', email: null }], cursor: null } } });
    api.bookPt.mockResolvedValue({ data: { appointment: mayaSession() } });
    open();
    const day = await friday();
    fireEvent.click(day.getByRole('button', { name: 'Book 11:00' }));
    const box = within(await screen.findByTestId('pt-book-box'));
    expect(box.getByRole('heading').textContent).toBe('Book Sam Reed · Fri 9 Oct · 11:00 – 12:00');
    // Nothing is asked of the member list until something is typed.
    expect(api.getMemberListEntries).not.toHaveBeenCalled();
    fireEvent.change(box.getByPlaceholderText('Name, email or phone'), { target: { value: 'maya' } });
    fireEvent.click(await box.findByText('Maya Lopez'));
    expect(api.getMemberListEntries).toHaveBeenCalledWith('g1', 'query=maya');
    expect(box.getByText('Maya Lopez will be booked with Sam Reed on Fri 9 Oct, 11:00 – 12:00.')).toBeTruthy();
    expect(box.getByText(/The app doesn't tell them yet/)).toBeTruthy();
    expect(api.bookPt).not.toHaveBeenCalled();

    fireEvent.click(box.getByRole('button', { name: 'Book session' }));
    await waitFor(() => expect(api.bookPt).toHaveBeenCalledTimes(1));
    const [gymId, body] = api.bookPt.mock.calls[0];
    expect(gymId).toBe('g1');
    expect(body).toMatchObject({ trainerId: SAM, entryId: MAYA, localDate: '2026-10-09', startMinute: 660 });
    expect(body.requestKey).toMatch(/^[0-9a-f-]{36}$/);
    // The week is read again and the box is gone.
    await waitFor(() => expect(api.getPtWeek).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('pt-book-box')).toBeNull();
  });

  it("the server's refusal is shown in its own words, the box stays, and a second press sends the same request", async () => {
    api.getMemberListEntries.mockResolvedValue({ data: { page: { total: 1, entries: [{ entryId: MAYA, fullName: 'Maya Lopez', membershipType: null, email: null }], cursor: null } } });
    api.bookPt.mockRejectedValue({ response: { status: 409, data: { error: 'pack_used', message: "This person's pack has no sessions left." } } });
    open();
    fireEvent.click((await friday()).getByRole('button', { name: 'Book 09:00' }));
    const box = within(await screen.findByTestId('pt-book-box'));
    fireEvent.change(box.getByPlaceholderText('Name, email or phone'), { target: { value: 'maya' } });
    fireEvent.click(await box.findByText('Maya Lopez'));
    fireEvent.click(box.getByRole('button', { name: 'Book session' }));
    expect(await box.findByRole('alert')).toBeTruthy();
    expect(box.getByRole('alert').textContent).toBe("This person's pack has no sessions left.");
    fireEvent.click(box.getByRole('button', { name: 'Book session' }));
    await waitFor(() => expect(api.bookPt).toHaveBeenCalledTimes(2));
    expect(api.bookPt.mock.calls[1][1].requestKey).toBe(api.bookPt.mock.calls[0][1].requestKey);
  });

  it('staff who cannot read the member list see the free times as plain times, with why, and no Book', async () => {
    api.getPtTrainers.mockResolvedValue({ data: trainers({ canManage: false, canBook: false, trainers: [{ ...sam, mine: true }] }) });
    open();
    const day = await friday();
    expect(day.getByText('09:00')).toBeTruthy();
    expect(day.queryByRole('button', { name: 'Book 09:00' })).toBeNull();
    expect(screen.getByText(/To book one, ask a manager/)).toBeTruthy();
    // One row, their own: no trainer picker.
    expect(screen.queryByLabelText('Trainer')).toBeNull();
    // Their own session can still be cancelled.
    expect(day.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });
});

describe('cancelling', () => {
  it('a free cancel asks first, says the pack gets its session back, and sends a plain cancel', async () => {
    api.cancelPt.mockResolvedValue({ data: { appointment: mayaSession({ status: 'cancelled', cancel: null, packCharged: false }) } });
    open();
    const day = await friday();
    fireEvent.click(day.getByRole('button', { name: 'Cancel' }));
    expect(day.getByText("Cancel Maya Lopez's session on Fri 9 Oct, 10:00 – 11:00? It's free to cancel, and their pack gets the session back.")).toBeTruthy();
    expect(api.cancelPt).not.toHaveBeenCalled();
    fireEvent.click(day.getByRole('button', { name: 'Keep it' }));
    expect(day.queryByRole('button', { name: 'Cancel session' })).toBeNull();
    fireEvent.click(day.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(day.getByRole('button', { name: 'Cancel session' }));
    await waitFor(() => expect(api.cancelPt).toHaveBeenCalledWith('g1', SESSION, { lateOk: false, giveBack: false }));
    await waitFor(() => expect(api.getPtWeek).toHaveBeenCalledTimes(2));
  });

  it('a late cancel on a pack offers both outcomes, and each button sends its own', async () => {
    api.getPtWeek.mockResolvedValue({ data: week([mayaSession({ cancel: 'late' })]) });
    api.cancelPt.mockResolvedValue({ data: { appointment: mayaSession({ status: 'cancelled', cancel: null }) } });
    open();
    const day = await friday();
    fireEvent.click(day.getByRole('button', { name: 'Cancel' }));
    expect(day.getByText(/too late to cancel for free. Choose what happens to the session on their pack\./)).toBeTruthy();
    expect(day.queryByRole('button', { name: 'Cancel session' })).toBeNull();
    fireEvent.click(day.getByRole('button', { name: 'Cancel and give the session back' }));
    await waitFor(() => expect(api.cancelPt).toHaveBeenCalledWith('g1', SESSION, { lateOk: true, giveBack: true }));

    cleanup();
    api.cancelPt.mockClear();
    open();
    const again = await friday();
    fireEvent.click(again.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(again.getByRole('button', { name: 'Late cancel: the session stays used' }));
    await waitFor(() => expect(api.cancelPt).toHaveBeenCalledWith('g1', SESSION, { lateOk: true, giveBack: false }));
  });

  it('a cancel that turned late while the box was open is not carried out: the week is read again and staff choose', async () => {
    api.cancelPt.mockRejectedValue({ response: { status: 409, data: { error: 'late_cancel', message: "It's too late to cancel for free.", packCharged: true } } });
    open();
    const day = await friday();
    fireEvent.click(day.getByRole('button', { name: 'Cancel' }));
    api.getPtWeek.mockResolvedValue({ data: week([mayaSession({ cancel: 'late' })]) });
    fireEvent.click(day.getByRole('button', { name: 'Cancel session' }));
    expect(await day.findByRole('alert')).toBeTruthy();
    expect(day.getByRole('alert').textContent).toBe("It's now too late to cancel for free. Choose again.");
    expect(await day.findByRole('button', { name: 'Cancel and give the session back' })).toBeTruthy();
    expect(api.cancelPt).toHaveBeenCalledTimes(1);
  });

  it('a session that has started has no Cancel', async () => {
    api.getPtWeek.mockResolvedValue({ data: week([mayaSession({ cancel: null })]) });
    open();
    expect((await friday()).queryByRole('button', { name: 'Cancel' })).toBeNull();
  });
});

describe('hours', () => {
  it('Edit hours opens the form as saved, and Save sends every range and reads the week again', async () => {
    api.savePtTrainer.mockResolvedValue({ data: trainers({ trainers: [ana, { ...sam, sessionMinutes: 30 }] }) });
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit hours' }));
    const form = within(screen.getByTestId('pt-hours-form'));
    expect(form.getByLabelText('Takes personal training sessions').checked).toBe(true);
    expect(form.getByText('These hours make 3 sessions a week. Sessions already booked stay as they are.')).toBeTruthy();
    fireEvent.change(form.getByLabelText('Session length'), { target: { value: '30' } });
    expect(form.getByText(/These hours make 6 sessions a week\./)).toBeTruthy();
    expect(api.savePtTrainer).not.toHaveBeenCalled();
    fireEvent.click(form.getByRole('button', { name: 'Save hours' }));
    await waitFor(() =>
      expect(api.savePtTrainer).toHaveBeenCalledWith('g1', SAM, { offers: true, sessionMinutes: 30, hours: [{ weekday: 5, fromMinute: 540, toMinute: 720 }] }),
    );
    await waitFor(() => expect(screen.queryByTestId('pt-hours-form')).toBeNull());
    expect(screen.getByText('30-minute sessions')).toBeTruthy();
    expect(api.getPtWeek).toHaveBeenCalledTimes(2);
  });

  it('hours that cannot be saved say why, and Save waits', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit hours' }));
    const form = within(screen.getByTestId('pt-hours-form'));
    fireEvent.click(form.getByRole('button', { name: 'Remove Friday hours 1' }));
    expect(form.getByText('Add the hours they train, or untick "Takes personal training sessions".')).toBeTruthy();
    expect(form.getByRole('button', { name: 'Save hours' }).disabled).toBe(true);
    fireEvent.click(form.getByLabelText('Takes personal training sessions'));
    expect(form.getByRole('button', { name: 'Save hours' }).disabled).toBe(false);
    // Close puts nothing through.
    fireEvent.click(form.getByRole('button', { name: 'Close' }));
    expect(api.savePtTrainer).not.toHaveBeenCalled();
    expect(screen.getByText('Friday · 09:00 – 12:00')).toBeTruthy();
  });
});

describe('a gym that can only read', () => {
  it('shows the sessions and the free times, and offers nothing that changes them', async () => {
    ORG = { ...ORG, consoleReadOnly: true };
    open();
    const day = await friday();
    expect(screen.getByText('This gym needs a plan before anything here can be changed.')).toBeTruthy();
    expect(day.getByTestId('pt-session')).toBeTruthy();
    expect(day.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(day.queryByRole('button', { name: 'Book 09:00' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit hours' })).toBeNull();
  });
});
