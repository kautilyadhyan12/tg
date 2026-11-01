// @vitest-environment jsdom
// Overview's Chargebacks card and a payment's line (ROADMAP 18d-iv-e-i).
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const svc = vi.hoisted(() => ({ list: vi.fn(), startPreview: vi.fn(), start: vi.fn() }));
vi.mock('../../api/chargebacksApi', () => ({ chargebacksService: svc }));
vi.mock('./MemberListPerson', () => ({ default: ({ entryId }) => <div role="dialog" aria-label={`person ${entryId}`} /> }));

const { default: ChargebacksCard } = await import('../../components/console/ChargebacksCard');
const { default: ChargebackLines, ChargeStopHolder } = await import('./ChargebackLines');
const { chargeStopLine, chargebackLines } = await import('./chargebackView');
const { reconnectWords } = await import('./paymentsView');

const ENTRY = '11111111-1111-4111-8111-111111111111';
const org = { id: '77777777-7777-4777-8777-777777777777', orgType: 'gym', slug: 'demo' };
const seen = { id: '22222222-2222-4222-8222-222222222222', amountMinor: 8804, currency: 'USD', state: 'EVIDENCE_REQUIRED', reason: 'NO_KNOWLEDGE', dueOn: '2026-11-14', duePassed: false, card: null, stops: true, name: 'Priya Kapoor', past: false, personDeleted: false, member: { entryId: ENTRY, what: 'Silver' }, sale: null };
const list = (over = {}) => ({ count: 1, rows: [seen], next: null, needsReconnect: false, canReconnect: false, ...over });
const show = (privileges) => render(<MemoryRouter><ChargebacksCard org={org} orgSlug="demo" privileges={privileges} readOnly={false} /></MemoryRouter>);
const BOTH = ['billing.members', 'members.confirm'];

afterEach(cleanup);

describe('ChargebacksCard', () => {
  it('names who, how much and the date; the link is Square\'s; their page opens', async () => {
    svc.list.mockResolvedValue(list());
    show(BOTH);
    const row = await screen.findByTestId('chargeback-row');
    expect(screen.getByTestId('chargebacks-headline').textContent).toBe('1 chargeback needs a response');
    expect(row.textContent).toContain('Priya Kapoor');
    expect(row.textContent).toContain('$88.04');
    expect(row.textContent).toContain('Respond in Square by 14 November 2026.');
    expect(within(row).getByRole('link', { name: 'Respond in Square' }).getAttribute('href')).toBe('https://squareup.com/dashboard/sales/disputes');
    fireEvent.click(within(row).getByRole('button', { name: 'Open their page' }));
    await screen.findByRole('dialog', { name: `person ${ENTRY}` });
  });

  it('a deleted member has no page to open, and still has the date', async () => {
    svc.list.mockResolvedValue(list({ rows: [{ ...seen, name: null, personDeleted: true, member: { entryId: null, what: 'Silver' } }] }));
    show(BOTH);
    const row = await screen.findByTestId('chargeback-row');
    expect(row.textContent).toContain('A deleted member');
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it('a state nobody has placed says to check, not a date', async () => {
    svc.list.mockResolvedValue(list({ rows: [{ ...seen, state: 'UNKNOWN' }] }));
    show(BOTH);
    const row = await screen.findByTestId('chargeback-row');
    expect(row.textContent).toContain('Check it in Square.');
    expect(row.textContent).not.toContain('by 14 November');
  });

  it('the owner is told to reconnect; others who can', async () => {
    svc.list.mockResolvedValue(list({ count: 0, rows: [], needsReconnect: true, canReconnect: false }));
    show(BOTH);
    expect((await screen.findByTestId('chargebacks-reconnect')).textContent).toBe('The owner needs to reconnect Square before chargebacks can show here.');
  });

  it('nothing to say, nothing drawn; no tick, no read', async () => {
    svc.list.mockResolvedValue(list({ count: 0, rows: [] }));
    const { container } = show(BOTH);
    await waitFor(() => expect(svc.list).toHaveBeenCalled());
    expect(container.textContent).toBe('');
    svc.list.mockClear();
    show(['members.read']);
    expect(svc.list).not.toHaveBeenCalled();
  });
});

describe('the lines', () => {
  it('a payment draws its chargeback', () => {
    render(<ChargebackLines lines={chargebackLines([seen], true)} />);
    expect(screen.getByTestId('chargeback').textContent).toContain("The app won't charge this card by itself.");
  });
  const lost = { ...seen, state: 'LOST', chargesStartedOn: null };

  it('a lost one: the button opens a box naming who, nothing starts until its own button, and Cancel leaves it', async () => {
    svc.start.mockReset();
    svc.startPreview.mockResolvedValue({ people: [{ name: 'Priya Kapoor', what: 'Silver' }, { name: 'Sam Kapoor', what: 'Silver' }], card: { brand: 'VISA', last4: '1111' }, otherStops: false });
    svc.start.mockResolvedValue(undefined);
    const onStarted = vi.fn();
    render(<ChargebackLines lines={chargebackLines([lost], true)} gymId={org.id} onStarted={onStarted} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start automatic charges again' }));
    const box = await screen.findByTestId('chargeback-start-box');
    expect(box.textContent).toContain('The app will charge Visa ending 1111 by itself again for:');
    expect(box.textContent).toContain('Sam Kapoor · Silver');
    expect(svc.start).not.toHaveBeenCalled();
    fireEvent.click(within(box).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('chargeback-start-box')).toBeNull();
    expect(svc.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Start automatic charges again' }));
    fireEvent.click(within(await screen.findByTestId('chargeback-start-box')).getByRole('button', { name: 'Start automatic charges' }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(1));
    expect(svc.start).toHaveBeenCalledWith(org.id, seen.id);
  });

  it('a refused press says so in the box, and nothing is said to have started', async () => {
    svc.startPreview.mockResolvedValue({ people: [{ name: 'Priya Kapoor', what: 'Silver' }], card: null, otherStops: false });
    svc.start.mockRejectedValue(new Error('no'));
    const onStarted = vi.fn();
    render(<ChargebackLines lines={chargebackLines([lost], true)} gymId={org.id} onStarted={onStarted} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start automatic charges again' }));
    const box = await screen.findByTestId('chargeback-start-box');
    fireEvent.click(within(box).getByRole('button', { name: 'Start automatic charges' }));
    expect((await within(box).findByRole('alert')).textContent).toBeTruthy();
    expect(onStarted).not.toHaveBeenCalled();
  });

  it('no button once started, on a sale, or on one still open', () => {
    const { rerender } = render(<ChargebackLines lines={chargebackLines([{ ...lost, stops: false, chargesStartedOn: '2026-11-02' }], true)} gymId={org.id} onStarted={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Start automatic charges again' })).toBeNull();
    expect(screen.getByTestId('chargeback').textContent).toContain('Automatic charges started again on 2 November 2026.');
    rerender(<ChargebackLines lines={chargebackLines([lost])} gymId={org.id} onStarted={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Start automatic charges again' })).toBeNull();
    rerender(<ChargebackLines lines={chargebackLines([seen], true)} gymId={org.id} onStarted={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Start automatic charges again' })).toBeNull();
  });

  it("the person whose chargeback it is opens from the bill", () => {
    render(<MemoryRouter><ChargeStopHolder holder={{ entryId: ENTRY, name: 'Pat' }} gym={{ slug: 'demo', viewerPrivileges: ['members.read'], privileges: ['members.read'] }} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: "Open Pat's page" }).getAttribute('href')).toContain(`?person=${ENTRY}`);
  });
  it('each stop says what is true', () => {
    expect(chargeStopLine(null)).toBeNull();
    expect(chargeStopLine({ kind: 'behind', heldBy: null })).toContain('the bill before it was paid late');
    expect(chargeStopLine({ kind: 'stopped', heldBy: null })).toBe('Not charged automatically because of a chargeback. You can still charge the card here.');
    expect(chargeStopLine({ kind: 'stopped', heldBy: { entryId: ENTRY, name: 'Pat' } })).toContain("a chargeback on Pat's payment");
    expect(chargeStopLine({ kind: 'missed', heldBy: null })).toBe('Not charged automatically while a chargeback was open. Charge the card here, oldest first. Automatic charges carry on once the missed bills are paid.');
  });
  it('Settings says why to reconnect', () => {
    expect(reconnectWords(['chargebacks']).line).toContain('chargebacks show here');
    expect(reconnectWords(['chargebacks', 'subscriptions']).hint).toContain('two more things');
    expect(reconnectWords(['subscriptions']).line).toContain('Delete permanently');
  });
});
