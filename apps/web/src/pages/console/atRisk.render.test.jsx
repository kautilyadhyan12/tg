// THE AT RISK PAGE, drawn (ROADMAP 20d-i; spec Part 3 §16.4). Only the network is mocked:
// what staff see is read off the real page.
//
// The worst thing the screen could do: offer a message to somebody it cannot go to, say
// "nobody has stopped coming" at a gym that checks nobody in, or ask for the list for
// somebody the server would refuse.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const svc = { list: vi.fn(), saveSettings: vi.fn(), sendMessage: vi.fn() };
const orgApi = { getMine: vi.fn(), getMemberList: vi.fn() };
vi.mock('../../api/atRiskApi', () => ({ atRiskService: svc }));
vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: orgApi };
});
vi.mock('./MemberListPerson', () => ({
  default: ({ entryId, onClose }) => (
    <div role="dialog" aria-label={`person ${entryId}`}>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

const AtRisk = (await import('./AtRisk')).default;
const { resetConsoleOrgs } = await import('./consoleOrgs');

const ORG = {
  id: 'g1',
  slug: 'iron-house',
  name: 'Iron House',
  staffRole: 'owner',
  privileges: ['members.read', 'members.confirm', 'attendance.read', 'org.manage'],
  timezone: 'Europe/London',
  orgType: 'gym',
  subscription: { status: 'trialing', trialEndsAt: '2099-01-01T00:00:00.000Z' },
};
const TRAINER = { ...ORG, staffRole: 'trainer', privileges: ['members.read'] };

const person = (over = {}) => ({
  entryId: 'e-stan',
  userId: 'u-stan',
  app: 'one',
  name: 'Stan Stopped',
  lastVisitOn: '2026-09-22',
  daysAway: 20,
  weeksCame: 3,
  lastMessage: null,
  messageableAt: null,
  ...over,
});
const PAT = person({ entryId: 'e-pat', userId: null, app: 'none', name: 'Pat Paper', weeksCame: 2 });
const HAL = person({ entryId: 'e-hal', userId: null, app: 'shared', name: 'Hal Household' });
const answer = (over = {}) => ({
  settings: { quietDays: 14, weeksCame: 2 },
  today: '2026-10-12',
  checkin: 'in_use',
  firstCheckinOn: '2026-06-01',
  lastCheckinOn: '2026-10-12',
  total: 3,
  people: [person(), PAT, HAL],
  ...over,
});

const open = (org = ORG) => {
  orgApi.getMine.mockResolvedValue({ data: { orgs: [org], formerOrgs: [] } });
  render(
    <MemoryRouter initialEntries={['/console/iron-house/at-risk']}>
      <Routes>
        <Route path="/console/:orgSlug/at-risk" element={<AtRisk />} />
        <Route path="/console/:orgSlug/attendance" element={<p>The Attendance page</p>} />
      </Routes>
    </MemoryRouter>,
  );
};
const rows = () => screen.getAllByTestId('at-risk-row');
const row = (name) => rows().find((r) => r.textContent.includes(name));

beforeEach(() => {
  resetConsoleOrgs();
  svc.list.mockResolvedValue(answer());
  orgApi.getMemberList.mockResolvedValue({ data: { list: null } });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('the list', () => {
  it('says what puts somebody on it, how many there are, and each person’s two facts', async () => {
    open();
    await screen.findByTestId('at-risk-headline');
    expect(svc.list).toHaveBeenCalledTimes(1);
    expect(svc.list).toHaveBeenCalledWith('g1');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('At risk');
    expect(screen.getByText('Members who used to come and have stopped: no check-in for 14 days or more, after coming in at least 2 of their last 4 weeks.')).toBeTruthy();
    expect(screen.getByTestId('at-risk-headline').textContent).toBe('3 members have stopped coming.');
    expect(rows().length).toBe(3);
    expect(row('Stan Stopped').textContent).toContain('Last check-in 22 Sep, 20 days ago');
    expect(row('Stan Stopped').textContent).toContain('Came in 3 of their last 4 weeks');
  });

  it('only somebody a message can reach has the button; the others say why, with a button to their page', async () => {
    open();
    await screen.findByTestId('at-risk-headline');
    expect(within(row('Stan Stopped')).getByRole('button', { name: 'Send a message' })).toBeTruthy();
    for (const name of ['Pat Paper', 'Hal Household']) {
      expect(within(row(name)).queryByRole('button', { name: 'Send a message' })).toBeNull();
      expect(within(row(name)).getByRole('button', { name: 'Open their page' })).toBeTruthy();
    }
    expect(row('Pat Paper').textContent).toContain("Not in the app, so Pat can't be messaged here.");
    expect(row('Hal Household').textContent).toContain('Two people use this record in the app');

    fireEvent.click(within(row('Pat Paper')).getByRole('button', { name: 'Open their page' }));
    expect(screen.getByRole('dialog', { name: 'person e-pat' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: "Open Stan Stopped's page" }));
    expect(screen.getByRole('dialog', { name: 'person e-stan' })).toBeTruthy();
  });

  it('shows 25 at a time, and says when the server cut the list short', async () => {
    const people = Array.from({ length: 60 }, (_, i) => person({ entryId: `e${String(i)}`, userId: `u${String(i)}`, name: `Person ${String(i)}` }));
    svc.list.mockResolvedValue(answer({ total: 312, people }));
    open();
    await screen.findByTestId('at-risk-headline');
    expect(rows().length).toBe(25);
    fireEvent.click(screen.getByRole('button', { name: 'Show 25 more' }));
    expect(rows().length).toBe(50);
    fireEvent.click(screen.getByRole('button', { name: 'Show 10 more' }));
    expect(rows().length).toBe(60);
    expect(screen.getByText('Showing the first 60 of 312, the most regular first.')).toBeTruthy();
  });

  it('nobody at risk is a whole sentence, never an empty box', async () => {
    svc.list.mockResolvedValue(answer({ total: 0, people: [] }));
    open();
    expect((await screen.findByTestId('at-risk-headline')).textContent).toBe('Nobody has stopped coming. Every member who was coming regularly has checked in within the last 14 days.');
    expect(screen.queryAllByTestId('at-risk-row').length).toBe(0);
  });
});

describe('sending a come-back message', () => {
  it('the box opens under the person, sends the line picked to that person, and says so in the same place', async () => {
    svc.sendMessage.mockResolvedValue({ preset: 'door_open', sentAt: '2026-10-12T10:00:00.000Z' });
    open();
    await screen.findByTestId('at-risk-headline');
    const stan = row('Stan Stopped');
    fireEvent.click(within(stan).getByRole('button', { name: 'Send a message' }));
    const box = within(stan).getByRole('group', { name: 'Message to Stan Stopped' });
    expect(box.textContent).toContain("Pick one message for Stan. They see it at the top of their Inbox in the app for 7 days. They can't reply to it.");
    expect(within(box).getAllByRole('radio').length).toBe(4);
    expect(svc.sendMessage).not.toHaveBeenCalled();

    fireEvent.click(within(box).getByRole('radio', { name: "The door's always open when you're ready." }));
    svc.list.mockResolvedValue(
      answer({ people: [person({ lastMessage: { preset: 'door_open', sentAt: '2026-10-12T10:00:00.000Z' }, messageableAt: '2099-10-19T10:00:00.000Z' }), PAT, HAL] }),
    );
    fireEvent.click(within(box).getByRole('button', { name: 'Send to Stan' }));
    await waitFor(() => expect(within(row('Stan Stopped')).getByRole('status').textContent).toBe("Sent to Stan: “The door's always open when you're ready.”"));
    expect(svc.sendMessage).toHaveBeenCalledTimes(1);
    expect(svc.sendMessage).toHaveBeenCalledWith('g1', 'u-stan', 'door_open');
    // The box is gone and so is the button: a second cannot be sent.
    await waitFor(() => expect(svc.list).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(row('Stan Stopped')).queryByRole('button', { name: 'Send a message' })).toBeNull());
    expect(within(row('Stan Stopped')).queryByRole('group')).toBeNull();
  });

  it('Cancel sends nothing and leaves the row as it was', async () => {
    open();
    await screen.findByTestId('at-risk-headline');
    fireEvent.click(within(row('Stan Stopped')).getByRole('button', { name: 'Send a message' }));
    fireEvent.click(within(row('Stan Stopped')).getByRole('button', { name: 'Cancel' }));
    expect(svc.sendMessage).not.toHaveBeenCalled();
    expect(within(row('Stan Stopped')).getByRole('button', { name: 'Send a message' })).toBeTruthy();
  });

  it('a message that would not go says why in the row, and the box stays open', async () => {
    svc.sendMessage.mockRejectedValue({ response: { status: 409, data: { message: 'This member has already been sent a message in the last 7 days.' } } });
    open();
    await screen.findByTestId('at-risk-headline');
    fireEvent.click(within(row('Stan Stopped')).getByRole('button', { name: 'Send a message' }));
    fireEvent.click(within(row('Stan Stopped')).getByRole('button', { name: 'Send to Stan' }));
    expect((await within(row('Stan Stopped')).findByRole('alert')).textContent).toBe('This member has already been sent a message in the last 7 days.');
  });

  it('a message already sent is said on the row, with the day another may go', async () => {
    svc.list.mockResolvedValue(
      answer({ people: [person({ lastMessage: { preset: 'miss_you', sentAt: '2026-10-10T09:00:00.000Z' }, messageableAt: '2099-10-17T09:00:00.000Z' })], total: 1 }),
    );
    open();
    await screen.findByTestId('at-risk-headline');
    expect(row('Stan Stopped').textContent).toContain('Sent “We miss you — hope to see you soon.” on 10 Oct. You can send another from 17 Oct.');
    expect(within(row('Stan Stopped')).queryByRole('button', { name: 'Send a message' })).toBeNull();
  });
});

describe('the gym’s two numbers', () => {
  it('whoever runs the gym picks and saves them, and the list is read again', async () => {
    svc.saveSettings.mockResolvedValue({ quietDays: 21, weeksCame: 2 });
    open();
    await screen.findByTestId('at-risk-headline');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('No check-in for'), { target: { value: '21' } });
    expect(save.disabled).toBe(false);
    expect(screen.getByText('Not saved yet.')).toBeTruthy();
    expect(svc.saveSettings).not.toHaveBeenCalled();

    svc.list.mockResolvedValue(answer({ settings: { quietDays: 21, weeksCame: 2 }, total: 1, people: [person({ daysAway: 25 })] }));
    fireEvent.click(save);
    await screen.findByText('Saved. The list below uses the new numbers.');
    expect(svc.saveSettings).toHaveBeenCalledWith('g1', { quietDays: 21, weeksCame: 2 });
    await waitFor(() => expect(screen.getByTestId('at-risk-headline').textContent).toBe('1 member has stopped coming.'));
    expect(screen.getByText(/no check-in for 21 days or more/)).toBeTruthy();
  });

  it('a save that fails says so and keeps what was picked', async () => {
    svc.saveSettings.mockRejectedValue({ response: { status: 500, data: {} } });
    open();
    await screen.findByTestId('at-risk-headline');
    fireEvent.change(screen.getByLabelText('After coming in at least'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe("We couldn't save that. Try again.");
    expect(screen.getByLabelText('After coming in at least').value).toBe('3');
  });

  it('staff who cannot change them have no pickers and are told who can', async () => {
    open(TRAINER);
    await screen.findByTestId('at-risk-headline');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByLabelText('No check-in for')).toBeNull();
    expect(screen.getByText('The owner can change how many days and weeks this list uses.')).toBeTruthy();
  });
});

describe('a gym that uses only part of the app', () => {
  it('nobody was ever checked in: the reason and a button to Attendance, never "nobody has stopped coming"', async () => {
    svc.list.mockResolvedValue(answer({ checkin: 'none', firstCheckinOn: null, lastCheckinOn: null, total: 0, people: [] }));
    open();
    const note = await screen.findByTestId('at-risk-checkin-note');
    expect(note.textContent).toContain('nobody has been checked in at Iron House yet');
    expect(screen.queryByTestId('at-risk-headline')).toBeNull();
    fireEvent.click(within(note).getByRole('link', { name: 'Open Attendance' }));
    expect(await screen.findByText('The Attendance page')).toBeTruthy();
  });

  it('check-in has only just begun: the day the list can start, and no list', async () => {
    svc.list.mockResolvedValue(answer({ checkin: 'new', firstCheckinOn: '2026-10-07', total: 0, people: [] }));
    open();
    expect((await screen.findByTestId('at-risk-checkin-note')).textContent).toContain('This list can show who has stopped coming from 21 Oct');
    expect(screen.queryByTestId('at-risk-headline')).toBeNull();
  });

  it('check-in has stopped: said above the list, and staff with no Attendance are told who has', async () => {
    svc.list.mockResolvedValue(answer({ checkin: 'stopped', lastCheckinOn: '2026-09-22' }));
    open(TRAINER);
    const note = await screen.findByTestId('at-risk-checkin-note');
    expect(note.textContent).toContain('The last check-in was on 22 Sep.');
    expect(within(note).queryByRole('link')).toBeNull();
    expect(note.textContent).toContain('The owner can check people in from Attendance.');
    expect(rows().length).toBe(3);
  });
});

describe('who is asked for', () => {
  it('somebody without the tick is told, and nothing is asked for them', async () => {
    open({ ...ORG, staffRole: 'trainer', privileges: ['attendance.read'] });
    expect(await screen.findByText("Your role doesn't allow you to see members. Ask the owner if you need to.")).toBeTruthy();
    expect(svc.list).not.toHaveBeenCalled();
  });

  it('a list that will not load says so, with Try again', async () => {
    svc.list.mockRejectedValueOnce({ response: { status: 500, data: {} } });
    open();
    expect(await screen.findByText("We couldn't load this list.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByTestId('at-risk-headline')).toBeTruthy();
  });
});
