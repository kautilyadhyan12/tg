// @vitest-environment jsdom
// Overview's money boxes in the third look (ROADMAP V5-b). The worst thing they could do: show one
// business's money rows (names, amounts) to staff whose role gives them none, or to another business.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLE_PRIVILEGES } from '@app/shared';

const failed = vi.hoisted(() => ({ summary: vi.fn() }));
const refunds = vi.hoisted(() => ({ list: vi.fn() }));
const checks = vi.hoisted(() => ({ list: vi.fn() }));
const cancels = vi.hoisted(() => ({ list: vi.fn() }));
const charges = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../api/failedPaymentsApi', () => ({ failedPaymentsService: failed }));
vi.mock('../../api/refundsToReviewApi', () => ({ refundsToReviewService: refunds }));
vi.mock('../../api/appPaymentChecksApi', () => ({ appPaymentChecksService: checks }));
vi.mock('../../api/appCancelsApi', () => ({ appCancelsService: cancels }));
vi.mock('../../api/chargebacksApi', () => ({ chargebacksService: charges }));
vi.mock('./liveNews', () => ({ useLiveNews: () => undefined }));
vi.mock('./MemberListPerson', () => ({ default: () => null }));

const { default: FailedPaymentsCard } = await import('../../components/console/FailedPaymentsCard');
const { default: RefundsToReviewCard } = await import('../../components/console/RefundsToReviewCard');
const { default: AppPaymentChecksCard } = await import('../../components/console/AppPaymentChecksCard');
const { default: AppCancelsCard } = await import('../../components/console/AppCancelsCard');
const { default: ChargebacksCard } = await import('../../components/console/ChargebacksCard');

const ENTRY = '11111111-1111-4111-8111-111111111111';
const A = { id: '77777777-7777-4777-8777-777777777777', orgType: 'gym', slug: 'iron-house' };
const B = { id: '88888888-8888-4888-8888-888888888888', orgType: 'gym', slug: 'northside' };

const refundRow = { id: '44444444-4444-4444-8444-444444444444', kind: 'failed', amountMinor: 2500, paidMinor: 2500, others: 0, currency: 'USD', name: 'Ravi Shah', past: false, personDeleted: false, on: '2026-10-30', member: { entryId: ENTRY, membershipId: '22222222-2222-4222-8222-222222222222', paymentId: '33333333-3333-4333-8333-333333333333', typeName: 'Gold Monthly', byHand: false, fee: null }, sale: null };
const checkRow = { id: 'bill:1', entryId: ENTRY, name: 'Tara Singh', past: false, kind: 'bill', typeName: 'Gold Monthly', fee: null, why: 'taken', amountMinor: 5499, currency: 'USD', on: '2026-11-12', payerName: 'Tara Singh' };
const cancelRow = { id: '55555555-5555-4555-8555-555555555555', entryId: ENTRY, name: 'Maya Test', past: false, membershipName: 'Gold Monthly', on: '2026-11-11', endsOn: '2026-11-30', when: 'period_end', reason: 'cost' };
const chargeRow = { id: '66666666-6666-4666-8666-666666666666', amountMinor: 8804, currency: 'USD', state: 'EVIDENCE_REQUIRED', reason: 'NO_KNOWLEDGE', dueOn: '2026-11-14', duePassed: false, card: null, stops: true, name: 'Priya Kapoor', past: false, personDeleted: false, member: { entryId: ENTRY, what: 'Silver' }, sale: null };
const NAMES = ['Ravi Shah', 'Tara Singh', 'Maya Test', 'Priya Kapoor'];

function Boxes({ org, privileges }) {
  return (
    <MemoryRouter>
      <FailedPaymentsCard gymId={org.id} orgSlug={org.slug} privileges={privileges} />
      <RefundsToReviewCard org={org} orgSlug={org.slug} privileges={privileges} readOnly={false} />
      <AppPaymentChecksCard org={org} privileges={privileges} readOnly={false} />
      <AppCancelsCard org={org} orgSlug={org.slug} privileges={privileges} readOnly={false} />
      <ChargebacksCard org={org} orgSlug={org.slug} privileges={privileges} readOnly={false} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  failed.summary.mockResolvedValue({ count: 3, totals: [{ currency: 'USD', minor: 6000 }], square: true });
  refunds.list.mockResolvedValue({ count: 1, rows: [refundRow], next: null });
  checks.list.mockResolvedValue({ rows: [checkRow], more: false });
  cancels.list.mockResolvedValue({ count: 1, rows: [cancelRow], letsEveryoneIn: false, today: '2026-11-12' });
  charges.list.mockResolvedValue({ count: 1, lostCount: 0, rows: [chargeRow], next: null, needsReconnect: false, canReconnect: false });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the worst thing: money rows only for the staff and the business they belong to', () => {
  it('a trainer gets no money box, and none of their reads is asked', async () => {
    render(<Boxes org={A} privileges={[...ROLE_PRIVILEGES.trainer]} />);
    await new Promise((r) => setTimeout(r, 20));
    for (const id of ['failed-payments-card', 'refunds-to-review', 'app-payment-checks', 'app-cancels', 'chargebacks']) expect(screen.queryByTestId(id)).toBeNull();
    for (const name of NAMES) expect(screen.queryByText(name, { exact: false })).toBeNull();
    expect(failed.summary).not.toHaveBeenCalled();
    expect(refunds.list).not.toHaveBeenCalled();
    expect(checks.list).not.toHaveBeenCalled();
    expect(charges.list).not.toHaveBeenCalled();
  });

  it('the owner sees all five, in the new look', async () => {
    render(<Boxes org={A} privileges={[...ROLE_PRIVILEGES.owner]} />);
    for (const id of ['failed-payments-card', 'refunds-to-review', 'app-payment-checks', 'app-cancels', 'chargebacks']) {
      const box = await screen.findByTestId(id);
      expect(box.closest('.c-card')).not.toBeNull();
    }
    for (const name of NAMES) expect(screen.getAllByText(name, { exact: false }).length).toBeGreaterThan(0);
  });

  it("switching to another business never shows the last one's people while its own read is out", async () => {
    const view = render(<Boxes org={A} privileges={[...ROLE_PRIVILEGES.owner]} />);
    await screen.findByText('Priya Kapoor', { exact: false });
    const never = () => new Promise(() => {});
    failed.summary.mockImplementation(never);
    refunds.list.mockImplementation(never);
    checks.list.mockImplementation(never);
    cancels.list.mockImplementation(never);
    charges.list.mockImplementation(never);
    view.rerender(<Boxes org={B} privileges={[...ROLE_PRIVILEGES.owner]} />);
    await waitFor(() => expect(charges.list).toHaveBeenLastCalledWith(B.id));
    for (const name of NAMES) expect(screen.queryByText(name, { exact: false })).toBeNull();
    expect(screen.queryByTestId('failed-payments-card')).toBeNull();
  });
});
