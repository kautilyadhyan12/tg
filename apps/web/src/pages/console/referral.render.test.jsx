// SETTINGS → REFER A FRIEND, drawn (ROADMAP 20e-ii-a). Only the network is mocked; every
// sentence about a gift comes from the server's own words for it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
const THANKS = { id: '11111111-1111-4111-8111-111111111111', name: 'Thank you', code: 'THANKS10', words: '10% off a membership', status: 'active', problem: null };
const WELCOME = { id: '22222222-2222-4222-8222-222222222222', name: 'Welcome', code: 'WELCOME20', words: '20% off the first payment of a membership', status: 'active', problem: null };
const ENDED = { id: '33333333-3333-4333-8333-333333333333', name: 'Summer', code: 'SUMMER', words: '5% off products, until 31 August 2026', status: 'expired', problem: 'It ended on 31 August 2026.' };
const LATER = { id: '44444444-4444-4444-8444-444444444444', name: 'New year', code: 'NEWYEAR', words: '15% off a membership', status: 'scheduled', problem: 'It starts on 1 January 2027.' };
const OFF = { on: false, memberDiscountId: null, friendDiscountId: null, discounts: [THANKS, WELCOME, ENDED, LATER], memberLines: [] };

const draw = (org = ORG) =>
  render(
    <MemoryRouter>
      <ReferralPanel org={org} readOnly={false} startOpen />
    </MemoryRouter>,
  );
const save = () => screen.getByRole('button', { name: 'Save changes' });
const pick = (label, id) => fireEvent.change(screen.getByLabelText(label), { target: { value: id } });

beforeEach(() => {
  getReferralSettings.mockReset();
  saveReferralSettings.mockReset();
});
afterEach(cleanup);

describe('Refer a friend', () => {
  it('turned on with both gifts, the member and the friend read exactly what the codes give, and the business is named as who set it', async () => {
    getReferralSettings.mockResolvedValue({ data: { settings: OFF } });
    draw();
    await screen.findByLabelText('Gift for the member who invites');
    fireEvent.click(screen.getByLabelText('Turn on Refer a friend'));
    // On with no gift: Save waits, and says why.
    expect(screen.getByText(REFERRAL_WORDS.no_gift)).toBeTruthy();
    expect(save().disabled).toBe(true);
    pick('Gift for the member who invites', THANKS.id);
    pick('Gift for the friend', WELCOME.id);
    expect(screen.getByText("When a friend you invite joins Iron House and makes their first payment, you get 10% off a membership. We'll send your code to your inbox.")).toBeTruthy();
    expect(screen.getByText('Your friend gets 20% off the first payment of a membership when they join.')).toBeTruthy();
    expect(screen.getByText('Your welcome offer: 20% off the first payment of a membership. Use code WELCOME20 when you join.')).toBeTruthy();
    expect(screen.getAllByText('This offer is set by Iron House and may change.')).toHaveLength(2);
    // The member's own code is in no preview: it is sent to them once it is earned.
    expect(screen.queryByText(/THANKS10 when|code THANKS10/)).toBeNull();

    saveReferralSettings.mockResolvedValue({ data: { settings: { ...OFF, on: true, memberDiscountId: THANKS.id, friendDiscountId: WELCOME.id } } });
    fireEvent.click(save());
    await screen.findByText('Saved. Refer a friend is on.');
    expect(saveReferralSettings).toHaveBeenCalledWith('g1', { on: true, memberDiscountId: THANKS.id, friendDiscountId: WELCOME.id });
  });

  it('an ended code cannot be saved and promises nothing; one starting later can, and says nobody is promised it yet', async () => {
    getReferralSettings.mockResolvedValue({ data: { settings: OFF } });
    draw();
    await screen.findByLabelText('Gift for the member who invites');
    fireEvent.click(screen.getByLabelText('Turn on Refer a friend'));
    pick('Gift for the member who invites', ENDED.id);
    expect(screen.getByText('Summer: It ended on 31 August 2026. Pick another.')).toBeTruthy();
    expect(screen.getByText('It ended on 31 August 2026. Nobody is promised it.')).toBeTruthy();
    expect(save().disabled).toBe(true);
    expect(screen.queryByText(/you get 5% off/)).toBeNull();

    pick('Gift for the member who invites', LATER.id);
    expect(screen.getByText('It starts on 1 January 2027. Until then, nobody is promised it.')).toBeTruthy();
    expect(screen.queryByText(/you get 15% off/)).toBeNull();
    expect(save().disabled).toBe(false);
  });

  it('a business with no promo code yet is sent to the Discounts box that makes one', async () => {
    getReferralSettings.mockResolvedValue({ data: { settings: { ...OFF, discounts: [] } } });
    draw();
    await screen.findByText(/You have no promo codes yet\./);
    expect(screen.getByRole('link', { name: 'Open Memberships' }).getAttribute('href')).toBe('/console/iron-house/memberships#discounts');
  });

  it('a refusal from the server is said, and nothing is shown as saved', async () => {
    getReferralSettings.mockResolvedValue({ data: { settings: OFF } });
    saveReferralSettings.mockRejectedValue({ response: { data: { message: REFERRAL_WORDS.not_live } } });
    draw();
    await screen.findByLabelText('Gift for the member who invites');
    fireEvent.click(screen.getByLabelText('Turn on Refer a friend'));
    pick('Gift for the member who invites', THANKS.id);
    fireEvent.click(save());
    await screen.findByText(REFERRAL_WORDS.not_live);
    expect(screen.queryByText(/^Saved\./)).toBeNull();
  });
});
