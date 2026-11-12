// Undo cancellation, for staff (ROADMAP 18l-ii-b; spec Part 3 §14.8).
//
// THE WORST THING THIS BOX COULD DO: offer staff a way to start payments again that a member stopped in the app, or
// press for a membership other than the one its box named. So: a cancel made in the app has no Undo and says it can be
// undone only in the app, whatever the server sends; and the press sends that membership, the box's own key and one
// request key, which stays the same when pressed again.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { giveHeldMembership, heldMembershipView, heldMembershipsResponseSchema, moveHeldMembership, undoCancelAskSchema } from '@app/shared';

vi.mock('../../api/chargebacksApi', () => ({ chargebacksService: { startPreview: vi.fn(), start: vi.fn() } }));
vi.mock('./MemberNotes', () => ({ default: () => null }));
vi.mock('./MemberPayer', () => ({ default: () => null }));
vi.mock('./MemberCard', () => ({ default: () => null }));
vi.mock('./liveNews', () => ({ useLiveNews: () => undefined }));
vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getHeldMemberships: vi.fn(),
      getTerminalPayments: vi.fn(),
      getUndoCancel: vi.fn(),
      changeHeldMembership: vi.fn(),
      getMembershipAgreement: vi.fn(),
    },
  };
});

const { billingFor } = await import('./billingFixture');
const { orgService } = await import('../../api/orgsApi');
const MemberMemberships = (await import('./MemberMemberships')).default;

const GYM = '11111111-1111-4111-8111-111111111111';
const ADA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TODAY = '2026-10-20';
const GOLD = {
  id: '22222222-2222-4222-8222-000000000001',
  name: 'Gold Monthly',
  kind: 'recurring',
  priceMinor: 4999,
  currency: 'GBP',
  termCount: 1,
  termUnit: 'month',
  packClasses: null,
  packDays: null,
  taxes: [],
};

/** A membership cancelled on the last day paid for, as the server sends it. */
function cancelledLater(n, more = {}) {
  const made = giveHeldMembership(GOLD, '2026-10-04', true, '2026-10-04');
  if (!made.ok) throw new Error(made.reason);
  const move = moveHeldMembership(made.membership, { type: 'cancel', when: 'period_end' }, TODAY);
  if (!move.ok) throw new Error('refused');
  const m = move.membership;
  return {
    id: `44444444-4444-4444-8444-00000000000${String(n)}`,
    typeId: GOLD.id,
    typeName: GOLD.name,
    kind: GOLD.kind,
    priceMinor: GOLD.priceMinor,
    currency: GOLD.currency,
    termCount: GOLD.termCount,
    termUnit: GOLD.termUnit,
    packClasses: null,
    packDays: null,
    startsOn: '2026-10-04',
    frozenOn: m.frozenOn,
    classesLeft: m.classesLeft,
    fromList: false,
    notCharged: false,
    refundedInFull: false,
    discount: null,
    taxes: [],
    view: heldMembershipView(m, TODAY),
    billing: billingFor(n, made.membership, m, GOLD.priceMinor, TODAY),
    ...more,
  };
}
const answer = (memberships) => ({
  data: heldMembershipsResponseSchema.parse({
    today: TODAY,
    past: false,
    memberships,
    earlierNotShown: 0,
    types: [GOLD],
    listed: null,
    canBill: true,
    discounts: [],
    taxIncluded: false,
  }),
});
const KEY = 'b'.repeat(64);
const ASK = undoCancelAskSchema.parse({
  membership: { id: '44444444-4444-4444-8444-000000000001', name: 'Gold Monthly' },
  currency: 'GBP',
  question: "Undo the cancellation of Ada Lovelace's Gold Monthly?",
  choice: {
    button: 'Undo cancellation',
    lines: ["It will keep renewing until it's cancelled again.", 'Their next payment is £49.99 on 4 Nov 2026.'],
    next: { dueOn: '2026-11-04', amountMinor: 4999 },
    feeOffMinor: null,
    key: KEY,
  },
  notes: [],
});
const draw = () => (
  <MemoryRouter>
    <MemberMemberships gymId={GYM} entryId={ADA} name="Ada Lovelace" readOnly={false} />
  </MemoryRouter>
);

beforeEach(() => {
  vi.resetAllMocks();
  orgService.getTerminalPayments.mockImplementation(() => Promise.resolve({ data: { terminals: [], waiting: [] } }));
});
afterEach(() => cleanup());

describe('Undo cancellation', () => {
  it('a cancel made in the app has no Undo, and says it can be undone only in the app, even where the server says otherwise', async () => {
    const inApp = cancelledLater(1, { undoCancel: true, appCancel: { on: TODAY, byName: 'Ada Lovelace', reason: 'cost', keptOn: null, keptByName: null } });
    orgService.getHeldMemberships.mockResolvedValue(answer([inApp]));
    render(draw());
    const row = await screen.findByTestId('held-membership');
    expect(within(row).getByTestId('held-app-cancel-line').textContent).toBe('Cancelled in the app on 20 Oct 2026 by Ada Lovelace · Reason: Cost. It can be undone only in the app.');
    expect(within(row).queryByRole('button', { name: 'Undo cancellation' })).toBeNull();
  });

  it('a cancel the member kept reads as before, with no sentence about the app', async () => {
    const kept = cancelledLater(1, { appCancel: { on: '2026-10-10', byName: 'Ada Lovelace', reason: null, keptOn: '2026-10-12', keptByName: 'Ada Lovelace' } });
    orgService.getHeldMemberships.mockResolvedValue(answer([kept]));
    render(draw());
    const row = await screen.findByTestId('held-membership');
    expect(within(row).getByTestId('held-app-cancel-line').textContent).toBe('Cancelled in the app on 10 Oct 2026 by Ada Lovelace · Reactivated in the app on 12 Oct 2026');
    expect(within(row).queryByRole('button', { name: 'Undo cancellation' })).toBeNull();
  });

  it('opens its box under the membership, sends that membership with the box key, and says it is done', async () => {
    const gold = cancelledLater(1, { undoCancel: true });
    const other = cancelledLater(2);
    orgService.getHeldMemberships.mockResolvedValue(answer([gold, other]));
    orgService.getUndoCancel.mockResolvedValue({ data: ASK });
    orgService.changeHeldMembership.mockResolvedValue(answer([{ ...gold, undoCancel: false }, other]));
    render(draw());
    const rows = await screen.findAllByTestId('held-membership');
    expect(rows.map((r) => within(r).queryByRole('button', { name: 'Undo cancellation' }) !== null)).toEqual([true, false]);
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Undo cancellation' }));
    const ask = within(await within(rows[0]).findByTestId('held-ask-undoCancel'));
    expect(orgService.getUndoCancel).toHaveBeenCalledWith(GYM, ADA, gold.id);
    expect(await ask.findByText("Undo the cancellation of Ada Lovelace's Gold Monthly?")).toBeTruthy();
    expect(ask.getByText('Their next payment is £49.99 on 4 Nov 2026.')).toBeTruthy();
    expect(ask.getByRole('button', { name: 'Keep it cancelled' })).toBeTruthy();
    fireEvent.click(ask.getByRole('button', { name: 'Undo cancellation' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenCalledTimes(1));
    expect(orgService.changeHeldMembership).toHaveBeenCalledWith(GYM, ADA, gold.id, 'undo-cancel', { requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/), key: KEY });
    expect(await screen.findByText('Gold Monthly is reactivated and will keep renewing.')).toBeTruthy();
    expect(screen.queryByTestId('held-ask-undoCancel')).toBeNull();
  });

  it("a box with nothing to undo says why, with Close and no Undo button", async () => {
    const gold = cancelledLater(1, { undoCancel: true });
    orgService.getHeldMemberships.mockResolvedValue(answer([gold]));
    orgService.getUndoCancel.mockResolvedValue({ data: { ...ASK, choice: null, notes: ["It's frozen. Unfreeze it first, then undo the cancellation."] } });
    render(draw());
    const row = await screen.findByTestId('held-membership');
    fireEvent.click(within(row).getByRole('button', { name: 'Undo cancellation' }));
    const ask = within(await within(row).findByTestId('held-ask-undoCancel'));
    expect(await ask.findByText("It's frozen. Unfreeze it first, then undo the cancellation.")).toBeTruthy();
    expect(ask.queryByRole('button', { name: 'Undo cancellation' })).toBeNull();
    fireEvent.click(ask.getByRole('button', { name: 'Close' }));
    expect(within(row).queryByTestId('held-ask-undoCancel')).toBeNull();
    expect(orgService.changeHeldMembership).not.toHaveBeenCalled();
  });

  it('pressed again after a refusal, it sends the same request key', async () => {
    const gold = cancelledLater(1, { undoCancel: true });
    orgService.getHeldMemberships.mockResolvedValue(answer([gold]));
    orgService.getUndoCancel.mockResolvedValue({ data: ASK });
    orgService.changeHeldMembership.mockRejectedValueOnce(Object.assign(new Error('offline'), { response: undefined })).mockResolvedValue(answer([{ ...gold, undoCancel: false }]));
    render(draw());
    const row = await screen.findByTestId('held-membership');
    fireEvent.click(within(row).getByRole('button', { name: 'Undo cancellation' }));
    const ask = within(await within(row).findByTestId('held-ask-undoCancel'));
    fireEvent.click(await ask.findByRole('button', { name: 'Undo cancellation' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenCalledTimes(1));
    fireEvent.click(await ask.findByRole('button', { name: 'Undo cancellation' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenCalledTimes(2));
    const keys = orgService.changeHeldMembership.mock.calls.map((c) => c[4].requestKey);
    expect(keys[0]).toBe(keys[1]);
  });
});
