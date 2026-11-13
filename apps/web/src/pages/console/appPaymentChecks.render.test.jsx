// @vitest-environment jsdom
// Overview's App payments to review (ROADMAP 18k-vi): each payment in the app Square may have charged that wasn't applied
// here, what it was for and where it stands, each opening the member's page at its line; ten, then Show more.
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

describe('App payments to review', () => {
  it('its words, for each kind: what it was for and where it stands', () => {
    expect(appPaymentChecksHeadline(0)).toBeNull();
    expect(appPaymentChecksHeadline(1)).toBe('1 app payment to review');
    expect(appPaymentChecksHeadline(3)).toBe('3 app payments to review');
    expect(appPaymentCheckLines(row())).toEqual({ what: 'Gold Monthly · Membership payment', status: 'Charged $54.99 on 12 November 2026, but not applied to the bill.' });
    expect(appPaymentCheckLines(row({ kind: 'fee', fee: 'late_cancel', why: 'unknown', amountMinor: null, payerName: null }))).toEqual({
      what: 'Gold Monthly · Late cancel fee',
      status: 'Not confirmed by Square on 12 November 2026. The member may have been charged.',
    });
    expect(appPaymentCheckLines(row({ kind: 'fee', fee: 'freeze', amountMinor: 1700, currency: 'CAD' }))).toEqual({
      what: 'Gold Monthly · Freeze fee',
      status: 'Charged CA$17.00 on 12 November 2026, but not applied to the fee.',
    });
    expect(appPaymentCheckLines(row({ kind: 'purchase', typeName: '10-class pack', amountMinor: 9000, payerName: 'Priya Sharma' }))).toEqual({
      what: '10-class pack · App purchase',
      status: "Charged $90.00 on 12 November 2026, but 10-class pack wasn't added. Paid by Priya Sharma.",
    });
    expect(appPaymentCheckLines(row({ amountMinor: null })).status).toBe('Charged on 12 November 2026, but not applied to the bill.');
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
    expect((await screen.findByTestId('app-payment-checks-headline')).textContent).toBe('2 app payments to review');
    expect(screen.getByText("Square may have charged these members in the app, but the payments weren't applied here. Review each one in your Square Dashboard, then resolve it on the member's page.")).toBeTruthy();
    expect(screen.getByText('Gold Monthly · Membership payment')).toBeTruthy();
    expect(screen.getByText('5-class pack · App purchase')).toBeTruthy();
    expect(screen.getByText('Past member')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review payment: Ana Ruiz' }));
    expect(screen.getByRole('dialog', { name: `person ${ENTRY}` }).getAttribute('data-check-now')).toBe('purchase:bbb');
    fireEvent.click(screen.getByRole('button', { name: 'Close page' }));
    await waitFor(() => expect(svc.list).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ten at first, then Show more; and where more people have one than were read, says so', async () => {
    svc.list.mockResolvedValue({ rows: Array.from({ length: 12 }, (_, i) => row({ id: `bill:${String(i)}`, name: `Person ${String(i)}` })), more: true });
    draw();
    expect((await screen.findByTestId('app-payment-checks-headline')).textContent).toBe('12 app payments to review');
    expect(screen.getAllByTestId('app-payment-check-row')).toHaveLength(10);
    expect(screen.queryByText('Showing the 100 most recent members. More appear here as you resolve these.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(screen.getAllByTestId('app-payment-check-row')).toHaveLength(12);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
    expect(screen.getByText('Showing the 100 most recent members. More appear here as you resolve these.')).toBeTruthy();
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
