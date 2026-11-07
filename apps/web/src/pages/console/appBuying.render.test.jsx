// A member buying in the app (ROADMAP 18k-iii-a), on their page: what staff read while the payment page is open, and
// under a purchase that gave nothing though Square may have taken money. Each button acts on the one purchase it is under.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import AppBuying from './AppBuying';
import { orgService } from '../../api/orgsApi';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: { closeAppPurchase: vi.fn(), markAppPurchaseChecked: vi.fn() } };
});

const GYM = '11111111-1111-4111-8111-111111111111';
const TARA = '22222222-2222-4222-8222-222222222222';
const OPEN = '33333333-3333-4333-8333-333333333333';
const TAKEN = '44444444-4444-4444-8444-444444444444';
const UNKNOWN = '55555555-5555-4555-8555-555555555555';

const shown = (over = {}) => ({ appBuying: null, appBuyChecks: [], ...over });
const buying = { id: OPEN, typeName: '10-class pack', payerName: 'Tara Singh', closesAt: '2026-11-07T16:42:00.000Z' };

describe('a member buying in the app, on their page', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('says who is buying what until when, and Close payment page closes that page and says how it ended', async () => {
    orgService.closeAppPurchase.mockResolvedValue({ data: { outcome: 'closed' } });
    const onChanged = vi.fn();
    render(<AppBuying gymId={GYM} entryId={TARA} shown={shown({ appBuying: buying })} timezone="America/Chicago" canAct onChanged={onChanged} />);
    expect(screen.getByText("Tara Singh is buying 10-class pack in the app. The payment page closes at 10:42 AM if it isn't paid.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close payment page' }));
    await waitFor(() => expect(orgService.closeAppPurchase).toHaveBeenCalledWith(GYM, TARA, OPEN));
    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Payment page closed. Nothing was paid in the app.');
    expect(onChanged).toHaveBeenCalled();
  });

  it('names what Square took and what to do, and Mark as checked acts on that purchase alone', async () => {
    orgService.markAppPurchaseChecked.mockResolvedValue({ data: { ok: true } });
    const checks = [
      { id: TAKEN, typeName: '5-class pack', why: 'taken', amountMinor: 5000, currency: 'USD', on: '2026-11-07', payerName: 'Tara Singh' },
      { id: UNKNOWN, typeName: 'Day pass', why: 'unknown', amountMinor: null, currency: 'USD', on: '2026-11-06', payerName: null },
    ];
    render(<AppBuying gymId={GYM} entryId={TARA} shown={shown({ appBuyChecks: checks })} timezone="America/Chicago" canAct />);
    expect(
      screen.getByText(
        'Square took $50.00 from Tara Singh in the app on 7 November 2026 for 5-class pack, but it couldn\'t be given to them. Check it in Square, then refund it there or give it with Add membership.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "The member's payment page for Day pass in the app ended on 6 November 2026 without an answer from Square, so it may have been paid. Check it in Square, then refund it there or give it with Add membership.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Mark as checked' })[1]);
    await waitFor(() => expect(orgService.markAppPurchaseChecked).toHaveBeenCalledWith(GYM, TARA, UNKNOWN));
    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Marked as checked.');
  });

  it('shows nothing when no purchase is open or waiting, and no button to a reader who cannot act', () => {
    const { container } = render(<AppBuying gymId={GYM} entryId={TARA} shown={shown()} timezone={null} canAct />);
    expect(container.textContent).toBe('');
    cleanup();
    render(<AppBuying gymId={GYM} entryId={TARA} shown={shown({ appBuying: buying })} timezone="America/Chicago" canAct={false} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
