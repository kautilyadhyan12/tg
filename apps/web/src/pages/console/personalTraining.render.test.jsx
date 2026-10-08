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
  addPtTimeOff: vi.fn(),
  removePtTimeOff: vi.fn(),
  getBookingSettings: vi.fn(),
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
// The steps to a first session (23d), as the server says them: all done unless a test says not.
const ALL_DONE = { typeIncludesPt: true, somebodyHoldsIt: true, listHasPeople: true, sessionBooked: true };
const NOT_DONE = { typeIncludesPt: false, somebodyHoldsIt: false, listHasPeople: false, sessionBooked: false };
const OWNER_CAN = ['org.manage', 'staff.manage', 'memberships.manage', 'schedule.manage', 'members.read', 'members.confirm'];
const TRAINER_CAN = ['members.read', 'attendance.read'];
const trainers = (over = {}) => ({
  timezone: 'Europe/London',
  canManage: true,
  canBook: true,
  freeCancelMinutes: 120,
  gymHasTypes: true,
  setup: ALL_DONE,
  trainers: [ana, owner, sam],
  ...over,
});
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
  ORG = {
    id: 'g1',
    slug: 'iron-house',
    name: 'Iron House',
    orgType: 'gym',
    timezone: 'Europe/London',
    clockFormat: '24h',
    consoleReadOnly: false,
    privileges: OWNER_CAN,
  };
  for (const fn of Object.values(api)) fn.mockReset();
  api.getPtTrainers.mockResolvedValue({ data: trainers() });
  api.getPtWeek.mockResolvedValue({ data: week() });
  api.getPtPeople.mockResolvedValue({ data: PEOPLE });
});
afterEach(cleanup);

describe('the page for whoever runs the timetable', () => {
  it('the late-cancel box names the free-cancel time its own week read answered, not the one the page opened with (the review, L1)', async () => {
    // The page opened under 2 hours; a manager made it 1 day before this week was read.
    api.getPtTrainers.mockResolvedValue({ data: trainers({ freeCancelMinutes: 120 }) });
    api.getPtWeek.mockResolvedValue({ data: week([mayaSession({ cancel: 'late' })], { freeCancelMinutes: 1440 }) });
    open();
    const day = await friday();
    fireEvent.click(day.getByRole('button', { name: "Cancel Maya Lopez's session" }));
    expect(await screen.findByText(/It starts in less than 1 day, so it's too late to cancel for free\./)).toBeTruthy();
    expect(screen.queryByText(/less than 2 hours/)).toBeNull();
  });

  it('says personal training’s own booking rules, never the classes’ (17e-vi)', async () => {
    api.getBookingSettings.mockResolvedValue({
      data: { settings: { opensDays: 7, freeCancelMinutes: 120, handoverMinutes: 1440, waitlistMax: 20 }, pt: { opensDays: 3, freeCancelMinutes: 1440 } },
    });
    open();
    expect(await screen.findByText('Members can book up to 3 days ahead and cancel for free until 1 day before it starts.')).toBeTruthy();
    expect(screen.queryByText(/7 days ahead/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Change booking rules' }).getAttribute('href')).toBe('/console/iron-house/settings#booking-rules');
  });

  it('lists the trainers who are set up, says what the page is for, and shows the first one’s week: never the reader as a trainer', async () => {
    open();
    expect(await screen.findByText('One-to-one sessions with a trainer. Set when each trainer is available, then book members into their available times.')).toBeTruthy();
    expect(screen.getByText('These hours repeat every week. A class a trainer coaches is taken off their available times by itself.')).toBeTruthy();
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
    expect(day.getByText('Available times. Press one to book it.')).toBeTruthy();
    expect(day.getByRole('button', { name: 'Book 09:00 – 10:00' })).toBeTruthy();
    expect(day.getByTestId('pt-session').textContent).toContain('10:00 – 11:00 · Maya Lopez');
    expect(day.getByTestId('pt-session').textContent).toContain('PT 10 · 1 session used');
    // The week before today is not offered; the next one is one press away, and the page says how far it goes.
    expect(screen.getByText('Sessions can be booked up to Tue 1 Dec.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Previous week/ }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Next week/ }));
    await waitFor(() => expect(api.getPtWeek).toHaveBeenLastCalledWith('g1', SAM, '2026-10-14'));
  });

  // EVERY STEP TO A FIRST SESSION, with a tick on each one done (23d).
  const setupBox = () => within(screen.getByTestId('pt-setup'));
  const stepRows = () => [...screen.getByTestId('pt-setup').querySelectorAll('li')].map((li) => [li.dataset.step, li.dataset.done]);
  const stepText = (key) => screen.getByTestId('pt-setup').querySelector(`li[data-step="${key}"]`).textContent;
  const hrefOf = (name) => setupBox().getByRole('link', { name }).getAttribute('href');

  it('with nobody set up it lists every step with a button to its place and nothing ticked, and asks for no week', async () => {
    api.getPtTrainers.mockResolvedValue({ data: trainers({ setup: NOT_DONE, trainers: [ana, owner] }) });
    open();
    expect(await screen.findByRole('heading', { name: 'How to set up personal training' })).toBeTruthy();
    expect(screen.getByTestId('pt-setup-count').textContent).toBe('0 of 4 done');
    expect(stepRows()).toEqual([
      ['trainer', 'false'],
      ['type', 'false'],
      ['held', 'false'],
      ['book', 'false'],
    ]);
    expect(stepText('trainer')).toContain('1. Add a trainer and set their hours · Not done yet');
    expect(stepText('type')).toContain('2. Sell a membership or pack that includes personal training · Not done yet');
    expect(stepText('type')).toContain('On Memberships, tick "Includes personal training" on a membership or pack you sell.');
    expect(stepText('held')).toContain('3. Give it to a member · Not done yet');
    expect(stepText('book')).toContain("4. Book a session · Not done yet");
    // Each button opens the place its step is done in.
    expect(hrefOf('Invite staff')).toBe('/console/iron-house/members?view=staff&open=invite');
    expect(hrefOf('Open Memberships')).toBe('/console/iron-house/memberships');
    expect(hrefOf('Open Members')).toBe('/console/iron-house/members');
    expect(setupBox().getAllByRole('link')).toHaveLength(3);
    // The step to do next has the orange button, and only that one.
    expect(setupBox().getByRole('link', { name: 'Invite staff' }).className).toContain('c-btn-p');
    expect(setupBox().getByRole('link', { name: 'Open Memberships' }).className).not.toContain('c-btn-p');

    expect(screen.getByTestId('pt-no-trainers').textContent).toBe('No trainers yet.');
    expect(screen.getByRole('button', { name: 'Set their hours' }).disabled).toBe(true);
    expect(screen.queryByTestId('pt-day')).toBeNull();
    expect(api.getPtWeek).not.toHaveBeenCalled();
  });

  it('a gym that sells no memberships has three steps, and is not told to tick one', async () => {
    api.getPtTrainers.mockResolvedValue({ data: trainers({ gymHasTypes: false, setup: NOT_DONE, trainers: [ana, owner] }) });
    open();
    await screen.findByTestId('pt-setup');
    expect(screen.getByTestId('pt-setup-count').textContent).toBe('0 of 3 done');
    expect(stepRows().map(([key]) => key)).toEqual(['trainer', 'people', 'book']);
    expect(stepText('people')).toContain('2. Put your members on your list · Not done yet');
    expect(screen.getByTestId('pt-setup').textContent).not.toContain('Includes personal training');
    expect(setupBox().queryByRole('link', { name: 'Open Memberships' })).toBeNull();
  });

  it("each tick is the server's: what is done says Done, and the next step has the orange button", async () => {
    // Sam has hours, and a type includes personal training; nobody holds it yet.
    api.getPtTrainers.mockResolvedValue({ data: trainers({ setup: { ...NOT_DONE, typeIncludesPt: true } }) });
    open();
    await screen.findByTestId('pt-setup');
    expect(screen.getByTestId('pt-setup-count').textContent).toBe('2 of 4 done');
    expect(stepRows()).toEqual([
      ['trainer', 'true'],
      ['type', 'true'],
      ['held', 'false'],
      ['book', 'false'],
    ]);
    expect(stepText('trainer')).toContain('1. Add a trainer and set their hours · Done');
    expect(stepText('type')).toContain('· Done');
    expect(stepText('held')).toContain('· Not done yet');
    expect(setupBox().getByRole('link', { name: 'Open Members' }).className).toContain('c-btn-p');
    expect(setupBox().getByRole('link', { name: 'Open Memberships' }).className).not.toContain('c-btn-p');
    expect(setupBox().getByRole('link', { name: 'Invite staff' }).className).not.toContain('c-btn-p');
    // The trainers are listed under it as before.
    expect(screen.getAllByTestId('pt-trainer')).toHaveLength(1);
    expect(screen.queryByTestId('pt-no-trainers')).toBeNull();
  });

  it("a trainer's name opens their week, as See week does, and brings it into view (Kd's click-through)", async () => {
    const anaSetUp = { ...ana, offers: true, sessionMinutes: 30, hours: [{ weekday: 2, fromMinute: 600, toMinute: 720 }] };
    api.getPtTrainers.mockResolvedValue({ data: trainers({ trainers: [anaSetUp, owner, sam] }) });
    const had = Element.prototype.scrollIntoView;
    const into = vi.fn();
    Element.prototype.scrollIntoView = into;
    try {
      open();
      await friday();
      const names = screen.getAllByTestId('pt-trainer-name');
      expect(names.map((b) => b.textContent)).toEqual(['Ana Diaz', 'Sam Reed']);
      expect(names.every((b) => b.tagName === 'BUTTON')).toBe(true);
      // Ana's week is the one shown first; Sam's name asks for his.
      api.getPtWeek.mockClear();
      fireEvent.click(names[1]);
      await waitFor(() => expect(api.getPtWeek).toHaveBeenCalledWith('g1', SAM, null));
      expect(await screen.findByRole('heading', { name: /^Sam Reed · / })).toBeTruthy();
      const week = screen.getByLabelText('Sessions');
      await waitFor(() => expect(into.mock.instances.some((el) => el === week)).toBe(true));
      // See week does the same for the other trainer.
      into.mockClear();
      fireEvent.click(screen.getByRole('button', { name: "See Ana Diaz's week" }));
      await waitFor(() => expect(api.getPtWeek).toHaveBeenLastCalledWith('g1', ANA, null));
      await waitFor(() => expect(into.mock.instances.some((el) => el === screen.getByLabelText('Sessions'))).toBe(true));
    } finally {
      Element.prototype.scrollIntoView = had;
    }
  });

  it('with every step done there is no list, and none where the server sent no steps', async () => {
    open();
    await friday();
    expect(screen.queryByTestId('pt-setup')).toBeNull();
    cleanup();
    api.getPtTrainers.mockResolvedValue({ data: trainers({ setup: undefined, trainers: [ana, owner] }) });
    open();
    expect((await screen.findByTestId('pt-no-trainers')).textContent).toBe('No trainers yet.');
    expect(screen.queryByTestId('pt-setup')).toBeNull();
  });

  it('a booking reads the steps again, so the last tick lands without a reload', async () => {
    api.getPtTrainers.mockResolvedValue({ data: trainers({ setup: { ...ALL_DONE, sessionBooked: false } }) });
    api.bookPt.mockResolvedValue({ data: { appointment: mayaSession() } });
    open();
    const day = await friday();
    expect(screen.getByTestId('pt-setup-count').textContent).toBe('3 of 4 done');
    expect(api.getPtTrainers).toHaveBeenCalledTimes(1);
    fireEvent.click(day.getByRole('button', { name: 'Book 11:00 – 12:00' }));
    const box = within(await screen.findByTestId('pt-book-box'));
    fireEvent.click(await box.findByRole('button', { name: 'Pick Maya Lopez' }));
    api.getPtTrainers.mockResolvedValue({ data: trainers() });
    fireEvent.click(box.getByRole('button', { name: 'Book session' }));
    await waitFor(() => expect(screen.queryByTestId('pt-setup')).toBeNull());
    expect(api.getPtTrainers).toHaveBeenCalledTimes(2);
  });

  it('with the steps done, a booking reads the trainers no second time', async () => {
    api.bookPt.mockResolvedValue({ data: { appointment: mayaSession() } });
    open();
    fireEvent.click((await friday()).getByRole('button', { name: 'Book 11:00 – 12:00' }));
    const box = within(await screen.findByTestId('pt-book-box'));
    fireEvent.click(await box.findByRole('button', { name: 'Pick Maya Lopez' }));
    fireEvent.click(box.getByRole('button', { name: 'Book session' }));
    await waitFor(() => expect(api.getPtWeek).toHaveBeenCalledTimes(2));
    expect(api.getPtTrainers).toHaveBeenCalledTimes(1);
  });

  it('staff who cannot open a place get no button to it, and are told who can', async () => {
    // Somebody given the timetable alone: no Staff tab, no Memberships page.
    ORG = { ...ORG, privileges: ['schedule.manage', 'members.read'] };
    api.getPtTrainers.mockResolvedValue({ data: trainers({ setup: NOT_DONE, trainers: [ana, owner] }) });
    open();
    await screen.findByTestId('pt-setup');
    expect(setupBox().getAllByRole('link').map((a) => a.textContent)).toEqual(['Open Members']);
    expect(stepText('trainer')).toContain('The owner can invite somebody who is not on your staff yet.');
    expect(stepText('type')).toContain('Ask the owner to tick "Includes personal training" on a membership or pack you sell.');
    expect(screen.getByTestId('pt-setup').textContent).not.toContain('On Memberships');
    // With no button on the first step, the next button down is not painted as the next step.
    expect(setupBox().getByRole('link', { name: 'Open Members' }).className).not.toContain('c-btn-p');
    expect(screen.queryByRole('link', { name: 'Invite staff' })).toBeNull();
  });

  it('a gym with no live plan has Invite staff greyed, and the pages still open', async () => {
    ORG = { ...ORG, consoleReadOnly: true };
    api.getPtTrainers.mockResolvedValue({ data: trainers({ setup: NOT_DONE, trainers: [ana, owner] }) });
    open();
    await screen.findByTestId('pt-setup');
    expect(setupBox().getByRole('button', { name: 'Invite staff' }).disabled).toBe(true);
    expect(setupBox().queryByRole('link', { name: 'Invite staff' })).toBeNull();
    expect(hrefOf('Open Memberships')).toBe('/console/iron-house/memberships');
  });

  it("a studio's steps name its own page", async () => {
    ORG = { ...ORG, orgType: 'studio' };
    api.getPtTrainers.mockResolvedValue({ data: trainers({ setup: { ...NOT_DONE, typeIncludesPt: true } }) });
    open();
    await screen.findByTestId('pt-setup');
    expect(stepText('held')).toContain('3. Give it to a client · Not done yet');
    expect(hrefOf('Open Clients')).toBe('/console/iron-house/members');
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
    expect(day.getByText('Coaching a class, so not available')).toBeTruthy();
    expect(day.getByRole('button', { name: 'Book 11:00 AM – 12:00 PM' })).toBeTruthy();
    // The session booked from 10:00 runs into the class given to the trainer afterwards, and says so.
    expect(day.getByText('This runs into Spin, a class they coach at the same time. Move one of them.')).toBeTruthy();
    const saturday = within(screen.getAllByTestId('pt-day')[3]);
    expect(saturday.getByText('6:00 PM – 7:00 PM · Yoga')).toBeTruthy();
    expect(saturday.getByText('No available times')).toBeTruthy();
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
    // A search that found nobody sends staff nowhere.
    expect(box.queryByRole('link')).toBeNull();
  });

  it('an empty member list says where people are added, with a button that opens it', async () => {
    api.getPtPeople.mockResolvedValue({ data: { gymHasTypes: true, people: [], more: false } });
    open();
    fireEvent.click((await friday()).getByRole('button', { name: 'Book 09:00 – 10:00' }));
    const box = within(await screen.findByTestId('pt-book-box'));
    expect(await box.findByText('Your member list is empty. Add people on Members first.')).toBeTruthy();
    const link = box.getByRole('link', { name: 'Open Members' });
    expect(link.getAttribute('href')).toBe('/console/iron-house/members');
    expect(link.getAttribute('target')).toBeNull();
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
    ORG = { ...ORG, privileges: TRAINER_CAN };
    api.getPtTrainers.mockResolvedValue({ data: trainers({ canManage: false, canBook: false, setup: null, trainers: [{ ...sam, mine: true }] }) });
  });

  it('is shown no steps, whatever arrives', async () => {
    open();
    await screen.findByRole('heading', { name: 'Your hours' });
    expect(screen.queryByTestId('pt-setup')).toBeNull();
    cleanup();
    api.getPtTrainers.mockResolvedValue({ data: trainers({ canManage: false, canBook: false, setup: NOT_DONE, trainers: [{ ...sam, mine: true }] }) });
    open();
    await screen.findByRole('heading', { name: 'Your hours' });
    expect(screen.queryByTestId('pt-setup')).toBeNull();
  });

  it('a class they coach in their own time off names who can change its coach, with no button to the Calendar', async () => {
    api.getPtWeek.mockResolvedValue({
      data: week([], {
        days: week().days.map((day) => ({
          ...day,
          free: [],
          appointments: [],
          classes: day.localDate === '2026-10-09' ? [{ name: 'Spin', localStartMinute: 720, minutes: 45 }] : [],
          timeOff: day.localDate === '2026-10-09' ? [{ id: 'off-1', fromMinute: null, toMinute: null }] : [],
        })),
      }),
    });
    open();
    const day = await friday();
    expect(day.getByTestId('pt-coaching').textContent).toContain('In their time off. Whoever runs the timetable can give this class another coach.');
    expect(day.queryByRole('link')).toBeNull();
  });

  it('sees their own hours and week, the free times as plain times with why, and no Book; their own session can be cancelled', async () => {
    open();
    expect(await screen.findByRole('heading', { name: 'Your hours' })).toBeTruthy();
    expect(screen.getByText('One-to-one sessions. Set when you are available; the sessions booked with you appear below.')).toBeTruthy();
    expect(screen.getByText('These hours repeat every week. A class you coach is taken off your available times by itself.')).toBeTruthy();
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

  it('a late cancel on a session somebody already gave back is not shown as done either', async () => {
    api.getPtWeek.mockResolvedValue({ data: week([mayaSession({ cancel: 'late' })]) });
    api.cancelPt.mockRejectedValue({
      response: { status: 409, data: { error: 'not_kept', message: 'This session was already cancelled, and not as a late cancel. No session was used.' } },
    });
    open();
    const day = await friday();
    fireEvent.click(day.getByRole('button', { name: "Cancel Maya Lopez's session" }));
    fireEvent.click(day.getByRole('button', { name: 'Late cancel: the session stays used' }));
    expect((await day.findByRole('alert')).textContent).toBe('This session was already cancelled, and not as a late cancel. No session was used.');
    expect(day.queryByRole('button', { name: 'Late cancel: the session stays used' })).toBeNull();
    expect(api.getPtWeek).toHaveBeenCalledTimes(1);
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

// 17e-iii-b
describe("a trainer's time off", () => {
  const OFF = '55555555-5555-4555-8555-000000000001';
  const CLASS = '44444444-4444-4444-8444-000000000001';
  const fridayOff = { id: OFF, fromDate: '2026-10-09', toDate: '2026-10-09', fromMinute: null, toMinute: null };
  const withOff = (list) => trainers({ trainers: [ana, owner, { ...sam, timeOff: list }] });
  const over = {
    mark: 'b'.repeat(64),
    sessions: { count: 1, shown: [{ id: SESSION, name: 'Maya Lopez', localDate: '2026-10-09', localStartMinute: 600, minutes: 60 }] },
    classes: { count: 1, shown: [{ id: CLASS, name: 'Spin', localDate: '2026-10-09', localStartMinute: 630, minutes: 45 }] },
    classesUpTo: '2026-12-01',
  };
  const asks = () => Object.assign(new Error('409'), { response: { status: 409, data: { error: 'time_off_over_bookings', message: 'x', over } } });
  const panel = () => within(screen.getByTestId('pt-time-off'));
  // Days are pressed on the calendar, by the name each day's button reads ("Fri 9 Oct 2026").
  const pickDay = (box, day) => {
    fireEvent.click(panel().getByRole('button', { name: box }));
    fireEvent.click(panel().getByRole('button', { name: day }));
  };
  const pickDays = (first, last, box = 'First day') => {
    pickDay(box, first);
    if (last !== undefined) pickDay('Last day', last);
  };

  // The gym's today is read from the clock: Wednesday 7 October 2026.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T09:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('Time off on a trainer opens their time off; whole days are sent as picked, once, and then listed on the panel and their row', async () => {
    api.addPtTimeOff.mockResolvedValue({ data: withOff([{ ...fridayOff, toDate: '2026-10-12' }]) });
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Time off for Sam Reed' }));
    expect(panel().getByRole('heading', { name: 'Time off for Sam Reed' })).toBeTruthy();
    expect(panel().getByText('A holiday, a day away or a few hours. No session can be booked in it. The weekly hours stay as they are.')).toBeTruthy();
    expect(panel().getByText('No time off coming.')).toBeTruthy();
    // Nothing is picked: the button waits, and the form does not scold an untouched box.
    expect(panel().getByRole('button', { name: 'Add time off' }).disabled).toBe(true);
    expect(panel().queryByText('Pick the first and the last day.')).toBeNull();
    // Nothing is typed: there is no date box to type in, only the two calendars.
    expect(screen.getByTestId('pt-time-off').querySelector('input')).toBeNull();
    expect(panel().getByRole('button', { name: 'First day' }).textContent).toBe('Pick a date');
    // Days before today cannot be pressed.
    fireEvent.click(panel().getByRole('button', { name: 'First day' }));
    expect(panel().getByRole('button', { name: 'Tue 6 Oct 2026' }).disabled).toBe(true);
    fireEvent.click(panel().getByRole('button', { name: 'Fri 9 Oct 2026' }));
    // The last day follows the first until it is picked.
    expect(panel().getByRole('button', { name: 'First day' }).textContent).toBe('Fri 9 Oct 2026');
    expect(panel().getByRole('button', { name: 'Last day' }).textContent).toBe('Fri 9 Oct 2026');
    expect(panel().getByRole('button', { name: 'Add time off' }).disabled).toBe(false);
    // The last day's calendar starts at the first day.
    fireEvent.click(panel().getByRole('button', { name: 'Last day' }));
    expect(panel().getByRole('button', { name: 'Thu 8 Oct 2026' }).disabled).toBe(true);
    fireEvent.click(panel().getByRole('button', { name: 'Mon 12 Oct 2026' }));
    fireEvent.click(panel().getByRole('button', { name: 'Add time off' }));
    await waitFor(() => expect(api.addPtTimeOff).toHaveBeenCalledTimes(1));
    const [gym, who, body] = api.addPtTimeOff.mock.calls[0];
    expect([gym, who]).toEqual(['g1', SAM]);
    expect(body).toEqual({ requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/), fromDate: '2026-10-09', toDate: '2026-10-12', fromMinute: null, toMinute: null });
    expect(await panel().findByText('Fri 9 Oct – Mon 12 Oct · all day')).toBeTruthy();
    expect(screen.getByTestId('pt-trainer').textContent).toContain('Time off: Fri 9 Oct – Mon 12 Oct · all day');
    // The week is read again, and the form is empty for the next one.
    await waitFor(() => expect(api.getPtWeek.mock.calls.length).toBeGreaterThan(1));
    expect(panel().getByRole('button', { name: 'Add time off' }).disabled).toBe(true);
  });

  it('part of one day sends that day and its times', async () => {
    api.addPtTimeOff.mockResolvedValue({ data: withOff([{ ...fridayOff, fromMinute: 540, toMinute: 720 }]) });
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Time off for Sam Reed' }));
    fireEvent.click(panel().getByRole('button', { name: 'Part of one day' }));
    pickDays('Fri 9 Oct 2026', undefined, 'Day');
    expect(panel().getByText('Pick a start and an end time.')).toBeTruthy();
    const pick = (label, hour, minute) => {
      fireEvent.change(panel().getByLabelText(`${label} hour`), { target: { value: hour } });
      fireEvent.change(panel().getByLabelText(`${label} minute`), { target: { value: minute } });
    };
    pick('Time off from', '9', '0');
    pick('Time off to', '12', '0');
    fireEvent.click(panel().getByRole('button', { name: 'Add time off' }));
    await waitFor(() => expect(api.addPtTimeOff).toHaveBeenCalledTimes(1));
    expect(api.addPtTimeOff.mock.calls[0][2]).toMatchObject({ fromDate: '2026-10-09', toDate: '2026-10-09', fromMinute: 540, toMinute: 720 });
    expect(await panel().findByText('Fri 9 Oct · 09:00 – 12:00')).toBeTruthy();
  });

  it('sessions and classes already in it are named before anything is added; Add time off anyway sends the same request with their mark', async () => {
    api.addPtTimeOff.mockRejectedValueOnce(asks()).mockResolvedValueOnce({ data: withOff([fridayOff]) });
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Time off for Sam Reed' }));
    pickDays('Fri 9 Oct 2026');
    fireEvent.click(panel().getByRole('button', { name: 'Add time off' }));
    const box = within(await screen.findByTestId('pt-time-off-box'));
    expect(box.getByText('Sam Reed has 1 session booked and coaches 1 class in this time')).toBeTruthy();
    expect(box.getByText('Maya Lopez')).toBeTruthy();
    expect(box.getByText('Fri 9 Oct · 10:00 – 11:00')).toBeTruthy();
    expect(box.getByText('Spin')).toBeTruthy();
    expect(box.getByText('Fri 9 Oct · 10:30 – 11:15')).toBeTruthy();
    expect(box.getByText(/This session stays booked: nobody is cancelled and nothing comes off or goes back on a pack\./)).toBeTruthy();
    expect(box.getByText(/This class stays on the calendar with Sam Reed as coach\. To change the coach, open the class on the Calendar\./)).toBeTruthy();
    // The Calendar opens on that class's week, in this tab. It leaves the time off being
    // added, so the press asks first; Stay here changes nothing.
    expect(box.queryByRole('link')).toBeNull();
    fireEvent.click(box.getByRole('button', { name: 'Open the Calendar' }));
    expect(box.getByText("You'll leave this page, and what you typed here won't be saved.")).toBeTruthy();
    const leave = box.getByRole('link', { name: 'Leave this page' });
    expect(leave.getAttribute('href')).toBe('/console/iron-house/classes?view=week&week=2026-10-09');
    expect(leave.getAttribute('target')).toBeNull();
    fireEvent.click(box.getByRole('button', { name: 'Stay here' }));
    expect(box.queryByRole('link')).toBeNull();
    expect(box.getByRole('button', { name: 'Open the Calendar' })).toBeTruthy();
    expect(box.getByText("The app doesn't tell them yet. Let them know yourself.")).toBeTruthy();
    // The plain Add is gone while the box asks.
    expect(panel().queryByRole('button', { name: 'Add time off' })).toBeNull();
    expect(panel().getByText('No time off coming.')).toBeTruthy();

    fireEvent.click(box.getByRole('button', { name: 'Add time off anyway' }));
    await waitFor(() => expect(api.addPtTimeOff).toHaveBeenCalledTimes(2));
    const [first, second] = api.addPtTimeOff.mock.calls.map((call) => call[2]);
    expect(first.confirm).toBeUndefined();
    expect(second).toEqual({ ...first, confirm: 'b'.repeat(64) });
    expect(await panel().findByText('Fri 9 Oct · all day')).toBeTruthy();
    expect(screen.queryByTestId('pt-time-off-box')).toBeNull();
  });

  it('Go back, or a change to the days, takes the box away and adds nothing', async () => {
    api.addPtTimeOff.mockRejectedValue(asks());
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Time off for Sam Reed' }));
    pickDays('Fri 9 Oct 2026');
    fireEvent.click(panel().getByRole('button', { name: 'Add time off' }));
    fireEvent.click(within(await screen.findByTestId('pt-time-off-box')).getByRole('button', { name: 'Go back' }));
    expect(screen.queryByTestId('pt-time-off-box')).toBeNull();
    fireEvent.click(panel().getByRole('button', { name: 'Add time off' }));
    await screen.findByTestId('pt-time-off-box');
    pickDays('Sat 10 Oct 2026');
    expect(screen.queryByTestId('pt-time-off-box')).toBeNull();
    expect(api.addPtTimeOff).toHaveBeenCalledTimes(2);
    expect(api.addPtTimeOff.mock.calls.every((call) => call[2].confirm === undefined)).toBe(true);
  });

  it('a refusal in the server’s words is shown, and the form stays as it was', async () => {
    api.addPtTimeOff.mockRejectedValue(Object.assign(new Error('409'), { response: { status: 409, data: { error: 'time_off_ended', message: 'That time has already passed.' } } }));
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Time off for Sam Reed' }));
    pickDays('Wed 7 Oct 2026');
    fireEvent.click(panel().getByRole('button', { name: 'Add time off' }));
    expect((await panel().findByRole('alert')).textContent).toBe('That time has already passed.');
    expect(panel().getByRole('button', { name: 'First day' }).value).toBe('2026-10-07');
  });

  it('Remove asks first, naming the time off, and Keep it removes nothing', async () => {
    api.getPtTrainers.mockResolvedValue({ data: withOff([fridayOff]) });
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Time off for Sam Reed' }));
    fireEvent.click(panel().getByRole('button', { name: 'Remove time off Fri 9 Oct · all day' }));
    const box = within(panel().getByRole('group', { name: 'Remove this time off' }));
    expect(box.getByText("Remove Sam Reed's time off on Fri 9 Oct · all day?")).toBeTruthy();
    expect(box.getByText("These times go back to Sam Reed's usual hours, so sessions can be booked in them again. Nothing that is booked changes.")).toBeTruthy();
    expect(api.removePtTimeOff).not.toHaveBeenCalled();
    fireEvent.click(box.getByRole('button', { name: 'Keep it' }));
    expect(panel().queryByRole('group', { name: 'Remove this time off' })).toBeNull();
    expect(panel().getByText('Fri 9 Oct · all day')).toBeTruthy();
    expect(api.removePtTimeOff).not.toHaveBeenCalled();
  });

  it('removing one of two times off that overlap does not say the times can be booked again', async () => {
    api.getPtTrainers.mockResolvedValue({ data: withOff([fridayOff, { id: 'o-hour', fromDate: '2026-10-09', toDate: '2026-10-09', fromMinute: 600, toMinute: 660 }]) });
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Time off for Sam Reed' }));
    fireEvent.click(panel().getByRole('button', { name: 'Remove time off Fri 9 Oct · 10:00 – 11:00' }));
    const box = within(panel().getByRole('group', { name: 'Remove this time off' }));
    expect(box.getByText('Sam Reed has other time off in these times, and that stays. Nothing that is booked changes.')).toBeTruthy();
    expect(box.queryByText(/can be booked in them again/)).toBeNull();
  });

  it('a request the server says it has seen before gets a new key, and the list is read again', async () => {
    const reused = Object.assign(new Error('409'), { response: { status: 409, data: { error: 'request_reused', message: "That didn't go through. Try again." } } });
    api.addPtTimeOff.mockRejectedValueOnce(reused).mockResolvedValueOnce({ data: withOff([fridayOff]) });
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Time off for Sam Reed' }));
    const reads = api.getPtTrainers.mock.calls.length;
    pickDays('Fri 9 Oct 2026');
    fireEvent.click(panel().getByRole('button', { name: 'Add time off' }));
    expect((await panel().findByRole('alert')).textContent).toBe("That didn't go through. The list above is up to date now: check it before you add this again.");
    await waitFor(() => expect(api.getPtTrainers.mock.calls.length).toBe(reads + 1));
    fireEvent.click(panel().getByRole('button', { name: 'Add time off' }));
    await waitFor(() => expect(api.addPtTimeOff).toHaveBeenCalledTimes(2));
    const [first, second] = api.addPtTimeOff.mock.calls.map((call) => call[2].requestKey);
    expect(second).not.toBe(first);
  });

  it('a trainer who cannot book is told to ask a manager, in the box and on the session', async () => {
    api.getPtTrainers.mockResolvedValue({ data: trainers({ canManage: false, canBook: false, trainers: [{ ...sam, mine: true, timeOff: [] }] }) });
    api.getPtWeek.mockResolvedValue({
      data: week([mayaSession()], { days: week().days.map((day) => ({ ...day, timeOff: day.localDate === '2026-10-09' ? [{ id: OFF, fromMinute: null, toMinute: null }] : [] })) }),
    });
    api.addPtTimeOff.mockRejectedValue(asks());
    open();
    expect((await friday()).getByTestId('pt-session').textContent).toContain('Cancel it and ask a manager to book another time, or remove the time off.');
    fireEvent.click(screen.getByRole('button', { name: 'Time off' }));
    pickDays('Fri 9 Oct 2026');
    fireEvent.click(panel().getByRole('button', { name: 'Add time off' }));
    const box = within(await screen.findByTestId('pt-time-off-box'));
    expect(box.getByText(/To move one, cancel it on this page and ask a manager to book another time\./)).toBeTruthy();
    expect(box.queryByText(/and book another time\./)).toBeNull();
  });

  it('Remove takes one time off away, by its own name', async () => {
    api.getPtTrainers.mockResolvedValue({ data: withOff([fridayOff, { id: 'o-2', fromDate: '2026-10-12', toDate: '2026-10-16', fromMinute: null, toMinute: null }]) });
    api.removePtTimeOff.mockResolvedValue({ data: withOff([fridayOff]) });
    open();
    expect((await screen.findByTestId('pt-trainer')).textContent).toContain('Time off: Fri 9 Oct · all day, and 1 more');
    fireEvent.click(screen.getByRole('button', { name: 'Time off for Sam Reed' }));
    fireEvent.click(panel().getByRole('button', { name: 'Remove time off Mon 12 Oct – Fri 16 Oct · all day' }));
    // The box is under its own row, and the other time off keeps its Remove.
    expect(panel().getByText("Remove Sam Reed's time off on Mon 12 Oct – Fri 16 Oct · all day?")).toBeTruthy();
    expect(panel().getByRole('button', { name: 'Remove time off Fri 9 Oct · all day' })).toBeTruthy();
    fireEvent.click(panel().getByRole('button', { name: 'Remove time off' }));
    await waitFor(() => expect(api.removePtTimeOff).toHaveBeenCalledWith('g1', SAM, 'o-2'));
    await waitFor(() => expect(panel().queryByText('Mon 12 Oct – Fri 16 Oct · all day')).toBeNull());
    expect(panel().getByText('Fri 9 Oct · all day')).toBeTruthy();
  });

  it('the week marks the day off, and a session or a class left in it says so', async () => {
    api.getPtWeek.mockResolvedValue({
      data: week([mayaSession()], {
        days: week().days.map((day) => ({
          ...day,
          free: [],
          classes: day.localDate === '2026-10-09' ? [{ name: 'Spin', localStartMinute: 720, minutes: 45 }] : [],
          timeOff: day.localDate === '2026-10-09' || day.localDate === '2026-10-10' ? [{ id: OFF, fromMinute: null, toMinute: null }] : [],
        })),
      }),
    });
    open();
    const day = await friday();
    expect(day.getByTestId('pt-day-off').textContent).toBe('Time off · all day');
    expect(day.getByTestId('pt-session').textContent).toContain('This is in their time off. Cancel it and book another time, or remove the time off.');
    expect(day.getByTestId('pt-coaching').textContent).toContain('In their time off. Give this class another coach on the Calendar.');
    expect(within(day.getByTestId('pt-coaching')).getByRole('link', { name: 'Open the Calendar' }).getAttribute('href')).toBe(
      '/console/iron-house/classes?view=week&week=2026-10-09',
    );
    // A day with nothing else on it says it is off, not only that nothing is free.
    const days = screen.getAllByTestId('pt-day');
    expect(days[3].textContent).toBe('Sat 10 OctTime off · all day');
    expect(days[4].textContent).toBe('Sun 11 OctNo available times');
  });

  it('a trainer who runs no timetable has Time off for themselves', async () => {
    api.getPtTrainers.mockResolvedValue({ data: trainers({ canManage: false, canBook: false, trainers: [{ ...sam, mine: true, timeOff: [fridayOff] }] }) });
    open();
    expect(await screen.findByText('Time off: Fri 9 Oct · all day')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Time off' }));
    expect(panel().getByRole('heading', { name: 'Time off for Sam Reed (you)' })).toBeTruthy();
    expect(panel().getByRole('button', { name: 'Remove time off Fri 9 Oct · all day' })).toBeTruthy();
  });

  it('a gym that can only read sees the time off and can change none of it', async () => {
    ORG = { ...ORG, consoleReadOnly: true };
    api.getPtTrainers.mockResolvedValue({ data: withOff([fridayOff]) });
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Time off for Sam Reed' }));
    expect(panel().getByText('Fri 9 Oct · all day')).toBeTruthy();
    expect(panel().queryByRole('button', { name: /Remove time off/ })).toBeNull();
    expect(panel().queryByRole('button', { name: 'Add time off' })).toBeNull();
    expect(panel().getByRole('button', { name: 'Close' })).toBeTruthy();
  });
});
