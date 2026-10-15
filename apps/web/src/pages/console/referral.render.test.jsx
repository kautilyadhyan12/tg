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
}));

const ReferralPanel = (await import('../../components/console/ReferralPanel')).default;

const ORG = { id: 'g1', slug: 'iron-house', name: 'Iron House', orgType: 'gym', staffRole: 'owner', privileges: ['org.manage', 'memberships.manage'] };
const OFF = { on: false, member: null, friend: null, currency: 'INR', memberLines: [] };
const SAVED_GIFT = (code, percentBp, on, words) => ({ kind: 'percent', percentBp, amountMinor: null, currency: null, on, code, words, problem: null, archived: false });

const draw = (org = ORG) =>
  render(
    <MemoryRouter>
      <ReferralPanel org={org} readOnly={false} startOpen />
    </MemoryRouter>,
  );
const save = () => screen.getByRole('button', { name: 'Save changes' });
const box = (title) => within(screen.getByRole('group', { name: title }));
const MEMBER = 'Gift for the member who invites';
const FRIEND = 'Gift for the friend';
const choose = (title, what, value, on) => {
  fireEvent.change(box(title).getByLabelText(`${title}: what they get`), { target: { value: what } });
  if (what === 'none') return;
  fireEvent.change(box(title).getByLabelText(`${title}: ${what === 'percent' ? 'percentage' : 'amount'}`), { target: { value } });
  fireEvent.change(box(title).getByLabelText(`${title}: off`), { target: { value: on } });
};

beforeEach(() => {
  getReferralSettings.mockReset();
  saveReferralSettings.mockReset();
});
afterEach(cleanup);

describe('Refer a friend', () => {
  it('both gifts are set in the box itself: the member and the friend read exactly what they give, and who set the offer', async () => {
    getReferralSettings.mockResolvedValue({ data: { settings: OFF } });
    draw();
    await screen.findByRole('group', { name: MEMBER });
    // Nothing to set up on another page first.
    expect(screen.queryByText(/promo codes yet/)).toBeNull();
    fireEvent.click(screen.getByLabelText('Turn on Refer a friend'));
    expect(screen.getByText(REFERRAL_WORDS.no_gift)).toBeTruthy();
    expect(save().disabled).toBe(true);

    choose(MEMBER, 'percent', '10', 'every');
    choose(FRIEND, 'amount', '500', 'first');
    expect(screen.getByText("When a friend you invite joins Iron House and makes their first payment, you get 10% off every payment of a membership. We'll send your code to your inbox.")).toBeTruthy();
    expect(screen.getByText('Your friend gets ₹500.00 off the first payment of a membership when they join.')).toBeTruthy();
    // The friend's code is made on Save: the preview says so, and invents none.
    expect(screen.getByText('Your welcome offer: ₹500.00 off the first payment of a membership. Use code [its code, made when you save] when you join.')).toBeTruthy();
    expect(screen.getAllByText('This offer is set by Iron House and may change.')).toHaveLength(2);

    saveReferralSettings.mockResolvedValue({
      data: {
        settings: {
          ...OFF,
          on: true,
          member: SAVED_GIFT('THANKS10', 1000, 'every', '10% off every payment of a membership'),
          friend: { kind: 'amount', percentBp: null, amountMinor: 50000, currency: 'INR', on: 'first', code: 'WELCOME500', words: '₹500.00 off the first payment of a membership', problem: null, archived: false },
        },
      },
    });
    fireEvent.click(save());
    await screen.findByText('Saved. Refer a friend is on.');
    expect(saveReferralSettings).toHaveBeenCalledWith('g1', {
      on: true,
      member: { kind: 'percent', percentBp: 1000, amountMinor: null, on: 'every' },
      friend: { kind: 'amount', percentBp: null, amountMinor: 50000, on: 'first' },
    });
    // Saved, each gift says its code, the friend's preview shows the real one, and each has a button to Discounts.
    expect(box(MEMBER).getByText('Its promo code: THANKS10.')).toBeTruthy();
    expect(box(FRIEND).getByText('Its promo code: WELCOME500.')).toBeTruthy();
    expect(screen.getByText('Your welcome offer: ₹500.00 off the first payment of a membership. Use code WELCOME500 when you join.')).toBeTruthy();
    expect(box(MEMBER).getByRole('link', { name: 'See it in Discounts' }).getAttribute('href')).toBe('/console/iron-house/memberships#discounts');
  });

  it('what is typed that is not a gift waits, says why, and promises nothing', async () => {
    getReferralSettings.mockResolvedValue({ data: { settings: OFF } });
    draw();
    await screen.findByRole('group', { name: MEMBER });
    fireEvent.click(screen.getByLabelText('Turn on Refer a friend'));
    choose(MEMBER, 'percent', '100', 'first');
    expect(box(MEMBER).getByText('Type a percentage above 0 and under 100, like 10.')).toBeTruthy();
    expect(save().disabled).toBe(true);
    expect(screen.queryByText(/you get 100%/)).toBeNull();
    choose(MEMBER, 'percent', '12.5', 'products');
    expect(screen.getByText(/you get 12\.5% off products\./)).toBeTruthy();
    expect(save().disabled).toBe(false);
  });

  it('a business with no country can give a percentage, and is sent to set its country for an amount', async () => {
    getReferralSettings.mockResolvedValue({ data: { settings: { ...OFF, currency: null } } });
    draw();
    await screen.findByRole('group', { name: MEMBER });
    choose(MEMBER, 'amount', '500', 'first');
    expect(box(MEMBER).getByText(REFERRAL_WORDS.no_currency)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Set your country' }).getAttribute('href')).toBe('/console/iron-house/settings#country');
    expect(save().disabled).toBe(true);
  });

  it('a gift whose code was archived in Discounts says nobody is promised it, and that saving makes a new one', async () => {
    getReferralSettings.mockResolvedValue({
      data: { settings: { ...OFF, on: true, friend: { ...SAVED_GIFT('WELCOME20', 2000, 'first', '20% off the first payment of a membership'), problem: 'It was archived.', archived: true } } },
    });
    draw();
    await screen.findByRole('group', { name: FRIEND });
    expect(box(FRIEND).getByText('It was archived. Nobody is promised this gift. Save to make a new code.')).toBeTruthy();
  });

  it('a refusal from the server is said, and nothing is shown as saved', async () => {
    getReferralSettings.mockResolvedValue({ data: { settings: OFF } });
    saveReferralSettings.mockRejectedValue({ response: { data: { message: REFERRAL_WORDS.too_many } } });
    draw();
    await screen.findByRole('group', { name: MEMBER });
    fireEvent.click(screen.getByLabelText('Turn on Refer a friend'));
    choose(MEMBER, 'percent', '10', 'first');
    fireEvent.click(save());
    await screen.findByText(REFERRAL_WORDS.too_many);
    expect(screen.queryByText(/^Saved\./)).toBeNull();
  });
});
