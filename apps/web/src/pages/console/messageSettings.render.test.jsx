// SETTINGS → AUTOMATIC MESSAGES, drawn (ROADMAP 20b-i). Only the network is mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GYM_MESSAGE_OWN_LINE_WORDS } from '@app/shared';

const getMessageSettings = vi.fn();
const updateMessageSettings = vi.fn();
vi.mock('../../api/orgsApi', () => ({
  orgService: { getMessageSettings, updateMessageSettings },
  errorText: (err, fallback) => err?.response?.data?.message ?? fallback,
}));

const MessageSettingsPanel = (await import('../../components/console/MessageSettingsPanel')).default;
const view = await import('./messageSettingsView');

const ORG = { id: 'g1', slug: 'iron-house', name: 'Iron House', orgType: 'gym', staffRole: 'owner', privileges: ['org.manage', 'attendance.read'] };
const START = {
  messages: [
    { kind: 'welcome', on: true, ownLine: null },
    { kind: 'birthday', on: true, ownLine: null },
    { kind: 'milestone', on: true, ownLine: null },
    { kind: 'miss_you', on: true, ownLine: null },
  ],
  missYouDays: 10,
  milestones: [50, 100],
  checkIn: true,
};
const withKind = (kind, change, over = {}) => ({ ...START, ...over, messages: START.messages.map((m) => (m.kind === kind ? { ...m, ...change } : m)) });
const draw = (org = ORG, props = {}) =>
  render(
    <MemoryRouter>
      <MessageSettingsPanel org={org} readOnly={false} startOpen {...props} />
    </MemoryRouter>,
  );
const box = (name) => screen.getByRole('group', { name });
const theSwitch = (name) => screen.getByRole('switch', { name: `Send the ${name} message` });
const preview = (kind) => screen.getByTestId(`preview-${kind}`).textContent;
const line = (name) => within(box(name)).getByLabelText('Add a line of your own (optional)');
const save = () => screen.getByRole('button', { name: 'Save changes' });

beforeEach(() => {
  getMessageSettings.mockReset();
  updateMessageSettings.mockReset();
});
afterEach(cleanup);

describe('Automatic messages', () => {
  it('shows each message with its switch, when it is sent and the words a member will read, in the gym\'s name', async () => {
    getMessageSettings.mockResolvedValue({ data: START });
    draw();
    await screen.findByText('On: Welcome · Birthday · Visit milestone · We miss you');
    expect(screen.getAllByRole('switch').map((s) => [s.getAttribute('aria-label'), s.getAttribute('aria-checked')])).toEqual([
      ['Send the Welcome message', 'true'],
      ['Send the Birthday message', 'true'],
      ['Send the Visit milestone message', 'true'],
      ['Send the We miss you message', 'true'],
    ]);
    expect(preview('welcome')).toBe("Welcome to Iron House, Maya. We're glad you joined. Messages from us will show up here.");
    expect(preview('birthday')).toBe('Happy birthday, Maya! From everyone at Iron House.');
    expect(preview('milestone')).toBe("That's 50 visits to Iron House, Maya. Well done.");
    expect(preview('miss_you')).toBe("We haven't seen you at Iron House for a while, Maya. We hope to see you soon.");
    expect(within(box('Birthday')).getByText(/from the date of birth on your Members list/)).toBeTruthy();
    expect(screen.getByText(/Nobody gets more than one a day, and none is sent at night\./)).toBeTruthy();
    expect(screen.getByText(/In the examples below, Maya stands in for each member's own first name\./)).toBeTruthy();
    // The gym's numbers as kept.
    expect(within(box('Visit milestone')).getAllByRole('checkbox').map((c) => c.checked)).toEqual([false, false, true, true, false, false, false]);
    expect(within(box('We miss you')).getByLabelText('Days without a check-in').value).toBe('10');
    expect(save().disabled).toBe(true);
    expect(screen.queryByText(/This one counts check-ins/)).toBeNull();
  });

  it('nothing is sent to the server until Save, and Save sends every message and both numbers once', async () => {
    getMessageSettings.mockResolvedValue({ data: START });
    const after = withKind('birthday', { on: false }, { missYouDays: 14, milestones: [10, 50, 100] });
    after.messages[3] = { kind: 'miss_you', on: true, ownLine: 'Your first class back is on us.' };
    updateMessageSettings.mockResolvedValue({ data: after });
    draw();
    await screen.findByText(/^On:/);
    fireEvent.click(theSwitch('Birthday'));
    fireEvent.click(within(box('Visit milestone')).getByLabelText('10 visits'));
    fireEvent.change(within(box('We miss you')).getByLabelText('Days without a check-in'), { target: { value: '14' } });
    fireEvent.change(line('We miss you'), { target: { value: '  Your first class back is on us. ' } });
    // The words follow what is typed, before any save.
    expect(preview('miss_you')).toBe("We haven't seen you at Iron House for a while, Maya. We hope to see you soon.\nYour first class back is on us.");
    expect(preview('milestone')).toBe("That's 10 visits to Iron House, Maya. Well done.");
    expect(screen.getByText('Not saved yet.')).toBeTruthy();
    expect(updateMessageSettings).not.toHaveBeenCalled();

    fireEvent.click(save());
    await screen.findByText('Saved. It holds from the next message sent.');
    expect(updateMessageSettings).toHaveBeenCalledTimes(1);
    expect(updateMessageSettings).toHaveBeenCalledWith('g1', {
      messages: [
        { kind: 'welcome', on: true, ownLine: null },
        { kind: 'birthday', on: false, ownLine: null },
        { kind: 'milestone', on: true, ownLine: null },
        { kind: 'miss_you', on: true, ownLine: 'Your first class back is on us.' },
      ],
      missYouDays: 14,
      milestones: [10, 50, 100],
    });
    expect(screen.getByText('On: Welcome · Visit milestone · We miss you')).toBeTruthy();
    expect(theSwitch('Birthday').getAttribute('aria-checked')).toBe('false');
    expect(save().disabled).toBe(true);
  });

  it('a line with a link, an @ or too many characters is refused as typed, in the server\'s words, and cannot be saved', async () => {
    getMessageSettings.mockResolvedValue({ data: START });
    draw();
    await screen.findByText(/^On:/);
    const cases = [
      ['Book at ironhouse.com', GYM_MESSAGE_OWN_LINE_WORDS.link],
      ['Follow @ironhouse', GYM_MESSAGE_OWN_LINE_WORDS.at],
      ['x'.repeat(141), GYM_MESSAGE_OWN_LINE_WORDS.too_long],
    ];
    for (const [typed, words] of cases) {
      fireEvent.change(line('Welcome'), { target: { value: typed } });
      expect(within(box('Welcome')).getByRole('alert').textContent).toBe(words);
      expect(save().disabled).toBe(true);
    }
    fireEvent.change(line('Welcome'), { target: { value: 'Your first class is free.' } });
    expect(within(box('Welcome')).queryByRole('alert')).toBeNull();
    expect(within(box('Welcome')).getByText('25 of 140 characters. No web addresses and no @.')).toBeTruthy();
    expect(save().disabled).toBe(false);
    // Every number of visits unticked: said, and not saved.
    fireEvent.click(within(box('Visit milestone')).getByLabelText('50 visits'));
    fireEvent.click(within(box('Visit milestone')).getByLabelText('100 visits'));
    expect(within(box('Visit milestone')).getByRole('alert').textContent).toBe('Tick at least one number of visits, or switch this message off.');
    expect(save().disabled).toBe(true);
    expect(updateMessageSettings).not.toHaveBeenCalled();
  });

  it('a gym nobody is checked in at is told on the two messages that count visits, with a button to Attendance, or who can', async () => {
    getMessageSettings.mockResolvedValue({ data: { ...START, checkIn: false } });
    draw();
    await screen.findByText(/^On:/);
    const note = 'This one counts check-ins. Nobody has been checked in at your gym in the last 30 days, so nobody will get it yet.';
    for (const name of ['Visit milestone', 'We miss you']) {
      expect(within(box(name)).getByText(note)).toBeTruthy();
      // The box holds what was typed, so the button asks before it leaves.
      expect(within(box(name)).getByRole('button', { name: 'Open Attendance' })).toBeTruthy();
    }
    for (const name of ['Welcome', 'Birthday']) expect(within(box(name)).queryByText(note)).toBeNull();
    fireEvent.click(within(box('We miss you')).getByRole('button', { name: 'Open Attendance' }));
    expect(within(box('We miss you')).getByRole('link', { name: 'Leave this page' }).getAttribute('href')).toBe('/console/iron-house/attendance');

    cleanup();
    getMessageSettings.mockResolvedValue({ data: { ...START, checkIn: false } });
    draw({ ...ORG, staffRole: 'manager', privileges: ['org.manage'] });
    await screen.findByText(/^On:/);
    expect(within(box('We miss you')).getByText('Staff who can open Attendance check people in there.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open Attendance' })).toBeNull();
  });

  it("the server's refusal is shown and what was typed is kept; a load that fails offers Try again", async () => {
    getMessageSettings.mockResolvedValue({ data: START });
    updateMessageSettings.mockRejectedValue({ response: { data: { message: "We can't keep a line with this word in it: darn. Take it out and try again." } } });
    draw();
    await screen.findByText(/^On:/);
    fireEvent.change(line('Birthday'), { target: { value: 'darn good cake' } });
    fireEvent.click(save());
    await screen.findByText("We can't keep a line with this word in it: darn. Take it out and try again.");
    expect(line('Birthday').value).toBe('darn good cake');

    cleanup();
    getMessageSettings.mockRejectedValueOnce(new Error('offline'));
    getMessageSettings.mockResolvedValue({ data: START });
    draw(ORG, { startOpen: false });
    await screen.findByText("We couldn't load your automatic messages.");
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    await screen.findByText(/^On:/);
  });

  it('a gym on no plan sees everything and can change nothing; a studio reads its own words', async () => {
    getMessageSettings.mockResolvedValue({ data: withKind('welcome', { on: false }) });
    draw({ ...ORG, orgType: 'studio' }, { readOnly: true });
    await screen.findByText('On: Birthday · Visit milestone · We miss you');
    expect(screen.getAllByRole('switch').every((s) => s.disabled)).toBe(true);
    expect(line('Welcome').disabled).toBe(true);
    expect(save().disabled).toBe(true);
    expect(within(box('Welcome')).getByText('Sent when somebody joins your studio in the app, within a quarter of an hour.')).toBeTruthy();
    expect(within(box('Birthday')).getByText(/Sent on the morning of a client's birthday/)).toBeTruthy();
  });
});

describe('the box\'s own rules', () => {
  it('reads what the server holds, and says whether anything changed', () => {
    const kept = view.messageDraft(withKind('birthday', { on: false, ownLine: 'Cake at the desk' }, { missYouDays: 21, milestones: [100, 10] }));
    expect(kept).toEqual({
      on: { welcome: true, birthday: false, milestone: true, miss_you: true },
      lines: { welcome: '', birthday: 'Cake at the desk', milestone: '', miss_you: '' },
      missYouDays: 21,
      milestones: [10, 100],
    });
    expect(view.messageDraftChanged(kept, kept)).toBe(false);
    // Spaces alone are no change.
    expect(view.messageDraftChanged({ ...kept, lines: { ...kept.lines, birthday: ' Cake at the desk ' } }, kept)).toBe(false);
    expect(view.messageDraftChanged({ ...kept, missYouDays: 7 }, kept)).toBe(true);
    expect(view.messageDraftChanged({ ...kept, milestones: [10] }, kept)).toBe(true);
    expect(view.messageDraftChanged({ ...kept, on: { ...kept.on, welcome: false } }, kept)).toBe(true);
    expect(view.toggleMilestone([50, 100], 10)).toEqual([10, 50, 100]);
    expect(view.toggleMilestone([50, 100], 50)).toEqual([100]);
    expect(view.messageSettingsSummary(view.messageDraft({ ...START, messages: START.messages.map((m) => ({ ...m, on: false })) }))).toBe('All switched off');
    expect(view.messageSettingsSummary(null)).toBe('');
  });
});
