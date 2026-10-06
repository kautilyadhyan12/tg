// THE PERSONAL TRAINING PAGE (ROADMAP 17e-i), drawn with the server's answers mocked: what
// staff press is what is sent, and nothing is offered to somebody who may not do it.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const api = {
  getPtTrainers: vi.fn(),
  savePtTrainer: vi.fn(),
  getPtWeek: vi.fn(),
  getPtPeople: vi.fn(),
  bookPt: vi.fn(),
  cancelPt: vi.fn(),
};
vi.mock('../../api/orgsApi', async (importOriginal) => ({ ...(await importOriginal()), orgService: api }));
let ORG;
vi.mock('./useConsoleOrg', () => ({ useConsoleOrg: () => ({ loading: false, error: null, org: ORG, notFound: false, reload: () => {} }) }));

const PersonalTraining = (await import('./PersonalTraining')).default;

const SAM = '11111111-1111-4111-8111-000000000001';
const OWNER = '11111111-1111-4111-8111-000000000002';
const ANA = '11111111-1111-4111-8111-000000000003';
const MAYA = '22222222-2222-4222-8222-000000000001';
const LEO = '22222222-2222-4222-8222-000000000002';
const SESSION = '33333333-3333-4333-8333-000000000001';

const sam = { userId: SAM, name: 'Sam Reed', initials: 'SR', offers: true, sessionMinutes: 60, hours: [{ weekday: 5, fromMinute: 540, toMinute: 720 }], mine: false };
const owner = { userId: OWNER, name: 'Harbour Owner', initials: 'HO', offers: false, sessionMinutes: null, hours: [], mine: true };
const ana = { userId: ANA, name: 'Ana Diaz', initials: 'AD', offers: false, sessionMinutes: null, hours: [], mine: false };
const trainers = (over = {}) => ({ timezone: 'Europe/London', canManage: true, canBook: true, freeCancelMinutes: 120, gymHasTypes: true, trainers: [ana, owner, sam], ...over });
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
    classes: [],
  })),
  ...over,
});
const PEOPLE = {
  gymHasTypes: true,
  people: [
    { entryId: MAYA, name: 'Maya Lopez', pt: { membership: 'PT 10', sessionsLeft: 9 } },
    { entryId: LEO, name: 'Leo Grant', pt: null },
  ],
  more: false,
};

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
  api.getPtPeople.mockResolvedValue({ data: PEOPLE });
});
afterEach(cleanup);

describe('the page for whoever runs the timetable', () => {
  it('lists the trainers who are set up, says what the page is for, and shows the first one’s week: never the reader as a trainer', async () => {
    open();
    expect(await screen.findByText('One-to-one sessions with a trainer. Set when each trainer is free, then book members into their free times.')).toBeTruthy();
    expect(screen.getByText('These hours repeat every week. A class a trainer coaches is taken off their free times by itself.')).toBeTruthy();
    const rows = screen.getAllByTestId('pt-trainer');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('Sam Reed · 60-minute sessions');
    expect(rows[0].textContent).toContain('Friday · 09:00 – 12:00');
    expect(within(rows[0]).getByText('Week shown below')).toBeTruthy();
    // The owner is not a trainer, and is not drawn as one.
    expect(screen.queryByText(/Harbour Owner \(you\) ·/)).toBeNull();
    expect(await screen.findByRole('heading', { name: 'Sam Reed · Wed 7 Oct – Tue 13 Oct' })).toBeTruthy();
    expect(api.getPtWeek).toHaveBeenCalledWith('g1', SAM, null);

    const day = await friday();
    expect(day.getByText('Fri 9 Oct')).toBeTruthy();
    expect(day.getByText('Free times. Press one to book it.')).toBeTruthy();
    expect(day.getByRole('button', { name: 'Book 09:00 – 10:00' })).toBeTruthy();
    expect(day.getByTestId('pt-session').textContent).toContain('10:00 – 11:00 · Maya Lopez');
    expect(day.getByTestId('pt-session').textContent).toContain('PT 10 · 1 session used');
    // The week before today is not offered; the next one is one press away, and the page says how far it goes.
    expect(screen.getByText('Sessions can be booked up to Tue 1 Dec.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Previous week/ }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Next week/ }));
    await waitFor(() => expect(api.getPtWeek).toHaveBeenLastCalledWith('g1', SAM, '2026-10-14'));
  });

  it('with nobody set up it says so and how to start, and asks for no week', async () => {
    api.getPtTrainers.mockResolvedValue({ data: trainers({ trainers: [ana, owner] }) });
    open();
    expect(await screen.findByText('No trainers yet. This is how it works:')).toBeTruthy();
    expect([...screen.getByTestId('pt-how').querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Add a trainer and set the hours they are free.',
      'Tick "Includes personal training" on a membership or pack (Settings, then Memberships) and give it to the member on their page.',
      "Press one of the trainer's free times and pick the member.",
    ]);
    expect(screen.getByRole('button', { name: 'Set their hours' }).disabled).toBe(true);
    expect(screen.queryByTestId('pt-day')).toBeNull();
    expect(api.getPtWeek).not.toHaveBeenCalled();
  });

  it('a gym that sells no memberships is not told to tick one', async () => {
    api.getPtTrainers.mockResolvedValue({ data: trainers({ gymHasTypes: false, trainers: [ana, owner] }) });
    open();
    await screen.findByText('No trainers yet. This is how it works:');
    expect([...screen.getByTestId('pt-how').querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Add a trainer and set the hours they are free.',
      "Press one of the trainer's free times and pick the member.",
    ]);
  });

  it('a class the trainer coaches is listed on its day as time that is not free, on the clock the gym reads', async () => {
    ORG = { ...ORG, clockFormat: '12h' };
    const data = week();
    data.days[2].classes = [{ name: 'Spin', localStartMinute: 615, minutes: 45 }];
    data.days[2].free = [660];
    // A class and nothing else on a day still shows the day whole.
    data.days[3].classes = [{ name: 'Yoga', localStartMinute: 1080, minutes: 60 }];
    api.getPtWeek.mockResolvedValue({ data });
    open();
    const day = await friday();
    expect(within(day.getByTestId('pt-coaching')).getByText('10:15 AM – 11:00 AM · Spin')).toBeTruthy();
    expect(day.getByText('Coaching a class, so not free')).toBeTruthy();
    expect(day.getByRole('button', { name: 'Book 11:00 AM – 12:00 PM' })).toBeTruthy();
    // The session booked from 10:00 runs into the class given to the trainer afterwards, and says so.
    expect(day.getByText('This runs into Spin, a class they coach at the same time. Move one of them.')).toBeTruthy();
    const saturday = within(screen.getAllByTestId('pt-day')[3]);
    expect(saturday.getByText('6:00 PM – 7:00 PM · Yoga')).toBeTruthy();
    expect(saturday.getByText('No free times')).toBeTruthy();
  });

  it('Add a trainer: pick a member of staff, set their hours, and their week is the one shown', async () => {
    const anaSet = { ...ana, offers: true, sessionMinutes: 45, hours: [] };
    api.savePtTrainer.mockResolvedValue({ data: trainers({ trainers: [anaSet, owner, sam] }) });
    open();
    await screen.findAllByTestId('pt-trainer');
    const add = screen.getByLabelText('Add a trainer');
    expect([...add.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Choose a member of staff', 'Ana Diaz', 'Harbour Owner (you)']);
    fireEvent.change(add, { target: { value: ANA } });
    fireEvent.click(screen.getByRole('button', { name: 'Set their hours' }));
    const form = within(screen.getByTestId('pt-hours-form'));
    expect(form.getByRole('heading', { name: 'Hours for Ana Diaz' })).toBeTruthy();
    // Any length, typed: 45 by its button here, then no hours and unticked is a valid save.
    fireEvent.click(form.getByRole('button', { name: '45 minutes' }));
    expect(form.getByLabelText('How long is one session? (minutes)').value).toBe('45');
    fireEvent.click(form.getByLabelText('Takes personal training sessions'));
    fireEvent.click(form.getByRole('button', { name: 'Save hours' }));
    await waitFor(() => expect(api.savePtTrainer).toHaveBeenCalledWith('g1', ANA, { offers: false, sessionMinutes: 45, hours: [] }));
    await waitFor(() => expect(api.getPtWeek).toHaveBeenLastCalledWith('g1', ANA, null));
    expect(screen.getAllByTestId('pt-trainer')).toHaveLength(2);
  });

  it("while another member of staff is picked or being set up, the first trainer's week is put away; See week brings it back", async () => {
    open();
    await friday();
    expect(screen.getByRole('heading', { name: /^Sam Reed · / })).toBeTruthy();
    // Picked in the list, before any button.
    fireEvent.change(screen.getByLabelText('Add a trainer'), { target: { value: OWNER } });
    expect(screen.queryByRole('heading', { name: /^Sam Reed · / })).toBeNull();
    expect(screen.queryByTestId('pt-day')).toBeNull();
    expect(screen.queryByText('Week shown below')).toBeNull();
    // And while their hours form is open.
    fireEvent.click(screen.getByRole('button', { name: 'Set their hours' }));
    expect(screen.getByRole('heading', { name: 'Hours for Harbour Owner (you)' })).toBeTruthy();
    expect(screen.queryByTestId('pt-day')).toBeNull();
    // Closing the form without saving, the list still names the person picked, so the week stays away.
    fireEvent.click(within(screen.getByTestId('pt-hours-form')).getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('pt-day')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: "See Sam Reed's week" }));
    expect((await screen.findAllByTestId('pt-day')).length).toBe(7);
    expect(screen.getByLabelText('Add a trainer').value).toBe('');
    // Editing Sam's own hours keeps Sam's week on screen.
    fireEvent.click(screen.getByRole('button', { name: 'Edit hours for Sam Reed' }));
    expect(screen.getAllByTestId('pt-day')).toHaveLength(7);
  });

  it('See week on another trainer reads theirs', async () => {
    const anaSet = { ...ana, offers: true, sessionMinutes: 30, hours: [{ weekday: 1, fromMinute: 600, toMinute: 660 }] };
    api.getPtTrainers.mockResolvedValue({ data: trainers({ trainers: [anaSet, owner, sam] }) });
    open(`/console/iron-house/personal-training?trainer=${SAM}`);
    await screen.findByRole('heading', { name: /^Sam Reed · / });
    fireEvent.click(screen.getByRole('button', { name: "See Ana Diaz's week" }));
    await waitFor(() => expect(api.getPtWeek).toHaveBeenLastCalledWith('g1', ANA, null));
  });
});

describe('booking', () => {
  it('a free time opens the box with the members already listed, people with personal training first; Book sends exactly that time and person once', async () => {
    api.bookPt.mockResolvedValue({ data: { appointment: mayaSession() } });
    open();
    const day = await friday();
    fireEvent.click(day.getByRole('button', { name: 'Book 11:00 – 12:00' }));
    const box = within(await screen.findByTestId('pt-book-box'));
    expect(box.getByRole('heading').textContent).toBe('Book Sam Reed · Fri 9 Oct · 11:00 – 12:00');
    // Nothing is typed: the list is asked for as the box opens.
    expect(await box.findByText('Your members, people with personal training first')).toBeTruthy();
    expect(api.getPtPeople).toHaveBeenCalledWith('g1', '', '2026-10-09');
    expect(box.getByText('PT 10 · 9 sessions left')).toBeTruthy();
    // Leo holds nothing that pays for a session: he is named, says why, and cannot be picked.
    expect(box.getByText('No membership that includes personal training')).toBeTruthy();
    expect(box.queryByRole('button', { name: 'Pick Leo Grant' })).toBeNull();

    fireEvent.click(box.getByRole('button', { name: 'Pick Maya Lopez' }));
    expect(box.getByText('Maya Lopez will be booked with Sam Reed on Fri 9 Oct, 11:00 – 12:00.')).toBeTruthy();
    expect(box.getByText(/One session is used from PT 10\. The app doesn't tell them yet/)).toBeTruthy();
    expect(api.bookPt).not.toHaveBeenCalled();

    fireEvent.click(box.getByRole('button', { name: 'Book session' }));
    await waitFor(() => expect(api.bookPt).toHaveBeenCalledTimes(1));
    const [gymId, body] = api.bookPt.mock.calls[0];
    expect(gymId).toBe('g1');
    expect(body).toMatchObject({ trainerId: SAM, entryId: MAYA, localDate: '2026-10-09', startMinute: 660, minutes: 60 });
    expect(body.requestKey).toMatch(/^[0-9a-f-]{36}$/);
    // The week is read again and the box is gone.
    await waitFor(() => expect(api.getPtWeek).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('pt-book-box')).toBeNull();
  });

  it('typing a name narrows the list', async () => {
    open();
    fireEvent.click((await friday()).getByRole('button', { name: 'Book 09:00 – 10:00' }));
    const box = within(await screen.findByTestId('pt-book-box'));
    await box.findByText('Your members, people with personal training first');
    api.getPtPeople.mockResolvedValue({ data: { gymHasTypes: true, people: [], more: false } });
    fireEvent.change(box.getByPlaceholderText('Search by name or email'), { target: { value: 'zz' } });
    expect(await box.findByText('Nobody on your member list matches.')).toBeTruthy();
    expect(api.getPtPeople).toHaveBeenLastCalledWith('g1', 'zz', '2026-10-09');
  });

  it("the server's refusal is shown in its own words, the box stays, and a second press sends the same request", async () => {
    api.bookPt.mockRejectedValue({ response: { status: 409, data: { error: 'pack_used', message: "This person's pack has no sessions left." } } });
    open();
    fireEvent.click((await friday()).getByRole('button', { name: 'Book 09:00 – 10:00' }));
    const box = within(await screen.findByTestId('pt-book-box'));
    fireEvent.click(await box.findByRole('button', { name: 'Pick Maya Lopez' }));
    fireEvent.click(box.getByRole('button', { name: 'Book session' }));
    expect(await box.findByRole('alert')).toBeTruthy();
    expect(box.getByRole('alert').textContent).toBe("This person's pack has no sessions left.");
    fireEvent.click(box.getByRole('button', { name: 'Book session' }));
    await waitFor(() => expect(api.bookPt).toHaveBeenCalledTimes(2));
    expect(api.bookPt.mock.calls[1][1].requestKey).toBe(api.bookPt.mock.calls[0][1].requestKey);
  });
});

describe('a trainer on the usual permissions', () => {
  beforeEach(() => {
    api.getPtTrainers.mockResolvedValue({ data: trainers({ canManage: false, canBook: false, trainers: [{ ...sam, mine: true }] }) });
  });

  it('sees their own hours and week, the free times as plain times with why, and no Book; their own session can be cancelled', async () => {
    open();
    expect(await screen.findByRole('heading', { name: 'Your hours' })).toBeTruthy();
    expect(screen.getByText('One-to-one sessions. Set when you are free; the sessions booked with you appear below.')).toBeTruthy();
    expect(screen.getByText('These hours repeat every week. A class you coach is taken off your free times by itself.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Trainers' })).toBeNull();
    expect(screen.queryByLabelText('Add a trainer')).toBeNull();
    const day = await friday();
    expect(day.getByText('09:00 – 10:00')).toBeTruthy();
    expect(day.queryByRole('button', { name: 'Book 09:00 – 10:00' })).toBeNull();
    expect(screen.getByText(/To book one, ask a manager/)).toBeTruthy();
    expect(day.getByRole('button', { name: "Cancel Maya Lopez's session" })).toBeTruthy();
    expect(api.getPtPeople).not.toHaveBeenCalled();
  });

  it('edits their own hours', async () => {
    api.savePtTrainer.mockResolvedValue({ data: trainers({ canManage: false, canBook: false, trainers: [{ ...sam, mine: true, sessionMinutes: 20 }] }) });
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit my hours' }));
    const form = within(screen.getByTestId('pt-hours-form'));
    fireEvent.change(form.getByLabelText('How long is one session? (minutes)'), { target: { value: '20' } });
    expect(form.getByText(/These hours make 9 sessions a week\./)).toBeTruthy();
    fireEvent.click(form.getByRole('button', { name: 'Save hours' }));
    await waitFor(() =>
      expect(api.savePtTrainer).toHaveBeenCalledWith('g1', SAM, { offers: true, sessionMinutes: 20, hours: [{ weekday: 5, fromMinute: 540, toMinute: 720 }] }),
    );
    expect(await screen.findByText('20-minute sessions')).toBeTruthy();
  });
});

describe('cancelling', () => {
  it('a free cancel asks first, says the pack gets its session back, and sends a plain cancel', async () => {
    api.cancelPt.mockResolvedValue({ data: { appointment: mayaSession({ status: 'cancelled', cancel: null, packCharged: false }) } });
    open();
    const day = await friday();
    fireEvent.click(day.getByRole('button', { name: "Cancel Maya Lopez's session" }));
    expect(day.getByText("Cancel Maya Lopez's session on Fri 9 Oct, 10:00 – 11:00? It's free to cancel, and their pack gets the session back.")).toBeTruthy();
    expect(api.cancelPt).not.toHaveBeenCalled();
    fireEvent.click(day.getByRole('button', { name: 'Keep it' }));
    expect(day.queryByRole('button', { name: 'Cancel session' })).toBeNull();
    fireEvent.click(day.getByRole('button', { name: "Cancel Maya Lopez's session" }));
    fireEvent.click(day.getByRole('button', { name: 'Cancel session' }));
    await waitFor(() => expect(api.cancelPt).toHaveBeenCalledWith('g1', SESSION, { lateOk: false, giveBack: false }));
    await waitFor(() => expect(api.getPtWeek).toHaveBeenCalledTimes(2));
  });

  it('a late cancel on a pack offers both outcomes, and each button sends its own', async () => {
    api.getPtWeek.mockResolvedValue({ data: week([mayaSession({ cancel: 'late' })]) });
    api.cancelPt.mockResolvedValue({ data: { appointment: mayaSession({ status: 'cancelled', cancel: null }) } });
    open();
    const day = await friday();
    fireEvent.click(day.getByRole('button', { name: "Cancel Maya Lopez's session" }));
    expect(day.getByText(/too late to cancel for free. Choose what happens to the session on their pack\./)).toBeTruthy();
    expect(day.queryByRole('button', { name: 'Cancel session' })).toBeNull();
    fireEvent.click(day.getByRole('button', { name: 'Cancel and give the session back' }));
    await waitFor(() => expect(api.cancelPt).toHaveBeenCalledWith('g1', SESSION, { lateOk: true, giveBack: true }));

    cleanup();
    api.cancelPt.mockClear();
    open();
    const again = await friday();
    fireEvent.click(again.getByRole('button', { name: "Cancel Maya Lopez's session" }));
    fireEvent.click(again.getByRole('button', { name: 'Late cancel: the session stays used' }));
    await waitFor(() => expect(api.cancelPt).toHaveBeenCalledWith('g1', SESSION, { lateOk: true, giveBack: false }));
  });

  it('a cancel that turned late while the box was open is not carried out: the week is read again and staff choose', async () => {
    api.cancelPt.mockRejectedValue({ response: { status: 409, data: { error: 'late_cancel', message: "It's too late to cancel for free.", packCharged: true } } });
    open();
    const day = await friday();
    fireEvent.click(day.getByRole('button', { name: "Cancel Maya Lopez's session" }));
    api.getPtWeek.mockResolvedValue({ data: week([mayaSession({ cancel: 'late' })]) });
    fireEvent.click(day.getByRole('button', { name: 'Cancel session' }));
    expect(await day.findByRole('alert')).toBeTruthy();
    expect(day.getByRole('alert').textContent).toBe("It's now too late to cancel for free. Choose again.");
    expect(await day.findByRole('button', { name: 'Cancel and give the session back' })).toBeTruthy();
    expect(api.cancelPt).toHaveBeenCalledTimes(1);
  });

  it('a give-back on a session somebody already cancelled late is not shown as done: the words stay until Close', async () => {
    api.getPtWeek.mockResolvedValue({ data: week([mayaSession({ cancel: 'late' })]) });
    api.cancelPt.mockRejectedValue({
      response: { status: 409, data: { error: 'kept_used', message: 'This session was already cancelled as a late cancel. The session stays used.' } },
    });
    open();
    const day = await friday();
    fireEvent.click(day.getByRole('button', { name: "Cancel Maya Lopez's session" }));
    fireEvent.click(day.getByRole('button', { name: 'Cancel and give the session back' }));
    expect((await day.findByRole('alert')).textContent).toBe('This session was already cancelled as a late cancel. The session stays used.');
    // Nothing more to choose, and the week is not read again behind the message.
    expect(day.queryByRole('button', { name: 'Cancel and give the session back' })).toBeNull();
    expect(day.queryByRole('button', { name: 'Late cancel: the session stays used' })).toBeNull();
    expect(api.getPtWeek).toHaveBeenCalledTimes(1);
    api.getPtWeek.mockResolvedValue({ data: week([]) });
    fireEvent.click(day.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(api.getPtWeek).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('a trainer who is not sent what the person pays with still reads that a session of a pack is used', async () => {
    api.getPtTrainers.mockResolvedValue({ data: trainers({ canManage: false, canBook: false, trainers: [{ ...sam, mine: true }] }) });
    api.getPtWeek.mockResolvedValue({ data: week([mayaSession({ membership: null, entryId: null })]) });
    open();
    expect((await friday()).getByTestId('pt-session').textContent).toContain('1 session used from their pack');
  });

  it('a session that has started has no Cancel', async () => {
    api.getPtWeek.mockResolvedValue({ data: week([mayaSession({ cancel: null })]) });
    open();
    expect((await friday()).queryByRole('button', { name: "Cancel Maya Lopez's session" })).toBeNull();
  });
});

describe('hours', () => {
  it('Edit hours opens the form as saved; a typed length that is not one is said, and Save waits', async () => {
    api.savePtTrainer.mockResolvedValue({ data: trainers({ trainers: [ana, owner, { ...sam, sessionMinutes: 20 }] }) });
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit hours for Sam Reed' }));
    const form = within(screen.getByTestId('pt-hours-form'));
    expect(form.getByLabelText('Takes personal training sessions').checked).toBe(true);
    expect(form.getByText('These hours make 3 sessions a week. Sessions already booked stay as they are.')).toBeTruthy();
    const length = form.getByLabelText('How long is one session? (minutes)');
    fireEvent.change(length, { target: { value: '52' } });
    expect(form.getByText('Type how long a session is, in minutes. Any length from 10 to 240 minutes, in steps of 5.')).toBeTruthy();
    expect(form.getByRole('button', { name: 'Save hours' }).disabled).toBe(true);
    fireEvent.change(length, { target: { value: '20' } });
    expect(form.getByText(/These hours make 9 sessions a week\./)).toBeTruthy();
    expect(api.savePtTrainer).not.toHaveBeenCalled();
    fireEvent.click(form.getByRole('button', { name: 'Save hours' }));
    await waitFor(() =>
      expect(api.savePtTrainer).toHaveBeenCalledWith('g1', SAM, { offers: true, sessionMinutes: 20, hours: [{ weekday: 5, fromMinute: 540, toMinute: 720 }] }),
    );
    await waitFor(() => expect(screen.queryByTestId('pt-hours-form')).toBeNull());
    expect(screen.getByTestId('pt-trainer').textContent).toContain('20-minute sessions');
  });

  it('hours that cannot be saved say why, and Close puts nothing through', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit hours for Sam Reed' }));
    const form = within(screen.getByTestId('pt-hours-form'));
    fireEvent.click(form.getByRole('button', { name: 'Remove Friday hours 1' }));
    expect(form.getByText('Add the hours they train, or untick "Takes personal training sessions".')).toBeTruthy();
    expect(form.getByRole('button', { name: 'Save hours' }).disabled).toBe(true);
    fireEvent.click(form.getByLabelText('Takes personal training sessions'));
    expect(form.getByRole('button', { name: 'Save hours' }).disabled).toBe(false);
    fireEvent.click(form.getByRole('button', { name: 'Close' }));
    expect(api.savePtTrainer).not.toHaveBeenCalled();
    expect(screen.getByTestId('pt-trainer').textContent).toContain('Friday · 09:00 – 12:00');
  });
});

describe('a gym that can only read', () => {
  it('shows the trainers, the sessions and the free times, and offers nothing that changes them', async () => {
    ORG = { ...ORG, consoleReadOnly: true };
    open();
    const day = await friday();
    expect(screen.getByText('This gym needs a plan before anything here can be changed.')).toBeTruthy();
    expect(day.getByTestId('pt-session')).toBeTruthy();
    expect(day.queryByRole('button', { name: "Cancel Maya Lopez's session" })).toBeNull();
    expect(day.queryByRole('button', { name: 'Book 09:00 – 10:00' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit hours for Sam Reed' })).toBeNull();
    expect(screen.queryByLabelText('Add a trainer')).toBeNull();
  });
});
