// @vitest-environment jsdom
// Overview's Payments to check in Square (ROADMAP 18k-vi): each payment in the app Square may have taken that didn't go
// through, in the member's page's own words, each opening that page at its line; ten, then Show more.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const svc = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../api/appPaymentChecksApi', () => ({ appPaymentChecksService: svc }));
vi.mock('./liveNews', () => ({ useLiveNews: () => undefined }));
vi.mock('./MemberListPerson', () => ({
  default: ({ entryId, checkNow, onClose }) => (
    <div role="dialog" aria-label={`person ${entryId}`} data-check-now={checkNow}>
      <button type="button" onClick={onClose}>
        Close page
      </button>
    </div>
  ),
}));

const { default: AppPaymentChecksCard } = await import('../../components/console/AppPaymentChecksCard');
const { appPaymentCheckLines, canSeeAppPaymentChecks } = await import('./appPaymentChecksView');
const { appPaymentChecksHeadline } = await import('@app/shared');

const ENTRY = '11111111-1111-4111-8111-111111111111';
const org = { id: '77777777-7777-4777-8777-777777777777', orgType: 'gym', slug: 'demo' };
const STAFF = ['members.confirm', 'billing.members'];
let n = 0;
const row = (over = {}) => ({
  id: `bill:${String(n++)}`,
  entryId: ENTRY,
  name: 'Tara Singh',
  past: false,
  kind: 'bill',
  typeName: 'Gold Monthly',
  fee: null,
  why: 'taken',
  amountMinor: 5499,
  currency: 'USD',
  on: '2026-11-12',
  payerName: 'Tara Singh',
  ...over,
});
const draw = (privileges = STAFF) =>
  render(
    <MemoryRouter>
      <AppPaymentChecksCard org={org} privileges={privileges} readOnly={false} />
    </MemoryRouter>,
  );

beforeEach(() => svc.list.mockReset());
afterEach(cleanup);

describe('Payments to check in Square', () => {
  it('its words, for each kind, in the member page’s own sentences', () => {
    expect(appPaymentChecksHeadline(0)).toBeNull();
    expect(appPaymentChecksHeadline(1)).toBe('1 payment to check in Square');
    expect(appPaymentChecksHeadline(3)).toBe('3 payments to check in Square');
    expect(appPaymentCheckLines(row())).toEqual({
      what: 'Gold Monthly · bill',
      sentence: "Square took $54.99 from Tara Singh in the app on 12 Nov 2026, but it couldn't go on this bill. Check it in Square before taking this payment again. It won't be charged to the card on file automatically.",
    });
    expect(appPaymentCheckLines(row({ kind: 'fee', fee: 'late_cancel', why: 'unknown', amountMinor: null, payerName: null }))).toEqual({
      what: 'Gold Monthly · late cancel fee',
      sentence: "The member's payment page in the app ended on 12 Nov 2026 without an answer from Square, so it may have been paid. Check it in Square before taking this payment again.",
    });
    expect(appPaymentCheckLines(row({ kind: 'purchase', typeName: '5-class pack', amountMinor: 5000, payerName: 'Priya Sharma' }))).toEqual({
      what: '5-class pack · bought in the app',
      sentence: "Square took $50.00 from Priya Sharma in the app on 12 Nov 2026 for 5-class pack, but it couldn't be given to them. Check it in Square, then refund it there or give it with Add membership.",
    });
  });

  it('who may read it: who takes payments and keeps the member list', () => {
    expect(canSeeAppPaymentChecks(STAFF)).toBe(true);
    expect(canSeeAppPaymentChecks(['billing.members'])).toBe(false);
    expect(canSeeAppPaymentChecks(['members.confirm'])).toBe(false);
    expect(canSeeAppPaymentChecks(null)).toBe(false);
  });

  it('lists each one and opens that member’s page at its line', async () => {
    svc.list.mockResolvedValue({ rows: [row({ id: 'bill:aaa' }), row({ id: 'purchase:bbb', name: 'Ana Ruiz', past: true, kind: 'purchase', typeName: '5-class pack' })], more: false });
    draw();
    expect((await screen.findByTestId('app-payment-checks-headline')).textContent).toBe('2 payments to check in Square');
    expect(screen.getByText("Square may have taken these payments in the app, but they didn't go through here. Check each one in Square, then settle it on the member's page.")).toBeTruthy();
    expect(screen.getByText('Gold Monthly · bill')).toBeTruthy();
    expect(screen.getByText('5-class pack · bought in the app')).toBeTruthy();
    expect(screen.getByText('Past member')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open their page: Ana Ruiz' }));
    expect(screen.getByRole('dialog', { name: `person ${ENTRY}` }).getAttribute('data-check-now')).toBe('purchase:bbb');
    fireEvent.click(screen.getByRole('button', { name: 'Close page' }));
    await waitFor(() => expect(svc.list).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ten at first, then Show more; and where more people have one than were read, says so', async () => {
    svc.list.mockResolvedValue({ rows: Array.from({ length: 12 }, (_, i) => row({ id: `bill:${String(i)}`, name: `Person ${String(i)}` })), more: true });
    draw();
    expect((await screen.findByTestId('app-payment-checks-headline')).textContent).toBe('12 payments to check in Square');
    expect(screen.getAllByTestId('app-payment-check-row')).toHaveLength(10);
    expect(screen.queryByText('Only the 100 newest people are shown. More appear here as you settle these.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(screen.getAllByTestId('app-payment-check-row')).toHaveLength(12);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
    expect(screen.getByText('Only the 100 newest people are shown. More appear here as you settle these.')).toBeTruthy();
  });

  it('draws nothing with none, a failed read, or without both ticks', async () => {
    svc.list.mockResolvedValue({ rows: [], more: false });
    const { container } = draw();
    await waitFor(() => expect(svc.list).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
    cleanup();
    svc.list.mockRejectedValueOnce({ response: { status: 500 } });
    const failed = draw();
    await waitFor(() => expect(svc.list).toHaveBeenCalledTimes(2));
    expect(failed.container.innerHTML).toBe('');
    cleanup();
    svc.list.mockClear();
    const not = draw(['billing.members']);
    expect(not.container.innerHTML).toBe('');
    expect(svc.list).not.toHaveBeenCalled();
  });
});
