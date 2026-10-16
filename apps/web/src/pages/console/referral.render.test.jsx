// SETTINGS → REFER A FRIEND, drawn (ROADMAP 20e-ii-a). Only the network is mocked; every
// sentence about a gift is made by the server's own functions.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { REFERRAL_WORDS } from '@app/shared';

const getReferralSettings = vi.fn();
const saveReferralSettings = vi.fn();
vi.mock('../../api/orgsApi', () => ({
  orgService: { getReferralSettings, saveReferralSettings },
  errorText: (err, fallback) => err?.response?.data?.message ?? fallback,
  errorCode: (err) => err?.response?.data?.error ?? null,
}));

const ReferralPanel = (await import('../../components/console/ReferralPanel')).default;

const ORG = { id: 'g1', slug: 'iron-house', name: 'Iron House', orgType: 'gym', staffRole: 'owner', privileges: ['org.manage', 'memberships.manage'] };
const OFF = { on: false, member: null, friend: null, currency: 'INR', memberLines: [], version: 'v1' };
const FRIEND_SAVED = { kind: 'amount', percentBp: null, amountMinor: 50000, currency: 'INR', on: 'first', code: 'WELCOME500', words: '₹500.00 off the first payment of a membership', problem: null, archived: false };
const MEMBER_SAVED = { kind: 'percent', percentBp: 1000, amountMinor: null, currency: null, on: 'membership', days: null, words: '10% off your next membership payment' };

const draw = (org = ORG) =>
  render(
    <MemoryRouter>
      <ReferralPanel org={org} readOnly={false} startOpen />
    </MemoryRouter>,
  );
const save = () => screen.getByRole('button', { name: 'Save changes' });
const bar = () => within(screen.getByTestId('referral-save-bar'));
const box = (title) => within(screen.getByRole('group', { name: title }));
const MEMBER = 'Gift for the member who invites';
const FRIEND = 'Gift for the friend';
const choose = (title, what, value, on) => {
  fireEvent.change(box(title).getByLabelText(`${title}: what they get`), { target: { value: what } });
  if (what === 'none') return;
  fireEvent.change(box(title).getByLabelText(`${title}: ${what === 'percent' ? 'percentage' : 'amount'}`), { target: { value } });
  if (on !== undefined) fireEvent.change(box(title).getByLabelText(`${title}: off`), { target: { value: on } });
};

beforeEach(() => {
  getReferralSettings.mockReset();
  saveReferralSettings.mockReset();
});
afterEach(cleanup);

describe('Refer a friend', () => {
  it('both gifts are set in the box: the member gets an amount off their next membership payment, the friend a code, and both read exactly that', async () => {
    getReferralSettings.mockResolvedValue({ data: { settings: OFF } });
    draw();
    await screen.findByRole('group', { name: MEMBER });
    fireEvent.click(screen.getByLabelText('Turn on Refer a friend'));
    // Said under the switch that was just ticked, and beside Save.
    expect(screen.getAllByText(REFERRAL_WORDS.no_gift)).toHaveLength(2);
    expect(bar().getByText(REFERRAL_WORDS.no_gift)).toBeTruthy();
    expect(save().disabled).toBe(true);

    choose(MEMBER, 'percent', '10');
    // The member's money comes off their next membership payment unless the owner picks products.
    expect(box(MEMBER).getByLabelText(`${MEMBER}: off`).value).toBe('membership');
    choose(FRIEND, 'amount', '500', 'first');
    expect(
      screen.getByText("When a friend you invite joins Iron House and makes their first payment, you get 10% off your next membership payment. It comes off by itself, and we'll tell you in your inbox."),
    ).toBeTruthy();
    expect(screen.getByText('Your friend gets ₹500.00 off the first payment of a membership when they join.')).toBeTruthy();
    expect(screen.getByText("[member's first name] invited you to join Iron House.")).toBeTruthy();
    // No code for the friend to remember: the business adds the offer.
    expect(screen.getByText('Your welcome offer: ₹500.00 off the first payment of a membership. Iron House adds it for you when you join.')).toBeTruthy();
    expect(bar().getByText("You have changes that aren't saved.")).toBeTruthy();

    saveReferralSettings.mockResolvedValue({ data: { settings: { ...OFF, on: true, member: MEMBER_SAVED, friend: FRIEND_SAVED } } });
    fireEvent.click(save());
    await screen.findByText('Saved. Refer a friend is on.');
    expect(saveReferralSettings).toHaveBeenCalledWith('g1', {
      on: true,
      member: { kind: 'percent', percentBp: 1000, amountMinor: null, on: 'membership', days: null },
      friend: { kind: 'amount', percentBp: null, amountMinor: 50000, on: 'first' },
      // The offer as the box read it: a save made since in another tab refuses this one.
      version: 'v1',
    });
    expect(box(FRIEND).getByText('Its promo code: WELCOME500.')).toBeTruthy();
    expect(box(MEMBER).queryByText(/promo code/)).toBeNull();
    expect(screen.getByText('Your welcome offer: ₹500.00 off the first payment of a membership. Iron House adds it for you when you join.')).toBeTruthy();
    expect(box(FRIEND).getByRole('link', { name: 'See it in Discounts' }).getAttribute('href')).toBe('/console/iron-house/memberships#discounts');
  });

  it('free days on their membership, with money off for a member who has none, read and saved as typed', async () => {
    getReferralSettings.mockResolvedValue({ data: { settings: OFF } });
    draw();
    await screen.findByRole('group', { name: MEMBER });
    fireEvent.click(screen.getByLabelText('Turn on Refer a friend'));
    fireEvent.change(box(MEMBER).getByLabelText(`${MEMBER}: what they get`), { target: { value: 'days' } });
    expect(box(MEMBER).getByText('Their next renewal, or the last day of their membership, moves later by these days. What they owe now stays the same.')).toBeTruthy();
    fireEvent.change(box(MEMBER).getByLabelText(`${MEMBER}: days`), { target: { value: '91' } });
    expect(box(MEMBER).getByText('Type a number of days from 1 to 90, like 14.')).toBeTruthy();
    expect(save().disabled).toBe(true);
    fireEvent.change(box(MEMBER).getByLabelText(`${MEMBER}: days`), { target: { value: '14' } });
    // Free days alone are not enough: a member with no membership then has nothing to add them to.
    expect(box(MEMBER).getByText('Choose what a member with no membership gets instead.')).toBeTruthy();
    expect(save().disabled).toBe(true);
    fireEvent.change(box(MEMBER).getByLabelText(`${MEMBER}: with no membership, what they get`), { target: { value: 'amount' } });
    fireEvent.change(box(MEMBER).getByLabelText(`${MEMBER}: with no membership, amount`), { target: { value: '500' } });
    expect(
      screen.getByText("When a friend you invite joins Iron House and makes their first payment, you get 14 free days on your membership. They are added by themselves, and we'll tell you in your inbox."),
    ).toBeTruthy();
    expect(screen.getByText('If you have no membership then, you get ₹500.00 off your next membership payment instead.')).toBeTruthy();
    const saved = { kind: 'amount', percentBp: null, amountMinor: 50000, currency: 'INR', on: 'membership', days: 14, words: '14 free days on your membership' };
    saveReferralSettings.mockResolvedValue({ data: { settings: { ...OFF, on: true, member: saved } } });
    fireEvent.click(save());
    await screen.findByText('Saved. Refer a friend is on.');
    expect(saveReferralSettings).toHaveBeenCalledWith('g1', {
      on: true,
      member: { kind: 'amount', percentBp: null, amountMinor: 50000, on: 'membership', days: 14 },
      friend: null,
      version: 'v1',
    });
    // Read back as it was saved, with nothing left unsaved.
    expect(box(MEMBER).getByLabelText(`${MEMBER}: days`).value).toBe('14');
    expect(box(MEMBER).getByLabelText(`${MEMBER}: with no membership, amount`).value).toBe('500.00');
    expect(bar().queryByText(/aren't saved/)).toBeNull();
  });

  it('money off products at the desk', async () => {
    getReferralSettings.mockResolvedValue({ data: { settings: OFF } });
    draw();
    await screen.findByRole('group', { name: MEMBER });
    fireEvent.click(screen.getByLabelText('Turn on Refer a friend'));
    choose(MEMBER, 'amount', '200', 'products');
    expect(screen.getByText(/you get ₹200\.00 off your next purchase at the desk\. It comes off by itself/)).toBeTruthy();
    saveReferralSettings.mockResolvedValue({ data: { settings: { ...OFF, on: true, member: { ...MEMBER_SAVED, on: 'products' } } } });
    fireEvent.click(save());
    await screen.findByText('Saved. Refer a friend is on.');
    expect(saveReferralSettings.mock.calls[0][1].member).toEqual({ kind: 'amount', percentBp: null, amountMinor: 20000, on: 'products', days: null });
  });

  it('unticking the switch says what is not saved beside Save, which stays in view', async () => {
    getReferralSettings.mockResolvedValue({ data: { settings: { ...OFF, on: true, member: MEMBER_SAVED, friend: FRIEND_SAVED } } });
    draw();
    await screen.findByRole('group', { name: MEMBER });
    expect(bar().queryByText(/aren't saved/)).toBeNull();
    fireEvent.click(screen.getByLabelText('Turn on Refer a friend'));
    expect(bar().getByText("You have changes that aren't saved.")).toBeTruthy();
    expect(screen.getByTestId('referral-save-bar').className).toMatch(/sticky/);
    expect(save().disabled).toBe(false);
  });

  it('what is typed that is not a gift waits, says why, and promises nothing', async () => {
    getReferralSettings.mockResolvedValue({ data: { settings: OFF } });
    draw();
    await screen.findByRole('group', { name: MEMBER });
    fireEvent.click(screen.getByLabelText('Turn on Refer a friend'));
    choose(MEMBER, 'percent', '100');
    expect(box(MEMBER).getByText('Type a percentage above 0 and under 100, like 10.')).toBeTruthy();
    expect(save().disabled).toBe(true);
    expect(screen.queryByText(/you get 100%/)).toBeNull();
    choose(MEMBER, 'percent', '12.5');
    expect(screen.getByText(/you get 12\.5% off your next membership payment\./)).toBeTruthy();
    expect(save().disabled).toBe(false);
  });

  it('a business with no country can give a percentage, and is sent to set its country for an amount', async () => {
    getReferralSettings.mockResolvedValue({ data: { settings: { ...OFF, currency: null } } });
    draw();
    await screen.findByRole('group', { name: MEMBER });
    choose(MEMBER, 'amount', '500');
    expect(box(MEMBER).getByText(REFERRAL_WORDS.no_currency)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Set your country' }).getAttribute('href')).toBe('/console/iron-house/settings#country');
    expect(save().disabled).toBe(true);
  });

  it("a friend's code archived in Discounts says nobody is promised it, and that saving makes a new one", async () => {
    getReferralSettings.mockResolvedValue({
      data: { settings: { ...OFF, on: true, friend: { ...FRIEND_SAVED, problem: 'It was archived.', archived: true } } },
    });
    draw();
    await screen.findByRole('group', { name: FRIEND });
    expect(box(FRIEND).getByText('It was archived. Nobody is promised this gift. Save to make a new code.')).toBeTruthy();
  });

  it('saved meanwhile in another tab: nothing is saved, it says so where Save is, and the box shows the offer as it now is (item 20\'s passes, H3)', async () => {
    const changed = 'These settings were changed since you opened them. Nothing was saved: check them and save again.';
    getReferralSettings.mockResolvedValueOnce({ data: { settings: OFF } }).mockResolvedValueOnce({ data: { settings: { ...OFF, on: true, member: MEMBER_SAVED, version: 'v2' } } });
    saveReferralSettings.mockRejectedValueOnce({ response: { status: 409, data: { error: 'referral_settings_changed', message: changed } } });
    draw();
    await screen.findByRole('group', { name: MEMBER });
    fireEvent.click(screen.getByLabelText('Turn on Refer a friend'));
    choose(FRIEND, 'percent', '10', 'first');
    fireEvent.click(save());
    expect(await screen.findByText(changed)).toBeTruthy();
    // Read again: the other tab's offer, with no change waiting to be saved.
    await screen.findByText(/you get 10% off your next membership payment/);
    expect(getReferralSettings).toHaveBeenCalledTimes(2);
    expect(bar().queryByText("You have changes that aren't saved.")).toBeNull();
    expect(screen.queryByText(/^Saved\./)).toBeNull();
  });

  it('a refusal from the server is said, and nothing is shown as saved', async () => {
    getReferralSettings.mockResolvedValue({ data: { settings: OFF } });
    saveReferralSettings.mockRejectedValue({ response: { data: { message: REFERRAL_WORDS.too_many } } });
    draw();
    await screen.findByRole('group', { name: MEMBER });
    fireEvent.click(screen.getByLabelText('Turn on Refer a friend'));
    choose(FRIEND, 'percent', '10', 'first');
    fireEvent.click(save());
    await screen.findByText(REFERRAL_WORDS.too_many);
    expect(screen.queryByText(/^Saved\./)).toBeNull();
  });
});
