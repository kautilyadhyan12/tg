// SETTINGS → AUTOMATIC MESSAGES, drawn (ROADMAP 20b-i, 20b-ii). Only the network is mocked.
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

const ORG = { id: 'g1', slug: 'iron-house', name: 'Iron House', orgType: 'gym', staffRole: 'owner', privileges: ['org.manage', 'attendance.read', 'memberships.manage'] };
const KINDS = ['welcome', 'trial_check_in', 'trial_ending', 'membership_ending', 'payment_overdue', 'birthday', 'milestone', 'miss_you'];
const NAMES = ['Welcome', 'Trial check-in', 'Trial ending', 'Membership ending', 'Payment overdue', 'Birthday', 'Visit milestone', 'We miss you'];
const NUMBERS = { missYouDays: 10, milestones: [50, 100], trialCheckInDay: 2, trialEndingDays: 2, membershipEndingDays: 7 };
/** A gym that uses everything: check-in, a price list with a trial on it, payments. */
const START = {
  messages: KINDS.map((kind) => ({ kind, on: true, ownLine: null })),
  ...NUMBERS,
  checkIn: true,
  trialOnList: true,
  priceList: true,
  payments: true,
  billsOverdueDays: 0,
};
const loaded = () => screen.findByText(/^(All 8 on|\d of 8 on|All switched off)$/);
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
    await screen.findByText('All 8 on');
    expect(screen.getAllByRole('switch').map((s) => [s.getAttribute('aria-label'), s.getAttribute('aria-checked')])).toEqual(NAMES.map((name) => [`Send the ${name} message`, 'true']));
    expect(preview('trial_check_in')).toBe("How is your trial at Iron House going, [member's first name]? If you have any questions, just ask us.");
    expect(preview('trial_ending')).toBe("Your trial at Iron House ends on [its last day], [member's first name]. Ask us about a membership to keep coming.");
    expect(preview('membership_ending')).toBe("Your membership at Iron House ends on [its last day], [member's first name]. Ask us if you'd like to renew.");
    expect(preview('payment_overdue')).toBe("Your payment to Iron House is overdue, [member's first name]. Please speak to us to sort it out.");
    // No date and no amount of money stands in any example.
    expect(KINDS.map(preview).join(' ')).not.toMatch(/January|2026|[$£€₹]/);
    expect(within(box('Trial check-in')).getByLabelText('Day of the trial').value).toBe('2');
    expect(within(box('Trial ending')).getByLabelText('Days before a trial ends').value).toBe('2');
    expect(within(box('Membership ending')).getByLabelText('Days before a membership ends').value).toBe('7');
    expect(within(box('Payment overdue')).getByText(/the morning it reads Overdue on a member's page: the day after its due date\. Never for a bill that is paid, cancelled or refunded/)).toBeTruthy();
    expect(within(box('Payment overdue')).getByText(/No amount is shown\. A member cannot switch this one off\./)).toBeTruthy();
    expect(within(box('Membership ending')).getByText(/A membership that renews by itself has no last day\./)).toBeTruthy();
    expect(screen.getByText(/A member can switch any of them off for themselves, except Welcome and Payment overdue\./)).toBeTruthy();
    // Nothing is missing at this gym, so no row says nobody will get it.
    expect(screen.queryByText(/nobody will get (this|it) yet/)).toBeNull();
    expect(preview('welcome')).toBe("Welcome to Iron House, [member's first name]. We're glad you joined. Messages from us will show up here.");
    expect(preview('birthday')).toBe("Happy birthday, [member's first name]! From everyone at Iron House.");
    expect(preview('milestone')).toBe("You've reached 50 visits at Iron House, [member's first name]. Well done.");
    expect(preview('miss_you')).toBe("We haven't seen you at Iron House for a while, [member's first name]. We hope to see you soon.");
    expect(within(box('Birthday')).getByText(/when the date of birth is already on your Members list\. Nobody gets one for 1 January or 31 December, or for a date that makes them under 18/)).toBeTruthy();
    expect(within(box('Welcome')).getByText('Sent when somebody joins your gym in the app: within a quarter of an hour by day, and the next morning if they join at night. Not sent to your own staff.')).toBeTruthy();
    expect(within(box('We miss you')).getByText(/Somebody who stopped coming more than 30 days before that gets none\./)).toBeTruthy();
    expect(within(box('Visit milestone')).getByText(/A visit is a day the front desk or staff checked them in\./)).toBeTruthy();
    expect(screen.getByText(/Nobody gets more than one a day, and none is sent at night\./)).toBeTruthy();
    expect(screen.getByText(/Where you see \[member's first name\] below, each member reads their own first name: "Happy birthday, Priya!"/)).toBeTruthy();
    // No name of a person is in any example.
    expect(document.body.textContent).not.toContain('Maya');
    // The gym's numbers as kept.
    expect(within(box('Visit milestone')).getAllByRole('checkbox').map((c) => c.checked)).toEqual([false, false, true, true, false, false, false]);
    expect(within(box('We miss you')).getByLabelText('Days without a check-in').value).toBe('10');
    expect(save().disabled).toBe(true);
    expect(screen.queryByText(/This one counts check-ins/)).toBeNull();
  });

  it('nothing is sent to the server until Save, and Save sends every message and every number once', async () => {
    getMessageSettings.mockResolvedValue({ data: START });
    const after = withKind('birthday', { on: false }, { missYouDays: 14, milestones: [10, 50, 100] });
    after.messages[7] = { kind: 'miss_you', on: true, ownLine: 'Your first class back is on us.' };
    Object.assign(after, { trialCheckInDay: 3, trialEndingDays: 1, membershipEndingDays: 14 });
    updateMessageSettings.mockResolvedValue({ data: after });
    draw();
    await loaded();
    fireEvent.click(theSwitch('Birthday'));
    fireEvent.click(within(box('Visit milestone')).getByLabelText('10 visits'));
    fireEvent.change(within(box('We miss you')).getByLabelText('Days without a check-in'), { target: { value: '14' } });
    fireEvent.change(line('We miss you'), { target: { value: '  Your first class back is on us. ' } });
    fireEvent.change(within(box('Trial check-in')).getByLabelText('Day of the trial'), { target: { value: '3' } });
    fireEvent.change(within(box('Trial ending')).getByLabelText('Days before a trial ends'), { target: { value: '1' } });
    fireEvent.change(within(box('Membership ending')).getByLabelText('Days before a membership ends'), { target: { value: '14' } });
    // The words follow what is typed, before any save.
    expect(preview('miss_you')).toBe("We haven't seen you at Iron House for a while, [member's first name]. We hope to see you soon.\nYour first class back is on us.");
    expect(preview('milestone')).toBe("You've reached 10 visits at Iron House, [member's first name]. Well done.");
    expect(screen.getByText('Not saved yet.')).toBeTruthy();
    expect(updateMessageSettings).not.toHaveBeenCalled();

    fireEvent.click(save());
    await screen.findByText('Saved. It holds from the next message sent.');
    expect(updateMessageSettings).toHaveBeenCalledTimes(1);
    expect(updateMessageSettings).toHaveBeenCalledWith('g1', {
      messages: KINDS.map((kind) => ({ kind, on: kind !== 'birthday', ownLine: kind === 'miss_you' ? 'Your first class back is on us.' : null })),
      missYouDays: 14,
      milestones: [10, 50, 100],
      trialCheckInDay: 3,
      trialEndingDays: 1,
      membershipEndingDays: 14,
    });
    expect(screen.getByText('7 of 8 on')).toBeTruthy();
    expect(within(box('Trial check-in')).getByLabelText('Day of the trial').value).toBe('3');
    expect(theSwitch('Birthday').getAttribute('aria-checked')).toBe('false');
    expect(save().disabled).toBe(true);
  });

  it('a line with a link, an @ or too many characters is refused as typed, in the server\'s words, and cannot be saved', async () => {
    getMessageSettings.mockResolvedValue({ data: START });
    draw();
    await loaded();
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
    await loaded();
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
    await loaded();
    expect(within(box('We miss you')).getByText('Staff who can open Attendance check people in there.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open Attendance' })).toBeNull();
  });

  it('a gym with no trial, no price list or no payment recorded is told on the rows that need one, with a button to where it is set up, or who can', async () => {
    const noTrial = 'There is no trial on your price list, so nobody will get this yet. Add a trial on Memberships, and give it to a member on their page.';
    const noList = 'Your price list is empty, so no member has a membership in the app and nobody will get this yet.';
    const noPayments = /^No payment has been recorded in the app in the last 45 days, so nobody will get this yet\. It is only sent while you record payments here, on a member's page: otherwise people who paid you somewhere else would be told they owe./;
    const missing = (kind) => screen.queryByTestId(`missing-${kind}`);

    // An empty price list: all four rows say so, each with one button to Memberships.
    getMessageSettings.mockResolvedValue({ data: { ...START, trialOnList: false, priceList: false, payments: false } });
    draw();
    await loaded();
    for (const kind of ['trial_check_in', 'trial_ending']) expect(missing(kind).textContent).toContain(noTrial);
    for (const kind of ['membership_ending', 'payment_overdue']) expect(missing(kind).textContent).toContain(noList);
    for (const kind of ['welcome', 'birthday', 'milestone', 'miss_you']) expect(missing(kind)).toBeNull();
    for (const name of ['Trial check-in', 'Trial ending', 'Membership ending', 'Payment overdue']) {
      expect(within(box(name)).getAllByRole('button', { name: /^Open / }).map((b) => b.textContent)).toEqual(['Open Memberships']);
    }
    // The box holds what was typed, so the button asks before it leaves.
    fireEvent.click(within(box('Trial ending')).getByRole('button', { name: 'Open Memberships' }));
    expect(within(box('Trial ending')).getByRole('link', { name: 'Leave this page' }).getAttribute('href')).toBe('/console/iron-house/memberships');

    // A price list with no trial, and no payment recorded: the payment row sends them to Members.
    cleanup();
    getMessageSettings.mockResolvedValue({ data: { ...START, trialOnList: false, payments: false, billsOverdueDays: 7 } });
    draw();
    await loaded();
    expect(missing('membership_ending')).toBeNull();
    expect(missing('trial_check_in').textContent).toContain(noTrial);
    expect(missing('payment_overdue').textContent).toMatch(noPayments);
    fireEvent.click(within(missing('payment_overdue')).getByRole('button', { name: 'Open Members' }));
    expect(within(missing('payment_overdue')).getByRole('link', { name: 'Leave this page' }).getAttribute('href')).toBe('/console/iron-house/members');
    // The gym's own grace period is said, with a button to the box that changes it.
    expect(within(box('Payment overdue')).getByText(/reads Overdue on a member's page: 7 days after its due date\./)).toBeTruthy();
    expect(within(box('Payment overdue')).getByText('You change this in the Bills box on Memberships.')).toBeTruthy();
    fireEvent.click(within(box('Payment overdue')).getByRole('button', { name: 'Open the Bills box' }));
    expect(within(box('Payment overdue')).getAllByRole('link', { name: 'Leave this page' }).map((a) => a.getAttribute('href'))).toContain('/console/iron-house/memberships');

    // Somebody who cannot change the price list is told who can, with no button to it.
    cleanup();
    getMessageSettings.mockResolvedValue({ data: { ...START, trialOnList: false, priceList: false, payments: false } });
    draw({ ...ORG, staffRole: 'manager', privileges: ['org.manage'] });
    await loaded();
    expect(missing('trial_check_in').textContent).toContain('Staff who can change the price list add one on Memberships.');
    expect(screen.queryByRole('button', { name: 'Open Memberships' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open the Bills box' })).toBeNull();

    // A reply from a server that says nothing of these is read as nothing missing.
    cleanup();
    getMessageSettings.mockResolvedValue({ data: { messages: START.messages, ...NUMBERS, checkIn: true } });
    draw();
    await loaded();
    for (const kind of KINDS) expect(missing(kind)).toBeNull();
  });

  it("the server's refusal is shown and what was typed is kept; a load that fails offers Try again", async () => {
    getMessageSettings.mockResolvedValue({ data: START });
    updateMessageSettings.mockRejectedValue({ response: { data: { message: "We can't keep a line with this word in it: darn. Take it out and try again." } } });
    draw();
    await loaded();
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
    await loaded();
  });

  it('a gym on no plan sees everything and can change nothing; a studio reads its own words', async () => {
    getMessageSettings.mockResolvedValue({ data: withKind('welcome', { on: false }) });
    draw({ ...ORG, orgType: 'studio' }, { readOnly: true });
    await screen.findByText('7 of 8 on');
    expect(screen.getAllByRole('switch').every((s) => s.disabled)).toBe(true);
    expect(line('Welcome').disabled).toBe(true);
    expect(save().disabled).toBe(true);
    expect(within(box('Welcome')).getByText(/^Sent when somebody joins your studio in the app: within a quarter of an hour by day/)).toBeTruthy();
    expect(within(box('Birthday')).getByText(/^Sent on a client's birthday, in the morning/)).toBeTruthy();
  });
});

describe('the box\'s own rules', () => {
  it('reads what the server holds, and says whether anything changed', () => {
    const kept = view.messageDraft(withKind('birthday', { on: false, ownLine: 'Cake at the desk' }, { missYouDays: 21, milestones: [100, 10] }));
    expect(kept).toEqual({
      on: Object.fromEntries(KINDS.map((kind) => [kind, kind !== 'birthday'])),
      lines: Object.fromEntries(KINDS.map((kind) => [kind, kind === 'birthday' ? 'Cake at the desk' : ''])),
      trialCheckInDay: 2,
      trialEndingDays: 2,
      membershipEndingDays: 7,
      missYouDays: 21,
      milestones: [10, 100],
    });
    for (const field of ['trialCheckInDay', 'trialEndingDays', 'membershipEndingDays']) expect(view.messageDraftChanged({ ...kept, [field]: 3 }, kept), field).toBe(true);
    // A reply with no numbers in it starts at the app's own.
    expect(view.messageDraft({ messages: [] })).toMatchObject({ trialCheckInDay: 2, trialEndingDays: 2, membershipEndingDays: 7, missYouDays: 10 });
    expect([view.overdueAfter(0), view.overdueAfter(1), view.overdueAfter(7), view.overdueAfter(undefined)]).toEqual(['the day after its due date', '1 day after its due date', '7 days after its due date', 'the day after its due date']);
    expect(view.messageSettingsSummary(kept)).toBe('7 of 8 on');
    expect(view.messageSettingsSummary(view.messageDraft(START))).toBe('All 8 on');
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
